#!/usr/bin/env node
// ToolSocket CLI — discover, inspect and run 660+ agent tools from the shell,
// or bridge the remote MCP server to stdio. Zero dependencies, Node 18+.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const CONFIG_DIR = process.env.TOOLSOCKET_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "toolsocket");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ───────── config
function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); } catch { return {}; }
}
function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}
const cfg = loadConfig();
const BASE = (process.env.TOOLSOCKET_URL ?? cfg.url ?? "https://toolsocket.top").replace(/\/$/, "");
const KEY = process.env.TOOLSOCKET_API_KEY ?? cfg.key ?? "";

// ───────── args
const argv = process.argv.slice(2);
const flags = { json: false, inputs: [], rest: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json" || a === "-j") flags.json = true;
  else if (a === "-i" || a === "--input") flags.inputs.push(argv[++i] ?? "");
  else if (a === "--wait" || a === "-w") flags.wait = Number(argv[++i]);
  else if (a === "--limit" || a === "-n") flags.limit = Number(argv[++i]);
  else if (a === "--key") flags.key = argv[++i];
  else if (a === "-h" || a === "--help") flags.help = true;
  else if (a === "-v" || a === "--version") flags.version = true;
  else flags.rest.push(a);
}
const [cmd, ...args] = flags.rest;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), orange = c("38;5;208"), green = c(32), red = c(31);

function die(msg, code = 1) {
  if (flags.json) process.stdout.write(JSON.stringify({ error: msg }) + "\n");
  else process.stderr.write(`${red("error")} ${msg}\n`);
  process.exit(code);
}
const out = (human, data) => process.stdout.write((flags.json ? JSON.stringify(data, null, 2) : human) + "\n");

// ───────── http
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { accept: "application/json", "user-agent": `toolsocket-cli/${VERSION}`, "x-toolsocket-client": "cli" };
  if (body) headers["content-type"] = "application/json";
  if (auth && KEY) headers.authorization = `Bearer ${KEY}`;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    die(`cannot reach ${BASE} (${e.cause?.code ?? e.message})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 202) {
    const hint = res.status === 401 ? `\n  ${dim("Run `toolsocket login` with a key from " + BASE + "/console")}`
      : res.status === 402 ? `\n  ${dim("Top up at " + BASE + "/console")}` : "";
    const details = Array.isArray(data.details) ? `\n  ${data.details.map((d) => (typeof d === "string" ? d : `${d.path ?? d.field ?? ""} ${d.message ?? JSON.stringify(d)}`.trim())).join("\n  ")}` : "";
    die(`${res.status} ${data.error ?? ""} ${data.message ?? ""}`.trim() + details + hint, res.status === 402 ? 3 : 1);
  }
  return data;
}

// "-i city=Tokyo -i days=2" or "-i '{...}'" or "-i @input.json"
function parseInputs(list) {
  let input = {};
  for (const raw of list) {
    if (raw.startsWith("@")) Object.assign(input, JSON.parse(readFileSync(raw.slice(1), "utf8")));
    else if (raw.trim().startsWith("{")) Object.assign(input, JSON.parse(raw));
    else {
      const eq = raw.indexOf("=");
      if (eq < 1) die(`bad input "${raw}" — use key=value, a JSON object, or @file.json`);
      const k = raw.slice(0, eq), v = raw.slice(eq + 1);
      try { input[k] = JSON.parse(v); } catch { input[k] = v; }
    }
  }
  return input;
}
const usd = (n) => (n === 0 ? "free" : money(n));
const money = (n) => `$${Number(n ?? 0).toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;

// ───────── commands
const HELP = `${bold("toolsocket")} ${dim(VERSION)} — 660+ tools for AI agents, one API key

${bold("Usage")}
  toolsocket login [--key ts_live_…]     save your API key (from ${BASE}/console)
  toolsocket discover <query> [-n 10]    search tools in plain language (English or 中文)
  toolsocket inspect <tool>              description, input schema and example
  toolsocket run <tool> [-i k=v]…        run a tool; -i accepts k=v, '{json}' or @file.json
  toolsocket get <run_id>                fetch a run's status and output
  toolsocket balance                     account balance and today's spend
  toolsocket mcp                         stdio ⇄ remote MCP bridge for stdio-only clients
  toolsocket logout                      forget the saved key

${bold("Options")}
  -j, --json      machine-readable output        -w, --wait <s>   seconds to wait (run, get)
  -h, --help      this help                      -v, --version    print version

${bold("Environment")}
  TOOLSOCKET_API_KEY   overrides the saved key   TOOLSOCKET_URL   default ${dim("https://toolsocket.top")}

${bold("Examples")}
  toolsocket discover "douyin hot search"
  toolsocket run openmeteo#forecast -i city=Tokyo -i days=2
  toolsocket run tiktok#app/v3/fetch_user_post_videos -i unique_id=nasa --json

Docs: ${BASE}/docs`;

async function login() {
  let key = flags.key ?? args[0];
  if (!key) {
    if (!process.stdin.isTTY) key = readFileSync(0, "utf8").trim();
    else {
      process.stdout.write(`Paste your API key from ${BASE}/console ${dim("(input hidden)")}: `);
      key = await readHidden();
    }
  }
  key = String(key ?? "").trim();
  if (!key.startsWith("ts_live_")) die("that doesn't look like a ToolSocket key (it starts with ts_live_)");
  const res = await fetch(`${BASE}/v1/me`, { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
  if (!res) die(`cannot reach ${BASE}`);
  if (res.status === 401) die("this key is invalid or revoked");
  const me = await res.json();
  saveConfig({ ...cfg, key });
  out(`${green("✓")} logged in as ${bold(me.user.email)} · balance ${bold(money(me.user.balanceUsd))}\n  ${dim("key saved to " + CONFIG_FILE)}`, { ok: true, email: me.user.email, balanceUsd: me.user.balanceUsd });
}
function readHidden() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {};
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function discover() {
  const q = args.join(" ").trim();
  if (!q) die("usage: toolsocket discover <query>");
  const d = await api(`/v1/discover?q=${encodeURIComponent(q)}&limit=${flags.limit || 10}`, { auth: false });
  if (flags.json) return out("", d);
  if (!d.results?.length) return out(dim(`no tools match "${q}"`));
  const rows = d.results.map((t) => [orange(t.id), usd(t.price?.usd ?? 0), t.health?.status ?? "", t.summary ?? t.name ?? ""]);
  const w = Math.min(48, Math.max(...d.results.map((t) => t.id.length)));
  out(rows.map(([id, p, h, s]) => `${id}${" ".repeat(Math.max(1, w - stripAnsi(id).length + 2))}${p.padEnd(9)}${dim(h.padEnd(9))}${s}`).join("\n") + `\n\n${dim("next: toolsocket inspect <tool>")}`);
}
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

async function inspect() {
  const tool = args[0];
  if (!tool) die("usage: toolsocket inspect <tool>");
  const d = await api(`/v1/inspect?tool=${encodeURIComponent(tool)}`, { auth: false });
  if (flags.json) return out("", d);
  const props = d.input?.properties ?? {};
  const req = new Set(d.input?.required ?? []);
  const lines = [
    `${bold(d.name)}  ${orange(d.id)}  ${usd(d.price?.usd ?? 0)} / ${d.price?.model === "per_result" ? "result" : "call"}`,
    d.description || d.summary || "",
    "",
    bold("Input"),
    ...Object.entries(props).map(([k, s]) => `  ${req.has(k) ? bold(k) : k}${req.has(k) ? red("*") : ""}  ${dim(s.type ?? "")}${s.default !== undefined ? dim(` = ${JSON.stringify(s.default)}`) : ""}${s.description ? `  ${s.description}` : ""}`),
  ];
  if (d.example) lines.push("", bold("Example"), `  toolsocket run ${d.id} ${Object.entries(d.example).map(([k, v]) => `-i ${k}=${typeof v === "string" ? shellQuote(v) : JSON.stringify(v)}`).join(" ")}`);
  if (d.hints?.length) lines.push("", ...d.hints.map((h) => dim(`· ${h}`)));
  out(lines.join("\n"));
}
const shellQuote = (s) => (/^[\w@.\/:+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

async function run() {
  const tool = args[0];
  if (!tool) die("usage: toolsocket run <tool> [-i key=value]…");
  const input = parseInputs(flags.inputs);
  let r = await api("/v1/run", { method: "POST", body: { tool, input, wait: flags.wait ?? 60 } });
  while (r.status === "RUNNING" || r.status === "PENDING") r = await api(`/v1/runs/${r.id}?wait=30`);
  printRun(r);
}
async function get() {
  const id = args[0];
  if (!id) die("usage: toolsocket get <run_id>");
  printRun(await api(`/v1/runs/${encodeURIComponent(id)}?wait=${flags.wait ?? 0}`));
}
function printRun(r) {
  if (flags.json) return out("", r);
  const ok = r.status === "COMPLETED";
  const cost = r.cost ? (r.cost.charged ? `$${r.cost.usd}` : "not charged") : "";
  process.stderr.write(`${ok ? green("✓") : red("✗")} ${r.status} ${dim(`${r.tool} · ${r.durationMs ?? "?"}ms · ${cost} · ${r.id}`)}\n`);
  if (r.error) process.stderr.write(`${red(typeof r.error === "string" ? r.error : JSON.stringify(r.error))}\n`);
  if (r.output !== undefined && r.output !== null) process.stdout.write(JSON.stringify(r.output, null, 2) + "\n");
  if (!ok) process.exitCode = 2;
}

async function balance() {
  if (!KEY) die("not logged in — run `toolsocket login`");
  const d = await api("/v1/me");
  const u = d.user;
  out(`${bold(u.email)}\n  balance      ${bold(money(u.balanceUsd))}\n  spent today  ${money(u.spentTodayUsd)}${u.dailyLimitUsd != null ? dim(` / limit ${money(u.dailyLimitUsd)}`) : ""}\n  ${dim("top up: " + BASE + "/console")}`,
    { email: u.email, balanceUsd: u.balanceUsd, spentTodayUsd: u.spentTodayUsd, dailyLimitUsd: u.dailyLimitUsd });
}

function logout() {
  if (existsSync(CONFIG_FILE)) {
    const { key, ...rest } = cfg;
    Object.keys(rest).length ? saveConfig(rest) : rmSync(CONFIG_FILE);
  }
  out(`${green("✓")} key removed`, { ok: true });
}

// stdio ⇄ Streamable HTTP. One JSON-RPC message per line in, one per line out.
async function mcp() {
  if (!KEY) {
    process.stderr.write("toolsocket mcp: no API key. Set TOOLSOCKET_API_KEY or run `toolsocket login`.\n");
    process.exit(1);
  }
  let session = null;
  const send = async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "user-agent": `toolsocket-cli/${VERSION}` };
    if (session) headers["mcp-session-id"] = session;
    try {
      const res = await fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(180_000) });
      session = res.headers.get("mcp-session-id") ?? session;
      if (res.status === 202 || res.status === 204) return;
      const text = await res.text();
      if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
        for (const l of text.split("\n")) if (l.startsWith("data:")) emit(l.slice(5).trim());
      } else if (res.ok) emit(text);
      else replyError(msg, `ToolSocket ${res.status}: ${text.slice(0, 300)}`);
    } catch (e) {
      replyError(msg, `ToolSocket unreachable: ${e.message}`);
    }
  };
  const emit = (s) => {
    if (!s) return;
    try { process.stdout.write(JSON.stringify(JSON.parse(s)) + "\n"); } catch {}
  };
  const replyError = (msg, message) => {
    const ids = (Array.isArray(msg) ? msg : [msg]).filter((m) => m && m.id !== undefined).map((m) => m.id);
    for (const id of ids) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
  };
  const rl = createInterface({ input: process.stdin });
  const pending = new Set();
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const p = send(line).finally(() => pending.delete(p));
    pending.add(p);
  });
  rl.on("close", async () => {
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}

// ───────── main
if (flags.version) { out(VERSION, { version: VERSION }); process.exit(0); }
if (flags.help || !cmd || cmd === "help") { out(HELP, { commands: ["login", "discover", "inspect", "run", "get", "balance", "mcp", "logout"] }); process.exit(0); }
const COMMANDS = { login, discover, search: discover, inspect, run, get, balance, whoami: balance, mcp, logout };
if (!COMMANDS[cmd]) die(`unknown command "${cmd}" — try \`toolsocket --help\``);
await COMMANDS[cmd]();
