import {
  AI_SRE,
  ASK_AI,
  FIX_TASKS,
  GITHUB_APP,
  INFRASTRUCTURE_AI_AGENTS,
  LLM_PROVIDERS,
  MCP_SERVER,
} from "./AiDocsPages";
import { tables } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import {
  PACKAGES_DIR,
  bold,
  codeIn,
  englishPage,
  englishSection,
  readRepoFile,
  rowStartingWith,
  sourceFilesUnder,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "Common/Types/AI/AIChatPermissionMode";
import { AUTOMATIC_FIX_SWITCH_COLUMNS } from "Common/Types/AI/AutomaticFixSwitches";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import LlmType from "Common/Types/LLM/LlmType";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 27: what the AI pages say, held to the code that makes
 * it true. AiDocsTranslations holds the 16 translations to these English
 * pages, line for line, so a fact that changes here changes in every
 * language with the English.
 *
 * The suite reads the product's sources as text where they are React or
 * server code a docs test cannot load, and imports the small Common types
 * that decide a fact. Each fact names the source that makes it true, so a
 * change there fails the fact until the page says the new thing.
 *
 * The older suites keep holding what they already held (the Kubernetes AI
 * agent, the daily limits, the fixing switches, the LLM provider guide's
 * examples, the resource AI agents' policy tables); this one holds what the
 * rewrite added or changed: where each thing opens, the conversation's
 * modes and controls, every way a fix task starts, the budgets and timers
 * of a fix run, the GitHub commands, which provider AI uses, the MCP
 * server's tools and limits, and the plans.
 */

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

function dashboardSource(relativePath: string): string {
  return readRepoFile(`${DASHBOARD}/${relativePath}`);
}

// One line of text: a page's paragraph or a source's statement, unwrapped.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The first number a source assigns to a named constant.
function numberConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${escapeRegExp(name)}: number = ([\\d_ *]+);`),
  );

  if (!match) {
    throw new Error(`No number constant ${name}`);
  }

  // A product of digit literals: "15 * 60 * 1000", "100_000".
  return Number(
    (match[1] as string)
      .replace(/_/g, "")
      .split("*")
      .reduce((product: number, factor: string): number => {
        return product * Number(factor.trim());
      }, 1),
  );
}

// The string a source assigns to a named constant.
function stringConstant(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${escapeRegExp(name)}: string = "([^"]+)";`),
  );

  if (!match) {
    throw new Error(`No string constant ${name}`);
  }

  return match[1] as string;
}

describe("Ask AI", () => {
  const page: string = englishPage(ASK_AI);
  const open: Array<Array<string>> = tableWithHeader(
    englishSection(ASK_AI, "## Open Ask AI"),
    "Where",
  );

  it("opens from the header's Ask AI button and Ctrl/Cmd + I, but leaves the keys to a text box being typed in", () => {
    const header: string = dashboardSource("Components/Header/AskAI.tsx");
    const panel: string = dashboardSource("Components/AIChat/AIChatPanel.tsx");
    const anyPage: string = rowStartingWith(open, "Any page").join(" | ");

    expect(header).toContain('name="Ask AI"');
    expect(header).toContain('shortcut={[KeyboardKey.Mod, "I"]}');
    expect(panel).toContain('event.key.toLowerCase() !== "i"');
    expect(panel).toContain('target.tagName === "TEXTAREA"');
    expect(panel).toContain("target.isContentEditable");
    expect(anyPage).toContain(`Click ${bold("Ask AI")} in the header`);
    expect(anyPage).toContain("`Ctrl` + `I` (`Cmd` + `I` on a Mac)");
    expect(anyPage).toContain(
      "While you type in a text box or an editor, the keys stay the editor's italics shortcut.",
    );
  });

  it("is an action of the command palette, which opens with Ctrl/Cmd + K", () => {
    const palette: string = dashboardSource(
      "Components/CommandPalette/DashboardCommandPalette.tsx",
    );
    const search: string = dashboardSource("Components/Header/Search.tsx");

    expect(palette).toContain('t("commandPalette.actions.askAi", "Ask AI")');
    expect(search).toContain('shortcut={[KeyboardKey.Mod, "K"]}');
    expect(rowStartingWith(open, "The command palette").join(" | ")).toContain(
      `\`Ctrl\` + \`K\` (\`Cmd\` + \`K\` on a Mac) and choose ${bold("Ask AI")}`,
    );
  });

  it("opens with the evidence from a log error pattern and a chart's findings, through Explain with AI", () => {
    for (const source of [
      "Components/Logs/ErrorPatternDetail.tsx",
      "Components/Telemetry/InvestigationDrawer.tsx",
    ]) {
      const text: string = dashboardSource(source);

      expect({ source, explains: text.includes("Explain with AI") }).toEqual({
        source,
        explains: true,
      });
      expect(text).toContain("EventName.AI_CHAT_TOGGLE");
    }

    expect(
      rowStartingWith(open, "A log error pattern, or a chart's findings")[1],
    ).toContain(`Click ${bold("Explain with AI")}`);
  });

  it("has a page of its own under Products → AI → Chat, a conversation at an address of its own", () => {
    const items: string = dashboardSource("Utils/NavigationItems.tsx");
    const routes: string = flat(dashboardSource("Utils/RouteMap.ts"));

    expect(flat(items)).toContain(
      'title: t("navbar.items.aiChatTitle", "Chat")',
    );
    expect(items).toContain('t("navbar.categories.ai", "AI")');
    expect(routes).toContain(
      "[PageMap.AI_COPILOT_CONVERSATION]: new Route( `/dashboard/${RouteParams.ProjectID}/ai/chat/${RouteParams.ModelID}`, )",
    );
    expect(rowStartingWith(open, "Its own page")[1]).toContain(
      `Open ${bold("Products → AI → Chat")} for a full-page workspace. Each conversation there has its own address`,
    );
  });

  it("asks before it acts by default, and names the modes as the picker does", () => {
    const picker: string = dashboardSource(
      "Components/AIChat/PermissionModePicker.tsx",
    );
    const modes: Array<Array<string>> = tableWithHeader(
      englishSection(ASK_AI, "## Actions and permission modes"),
      "Mode",
    );

    expect(AIChatPermissionModeHelper.getDefault()).toBe(
      AIChatPermissionMode.AskForApproval,
    );

    for (const [mode, label] of [
      [AIChatPermissionMode.AskForApproval, "Ask to act"],
      [AIChatPermissionMode.AutoRun, "Auto-run"],
      [AIChatPermissionMode.ReadOnly, "Read-only"],
    ] as Array<[AIChatPermissionMode, string]>) {
      expect(picker).toContain(
        `[AIChatPermissionMode.${mode}]: translationKey("${label}")`,
      );
    }

    expect(
      modes.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([bold("Ask to act"), bold("Auto-run"), bold("Read-only")]);
    expect(rowStartingWith(modes, bold("Ask to act"))[1]).toContain(
      "The default.",
    );
  });

  it("names the approval card's buttons as the card draws them", () => {
    const card: string = dashboardSource(
      "Components/AIChat/ToolApprovalCard.tsx",
    );
    const row: string = englishSection(
      ASK_AI,
      "## Actions and permission modes",
    );

    for (const button of ["Allow", "Skip", "Deny all"]) {
      expect(card).toContain(`translator.translateText("${button}")`);
      expect(row).toContain(bold(button));
    }
  });

  it("lists an action for every change the AI toolbox can make", () => {
    const toolbox: string = readRepoFile(
      "Common/Server/Utils/AI/Toolbox/Index.ts",
    );
    const actions: string = flat(
      englishSection(ASK_AI, "## Actions and permission modes"),
    );

    for (const [tool, says] of [
      ["CreateIncidentTool", "Create an incident"],
      [
        "AcknowledgeIncidentTool",
        "acknowledge or resolve incidents and alerts",
      ],
      ["ResolveAlertTool", "acknowledge or resolve incidents and alerts"],
      ["ChangeIncidentSeverityTool", "change an incident's severity"],
      [
        "CreateIncidentNoteTool",
        "Post an internal note on an incident or an alert",
      ],
      [
        "CreateAlertNoteTool",
        "Post an internal note on an incident or an alert",
      ],
      [
        "PostIncidentStatusUpdateTool",
        "Post a public status update on an incident",
      ],
      ["PageOnCallPolicyTool", "Page an on-call policy"],
      ["RunRunbookTool", "run a runbook"],
      [
        "StartInvestigationTool",
        "start an AI investigation of an incident or alert",
      ],
      [
        "CommitCodeToBranchTool",
        "commit to a new branch of a connected repository",
      ],
      ["OpenCodePullRequestTool", "open a pull request"],
    ] as Array<[string, string]>) {
      expect({ tool, inToolbox: toolbox.includes(`    ${tool},`) }).toEqual({
        tool,
        inToolbox: true,
      });
      expect({ tool, said: actions.includes(says) }).toEqual({
        tool,
        said: true,
      });
    }

    // Chat-authored commits never land where nobody has to merge them.
    expect(toolbox).toContain("These never touch the default or a protected");
    expect(actions).toContain(
      "It never writes to the default branch or a protected one, so a person still merges the change.",
    );
  });

  it("offers the project's providers and the global ones, the default first chosen", () => {
    const service: string = readRepoFile(
      "Common/Server/Services/LlmProviderService.ts",
    );
    const chat: string = dashboardSource("Components/AIChat/useAiChat.ts");
    const steering: string = flat(
      englishSection(ASK_AI, "## Steering a conversation"),
    );

    expect(service).toContain(
      "every provider configured for the project plus every global provider",
    );
    expect(chat).toContain(
      '(data["defaultProviderId"] as string) || undefined',
    );
    expect(steering).toContain(
      "The composer's provider picker lists your project's LLM providers and the global ones, with the default marked. A new conversation uses the default.",
    );
  });

  it("names the rating, cost and download controls as the conversation draws them", () => {
    const messages: string = dashboardSource(
      "Components/AIChat/ChatMessageList.tsx",
    );
    const download: string = dashboardSource(
      "Components/AIChat/ChatDownloadMenu.tsx",
    );
    const steering: string = englishSection(
      ASK_AI,
      "## Steering a conversation",
    );

    for (const title of ["Good answer", "Poor answer"]) {
      expect(messages).toContain(`translator.translateText("${title}")`);
      expect(steering).toContain(bold(title));
    }

    for (const text of [
      "Download conversation",
      "Download as Markdown",
      "Download as PDF",
    ]) {
      expect(download).toContain(`text="${text}"`);
      expect(steering).toContain(bold(text));
    }

    // The footer: cost, tokens and queries of the newest answer.
    expect(messages).toContain("totalCostInUSDCents");
    expect(messages).toContain('other: "{{count}} tokens"');
    expect(messages).toContain('other: "{{count}} queries"');
  });

  it("needs the Growth plan on OneUptime Cloud, Enable AI and a provider, and says so in that order", () => {
    const gate: string = dashboardSource("Components/AI/AIPlanGate.tsx");
    const availability: string = dashboardSource(
      "Components/AIChat/AIChatAvailability.ts",
    );
    const requirements: string = flat(
      englishSection(ASK_AI, "## Requirements"),
    );
    const troubleshooting: string = flat(
      englishSection(ASK_AI, "## Troubleshooting"),
    );

    expect(gate).toContain("PlanType.Growth,");
    expect(PlanType.Growth).toBe("Growth");
    expect(requirements).toContain(
      bold("The Growth plan, on OneUptime Cloud."),
    );
    expect(requirements).toContain(
      `${bold("Enable AI")}, on ${bold("Project Settings → AI → AI Features")}, turns every AI feature of the project off, Ask AI included.`,
    );

    // The panel says why before anything is typed, in this order.
    const order: Array<number> = [
      "PlanUpgradeRequired = ",
      "DisabledForProject = ",
      "NoProviderConfigured = ",
    ].map((reason: string): number => {
      return availability.indexOf(reason);
    });

    expect(order).toEqual(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    );
    expect(troubleshooting).toContain(
      `the project's plan does not include AI, ${bold("Enable AI")} is off, or the project has no LLM provider`,
    );
  });

  it("links the incident's own conversation to the AI SRE section about it", () => {
    expect(page).toContain(
      "[Talk to OneUptime AI about the incident](/docs/ai/ai-sre#talk-to-oneuptime-ai-about-the-incident)",
    );
    expect(englishPage(AI_SRE).split("\n")).toContain(
      "## Talk to OneUptime AI about the incident",
    );
  });
});

describe("Fix Tasks", () => {
  const starts: Array<Array<string>> = tableWithHeader(
    englishSection(FIX_TASKS, "## Where fix tasks start"),
    "Where",
  );

  it("lists Tasks under Products → Code, with the task's Overview, Logs and Pull Requests", () => {
    const items: string = flat(dashboardSource("Utils/NavigationItems.tsx"));
    const taskMenu: string = dashboardSource(
      "Pages/AIAgentTasks/View/SideMenu.tsx",
    );
    const codeMenu: string = dashboardSource(
      "Components/Code/CodeSideMenu.tsx",
    );
    const run: string = flat(
      englishSection(FIX_TASKS, "## How a fix run works"),
    );

    expect(items).toContain('title: t("navbar.items.aiAgentsTitle", "Tasks")');
    expect(items).toContain("category: codeCategory,");
    expect(codeMenu).toContain('title: "Tasks"');
    expect(codeMenu).toContain('title: "Code Repositories"');

    for (const item of ["Overview", "Logs", "Pull Requests"]) {
      expect(taskMenu).toContain(`title: "${item}"`);
      expect(run).toContain(bold(item));
    }

    expect(run).toContain(
      `Every task is listed under ${bold("Products → Code → Tasks")}`,
    );
    // Tasks is in the Code group, never under AI.
    expect(englishPage(FIX_TASKS)).not.toContain("**AI** > **Tasks**");
  });

  it("names every button that starts a fix task, as the Dashboard draws it", () => {
    const exceptionTasks: string = dashboardSource(
      "Utils/ExceptionAIAssistance.ts",
    );
    const investigation: string = dashboardSource(
      "Components/AI/InvestigationPanel.tsx",
    );
    const trace: string = dashboardSource(
      "Components/Traces/TraceDetail/TraceHeader.tsx",
    );
    const telemetry: string = dashboardSource(
      "Components/AI/TelemetryImprovementCard.tsx",
    );

    for (const name of [
      "Fix with AI",
      "Generate Regression Test",
      "Improve Error Handling",
    ]) {
      expect(exceptionTasks).toContain(`startActionName: "${name}"`);
    }

    expect(investigation).toContain('title="Open Fix PR from this analysis"');
    expect(trace).toContain('title="Fix performance with AI"');
    expect(telemetry).toContain('translationKey("Improve Logging")');
    expect(telemetry).toContain('translationKey("Improve Tracing")');

    expect(
      starts.map((row: Array<string>): string => {
        return row[1] as string;
      }),
    ).toEqual(
      [
        "Fix with AI",
        "Generate Regression Test",
        "Improve Error Handling",
        "Open Fix PR from this analysis",
        "Fix performance with AI",
        "Improve Logging",
        "Improve Tracing",
      ].map(bold),
    );
  });

  it("puts the logging and tracing improvements on a service's Logs and Traces pages", () => {
    expect(dashboardSource("Pages/Service/View/Logs.tsx")).toContain(
      'taskType="ImproveLogging"',
    );
    expect(dashboardSource("Pages/Service/View/Traces.tsx")).toContain(
      'taskType="ImproveTracing"',
    );
    expect(
      rowStartingWith(starts, `A service's ${bold("Logs")} page`),
    ).toBeDefined();
    expect(
      rowStartingWith(starts, `A service's ${bold("Traces")} page`),
    ).toBeDefined();
  });

  it("opens an exception's AI Assistance from its side menu, under Resolve", () => {
    const menu: string = flat(
      dashboardSource("Pages/Exceptions/View/SideMenu.tsx"),
    );

    expect(menu).toContain('<SideMenuSection title="Resolve">');
    expect(menu.indexOf('title: "AI Assistance"')).toBeGreaterThan(
      menu.indexOf('<SideMenuSection title="Resolve">'),
    );
    expect(
      flat(englishSection(FIX_TASKS, "## Where fix tasks start")),
    ).toContain(
      `open the exception under ${bold("Products → Observability → Exceptions")} and choose ${bold("AI Assistance")} in its side menu`,
    );
  });

  it("states the run's budgets as the server enforces them", () => {
    const completion: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
    );
    const run: string = flat(
      englishSection(FIX_TASKS, "## How a fix run works"),
    );
    const calls: number = numberConstant(
      completion,
      "MAX_COMPLETION_CALLS_PER_RUN",
    );
    const tokens: number = numberConstant(
      completion,
      "MAX_OUTPUT_TOKENS_PER_RUN",
    );

    expect(run).toContain(
      `at most ${bold(`${calls} LLM calls`)} and ${bold(`${tokens.toLocaleString("en-US")} output tokens`)}`,
    );
  });

  it("names an exception fix's branch as the Runner names it", () => {
    const handler: string = readRepoFile(
      "Runner/TaskHandlers/FixExceptionTaskHandler.ts",
    );
    const prefix: string = stringConstant(handler, "branchPrefix");

    expect(flat(englishSection(FIX_TASKS, "## How a fix run works"))).toContain(
      `A fix of an exception is named \`${prefix}\` followed by the first characters of the run's id.`,
    );
  });

  it("verifies a change with up to 15 minutes a command, CI=true and two repairs", () => {
    const verification: string = readRepoFile(
      "Runner/Utils/BuildVerification.ts",
    );
    const section: string = flat(
      englishSection(FIX_TASKS, "## Verification before the pull request"),
    );
    const minutes: number =
      numberConstant(verification, "VERIFICATION_COMMAND_TIMEOUT_MS") / 60000;
    const repairs: number = numberConstant(verification, "MAX_REPAIR_ATTEMPTS");

    expect(verification).toContain('CI: "true"');
    expect(section).toContain(
      `Each one gets up to ${minutes} minutes and runs with \`CI=true\``,
    );
    expect(section).toContain(
      `It makes at most ${bold(String(repairs))} repair attempts.`,
    );
  });

  it("gives the verification commands the repository Settings page's titles and placeholders", () => {
    const settings: string = flat(
      dashboardSource("Pages/CodeRepository/View/Settings.tsx"),
    );
    const commands: Array<Array<string>> = tableWithHeader(
      englishSection(FIX_TASKS, "## Verification before the pull request"),
      "Command",
    );

    for (const [title, placeholder] of [
      ["Setup Command", "npm ci"],
      ["Build Command", "npm run build"],
      ["Test Command", "npm test"],
    ] as Array<[string, string]>) {
      expect(settings).toContain(`title: "${title}",`);
      expect(settings).toContain(`placeholder: "${placeholder}",`);
      expect(rowStartingWith(commands, bold(title))[1]).toBe(
        `\`${placeholder}\``,
      );
    }
  });

  it("fails a run that stops reporting after 12 minutes, and a task no Runner takes after 30", () => {
    const stuck: string = readRepoFile(
      "App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts",
    );
    const queue: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue.ts",
    );
    const fails: string = flat(
      englishSection(FIX_TASKS, "## When a fix fails"),
    );

    expect(numberConstant(stuck, "RUN_HEARTBEAT_TIMEOUT_MINUTES")).toBe(12);
    expect(stuck).toContain("CodeFixRunQueue.markStaleRunAsError");
    expect(numberConstant(queue, "ORPHANED_QUEUED_TIMEOUT_MINUTES")).toBe(30);
    expect(fails).toContain(
      "A run whose heartbeat has been silent for more than 12 minutes is failed with an error. It is never queued again on its own",
    );
    expect(fails).toContain(
      `A task that waits more than 30 minutes while no Runner with ${bold("Runs AI Code Fixes")} is connected fails`,
    );
  });

  it("prints the Runner's setup command as the Runner's page builds it", () => {
    const image: string = dashboardSource("Components/Runner/RunnerImage.ts");
    const install: string = dashboardSource(
      "Components/Runner/InstallInstructions.tsx",
    );
    const runImage: string = stringConstant(image, "RUNNER_IMAGE");
    const container: string = stringConstant(image, "RUNNER_CONTAINER_NAME");
    const command: string = `docker run --name ${container} --restart unless-stopped \\
  -e ONEUPTIME_RUNNER_ID=<runner-id> \\
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \\
  -e ONEUPTIME_URL=<your-oneuptime-url> \\
  -d ${runImage}`;

    expect(install).toContain(
      "const dockerCommand: string = `docker run --name ${RUNNER_CONTAINER_NAME} --restart unless-stopped \\\\",
    );
    expect(englishPage(FIX_TASKS)).toContain(command);
    expect(install).toContain(
      "only a Project Owner, Project Admin or Runbook Admin can read it",
    );
    expect(flat(englishPage(FIX_TASKS))).toContain(
      "The command embeds the Runner's secret key, which only a Project Owner, Project Admin or Runbook Admin can read.",
    );
    // The key is not shown once and lost: those roles can read it again.
    expect(englishPage(FIX_TASKS)).not.toContain("The key is shown once");
  });

  it("says Runs AI Code Fixes starts off, and that the bundled Runner runs by default", () => {
    const runner: string = flat(
      readRepoFile("Common/Models/DatabaseModels/Runner.ts"),
    );
    const values: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "..", "HelmChart/Public/oneuptime/values.yaml"),
      "utf8",
    );
    const compose: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "..", "docker-compose.yml"),
      "utf8",
    );

    expect(runner).toContain(
      "default: false, }) public canRunCodeFixTasks?: boolean = undefined;",
    );
    expect(values).toContain("runner:\n  enabled: true");
    expect(compose).toContain("  runner:\n");
    expect(flat(englishPage(FIX_TASKS))).toContain(
      `Turn on ${bold("Runs AI Code Fixes")} on the Runner. It is off by default`,
    );
    expect(flat(englishPage(FIX_TASKS))).toContain(
      "The `runner` service of Docker Compose, or the Helm chart's Runner (`runner.enabled`, on by default)",
    );
  });

  it("finds the repository the way the resolver does: the stack trace, then the name, then the only one", () => {
    const resolver: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/StackTraceRepoResolver.ts",
    );
    const before: string = flat(
      englishSection(FIX_TASKS, "## Before you begin"),
    );

    expect(resolver).toContain(
      'method: "stack-trace" | "name-match" | "only-repository";',
    );
    expect(before).toContain(
      "OneUptime finds the repository by matching the file paths of the exception's stack trace against your connected repositories. When nothing matches, it falls back to a repository named like the service, and then to the project's only repository when there is just one.",
    );
  });

  it("needs the Growth plan to connect GitHub on OneUptime Cloud", () => {
    const repository: string = flat(
      readRepoFile("Common/Models/DatabaseModels/CodeRepository.ts"),
    );
    const prerequisites: Array<Array<string>> = tableWithHeader(
      englishSection(FIX_TASKS, "## Before you begin"),
      "What",
    );

    expect(repository).toContain(
      "@TableBillingAccessControl({ create: PlanType.Growth,",
    );
    expect(
      rowStartingWith(
        prerequisites,
        "A repository connected through the GitHub App",
      )[1],
    ).toContain("Needs the Growth plan.");
  });

  it("sends an account that already has the app to Connect an existing installation", () => {
    const prerequisites: Array<Array<string>> = tableWithHeader(
      englishSection(FIX_TASKS, "## Before you begin"),
      "What",
    );

    expect(
      dashboardSource("Pages/CodeRepository/CodeRepository.tsx"),
    ).toContain('"Connect an existing installation"');
    expect(
      rowStartingWith(
        prerequisites,
        "A repository connected through the GitHub App",
      )[1],
    ).toContain(
      `If the app is already installed on the GitHub account, click ${bold("Connect an existing installation")} instead: installing it again does not connect it.`,
    );
  });

  it("keeps the first 300 characters of each step's output in the run's log", () => {
    const agent: string = readRepoFile("Runner/CodeAgents/InHouseCodeAgent.ts");

    expect(agent).toContain("toolResult.substring(0, 300)");
    expect(flat(englishSection(FIX_TASKS, "## Privacy"))).toContain(
      "The task's log keeps the first 300 characters of each step's output",
    );
  });

  it("names the Base URL of the Ollama example as an address the server can reach", () => {
    expect(englishPage(FIX_TASKS)).toContain(
      "GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434",
    );
  });
});

describe("GitHub App", () => {
  const parser: string = readRepoFile(
    "Common/Server/Utils/CodeRepository/GitHub/GitHubCommandParser.ts",
  );

  // The phrases the parser reads as a command, by the command's first one.
  function phrases(first: string): Array<string> {
    const group: RegExpMatchArray | null = flat(parser).match(
      new RegExp(`phrases: \\[([^\\]]*"${escapeRegExp(first)}"[^\\]]*)\\]`),
    );

    if (!group) {
      throw new Error(`No phrase group holds "${first}"`);
    }

    return Array.from((group[1] as string).matchAll(/"([^"]+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
  }

  /*
   * Every row of a commands table: its command, and the phrases its "Also
   * understood" cell lists.
   */
  function commandRows(heading: string): Array<[string, Array<string>]> {
    return tableWithHeader(englishSection(GITHUB_APP, heading), "Command").map(
      (row: Array<string>): [string, Array<string>] => {
        return [
          codeIn(row[0] as string)[0] as string,
          codeIn(row[2] as string),
        ];
      },
    );
  }

  it("lists only phrases the parser reads as each command", () => {
    const rows: Array<[string, Array<string>]> = [
      ...commandRows("### On a pull request"),
      ...commandRows("### On an issue"),
      ...commandRows("### Anywhere"),
    ];

    for (const [command, understood] of rows) {
      if (understood.length === 0) {
        continue;
      }

      const verb: string = command.split(" ")[1] as string;
      const group: Array<string> = phrases(
        verb === "revise"
          ? "revise this"
          : verb === "implement"
            ? "implement this"
            : verb,
      );

      for (const phrase of understood) {
        expect({ command, phrase, read: group.includes(phrase) }).toEqual({
          command,
          phrase,
          read: true,
        });
      }
    }
  });

  it("says help, status and cancel start no agent run", () => {
    const types: string = readRepoFile(
      "Common/Types/CodeRepository/GitHubCommand.ts",
    );

    expect(flat(types)).toContain(
      "commandType === GitHubCommandType.Help || commandType === GitHubCommandType.Status || commandType === GitHubCommandType.Cancel",
    );
    expect(englishPage(GITHUB_APP)).toContain(
      "`help`, `status` and `cancel` never start an agent run, so they cost nothing.",
    );
  });

  /*
   * An edit to a comment that already addressed the app was answered when
   * the comment was written: only an edit that adds the mention asks again.
   */
  it("says editing a comment that already mentions the app does not run it again", () => {
    const handler: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler.ts",
    );

    expect(handler).toContain(
      'return NOT_HANDLED("mention-already-there-before-edit");',
    );
    expect(englishPage(GITHUB_APP)).toContain(
      "Editing a comment that already mentions the app does not run it again: to change your request, write a new comment. An edit that adds the mention is a new request.",
    );
  });

  it("sends an account that already has the app to Connect an existing installation", () => {
    expect(
      dashboardSource("Pages/CodeRepository/CodeRepository.tsx"),
    ).toContain('"Connect an existing installation"');
    expect(englishPage(GITHUB_APP)).toContain(
      `click ${bold("Connect an existing installation")} there instead of installing it again.`,
    );
  });

  it("names the repository's settings as its Settings page draws them, with the trigger label's default", () => {
    const settings: string = flat(
      dashboardSource("Pages/CodeRepository/View/Settings.tsx"),
    );
    const page: string = flat(englishPage(GITHUB_APP));

    for (const title of [
      "Respond to GitHub Commands",
      "GitHub Trigger Label",
      "Max Open Fix Pull Requests",
    ]) {
      expect(settings).toContain(`title: "${title}",`);
      expect(page).toContain(bold(title));
    }

    expect(settings).toContain('placeholder: "oneuptime",');
    expect(page).toContain(
      "the repository's trigger label, `oneuptime` unless you changed it",
    );

    // The cap is one choice: no limit, a limit, or none.
    const limit: string = flat(
      dashboardSource("Components/CodeRepository/FixPullRequestLimit.ts"),
    );

    for (const word of [
      "AI Fix Pull Requests",
      "No limit",
      "A limit",
      "None",
    ]) {
      expect(limit).toMatch(
        new RegExp(`translationKey\\(\\s*"${escapeRegExp(word)}",?\\s*\\)`),
      );
    }

    expect(settings).toContain(
      "overrideFieldKey: FIX_PULL_REQUEST_LIMIT_FIELD_KEY, formOnly: true,",
    );
    expect(page).toContain(
      `${bold("AI Fix Pull Requests")} is ${bold("No limit")} until you choose ${bold("A limit")}, or ${bold("None")}, which blocks AI fix pull requests on that repository.`,
    );
  });

  it("states a run's budget as a fix task's", () => {
    const completion: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
    );

    expect(flat(englishPage(GITHUB_APP))).toContain(
      `a clone, up to ${numberConstant(completion, "MAX_COMPLETION_CALLS_PER_RUN")} LLM calls and ${numberConstant(completion, "MAX_OUTPUT_TOKENS_PER_RUN").toLocaleString("en-US")} output tokens`,
    );
  });

  it("connects a repository under Tasks → Code Repositories, opened from Products → Code → Tasks", () => {
    const page: string = englishPage(GITHUB_APP);

    expect(page).toContain(
      `connect it under ${bold("Tasks → Code Repositories")} (open ${bold("Products → Code → Tasks")})`,
    );
  });
});

describe("LLM Providers", () => {
  it("draws the order AI picks a provider in: the project's default, then a global one", () => {
    const service: string = flat(
      readRepoFile("Common/Server/Services/LlmProviderService.ts"),
    );
    const which: string = flat(
      englishSection(LLM_PROVIDERS, "## Which provider AI uses"),
    );

    expect(service).toContain(
      "// First try to get the default provider for the project let provider: Model | null = await this.findOneBy({ query: { projectId: projectId, isDefault: true, },",
    );
    expect(service).toContain(
      "// If no default provider, get any global provider for the project.",
    );
    expect(which).toContain(
      "AI features use the project's default provider. A project with no default provider uses the global provider, when there is one.",
    );
    expect(which).toContain(
      `A provider is a project's default when ${bold("Set as Default")} is on, which it is for every new provider.`,
    );
  });

  /*
   * The form a project's provider is created and edited with: the shared
   * one (Common/UI/Components/AI/LlmProviderFormFields), which the page
   * draws.
   */
  function providerForm(): string {
    expect(dashboardSource("Pages/Settings/LlmProviders.tsx")).toContain(
      "formFields={getProjectLlmProviderFormFields()}",
    );

    return flat(
      readRepoFile("Common/UI/Components/AI/LlmProviderFormFields.tsx"),
    );
  }

  it("starts a new provider as the default, in the form and on the server", () => {
    const service: string = flat(
      readRepoFile("Common/Server/Services/LlmProviderService.ts"),
    );
    const form: string = providerForm();

    expect(service).toContain(
      "if (createBy.data.isDefault === undefined) { createBy.data.isDefault = true;",
    );
    expect(form).toContain(
      'field: { isDefault: true, }, title: "Set as Default",',
    );
    expect(form).toContain("defaultValue: true,");
  });

  it("walks the create form's two steps by their titles, with each step's fields", () => {
    const form: string = providerForm();
    const setUp: string = flat(
      englishSection(LLM_PROVIDERS, "## Setting Up an LLM Provider"),
    );

    for (const [step, id] of [
      ["Provider", "provider"],
      ["Connection", "connection"],
    ] as Array<[string, string]>) {
      expect(form).toContain(`{ title: "${step}", id: "${id}" }`);
      expect(setUp).toContain(`On ${bold(step)}`);
    }

    // The provider is picked first, then named after it.
    expect(setUp).toContain(`pick your ${bold("LLM Provider")}`);
    expect(form).toContain("getLlmProviderNameAfterPick");
    expect(setUp).toContain(
      `${bold("Name")}: the provider's name until you type your own`,
    );
    expect(setUp).toContain(`a ${bold("Description")}`);
  });

  it("lists every provider type the form offers, in a table row of its own", () => {
    const providers: Array<Array<string>> = tableWithHeader(
      englishSection(LLM_PROVIDERS, "## Supported Providers"),
      "Provider",
    );
    const labels: Array<string> = providers.map(
      (row: Array<string>): string => {
        return row[0] as string;
      },
    );

    expect(labels).toHaveLength(Object.values(LlmType).length);
    expect(labels).toContain(bold("Azure OpenAI / Microsoft Foundry"));
    expect(labels).toContain(bold("OpenAI Compatible"));
  });

  it("names the Draft with AI button the note composer draws", () => {
    expect(
      dashboardSource("Components/EventNotes/EventNoteComposer.tsx"),
    ).toContain('tx("Draft with AI")');
    expect(englishPage(LLM_PROVIDERS)).toContain(bold("Draft with AI"));
  });
});

describe("MCP Server", () => {
  // The singular names of the models under a folder whose source holds a marker.
  function modelsMarked(folder: string, marker: string): Array<string> {
    return sourceFilesUnder(folder)
      .filter((file: string): boolean => {
        return readRepoFile(file).includes(marker);
      })
      .map((file: string): string => {
        const match: RegExpMatchArray | null = readRepoFile(file).match(
          /singularName: "([^"]+)"/,
        );

        if (!match) {
          throw new Error(`${file} has no singular name`);
        }

        return match[1] as string;
      })
      .sort();
  }

  // The records the MCP server makes CRUD tools for.
  function records(): Array<string> {
    return modelsMarked("Common/Models/DatabaseModels", "@EnableMCP()");
  }

  // The telemetry the MCP server makes list and count tools for.
  function telemetry(): Array<string> {
    return modelsMarked("Common/Models/AnalyticsModels", "enableMCP: true");
  }

  function tools(): string {
    return readRepoFile("App/FeatureSet/MCP/Tools/ToolGenerator.ts");
  }

  /*
   * The names the section's tables list, row by row: the first table the
   * records with CRUD tools, the second the telemetry.
   */
  function namesIn(table: number): Array<string> {
    const rows: Array<Array<string>> = (
      tables(englishSection(MCP_SERVER, "## Available Resources"))[table] || []
    ).slice(1);

    return rows
      .flatMap((row: Array<string>): Array<string> => {
        return (row[1] as string).split(", ");
      })
      .sort();
  }

  it("lists every record with CRUD tools, by its model's name", () => {
    expect(records()).toHaveLength(27);
    expect(namesIn(0)).toEqual(records());
    // Every database model with MCP on gets all six tools.
    for (const tool of [
      "createCreateTool(",
      "createReadTool(",
      "createListTool(",
      "createUpdateTool(",
      "createDeleteTool(",
      "createCountTool(",
    ]) {
      expect(tools()).toContain(tool);
    }
  });

  it("lists every kind of telemetry with list and count tools only", () => {
    expect(telemetry()).toHaveLength(9);
    expect(namesIn(1)).toEqual(telemetry());
    expect(tools()).toContain(
      "const analyticsTools: McpToolInfo[] = generateAnalyticsModelTools();",
    );
  });

  it("counts the records and the telemetry as the tables do", () => {
    expect(
      flat(englishSection(MCP_SERVER, "## What the tools cover")),
    ).toContain(
      `There are create, get, list, update, delete and count tools for ${records().length} kinds of record, list and count tools for ${telemetry().length} kinds of telemetry, and tools made for incident response.`,
    );
  });

  it("names the public tools and the tools made for incident response by the server's own names", () => {
    const helper: string = readRepoFile(
      "App/FeatureSet/MCP/Tools/HelperTools.ts",
    );
    const status: string = readRepoFile(
      "App/FeatureSet/MCP/Tools/PublicStatusPageTools.ts",
    );
    const workflow: string = readRepoFile(
      "App/FeatureSet/MCP/Tools/WorkflowTools.ts",
    );
    const page: string = englishPage(MCP_SERVER);

    for (const [source, names] of [
      [helper, ["oneuptime_help", "oneuptime_list_resources"]],
      [
        status,
        [
          "get_public_status_page_overview",
          "get_public_status_page_incidents",
          "get_public_status_page_scheduled_maintenance",
          "get_public_status_page_announcements",
        ],
      ],
      [
        workflow,
        [
          "acknowledge_incident",
          "resolve_incident",
          "acknowledge_alert",
          "resolve_alert",
          "add_incident_note",
          "add_alert_note",
          "oneuptime_whoami",
        ],
      ],
    ] as Array<[string, Array<string>]>) {
      for (const name of names) {
        expect({ name, served: source.includes(`name: "${name}"`) }).toEqual({
          name,
          served: true,
        });
        expect({ name, named: page.includes(`**\`${name}\`**`) }).toEqual({
          name,
          named: true,
        });
      }
    }
  });

  it("pages lists with the server's default and largest limit", () => {
    const config: string = readRepoFile(
      "App/FeatureSet/MCP/Config/ServerConfig.ts",
    );

    expect(numberConstant(config, "LIST_DEFAULT_LIMIT")).toBe(10);
    expect(numberConstant(config, "LIST_MAX_LIMIT")).toBe(100);
    expect(
      flat(englishSection(MCP_SERVER, "## Field Selection and Pagination")),
    ).toContain(
      "List tools page with `limit` (10 by default, 100 at most) and `skip`",
    );
  });

  it("states the tokens' lifetimes as the authorization server issues them", () => {
    const config: string = readRepoFile(
      "Common/Server/Utils/Mcp/McpOAuthConfig.ts",
    );
    const signIn: string = flat(
      englishSection(MCP_SERVER, "### Signing In (OAuth 2.1)"),
    );

    expect(numberConstant(config, "ACCESS_TOKEN_TTL_SECONDS")).toBe(60 * 60);
    expect(numberConstant(config, "REFRESH_TOKEN_TTL_SECONDS")).toBe(
      30 * 24 * 60 * 60,
    );
    expect(signIn).toContain(
      "an access token lasts one hour. A refresh token lasts 30 days",
    );
  });

  it("gives the same connect steps as the MCP Server settings page", () => {
    const settings: string = dashboardSource("Pages/Settings/McpServer.tsx");
    const page: string = englishPage(MCP_SERVER);

    expect(settings).toContain(
      "code={`claude mcp add --transport http oneuptime ${mcpUrl}`}",
    );
    expect(page).toContain(
      "claude mcp add --transport http oneuptime https://oneuptime.com/mcp\n",
    );
    expect(settings).toContain(
      'code={`claude mcp add --transport http oneuptime ${mcpUrl} --header "x-api-key: your-api-key-here"`}',
    );
    expect(page).toContain(
      'claude mcp add --transport http oneuptime https://oneuptime.com/mcp --header "x-api-key: your-api-key-here"',
    );
    expect(settings).toContain(
      'translator.translateText("Customize → Connectors")',
    );
    expect(settings).toContain(
      'translator.translateText("Add custom connector")',
    );
    expect(page).toContain(
      `open ${bold("Customize → Connectors")}, choose ${bold("Add custom connector")}`,
    );
  });

  it("lists connected clients on Project Settings → AI → MCP Server, under Connected MCP Clients", () => {
    const menu: string = flat(dashboardSource("Pages/Settings/SideMenu.tsx"));
    const settings: string = dashboardSource("Pages/Settings/McpServer.tsx");

    expect(menu.indexOf('title: "MCP Server"')).toBeGreaterThan(
      menu.indexOf('title: "AI",'),
    );
    expect(settings).toContain('title: "Connected MCP Clients"');
    expect(flat(englishPage(MCP_SERVER))).toContain(
      `listed on ${bold("Project Settings → AI → MCP Server")}, under ${bold("Connected MCP Clients")}`,
    );
  });

  it("turns a status page's MCP access off on its MCP page, in the AI section of its menu", () => {
    const menu: string = flat(
      dashboardSource("Pages/StatusPages/View/SideMenu.tsx"),
    );
    const mcp: string = dashboardSource("Pages/StatusPages/View/Mcp.tsx");

    expect(menu).toContain(
      '<SideMenuSection title="AI"> <SideMenuItem link={{ title: "MCP",',
    );
    expect(mcp).toContain('title="Enable MCP Server"');
    expect(flat(englishPage(MCP_SERVER))).toContain(
      `open ${bold("MCP")} in the ${bold("AI")} section of its side menu and switch off ${bold("Enable MCP Server")}`,
    );
  });

  it("takes the consent page's choices from the Accounts app", () => {
    const accounts: Record<string, Record<string, string>> = JSON.parse(
      readRepoFile("App/FeatureSet/Accounts/src/Locales/en.json"),
    ) as Record<string, Record<string, string>>;
    const consent: Record<string, string> = accounts["mcpAuthorize"] as Record<
      string,
      string
    >;

    expect(
      flat(englishSection(MCP_SERVER, "## Signing In with OneUptime")),
    ).toContain(
      `Choose ${bold(consent["accessWriteTitle"] as string)}, or ${bold(consent["accessReadTitle"] as string)}.`,
    );
    expect(englishPage(MCP_SERVER)).toContain(
      `Click ${bold(consent["authorizeButton"] as string)}.`,
    );
  });

  it("needs the Growth plan on OneUptime Cloud for API keys and connected clients", () => {
    expect(flat(englishPage(MCP_SERVER))).toContain(
      "On OneUptime Cloud, the Growth plan or higher: connecting an MCP client is available on the same plans as API keys.",
    );
  });
});

describe("AI SRE and the infrastructure AI agents", () => {
  it("says investigations start on and fixing starts off, as new projects do", () => {
    const service: string = readRepoFile(
      "Common/Server/Services/ProjectService.ts",
    );
    const defaults: string = service.slice(
      service.indexOf("export const NEW_PROJECT_AI_DEFAULT_COLUMNS"),
      service.indexOf(
        "];",
        service.indexOf("export const NEW_PROJECT_AI_DEFAULT_COLUMNS"),
      ),
    );
    const how: string = flat(englishSection(AI_SRE, "## How it works"));

    for (const signal of [
      AutoRemediationTriggerEntity.Incident,
      AutoRemediationTriggerEntity.Alert,
    ]) {
      expect(defaults).not.toContain(
        `"${AUTOMATIC_FIX_SWITCH_COLUMNS[signal].fix}"`,
      );
    }

    expect(defaults).toContain('"enableAutomaticIncidentInvestigation"');
    expect(defaults).toContain('"enableAutomaticAlertInvestigation"');
    expect(how).toContain(`${bold("It investigates")} (on by default).`);
    expect(how).toContain(`${bold("It fixes")} (off by default).`);
  });

  it("draws the three checks the command policy runs in the order the page describes them", () => {
    const section: string = englishSection(
      AI_SRE,
      "### What an investigation may run",
    );

    expect(section).toContain("1. The AI tool:");
    expect(section).toContain("2. The server, before");
    expect(section).toContain("3. The AI agent, before");
    expect(flat(section)).toContain(
      "Three independent checks keep it read-only: the policy that tiers every command, the server that refuses to enqueue anything else for an investigation, and the AI agent, which re-checks the same policy before spawning kubectl.",
    );
  });

  /*
   * Test connection, Reset agent and approving a fix take an edit of the
   * very cluster or resource, decided for its own row: the routes ask the
   * one check per record (assertCallerMayChangeCluster, built on
   * findOneUpdatableById, and assertCallerMayChangeResource), never the
   * table half alone (TableHalfWriteGuard in Common holds that).
   */
  it("says Test connection, Reset agent and approving a fix take an edit of that very cluster or resource, as the routes decide it", () => {
    const clusterRoutes: string = readRepoFile(
      "Common/Server/API/KubernetesClusterAiAccessAPI.ts",
    );
    const resourceRoutes: string = readRepoFile(
      "Common/Server/API/ResourceAiAccessAPI.ts",
    );
    const approval: string = readRepoFile(
      "Common/Server/API/AutoRemediationAPI.ts",
    );
    const clusterCheck: string = readRepoFile(
      "Common/Server/Services/KubernetesClusterAiAccessService.ts",
    );

    // The test and the reset of a cluster, and the cluster's own row.
    expect(clusterRoutes).toContain("await assertCanEditCluster({");
    expect(clusterRoutes).toContain(
      "await assertCanChangeClusterToResetAgent({",
    );
    expect(
      clusterRoutes.split(
        "KubernetesClusterAiAccessService.assertCallerMayChangeCluster(",
      ).length - 1,
    ).toBe(2);
    expect(clusterCheck).toContain(
      "await KubernetesClusterService.findOneUpdatableById({",
    );

    // The test and the reset of a resource.
    expect(resourceRoutes).toContain("await assertCanEditResource({");
    expect(resourceRoutes).toContain(
      "await assertCanChangeResourceToResetAgent({",
    );

    // Approving: every cluster and every resource the plan changes.
    expect(approval).toContain("await assertApproverMayChangeClusters({");
    expect(approval).toContain("await assertApproverMayChangeResources({");

    const clusterRule: string = flat(
      englishSection(AI_SRE, "### Who may change it"),
    );
    expect(clusterRule).toContain(
      `is open to anyone who may edit the cluster, and so are ${bold("Test connection")} and approving a fix OneUptime AI proposes for it. All of these take permission to edit that very cluster: a permission limited to some labels, or to the clusters you or your teams own, reaches only those clusters, and a block with labels takes away the clusters that carry them.`,
    );

    const resourceRule: string = flat(
      englishSection(INFRASTRUCTURE_AI_AGENTS, "### Who may change it"),
    );
    expect(resourceRule).toContain(
      `are open to anyone who may edit the resource, and so are ${bold("Test connection")} and approving a fix OneUptime AI proposes for it. All of these take permission to edit that very resource: a permission limited to some labels, or to the resources you or your teams own, reaches only those resources, and a block with labels takes away the resources that carry them.`,
    );
  });

  /*
   * The incident's conversation is a terminal the person asking steers: its
   * read-only kubectl and infrastructure commands reach only the linked
   * clusters and resources that person may view. The thread keeps those
   * alone, with the asking person's props (or the deciding person's on a
   * paused answer), before it builds the turn's tools.
   */
  it("says the conversation's commands reach only the clusters and resources the person asking may view, as the thread builds them", () => {
    const thread: string = flat(
      readRepoFile("Common/Server/Utils/AI/SRE/InvestigationThread.ts"),
    );
    const threadService: string = flat(
      readRepoFile("Common/Server/Utils/AI/SRE/InvestigationThreadService.ts"),
    );

    expect(thread).toContain(
      "await KubernetesClusterAiAccessService.getStatusesViewableBy({ props: data.props,",
    );
    expect(thread).toContain(
      "await ResourceAiAccessService.getStatusesViewableBy({ props: data.props,",
    );
    expect(threadService).toContain("props: data.turn.props,");

    const conversation: string = flat(
      englishSection(AI_SRE, "## Talk to OneUptime AI about the incident"),
    );

    expect(conversation).toContain(
      "(and runs read-only kubectl or infrastructure commands where it has access, on the clusters and resources you may view)",
    );
  });

  it("says the resource AI agent asks for work every 3 seconds, as its loop does", () => {
    const config: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "..", "agents/ResourceAIAgent/Config.ts"),
      "utf8",
    );

    expect(numberConstant(config, "DEFAULT_POLL_INTERVAL_MS")).toBe(3000);
    expect(
      flat(
        englishSection(INFRASTRUCTURE_AI_AGENTS, "### Connecting to OneUptime"),
      ),
    ).toContain("asks for work every 3 seconds");
    expect(
      flat(englishSection(INFRASTRUCTURE_AI_AGENTS, "## How it works")),
    ).toContain("The agent asks for<br/>work every 3 seconds");
  });
});
