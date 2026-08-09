# CryptoDraw Backend

Production-oriented companion API for the CryptoDraw Shopify theme in this package.

## Implemented behavior

- One **fresh, confirmed USDT transfer** creates one entry.
- The **same wallet can enter repeatedly** with separate transactions.
- A **transaction hash is unique** and can never create two entries.
- The receiver gets the **full configured USDT token amount**. Gas / native network fee / TRON energy-bandwidth is paid separately by the participant wallet.
- Payment sessions reserve pool capacity while active so a capped pool cannot intentionally overbook during checkout.
- On-chain verification checks the configured network, token contract, sender, receiver, exact token amount and required confirmation state.
- Admin dashboard: pool create/open/close/edit, payment pause, entries, payment sessions, CSV export, freeze, draw finalization, payout record and audit log.
- Public My Entries API and storefront page.
- Completed draws publish a frozen entry list, SHA-256 entry-set commitment / Merkle root, pinned drand beacon data, deterministic winning index and proof hash.
- Public transparency feed.

## Important security design

The backend **does not store participant private keys** and it does not need a payout private key. Wallet payments are built as unsigned instructions and are approved/signed in the participant wallet. Winner payouts can be made from your treasury/multisig process and the resulting payout transaction hash can be recorded in Admin.

Do not put RPC secrets, TronGrid keys, admin secrets or database credentials in Shopify Liquid or browser JavaScript.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- HTTPS backend host
- Verified USDT token contract and your receiver address for every accepted network
- RPC endpoint for each EVM chain and/or TronGrid-compatible API for TRON
- Reown / WalletConnect Project ID for the Shopify frontend

## Install

```bash
cp .env.example .env
# edit .env first
npm install
npm run migrate
npm test
npm start
```

Open:

- Health: `https://YOUR-BACKEND/health`
- Admin: `https://YOUR-BACKEND/admin`

## drand chain pinning

The draw verifier intentionally requires a pinned chain hash + public key. Get the values from the drand endpoint you intend to trust:

```bash
npm run drand-info
```

Copy the printed `DRAND_CHAIN_HASH` and `DRAND_PUBLIC_KEY` into `.env`, then restart.

## Payment network configuration

`EVM_NETWORKS_JSON` and `TRON_NETWORKS_JSON` are JSON arrays. Never copy a token address from an untrusted source. Confirm the exact token contract, decimals, network and receiving wallet before accepting funds.

Example shape only:

```text
EVM_NETWORKS_JSON=[{"key":"bsc","name":"BNB Smart Chain","chainId":56,"rpcUrl":"https://YOUR-RPC","usdtContract":"0xVERIFIED_TOKEN","receiverAddress":"0xYOUR_WALLET","amountDecimals":18,"confirmations":3}]
```

```text
TRON_NETWORKS_JSON=[{"key":"tron","name":"TRON","apiBase":"https://api.trongrid.io","apiKey":"YOUR_KEY","usdtContract":"T_VERIFIED_TOKEN","receiverAddress":"T_YOUR_WALLET","amountDecimals":6,"feeLimitSun":100000000}]
```

The code uses `amountDecimals` to convert `1.000000` USDT to the exact token atomic amount. Set it to the decimals of the contract you actually configure.

## Shopify connection

In Shopify Theme Editor:

1. **Theme settings → Backend API**
2. Set **Public backend API base URL** to `https://YOUR-BACKEND`
3. Set **Payment mode** to `Backend-verified payment sessions`
4. **Theme settings → Wallet connection**
5. Add your Reown / WalletConnect Project ID
6. Set the EVM chain ID/name to the EVM network you want the wallet page to request

In backend `.env`, add the Shopify origins to `PUBLIC_ORIGINS`:

```text
PUBLIC_ORIGINS=https://YOUR-STORE.myshopify.com,https://YOUR-CUSTOM-DOMAIN.com
```

## Core public endpoints

- `GET /public/networks`
- `GET /public/current-pool`
- `GET /public/recent-entries`
- `GET /public/my-entries?address=...`
- `GET /public/winners`
- `GET /public/transparency`
- `POST /public/payment-session`
- `POST /public/entries/confirm`
- `GET /public/draw-proof/:poolId`
- `GET /public/draw-proof/:poolId/entries`

## Entry / duplicate rules

There is intentionally **no unique constraint on wallet address**. A wallet can have 1, 10, 100 or more confirmed entries.

There **is** a unique constraint on `entries.tx_hash` and `payment_sessions.tx_hash`. Replaying the exact same blockchain transaction cannot mint another entry. A new entry requires a new transfer and therefore a new transaction hash.

## Pool close / freeze workflow

Recommended operational sequence:

1. `Open` pool.
2. When you want to stop new entry sessions, use `Close` in Admin.
3. Existing active payment sessions can still finish confirmation.
4. Admin `Freeze` refuses to proceed while an active payment session could still settle.
5. Freeze commits the exact confirmed entry list and precommits a future drand round.
6. After that drand round exists, press `Finalize draw`.
7. The backend verifies the drand beacon cryptographically, computes the winner and publishes the proof.
8. Pay the winner using your treasury process, then record payout status + TX hash in Admin.

## Admin security

Use long, random values for both `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`. Run the backend only behind HTTPS in production. The admin cookie is HttpOnly, SameSite=Strict and Secure in production. Payment/API routes are rate limited and state changes are written to the audit log.

## No country or age storefront gating

This build contains no country-block page and no age/eligibility checkbox in the entry flow. A blockchain transaction itself is not technical proof of a person's age, so do not describe it as age verification.

## Shopify-hosted Admin Dashboard
The current Shopify theme renders the full Admin Dashboard at `/cart?view=admin`.
It authenticates against this backend with `POST /admin/api/login`, receives a short-lived signed admin token, stores it in browser `sessionStorage`, and sends it as `Authorization: Bearer <token>` for protected admin API calls.

For this to work, `PUBLIC_ORIGINS` MUST include every storefront origin that can host the dashboard, for example:
`PUBLIC_ORIGINS=https://your-store.myshopify.com,https://yourdomain.com`

The standalone backend dashboard at `/admin` continues to work as well.
