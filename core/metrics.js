export function parseValue(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('没有可解析的数值');
  const text = raw.trim();
  const match = text.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (match?.length !== 1 || !/^[\p{L}\p{Sc}\s%]*$/u.test(text.replace(match[0], ''))) {
    throw new Error('数值格式不明确，请选择只包含一个数值的元素');
  }
  const number = match[0];
  if (number.includes(',') && !/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(number)) throw new Error('不支持此小数或千分位格式');
  const value = Number(number.replaceAll(',', ''));
  if (!Number.isFinite(value)) throw new Error('数值超出范围');
  return value;
}

export function parseFixed(raw, label = '固定数值') {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()) || !Number.isFinite(Number(raw))) {
    throw new Error(`${label}请输入有效数字，例如 0、36.5；单位请填写在“显示单位”中`);
  }
  return Number(raw);
}

export function validateSample(sample) {
  if (sample.total !== null && sample.total !== undefined && sample.value > sample.total) {
    const unit = sample.unit ? ` ${sample.unit}` : '';
    throw Object.assign(new Error(`当前量 ${sample.value}${unit} 大于总量 ${sample.total}${unit}，请检查选取元素、固定数值及单位是否一致`), { code: 'range' });
  }
  return sample;
}

export function pathParts(path) {
  if (typeof path !== 'string' || path.length>2000 || !/^[A-Za-z_\d-]+(?:\[\d+\]|\.[A-Za-z_\d-]+)*$/.test(path)) throw new Error('字段路径格式无效');
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (parts.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) throw new Error('禁止访问此字段');
  return parts;
}

export function readPath(data, path) {
  let value = data;
  for (const key of pathParts(path)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`找不到字段 ${path}`);
    value = value[key];
  }
  return value;
}

export function extractSample(source, payload) {
  const value = source.kind === 'http' ? readPath(payload, source.valuePath) : source.kind === 'fixed' || source.valueMode === 'fixed' ? source.fixedValue : payload.value;
  const total = source.kind === 'http' ? (source.totalPath ? readPath(payload, source.totalPath) : null) : source.totalMode === 'fixed' ? source.fixedTotal : source.totalMode === 'none' || source.kind === 'fixed' ? null : payload.total;
  const parse = (raw, label) => {
    try { return parseValue(raw); }
    catch (failure) { throw Object.assign(new Error(`${label}读取失败：${failure.message}。请修改配置或重新选取数值元素`), { code: 'parse' }); }
  };
  const needsTotal = source.kind === 'http' ? !!source.totalPath : source.totalMode === 'web' || source.totalMode === 'fixed' || (!source.totalMode && !!source.totalSelector);
  return validateSample({ value: parse(value, '当前量'), total: total == null && !needsTotal ? null : parse(total, '总量'), unit: source.unit || '' });
}

export function progress(sample) {
  return sample?.total > 0 && sample.value >= 0 && sample.value <= sample.total ? sample.value / sample.total * 100 : null;
}
