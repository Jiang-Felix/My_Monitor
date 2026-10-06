// The display window needs readings, not account URLs, editor settings or graphs.
export function floatingSnapshot(sources,floatingSettings,language){
  return {language,floatingSettings,sources:sources.map(source=>({
    id:source.id,name:source.name,unit:source.unit,enabled:source.enabled,
    status:source.status,failed:source.failed,stale:source.stale,
    sample:source.sample,change:source.change,recentChange:source.recentChange,
  }))};
}
