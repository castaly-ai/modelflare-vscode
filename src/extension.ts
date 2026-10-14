import {
  ModelDirectory,
  ModelflareClient,
  SMART_KEY_HINT,
  describeError,
  isModelflareError,
  signUpUrl,
  streamChatCompletion,
  type ClassifiedModel,
  type Locale,
} from '@modelflare/core'
import * as vscode from 'vscode'

const VENDOR = 'modelflare'
const SECRET_KEY = 'modelflare.apiKey'
const ATTRIBUTION_PLUGIN = 'modelflare-vscode'
const UTM_SOURCE = 'vscode'
const VERSION = __MODELFLARE_PLUGIN_VERSION__

// Modelflare does not publish per-model context limits; these are the budget
// VS Code uses when it trims a conversation.
const MAX_INPUT_TOKENS = 128_000
const MAX_OUTPUT_TOKENS = 16_384

const locale: Locale = vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'

const copy = {
  en: {
    prompt: 'Enter your Modelflare Smart API Key',
    getKey: 'Get a Smart API Key',
    saved: 'Modelflare API key saved.',
    cleared: 'Modelflare API key removed.',
    remove: 'Remove the saved key',
    setKey: 'Set or replace the API key',
  },
  zh: {
    prompt: '输入你的 Modelflare Smart API Key',
    getKey: '获取 Smart API Key',
    saved: 'Modelflare API Key 已保存。',
    cleared: 'Modelflare API Key 已删除。',
    remove: '删除已保存的 Key',
    setKey: '设置或替换 API Key',
  },
}[locale]

interface ModelflareChatInformation extends vscode.LanguageModelChatInformation {
  readonly modelId: string
}

type ChatMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string | null; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function textOf(parts: ReadonlyArray<unknown>): string {
  return parts
    .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : typeof part === 'string' ? part : ''))
    .join('')
}

function toOpenAIMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const message of messages) {
    const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user'
    let text = ''
    const toolCalls: unknown[] = []
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({ id: part.callId, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } })
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        result.push({ role: 'tool', tool_call_id: part.callId, content: textOf(part.content) })
      }
    }
    if (text || toolCalls.length > 0) {
      result.push({ role, content: text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) })
    }
  }
  return result
}

function toInformation(model: ClassifiedModel): ModelflareChatInformation {
  return {
    id: model.id,
    modelId: model.id,
    name: model.id,
    family: model.id,
    version: '1',
    detail: 'Modelflare',
    tooltip: `${model.id} via Modelflare`,
    maxInputTokens: MAX_INPUT_TOKENS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    capabilities: { toolCalling: true, imageInput: false },
  }
}

class ModelflareChatProvider implements vscode.LanguageModelChatProvider<ModelflareChatInformation> {
  readonly #changed = new vscode.EventEmitter<void>()
  readonly onDidChangeLanguageModelChatInformation = this.#changed.event
  #client: ModelflareClient | undefined
  #directory: ModelDirectory | undefined

  constructor(private readonly secrets: vscode.SecretStorage) {}

  reset(): void {
    this.#client = undefined
    this.#directory = undefined
    this.#changed.fire()
  }

  async #ensure(): Promise<{ client: ModelflareClient; directory: ModelDirectory } | undefined> {
    if (this.#client && this.#directory) return { client: this.#client, directory: this.#directory }
    const apiKey = await this.secrets.get(SECRET_KEY)
    if (!apiKey) return undefined
    const baseUrl = vscode.workspace.getConfiguration('modelflare').get<string>('baseUrl') || 'global'
    this.#client = new ModelflareClient({ apiKey, baseUrl, plugin: ATTRIBUTION_PLUGIN, version: VERSION })
    this.#directory = new ModelDirectory({ client: this.#client })
    return { client: this.#client, directory: this.#directory }
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<ModelflareChatInformation[]> {
    let session = await this.#ensure()
    if (!session && !options.silent) {
      await promptForKey(this.secrets)
      session = await this.#ensure()
    }
    if (!session) return []
    const controller = new AbortController()
    const subscription = token.onCancellationRequested(() => controller.abort())
    try {
      const snapshot = await session.directory.load({ signal: controller.signal })
      return snapshot.models
        .filter((model) => model.kind === 'text' && model.endpoints.includes('openai'))
        .map(toInformation)
    } catch (error) {
      if (!options.silent) void vscode.window.showErrorMessage(await this.#describe(error))
      return []
    } finally {
      subscription.dispose()
    }
  }

  async provideLanguageModelChatResponse(
    model: ModelflareChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const session = await this.#ensure()
    if (!session) throw new Error(`${SMART_KEY_HINT[locale]} ${signUpUrl(UTM_SOURCE)}`)
    const controller = new AbortController()
    const subscription = token.onCancellationRequested(() => controller.abort())
    const tools = (options.tools ?? []).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      },
    }))
    try {
      const events = streamChatCompletion(
        session.client,
        {
          model: model.modelId,
          messages: toOpenAIMessages(messages),
          max_tokens: MAX_OUTPUT_TOKENS,
          ...(tools.length > 0
            ? { tools, tool_choice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto' }
            : {}),
        },
        controller.signal,
      )
      for await (const event of events) {
        if (event.type === 'text') {
          progress.report(new vscode.LanguageModelTextPart(event.text))
        } else if (event.type === 'tool_call') {
          let input: object = {}
          try {
            input = event.arguments ? (JSON.parse(event.arguments) as object) : {}
          } catch {
            input = { raw: event.arguments }
          }
          progress.report(new vscode.LanguageModelToolCallPart(event.id, event.name, input))
        }
      }
    } catch (error) {
      if (token.isCancellationRequested) return
      throw new Error(await this.#describe(error, model.modelId))
    } finally {
      subscription.dispose()
    }
  }

  async provideTokenCount(
    _model: ModelflareChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
  ): Promise<number> {
    const value = typeof text === 'string' ? text : textOf(text.content)
    // Rough estimate; Modelflare bills from the upstream usage, not from this.
    return Math.ceil(value.length / 4)
  }

  async #describe(error: unknown, modelId?: string): Promise<string> {
    if (!isModelflareError(error)) return error instanceof Error ? error.message : String(error)
    let modelListed: boolean | undefined
    if (error.kind === 'model_not_found' && modelId && this.#directory) {
      modelListed = await this.#directory.isListed(modelId).catch(() => undefined)
    }
    return describeError(error, { locale, utmSource: UTM_SOURCE, ...(modelListed !== undefined ? { modelListed } : {}) })
  }
}

async function promptForKey(secrets: vscode.SecretStorage): Promise<boolean> {
  const getKey: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('link-external'), tooltip: copy.getKey }
  const input = vscode.window.createInputBox()
  input.title = 'Modelflare'
  input.prompt = SMART_KEY_HINT[locale]
  input.placeholder = copy.prompt
  input.password = true
  input.ignoreFocusOut = true
  input.buttons = [getKey]
  const value = await new Promise<string | undefined>((resolve) => {
    input.onDidTriggerButton(() => void vscode.env.openExternal(vscode.Uri.parse(signUpUrl(UTM_SOURCE))))
    input.onDidAccept(() => {
      resolve(input.value.trim())
      input.hide()
    })
    input.onDidHide(() => resolve(undefined))
    input.show()
  })
  input.dispose()
  if (!value) return false
  await secrets.store(SECRET_KEY, value)
  void vscode.window.showInformationMessage(copy.saved)
  return true
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ModelflareChatProvider(context.secrets)
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
    vscode.commands.registerCommand('modelflare.manage', async () => {
      const hasKey = Boolean(await context.secrets.get(SECRET_KEY))
      const choice = hasKey
        ? await vscode.window.showQuickPick([copy.setKey, copy.remove], { title: 'Modelflare' })
        : copy.setKey
      if (choice === copy.remove) {
        await context.secrets.delete(SECRET_KEY)
        void vscode.window.showInformationMessage(copy.cleared)
        provider.reset()
      } else if (choice === copy.setKey && (await promptForKey(context.secrets))) {
        provider.reset()
      }
    }),
    vscode.commands.registerCommand('modelflare.refreshModels', () => provider.reset()),
    context.secrets.onDidChange((event) => {
      if (event.key === SECRET_KEY) provider.reset()
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('modelflare.baseUrl')) provider.reset()
    }),
  )
}

export function deactivate(): void {}
