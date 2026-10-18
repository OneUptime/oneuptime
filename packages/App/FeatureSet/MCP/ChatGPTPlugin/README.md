# ChatGPT plugin

The package OneUptime uploads to the ChatGPT plugin directory, which ChatGPT and Codex share, to list its hosted MCP server, `https://oneuptime.com/mcp`. It follows OpenAI's [plugin package format](https://developers.openai.com/plugins/build/plugins): the portable Agent Plugins format, with OpenAI's settings under `extensions["com.openai"]`.

| File          | What it holds                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `plugin.json` | The listing (name, descriptions, links, icons), the review test cases and the release notes.                   |
| `mcp.json`    | The server: streamable HTTP at `https://oneuptime.com/mcp`, signed in to with OAuth for read and write access. |
| `assets/`     | The listing icon (512px) and the composer icon (192px): OneUptime's app icon.                                  |

`mcp.json` declares the server's sign-in under `extensions["com.openai"].auth`, where OpenAI's portal reads it. Agent Plugins 1.0.0 itself defines no authentication fields, so a client that only knows that format reads the server entry as invalid; this package is built for OpenAI's.

`../Tests/ChatGPTPlugin.test.ts` holds both files to the published Agent Plugins schemas (copied in `../Tests/AgentPlugins/`) and to OpenAI's submission limits, and checks that every tool a test case names is one the server has.

## Build the ZIP

```bash
npm run build-chatgpt-plugin
```

This writes `build/chatgpt-plugin/oneuptime-chatgpt-plugin.zip`, with `plugin.json`, `mcp.json` and `assets/` at its root. This README stays out of it.

## What the submission needs besides the ZIP

- **A verified developer identity** for OneUptime, in the OpenAI Platform's [organization settings](https://platform.openai.com/settings/organization/general).
- **Domain verification.** When you connect the server, the portal shows a token that has to be served as plain text at `https://oneuptime.com/.well-known/openai-apps-challenge`. OneUptime does not serve that path. `oneuptime.com` is behind Cloudflare, so a Worker on that one route that returns the token is enough.
- **Reviewer credentials**, entered under **Review details** and never in the package: a dedicated OneUptime Cloud account that signs in with an email and a password alone (no two-factor sign-in, email already verified), in the demo project described below.
- **A demo video** of the test cases running in ChatGPT with that account, at a URL reviewers can open. Enter it under **Review details**, or add it to `plugin.json` as `extensions["com.openai"].review.demo_recording_url`.

## The demo project the test cases expect

The reviewer signs in, chooses the demo project and allows read and write access, then runs the five positive test cases in `plugin.json`. The project needs:

- The Growth plan or higher (connecting an MCP client needs it), and no SSO requirement.
- The reviewer account on the project's Owners team, or on another team allowed to change incidents.
- Incidents created in the last 30 days, with different severities, at least one of them not resolved.
- Monitors, at least one of them not Operational: a manual monitor set to Offline or Degraded will do.
- A status page with a few resources, its MCP access left on (the default).

The third case acknowledges an incident and adds an internal note to it. Running it again acknowledges nothing new (an incident that is already acknowledged is left as it is) but adds another note.

## Updating the listing

Changes to the server's tools need no new ZIP: the directory picks them up from the server and checks them. A change to the listing, the test cases or the icons needs one: raise `version` in `plugin.json`, build the ZIP, and upload it to the existing plugin. See OpenAI's [submission guide](https://developers.openai.com/plugins/deploy/submission).
