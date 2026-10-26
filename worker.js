// Cloudflare Worker: worker.js
// Serves static assets & handles APIs for Customer, Rider, Shop (Butcher), and Admin portals

const ADMIN_SECRET_KEY = "amorelot2026"; // Master Admin Secret Key

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate"
  };
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

  // Initialize feature flags (OFF by default)
  try {
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('feature_fresh_tmrw', '0')").run();
    await db.prepare("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('feature_subscriptions', '0')").run();
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
    // API: /api/settings (Admin Feature Flags for V2 & V3)
    // ═══════════════════════════════════════════════════════════════
    if (url.pathname === "/api/settings") {
      // GET: Public settings (Customer app reads these to show/hide tabs)
      if (request.method === "GET") {
        try {
          const rows = await env.DB.prepare("SELECT * FROM system_settings").all();
          const settings = {
            feature_fresh_tmrw: false,
            feature_subscriptions: false
          };
          (rows.results || []).forEach(r => {
            if (r.key === 'feature_fresh_tmrw') settings.feature_fresh_tmrw = r.value === '1';
            if (r.key === 'feature_subscriptions') settings.feature_subscriptions = r.value === '1';
          });
          return new Response(JSON.stringify(settings), { headers: corsHeaders() });
        } catch(err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // POST: Admin updates feature flags (Requires X-Admin-Key)
      if (request.method === "POST") {
        try {
          const adminKey = request.headers.get('X-Admin-Key') || url.searchParams.get('key');
          if (adminKey !== ADMIN_SECRET_KEY) {
            return new Response(JSON.stringify({ error: "Unauthorized: Invalid Admin Key" }), { status: 401, headers: corsHeaders() });
          }
          const body = await request.json();
          if (body.feature_fresh_tmrw !== undefined) {
            await env.DB.prepare("UPDATE system_settings SET value = ? WHERE key = 'feature_fresh_tmrw'")
              .bind(body.feature_fresh_tmrw ? '1' : '0').run();
          }
          if (body.feature_subscriptions !== undefined) {
            await env.DB.prepare("UPDATE system_settings SET value = ? WHERE key = 'feature_subscriptions'")
              .bind(body.feature_subscriptions ? '1' : '0').run();
          }
          return new Response(JSON.stringify({ success: true, settings: body }), { headers: corsHeaders() });
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
      // Auto-expire only INSTANT pending orders older than 30 minutes (Never touches scheduled Fresh Tmrw!)
      try {
        await env.DB.prepare(`
          UPDATE orders 
          SET status = 'expired' 
          WHERE status = 'pending' 
          AND (order_type IS NULL OR order_type = 'instant')
          AND datetime(created_at) < datetime('now', '-30 minutes')
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

          await env.DB.prepare(`
            INSERT INTO orders (
              id, customer_name, customer_phone, delivery_address, 
              special_notes, items, subtotal, delivery_fee, total_price, 
              status, delivery_zone, delivery_otp, order_type, delivery_slot, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
            delivery_slot
          ).run();

          const created = { id, status: initialStatus, delivery_otp, order_type, delivery_slot, ...body };
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
            const adminKey = request.headers.get('X-Admin-Key') || url.searchParams.get('key');
            if (adminKey !== ADMIN_SECRET_KEY) {
              return new Response(JSON.stringify({ error: "Unauthorized: Invalid Admin Key" }), { 
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

          // Cancellation Handling
          if (status === 'cancelled') {
            if (existing.status === 'preparing' || existing.status === 'packed' || existing.status === 'accepted') {
              return new Response(JSON.stringify({ 
                error: "Cannot cancel order: Butcher carving has already started." 
              }), { status: 400, headers: corsHeaders() });
            }
            if (existing.status === 'delivered') {
              return new Response(JSON.stringify({ error: "Order already delivered." }), { status: 400, headers: corsHeaders() });
            }
            await env.DB.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").bind(id).run();
            return new Response(JSON.stringify({ success: true, id, status: 'cancelled' }), { headers: corsHeaders() });
          }

          // Rider Handover Delivery with 4-Digit OTP Verification
          if (status === 'delivered') {
            const adminKey = request.headers.get('X-Admin-Key') || url.searchParams.get('key');
            const isAdminOverride = adminKey === ADMIN_SECRET_KEY;

            if (existing.delivery_otp && !isAdminOverride) {
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

          // Status Updates
          if (rider_name) {
            await env.DB.prepare(`
              UPDATE orders SET status = ?, rider_name = ? WHERE id = ?
            `).bind(status, rider_name, id).run();
          } else {
            await env.DB.prepare(`
              UPDATE orders SET status = ? WHERE id = ?
            `).bind(status, id).run();
          }

          return new Response(JSON.stringify({ success: true, id, status, rider_name }), { headers: corsHeaders() });
        } catch (err) {
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
