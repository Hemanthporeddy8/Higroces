// Cloudflare Worker: worker.js
// Serves static assets (HTML/CSS/JS/PWA) and handles /api/orders via Cloudflare D1

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
          error: "Cloudflare D1 is not bound. Please add a D1 binding named 'DB' in Cloudflare dashboard." 
        }), { status: 500, headers: corsHeaders() });
      }

      // POST: Place a new order
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const id = crypto.randomUUID();
          const itemsStr = typeof body.items === 'string' ? body.items : JSON.stringify(body.items || []);

          await env.DB.prepare(`
            INSERT INTO orders (
              id, customer_name, customer_phone, delivery_address, 
              special_notes, items, subtotal, delivery_fee, total_price, 
              status, delivery_zone, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
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
            body.delivery_zone || 'HSR Layout'
          ).run();

          const created = { id, status: 'pending', ...body };
          return new Response(JSON.stringify({ success: true, order: created }), {
            status: 201,
            headers: corsHeaders()
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // GET: Retrieve order tracking or rider orders
      if (request.method === "GET") {
        try {
          const orderId = url.searchParams.get('orderId');
          const zone = url.searchParams.get('zone');
          const rider = url.searchParams.get('rider');

          // Customer order status check
          if (orderId) {
            const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
            if (!order) {
              return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders() });
            }
            return new Response(JSON.stringify({ order }), { headers: corsHeaders() });
          }

          // Rider dashboard query
          let pendingOrders = [];
          let activeOrders = [];

          if (zone) {
            const res = await env.DB.prepare(`
              SELECT * FROM orders 
              WHERE status = 'pending' AND delivery_zone = ? 
              ORDER BY datetime(created_at) DESC
            `).bind(zone).all();
            pendingOrders = res.results || [];
          }

          if (rider) {
            const res = await env.DB.prepare(`
              SELECT * FROM orders 
              WHERE status = 'accepted' AND rider_name = ? 
              ORDER BY datetime(created_at) DESC
            `).bind(rider).all();
            activeOrders = res.results || [];
          }

          return new Response(JSON.stringify({ pendingOrders, activeOrders }), { headers: corsHeaders() });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
        }
      }

      // PATCH: Update order status (Accept / Mark Delivered)
      if (request.method === "PATCH") {
        try {
          const body = await request.json();
          const { id, status, rider_name } = body;

          if (!id || !status) {
            return new Response(JSON.stringify({ error: "id and status are required" }), { status: 400, headers: corsHeaders() });
          }

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

    // 3. Static Assets: Serve index.html, rider.html, custom.html, PWA, CSS, etc.
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
