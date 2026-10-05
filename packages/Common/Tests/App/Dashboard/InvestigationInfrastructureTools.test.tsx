import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * How the investigation panel words the tools that reach infrastructure
 * resources through their AI agents (run_infrastructure_command,
 * list_infrastructure_access) — the same way it words kubectl, and never
 * as telemetry queries:
 *
 * - their outcomes ("Succeeded", "The command returned an error",
 *   "2 resources"), evidence descriptions and notes;
 * - the activity feed's labels and failure wording ("did not run on the
 *   infrastructure", "no result came back — it may have run");
 * - the run summary: infrastructure calls are taken out of "telemetry
 *   queries" and counted as their own usage item;
 * - the kubectl-only names and summary stay exactly as they were.
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
        return "error";
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

import ChatActivityFeed, {
  CLUSTER_TOOL_NAMES,
  InfrastructureActivitySummary,
  KubectlActivitySummary,
  summarizeKubectlActivity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import {
  describeClusterEvidenceTool,
  describeClusterToolOutcome,
  formatEvidenceOutcome,
  getClusterEvidenceNote,
  INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX,
  INFRASTRUCTURE_TOOL_NAMES,
  isClusterToolName,
  isInfrastructureResultUnknownMessage,
  isInfrastructureToolName,
  isLiveInfrastructureToolName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ClusterToolFormat";
import {
  describeInfrastructureUsage,
  InvestigationUsageLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationRunDetails";
import { describeEvidenceTool } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import IconProp from "../../../Types/Icon/IconProp";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import ObjectID from "../../../Types/ObjectID";

interface StepEvent {
  eventType: AIRunEventType;
  toolName?: string | undefined;
  resultSummary?: AIRunEventResultSummary | undefined;
}

function events(steps: Array<StepEvent>): Array<AIRunEvent> {
  return steps.map((step: StepEvent): AIRunEvent => {
    const event: AIRunEvent = new AIRunEvent(ObjectID.generate());
    event.eventType = step.eventType;

    if (step.toolName) {
      event.toolName = step.toolName;
    }

    if (step.resultSummary) {
      event.resultSummary = step.resultSummary;
    }

    return event;
  });
}

const RESULT_UNKNOWN_MESSAGE: string = `${INFRASTRUCTURE_RESULT_UNKNOWN_EVENT_PREFIX} the Docker AI agent of Docker host "web-1" took the command, but no result came back, so whether it ran is unknown.`;

function infrastructure(
  outcome: "succeeded" | "errored" | "not-run" | "unknown",
): Array<StepEvent> {
  return [
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    },
    outcome === "not-run" || outcome === "unknown"
      ? {
          eventType: AIRunEventType.ToolCallFailed,
          toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          resultSummary: {
            errorMessage:
              outcome === "unknown"
                ? RESULT_UNKNOWN_MESSAGE
                : 'No command was run on Docker host "web-1": the Docker AI agent did not pick up the command in time.',
          },
        }
      : {
          eventType: AIRunEventType.ToolCallCompleted,
          toolName: RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
          resultSummary: {
            rowCount: outcome === "succeeded" ? 1 : 0,
            durationInMs: 2000,
          },
        },
  ];
}

afterEach(() => {
  cleanup();
});

describe("the infrastructure tool names", () => {
  test("are their own list, and the cluster list is unchanged", () => {
    expect(INFRASTRUCTURE_TOOL_NAMES).toEqual([
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
    ]);
    expect(CLUSTER_TOOL_NAMES).toEqual([
      RUN_KUBECTL_TOOL_NAME,
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ]);
    expect(isClusterToolName(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME)).toBe(false);
    expect(isInfrastructureToolName(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME)).toBe(
      true,
    );
    expect(isInfrastructureToolName(RUN_KUBECTL_TOOL_NAME)).toBe(false);
    expect(isInfrastructureToolName(undefined)).toBe(false);
  });

  test("are live infrastructure like the cluster tools; telemetry is not", () => {
    for (const toolName of [
      RUN_KUBECTL_TOOL_NAME,
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
    ]) {
      expect(isLiveInfrastructureToolName(toolName)).toBe(true);
    }

    expect(isLiveInfrastructureToolName("query_metrics")).toBe(false);
    expect(isLiveInfrastructureToolName(null)).toBe(false);
  });

  test("recognise the server's result-unknown event", () => {
    expect(isInfrastructureResultUnknownMessage(RESULT_UNKNOWN_MESSAGE)).toBe(
      true,
    );
    expect(
      isInfrastructureResultUnknownMessage(
        'No command was run on Docker host "web-1".',
      ),
    ).toBe(false);
    expect(isInfrastructureResultUnknownMessage(undefined)).toBe(false);
  });
});

describe("infrastructure tool outcomes and evidence", () => {
  test("a command says whether it succeeded or returned an error, never rows", () => {
    expect(
      describeClusterToolOutcome(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME, 1),
    ).toEqual({ label: "Succeeded", detail: "succeeded", isError: false });
    expect(
      describeClusterToolOutcome(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME, 0),
    ).toEqual({
      label: "The command returned an error",
      detail: "the command returned an error",
      isError: true,
    });
    expect(formatEvidenceOutcome(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME, 1)).toBe(
      "Succeeded",
    );
  });

  test("a listing counts resources", () => {
    expect(
      describeClusterToolOutcome(LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 0)
        ?.label,
    ).toBe("No resources");
    expect(
      describeClusterToolOutcome(LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 1)
        ?.label,
    ).toBe("1 resource");
    expect(
      describeClusterToolOutcome(LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME, 3)
        ?.detail,
    ).toBe("3 resources");
  });

  test("describes each tool and never promises rows", () => {
    expect(describeEvidenceTool(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME)).toEqual({
      description: "Ran a read-only infrastructure command",
      icon: IconProp.Terminal,
      category: "Infrastructure",
    });
    expect(
      describeClusterEvidenceTool(LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME),
    ).toEqual({
      description: "Listed the infrastructure OneUptime AI can inspect",
      icon: IconProp.Server,
      category: "Infrastructure",
    });

    for (const toolName of INFRASTRUCTURE_TOOL_NAMES) {
      const note: string | null = getClusterEvidenceNote(toolName);
      expect(note).toBeTruthy();
      expect(note).not.toContain("its rows");
    }

    // Every command is listed on the resource's AI Logs page now.
    const commandNote: string | null = getClusterEvidenceNote(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(commandNote).toContain(
      "the resource's AI Logs page (AI → Logs) lists every command OneUptime AI ran there.",
    );
    expect(commandNote).not.toContain("AI Insights");
  });

  test("leaves the kubectl wording as it was", () => {
    expect(describeClusterToolOutcome(RUN_KUBECTL_TOOL_NAME, 0)?.label).toBe(
      "kubectl returned an error",
    );
    expect(describeClusterToolOutcome("query_metrics", 3)).toBeNull();
  });
});

describe("summarizeKubectlActivity with infrastructure calls", () => {
  test("keeps infrastructure calls out of telemetry and counts them on their own", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        {
          eventType: AIRunEventType.ToolCallStarted,
          toolName: LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        },
        {
          eventType: AIRunEventType.ToolCallCompleted,
          toolName: LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
          resultSummary: { rowCount: 2 },
        },
        ...infrastructure("succeeded"),
        ...infrastructure("errored"),
        ...infrastructure("not-run"),
        ...infrastructure("unknown"),
      ]),
    );

    expect(summary.executed).toBe(0);
    expect(summary.notRun).toBe(0);
    // Every infrastructure call started is not a telemetry query.
    expect(summary.clusterToolCalls).toBe(5);
    expect(summary.infrastructure).toEqual({
      executed: 2,
      succeeded: 1,
      notRun: 1,
      unknown: 1,
    });
  });

  test("leaves the summary exactly as it was without infrastructure calls", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        {
          eventType: AIRunEventType.ToolCallStarted,
          toolName: RUN_KUBECTL_TOOL_NAME,
        },
      ]),
    );

    expect(summary).toEqual({
      executed: 0,
      succeeded: 0,
      notRun: 0,
      unknown: 0,
      clusterToolCalls: 1,
    });
    expect("infrastructure" in summary).toBe(false);
  });

  test("counts only the latest attempt", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        ...infrastructure("succeeded"),
        { eventType: AIRunEventType.RunStarted },
        ...infrastructure("not-run"),
      ]),
    );

    expect(summary.infrastructure).toEqual({
      executed: 0,
      succeeded: 0,
      notRun: 1,
      unknown: 0,
    });
  });
});

describe("ChatActivityFeed infrastructure steps", () => {
  test("labels a command and says whether it succeeded, returned an error or never ran", () => {
    render(
      <ChatActivityFeed
        events={events([
          ...infrastructure("succeeded"),
          ...infrastructure("errored"),
          ...infrastructure("not-run"),
        ])}
        hideChrome={true}
      />,
    );

    expect(
      screen.getAllByText("Running a command on the infrastructure"),
    ).toHaveLength(3);
    expect(screen.getByText("· succeeded · 2.0s")).toBeVisible();
    expect(
      screen.getByText("· the command returned an error · 2.0s"),
    ).toBeVisible();
    expect(
      screen.getByText("· did not run on the infrastructure"),
    ).toBeVisible();
    expect(screen.queryByText(/row/)).toBeNull();
    expect(screen.queryByText(/retrying/)).toBeNull();
  });

  test("says a command whose result never came back may have run", () => {
    render(
      <ChatActivityFeed
        events={events([...infrastructure("unknown")])}
        hideChrome={true}
      />,
    );

    expect(
      screen.getByText("· no result came back — it may have run"),
    ).toBeVisible();
    expect(screen.queryByText(/did not run/)).toBeNull();
  });

  test("labels the listing and counts it in resources", () => {
    render(
      <ChatActivityFeed
        events={events([
          {
            eventType: AIRunEventType.ToolCallStarted,
            toolName: LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
          },
          {
            eventType: AIRunEventType.ToolCallCompleted,
            toolName: LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
            resultSummary: { rowCount: 2 },
          },
        ])}
        hideChrome={true}
      />,
    );

    expect(screen.getByText("Checking infrastructure access")).toBeVisible();
    expect(screen.getByText("· 2 resources")).toBeVisible();
  });
});

describe("describeInfrastructureUsage", () => {
  function activity(
    overrides: Partial<InfrastructureActivitySummary> = {},
  ): InfrastructureActivitySummary {
    return { executed: 0, succeeded: 0, notRun: 0, unknown: 0, ...overrides };
  }

  test.each<[string, InfrastructureActivitySummary | undefined, string | null]>(
    [
      ["no activity", undefined, null],
      ["nothing tried", activity(), null],
      [
        "one that ran",
        activity({ executed: 1, succeeded: 1 }),
        "1 infrastructure command",
      ],
      [
        "some that failed or never ran",
        activity({ executed: 3, succeeded: 2, notRun: 1, unknown: 1 }),
        "3 infrastructure commands (1 failed, 1 did not run, 1 returned no result)",
      ],
      [
        "only never ran",
        activity({ notRun: 2 }),
        "2 infrastructure commands did not run",
      ],
      [
        "only unknown",
        activity({ unknown: 1 }),
        "1 infrastructure command returned no result",
      ],
      [
        "never ran and unknown",
        activity({ notRun: 1, unknown: 2 }),
        "3 infrastructure commands without a result (1 did not run, 2 returned no result)",
      ],
    ],
  )(
    "words %s",
    (
      _label: string,
      summary: InfrastructureActivitySummary | undefined,
      expected: string | null,
    ) => {
      expect(describeInfrastructureUsage(summary)).toBe(expected);
    },
  );
});

describe("InvestigationUsageLine with infrastructure commands", () => {
  function usageItems(
    toolCallCount: number,
    kubectlActivity: KubectlActivitySummary,
  ): Array<string> {
    render(
      <InvestigationUsageLine
        usage={{ toolCallCount, totalTokens: 0 }}
        kubectlActivity={kubectlActivity}
        showReadOnly={false}
      />,
    );
    return within(screen.getByRole("list", { name: "Investigation usage" }))
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });
  }

  test("counts telemetry without the infrastructure calls and says what those did", () => {
    expect(
      usageItems(5, {
        executed: 0,
        succeeded: 0,
        notRun: 0,
        clusterToolCalls: 3,
        infrastructure: { executed: 2, succeeded: 2, notRun: 0, unknown: 0 },
      }),
    ).toEqual(["2 telemetry queries", "2 infrastructure commands"]);
  });

  test("shows kubectl and infrastructure apart", () => {
    expect(
      usageItems(6, {
        executed: 1,
        succeeded: 1,
        notRun: 0,
        clusterToolCalls: 3,
        infrastructure: { executed: 1, succeeded: 0, notRun: 0, unknown: 0 },
      }),
    ).toEqual([
      "3 telemetry queries",
      "1 kubectl command",
      "1 infrastructure command (1 failed)",
    ]);
  });

  test("adds nothing for a run without infrastructure calls", () => {
    expect(
      usageItems(3, {
        executed: 1,
        succeeded: 1,
        notRun: 0,
        clusterToolCalls: 1,
      }),
    ).toEqual(["2 telemetry queries", "1 kubectl command"]);
  });
});
