import { EntryPanel, fmt, pct } from './EntryPanel.jsx';

/** Shared crop control for the two whole-frame entries. */
const areaCrop = (initial) => ({
  initial,
  render: (crop, setCrop) => (
    <label className="inline">
      中心裁切
      <input
        type="number"
        value={crop.cropW}
        step={2}
        onChange={(e) => setCrop({ ...crop, cropW: Number(e.target.value) })}
      />
      ×
      <input
        type="number"
        value={crop.cropH}
        step={2}
        onChange={(e) => setCrop({ ...crop, cropH: Number(e.target.value) })}
      />
      <small>马赛克像素。避开画面边缘的遮蔽区与漏光。</small>
    </label>
  ),
});

// --------------------------------------------------------------------------
// entry 3 -- dark pairs
// --------------------------------------------------------------------------

const DarkResults = ({ results }) => (
  <table className="mini">
    <thead>
      <tr>
        <th>ISO</th><th>通道</th><th>黑电平 A</th><th>std A</th><th>std D</th>
        <th>剪切后</th><th>剔除</th>
        <th className="derived">时域读噪</th><th className="derived">FPN</th>
      </tr>
    </thead>
    <tbody>
      {results.map((r) =>
        r.failed ? (
          <tr key={r.iso}>
            <td className="num">{r.iso}</td>
            <td colSpan={8} className="error">{r.failed}</td>
          </tr>
        ) : (
          r.channels.map((c, i) => (
            <tr key={`${r.iso}-${i}`}>
              <td className="num">{i === 0 ? r.iso : ''}</td>
              <td>{c.position}</td>
              <td className="num">{fmt(c.measured.blackA)}</td>
              <td className="num">{fmt(c.measured.stdA)}</td>
              <td className="num">{fmt(c.measured.stdDiffRaw)}</td>
              <td className="num">{fmt(c.measured.stdDiffClipped)}</td>
              <td className="num">{c.measured.rejected}</td>
              <td className="num derived">{fmt(c.derived.temporalStd)}</td>
              <td className="num derived">{fmt(c.derived.fpnStd)}</td>
            </tr>
          ))
        ),
      )}
    </tbody>
  </table>
);

export const DarkEntry = (props) => (
  <EntryPanel
    {...props}
    entry="dark"
    title="入口 3 · 黑场对"
    blurb={
      <p>
        每个 ISO 两张，机身盖，最低到最高。这组一次给出三样东西：每个 ISO 的黑电平、每个 ISO 的时域读噪，
        以及噪声谱。另外两个入口都要用这里的黑电平，所以先拍它。
      </p>
    }
    cropControl={areaCrop({ cropW: 5900, cropH: 3900 })}
    buildJobs={(scan, crop) =>
      (scan.pairs ?? []).map((p) => ({
        iso: p.iso,
        shutter: p.shutter,
        pathA: p.a.path,
        pathB: p.b.path,
        nameA: p.a.name,
        nameB: p.b.name,
        warning: p.warnings.map((w) => w.message).join(' '),
        ...crop,
        spectra: true,
      }))
    }
    Results={DarkResults}
  />
);

// --------------------------------------------------------------------------
// entry 2 -- ISO gain ladder
// --------------------------------------------------------------------------

const GainResults = ({ results }) => (
  <table className="mini">
    <thead>
      <tr>
        <th>ISO</th><th>快门</th><th>通道</th><th>Mean</th><th>Std</th><th>过曝比例</th>
        <th className="derived">高于黑电平</th><th className="derived">占满阱</th>
      </tr>
    </thead>
    <tbody>
      {results.map((r, ri) =>
        r.failed ? (
          <tr key={ri}>
            <td className="num">{r.iso}</td>
            <td colSpan={7} className="error">{r.failed}</td>
          </tr>
        ) : (
          r.channels.map((c, i) => (
            <tr key={`${ri}-${i}`}>
              <td className="num">{i === 0 ? r.iso : ''}</td>
              <td>{i === 0 ? (r.shutter >= 1 ? `${r.shutter}s` : `1/${Math.round(1 / r.shutter)}s`) : ''}</td>
              <td>{['(0,0)', '(0,1)', '(1,0)', '(1,1)'][i]}</td>
              <td className="num">{fmt(c.measured.mean, 3)}</td>
              <td className="num">{fmt(c.measured.std, 3)}</td>
              <td className="num">{pct(c.measured.clipFrac)}</td>
              <td className="num derived">{fmt(c.derived.aboveBlack, 1)}</td>
              <td className="num derived">{pct(c.derived.fractionOfFull, 1)}</td>
            </tr>
          ))
        ),
      )}
    </tbody>
  </table>
);

export const GainEntry = (props) => (
  <EntryPanel
    {...props}
    entry="gain"
    title="入口 2 · ISO 增益阶梯"
    blurb={
      <p>
        固定场景、固定光圈，扫 ISO。工具只记录电平，不算增益比——比值的算法会变，实测电平不会。
        推荐「同快门配对」：每个快门时间下拍相邻两档 ISO，快门就从算式里约掉了。
      </p>
    }
    cropControl={areaCrop({ cropW: 5900, cropH: 3900 })}
    buildJobs={(scan, crop) =>
      (scan.usable ?? []).map((f) => ({
        iso: f.meta.iso,
        shutter: f.meta.shutter,
        path: f.path,
        name: f.name,
        shutterGroup: f.meta.shutter.toPrecision(6),
        ...crop,
      }))
    }
    Results={GainResults}
  />
);

// --------------------------------------------------------------------------
// entry 1 -- PTC flat-field pairs
// --------------------------------------------------------------------------

const PtcResults = ({ results }) => (
  <table className="mini">
    <thead>
      <tr>
        <th>快门</th><th>通道</th><th>Mean A</th><th>std A</th><th>std D</th>
        <th>剪切后</th><th>过曝</th>
        <th className="derived">信号</th><th className="derived">时域噪声</th>
      </tr>
    </thead>
    <tbody>
      {results.map((r, ri) =>
        r.failed ? (
          <tr key={ri}>
            <td colSpan={9} className="error">{r.failed}</td>
          </tr>
        ) : (
          r.channels.map((c, i) => (
            <tr key={`${ri}-${i}`}>
              <td>{i === 0 ? (r.shutter >= 1 ? `${r.shutter}s` : `1/${Math.round(1 / r.shutter)}s`) : ''}</td>
              <td>{c.position}</td>
              <td className="num">{fmt(c.measured.meanA, 2)}</td>
              <td className="num">{fmt(c.measured.stdA, 3)}</td>
              <td className="num">{fmt(c.measured.stdDiffRaw, 3)}</td>
              <td className="num">{fmt(c.measured.stdDiffClipped, 3)}</td>
              <td className="num">{pct(c.measured.clipFrac, 2)}</td>
              <td className="num derived">{fmt(c.derived.signal, 1)}</td>
              <td className="num derived">{fmt(c.derived.temporalStd, 3)}</td>
            </tr>
          ))
        ),
      )}
    </tbody>
  </table>
);

export const PtcEntry = (props) => (
  <EntryPanel
    {...props}
    entry="ptc"
    title="入口 1 · PTC 平场对"
    blurb={
      <p>
        单一 ISO，扫快门，从接近全黑到刚刚过曝，每级两张。取中心 512×512 马赛克。
        产出的就是分析端直接能读的 JPTC/2。
      </p>
    }
    cropControl={{
      initial: { cropSize: 512 },
      render: (crop, setCrop) => (
        <label className="inline">
          中心裁切
          <input
            type="number"
            value={crop.cropSize}
            step={2}
            onChange={(e) => setCrop({ cropSize: Number(e.target.value) })}
          />
          <small>马赛克像素的正方形，每通道是它的一半。</small>
        </label>
      ),
    }}
    buildJobs={(scan, crop) =>
      (scan.pairs ?? []).map((p) => ({
        iso: p.a.meta.iso,
        shutter: p.shutter,
        pathA: p.a.path,
        pathB: p.b.path,
        nameA: p.a.name,
        nameB: p.b.name,
        warning: p.warnings.map((w) => w.message).join(' '),
        ...crop,
      }))
    }
    Results={PtcResults}
  />
);
