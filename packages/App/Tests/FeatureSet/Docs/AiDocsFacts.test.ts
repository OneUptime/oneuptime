import {
  AI_SRE,
  ASK_AI,
  CODE_PAGE,
  EXTERNAL_MCP_SERVERS,
  GITHUB_APP,
  INFRASTRUCTURE_AI_AGENTS,
  LLM_PROVIDERS,
  MCP_SERVER,
} from "./AiDocsPages";
import { tables } from "./DocsPageShape";
import {
  MCP_CLIENTS,
  MCP_CLIENT_NAMES,
  MCP_SIGN_IN_ANSWERS,
  McpClient,
  McpConnectSetupStep,
  getMcpConnectSetup,
} from "../../../FeatureSet/Dashboard/src/Components/Mcp/McpConnectSetup";
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
import { AUTOMATIC_FIX_SWITCH_COLUMNS } from "Common/Types/AI/AutomaticFixPullRequests";
import { INCIDENT_AND_ALERT_TRIGGER_ENTITIES } from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  CODE_TASK_LIMITS,
  CODE_TASK_LOG_WINDOWS_IN_HOURS,
} from "Common/Types/AI/CodeTask";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "Common/Types/AI/CodeFixTaskType";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  PRODUCTION_REVIEW_LIMITS,
  PRODUCTION_REVIEW_WINDOWS,
  ProductionReviewPosting,
  ProductionReviewPullRequestContent,
  ProductionReviewSection,
  ProductionReviewUtil,
} from "Common/Types/CodeRepository/ProductionReview";
import LlmType from "Common/Types/LLM/LlmType";
import {
  CodeRepositoryRunnerChoiceKind,
  decideCodeRepositoryRunner,
} from "Common/Types/Runner/CodeRepositoryRunner";
import {
  CodeRepositorySetting,
  getCodeRepositorySettingsPath,
} from "Common/Types/CodeRepository/CodeRepositorySetting";
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

/*
 * Whether the repository's Settings page draws what the marker names inside
 * its More settings (AdvancedPageSection): what the pages say is "under
 * More settings" must be there.
 */
function isUnderMoreSettings(settings: string, marker: string): boolean {
  const opens: number = settings.indexOf("<AdvancedPageSection");
  const closes: number = settings.indexOf("</AdvancedPageSection>");
  const at: number = settings.indexOf(marker);

  return opens !== -1 && at > opens && at < closes;
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
    const dialog: string = dashboardSource("Components/AIChat/AskAiDialog.tsx");
    const anyPage: string = rowStartingWith(open, "Any page").join(" | ");

    expect(header).toContain('name="Ask AI"');
    expect(header).toContain('shortcut={[KeyboardKey.Mod, "I"]}');
    expect(dialog).toContain('event.key.toLowerCase() !== "i"');
    expect(dialog).toContain('target.tagName === "TEXTAREA"');
    expect(dialog).toContain("target.isContentEditable");
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

  /*
   * Products → AI → Chat, and a conversation's own address, open the dialog
   * over the page the person was on (Pages/AICopilot passes the browser
   * back to it), not a second, full-page design.
   */
  it("opens from the products menu over the page you were on, a conversation at an address of its own", () => {
    const items: string = dashboardSource("Utils/NavigationItems.tsx");
    const routes: string = flat(dashboardSource("Utils/RouteMap.ts"));
    const address: string = dashboardSource("Pages/AICopilot/AICopilot.tsx");

    expect(flat(items)).toContain(
      'title: t("navbar.items.aiChatTitle", "Chat")',
    );
    expect(items).toContain('t("navbar.categories.ai", "AI")');
    expect(routes).toContain(
      "[PageMap.AI_COPILOT_CONVERSATION]: new Route( `/dashboard/${RouteParams.ProjectID}/ai/chat/${RouteParams.ModelID}`, )",
    );
    expect(address).toContain("openAskAi({");
    expect(address).toContain("Navigation.goBack();");
    expect(rowStartingWith(open, "The products menu")[1]).toContain(
      `Open ${bold("Products → AI → Chat")}. Ask AI opens over the page you were on. Each conversation has its own address`,
    );
  });

  /*
   * A dialog in the middle of the screen, a full-screen sheet on a phone;
   * Esc or a click beside it goes back to the page; the conversation is
   * kept; and an answer still being written when it closed says when it
   * is ready (AskAiResumeButton).
   */
  it("opens as a dialog over the page, and closing it loses nothing", () => {
    const dialog: string = dashboardSource("Components/AIChat/AskAiDialog.tsx");
    const resume: string = dashboardSource(
      "Components/AIChat/AskAiResumeButton.tsx",
    );
    const said: string = flat(englishSection(ASK_AI, "## Open Ask AI"));

    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("sm:items-center");
    expect(dialog).toContain("h-[100dvh] w-full");
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain("onClick={onBackdropClick}");
    expect(dialog).toContain("<AskAiResumeButton");
    expect(resume).toContain('translator.translateText("Ask AI has answered")');
    expect(said).toContain(
      "Ask AI opens in the middle of the screen, over the page you were on, and on a phone it fills the screen. Press `Esc`, or click beside it, to go back to the page. The conversation stays where you left it: open Ask AI again to carry on. If you close it while it is still answering, a reminder in the corner says when the answer is ready, and opens it.",
    );
  });

  /*
   * The start offers the page's own questions, and the context chip can be
   * removed and added back (PageContextChip's attach button).
   */
  it("suggests the page's own questions, and the chip can be removed and added back", () => {
    const start: string = dashboardSource("Components/AIChat/ChatHomeView.tsx");
    const chip: string = dashboardSource(
      "Components/AIChat/PageContextChip.tsx",
    );
    const said: string = flat(englishSection(ASK_AI, "## Page context"));

    expect(start).toContain("PageContextUtil.getSuggestions(context, translator)");
    expect(chip).toContain('translateText("Remove page context")');
    expect(chip).toContain(
      '"Attach this page as context for your questions"',
    );
    expect(said).toContain(
      "the composer shows a chip with the page's subject, and the questions it suggests are that page's own. Remove the chip to ask about the whole project instead, and add it back the same way. Open Ask AI on another page and the context follows you.",
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
      // An alert, as an incident (#5301).
      ["CreateAlertTool", "Create an incident or an alert"],
      [
        "AddIncidentAffectedResourcesTool",
        "Link an incident or an alert to the infrastructure and services it is about",
      ],
      [
        "AddAlertAffectedResourcesTool",
        "Link an incident or an alert to the infrastructure and services it is about",
      ],
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
    // Only when there is a choice: one provider draws no picker at all.
    expect(dashboardSource("Components/AIChat/AskAiDialog.tsx")).toContain(
      "chat.providers.length > 1 ? (",
    );
    expect(steering).toContain(
      "When your project can use more than one LLM provider, the composer's provider picker lists your project's LLM providers and the global ones, with the default marked. A new conversation uses the default.",
    );
  });

  // The live line: what it does now, and its steps a click away.
  it("says what it is doing in one line, which opens into its steps", () => {
    const messages: string = dashboardSource(
      "Components/AIChat/ChatMessageList.tsx",
    );
    const steering: string = flat(
      englishSection(ASK_AI, "## Steering a conversation"),
    );

    expect(messages).toContain('data-testid="ai-chat-live-step"');
    expect(messages).toContain(
      '{ one: "{{count}} step", other: "{{count}} steps" }',
    );
    expect(steering).toContain(
      "While it answers, one line says what it is doing now, such as searching logs. Click the number of steps beside it to see each step.",
    );
  });

  // The history: All conversations in the header, the last three on the start.
  it("keeps every conversation a click away, and the last three on the start", () => {
    const dialog: string = dashboardSource("Components/AIChat/AskAiDialog.tsx");
    const start: string = dashboardSource("Components/AIChat/ChatHomeView.tsx");
    const steering: string = flat(
      englishSection(ASK_AI, "## Steering a conversation"),
    );

    expect(dialog).toContain('translator.translateText("All conversations")');
    expect(numberConstant(start, "RECENT_CONVERSATIONS_SHOWN")).toBe(3);
    expect(steering).toContain(
      `${bold("All conversations")}, in Ask AI's header, lists your conversations, newest first, to open again or delete. A new conversation's start shows the last three.`,
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

    // Under an answer, its sources; the newest one's cost, tokens and queries.
    expect(messages).toContain('{ one: "{{count}} source", other: "{{count}} sources" }');
    expect(messages).toContain("totalCostInUSDCents");
    expect(messages).toContain('other: "{{count}} tokens"');
    expect(messages).toContain('other: "{{count}} queries"');
    expect(flat(steering)).toContain(
      "Under each answer, its sources open into the queries it ran, and the newest answer's also say how many queries it ran, its tokens and its cost.",
    );
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

    // Ask AI says why before anything is typed, in this order.
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

  /*
   * Issue #5259: on a host's page Ask AI answered that it had no tool to run
   * a command, though the Host AI agent was connected. The section says what
   * it runs now, through which agent, for whom - and what never runs.
   */
  it("runs the page's resource's read-only commands through its AI agent, for the resources you may view", () => {
    const api: string = readRepoFile("Common/Server/API/AIChatAPI.ts");
    const access: string = flat(
      readRepoFile("Common/Server/Utils/AI/Chat/ChatInfrastructureAccess.ts"),
    );
    const section: string = flat(
      englishSection(ASK_AI, "## Commands on your infrastructure"),
    );

    // Every turn the chat API starts, and every one it resumes, asks for it.
    expect(api.split("offersPageInfrastructure: true,").length - 1).toBe(2);
    expect(section).toContain(
      "Ask AI runs commands on it through that agent when you ask",
    );

    // The resource or cluster on the page, or what an incident or alert links.
    expect(access).toContain("ResourceAiAccessService.getStatusForResource({");
    expect(access).toContain(
      "KubernetesClusterAiAccessService.getStatusForCluster({",
    );
    expect(access).toContain("ResourceAiAccessService.getStatusesForSubject({");
    expect(section).toContain("or a Kubernetes cluster)");
    expect(section).toContain(
      "Opened on an incident or an alert, it reaches the resources linked to it.",
    );

    // An investigation's own read-only toolkits: never a change.
    expect(access).toContain("new KubectlInvestigationToolkit(");
    expect(access).toContain("new InfrastructureInvestigationToolkit(");
    expect(access).not.toContain("isMutation: true");
    expect(section).toContain(
      "It runs only the read-only commands an AI investigation may run on that kind of resource",
    );
    expect(section).toContain(
      "A change through the agent, such as restarting a service, never runs from Ask AI: it gives you the exact command instead",
    );

    // At most so many for one answer, through each kind of agent's toolkit.
    const perAnswer: number = numberConstant(
      readRepoFile("Common/Server/Utils/AI/Chat/ChatInfrastructureAccess.ts"),
      "MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER",
    );
    expect(access).toContain(
      "maxCommands: MAX_INFRASTRUCTURE_COMMANDS_PER_ANSWER,",
    );
    expect(access.split("maxCommands: data.maxCommands,").length - 1).toBe(2);
    expect(section).toContain(
      `at most ${perAnswer} for one answer through each kind of agent`,
    );

    /*
     * The commands only read; Ask AI's own actions - a runbook among them -
     * are the permission mode's, which the next section describes.
     */
    expect(readRepoFile("Common/Server/Utils/AI/Toolbox/Index.ts")).toContain(
      "    RunRunbookTool,",
    );
    expect(section).toContain(
      "Ask AI's own actions, such as running a runbook, follow the conversation's permission mode, as below.",
    );

    // When it cannot: why, and what would change it.
    expect(access).toContain("this.buildWithoutAccessSection(tools.viewable),");
    expect(section).toContain("it says so, with what to change");

    // Only what the person asking may view.
    expect(access).toContain(
      "KubernetesClusterAiAccessService.getStatusesViewableBy({",
    );
    expect(access).toContain("ResourceAiAccessService.getStatusesViewableBy({");
    expect(section).toContain(
      "It reaches only the resources you may view, and only while AI investigation is on for the resource.",
    );

    expect(section).toContain(
      "[Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents)",
    );
    expect(englishPage(INFRASTRUCTURE_AI_AGENTS).split("\n")[2]).toContain(
      "Ask AI, opened on the resource's page, runs the same read-only commands when you ask it to (see [Ask AI](/docs/ai/ask-ai)).",
    );
  });
});

describe("Code", () => {
  const starts: Array<Array<string>> = tableWithHeader(
    englishSection(CODE_PAGE, "## Where fix tasks start"),
    "Where",
  );

  it("opens Code from Products, a repository's Tasks and Settings, and each turn's Log", () => {
    const items: string = flat(dashboardSource("Utils/NavigationItems.tsx"));
    const repositoryMenu: string = dashboardSource(
      "Pages/Code/Repository/SideMenu.tsx",
    );
    const turn: string = dashboardSource("Components/Code/CodeTaskTurn.tsx");
    const page: string = flat(englishPage(CODE_PAGE));

    expect(items).toContain('title: t("navbar.items.codeTitle", "Code")');
    expect(items).toContain("category: codeCategory,");
    expect(items).not.toContain("navbar.items.aiAgentsTitle");
    expect(repositoryMenu).toContain('title: "Tasks"');
    expect(repositoryMenu).toContain('title: "Settings"');
    expect(turn).toContain('translator.translateText("Log")');

    expect(page).toContain(
      `Every task is listed in its repository under ${bold("Products → Code")}`,
    );
    expect(page).toContain(`each turn's ${bold("Log")} has a line`);
    // Code is one product: no Tasks page under it, and nothing under AI.
    expect(page).not.toContain("Products → Code → Tasks");
    expect(page).not.toContain("**AI** > **Tasks**");
  });

  it("says a task's Log page picks between its turns, once it has more than one", () => {
    const log: string = flat(dashboardSource("Pages/Code/Task/Log.tsx"));
    const turns: string = flat(
      dashboardSource("Components/Code/CodeTaskLogTurns.ts"),
    );

    // The picker lists the task's turns, and shows only with more than one.
    expect(turns).toContain('label: translationKey("Turn"),');
    expect(log).toContain("<CodeTaskLogTurnPicker");
    expect(log).toContain("turns.length > 1");
    expect(
      flat(englishSection(CODE_PAGE, "## A task's conversation")),
    ).toContain(
      `On a task with more than one turn, a picker at the top of the ${bold("Log")} page moves between its turns.`,
    );
  });

  it("asks AI with the words Code's pages draw: the question, the pickers, the examples", () => {
    const home: string = dashboardSource("Pages/Code/Code.tsx");
    const askBox: string = dashboardSource("Components/Code/CodeAskBox.tsx");
    const sideMenu: string = dashboardSource(
      "Components/Code/CodeSideMenu.tsx",
    );
    const copy: string = dashboardSource("Components/Code/CodeTaskCopy.ts");
    const composer: string = dashboardSource(
      "Components/Code/CodeComposer.tsx",
    );
    const connect: string = dashboardSource(
      "Components/Code/GitHubConnect.tsx",
    );
    const ask: string = flat(
      englishSection(CODE_PAGE, "## Ask AI in a repository"),
    );

    // Code opens on the question, over the box where it is asked.
    expect(home).toContain('translator.translateText("What should AI do?")');
    expect(home).toContain("<CodeAskBox");
    expect(askBox).toContain('translator.translateTemplate("Try asking")');
    expect(askBox).toContain(
      'sendLabel={translator.translateTemplate("Start task")}',
    );
    // The repository picked last is the one the box starts on.
    expect(askBox).toContain(
      "getRememberedRepositoryKey(projectId.toString())",
    );
    // Repositories is in Code's side menu; the main branch is badged Default.
    expect(sideMenu).toContain('title: "Repositories"');
    expect(copy).toContain('branchDefaultBadge: translationKey("Default"),');
    expect(composer).toContain('translator.translateText("Add context")');
    // Enter sends; Shift + Enter starts a new line.
    expect(composer).toContain('event.key === "Enter" &&');
    expect(composer).toContain("!event.shiftKey &&");
    expect(connect).toContain('translator.translateText("Connect GitHub")');

    for (const label of [
      "Products → Code",
      "What should AI do?",
      "Connect GitHub",
      "Repositories",
      "Default",
      "Try asking",
      "Add context",
      "Start task",
    ]) {
      expect(ask).toContain(bold(label));
    }

    expect(ask).toContain(`Click ${bold("Start task")}, or press Enter.`);
    expect(ask).toContain("The box starts on the repository you picked last.");
  });

  it("lists every kind of context as Add context offers it, with the limits the server holds", () => {
    const copy: string = dashboardSource("Components/Code/CodeTaskCopy.ts");
    const builder: string = readRepoFile(
      "Common/Server/Utils/AI/CodeTask/CodeTaskContextBuilder.ts",
    );
    const ask: string = englishSection(CODE_PAGE, "## Ask AI in a repository");
    const rows: Array<Array<string>> = tableWithHeader(ask, "Context");
    const labels: Array<string> = [
      "File or folder",
      "Note",
      "Link",
      "Incident",
      "Alert",
      "Exception",
      "Monitor",
      "Trace",
      "Logs",
      "Performance profile",
    ];

    for (const label of labels) {
      expect(copy).toContain(`label: translationKey("${label}"),`);
    }

    // In the menu's order, the incident and the alert in one row.
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      bold("File or folder"),
      bold("Note"),
      bold("Link"),
      `${bold("Incident")} or ${bold("Alert")}`,
      bold("Exception"),
      bold("Monitor"),
      bold("Trace"),
      bold("Logs"),
      bold("Performance profile"),
    ]);
    // What the Add context dialog says a profile gives AI.
    expect(dashboardSource("Components/Code/CodeContextModal.tsx")).toContain(
      "\"AI reads where the function's time goes in the service's profiles: who calls it, what it calls and its hottest lines.\"",
    );
    expect(rowStartingWith(rows, bold("Performance profile"))[1]).toBe(
      "Where a function's time goes in its service's profiles: who calls it, what it calls and its hottest lines.",
    );

    expect(numberConstant(builder, "LOG_LINES")).toBe(20);
    expect(CODE_TASK_LOG_WINDOWS_IN_HOURS).toEqual([1, 24, 168]);
    expect(rowStartingWith(rows, bold("Logs"))[1]).toBe(
      "The latest 20 log lines that contain your search, from the last hour, day or week.",
    );
    expect(flat(ask)).toContain(
      `A request carries at most ${CODE_TASK_LIMITS.maxContextItems} pieces of context.`,
    );
    // What AI reads of a record is redacted as the AI toolbox redacts.
    expect(builder).toContain(
      "ToolResultSerializer.redactAndOmitEmbeddedData(text).text",
    );
    expect(flat(ask)).toContain(
      "Tokens, keys, passwords and email addresses in what OneUptime reads are redacted before AI sees them",
    );
  });

  it("names a task's states as its page draws them, with Stop and Try again", () => {
    const copy: string = dashboardSource("Components/Code/CodeTaskCopy.ts");
    const conversation: string = dashboardSource(
      "Pages/Code/Task/Conversation.tsx",
    );
    const turn: string = dashboardSource("Components/Code/CodeTaskTurn.tsx");
    const states: Array<Array<string>> = tableWithHeader(
      englishSection(CODE_PAGE, "## A task's conversation"),
      "State",
    );

    expect(copy).toContain(
      'export const QUEUED_LABEL: string = translationKey("Queued");',
    );

    for (const state of [
      "Working…",
      "Waiting for you",
      "Done",
      "Failed",
      "Stopped",
    ]) {
      expect(copy).toContain(`label: translationKey("${state}"),`);
    }

    expect(
      states.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      [
        "Queued",
        "Working…",
        "Waiting for you",
        "Done",
        "Failed",
        "Stopped",
      ].map(bold),
    );
    expect(conversation).toContain('translator.translateText("Stop")');
    expect(turn).toContain('translator.translateText("Try again")');
    expect(rowStartingWith(states, bold("Working…"))[1]).toContain(
      `${bold("Stop")} stops it`,
    );
    expect(rowStartingWith(states, bold("Failed"))[1]).toContain(
      `${bold("Try again")} asks the same again.`,
    );
  });

  it("continues a task on its pull request's branch, and lets only editors ask, reply, stop and read the diff", () => {
    const handler: string = readRepoFile(
      "Runner/TaskHandlers/CodeRequestTaskHandler.ts",
    );
    const api: string = readRepoFile("Common/Server/API/CodeTaskAPI.ts");
    const access: string = readRepoFile(
      "Common/Server/Utils/AI/CodeTask/CodeTaskAccess.ts",
    );
    const section: string = flat(
      englishSection(CODE_PAGE, "## A task's conversation"),
    );

    expect(handler).toContain(
      "const branchName: string = details.workingBranch || details.newBranchName;",
    );
    expect(section).toContain(
      "Each reply is the next turn of the same task: it works on the same branch and pushes to the same pull request while that is open.",
    );
    expect(access).toContain(
      "await ModelPermission.checkUpdatePermissionByModel<CodeRepository>({",
    );
    expect(api).toContain("canSeeChanges: canAsk,");
    expect(section).toContain(
      "Anyone who can read a repository reads its tasks. Asking AI, replying and stopping a task take permission to edit the repository, and so does seeing a change's diff: everyone else sees which files changed.",
    );
  });

  it("names every button that starts a fix task, as the Dashboard draws it", () => {
    const exceptionTasks: string = dashboardSource(
      "Utils/ExceptionAIAssistance.ts",
    );
    const investigation: string = dashboardSource(
      "Components/AI/InvestigationPanel.tsx",
    );
    // The trace's button is drawn by its finding strip, beside the finding.
    const trace: string = dashboardSource(
      "Components/Traces/TraceDetail/TracePerformanceSuggestionCopy.ts",
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
    expect(trace).toContain('"Fix performance with AI"');
    expect(telemetry).toContain('translationKey("Improve Logging")');
    expect(telemetry).toContain('translationKey("Improve Tracing")');
    // The Profiler's function panel, beside the function's finding.
    expect(dashboardSource("Components/Profiles/ProfileCopy.ts")).toContain(
      'export const FIX_WITH_AI: string = translationKey("Fix with AI");',
    );

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
        "Fix with AI",
      ].map(bold),
    );
  });

  it("offers a function's Fix with AI only on own code that takes a real share, or grew, as the shared rule decides", () => {
    const rule: string = flat(
      readRepoFile("Common/Utils/Suggestions/ProfileFixSuggestion.ts"),
    );

    expect(rule).toContain(
      "export const PROFILE_FIX_MIN_OWN_SHARE_PERCENT: number = 5;",
    );
    expect(rule).toContain(
      "export const PROFILE_FIX_MIN_GROWTH_POINTS: number = 3;",
    );
    expect(flat(englishPage(CODE_PAGE))).toContain(
      `A function's ${bold("Fix with AI")} shows only on the application's own code that takes at least 5% of the profile's time or memory, or whose share grew by 3 points or more since the window it is compared with`,
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

  it("says the buttons show only where they can start a task, as the Dashboard decides it", () => {
    const section: string = flat(
      englishSection(CODE_PAGE, "## Where fix tasks start"),
    );
    const menu: string = flat(
      dashboardSource("Pages/Exceptions/View/SideMenu.tsx"),
    );
    const assistance: string = flat(
      dashboardSource("Components/Exceptions/ExceptionAIAssistance.tsx"),
    );
    const telemetry: string = flat(
      dashboardSource("Components/AI/TelemetryImprovementCard.tsx"),
    );
    const investigation: string = flat(
      dashboardSource("Components/AI/InvestigationPanel.tsx"),
    );
    const traceExplorer: string = flat(
      dashboardSource("Components/Traces/TraceExplorer.tsx"),
    );
    const telemetryRule: string = readRepoFile(
      "Common/Utils/Suggestions/TelemetryImprovementSuggestion.ts",
    );

    // AI off: the exception menu leaves AI Assistance out, and its page says so.
    expect(menu).toContain("const isAiOffered: boolean = useAiOffered();");
    expect(menu).toContain(
      '{isAiOffered ? ( <SideMenuSection title="Resolve">',
    );
    expect(assistance).toContain("if (!isAiOffered) {");
    // AI off: the investigation's fix action and the trace's suggestion too.
    expect(investigation).toContain(
      "isCodeFixRecommended && (isAiOffered || Boolean(fixTaskRunId));",
    );
    expect(traceExplorer).toContain("if (!isAiOfferedForSelectedProject()) {");
    // Improve Logging / Tracing: AI on and a repository, never a setup link.
    expect(telemetry).toContain("if (!isAiOffered) { return; }");
    expect(telemetryRule).toContain("isBackedByEvidence: false,");
    /*
     * ... and nothing Code's gate says stops the run (CodeFixStartGate: the
     * plan, AI credits, a Runner online): the card is not drawn then
     * either, for the same reason.
     */
    expect(telemetryRule).toContain("isBlocked: input.isBlocked,");
    expect(
      readRepoFile(
        "Common/Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger.ts",
      ),
    ).toContain("CodeFixStartGate.check(");

    expect(section).toContain(
      `These buttons show only where they can start a task. With AI switched off for the project, none of them is shown and an exception's side menu has no ${bold("AI Assistance")}. ${bold("Improve Logging")} and ${bold("Improve Tracing")} show once a repository is connected and nothing stops AI working in it (such as the plan, used-up AI credits or no Runner online), and ${bold("Fix performance with AI")} only on a trace worth fixing (see [Traces Explorer](/docs/telemetry/traces-explorer)).`,
    );
    expect(rowStartingWith(starts, "A trace worth fixing")?.[2]).toBe(
      "Fixes the slow pattern the button names, such as an N+1 query or calls that could run in parallel.",
    );
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
      flat(englishSection(CODE_PAGE, "## Where fix tasks start")),
    ).toContain(
      `open the exception under ${bold("Products → Observability → Exceptions")} and choose ${bold("AI Assistance")} in its side menu`,
    );
  });

  it("states the run's budgets as the server enforces them", () => {
    const completion: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
    );
    const run: string = flat(
      englishSection(CODE_PAGE, "## How a fix run works"),
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

    expect(flat(englishSection(CODE_PAGE, "## How a fix run works"))).toContain(
      `A fix of an exception is named \`${prefix}\` followed by the first characters of the run's id.`,
    );
  });

  it("verifies a change with up to 15 minutes a command, CI=true and two repairs", () => {
    const verification: string = readRepoFile(
      "Runner/Utils/BuildVerification.ts",
    );
    const section: string = flat(
      englishSection(CODE_PAGE, "## Verification before the pull request"),
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

  it("says the code agent reads the repository's AGENTS.md, else its CLAUDE.md, and where it looks without either, as the Runner's prompt does", () => {
    const instructions: string = flat(
      readRepoFile("Runner/Utils/RepositoryInstructions.ts"),
    );
    const section: string = flat(
      englishSection(CODE_PAGE, "## Verification before the pull request"),
    );

    expect(instructions).toContain(
      'export const REPOSITORY_INSTRUCTION_FILES: ReadonlyArray<string> = [ "AGENTS.md", "CLAUDE.md", ];',
    );
    expect(section).toContain(
      "Before the code agent changes anything, it reads the repository's `AGENTS.md` (or its `CLAUDE.md`, when it has no `AGENTS.md`) from the branch the task starts from, and works the way it says.",
    );

    // Where the prompt sends the agent when the repository has neither.
    for (const place of [
      "CONTRIBUTING.md",
      "the README",
      "the package scripts (package.json)",
      "a Makefile",
      "the CI workflows under .github/workflows",
    ]) {
      expect(instructions).toContain(place);
    }

    expect(section).toContain(
      "With neither, it learns how from the repository's `CONTRIBUTING.md`, README, package scripts, `Makefile` or CI workflows. There is nothing to set up in OneUptime.",
    );
  });

  it("has a Runner of the project's own build and test the change, 2 minutes a command or up to 10 when asked, without its credentials, and Global Runner run no command", () => {
    const agent: string = readRepoFile("Runner/CodeAgents/InHouseCodeAgent.ts");
    const limits: string = readRepoFile("Runner/Utils/AgentCommandLimits.ts");
    const checks: Array<Array<string>> = tableWithHeader(
      englishSection(CODE_PAGE, "## Verification before the pull request"),
      "Where AI works",
    );
    const minutes: number =
      numberConstant(limits, "DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS") / 60;
    const mostMinutes: number =
      numberConstant(limits, "MAX_AGENT_COMMAND_TIMEOUT_SECONDS") / 60;

    // The agent's commands take their time from the limits, and may ask for more.
    expect(agent).toContain("getAgentCommandTimeoutMs(");
    expect(agent).toContain("[AGENT_COMMAND_TIMEOUT_ARGUMENT]");

    // Told to check its change only where it can run commands at all.
    expect(flat(agent)).toContain(
      "canRunCommands: runsProjectAuthoredCommands(),",
    );

    // A command the model composed runs without the Runner's own key.
    expect(flat(agent)).toContain(
      'for (const name of [ "ONEUPTIME_RUNNER_KEY", "ONEUPTIME_RUNNER_ID", "GIT_ASKPASS", "ONEUPTIME_GIT_ACCESS_TOKEN", ]) { delete environment[name]; }',
    );

    expect(rowStartingWith(checks, "One of your Runners")[1]).toContain(
      `Each command it runs gets ${minutes} minutes, or up to ${mostMinutes} for a slow install, build or test suite, without the Runner's own credentials in its environment.`,
    );
    expect(rowStartingWith(checks, bold("Global Runner"))[1]).toBe(
      "Runs no command: it writes the change and opens the pull request, and your repository's own CI checks it.",
    );
  });

  it("names the commands an operator set as the repository's settings draw them: read-only under More settings, with Remove Commands", () => {
    const copy: string = flat(
      dashboardSource("Components/Code/CodeRepositorySettingsCopy.ts"),
    );
    const card: string = flat(
      dashboardSource("Components/Code/CodeRepositoryCommandsCard.tsx"),
    );
    const section: string = flat(
      englishSection(CODE_PAGE, "### Commands set on a repository"),
    );

    expect(copy).toContain(
      'commandsCardTitle: translationKey("Build and Test Commands"),',
    );
    expect(copy).toContain(
      'removeCommandsButton: translationKey("Remove Commands"),',
    );

    // The card shows them; nothing on the page asks for them any more.
    for (const title of ["Setup Command", "Build Command", "Test Command"]) {
      expect(card).toContain(`title: "${title}" }`);
    }

    expect(dashboardSource("Pages/Code/Repository/Settings.tsx")).not.toMatch(
      /setupCommand: true,\s*\},\s*title:/,
    );
    expect(section).toContain(
      `They show read-only on the ${bold("Build and Test Commands")} card, under ${bold("More settings")} on the repository's ${bold("Settings")} page, and ${bold("Remove Commands")} removes all three.`,
    );
  });

  it("fails a run that stops reporting after 12 minutes, and a task no Runner takes after 30", () => {
    const stuck: string = readRepoFile(
      "App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts",
    );
    const queue: string = readRepoFile(
      "Common/Server/Utils/AI/CodeFix/CodeFixRunQueue.ts",
    );
    const fails: string = flat(
      englishSection(CODE_PAGE, "## When a fix fails"),
    );

    expect(numberConstant(stuck, "RUN_HEARTBEAT_TIMEOUT_MINUTES")).toBe(12);
    expect(stuck).toContain("CodeFixRunQueue.markStaleRunAsError");
    expect(numberConstant(queue, "ORPHANED_QUEUED_TIMEOUT_MINUTES")).toBe(30);
    expect(fails).toContain(
      "A run whose heartbeat has been silent for more than 12 minutes is failed with an error. It is never queued again on its own",
    );
    expect(fails).toContain(
      "A task that waits more than 30 minutes while the Runner that should take it is not connected - the one its repository picks, the project's default Runner for a repository that picks none, or a global Runner - fails, with a message that says which",
    );
    // The sweeper says which: the repository's Runner, or a global one.
    expect(queue).toContain("describeRepositoryRunnerStatus(");
  });

  it("keeps a run's heartbeat going while a command of the code agent runs, well inside the 12 minutes", () => {
    const stuck: string = readRepoFile(
      "App/FeatureSet/Workers/Jobs/AIChat/TimeoutStuckRuns.ts",
    );
    const limits: string = readRepoFile("Runner/Utils/AgentCommandLimits.ts");
    const agent: string = flat(
      readRepoFile("Runner/CodeAgents/InHouseCodeAgent.ts"),
    );

    // A beat at least every interval, and a long command never outlives it.
    expect(
      numberConstant(limits, "AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS"),
    ).toBeLessThan(
      numberConstant(stuck, "RUN_HEARTBEAT_TIMEOUT_MINUTES") * 60 * 1000,
    );
    expect(agent).toContain("startAgentCommandKeepAlive({");
    expect(agent).toContain(
      "await this.backendAPI.updateTaskStatus( this.config.taskId, AIAgentTaskStatus.InProgress, );",
    );
    expect(flat(englishSection(CODE_PAGE, "## When a fix fails"))).toContain(
      "A command the code agent runs keeps the heartbeat going while it runs, so a long build or test suite is not taken for a stopped Runner.",
    );
  });

  it("never hands a request from Code to a Runner older than Code", () => {
    const claim: string = flat(
      readRepoFile("Common/Server/Services/AIRunService.ts"),
    );

    // A Runner that does not say what it supports is one older than Code.
    expect(claim).toContain(
      "data.supportedTaskTypes || CodeFixTaskTypeHelper.getTaskTypesForRunnersThatDoNotSay();",
    );
    expect(
      CodeFixTaskTypeHelper.getTaskTypesForRunnersThatDoNotSay(),
    ).not.toContain(CodeFixTaskType.CodeRequest);
    expect(flat(englishSection(CODE_PAGE, "## When a fix fails"))).toContain(
      "A Runner older than Code is never handed a request from Code: update a Runner you run yourself along with the server.",
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
    expect(englishPage(CODE_PAGE)).toContain(command);
    expect(install).toContain(
      "only a Project Owner, Project Admin or Runbook Admin can read it",
    );
    expect(flat(englishPage(CODE_PAGE))).toContain(
      "The command embeds the Runner's secret key, which only a Project Owner, Project Admin or Runbook Admin can read.",
    );
    // The key is not shown once and lost: those roles can read it again.
    expect(englishPage(CODE_PAGE)).not.toContain("The key is shown once");
  });

  it("says a repository picks its Runner on its Settings page, and that the bundled global Runner runs by default", () => {
    const runner: string = flat(
      readRepoFile("Common/Models/DatabaseModels/Runner.ts"),
    );
    const repository: string = flat(
      readRepoFile("Common/Models/DatabaseModels/CodeRepository.ts"),
    );
    const settings: string = flat(
      dashboardSource("Pages/Code/Repository/Settings.tsx"),
    );
    const field: string = flat(
      dashboardSource("Components/Code/CodeRepositoryRunner.tsx"),
    );
    const values: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "..", "HelmChart/Public/oneuptime/values.yaml"),
      "utf8",
    );
    const compose: string = fs.readFileSync(
      path.join(PACKAGES_DIR, "..", "docker-compose.yml"),
      "utf8",
    );
    const page: string = flat(englishPage(CODE_PAGE));

    // A Runner has no switch for code fixes: a repository picks its Runner.
    expect(runner).not.toContain("canRunCodeFixTasks");
    expect(repository).toContain("public runnerId?: ObjectID = undefined;");
    // The Runner card, with its own Edit: no dialog of steps any more.
    expect(settings).toContain(
      'name="Repository > Runner" cardProps={{ title: CODE_REPOSITORY_SETTINGS_COPY.runnerCardTitle,',
    );
    // Folded under More settings, as the page says.
    expect(isUnderMoreSettings(settings, 'name="Repository > Runner"')).toBe(
      true,
    );
    expect(settings).toContain('editButtonText="Edit"');
    expect(settings).not.toContain('editButtonText="Edit Settings"');
    expect(
      flat(dashboardSource("Components/Code/CodeRepositorySettingsCopy.ts")),
    ).toContain('runnerCardTitle: translationKey("Runner"),');
    expect(field).toContain('fieldTitle: translationKey("Runner"),');
    expect(page).toContain(
      `On the repository's ${bold("Settings")} page in Code, open ${bold("More settings")}, click ${bold("Edit")} on the ${bold("Runner")} card and pick the Runner.`,
    );
    expect(page).toContain(
      `Each repository picks the Runner AI works in it on: on its ${bold("Settings")} page in Code, open ${bold("More settings")}, click ${bold("Edit")} on the ${bold("Runner")} card and pick one.`,
    );

    // The bundled global Runner, on by default, does the code fixes.
    expect(values).toContain("\nglobalRunner:\n  enabled: true");
    expect(compose).toContain("  global-runner:\n");
    expect(compose).not.toContain("  runner:\n");
    expect(page).toContain(
      "the bundled global Runner (`global-runner` in Docker Compose, `globalRunner` in the Helm chart, on by default) runs AI code fixes in every repository that works on a global Runner",
    );
  });

  it("says a repository that picks no Runner follows the project's default Runner, else works on Global Runner, which does not build or test, as the picker offers it", () => {
    const picker: string = flat(
      dashboardSource("Components/Runner/RunnerPickerModel.ts"),
    );
    const section: string = flat(
      englishSection(CODE_PAGE, "### Pick the repository's Runner"),
    );
    const defaultRunnerId: string = "6c4a9f3e-2b1d-4e8a-9f7c-1d2e3f4a5b6c";
    const pickedRunnerId: string = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

    // The rule every reader of a repository's Runner goes by.
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        projectDefaultRunnerId: defaultRunnerId,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({
      kind: CodeRepositoryRunnerChoiceKind.ProjectDefault,
      runnerId: defaultRunnerId,
    });
    // Picking Global Runner keeps a repository on it beside a default.
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        picksGlobalRunner: true,
        projectDefaultRunnerId: defaultRunnerId,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
    // With no default, a repository that picks none is on Global Runner.
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: null,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({ kind: CodeRepositoryRunnerChoiceKind.Global });
    // A pick always wins.
    expect(
      decideCodeRepositoryRunner({
        repositoryRunnerId: pickedRunnerId,
        projectDefaultRunnerId: defaultRunnerId,
        projectUsesGlobalRunners: true,
      }),
    ).toEqual({
      kind: CodeRepositoryRunnerChoiceKind.Custom,
      runnerId: pickedRunnerId,
    });

    expect(picker).toContain(
      'GLOBAL_RUNNER_CHOICE_LABEL: string = translationKey("Global Runner");',
    );
    expect(picker).toContain(
      'PROJECT_DEFAULT_TAG: string = translationKey("Project default");',
    );
    expect(picker).toContain(
      `"Run by OneUptime for every project. It does not build or test AI's change before the pull request opens."`,
    );
    expect(section).toContain(
      `A repository that picks none works on the project's [default Runner](/docs/runbooks/agents#the-projects-default-runner), the first choice, marked ${bold("Project default")}, and moves with it when another Runner becomes the default. In a project with no default Runner, it works on ${bold("Global Runner")}, which OneUptime runs for every project. To keep a repository on ${bold("Global Runner")} while the project has a default Runner, pick it.`,
    );
    expect(section).toContain(
      "Only the Runner a repository works on is handed its tasks and a token for it.",
    );
    expect(section).toContain(
      "every repository needs one of the project's own Runners: the one it picks, or the project's default Runner.",
    );
    // A global Runner never runs a repository's commands.
    expect(
      flat(readRepoFile("Runner/Config.ts")).includes(
        "export function runsProjectAuthoredCommands(): boolean { return !GlobalRunnerMode.isActive(); }",
      ),
    ).toBe(true);
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(CODE_PAGE, "### Pick the repository's Runner"),
          "Runner",
        ),
        bold("Global Runner"),
      )[1],
    ).toContain("without building or testing it");
  });

  it("copies no Runner into a repository the GitHub App imports: it follows the project's default Runner like any other", () => {
    const service: string = flat(
      readRepoFile("Common/Server/Services/CodeRepositoryService.ts"),
    );

    // The import writes the switches' defaults, and no Runner.
    expect(service).not.toContain("findProjectDefaultRunnerId(");
    expect(service).toContain(
      "public static getNewRepositoryDefaults(): NewRepositoryDefaults { return { isGitHubCommandsEnabled: true, isProductionReviewEnabled: true, }; }",
    );
    expect(flat(englishPage(CODE_PAGE))).not.toContain(
      "A repository the GitHub App imports starts on",
    );
  });

  it("finds the repository the way the resolver does: the stack trace, then the name, then the only one", () => {
    const resolver: string = readRepoFile(
      "Common/Server/Utils/CodeRepository/StackTraceRepoResolver.ts",
    );
    const before: string = flat(
      englishSection(CODE_PAGE, "## Before you begin"),
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
      englishSection(CODE_PAGE, "## Before you begin"),
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
      englishSection(CODE_PAGE, "## Before you begin"),
      "What",
    );

    expect(dashboardSource("Components/Code/GitHubConnect.tsx")).toContain(
      '"Connect an existing installation"',
    );
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
    expect(flat(englishSection(CODE_PAGE, "## Privacy"))).toContain(
      "The task's log keeps the first 300 characters of each step's output",
    );
  });

  it("names the Base URL of the Ollama example as an address the server can reach", () => {
    expect(englishPage(CODE_PAGE)).toContain(
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
            : verb === "production"
              ? "production review"
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
    expect(dashboardSource("Components/Code/GitHubConnect.tsx")).toContain(
      '"Connect an existing installation"',
    );
    expect(englishPage(GITHUB_APP)).toContain(
      `click ${bold("Connect an existing installation")} there instead of installing it again.`,
    );
  });

  it("names the repository's settings as its Settings page draws them, with the trigger label's default", () => {
    const settings: string = flat(
      dashboardSource("Pages/Code/Repository/Settings.tsx"),
    );
    const copy: string = flat(
      dashboardSource("Components/Code/CodeRepositorySettingsCopy.ts"),
    );
    const page: string = flat(englishPage(GITHUB_APP));

    expect(copy).toContain(
      'gitHubCommandsSwitchTitle: translationKey("Respond to GitHub Commands"),',
    );
    expect(copy).toContain(
      'triggerLabelCardTitle: translationKey("GitHub Trigger Label"),',
    );
    // The limit's number, under its GitHub words (FixPullRequestLimit).
    expect(
      flat(dashboardSource("Components/CodeRepository/FixPullRequestLimit.ts")),
    ).toContain(
      'MAX_OPEN_FIX_PULL_REQUESTS_TITLE: string = translationKey( "Max Open Fix Pull Requests", );',
    );
    expect(settings).toContain("title: limitCopy.maxFieldTitle,");

    for (const title of [
      "Respond to GitHub Commands",
      "GitHub Trigger Label",
      "Max Open Fix Pull Requests",
    ]) {
      expect(page).toContain(bold(title));
    }

    // The switch is on until someone turns it off, and saves on its own.
    expect(
      flat(readRepoFile("Common/Models/DatabaseModels/CodeRepository.ts")),
    ).toContain(
      'type: TableColumnType.Boolean, isDefaultValueColumn: true, defaultValue: true, title: "Respond to GitHub Commands",',
    );
    expect(settings).toContain('column="isGitHubCommandsEnabled"');
    expect(
      isUnderMoreSettings(settings, 'column="isGitHubCommandsEnabled"'),
    ).toBe(true);
    expect(page).toContain(
      `Each repository has a switch: ${bold("Respond to GitHub Commands")}, under ${bold("More settings")} on the repository's ${bold("Settings")} page. It is on for every repository and saves the moment you flip it.`,
    );
    // The GitHub App's own answer, where commands are off, says where too.
    expect(
      flat(
        readRepoFile(
          "Common/Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer.ts",
        ),
      ),
    ).toContain(
      "A project admin can turn them back on in OneUptime under Code → this repository → Settings → More settings.",
    );
    // ... with a link that opens More settings at the switch itself.
    expect(
      readRepoFile(
        "Common/Server/Utils/CodeRepository/GitHub/GitHubReplyComposer.ts",
      ),
    ).toContain("[Respond to GitHub Commands](${data.settingsUrl})");
    expect(
      flat(
        readRepoFile(
          "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler.ts",
        ),
      ),
    ).toContain("setting: CodeRepositorySetting.GitHubCommands,");
    expect(
      getCodeRepositorySettingsPath({
        projectId: "project",
        codeRepositoryId: "repository",
        setting: CodeRepositorySetting.GitHubCommands,
      }),
    ).toBe("/project/code/repositories/repository/settings#github-commands");
    // ... where the switch's card takes that place on the page.
    expect(settings).toContain("cardId={CodeRepositorySetting.GitHubCommands}");
    expect(page).toContain(
      "With it off, the app ignores mentions, assignments and the trigger label in that repository, and answers anyone who asks with a link to the switch.",
    );

    // What most never change is folded under More settings.
    expect(
      isUnderMoreSettings(settings, 'name="Repository > GitHub Trigger Label"'),
    ).toBe(true);
    expect(page).toContain(
      `The same page holds the ${bold("GitHub Trigger Label")}, under ${bold("More settings")}, if you want a label other than \`oneuptime\`.`,
    );

    expect(copy).toContain(
      'DEFAULT_GITHUB_TRIGGER_LABEL: string = "oneuptime";',
    );
    expect(settings).toContain("placeholder: DEFAULT_GITHUB_TRIGGER_LABEL,");
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

  it("connects a repository in Products → Code", () => {
    const page: string = englishPage(GITHUB_APP);

    expect(page).toContain(`connect it in ${bold("Products → Code")}.`);
    expect(page).not.toContain("Code Repositories");
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

  /*
   * The two MCP pages point at each other: this one is about assistants
   * that connect to OneUptime, External MCP Servers about the servers
   * OneUptime AI connects to - as the Dashboard's MCP Server page points to
   * External MCP Servers.
   */
  it("points the other way, to External MCP Servers, as that page points here and the Dashboard's page does", () => {
    const opening: string = englishPage(MCP_SERVER).split("\n## ")[0] || "";

    expect(opening).toContain(
      "This page is about AI assistants that connect to OneUptime. To let OneUptime AI use the tools of other MCP servers instead, such as AWS's or GitHub's, see [External MCP Servers](/docs/ai/external-mcp-servers).",
    );
    expect(
      (englishPage(EXTERNAL_MCP_SERVERS).split("\n## ")[0] || "").includes(
        "](/docs/ai/mcp-server)",
      ),
    ).toBe(true);

    const dashboardPage: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/Settings/McpServer.tsx",
    );

    expect(dashboardPage).toContain(
      "RouteMap[PageMap.SETTINGS_AI_EXTERNAL_MCP_SERVERS]",
    );
    expect(dashboardPage).toContain(
      "To let OneUptime AI use the tools of other MCP servers, such as AWS's or GitHub's, add them in {{externalServersLink}}.",
    );
  });

  it("lists every record with CRUD tools, by its model's name", () => {
    /*
     * Postmortem Status, the 28th, came with the Postmortems list; Security
     * Case Priority and Security Case Status with Security Events > Settings.
     */
    expect(records()).toHaveLength(30);
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
    /*
     * The page builds every setup from McpConnectSetup, for a client and a
     * way of signing in; with the cloud's address, each snippet is the
     * docs' own, word for word.
     */
    const page: string = englishPage(MCP_SERVER);
    const cloudUrl: string = "https://oneuptime.com/mcp";
    const snippets: Array<string> = [];

    for (const client of MCP_CLIENTS) {
      for (const signIn of MCP_SIGN_IN_ANSWERS) {
        const setup: McpConnectSetupStep = getMcpConnectSetup({
          client,
          signIn,
          mcpUrl: cloudUrl,
        });

        if (setup.code) {
          snippets.push(setup.code.text);
          expect({
            client,
            signIn,
            inDocs: page.includes(setup.code.text),
          }).toEqual({
            client,
            signIn,
            inDocs: true,
          });
        }
      }
    }

    // Every client but Claude Desktop's sign-in (a menu, not a file) has one.
    expect(snippets).toHaveLength(MCP_CLIENTS.length * 2 - 1);
    expect(page).toContain(
      "claude mcp add --transport http oneuptime https://oneuptime.com/mcp\n",
    );

    // Claude's menu, named on the page as the docs name it.
    const card: string = dashboardSource("Components/Mcp/McpServerCard.tsx");

    expect(card).toContain(
      'translator.translateText("Customize → Connectors")',
    );
    expect(card).toContain('translator.translateText("Add custom connector")');
    expect(page).toContain(
      `open ${bold("Customize → Connectors")}, choose ${bold("Add custom connector")}`,
    );
  });

  it("names a tab on the page for every client the docs give a setup for", () => {
    const tabsOf: (heading: string) => Array<string> = (
      heading: string,
    ): Array<string> => {
      return englishSection(MCP_SERVER, heading)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("@tab ");
        })
        .map((line: string): string => {
          return line.slice("@tab ".length);
        });
    };

    // Claude Desktop signs in through Claude's own connector menu: "Claude".
    expect(tabsOf("## Connect a client")).toEqual([
      MCP_CLIENT_NAMES[McpClient.ClaudeCode],
      "Claude",
      MCP_CLIENT_NAMES[McpClient.VsCode],
      MCP_CLIENT_NAMES[McpClient.Cursor],
    ]);
    expect(tabsOf("## Connecting with an API key")).toEqual(
      MCP_CLIENTS.map((client: McpClient): string => {
        return MCP_CLIENT_NAMES[client];
      }),
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

    for (const signal of INCIDENT_AND_ALERT_TRIGGER_ENTITIES) {
      expect(defaults).not.toContain(
        `"${AUTOMATIC_FIX_SWITCH_COLUMNS[signal]}"`,
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
    // The thread's tools are built where Ask AI's are, for the person asking.
    const access: string = flat(
      readRepoFile("Common/Server/Utils/AI/Chat/ChatInfrastructureAccess.ts"),
    );

    expect(thread).toContain(
      "await ChatInfrastructureAccess.buildTools({ projectId: data.projectId, aiRunId: data.aiRunId, props: data.props,",
    );
    expect(access).toContain(
      "await KubernetesClusterAiAccessService.getStatusesViewableBy({ props: data.props,",
    );
    expect(access).toContain(
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

/*
 * The Code page's production review of pull requests, held to what the
 * server does (Common/Server/Utils/CodeRepository/ProductionReview) and to
 * the words Code draws: the switch and its default, the windows each part
 * reads, OneUptime AI's daily reads, what a public repository's pull
 * requests show, who starts a review on their own, and the command.
 */
describe("Production review of pull requests", () => {
  const SECTION: string = "## Production review of pull requests";
  const section: string = flat(englishSection(CODE_PAGE, SECTION));
  const reads: Array<Array<string>> = tableWithHeader(
    englishSection(CODE_PAGE, SECTION),
    "It reads",
  );

  it("names the switch, the page, Review again and What to watch as Code draws them", () => {
    const copy: string = flat(
      dashboardSource("Components/Code/CodeProductionReviewCopy.ts"),
    );
    const menu: string = flat(
      dashboardSource("Pages/Code/Repository/SideMenu.tsx"),
    );

    expect(copy).toContain(
      'switchTitle: translationKey("Review Pull Requests Against Production"),',
    );
    expect(copy).toContain('pageTitle: translationKey("Production Reviews"),');
    expect(copy).toContain('reviewAgain: translationKey("Review again"),');
    expect(copy).toContain('pointsTitle: translationKey("What to watch"),');
    expect(menu).toContain('title: "Production Reviews",');
    expect(section).toContain(
      `Turn on ${bold("Review Pull Requests Against Production")}, under ${bold("More settings")} on a repository's ${bold("Settings")} page in Code`,
    );
    // Folded under More settings, as the page says.
    expect(
      isUnderMoreSettings(
        flat(dashboardSource("Pages/Code/Repository/Settings.tsx")),
        'column="isProductionReviewEnabled"',
      ),
    ).toBe(true);
    expect(section).toContain(
      `the repository's ${bold("Production Reviews")} page in Code keeps each review, with ${bold("Review again")}.`,
    );
    expect(section).toContain(
      `adds ${bold("What to watch")}: a few short points`,
    );
  });

  it("reads each part over the window the server reads it over", () => {
    expect(PRODUCTION_REVIEW_WINDOWS).toEqual({
      exceptionsDays: 7,
      tracesHours: 1,
      profilesHours: 1,
      incidentsDays: 30,
      deploysDays: 7,
    });
    expect(rowStartingWith(reads, bold("Exceptions"))[1]).toContain(
      `in the last ${PRODUCTION_REVIEW_WINDOWS.exceptionsDays} days`,
    );
    expect(rowStartingWith(reads, bold("Operations"))[1]).toContain(
      "in the last hour",
    );
    expect(rowStartingWith(reads, bold("Hot functions"))[1]).toContain(
      "in the last hour",
    );
    expect(rowStartingWith(reads, bold("Incidents"))[1]).toContain(
      `incidents of the last ${PRODUCTION_REVIEW_WINDOWS.incidentsDays} days`,
    );
    expect(rowStartingWith(reads, bold("Deploys"))[1]).toContain(
      `deploys of the last ${PRODUCTION_REVIEW_WINDOWS.deploysDays} days`,
    );
    expect(Object.values(ProductionReviewSection).sort()).toEqual(
      [
        "Deploys",
        "Exceptions",
        "Incidents",
        "Operations",
        "Profiles",
        "Services",
      ].sort(),
    );
  });

  it("holds OneUptime AI's reads to the server's daily limits, and only while AI is on", () => {
    const runner: string = flat(
      readRepoFile(
        "Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewRunner.ts",
      ),
    );

    expect(PRODUCTION_REVIEW_LIMITS.maxAiReadsPerPullRequestPerDay).toBe(10);
    expect(PRODUCTION_REVIEW_LIMITS.maxAiReadsPerRepositoryPerDay).toBe(100);
    expect(runner).toContain("await AIService.isProjectAIEnabled(projectId)");
    expect(section).toContain(
      `It runs only while AI is on for the project, at most ${PRODUCTION_REVIEW_LIMITS.maxAiReadsPerPullRequestPerDay} times a day for a pull request and ${PRODUCTION_REVIEW_LIMITS.maxAiReadsPerRepositoryPerDay} for a repository`,
    );
    expect(section).toContain(
      "When production shows nothing about the change, OneUptime posts nothing.",
    );
  });

  it("posts only a link on a public repository unless the repository chose otherwise, in the words of its choice", () => {
    const copy: string = flat(
      dashboardSource("Components/Code/CodeProductionReviewCopy.ts"),
    );

    expect(
      ProductionReviewUtil.getPosting({ content: undefined, isPublic: true }),
    ).toBe(ProductionReviewPosting.Link);
    expect(
      ProductionReviewUtil.getPosting({ content: undefined, isPublic: false }),
    ).toBe(ProductionReviewPosting.Review);
    expect(
      ProductionReviewUtil.getPosting({
        content: ProductionReviewPullRequestContent.Link,
        isPublic: false,
      }),
    ).toBe(ProductionReviewPosting.Link);
    expect(
      ProductionReviewUtil.getPosting({
        content: ProductionReviewPullRequestContent.ReviewEvenIfPublic,
        isPublic: true,
      }),
    ).toBe(ProductionReviewPosting.Review);

    expect(copy).toContain(
      'contentCardTitle: translationKey("Production Review Comment"),',
    );
    expect(copy).toContain(
      'title: translationKey("Only a link to the review"),',
    );
    expect(copy).toContain(
      'title: translationKey("The review, even on a public repository"),',
    );
    expect(section).toContain(
      `${bold("Production Review Comment")}, under ${bold("More settings")} on the repository's ${bold("Settings")} page, can post ${bold("Only a link to the review")} everywhere, or ${bold("The review, even on a public repository")}.`,
    );
  });

  it("reviews on its own only for people who can write to the repository; the command asks for anyone else", () => {
    const trigger: string = flat(
      readRepoFile(
        "Common/Server/Utils/CodeRepository/ProductionReview/ProductionReviewGitHubTrigger.ts",
      ),
    );
    const parser: string = flat(
      readRepoFile(
        "Common/Server/Utils/CodeRepository/GitHub/GitHubCommandParser.ts",
      ),
    );

    expect(trigger).toContain('return notHandled("author-cannot-write");');
    expect(trigger).toContain('return notHandled("sender-cannot-write");');
    expect(trigger).toContain('return notHandled("bot-or-unknown-author");');
    expect(parser).toContain('"production review",');
    expect(section).toContain(
      "A pull request is reviewed on its own only when its author, and whoever pushed to it, can write to the repository.",
    );
    expect(codeIn(section)).toContain("@oneuptime production review");
  });

  it("is on for repositories connected from now on, and off for those connected before it", () => {
    const service: string = flat(
      readRepoFile("Common/Server/Services/CodeRepositoryService.ts"),
    );
    const model: string = flat(
      readRepoFile("Common/Models/DatabaseModels/CodeRepository.ts"),
    );

    expect(service).toContain("isProductionReviewEnabled: true,");
    expect(model).toContain(
      "public isProductionReviewEnabled?: boolean = undefined;",
    );
    expect(section).toContain(
      "The switch is on for the repositories the GitHub App connects from now on. A repository connected before it existed keeps it off until you turn it on.",
    );
  });

  it("the GitHub App page names the command and sends people to this section", () => {
    const app: string = flat(englishPage(GITHUB_APP));

    expect(app).toContain(
      "| `@oneuptime production review` | Reviews the pull request against production now, whoever opened it",
    );
    expect(app).toContain(
      `turn on ${bold("Review Pull Requests Against Production")} in the repository's settings: see [Production review of pull requests](/docs/ai/ai-agent#production-review-of-pull-requests).`,
    );
  });
});
