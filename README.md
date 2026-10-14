# Modelflare for VS Code

Use every model available to your Modelflare **Smart API Key** — GPT, Claude, Gemini and more — in the VS Code chat model picker. Bring your own key; no Copilot subscription is required for BYOK models.

一个 Modelflare **Smart API Key**，在 VS Code 聊天的模型选择器里调用你账号可用的全部模型。

## Get a Smart API Key / 获取 Smart API Key

1. Sign up / 注册: https://modelflare.dev/sign-up?utm_source=vscode&utm_medium=plugin&utm_campaign=integrations
2. Console → API Keys → **Create Smart API Key**, and pick a routing strategy (Balanced / Stability first / Low price first). You can change the strategy on the key at any time.

   控制台 API Keys →「Create Smart API Key」，选择路由策略（均衡 / 稳定优先 / 低价优先），之后可随时在 Key 设置里修改。

## Configure / 配置

1. Open the chat model picker → **Manage Models** → **Modelflare**, or run **Modelflare: Manage Modelflare API Key** from the Command Palette.
2. Paste your Smart API Key. It is stored in VS Code's secret storage, never in settings.
3. Pick a Modelflare model in the chat model picker.

| Setting | Value |
|---|---|
| API key | your Smart API Key (secret storage) |
| `modelflare.baseUrl` | `global` → https://modelflare.dev/v1 (default) · `china` → https://origin.modelflare.dev/v1 · or a custom URL |

## Features / 功能

- Text models available to your key, loaded from `GET /v1/models`; new models appear without editing the key. Run **Modelflare: Refresh Modelflare Models** to reload.
- Streaming responses and tool calling for agent mode.
- Routing across groups, fallback and the routing strategy are handled by the Smart API Key on the server.
- Requests are billed by the group that served them; see the usage logs at https://modelflare.dev/usage-logs.

## Troubleshooting / 常见问题

- **401**: the key is missing or invalid. Create a Smart API Key at https://modelflare.dev/keys.
- **`model_not_found`**: a regular key only calls the models of its own group. A Smart API Key calls every model available to your account. If you already use a Smart API Key, that model is not available to your account right now.
- **403 `insufficient_user_quota`**: top up at https://modelflare.dev/billing.

## Links

Docs: https://docs.modelflare.dev/ · Pricing: https://modelflare.dev/pricing

## License

MIT © Havenbyte LLC
