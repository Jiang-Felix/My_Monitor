import { resourceCategory } from './resource-status.js';
export function alertCategory(rule,source,track,now=Date.now(),blocked=false){
  if(!rule.enabled||!source||track?.error||resourceCategory(source,now,blocked)!=='normal')return 'paused';
  return rule.notificationsEnabled===false?'silent':'active';
}
