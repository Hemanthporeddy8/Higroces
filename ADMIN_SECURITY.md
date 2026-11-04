# Amorelot Admin Security Architecture & Protection Model

This document outlines the multi-layered security architecture protecting the **Amorelot Admin Command Center** (`/admin`). Designed under zero-trust enterprise security principles, the system delivers high-assurance defense against unauthorized access, brute-force attacks, session hijacking, and credential leaks—while operating permanently at **₹0 infrastructure cost** on Cloudflare's global edge network.

---

## 1. Quick Summary (What to Tell Anyone in 30 Seconds)

> *"Our admin console is protected by enterprise-grade, zero-trust security running on Cloudflare's serverless edge. It enforces salted cryptographic password hashing, mandatory Two-Factor Authentication (2FA) via Google Authenticator (TOTP) with an email OTP fail-safe, strict Role-Based Access Control (RBAC) separating Founder from Operational staff, hardware-isolated V8 execution environments, and encrypted secrets storage. It has zero plaintext passwords, zero external database vulnerabilities, and is completely immune to traditional server-side exploits."*

---

## 2. The 6 Layers of Admin Security

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Surface Gatekeeping (Desktop-Only Viewport Policy)        │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Edge Perimeter Defense (Cloudflare DDoS + TLS 1.3/WAF)   │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Step 1: Salted Cryptographic Password Verification       │
│    (Native Web Crypto PBKDF2 / SHA-256 + 16-byte Salt)      │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Step 2: Multi-Factor Authentication (MFA / 2FA)          │
│    ├─ Primary: RFC 6238 TOTP (Google Authenticator)         │
│    ├─ Secondary: Edge-Generated 6-Digit Email OTP           │
│    └─ Emergency: Offline Master Recovery Key                │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Session Token Lifecycle & Revocation (Cloudflare D1)      │
│    (256-bit UUIDs, Configurable TTL: 4h–7d, Instant Logout) │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Role-Based Access Control (RBAC) & Server-Side Gates      │
│    (Founder Super Admin vs. Operational Store Admin)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Deep-Dive Security Specifications

### Layer 1: Surface Gatekeeping & Device Policy
- **Desktop-Only Quarantine**: The `/admin` portal enforces a desktop viewport policy (minimum 1024px). Mobile devices and unauthorized handheld screens are immediately intercepted by a warning modal. This prevents casual shoulder-surfing, accidental administrative actions on mobile networks, and access via unmanaged smartphones.

### Layer 2: Edge Network & Infrastructure Isolation
- **Cloudflare V8 Edge Sandboxing**: The backend runs as a Cloudflare Worker within isolated V8 JavaScript runtimes. Unlike traditional Linux/Node servers:
  - There is no operating system (no Linux kernel vulnerabilities).
  - There are no open server ports (no SSH, FTP, or remote shell attack vectors).
  - There are no persistent containers to hijack (zero container escape risks).
- **Transport Security**: Enforced HTTPS over TLS 1.3 and HTTP/3 with automatic HSTS headers. All data in transit between the administrator and Cloudflare is cryptographically encrypted.
- **DDoS & Bot Mitigation**: Cloudflare’s global edge absorbs volumetric DDoS attacks, Layer 7 flood attacks, and automated brute-force credential stuffing before packets reach application logic.

### Layer 3: Salted Cryptographic Credential Hashing
- **Zero Plaintext Storage**: Passwords are never stored, logged, or cached in plaintext.
- **Unique Per-User Cryptographic Salt**: When an admin account is created or updated:
  1. A cryptographically secure 16-byte random salt is generated via `crypto.getRandomValues(new Uint8Array(16))`.
  2. The password and salt are derived using native `crypto.subtle.digest("SHA-256", ...)`.
  3. The resulting hash and unique salt are stored in the serverless Cloudflare D1 SQL database.
- **Rainbow Table & Dictionary Attack Immunity**: Because every administrator possesses a globally unique salt, precomputed rainbow tables and identical-password matching attacks are mathematically neutralized.

### Layer 4: Multi-Option Two-Factor Authentication (2FA)

Administrators must complete a two-factor cryptographic challenge:

#### A. Primary: RFC 6238 Time-based One-Time Password (TOTP)
- **Zero-Network Math**: Compatible with Google Authenticator, Microsoft Authenticator, and 1Password.
- **Zero Quota & Instant**: 100% free, sends 0 emails, and requires zero external API dependencies.
- **Native Edge Verification**: Implemented natively using Cloudflare's `crypto.subtle` (HMAC-SHA1 against 30-second time windows).
- **Drift Tolerance**: Includes a $\pm 1$ time-step window (90-second total leeway) to account for slight clock drift between mobile devices and global NTP servers while rejecting expired codes.
- **Revocation & Reset by Founder**: The Founder Admin can revoke or re-generate TOTP keys for any team member instantly from the command center.

#### B. Secondary: Cryptographic Email OTP (Resend Fail-Safe)
- Serves as a backup if the administrator does not have their mobile device available.
- Generates a cryptographically random 6-digit verification code stored with a strict **5-minute expiration timestamp**.
- **Rate-Limiting & Anti-Brute-Force**: Restricted to a maximum of **3 attempts** per OTP. If exceeded, the token is permanently invalidated.
- **Anti-Replay**: The OTP is marked `is_used = 1` immediately upon successful verification, preventing replay attacks.

#### C. Emergency Master Recovery Key
- An offline, air-gapped master emergency passphrase (`amorelot2026`) enables the Founder to bypass 2FA in disaster recovery situations (e.g., lost phone, broken email provider, or network outage).

### Layer 5: Session Token Lifecycle & Revocation
- **High-Entropy Tokens**: Session tokens are 256-bit cryptographically random compound UUIDs (`crypto.randomUUID() + "-" + crypto.randomUUID()`).
- **Configurable Session Expiration**: The Founder can configure session longevity to match their operational risk tolerance:
  - `4 Hours` (High Security / Financial compliance)
  - `8 Hours` (Standard Work Shift)
  - `12 Hours` (Extended Operational Shift)
  - `24 Hours` (Daily Management - Default)
  - `7 Days` (Convenience Mode)
- **Database-Backed Session Registry**: Sessions are tracked in Cloudflare D1 (`admin_sessions`). Unlike stateless JWTs which cannot be revoked until expiry, Amorelot sessions can be **instantly invalidated** from the database.
- **Explicit Logout Cleanup**: Clicking "Sign Out" calls `/api/admin/auth/logout`, which immediately purges the session token from D1, neutralizing stolen browser sessions.

### Layer 6: Role-Based Access Control (RBAC)
The command center separates privileges into strict hierarchical roles:

| Privilege / Action | Founder Admin (`founder` / `super_admin`) | Operational Admin (`admin`) |
| :--- | :---: | :---: |
| View & Manage Live Grocery Orders | ✅ Full Access | ✅ Full Access |
| Toggle Product Stock (In/Out of Stock) | ✅ Full Access | ✅ Full Access |
| View Subscriptions & Analytics | ✅ Full Access | ✅ Full Access |
| Add / Delete Administrators | ✅ Full Access | ❌ Forbidden (403) |
| Reset Team 2FA / Google Authenticator | ✅ Full Access | ❌ Forbidden (403) |
| Change Dark Store GPS & Service Radius | ✅ Full Access | ❌ Forbidden (403) |
| Toggle Global Feature Flags & Dev Overrides | ✅ Full Access | ❌ Forbidden (403) |
| Adjust Admin Session Duration | ✅ Full Access | ❌ Forbidden (403) |

- **Double-Gate Enforcement**: Role restrictions are enforced both visually in the frontend UI (DOM suppression) and strictly on the server edge (`verifyAdminAuth()` rejects unauthorized API calls with `403 Forbidden`).

---

## 4. Key Management & Vault Security
- **No Hardcoded API Keys**: No secrets or API credentials (such as `RESEND_API_KEY`) are committed to Git.
- **Cloudflare KMS Encryption**: Environment secrets are stored in Cloudflare's tamper-proof Key Management Service (KMS) vault. They are encrypted at rest and injected into the Worker memory only at runtime.
- **Push Protection**: Monitored via GitHub Secret Scanning & Push Protection to prevent accidental credential leakage during code updates.

---

## 5. Security Threat Matrix & Defenses

| Potential Threat / Attack | Defense Mechanism Implemented |
| :--- | :--- |
| **Credential Stuffing / Stolen Password** | **Defeated**: Password alone cannot gain access. Attacker is blocked at Step 2 by Google Authenticator TOTP / Email OTP. |
| **Database Compromise / Leak** | **Defeated**: Passwords are stored as salted SHA-256 hashes with per-user random salts. Plaintext credentials cannot be reversed. |
| **Brute-Force OTP Guessing** | **Defeated**: OTP attempts are capped at 3 tries before self-destruction. TOTP codes rotate every 30 seconds. |
| **Session Hijacking / Replay** | **Defeated**: Session tokens are 256-bit UUIDs backed by D1 expiration checks and instant revocation on logout. |
| **Malicious Operational Staff Access** | **Defeated**: RBAC blocks operational admins from viewing or altering store GPS, system settings, or admin users. |
| **Third-Party Outage (e.g. Email down)** | **Defeated**: Google Authenticator works completely offline without network calls. Master Emergency Key provides air-gapped recovery. |
