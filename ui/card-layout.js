const MIN_WIDTH=260, MAX_WIDTH=340, TARGET_WIDTH=300, GAP=18;
export function cardLayout(width,count){
  width=Math.max(0,Number.isFinite(width)?width:0);
  const available=Math.max(1,Math.floor((width+GAP)/(MIN_WIDTH+GAP)));
  const preferred=Math.max(1,Math.round((width+GAP)/(TARGET_WIDTH+GAP)));
  const columns=Math.min(available,preferred,Math.max(1,count));
  const cardWidth=Math.min(MAX_WIDTH,width,(width-GAP*(columns-1))/columns);
  return {columns,cardWidth};
}
