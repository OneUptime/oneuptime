# Agent Plugins 1.0.0 schemas

`plugin.schema.json` and `mcp.schema.json` are the published Agent Plugins 1.0.0 schemas, copied unchanged from [agent-plugins.org/schemas/1.0.0](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) (the same files as `schemas/1.0.0/` in [agentplugins/agent-plugins-spec](https://github.com/agentplugins/agent-plugins-spec)) so that `../ChatGPTPlugin.test.ts` can check the ChatGPT plugin package against them without a network. They are licensed under the Apache License 2.0, as the specification repository's `LICENSE.md` sets out for its schemas.

The specification says a client must not fetch a schema while loading a plugin, and that the specification text wins where the two disagree. Replace both files together when the package moves to a new Agent Plugins version.
