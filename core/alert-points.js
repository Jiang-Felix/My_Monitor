// Shared by the local alert engine and the browser renderer.
export const CHART_POINT_OPTIONS = Object.freeze([10,20,50]);
export const DEFAULT_CHART_POINTS = 20;
export const MAX_ALERT_POINTS = 50;
export const chartPointCount = value => CHART_POINT_OPTIONS.includes(value) ? value : DEFAULT_CHART_POINTS;
