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
  /** One declaration covering both switches the file cannot reveal. */
  declaredOff: false,
  highIsoNr: '',
  imageWidth: '',
  imageHeight: '',
};

/** A dimension is only usable if it is a whole number of pixels above zero. */
export const parseDimension = (value) => {
  const n = Number(String(value).trim());
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};

export const modeIsComplete = (mode) =>
  Boolean(
    mode.shutterType.trim() &&
      mode.compression.trim() &&
      mode.lens.trim() &&
      mode.declaredOff &&
      parseDimension(mode.imageWidth) &&
      parseDimension(mode.imageHeight),
  );

export const ModeForm = ({ mode, onChange, detected }) => {
  const set = (patch) => onChange({ ...mode, ...patch });

  const width = parseDimension(mode.imageWidth);
  const height = parseDimension(mode.imageHeight);
  const megapixels = width && height ? ((width * height) / 1e6).toFixed(1) : null;

  /*
   * A cropped body or a smaller output size makes this legitimately different,
   * so it is a remark and not a gate -- but an order-of-magnitude slip, or a
   * transposed pair of numbers, shows up here.
   */
  /*
   * An after-the-fact check, once a scan has happened -- never an offer. There
   * is deliberately no way to fill this field from a RAW: the RAW's visible
   * area is not the JPEG, and a button that fills it in would be taken every
   * time, which is exactly the wrong number arriving with no one having looked.
   */
  const mismatch =
    width &&
    height &&
    detected?.width > 0 &&
    (Math.abs(width / detected.width - 1) > 0.06 ||
      Math.abs(height / detected.height - 1) > 0.06);

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
          {detected.adcStep > 1 ? `，量化步长 ${detected.adcStep}` : ''}
        </p>
      )}

      {/*
        First, because it is the one number every comparison is built on. SNR is
        normalised to a 2160-pixel-tall output, so the output's own height sets
        the scale; get it wrong and the curve is wrong by that ratio while
        looking perfectly healthy. It cannot be taken from the RAW: the sensor
        carries masked borders the picture does not, and some bodies crop
        further. The JPEG the camera itself wrote is the answer.
      */}
      <div className="field field--first">
        <label>
          JPEG 输出像素 <span className="req">必填</span>
        </label>
        <div className="dims">
          <input
            type="number"
            min="1"
            step="1"
            value={mode.imageWidth}
            placeholder="宽"
            onChange={(e) => set({ imageWidth: e.target.value })}
          />
          <span>×</span>
          <input
            type="number"
            min="1"
            step="1"
            value={mode.imageHeight}
            placeholder="高"
            onChange={(e) => set({ imageHeight: e.target.value })}
          />
          {megapixels !== null && <span className="dims-mp">= {megapixels} MP</span>}
        </div>
        <small>
          <b>照同一台机器拍的 JPEG 的长和宽填</b>，不是传感器的总像素、也不是 RAW 的尺寸。
          所有对比都归一到 2160 高的输出，这个高度就是那把尺子；填错了曲线会整体差一个比例，
          而且看不出任何异常。软件<b>不会</b>替你从 RAW 里读——RAW 的有效区不是 JPEG，
          机身裁切和小尺寸输出都会让它们不同，这个数只能你自己对着照片确认。
          {mismatch && (
            <>
              <br />
              <span className="warn">
                和刚读到的 RAW 有效区（{detected.width}×{detected.height}）差得较多。
                机身裁切、小尺寸输出时这是正常的；否则请回去核对一遍你的 JPEG。
              </span>
            </>
          )}
        </small>
      </div>

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
            checked={mode.declaredOff}
            onChange={(e) => set({ declaredOff: e.target.checked })}
          />
          <span>
            我已确认<b>长曝光降噪已关闭</b>，<b>防抖也已关闭</b> <span className="req">必填</span>
          </span>
        </label>
        <small>
          长曝光降噪只在部分帧上减暗电流，会破坏帧与帧之间的可比性。相机菜单里通常叫「长时间曝光降噪」或
          Long Exposure NR。
          <br />
          防抖（IBIS / OIS / Dual I.S.）要关，是因为它在曝光之间移动传感器：ISO 增益阶梯和 PTC 都建立在
          「同一批像素看到同样的光」上，墙面只要不是绝对均匀，画面挪一点点电平就跟着变。上了三脚架还开着防抖，
          有些机身反而会自己找抖动。黑场无所谓，但一起关掉最省事。
        </small>
      </div>

      {!modeIsComplete(mode) && (
        <p className="gate">还有必填项没填完，下一步是锁着的。</p>
      )}
    </section>
  );
};
