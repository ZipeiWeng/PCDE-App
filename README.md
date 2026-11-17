# PawPrint Health · PCDE App

宠物健康监测 App 的完整源码：健康水球、每日活动与趋势、健康档案、设备连接与数据上传、AI 助手、新手引导、硬件商店及模拟订阅购买。

Complete source for the PawPrint pet-health app: wellness orb, activity and trends, health records, device connection and telemetry, AI companion, onboarding, hardware shop and simulated subscription checkout.

- **Source snapshot:** Sites version 53, published 17 November 2026
- **Source commit:** `f555de246cda5eeac8611dcae803ab5b5216798b`
- **Existing hosted app:** https://pawprint-health.zipeiweng453524.chatgpt.site/

This is a source handoff. Copying the code to GitHub does not transfer the hosted database, production secrets, accounts or deployment configuration.

## 本地运行 / Run locally

Use **Node.js 24.x** with npm. The export was prepared in Node **24.22.1**. Tests use Node's built-in `node:sqlite`. The project currently declares no third-party npm dependencies, so an `npm install` step is not required.

解压代码包后进入 `PCDE-App` 文件夹。代码上传到 GitHub 后，也可以使用下面的 clone 命令。

After extracting the archive, open its `PCDE-App` folder. Once the source has been uploaded to GitHub, cloning is an alternative.

```bash
# GitHub option, after upload:
git clone https://github.com/ZipeiWeng/PCDE-App.git
cd PCDE-App

# Or run this inside the extracted PCDE-App folder:
npm run dev
```

Open **http://localhost:4173/** and choose **Explore demo**.

`npm run dev` starts the UI preview, not a fully configured production backend. Real sign-in, email verification, AI requests and authenticated database writes are deliberately unavailable in this preview. The TEST-account sign-in button needs the deployed backend; use **Explore demo** for local UI work. Public clinic/catalog reads and a small set of preview fixtures are implemented in `scripts/dev-server.mjs`.

**中文说明：** 本地先使用 **Explore demo** 查看界面和交互。将密钥填入文件不会自动启用本地登录、验证码或 AI；这些功能需要在后端运行环境中绑定数据库并配置密钥。

## 检查与构建 / Check and build

Run from the project root:

```bash
npm test
npm run build
```

- `npm test` runs the automated Node test suite, including API, state, validation and interaction tests. Provider calls in tests use fixtures; passing tests do not demonstrate live hardware or payment processing.
- `npm run build` generates **`dist/server/index.js`**, a Cloudflare Worker ES module with the frontend assets embedded. This generated file can be rebuilt and is excluded from the source export.
- **Do not delete `dist/`.** In this project, most files inside `dist/` are the editable frontend source, not disposable build output. Only `dist/server/` is generated.

## 项目结构 / Project structure

| Path | Contents |
| --- | --- |
| `dist/` | Native JavaScript modules, HTML, CSS and image/SVG assets; main frontend source |
| `worker/index.js` | Backend request routing, AI integration and static asset serving |
| `worker/auth.js` | Accounts, sessions, email verification and isolated TEST sessions |
| `worker/health-data.js` | Pet profiles, devices, health records and hardware telemetry API |
| `worker/vet-feedback.js` | Clinic feedback API |
| `worker/billing.js`, `worker/shop.js` | Retained live-payment backend implementation; not used by the current simulated purchase UI |
| `drizzle/` | Ordered SQLite/D1 schema migrations and migration journal |
| `scripts/` | Local preview server and Worker build script |
| `tests/` | Automated regression tests |
| `docs/` | Hardware, subscription and shop handoff documentation |
| `.env.example` | Configuration checklist with placeholders only; not automatically loaded by the preview |

## 部署完整后端 / Deploy the full app

The backend targets **Cloudflare Workers + D1**. There is no production database or account data in this repository. Before deployment:

1. Create a D1 database and bind it to the Worker as **`AUTH_DB`**.
2. Apply the SQL migrations in `drizzle/` in numeric order, from `0000_pawprint_auth.sql` through `0004_pawprint_shop.sql`. The `meta/_journal.json` file describes the source migration history; it does not prove that a new database has been migrated.
3. Configure runtime secrets and variables using `.env.example` as a checklist. Authentication requires an `AUTH_SECRET` of at least 32 characters; email delivery additionally needs its provider configuration. AI features require their server-side API configuration.
4. Run `npm run build`, then deploy the generated Worker with your own account, bindings and deployment configuration. Serve the frontend and `/api/` routes together over HTTPS.
5. Verify account creation, sign-in, email delivery, AI and device uploads against the new deployment. Update deployment-specific URLs in handoff documentation if the domain changes.

The original Sites identity/configuration is intentionally omitted from this portable export. No Cloudflare account ID or database ID is supplied; use the values belonging to your deployment.

**GitHub Pages 不能直接运行完整后端。** GitHub stores the source. GitHub Pages alone does not run this Worker, D1 database, authentication or AI APIs. Hosting only the static files is not equivalent to deploying the complete app.

## 演示状态 / Demo behaviour

- Shop product: **Pawprint One, CNY 350**. Subscription: **Pawprint Plus, CNY 144/year**.
- The current shop and subscription UI use **simulated checkout**: address → payment method → Pay → **Order Placed**. No payment or recurring charge is made.
- Completing simulated subscription checkout shows Plus as the current plan for that session and removes the repeated-purchase button. Starting a fresh TEST session or reloading resets its demo membership to Free, so the complete purchase flow can be demonstrated again.
- Mock payment/address values stay in the temporary checkout form. A demo receipt is not a real billing entitlement.
- Simulated readings, tutorial examples and TEST data must remain distinguishable from real device readings. Health guidance is not a diagnosis.

## 对接文档 / Integration documents

- [Hardware API · 硬件上传接口、认证和数据格式](docs/hardware-api.md)
- [Subscription checkout and retained payment backend](docs/PAYMENTS.md)
- [Hardware shop and checkout](docs/SHOP.md)

Keep real API keys, device upload tokens, credentials, database exports and customer information out of Git. The example configuration contains no working secrets.
