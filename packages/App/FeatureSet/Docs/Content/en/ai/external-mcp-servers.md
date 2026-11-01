# External MCP Servers

OneUptime AI can use the tools of MCP servers outside OneUptime — the ones your cloud, your code host or your own team run, such as AWS, Azure or GitHub — while it investigates and fixes incidents and alerts. Add a server once under **Project Settings → AI → External MCP Servers**, and OneUptime AI uses it from the next incident on.

:::cards
- [Add a server](#add-a-server): Its address, and how OneUptime signs in.
- [What OneUptime AI does with a server](#what-oneuptime-ai-does-with-a-server): Tools that read in investigations, the others in fixes.
- [Choose the servers a rule may use](#choose-the-servers-a-rule-may-use): All of them, unless a rule picks some.
- [Safety](#safety): What a server can and cannot make OneUptime AI do.
:::

This page is about servers OneUptime AI connects to. To connect an AI assistant such as Claude or Cursor to OneUptime instead, see [MCP Server](/docs/ai/mcp-server).

## Before you begin

- **OneUptime AI is on** for the project, with an LLM provider it can use: see [LLM Providers](/docs/ai/llm-provider).
- **The server's MCP address.** Streamable HTTP and the older HTTP with SSE both work: OneUptime finds out which one the server speaks when it connects.
- **How OneUptime signs in to it:** an API token, headers of the server's own, or OAuth client credentials from your identity provider.
- **A Project Owner or a Project Admin** adds, changes, tests and removes servers; Project Members and Viewers can see them. On OneUptime Cloud, adding a server takes the Growth plan or above.

## Add a server

:::steps
### Open External MCP Servers
Go to **Project Settings → AI → External MCP Servers** and click **Create External MCP Server**.

### Say where it is
Give it a **Name**, the one OneUptime AI and the people reading what it did see it by, and its **URL**, such as `https://mcp.example.com/mcp`. Under **More fields**, a **Description** says what the server is for; OneUptime AI reads it to pick the right server.

### Choose how OneUptime signs in
Pick one card under **Authentication**, then fill in what it asks for (see [Authentication](#authentication)).

### See what OneUptime found
When you save, OneUptime connects at once and the **Test connection** dialog says what it found: the server, how it talks, and each of its tools, marked **Reads only** or **May change things**. If it could not connect, the dialog says why and what to check.
:::

The list of servers says how each one is doing: **Connected**, **Can't connect** (hover over it for the reason), **Not checked yet** or **Off**, and how many tools it offers. A server's page has its details, the switch that lets OneUptime AI use it, and its **Tools**, with **Test connection** to connect again and read them anew. A test calls none of the server's tools.

## Authentication

| Authentication | What OneUptime sends | What you fill in |
| --- | --- | --- |
| **No sign-in** | Nothing | Nothing. For a server that needs no sign-in, or that only your network reaches. |
| **Bearer token** | `Authorization: Bearer <token>` | **Token** |
| **Custom headers** | The headers you enter, with every request | A name and a value per header, such as `X-API-Key`. At most 10. |
| **OAuth client credentials** | A token it asks your identity provider for, as a bearer token, asking again before it expires | **Token URL**, **Client ID** and **Client Secret**, on a step of their own; **Scope** and **Audience** under **More fields** |

The token, the header values and the client secret are stored encrypted and never shown again, not even to the people who saved them. An edit starts them empty; leave one empty to keep what is stored. The server's page shows the names of the headers it sends, never their values. Changing **Authentication** removes the secrets the old way of signing in used.

Never put a token or a password in the **URL**: everyone who can read the server reads its address, and a user name or password in it is refused.

## What OneUptime AI does with a server

Each tool a server offers either only reads, or may change something. OneUptime goes by what the server says about the tool (its `readOnlyHint`): a tool the server does not mark as read-only counts as one that may change something.

```mermaid title="Which tools OneUptime AI uses, and when"
flowchart TB
    T["A tool of<br/>your MCP server"] --> Q{"Does it<br/>only read?"}
    Q -->|"yes"| R["Used in<br/>investigations<br/>and fixes"]
    Q -->|"no"| C["Used in<br/>fixes only"]
    C --> A{"The rule's<br/>Approval"}
    A -->|"Ask before<br/>fixing"| P["Proposed, for<br/>a person to<br/>approve"]
    A -->|"Fix without<br/>asking"| M["Made at once,<br/>through the<br/>servers the<br/>rule names"]
```

| | Tools that only read | Tools that may change something |
| --- | --- | --- |
| **Investigations** | Used, alongside OneUptime's own data | Never used: OneUptime refuses the call |
| **Fixes** | Used to work out the fix | Proposed for approval, or used right away, as the AI rule's **Fix** says |

**In an investigation**, OneUptime AI lists the tools of the servers it may use and calls the ones that read, to look at what OneUptime cannot see itself: your cloud account, a deployment, an issue tracker. It uses what they answer in its root cause analysis. See [AI SRE](/docs/ai/ai-sre).

**In a fix**, when a server it may use offers a tool that may change something, OneUptime AI works out a fix through it, after the root cause analysis when there is one:

- **Ask before fixing** — each change it would make is recorded and sent nowhere. The **Remediation** step of the incident's **OneUptime AI** card lists them in order, each with its server, its tool and what it would send. **Approve & Run** makes exactly those changes, in that order, under your name; approving takes the same permission as starting a runbook. A change that fails stops the ones after it.
- **Fix without asking** — OneUptime AI makes the changes itself, each recorded before it is sent. It does so only for a rule that names its MCP servers, when no other matching rule asks first, nothing else is already fixing the incident on its own (an AI agent on a cluster or host, or a runbook), and the rule has not made the most fixes it may make on its own in an hour; otherwise the changes are proposed. With no rule set up, or a rule that names no MCP server, every change is proposed.

A fix makes at most 5 changes. OneUptime then watches the incident's monitors, as it does for every fix. Nothing is undone automatically: an MCP tool has no undo OneUptime can know of, so a fix that did not work is left for a person, and the **Remediation** step shows what each server answered.

To stop OneUptime AI using a server, turn off **Let OneUptime AI use this server** on its page. It asks first: the server is no longer used in any investigation or fix, and a proposed fix through it can no longer be approved.

## Choose the servers a rule may use

Each AI rule can name the MCP servers OneUptime AI may use for what it matches. The field is **MCP Servers**, under **More fields**. Until you pick some, OneUptime AI may use all of them, and the folded section says so.

- **None picked** — all of the project's servers that are on.
- **Some picked** — only those. On an AI rule that fixes without asking, naming its servers is also what lets OneUptime AI make their changes without asking.

When several rules that investigate match, OneUptime AI may use every server any of them allows; if the rules cannot be read, the investigation uses no MCP server at all. Each matching rule that fixes works out its own fix through its servers, and the rules that name none share one fix through all of them.

## Safety

- **What a server sends back is data, never instructions.** OneUptime AI reads its tools' descriptions and answers as text from outside OneUptime: they never change a rule, an approval or what OneUptime AI may do.
- **The address is checked on every connection.** OneUptime never connects to its own or a link-local address. On OneUptime Cloud it also refuses private network addresses: use the server's public address. A self-hosted OneUptime reaches private addresses unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` is set. Redirects are not followed.
- **Limits.** A project has at most 20 servers, and OneUptime reads at most 200 tools of each. Connecting times out after 20 seconds, listing the tools after 30 and a tool call after 60. An answer larger than 2 MB is refused, and a run makes at most 40 calls to MCP servers.
- **Every call is recorded.** Each call is a step of the run, shown in its activity, and each change a fix makes is in the **Remediation** step with what the server answered. The model calls behind them are in **Project Settings → AI → AI Logs**.

## Troubleshooting

:::details Can't connect, or the test fails
The **Test connection** dialog says what went wrong and what to check: the address (a private address on OneUptime Cloud, a host that does not answer), the sign-in (a token or headers the server refused, or a token URL that gave no token), or a URL that is not the server's MCP address. Fix the server's settings with **Edit** on its page, then test again.
:::

:::details OneUptime AI does not use a server
Check that **Let OneUptime AI use this server** is on, that the rule that matched the incident does not name other servers under **More fields**, and that the server's tools were read: its **Tools** card lists them. An investigation uses only the tools marked **Reads only**.
:::

## Next steps

:::cards
- [AI SRE](/docs/ai/ai-sre): How OneUptime AI investigates and fixes, and the rules that decide which incidents.
- [LLM Providers](/docs/ai/llm-provider): The model that uses the servers' tools.
- [MCP Server](/docs/ai/mcp-server): Connect an AI assistant to OneUptime instead.
:::
