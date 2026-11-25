# Amorelot — Butcher Inventory & Carcass Breakdown System (CBM)

## 1. System Overview & Core Concept
The **Carcass Breakdown Model (CBM)** allows the butcher hub manager to manage stock naturally without manually calculating grams of individual muscles. 

Instead of typing weights for each part, the hub butcher inputs the **total number of whole chickens slaughtered/prepared for the day's batch**:
$$\text{Input: } N \text{ Whole Hens (e.g. } N = 10 \text{)}$$

### Mathematical Breakdown Per Bird:
| Anatomical Cut | Yield Per Bird | Example: 10 Hens Batch | Avg Unit Weight | Primary Culinary Use |
| :--- | :---: | :---: | :---: | :--- |
| **Breast Fillets** | 2 lobes (halves) | **20 fillets** | ~250g per fillet | Boneless breast, stir fry, steak |
| **Whole Legs** | 2 legs (thigh+drum) | **20 whole legs** | ~320g per leg | Tandoori, Roast, Biryani |
| *(or Drumsticks)* | 2 drumsticks | **20 drumsticks** | ~150g per drumstick | Fry, Lollipop, Curry |
| *(or Thighs)* | 2 thighs | **20 thighs** | ~170g per thigh | Juicy curry, boneless thigh tikka |
| **Wings** | 2 wings (flat+drumette)| **20 wings** | ~95g per wing | Crispy fry, hot wings |
| **Curry Cut / Ribs** | 1 carcass (upper/lower)| **10 carcass sets** | ~380g | Soup stock, bone-in curry |
| **Cavity Organs (Offal)**| 1 set (liver, heart, gizzard)| **10 offal sets** | ~95g | Fresh liver fry, gizzard masala |

---

## 2. Real-Time Order Depletion & SVG Sold-Out Locking
1. **Live Decrement:**
   - Every time a customer places an order via the Storefront or Butcher Mode, the database automatically subtracts the ordered cut count:
     $$\text{Remaining Wings} = \text{Initial Wings} - \text{Ordered Wings}$$
2. **Visual "Sold Out" on Interactive Diagram:**
   - When a cut hits `0`:
     - That part is dimmed and desaturated on the SVG (`opacity: 0.3; filter: grayscale(1);`).
     - A subtle badge appears: `Sold Out for Today — Fresh Batch Tomorrow 7:00 AM`.
     - Clicking the part politely notifies the customer: *"Wings are fully reserved for today. Would you like Fresh Drumsticks or Breast Fillet instead?"*

---

## 3. Resolving the "Unsold / Fractional Cut" Dilemma (Zero Waste Policy)
### The Problem:
*If a customer orders 1 breast half (~250g), who buys the remaining breast or other cuts?*

### The 4 Commercial Butchery Solutions:
1. **Natural Minimum Sizing (No Awkward Slices):**
   - The app restricts minimum orders to natural anatomical units: **250g (1 whole breast half)**, **500g (1 full breast pair)**, or increments of 250g.
   - Customers never buy random fractions like 60g, ensuring all meat remains in intact, clean, sellable whole fillets.
2. **The "Shared Hub Pool":**
   - Customers order from the hub's collective daily batch. If Customer A orders 250g, Customer B ordering 500g gets the matching half plus another fillet. Across dozens of daily orders, parts balance out naturally.
3. **The Keema (Mince) & Curry Cut Absorption Channel (Zero Waste):**
   - Any unsold boneless breast portions at evening cutoff are converted into **Fresh Chicken Keema (Mince)**.
   - Keema commands a **higher price per kg (₹380–₹420/kg)** for momos, burgers, and kebabs, turning leftover breast meat into a premium profit product.
   - Remaining bone-in cuts are cubed and merged into the **Chicken Curry Cut** batches (the #1 best-seller accounting for 60%+ of shop volume).
4. **Margin Protection (Prime Cut Pricing):**
   - Whole Chicken sells at ~₹200–₹220/kg, while Boneless Breast sells at ~₹400–₹480/kg.
   - The high margin on breast and whole legs covers the bird's cost entirely, guaranteeing full profit even if remaining soup bones sell at lower rates.

---

## 4. Cloudflare D1 Database Schema Design

```sql
-- Daily Slaughter Batches per Hub
CREATE TABLE IF NOT EXISTS hub_daily_batches (
    id TEXT PRIMARY KEY,
    hub_id TEXT NOT NULL DEFAULT 'main-hub',
    batch_date DATE NOT NULL,
    total_hens_slaughtered INTEGER NOT NULL DEFAULT 10,
    breasts_initial INTEGER NOT NULL,
    breasts_remaining INTEGER NOT NULL,
    legs_initial INTEGER NOT NULL,
    legs_remaining INTEGER NOT NULL,
    wings_initial INTEGER NOT NULL,
    wings_remaining INTEGER NOT NULL,
    ribs_initial INTEGER NOT NULL,
    ribs_remaining INTEGER NOT NULL,
    offal_initial INTEGER NOT NULL,
    offal_remaining INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Instant Recall Keyword
Whenever the user mentions **"Carcass Breakdown"**, **"10 Hens System"**, or **"swap butcher inventory"**, refer directly to this document.
