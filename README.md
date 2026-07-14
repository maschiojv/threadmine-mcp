# ThreadMine MCP Server

> ThreadMine is a Java thread dump analyzer with AI — detects deadlocks, CPU spikes, pool exhaustion and virtual thread pinning. Free online, no signup.

Official [MCP](https://modelcontextprotocol.io) server for [ThreadMine](https://threadmine.dev). Paste a JVM thread dump into your AI assistant — Claude Code, Claude Desktop or Cursor — and get back the detected problems, a health score and a link to the full interactive report, without leaving the chat.

## Tools

| Tool | What it does | Quota |
|---|---|---|
| `analyze_thread_dump` | Uploads a thread dump (inline text or file path) and returns detected problems, health score (0-100) and the report link | Consumes 1 analysis from your daily quota |
| `get_analysis` | Fetches a previous analysis by id | Free (read-only) |

## Setup

1. Create a free account at [threadmine.dev](https://threadmine.dev).
2. Create an API key: **Settings → API Keys** in the [web app](https://app.threadmine.dev).
3. Add the server to your assistant:

**Claude Code**

```bash
claude mcp add threadmine -e THREADMINE_API_KEY=tf_live_xxx -- npx -y @threadmine/mcp
```

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "threadmine": {
      "command": "npx",
      "args": ["-y", "@threadmine/mcp"],
      "env": { "THREADMINE_API_KEY": "tf_live_xxx" }
    }
  }
}
```

## Usage

Ask your assistant things like:

- *"Analyze this thread dump: `<paste>`"*
- *"Run the dump at /tmp/threaddump.txt through ThreadMine"*
- *"What did analysis `<id>` find? Any deadlocks?"*

## Notes

- Analyses run in the workspace the API key belongs to and count against that workspace's plan quota (the Free plan includes a daily quota — [pricing](https://threadmine.dev/pricing)).
- `THREADMINE_API_URL` can override the API endpoint (self-hosted / staging).
- Requires Node.js ≥ 20.

## License

MIT
