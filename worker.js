// Cloudflare Worker: worker.js
// Serves static assets & handles APIs for Customer, Rider, Shop (Butcher), and Admin portals

const ADMIN_SECRET_KEY = "amorelot2026"; // Master Admin Secret Key

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
    "Content-Type": "application/json"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 2. API Endpoints: /api/orders
    if (url.pathname === "/api/orders") {
      if (!env.DB) {
        return new Response(JSON.stringify({ 
          error: "Cloudflare D1 is not bound (env.DB is missing)." 
        }), { status: 500, headers: corsHeaders() });
      }

      // Ensure delivery_otp column exists
      try {
        await env.DB.prepare("ALTER TABLE orders ADD COLUMN delivery_otp TEXT").run();
      } catch(e) {}

      // Auto-expire pending orders older than 30 minutes
      try {
        await env.DB.prepare(`
          UPDATE orders 
          SET status = 'expired' 
          WHERE status = 'pending' 
          AND datetime(created_at) < datetime('now', '-30 minutes')
        `).run();
      } catch(e) {}

      // POST: Place a new order (Customer)
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const id = crypto.randomUUID();
          const itemsStr = typeof body.items === 'string' ? body.items : JSON.stringify(body.items || []);
          
          // Generate 4-digit dynamic delivery OTP
          const delivery_otp = Math.floor(1000 + Math.random() * 9000).toString();

          await env.DB.prepare(`
            INSERT INTO orders (
              id, customer_name, customer_phone, delivery_address, 
              special_notes, items, subtotal, delivery_fee, total_price, 
              status, delivery_zone, delivery_otp, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'))
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
            body.delivery_zone || 'HSR Layout',
            delivery_otp
          ).run();

          const created = { id, status: 'pending', delivery_otp, ...body };
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

          // A. Admin Portal Query (All orders + Real-time Revenue & Stats)
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
            let preparingCount = 0;
            let inTransitCount = 0;
            let deliveredCount = 0;

            allOrders.forEach(o => {
              if (o.status !== 'cancelled' && o.status !== 'expired') {
                totalRevenue += Number(o.total_price) || 0;
              }
              if (o.status === 'pending') pendingCount++;
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
                preparingCount,
                inTransitCount,
                deliveredCount
              }
            }), { headers: corsHeaders() });
          }

          // B. Customer Tracking Query (Includes delivery_otp)
          if (orderId) {
            const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
            if (!order) {
              return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders() });
            }
            return new Response(JSON.stringify({ order }), { headers: corsHeaders() });
          }

          // C. Shop / Butcher Portal Query (Only today's active cuts within 8 hours)
          if (isShop) {
            let shopQuery = `
              SELECT * FROM orders 
              WHERE status IN ('pending', 'preparing', 'packed') 
              AND datetime(created_at) >= datetime('now', '-8 hours')
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

          // D. Rider Dashboard Query (Delivery OTP masked from rider for security)
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

      // PATCH: Update order status (Cancellation, Shop 'packed', Rider 'accepted'/'delivered' with OTP)
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

          // 1. Customer Cancellation Handling
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

          // 2. Rider Handover Delivery with 4-Digit OTP Verification
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

          // 3. Regular Status Updates (preparing, packed, accepted)
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
