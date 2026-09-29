import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The investigation panel's cluster access, end to end through the real
 * notice, activity feed and usage line:
 *
 *  - what the run DID with kubectl is read from its events: only commands
 *    that ran on the cluster count as run, a run whose every command failed
 *    or never ran is never shown as an inspection, and kubectl is never also
 *    counted as a telemetry query;
 *  - the notice's rows come from the API on every poll, stamped with the
 *    time they were evaluated and the Runner's latest heartbeat. A poll
 *    that changes nothing a reader can see must not re-commit the panel;
 *    one that does (mode, readiness, gap text) must.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "investigation-markdown" },
        props.text,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "evidence-widget" });
      },
    };
  },
);

import InvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import ObjectID from "../../../Types/ObjectID";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

const SETTLED_POLL_INTERVAL_MS: number = 30_000;
const COMPLETED_AT: string = "2026-09-22T12:00:00.000Z";
const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CLUSTER_ID: string = "56565656-5656-4565-8565-565656565656";
const ANALYSIS: string =
  "## Root cause\n\nThe pods are Pending because the node pool is full.";

const RUNNER_OFFLINE_GAP: JSONObject = {
  code: "runner_offline",
  title: "The Runner is offline",
  description: 'Runner "kubernetes-agent/prod-us" last reported in at 11:58.',
  nextStep: "Check the in-cluster Runner pod.",
  blocks: "both",
};

let eventSequence: number = 0;

function event(
  eventType: AIRunEventType,
  toolName?: string,
  resultSummary?: JSONObject,
): JSONObject {
  eventSequence++;
  return {
    _id: ObjectID.generate().toString(),
    sequence: eventSequence,
    eventType,
    ...(toolName ? { toolName } : {}),
    ...(resultSummary ? { resultSummary } : {}),
    createdAt: COMPLETED_AT,
  };
}

function toolCall(
  toolName: string,
  outcome: "completed" | "failed",
  rowCount: number = 1,
): Array<JSONObject> {
  return [
    event(AIRunEventType.ToolCallStarted, toolName),
    outcome === "completed"
      ? event(AIRunEventType.ToolCallCompleted, toolName, { rowCount })
      : event(AIRunEventType.ToolCallFailed, toolName, {
          errorMessage: `kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.`,
        }),
  ];
}

function evidence(
  citationId: string,
  toolName: string,
  label: string,
): JSONObject {
  return {
    citationId,
    toolName,
    label,
    rowCount: 1,
    queryArguments: {},
    canLoadRows: false,
  };
}

function clusterRow(overrides: JSONObject = {}): JSONObject {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: "67676767-6767-4676-8676-676767676767",
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      lastAliveAt: "2026-09-22T11:59:00.000Z",
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

function payload(data: {
  status?: AIRunStatus | undefined;
  events?: Array<JSONObject> | undefined;
  evidence?: Array<JSONObject> | undefined;
  clusterAccess?: Array<JSONObject> | undefined;
  toolCallCount?: number | undefined;
}): { data: JSONObject } {
  const status: AIRunStatus = data.status || AIRunStatus.Completed;
  const isCompleted: boolean = status === AIRunStatus.Completed;

  return {
    data: {
      run: {
        _id: RUN_ID,
        status,
        errorMessage: isCompleted ? null : "The LLM provider timed out.",
        toolCallCount: data.toolCallCount ?? 2,
        totalTokens: 1234,
        humanVerdict: null,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        completedAt: COMPLETED_AT,
      },
      events: (data.events || [
        event(AIRunEventType.RunStarted),
      ]) as unknown as JSONArray,
      analysisMarkdown: isCompleted ? ANALYSIS : null,
      analysisTldr: null,
      isAnalysisPending: false,
      evidence: (isCompleted ? data.evidence || [] : []) as JSONArray,
      references: [],
      clusterAccess: (data.clusterAccess || [clusterRow()]) as JSONArray,
    },
  };
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

async function tick(milliseconds: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    for (let index: number = 0; index < 8; index++) {
      await Promise.resolve();
    }
  });
}

function renderPanel(): void {
  render(<InvestigationPanel subjectType="incident" subjectId={INCIDENT_ID} />);
}

function noticeText(): string {
  return screen.getByTestId("cluster-access-notice").textContent || "";
}

function usageItems(): Array<string> {
  return within(screen.getByRole("list", { name: "Investigation usage" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(COMPLETED_AT));
  goTo(`/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID.toString()}`);
  eventSequence = 0;
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  postMock.mockReset();
});

describe("InvestigationPanel reports what the run did with kubectl", () => {
  test("counts only commands that ran as run, and never as telemetry queries", async () => {
    postMock.mockResolvedValue(
      payload({
        events: [
          event(AIRunEventType.RunStarted),
          ...toolCall(LIST_CLUSTER_ACCESS_TOOL_NAME, "completed", 1),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "failed"),
          ...toolCall("query_metrics", "completed", 80),
          event(AIRunEventType.RunCompleted),
        ],
        evidence: [
          evidence("C1", LIST_CLUSTER_ACCESS_TOOL_NAME, "Clusters"),
          evidence("C2", RUN_KUBECTL_TOOL_NAME, "kubectl get pods -n web"),
          evidence("C3", "query_metrics", "Max(cpu)"),
        ],
      }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
      "OneUptime AI ran 1 read-only kubectl command during this investigation (1 more could not run — see Investigation activity).",
    );
    const items: Array<string> = usageItems();
    expect(items).toContain("1 telemetry query");
    expect(items).toContain("1 kubectl command (1 did not run)");
  });

  /*
   * The review's scenario: the in-cluster Runner was evicted but still read
   * as online, and every command went unclaimed.
   */
  test("never shows a run whose kubectl commands all failed to run as an inspection", async () => {
    postMock.mockResolvedValue(
      payload({
        events: [
          event(AIRunEventType.RunStarted),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "failed"),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "failed"),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "failed"),
          event(AIRunEventType.RunCompleted),
        ],
      }) as never,
    );

    renderPanel();
    await flush();

    const usage: HTMLElement = screen.getByTestId("cluster-access-run-usage");
    expect(usage).toHaveAttribute("data-tone", "failed");
    expect(usage).not.toHaveTextContent("ran 3");
    expect(usage).toHaveTextContent("none ran on the cluster");
    expect(usageItems()).toContain("3 kubectl commands did not run");
  });

  test("a failed run's usage line counts kubectl apart from its tool calls", async () => {
    postMock.mockResolvedValue(
      payload({
        status: AIRunStatus.Error,
        toolCallCount: 6,
        events: [
          event(AIRunEventType.RunStarted),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          ...toolCall(LIST_CLUSTER_ACCESS_TOOL_NAME, "completed", 1),
          ...toolCall("query_metrics", "completed", 80),
          ...toolCall("search_logs", "completed", 12),
          event(AIRunEventType.RunFailed),
        ],
      }) as never,
    );

    renderPanel();
    await flush();

    const items: Array<string> = usageItems();
    expect(items).toContain("2 telemetry queries");
    expect(items).toContain("3 kubectl commands");
    expect(items.join(" · ")).not.toContain("6 telemetry");
    expect(noticeText()).toContain(
      "OneUptime AI ran 3 read-only kubectl commands during this investigation.",
    );
  });

  test("counts the latest attempt of a retried run only", async () => {
    postMock.mockResolvedValue(
      payload({
        events: [
          event(AIRunEventType.RunStarted),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          event(AIRunEventType.RunFailed),
          event(AIRunEventType.RunStarted),
          ...toolCall(RUN_KUBECTL_TOOL_NAME, "completed", 1),
          event(AIRunEventType.RunCompleted),
        ],
      }) as never,
    );

    renderPanel();
    await flush();

    expect(screen.getByTestId("cluster-access-run-usage")).toHaveTextContent(
      "OneUptime AI ran 1 read-only kubectl command during this investigation.",
    );
  });
});

describe("InvestigationPanel commits a poll only when the notice would change", () => {
  let fromJSONArray: jest.SpyInstance;

  beforeEach(() => {
    // Called only inside the panel's "something changed" branch.
    fromJSONArray = jest.spyOn(AIRunEvent, "fromJSONArray");
  });

  async function loadThenPoll(
    first: { data: JSONObject },
    second: { data: JSONObject },
  ): Promise<void> {
    postMock
      .mockResolvedValueOnce(first as never)
      .mockResolvedValue(second as never);

    renderPanel();
    await flush();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(fromJSONArray).toHaveBeenCalledTimes(1);

    await tick(SETTLED_POLL_INTERVAL_MS);
    expect(postMock).toHaveBeenCalledTimes(2);
  }

  test("a poll that only moves the evaluation time and the Runner heartbeat re-commits nothing", async () => {
    await loadThenPoll(
      payload({}),
      payload({
        clusterAccess: [
          clusterRow({
            evaluatedAt: "2026-09-22T12:00:30.123Z",
            runner: {
              id: "67676767-6767-4676-8676-676767676767",
              name: "kubernetes-agent/prod-us",
              isOnline: true,
              lastAliveAt: "2026-09-22T12:00:29.000Z",
              canRunAiCommands: true,
            },
          }),
        ],
      }),
    );

    expect(fromJSONArray).toHaveBeenCalledTimes(1);
    expect(noticeText()).toContain("(fixes ask for your approval)");
  });

  test("a poll that changes the remediation mode is applied", async () => {
    await loadThenPoll(
      payload({}),
      payload({
        clusterAccess: [
          clusterRow({
            remediationMode: KubernetesAiRemediationMode.Disabled,
            evaluatedAt: "2026-09-22T12:00:30.000Z",
          }),
        ],
      }),
    );

    expect(fromJSONArray).toHaveBeenCalledTimes(2);
    expect(noticeText()).toContain("(fixes are off)");
    expect(noticeText()).not.toContain("fixes ask for your approval");
  });

  test("a poll that changes only a gap's text under the same code is applied", async () => {
    const unreachable: (description: string) => JSONObject = (
      description: string,
    ): JSONObject => {
      return clusterRow({
        isInvestigationReady: false,
        gaps: [{ ...RUNNER_OFFLINE_GAP, description }],
      });
    };

    await loadThenPoll(
      payload({ clusterAccess: [unreachable("Last reported in at 11:58.")] }),
      payload({ clusterAccess: [unreachable("Last reported in at 11:59.")] }),
    );

    expect(screen.getByTestId("cluster-access-unreachable")).toHaveTextContent(
      "Why: The Runner is offline. Last reported in at 11:59.",
    );
  });

  test("a poll that flips readiness moves the cluster to the unreachable row", async () => {
    await loadThenPoll(
      payload({}),
      payload({
        clusterAccess: [
          clusterRow({
            isInvestigationReady: false,
            gaps: [RUNNER_OFFLINE_GAP],
          }),
        ],
      }),
    );

    expect(screen.queryByTestId("cluster-access-reachable")).toBeNull();
    expect(screen.getByTestId("cluster-access-unreachable")).toHaveTextContent(
      'OneUptime AI cannot currently reach cluster "prod-us" with kubectl',
    );
  });
});
