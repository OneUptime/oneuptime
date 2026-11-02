# Coding agent plugin

The plugin OneUptime lists for coding agents in [Cursor's Marketplace](https://cursor.com/marketplace) and the [Claude directory](https://claude.ai/directory). It contains the hosted MCP server, `https://oneuptime.com/mcp`, and four skills: adding OpenTelemetry, setting up monitors and a status page, investigating an incident, and using the CLI in scripts and CI. Both directories read a plugin from a public Git repository, not from an upload, so this package builds a folder that becomes the root of one: [OneUptime/oneuptime-agent-plugin](https://github.com/OneUptime/oneuptime-agent-plugin). Each release that changes the plugin publishes it there, as the Terraform provider is published to its own repository. The listing's words, links and icon come from the ChatGPT plugin and are read from [`../ChatGPTPlugin/`](../ChatGPTPlugin/README.md) at build time, so the two listings stay the same.

| File          | What it holds                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/`     | The four skills, published as they are. The ChatGPT plugin's ZIP carries them too, for ChatGPT and Codex, so they name no client.                                                                                                 |
| `LISTING.md`  | The plugin's README, which the Claude directory shows as the listing's description. Each `{{name}}` in it is filled from the ChatGPT listing: its first sentence, its list of what you can do, its starter prompts and its links. |
| `plugin.json` | What this plugin says differently from the ChatGPT listing: its `repository`, which is also where the release publishes it. Any other field set here replaces the ChatGPT listing's.                                              |
| `README.md`   | This file, for maintainers. It is left out of the build.                                                                                                                                                                          |

## Build the folder

```bash
npm run build-coding-agent-plugin
```

This writes `build/coding-agent-plugin/oneuptime/`. Given a path, it writes there instead: `npm run build-coding-agent-plugin -- ../oneuptime-agent-plugin`. It empties the folder first and keeps `.git`. It refuses a folder that is neither empty nor an earlier build. Every manifest carries the version in the repository's `VERSION` file, which is the release's. `--version 14.0.101` sets another.

| In the folder                             | Who reads it                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `plugin.json`, `mcp.json`                 | Clients of the Agent Plugins 1.0.0 standard, Cursor among them. The server is `streamable-http`, with nothing but its address.  |
| `.cursor-plugin/plugin.json`              | Cursor. It adds the logo, which the standard's closed manifest has no field for, and points at `.mcp.json`.                     |
| `.claude-plugin/plugin.json`, `.mcp.json` | Claude. The manifest carries the directory's listing fields, and the server is `type: "http"`, the type the directory requires. |
| `skills/<name>/SKILL.md`                  | Every client.                                                                                                                   |
| `README.md`                               | Both directories. It is `LISTING.md`, filled in.                                                                                |
| `LICENSE`, `NOTICE`                       | The repository's own, Apache-2.0.                                                                                               |
| `assets/logo.png`                         | The ChatGPT listing's 512 px icon.                                                                                              |

Cursor's own `origin-apps` plugin, in [cursor/plugins](https://github.com/cursor/plugins), keeps the same three manifests in one folder.

The ChatGPT package's `mcp.json` cannot be reused as it is. It declares the sign-in under `extensions["com.openai"].auth`, which Agent Plugins 1.0.0 does not define, so a client that knows only the standard reads that server entry as invalid. These entries hold only the address. Claude Code and Cursor find the sign-in themselves, from the server's OAuth metadata (RFC 9728), and register as clients, which the server allows.

[`../Tests/CodingAgentPlugin.test.ts`](../Tests/CodingAgentPlugin.test.ts) runs the build and checks the folder. It checks the folder against the Agent Plugins schemas (copied in `../Tests/AgentPlugins/`), against the fields Cursor and Claude document, and against the Claude directory's automated checks. It checks each skill against the server: every tool it names, every JSON example against its tool's arguments, and each fact it states about OneUptime against the code that does it. [`Tests/Ops/CodingAgentPluginPackage.test.js`](../../../../../Tests/Ops/CodingAgentPluginPackage.test.js) checks the build script, and [`Tests/Ops/CodingAgentPluginRelease.test.js`](../../../../../Tests/Ops/CodingAgentPluginRelease.test.js) the release job and the publish script.

## How a release publishes it

`release.yml`'s `publish-coding-agent-plugin` job runs [`Scripts/MCP/PublishCodingAgentPlugin.sh`](../../../../../Scripts/MCP/PublishCodingAgentPlugin.sh) once the GitHub release is published, so a plugin never describes a release that is not out. It clones the repository `plugin.json` names, with the deploy key `CODING_AGENT_PLUGIN_DEPLOY_KEY`, and:

- builds the plugin at the version the repository already has, and stops if that is what is there: a release that changes nothing but the version pushes nothing. OneUptime releases about twice a day, and both directories look at every commit. The Claude directory scans each one, and Cursor reviews each update by hand.
- otherwise builds it at the release's version and pushes one commit to `main`, replacing everything in the repository but `.git`. The repository is generated: change the plugin here, never there.
- leaves a repository at a newer version alone, as a re-run of an older release would find it.

While the key is not set, the job is skipped with a notice, and the release goes on.

On 2026-11-02, `claude plugin validate` passed on the built folder, and `claude --plugin-dir <folder> mcp list` connected to `https://oneuptime.com/mcp`.

## Why the plugin needs a repository of its own

- The Claude directory stops validating a repository of 10,000 or more files and folders. This repository has about 38,000.
- Cursor reads a plugin from the root of a repository. To find one in a subfolder, it needs a `.cursor-plugin/marketplace.json` at the root.
- Both need the repository public. Cursor's docs say every plugin must be open source. Claude validates a private repository, but only lists a public one.

## What only a maintainer can do

1. **Create the repository.** Create the public repository `OneUptime/oneuptime-agent-plugin`, and leave it empty: no README, licence or `.gitignore`. The first publish creates `main`, and a repository that holds anything else is refused. For another name, change `repository` in this package's `plugin.json` first: the manifests and the publish both read it.

2. **Give the release a key to it.** Make a deploy key: `ssh-keygen -t ed25519 -N "" -C "release.yml: coding agent plugin" -f coding_agent_plugin_deploy_key`. Add `coding_agent_plugin_deploy_key.pub` to the repository's deploy keys with write access. In this repository's **Settings → Environments**, create `coding-agent-plugin-publish` and limit its deployment branches to `release`. Then give it the secret `CODING_AGENT_PLUGIN_DEPLOY_KEY`, the private key, and delete both files. The next release publishes the plugin. To publish before then, run the script from this repository's root with the key and the version of the last release:

   ```bash
   PACKAGE_VERSION="$(cat VERSION)" CODING_AGENT_PLUGIN_DEPLOY_KEY="$(cat coding_agent_plugin_deploy_key)" bash Scripts/MCP/PublishCodingAgentPlugin.sh
   ```

3. **Try it in both clients.** Cursor's checklist asks that a plugin was tested locally. Clone the repository to `../oneuptime-agent-plugin`, or build into that folder.

   - Claude Code: run `claude plugin validate ../oneuptime-agent-plugin`. Claude Code 2.1.281 and later accept the manifest's `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl` and `termsOfServiceUrl`. Earlier versions warn about each of them, and `--strict` fails on those warnings. Then start `claude --plugin-dir ../oneuptime-agent-plugin`, run `/mcp` to sign in, and ask "Which incidents are open in OneUptime right now?".
   - Cursor: copy the folder to `~/.cursor/plugins/local/oneuptime`, run **Developer: Reload Window**, and check under **Customize** that the four skills and the `oneuptime` server load. Then sign in.

4. **Submit the MCP server to the Claude directory as a connector.** At [claude.ai/directory/manage](https://claude.ai/directory/manage), choose **Submit new**, then **MCP connector**, with `https://oneuptime.com/mcp`. Anthropic asks for this even when a plugin already uses the server. When one organization submits both, it can pair the two listings. Reviewers need a test account with sample data, and the demo project described in [`../ChatGPTPlugin/README.md`](../ChatGPTPlugin/README.md#the-demo-project-the-test-cases-expect) will do.

5. **Submit the plugin to the Claude directory.** Choose **Submit new**, then **Plugin bundle**, enter the repository, and choose **Validate**. The portal's checks go further than `claude plugin validate`: it checks the README, the licence and whether the name is free. Then answer the data handling and compliance steps. Submitting needs a paid Claude plan, and on Team or Enterprise, an Owner. The first organization to submit a repository folder holds its listing, so submit from the organization that should own it.

6. **Submit the plugin to Cursor.** At [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish), submit the repository's link. The Cursor team reviews every plugin and every update by hand. Its docs call the Marketplace the place for official plugins and point community plugins and MCP servers to [cursor.directory](https://cursor.directory). If the form does not take a vendor's plugin, ask Cursor rather than listing it there.

7. **After the listings go live.** In the Claude portal, set up the GitHub push webhook, or leave the scheduled check, and pair the plugin with the connector. Leave the tracked branch as `main`, which each release pushes to.

Some things can hold a version for an Anthropic reviewer: not a refusal, but a wait. `use-oneuptime-cli` shows a CI job that gives the CLI `ONEUPTIME_API_KEY` from the pipeline's secrets, and the directory's checklist holds a plugin that sends a credential from the user's environment to a server. A person reviews every new listing anyway. If asked, the reason is that the CLI exists for pipelines, where a secret store is where the key belongs.

## What the docs said on 2026-11-02

The earlier notes held, with these additions:

- **Cursor**: a plugin is a public Git repository, submitted at cursor.com/marketplace/publish and reviewed by hand, each update too. "All plugins must be open source." Cursor loads Agent Plugins (root `plugin.json`) and Cursor Plugins (`.cursor-plugin/plugin.json`), and says nothing about which wins when a folder has both. Skills are `skills/<name>/SKILL.md`, and a skill's `name` must match its folder. Its checklist also asks for a `README.md` that documents usage and configuration, a logo referenced by a relative path, and Agent Plugins that conform to the standard's schemas.
- **Claude**: a plugin bundle is submitted from a GitHub repository at claude.ai/directory/manage, where the remote MCP server is submitted on its own as a connector. The README must have at least 40 words, not counting code blocks, and a licence must be a `LICENSE` file or the manifest's `license`. `claude plugin validate` checks only that the files are well-formed. Skills cannot be submitted on their own. The checklist also lists a folder with skills and no manifest as "listed for Claude Code only".

## Updating the plugin

Change the skills, `LISTING.md` or the ChatGPT listing here, and merge. The next release publishes the change at its own version. A skill reaches ChatGPT and Codex only in a new ChatGPT ZIP: raise `version` in `../ChatGPTPlugin/plugin.json`, then build and upload it as its README says. The Claude directory scans the new commit and publishes it as its publish setting says, and Cursor reviews it. A change to the server's tools needs nothing, unless a skill names a tool the server no longer has: then `../Tests/CodingAgentPlugin.test.ts` fails until the skill is changed too.
