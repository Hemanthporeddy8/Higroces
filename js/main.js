import { 
  viewMode, setViewModeState, setToolState, isAnimating,
  sessionCuts, actionHistory, legStates, severedParts
} from './state.js';
import { setPartScaleWeight, onCustomWeightInput, harvestSelectedPart, undoLastCut } from './scale.js';
import { setupSVGInteractions } from './svgInteractions.js';
import { init3D, onWindowResize, animate3D } from './threeEngine.js';
import { initOffalBox } from './ui.js';

// Bind to window for global inline HTML onclick support
window.setViewMode = function(mode) {
  setViewModeState(mode);
  document.getElementById('btn2D').classList.toggle('active', mode === '2d');
  document.getElementById('btn3D').classList.toggle('active', mode === '3d');

  const diagSvg = document.getElementById('diag-chicken');
  const container3D = document.getElementById('canvas3d-container');

  if (mode === '2d') {
    diagSvg.style.display = 'block';
    container3D.style.display = 'none';
  } else {
    diagSvg.style.display = 'none';
    container3D.style.display = 'block';
    setTimeout(() => {
      // Import threejs lazily or start loop
      import('./threeEngine.js').then(({ renderer3, init3D, onWindowResize, animate3D }) => {
        if (!renderer3) {
          init3D();
        } else {
          onWindowResize();
          animate3D();
        }
      });
    }, 50);
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

window.setPartScaleWeight = setPartScaleWeight;
window.onCustomWeightInput = onCustomWeightInput;
window.harvestSelectedPart = harvestSelectedPart;
window.undoLastCut = undoLastCut;

window.saveCustomCutsToCart = function() {
  if (sessionCuts.length === 0) {
    alert("You haven't carved any cuts yet. Choose 'Knife Cut' to carve parts!");
    return;
  }
  localStorage.setItem('custom_chicken_cuts', JSON.stringify(sessionCuts));
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
});
