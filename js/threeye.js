// threeye.js — Custom Lightweight 3D Canvas Projection Engine

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  set(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    return this;
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  copy(v) {
    this.x = v.x; this.y = v.y; this.z = v.z;
    return this;
  }
  lerpVectors(v1, v2, t) {
    this.x = v1.x + (v2.x - v1.x) * t;
    this.y = v1.y + (v2.y - v1.y) * t;
    this.z = v1.z + (v2.z - v1.z) * t;
    return this;
  }
}

class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x; this.y = y;
  }
}

class Color {
  constructor(val) {
    this.set(val);
  }
  set(val) {
    if (typeof val === 'number') {
      this.hexStr = '#' + val.toString(16).padStart(6, '0');
    } else {
      this.hexStr = val;
    }
  }
  setHex(hex) {
    this.set(hex);
  }
}

class Euler {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  set(x, y, z) {
    this.x = x; this.y = y; this.z = z;
  }
}

class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.scale = new Vector3(1, 1, 1);
    this.children = [];
    this.visible = true;
    this.userData = {};
  }
  add(obj) {
    if (obj) {
      obj.parent = this;
      this.children.push(obj);
    }
  }
  traverse(cb) {
    cb(this);
    this.children.forEach(child => {
      if (child && typeof child.traverse === 'function') {
        child.traverse(cb);
      }
    });
  }
}

class Scene extends Object3D {
  constructor() {
    super();
    this.background = new Color(0xffffff);
  }
}

class Group extends Object3D {}

class SphereGeometry {
  constructor(radius = 1, widthSegments = 8, heightSegments = 6) {
    this.type = 'sphere';
    this.radius = radius;
  }
}

class CylinderGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 8) {
    this.type = 'cylinder';
    this.radiusTop = radiusTop;
    this.radiusBottom = radiusBottom;
    this.height = height;
  }
}

class MeshToonMaterial {
  constructor(params = {}) {
    this.color = new Color(params.color || 0xffffff);
    this.emissive = new Color(0x000000);
  }
}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.isMesh = true;
  }
}

class AmbientLight extends Object3D {
  constructor(color, intensity) {
    super();
  }
}

class DirectionalLight extends Object3D {
  constructor(color, intensity) {
    super();
    this.position = new Vector3();
  }
}

class PerspectiveCamera {
  constructor(fov, aspect, near, far) {
    this.position = new Vector3(0, 0, 5);
  }
  updateProjectionMatrix() {}
}

class Raycaster {
  constructor() {
    this.camera = null;
    this.mouse = null;
  }
  setFromCamera(mouse, camera) {
    this.mouse = mouse;
    this.camera = camera;
  }
  intersectObjects(objects) {
    if (!this.mouse || !window.renderer3) return [];
    
    const W = window.renderer3.width;
    const H = window.renderer3.height;
    
    // Convert NDC (-1 to 1) back to canvas coordinates
    const mx_canvas = ((this.mouse.x + 1) / 2) * W;
    const my_canvas = ((1 - this.mouse.y) / 2) * H;
    
    const hits = [];
    objects.forEach(mesh => {
      if (mesh.visible && mesh._lastScreenPos) {
        const dx = mx_canvas - mesh._lastScreenPos.x;
        const dy = my_canvas - mesh._lastScreenPos.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        let clickRadius = Math.max(mesh._lastScreenPos.rx, mesh._lastScreenPos.ry);
        if (mesh.geometry.type === 'cylinder') {
          clickRadius = mesh._lastScreenPos.rx * 1.5; // adjust for cylinder click accuracy
        }
        
        if (dist <= clickRadius) {
          hits.push({
            object: mesh,
            distance: mesh._lastScreenPos.z // use depth Z for distance
          });
        }
      }
    });
    
    // Sort closest depth first (i.e. highest z value)
    hits.sort((a, b) => b.distance - a.distance);
    return hits;
  }
}

// Color shader helpers
function darkenColor(hex, percent) {
  let num = parseInt(hex.replace("#",""), 16),
  amt = Math.round(2.55 * percent * 100),
  R = (num >> 16) - amt,
  G = (num >> 8 & 0x00FF) - amt,
  B = (num & 0x0000FF) - amt;
  return "#" + (0x1000000 + (R<0?0:R>255?255:R)*0x10000 + (G<0?0:G>255?255:G)*0x100 + (B<0?0:B>255?255:B)).toString(16).slice(1);
}

// Escaping the # character in string formatters inside build script
function lightenColor(hex, percent) {
  let num = parseInt(hex.replace("#",""), 16),
  amt = Math.round(2.55 * percent * 100),
  R = (num >> 16) + amt,
  G = (num >> 8 & 0x00FF) + amt,
  B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R<0?0:R>255?255:R)*0x10000 + (G<0?0:G>255?255:G)*0x100 + (B<0?0:B>255?255:B)).toString(16).slice(1);
}

class WebGLRenderer {
  constructor(params = {}) {
    this.canvas = params.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    window.renderer3 = this; // store globally for raycaster
  }
  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }
  setPixelRatio() {}
  
  render(scene, camera) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    
    // Clear canvas with scene background
    ctx.fillStyle = scene.background.hexStr || '#DCD8D0';
    ctx.fillRect(0, 0, W, H);
    
    // Collect all visible meshes
    const meshes = [];
    scene.traverse(node => {
      if (node.isMesh && node.visible) {
        meshes.push(node);
      }
    });
    
    const cameraZ = 5.0;
    const fov = 350; // Perspective zoom
    
    meshes.forEach(mesh => {
      let rotY = 0;
      let parentPos = new Vector3();
      
      let p = mesh.parent;
      while (p) {
        rotY += p.rotation.y;
        parentPos.x += p.position.x;
        parentPos.y += p.position.y;
        parentPos.z += p.position.z;
        p = p.parent;
      }
      
      // Rotate local coords around parent's Y axis
      const lx = mesh.position.x;
      const ly = mesh.position.y;
      const lz = mesh.position.z;
      
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      
      const gx = lx * cosY - lz * sinY + parentPos.x;
      const gy = ly + parentPos.y;
      const gz = lx * sinY + lz * cosY + parentPos.z;
      
      // Project to 2D screen coords
      const scale = fov / (cameraZ - gz);
      const screenX = gx * scale + W / 2;
      const screenY = -gy * scale + H / 2;
      
      const meshScaleX = mesh.scale.x;
      const meshScaleY = mesh.scale.y;
      
      let rx = 0, ry = 0;
      if (mesh.geometry.type === 'sphere') {
        rx = mesh.geometry.radius * meshScaleX * scale;
        ry = mesh.geometry.radius * meshScaleY * scale;
      } else {
        rx = mesh.geometry.radiusBottom * meshScaleX * scale;
        ry = mesh.geometry.height * meshScaleY * scale;
      }
      
      mesh._lastScreenPos = {
        x: screenX,
        y: screenY,
        z: gz,
        rx: rx,
        ry: ry,
        scale: scale,
        rotY: rotY
      };
    });
    
    // Depth sorting (Z-buffer / Painter's Algorithm)
    meshes.sort((a, b) => a._lastScreenPos.z - b._lastScreenPos.z);
    
    // Draw meshes
    meshes.forEach(mesh => {
      const proj = mesh._lastScreenPos;
      const baseColor = mesh.material.color.hexStr;
      
      let glowHex = mesh.material.emissive.hexStr;
      let isGlowing = (glowHex !== '#000000' && glowHex !== '#000');
      
      ctx.save();
      
      if (mesh.geometry.type === 'sphere') {
        const rx = proj.rx;
        const ry = proj.ry;
        
        ctx.beginPath();
        ctx.ellipse(proj.x, proj.y, rx, ry, mesh.rotation.z, 0, 2 * Math.PI);
        
        let shadowColor = darkenColor(baseColor, 0.28);
        let highlightColor = lightenColor(baseColor, 0.38);
        
        if (isGlowing) {
          shadowColor = lightenColor(glowHex, 0.1);
          highlightColor = lightenColor(glowHex, 0.45);
        }
        
        const grad = ctx.createRadialGradient(
          proj.x - rx * 0.25, proj.y - ry * 0.25, Math.min(rx, ry) * 0.1,
          proj.x, proj.y, Math.max(rx, ry)
        );
        grad.addColorStop(0, highlightColor);
        grad.addColorStop(0.3, isGlowing ? glowHex : baseColor);
        grad.addColorStop(1, shadowColor);
        
        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;
        ctx.fill();
        
        ctx.strokeStyle = darkenColor(baseColor, 0.45);
        ctx.lineWidth = 1.8;
        ctx.stroke();
      } 
      else if (mesh.geometry.type === 'cylinder') {
        const rx = proj.rx;
        const ry = proj.ry;
        
        const cx = proj.x;
        const cy = proj.y;
        
        ctx.beginPath();
        ctx.translate(cx, cy);
        ctx.rotate(mesh.rotation.z);
        
        let shadowColor = darkenColor(baseColor, 0.28);
        let highlightColor = lightenColor(baseColor, 0.3);
        if (isGlowing) {
          shadowColor = lightenColor(glowHex, 0.1);
          highlightColor = lightenColor(glowHex, 0.45);
        }
        
        const grad = ctx.createLinearGradient(-rx, 0, rx, 0);
        grad.addColorStop(0, shadowColor);
        grad.addColorStop(0.3, isGlowing ? glowHex : baseColor);
        grad.addColorStop(1, shadowColor);
        
        ctx.fillStyle = grad;
        ctx.fillRect(-rx, -ry/2, rx*2, ry);
        
        ctx.beginPath();
        ctx.ellipse(0, -ry/2, rx, rx*0.35, 0, 0, 2*Math.PI);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.ellipse(0, ry/2, rx, rx*0.35, 0, 0, 2*Math.PI);
        ctx.fill();
        ctx.stroke();
        
        ctx.strokeStyle = darkenColor(baseColor, 0.45);
        ctx.lineWidth = 1.8;
        ctx.strokeRect(-rx, -ry/2, rx*2, ry);
      }
      
      ctx.restore();
    });
  }
}

// Bind to global scope
window.THREE = {
  Vector3, Vector2, Color, Euler, Object3D, Scene, Group,
  SphereGeometry, CylinderGeometry, MeshToonMaterial, Mesh,
  AmbientLight, DirectionalLight, PerspectiveCamera, WebGLRenderer, Raycaster
};
