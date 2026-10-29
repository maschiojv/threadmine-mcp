# ThreadMine MCP Server

> ThreadMine is a Java thread dump analyzer with AI — detects deadlocks, CPU spikes, pool exhaustion and virtual thread pinning. Free online, no signup.

Official [MCP](https://modelcontextprotocol.io) server for [ThreadMine](https://threadmine.dev). Paste a JVM thread dump into your AI assistant — Claude Code, Claude Desktop or Cursor — and get back the detected problems, a health score and a link to the full interactive report, without leaving the chat.

**No account needed.** Without an API key the server uses the same public endpoint as the [threadmine.dev](https://threadmine.dev) analyzer. With a key, analyses land in your ThreadMine workspace.

## Tools

| Tool | What it does |
|---|---|
| `analyze_thread_dump` | Uploads a thread dump (inline text or file path) and returns detected problems, health score (0-100) and the report link |
| `get_analysis` | Fetches a previous analysis by the id `analyze_thread_dump` returned. Read-only, consumes nothing |

## Setup

**Claude Code plugin** (MCP server plus a skill that tells Claude when to use it)

```bash
claude plugin marketplace add maschiojv/threadmine-mcp
claude plugin install threadmine@threadmine-plugins
```

**Claude Code, server only**

```bash
claude mcp add threadmine -- npx -y @threadmine/mcp
```

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "threadmine": {
      "command": "npx",
      "args": ["-y", "@threadmine/mcp"]
    }
  }
}
```

## With or without an account

| | Without an API key | With `THREADMINE_API_KEY` |
|---|---|---|
| Limit | 5 analyses per hour, 20 per day, per IP | Your plan's quota ([pricing](https://threadmine.dev/en/pricing)) |
| Report | Public link (`threadmine.dev/resultado/...`), anyone with it can open it, expires after 7 days | Private, in your workspace |

To use your account, create an API key in the [web app](https://app.threadmine.dev) (**Settings → API Keys**) and set `THREADMINE_API_KEY` in the server's environment. For the plugin, export it in the shell that starts Claude Code; for the other setups, add it to the `env` block (`"env": { "THREADMINE_API_KEY": "tf_live_xxx" }`) or pass `-e THREADMINE_API_KEY=tf_live_xxx` to `claude mcp add`.

## Usage

Ask your assistant things like:

- *"Analyze this thread dump: `<paste>`"*
- *"Run the dump at /tmp/threaddump.txt through ThreadMine"*
- *"My Spring Boot app stopped answering, here's the jstack output"*
- *"What did analysis `<id>` find? Any deadlocks?"*

## Privacy

The dump is sent to the ThreadMine API over TLS. Thread dumps can carry hostnames, class and package names and SQL fragments. If your policy forbids sending production dumps to a third party, run them through [tm-anon](https://github.com/maschiojv/threadmine-anonymizer) first: it anonymizes the dump locally, keeps the mapping on your machine, and ThreadMine still analyzes the result.

## Notes

- `THREADMINE_API_URL` overrides the API endpoint (self-hosted / staging). `THREADMINE_SITE_URL` overrides the site used in anonymous report links.
- Requires Node.js ≥ 20.

## License

MIT
