// Cloudflare Worker: worker.js
// Serves static assets & handles APIs for Customer, Rider, Shop (Butcher), and Admin portals

const ADMIN_SECRET_KEY = "amorelot2026"; // Master Admin Secret Key (Emergency Fallback)

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key, Authorization",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };
}

// ── CRYPTO & AUTH HELPERS (PBKDF2 SHA-256) ──
function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const derived = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
  const exported = await crypto.subtle.exportKey("raw", derived);
  return Array.from(new Uint8Array(exported)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── RFC 6238 TOTP (GOOGLE AUTHENTICATOR ENGINE) ──
function base32ToBuf(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(base32).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0, index = 0;
  const output = new Uint8Array(Math.floor((clean.length * 5) / 8));
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return output;
}

function generateBase32Secret(length = 20) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += alphabet[bytes[i] % 32];
  }
  return str;
}

async function generateTOTPCode(secretBase32, timeStep) {
  const keyBuf = base32ToBuf(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw', keyBuf, { name: 'HMAC', hash: { name: 'SHA-1' } }, false, ['sign']
  );
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  const high = Math.floor(timeStep / 0x100000000);
  const low = timeStep % 0x100000000;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  const signature = await crypto.subtle.sign('HMAC', key, counterBuf);
  const sigBytes = new Uint8Array(signature);
  const offset = sigBytes[sigBytes.length - 1] & 0x0f;
  const binary =
    ((sigBytes[offset] & 0x7f) << 24) |
    ((sigBytes[offset + 1] & 0xff) << 16) |
    ((sigBytes[offset + 2] & 0xff) << 8) |
    (sigBytes[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

async function verifyTOTP(secretBase32, inputOtp, window = 1) {
  if (!secretBase32 || !inputOtp) return false;
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  const cleanInput = String(inputOtp).trim();
  for (let offset = -window; offset <= window; offset++) {
    const code = await generateTOTPCode(secretBase32, currentStep + offset);
    if (code === cleanInput) return true;
  }
  return false;
}

async function getAdminSessionDurationMs(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'admin_session_hours'").first();
    const hours = row ? parseFloat(row.value) || 4 : 4;
    return hours * 60 * 60 * 1000;
  } catch(e) {
    return 4 * 60 * 60 * 1000;
  }
}

async function sendEmailOtp(email, otp, env) {
  // If RESEND_API_KEY is configured in worker secrets, send live email
  if (env && env.RESEND_API_KEY) {
    try {
      const fromEmail = env.EMAIL_FROM || "Amorelot Security <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject: "🔐 Amorelot Executive Admin Login OTP",
          html: `
            <div style="font-family:sans-serif; max-width:480px; margin:0 auto; padding:24px; background:#0E1614; color:#FFFFFF; border-radius:12px; border:1px solid #20312B;">
              <h2 style="color:#FFB74D; margin-top:0;">🔐 Amorelot Executive Security</h2>
              <p style="color:#C0D2C8; font-size:15px;">You are logging in to the Amorelot Command Center.</p>
              <p style="color:#C0D2C8; font-size:14px;">Your 6-digit verification code is:</p>
              <div style="background:#14201C; border:1.5px solid #2ECC71; border-radius:8px; padding:16px; text-align:center; margin:20px 0;">
                <span style="font-family:monospace; font-size:32px; font-weight:800; letter-spacing:8px; color:#2ECC71;">${otp}</span>
              </div>
              <p style="color:#8E9F98; font-size:13px;">This code is valid for 5 minutes. Do not share this code with anyone.</p>
            </div>
          `
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error("Resend API failed:", res.status, errText);
        // Fail-safe: if Resend fails, fallback so admin is NEVER locked out
        return { devMode: true, sent: false, error: `Resend error (${res.status})` };
      }
      return { devMode: false, sent: true };
    } catch(e) {
      console.error("sendEmailOtp error:", e);
      return { devMode: true, sent: false, error: e.message };
    }
  }

  // Dev mode fallback: log to console & friendly notice
  console.log(`[AUTH-DEV] Generated Admin OTP for ${email}: ${otp}`);
  return { devMode: true, sent: false };
}

async function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  if (!token) {
    token = request.headers.get('X-Admin-Key') || new URL(request.url).searchParams.get('key');
  }
  if (!token) return null;

  // Master key fallback (emergency access)
  if (token === ADMIN_SECRET_KEY) {
    return { id: 'master', email: 'master@amorelot.com', full_name: 'Founder Master Admin', role: 'founder' };
  }

  // Check in admin_sessions
  try {
    const session = await env.DB.prepare(`
      SELECT s.token, s.expires_at, u.id, u.email, u.full_name, u.role
      FROM admin_sessions s
      JOIN admin_users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > ?
    `).bind(token, Date.now()).first();

    if (session) {
      return {
        id: session.id,
        email: session.email,
        full_name: session.full_name,
        role: session.role
      };
    }
  } catch(e) {
    console.error("verifyAdminAuth error:", e);
  }
  return null;
}

function isFounder(adminAuth) {
  if (!adminAuth) return false;
  return adminAuth.role === 'founder' || adminAuth.role === 'super_admin';
}

// ── SHOPKEEPER MERCHANT AUTHENTICATION ENGINE (0 SMS BILLS) ──
async function verifyShopAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  let token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
  if (!token) {
    token = request.headers.get('X-Shop-Token');
  }
  if (!token) {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/shop_session=([a-zA-Z0-9_\-]+)/);
    if (match) token = match[1];
  }
  if (!token) return null;

  try {
    const session = await env.DB.prepare(`
      SELECT s.token, s.expires_at, sh.id, sh.name, sh.owner_name, sh.phone, sh.email, sh.address, sh.category, sh.is_active, sh.approval_status
      FROM shop_sessions s
      JOIN shops sh ON s.shop_id = sh.id
      WHERE s.token = ? AND s.expires_at > ?
    `).bind(token, Date.now()).first();

    if (session && session.is_active == 1 && (session.approval_status === 'approved' || !session.approval_status)) {
      return session;
    }
  } catch(e) {
    console.warn("verifyShopAuth error:", e);
  }
  return null;
}

// ── ZERO-D1-WRITE STORE STATUS CONTROLLER (KV / EDGE CACHE) ──
let globalStoreIsOnline = true;

async function getStoreOnlineStatus(env) {
  // 1. Try Workers KV if bound (0 D1 reads, 0 D1 writes)
  if (env && env.STORE_KV) {
    try {
      const val = await env.STORE_KV.get('store_is_online');
      if (val !== null) return val !== '0';
    } catch(e) {}
  }
  // 2. Try Cache API (0 D1 reads, 0 D1 writes across edge isolates)
  try {
    const cache = caches.default;
    const cacheKey = new Request("https://higroces.internal/store-status");
    const cachedRes = await cache.match(cacheKey);
    if (cachedRes) {
      const data = await cachedRes.json();
      if (data && data.is_online !== undefined) {
        globalStoreIsOnline = data.is_online;
        return data.is_online;
      }
    }
  } catch(e) {}
  // 3. In-Memory Isolate State
  if (globalStoreIsOnline !== undefined) {
    return globalStoreIsOnline;
  }
  // 4. Fallback to D1 settings read (read-only fallback, 0 D1 writes)
  try {
    const row = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'store_is_online'").first();
    return row ? row.value !== '0' : true;
  } catch(e) {
    return true;
  }
}

async function setStoreOnlineStatus(isOnline, env) {
  globalStoreIsOnline = isOnline;

  // 1. If Workers KV is bound: write to KV ONLY (0 D1 writes!)
  if (env && env.STORE_KV) {
    try {
      await env.STORE_KV.put('store_is_online', isOnline ? '1' : '0');
      return { success: true, is_online: isOnline, storage: 'kv', d1_writes: 0 };
    } catch(e) {
      console.warn("STORE_KV write error:", e);
    }
  }

  // 2. If KV not bound, store in edge cache API + in-memory (0 D1 writes!)
  try {
    const cache = caches.default;
    const cacheKey = new Request("https://higroces.internal/store-status");
    const res = new Response(JSON.stringify({ is_online: isOnline, updated_at: Date.now() }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" }
    });
    await cache.put(cacheKey, res);
  } catch(e) {}

  return { success: true, is_online: isOnline, storage: 'edge_memory', d1_writes: 0 };
}

// ── HAVERSINE DISTANCE HELPER (KM) ──
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Auto-migration & Schema Initializer
async function ensureAllSchemas(db) {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT)`).run();
  } catch(e) {}

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        customer_name TEXT,
        customer_phone TEXT,
        delivery_address TEXT,
        delivery_zone TEXT,
        plan_type TEXT,
        plan_title TEXT,
        price_per_day REAL,
        frequency TEXT,
        status TEXT DEFAULT 'active',
        start_date TEXT,
        delivery_slot TEXT DEFAULT '6:30 AM - 7:30 AM',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  try { await db.prepare("ALTER TABLE orders ADD COLUMN delivery_otp TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'instant'").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE orders ADD COLUMN delivery_slot TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE orders ADD COLUMN cust_lat REAL").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE orders ADD COLUMN cust_lng REAL").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE orders ADD COLUMN shop_id TEXT").run(); } catch(e) {}

  // ── SHOPS / PARTNER HUBS TABLE ──
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS shops (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_name TEXT,
        phone TEXT,
        address TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        delivery_radius_km REAL DEFAULT 10.0,
        is_active INTEGER DEFAULT 1,
        category TEXT DEFAULT 'all',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  try { await db.prepare("ALTER TABLE shops ADD COLUMN category TEXT DEFAULT 'all'").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN email TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN passcode_hash TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN salt TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN password_hash TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN password_salt TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN reset_token TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN reset_expires INTEGER").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN approval_status TEXT DEFAULT 'approved'").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN fssai_number TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN upi_id TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN gstin TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN storefront_image TEXT").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE shops ADD COLUMN owner_id_proof TEXT").run(); } catch(e) {}

  // Shop Sessions Table (Merchant Login Sessions)
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS shop_sessions (
        token TEXT PRIMARY KEY,
        shop_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  // Auto-seed primary hub if shops table is empty
  try {
    const existingShops = await db.prepare("SELECT count(*) as count FROM shops").first();
    if (!existingShops || existingShops.count === 0) {
      await db.prepare(`
        INSERT INTO shops (id, name, owner_name, phone, address, latitude, longitude, delivery_radius_km, is_active, category, email, approval_status)
        VALUES ('shop_primary_hub', 'HSR Meat Hub & Dark Store', 'Hemanth Poreddy', '+91 9876543210', 'HSR Layout, Sector 2, Bengaluru', 17.987000, 79.535900, 10.0, 1, 'meat', 'hub@amorelot.com', 'approved')
      `).run();
    }
  } catch(e) {}

  // Auto-categorize known shops if still generic 'all'
  try {
    await db.prepare("UPDATE shops SET category = 'grocery' WHERE name LIKE '%kiranam%' AND (category IS NULL OR category = 'all')").run();
    await db.prepare("UPDATE shops SET category = 'meat' WHERE (name LIKE '%meat%' OR name LIKE '%butcher%') AND (category IS NULL OR category = 'all')").run();
    await db.prepare("UPDATE shops SET approval_status = 'approved' WHERE approval_status IS NULL").run();
  } catch(e) {}

  // Auto-seed initial 6-digit merchant passcodes ('123456') and Master Passwords for existing shops if unassigned
  try {
    const s1 = await db.prepare("SELECT passcode_hash, password_hash FROM shops WHERE id = 'shop_primary_hub'").first();
    if (!s1 || !s1.passcode_hash || !s1.password_hash) {
      const salt1 = generateSalt();
      const pSalt1 = generateSalt();
      const hash1 = await hashPassword('123456', salt1);
      const pHash1 = await hashPassword('Hub@123456', pSalt1);
      await db.prepare(`
        UPDATE shops 
        SET email = 'hub@amorelot.com', passcode_hash = ?, salt = ?, password_hash = ?, password_salt = ?, approval_status = 'approved' 
        WHERE id = 'shop_primary_hub'
      `).bind(hash1, salt1, pHash1, pSalt1).run();
    }
    const s2 = await db.prepare("SELECT passcode_hash, password_hash FROM shops WHERE id = 'shop_84917e65'").first();
    if (!s2 || !s2.passcode_hash || !s2.password_hash) {
      const salt2 = generateSalt();
      const pSalt2 = generateSalt();
      const hash2 = await hashPassword('123456', salt2);
      const pHash2 = await hashPassword('Balaji@123456', pSalt2);
      await db.prepare(`
        UPDATE shops 
        SET email = 'balaji@higroces.com', passcode_hash = ?, salt = ?, password_hash = ?, password_salt = ?, approval_status = 'approved' 
        WHERE id = 'shop_84917e65'
      `).bind(hash2, salt2, pHash2, pSalt2).run();
    }
  } catch(e) {}

  // Product Inventory Table (Stock, Merchant Custom Pricing & Discounts)
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS product_inventory (
        product_id TEXT PRIMARY KEY,
        is_in_stock INTEGER DEFAULT 1,
        custom_price REAL,
        discount_percent REAL DEFAULT 0,
        discount_price REAL,
        is_discount_active INTEGER DEFAULT 0,
        auto_clearance_enabled INTEGER DEFAULT 0,
        max_clearance_qty INTEGER,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  // Safe schema migrations for existing database
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN custom_price REAL").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN discount_percent REAL DEFAULT 0").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN discount_price REAL").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN is_discount_active INTEGER DEFAULT 0").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN auto_clearance_enabled INTEGER DEFAULT 0").run(); } catch(e) {}
  try { await db.prepare("ALTER TABLE product_inventory ADD COLUMN max_clearance_qty INTEGER").run(); } catch(e) {}

  // ── ENTERPRISE ADMIN AUTH TABLES ──
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT DEFAULT 'super_admin',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  try { await db.prepare("ALTER TABLE admin_users ADD COLUMN totp_secret TEXT").run(); } catch(e) {}

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_otps (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        otp_code TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0,
        is_used INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

  // Initialize feature flags & Dark Store defaults
  try {
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('feature_fresh_tmrw', '0')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('feature_subscriptions', '0')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dark_store_name', 'HSR Meat Hub & Dark Store')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dark_store_lat', '12.9121')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('dark_store_lng', '77.6408')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('smart_recommendation_mode', 'auto')").run();
  } catch(e) {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!env.DB) {
      if (url.pathname.startsWith('/api/')) {
        return new Response(JSON.stringify({ 
          error: "Cloudflare D1 is not bound (env.DB is missing)." 
        }), { status: 500, headers: corsHeaders() });
      }
    } else {
      await ensureAllSchemas(env.DB);
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/admin/auth/* (Executive Admin Email + Password + OTP)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/admin/auth/status") {
      try {
        const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM admin_users").first();
        const count = countRes ? (countRes.count || 0) : 0;
        return new Response(JSON.stringify({ hasAdmin: count > 0, count }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/setup" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, password, full_name, setup_key } = body;
        if (!email || !password || !full_name) {
          return new Response(JSON.stringify({ error: "Full Name, email, and password are required." }), { status: 400, headers: corsHeaders() });
        }
        if (setup_key !== ADMIN_SECRET_KEY) {
          return new Response(JSON.stringify({ error: "Invalid master setup key. Emergency master key required to register a Founder Admin." }), { status: 403, headers: corsHeaders() });
        }
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        const newId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO admin_users (id, email, full_name, password_hash, salt, role)
          VALUES (?, ?, ?, ?, ?, 'founder')
        `).bind(newId, email.toLowerCase().trim(), full_name.trim(), hash, salt).run();

        return new Response(JSON.stringify({ success: true, message: "Founder Admin (Founding Titan) account created successfully!" }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/login-step1" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, password, method } = body;
        if (!email || !password) {
          return new Response(JSON.stringify({ error: "Email and password are required." }), { status: 400, headers: corsHeaders() });
        }
        const cleanEmail = email.toLowerCase().trim();
        const user = await env.DB.prepare("SELECT * FROM admin_users WHERE email = ?").bind(cleanEmail).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Invalid email or password." }), { status: 401, headers: corsHeaders() });
        }
        const testHash = await hashPassword(password, user.salt);
        if (testHash !== user.password_hash) {
          return new Response(JSON.stringify({ error: "Invalid email or password." }), { status: 401, headers: corsHeaders() });
        }

        // Mask email: h***@domain.com
        const parts = user.email.split('@');
        const masked = parts[0].length <= 2 ? parts[0] + '***@' + parts[1] : parts[0][0] + '***' + parts[0].slice(-1) + '@' + parts[1];
        const hasTotp = !!(user.totp_secret && user.totp_secret.trim().length > 0);

        // ── METHOD A: GOOGLE AUTHENTICATOR (ZERO EMAILS SENT) ──
        if (method === 'totp') {
          if (!hasTotp) {
            return new Response(JSON.stringify({ error: "Google Authenticator is not linked to this account yet. Please use 'Send Code to Email' to log in." }), { status: 400, headers: corsHeaders() });
          }
          return new Response(JSON.stringify({
            success: true,
            method: 'totp',
            hasTotp: true,
            message: "Enter the 6-digit code from your Google Authenticator app",
            maskedEmail: masked
          }), { headers: corsHeaders() });
        }

        // ── METHOD B: EMAIL OTP (RESEND) ──
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpId = crypto.randomUUID();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
        await env.DB.prepare(`
          INSERT INTO admin_otps (id, email, otp_code, expires_at, attempts, is_used)
          VALUES (?, ?, ?, ?, 0, 0)
        `).bind(otpId, user.email, otpCode, expiresAt).run();

        // Send OTP via Resend or log
        const emailResult = await sendEmailOtp(user.email, otpCode, env);

        return new Response(JSON.stringify({
          success: true,
          method: 'email',
          message: `6-digit security code sent to ${masked}`,
          maskedEmail: masked,
          hasTotp,
          devMode: emailResult.devMode,
          debugOtp: emailResult.devMode ? otpCode : undefined,
          emailError: emailResult.error
        }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/verify-otp" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, otp } = body;
        if (!email || !otp) {
          return new Response(JSON.stringify({ error: "Email and OTP are required." }), { status: 400, headers: corsHeaders() });
        }
        const cleanEmail = email.toLowerCase().trim();
        const cleanOtp = String(otp).trim();

        const user = await env.DB.prepare("SELECT id, email, full_name, role, totp_secret FROM admin_users WHERE email = ?").bind(cleanEmail).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Administrator account not found." }), { status: 404, headers: corsHeaders() });
        }

        let authPassed = false;
        let authMethod = 'email_otp';

        // 1. Check Google Authenticator (TOTP) if enabled for this user
        if (user.totp_secret && user.totp_secret.trim().length > 0) {
          const isTotp = await verifyTOTP(user.totp_secret, cleanOtp);
          if (isTotp) {
            authPassed = true;
            authMethod = 'totp';
          }
        }

        // 2. If TOTP didn't pass, verify Email OTP from admin_otps
        if (!authPassed) {
          const record = await env.DB.prepare(`
            SELECT * FROM admin_otps WHERE email = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1
          `).bind(cleanEmail).first();

          if (record) {
            if (Date.now() <= record.expires_at && record.attempts < 3) {
              if (record.otp_code === cleanOtp) {
                authPassed = true;
                authMethod = 'email_otp';
                await env.DB.prepare("UPDATE admin_otps SET is_used = 1 WHERE id = ?").bind(record.id).run();
              } else {
                await env.DB.prepare("UPDATE admin_otps SET attempts = attempts + 1 WHERE id = ?").bind(record.id).run();
              }
            }
          }
        }

        if (!authPassed) {
          return new Response(JSON.stringify({ error: "Invalid code. Please check your Google Authenticator app or email." }), { status: 400, headers: corsHeaders() });
        }

        // Session creation with configurable session duration
        const durationMs = await getAdminSessionDurationMs(env);
        const token = crypto.randomUUID() + "-" + crypto.randomUUID();
        const expiresAt = Date.now() + durationMs;

        await env.DB.prepare(`
          INSERT INTO admin_sessions (token, user_id, expires_at)
          VALUES (?, ?, ?)
        `).bind(token, user.id, expiresAt).run();

        return new Response(JSON.stringify({
          success: true,
          token,
          authMethod,
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role
          }
        }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/logout" && request.method === "POST") {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : request.headers.get('X-Admin-Key');
        if (token) {
          await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/verify-session") {
      try {
        const adminAuth = await verifyAdminAuth(request, env);
        if (!adminAuth) {
          return new Response(JSON.stringify({ valid: false }), { status: 401, headers: corsHeaders() });
        }
        return new Response(JSON.stringify({ valid: true, user: adminAuth }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // Console Lock Screen Unlock (Password Verification on Refresh)
    if (url.pathname === "/api/admin/auth/unlock" && request.method === "POST") {
      try {
        const adminAuth = await verifyAdminAuth(request, env);
        if (!adminAuth) {
          return new Response(JSON.stringify({ error: "Session expired or invalid. Please sign in again." }), { status: 401, headers: corsHeaders() });
        }
        const body = await request.json();
        const { password } = body;
        if (!password) {
          return new Response(JSON.stringify({ error: "Password is required to unlock." }), { status: 400, headers: corsHeaders() });
        }
        if (adminAuth.id === 'master') {
          if (password === ADMIN_SECRET_KEY) {
            return new Response(JSON.stringify({ success: true, user: adminAuth }), { headers: corsHeaders() });
          }
          return new Response(JSON.stringify({ error: "Incorrect password." }), { status: 401, headers: corsHeaders() });
        }
        const user = await env.DB.prepare("SELECT * FROM admin_users WHERE id = ?").bind(adminAuth.id).first();
        if (!user) {
          return new Response(JSON.stringify({ error: "Admin user not found." }), { status: 404, headers: corsHeaders() });
        }
        const testHash = await hashPassword(password, user.salt);
        if (testHash !== user.password_hash) {
          return new Response(JSON.stringify({ error: "Incorrect password." }), { status: 401, headers: corsHeaders() });
        }
        return new Response(JSON.stringify({ success: true, user: adminAuth }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ── GOOGLE AUTHENTICATOR (TOTP) SETUP & MANAGEMENT ──
    if (url.pathname === "/api/admin/auth/totp/setup" && request.method === "POST") {
      try {
        const adminAuth = await verifyAdminAuth(request, env);
        if (!adminAuth) {
          return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
        }
        const secret = generateBase32Secret(20);
        const issuer = "Amorelot";
        const label = `${issuer}:${adminAuth.email}`;
        const otpauth_url = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
        return new Response(JSON.stringify({ success: true, secret, otpauth_url, email: adminAuth.email }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/totp/verify-setup" && request.method === "POST") {
      try {
        const adminAuth = await verifyAdminAuth(request, env);
        if (!adminAuth) {
          return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
        }
        const body = await request.json();
        const { secret, code } = body;
        if (!secret || !code) {
          return new Response(JSON.stringify({ error: "Secret and 6-digit confirmation code are required." }), { status: 400, headers: corsHeaders() });
        }
        const isValid = await verifyTOTP(secret, code);
        if (!isValid) {
          return new Response(JSON.stringify({ error: "Incorrect 6-digit code. Please verify the time on your phone and try again." }), { status: 400, headers: corsHeaders() });
        }
        await env.DB.prepare("UPDATE admin_users SET totp_secret = ? WHERE id = ?").bind(secret, adminAuth.id).run();
        return new Response(JSON.stringify({ success: true, message: "Google Authenticator 2FA activated successfully!" }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/totp/reset" && request.method === "POST") {
      try {
        const adminAuth = await verifyAdminAuth(request, env);
        if (!adminAuth) {
          return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
        }
        const body = await request.json();
        const targetId = body.target_id || adminAuth.id;
        if (targetId !== adminAuth.id && !isFounder(adminAuth)) {
          return new Response(JSON.stringify({ error: "Permission denied: Only Founder Admins can reset 2FA for team members." }), { status: 403, headers: corsHeaders() });
        }
        await env.DB.prepare("UPDATE admin_users SET totp_secret = NULL WHERE id = ?").bind(targetId).run();
        return new Response(JSON.stringify({ success: true, message: "Authenticator 2FA has been reset." }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ── TEAM & MULTI-ADMIN MANAGEMENT ──
    if (url.pathname === "/api/admin/team") {
      const adminAuth = await verifyAdminAuth(request, env);
      if (!adminAuth) {
        return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
      }

      if (!isFounder(adminAuth)) {
        return new Response(JSON.stringify({ error: "Access denied: Only Founder Admins can view or manage executive team members." }), { status: 403, headers: corsHeaders() });
      }

      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT id, email, full_name, role, (totp_secret IS NOT NULL AND length(totp_secret) > 0) AS has_totp, created_at FROM admin_users ORDER BY created_at DESC").all();
          return new Response(JSON.stringify({ admins: rows.results || [] }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { email, password, full_name, role } = body;
          if (!email || !password || !full_name) {
            return new Response(JSON.stringify({ error: "Name, email, and initial password are required." }), { status: 400, headers: corsHeaders() });
          }
          const cleanEmail = email.toLowerCase().trim();
          const salt = generateSalt();
          const hash = await hashPassword(password, salt);
          const newId = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO admin_users (id, email, full_name, password_hash, salt, role)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(newId, cleanEmail, full_name.trim(), hash, salt, role || 'ops_admin').run();

          return new Response(JSON.stringify({ success: true, id: newId }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: "An admin with this email already exists." }), { status: 409, headers: corsHeaders() });
        }
      }

      if (request.method === "DELETE") {
        try {
          const targetId = url.searchParams.get('id');
          if (targetId === adminAuth.id) {
            return new Response(JSON.stringify({ error: "You cannot delete your own admin account." }), { status: 400, headers: corsHeaders() });
          }
          await env.DB.prepare("DELETE FROM admin_sessions WHERE user_id = ?").bind(targetId).run();
          await env.DB.prepare("DELETE FROM admin_users WHERE id = ?").bind(targetId).run();
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/store/status (Online / Offline Toggle for Butcher/Shop)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/store/status") {
      if (request.method === "GET") {
        const isOnline = await getStoreOnlineStatus(env);
        return new Response(JSON.stringify({ is_online: isOnline, d1_writes: 0 }), { headers: corsHeaders() });
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();
          const isOnline = body.is_online === true || body.is_online === 1 || body.is_online === '1';
          const result = await setStoreOnlineStatus(isOnline, env);
          return new Response(JSON.stringify(result), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/settings (Feature Flags & Dark Store Hub Coordinates)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/settings") {
      // GET: Public settings (Customer & Rider apps read these)
      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT * FROM system_settings").all();
          const isOnline = await getStoreOnlineStatus(env);
          const settings = {
            feature_fresh_tmrw: false,
            feature_subscriptions: false,
            store_is_online: isOnline,
            admin_session_hours: 4,
            dark_store_name: "HSR Meat Hub & Dark Store",
            dark_store_lat: "12.9121",
            dark_store_lng: "77.6408",
            smart_recommendation_mode: "auto"
          };
          (rows.results || []).forEach(r => {
            if (r.key === 'feature_fresh_tmrw') settings.feature_fresh_tmrw = r.value === '1';
            if (r.key === 'feature_subscriptions') settings.feature_subscriptions = r.value === '1';
            if (r.key === 'admin_session_hours') settings.admin_session_hours = parseFloat(r.value) || 4;
            if (r.key === 'dark_store_name' && r.value) settings.dark_store_name = r.value;
            if (r.key === 'dark_store_lat' && r.value) settings.dark_store_lat = r.value;
            if (r.key === 'dark_store_lng' && r.value) settings.dark_store_lng = r.value;
            if (r.key === 'smart_recommendation_mode' && r.value) settings.smart_recommendation_mode = r.value;
          });
          return new Response(JSON.stringify(settings), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Admin updates settings (Feature flags & Dark Store GPS)
      if (request.method === "POST") {
        try {
          const adminAuth = await verifyAdminAuth(request, env);
          if (!adminAuth || !isFounder(adminAuth)) {
            return new Response(JSON.stringify({ error: "Access denied: Only Founder Admins can modify global settings and dark store GPS coordinates." }), { status: 403, headers: corsHeaders() });
          }
          const body = await request.json();
          if (body.store_is_online !== undefined) {
            await setStoreOnlineStatus(body.store_is_online === true || body.store_is_online === 1, env);
          }
          if (body.admin_session_hours !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('admin_session_hours', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(String(body.admin_session_hours)).run();
          }
          if (body.feature_fresh_tmrw !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('feature_fresh_tmrw', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(body.feature_fresh_tmrw ? '1' : '0').run();
          }
          if (body.feature_subscriptions !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('feature_subscriptions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(body.feature_subscriptions ? '1' : '0').run();
          }
          if (body.dark_store_name !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('dark_store_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(String(body.dark_store_name)).run();
          }
          if (body.dark_store_lat !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('dark_store_lat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(String(body.dark_store_lat)).run();
          }
          if (body.dark_store_lng !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('dark_store_lng', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(String(body.dark_store_lng)).run();
          }
          if (body.smart_recommendation_mode !== undefined) {
            await env.DB.prepare("INSERT INTO system_settings (key, value) VALUES ('smart_recommendation_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
              .bind(String(body.smart_recommendation_mode)).run();
          }
          return new Response(JSON.stringify({ success: true, settings: body }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/inventory (Real-time Stock, Price & Discount Management)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/inventory") {
      // GET: Returns map of { [productId]: boolean } AND rich items object
      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare(`
            SELECT product_id, is_in_stock, custom_price, discount_percent, discount_price, is_discount_active, auto_clearance_enabled, max_clearance_qty 
            FROM product_inventory
          `).all();
          const inventory = {};
          const items = {};
          (rows.results || []).forEach(r => {
            inventory[r.product_id] = r.is_in_stock === 1;
            items[r.product_id] = {
              product_id: r.product_id,
              is_in_stock: r.is_in_stock === 1,
              custom_price: (r.custom_price !== null && r.custom_price !== undefined) ? Number(r.custom_price) : null,
              discount_percent: Number(r.discount_percent || 0),
              discount_price: (r.discount_price !== null && r.discount_price !== undefined) ? Number(r.discount_price) : null,
              is_discount_active: r.is_discount_active === 1,
              auto_clearance_enabled: r.auto_clearance_enabled === 1,
              max_clearance_qty: r.max_clearance_qty ? Number(r.max_clearance_qty) : null
            };
          });
          return new Response(JSON.stringify({ inventory, items }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Shopkeeper or Admin updates item stock, retail price & discounts
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { product_id, is_in_stock, custom_price, discount_percent, discount_price, is_discount_active, auto_clearance_enabled, max_clearance_qty } = body;
          if (!product_id) {
            return new Response(JSON.stringify({ error: "product_id is required" }), { status: 400, headers: corsHeaders() });
          }

          // Fetch current row if present to retain unedited values
          const existing = await env.DB.prepare("SELECT * FROM product_inventory WHERE product_id = ?").bind(product_id).first();

          const stockVal = is_in_stock !== undefined 
            ? ((is_in_stock === false || is_in_stock === 0 || is_in_stock === '0') ? 0 : 1)
            : (existing ? existing.is_in_stock : 1);

          const priceVal = custom_price !== undefined 
            ? (custom_price !== null && custom_price !== '' ? Number(custom_price) : null) 
            : (existing ? existing.custom_price : null);

          const discPctVal = discount_percent !== undefined 
            ? Number(discount_percent || 0) 
            : (existing ? existing.discount_percent : 0);

          const discPriceVal = discount_price !== undefined 
            ? (discount_price !== null && discount_price !== '' ? Number(discount_price) : null) 
            : (existing ? existing.discount_price : null);

          const isDiscActiveVal = is_discount_active !== undefined 
            ? (is_discount_active ? 1 : 0) 
            : (existing ? existing.is_discount_active : 0);

          const autoClearanceVal = auto_clearance_enabled !== undefined 
            ? (auto_clearance_enabled ? 1 : 0) 
            : (existing ? existing.auto_clearance_enabled : 0);

          const maxQtyVal = max_clearance_qty !== undefined 
            ? (max_clearance_qty ? Number(max_clearance_qty) : null) 
            : (existing ? existing.max_clearance_qty : null);

          await env.DB.prepare(`
            INSERT INTO product_inventory (product_id, is_in_stock, custom_price, discount_percent, discount_price, is_discount_active, auto_clearance_enabled, max_clearance_qty, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(product_id) DO UPDATE SET 
              is_in_stock = excluded.is_in_stock,
              custom_price = excluded.custom_price,
              discount_percent = excluded.discount_percent,
              discount_price = excluded.discount_price,
              is_discount_active = excluded.is_discount_active,
              auto_clearance_enabled = excluded.auto_clearance_enabled,
              max_clearance_qty = excluded.max_clearance_qty,
              updated_at = datetime('now')
          `).bind(product_id, stockVal, priceVal, discPctVal, discPriceVal, isDiscActiveVal, autoClearanceVal, maxQtyVal).run();

          return new Response(JSON.stringify({ 
            success: true, 
            product_id, 
            is_in_stock: stockVal === 1,
            custom_price: priceVal,
            discount_percent: discPctVal,
            discount_price: discPriceVal,
            is_discount_active: isDiscActiveVal === 1,
            auto_clearance_enabled: autoClearanceVal === 1,
            max_clearance_qty: maxQtyVal
          }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/shops (Partner Shops & Dark Store Hubs)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/shops") {
      // GET: List all shops (Optionally with aggregated orders & revenue metrics, or pending applications)
      if (request.method === "GET") {
        try {
          const withPending = url.searchParams.get('pending') === 'true';
          if (withPending) {
            const adminAuth = await verifyAdminAuth(request, env);
            if (!adminAuth) {
              return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { status: 401, headers: corsHeaders() });
            }
            const res = await env.DB.prepare("SELECT * FROM shops WHERE approval_status = 'pending' ORDER BY datetime(created_at) DESC").all();
            return new Response(JSON.stringify({ 
              shops: res.results || [], 
              pendingShops: res.results || [],
              count: (res.results || []).length
            }), { headers: corsHeaders() });
          }

          const withReports = url.searchParams.get('reports') === 'true';
          if (withReports) {
            const adminAuth = await verifyAdminAuth(request, env);
            if (!adminAuth) {
              return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { status: 401, headers: corsHeaders() });
            }
            const res = await env.DB.prepare(`
              SELECT 
                s.id, s.name, s.owner_name, s.phone, s.email, s.address, s.latitude, s.longitude,
                s.delivery_radius_km, s.is_active, s.category, s.approval_status, s.created_at,
                COUNT(o.id) as total_orders,
                COALESCE(SUM(CASE WHEN o.status != 'cancelled' AND o.status != 'expired' THEN o.total_price ELSE 0 END), 0) as total_revenue,
                COUNT(CASE WHEN o.status = 'pending' OR o.status = 'preparing' OR o.status = 'packed' THEN 1 END) as active_orders,
                COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as delivered_orders
              FROM shops s
              LEFT JOIN orders o ON (o.shop_id = s.id OR (o.shop_id IS NULL AND s.id = 'shop_primary_hub'))
              WHERE s.approval_status != 'pending' OR s.approval_status IS NULL
              GROUP BY s.id
              ORDER BY s.created_at DESC
            `).all();

            const pendingCountRow = await env.DB.prepare("SELECT COUNT(*) as count FROM shops WHERE approval_status = 'pending'").first();

            return new Response(JSON.stringify({ 
              shops: res.results || [],
              pendingCount: pendingCountRow ? pendingCountRow.count : 0
            }), { headers: corsHeaders() });
          }

          // Public storefront & riders query: ONLY return active and approved shops
          const res = await env.DB.prepare(`
            SELECT id, name, owner_name, phone, address, latitude, longitude, delivery_radius_km, is_active, category, created_at 
            FROM shops 
            WHERE is_active = 1 AND (approval_status IS NULL OR approval_status = 'approved') 
            ORDER BY created_at DESC
          `).all();
          return new Response(JSON.stringify({ shops: res.results || [] }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Admin creates a new partner shop
      if (request.method === "POST") {
        try {
          const adminAuth = await verifyAdminAuth(request, env);
          if (!adminAuth) {
            return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { status: 401, headers: corsHeaders() });
          }

          const body = await request.json();
          const { name, owner_name, phone, address, latitude, longitude, delivery_radius_km, is_active, category, email, passcode, password } = body;

          if (!name || latitude === undefined || longitude === undefined) {
            return new Response(JSON.stringify({ error: "Shop Name, Latitude, and Longitude are required." }), { status: 400, headers: corsHeaders() });
          }

          const id = 'shop_' + crypto.randomUUID().slice(0, 8);
          const lat = Number(latitude);
          const lng = Number(longitude);
          const radius = Number(delivery_radius_km) || 10.0;
          const active = (is_active === false || is_active === 0 || is_active === '0') ? 0 : 1;
          const cat = (category === 'grocery' || category === 'meat') ? category : 'all';
          const emailVal = (email || '').toLowerCase().trim();

          let hash = null;
          let salt = null;
          if (passcode && String(passcode).trim()) {
            salt = generateSalt();
            hash = await hashPassword(String(passcode).trim(), salt);
          }

          let pHash = null;
          let pSalt = null;
          if (password && String(password).trim()) {
            pSalt = generateSalt();
            pHash = await hashPassword(String(password).trim(), pSalt);
          }

          await env.DB.prepare(`
            INSERT INTO shops (
              id, name, owner_name, phone, address, latitude, longitude, 
              delivery_radius_km, is_active, category, email, passcode_hash, salt, 
              password_hash, password_salt, approval_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
          `).bind(id, name.trim(), (owner_name || '').trim(), (phone || '').trim(), (address || '').trim(), lat, lng, radius, active, cat, emailVal, hash, salt, pHash, pSalt).run();

          return new Response(JSON.stringify({
            success: true,
            shop: { id, name, owner_name, phone, address, latitude: lat, longitude: lng, delivery_radius_km: radius, is_active: active, category: cat, email: emailVal }
          }), { status: 201, headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // PATCH: Admin updates an existing shop or approves pending application
      if (request.method === "PATCH") {
        try {
          const adminAuth = await verifyAdminAuth(request, env);
          if (!adminAuth) {
            return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { status: 401, headers: corsHeaders() });
          }

          const body = await request.json();
          const { id, name, owner_name, phone, address, latitude, longitude, delivery_radius_km, is_active, category, email, passcode, password, action } = body;

          if (!id) {
            return new Response(JSON.stringify({ error: "Shop ID is required for update." }), { status: 400, headers: corsHeaders() });
          }

          const existing = await env.DB.prepare("SELECT * FROM shops WHERE id = ?").bind(id).first();
          if (!existing) {
            return new Response(JSON.stringify({ error: "Shop not found." }), { status: 404, headers: corsHeaders() });
          }

          if (action === 'approve') {
            await env.DB.prepare("UPDATE shops SET approval_status = 'approved', is_active = 1 WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ success: true, approvedId: id, message: "Shop approved and activated successfully!" }), { headers: corsHeaders() });
          }

          const newName = name !== undefined ? name.trim() : existing.name;
          const newOwner = owner_name !== undefined ? owner_name.trim() : existing.owner_name;
          const newPhone = phone !== undefined ? phone.trim() : existing.phone;
          const newAddress = address !== undefined ? address.trim() : existing.address;
          const newLat = latitude !== undefined ? Number(latitude) : existing.latitude;
          const newLng = longitude !== undefined ? Number(longitude) : existing.longitude;
          const newRadius = delivery_radius_km !== undefined ? Number(delivery_radius_km) : existing.delivery_radius_km;
          const newActive = is_active !== undefined ? ((is_active === false || is_active === 0 || is_active === '0') ? 0 : 1) : existing.is_active;
          const newCategory = category !== undefined ? category : (existing.category || 'all');
          const newEmail = email !== undefined ? email.toLowerCase().trim() : existing.email;

          await env.DB.prepare(`
            UPDATE shops 
            SET name = ?, owner_name = ?, phone = ?, address = ?, latitude = ?, longitude = ?, delivery_radius_km = ?, is_active = ?, category = ?, email = ?
            WHERE id = ?
          `).bind(newName, newOwner, newPhone, newAddress, newLat, newLng, newRadius, newActive, newCategory, newEmail, id).run();

          // If admin resets or updates merchant daily counter passcode
          if (passcode && String(passcode).trim()) {
            const salt = generateSalt();
            const hash = await hashPassword(String(passcode).trim(), salt);
            await env.DB.prepare("UPDATE shops SET passcode_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, id).run();
          }

          // If admin resets or updates merchant master password
          if (password && String(password).trim()) {
            const pSalt = generateSalt();
            const pHash = await hashPassword(String(password).trim(), pSalt);
            await env.DB.prepare("UPDATE shops SET password_hash = ?, password_salt = ? WHERE id = ?").bind(pHash, pSalt, id).run();
          }

          return new Response(JSON.stringify({
            success: true,
            shop: { id, name: newName, owner_name: newOwner, phone: newPhone, address: newAddress, latitude: newLat, longitude: newLng, delivery_radius_km: newRadius, is_active: newActive, category: newCategory, email: newEmail }
          }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // DELETE: Admin removes a partner shop
      if (request.method === "DELETE") {
        try {
          const adminAuth = await verifyAdminAuth(request, env);
          if (!adminAuth) {
            return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { status: 401, headers: corsHeaders() });
          }

          const id = url.searchParams.get('id');
          if (!id) {
            return new Response(JSON.stringify({ error: "Shop ID is required." }), { status: 400, headers: corsHeaders() });
          }

          await env.DB.prepare("DELETE FROM shops WHERE id = ?").bind(id).run();
          await env.DB.prepare("DELETE FROM shop_sessions WHERE shop_id = ?").bind(id).run();
          return new Response(JSON.stringify({ success: true, deletedId: id }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/shop/auth/* (Two-Tier Merchant Authentication)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/shop/auth/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, passcode, password } = body;
        if (!email || (!passcode && !password)) {
          return new Response(JSON.stringify({ error: "Email and either Passcode or Password are required." }), { status: 400, headers: corsHeaders() });
        }

        const cleanEmail = email.toLowerCase().trim();
        const shop = await env.DB.prepare("SELECT * FROM shops WHERE LOWER(email) = ?").bind(cleanEmail).first();
        if (!shop) {
          return new Response(JSON.stringify({ error: "Invalid merchant credentials." }), { status: 401, headers: corsHeaders() });
        }

        if (shop.approval_status === 'pending') {
          return new Response(JSON.stringify({ error: "Your shop application is still under review by the admin." }), { status: 403, headers: corsHeaders() });
        }

        if (shop.approval_status === 'rejected' || shop.is_active == 0) {
          return new Response(JSON.stringify({ error: "This merchant account is currently inactive." }), { status: 403, headers: corsHeaders() });
        }

        let authenticated = false;
        let authMethod = 'passcode';

        // 1. Daily 6-digit counter passcode verification
        if (passcode && shop.passcode_hash && shop.salt) {
          const computedPasscode = await hashPassword(String(passcode).trim(), shop.salt);
          if (computedPasscode === shop.passcode_hash) {
            authenticated = true;
            authMethod = 'passcode';
          }
        }

        // 2. Master account password verification
        if (!authenticated && password) {
          const saltToUse = shop.password_salt || shop.salt;
          const hashToCompare = shop.password_hash || shop.passcode_hash;
          if (saltToUse && hashToCompare) {
            const computedPassword = await hashPassword(String(password).trim(), saltToUse);
            if (computedPassword === hashToCompare) {
              authenticated = true;
              authMethod = 'password';
            }
          }
        }

        if (!authenticated) {
          return new Response(JSON.stringify({ error: passcode ? "Incorrect 6-digit passcode." : "Incorrect password." }), { status: 401, headers: corsHeaders() });
        }

        const token = crypto.randomUUID();
        const expires_at = Date.now() + (30 * 24 * 3600 * 1000); // 30 days
        await env.DB.prepare("INSERT INTO shop_sessions (token, shop_id, expires_at) VALUES (?, ?, ?)").bind(token, shop.id, expires_at).run();

        const headers = corsHeaders();
        headers['Set-Cookie'] = `shop_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;

        return new Response(JSON.stringify({
          success: true,
          token,
          authMethod,
          shop: {
            id: shop.id,
            name: shop.name,
            owner_name: shop.owner_name,
            phone: shop.phone,
            email: shop.email,
            category: shop.category,
            address: shop.address
          }
        }), { headers });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // Forgot Password Endpoint
    if (url.pathname === "/api/shop/auth/forgot-password" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email } = body;
        if (!email) {
          return new Response(JSON.stringify({ error: "Email is required." }), { status: 400, headers: corsHeaders() });
        }
        const cleanEmail = email.toLowerCase().trim();
        const shop = await env.DB.prepare("SELECT id, name, email FROM shops WHERE LOWER(email) = ?").bind(cleanEmail).first();
        if (!shop) {
          return new Response(JSON.stringify({ success: true, message: "If a registered shop matches this email, a reset code has been sent." }), { headers: corsHeaders() });
        }

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + (15 * 60 * 1000); // 15 mins

        await env.DB.prepare("UPDATE shops SET reset_token = ?, reset_expires = ? WHERE id = ?").bind(resetCode, expiresAt, shop.id).run();

        if (env.RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "HiGroces Security <security@amorelot.com>",
              to: [cleanEmail],
              subject: "HiGroces Password Reset Code",
              html: `<div style="font-family:sans-serif; padding:20px; color:#111;">
                <h2>HiGroces Merchant Security</h2>
                <p>Your password reset code for store <strong>${shop.name}</strong> is:</p>
                <div style="font-size:2rem; font-weight:bold; letter-spacing:4px; color:#0C513F; margin:16px 0;">${resetCode}</div>
                <p>This code expires in 15 minutes. Note: Your daily counter 6-digit passcode remains unchanged.</p>
              </div>`
            })
          }).catch(err => console.warn("Resend email error:", err));
        }
        console.log(`[MERCHANT-DEV] Password Reset Code for ${cleanEmail}: ${resetCode}`);

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Verification code sent to ${cleanEmail}. Enter the code and choose a new password.`,
          devCode: (!env.RESEND_API_KEY) ? resetCode : undefined
        }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // Reset Password Endpoint
    if (url.pathname === "/api/shop/auth/reset-password" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, code, new_password } = body;
        if (!email || !code || !new_password) {
          return new Response(JSON.stringify({ error: "Email, reset code, and new password are required." }), { status: 400, headers: corsHeaders() });
        }
        if (String(new_password).trim().length < 6) {
          return new Response(JSON.stringify({ error: "New password must be at least 6 characters." }), { status: 400, headers: corsHeaders() });
        }
        const cleanEmail = email.toLowerCase().trim();
        const shop = await env.DB.prepare("SELECT id, reset_token, reset_expires FROM shops WHERE LOWER(email) = ?").bind(cleanEmail).first();
        if (!shop || !shop.reset_token || shop.reset_token !== String(code).trim()) {
          return new Response(JSON.stringify({ error: "Invalid or expired reset code." }), { status: 400, headers: corsHeaders() });
        }
        if (shop.reset_expires && Date.now() > shop.reset_expires) {
          return new Response(JSON.stringify({ error: "Reset code has expired. Please request a new code." }), { status: 400, headers: corsHeaders() });
        }

        const pSalt = generateSalt();
        const pHash = await hashPassword(String(new_password).trim(), pSalt);
        await env.DB.prepare("UPDATE shops SET password_hash = ?, password_salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?").bind(pHash, pSalt, shop.id).run();

        return new Response(JSON.stringify({ success: true, message: "Master Account Password updated successfully! You can now log in." }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/shop/auth/session") {
      try {
        const shopAuth = await verifyShopAuth(request, env);
        if (!shopAuth) {
          return new Response(JSON.stringify({ authenticated: false }), { headers: corsHeaders() });
        }
        return new Response(JSON.stringify({
          authenticated: true,
          shop: {
            id: shopAuth.id,
            name: shopAuth.name,
            owner_name: shopAuth.owner_name,
            phone: shopAuth.phone,
            email: shopAuth.email,
            category: shopAuth.category,
            address: shopAuth.address
          }
        }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/shop/auth/logout" && request.method === "POST") {
      try {
        const authHeader = request.headers.get('Authorization') || '';
        let token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
        if (!token) {
          const cookie = request.headers.get('Cookie') || '';
          const match = cookie.match(/shop_session=([a-zA-Z0-9_\-]+)/);
          if (match) token = match[1];
        }
        if (token) {
          await env.DB.prepare("DELETE FROM shop_sessions WHERE token = ?").bind(token).run();
        }
        const headers = corsHeaders();
        headers['Set-Cookie'] = `shop_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
        return new Response(JSON.stringify({ success: true, message: "Logged out" }), { headers });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/partner/apply (Public Partner Shop Onboarding Application)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/partner/apply" && request.method === "POST") {
      try {
        const body = await request.json();
        const { 
          name, owner_name, phone, email, password, passcode, category, address, 
          latitude, longitude, delivery_radius_km,
          fssai_number, upi_id, gstin, storefront_image, owner_id_proof 
        } = body;

        if (!name || !email || (!passcode && !password) || latitude === undefined || longitude === undefined) {
          return new Response(JSON.stringify({ error: "Shop Name, Email, Password, Passcode, Latitude, and Longitude are required." }), { status: 400, headers: corsHeaders() });
        }

        const passcodeStr = String(passcode || '').trim();
        if (passcodeStr && !/^\d{6}$/.test(passcodeStr)) {
          return new Response(JSON.stringify({ error: "Daily counter passcode must be exactly 6 numeric digits." }), { status: 400, headers: corsHeaders() });
        }

        const passwordStr = String(password || '').trim();
        if (passwordStr && passwordStr.length < 6) {
          return new Response(JSON.stringify({ error: "Master account password must be at least 6 characters." }), { status: 400, headers: corsHeaders() });
        }

        const existing = await env.DB.prepare("SELECT id FROM shops WHERE LOWER(email) = LOWER(?)").bind(email.trim()).first();
        if (existing) {
          return new Response(JSON.stringify({ error: "A partner shop with this login email is already registered." }), { status: 400, headers: corsHeaders() });
        }

        // Salt and hash 6-digit daily passcode
        const salt = generateSalt();
        const hash = passcodeStr ? await hashPassword(passcodeStr, salt) : null;

        // Salt and hash master account password
        const pSalt = generateSalt();
        const pHash = passwordStr ? await hashPassword(passwordStr, pSalt) : null;

        const id = 'shop_' + crypto.randomUUID().slice(0, 8);
        const lat = Number(latitude);
        const lng = Number(longitude);
        const radius = Number(delivery_radius_km) || 10.0;
        const cat = (category === 'grocery' || category === 'meat') ? category : 'all';

        await env.DB.prepare(`
          INSERT INTO shops (
            id, name, owner_name, phone, email, passcode_hash, salt, 
            password_hash, password_salt, category, address, latitude, 
            longitude, delivery_radius_km, is_active, approval_status, created_at,
            fssai_number, upi_id, gstin, storefront_image, owner_id_proof
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', datetime('now'), ?, ?, ?, ?, ?)
        `).bind(
          id, name.trim(), (owner_name || '').trim(), (phone || '').trim(), 
          email.toLowerCase().trim(), hash, salt, pHash, pSalt, cat, 
          (address || '').trim(), lat, lng, radius,
          (fssai_number || '').trim(), (upi_id || '').trim(), (gstin || '').trim().toUpperCase(), (storefront_image || ''), (owner_id_proof || '').trim()
        ).run();

        return new Response(JSON.stringify({
          success: true,
          message: "🎉 Partner application submitted successfully! Your shop profile has been placed in the Admin Verification Queue. Once approved, you can log in to your merchant portal at /shop."
        }), { status: 201, headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/subscriptions (Daily Repeat Engine)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/subscriptions") {
      // GET: List all subscriptions (Admin)
      if (request.method === "GET") {
        try {
          const res = await env.DB.prepare("SELECT * FROM subscriptions ORDER BY datetime(created_at) DESC LIMIT 100").all();
          return new Response(JSON.stringify({ subscriptions: res.results || [] }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Customer starts new subscription
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const id = crypto.randomUUID();
          await env.DB.prepare(`
            INSERT INTO subscriptions (
              id, customer_name, customer_phone, delivery_address, delivery_zone,
              plan_type, plan_title, price_per_day, frequency, status, start_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'))
          `).bind(
            id,
            body.customer_name || 'Subscriber',
            body.customer_phone || '',
            body.delivery_address || '',
            body.delivery_zone || 'HSR Layout',
            body.plan_type || 'gym_chicken_breast',
            body.plan_title || 'Gym Rat 30-Day Protein',
            Number(body.price_per_day) || 140,
            body.frequency || 'daily',
            body.start_date || new Date().toISOString().split('T')[0]
          ).run();

          return new Response(JSON.stringify({ success: true, id }), { status: 201, headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // PATCH: Admin / Customer pause or cancel subscription
      if (request.method === "PATCH") {
        try {
          const body = await request.json();
          const { id, status } = body;
          if (!id || !status) {
            return new Response(JSON.stringify({ error: "id and status required" }), { status: 400, headers: corsHeaders() });
          }
          await env.DB.prepare("UPDATE subscriptions SET status = ? WHERE id = ?").bind(status, id).run();
          return new Response(JSON.stringify({ success: true, id, status }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/mandi-sheet (Consolidated Wholesale Market List)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/mandi-sheet") {
      try {
        const scheduledOrders = await env.DB.prepare(`
          SELECT * FROM orders 
          WHERE order_type = 'fresh_tmrw' 
          AND status IN ('scheduled', 'pending', 'preparing')
          ORDER BY datetime(created_at) DESC
        `).all();

        const ordersList = scheduledOrders.results || [];
        const itemMap = {};

        ordersList.forEach(o => {
          const items = typeof o.items === 'string' ? JSON.parse(o.items || '[]') : (o.items || []);
          items.forEach(i => {
            const key = i.name;
            if (!itemMap[key]) {
              itemMap[key] = {
                name: i.name,
                unit: i.unit || 'kg',
                totalQty: 0,
                orderCount: 0,
                emoji: i.emoji || '🥬'
              };
            }
            itemMap[key].totalQty += (Number(i.qty) || 1);
            itemMap[key].orderCount += 1;
          });
        });

        return new Response(JSON.stringify({
          totalOrders: ordersList.length,
          mandiList: Object.values(itemMap)
        }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // API: /api/orders
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/orders") {
      // Auto-expire instant orders (pending > 30m, or uncompleted stuck orders > 45 minutes)
      try {
        await env.DB.prepare(`
          UPDATE orders 
          SET status = 'expired' 
          WHERE (order_type IS NULL OR order_type = 'instant')
          AND (
            (status = 'pending' AND datetime(created_at) < datetime('now', '-30 minutes'))
            OR
            (status IN ('preparing', 'packed', 'accepted') AND datetime(created_at) < datetime('now', '-45 minutes'))
          )
        `).run();
      } catch(e) {}

      // POST: Place a new order (Customer)
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const id = crypto.randomUUID();
          const itemsStr = typeof body.items === 'string' ? body.items : JSON.stringify(body.items || []);
          
          const order_type = body.order_type || 'instant';
          const delivery_slot = body.delivery_slot || (order_type === 'fresh_tmrw' ? 'Tomorrow Morning (6:30 AM - 8:00 AM)' : 'Instant (15 mins)');
          const initialStatus = order_type === 'fresh_tmrw' ? 'scheduled' : 'pending';

          // Generate 4-digit dynamic delivery OTP
          const delivery_otp = Math.floor(1000 + Math.random() * 9000).toString();

          const cust_lat = (body.cust_lat !== undefined && body.cust_lat !== null && body.cust_lat !== '') ? Number(body.cust_lat) : null;
          const cust_lng = (body.cust_lng !== undefined && body.cust_lng !== null && body.cust_lng !== '') ? Number(body.cust_lng) : null;
          let shop_id = (body.shop_id && String(body.shop_id).trim()) ? String(body.shop_id).trim() : null;

          // 🧠 Smart Shop Routing: If shop_id not provided by customer, auto-assign best eligible shop
          if (!shop_id) {
            try {
              let hasMeat = false;
              const parsedItems = typeof body.items === 'string' ? JSON.parse(body.items) : (body.items || []);
              hasMeat = parsedItems.some(it => {
                const n = (it.name || '').toLowerCase();
                const c = (it.category || '').toLowerCase();
                return c === 'chicken' || c === 'mutton' || c === 'fish' || c === 'meat' || c === 'custom' ||
                       n.includes('chicken') || n.includes('mutton') || n.includes('fish') || n.includes('meat') || n.includes('prawn');
              });

              const targetCat = hasMeat ? 'meat' : 'grocery';
              const shopRes = await env.DB.prepare("SELECT * FROM shops WHERE is_active = 1").all();
              const activeShops = shopRes.results || [];
              const eligible = activeShops.filter(s => s.category === 'all' || !s.category || s.category === targetCat);

              if (eligible.length > 0) {
                if (cust_lat && cust_lng) {
                  let closest = eligible[0];
                  let minD = Infinity;
                  for (const s of eligible) {
                    const d = haversineKm(cust_lat, cust_lng, s.latitude, s.longitude);
                    if (d < minD) {
                      minD = d;
                      closest = s;
                    }
                  }
                  shop_id = closest.id;
                } else {
                  shop_id = eligible[0].id;
                }
              }
            } catch(e) {}
          }

          if (!shop_id) {
            shop_id = 'shop_primary_hub';
          }

          await env.DB.prepare(`
            INSERT INTO orders (
              id, customer_name, customer_phone, delivery_address, 
              special_notes, items, subtotal, delivery_fee, total_price, 
              status, delivery_zone, delivery_otp, order_type, delivery_slot,
              cust_lat, cust_lng, shop_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).bind(
            id,
            body.customer_name || 'Customer',
            body.customer_phone || '',
            body.delivery_address || '',
            body.special_notes || '',
            itemsStr,
            Number(body.subtotal) || 0,
            Number(body.delivery_fee) || 0,
            Number(body.total_price) || 0,
            initialStatus,
            body.delivery_zone || 'HSR Layout',
            delivery_otp,
            order_type,
            delivery_slot,
            cust_lat,
            cust_lng,
            shop_id
          ).run();

          const created = { id, status: initialStatus, delivery_otp, order_type, delivery_slot, cust_lat, cust_lng, shop_id, ...body };
          return new Response(JSON.stringify({ success: true, order: created }), {
            status: 201,
            headers: corsHeaders()
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // GET: Query orders
      if (request.method === "GET") {
        try {
          const orderId = url.searchParams.get('orderId');
          const zone = url.searchParams.get('zone');
          const rider = url.searchParams.get('rider');
          const isShop = url.searchParams.get('shop') === 'true';
          const isAdmin = url.searchParams.get('admin') === 'true';

          // A. Admin Portal Query
          if (isAdmin) {
            const adminAuth = await verifyAdminAuth(request, env);
            if (!adminAuth) {
              return new Response(JSON.stringify({ error: "Unauthorized: Admin session required" }), { 
                status: 401, 
                headers: corsHeaders() 
              });
            }

            const shopFilter = url.searchParams.get('shop_id');
            let query = "SELECT * FROM orders";
            let params = [];
            if (shopFilter && shopFilter !== 'all') {
              query += " WHERE (shop_id = ? OR (shop_id IS NULL AND ? = 'shop_primary_hub'))";
              params.push(shopFilter, shopFilter);
            }
            query += " ORDER BY datetime(created_at) DESC LIMIT 100";

            const allOrdersRes = params.length > 0 
              ? await env.DB.prepare(query).bind(...params).all()
              : await env.DB.prepare(query).all();
            const allOrders = allOrdersRes.results || [];

            let totalRevenue = 0;
            let pendingCount = 0;
            let scheduledCount = 0;
            let preparingCount = 0;
            let inTransitCount = 0;
            let deliveredCount = 0;

            allOrders.forEach(o => {
              if (o.status !== 'cancelled' && o.status !== 'expired') {
                totalRevenue += Number(o.total_price) || 0;
              }
              if (o.status === 'scheduled') scheduledCount++;
              else if (o.status === 'pending') pendingCount++;
              else if (o.status === 'preparing' || o.status === 'packed') preparingCount++;
              else if (o.status === 'accepted') inTransitCount++;
              else if (o.status === 'delivered') deliveredCount++;
            });

            return new Response(JSON.stringify({
              orders: allOrders,
              stats: {
                totalOrders: allOrders.length,
                totalRevenue: Math.round(totalRevenue),
                pendingCount,
                scheduledCount,
                preparingCount,
                inTransitCount,
                deliveredCount
              }
            }), { headers: corsHeaders() });
          }

          // B. Customer Tracking Query
          if (orderId) {
            const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
            if (!order) {
              return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders() });
            }
            return new Response(JSON.stringify({ order }), { headers: corsHeaders() });
          }

          // C. Shop / Butcher Portal Query (Strict Merchant Privacy Lock)
          if (isShop) {
            const shopAuth = await verifyShopAuth(request, env);
            const adminAuth = await verifyAdminAuth(request, env);

            if (!shopAuth && !adminAuth) {
              return new Response(JSON.stringify({ error: "Unauthorized: Merchant login required", requireLogin: true }), { status: 401, headers: corsHeaders() });
            }

            let targetShopId = null;
            if (shopAuth) {
              // 🔒 STRICT PRIVACY LOCK: Shopkeeper can ONLY view orders belonging to their own shop!
              targetShopId = shopAuth.id;
            } else if (adminAuth) {
              targetShopId = url.searchParams.get('shop_id') || url.searchParams.get('shopId');
            }

            let shopQuery = `
              SELECT * FROM orders 
              WHERE status IN ('pending', 'preparing', 'packed', 'scheduled') 
              AND datetime(created_at) >= datetime('now', '-12 hours')
            `;
            let params = [];
            if (targetShopId && targetShopId !== 'all') {
              shopQuery += ` AND (shop_id = ? OR (shop_id IS NULL AND ? = 'shop_primary_hub'))`;
              params.push(targetShopId, targetShopId);
            } else if (zone && zone !== 'all') {
              shopQuery += ` AND delivery_zone = ?`;
              params.push(zone);
            }
            shopQuery += ` ORDER BY datetime(created_at) DESC LIMIT 50`;

            const res = params.length > 0 
              ? await env.DB.prepare(shopQuery).bind(...params).all()
              : await env.DB.prepare(shopQuery).all();

            return new Response(JSON.stringify({ orders: res.results || [] }), { headers: corsHeaders() });
          }

          // D. Rider Dashboard Query
          let pendingOrders = [];
          let activeOrders = [];

          if (zone) {
            const res = await env.DB.prepare(`
              SELECT * FROM orders 
              WHERE (status = 'pending' OR status = 'packed') 
              AND delivery_zone = ? 
              AND datetime(created_at) >= datetime('now', '-8 hours')
              ORDER BY datetime(created_at) DESC
            `).bind(zone).all();
            pendingOrders = (res.results || []).map(o => {
              const { delivery_otp, ...safe } = o;
              return safe;
            });
          }

          if (rider) {
            const res = await env.DB.prepare(`
              SELECT * FROM orders 
              WHERE status = 'accepted' AND rider_name = ? 
              ORDER BY datetime(created_at) DESC
            `).bind(rider).all();
            activeOrders = (res.results || []).map(o => {
              const { delivery_otp, ...safe } = o;
              return safe;
            });
          }

          return new Response(JSON.stringify({ pendingOrders, activeOrders }), { headers: corsHeaders() });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // PATCH: Update order status
      if (request.method === "PATCH") {
        try {
          const body = await request.json();
          const { id, status, rider_name, otp } = body;

          if (!id || !status) {
            return new Response(JSON.stringify({ error: "id and status are required" }), { status: 400, headers: corsHeaders() });
          }

          const existing = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
          if (!existing) {
            return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders() });
          }

          const adminAuth = await verifyAdminAuth(request, env);
          const isAdminOverride = !!adminAuth;

          // 1. Super Admin Override: Full authority to force ANY status (cancelled, delivered, expired, etc.)
          if (isAdminOverride) {
            if (rider_name) {
              await env.DB.prepare("UPDATE orders SET status = ?, rider_name = ? WHERE id = ?").bind(status, rider_name, id).run();
            } else {
              await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(status, id).run();
            }
            return new Response(JSON.stringify({ success: true, id, status, adminOverride: true }), { headers: corsHeaders() });
          }

          // 2. Customer Cancellation Handling
          if (status === 'cancelled') {
            if (existing.status === 'preparing' || existing.status === 'packed' || existing.status === 'accepted') {
              return new Response(JSON.stringify({ 
                error: "Cannot cancel order: Butcher carving or delivery transit has already started." 
              }), { status: 400, headers: corsHeaders() });
            }
            if (existing.status === 'delivered') {
              return new Response(JSON.stringify({ error: "Order already delivered." }), { status: 400, headers: corsHeaders() });
            }
            await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ success: true, id, status: 'cancelled' }), { headers: corsHeaders() });
          }

          // 3. Rider Handover Delivery with 4-Digit OTP Verification
          if (status === 'delivered') {
            if (existing.delivery_otp) {
              const submittedOtp = (otp || '').toString().trim();
              if (!submittedOtp || submittedOtp !== existing.delivery_otp.toString()) {
                return new Response(JSON.stringify({ 
                  error: "Invalid Handover PIN! Please ask the customer at the door for the 4-digit code shown on their tracking screen." 
                }), { status: 400, headers: corsHeaders() });
              }
            }

            await env.DB.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ success: true, id, status: 'delivered' }), { headers: corsHeaders() });
          }

          // 4. Shop & Rider Status Updates
          if (rider_name) {
            await env.DB.prepare("UPDATE orders SET status = ?, rider_name = ? WHERE id = ?").bind(status, rider_name, id).run();
          } else {
            await env.DB.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(status, id).run();
          }

          return new Response(JSON.stringify({ success: true, id, status, rider_name }), { headers: corsHeaders() });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // DELETE: Super Admin can delete test orders
      if (request.method === "DELETE") {
        try {
          const adminAuth = await verifyAdminAuth(request, env);
          if (!adminAuth || !isFounder(adminAuth)) {
            return new Response(JSON.stringify({ error: "Access denied: Only Founder Admins can delete order records." }), { status: 403, headers: corsHeaders() });
          }
          const orderId = url.searchParams.get('id') || (await request.json().catch(() => ({}))).id;
          if (!orderId) {
            return new Response(JSON.stringify({ error: "Order ID is required" }), { status: 400, headers: corsHeaders() });
          }
          await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(orderId).run();
          return new Response(JSON.stringify({ success: true, deleted: orderId }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }
    }

    // 3. Static Assets: Serve index.html, custom.html, rider.html, shop.html, admin.html, PWA, CSS
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);
      const pathname = url.pathname;
      if (pathname.endsWith('.html') || pathname === '/' || pathname === '/admin' || pathname === '/partner' || pathname === '/shop' || pathname === '/rider' || pathname === '/track') {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        newHeaders.set('Pragma', 'no-cache');
        newHeaders.set('Expires', '0');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      }
      return response;
    }

    return new Response("Not found", { status: 404 });
  }
};
