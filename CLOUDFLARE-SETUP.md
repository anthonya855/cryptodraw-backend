# CryptoDraw Cloudflare deployment

The repository now targets Cloudflare Workers.

## Initial deploy

1. Cloudflare Dashboard -> Workers & Pages -> Create application -> Import a repository.
2. Connect GitHub and select `anthonya855/cryptodraw-backend`.
3. Framework preset: None.
4. Build command: `npm install`
5. Deploy command: `npx wrangler deploy`
6. Root directory: `/`

The first deployment can succeed without D1. `/health` will report `database: not-bound`.

## Create and bind D1

Create a D1 database named `cryptodraw-db` from Cloudflare Dashboard -> Storage & databases -> D1 SQL database.

Then open the `cryptodraw-api` Worker -> Settings -> Bindings -> Add -> D1 database:

- Variable name: `DB`
- Database: `cryptodraw-db`

Deploy the binding change. The Worker automatically creates its tables and seed pool on the first DB-backed request.

## Required secrets

Worker -> Settings -> Variables and Secrets -> Add Secret:

- `ADMIN_PASSWORD` - private administrator password
- `ADMIN_SESSION_SECRET` - separate long random secret
- `SHOPIFY_API_SECRET` - Shopify app Client secret

Optional later:

- `REOWN_PROJECT_ID`
- `EVM_NETWORKS_JSON`
- `TRON_NETWORKS_JSON`

Do not put secrets in GitHub.

## Shopify App Proxy

Use the deployed Worker URL as the App Proxy destination:

`https://<worker-subdomain>.workers.dev/apps/cryptodraw`

Shopify proxy settings:

- Prefix: `apps`
- Subpath: `cryptodraw`

Customer-facing requests use `/apps/cryptodraw/...` on the Shopify store. Admin remains directly on the Worker at `/admin`.

## Payment safety

Real payment confirmation intentionally stays disabled until verified USDT network configuration is supplied. Never invent receiver wallets, token contracts, decimals, RPC URLs or API keys.
