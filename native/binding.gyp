{
  "targets": [
    {
      "target_name": "libraw_binding",
      "sources": [
        "src/binding.cc",
        "vendor/LibRaw/src/decoders/canon_600.cpp",
        "vendor/LibRaw/src/decoders/crx.cpp",
        "vendor/LibRaw/src/decoders/decoders_dcraw.cpp",
        "vendor/LibRaw/src/decoders/decoders_libraw.cpp",
        "vendor/LibRaw/src/decoders/decoders_libraw_dcrdefs.cpp",
        "vendor/LibRaw/src/decoders/dng.cpp",
        "vendor/LibRaw/src/decoders/fp_dng.cpp",
        "vendor/LibRaw/src/decoders/fuji_compressed.cpp",
        "vendor/LibRaw/src/decoders/generic.cpp",
        "vendor/LibRaw/src/decoders/kodak_decoders.cpp",
        "vendor/LibRaw/src/decoders/load_mfbacks.cpp",
        "vendor/LibRaw/src/decoders/olympus14.cpp",
        "vendor/LibRaw/src/decoders/pana8.cpp",
        "vendor/LibRaw/src/decoders/smal.cpp",
        "vendor/LibRaw/src/decoders/sonycc.cpp",
        "vendor/LibRaw/src/decoders/unpack.cpp",
        "vendor/LibRaw/src/decoders/unpack_thumb.cpp",
        "vendor/LibRaw/src/decompressors/losslessjpeg.cpp",
        "vendor/LibRaw/src/demosaic/aahd_demosaic.cpp",
        "vendor/LibRaw/src/demosaic/ahd_demosaic.cpp",
        "vendor/LibRaw/src/demosaic/dcb_demosaic.cpp",
        "vendor/LibRaw/src/demosaic/dht_demosaic.cpp",
        "vendor/LibRaw/src/demosaic/misc_demosaic.cpp",
        "vendor/LibRaw/src/demosaic/xtrans_demosaic.cpp",
        "vendor/LibRaw/src/integration/dngsdk_glue.cpp",
        "vendor/LibRaw/src/integration/rawspeed_glue.cpp",
        "vendor/LibRaw/src/libraw_c_api.cpp",
        "vendor/LibRaw/src/libraw_datastream.cpp",
        "vendor/LibRaw/src/metadata/adobepano.cpp",
        "vendor/LibRaw/src/metadata/canon.cpp",
        "vendor/LibRaw/src/metadata/ciff.cpp",
        "vendor/LibRaw/src/metadata/cr3_parser.cpp",
        "vendor/LibRaw/src/metadata/epson.cpp",
        "vendor/LibRaw/src/metadata/exif_gps.cpp",
        "vendor/LibRaw/src/metadata/fuji.cpp",
        "vendor/LibRaw/src/metadata/hasselblad_model.cpp",
        "vendor/LibRaw/src/metadata/identify.cpp",
        "vendor/LibRaw/src/metadata/identify_tools.cpp",
        "vendor/LibRaw/src/metadata/kodak.cpp",
        "vendor/LibRaw/src/metadata/leica.cpp",
        "vendor/LibRaw/src/metadata/makernotes.cpp",
        "vendor/LibRaw/src/metadata/mediumformat.cpp",
        "vendor/LibRaw/src/metadata/minolta.cpp",
        "vendor/LibRaw/src/metadata/misc_parsers.cpp",
        "vendor/LibRaw/src/metadata/nikon.cpp",
        "vendor/LibRaw/src/metadata/normalize_model.cpp",
        "vendor/LibRaw/src/metadata/olympus.cpp",
        "vendor/LibRaw/src/metadata/p1.cpp",
        "vendor/LibRaw/src/metadata/pentax.cpp",
        "vendor/LibRaw/src/metadata/samsung.cpp",
        "vendor/LibRaw/src/metadata/sony.cpp",
        "vendor/LibRaw/src/metadata/tiff.cpp",
        "vendor/LibRaw/src/postprocessing/aspect_ratio.cpp",
        "vendor/LibRaw/src/postprocessing/dcraw_process.cpp",
        "vendor/LibRaw/src/postprocessing/mem_image.cpp",
        "vendor/LibRaw/src/postprocessing/postprocessing_aux.cpp",
        "vendor/LibRaw/src/postprocessing/postprocessing_utils.cpp",
        "vendor/LibRaw/src/postprocessing/postprocessing_utils_dcrdefs.cpp",
        "vendor/LibRaw/src/preprocessing/ext_preprocess.cpp",
        "vendor/LibRaw/src/preprocessing/raw2image.cpp",
        "vendor/LibRaw/src/preprocessing/subtract_black.cpp",
        "vendor/LibRaw/src/tables/cameralist.cpp",
        "vendor/LibRaw/src/tables/colorconst.cpp",
        "vendor/LibRaw/src/tables/colordata.cpp",
        "vendor/LibRaw/src/tables/wblists.cpp",
        "vendor/LibRaw/src/utils/curves.cpp",
        "vendor/LibRaw/src/utils/decoder_info.cpp",
        "vendor/LibRaw/src/utils/init_close_utils.cpp",
        "vendor/LibRaw/src/utils/open.cpp",
        "vendor/LibRaw/src/utils/phaseone_processing.cpp",
        "vendor/LibRaw/src/utils/read_utils.cpp",
        "vendor/LibRaw/src/utils/thumb_utils.cpp",
        "vendor/LibRaw/src/utils/utils_dcraw.cpp",
        "vendor/LibRaw/src/utils/utils_libraw.cpp",
        "vendor/LibRaw/src/write/apply_profile.cpp",
        "vendor/LibRaw/src/write/file_write.cpp",
        "vendor/LibRaw/src/write/tiff_writer.cpp",
        "vendor/LibRaw/src/x3f/x3f_parse_process.cpp",
        "vendor/LibRaw/src/x3f/x3f_utils_patched.cpp"
      ],
      "include_dirs": [
        "../node_modules/node-addon-api",
        "vendor/LibRaw",
        "vendor/LibRaw/libraw"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "LIBRAW_NODLL",
        "NO_JPEG",
        "NO_LCMS",
        "NO_JASPER",
        "_CRT_SECURE_NO_WARNINGS",
        "WIN32_LEAN_AND_MEAN"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-w"
      ],
      "msbuild_settings": {
        "ClCompile": {
          "LanguageStandard": "stdcpp17",
          "RuntimeLibrary": "MultiThreaded",
          "ExceptionHandling": "Sync",
          "WarningLevel": "TurnOffAllWarnings",
          "AdditionalOptions": [
            "/bigobj"
          ]
        },
        "Link": {
          "DelayLoadDLLs": [
            "node.exe",
            "%(DelayLoadDLLs)"
          ]
        }
      }
    }
  ]
}