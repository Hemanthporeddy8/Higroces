# Amorelot — Growth Engine & Expansion Roadmap (V2 & V3)
**Brand Master**: Amorelot / Amorelot Fresh  
**Project Email**: amorelotofficial@gmail.com  
**Architecture**: Cloudflare Workers + Cloudflare D1 + PWA  

---

## Executive Summary

Amorelot operates on a high-margin, hyper-retention **3-Pillar Quick Commerce Architecture**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                               AMORELOT                                 │
├───────────────────┬──────────────────────────┬─────────────────────────┤
│   ⚡ 15-MIN INSTANT │   🌱 FRESH TMRW          │   🔄 DAILY REPEAT       │
│   (V1 - Active)   │   (V2 - Next-Day Mandi)  │   (V3 - Subscriptions)  │
├───────────────────┼──────────────────────────┼─────────────────────────┤
│ • Custom Meat Cuts│ • Direct APMC Mandi      │ • Gym Rat Chicken Breast│
│ • Ice Cream/Snacks│ • Zero Cold-Storage      │ • Farm Milk & Egg Tray  │
│ • Emergency POT   │ • 0% Spoilage / Pre-Paid │ • Fresh Fruit Bowls     │
│ • Tech Gadgets    │ • 6:30 AM Doorstep Drop  │ • Monthly Auto-Wallet   │
└───────────────────┴──────────────────────────┴─────────────────────────┘
```

---

## Pillar 1: 15-Minute Instant Commerce (V1 Core - Live)
* **Delivery Promise**: 10–15 Minutes.
* **Core Categories**:
  - Fresh butchered chicken, mutton, fish (2D Butcher Mode custom cuts).
  - Fast-moving packaged dairy, eggs, breads, cold drinks, snacks.
  - High-margin impulse electronics (cables, scales, meat thermometers).
* **Fulfillment**: Neighborhood Dark Store + Partner Butcher Station KDS (`/shop.html`).
* **Handover Verification**: Dynamic 4-Digit Delivery OTP (`rider.html`).

---

## Pillar 2: "Fresh Tmrw" (Next-Day Zero Cold-Storage Farm Produce)

### 1. The Core Problem Solved
Traditional quick commerce (Zepto/Blinkit) stores delicate greens and vegetables in dark store refrigerators for 3 to 5 days, resulting in wilted spinach, softened tomatoes, and high operational wastage (12–18% spoilage write-off).

### 2. The Fresh Tmrw Solution & USP
* **Zero Cold-Storage Guarantee**: Never refrigerated or frozen.
* **Mandi Procurement**: Sourced directly from local wholesale APMC Mandi at 4:30 AM on the day of delivery.
* **Zero Spoilage Risk**: Customers place orders before 10:00 PM tonight with digital pre-payment. The procurement team only buys the exact aggregate quantities ordered.
* **Delivery Window**: Delivered directly to the customer's doorstep between 6:30 AM and 8:00 AM.

### 3. Operational Workflow
```
[Customer Orders Veggies before 10 PM]
            │
            ▼
[Cloudflare D1: status = 'scheduled', order_type = 'fresh_tmrw']
            │
            ▼
[Admin 5:00 AM Mandi Procurement Sheet aggregates total kg]
            │
            ▼
[Agent buys bulk at APMC wholesale market]
            │
            ▼
[Bagging & Morning Dispatch to Doorstep by 7:30 AM]
```

### 4. Technical Guardrails
* **Auto-Reaper Bypass**: The 30-minute auto-expiry strictly checks `order_type = 'instant' AND status = 'pending'`. Pre-orders (`order_type = 'fresh_tmrw'`) maintain `status = 'scheduled'` overnight without interference.

---

## Pillar 3: Daily Repeat Subscriptions (High-LTV Retention Engine)

### 1. The 3 Flagship Subscription Baskets

#### A. 🏋️ The "Gym Rat" High-Protein Plan (The Core Differentiator)
* **The Problem**: Fitness enthusiasts and gym-goers require 250g–500g of lean animal protein daily. Weighing, trimming fat, and washing raw chicken breast every morning is tedious.
* **The Offering**:
  - 300g or 500g fresh, trimmed, skinless chicken breast.
  - Vacuum-sealed in daily hygienic portion packs.
  - Dropped at the door every morning at 7:00 AM.
* **Unit Economics**:
  - Daily Price: ₹140 (300g trimmed breast).
  - Monthly Recurring Revenue (MRR): **₹4,200 per subscriber**.
  - 100 Gym Subscribers = **₹4,20,000 / month guaranteed revenue**.

#### B. 🥛 Daily Farm Milk & Eggs Plan
* **The Offering**: 1 Litre unadulterated pasteurized/A2 milk + 6 Farm Eggs daily.
* **Daily Price**: ₹105 / day (₹3,150 / month).
* **Role**: Primary household anchor hook that creates daily brand recall.

#### C. 🥗 Fresh Morning Cut Fruit Bowl
* **The Offering**: Pre-washed, peeled, and cubed seasonal fruits (Papaya, Pomegranate, Watermelon, Pineapple).
* **Daily Price**: ₹89 / day.
* **Margin**: ~52% gross margin.

### 2. Delivery Model: The "Silent Doorstep Drop" (6:00 AM – 7:30 AM)
* No doorbells or loud phone calls.
* Dedicated thermal delivery bag left outside the flat door.
* Rider snaps delivery proof photo inside the app.
* Ultra-efficient route: 1 rider delivers to 25–35 apartments in the same gated society in under 1 hour (Delivery cost < ₹8 per drop).

---

## Technical Architecture & Database Schema

### Cloudflare D1 Tables

#### 1. `system_settings` (Feature Flags)
```sql
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- Keys:
-- 'feature_fresh_tmrw': '0' (OFF) | '1' (ON)
-- 'feature_subscriptions': '0' (OFF) | '1' (ON)
```

#### 2. `subscriptions` (Recurring Deliveries)
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  customer_name TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  delivery_zone TEXT,
  plan_type TEXT,        -- 'gym_chicken_breast', 'daily_milk_eggs', 'fruit_bowl'
  plan_title TEXT,
  price_per_day REAL,
  frequency TEXT,        -- 'daily', 'weekdays_only'
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'cancelled'
  start_date TEXT,
  delivery_slot TEXT DEFAULT '6:30 AM - 7:30 AM',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### 3. `orders` Enhancements
* `order_type TEXT DEFAULT 'instant'` ('instant' | 'fresh_tmrw')
* `delivery_slot TEXT` (e.g. 'Instant (15 mins)' | 'Tomorrow Morning 6:30 AM - 8:00 AM')

---

## Deployment & Phased Rollout Schedule

1. **Phase 1 (Active)**: Instant 15-Minute Meat & Grocery MVP.
   - Admin Feature Flags defaulted to `OFF`.
   - Complete zero-risk customer testing in target zone.
2. **Phase 2 (When partner buyer is onboarded)**:
   - Toggle `feature_fresh_tmrw` to `ON` in `/admin`.
   - Launch next-day farm harvest pre-orders.
3. **Phase 3 (When recurring volume exceeds 50 orders/day)**:
   - Toggle `feature_subscriptions` to `ON` in `/admin`.
   - Onboard local gym communities and gated apartment complexes.
