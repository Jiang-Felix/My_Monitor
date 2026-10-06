// The same surface and semantic tokens drive every monitoring page and editor.
export const THEMES = [
  {id:'ocean',name:'深海蓝',scheme:'dark',colors:{bg:'#07172b',panel:'#112a43',raised:'#183d58',line:'#2b5069',text:'#eefaff',muted:'#b8d0df',blue:'#80e9f1',teal:'#56dcb4',amber:'#ebc58c',red:'#f2abab',sidebar:'#0c2138',field:'#0b2036',selected:'#17445b',hover:'#23455d','on-accent':'#153149',grid:'#294357','test-accent':'#d6b47a','test-line':'#806a48'}},
  {id:'graphite',name:'石墨灰',scheme:'dark',colors:{bg:'#181b21',panel:'#242a33',raised:'#303843',line:'#46515f',text:'#f3f6fc',muted:'#b7c2ce',blue:'#b8cff8',teal:'#7ed5c2',amber:'#f0ca92',red:'#ffb7b4',sidebar:'#1d2229',field:'#1b2028',selected:'#333d4a',hover:'#303843','on-accent':'#162130',grid:'#3a4554','test-accent':'#d6b47a','test-line':'#806a48'}},
  {id:'forest',name:'松林绿',scheme:'dark',colors:{bg:'#101f1c',panel:'#1b322b',raised:'#244033',line:'#3c6353',text:'#f0fbf5',muted:'#bbd1c5',blue:'#9ae3bf',teal:'#93dce6',amber:'#edca95',red:'#f4b5b8',sidebar:'#152920',field:'#132a23',selected:'#28493e',hover:'#2a493f','on-accent':'#102b21',grid:'#334f43','test-accent':'#d6b47a','test-line':'#806a48'}},
  {id:'violet',name:'暮光紫',scheme:'dark',colors:{bg:'#1b182a',panel:'#2a2540',raised:'#39304e',line:'#514762',text:'#f7f3ff',muted:'#c8bfdc',blue:'#c6b5fa',teal:'#8ed9d3',amber:'#f0cd96',red:'#f3b4cb',sidebar:'#221e35',field:'#211d35',selected:'#3d3457',hover:'#39304e','on-accent':'#261c3c',grid:'#49405b','test-accent':'#d6b47a','test-line':'#806a48'}},
  {id:'cloud',name:'云雾白',scheme:'light',colors:{bg:'#f3f6fa',panel:'#ffffff',raised:'#ecf1f7',line:'#b8c8d8',text:'#172c42',muted:'#4d6176',blue:'#005d85',teal:'#006d60',amber:'#805600',red:'#9e3341',sidebar:'#e7edf5',field:'#f7f9fc',selected:'#dce8f3',hover:'#e0eaf4','on-accent':'#ffffff',grid:'#dae2eb','test-accent':'#805600','test-line':'#b19661'}},
  {id:'sand',name:'暖沙色',scheme:'light',colors:{bg:'#f7f3eb',panel:'#fffdfa',raised:'#f0e8da',line:'#cbbda6',text:'#352e25',muted:'#655644',blue:'#765321',teal:'#356457',amber:'#805007',red:'#9d3443',sidebar:'#eee6d8',field:'#fbf7f0',selected:'#e9ddc9',hover:'#ede2d0','on-accent':'#fffdfa',grid:'#dfd5c5','test-accent':'#805600','test-line':'#b19661'}}
].map(theme=>({
  ...theme,
  colors:{
    ...theme.colors,
    // Light palettes need brighter graphic fills than their readable status text.
    'teal-fill':theme.scheme==='light'?(theme.id==='cloud'?'#318c77':'#458675'):theme.colors.teal,
    'amber-fill':theme.scheme==='light'?'#b7791f':theme.colors.amber
  }
}));
export const themeById=id=>THEMES.find(theme=>theme.id===id)||THEMES[0];
