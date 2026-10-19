/**
 * dsh-opencode-zen-free
 *
 * 把 OpenCode Zen 的「免费模型」接入 DeepSeek Harness，支持两种额度模式：
 *
 *   - anonymous（默认）：`Authorization: Bearer public` 走公共额度，无需 API key
 *   - private：使用自己的 OpenCode Console API key（oc_sk_...）
 *
 * 链路：
 *   DSH agent-loop
 *     → PiAiAdapter（dsh-llm-pi-ai seam）
 *       → pi-ai provider（openai-completions）
 *         → 本地 loopback shim（127.0.0.1）
 *           → https://opencode.ai/inference/openai/v1
 *
 * shim 承担 pi-ai 做不到的三件事：
 *   1. 补齐免费层要求的请求形态（bash + read 门禁工具、强制 stream、时间戳编码 session）
 *   2. 对上游偶发 5xx 做指数退避重试（pi-ai 默认 2 次不够）
 *   3. 把 bash/read 门禁工具注册成真实可执行工具，避免模型调用被丢弃而脱轨
 *
 * 所有约束均由实测确认，详见 README.md 与 lib/free-tier.js、lib/session-id.js 的注释。
 */
import { createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import z from '@deepseek-ai/schemastery';
import { createOpenCodeShim } from './shim.js';
import { bashToolDefinition, readToolDefinition } from './gate-tools.js';

/** Cordis 插件名。 */
export const name = 'llm-opencode-zen-free';

/** 需要 llm 服务先就绪；注册门禁工具时还需要 tools 服务（可缺省）。 */
export const inject = ['llm'];

/** 上游 OpenAI-兼容 端点。 */
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';

const DEFAULT_CHANNEL = 'latest';
const DEFAULT_CLIENT = 'cli';
const DEFAULT_CLIENT_VERSION = '2.0.32';

/** 匿名公共额度使用的令牌（实测可通，无需账号）。 */
const ANONYMOUS_TOKEN = 'public';

/**
 * 免费模型清单。
 *
 * 上游 models 端点不返回 contextWindow / maxTokens，这里给保守值：
 * 只会让 DSH 的上下文压缩更早触发，不会溢出。
 */
const FREE_MODELS = [
  { id: 'space-bunny-free', name: 'Space Bunny Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'big-pickle', name: 'Big Pickle (stealth)', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'mimo-v2.6-flash-free', name: 'MiMo V2.6 Flash Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'glm-5.3-flash-free', name: 'GLM 5.3 Flash Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'beam-free', name: 'Beam Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free', contextWindow: 200000, maxTokens: 32768, supportsImages: false },
  { id: 'nemotron-3.5-super-vl-free', name: 'Nemotron 3.5 Super VL Free', contextWindow: 200000, maxTokens: 32768, supportsImages: true },
];

/** 插件配置。 */
export const Config = z.object({
  mode: z
    .union([z.const('anonymous'), z.const('private')])
    .default('anonymous')
    .description('anonymous：公共额度免 key；private：使用自己的 Console API key'),
  apiKey: z.string().description('OpenCode Console API key（oc_sk_...）；仅 private 模式使用，留空则读 OPENCODE_API_KEY'),
  baseUrl: z.string().default(DEFAULT_BASE_URL).description('上游 OpenAI-兼容 baseUrl'),
  providerId: z.string().default('opencode-zen-free').description('DSH 模型选择器里的 provider id'),
  displayName: z.string().default('OpenCode Zen 免费模型').description('模型分组显示名'),
  clientName: z.string().default(DEFAULT_CLIENT).description('伪装头 x-opencode-client'),
  clientVersion: z.string().default(DEFAULT_CLIENT_VERSION).description('UA 里的客户端版本'),
  channel: z.string().default(DEFAULT_CHANNEL).description('UA 里的 channel'),
  maxAttempts: z.number().default(12).description('上游瞬时故障最大尝试次数'),
  retryBaseDelayMs: z.number().default(400).description('首次退避毫秒'),
  retryMaxDelayMs: z.number().default(4000).description('退避上限毫秒'),
  streamIdleTimeoutMs: z.number().default(180000).description('流式空闲超时毫秒'),
  registerGateTools: z.boolean().default(true).description('把 bash/read 注册成真实可执行工具'),
});

/** 按模式解析实际使用的 Bearer 令牌。 */
function resolveToken(config) {
  if (config.mode === 'private') {
    return config.apiKey || process.env.OPENCODE_API_KEY || '';
  }
  return ANONYMOUS_TOKEN;
}

/** 把免费模型清单转成 pi-ai 描述，baseUrl 指向本地 shim。 */
function toPiModels(config, shimBaseUrl) {
  return FREE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    api: 'openai-completions',
    provider: config.providerId,
    baseUrl: shimBaseUrl,
    input: m.supportsImages ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    compat: { maxTokensField: 'max_tokens' },
  }));
}

/** 组装 provider + adapter。 */
function createAdapter(config, shim) {
  const buildModels = () => toPiModels(config, shim.baseUrl());

  const provider = {
    ...createProvider({
      id: config.providerId,
      name: config.displayName,
      baseUrl: shim.baseUrl(),
      auth: {
        apiKey: {
          name: 'OpenCode free tier',
          async resolve() {
            const token = resolveToken(config);
            if (!token) return undefined;
            return { auth: { apiKey: token }, source: config.mode === 'anonymous' ? '公共额度' : 'Console key' };
          },
        },
      },
      models: buildModels(),
      api: openAICompletionsApi(),
    }),
    getModels: () => buildModels(),
  };

  const profile = {
    provider: config.providerId,
    displayName: config.displayName,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-opencode-zen-free retryPolicy'),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    piProvider: provider,
  };

  let profiles = new Map([[config.providerId, profile]]);

  return {
    adapter: new PiAiAdapter({
      profiles: () => profiles,
      auth: {
        apiKey: {
          name: 'OpenCode free tier',
          async resolve() {
            const token = resolveToken(config);
            return token
              ? { auth: { apiKey: token }, source: config.mode === 'anonymous' ? '公共额度' : 'Console key' }
              : undefined;
          },
        },
      },
      resolveApiKey: async () => resolveToken(config),
    }),
    invalidate: () => {
      profiles = new Map([[config.providerId, profile]]);
    },
  };
}

/**
 * 把 bash / read 注册为真实工具。
 *
 * 网关要求请求里有这两个名字；只挂名字不实现会让模型去调一个永远执行不了的
 * 工具、整轮被带偏。注册成真工具后：
 *   - 网关校验通过
 *   - 模型调用能真的跑到命令/读到文件
 *
 * 工具层不可用（无 ctx.tools）时静默降级：网关校验仍由 shim 补齐名字。
 */
function registerGateTools(ctx, logger) {
  const registry = ctx.get?.('tools');
  if (!registry || typeof registry.register !== 'function') {
    logger?.warn?.(
      'dsh-opencode-zen-free: 未找到工具注册表，bash/read 将只作为网关所需的占位名注入，模型调用它们会被丢弃',
    );
    return () => {};
  }

  const disposers = [];
  for (const definition of [bashToolDefinition(), readToolDefinition()]) {
    try {
      disposers.push(registry.register(definition));
    } catch (error) {
      logger?.warn?.(`dsh-opencode-zen-free: 注册工具 ${definition.name} 失败：${error.message}`);
    }
  }
  logger?.info?.(`dsh-opencode-zen-free: 已注册门禁工具 ${disposers.length} 个（bash/read）`);

  return () => {
    for (const dispose of disposers) {
      try { dispose?.(); } catch { /* ignore */ }
    }
  };
}

/**
 * Cordis 插件入口。
 *
 * 顺序：注册门禁工具 → 起 shim → 注册 adapter。
 *
 * 不再需要本机装过 OpenCode：`x-opencode-session` 由 shim 按「时间戳编码」
 * 规则本地派生（见 session-id.js），实测与真实会话等价。
 */
export async function apply(ctx, config) {
  const resolved = {
    mode: 'anonymous',
    baseUrl: DEFAULT_BASE_URL,
    providerId: 'opencode-zen-free',
    displayName: 'OpenCode Zen 免费模型',
    clientName: DEFAULT_CLIENT,
    clientVersion: DEFAULT_CLIENT_VERSION,
    channel: DEFAULT_CHANNEL,
    maxAttempts: 12,
    retryBaseDelayMs: 400,
    retryMaxDelayMs: 4000,
    streamIdleTimeoutMs: 180000,
    registerGateTools: true,
    ...(config ?? {}),
  };

  const token = resolveToken(resolved);
  if (!token) {
    ctx.logger.warn(
      'dsh-opencode-zen-free: private 模式但未提供 apiKey（也未设 OPENCODE_API_KEY），所有请求会 401',
    );
  }

  // 门禁工具优先注册，这样模型真调用时能执行
  const disposeGateTools = resolved.registerGateTools ? registerGateTools(ctx, ctx.logger) : () => {};

  const shim = createOpenCodeShim({
    getApiKey: () => resolveToken(resolved),
    upstreamBase: resolved.baseUrl,
    maxAttempts: resolved.maxAttempts,
    baseDelayMs: resolved.retryBaseDelayMs,
    maxDelayMs: resolved.retryMaxDelayMs,
    logger: ctx.logger,
  });

  try {
    await shim.start();
  } catch (error) {
    ctx.logger.error('dsh-opencode-zen-free: loopback shim 启动失败', error);
    disposeGateTools();
    return;
  }

  const runtime = createAdapter(resolved, shim);
  const release = ctx.llm.registerAdapter([resolved.providerId], runtime.adapter);

  ctx.effect(() => () => {
    release();
    disposeGateTools();
    shim.close();
  });

  ctx.logger.info(
    `dsh-opencode-zen-free: 已注册 "${resolved.providerId}"（${resolved.displayName}），` +
      `${FREE_MODELS.length} 个免费模型；模式=${resolved.mode}；端点=${resolved.baseUrl}`,
  );
}
