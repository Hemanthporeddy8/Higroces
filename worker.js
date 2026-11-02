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
      return { devMode: false, sent: res.ok };
    } catch(e) {
      console.error("sendEmailOtp error:", e);
      return { devMode: false, sent: false, error: e.message };
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
    return { id: 'master', email: 'master@amorelot.com', full_name: 'Master Super Admin', role: 'super_admin' };
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

  // Product Inventory Table (In-Stock / Out-of-Stock toggles)
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS product_inventory (
        product_id TEXT PRIMARY KEY,
        is_in_stock INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  } catch(e) {}

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
          return new Response(JSON.stringify({ error: "Invalid master setup key. Emergency master key required to register a super admin." }), { status: 403, headers: corsHeaders() });
        }
        const salt = generateSalt();
        const hash = await hashPassword(password, salt);
        const newId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO admin_users (id, email, full_name, password_hash, salt, role)
          VALUES (?, ?, ?, ?, ?, 'super_admin')
        `).bind(newId, email.toLowerCase().trim(), full_name.trim(), hash, salt).run();

        return new Response(JSON.stringify({ success: true, message: "Super Admin account created successfully!" }), { headers: corsHeaders() });
      } catch(err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
      }
    }

    if (url.pathname === "/api/admin/auth/login-step1" && request.method === "POST") {
      try {
        const body = await request.json();
        const { email, password } = body;
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

        // Credentials valid -> Generate 6-digit cryptographic OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpId = crypto.randomUUID();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
        await env.DB.prepare(`
          INSERT INTO admin_otps (id, email, otp_code, expires_at, attempts, is_used)
          VALUES (?, ?, ?, ?, 0, 0)
        `).bind(otpId, user.email, otpCode, expiresAt).run();

        // Send OTP via Resend or log
        const emailResult = await sendEmailOtp(user.email, otpCode, env);

        // Mask email: h***@domain.com
        const parts = user.email.split('@');
        const masked = parts[0].length <= 2 ? parts[0] + '***@' + parts[1] : parts[0][0] + '***' + parts[0].slice(-1) + '@' + parts[1];

        return new Response(JSON.stringify({
          success: true,
          message: `6-digit security code sent to ${masked}`,
          maskedEmail: masked,
          devMode: emailResult.devMode,
          debugOtp: emailResult.devMode ? otpCode : undefined
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

        const record = await env.DB.prepare(`
          SELECT * FROM admin_otps WHERE email = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1
        `).bind(cleanEmail).first();

        if (!record) {
          return new Response(JSON.stringify({ error: "No active security code found. Please login again." }), { status: 400, headers: corsHeaders() });
        }
        if (Date.now() > record.expires_at) {
          return new Response(JSON.stringify({ error: "Security code expired. Please request a new code." }), { status: 400, headers: corsHeaders() });
        }
        if (record.attempts >= 3) {
          return new Response(JSON.stringify({ error: "Maximum attempts exceeded. Please restart login." }), { status: 429, headers: corsHeaders() });
        }
        if (record.otp_code !== cleanOtp) {
          await env.DB.prepare("UPDATE admin_otps SET attempts = attempts + 1 WHERE id = ?").bind(record.id).run();
          const remaining = 2 - record.attempts;
          return new Response(JSON.stringify({ error: `Incorrect security code. ${remaining > 0 ? remaining + ' attempt(s) remaining.' : 'Locked out.'}` }), { status: 400, headers: corsHeaders() });
        }

        // OTP verified
        await env.DB.prepare("UPDATE admin_otps SET is_used = 1 WHERE id = ?").bind(record.id).run();

        const user = await env.DB.prepare("SELECT id, email, full_name, role FROM admin_users WHERE email = ?").bind(cleanEmail).first();
        const token = crypto.randomUUID() + "-" + crypto.randomUUID();
        const expiresAt = Date.now() + 4 * 60 * 60 * 1000; // 4-hour session

        await env.DB.prepare(`
          INSERT INTO admin_sessions (token, user_id, expires_at)
          VALUES (?, ?, ?)
        `).bind(token, user.id, expiresAt).run();

        return new Response(JSON.stringify({
          success: true,
          token,
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

    // ── TEAM & MULTI-ADMIN MANAGEMENT ──
    if (url.pathname === "/api/admin/team") {
      const adminAuth = await verifyAdminAuth(request, env);
      if (!adminAuth) {
        return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
      }

      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT id, email, full_name, role, created_at FROM admin_users ORDER BY created_at DESC").all();
          return new Response(JSON.stringify({ admins: rows.results || [] }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      if (request.method === "POST") {
        if (adminAuth.role !== 'super_admin') {
          return new Response(JSON.stringify({ error: "Only Super Admins can add team members." }), { status: 403, headers: corsHeaders() });
        }
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
          `).bind(newId, cleanEmail, full_name.trim(), hash, salt, role || 'store_manager').run();

          return new Response(JSON.stringify({ success: true, id: newId }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: "An admin with this email already exists." }), { status: 409, headers: corsHeaders() });
        }
      }

      if (request.method === "DELETE") {
        if (adminAuth.role !== 'super_admin') {
          return new Response(JSON.stringify({ error: "Only Super Admins can remove team members." }), { status: 403, headers: corsHeaders() });
        }
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
    // API: /api/settings (Feature Flags & Dark Store Hub Coordinates)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/settings") {
      // GET: Public settings (Customer & Rider apps read these)
      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT * FROM system_settings").all();
          const settings = {
            feature_fresh_tmrw: false,
            feature_subscriptions: false,
            dark_store_name: "HSR Meat Hub & Dark Store",
            dark_store_lat: "12.9121",
            dark_store_lng: "77.6408",
            smart_recommendation_mode: "auto"
          };
          (rows.results || []).forEach(r => {
            if (r.key === 'feature_fresh_tmrw') settings.feature_fresh_tmrw = r.value === '1';
            if (r.key === 'feature_subscriptions') settings.feature_subscriptions = r.value === '1';
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
          if (!adminAuth) {
            return new Response(JSON.stringify({ error: "Unauthorized: Admin session required." }), { status: 401, headers: corsHeaders() });
          }
          const body = await request.json();
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
    // API: /api/inventory (Real-time Stock Toggling for Butcher & Shop)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/inventory") {
      // GET: Returns map of { [productId]: boolean }
      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT product_id, is_in_stock FROM product_inventory").all();
          const inventory = {};
          (rows.results || []).forEach(r => {
            inventory[r.product_id] = r.is_in_stock === 1;
          });
          return new Response(JSON.stringify({ inventory }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Shopkeeper or Admin updates item stock status
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const { product_id, is_in_stock } = body;
          if (!product_id) {
            return new Response(JSON.stringify({ error: "product_id is required" }), { status: 400, headers: corsHeaders() });
          }
          const stockVal = (is_in_stock === false || is_in_stock === 0 || is_in_stock === '0') ? 0 : 1;
          await env.DB.prepare(`
            INSERT INTO product_inventory (product_id, is_in_stock, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(product_id) DO UPDATE SET is_in_stock = excluded.is_in_stock, updated_at = datetime('now')
          `).bind(product_id, stockVal).run();

          return new Response(JSON.stringify({ success: true, product_id, is_in_stock: stockVal === 1 }), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
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
      // Auto-expire instant orders (pending > 30m, or uncompleted stuck orders > 4 hours)
      try {
        await env.DB.prepare(`
          UPDATE orders 
          SET status = 'expired' 
          WHERE (order_type IS NULL OR order_type = 'instant')
          AND (
            (status = 'pending' AND datetime(created_at) < datetime('now', '-30 minutes'))
            OR
            (status IN ('preparing', 'packed', 'accepted') AND datetime(created_at) < datetime('now', '-4 hours'))
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

          await env.DB.prepare(`
            INSERT INTO orders (
              id, customer_name, customer_phone, delivery_address, 
              special_notes, items, subtotal, delivery_fee, total_price, 
              status, delivery_zone, delivery_otp, order_type, delivery_slot,
              cust_lat, cust_lng, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
            cust_lng
          ).run();

          const created = { id, status: initialStatus, delivery_otp, order_type, delivery_slot, cust_lat, cust_lng, ...body };
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

            const allOrdersRes = await env.DB.prepare(`
              SELECT * FROM orders ORDER BY datetime(created_at) DESC LIMIT 100
            `).all();
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

          // C. Shop / Butcher Portal Query
          if (isShop) {
            let shopQuery = `
              SELECT * FROM orders 
              WHERE status IN ('pending', 'preparing', 'packed', 'scheduled') 
              AND datetime(created_at) >= datetime('now', '-12 hours')
            `;
            let params = [];
            if (zone) {
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
          if (!adminAuth || adminAuth.role !== 'super_admin') {
            return new Response(JSON.stringify({ error: "Unauthorized: Super Admin session required." }), { status: 401, headers: corsHeaders() });
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
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
