export const MIN_ALERT_MULTIPLIER=1,MAX_ALERT_MULTIPLIER=12,ALERT_MULTIPLIER_STEP=.5;
export function validAlertCadence(value){
  return Number.isFinite(value)&&value>=1&&value<=2592000&&(Number.isInteger(value)||(value<=MAX_ALERT_MULTIPLIER&&Number.isInteger(value*2)));
}
