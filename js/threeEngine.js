import { 
  viewMode, colors3D, severedParts, legStates, currentTool, isAnimating,
  PART_WEIGHTS, PART_PRICES,
  setIsAnimatingState
} from './state.js';
import { inspectPart } from './ui.js';
import { splitLeg } from './svgInteractions.js';
import { animateScale, addCutToSession } from './scale.js';

export let scene3, camera3, renderer3, chickenGroup, raycaster, mouse;
export const parts3D = {};

const colorValues = {
  back: 0xFFB74D,       
  breast_l: 0xFFF8E1,   
  breast_r: 0xFFF8E1,   
  wing_l: 0xFFCC80,     
  wing_r: 0xFFCC80,     
  thigh_l: 0xFF8A65,    
  thigh_r: 0xFF8A65,    
  leg_l: 0xFF7043,      
  leg_r: 0xFF7043,      
  neck: 0xFF8A65        
};

export function init3D() {
  try {
    if (typeof THREE === 'undefined') {
      throw new Error("Three.js library is not loaded. Please check your browser tracking prevention or internet settings.");
    }
    
    const container = document.getElementById('canvas3d-container');
    const canvas    = document.getElementById('canvas3d');
    let W = container.clientWidth;
    let H = container.clientHeight;
    if (W < 100 || H < 100) {
      const rightPanel = document.getElementById('customRightPanel');
      W = rightPanel.clientWidth || (window.innerWidth - 320);
      H = rightPanel.clientHeight || window.innerHeight;
    }

    scene3 = new THREE.Scene();
    scene3.background = new THREE.Color(0xDCD8D0);

    camera3 = new THREE.PerspectiveCamera(40, W/H, 0.1, 50);
    camera3.position.set(0, 0, 5.0);

    renderer3 = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer3.setSize(W, H);
    renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene3.add(new THREE.AmbientLight(0xffffff, 0.75));
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2.5, 4.0, 3.5);
    scene3.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xFFE0B2, 0.45);
    fillLight.position.set(-3.0, 1.0, 2.0);
    scene3.add(fillLight);

    buildChicken3D();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    canvas.addEventListener('click', on3DClick);
    canvas.addEventListener('mousemove', on3DHover);
    window.addEventListener('resize', onWindowResize);

    animate3D();
  } catch (err) {
    console.error("3D Canvas Initialization failed:", err);
    const container = document.getElementById('canvas3d-container');
    container.innerHTML = `<div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; color:var(--red); background: #E8D8C4; border: 2px solid var(--border); border-radius:8px; font-family:'Outfit', sans-serif;">
      <span style="font-size:2rem; margin-bottom:12px;">⚠️</span>
      <h3 style="font-family:'Playfair Display', serif; margin-bottom:8px;">3D Model Failed to Load</h3>
      <p style="font-size:0.75rem; color:var(--ink-light); max-width:300px; margin-bottom:12px;">${err.message}</p>
      <button onclick="window.location.reload()" style="background:var(--brand-primary); color:white; border:none; padding:6px 16px; border-radius:4px; font-size:0.7rem; font-weight:600; cursor:pointer;">Reload Page</button>
    </div>`;
  }
}

export function buildChicken3D() {
  chickenGroup = new THREE.Group();

  const materials = {};
  for (const [part, hex] of Object.entries(colorValues)) {
    materials[part] = new THREE.MeshToonMaterial({
      color: hex
    });
  }

  // Split Back 3D Parts (Upper Ribs and Lower Back)
  const buGroup = new THREE.Group();
  const buMesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), materials.back);
  buMesh.scale.set(0.95, 0.85, 0.9);
  buGroup.position.set(0, 0.45, -0.05);
  buGroup.add(buMesh);
  buGroup.userData = { partId: 'back_upper', name: 'Ribs', weight: 200, price: 0.65, emoji: '🦴' };
  buGroup.userData.origPos = buGroup.position.clone();
  parts3D.back_upper = buGroup;
  chickenGroup.add(buGroup);

  const bloGroup = new THREE.Group();
  const bloMesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), materials.back);
  bloMesh.scale.set(0.95, 0.85, 0.9);
  bloGroup.position.set(0, -0.35, -0.05);
  bloGroup.add(bloMesh);
  bloGroup.userData = { partId: 'back_lower', name: 'Lower Back', weight: 180, price: 0.55, emoji: '🍗' };
  bloGroup.userData.origPos = bloGroup.position.clone();
  parts3D.back_lower = bloGroup;
  chickenGroup.add(bloGroup);

  const blGroup = new THREE.Group();
  const blMesh = new THREE.Mesh(new THREE.SphereGeometry(0.66, 32, 24), materials.breast_l);
  blMesh.scale.set(0.85, 1.35, 0.82);
  blGroup.position.set(-0.42, 0.22, 0.48);
  blGroup.rotation.set(0.08, 0.08, -0.12);
  blGroup.add(blMesh);
  blGroup.userData = { partId: 'breast_l', name: 'Breast', weight: 255, price: 3.50, emoji: '🥩' };
  blGroup.userData.origPos = blGroup.position.clone();
  parts3D.breast_l = blGroup;
  chickenGroup.add(blGroup);

  const brGroup = new THREE.Group();
  const brMesh = new THREE.Mesh(new THREE.SphereGeometry(0.66, 32, 24), materials.breast_r);
  brMesh.scale.set(0.85, 1.35, 0.82);
  brGroup.position.set(0.42, 0.22, 0.48);
  brGroup.rotation.set(0.08, -0.08, 0.12);
  brGroup.add(brMesh);
  brGroup.userData = { partId: 'breast_r', name: 'Breast', weight: 255, price: 3.50, emoji: '🥩' };
  brGroup.userData.origPos = brGroup.position.clone();
  parts3D.breast_r = brGroup;
  chickenGroup.add(brGroup);

  const neckGroup = new THREE.Group();
  neckGroup.position.set(0, 1.15, 0.1);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.55, 24), materials.neck);
  neckMesh.rotation.x = -0.10;
  neckGroup.add(neckMesh);
  neckGroup.userData = { partId: 'neck', name: 'Neck', weight: 115, price: 0.90, emoji: '🦴' };
  neckGroup.userData.origPos = neckGroup.position.clone();
  parts3D.neck = neckGroup;
  chickenGroup.add(neckGroup);

  const wlGroup = new THREE.Group();
  wlGroup.position.set(-0.95, 0.32, 0.05);
  const wlDrum = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), materials.wing_l);
  wlDrum.scale.set(0.65, 0.65, 1.35);
  wlDrum.rotation.set(0.15, 0.15, -0.35);
  wlGroup.add(wlDrum);
  
  const wlFlat = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), materials.wing_l);
  wlFlat.scale.set(0.5, 0.5, 1.75);
  wlFlat.position.set(-0.23, -0.18, -0.10);
  wlFlat.rotation.set(0.25, 0.25, -0.55);
  wlGroup.add(wlFlat);
  
  wlGroup.userData = { partId: 'wing_l', name: 'Wing', weight: 95, price: 1.80, emoji: '🍗' };
  wlGroup.userData.origPos = wlGroup.position.clone();
  parts3D.wing_l = wlGroup;
  chickenGroup.add(wlGroup);

  const wrGroup = new THREE.Group();
  wrGroup.position.set(0.95, 0.32, 0.05);
  const wrDrum = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), materials.wing_r);
  wrDrum.scale.set(0.65, 0.65, 1.35);
  wrDrum.rotation.set(0.15, -0.15, 0.35);
  wrGroup.add(wrDrum);
  
  const wrFlat = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), materials.wing_r);
  wrFlat.scale.set(0.5, 0.5, 1.75);
  wrFlat.position.set(0.23, -0.18, -0.10);
  wrFlat.rotation.set(0.25, -0.25, 0.55);
  wrGroup.add(wrFlat);
  
  wrGroup.userData = { partId: 'wing_r', name: 'Wing', weight: 95, price: 1.80, emoji: '🍗' };
  wrGroup.userData.origPos = wrGroup.position.clone();
  parts3D.wing_r = wrGroup;
  chickenGroup.add(wrGroup);

  const tlGroup = new THREE.Group();
  tlGroup.position.set(-0.52, -0.55, 0.22);
  const tlMesh = new THREE.Mesh(new THREE.SphereGeometry(0.64, 24, 18), materials.thigh_l);
  tlMesh.scale.set(0.85, 1.12, 0.85);
  tlMesh.rotation.set(0.08, 0.08, -0.08);
  tlGroup.add(tlMesh);
  tlGroup.userData = { partId: 'thigh_l', name: 'Thigh', weight: 172, price: 2.20, emoji: '🍗' };
  tlGroup.userData.origPos = tlGroup.position.clone();
  parts3D.thigh_l = tlGroup;
  chickenGroup.add(tlGroup);

  const trGroup = new THREE.Group();
  trGroup.position.set(0.52, -0.55, 0.22);
  const trMesh = new THREE.Mesh(new THREE.SphereGeometry(0.64, 24, 18), materials.thigh_r);
  trMesh.scale.set(0.85, 1.12, 0.85);
  trMesh.rotation.set(0.08, -0.08, 0.08);
  trGroup.add(trMesh);
  trGroup.userData = { partId: 'thigh_r', name: 'Thigh', weight: 172, price: 2.20, emoji: '🍗' };
  trGroup.userData.origPos = trGroup.position.clone();
  parts3D.thigh_r = trGroup;
  chickenGroup.add(trGroup);

  const dlGroup = new THREE.Group();
  dlGroup.position.set(-0.46, -1.25, 0.28);
  const dlMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 0.75, 20), materials.leg_l);
  dlMesh.rotation.set(0.18, 0.08, -0.10);
  dlGroup.add(dlMesh);
  dlGroup.userData = { partId: 'leg_l', name: 'Drumstick', weight: 148, price: 1.60, emoji: '🍗' };
  dlGroup.userData.origPos = dlGroup.position.clone();
  parts3D.leg_l = dlGroup;
  chickenGroup.add(dlGroup);

  const drGroup = new THREE.Group();
  drGroup.position.set(0.46, -1.25, 0.28);
  const drMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 0.75, 20), materials.leg_r);
  drMesh.rotation.set(0.18, -0.08, 0.10);
  drGroup.add(drMesh);
  drGroup.userData = { partId: 'leg_r', name: 'Drumstick', weight: 148, price: 1.60, emoji: '🍗' };
  drGroup.userData.origPos = drGroup.position.clone();
  parts3D.leg_r = drGroup;
  chickenGroup.add(drGroup);

  chickenGroup.position.y = -0.22;
  chickenGroup.scale.set(0.82, 0.82, 0.82);
  scene3.add(chickenGroup);
}

export function onWindowResize() {
  if (!renderer3) return;
  const container = document.getElementById('canvas3d-container');
  let W = container.clientWidth;
  let H = container.clientHeight;
  if (W < 100 || H < 100) {
    const rightPanel = document.getElementById('customRightPanel');
    W = rightPanel.clientWidth || (window.innerWidth - 320);
    H = rightPanel.clientHeight || window.innerHeight;
  }
  renderer3.setSize(W, H);
  camera3.aspect = W / H;
  camera3.updateProjectionMatrix();
}

export function animate3D() {
  if (viewMode !== '3d') {
    setIsAnimatingState(false);
    return;
  }
  setIsAnimatingState(true);
  requestAnimationFrame(animate3D);
  if (chickenGroup) {
    chickenGroup.rotation.y = Math.sin(Date.now() * 0.0006) * 0.22;
  }
  if (renderer3) {
    renderer3.render(scene3, camera3);
  }
}

let hovered3DGroup = null;

export function on3DHover(e) {
  if (viewMode !== '3d') return;
  const canvas = document.getElementById('canvas3d');
  const rect   = canvas.getBoundingClientRect();
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera3);
  
  const clickableMeshes = [];
  if (chickenGroup) {
    chickenGroup.children.forEach(group => {
      if (group.visible) {
        group.traverse(child => { if (child.isMesh) clickableMeshes.push(child); });
      }
    });
  }

  const hits = raycaster.intersectObjects(clickableMeshes);
  
  if (hovered3DGroup) {
    const prevData = hovered3DGroup.userData;
    const side = prevData.partId.endsWith('_l') ? 'l' : 'r';
    if ((prevData.partId.startsWith('thigh') || prevData.partId.startsWith('leg')) && legStates[side] === 'whole') {
      [`thigh_${side}`, `leg_${side}`].forEach(p => {
        const grp = parts3D[p];
        if (grp) grp.traverse(child => { if (child.isMesh) child.material.emissive.setHex(0x000000); });
      });
    } else {
      hovered3DGroup.traverse(child => { if (child.isMesh) child.material.emissive.setHex(0x000000); });
    }
    hovered3DGroup = null;
  }

  if (hits.length > 0) {
    const hitMesh = hits[0].object;
    let parentGroup = hitMesh.parent;
    while (parentGroup && parentGroup.parent !== chickenGroup) { parentGroup = parentGroup.parent; }

    if (parentGroup) {
      const pId = parentGroup.userData.partId;
      if (!severedParts[pId]) {
        hovered3DGroup = parentGroup;
        const glowHex = currentTool === 'knife' ? 0x441100 : 0x181000;
        const side = pId.endsWith('_l') ? 'l' : 'r';

        if ((pId.startsWith('thigh') || pId.startsWith('leg')) && legStates[side] === 'whole') {
          [`thigh_${side}`, `leg_${side}`].forEach(p => {
            const grp = parts3D[p];
            if (grp && !severedParts[p]) {
              grp.traverse(child => { if (child.isMesh) child.material.emissive.setHex(glowHex); });
            }
          });
        } else {
          parentGroup.traverse(child => { if (child.isMesh) child.material.emissive.setHex(glowHex); });
        }
      }
    }
  }
}

export function on3DClick(e) {
  if (viewMode !== '3d') return;
  if (!hovered3DGroup) return;

  const group = hovered3DGroup;
  const data = group.userData;
  const pId = data.partId;
  const side = pId.endsWith('_l') ? 'l' : 'r';

  if (currentTool === 'knife') {
    if (severedParts[pId]) return;
    if ((pId.startsWith('thigh') || pId.startsWith('leg')) && legStates[side] === 'whole') {
      splitLeg(side, e.clientX, e.clientY);
    } else {
      cut3DPart(group, e.clientX, e.clientY);
    }
  } else {
    inspectPart(pId);
    
    if (pId.startsWith('back_')) {
      const grp = parts3D[pId];
      if (grp) grp.traverse(child => { if (child.isMesh) child.material.emissive.setHex(0x181000); });
    } else {
      [`thigh_${side}`, `leg_${side}`].forEach(p => {
        const grp = parts3D[p];
        if (grp) grp.traverse(child => { if (child.isMesh) child.material.emissive.setHex(0x181000); });
      });
    }
  }
}

import { spawn2DSlash, severPart } from './svgInteractions.js';

export function cut3DPart(group, cx, cy) {
  const data = group.userData;
  const partId = data.partId;
  if (severedParts[partId]) return;

  severedParts[partId] = true;
  hovered3DGroup = null;

  spawn2DSlash(cx, cy);

  const startPos = group.position.clone();
  const startScale = group.scale.clone();
  const targetPos = new THREE.Vector3(startPos.x * 2.2, startPos.y * 1.5, startPos.z + 1.5);

  let t = 0;
  const animateCut = () => {
    t += 0.055;
    if (t >= 1) {
      group.visible = false;
      animateScale(data.weight, data.name, data.emoji);
      addCutToSession(partId, data.name, data.weight, data.price, data.emoji);
      actionHistory.push({ type: 'harvest', partId: partId });
      renderSessionCuts();
      severPart(partId);
    } else {
      group.position.lerpVectors(startPos, targetPos, t);
      group.scale.set(startScale.x*(1-t), startScale.y*(1-t), startScale.z*(1-t));
      requestAnimationFrame(animateCut);
    }
  };
  animateCut();
}

export function syncPartTo3D(partId, visible) {
  if (!chickenGroup) return;
  const group = parts3D[partId];
  if (group) {
    if (visible) {
      group.visible = true;
      group.scale.set(1, 1, 1);
      
      const side = partId.endsWith('_l') ? 'l' : 'r';
      if ((partId.startsWith('thigh') || partId.startsWith('leg')) && legStates[side] === 'split') {
        const offset = thigh => {
          if (side === 'l') return thigh ? {x:-0.12, y:0.06} : {x:-0.06, y:-0.12};
          return thigh ? {x:0.12, y:0.06} : {x:0.06, y:-0.12};
        };
        const off = offset(partId.startsWith('thigh'));
        group.position.set(group.userData.origPos.x + off.x, group.userData.origPos.y + off.y, group.userData.origPos.z);
      } else {
        group.position.copy(group.userData.origPos);
      }
    } else {
      group.visible = false;
    }
  }
}
