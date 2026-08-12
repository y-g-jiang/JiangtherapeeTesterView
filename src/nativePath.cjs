/*
 * Where the LibRaw addon lives.
 *
 * One build serves both node.exe and electron.exe. That is what Node-API is
 * for, and it only works because the addon is linked with /DELAYLOAD:node.exe
 * so its Node symbols bind to whichever executable is hosting it.
 *
 * Getting that wrong is worth remembering: without the delay-load the addon
 * hard-imports node.exe, which loads fine under Node and kills electron.exe
 * during the Windows loader's import resolution -- no JS error, no stack, and
 * on a GUI-subsystem process no console either. It simply vanishes.
 */
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');

const root = resolve(__dirname, '..');

const CANDIDATES = [
  resolve(root, 'native/prebuilt/libraw_binding.node'),
  resolve(root, 'native/build/Release/libraw_binding.node'),
];

const resolveNativePath = () => {
  for (const path of CANDIDATES) if (existsSync(path)) return path;
  throw new Error('LibRaw 插件还没有编译。请先运行  npm run build:native');
};

module.exports = { resolveNativePath };
