/**
 * 网关门禁工具（gate tools）：`bash` 与 `read`。
 *
 * 免费层网关要求请求体里出现名为 `bash` 和 `read` 的 function 工具，
 * 否则返回 500（空 body）。只挂名字不实现比不挂更糟——模型会去调一个
 * 永远无法执行的工具，整轮对话被带偏。
 *
 * 所以这里把它们注册成**真实可执行**的工具：
 *   - 网关看到它要求的两个名字（校验通过）
 *   - 模型调 `bash` 真的能跑命令，调 `read` 真的能读文件
 *   - 不会出现「模型调用被静默丢弃」的脱轨
 *
 * 这份实现刻意保持精简（exec + readFile），不依赖宿主工具服务，
 * 因此即使 DSH 的工具层不可用，网关校验仍能通过。
 */
import { exec } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 单次工具结果上限，避免一次输出吞掉整个上下文。 */
const MAX_OUTPUT_BYTES = 64000;

/** 命令执行超时。 */
const COMMAND_TIMEOUT_MS = 120000;

/** 截断过长文本并注明。 */
function clip(text) {
  const s = String(text ?? '');
  if (Buffer.byteLength(s) <= MAX_OUTPUT_BYTES) return s;
  return `${s.slice(0, MAX_OUTPUT_BYTES)}\n…(输出已截断)`;
}

/**
 * 执行一条 shell 命令。
 *
 * @param {string} command 要执行的命令
 * @param {string} [cwd] 工作目录
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runShell(command, cwd) {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: typeof cwd === 'string' && cwd !== '' ? cwd : undefined,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

/**
 * 读取文件或目录，每行加 1-based 行号前缀（与 OpenCode 的 read 行为一致）。
 *
 * @param {string} target 文件或目录路径
 * @param {{offset?: number, limit?: number}} [options]
 * @returns {Promise<string>}
 */
async function readPath(target, options = {}) {
  const { offset, limit } = options;
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    return `read: ${target}: ${error.code === 'ENOENT' ? '不存在' : error.message}`;
  }

  if (info.isDirectory()) {
    const entries = (await readdir(target)).sort();
    const start = Math.max(1, Number(offset) || 1) - 1;
    const take = Number(limit) > 0 ? Number(limit) : entries.length;
    return clip(entries.slice(start, start + take).map((name, i) => `${start + i + 1}: ${name}`).join('\n'));
  }

  let text;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    return `read: ${target}: ${error.message}`;
  }
  // 二进制文件回退成一句说明，避免把乱码塞进上下文
  if (text.includes('\u0000')) return `read: ${target}: 二进制文件，未展开`;

  const lines = text.split('\n');
  const start = Math.max(1, Number(offset) || 1) - 1;
  const take = Number(limit) > 0 ? Number(limit) : 2000;
  return clip(
    lines
      .slice(start, start + take)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n'),
  );
}

/** 工具返回值的统一渲染：一个 text 块。 */
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
};

/** `bash` 工具定义。 */
export function bashToolDefinition() {
  return {
    name: 'bash',
    description:
      '执行一条 shell 命令并返回退出码与输出。用于查看文件（sed/grep/wc/git）以及构建和测试。' +
      '工作目录默认继承当前进程。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '命令的工作目录' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      const command = String(args?.command ?? '');
      if (command === '') return 'bash: 未提供 command';
      const { code, stdout, stderr } = await runShell(command, args?.cwd);
      const body = [stdout, stderr].filter((part) => part !== '').join('\n');
      return `${clip(body)}\n[exit ${code}]`;
    },
  };
}

/** `read` 工具定义。 */
export function readToolDefinition() {
  return {
    name: 'read',
    description:
      '读取文件或目录内容。文本每行前加 1-based 行号前缀（前缀仅用于定位，不属于文件内容）。' +
      '目录按行列出条目。大文件可用 offset 与 limit 分批读取。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要读取的文件或目录' },
        offset: { type: 'integer', minimum: 0, description: '起始行或目录项（1-based）' },
        limit: { type: 'integer', minimum: 0, description: '最多读取的行数或目录项数' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      const target = String(args?.path ?? '');
      if (target === '') return 'read: 未提供 path';
      return readPath(path.resolve(target), { offset: args?.offset, limit: args?.limit });
    },
  };
}

/**
 * 网关必需的工具名。
 *
 * 实测：body 里没有这两个名字就会 500；名字齐了才 200。
 */
export const GATE_TOOL_NAMES = ['bash', 'read'];

/**
 * 往请求体的 tools 数组里补齐网关要求的两个工具。
 *
 * DSH 自己的工具集里可能已有同名工具（不同 schema），此时保持原样不动——
 * 网关只要名字在就行，而替换掉调用方自己的工具反而会破坏它的语义。
 *
 * @param {unknown} tools 客户端提供的 tools
 * @returns {Array<object>} 补齐后的 tools
 */
export function ensureGateTools(tools) {
  const list = Array.isArray(tools) ? [...tools] : [];
  const present = new Set(
    list
      .filter((t) => t && t.type === 'function' && t.function && typeof t.function.name === 'string')
      .map((t) => t.function.name),
  );

  for (const name of GATE_TOOL_NAMES) {
    if (present.has(name)) continue;
    const def = name === 'bash' ? bashToolDefinition() : readToolDefinition();
    list.push({
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.parameters,
        strict: false,
      },
    });
  }
  return list;
}
