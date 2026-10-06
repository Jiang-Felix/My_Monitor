export const DEFAULT_FLOATING_SETTINGS = {
  backgroundColor: '#74767a', backgroundOpacity: 0.62,
  trackColor: '#141517', fillColor: '#fafafa',
  barHeight: 20, barWidth: 300,
  showName: true, showAmount: true, showPercent: true,
  showDeltaBand: true, showDeltaValue: true, showSmooth: true,
  increaseColor: '#34c779', decreaseColor: '#ef5261',
  showUnit: true, showTotal: true,
  showZeroDelta: false, textAlign: 'distributed',
};

export const floatingTextHeight = settings => settings.showAmount || settings.showDeltaValue ? 16 : 4;
export const floatingRowHeight = settings => Math.max(settings.barHeight, settings.showName || settings.showPercent ? 16 : 4);

export function validateFloatingSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('浮窗配置必须是对象');
  const settings = { ...DEFAULT_FLOATING_SETTINGS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(settings, key)) throw new Error(`未知浮窗配置：${key}`);
    if (key.endsWith('Color')) {
      if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) throw new Error(`${key} 必须为六位十六进制颜色`);
      settings[key] = value;
    } else if (key === 'textAlign') {
      if (!['left','center','right','distributed'].includes(value)) throw new Error('浮窗文字对齐方式无效');
      settings[key] = value;
    } else if (key.startsWith('show')) {
      if (typeof value !== 'boolean') throw new Error(`${key} 必须为布尔值`);
      settings[key] = value;
    } else {
      if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) throw new Error(`${key} 必须为数字`);
      const number = Number(value);
      const [min, max] = key === 'backgroundOpacity' ? [0.05, 1] : key === 'barHeight' ? [4, 80] : [120, 640];
      if (!Number.isFinite(number) || number < min || number > max || (key !== 'backgroundOpacity' && !Number.isInteger(number))) throw new Error(`${key} 超出有效范围`);
      settings[key] = number;
    }
  }
  settings.barHeight = Math.max(settings.barHeight, floatingTextHeight(settings));
  return settings;
}
