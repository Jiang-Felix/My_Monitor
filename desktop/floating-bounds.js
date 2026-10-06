export const FLOATING_MARGIN=16;
export function placeFloating(bounds,workAreas,margin=FLOATING_MARGIN) {
  let best=null,bestCost=Infinity;
  for(const area of workAreas) {
    if(area.width<=0 || area.height<=0)continue;
    const gap=Math.min(margin,Math.floor((Math.min(area.width,area.height)-1)/2));
    const width=Math.min(bounds.width,area.width-2*gap),height=Math.min(bounds.height,area.height-2*gap);
    const next={
      x:Math.max(area.x+gap,Math.min(bounds.x,area.x+area.width-gap-width)),
      y:Math.max(area.y+gap,Math.min(bounds.y,area.y+area.height-gap-height)),width,height
    };
    // Minimize the correction across displays, including any necessary size reduction.
    const cost=['x','y','width','height'].reduce((sum,key)=>sum+(next[key]-bounds[key])**2,0);
    if(cost<bestCost){best=next;bestCost=cost;}
  }
  return best||{...bounds};
}
