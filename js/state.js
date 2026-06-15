// State Management
export const sessionCuts = [];
export const actionHistory = [];
export const legStates = { l: 'whole', r: 'whole' };
export let currentTool = 'select'; // 'select' or 'knife'
export let viewMode = '2d';       // '2d' or '3d'
export const severedParts = {};
export let isAnimating = false;

export let currentScalePartId = null;
export let currentScaleWeight = 0;
export let baseScaleWeight = 0;
export let isBoneless = false;
export let isSkinless = false;
export let selectedLegSide = null; // 'l' or 'r'
export let activeCutsListIdx = null;

export const PART_WEIGHTS = {
  back_upper: 200, back_lower: 180, breast_l: 255, breast_r: 255, neck: 115, wing_l: 95, wing_r: 95,
  thigh_l: 172, thigh_r: 172, leg_l: 148, leg_r: 148, leg_whole_l: 320, leg_whole_r: 320
};
export const PART_PRICES = {
  back_upper: 0.65, back_lower: 0.55, breast_l: 3.50, breast_r: 3.50, neck: 0.90, wing_l: 1.80, wing_r: 1.80,
  thigh_l: 2.20, thigh_r: 2.20, leg_l: 1.60, leg_r: 1.60, leg_whole_l: 3.80, leg_whole_r: 3.80
};

export const PART_INFO = {
  'back_upper|chicken': { name:'Ribs', weight:200, price:0.65, emoji:'🦴', tip:'Rib cage carcass. Rich bones for clean chicken broth.' },
  'back_lower|chicken': { name:'Lower Back', weight:180, price:0.55, emoji:'🍗', tip:'Lower back carcass bones. Excellent for soup stock.' },
  'breast_l|chicken': { name:'Breast', weight:255, price:3.50, tip:'Lean white breast meat.' },
  'breast_r|chicken': { name:'Breast', weight:255, price:3.50, tip:'Lean white breast meat.' },
  'neck|chicken': { name:'Neck', weight:115, price:0.90, tip:'Cartilage rich chicken neck stump.' },
  'wing_l|chicken': { name:'Wing', weight:95, price:1.80, tip:'Chicken wing (drumette & flat).' },
  'wing_r|chicken': { name:'Wing', weight:95, price:1.80, tip:'Chicken wing (drumette & flat).' },
  'thigh_l|chicken': { name:'Thigh', weight:172, price:2.20, tip:'Juicy chicken thigh.' },
  'thigh_r|chicken': { name:'Thigh', weight:172, price:2.20, tip:'Juicy chicken thigh.' },
  'leg_l|chicken': { name:'Drumstick', weight:148, price:1.60, tip:'Chicken drumstick leg.' },
  'leg_r|chicken': { name:'Drumstick', weight:148, price:1.60, tip:'Chicken drumstick leg.' },
  'leg_whole_l|chicken': { name:'Whole Leg', weight:320, price:3.80, tip:'Whole chicken leg.' },
  'leg_whole_r|chicken': { name:'Whole Leg', weight:320, price:3.80, tip:'Whole chicken leg.' },
};

export const OFFAL_DATA = [
  { n: 'Chicken Heart', w: 15, p: 0.50, e: '❤️' },
  { n: 'Chicken Liver', w: 45, p: 0.80, e: '🥩' },
  { n: 'Chicken Gizzard', w: 35, p: 0.60, e: '🥘' }
];

export function setViewModeState(val) { viewMode = val; }
export function setToolState(val) { currentTool = val; }
export function setIsAnimatingState(val) { isAnimating = val; }
export function setCurrentScalePartIdState(val) { currentScalePartId = val; }
export function setCurrentScaleWeightState(val) { currentScaleWeight = val; }
export function setSelectedLegSideState(val) { selectedLegSide = val; }
export function setBaseScaleWeightState(val) { baseScaleWeight = val; }
export function setIsBonelessState(val) { isBoneless = val; }
export function setIsSkinlessState(val) { isSkinless = val; }

// Current animal type
export let currentAnimal = 'chicken'; // 'chicken' or 'fish'
export function setCurrentAnimalState(val) { currentAnimal = val; }

// Fish data
export const FISH_PART_WEIGHTS = {
  fish_head: 140, fish_front: 180, fish_mid: 220, fish_back: 150, fish_tail: 60
};
export const FISH_PART_PRICES = {
  fish_head: 0.90, fish_front: 2.80, fish_mid: 3.20, fish_back: 1.50, fish_tail: 0.80
};
export const FISH_PART_INFO = {
  'fish_head|fish':  { name: 'Fish Head',      weight: 140, price: 0.90, emoji: '🐟', tip: 'Collagen-rich head, perfect for curry and broth.' },
  'fish_front|fish': { name: 'Front Steaks',   weight: 180, price: 2.80, emoji: '🐟', tip: 'Front shoulder steaks — firm, flavorful meat.' },
  'fish_mid|fish':   { name: 'Middle Steaks',  weight: 220, price: 3.20, emoji: '🐟', tip: 'Thickest middle section — the premium cut.' },
  'fish_back|fish':  { name: 'Back Steaks',    weight: 150, price: 1.50, emoji: '🐟', tip: 'Back section steaks — lean and tender.' },
  'fish_tail|fish':  { name: 'Tail Piece',     weight:  60, price: 0.80, emoji: '🐟', tip: 'Tail piece — great for frying or soup base.' },
};
export const FISH_OFFAL_DATA = [
  { n: 'Fish Roe',   w: 30, p: 1.20, e: '🟡' },
  { n: 'Fish Liver', w: 20, p: 0.80, e: '🟤' },
];

// Parts where "Boneless" doesn't make sense (mostly bone/cartilage already)
export const NO_BONELESS_PARTS = new Set([
  'wing_l', 'wing_r', 'back_upper', 'back_lower', 'neck', 'fish_head', 'fish_tail'
]);

