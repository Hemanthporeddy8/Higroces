import { 
  sessionCuts, actionHistory, legStates, severedParts, 
  currentScalePartId, currentScaleWeight, selectedLegSide,
  PART_WEIGHTS, PART_PRICES, PART_INFO,
  setCurrentScalePartIdState, setCurrentScaleWeightState, setSelectedLegSideState
} from './state.js';
import { renderSessionCuts } from './ui.js';
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

export function setPartScaleWeight(weight) {
  setCurrentScaleWeightState(parseInt(weight) || 250);
  document.getElementById('weightDisplay').textContent = weight.toLocaleString();
  document.getElementById('inputCustomWeight').value = weight;
}

export function onCustomWeightInput(weightVal) {
  const weight = parseInt(weightVal) || 0;
  if (weight >= 50 && weight <= 5000) {
    setCurrentScaleWeightState(weight);
    document.getElementById('weightDisplay').textContent = weight.toLocaleString();
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
  const computedPrice = parseFloat((basePrice * (currentScaleWeight / baseWeight)).toFixed(2));

  addCutToSession(partId, info.name, currentScaleWeight, computedPrice, emoji);

  actionHistory.push({ type: 'harvest', partId: partId });

  document.querySelectorAll('.cut-part').forEach(p => p.classList.remove('selected-part'));
  document.getElementById('harvestBtnContainer').style.display = 'none';
  document.getElementById('weightSelectorSection').style.display = 'none';
  setCurrentScalePartIdState(null);

  animateScale(currentScaleWeight, info.name, emoji);
  renderSessionCuts();
}
