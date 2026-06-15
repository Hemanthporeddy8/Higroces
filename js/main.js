import { 
  viewMode, setViewModeState, setToolState, isAnimating,
  sessionCuts, actionHistory, legStates, severedParts,
  currentAnimal, setCurrentAnimalState
} from './state.js';
import { setPartScaleWeight, onCustomWeightInput, harvestSelectedPart, undoLastCut, toggleMeatOption } from './scale.js';
import { setupSVGInteractions } from './svgInteractions.js';
import { init3D, onWindowResize, animate3D, renderer3 } from './threeEngine.js';
import { initOffalBox, renderQuickSelectSidebar, inspectPart } from './ui.js';

// Bind to window for global inline HTML onclick support
window.setViewMode = function(mode) {
  setViewModeState(mode);
  document.getElementById('btn2D').classList.toggle('active', mode === '2d');
  document.getElementById('btn3D').classList.toggle('active', mode === '3d');

  const diagSvg = document.getElementById('diag-' + currentAnimal);
  const container3D = document.getElementById('canvas3d-container');

  if (mode === '2d') {
    if (diagSvg) diagSvg.style.display = 'block';
    container3D.style.display = 'none';
  } else {
    // Hide all diagram containers
    document.querySelectorAll('.meat-diagram').forEach(d => d.style.display = 'none');
    container3D.style.display = 'block';
    // Force layout reflow so clientWidth/Height are available
    container3D.getBoundingClientRect();
    setTimeout(() => {
      if (typeof init3D === 'function') {
        if (!renderer3) {
          init3D();
        } else {
          onWindowResize();
          animate3D();
        }
      }
    }, 200); // increased from 50ms to 200ms for reliable layout
  }
};

window.setTool = function(tool) {
  setToolState(tool);
  document.getElementById('wsBtnSelect').classList.toggle('active', tool === 'select');
  document.getElementById('wsBtnKnife').classList.toggle('active', tool === 'knife');
  
  const rightPanel = document.getElementById('customRightPanel');
  rightPanel.classList.toggle('knife-active', tool === 'knife');
  
  document.getElementById('wsModeHint').textContent =
    tool === 'knife'
    ? '🔪 Knife Active — click any part to cut it'
    : '▶ Select Tool — click a part to inspect details';
};

// Animal switcher (Chicken / Fish)
window.setAnimal = function(animal) {
  setCurrentAnimalState(animal);

  // Update tab buttons
  const btnChicken = document.getElementById('diagAnimalChicken');
  const btnFish    = document.getElementById('diagAnimalFish');
  if (btnChicken) btnChicken.classList.toggle('active', animal === 'chicken');
  if (btnFish)    btnFish.classList.toggle('active',    animal === 'fish');

  // Show the right diagram, hide the other; also handle 3D toggle visibility
  document.querySelectorAll('.meat-diagram').forEach(d => { d.style.display = 'none'; });
  const activeDiag = document.getElementById('diag-' + animal);
  if (activeDiag && viewMode === '2d') activeDiag.style.display = 'block';

  // Reset left-panel state
  const weightDisplay = document.getElementById('weightDisplay');
  if (weightDisplay) weightDisplay.textContent = '0';
  const scalePartName = document.getElementById('scalePartName');
  if (scalePartName) scalePartName.textContent = '— empty —';

  document.getElementById('harvestBtnContainer').style.display  = 'none';
  document.getElementById('weightSelectorSection').style.display = 'none';
  document.querySelectorAll('.cut-part').forEach(p => p.classList.remove('selected-part'));

  // Re-setup interactions and sidebar for new animal
  setupSVGInteractions();
  renderQuickSelectSidebar();
  initOffalBox();

  // Update offal section title
  const offalTitle = document.getElementById('offalSectionTitle');
  if (offalTitle) offalTitle.textContent = animal === 'fish' ? 'FISH EXTRAS' : 'CAVITY / ORGAN HARVEST (OFFAL)';
};

window.setPartScaleWeight = setPartScaleWeight;
window.onCustomWeightInput = onCustomWeightInput;
window.harvestSelectedPart = harvestSelectedPart;
window.undoLastCut = undoLastCut;
window.toggleMeatOption = toggleMeatOption;
window.renderQuickSelectSidebar = renderQuickSelectSidebar;
window.inspectPart = inspectPart;

window.saveCustomCutsToCart = function() {
  if (sessionCuts.length === 0) {
    alert("You haven't carved any cuts yet. Choose 'Knife Cut' to carve parts!");
    return;
  }
  try {
    localStorage.setItem('custom_chicken_cuts', JSON.stringify(sessionCuts));
  } catch (e) {
    console.error("Failed to write to localStorage", e);
  }
  sessionCuts.length = 0;
  window.location.href = 'index.html';
};

window.goBackToStorefront = function() {
  if (sessionCuts.length > 0) {
    if (!confirm("Are you sure you want to exit? Your custom carved cuts will be discarded.")) {
      return;
    }
  }
  window.location.href = 'index.html';
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.setViewMode('2d');
  initOffalBox();
  setupSVGInteractions();
  renderQuickSelectSidebar();
});
