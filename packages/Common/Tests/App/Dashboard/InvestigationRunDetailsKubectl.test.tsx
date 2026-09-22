import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The usage line under an investigation says what the run did. Every cited
 * tool call is evidence — kubectl commands and cluster listings included —
 * but only the others are telemetry queries: kubectl has its own item, and
 * a cluster listing is configuration. Each call is counted once, and only
 * commands that ran on the cluster are counted as kubectl commands; the
 * ones that returned an error or never ran are said alongside.
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

import InvestigationRunDetails, {
  ComponentProps as RunDetailsProps,
  describeKubectlUsage,
  InvestigationUsageLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationRunDetails";
import { KubectlActivitySummary } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import ObjectID from "../../../Types/ObjectID";

const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";

let citation: number = 0;

function evidenceItem(
  toolName: string,
  rowCount: number,
  label: string,
): InvestigationEvidenceItem {
  citation++;
  return {
    citationId: `C${citation}`,
    toolName,
    label,
    rowCount,
    queryArguments: {},
    canLoadRows: toolName !== RUN_KUBECTL_TOOL_NAME,
  };
}

function activity(
  overrides: Partial<KubectlActivitySummary> = {},
): KubectlActivitySummary {
  return {
    executed: 0,
    succeeded: 0,
    notRun: 0,
    clusterToolCalls: 0,
    ...overrides,
  };
}

function runEvents(): Array<AIRunEvent> {
  const started: AIRunEvent = new AIRunEvent(ObjectID.generate());
  started.eventType = AIRunEventType.RunStarted;
  return [started];
}

// The finding's run: 2 telemetry queries, 1 cluster listing, 3 kubectl.
function mixedEvidence(): Array<InvestigationEvidenceItem> {
  return [
    evidenceItem("query_metrics", 80, "Max(db.client.connections.usage)"),
    evidenceItem("search_logs", 12, "Logs matching 'timeout'"),
    evidenceItem(
      LIST_CLUSTER_ACCESS_TOOL_NAME,
      1,
      "Clusters OneUptime AI can inspect",
    ),
    evidenceItem(
      RUN_KUBECTL_TOOL_NAME,
      1,
      'kubectl describe pod web-1 -n web on cluster "prod-us"',
    ),
    evidenceItem(
      RUN_KUBECTL_TOOL_NAME,
      1,
      'kubectl get events -n web on cluster "prod-us"',
    ),
    evidenceItem(
      RUN_KUBECTL_TOOL_NAME,
      1,
      'kubectl get nodes on cluster "prod-us"',
    ),
  ];
}

function renderDetails(overrides: Partial<RunDetailsProps> = {}): void {
  render(
    <InvestigationRunDetails
      evidence={mixedEvidence()}
      legacyEntries={[]}
      events={runEvents()}
      usage={{ toolCallCount: 6, totalTokens: 1000 }}
      kubectlActivity={activity({
        executed: 3,
        succeeded: 3,
        clusterToolCalls: 4,
      })}
      subjectType="incident"
      subjectId={INCIDENT_ID}
      runId={RUN_ID}
      focusRequest={null}
      {...overrides}
    />,
  );
}

function headerItems(): Array<string> {
  return within(screen.getByRole("list", { name: "Investigation usage" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

afterEach(() => {
  cleanup();
  citation = 0;
});

describe("InvestigationRunDetails counts each call once", () => {
  test("kubectl commands and cluster listings are not telemetry queries", () => {
    renderDetails();

    const items: Array<string> = headerItems();
    expect(items[0]).toBe("2 telemetry queries");
    expect(items[1]).toBe("3 kubectl commands");
    expect(items.join(" · ")).not.toContain("6 telemetry");
    // The Evidence tab still lists every cited call.
    fireEvent.click(screen.getByTestId("investigation-details-toggle"));
    expect(
      screen.getByRole("tab", { name: /^Evidence checked/ }),
    ).toHaveAccessibleName("Evidence checked 6");
  });

  // Negative control: telemetry-only evidence is counted exactly as before.
  test("telemetry-only evidence is still counted in full, with no kubectl item", () => {
    renderDetails({
      evidence: [
        evidenceItem("query_metrics", 80, "Max(latency)"),
        evidenceItem("search_logs", 12, "Logs"),
        evidenceItem("query_traces", 4, "Traces"),
      ],
      kubectlActivity: activity(),
    });

    const items: Array<string> = headerItems();
    expect(items[0]).toBe("3 telemetry queries");
    expect(items.join(" · ")).not.toContain("kubectl");
  });

  test("evidence made only of cluster calls counts no telemetry queries", () => {
    renderDetails({
      evidence: [
        evidenceItem(LIST_CLUSTER_ACCESS_TOOL_NAME, 1, "Clusters"),
        evidenceItem(RUN_KUBECTL_TOOL_NAME, 1, "kubectl get pods"),
        evidenceItem(RUN_KUBECTL_TOOL_NAME, 0, "kubectl get nodes"),
      ],
      kubectlActivity: activity({
        executed: 2,
        succeeded: 1,
        clusterToolCalls: 3,
      }),
    });

    const items: Array<string> = headerItems();
    expect(items[0]).toBe("0 telemetry queries");
    expect(items[1]).toBe("2 kubectl commands (1 failed)");
  });

  test("names kubectl commands that never ran instead of counting them as run", () => {
    renderDetails({
      evidence: [evidenceItem("query_metrics", 80, "Max(latency)")],
      kubectlActivity: activity({ notRun: 3, clusterToolCalls: 3 }),
    });

    const items: Array<string> = headerItems();
    expect(items[0]).toBe("1 telemetry query");
    expect(items[1]).toBe("3 kubectl commands did not run");
  });

  /*
   * Without evidence the count falls back to the run's tool calls, which
   * include every cluster tool call — those are taken out first.
   */
  test("the tool-call fallback leaves out cluster tool calls too", () => {
    renderDetails({
      evidence: [],
      kubectlActivity: activity({
        executed: 3,
        succeeded: 3,
        clusterToolCalls: 4,
      }),
    });

    const items: Array<string> = headerItems();
    expect(items[0]).toBe("2 telemetry queries");
    expect(items[1]).toBe("3 kubectl commands");
  });
});

describe("InvestigationUsageLine", () => {
  function renderLine(
    toolCallCount: number,
    kubectlActivity?: KubectlActivitySummary,
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

  test("a failed run's usage line counts kubectl apart from telemetry", () => {
    expect(
      renderLine(
        6,
        activity({ executed: 2, succeeded: 1, notRun: 1, clusterToolCalls: 4 }),
      ),
    ).toEqual([
      "2 telemetry queries",
      "2 kubectl commands (1 failed, 1 did not run)",
    ]);
  });

  test("never reports a negative query count", () => {
    expect(renderLine(1, activity({ clusterToolCalls: 3, notRun: 3 }))).toEqual(
      ["0 telemetry queries", "3 kubectl commands did not run"],
    );
  });

  test("without kubectl activity the tool calls are the telemetry queries", () => {
    expect(renderLine(5)).toEqual(["5 telemetry queries"]);
  });
});

describe("describeKubectlUsage", () => {
  test.each<[Partial<KubectlActivitySummary> | undefined, string | null]>([
    [undefined, null],
    [{}, null],
    [{ executed: 1, succeeded: 1 }, "1 kubectl command"],
    [{ executed: 3, succeeded: 3 }, "3 kubectl commands"],
    [{ executed: 3, succeeded: 2 }, "3 kubectl commands (1 failed)"],
    [
      { executed: 3, succeeded: 3, notRun: 1 },
      "3 kubectl commands (1 did not run)",
    ],
    [
      { executed: 3, succeeded: 1, notRun: 2 },
      "3 kubectl commands (2 failed, 2 did not run)",
    ],
    [{ notRun: 1 }, "1 kubectl command did not run"],
    [{ notRun: 2 }, "2 kubectl commands did not run"],
  ])(
    "%j -> %s",
    (
      overrides: Partial<KubectlActivitySummary> | undefined,
      expected: string | null,
    ) => {
      expect(
        describeKubectlUsage(overrides ? activity(overrides) : undefined),
      ).toBe(expected);
    },
  );
});
