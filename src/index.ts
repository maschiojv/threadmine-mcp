#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'

const server = buildServer({
  apiKey: process.env.THREADMINE_API_KEY,
  apiBaseUrl: process.env.THREADMINE_API_URL ?? 'https://api.threadmine.dev',
  appBaseUrl: process.env.THREADMINE_APP_URL ?? 'https://app.threadmine.dev',
})

await server.connect(new StdioServerTransport())
console.error('ThreadMine MCP server running on stdio')
