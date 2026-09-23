import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * IP-6: the Evidence tab lists every cited call, kubectl commands and
 * cluster listings included. A kubectl command has no rows — its rowCount
 * only says whether kubectl completed (1) or ran and returned an error (0)
 * — so it must read the way the activity feed reads it ("Succeeded",
 * "kubectl returned an error"), never "1 row" or "No rows"; a cluster
 * listing counts clusters. Telemetry queries keep their row counts.
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

import InvestigationEvidenceList from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationEvidenceList";
import { InvestigationEvidenceItem } from "../../../Types/AI/InvestigationEvidence";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";

const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "33333333-3333-4333-8333-333333333333";

function item(
  citationId: string,
  toolName: string,
  rowCount: number,
  label: string,
): InvestigationEvidenceItem {
  return {
    citationId,
    toolName,
    label,
    rowCount,
    queryArguments:
      toolName === RUN_KUBECTL_TOOL_NAME
        ? {
            clusterId: "77777777-7777-4777-8777-777777777777",
            command: label,
            rationale: "see why the pod is pending",
          }
        : {},
    canLoadRows: toolName === "query_metrics",
  };
}

const ITEMS: Array<InvestigationEvidenceItem> = [
  item(
    "C1",
    RUN_KUBECTL_TOOL_NAME,
    0,
    'kubectl get pods -n web on cluster "prod-us"',
  ),
  item(
    "C2",
    RUN_KUBECTL_TOOL_NAME,
    1,
    'kubectl describe pod web-1 -n web on cluster "prod-us"',
  ),
  item("C3", "query_metrics", 5, "Max(latency)"),
  item(
    "C4",
    LIST_CLUSTER_ACCESS_TOOL_NAME,
    2,
    "Clusters OneUptime AI can inspect",
  ),
];

function renderList(): void {
  render(
    <InvestigationEvidenceList
      items={ITEMS}
      legacyEntries={[]}
      subjectType="incident"
      subjectId={INCIDENT_ID}
      runId={RUN_ID}
    />,
  );
}

function row(citationId: string): HTMLElement {
  const element: Element | null = document.querySelector(
    `[data-citation-id="${citationId}"]`,
  );

  if (!element) {
    throw new Error(`No row for ${citationId}`);
  }

  return element as HTMLElement;
}

afterEach(() => {
  cleanup();
  postMock.mockReset();
});

describe("InvestigationEvidenceList kubectl items", () => {
  test("describes a kubectl command by its outcome, never in rows", () => {
    renderList();

    const failed: HTMLElement = row("C1");
    const succeeded: HTMLElement = row("C2");

    expect(within(failed).getByText("kubectl returned an error")).toBeVisible();
    expect(within(succeeded).getByText("Succeeded")).toBeVisible();

    for (const kubectlRow of [failed, succeeded]) {
      expect(kubectlRow).not.toHaveTextContent("No rows");
      expect(kubectlRow).not.toHaveTextContent(/\b1 row\b/);
      expect(kubectlRow).toHaveTextContent("Ran a read-only kubectl command");
      expect(kubectlRow).not.toHaveTextContent("Ran run kubectl");
    }
  });

  test("styles a kubectl error as an error, not as an empty result", () => {
    renderList();

    const pill: HTMLElement = within(row("C1")).getByText(
      "kubectl returned an error",
    );
    expect(pill.className).toContain("amber");
    expect(within(row("C1")).getByText("C1").className).toContain("amber");
    // A kubectl command that succeeded is not styled as an error.
    expect(within(row("C2")).getByText("Succeeded").className).not.toContain(
      "amber",
    );
  });

  test("counts a cluster listing in clusters", () => {
    renderList();

    expect(within(row("C4")).getByText("2 clusters")).toBeVisible();
    expect(row("C4")).not.toHaveTextContent("2 rows");
    expect(row("C4")).toHaveTextContent(
      "Listed the clusters OneUptime AI can inspect",
    );
  });

  // Negative control: a telemetry query keeps its row count.
  test("keeps a telemetry query's row count", () => {
    renderList();

    expect(within(row("C3")).getByText("5 rows")).toBeVisible();
    expect(row("C3")).toHaveTextContent("Queried a metric");
  });

  test("says what an expanded kubectl command was, and never promises its rows", () => {
    renderList();

    fireEvent.click(within(row("C1")).getByRole("button"));

    const details: HTMLElement = within(row("C1")).getByRole("region");
    expect(details).toHaveTextContent("What was run");
    expect(details).toHaveTextContent(
      "kubectl commands are not re-run from the dashboard",
    );
    expect(details).not.toHaveTextContent("its rows");
    expect(details).not.toHaveTextContent("What was queried");
    // Nothing is fetched for a kubectl command.
    expect(postMock).not.toHaveBeenCalled();
  });
});
