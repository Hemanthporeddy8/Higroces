import { 
  sessionCuts, actionHistory, legStates, severedParts, currentTool,
  PART_WEIGHTS, PART_PRICES, PART_INFO,
  FISH_PART_WEIGHTS, FISH_PART_PRICES, FISH_PART_INFO,
  setCurrentScalePartIdState, setCurrentScaleWeightState, setSelectedLegSideState
} from './state.js';
import { renderSessionCuts, inspectPart } from './ui.js';
import { addCutToSession, animateScale } from './scale.js';
import { syncPartTo3D } from './threeEngine.js';

export const PART_DIRS = {
  wing_l:     { dx:-72, dy:-14, rot:-22, scale:0.80 },
  wing_r:     { dx: 72, dy:-14, rot: 22, scale:0.80 },
  thigh_l:    { dx:-48, dy: 42, rot:-12, scale:0.85 },
  thigh_r:    { dx: 48, dy: 42, rot: 12, scale:0.85 },
  leg_l:      { dx:-28, dy: 68, rot: -9, scale:0.82 },
  leg_r:      { dx: 28, dy: 68, rot:  9, scale:0.82 },
  breast_l:   { dx:-32, dy:-12, rot: -9, scale:0.88 },
  breast_r:   { dx: 32, dy:-12, rot:  9, scale:0.88 },
  neck:       { dx:  0, dy:-70, rot:  0, scale:0.78 },
  back_upper: { dx:  0, dy:-15, rot:  0, scale:0.90 },
  back_lower: { dx:  0, dy: 45, rot:  0, scale:0.90 },
  // Fish parts
  fish_head:  { dx:-60, dy:  0, rot:-12, scale:0.82 },
  fish_front: { dx:-20, dy:-18, rot: -5, scale:0.86 },
  fish_mid:   { dx:  0, dy:-22, rot:  0, scale:0.88 },
  fish_back:  { dx: 20, dy:-18, rot:  5, scale:0.86 },
  fish_tail:  { dx: 60, dy:  0, rot: 12, scale:0.82 },
};

export function getDir(partId) {
  return PART_DIRS[partId] || { dx:0, dy:20, rot:0, scale:0.90 };
}

export function applyPartTransform(el, transition = '') {
  const dx  = parseFloat(el.dataset.dragPx || '0');
  const dy  = parseFloat(el.dataset.dragPy || '0');
  const sx  = parseFloat(el.dataset.severPx || '0');
  const sy  = parseFloat(el.dataset.severPy || '0');
  const sc  = parseFloat(el.dataset.severSc || '1');
  const rot = parseFloat(el.dataset.severRot || '0');
  if (transition) el.style.transition = transition;
  el.style.transform = `translate(${dx+sx}px,${dy+sy}px) scale(${sc}) rotate(${rot}deg)`;
}

export function setSever(el, px, py, scale, rot) {
  el.dataset.severPx  = px;
  el.dataset.severPy  = py;
  el.dataset.severSc  = scale;
  el.dataset.severRot = rot;
}

export function getSVGElements(partId) {
  return Array.from(document.querySelectorAll(`[data-part="${partId}"][data-meat="chicken"]`));
}

export function severPart(partId) {
  const dir = getDir(partId);
  getSVGElements(partId).forEach(el => {
    el.classList.remove('part-restoring');
    el.classList.add('part-severed');
    setSever(el, dir.dx * 1.8, dir.dy * 1.6, dir.scale * 0.88, dir.rot * 1.6);
    applyPartTransform(el, 'transform 0.10s cubic-bezier(0.55,0,1,0.45)');
    el.style.opacity = '0.5';
    setTimeout(() => {
      setSever(el, dir.dx * 0.30, dir.dy * 0.28, dir.scale, dir.rot * 0.35);
      applyPartTransform(el, 'transform 0.50s cubic-bezier(0.22,1,0.36,1), opacity 0.40s ease');
      el.style.opacity = '0.06';
    }, 110);
  });
}

export function restorePart(partId) {
  const dir = getDir(partId);
  getSVGElements(partId).forEach(el => {
    el.classList.remove('part-severed');
    el.classList.add('part-restoring');
    el.dataset.dragPx = '0';
    el.dataset.dragPy = '0';
    setSever(el, dir.dx * 0.30, dir.dy * 0.28, dir.scale, dir.rot * 0.35);
    applyPartTransform(el, 'none');
    el.style.opacity = '0.06';

    requestAnimationFrame(() => requestAnimationFrame(() => {
      setSever(el, -dir.dx * 0.08, -dir.dy * 0.08, 1.06, -dir.rot * 0.1);
      applyPartTransform(el, 'transform 0.60s cubic-bezier(0.34,1.6,0.64,1), opacity 0.35s ease');
      el.style.opacity = '1';
      setTimeout(() => {
        setSever(el, 0, 0, 1, 0);
        applyPartTransform(el, 'transform 0.30s cubic-bezier(0.34,1.4,0.64,1)');
        setTimeout(() => {
          el.style.transition = '';
          el.style.opacity = '';
          el.classList.remove('part-restoring');
        }, 320);
      }, 620);
    }));
  });
}

export function spawnBloodParticles(cx, cy, baseAngle) {
  for (let i = 0; i < 6; i++) {
    const drop = document.createElement('div');
    drop.className = 'blood-drop';
    const sz = 4 + Math.random() * 6;
    const spreadR = 50 + Math.random() * 30;
    const spreadA = baseAngle + (Math.random() * 120 - 60);
    const spreadRad = spreadA * Math.PI / 180;
    drop.style.cssText = `
      left:${cx + (Math.random()-0.5)*16}px;
      top:${cy + (Math.random()-0.5)*12}px;
      width:${sz}px; height:${sz}px;
      --fx:${Math.cos(spreadRad)*spreadR}px;
      --fy:${Math.sin(spreadRad)*spreadR + 20}px;
      --fs:${0.2 + Math.random()*0.3};
      --dur:${0.45 + Math.random()*0.25}s;
      animation-delay:${i*25}ms;
    `;
    document.body.appendChild(drop);
    setTimeout(() => drop.remove(), 800);
  }
}

export function cut2DPart(el, cx, cy) {
  const partId   = el.dataset.part;
  const meatType = el.dataset.meat || 'chicken';
  const info = meatType === 'fish' ? FISH_PART_INFO[partId + '|fish'] : PART_INFO[partId + '|chicken'];
  if (!info) return;
  if (severedParts[partId]) return;

  severedParts[partId] = true;
  const dir = getDir(partId);
  const emoji = el.dataset.emoji || '🥩';

  el.classList.add('cutting');
  setTimeout(() => el.classList.remove('cutting'), 420);

  const ring = document.createElement('div');
  ring.className = 'cut-ring';
  ring.style.left = cx + 'px';
  ring.style.top  = cy + 'px';
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 550);

  const baseAngle = Math.atan2(dir.dy || 1, dir.dx || 1) * 180 / Math.PI;
  spawnBloodParticles(cx, cy, baseAngle);

  setTimeout(() => severPart(partId), 85);

  const fly = document.getElementById('flyPiece');
  fly.textContent = emoji;
  fly.style.cssText = `display:block;left:${cx-18}px;top:${cy-18}px;opacity:1;transform:scale(1.5) rotate(0deg);transition:none;font-size:2.2rem;`;

  const scaleRect = document.querySelector('.scale-display').getBoundingClientRect();
  const tx = scaleRect.left + scaleRect.width/2 - 18;
  const ty = scaleRect.top;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    fly.style.transition = 'left 0.72s cubic-bezier(0.4,0,0.15,1), top 0.72s cubic-bezier(0.4,0,0.15,1), transform 0.72s ease, opacity 0.2s ease 0.55s';
    fly.style.left      = tx + 'px';
    fly.style.top       = ty + 'px';
    fly.style.transform = 'scale(0.65) rotate(420deg)';
    fly.style.opacity   = '0';
  }));

  setTimeout(() => {
    fly.style.display = 'none';
    animateScale(info.weight, info.name, emoji);
    addCutToSession(partId, info.name, info.weight, info.price, emoji);
    actionHistory.push({ type: 'harvest', partId: partId });
    renderSessionCuts();
    syncPartTo3D(partId, false);
  }, 740);
}

export function splitLeg(side, cx, cy) {
  legStates[side] = 'split';
  spawn2DSlash(cx, cy);

  [`thigh_${side}`, `leg_${side}`].forEach(p => {
    getSVGElements(p).forEach(el => {
      el.classList.add('cutting');
      setTimeout(() => el.classList.remove('cutting'), 420);
    });
    syncPartTo3D(p, true);
  });

  const tooltip = document.getElementById('tooltip');
  tooltip.textContent = `Leg split into Thigh & Drumstick!`;
  tooltip.classList.add('visible');
  setTimeout(() => tooltip.classList.remove('visible'), 1800);

  actionHistory.push({ type: 'split', side: side });
}

export function spawn2DSlash(cx, cy) {
  const slash = document.createElement('div');
  slash.className = 'knife-slash';
  slash.style.cssText = `left:${cx-45}px;top:${cy-1}px;--a:${Math.random()*30-15}deg;`;
  document.body.appendChild(slash);
  setTimeout(() => slash.remove(), 520);
  
  for (let i=0; i<5; i++) {
    const d = document.createElement('div');
    d.className = 'blood-drop';
    d.style.cssText = `left:${cx+(Math.random()-0.5)*16}px;top:${cy+(Math.random()-0.5)*12}px;width:5px;height:5px;--fx:${(Math.random()-0.5)*50}px;--fy:${Math.random()*40+10}px;--fs:0.3;--dur:0.5s;animation-delay:${i*20}ms;`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 750);
  }
}

export function setupSVGInteractions() {
  document.querySelectorAll('.cut-part').forEach(el => {
    const partId   = el.dataset.part;
    const weight   = parseInt(el.dataset.weight || '100');
    const price    = parseFloat(el.dataset.price || '1.0');
    const emoji    = el.dataset.emoji || '🥩';
    const dir      = getDir(partId);

    el.addEventListener('mouseenter', e => {
      let displayName = '';
      let displayWeight = weight;
      let displayPrice = price;
      const side = partId.endsWith('_l') ? 'l' : 'r';
      const meatType = el.dataset.meat || 'chicken';

      if (meatType === 'fish') {
        const info = FISH_PART_INFO[partId + '|fish'];
        displayName = info ? info.name : partId;
        displayWeight = FISH_PART_WEIGHTS[partId] || weight;
        displayPrice  = FISH_PART_PRICES[partId]  || price;
        if (!severedParts[partId]) el.classList.add('selected-part');
      } else if ((partId.startsWith('thigh') || partId.startsWith('leg')) && legStates[side] === 'whole') {
        const wholeLegId = `leg_whole_${side}`;
        const info = PART_INFO[wholeLegId + '|chicken'];
        displayName = info ? info.name : `Whole Leg`;
        displayWeight = PART_WEIGHTS[wholeLegId];
        displayPrice = PART_PRICES[wholeLegId];

        [`thigh_${side}`, `leg_${side}`].forEach(p => {
          if (!severedParts[p]) {
            getSVGElements(p).forEach(elPart => {
              elPart.classList.add('selected-part');
              if (currentTool === 'knife') {
                const d = getDir(p);
                setSever(elPart, d.dx * 0.18, d.dy * 0.18, 1.04, d.rot * 0.22);
                applyPartTransform(elPart, 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)');
              }
            });
          }
        });
      } else {
        const info = PART_INFO[partId + '|chicken'];
        displayName = info ? info.name : partId;
        
        if (!severedParts[partId]) {
          el.classList.add('selected-part');
          if (currentTool === 'knife') {
            setSever(el, dir.dx * 0.18, dir.dy * 0.18, 1.04, dir.rot * 0.22);
            applyPartTransform(el, 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)');
          }
        }
      }

      const tooltip = document.getElementById('tooltip');
      tooltip.textContent = `${displayName} • ${displayWeight}g • $${displayPrice.toFixed(2)}`;
      tooltip.classList.add('visible');
    });

    el.addEventListener('mousemove', e => {
      const tooltip = document.getElementById('tooltip');
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY - 38) + 'px';
    });

    el.addEventListener('mouseleave', () => {
      document.getElementById('tooltip').classList.remove('visible');
      const side = partId.endsWith('_l') ? 'l' : 'r';
      
      if ((partId.startsWith('thigh') || partId.startsWith('leg')) && legStates[side] === 'whole') {
        [`thigh_${side}`, `leg_${side}`].forEach(p => {
          getSVGElements(p).forEach(elPart => {
            elPart.classList.remove('selected-part');
            if (!severedParts[p]) {
              setSever(elPart, 0, 0, 1, 0);
              applyPartTransform(elPart, 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)');
            }
          });
        });
      } else {
        el.classList.remove('selected-part');
        if (!severedParts[partId]) {
          setSever(el, 0, 0, 1, 0);
          applyPartTransform(el, 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)');
        }
      }
    });

    el.addEventListener('click', e => {
      const side = partId.endsWith('_l') ? 'l' : 'r';
      
      if (currentTool === 'knife') {
        if ((partId.startsWith('thigh') || partId.startsWith('leg')) && legStates[side] === 'whole') {
          splitLeg(side, e.clientX, e.clientY);
        } else {
          cut2DPart(el, e.clientX, e.clientY);
        }
      } else {
        inspectPart(partId);
      }
    });
  });
}
