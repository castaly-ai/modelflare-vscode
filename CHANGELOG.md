# Changelog

## 0.1.1

- Extension ID is now `modelflare.modelflare-vscode`; the name `modelflare` is taken on the VS Code Marketplace. Commands and settings are unchanged. If you installed 0.1.0, run "Manage Modelflare API Key" once: VS Code keeps secrets per extension ID.

## 0.1.0

- Modelflare language model provider for the VS Code chat model picker.
- Text models loaded from the key's `GET /v1/models`; streaming and tool calling.
- Smart API Key stored in secret storage; global and China base URLs.
