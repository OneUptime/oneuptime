import "@testing-library/jest-dom";
import {
  afterEach,
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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The chart under a telemetry rule: what the rule would have caught.
 *
 * It asks the server to count the monitor's own query in every window of
 * the rule's length over the last hours (POST /telemetry/<signal>/
 * monitor-preview), a moment after the last change, and draws the counts
 * as bars under the rule's number, saying how often the rule would have
 * alerted, what is normal, and offering a number it would not have passed.
 * The chart and the request are stood in for: what is pinned is what is
 * asked, what is drawn, and what is said.
 */

interface RecordedChart {
  data: Array<{ data: Array<{ x: Date; y: number }> }>;
  referenceLines?: Array<{ value: number }> | undefined;
}

const charts: Array<RecordedChart> = [];

jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  return {
    __esModule: true,
    default: (props: RecordedChart): null => {
      charts.push(props);
      return null;
    },
  };
});

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error) => {
        return error.message || "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "11111111-1111-4111-8111-111111111111" };
      },
    },
  };
});

import TelemetryRulePreview, {
  getPreviewRoute,
  PREVIEW_READ_DELAY_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryRule/TelemetryRulePreview";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";

const END: Date = new Date("2026-10-28T12:00:00.000Z");
const WINDOW_SECONDS: number = 300;

// An answer with one count per window, oldest first.
function answer(counts: Array<number>): JSONObject {
  const start: number = END.getTime() - counts.length * WINDOW_SECONDS * 1000;

  return {
    windowInSeconds: WINDOW_SECONDS,
    startTime: new Date(start).toISOString(),
    endTime: END.toISOString(),
    buckets: counts.map((value: number, index: number) => {
      return {
        time: new Date(start + index * WINDOW_SECONDS * 1000).toISOString(),
        value,
      };
    }),
  };
}

function answerWith(counts: Array<number>): void {
  postMock.mockImplementation(() => {
    return Promise.resolve(new HTTPResponse(200, answer(counts), {}));
  });
}

async function waitForRead(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(PREVIEW_READ_DELAY_IN_MS);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function lastChart(): RecordedChart {
  const chart: RecordedChart | undefined = charts[charts.length - 1];

  if (!chart) {
    throw new Error("No chart drawn");
  }

  return chart;
}

const LOG_SETTINGS: JSONObject = {
  body: "payment",
  severityTexts: ["Error"],
  lastXSecondsOfLogs: WINDOW_SECONDS,
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  charts.length = 0;
  postMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what the preview asks", () => {
  test("each signal reads from its own route", () => {
    expect(getPreviewRoute(MonitorType.Logs)).toBe(
      "/telemetry/logs/monitor-preview",
    );
    expect(getPreviewRoute(MonitorType.Traces)).toBe(
      "/telemetry/traces/monitor-preview",
    );
    expect(getPreviewRoute(MonitorType.Exceptions)).toBe(
      "/telemetry/exceptions/monitor-preview",
    );
  });

  test("it says it is counting, then asks once, a moment after it is drawn, with the step's settings", async () => {
    answerWith([1, 2, 3]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
      />,
    );

    expect(
      screen.getByTestId("telemetry-rule-preview-loading"),
    ).toHaveTextContent("Counting what this rule would have seen…");
    expect(postMock).not.toHaveBeenCalled();

    await waitForRead();

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toContain("/telemetry/logs/monitor-preview");
    expect(request["data"]).toEqual(LOG_SETTINGS);
    expect(request["headers"]).toMatchObject({
      tenantid: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("changes made close together are read once, after the last", async () => {
    answerWith([1]);

    const { rerender } = render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
      />,
    );

    for (const body of ["p", "pa", "pay", "payment declined"]) {
      rerender(
        <TelemetryRulePreview
          monitorType={MonitorType.Logs}
          settings={{ ...LOG_SETTINGS, body }}
          filterType={FilterType.GreaterThan}
          threshold={10}
        />,
      );
      await act(async () => {
        jest.advanceTimersByTime(PREVIEW_READ_DELAY_IN_MS / 3);
      });
    }

    expect(postMock).not.toHaveBeenCalled();

    await waitForRead();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(
      (postMock.mock.calls[0]![0] as JSONObject)["data"] as JSONObject,
    ).toMatchObject({ body: "payment declined" });
  });

  test("a new number is judged on the counts already read, without asking again", async () => {
    answerWith([5, 15, 5]);

    const { rerender } = render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
      />,
    );

    await waitForRead();

    expect(
      screen.getByTestId("telemetry-rule-preview-verdict"),
    ).toHaveTextContent("This rule would have alerted 1 time, for 5 minutes.");

    rerender(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={20}
      />,
    );

    await waitForRead();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("telemetry-rule-preview-verdict"),
    ).toHaveTextContent("This rule would not have alerted in this time.");
  });
});

describe("what the preview draws and says", () => {
  test("one bar per window, the rule's number as a line, and what is normal", async () => {
    answerWith([3, 4, 12, 13, 4, 3]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
      />,
    );

    await waitForRead();

    expect(screen.getByTestId("telemetry-rule-preview")).toHaveTextContent(
      "Matching logs in each 5 minutes, over the last 30 minutes.",
    );
    expect(
      lastChart().data[0]!.data.map((point: { y: number }) => {
        return point.y;
      }),
    ).toEqual([3, 4, 12, 13, 4, 3]);
    expect(lastChart().referenceLines).toEqual([
      expect.objectContaining({ value: 10 }),
    ]);
    expect(
      screen.getByTestId("telemetry-rule-preview-verdict"),
    ).toHaveTextContent("This rule would have alerted 1 time, for 10 minutes.");
    expect(
      screen.getByTestId("telemetry-rule-preview-facts"),
    ).toHaveTextContent("Highest: 13 · Usually: 4 · Latest: 3");
  });

  test("it offers a number the rule would not have passed, and hands it to the rule", async () => {
    answerWith([3, 4, 12, 13, 4, 3]);
    const onUse: MockFunction = getJestMockFunction();

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
        onUseSuggestedThreshold={(value: number) => {
          onUse(value);
        }}
      />,
    );

    await waitForRead();

    const button: HTMLElement = screen.getByTestId(
      "telemetry-rule-preview-use-suggestion",
    );
    const suggested: number = Number(
      (button.textContent || "").replace(/[^0-9]/g, ""),
    );

    expect(suggested).toBeGreaterThan(13);

    fireEvent.click(button);

    expect(onUse).toHaveBeenCalledWith(suggested);
  });

  test("no suggestion is offered without a way to use it", async () => {
    answerWith([3, 4, 12, 13, 4, 3]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Traces}
        settings={{ spanStatuses: [2] }}
        filterType={FilterType.GreaterThan}
        threshold={10}
      />,
    );

    await waitForRead();

    expect(
      screen.queryByTestId("telemetry-rule-preview-use-suggestion"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("telemetry-rule-preview")).toHaveTextContent(
      "Matching spans in each 5 minutes",
    );
  });

  test("a rule for silence over windows with nothing in them warns it would alert at once", async () => {
    answerWith([0, 0, 0]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.EqualTo}
        threshold={0}
      />,
    );

    await waitForRead();

    expect(
      screen.getByTestId("telemetry-rule-preview-verdict"),
    ).toHaveTextContent(
      "Nothing matched in this time, so this rule would alert as soon as the monitor is saved.",
    );
    expect(
      screen.queryByTestId("telemetry-rule-preview-facts"),
    ).not.toBeInTheDocument();
  });

  test("an unusual-for-the-hour rule draws no line, and says what it compares with", async () => {
    answerWith([3, 4, 5]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.AnomalouslyHigh}
        threshold={undefined}
      />,
    );

    await waitForRead();

    expect(lastChart().referenceLines).toBeUndefined();
    expect(
      screen.getByTestId("telemetry-rule-preview-verdict"),
    ).toHaveTextContent(
      "Compared with the same hour of the week over the last 14 days.",
    );
  });

  test("a grouped Logs monitor is told the preview counts every group together", async () => {
    answerWith([3]);

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Logs}
        settings={LOG_SETTINGS}
        filterType={FilterType.GreaterThan}
        threshold={10}
        isGrouped={true}
      />,
    );

    await waitForRead();

    expect(screen.getByTestId("telemetry-rule-preview")).toHaveTextContent(
      "Counted together here. The monitor counts each group on its own.",
    );
  });

  test("a preview that cannot be counted says why, and reads again on Try again", async () => {
    postMock.mockImplementation(() => {
      return Promise.reject(new Error("The count took too long."));
    });

    render(
      <TelemetryRulePreview
        monitorType={MonitorType.Exceptions}
        settings={{ exceptionTypes: ["TypeError"] }}
        filterType={FilterType.GreaterThan}
        threshold={0}
      />,
    );

    await waitForRead();

    expect(
      screen.getByTestId("telemetry-rule-preview-error"),
    ).toHaveTextContent(
      "The preview could not be counted: The count took too long.",
    );

    answerWith([0, 2]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitForRead();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("telemetry-rule-preview")).toHaveTextContent(
      "Matching exceptions in each 5 minutes",
    );
  });
});
