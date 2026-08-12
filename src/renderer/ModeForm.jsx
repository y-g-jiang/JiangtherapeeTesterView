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
  lens: '',
  longExposureNr: false,
  highIsoNr: '',
  ambientC: '',
};

export const modeIsComplete = (mode) =>
  Boolean(
    mode.shutterType.trim() && mode.compression.trim() && mode.lens.trim() && mode.longExposureNr,
  );

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

      <div className="row">
        <div className="field field--wide">
          <label>
            快门类型 <span className="req">必填</span>
          </label>
          <input
            value={mode.shutterType}
            placeholder="机械快门 / 电子前帘 / 电子快门"
            onChange={(e) => set({ shutterType: e.target.value })}
          />
          <small>
            照相机菜单里叫什么就写什么。测 ISO 增益曲线时机械快门的标称时间不准，黑场则无所谓。
          </small>
        </div>

        <div className="field field--wide">
          <label>
            压缩 <span className="req">必填</span>
          </label>
          <input
            value={mode.compression}
            placeholder="无损压缩 / 无压缩 / 有损压缩"
            onChange={(e) => set({ compression: e.target.value })}
          />
          <small>
            有损压缩会把数据过一条压缩曲线，量化步长随信号变化，仍可用但必须如实填。
            无压缩与无损压缩对噪声统计没有区别。
          </small>
        </div>
      </div>

      <div className="row">
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
