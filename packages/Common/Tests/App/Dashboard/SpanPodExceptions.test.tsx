import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
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
import SpanPodExceptions, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/SpanPodExceptions";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The span panel's "Exceptions from this pod during this span (not linked by
 * trace ID)" against a store that keeps exceptions as ingest writes the ones
 * it extracts from log lines: no trace ID, the pod's key, the exact instant
 * in timeUnixNano and `time` only to the second.
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
const SPAN_START_MS: number = Date.UTC(2026, 9, 27, 5, 13, 8, 600);
const SPAN_START: number = SPAN_START_MS * MS;
const SPAN_END: number = SPAN_START + 3_000_000;
const POD: string = "05d5e10a274a1d03";
const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";

interface PodException {
  offsetMs: number;
  message: string;
}

let podExceptions: Array<PodException> = [];
let failReads: string | null = null;

function toException(item: PodException, index: number): ExceptionInstance {
  const nanos: number = SPAN_START + item.offsetMs * MS;
  return Object.assign(new ExceptionInstance(), {
    _id: new ObjectID(
      `50000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    ),
    // As ingest writes one extracted from a log line: to the second.
    time: new Date(Math.floor(nanos / MS / 1000) * 1000),
    timeUnixNano: nanos,
    exceptionType: "Error",
    message: item.message,
    stackTrace: `Error: ${item.message}\n    at removeJob (/usr/src/app/Worker.ts:42:11)`,
    fingerprint: FINGERPRINT,
  });
}

function reads(): Array<ListArgs> {
  return getListMock.mock.calls.map((call: [ListArgs]) => {
    return call[0];
  });
}

beforeEach(() => {
  getListMock.mockReset();
  failReads = null;
  podExceptions = [
    // 05:13:08.400: in the second the read covers, before the window.
    { offsetMs: -200, message: "Job Backup-RunBackups is locked" },
    { offsetMs: -60, message: "Job Usage-Report is locked" },
    { offsetMs: 1.4, message: "Job EnterpriseLicense could not be removed" },
    { offsetMs: 80, message: "Job Cleanup could not be removed" },
  ];

  getListMock.mockImplementation(async (args: ListArgs) => {
    if (failReads) {
      throw new HTTPErrorResponse(500, { message: failReads }, {});
    }

    const window: InBetween<Date> = args.query[
      "time"
    ] as unknown as InBetween<Date>;
    // The store compares the `time` it kept, to the second.
    const rows: Array<ExceptionInstance> = podExceptions
      .map(toException)
      .filter((exception: ExceptionInstance) => {
        const time: number = (exception.time as Date).getTime();
        return (
          args.query["k8sPodEntityKey"] === POD &&
          time >= window.startValue.getTime() &&
          time <= window.endValue.getTime()
        );
      });

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

function renderPodExceptions(overrides: Partial<ComponentProps> = {}): void {
  render(
    <SpanPodExceptions
      podEntityKey={POD}
      podName="oneuptime-app-5b9df8b796-6m5pk"
      startTimeUnixNano={SPAN_START}
      endTimeUnixNano={SPAN_END}
      hasLinkedExceptions={false}
      {...overrides}
    />,
  );
}

describe("an eBPF span, whose exceptions carry no trace ID", () => {
  test("opens on what its pod raised around it, placed by the exact instant, labelled as not linked", async () => {
    renderPodExceptions();

    expect(
      screen.getByText("No exceptions carry this span's ID."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("span-pod-exceptions-toggle")).toHaveTextContent(
      "Exceptions from this pod during this span (not linked by trace ID)",
    );
    expect(screen.getByTestId("span-pod-exceptions-window")).toHaveTextContent(
      "Exceptions oneuptime-app-5b9df8b796-6m5pk recorded from 100 ms before this span to 100 ms after it. A pod serves many requests at once, so some of these exceptions may belong to other requests.",
    );

    await screen.findByTestId("span-pod-exception-list");

    const before: HTMLElement = screen.getByTestId(
      "span-pod-exceptions-before",
    );
    const during: HTMLElement = screen.getByTestId(
      "span-pod-exceptions-during",
    );
    const after: HTMLElement = screen.getByTestId("span-pod-exceptions-after");
    expect(before).toHaveTextContent("Before the span");
    expect(before).toHaveTextContent("Job Usage-Report is locked");
    expect(before).toHaveTextContent("-60 ms");
    expect(during).toHaveTextContent(
      "Job EnterpriseLicense could not be removed",
    );
    expect(during).toHaveTextContent("+1.4 ms");
    expect(after).toHaveTextContent("Job Cleanup could not be removed");
    expect(after).toHaveTextContent("+80 ms");

    // Read back with the rest of its second, but outside the window.
    expect(
      screen.queryByText("Job Backup-RunBackups is locked"),
    ).not.toBeInTheDocument();

    // Each one links to its group and shows its stack trace.
    expect(
      within(during).getByRole("link", { name: "View exception" }),
    ).toHaveAttribute("href", expect.stringContaining(FINGERPRINT));
    expect(within(during).getByText("Stack trace")).toBeInTheDocument();
  });

  test("the read: the pod's own key over the window widened to whole seconds, oldest first", async () => {
    renderPodExceptions();
    await screen.findByTestId("span-pod-exception-list");

    const [read] = reads();
    expect(reads()).toHaveLength(1);
    expect(read!.modelType).toBe(ExceptionInstance);
    expect(read!.query["k8sPodEntityKey"]).toBe(POD);
    expect(read!.query["traceId"]).toBeUndefined();
    // 05:13:08.500 to about 05:13:08.70, widened to 05:13:08 - 05:13:09.
    expect(read!.query["time"]).toEqual(
      new InBetween<Date>(
        new Date(Date.UTC(2026, 9, 27, 5, 13, 8)),
        new Date(Date.UTC(2026, 9, 27, 5, 13, 9)),
      ),
    );
    expect(read!.sort).toEqual({ time: SortOrder.Ascending });
    expect(read!.limit).toBe(100);
    expect(Object.keys(read!.select!).sort()).toEqual(
      [
        "_id",
        "exceptionType",
        "fingerprint",
        "message",
        "stackTrace",
        "time",
        "timeUnixNano",
      ].sort(),
    );
  });
});

describe("a span with exceptions of its own", () => {
  test("keeps the pod's exceptions folded and unread until opened", async () => {
    renderPodExceptions({ hasLinkedExceptions: true });

    expect(
      screen.queryByText("No exceptions carry this span's ID."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("span-pod-exceptions-toggle")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(reads()).toHaveLength(0);

    fireEvent.click(screen.getByTestId("span-pod-exceptions-toggle"));

    expect(
      await screen.findByText("Job EnterpriseLicense could not be removed"),
    ).toBeInTheDocument();
    expect(reads()).toHaveLength(1);
  });
});

describe("what else the section can say", () => {
  test("a pod that raised nothing in the window says so", async () => {
    podExceptions = [{ offsetMs: -200, message: "outside the window" }];
    renderPodExceptions();

    expect(
      await screen.findByText("The pod recorded no exceptions in this window."),
    ).toBeInTheDocument();
  });

  test("a read the server refused says why", async () => {
    failReads = "Exceptions could not be read.";
    renderPodExceptions();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Exceptions could not be read.",
    );
  });

  test("a read that came back full says it may not show them all", async () => {
    podExceptions = [];
    for (let index: number = 0; index < 120; index++) {
      podExceptions.push({
        offsetMs: index * 0.01,
        message: `failure ${index}`,
      });
    }
    renderPodExceptions();
    await screen.findByTestId("span-pod-exception-list");

    expect(
      screen.getByText(
        "Only the first 100 exceptions of this window are shown.",
      ),
    ).toBeInTheDocument();
  });
});
