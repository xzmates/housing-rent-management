const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const [, , serverName, toolName, rawArgs = '{}'] = process.argv;

if (!serverName || !toolName) {
  console.error('Usage: node scripts/call-mcp-tool.js <server> <tool> <json-args>');
  process.exit(2);
}

const root = process.cwd();
const configPath = path.join(root, '.mcp.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const server = config.mcpServers && config.mcpServers[serverName];

if (!server) {
  console.error(`MCP server not found in .mcp.json: ${serverName}`);
  process.exit(2);
}

let toolArgs;
try {
  const argsText = rawArgs.startsWith('@')
    ? fs.readFileSync(path.resolve(root, rawArgs.slice(1)), 'utf8')
    : rawArgs;
  toolArgs = JSON.parse(argsText);
} catch (error) {
  console.error(`Invalid JSON args: ${error.message}`);
  process.exit(2);
}

const child = spawn(server.command, server.args || [], {
  cwd: root,
  env: { ...process.env, ...(server.env || {}) },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32'
});

let nextId = 1;
const pending = new Map();
let buffer = '';
let initialized = false;

function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function handleMessage(message) {
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
}

child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      handleMessage(JSON.parse(trimmed));
    } catch {
      process.stderr.write(`[mcp stdout] ${line}\n`);
    }
  }
});

child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
});

child.on('exit', code => {
  if (!initialized && code !== 0) {
    process.exit(code || 1);
  }
});

async function main() {
  const timeout = setTimeout(() => {
    console.error('MCP call timed out');
    child.kill();
    process.exit(124);
  }, 120000);

  const initResult = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'codex-manual-mcp', version: '0.1.0' }
  });
  initialized = true;
  notify('notifications/initialized', {});

  const tools = await send('tools/list', {});
  const names = (tools.tools || []).map(tool => tool.name);
  if (!names.includes(toolName)) {
    console.error(`Tool not found: ${toolName}`);
    console.error(`Available tools: ${names.join(', ')}`);
    process.exit(3);
  }

  const result = await send('tools/call', {
    name: toolName,
    arguments: toolArgs
  });

  clearTimeout(timeout);
  console.log(JSON.stringify({ initResult, result }, null, 2));
  child.kill();
}

main().catch(error => {
  console.error(error.message);
  child.kill();
  process.exit(1);
});
