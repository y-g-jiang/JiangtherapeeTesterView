import { useEffect, useState } from 'react';
import { DarkEntry } from './DarkEntry.jsx';
import { EMPTY_MODE, ModeForm, modeIsComplete } from './ModeForm.jsx';

const ENTRIES = [
  { key: 'dark', label: '3 · 黑场对', ready: true, hint: '先拍这个：另外两个入口都要用它给出的黑电平' },
  { key: 'isogain', label: '2 · ISO 增益阶梯', ready: false, hint: '固定场景扫 ISO' },
  { key: 'ptc', label: '1 · PTC 平场对', ready: false, hint: '单 ISO，多快门' },
];

export const App = () => {
  const [mode, setMode] = useState(EMPTY_MODE);
  const [tab, setTab] = useState('dark');
  const [info, setInfo] = useState(null);

  useEffect(() => {
    window.jptc.systemInfo().then(setInfo);
  }, []);

  const complete = modeIsComplete(mode);

  return (
    <div className="app">
      <header className="topbar">
        <h1>JPTC Collect</h1>
        <span className="sub">相机噪声测量采集工具</span>
        {info && (
          <span className="meta">
            v{info.version} · LibRaw {info.libraw} · 并行 {info.concurrency}
          </span>
        )}
      </header>

      <main className="main">
        <ModeForm mode={mode} onChange={setMode} detected={null} />

        <nav className="tabs">
          {ENTRIES.map((e) => (
            <button
              key={e.key}
              className={`tab${tab === e.key ? ' is-on' : ''}${e.ready ? '' : ' is-todo'}`}
              onClick={() => e.ready && setTab(e.key)}
              disabled={!e.ready}
              title={e.hint}
            >
              {e.label}
              {!e.ready && <span className="soon">未实现</span>}
            </button>
          ))}
        </nav>

        {tab === 'dark' && <DarkEntry mode={mode} disabled={!complete} />}
      </main>

      <footer className="foot">
        采集端不做任何修正。所有数值按实测写出，量化步长、剪切参数与裁切几何都记在文件头里，
        修正与否由分析端决定。
      </footer>
    </div>
  );
};
