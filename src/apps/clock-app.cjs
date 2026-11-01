// Also distributed unchanged as a shared TridOS app.
module.exports = {
  name: 'Clock & Stopwatch',
  desc: 'Local clock, analog face, and a stopwatch with pause, reset and laps.',
  version: '1.1.0',
  icon: { color: '#ed9d38', glyph: 'C', symbol: 'clock' },
  size: [54, 24],
  create(os, win, saved) {
    const { Hits, button } = os.ui;
    const hits = new Hits();
    const s = saved || {};
    let tab = s.tab === 'stopwatch' ? 'stopwatch' : 'clock';
    let elapsed = Number.isFinite(s.elapsed) ? Math.max(0, s.elapsed) : 0;
    let running = s.running === true;
    if (running && Number.isFinite(s.savedAt)) elapsed += Math.max(0, Date.now() - s.savedAt);
    let start = performance.now();
    let laps = Array.isArray(s.laps) ? s.laps.filter(n => Number.isFinite(n) && n >= 0).slice(-200) : [];
    let stamp = '', scroll = 0;
    const total = () => elapsed + (running ? Math.max(0, performance.now() - start) : 0);
    const pad = n => String(n).padStart(2, '0');
    const duration = ms => {
      const n = Math.floor(ms / 10);
      return pad(Math.floor(n / 360000)) + ':' + pad(Math.floor(n / 6000) % 60) + ':' + pad(Math.floor(n / 100) % 60) + '.' + pad(n % 100);
    };
    const toggle = () => {
      if (running) elapsed = total();
      else start = performance.now();
      running = !running;
    };
    const lap = () => {
      if (running) { laps.push(total()); if (laps.length > 200) laps.shift(); scroll = 0; }
    };
    const reset = () => { if (!running) { elapsed = 0; laps = []; scroll = 0; } };
    const digital = (v, str, top, color) => {
      const masks = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
      const unit = Math.max(1, Math.min(5, Math.floor(v.pxW / (str.length * 6 + 4)), Math.floor(v.pxH / 40)));
      let x = Math.floor((v.pxW - str.length * 6 * unit) / 2);
      for (const ch of str) {
        const y = top * v.ph, u = unit;
        if (ch === ':' || ch === '.') {
          v.pxRect(x + 2*u, y + 6*u, u, u, color);
          if (ch === ':') v.pxRect(x + 2*u, y + 2*u, u, u, color);
        } else {
          const mask = masks[Number(ch)];
          const segments = [[1,0,3,1], [4,1,1,3], [4,5,1,3], [1,8,3,1], [0,5,1,3], [0,1,1,3], [1,4,3,1]];
          segments.forEach((r, i) => { if (mask & (1 << i)) v.pxRect(x+r[0]*u, y+r[1]*u, r[2]*u, r[3]*u, color); });
        }
        x += 6*u;
      }
    };
    return {
      draw(v) {
        const th = os.th;
        v.fill(th.bg); hits.reset();
        button(v, hits, 1, 0, 'Clock', th, () => tab = 'clock', { active: tab === 'clock' });
        button(v, hits, 10, 0, 'Stopwatch', th, () => tab = 'stopwatch', { active: tab === 'stopwatch' });
        if (tab === 'clock') {
          const d = new Date();
          const hours = os.settings.clock24 ? d.getHours() : d.getHours() % 12 || 12;
          digital(v, pad(hours) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()), 3, th.text);
          const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          v.text(Math.max(1, Math.floor((v.w-date.length)/2)), 8, date, th.dim);
          if (!os.settings.clock24) v.text(v.w-5, 6, d.getHours()<12?'AM':'PM', th.dim);
          const r = Math.floor(Math.min(v.pxW*.3, (v.pxH-11*v.ph)/2));
          if (r > 8) {
            const cx = v.pxW/2, cy = 10*v.ph+r;
            for(let i=0;i<60;i++) {
              const a = i*Math.PI/30-Math.PI/2, inner = r-(i%5===0?7:3);
              v.pxLine(Math.round(cx+Math.cos(a)*inner),Math.round(cy+Math.sin(a)*inner),Math.round(cx+Math.cos(a)*r),Math.round(cy+Math.sin(a)*r),i%5===0?th.text:th.dim);
            }
            const hand = (fraction, length, color) => {
              const a = fraction*Math.PI*2-Math.PI/2;
              v.pxLine(Math.round(cx),Math.round(cy),Math.round(cx+Math.cos(a)*r*length),Math.round(cy+Math.sin(a)*r*length),color);
            };
            hand((d.getHours()%12+d.getMinutes()/60)/12,.5,th.text);
            hand((d.getMinutes()+d.getSeconds()/60)/60,.75,th.text);
            hand(d.getSeconds()/60,.85,th.accent);
          }
        } else {
          digital(v, duration(total()), 3, th.accent);
          button(v,hits,2,8,running?'Pause':'Start',th,toggle,{primary:true});
          button(v,hits,13,8,'Lap',th,lap);
          button(v,hits,21,8,'Reset',th,reset);
          v.text(2,10,running?'Running':'Paused',th.dim);
          const visible = Math.max(0,v.h-14);
          scroll = Math.min(scroll, Math.max(0,laps.length-visible));
          for(let i=0;i<visible;i++) {
            const idx = laps.length-1-scroll-i;
            if(idx<0) break;
            const split = laps[idx]-(idx>0?laps[idx-1]:0);
            v.text(2,12+i,os.util.fit('Lap '+pad(idx+1)+'  '+duration(laps[idx])+'  +'+duration(split),v.w-4),th.text);
          }
          v.text(1,v.h-1,os.util.fit('Space start/pause  L lap  R reset',v.w-2),th.dim);
        }
      },
      key(e) {
        if (e.key === 'tab') { tab = tab==='clock'?'stopwatch':'clock'; return true; }
        if (tab !== 'stopwatch') return false;
        if (e.key === ' ') { toggle(); return true; }
        if (e.key.toLowerCase() === 'l') { lap(); return true; }
        if (e.key.toLowerCase() === 'r') { reset(); return true; }
        return false;
      },
      mouse(e) {
        if(e.kind==='down' && e.button===0) hits.click(e.x,e.y);
        if(e.kind==='wheel') scroll = Math.max(0,scroll+e.dir*3);
      },
      tick() {
        const next = tab==='clock' ? Math.floor(Date.now()/1000) : Math.floor(total()/100);
        if(next===stamp) return false;
        stamp=next; return true;
      },
      save() { return { tab, elapsed:total(), running, savedAt:Date.now(), laps }; },
    };
  },
};
