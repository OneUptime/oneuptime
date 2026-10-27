import "@testing-library/jest-dom";
import {
  act,
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
import SpanDetailsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * The traces list's span panel for an eBPF span: no log carries the span's
 * ID or its trace's, so the Logs tab shows what the span's pod wrote around
 * it, read by pod and time once the panel's own reads have answered. The
 * list row is light - the pod and the exact times come with the full span.
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
      getFriendlyMessage: (): string => {
        return "Failed";
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
const TRACE_ID: string = "1e8f0c2a9b7d4e6f8a1b2c3d4e5f6a7b";
const SPAN_ID: string = "9e3779b1f281be04";
const POD: string = "7a2872b83f046399";
const START_MS: number = Date.UTC(2026, 9, 27, 8, 2, 9, 232);

let linkedReadsGate: Promise<void> = Promise.resolve();

function rowSpan(): Span {
  // What the traces list selects: no pod, and times to the second.
  return Object.assign(new Span(), {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "POST /*/v1/traces",
    kind: SpanKind.Server,
    statusCode: SpanStatus.Ok,
    startTime: new Date(START_MS - 232),
    endTime: new Date(START_MS - 232),
    durationUnixNano: 3_462_700,
  });
}

function fullSpan(): Span {
  return Object.assign(new Span(), {
    attributes: { "resource.k8s.pod.name": "oneuptime-app-5b9df8b796-88bzt" },
    events: [],
    statusMessage: "",
    sessionId: "",
    k8sPodEntityKey: POD,
    startTimeUnixNano: START_MS * MS,
    endTimeUnixNano: START_MS * MS + 3_462_700,
  });
}

function podLine(offsetMs: number, body: string, index: number): Log {
  return Object.assign(new Log(), {
    _id: new ObjectID(
      `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    ),
    time: new Date(START_MS + Math.floor(offsetMs)),
    timeUnixNano: (START_MS + offsetMs) * MS,
    severityText: "Information",
    body,
  });
}

function logReads(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: [ListArgs]) => {
      return call[0];
    })
    .filter((args: ListArgs) => {
      return args.modelType === Log;
    });
}

beforeEach(() => {
  getListMock.mockReset();
  linkedReadsGate = Promise.resolve();

  getListMock.mockImplementation(async (args: ListArgs) => {
    if (args.modelType === Span) {
      return { data: [fullSpan()], count: 1, skip: 0, limit: 1 };
    }

    // What the pod raised: extracted from a log line, time to the second.
    if (
      args.modelType === ExceptionInstance &&
      args.query["k8sPodEntityKey"] === POD
    ) {
      const exception: ExceptionInstance = Object.assign(
        new ExceptionInstance(),
        {
          time: new Date(Math.floor(START_MS / 1000) * 1000),
          timeUnixNano: (START_MS + 2) * MS,
          exceptionType: "Error",
          message: "Job EnterpriseLicense could not be removed",
          fingerprint: "9f86d081884c7d659a2feaa0c55ad015",
        },
      );
      return { data: [exception], count: 1, skip: 0, limit: args.limit };
    }

    if (args.query["k8sPodEntityKey"] === POD) {
      const window: InBetween<Date> = args.query[
        "time"
      ] as unknown as InBetween<Date>;
      const lines: Array<Log> = [
        podLine(-50, "Is Protobuf: false", 1),
        podLine(1.27, "Product Type: Traces", 2),
        podLine(3.24, "Added traces ingestion job", 3),
        podLine(60, "Product Type: Metrics", 4),
      ].filter((log: Log) => {
        const time: number = Number(log.timeUnixNano);
        return (
          time >= window.startValue.getTime() * MS &&
          time <= window.endValue.getTime() * MS
        );
      });
      return { data: lines, count: lines.length, skip: 0, limit: args.limit };
    }

    // No log carries the span's ID or the trace's.
    await linkedReadsGate;
    return { data: [], count: 0, skip: 0, limit: args.limit };
  });
});

afterEach(() => {
  cleanup();
});

async function openLogsTab(): Promise<void> {
  await act(async () => {
    render(<SpanDetailsPanel span={rowSpan()} />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Logs/ }));
  });
}

describe("an eBPF span in the traces list", () => {
  test("its Logs tab shows what its pod wrote around it, not linked by trace ID", async () => {
    await openLogsTab();

    const section: HTMLElement = await screen.findByTestId("span-pod-logs");
    expect(section).toHaveTextContent("No logs carry this span's ID.");
    expect(section).toHaveTextContent(
      "Logs from this pod during this span (not linked by trace ID)",
    );
    expect(
      await within(section).findByText("Product Type: Traces"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("span-pod-logs-window")).toHaveTextContent(
      "What oneuptime-app-5b9df8b796-88bzt wrote from 100 ms before this span to 100 ms after it.",
    );
    expect(
      within(screen.getByTestId("span-pod-logs-during")).getByText(
        "Added traces ingestion job",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("span-pod-logs-before")).getByText(
        "Is Protobuf: false",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("span-pod-logs-after")).getByText(
        "Product Type: Metrics",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No logs found for this span or its trace."),
    ).not.toBeInTheDocument();
  });

  test("the full span read asks for the pod and the exact times the row lacks", async () => {
    await openLogsTab();
    await screen.findByTestId("span-pod-logs");

    const detailRead: ListArgs = getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .find((args: ListArgs) => {
        return args.modelType === Span;
      })!;
    expect(Object.keys(detailRead.select!)).toEqual(
      expect.arrayContaining([
        "k8sPodEntityKey",
        "startTimeUnixNano",
        "endTimeUnixNano",
        "attributes",
      ]),
    );
  });

  test("the pod is read only once the span's and the trace's own logs have answered", async () => {
    let release: () => void = () => {};
    linkedReadsGate = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    await openLogsTab();

    // The span's read is in flight: nothing has asked for the pod yet.
    expect(
      logReads().filter((args: ListArgs) => {
        return Boolean(args.query["k8sPodEntityKey"]);
      }),
    ).toHaveLength(0);
    expect(screen.queryByTestId("span-pod-logs")).not.toBeInTheDocument();

    await act(async () => {
      release();
    });

    await screen.findByTestId("span-pod-logs");
    const reads: Array<ListArgs> = logReads();
    expect(
      reads.map((args: ListArgs) => {
        return args.query["k8sPodEntityKey"]
          ? "pod"
          : args.query["spanId"]
            ? "span"
            : "trace";
      }),
    ).toEqual(["span", "trace", "pod", "pod"]);
  });
});

describe("an eBPF span's exceptions in the traces list", () => {
  test("its Exceptions tab shows what its pod raised around it, once the span's own read has answered", async () => {
    await act(async () => {
      render(<SpanDetailsPanel span={rowSpan()} />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Exceptions/ }));
    });

    const section: HTMLElement = await screen.findByTestId(
      "span-pod-exceptions",
    );
    expect(section).toHaveTextContent("No exceptions carry this span's ID.");
    expect(section).toHaveTextContent(
      "Exceptions from this pod during this span (not linked by trace ID)",
    );
    expect(
      await within(section).findByText(
        "Job EnterpriseLicense could not be removed",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No exceptions were recorded on this span."),
    ).not.toBeInTheDocument();

    const exceptionReads: Array<string> = getListMock.mock.calls
      .map((call: [ListArgs]) => {
        return call[0];
      })
      .filter((args: ListArgs) => {
        return args.modelType === ExceptionInstance;
      })
      .map((args: ListArgs) => {
        return args.query["k8sPodEntityKey"] ? "pod" : "span";
      });
    expect(exceptionReads).toEqual(["span", "pod"]);
  });
});
