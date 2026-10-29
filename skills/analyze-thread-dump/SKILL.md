---
name: analyze-thread-dump
description: Analyzes JVM thread dumps with ThreadMine to find deadlocks, exhausted thread or connection pools, CPU-bound threads, stuck requests and virtual thread pinning. Use when the user pastes or points to a Java thread dump (jstack, jcmd Thread.print, kill -3, Thread.dump_to_file), or when a Java/Kotlin/Spring Boot app hangs, freezes, stops answering requests, burns CPU or times out waiting for connections and a thread dump would show why.
when_to_use: Trigger on "thread dump", "jstack", "jcmd", "kill -3", "deadlock", "app hung/frozen/stuck", "requests piling up", "HikariPool Connection is not available", "threads BLOCKED/WAITING", "virtual thread pinning", or text starting with "Full thread dump".
---

# Analyze a JVM thread dump with ThreadMine

The `threadmine` MCP server in this plugin exposes two tools:

- `analyze_thread_dump`: send the dump and get the detected problems, a health score (0-100) and a link to the interactive report.
- `get_analysis`: reopen a previous result by the id that `analyze_thread_dump` returned. It consumes nothing.

## Getting the dump to the tool

- If the dump is in a file, pass its absolute path in `file_path`. Dumps are often several MB, so prefer this over pasting the text into `content`.
- If the user pasted the dump in the chat, pass it in `content` as is. Don't trim it: the analysis needs every thread, including the idle ones.
- If there is no dump yet, help the user capture one from the running JVM. Taking two or three dumps a few seconds apart is what separates a thread that is stuck from one that is just busy.
  - `jcmd <pid> Thread.print > dump.txt` (or `jstack <pid> > dump.txt`); `jps -l` lists the Java PIDs.
  - Virtual threads don't show up in `jstack`. For Loom apps use `jcmd <pid> Thread.dump_to_file -format=text dump.txt`.
  - In a container: `kubectl exec <pod> -- jcmd 1 Thread.print > dump.txt`.

## Privacy, before the first upload

The tool sends the dump to the ThreadMine API (threadmine.dev). Without an API key the result is a public link that anyone holding it can open, and it expires after 7 days. Dumps can carry hostnames, package names and SQL fragments. If the dump comes from production and the user hasn't said it's fine to share, tell them in one sentence that it will be uploaded and let them decide. When their policy forbids sending it, point them to tm-anon (https://github.com/maschiojv/threadmine-anonymizer), which anonymizes the dump locally; ThreadMine analyzes the anonymized file the same way.

## Reading the result back to the user

- Lead with the probable root cause and the threads involved, using the thread names and stack frames from the result. Then the recommendation.
- Tie the finding to the user's code when you can see it: the lock, the pool or the call site in their repository.
- Give the report link so they can open the lock graph and the full stacks.
- If the tool reports the anonymous limit, relay the wait time it gives and stop. Don't retry in a loop.
- If the analysis fails because the file isn't a thread dump (a heap dump, a GC log, an application log), say what it looks like and how to capture a thread dump instead.
