// LibRaw binding for the collector.
//
// It does exactly one thing: hand back the sensor's own numbers. open_buffer()
// then unpack(), never dcraw_process(). Demosaic, white balance and colour
// conversion would each destroy the statistics this tool exists to measure,
// and they are also where nearly all of the decode time goes.

#include <napi.h>

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <vector>

#include "libraw/libraw.h"

namespace {

// Greatest common divisor of the gaps between distinct code values. A file
// whose 12-bit samples were scaled into a 16-bit container has every code a
// multiple of 16, and that factor cannot be recovered from any statistic
// computed downstream -- only from the codes themselves, here.
uint32_t Gcd(uint32_t a, uint32_t b) {
  while (b) {
    uint32_t t = a % b;
    a = b;
    b = t;
  }
  return a;
}

struct QuantisationProbe {
  uint32_t step = 1;
  uint32_t distinctSampled = 0;
  uint32_t minCode = 0;
  uint32_t maxCode = 0;
};

// Sample the plane, collect distinct codes, and take the GCD of their
// differences from the minimum. Sampling rather than sweeping keeps this
// cheap; a stride that shares no factor with the CFA period avoids landing on
// one colour.
QuantisationProbe ProbeQuantisation(const uint16_t* data, size_t count) {
  QuantisationProbe out;
  if (!data || count == 0) return out;

  const size_t stride = std::max<size_t>(1, count / 400000);
  uint32_t lo = 0xFFFFFFFFu;
  uint32_t hi = 0;
  std::vector<uint32_t> codes;
  codes.reserve(4096);

  for (size_t i = 0; i < count; i += stride) {
    uint32_t v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (codes.size() < 200000) codes.push_back(v);
  }
  if (codes.empty()) return out;

  std::sort(codes.begin(), codes.end());
  codes.erase(std::unique(codes.begin(), codes.end()), codes.end());

  uint32_t g = 0;
  for (size_t i = 1; i < codes.size(); i++) {
    g = Gcd(g, codes[i] - codes[i - 1]);
    if (g == 1) break;
  }

  out.step = g == 0 ? 1 : g;
  out.distinctSampled = static_cast<uint32_t>(codes.size());
  out.minCode = lo;
  out.maxCode = hi;
  return out;
}

class RawFile : public Napi::ObjectWrap<RawFile> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  RawFile(const Napi::CallbackInfo& info);

 private:
  Napi::Value Open(const Napi::CallbackInfo& info);
  Napi::Value Metadata(const Napi::CallbackInfo& info);
  Napi::Value CentreCrop(const Napi::CallbackInfo& info);
  Napi::Value ChannelPlane(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);

  LibRaw processor_;
  bool unpacked_ = false;
  // Owned copy of the file bytes: LibRaw's open_buffer keeps a pointer into
  // whatever it was handed, and a JS-owned ArrayBuffer can move or be freed.
  std::vector<uint8_t> buffer_;
};

Napi::Object RawFile::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function ctor = DefineClass(env, "RawFile", {
    InstanceMethod("open", &RawFile::Open),
    InstanceMethod("metadata", &RawFile::Metadata),
    InstanceMethod("centreCrop", &RawFile::CentreCrop),
    InstanceMethod("channelPlane", &RawFile::ChannelPlane),
    InstanceMethod("close", &RawFile::Close),
  });
  exports.Set("RawFile", ctor);
  return exports;
}

RawFile::RawFile(const Napi::CallbackInfo& info) : Napi::ObjectWrap<RawFile>(info) {}

Napi::Value RawFile::Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "open(buffer) expects a Buffer").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  Napi::Buffer<uint8_t> input = info[0].As<Napi::Buffer<uint8_t>>();
  buffer_.assign(input.Data(), input.Data() + input.Length());

  int rc = processor_.open_buffer(buffer_.data(), buffer_.size());
  if (rc != LIBRAW_SUCCESS) {
    Napi::Error::New(env, std::string("LibRaw open_buffer failed: ") + libraw_strerror(rc))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  rc = processor_.unpack();
  if (rc != LIBRAW_SUCCESS) {
    Napi::Error::New(env, std::string("LibRaw unpack failed: ") + libraw_strerror(rc))
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (!processor_.imgdata.rawdata.raw_image) {
    Napi::Error::New(env,
        "This file has no single-plane Bayer mosaic (Foveon, or already three-colour). "
        "The collector needs a CFA sensor.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  unpacked_ = true;
  return env.Undefined();
}

Napi::Value RawFile::Metadata(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!unpacked_) {
    Napi::Error::New(env, "metadata() before open()").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const libraw_data_t& d = processor_.imgdata;
  Napi::Object out = Napi::Object::New(env);

  out.Set("make", Napi::String::New(env, d.idata.make));
  out.Set("model", Napi::String::New(env, d.idata.model));
  out.Set("normalizedMake", Napi::String::New(env, d.idata.normalized_make));
  out.Set("normalizedModel", Napi::String::New(env, d.idata.normalized_model));
  out.Set("software", Napi::String::New(env, d.idata.software));
  out.Set("colors", Napi::Number::New(env, d.idata.colors));
  // cdesc is a char[5] naming the colours in index order, e.g. "RGBG".
  out.Set("cfaPattern", Napi::String::New(env, std::string(d.idata.cdesc)));
  out.Set("filters", Napi::Number::New(env, d.idata.filters));

  out.Set("rawWidth", Napi::Number::New(env, d.sizes.raw_width));
  out.Set("rawHeight", Napi::Number::New(env, d.sizes.raw_height));
  out.Set("width", Napi::Number::New(env, d.sizes.width));
  out.Set("height", Napi::Number::New(env, d.sizes.height));
  out.Set("topMargin", Napi::Number::New(env, d.sizes.top_margin));
  out.Set("leftMargin", Napi::Number::New(env, d.sizes.left_margin));
  out.Set("rawPitch", Napi::Number::New(env, d.sizes.raw_pitch));
  out.Set("flip", Napi::Number::New(env, d.sizes.flip));

  out.Set("iso", Napi::Number::New(env, d.other.iso_speed));
  out.Set("shutter", Napi::Number::New(env, d.other.shutter));
  out.Set("aperture", Napi::Number::New(env, d.other.aperture));
  out.Set("focalLen", Napi::Number::New(env, d.other.focal_len));
  out.Set("timestamp", Napi::Number::New(env, static_cast<double>(d.other.timestamp)));
  out.Set("shotOrder", Napi::Number::New(env, d.other.shot_order));

  out.Set("lens", Napi::String::New(env, d.lens.Lens));
  out.Set("lensMake", Napi::String::New(env, d.lens.LensMake));

  // Black level: LibRaw splits it into a scalar plus a per-channel correction,
  // and some cameras additionally carry a per-pixel pattern in cblack[4..5].
  out.Set("black", Napi::Number::New(env, d.color.black));
  Napi::Array cblack = Napi::Array::New(env, 4);
  for (uint32_t i = 0; i < 4; i++) {
    cblack.Set(i, Napi::Number::New(env, d.color.cblack[i]));
  }
  out.Set("cblack", cblack);
  out.Set("cblackPatternRows", Napi::Number::New(env, d.color.cblack[4]));
  out.Set("cblackPatternCols", Napi::Number::New(env, d.color.cblack[5]));
  out.Set("maximum", Napi::Number::New(env, d.color.maximum));
  out.Set("linearMax0", Napi::Number::New(env, d.color.linear_max[0]));

  out.Set("librawVersion", Napi::String::New(env, LibRaw::version()));

  const size_t count =
      static_cast<size_t>(d.sizes.raw_height) * static_cast<size_t>(d.sizes.raw_width);
  QuantisationProbe q = ProbeQuantisation(d.rawdata.raw_image, count);
  Napi::Object quant = Napi::Object::New(env);
  quant.Set("step", Napi::Number::New(env, q.step));
  quant.Set("distinctSampled", Napi::Number::New(env, q.distinctSampled));
  quant.Set("minCode", Napi::Number::New(env, q.minCode));
  quant.Set("maxCode", Napi::Number::New(env, q.maxCode));

  /*
   * A single GCD only catches a *uniform* scaling — 12-bit samples living in a
   * 16-bit container. Lossy-compressed RAW instead companded the data through
   * a lookup curve before storing it, so the effective quantisation step grows
   * with signal and no single q exists. Sheppard's correction would then need
   * q(S), not q.
   *
   * LibRaw exposes the linearisation table it applied. If it is not the
   * identity, the file is companded and the local step has to be read off the
   * curve.
   */
  Napi::Object curve = Napi::Object::New(env);
  int curveMax = 0;
  for (int i = 0x10000 - 1; i >= 0; i--) {
    if (d.color.curve[i] != 0) {
      curveMax = i;
      break;
    }
  }
  bool identity = true;
  for (int i = 0; i <= curveMax; i++) {
    if (d.color.curve[i] != i) {
      identity = false;
      break;
    }
  }
  curve.Set("length", Napi::Number::New(env, curveMax + 1));
  curve.Set("isIdentity", Napi::Boolean::New(env, identity || curveMax == 0));

  // Local step at a ladder of levels, so a companding curve is visible as a
  // step that climbs rather than a single number.
  Napi::Array ladder = Napi::Array::New(env);
  if (!identity && curveMax > 1) {
    uint32_t written = 0;
    for (int frac = 1; frac <= 16; frac++) {
      const int i = static_cast<int>(static_cast<double>(curveMax) * frac / 16.0);
      if (i < 1 || i > curveMax) continue;
      Napi::Object point = Napi::Object::New(env);
      point.Set("index", Napi::Number::New(env, i));
      point.Set("value", Napi::Number::New(env, d.color.curve[i]));
      point.Set("localStep",
                Napi::Number::New(env, static_cast<int>(d.color.curve[i]) -
                                           static_cast<int>(d.color.curve[i - 1])));
      ladder.Set(written++, point);
    }
  }
  curve.Set("ladder", ladder);
  quant.Set("linearisationCurve", curve);

  out.Set("quantisation", quant);

  return out;
}

// Centre crop of the *mosaic*, in mosaic pixels, aligned so the CFA phase of
// the crop matches the sensor's. Misaligning it by one pixel would silently
// swap the channel labels.
Napi::Value RawFile::CentreCrop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!unpacked_) {
    Napi::Error::New(env, "centreCrop() before open()").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const int size = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 512;
  if (size < 4 || (size & 1)) {
    Napi::Error::New(env, "centreCrop(size) needs an even size of at least 4")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const libraw_data_t& d = processor_.imgdata;
  const int rawW = d.sizes.raw_width;
  const int rawH = d.sizes.raw_height;
  // Stay inside the visible area: the masked border carries no signal and
  // would drag every statistic toward the black level.
  const int visW = d.sizes.width;
  const int visH = d.sizes.height;
  if (size > visW || size > visH) {
    Napi::Error::New(env, "centreCrop() larger than the visible image")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  int x0 = d.sizes.left_margin + (visW - size) / 2;
  int y0 = d.sizes.top_margin + (visH - size) / 2;
  // Preserve CFA phase relative to the raw origin.
  x0 -= (x0 - d.sizes.left_margin) & 1 ? 1 : 0;
  y0 -= (y0 - d.sizes.top_margin) & 1 ? 1 : 0;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x0 + size > rawW) x0 = rawW - size;
  if (y0 + size > rawH) y0 = rawH - size;

  Napi::Uint16Array out = Napi::Uint16Array::New(env, static_cast<size_t>(size) * size);
  const uint16_t* src = d.rawdata.raw_image;
  for (int y = 0; y < size; y++) {
    std::memcpy(out.Data() + static_cast<size_t>(y) * size,
                src + static_cast<size_t>(y0 + y) * rawW + x0,
                static_cast<size_t>(size) * sizeof(uint16_t));
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("data", out);
  result.Set("size", Napi::Number::New(env, size));
  result.Set("x0", Napi::Number::New(env, x0));
  result.Set("y0", Napi::Number::New(env, y0));
  // Which CFA colour sits at the crop's top-left, so the caller can label
  // R/G1/G2/B without re-deriving the phase.
  result.Set("originColor", Napi::Number::New(env, processor_.COLOR(y0, x0)));
  return result;
}

// One CFA channel as a dense plane, for the 1D spectra.
//
// channelPlane(index, cropW = 0, cropH = 0). A crop of 0 means the whole
// visible area; otherwise a centred crop of that many *mosaic* pixels, which
// is how a masked or otherwise unusable border gets excluded. The crop origin
// is forced to the sensor's CFA phase, so the channel labels never shift.
Napi::Value RawFile::ChannelPlane(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!unpacked_) {
    Napi::Error::New(env, "channelPlane() before open()").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const int wanted = info.Length() > 0 ? info[0].As<Napi::Number>().Int32Value() : 0;
  if (wanted < 0 || wanted > 3) {
    Napi::TypeError::New(env, "channelPlane(index) takes 0..3 for R, G1, G2, B")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const int cropW = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 0;
  const int cropH = info.Length() > 2 ? info[2].As<Napi::Number>().Int32Value() : 0;

  const libraw_data_t& d = processor_.imgdata;
  const int rawW = d.sizes.raw_width;
  int x0 = d.sizes.left_margin;
  int y0 = d.sizes.top_margin;
  int visW = d.sizes.width;
  int visH = d.sizes.height;

  if (cropW > 0 || cropH > 0) {
    const int wantW = cropW > 0 ? cropW : visW;
    const int wantH = cropH > 0 ? cropH : visH;
    if (wantW > visW || wantH > visH) {
      Napi::Error::New(env, "channelPlane() crop is larger than the visible image")
          .ThrowAsJavaScriptException();
      return env.Undefined();
    }
    // Even offsets keep the CFA phase; even extents keep the four planes the
    // same size as each other.
    x0 += ((visW - wantW) / 2) & ~1;
    y0 += ((visH - wantH) / 2) & ~1;
    visW = wantW & ~1;
    visH = wantH & ~1;
  }

  // Index 0..3 addresses the 2x2 CFA cell by position, not by colour name:
  // (0,0) (0,1) (1,0) (1,1). The caller pairs it with cfaPattern to get names.
  const int dy = wanted >> 1;
  const int dx = wanted & 1;
  const int planeW = (visW - dx + 1) / 2;
  const int planeH = (visH - dy + 1) / 2;

  Napi::Uint16Array out =
      Napi::Uint16Array::New(env, static_cast<size_t>(planeW) * planeH);
  const uint16_t* src = d.rawdata.raw_image;
  uint16_t* dst = out.Data();

  for (int y = 0; y < planeH; y++) {
    const uint16_t* row = src + static_cast<size_t>(y0 + dy + 2 * y) * rawW + x0 + dx;
    uint16_t* orow = dst + static_cast<size_t>(y) * planeW;
    for (int x = 0; x < planeW; x++) orow[x] = row[2 * x];
  }

  Napi::Object result = Napi::Object::New(env);
  result.Set("data", out);
  result.Set("width", Napi::Number::New(env, planeW));
  result.Set("height", Napi::Number::New(env, planeH));
  result.Set("x0", Napi::Number::New(env, x0));
  result.Set("y0", Napi::Number::New(env, y0));
  result.Set("mosaicWidth", Napi::Number::New(env, visW));
  result.Set("mosaicHeight", Napi::Number::New(env, visH));
  result.Set("color", Napi::Number::New(env, processor_.COLOR(dy, dx)));
  return result;
}

Napi::Value RawFile::Close(const Napi::CallbackInfo& info) {
  processor_.recycle();
  buffer_.clear();
  buffer_.shrink_to_fit();
  unpacked_ = false;
  return info.Env().Undefined();
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("version", Napi::String::New(env, LibRaw::version()));
  return RawFile::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(libraw_binding, InitAll)
