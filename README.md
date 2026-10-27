# ToolSocket

**660+ data tools for AI agents. One API key. Pay per call.**

TikTok · Douyin · Instagram · YouTube · X · Reddit · Weibo · Bilibili · Zhihu · Kuaishou · Threads · LinkedIn · GitHub · Wikipedia · weather · FX · crypto …

ToolSocket is a remote [MCP](https://modelcontextprotocol.io) server plus a REST API. Your agent searches the catalog, inspects a tool's schema, and runs it. Every call is paid from one prepaid balance. You don't need an account with each platform, and there's no subscription.

This repository is the open-source **CLI** and **stdio MCP bridge**. The server lives at `https://toolsocket.top`.

---

## Connect your agent (no install needed)

The MCP endpoint is:

```
https://toolsocket.top/mcp
```

| Client | How |
|---|---|
| **Claude.ai / Claude Desktop** | Settings → Connectors → *Add custom connector* → paste the URL → sign in → **Allow** |
| **ChatGPT** | Settings → Apps & Connectors → Developer mode → *Create* → paste the URL, auth **OAuth** |
| **Claude Code** | `claude mcp add --transport http toolsocket https://toolsocket.top/mcp`, then `/mcp` → *Authenticate* |
| **Cursor / VS Code / Windsurf / Codex** | copy-paste configs at **[toolsocket.top/docs](https://toolsocket.top/docs)** |

OAuth clients only need a sign-in. Clients that take headers can use an API key from the [Console](https://toolsocket.top/console) instead: `Authorization: Bearer ts_live_…`.

## CLI

```bash
npx -y toolsocket login                      # paste a ts_live_ key from toolsocket.top/console
npx -y toolsocket discover "douyin hot search"
npx -y toolsocket inspect openmeteo#forecast
npx -y toolsocket run openmeteo#forecast -i city=Tokyo -i days=2
npx -y toolsocket balance
```

Or install it globally with `npm i -g toolsocket`.

| Command | |
|---|---|
| `login [--key …]` | Save your API key to `~/.config/toolsocket/config.json` (mode 600) |
| `discover <query> [-n 10]` | Plain-language search, in English or 中文 |
| `inspect <tool>` | Description, input schema, example |
| `run <tool> [-i k=v]…` | Run a tool. `-i` takes `k=v`, `'{"json":true}'` or `@file.json` |
| `get <run_id>` | Fetch a run that is still in progress |
| `balance` | Balance and today's spend |
| `mcp` | stdio ⇄ remote MCP bridge (see below) |
| `logout` | Forget the saved key |

Add `--json` to any command to get machine-readable output. Exit codes: `0` ok, `1` error, `2` the run failed, `3` balance too low.

Environment variables: `TOOLSOCKET_API_KEY` overrides the saved key. `TOOLSOCKET_URL` points the CLI at another server.

## stdio MCP bridge

Some clients can only launch a local command (Cline, Zed, older Claude Desktop configs). For those, add:

```json
{
  "mcpServers": {
    "toolsocket": {
      "command": "npx",
      "args": ["-y", "toolsocket", "mcp"],
      "env": { "TOOLSOCKET_API_KEY": "ts_live_…" }
    }
  }
}
```

## The four MCP tools

Your agent sees four meta-tools, not 660 tool definitions, so its context stays small:

| Tool | Does |
|---|---|
| `discover_tools(query, limit?)` | Ranked search with price and live health |
| `inspect_tool(tool)` | Full description, input JSON Schema, example |
| `run_tool(tool, input)` | Runs the tool; waits up to 30 s, otherwise returns a run id |
| `get_run(run_id)` | Status and output of a run |

## Pricing

- Social-platform data costs mostly **$0.0015 per call**. Open-data tools are **free**.
- Each tool shows its price before you run it.
- Upstream errors and timeouts are refunded automatically.
- You can set daily and per-key spend limits in the Console.

## Development

The CLI has zero dependencies and is a single file: `bin/toolsocket.js`.

```bash
node bin/toolsocket.js --help
TOOLSOCKET_URL=http://127.0.0.1:8091 node bin/toolsocket.js discover weather
```

## License

MIT
