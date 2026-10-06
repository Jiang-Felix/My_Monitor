import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, themeById } from '../core/themes.js';
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(value=>{const n=parseInt(value,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const [light,dark]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (light+.05)/(dark+.05);}
test('all six palettes maintain readable text, actions, and complete surface tokens',()=>{
  assert.equal(THEMES.length,6);assert.equal(new Set(THEMES.map(theme=>theme.id)).size,6);
  assert.equal(THEMES.filter(theme=>theme.scheme==='light').length,2);
  const required=Object.keys(THEMES[0].colors).sort();
  for(const theme of THEMES){
    assert.deepEqual(Object.keys(theme.colors).sort(),required);
    for(const value of Object.values(theme.colors))assert.match(value,/^#[0-9a-f]{6}$/i);
    for(const surface of ['bg','panel','field','sidebar','selected'])for(const foreground of ['text','muted'])assert.ok(contrast(theme.colors[foreground],theme.colors[surface])>=4.5,`${theme.id} ${foreground} on ${surface} must be readable`);
    assert.ok(contrast(theme.colors['on-accent'],theme.colors.blue)>=4.5,`${theme.id} primary action contrast`);
    for(const fill of ['teal-fill','amber-fill'])assert.ok(contrast(theme.colors[fill],theme.colors.panel)>=3,`${theme.id} ${fill} graphic contrast`);
  }
  assert.equal(themeById('unknown').id,'ocean');
});
