import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import ChatActivityFeed, {
  CLUSTER_TOOL_NAMES,
  isClusterToolName,
  KubectlActivitySummary,
  summarizeKubectlActivity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ChatActivityFeed";
import AIRunEvent from "../../../Models/DatabaseModels/AIRunEvent";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import {
  LIST_CLUSTER_ACCESS_TOOL_NAME,
  RUN_KUBECTL_TOOL_NAME,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import ObjectID from "../../../Types/ObjectID";

/*
 * What an investigation's kubectl calls did, read from the run's events —
 * the one reading the notice, the usage line and the activity feed share.
 * The server records a command that reached kubectl as ToolCallCompleted
 * (rowCount 1 when kubectl succeeded, 0 when it returned an error) and one
 * that never did — never picked up by the cluster's Runner, refused, out of
 * budget — as ToolCallFailed. A ToolCallFailed kubectl call therefore never
 * counts as run, and a cluster tool call never counts as a telemetry query.
 */

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

function kubectl(
  outcome: "succeeded" | "errored" | "not-run",
): Array<StepEvent> {
  return [
    {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: RUN_KUBECTL_TOOL_NAME,
    },
    outcome === "not-run"
      ? {
          eventType: AIRunEventType.ToolCallFailed,
          toolName: RUN_KUBECTL_TOOL_NAME,
          resultSummary: {
            errorMessage:
              'kubectl was not run on cluster "prod-us": its Runner did not pick up the command in time.',
          },
        }
      : {
          eventType: AIRunEventType.ToolCallCompleted,
          toolName: RUN_KUBECTL_TOOL_NAME,
          resultSummary: {
            rowCount: outcome === "succeeded" ? 1 : 0,
            durationInMs: 2000,
          },
        },
  ];
}

function telemetry(toolName: string, rowCount: number): Array<StepEvent> {
  return [
    { eventType: AIRunEventType.ToolCallStarted, toolName },
    {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName,
      resultSummary: { rowCount },
    },
  ];
}

afterEach(() => {
  cleanup();
});

describe("summarizeKubectlActivity", () => {
  test("counts executed, succeeded and never-run kubectl calls apart", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        ...kubectl("succeeded"),
        ...kubectl("errored"),
        ...kubectl("not-run"),
        ...telemetry(LIST_CLUSTER_ACCESS_TOOL_NAME, 2),
        ...telemetry("query_metrics", 80),
      ]),
    );

    expect(summary).toEqual({
      executed: 2,
      succeeded: 1,
      notRun: 1,
      // 3 run_kubectl + 1 list_cluster_access started; query_metrics is not.
      clusterToolCalls: 4,
    });
  });

  test("a run whose every kubectl call failed to run has executed nothing", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        ...kubectl("not-run"),
        ...kubectl("not-run"),
        ...kubectl("not-run"),
      ]),
    );

    expect(summary.executed).toBe(0);
    expect(summary.succeeded).toBe(0);
    expect(summary.notRun).toBe(3);
  });

  test("never counts a list_cluster_access completion as a kubectl command", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([...telemetry(LIST_CLUSTER_ACCESS_TOOL_NAME, 1)]),
    );

    expect(summary).toEqual({
      executed: 0,
      succeeded: 0,
      notRun: 0,
      clusterToolCalls: 1,
    });
  });

  test("a run with no cluster calls reports nothing", () => {
    expect(
      summarizeKubectlActivity(
        events([
          { eventType: AIRunEventType.RunStarted },
          ...telemetry("search_logs", 3),
        ]),
      ),
    ).toEqual({ executed: 0, succeeded: 0, notRun: 0, clusterToolCalls: 0 });
    expect(summarizeKubectlActivity([])).toEqual({
      executed: 0,
      succeeded: 0,
      notRun: 0,
      clusterToolCalls: 0,
    });
  });

  /*
   * A retried run keeps its earlier attempts' events. The report, its
   * evidence and the run's counters describe the latest attempt, so the
   * kubectl counts do too.
   */
  test("counts the latest attempt only", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        { eventType: AIRunEventType.RunStarted },
        ...kubectl("succeeded"),
        ...kubectl("not-run"),
        { eventType: AIRunEventType.RunFailed },
        { eventType: AIRunEventType.RunStarted },
        ...kubectl("errored"),
      ]),
    );

    expect(summary).toEqual({
      executed: 1,
      succeeded: 0,
      notRun: 0,
      clusterToolCalls: 1,
    });
  });

  test("treats a completion without a row count as a command that returned an error", () => {
    const summary: KubectlActivitySummary = summarizeKubectlActivity(
      events([
        {
          eventType: AIRunEventType.ToolCallCompleted,
          toolName: RUN_KUBECTL_TOOL_NAME,
        },
      ]),
    );

    expect(summary.executed).toBe(1);
    expect(summary.succeeded).toBe(0);
  });
});

describe("isClusterToolName", () => {
  test("names exactly the tools that reach a cluster", () => {
    expect(CLUSTER_TOOL_NAMES).toEqual([
      RUN_KUBECTL_TOOL_NAME,
      LIST_CLUSTER_ACCESS_TOOL_NAME,
    ]);
    expect(isClusterToolName(RUN_KUBECTL_TOOL_NAME)).toBe(true);
    expect(isClusterToolName(LIST_CLUSTER_ACCESS_TOOL_NAME)).toBe(true);
    expect(isClusterToolName("query_metrics")).toBe(false);
    expect(isClusterToolName(undefined)).toBe(false);
    expect(isClusterToolName("")).toBe(false);
  });
});

describe("ChatActivityFeed kubectl steps", () => {
  test("says whether each kubectl command succeeded, returned an error or never ran", () => {
    render(
      <ChatActivityFeed
        events={events([
          ...kubectl("succeeded"),
          ...kubectl("errored"),
          ...kubectl("not-run"),
        ])}
        hideChrome={true}
      />,
    );

    expect(screen.getAllByText("Running kubectl on the cluster")).toHaveLength(
      3,
    );
    expect(screen.getByText("· succeeded · 2.0s")).toBeVisible();
    expect(
      screen.getByText("· kubectl returned an error · 2.0s"),
    ).toBeVisible();
    expect(screen.getByText("· did not run on the cluster")).toBeVisible();
    // A kubectl command has no rows to count, and is never "retried".
    expect(screen.queryByText(/row/)).toBeNull();
    expect(screen.queryByText(/retrying/)).toBeNull();
  });

  test("leaves other tools' steps as they were", () => {
    render(
      <ChatActivityFeed
        events={events([
          ...telemetry("search_logs", 3),
          {
            eventType: AIRunEventType.ToolCallStarted,
            toolName: "query_traces",
          },
          {
            eventType: AIRunEventType.ToolCallFailed,
            toolName: "query_traces",
          },
        ])}
        hideChrome={true}
      />,
    );

    expect(screen.getByText("· 3 rows")).toBeVisible();
    expect(
      screen.getByText("· did not succeed — retrying differently"),
    ).toBeVisible();
  });
});
