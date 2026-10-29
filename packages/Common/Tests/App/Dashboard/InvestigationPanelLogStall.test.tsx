import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An investigation that could not tell the cause for lack of logs says so
 * on the AI card, under its report, with the way forward - read from the
 * InvestigationStalled event the run recorded (the server decides it):
 *
 *  - no log reached OneUptime: "No logs to read", and Set up logs;
 *  - logs did, and its searches found none about the record: "No logs about
 *    this incident", how many times it searched, Set up logs and Find
 *    unlogged failures (Logs AI);
 *  - no such event, one that does not hold together, or no report beside
 *    it: nothing.
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
import { INVESTIGATION_LOG_STALL_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationLogStallCopy";
import AIRunCodeFixRecommendation from "../../../Types/AI/AIRunCodeFixRecommendation";
import AIRunEventType from "../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { InvestigationLogStallReason } from "../../../Utils/AI/InvestigationLogStall";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

const COMPLETED_AT: string = "2026-10-29T12:00:00.000Z";
const RUN_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ANALYSIS: string =
  "## Root cause\n\nCould not determine the root cause: no evidence was found in the telemetry.";

let eventSequence: number = 0;

function event(
  eventType: AIRunEventType,
  resultSummary?: JSONObject,
): JSONObject {
  eventSequence++;
  return {
    _id: ObjectID.generate().toString(),
    sequence: eventSequence,
    eventType,
    ...(resultSummary ? { resultSummary } : {}),
    createdAt: COMPLETED_AT,
  };
}

function stalled(logStall: JSONObject): JSONObject {
  return event(AIRunEventType.InvestigationStalled, {
    message: "OneUptime AI searched the logs 3 times and found nothing.",
    logStall,
  });
}

const NO_LOGS: JSONObject = {
  reason: InvestigationLogStallReason.NoLogs,
  logSearchCount: 0,
  windowStart: "2026-10-29T10:30:00.000Z",
  windowEnd: COMPLETED_AT,
};

const NO_MATCHING_LOGS: JSONObject = {
  reason: InvestigationLogStallReason.NoMatchingLogs,
  logSearchCount: 3,
  windowStart: "2026-10-29T10:30:00.000Z",
  windowEnd: COMPLETED_AT,
};

function payload(data: {
  events: Array<JSONObject>;
  analysisMarkdown?: string | null | undefined;
  isAnalysisPending?: boolean | undefined;
}): { data: JSONObject } {
  return {
    data: {
      run: {
        _id: RUN_ID,
        status: AIRunStatus.Completed,
        errorMessage: null,
        toolCallCount: 3,
        totalTokens: 1234,
        humanVerdict: null,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        completedAt: COMPLETED_AT,
      },
      events: data.events as unknown as JSONArray,
      analysisMarkdown:
        data.analysisMarkdown === undefined ? ANALYSIS : data.analysisMarkdown,
      analysisTldr: null,
      isAnalysisPending: data.isAnalysisPending === true,
      evidence: [],
      references: [],
      clusterAccess: [],
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

async function renderPanel(
  events: Array<JSONObject>,
  options: {
    subjectType?: "incident" | "alert";
    analysisMarkdown?: string | null;
    isAnalysisPending?: boolean;
  } = {},
): Promise<void> {
  postMock.mockResolvedValue(
    payload({
      events,
      analysisMarkdown: options.analysisMarkdown,
      isAnalysisPending: options.isAnalysisPending,
    }) as never,
  );

  render(
    <InvestigationPanel
      subjectType={options.subjectType || "incident"}
      subjectId={INCIDENT_ID}
    />,
  );

  await flush();
}

function notice(): HTMLElement | null {
  return screen.queryByTestId(INVESTIGATION_LOG_STALL_TEST_IDS.notice);
}

function href(testId: string): string {
  return screen.getByTestId(testId).getAttribute("href") || "";
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

describe("the AI card says when the logs stood in the way", () => {
  test("no log reached OneUptime: No logs to read, and where to set them up", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      stalled(NO_LOGS),
      event(AIRunEventType.RunCompleted),
    ]);

    const line: HTMLElement = notice()!;

    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveTextContent("No logs to read");
    expect(line).toHaveTextContent(
      "No logs reached OneUptime from the hour before this incident started, so OneUptime AI had none to read. Send your services' logs to OneUptime, and the next investigation can use them.",
    );
    expect(href(INVESTIGATION_LOG_STALL_TEST_IDS.setUpLogs)).toBe(
      `/dashboard/${PROJECT_ID}/logs/documentation`,
    );
    expect(
      screen.getByTestId(INVESTIGATION_LOG_STALL_TEST_IDS.setUpLogs),
    ).toHaveTextContent("Set up logs");
    // Logs AI finds what logs do not say: no help with no logs at all.
    expect(
      screen.queryByTestId(INVESTIGATION_LOG_STALL_TEST_IDS.logsAi),
    ).toBeNull();
  });

  test("logs reached OneUptime and none matched: how many times it searched, and both ways forward", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      stalled(NO_MATCHING_LOGS),
      event(AIRunEventType.RunCompleted),
    ]);

    const line: HTMLElement = notice()!;

    expect(line).toHaveTextContent("No logs about this incident");
    expect(line).toHaveTextContent(
      "OneUptime AI searched the logs 3 times and found nothing about this incident. Check that every service involved sends its logs to OneUptime, and let Logs AI find the failures your code does not log.",
    );
    expect(href(INVESTIGATION_LOG_STALL_TEST_IDS.setUpLogs)).toBe(
      `/dashboard/${PROJECT_ID}/logs/documentation`,
    );
    expect(href(INVESTIGATION_LOG_STALL_TEST_IDS.logsAi)).toBe(
      `/dashboard/${PROJECT_ID}/logs/ai/insights`,
    );
    expect(
      screen.getByTestId(INVESTIGATION_LOG_STALL_TEST_IDS.logsAi),
    ).toHaveTextContent("Find unlogged failures");
  });

  test("one search is said as once", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      stalled({ ...NO_MATCHING_LOGS, logSearchCount: 1 }),
      event(AIRunEventType.RunCompleted),
    ]);

    expect(notice()).toHaveTextContent(
      "OneUptime AI searched the logs once and found nothing about this incident",
    );
  });

  test("an alert's card says it of the alert", async () => {
    await renderPanel(
      [
        event(AIRunEventType.RunStarted),
        stalled(NO_MATCHING_LOGS),
        event(AIRunEventType.RunCompleted),
      ],
      { subjectType: "alert" },
    );

    expect(notice()).toHaveTextContent("No logs about this alert");
    expect(notice()).toHaveTextContent("found nothing about this alert");
  });

  test("it sits under the report, before the run's details", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      stalled(NO_LOGS),
      event(AIRunEventType.RunCompleted),
    ]);

    const report: HTMLElement = screen.getByTestId("investigation-markdown");
    const line: HTMLElement = notice()!;

    expect(
      report.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The links are a row of their own, never inside the sentence.
    expect(
      screen
        .getByTestId(INVESTIGATION_LOG_STALL_TEST_IDS.actions)
        .closest("p"),
    ).toBeNull();
  });

  test("a run that recorded no stall says nothing of the kind", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      event(AIRunEventType.RunCompleted),
    ]);

    expect(screen.getByTestId("investigation-markdown")).toBeInTheDocument();
    expect(notice()).toBeNull();
  });

  test("a stall that does not hold together says nothing", async () => {
    await renderPanel([
      event(AIRunEventType.RunStarted),
      stalled({ ...NO_LOGS, reason: "NoTraces" }),
      event(AIRunEventType.RunCompleted),
    ]);

    expect(notice()).toBeNull();
  });

  test("no report beside it, nothing: the line explains a report", async () => {
    await renderPanel(
      [
        event(AIRunEventType.RunStarted),
        stalled(NO_LOGS),
        event(AIRunEventType.RunCompleted),
      ],
      { analysisMarkdown: null },
    );

    expect(notice()).toBeNull();
  });
});
