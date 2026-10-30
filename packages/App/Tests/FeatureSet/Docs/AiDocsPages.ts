/*
 * The AI pages, by the paths their suites name them with, and the words
 * they keep as the product writes them.
 *
 * Docs overhaul task 27 rewrote these pages: AiDocsFacts holds the English
 * pages to the product, and AiDocsTranslations holds every translation to
 * its English page. They read the page lists and the kept words from here,
 * never from each other: importing a .test.ts file runs its tests.
 */

export interface AiDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const ASK_AI: string = "ai/ask-ai";
export const AI_SRE: string = "ai/ai-sre";
// What a project's team writes for OneUptime AI about its own systems (#5198).
export const AI_CONTEXT: string = "ai/ai-context";
export const INFRASTRUCTURE_AI_AGENTS: string = "ai/infrastructure-ai-agents";
export const CODE_PAGE: string = "ai/ai-agent";
export const GITHUB_APP: string = "ai/github-app";
export const LLM_PROVIDERS: string = "ai/llm-provider";
export const EXTERNAL_MCP_SERVERS: string = "ai/external-mcp-servers";
export const MCP_SERVER: string = "ai/mcp-server";

/*
 * Microsoft Foundry is in the AI nav group too. Its page was written with
 * its translations by the task that added it, and MicrosoftFoundryDocs
 * holds it; this task's suites leave it to that one.
 */
export const MICROSOFT_FOUNDRY: AiDocsPageEntry = {
  page: "ai/microsoft-foundry",
  navTitle: "Microsoft Foundry",
};

/*
 * The pages this task rewrote, in nav order, and External MCP Servers: the
 * servers OneUptime AI uses, written in every language by the task that
 * added them, and held to the same rules.
 */
export const AI_PAGES: ReadonlyArray<AiDocsPageEntry> = [
  { page: ASK_AI, navTitle: "Ask AI" },
  { page: AI_SRE, navTitle: "AI SRE" },
  { page: INFRASTRUCTURE_AI_AGENTS, navTitle: "Infrastructure AI Agents" },
  { page: CODE_PAGE, navTitle: "Code" },
  { page: GITHUB_APP, navTitle: "GitHub App" },
  { page: LLM_PROVIDERS, navTitle: "LLM Providers" },
  // What OneUptime AI knows of the project, after which model it uses.
  { page: AI_CONTEXT, navTitle: "AI Context" },
  { page: EXTERNAL_MCP_SERVERS, navTitle: "External MCP Servers" },
  { page: MCP_SERVER, navTitle: "MCP Server" },
];

/*
 * A table's create button, drawn as translateCreateAction draws it
 * ("Create <singular name>").
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [LLM_PROVIDERS]: ["Create LLM Provider"],
  [EXTERNAL_MCP_SERVERS]: ["Create External MCP Server"],
  [MCP_SERVER]: ["Create API Key"],
};

/*
 * A role's or a permission's name, as the role pickers, the API and
 * Terraform name it, kept in English in every language, as the other
 * translated pages keep them (IdentityDocsTranslations). Some of them are
 * Dashboard labels too (a team's role field draws "Project Admin" in the
 * reader's language), but the pages name the permission, and
 * LlmProviderTestDocs holds every language to the English titles.
 */
export const PERMISSION_NAMES: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [ASK_AI]: [
      /*
       * What creating an incident or an alert needs in a custom role
       * (#5301): permissions, though "Create Alert" is a button too.
       */
      "Create Incident",
      "Create Alert",
      "Create Incident State Timeline",
      "Create Alert State Timeline",
      "Create On-Call Duty Policy Execution Log",
      "Create Runbook Execution",
    ],
    [AI_SRE]: ["Manage Billing", "Edit AI Rule"],
    // Who changes the project's AI context, and who reads it.
    [AI_CONTEXT]: ["Read Project"],
    [INFRASTRUCTURE_AI_AGENTS]: ["Edit AI Rule"],
    [LLM_PROVIDERS]: ["Read LLM", "Edit LLM"],
    [MCP_SERVER]: ["Authorize MCP Client"],
  };

// The plans the pages name: the Dashboard shows a plan's name as written.
export const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [MCP_SERVER]: ["Growth"],
};

/*
 * Bold names no Dashboard locale has as a label, so every language's page
 * keeps them as written:
 *
 *   - the ⋯ menu, a symbol in every language;
 *   - OpenAI Compatible, an option of the LLM Provider field, drawn as
 *     the field's options write it;
 *   - text the server writes in English: a refused Base URL's message,
 *     the context window errors, the investigation card's lines for an
 *     incident outside the rules and for one resolved during a rule's wait
 *     (InvestigationEligibility), the AI Logs statuses, and the lead of a
 *     follow-up check's analysis (IncidentFollowUpCheck.buildReportLead);
 *   - the namespaces Kubernetes names kube-system, kube-public and
 *     kube-node-lease;
 *   - the command policy's SafeWrite and RiskyWrite tiers.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [AI_SRE]: [
      "⋯",
      "kube-system",
      "kube-public",
      "kube-node-lease",
      "This incident was outside the AI rules that investigate at creation",
      "Resolved before the investigation started",
      "Budget Exceeded",
      "Insufficient Balance",
      "Most likely root cause",
      "Suggested next steps",
      "Checked again",
    ],
    [INFRASTRUCTURE_AI_AGENTS]: ["⋯", "SafeWrite", "RiskyWrite"],
    /*
     * The check a production review adds on GitHub: its name and titles,
     * written by the server in English (ProductionReviewRunner,
     * ProductionReviewComposer).
     */
    [CODE_PAGE]: [
      "OneUptime production review",
      "Something in production is worth a look",
      "Nothing in production runs through these changes",
    ],
    // The heading a review writes its production findings under, on GitHub.
    [GITHUB_APP]: ["Production context"],
    [LLM_PROVIDERS]: [
      "OpenAI Compatible",
      '"…points to an address OneUptime is not allowed to connect to"',
      '"…the request is larger than the model\'s context window"',
      '"no user query found in messages"',
    ],
  };

/*
 * Names that are also a Dashboard label in English, but that the pages use
 * for something else, so every language keeps them as written: what
 * another product draws (GitHub's permissions and webhook events, Claude's
 * menus and the name Claude Code gives the server, LM Studio's setting,
 * vSphere's Read-Only role), the command
 * policy's Read and Denied tiers, and the sections OneUptime AI writes its
 * report under.
 */
export const OTHER_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [AI_SRE]: ["Summary", "Evidence"],
  [INFRASTRUCTURE_AI_AGENTS]: ["Read", "Denied", "Read-Only"],
  // The GitHub App's permission a production review's check needs.
  [CODE_PAGE]: ["Checks", "Read & write"],
  [GITHUB_APP]: [
    "Issues",
    "Checks",
    "Read & write",
    "Permissions & events",
    "Issue comment",
    "Pull request",
    "Pull request review",
    "Pull request review comment",
    "Repository permissions",
  ],
  [LLM_PROVIDERS]: ["Serve on Local Network"],
  [MCP_SERVER]: ["Customize → Connectors", "Add custom connector", "oneuptime"],
};

/*
 * The MCP consent page's choices and button, drawn from the Accounts app's
 * own locale (Accounts/src/Locales, keyed by mcpAuthorize.*), not the
 * Dashboard's.
 */
export const ACCOUNTS_LABELS: Readonly<Record<string, string>> = {
  "Read and write": "mcpAuthorize.accessWriteTitle",
  "Read only": "mcpAuthorize.accessReadTitle",
  Authorize: "mcpAuthorize.authorizeButton",
};

/*
 * An Admin Dashboard page a page sends a server administrator to, by the
 * keys its menus draw it from (DocsAdminDashboard).
 */
export const ADMIN_PATHS: Readonly<Record<string, ReadonlyArray<string>>> = {
  "Settings → Global LLM Providers": [
    "breadcrumbs.settings",
    "breadcrumbs.globalLlmProviders",
  ],
};

/*
 * A label the Dashboard draws from a template with a number in it: the
 * conversation's "Show 6 earlier messages", from "Show {{count}} earlier
 * messages".
 */
export const TEMPLATED_LABELS: Readonly<
  Record<string, { template: string; values: Record<string, string> }>
> = {
  "Show 6 earlier messages": {
    template: "Show {{count}} earlier messages",
    values: { count: "6" },
  },
};

/*
 * Bold words that are emphasis or a list item's lead, not a Dashboard
 * label: a translation words them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [ASK_AI]: [
    "What each action needs.",
    "Which records.",
    "When an action is refused.",
    "Slack, Microsoft Teams and AI investigations.",
    "Stop it.",
    "Follow its work.",
    "Pick the model.",
    "Rate an answer.",
    "See the cost.",
    "Keep a copy.",
    "Pick up where you left off.",
    "An LLM provider.",
    "The Growth plan, on OneUptime Cloud.",
    "AI turned on for the project.",
  ],
  [AI_SRE]: [
    "strictly read-only",
    "It investigates",
    "It fixes",
    "It learns.",
    "and",
    "no time limit",
    "investigation time limit",
    "Cost controls",
    "Ask follow-up questions",
    "Ask it to act",
    "with your own permissions",
    "Choose how it acts",
    "One shared thread.",
    "on by default for new projects",
    "Configure an LLM provider.",
    "Make sure AI is enabled for the project",
    "Choose per signal type",
    "off",
    "read-only",
    "Automatic code fixes",
    "safe",
    "riskier",
    "Rollback first.",
    "Verified in production.",
    "Still happening after the fix",
    "Fixed in production",
    "Not verified in production",
    "The other fixes are watched for what they fix.",
    "A slow operation",
    "An incident's or an alert's root cause",
    "Missing telemetry, logging or tracing",
    "every",
    "never",
    "any",
    "where",
    "patch/update on workloads, pods and CronJobs, and create on Jobs, in a namespace is equivalent to running any image as any ServiceAccount in that namespace and reading its Secrets.",
    "not",
    "without",
    "Commands on Runners.",
    // Which LLM provider a rule uses.
    "Everything the rule starts.",
    "A provider that can no longer be used.",
    "The run says which.",
    "Who may pick one.",
    "Several rules.",
    "Changes during the wait.",
    "When the wait ends.",
    "Fixing does not wait.",
    "A new alert afterwards.",
    "RCA first",
    "enqueues an AI investigation",
    "settles",
    "no investigation is enqueued",
    "wait before investigating",
    "created already resolved",
    "Each Kubernetes cluster it is linked to",
    "Each infrastructure resource it is linked to",
    "The AI rules",
    "The project",
    "every severity",
    "no cooldown",
    "no limit",
    "0",
    "The project's owners are emailed.",
    "Skipped incidents and alerts are investigated after the reset.",
    "Auto Recharge on",
    "Auto Recharge off",
    "Auto Recharge could not charge the card",
    "The project's owners are emailed",
    "Read-only, always.",
    "Citations are minted server-side",
    "Full audit trail.",
    "Secrets are redacted",
    "Images are left out of what the model reads.",
    "Self-host = zero third-party egress.",
    "What it writes acts on nothing.",
    "insight",
    "no AI in the watch loop",
    "never page anyone and never open incidents",
    "triage analysis",
    "fix pull request",
    "newly created",
    "Workloads Argo CD, Flux or Helm declare.",
    "temporary fix",
    "Verification notices a fix that was put back.",
  ],
  [INFRASTRUCTURE_AI_AGENTS]: [
    "resource AI agents",
    "The same tiers and modes.",
    "The same three checks.",
    "The same rule about credentials.",
    "The same defaults.",
    "One image for every resource.",
    "Write access is an environment variable.",
    "host's own",
    "same identity the collector reports",
    "investigation",
    "always need a person",
    "Safe",
    "Riskier",
    "Always a person",
    "Never",
    "one whole word",
    "every",
    "Docker, Podman and Docker Swarm:",
    "VMware vCenter:",
    "Database servers:",
    "Hosts:",
    "Proxmox:",
    "OneUptime AI's tools.",
    "When OneUptime queues it.",
    "On the agent, before anything runs.",
    "The Docker and Podman socket is root on the host.",
    "The Host AI agent is root on the host.",
  ],
  [CODE_PAGE]: [
    "40 LLM calls",
    "100,000 output tokens",
    "2",
    "12",
    // What a fix reads of production, and the rules it reads it by.
    "Exceptions",
    "Traces",
    "Logs",
    "Metrics",
    "Incidents",
    "Deploys",
    "Read only.",
    "This project, and only the services this repository serves.",
    "No private incidents",
    "Bounded.",
    // What a production review reads of the changed code, and its rules.
    "Operations",
    "Hot functions",
    "Aggregates only.",
    "Public repositories get a link.",
    "Outside contributors cannot start one.",
    "The token comments.",
  ],
  [GITHUB_APP]: [
    "it never merges anything, and it never approves a pull request.",
    "connected to a OneUptime project",
    "Add the trigger label.",
    "Assign the issue to the app's bot user",
    "one comment",
    "Only people with write, maintain or admin access to the repository.",
    "It never merges.",
    "It never approves or requests changes.",
    "It never rewrites history.",
    "It cannot revise a pull request from a fork.",
    "It never changes a pull request's title, description or target branch.",
    "The cap on open pull requests",
    "The prompts label untrusted text as a request, not as instructions",
    "The real containment is the sandbox.",
  ],
  [LLM_PROVIDERS]: [
    "Investigations",
    "Questions",
    "Drafts",
    "Code",
    "Everything else",
    "OneUptime Cloud",
    "every project at once",
    "Who can see a provider.",
    "Testing a provider.",
    "Raise the context window.",
    "Popular Ollama models:",
    "OneUptime server",
    "Loopback addresses are always refused.",
    "Private addresses work on self-hosted installs.",
    "OneUptime Cloud (SaaS) cannot reach private networks.",
    "Name providers clearly",
    "Keep keys in the API Key field.",
    "Test after every change",
    "Watch what AI costs.",
    "OpenAI or Anthropic",
    "A firewall",
  ],
  [EXTERNAL_MCP_SERVERS]: [
    "OneUptime AI is on",
    "The server's MCP address.",
    "How OneUptime signs in to it:",
    "A Project Owner or a Project Admin",
    "Investigations",
    "Fixes",
    "In an investigation",
    "In a fix",
    "None picked",
    "Some picked",
    "What a server sends back is data, never instructions.",
    "The address is checked on every connection.",
    "Limits.",
    "Every call is recorded.",
  ],
  [MCP_SERVER]: [
    "OneUptime Cloud",
    "Self-hosted",
    "Monitors",
    "Incident response",
    "Alerts",
    "Teams and on-call",
    "Status pages",
    "Scheduled maintenance",
    "Telemetry",
    "It has your permissions, and never more.",
    "Read only means read only.",
    "It is for one project.",
    "It works only through the MCP server.",
    "Instance administrators get no special treatment.",
    "Flow",
    "Discovery",
    "Client identity",
    "Scopes",
    "Token lifetimes",
    "Resource indicators",
    "Revocation",
    "The client never asks me to sign in",
    "My project is greyed out on the authorization page",
    'A tool is refused as "read-only"',
    "The client stopped working",
    "Self-hosted - the client says it cannot find the authorization server",
  ],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, systems, protocols and models. A line made of them alone is
 * not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime AI",
  "OneUptime",
  "OpenTelemetry",
  "Kubernetes AI agent",
  "Kubernetes",
  "Docker Swarm",
  "Docker Compose",
  "Docker Desktop",
  "Docker",
  "Podman",
  "Proxmox VE",
  "Proxmox",
  "VMware vCenter",
  "VMware",
  "vCenter",
  "vSphere",
  "Ceph",
  "PostgreSQL",
  "MySQL",
  "MariaDB",
  "Percona Server",
  "Redis",
  "Valkey",
  "KeyDB",
  "Dragonfly",
  "MongoDB",
  "Linux",
  "Windows",
  "macOS",
  "GitHub Copilot Chat",
  "GitHub Copilot",
  "GitHub App",
  "GitHub",
  "GitLab.com",
  "GitLab",
  "Forgejo",
  "Gitea",
  "Codeberg",
  "Bitbucket",
  "Azure DevOps",
  "Slack",
  "Microsoft Teams",
  "Microsoft Foundry",
  "Azure OpenAI",
  "OpenAI",
  "Anthropic",
  "Claude Code",
  "Claude Desktop",
  "Claude",
  "Cursor",
  "VS Code",
  "Groq",
  "Mistral",
  "Ollama",
  "Qwen",
  "Llama",
  "vLLM",
  "LocalAI",
  "LM Studio",
  "Hugging Face",
  "Helm",
  "Terraform",
  "Markdown",
  "MCP",
  "OAuth",
  "PKCE",
  "RFC",
  "REST",
  "JSON",
  "HTTP",
  "HTTPS",
  "API",
  "LLM",
  "SSO",
  "SSH",
  "RBAC",
  "PDF",
  "UTC",
  "USD",
];
