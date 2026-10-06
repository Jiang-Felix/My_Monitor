import { placeFloating,FLOATING_MARGIN } from './floating-bounds.js';
export function savedFloatingPosition(value){
  if(!value || !['x','y'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&Math.abs(value[key])<=1e7))return null;
  return {x:Math.round(value.x),y:Math.round(value.y)};
}
export function floatingPlacement(saved,size,areas,fallbackArea){
  const point=savedFloatingPosition(saved)||{x:fallbackArea.x+fallbackArea.width-size.width-FLOATING_MARGIN,y:fallbackArea.y+24};
  return placeFloating({...size,...point},areas);
}
