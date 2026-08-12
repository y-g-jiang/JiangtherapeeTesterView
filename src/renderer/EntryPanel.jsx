import { useEffect, useState } from 'react';

const fmt = (v, d = 4) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d);
const shutterText = (s) => (s >= 1 ? `${Number(s.toFixed(3))}s` : `1/${Math.round(1 / s)}s`);
const pct = (v, d = 3) => (Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : '—');

/**
 * All three entries share this shape: choose a folder, look at what the scan
 * refused and why, adjust the crop, run, look at the numbers, save.
 *
 * What differs between them is which jobs the scan produces and which columns
 * the results table has, so those are the two things passed in.
 */
export const EntryPanel = ({
  entry,
  mode,
  disabled,
  title,
  blurb,
  cropControl,
  buildJobs,
  Results,
  onDetected,
}) => {
  const [picked, setPicked] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [crop, setCrop] = useState(cropControl.initial);
  const [black, setBlack] = useState(null);

  useEffect(() => window.jptc.onScanProgress(setScanning), []);
  useEffect(() => window.jptc.onRunProgress(setRunning), []);

  const reset = () => {
    setScan(null);
    setResults(null);
    setSaved(null);
    setError(null);
  };

  const pick = async () => {
    reset();
    const chosen = await window.jptc.pickFiles();
    if (!chosen || chosen.length === 0) return;
    setPicked(chosen);
    setScanning({ done: 0, total: chosen.length, name: '' });
    try {
      const result = await window.jptc.scanFiles(chosen, entry);
      setScan(result);
      // The mode form sits above this panel and cannot read a file itself, so
      // what the scan learned about the body is handed back up to it.
      const meta = result?.frames?.[0]?.meta;
      // What the PTC header will carry, said before the run rather than after
      // the save -- a missing black level means re-shooting nothing, but it
      // does mean processing the dark set, and that is worth knowing early.
      if (meta && entry === 'ptc') {
        setBlack(await window.jptc.blackLevels(`${meta.make} ${meta.model}`.trim()));
      }
      if (meta && onDetected) {
        onDetected({
          camera: `${meta.make} ${meta.model}`.trim(),
          width: meta.width,
          height: meta.height,
          rawWidth: meta.rawWidth,
          rawHeight: meta.rawHeight,
          adcStep: meta.quantisation?.step,
        });
      }
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setScanning(null);
    }
  };

  const jobs = scan ? buildJobs(scan, crop) : [];

  const run = async () => {
    setError(null);
    setResults(null);
    setSaved(null);
    setRunning({ done: 0, total: jobs.length });
    try {
      setResults(
        await window.jptc.runEntry({
          entry,
          jobs,
          ...crop,
          ladder: scan?.ladder,
          window: 'hann',
        }),
      );
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
        <h2>{title}</h2>
        <p>先把上面的拍摄模式填完。</p>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {blurb}
      </header>

      <div className="actions">
        <button className="primary" onClick={pick}>
          选择 RAW 文件…
        </button>
        {picked && (
          <span className="path" title={picked.join('\n')}>
            已选 {picked.length} 个文件
            {scan?.dir ? ` · ${scan.dir}` : ''}
          </span>
        )}
      </div>

      {scanning && (
        <p className="progress">
          正在读取 {scanning.done}/{scanning.total} {scanning.name}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {scan?.error && <p className="error">{scan.error}</p>}

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
        <div
          className={
            // A note that the set spans several ISOs is not a warning, and
            // painting it as one teaches people to ignore the panel.
            scan.problems.some((p) => p.level === 'error')
              ? 'panel panel--error'
              : scan.problems.some((p) => p.level !== 'info')
                ? 'panel panel--warn'
                : 'panel'
          }
        >
          {scan.problems.map((p, i) => (
            <p key={i}>{p.message}</p>
          ))}
        </div>
      )}

      {scan?.rejected?.length > 0 && (
        <div className="panel panel--error">
          <h3>不能用的，需要补拍</h3>
          {scan.rejected.map((r, i) => (
            <div key={i} className="reject">
              <b>
                {r.iso !== undefined ? `ISO ${r.iso}` : ''}
                {r.shutter !== undefined ? ` ${shutterText(r.shutter)}` : ''}
                {r.name ?? ''}
              </b>
              {r.files && <span className="files">{r.files.join('、')}</span>}
              {r.message && <p>{r.message}</p>}
              {r.checks?.map((c, j) => (
                <p key={j}>{c.message}</p>
              ))}
            </div>
          ))}
        </div>
      )}

      {entry === 'ptc' && jobs.length > 0 && (() => {
        const needed = [...new Set(jobs.map((j) => j.iso))].sort((a, b) => a - b);
        const have = new Set(black?.isos ?? []);
        const missing = needed.filter((iso) => !have.has(iso));
        return (
          <div className={missing.length > 0 ? 'panel panel--warn' : 'panel'}>
            <h3>黑电平</h3>
            {black ? (
              <p>
                用 {black.measuredAt} 那组黑场实测的（{black.source}），逐 ISO 逐通道，写进 PTC 表的表头。
              </p>
            ) : (
              <p>这台机器还没有处理过黑场组。</p>
            )}
            {missing.length > 0 && (
              <p>
                <b>ISO {missing.join('、')} 没有黑场数据。</b>
                这些 ISO 的 PTC 表会缺 <code>#BlackLevel</code>，分析端读不了。
                先去入口 3 处理这些 ISO 的黑场对，再回来保存即可——不用重拍平场。
              </p>
            )}
          </div>
        );
      })()}

      {jobs.length > 0 && (
        <>
          <div className="panel">
            <h3>
              找到 {jobs.length} {entry === 'gain' ? '张可用' : '对，可以处理'}
              {scan.ladder && (
                <span className="tagline">
                  {scan.ladder === 'paired-shutter' ? '同快门配对' : '自动快门扫 ISO'}
                </span>
              )}
            </h3>
            <table className="mini">
              <thead>
                <tr>
                  <th>ISO</th>
                  <th>快门</th>
                  <th>文件</th>
                  <th>提示</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j, i) => (
                  <tr key={i}>
                    <td className="num">{j.iso}</td>
                    <td>{shutterText(j.shutter)}</td>
                    <td>{j.nameA ? `${j.nameA} + ${j.nameB}` : j.name}</td>
                    <td className="warn">{j.warning ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actions actions--wrap">
            {cropControl.render(crop, setCrop)}
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
            下表是<b>实测值</b>，没有做任何修正，也没有减黑电平。灰底那几列是由它们算出来的，
            只显示在这里、不写进文件——那些一步谁都能重算，不该由采集端替你决定。
          </p>
          <Results results={results.results} />
          <div className="actions">
            <button className="primary" onClick={save}>
              保存 CSV…
            </button>
          </div>
        </div>
      )}

      {saved && (
        <div className="panel panel--ok">
          <h3>已打包完成</h3>
          <p className="archive">
            <button className="link" onClick={() => window.jptc.reveal(saved.archive.path)}>
              {saved.archive.name}
            </button>
            <span className="size">
              {(saved.archive.size / 1024).toFixed(0)} KB
              {saved.rawBytes > 0 && (
                <> · 压缩自 {(saved.rawBytes / 1024).toFixed(0)} KB</>
              )}
            </span>
          </p>
          <p className="note">
            <b>把这一个 zip 寄回即可。</b>里面是 {saved.contents.length} 个 CSV：
          </p>
          <ul className="contents">
            {saved.contents.map((f) => (
              <li key={f.name}>
                {f.name} <span className="size">{(f.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
          {saved.missingBlack?.length > 0 && (
            <p className="warn">
              ISO {saved.missingBlack.join('、')} 的表缺 <code>#BlackLevel</code>，
              分析端会拒收。处理完这些 ISO 的黑场组后重新保存即可。
            </p>
          )}
          <p className="note">位置：{saved.dir}</p>
        </div>
      )}
    </section>
  );
};

export { fmt, pct, shutterText };
