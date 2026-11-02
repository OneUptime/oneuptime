![OneUptime](assets/logo.png)

# OneUptime for coding agents

{{intro}} This plugin gives your coding agent OneUptime's hosted MCP server and four skills for the moments you reach for OneUptime while you work: instrumenting an app, setting up monitoring, working an incident and scripting OneUptime in CI.

## What you can do

{{capabilities}}

## Skills

| Skill                  | Use it to                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `add-opentelemetry`    | Add OpenTelemetry to an application and send its traces, metrics and logs to OneUptime.         |
| `set-up-monitoring`    | Create monitors and a status page for a service.                                                |
| `investigate-incident` | Find an active incident, read its logs, exceptions and traces, keep notes on it and resolve it. |
| `use-oneuptime-cli`    | Use the OneUptime CLI in scripts and CI, where no MCP client is available.                      |

## Try asking

{{prompts}}

- Add OpenTelemetry to this app and send it to OneUptime.
- Set up a monitor and a status page for this service.
- Add a step to this pipeline that stops the deploy while an incident is open.

## Requirements

- A OneUptime account. On OneUptime Cloud, connecting an MCP client and using API keys need the Growth plan or higher. The public status page tools need no credential.
- A coding agent that loads plugins and supports sign-in to remote MCP servers, such as Claude Code or Cursor.

## Connect

The plugin adds the MCP server at {{serverUrl}}. There is no key to copy. The first time a tool needs your data, you sign in to OneUptime in your browser, choose the project your agent may work in, and choose read and write or read only. In Claude Code, run `/mcp` and choose **oneuptime** to sign in.

Your agent can do only what your role in that project allows. You can disconnect it at any time in OneUptime under **Project Settings → AI → MCP Server**.

The plugin connects to OneUptime Cloud. For a self-hosted OneUptime, add `https://your-oneuptime-domain.com/mcp` to your client as an MCP server: the skills work the same way.

## What the plugin runs, sends and fetches

- The plugin holds the address of the MCP server and the skills, which are Markdown. It has no hooks, scripts or bundled programs, and it starts nothing by itself.
- Your client connects to {{serverUrl}}. The tools you approve read and change records in the OneUptime project you signed in to. OneUptime's [privacy policy]({{privacyPolicyURL}}) and [terms]({{termsOfServiceURL}}) apply.
- The skills are instructions for your agent, which asks for your approval as your client is set up to. They can have it install the OpenTelemetry SDK in your project, install the `@oneuptime/cli` package from npm, run `oneuptime` commands, and call `https://oneuptime.com/otlp/v1/validate` with `curl` to check an ingestion key.
- Keys stay with you. The plugin stores no credentials, and the skills tell your agent to keep API keys and ingestion keys in your secret store.

## Support

See the [MCP server documentation]({{homepage}}), or contact [OneUptime support]({{supportURL}}).

## License

Apache-2.0. See `LICENSE`.
