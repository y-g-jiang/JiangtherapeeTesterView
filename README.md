# JPTC Collect

相机噪声测量的采集端工具。你按流程拍，它把 RAW 读成可回收的 CSV。

**普通使用者看这两份就够了：[拍摄指南.md](拍摄指南.md)（怎么拍）和 [使用指南.md](使用指南.md)（软件怎么用，带截图）** —— 那里写了拍什么、怎么拍、为什么这么要求。这份 README 是给要改代码或自己构建的人看的。

## 它做什么

三个入口，按依赖顺序拍摄与处理：

| 入口 | 拍什么 | 产出 |
|---|---|---|
| **3 · 黑场对** | 每个 ISO 两张，机身盖 | 每 ISO 的黑电平、时域读噪、16 条一维噪声谱 |
| **2 · ISO 增益阶梯** | 固定场景扫 ISO | 各 ISO 各通道的电平 |
| **1 · PTC 平场对** | 单 ISO 扫快门，每级两张 | JPTC/2 格式的 PTC 数据 |

黑场先拍，因为另外两个入口在分析时都要用它给出的黑电平。

## 一条贯穿的规矩：采集端不做任何修正

写进文件的每一个数都必须属于「只有拿着像素才算得出来」那一类。凡是对这些数做算术就能得到的东西——除以 √2、Sheppard 修正、减黑电平、算增益比——一律留给分析端。

这在代码里是**结构性**的：每个通道返回 `measured` 和 `derived` 两个对象，`measured` 进文件，`derived` 只上屏幕，好让操作者当场看出这一组是不是废了。

**唯一的例外是坏点剪切**，因为判断一个像素好坏必须拿着那个像素，分析端复现不了。所以它的全部输入都记进文件头：k 值、未剪切的标准差、被剔除的像素数。不可撤销，但可审计。

同理，文件头里记着**实测的量化步长**——它从任何下游统计量里都反推不出来，只有能看到原始码值的采集端能定，而 Sheppard 修正必须有它。

## 构建

需要 Node 22+、Python、以及 **Visual Studio 生成工具 2022（含 C++ x64 工具集）**。

```bash
git clone --recurse-submodules <this repo>
npm install
npm run build:native     # 编译 LibRaw 插件，几分钟
npm run dev              # 开发模式
npm run pack             # 打包 Windows 安装包到 dist/
```

命令行工具（不开界面，方便验算）：

```bash
npm run probe -- <file.raw>                       # 元数据、量化步长、CFA 对齐
npm run dark  -- <A.raw> <B.raw> 5900 3900        # 黑场对的完整计算链
npm test                                          # DSP 层单测
```

### 构建上的三个坑

都踩过，记在这里免得再踩：

- **项目路径不能有空格或非 ASCII 字符。** node-gyp 会把 include 路径切碎、反斜杠吃掉、中文变乱码，而且报的错跟真正原因毫无关系。
- **`binding.gyp` 里不能同时写 `msvs_settings` 和 `msbuild_settings`。** gyp 见到后者就整个丢弃前者，连同 node-gyp 自己的 `DelayLoadDLLs` 和 `RuntimeLibrary`。少了 `/DELAYLOAD:node.exe`，插件会硬导入 `node.exe`：在 node 下正常，在 Electron 下被 Windows 加载器直接杀掉，**没有 JS 错误、没有栈、GUI 进程连控制台都没有**，看上去就是应用凭空消失。
- **LibRaw 的 `*_ph.cpp` 是占位实现**，用来在精简构建里替换真实的后处理代码，不是补充。两套一起编就是满屏重复符号。

## 结构

```
native/          LibRaw 原生插件（submodule 固定在 0.22.2）
src/dsp/         chirp-z FFT 与行列周期图
src/analysis/    三个入口各自的计算与配对
src/output/      CSV 写出器
src/renderer/    界面
electron/        主进程、preload、worker 池
docs/            设计文档
```

`src/dsp` 与 `src/analysis` 是纯函数、零 DOM 依赖，可以在 Node 下直接单测，`src/dsp/__tests__` 里钉着 Bluestein 对暴力 DFT、矩形窗 Parseval 到十位、以及植入条纹落在正确轴上这几条。

## 许可

未定。
