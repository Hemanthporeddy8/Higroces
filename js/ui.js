import { 
  sessionCuts, actionHistory, legStates, severedParts, currentScalePartId,
  PART_WEIGHTS, PART_PRICES, PART_INFO, OFFAL_DATA,
  setCurrentScalePartIdState, setCurrentScaleWeightState, setSelectedLegSideState
} from './state.js';
import { setPartScaleWeight, adjustCutQty, setCutSize, removeSessionCut, animateScale } from './scale.js';
import { getSVGElements } from './svgInteractions.js';

export function renderSessionCuts() {
  const container = document.getElementById('sessionCutsList');
  if (sessionCuts.length === 0) {
    container.innerHTML = '<div class="empty-session-message">Use the knife tool to carve parts from the chicken.</div>';
    return;
  }
  
  container.innerHTML = sessionCuts.map((item, idx) => {
    if (item.id.startsWith('offal_')) {
      return `
        <div class="session-cut-item" style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--paper-mid);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.2rem;">${item.emoji}</span>
            <div>
              <div class="sci-name" style="font-weight:600; font-size:0.8rem; color:var(--ink);">${item.name}</div>
              <div class="sci-weight" style="font-size:0.7rem; color:var(--ink-light);">${item.weight}g • $${item.price.toFixed(2)}</div>
            </div>
          </div>
          <button class="sci-remove" data-idx="${idx}" style="background:none; border:none; color:var(--red); cursor:pointer; font-size:1.2rem; padding:0 6px;">×</button>
        </div>
      `;
    }

    const sizes = ['Small', 'Medium', 'Large'];
    const currentSize = item.size || 'Medium';

    const sizeSelector = `
      <select data-idx="${idx}" class="sci-size-select" style="background:white; border:1px solid var(--border); border-radius:4px; padding:2px 4px; font-size:0.65rem; font-family:'Outfit',sans-serif; color:var(--ink); cursor:pointer; margin-right:4px;">
        ${sizes.map(s => `<option value="${s}" ${s === currentSize ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    `;

    const qtyControls = `
      <div style="display:inline-flex; align-items:center; gap:4px; margin-right:8px; background:white; border:1px solid var(--border); border-radius:4px; padding:1px 3px;">
        <button class="sci-qty-btn-minus" data-idx="${idx}" style="border:none; background:none; cursor:pointer; font-size:0.75rem; width:14px; height:14px; display:flex; align-items:center; justify-content:center; color:var(--ink-light); font-weight:bold;">-</button>
        <span style="font-family:'DM Mono',monospace; font-size:0.75rem; min-width:12px; text-align:center;">${item.qty || 1}</span>
        <button class="sci-qty-btn-plus" data-idx="${idx}" style="border:none; background:none; cursor:pointer; font-size:0.75rem; width:14px; height:14px; display:flex; align-items:center; justify-content:center; color:var(--ink-light); font-weight:bold;">+</button>
      </div>
    `;

    return `
      <div class="session-cut-item" style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--paper-mid);">
        <div style="display:flex; align-items:center; gap:8px; max-width:160px;">
          <span style="font-size:1.2rem;">${item.emoji}</span>
          <div>
            <div class="sci-name" style="font-weight:600; font-size:0.8rem; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.name}">${item.name}</div>
            <div class="sci-weight" style="font-size:0.7rem; color:var(--ink-light);">${item.weight * (item.qty || 1)}g • $${((item.price || 0) * (item.qty || 1)).toFixed(2)}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center;">
          ${sizeSelector}
          ${qtyControls}
          <button class="sci-remove" data-idx="${idx}" style="background:none; border:none; color:var(--red); cursor:pointer; font-size:1.2rem; padding:0 6px;">×</button>
        </div>
      </div>
    `;
  }).join('');

  // Bind click handlers to prevent global scope onclick dependencies
  container.querySelectorAll('.sci-remove').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      removeSessionCut(parseInt(btn.dataset.idx));
    };
  });

  container.querySelectorAll('.sci-size-select').forEach(sel => {
    sel.onchange = (e) => {
      e.stopPropagation();
      setCutSize(parseInt(sel.dataset.idx), sel.value);
    };
    sel.onclick = (e) => e.stopPropagation();
  });

  container.querySelectorAll('.sci-qty-btn-minus').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      adjustCutQty(parseInt(btn.dataset.idx), -1);
    };
  });

  container.querySelectorAll('.sci-qty-btn-plus').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      adjustCutQty(parseInt(btn.dataset.idx), 1);
    };
  });
}

export function inspectPart(el) {
  let partId;
  if (el && el.dataset && el.dataset.part) {
    partId = el.dataset.part;
  } else if (typeof el === 'string') {
    partId = el;
  } else if (el) {
    partId = el.getAttribute('data-part');
  }

  if (!partId) return;
  const side = partId.endsWith('_l') ? 'l' : 'r';
  
  document.querySelectorAll('.cut-part').forEach(p => p.classList.remove('selected-part'));
  activeCutsListIdx = null;

  if ((partId.startsWith('thigh') || partId.startsWith('leg')) && legStates[side] === 'whole') {
    const wholeLegId = `leg_whole_${side}`;
    const info = PART_INFO[wholeLegId + '|chicken'];
    if (!info) return;

    [`thigh_${side}`, `leg_${side}`].forEach(p => {
      getSVGElements(p).forEach(elPart => elPart.classList.add('selected-part'));
    });

    setSelectedLegSideState(side);
    setCurrentScalePartIdState(wholeLegId);
    
    document.getElementById('harvestBtnContainer').style.display = 'block';
    document.getElementById('btnHarvestSelect').textContent = `Harvest Whole Leg`;
    
    document.getElementById('weightSelectorSection').style.display = 'block';
    document.getElementById('inputCustomWeight').value = info.weight;
    setPartScaleWeight(info.weight);
    
    animateScale(info.weight, info.name, '🍗');
  } else {
    const info = PART_INFO[partId + '|chicken'];
    if (!info) return;

    const targetEl = getSVGElements(partId)[0];
    if (targetEl) targetEl.classList.add('selected-part');
    
    setSelectedLegSideState(null);
    setCurrentScalePartIdState(partId);

    document.getElementById('harvestBtnContainer').style.display = 'block';
    document.getElementById('btnHarvestSelect').textContent = `Cut & Harvest ${info.name}`;
    
    document.getElementById('weightSelectorSection').style.display = 'block';
    document.getElementById('inputCustomWeight').value = info.weight;
    setPartScaleWeight(info.weight);
    
    animateScale(info.weight, info.name, (targetEl && targetEl.dataset.emoji) || '🥩');
  }
}

export function initOffalBox() {
  const box = document.getElementById('internalPartsBox');
  box.innerHTML = '';
  OFFAL_DATA.forEach(p => {
    const tag = document.createElement('div');
    tag.style.cssText = `
      background: white; border: 1px solid var(--border); border-radius: 4px;
      padding: 5px 10px; font-size: 0.72rem; cursor: pointer; display: flex;
      align-items: center; gap: 6px; transition: all 0.15s; color: var(--ink);
    `;
    tag.innerHTML = `<span style="font-size:0.9rem;">${p.e}</span> <span>${p.n}</span>`;
    tag.onmouseenter = () => { tag.style.borderColor = 'var(--red)'; tag.style.background = 'var(--paper-dark)'; };
    tag.onmouseleave = () => { tag.style.borderColor = 'var(--border)'; tag.style.background = 'white'; };
    tag.onclick = () => harvestOffal(p.n, p.w, p.p, p.e);
    box.appendChild(tag);
  });
}

function harvestOffal(name, weight, price, emoji) {
  if (sessionCuts.some(c => c.name === name)) {
    alert(`${name} has already been harvested!`);
    return;
  }

  const box = document.getElementById('internalPartsBox');
  box.style.background = 'rgba(184,40,24,0.1)';
  setTimeout(() => box.style.background = '', 200);

  addCutToSession('offal_' + name.toLowerCase(), name, weight, price, emoji);
  actionHistory.push({ type: 'harvest', partId: 'offal_' + name.toLowerCase() });
  animateScale(weight, name, emoji);
  renderSessionCuts();
}
