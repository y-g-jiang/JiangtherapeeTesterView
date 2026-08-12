/**
 * The shooting mode. Nothing downstream unlocks until this is complete.
 *
 * It is a gate rather than a validated submit because the fields describe how
 * the frames were *taken* — they cannot be recovered afterwards, and a set
 * whose mode is unknown is a set nobody can use.
 */

export const EMPTY_MODE = {
  firmware: '',
  shutterType: '',
  compression: '',
  bitDepth: '',
  lens: '',
  longExposureNr: false,
  highIsoNr: '',
  ambientC: '',
};

const SHUTTER = [
  ['mech', '机械快门', '快门帘走完全程。测 ISO 增益曲线时它的标称值不准，但黑场无所谓。'],
  ['efcs', '电子前帘', '前帘电子、后帘机械。'],
  ['elec', '电子快门', '全电子。曝光时间由时钟决定，最准。'],
];

const COMPRESSION = [
  ['lossless', '无损压缩', '包含「无压缩」——两者对噪声统计没有区别。'],
  ['uncompressed', '无压缩', '与无损压缩等价，分开填只是为了记录。'],
  ['lossy', '有损压缩', '数据被压缩曲线改过，量化步长随信号变。仍可用，但必须如实填。'],
];

export const modeIsComplete = (mode) =>
  Boolean(mode.shutterType && mode.compression && mode.bitDepth && mode.lens && mode.longExposureNr);

export const ModeForm = ({ mode, onChange, detected }) => {
  const set = (patch) => onChange({ ...mode, ...patch });

  return (
    <section className="card">
      <header className="card-head">
        <h2>拍摄模式</h2>
        <p>
          这些是从文件里读不出来、事后也补不回来的东西。填完之前后面的步骤是锁着的——一组不知道怎么拍的数据，谁都用不了。
        </p>
      </header>

      {detected && (
        <p className="detected">
          从文件读到：<b>{detected.camera}</b>
          {detected.bitHint ? `，看起来是 ${detected.bitHint} 位` : ''}
          {detected.adcStep > 1 ? `，量化步长 ${detected.adcStep}` : ''}
        </p>
      )}

      <div className="field">
        <label>快门类型 <span className="req">必填</span></label>
        <div className="choices">
          {SHUTTER.map(([value, label, hint]) => (
            <button
              key={value}
              className={mode.shutterType === value ? 'choice is-on' : 'choice'}
              onClick={() => set({ shutterType: value })}
              title={hint}
            >
              <span className="choice-label">{label}</span>
              <span className="choice-hint">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>压缩 <span className="req">必填</span></label>
        <div className="choices">
          {COMPRESSION.map(([value, label, hint]) => (
            <button
              key={value}
              className={mode.compression === value ? 'choice is-on' : 'choice'}
              onClick={() => set({ compression: value })}
              title={hint}
            >
              <span className="choice-label">{label}</span>
              <span className="choice-hint">{hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>位深 <span className="req">必填</span></label>
          <div className="choices choices--tight">
            {['12', '14', '16'].map((v) => (
              <button
                key={v}
                className={mode.bitDepth === v ? 'choice is-on' : 'choice'}
                onClick={() => set({ bitDepth: v })}
              >
                <span className="choice-label">{v} bit</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>固件版本</label>
          <input
            value={mode.firmware}
            placeholder="例如 1.2"
            onChange={(e) => set({ firmware: e.target.value })}
          />
          <small>同一台机身不同固件的读出可以完全不同。</small>
        </div>

        <div className="field">
          <label>环境温度 ℃</label>
          <input
            value={mode.ambientC}
            placeholder="可选"
            onChange={(e) => set({ ambientC: e.target.value })}
          />
          <small>暗电流与温度强相关。</small>
        </div>
      </div>

      <div className="field">
        <label>镜头 <span className="req">必填</span></label>
        <div className="choices">
          <button
            className={mode.lens === 'none-bodycap' ? 'choice is-on' : 'choice'}
            onClick={() => set({ lens: 'none-bodycap' })}
          >
            <span className="choice-label">无镜头，机身盖</span>
            <span className="choice-hint">拍黑场就该是这个。装着镜头的黑场不可信。</span>
          </button>
          <button
            className={mode.lens && mode.lens !== 'none-bodycap' ? 'choice is-on' : 'choice'}
            onClick={() => set({ lens: mode.lens === 'none-bodycap' ? '' : mode.lens })}
          >
            <span className="choice-label">装着镜头</span>
            <span className="choice-hint">在右边填型号。</span>
          </button>
          {mode.lens !== 'none-bodycap' && (
            <input
              className="choice-input"
              value={mode.lens}
              placeholder="镜头型号"
              onChange={(e) => set({ lens: e.target.value })}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={mode.longExposureNr}
            onChange={(e) => set({ longExposureNr: e.target.checked })}
          />
          <span>
            我已确认<b>长曝光降噪已关闭</b> <span className="req">必填</span>
          </span>
        </label>
        <small>
          它只在部分帧上减暗电流，会破坏帧与帧之间的可比性。相机菜单里通常叫「长时间曝光降噪」或 Long Exposure NR。
        </small>
      </div>

      {!modeIsComplete(mode) && (
        <p className="gate">还有必填项没填完，下一步是锁着的。</p>
      )}
    </section>
  );
};
