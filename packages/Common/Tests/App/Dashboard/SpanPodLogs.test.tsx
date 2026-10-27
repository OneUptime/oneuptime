import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import SpanPodLogs, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/SpanPodLogs";
import Log from "../../../Models/AnalyticsModels/Log";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The span panel's "Logs from this pod during this span (not linked by trace
 * ID)" against a pod that answers like ClickHouse would: by pod, by time
 * window, sorted and cut at the read's limit. The span is an oneuptime-app
 * request the eBPF agent recorded on the test cluster (3.46 ms); the pod
 * wrote three lines for it and others for its neighbours.
 */

type ListArgs = {
  modelType: unknown;
  query: JSONObject;
  select?: JSONObject;
  sort?: JSONObject;
  skip: number;
  limit: number;
};
type ListResultLike = {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const getListMock: Mock<(args: ListArgs) => Promise<ListResultLike>> =
  jest.fn<(args: ListArgs) => Promise<ListResultLike>>();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (args: ListArgs) => {
        return getListMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return String((error.data as JSONObject)?.["message"]);
        }
        return (error as Error)?.message || "Failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

const MS: number = 1_000_000;
const SPAN_START_MS: number = Date.UTC(2026, 9, 27, 8, 2, 9, 232);
const SPAN_START: number = SPAN_START_MS * MS + 13_800;
const SPAN_END: number = SPAN_START + 3_462_700;
const POD: string = "7a2872b83f046399";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

interface PodLine {
  offsetMs: number;
  // An exact instant instead of the offset from the span's start.
  atUnixNano?: number;
  body: string;
  severity?: string;
}

let podLines: Array<PodLine> = [];
let failReads: string | null = null;

function toLog(line: PodLine, index: number): Log {
  const nanos: number = line.atUnixNano ?? SPAN_START + line.offsetMs * MS;
  return Object.assign(new Log(), {
    _id: new ObjectID(
      `20000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    ),
    time: new Date(Math.floor(nanos / MS)),
    timeUnixNano: nanos,
    severityText: line.severity || "Information",
    body: line.body,
  });
}

function podReads(): Array<ListArgs> {
  return getListMock.mock.calls.map((call: [ListArgs]) => {
    return call[0];
  });
}

/*
 *   -233 ms  a neighbour's request         (outside the default window)
 *    -50 ms  a neighbour's request
 *  +1.27 ms  Product Type: Traces          \
 *  +1.28 ms  Is Protobuf: true              } this span
 *  +3.24 ms  Added traces ingestion job    /
 *    +60 ms  a neighbour's request
 *   +221 ms  Product Type: Logs            (outside the default window)
 */
function measuredLines(): Array<PodLine> {
  return [
    { offsetMs: -232.59, body: "Product Type: Traces (earlier request)" },
    { offsetMs: -50, body: "Is Protobuf: false (earlier request)" },
    { offsetMs: 1.27, body: "Product Type: Traces" },
    { offsetMs: 1.28, body: "Is Protobuf: true" },
    {
      offsetMs: 3.24,
      body: "Added traces ingestion job: traces-1793088129234000000",
    },
    {
      offsetMs: 60,
      body: "Request finished (later request)",
      severity: "Warning",
    },
    { offsetMs: 221.49, body: "Product Type: Logs (later request)" },
  ];
}

beforeEach(() => {
  getListMock.mockReset();
  podLines = measuredLines();
  failReads = null;

  getListMock.mockImplementation(async (args: ListArgs) => {
    if (failReads) {
      throw new HTTPErrorResponse(500, { message: failReads }, {});
    }

    const window: InBetween<Date> = args.query[
      "time"
    ] as unknown as InBetween<Date>;
    // `time` is a DateTime64(9): compared to the nanosecond, both ends in.
    const rows: Array<Log> = podLines
      .map(toLog)
      .filter((log: Log) => {
        const time: number = Number(log.timeUnixNano);
        return (
          args.query["k8sPodEntityKey"] === POD &&
          time >= window.startValue.getTime() * MS &&
          time <= window.endValue.getTime() * MS
        );
      })
      .sort((left: Log, right: Log) => {
        return Number(left.timeUnixNano) - Number(right.timeUnixNano);
      });

    if (args.sort?.["time"] === SortOrder.Descending) {
      rows.reverse();
    }

    return {
      data: rows.slice(0, args.limit),
      count: rows.length,
      skip: 0,
      limit: args.limit,
    };
  });
});

afterEach(() => {
  cleanup();
});

function renderPodLogs(overrides: Partial<ComponentProps> = {}): void {
  render(
    <SpanPodLogs
      podEntityKey={POD}
      podName="oneuptime-app-5b9df8b796-88bzt"
      startTimeUnixNano={SPAN_START}
      endTimeUnixNano={SPAN_END}
      hasLinkedLogs={false}
      {...overrides}
    />,
  );
}

// Each line as "<severity> <body> <offset>".
function linesIn(position: "before" | "during" | "after"): Array<string> {
  return within(screen.getByTestId(`span-pod-logs-${position}`))
    .getAllByRole("listitem")
    .map((item: HTMLElement) => {
      return Array.from(item.children)
        .map((part: Element) => {
          return (part.textContent || "").trim();
        })
        .join(" ");
    });
}

describe("an eBPF span, whose logs carry no trace ID", () => {
  test("opens on what its pod wrote, before, during and after the span, labelled as not linked", async () => {
    renderPodLogs();

    expect(
      screen.getByText("No logs carry this span's ID."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("span-pod-logs-toggle")).toHaveTextContent(
      "Logs from this pod during this span (not linked by trace ID)",
    );
    expect(screen.getByTestId("span-pod-logs-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("span-pod-logs-window")).toHaveTextContent(
      "What oneuptime-app-5b9df8b796-88bzt wrote from 100 ms before this span to 100 ms after it. A pod serves many requests at once, so some of these lines may belong to other requests.",
    );

    await screen.findByTestId("span-pod-log-lines");

    expect(linesIn("before")).toEqual([
      "Information Is Protobuf: false (earlier request) -50 ms",
    ]);
    expect(linesIn("during")).toEqual([
      "Information Product Type: Traces +1.27 ms",
      "Information Is Protobuf: true +1.28 ms",
      "Information Added traces ingestion job: traces-1793088129234000000 +3.24 ms",
    ]);
    expect(linesIn("after")).toEqual([
      "Warning Request finished (later request) +60 ms",
    ]);
    expect(screen.getByTestId("span-pod-logs-before")).toHaveTextContent(
      "Before the span",
    );
    expect(screen.getByTestId("span-pod-logs-during")).toHaveTextContent(
      "During the span",
    );
    expect(screen.getByTestId("span-pod-logs-after")).toHaveTextContent(
      "After the span",
    );
  });

  test("its neighbours' lines are muted, its own are not", async () => {
    renderPodLogs();
    await screen.findByTestId("span-pod-log-lines");

    const during: HTMLElement = within(
      screen.getByTestId("span-pod-logs-during"),
    ).getAllByRole("listitem")[0]!;
    const before: HTMLElement = within(
      screen.getByTestId("span-pod-logs-before"),
    ).getAllByRole("listitem")[0]!;

    expect(during.className).toContain("bg-white");
    expect(
      within(during).getByText("Product Type: Traces").className,
    ).toContain("text-gray-800");
    expect(before.className).toContain("bg-gray-50");
    expect(
      within(before).getByText("Is Protobuf: false (earlier request)")
        .className,
    ).toContain("text-gray-500");
  });

  test("reads the pod's own key in two parts that meet at the span's start: the nearest lines before it, then the lines from it", async () => {
    renderPodLogs();
    await screen.findByTestId("span-pod-log-lines");

    const [before, fromStart] = podReads();

    expect(podReads()).toHaveLength(2);
    expect(before!.modelType).toBe(Log);
    expect(String(before!.query["projectId"])).toBe(PROJECT_ID);
    expect(before!.query["k8sPodEntityKey"]).toBe(POD);
    expect(before!.query["traceId"]).toBeUndefined();
    expect(before!.query["time"]).toEqual(
      new InBetween<Date>(
        new Date(SPAN_START_MS - 100),
        new Date(SPAN_START_MS),
      ),
    );
    expect(before!.sort).toEqual({ time: SortOrder.Descending });
    expect(before!.limit).toBe(50);

    expect(fromStart!.query["k8sPodEntityKey"]).toBe(POD);
    expect(fromStart!.query["time"]).toEqual(
      new InBetween<Date>(
        new Date(SPAN_START_MS),
        new Date(SPAN_START_MS + 104),
      ),
    );
    expect(fromStart!.sort).toEqual({ time: SortOrder.Ascending });
    expect(fromStart!.limit).toBe(200);
    expect(Object.keys(fromStart!.select!).sort()).toEqual(
      ["_id", "body", "severityText", "time", "timeUnixNano"].sort(),
    );
  });

  test("a line logged at the very millisecond the reads meet is shown once", async () => {
    podLines = [
      {
        offsetMs: 0,
        atUnixNano: SPAN_START_MS * MS,
        body: "at the span's first millisecond",
      },
    ];
    renderPodLogs();
    await screen.findByTestId("span-pod-log-lines");

    expect(screen.getAllByText("at the span's first millisecond")).toHaveLength(
      1,
    );
  });

  test("without the pod's name it says 'the pod'", async () => {
    renderPodLogs({ podName: undefined });

    expect(screen.getByTestId("span-pod-logs-window")).toHaveTextContent(
      "What the pod wrote from 100 ms before this span to 100 ms after it.",
    );
    await screen.findByTestId("span-pod-log-lines");
  });
});

describe("a span with logs of its own", () => {
  test("keeps the pod's lines folded and unread until opened", async () => {
    renderPodLogs({ hasLinkedLogs: true });

    expect(
      screen.queryByText("No logs carry this span's ID."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("span-pod-logs-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByTestId("span-pod-logs-window"),
    ).not.toBeInTheDocument();
    expect(podReads()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("span-pod-logs-toggle"));

    expect(await screen.findByText("Product Type: Traces")).toBeInTheDocument();
    expect(podReads()).toHaveLength(2);

    // Folding and opening again shows the same answer without reading again.
    fireEvent.click(screen.getByTestId("span-pod-logs-toggle"));
    fireEvent.click(screen.getByTestId("span-pod-logs-toggle"));
    expect(screen.getByText("Product Type: Traces")).toBeInTheDocument();
    expect(podReads()).toHaveLength(2);
  });
});

describe("Advanced", () => {
  test("is folded away, and widening the window reads it again", async () => {
    renderPodLogs();
    await screen.findByTestId("span-pod-log-lines");
    expect(screen.queryByText("Product Type: Logs (later request)")).toBeNull();

    expect(
      screen.queryByTestId("span-pod-logs-padding"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("span-pod-logs-advanced"));

    const choices: HTMLElement = screen.getByTestId("span-pod-logs-padding");
    expect(
      within(choices)
        .getAllByRole("radio")
        .map((choice: HTMLElement) => {
          return choice.textContent;
        }),
    ).toEqual(["±100 ms", "±1 s", "±10 s", "±1m"]);
    expect(screen.getByTestId("span-pod-logs-padding-100")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByTestId("span-pod-logs-padding-1000"));

    expect(
      await screen.findByText("Product Type: Logs (later request)"),
    ).toBeInTheDocument();
    expect(linesIn("before")).toEqual([
      "Information Product Type: Traces (earlier request) -233 ms",
      "Information Is Protobuf: false (earlier request) -50 ms",
    ]);
    expect(screen.getByTestId("span-pod-logs-window")).toHaveTextContent(
      "from 1 s before this span to 1 s after it.",
    );

    const [, , widerBefore, widerFromStart] = podReads();
    expect(widerBefore!.query["time"]).toEqual(
      new InBetween<Date>(
        new Date(SPAN_START_MS - 1000),
        new Date(SPAN_START_MS),
      ),
    );
    expect(widerFromStart!.query["time"]).toEqual(
      new InBetween<Date>(
        new Date(SPAN_START_MS),
        new Date(SPAN_START_MS + 1004),
      ),
    );
  });
});

describe("what else the section can say", () => {
  test("a pod that wrote nothing in the window says so", async () => {
    podLines = [];
    renderPodLogs();

    expect(
      await screen.findByText("The pod wrote nothing in this window."),
    ).toBeInTheDocument();
  });

  test("a read the server refused says why", async () => {
    failReads = "Logs could not be read.";
    renderPodLogs();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Logs could not be read.",
    );
  });

  test("a busy pod's parts cut short say which lines they kept", async () => {
    podLines = [];
    for (let index: number = 0; index < 60; index++) {
      podLines.push({ offsetMs: -1 - index, body: `before ${index}` });
    }
    for (let index: number = 0; index < 210; index++) {
      podLines.push({ offsetMs: index * 0.01, body: `from start ${index}` });
    }
    renderPodLogs();
    await screen.findByTestId("span-pod-log-lines");

    expect(screen.getByTestId("span-pod-logs-before")).toHaveTextContent(
      "Only the 50 lines nearest the span are shown.",
    );
    // The nearest ones: the farthest kept is 50 ms before the span.
    expect(screen.getByText("before 0")).toBeInTheDocument();
    expect(screen.getByText("before 49")).toBeInTheDocument();
    expect(screen.queryByText("before 50")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Only the first 200 lines from the span's start are shown.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("from start 200")).not.toBeInTheDocument();
    });
  });
});
