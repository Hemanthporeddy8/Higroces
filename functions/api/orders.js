// Cloudflare Pages Function: /api/orders
// Handles order creation, rider zone queries, and order status updates via Cloudflare D1.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// POST /api/orders -> Place a new order
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const id = crypto.randomUUID();
    const itemsStr = typeof body.items === 'string' ? body.items : JSON.stringify(body.items || []);

    if (!env.DB) {
      return new Response(JSON.stringify({ 
        error: "Cloudflare D1 binding (env.DB) not found. Please bind your D1 database to 'DB' in Cloudflare Pages settings." 
      }), { status: 500, headers: corsHeaders() });
    }

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

    const created = {
      id,
      customer_name: body.customer_name,
      customer_phone: body.customer_phone,
      delivery_address: body.delivery_address,
      special_notes: body.special_notes,
      items: body.items,
      subtotal: body.subtotal,
      delivery_fee: body.delivery_fee,
      total_price: body.total_price,
      status: 'pending',
      delivery_zone: body.delivery_zone,
      created_at: new Date().toISOString()
    };

    return new Response(JSON.stringify({ success: true, order: created }), {
      status: 201,
      headers: corsHeaders()
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
  }
}

// GET /api/orders?orderId=... OR /api/orders?zone=...&rider=...
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');
    const zone = url.searchParams.get('zone');
    const rider = url.searchParams.get('rider');

    if (!env.DB) {
      return new Response(JSON.stringify({ 
        error: "Cloudflare D1 binding (env.DB) not found." 
      }), { status: 500, headers: corsHeaders() });
    }

    // 1. Single order status tracker (for customer screen)
    if (orderId) {
      const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
      if (!order) {
        return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: corsHeaders() });
      }
      return new Response(JSON.stringify({ order }), { headers: corsHeaders() });
    }

    // 2. Rider dashboard queries (pending orders in zone + rider active deliveries)
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

// PATCH /api/orders -> Update order status (Accept or Mark Delivered)
export async function onRequestPatch({ request, env }) {
  try {
    const body = await request.json();
    const { id, status, rider_name } = body;

    if (!id || !status) {
      return new Response(JSON.stringify({ error: "id and status are required" }), { status: 400, headers: corsHeaders() });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: "Cloudflare D1 binding (env.DB) not found." }), { status: 500, headers: corsHeaders() });
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

    return new Response(JSON.stringify({ success: true, id, status, rider_name }), {
      headers: corsHeaders()
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
  }
}
