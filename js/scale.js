import { 
  sessionCuts, actionHistory, legStates, severedParts, 
  currentScalePartId, currentScaleWeight, selectedLegSide,
  baseScaleWeight, isBoneless, isSkinless,
  PART_WEIGHTS, PART_PRICES, PART_INFO,
  setCurrentScalePartIdState, setCurrentScaleWeightState, setSelectedLegSideState,
  setBaseScaleWeightState, setIsBonelessState, setIsSkinlessState
} from './state.js';
import { renderSessionCuts, renderQuickSelectSidebar } from './ui.js';
import { severPart, restorePart, syncPartTo3D, getSVGElements } from './svgInteractions.js';

export function animateScale(targetWeight, partName, emoji) {
  const pan = document.getElementById('scalePan');
  const display = document.getElementById('weightDisplay');
  const partLabel = document.getElementById('scalePartName');
  const emojiEl = document.getElementById('scaleEmoji');

  pan.classList.remove('weighing');
  void pan.offsetWidth;
  pan.classList.add('weighing');

  emojiEl.textContent = emoji || '🥩';
  emojiEl.style.opacity = '1';

  const duration = 600;
  const steps = 30;
  const step = targetWeight / steps;
  let current = 0;
  let i = 0;

  display.textContent = '0';
  partLabel.textContent = partName;

  const interval = setInterval(() => {
    i++;
    current = Math.min(Math.round(step * i), targetWeight);
    display.textContent = current.toLocaleString();
    if (i >= steps) {
      clearInterval(interval);
      display.textContent = targetWeight.toLocaleString();
    }
  }, duration / steps);

  setTimeout(() => {
    pan.classList.remove('weighing');
    emojiEl.style.opacity = '0.7';
  }, duration + 100);
}

export function updateAdjustedScaleWeight() {
  const checkB = document.getElementById('checkBoneless');
  const checkS = document.getElementById('checkSkinless');
  const activeB = checkB ? checkB.checked : false;
  const activeS = checkS ? checkS.checked : false;
  
  setIsBonelessState(activeB);
  setIsSkinlessState(activeS);
  
  let adjusted = baseScaleWeight;
  if (activeB) adjusted *= 0.8;
  if (activeS) adjusted *= 0.95;
  adjusted = Math.round(adjusted);
  
  setCurrentScaleWeightState(adjusted);
  
  const display = document.getElementById('weightDisplay');
  if (display) {
    display.textContent = adjusted.toLocaleString();
  }
}

export function setPartScaleWeight(weight) {
  setBaseScaleWeightState(parseInt(weight) || 250);
  updateAdjustedScaleWeight();
  const inputEl = document.getElementById('inputCustomWeight');
  if (inputEl) inputEl.value = baseScaleWeight;
}

export function onCustomWeightInput(weightVal) {
  const weight = parseInt(weightVal) || 0;
  if (weight >= 50 && weight <= 5000) {
    setBaseScaleWeightState(weight);
    updateAdjustedScaleWeight();
  }
}

export function toggleMeatOption(type) {
  updateAdjustedScaleWeight();
  if (currentScalePartId) {
    const info = PART_INFO[currentScalePartId + '|chicken'] || PART_INFO[currentScalePartId];
    if (info) {
      const display = document.getElementById('weightDisplay');
      if (display) {
        display.textContent = currentScaleWeight.toLocaleString();
      }
    }
  }
}

export function addCutToSession(partId, name, weight, price, emoji, size = 'Medium') {
  const existing = sessionCuts.find(c => c.name === name && c.size === size);
  if (existing) {
    existing.qty = (existing.qty || 1) + 1;
    if (!existing.partIds) {
      existing.partIds = [existing.partId];
    }
    existing.partIds.push(partId);
  } else {
    sessionCuts.push({
      id: partId + '_cut_' + Date.now(),
      partId: partId,
      partIds: [partId],
      name: name,
      baseWeight: weight,
      basePrice: price,
      weight: weight,
      price: price,
      emoji: emoji,
      qty: 1,
      size: size,
      isCustom: true
    });
  }
}

export function harvestSelectedPart() {
  if (!currentScalePartId) {
    alert("Please select a part of the chicken to cut & harvest!");
    return;
  }

  const partId = currentScalePartId;
  const isWholeLeg = partId.startsWith('leg_whole_');
  const side = isWholeLeg ? (partId.endsWith('_l') ? 'l' : 'r') : null;

  if (isWholeLeg) {
    if (severedParts[`thigh_${side}`] || severedParts[`leg_${side}`]) {
      alert("Part of this leg has already been cut or harvested!");
      return;
    }
  } else {
    if (severedParts[partId]) {
      alert("This part has already been cut or harvested!");
      return;
    }
  }

  let info, emoji;
  if (isWholeLeg) {
    info = PART_INFO[partId + '|chicken'];
    emoji = '🍗';
  } else {
    info = PART_INFO[partId + '|chicken'];
    emoji = getSVGElements(partId)[0]?.dataset.emoji || '🥩';
  }

  if (!info) return;

  if (isWholeLeg) {
    severedParts[`thigh_${side}`] = true;
    severedParts[`leg_${side}`] = true;
    severPart(`thigh_${side}`);
    severPart(`leg_${side}`);
    syncPartTo3D(`thigh_${side}`, false);
    syncPartTo3D(`leg_${side}`, false);
  } else {
    severedParts[partId] = true;
    severPart(partId);
    syncPartTo3D(partId, false);
  }

  const baseWeight = PART_WEIGHTS[partId] || 250;
  const basePrice = PART_PRICES[partId] || 2.0;

  const checkB = document.getElementById('checkBoneless');
  const checkS = document.getElementById('checkSkinless');
  const activeB = checkB ? checkB.checked : false;
  const activeS = checkS ? checkS.checked : false;

  let priceFactor = 1.0;
  if (activeB) priceFactor *= 1.15;
  if (activeS) priceFactor *= 1.05;

  const computedPrice = Math.round(basePrice * (baseScaleWeight / baseWeight) * priceFactor);

  let displayName = info.name;
  if (activeB && activeS) displayName += " (Boneless, Skinless)";
  else if (activeB) displayName += " (Boneless)";
  else if (activeS) displayName += " (Skinless)";

  addCutToSession(partId, displayName, currentScaleWeight, computedPrice, emoji);

  actionHistory.push({ type: 'harvest', partId: partId });

  document.querySelectorAll('.cut-part').forEach(p => p.classList.remove('selected-part'));
  document.getElementById('harvestBtnContainer').style.display = 'none';
  document.getElementById('weightSelectorSection').style.display = 'none';
  setCurrentScalePartIdState(null);

  animateScale(currentScaleWeight, displayName, emoji);
  renderSessionCuts();
  if (typeof renderQuickSelectSidebar === 'function') {
    renderQuickSelectSidebar();
  }
}

export function removeSessionCut(idx) {
  const item = sessionCuts[idx];
  if (!item) return;
  
  if (!item.id.startsWith('offal_')) {
    const partId = item.partId;
    
    const aIdx = actionHistory.findIndex(a => a.type === 'harvest' && a.partId === partId);
    if (aIdx !== -1) {
      actionHistory.splice(aIdx, 1);
    }

    if (partId.startsWith('leg_whole_')) {
      const side = partId.endsWith('_l') ? 'l' : 'r';
      delete severedParts[`thigh_${side}`];
      delete severedParts[`leg_${side}`];
      
      restorePart(`thigh_${side}`);
      restorePart(`leg_${side}`);
      syncPartTo3D(`thigh_${side}`, true);
      syncPartTo3D(`leg_${side}`, true);
    } else {
      delete severedParts[partId];
      restorePart(partId);
      syncPartTo3D(partId, true);
    }
  } else {
    const aIdx = actionHistory.findIndex(a => a.type === 'harvest' && a.partId === item.partId);
    if (aIdx !== -1) {
      actionHistory.splice(aIdx, 1);
    }
  }

  sessionCuts.splice(idx, 1);
  
  if (sessionCuts.length > 0) {
    const prev = sessionCuts[sessionCuts.length - 1];
    animateScale(prev.weight, prev.name, prev.emoji);
  } else {
    document.getElementById('weightDisplay').textContent = '0';
    document.getElementById('scalePartName').textContent = '— empty —';
  }

  renderSessionCuts();
  if (typeof renderQuickSelectSidebar === 'function') {
    renderQuickSelectSidebar();
  }
}

export function adjustCutQty(idx, amount) {
  const item = sessionCuts[idx];
  if (!item) return;
  item.qty = (item.qty || 1) + amount;
  if (item.qty <= 0) {
    removeSessionCut(idx);
  } else {
    renderSessionCuts();
  }
}

export function setCutSize(idx, size) {
  const item = sessionCuts[idx];
  if (!item) return;

  if (size === 'Exact (Premium 💎)') {
    alert("💎 Custom Exact Carving is a HiGroces Premium feature.\nJoin Premium to carve exact weight parameters!");
    // Reset selection in UI
    renderSessionCuts();
    return;
  }

  item.size = size;
  
  const baseWeight = item.baseWeight || PART_WEIGHTS[item.partId] || 150;
  const basePrice = item.basePrice || PART_PRICES[item.partId] || 100;

  if (size === 'Small') {
    item.weight = Math.round(baseWeight * 0.8);
    item.price = Math.round(basePrice * 0.8);
  } else if (size === 'Medium') {
    item.weight = baseWeight;
    item.price = basePrice;
  } else if (size === 'Large') {
    item.weight = Math.round(baseWeight * 1.25);
    item.price = Math.round(basePrice * 1.25);
  } else if (size === '250g') {
    item.weight = 250;
    item.price = Math.round(basePrice * (250 / baseWeight));
  } else if (size === '500g') {
    item.weight = 500;
    item.price = Math.round(basePrice * (500 / baseWeight));
  } else if (size === '1kg') {
    item.weight = 1000;
    item.price = Math.round(basePrice * (1000 / baseWeight));
  } else if (size === '2kg') {
    item.weight = 2000;
    item.price = Math.round(basePrice * (2000 / baseWeight));
  } else if (size === '5kg') {
    item.weight = 5000;
    item.price = Math.round(basePrice * (5000 / baseWeight));
  }

  renderSessionCuts();
}

export function undoLastCut() {
  if (actionHistory.length === 0) {
    alert("No actions to undo!");
    return;
  }
  const lastAction = actionHistory.pop();
  if (lastAction.type === 'harvest') {
    const idx = sessionCuts.findIndex(item => item.partId === lastAction.partId);
    if (idx !== -1) {
      removeSessionCut(idx);
    }
  } else if (lastAction.type === 'split') {
    const side = lastAction.side;
    legStates[side] = 'whole';
    [`thigh_${side}`, `leg_${side}`].forEach(p => {
      syncPartTo3D(p, true);
    });
    document.querySelectorAll('.cut-part').forEach(p => p.classList.remove('selected-part'));
    document.getElementById('weightDisplay').textContent = '0';
    document.getElementById('scalePartName').textContent = '— empty —';
  }
  if (typeof renderQuickSelectSidebar === 'function') {
    renderQuickSelectSidebar();
  }
}
