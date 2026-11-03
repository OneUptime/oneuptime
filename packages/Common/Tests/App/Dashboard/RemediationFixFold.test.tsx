import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";

// Only rendered when "Show reasoning" is opened; keep the lazy import out.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import RemediationStep, {
  getRemediationFixFailedCount,
  getRemediationFixSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep";
import {
  REMEDIATION_FIX_COMMANDS_SENTENCE,
  REMEDIATION_FIX_FAILED_COUNT,
  REMEDIATION_FIX_REVIEW_AND_APPROVE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A LIGHTER FIXES BLOCK: A FIX FOLDED TO ITS SENTENCE (#5413's UI review).
 *
 * Every command of a fix drew its program, its tier and approval, its
 * command, why, what it should do and its undo, and every change through
 * an MCP server its arguments and the server's answer, so three fixes were
 * a page of their own on a phone, with Approve & Run under all of it. Now
 * a fix of commands or changes is folded to where it stands and its
 * sentence - how many commands it runs, and where; how many changes it
 * makes, and through which servers - with a failure said in red beside
 * where it stands. One press, Review and approve (as its message in Slack
 * and Microsoft Teams says it) or Show details, opens its commands, its
 * reasoning, and Approve & Run under them: approving runs exactly what is
 * shown, so it is never offered beside a fix whose commands are folded.
 * A runbook, a fix still being worked out and one whose commands cannot
 * be read have nothing to fold.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-3333-4aaa-8bbb-000000000053",
);
const CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000054";
const OTHER_CLUSTER_ID: string = "0193c0de-4444-4aaa-8bbb-000000000055";
const RUNNER_ID: string = "0193c0de-5555-4aaa-8bbb-000000000056";
const KUBECTL_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000057";
const RAN_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000058";
const MCP_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000059";
const RUNBOOK_FIX_ID: string = "0193c0de-6666-4aaa-8bbb-000000000060";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function kubectlCommand(
  sequence: number,
  overrides: Partial<JSONObject> = {},
): JSONObject {
  return {
    sequence,
    stepType: RunbookStepType.Kubectl,
    runnerId: RUNNER_ID,
    runnerNameSnapshot: "kubernetes-agent/prod-east",
    kubernetesClusterId: CLUSTER_ID,
    kubernetesClusterNameSnapshot: "prod-east",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: `kubectl rollout restart deployment/web-${sequence} -n web`,
    timeoutInMs: 60000,
    rationale: "Pods hold a stale config.",
    expectedEffect: "Fresh pods pick up the corrected config.",
    rollbackCommand: `kubectl rollout undo deployment/web-${sequence} -n web`,
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  };
}

function kubectlFix(
  status: AutoRemediationSuggestionStatus,
  commands: Array<JSONObject>,
  id: string = KUBECTL_FIX_ID,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: id,
    status,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    ruleNameSnapshot: 'AI remediation for cluster "prod-east"',
    kubernetesClusterId: new ObjectID(CLUSTER_ID),
    rationaleMarkdown: "The 17:52 release left the pods a stale config.",
    commandPlan: { commands },
    createdAt: new Date("2026-10-30T10:00:00Z"),
  });
}

function mcpCall(
  sequence: number,
  status: ExternalMcpToolCallStatus,
  serverNameSnapshot: string,
): ExternalMcpToolCall {
  return {
    sequence,
    serverId: `server-${serverNameSnapshot}`,
    serverNameSnapshot,
    toolName: "set_flag",
    arguments: { flag: "checkout-db-pool-v2", enabled: false },
    status,
    wasMadeWithoutAsking: true,
    ...(status === ExternalMcpToolCallStatus.Failed
      ? { errorMessage: "The server did not answer within 30 seconds." }
      : {}),
  };
}

function mcpFix(calls: Array<ExternalMcpToolCall>): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: MCP_FIX_ID,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    ruleNameSnapshot: "Checkout fixes",
    mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({ calls }),
    createdAt: new Date("2026-10-30T09:59:00Z"),
  });
}

function runbookFix(
  status: AutoRemediationSuggestionStatus,
): AutoRemediationSuggestion {
  return Object.assign(new AutoRemediationSuggestion(), {
    _id: RUNBOOK_FIX_ID,
    status,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    ruleNameSnapshot: "Checkout fixes",
    runbookNameSnapshot: "Restart checkout-api pods",
    rationaleMarkdown: "The runbook restarts the pods that hold the pool.",
    createdAt: new Date("2026-10-30T09:58:00Z"),
  });
}

function plan(commands: Array<JSONObject>): AiRemediationCommandPlan {
  return AiRemediationCommandPlanUtil.parse({ commands })!;
}

let served: Array<AutoRemediationSuggestion> = [];
let postSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  served = [];
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: unknown;
  }): Promise<ListResult<AutoRemediationSuggestion>> => {
    // The step reads its decisions beside its fixes: none here.
    if (data.modelType !== AutoRemediationSuggestion) {
      return { data: [], count: 0, skip: 0, limit: 5 };
    }

    return { data: served, count: served.length, skip: 0, limit: 10 };
  }) as never);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  postSpy = jest.spyOn(API, "post");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderStep(
  fixes: Array<AutoRemediationSuggestion>,
): Promise<Array<HTMLElement>> {
  served = fixes;
  await act(async () => {
    render(
      <RemediationStep
        investigationStage="reported"
        incidentId={INCIDENT_ID}
      />,
    );
  });

  return await screen.findAllByTestId("remediation-fix");
}

// The fix whose title, source or sentence holds the given words.
function fixWith(words: string | RegExp): HTMLElement {
  const fix: HTMLElement | undefined = screen
    .getAllByTestId("remediation-fix")
    .find((element: HTMLElement): boolean => {
      return Boolean(within(element).queryAllByText(words).length);
    });

  if (!fix) {
    throw new Error(`No fix shows "${words.toString()}".`);
  }

  return fix;
}

function toggleOf(fix: HTMLElement): HTMLElement {
  return within(fix).getByTestId("remediation-fix-details-toggle");
}

describe("a fix that waits for approval", () => {
  test("is folded to where it stands and its sentence, with Review and approve and Dismiss: no command, reasoning, Approve & Run or dry run in sight", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
        kubectlCommand(2, { kubectlTier: KubectlCommandTier.RiskyWrite }),
      ]),
    ]);

    expect(
      within(fix!).getByTestId("remediation-fix-status"),
    ).toHaveTextContent("Waiting for approval");
    const sentence: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-sentence",
    );
    expect(sentence).toHaveTextContent(/^2 commands on cluster prod-east\.$/);
    // In its own direction: a locale without its words reads it in English.
    expect(sentence).toHaveAttribute("dir", "auto");

    const toggle: HTMLElement = toggleOf(fix!);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveTextContent(/^Review and approve$/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Nothing it opens is drawn yet, so it names nothing.
    expect(toggle).not.toHaveAttribute("aria-controls");

    // What it runs, and what runs it, are folded.
    expect(within(fix!).queryByTestId("remediation-fix-details")).toBeNull();
    expect(within(fix!).queryAllByTestId("remediation-command")).toHaveLength(
      0,
    );
    expect(
      within(fix!).queryByText(
        "kubectl rollout restart deployment/web-1 -n web",
      ),
    ).toBeNull();
    expect(within(fix!).queryByText("Show reasoning")).toBeNull();
    expect(within(fix!).queryByTestId("remediation-approve-button")).toBeNull();
    expect(within(fix!).queryByTestId("remediation-dry-run-button")).toBeNull();

    // Dismissing runs nothing: it is one press, folded or not.
    const actions: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-actions",
    );
    expect(within(actions).getByText("Dismiss")).toBeInTheDocument();
    expect(within(actions).queryByText("Approve & Run")).toBeNull();

    // Its sentence, then the press that opens it, then the buttons.
    expect(
      sentence.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      toggle.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Review and approve opens its commands, its reasoning and Approve & Run under them; Hide details folds it again, and the keyboard stays on the press", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
        kubectlCommand(2, { kubectlTier: KubectlCommandTier.RiskyWrite }),
      ]),
    ]);

    const toggle: HTMLElement = toggleOf(fix!);
    toggle.focus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(/^Hide details$/);
    // The press is the same button: the keyboard is where it was.
    expect(document.activeElement).toBe(toggle);

    const details: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-details",
    );
    // It names what it opened.
    expect(toggle.getAttribute("aria-controls")).toBe(details.id);
    expect(details.id).not.toBe("");
    expect(document.getElementById(details.id)).toBe(details);

    const commands: Array<HTMLElement> = within(details).getAllByTestId(
      "remediation-command",
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]).toHaveTextContent(
      "kubectl rollout restart deployment/web-1 -n web",
    );
    expect(
      within(commands[1]!).getByTestId("remediation-command-tier"),
    ).toHaveTextContent("riskier change");
    expect(within(details).getByText("Show reasoning")).toBeInTheDocument();

    // Approve & Run, under the commands it runs.
    const approve: HTMLElement = within(fix!).getByTestId(
      "remediation-approve-button",
    );
    expect(
      details.compareDocumentPosition(approve) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The sentence stays, over what it sums up.
    expect(
      within(fix!).getByTestId("remediation-fix-sentence"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent(/^Review and approve$/);
    expect(document.activeElement).toBe(toggle);
    expect(within(fix!).queryByTestId("remediation-fix-details")).toBeNull();
    expect(within(fix!).queryByTestId("remediation-approve-button")).toBeNull();
  });

  test("approved from the opened fix, it stays open as the step reads its fixes again, and says how it runs", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);
    postSpy.mockImplementation((async () => {
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Approved, [
          kubectlCommand(1, {
            execution: {
              status: AiRemediationCommandExecutionStatus.Running,
            },
          }),
        ]),
      ];
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

    fireEvent.click(screen.getByRole("button", { name: "Review and approve" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("remediation-approve-button"));
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByTestId("remediation-command-execution"),
    ).toHaveTextContent("Running…");
    expect(screen.getByTestId("remediation-fix-status")).toHaveTextContent(
      "Approved & started",
    );
    // Open as the reader left it: Hide details, nothing more to approve.
    const toggle: HTMLElement = screen.getByTestId(
      "remediation-fix-details-toggle",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent(/^Hide details$/);
    expect(screen.queryByTestId("remediation-approve-button")).toBeNull();

    // Folded again, an approved fix opens with Show details.
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent(/^Show details$/);
  });

  test("Dismiss works on the folded fix: nothing runs, and nothing had to be opened", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
    ]);
    postSpy.mockImplementation((async () => {
      served = [
        kubectlFix(AutoRemediationSuggestionStatus.Dismissed, [
          kubectlCommand(1),
        ]),
      ];
      return new HTTPResponse<JSONObject>(200, {}, {});
    }) as never);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });

    const request: { url: { toString: () => string } } = postSpy.mock
      .calls[0]![0] as never;
    expect(
      new URL(request.url.toString()).pathname.split("/").slice(-2),
    ).toEqual(["auto-remediation", "dismiss"]);
    expect(
      await screen.findByText("Dismissed", {
        selector: "[data-testid='remediation-fix-status'] *",
      }),
    ).toBeInTheDocument();
    // Still folded to its sentence, and nothing waits for anyone.
    expect(
      screen.getByTestId("remediation-fix-details-toggle"),
    ).toHaveTextContent(/^Show details$/);
    expect(screen.queryByTestId("remediation-fix-actions")).toBeNull();
  });
});

describe("a fix that ran", () => {
  test("folded, it says Show details, and how many of its commands failed in red beside where it stands", async () => {
    const [fix] = await renderStep([
      kubectlFix(
        AutoRemediationSuggestionStatus.AutoExecuted,
        [
          kubectlCommand(1, {
            wasAutoExecuted: true,
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              exitCode: 0,
            },
          }),
          kubectlCommand(2, {
            wasAutoExecuted: true,
            execution: {
              status: AiRemediationCommandExecutionStatus.Failed,
              exitCode: 1,
              errorMessage: "deployments.apps 'web-2' not found",
            },
          }),
        ],
        RAN_FIX_ID,
      ),
    ]);

    expect(toggleOf(fix!)).toHaveTextContent(/^Show details$/);
    expect(
      within(fix!).getByTestId("remediation-fix-sentence"),
    ).toHaveTextContent(/^2 commands on cluster prod-east\.$/);

    const failed: HTMLElement = within(fix!).getByTestId(
      "remediation-fix-failed-count",
    );
    expect(failed).toHaveTextContent(/^1 failed$/);
    expect(failed).toHaveAttribute("data-alarming", "true");
    expect(within(fix!).getByTestId("remediation-fix-facts")).toContainElement(
      failed,
    );
    // The failure itself is one press away.
    expect(
      within(fix!).queryByText("deployments.apps 'web-2' not found"),
    ).toBeNull();
    fireEvent.click(toggleOf(fix!));
    expect(
      within(fix!).getByText("deployments.apps 'web-2' not found"),
    ).toBeInTheDocument();
    // Nothing to press on a fix that ran on its own.
    expect(within(fix!).queryByTestId("remediation-fix-actions")).toBeNull();
  });

  test("a fix through MCP servers: how many changes, through which servers, each named once, and the one that failed", async () => {
    const [fix] = await renderStep([
      mcpFix([
        mcpCall(1, ExternalMcpToolCallStatus.Succeeded, "Feature flags"),
        mcpCall(2, ExternalMcpToolCallStatus.Failed, "Status page"),
        mcpCall(3, ExternalMcpToolCallStatus.Succeeded, "Feature flags"),
      ]),
    ]);

    expect(
      within(fix!).getByTestId("remediation-fix-sentence"),
    ).toHaveTextContent(/^3 changes through Feature flags, Status page\.$/);
    expect(
      within(fix!).getByTestId("remediation-fix-failed-count"),
    ).toHaveTextContent(/^1 failed$/);
    expect(
      within(fix!).queryAllByTestId("remediation-mcp-tool-call"),
    ).toHaveLength(0);

    fireEvent.click(toggleOf(fix!));
    expect(
      within(fix!).getAllByTestId("remediation-mcp-tool-call"),
    ).toHaveLength(3);
  });

  test("each fix opens on its own", async () => {
    await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
      ]),
      mcpFix([
        mcpCall(1, ExternalMcpToolCallStatus.Succeeded, "Feature flags"),
      ]),
    ]);

    const waiting: HTMLElement = fixWith("Waiting for approval");
    const mcp: HTMLElement = fixWith("AI fix through MCP servers");
    fireEvent.click(toggleOf(mcp));

    expect(toggleOf(mcp)).toHaveAttribute("aria-expanded", "true");
    expect(toggleOf(waiting)).toHaveAttribute("aria-expanded", "false");
    expect(
      within(waiting).queryByTestId("remediation-approve-button"),
    ).toBeNull();
    // Each opens what is its own.
    expect(toggleOf(mcp).getAttribute("aria-controls")).toBe(
      within(mcp).getByTestId("remediation-fix-details").id,
    );
  });
});

describe("a fix with nothing to fold", () => {
  test("a runbook keeps its reasoning and Approve & Run in sight: what it runs is its name", async () => {
    const [fix] = await renderStep([
      runbookFix(AutoRemediationSuggestionStatus.Suggested),
    ]);

    expect(
      within(fix!).queryByTestId("remediation-fix-details-toggle"),
    ).toBeNull();
    expect(within(fix!).queryByTestId("remediation-fix-sentence")).toBeNull();
    expect(within(fix!).getByText("Show reasoning")).toBeInTheDocument();
    expect(
      within(fix!).getByTestId("remediation-approve-button"),
    ).toBeInTheDocument();
  });

  test("a fix still being worked out, and one whose commands cannot be read, have no press to open them", async () => {
    await renderStep([
      Object.assign(kubectlFix(AutoRemediationSuggestionStatus.Planning, []), {
        commandPlan: undefined,
      }),
      Object.assign(
        kubectlFix(AutoRemediationSuggestionStatus.Suggested, [], RAN_FIX_ID),
        { commandPlan: { commands: "not a list" } },
      ),
    ]);

    expect(
      screen.queryAllByTestId("remediation-fix-details-toggle"),
    ).toHaveLength(0);
    expect(
      screen.getByText("The command plan could not be displayed."),
    ).toBeInTheDocument();
  });
});

describe("its sentence", () => {
  test("one command is counted as one", () => {
    expect(
      getRemediationFixSentence({
        plan: plan([kubectlCommand(1)]),
        mcpPlan: null,
      }),
    ).toBe("1 command on cluster prod-east.");
  });

  test("names each place its commands run once, in the order they run", () => {
    expect(
      getRemediationFixSentence({
        plan: plan([
          kubectlCommand(1),
          kubectlCommand(2, {
            kubernetesClusterId: OTHER_CLUSTER_ID,
            kubernetesClusterNameSnapshot: "prod-west",
          }),
          kubectlCommand(3),
        ]),
        mcpPlan: null,
      }),
    ).toBe("3 commands on cluster prod-east, cluster prod-west.");
  });

  test("a resource's AI agent and a Runner are named as each command row names them", () => {
    const resourceCommand: JSONObject = {
      sequence: 1,
      stepType: RunbookStepType.ResourceCommand,
      runnerId: RUNNER_ID,
      runnerNameSnapshot: "Docker AI agent",
      resourceType: AiResourceType.DockerHost,
      resourceId: "0193c0de-7777-4aaa-8bbb-000000000061",
      resourceNameSnapshot: "web-1",
      resourceCommandTier: ResourceCommandTier.SafeWrite,
      command: "docker restart web",
      timeoutInMs: 60000,
      rationale: "The container is wedged.",
      expectedEffect: "The container serves again.",
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    };
    const runnerCommand: JSONObject = {
      sequence: 2,
      stepType: RunbookStepType.Bash,
      runnerId: RUNNER_ID,
      runnerNameSnapshot: "ops-runner",
      command: "systemctl restart nginx",
      timeoutInMs: 60000,
      rationale: "nginx holds old upstreams.",
      expectedEffect: "nginx reads the new upstreams.",
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    };

    expect(
      getRemediationFixSentence({
        plan: plan([resourceCommand, runnerCommand]),
        mcpPlan: null,
      }),
    ).toBe("2 commands on Docker host web-1, ops-runner.");
  });

  test("nothing to say for a runbook, or a plan or list of changes with nothing in it", () => {
    expect(getRemediationFixSentence({ plan: null, mcpPlan: null })).toBeNull();
    expect(
      getRemediationFixSentence({ plan: plan([]), mcpPlan: null }),
    ).toBeNull();
    expect(
      getRemediationFixSentence({ plan: null, mcpPlan: { calls: [] } }),
    ).toBeNull();
  });

  test("counts a command whose undo failed among the failures, once", () => {
    const failedTwice: JSONObject = kubectlCommand(1, {
      execution: {
        status: AiRemediationCommandExecutionStatus.Failed,
        exitCode: 1,
      },
      rollbackExecution: {
        status: AiRemediationCommandExecutionStatus.Failed,
        exitCode: 1,
      },
    });
    const undoFailed: JSONObject = kubectlCommand(2, {
      execution: {
        status: AiRemediationCommandExecutionStatus.Succeeded,
        exitCode: 0,
      },
      rollbackExecution: {
        status: AiRemediationCommandExecutionStatus.Failed,
        exitCode: 1,
      },
    });
    const skipped: JSONObject = kubectlCommand(3, {
      execution: { status: AiRemediationCommandExecutionStatus.Skipped },
    });

    expect(
      getRemediationFixFailedCount({
        plan: plan([failedTwice, undoFailed, skipped]),
        mcpPlan: null,
      }),
    ).toBe(2);
    // A command that never ran is no failure of its own.
    expect(
      getRemediationFixFailedCount({ plan: plan([skipped]), mcpPlan: null }),
    ).toBe(0);
    expect(getRemediationFixFailedCount({ plan: null, mcpPlan: null })).toBe(0);
  });
});

/*
 * In the reader's language: the sentence, the failure count and Review and
 * approve are looked up, from the shipped locale files. Japanese.
 */
describe("in Japanese", () => {
  const JA: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "ja.json"), "utf8"),
  ) as Record<string, string>;

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "ja",
      fallbackLng: "ja",
      resources: { ja: { translation: JA } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("en");
    });
  });

  test("a folded fix reads in Japanese", async () => {
    const [fix] = await renderStep([
      kubectlFix(AutoRemediationSuggestionStatus.Suggested, [
        kubectlCommand(1),
        kubectlCommand(2, {
          execution: {
            status: AiRemediationCommandExecutionStatus.Failed,
            exitCode: 1,
          },
        }),
      ]),
    ]);

    const sentence: string = JA[REMEDIATION_FIX_COMMANDS_SENTENCE.other]!;
    expect(sentence).toBeDefined();
    expect(sentence).not.toBe(REMEDIATION_FIX_COMMANDS_SENTENCE.other);
    expect(
      within(fix!).getByTestId("remediation-fix-sentence"),
    ).toHaveTextContent(
      sentence
        .replace(
          "{{targets}}",
          `${JA["cluster {{name}}"]!.replace("{{name}}", "prod-east")}`,
        )
        .replace("{{count}}", "2"),
    );
    expect(
      within(fix!).getByTestId("remediation-fix-failed-count"),
    ).toHaveTextContent(
      JA[REMEDIATION_FIX_FAILED_COUNT.other]!.replace("{{count}}", "1"),
    );
    expect(toggleOf(fix!)).toHaveTextContent(
      JA[REMEDIATION_FIX_REVIEW_AND_APPROVE]!,
    );
  });
});
