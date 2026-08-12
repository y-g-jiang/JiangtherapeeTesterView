import { useEffect, useState } from 'react';

const fmt = (v, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const shutterText = (s) => (s >= 1 ? `${s}s` : `1/${Math.round(1 / s)}s`);

export const DarkEntry = ({ mode, disabled }) => {
  const [dir, setDir] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [cropW, setCropW] = useState(5900);
  const [cropH, setCropH] = useState(3900);

  useEffect(() => window.jptc.onScanProgress(setScanning), []);
  useEffect(() => window.jptc.onRunProgress(setRunning), []);

  const pick = async () => {
    setError(null);
    const chosen = await window.jptc.pickFolder();
    if (!chosen) return;
    setDir(chosen);
    setScan(null);
    setResults(null);
    setSaved(null);
    setScanning({ done: 0, total: 0, name: '' });
    try {
      const out = await window.jptc.scanFolder(chosen);
      setScan(out);
      if (out.frames.length) {
        // Default the crop to the largest even box inside the visible area,
        // minus a small margin, rather than making the operator guess.
        const m = out.frames[0].meta;
        setCropW(Math.min(cropW, (m.width - 100) & ~1));
        setCropH(Math.min(cropH, (m.height - 100) & ~1));
      }
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setScanning(null);
    }
  };

  const run = async () => {
    setError(null);
    setResults(null);
    setSaved(null);
    setRunning({ done: 0, total: scan.pairs.length });
    try {
      const out = await window.jptc.runDark({
        pairs: scan.pairs.map((p) => ({
          iso: p.iso,
          pathA: p.a.path,
          pathB: p.b.path,
          nameA: p.a.name,
          nameB: p.b.name,
        })),
        cropW,
        cropH,
        window: 'hann',
      });
      setResults(out);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(null);
    }
  };

  const save = async () => {
    setError(null);
    try {
      const out = await window.jptc.saveResults({ mode });
      if (out) setSaved(out);
    } catch (e) {
      setError(e?.message ?? String(e));
    }
  };

  if (disabled) {
    return (
      <section className="card card--locked">
        <h2>入口 3 · 黑场对</h2>
        <p>先把上面的拍摄模式填完。</p>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="card-head">
        <h2>入口 3 · 黑场对</h2>
        <p>
          每个 ISO 两张，机身盖，最低到最高。这组数据一次给出三样东西：每个 ISO 的黑电平、每个 ISO 的时域读噪，以及噪声谱。
          另外两个入口都要用这里的黑电平，所以先拍它。
        </p>
      </header>

      <div className="actions">
        <button className="primary" onClick={pick}>
          选择文件夹…
        </button>
        {dir && <span className="path" title={dir}>{dir}</span>}
      </div>

      {scanning && (
        <p className="progress">
          正在读取 {scanning.done}/{scanning.total} {scanning.name}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {scan?.failures?.length > 0 && (
        <div className="panel panel--error">
          <h3>这些文件读不了</h3>
          <ul>
            {scan.failures.map((f) => (
              <li key={f.name}>
                <b>{f.name}</b> — {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {scan?.problems?.length > 0 && (
        <div className="panel panel--warn">
          {scan.problems.map((p, i) => (
            <p key={i}>{p.message}</p>
          ))}
        </div>
      )}

      {scan?.rejected?.length > 0 && (
        <div className="panel panel--error">
          <h3>不能用的组，需要补拍</h3>
          {scan.rejected.map((r, i) => (
            <div key={i} className="reject">
              <b>ISO {r.iso}</b>
              <span className="files">{r.files.join('、')}</span>
              {r.message && <p>{r.message}</p>}
              {r.checks?.map((c, j) => (
                <p key={j}>{c.message}</p>
              ))}
            </div>
          ))}
        </div>
      )}

      {scan?.pairs?.length > 0 && (
        <>
          <div className="panel">
            <h3>找到 {scan.pairs.length} 对，可以处理</h3>
            <table className="mini">
              <thead>
                <tr>
                  <th>ISO</th>
                  <th>快门</th>
                  <th>A</th>
                  <th>B</th>
                  <th>提示</th>
                </tr>
              </thead>
              <tbody>
                {scan.pairs.map((p) => (
                  <tr key={p.iso}>
                    <td className="num">{p.iso}</td>
                    <td>{shutterText(p.shutter)}</td>
                    <td>{p.a.name}</td>
                    <td>{p.b.name}</td>
                    <td className="warn">{p.warnings.map((w) => w.message).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions actions--wrap">
            <label className="inline">
              中心裁切
              <input
                type="number"
                value={cropW}
                step={2}
                onChange={(e) => setCropW(Number(e.target.value))}
              />
              ×
              <input
                type="number"
                value={cropH}
                step={2}
                onChange={(e) => setCropH(Number(e.target.value))}
              />
              <small>马赛克像素。避开画面边缘的遮蔽区与漏光。</small>
            </label>
            <button className="primary" onClick={run} disabled={!!running}>
              {running ? `处理中 ${running.done}/${running.total}` : '开始处理'}
            </button>
          </div>
        </>
      )}

      {results && (
        <div className="panel">
          <h3>结果</h3>
          <p className="note">
            下表是<b>实测值</b>，没有做任何修正。时域读噪与 FPN 是由它们算出来的、只显示在这里，不写进文件——
            那两步谁都能重算，不该由采集端替你决定。
          </p>
          <table className="mini">
            <thead>
              <tr>
                <th>ISO</th>
                <th>通道</th>
                <th>黑电平 A</th>
                <th>std A</th>
                <th>std D</th>
                <th>剪切后</th>
                <th>剔除</th>
                <th className="derived">时域读噪</th>
                <th className="derived">FPN</th>
              </tr>
            </thead>
            <tbody>
              {results.results.map((r) =>
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

          <div className="actions">
            <button className="primary" onClick={save}>
              保存 CSV…
            </button>
          </div>
        </div>
      )}

      {saved && (
        <div className="panel panel--ok">
          <h3>已保存到 {saved.dir}</h3>
          <ul>
            {saved.files.map((f) => (
              <li key={f.path}>
                <button className="link" onClick={() => window.jptc.reveal(f.path)}>
                  {f.name}
                </button>
                <span className="size">{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
          <p className="note">把这几个文件一起寄回即可。</p>
        </div>
      )}
    </section>
  );
};
