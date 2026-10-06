import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}
export async function runResourceViewsSmoke({ mainWindow, monitor, root }) {
  const run = async code => {
    let timer;
    try{return await Promise.race([mainWindow.webContents.executeJavaScript(code,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Resource views renderer step stalled: ${code.slice(0,180)}; visible=${mainWindow.isVisible()}, focused=${mainWindow.isFocused()}, minimized=${mainWindow.isMinimized()}`)),5000);})]);}
    finally{clearTimeout(timer);}
  };
  const originalSize = mainWindow.getContentSize();
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const ids = ['views-initial', 'views-long', 'views-good', 'views-paused'];
  try {
    // Native picker focus changes can leave the dashboard hidden. CSS animation
    // promises do not reliably finish on a hidden surface, even with RAF enabled.
    mainWindow.show(); mainWindow.focus();
    await until(() => { if (!mainWindow.isVisible()) mainWindow.show(); return mainWindow.isVisible(); }, 'dashboard visible for layout captures');
    await run('document.querySelector("[data-page=data]").click(); document.querySelector("[data-filter=all]").click(); true');
    for (const id of ids) monitor.upsert({ id, name: id === 'views-long' ? '很长的数据源名称'.repeat(6) : id === 'views-good' ? '机场流量' : id, kind: 'fixed', fixedValue: 42, totalMode: id === 'views-good' ? 'fixed' : 'none', fixedTotal: id === 'views-good' ? 100 : undefined, unit: id === 'views-good' ? 'GB' : '', interval: 86400, enabled: id !== 'views-paused' });
    Object.assign(monitor.sources.get('views-initial'), { status: 'refreshing', sample: null, nextRun: Date.now() + 86400000 });
    Object.assign(monitor.sources.get('views-long'), { status: 'network', failed: true, error: '连接失败详情'.repeat(160), nextRun: Date.now() + 86400000 });
    Object.assign(monitor.sources.get('views-good'), { status: 'refreshing', sample: { value: 123456789012345, total: null, unit: 'GB' }, lastSuccess: Date.now(), nextRun: Date.now() + 86400000 });
    monitor.notify();
    await until(() => run('document.querySelector("[data-id=views-initial] .status")?.textContent.includes("监控异常")'), 'initial read is abnormal');
    const longSource = monitor.sources.get('views-long');
    Object.assign(longSource, { status: 'auth', sample: { value: 42, total: null, unit: '' }, lastSuccess: Date.now() - 200000000, error: '需重新授权' });
    monitor.notify();
    await until(() => run('document.querySelector("[data-id=views-long] .status")?.textContent.includes("需重新授权")'), 'authorization reason remains visible with stale old sample');
    Object.assign(longSource, { status: 'network', sample: null, lastSuccess: null, error: '连接失败详情'.repeat(160) });
    monitor.notify();
    await until(() => run('document.querySelector("[data-id=views-long] .status")?.textContent.includes("连接失败")'), 'restore long error fixture');
    await run('document.querySelector("[data-filter=abnormal]")?.click(); true');
    assert.deepEqual(await run('[...document.querySelectorAll("#cards [data-id]")].map(n=>n.dataset.id).filter(id=>id.startsWith("views-"))'), ['views-initial', 'views-long', 'views-paused'], 'one abnormal filter includes failed and manually paused sources and excludes healthy sources');
    assert.equal(await run('document.querySelector("#issue-count").textContent'), '3');
    assert.match(await run('document.querySelector("[data-id=views-paused] .status").textContent'), /监控异常.*已暂停/);
    await run('document.querySelector("[data-filter=all]").click(); true');
    const boxes = await run('[...document.querySelectorAll("#cards [data-id]")].filter(n=>n.dataset.id.startsWith("views-")).map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}))');
    for (const box of boxes) {assert.ok(box.width>=260&&box.width<=340);assert.equal(box.height,350);}
    const cardLayout=()=>run('(()=>{const container=document.querySelector("#cards").getBoundingClientRect(),cards=[...document.querySelectorAll("#cards .metric-card")].map(n=>n.getBoundingClientRect()),first=cards.filter(r=>Math.abs(r.top-cards[0].top)<1);return {left:container.left,right:container.right,first:first.map(r=>({left:r.left,right:r.right,width:r.width})),boxes:cards.map(r=>({width:r.width,height:r.height})),overflow:document.documentElement.scrollWidth>innerWidth+1};})()');
    const initial=await cardLayout();
    assert.equal(initial.first.length,3,`initial window fits exactly three adaptive cards per row; ${JSON.stringify(initial)}; ${await run('JSON.stringify({view:document.querySelector("#cards").dataset.view,width:innerWidth,columns:getComputedStyle(document.querySelector("#cards")).gridTemplateColumns,inline:document.querySelector("#cards").getAttribute("style")})')}`);
    const initialGap=initial.first[1].left-initial.first[0].right;
    assert.ok(Math.abs(initialGap-18)<1,`initial card gap stays 18px: ${initialGap}`);
    for(const width of [originalSize[0],1440,1800,2400,900,760]){
      mainWindow.setContentSize(width,900);await settle();
      const layout=await cardLayout();
      for(const box of layout.boxes){assert.ok(box.width>=259.9&&box.width<=340,`card width is bounded at ${width}px; ${JSON.stringify(layout)}; ${await run('JSON.stringify({width:innerWidth,columns:getComputedStyle(document.querySelector("#cards")).gridTemplateColumns,inline:document.querySelector("#cards").getAttribute("style")})')}`);assert.equal(box.height,350);}
      assert.equal(layout.overflow,false,`cards never overflow horizontally at ${width}px`);
      if(layout.first.length>1){
        const gaps=layout.first.slice(1).map((r,i)=>r.left-layout.first[i].right);
        assert.ok(gaps.every(g=>Math.abs(g-18)<1),`card gaps remain fixed at ${width}px`);
        const left=layout.first[0].left-layout.left,right=layout.right-layout.first.at(-1).right;
        assert.ok(Math.abs(left-right)<1,`bounded rows are centered at ${width}px`);
        if(layout.first[0].width<339.9)assert.ok(left<1&&right<1,`adaptive cards fill the row at ${width}px`);
      }
    }
    mainWindow.setContentSize(...originalSize);await settle();
    assert.equal(await run('const n=document.querySelector("[data-id=views-long] .card-error"); n.scrollHeight>n.clientHeight'), true);
    await run('window.__viewsNode=document.querySelector("[data-id=views-good]");true');
    monitor.sources.get('views-good').lastSuccess = Date.now() - 60000;
    monitor.notify();
    await until(() => run('document.querySelector("[data-id=views-good] [data-last-success]")?.textContent.includes("1 分钟")'), 'timestamp updates without replacing card');
    assert.equal(await run('window.__viewsNode===document.querySelector("[data-id=views-good]")'), true);
    Object.assign(monitor.sources.get('views-good'), { status: 'ok', sample: { value: 36.5, total: 100, unit: 'GB' }, lastSuccess: Date.now() });
    monitor.notify();
    await until(() => run('document.querySelector("[data-id=views-good] .metric-value")?.textContent.includes("36.5")'),'quota sample renders before layout checks');
    await run('document.querySelector("[data-view=list]").click(); true');
    assert.equal(await run('document.querySelector("#cards").dataset.view'), 'list');
    mainWindow.setContentSize(2400, 1080); await settle();
    const wide = await run('(()=>{const box=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {viewport:innerWidth,height:innerHeight,cards:box(document.querySelector("#cards")),footer:box(document.querySelector(".footer")),bodyWidth:document.documentElement.scrollWidth};})()');
    assert.ok(wide.cards.right >= wide.viewport - 58, 'wide window uses the available right side, including the stable scrollbar gutter');
    assert.ok(wide.footer.bottom >= wide.height - 30, 'short page footer reaches the lower edge');
    assert.ok(wide.bodyWidth <= wide.viewport + 1, 'wide list has no horizontal overflow');
    const layout = await run('(()=>{const n=document.querySelector("[data-id=views-good]"),box=s=>{const r=n.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,center:r.top+r.height/2};},style=s=>{const c=getComputedStyle(n.querySelector(s));return [c.fontSize,c.fontWeight,c.fontFamily];};return {row:n.getBoundingClientRect().toJSON(),name:box("h2"),actions:box(".card-actions"),menu:box(".edit-card"),refresh:box(".monitor-toggle"),total:box(".quota-total"),current:box(".metric-value"),totalStyle:style(".total-value"),currentStyle:style(".metric-value")};})()');
    assert.equal(layout.menu.width,layout.refresh.width); assert.equal(layout.menu.height,layout.refresh.height);
    assert.ok(Math.abs(layout.menu.left-layout.refresh.left)<1 && layout.menu.bottom<layout.refresh.top, 'matching edit and pause controls are vertically stacked');
    assert.ok(layout.actions.right>=layout.row.right-18, 'actions occupy the far right of each row');
    assert.ok(Math.abs(layout.name.center-layout.actions.center)<1, 'name is centered in the main row');
    assert.ok(await run('(()=>{const n=document.querySelector("[data-id=views-long]"),r=n.getBoundingClientRect(),h=n.querySelector("h2").getBoundingClientRect();return Math.abs((h.top+h.bottom)/2-(r.top+r.bottom)/2)<1;})()'),'name remains vertically centered in a taller error row');
    assert.deepEqual(layout.totalStyle,layout.currentStyle, 'quota total shares the current value typography');
    assert.ok(layout.total.left>layout.name.right && layout.total.right<layout.current.left, 'quota total uses the middle column, left of the current value');
    assert.equal(await run('!!document.querySelector("[data-id=views-paused] .quota-total")'),false, 'sources without totals render no total column content');
    await run('document.querySelector("[data-id=views-good] [data-action=edit]").click();true');
    assert.equal(await run('document.querySelector("#source-dialog").open'),true,'rightmost edit button opens editor directly');
    assert.ok(await run('document.querySelector("#source-dialog").getBoundingClientRect().right<=innerWidth'),'editor stays within the window');
    await run('document.querySelector("#cancel-dialog").click();true');
    await run('document.querySelector("#issue-count").click(); true');
    assert.equal(await run('document.querySelectorAll("#cards [data-id]").length'),3,'clicking the embedded count performs the same filter');
    await run('document.querySelector("[data-filter=all]").click(); true');
    await run('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, 'resource-views-list.png'), (await mainWindow.webContents.capturePage()).toPNG());
    for (const width of [1200,900,760]) {
      mainWindow.setContentSize(width,900); await settle();
      const compact=await run('(()=>{const n=document.querySelector("[data-id=views-good]"),r=n.getBoundingClientRect(),a=n.querySelector(".card-actions").getBoundingClientRect(),t=n.querySelector(".quota-total").getBoundingClientRect(),v=n.querySelector(".metric-value").getBoundingClientRect();return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,rowRight:r.right,actionsRight:a.right,totalRight:t.right,valueLeft:v.left,totalFont:getComputedStyle(n.querySelector(".total-value")).fontSize,currentFont:getComputedStyle(n.querySelector(".metric-value")).fontSize};})()');
      assert.ok(compact.scrollWidth<=compact.width+1,`no horizontal overflow at ${width}px`);
      assert.ok(compact.actionsRight>=compact.rowRight-18,`right-side controls retained at ${width}px`);
      assert.ok(compact.totalRight<compact.valueLeft,`amount columns remain separate at ${width}px`);
      assert.equal(compact.totalFont,compact.currentFont);
      await writeFile(join(artifacts,`resource-list-${width}.png`),(await mainWindow.webContents.capturePage()).toPNG());
    }
    mainWindow.setContentSize(...originalSize); await settle();
    mainWindow.webContents.reload();
    await until(() => run('document.querySelector("#cards")?.dataset.view === "list"'), 'list preference restored');
    await monitor.refresh('views-good');
    await until(()=>run('document.querySelector("[data-id=views-good] .metric-value")?.textContent.includes("42")'),'collection still updates the value');
    await run('document.querySelector("[data-id=views-good] [data-action=pause]").click(); true');
    await until(() => !monitor.sources.get('views-good').enabled, 'list pause action');
    await run('document.querySelector("[data-filter=abnormal]").click(); true');
    assert.equal(await run('document.querySelectorAll("#cards [data-id]").length'),4);
    assert.equal(await run('document.querySelector("#issue-count").textContent'),'4','embedded count follows pause changes');
    await until(()=>run('!document.querySelector("[data-id=views-good] [data-action=pause]").disabled'),'pause saved before resuming');
    await run('document.querySelector("[data-id=views-good] [data-action=pause]").click(); true');
    await until(()=>monitor.sources.get('views-good').enabled && monitor.sources.get('views-good').status==='ok','resume updates source normally');
    await until(()=>run('!document.querySelector("#cards [data-id=views-good]")'),'recovered source leaves abnormal filter');
    await run('document.querySelector("[data-filter=all]").click(); true');
    await run('document.querySelector("[data-id=views-good] [data-action=edit]").click(); true');
    assert.equal(await run('document.querySelector("#source-dialog").open'), true);
    assert.equal(await run('document.querySelector("[name=interval]").min'), '1');
    await run('document.querySelector("[data-kind=web]").click(); const f=document.querySelector("#source-form"); f.elements.valueMode.value="web"; f.elements.valueMode.dispatchEvent(new Event("change")); true');
    assert.equal(await run('document.querySelector("[name=interval]").min'), '30');
    await run('(()=>{const f=document.querySelector("#source-form"); f.elements.webUpdateMode.value="live"; f.elements.webUpdateMode.dispatchEvent(new Event("change")); return true;})()');
    assert.equal(await run('document.querySelector("[name=interval]").min'), '1');
    await run('document.querySelector("#cancel-dialog").click(); document.querySelector("[data-view=card]").click(); true');
    await run('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    await writeFile(join(artifacts, 'resource-views.png'), (await mainWindow.webContents.capturePage()).toPNG());
    console.log('PASS resource views: filter counts, responsive lists, footer, actions, name alignment, quota typography, 260–340px adaptive cards with fixed 18px gaps, list persistence and pause/recovery');
  } finally {
    mainWindow.setContentSize(...originalSize);
    for (const id of ids) monitor.remove(id);
    await run('document.querySelector("[data-filter=all]").click(); document.querySelector("[data-view=card]")?.click(); true');
  }
}

