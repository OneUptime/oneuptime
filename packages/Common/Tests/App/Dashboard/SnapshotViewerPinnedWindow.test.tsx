import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105: the investigation drawer's companion Traces and Exceptions
 * tabs are explorers pinned to the drawer's window. A zoom made on the
 * drawer's log chart (which sits above the tabs) moves that window while a
 * tab is open, so the explorer must follow a NEW pin the way the logs
 * explorer already did - and must not refetch, or undo a zoom the reader
 * made inside it, when the host merely rebuilds an equal query.
 *
 * The real viewers are rendered with the telemetry shell replaced by a probe
 * that records what it is handed, against mocked APIs.
 */

type ShellProps = {
  timeRange: {
    range: string;
    startAndEndDate?: { startValue: Date; endValue: Date };
  };
  onHistogramTimeRangeSelect?: (startTime: Date, endTime: Date) => void;
};

const shellProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: ShellProps) => {
      shellProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";

const FIRST_START: string = "2026-08-20T10:00:00.000Z";
const FIRST_END: string = "2026-08-20T10:15:00.000Z";
const SECOND_START: string = "2026-08-20T10:03:00.000Z";
const SECOND_END: string = "2026-08-20T10:05:00.000Z";

function between(startIso: string, endIso: string): InBetween<Date> {
  return new InBetween<Date>(new Date(startIso), new Date(endIso));
}

function shellWindow(): string {
  const calls: Array<Array<unknown>> = shellProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const props: ShellProps = calls[calls.length - 1]![0] as ShellProps;
  expect(props.timeRange.range).toBe(TimeRange.CUSTOM);
  return `${props.timeRange.startAndEndDate!.startValue.toISOString()}..${props.timeRange.startAndEndDate!.endValue.toISOString()}`;
}

function lastShellProps(): ShellProps {
  const calls: Array<Array<unknown>> = shellProbe.mock.calls;
  return calls[calls.length - 1]![0] as ShellProps;
}

function lastHistogramWindow(path: string): string {
  const requests: Array<Record<string, unknown>> = postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { url: { toString: () => string }; data: any };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: any }) => {
      return args.data as Record<string, unknown>;
    });
  expect(requests.length).toBeGreaterThan(0);
  const last: Record<string, unknown> = requests[requests.length - 1]!;
  return `${last["startTime"]}..${last["endTime"]}`;
}

interface ViewerCase {
  name: string;
  histogramPath: string;
  element: (window: InBetween<Date>) => React.ReactElement;
}

const CASES: Array<ViewerCase> = [
  {
    name: "the traces explorer",
    histogramPath: "/telemetry/traces/histogram",
    element: (window: InBetween<Date>): React.ReactElement => {
      return (
        <TracesViewer
          spanQuery={{ startTime: window } as any}
          limit={10}
          disableUrlSync={true}
        />
      );
    },
  },
  {
    name: "the exceptions explorer",
    histogramPath: "/telemetry/exceptions/histogram",
    element: (window: InBetween<Date>): React.ReactElement => {
      return (
        <ExceptionsViewer
          exceptionInstanceQuery={{ time: window } as any}
          limit={10}
          disableUrlSync={true}
        />
      );
    },
  },
];

beforeEach(() => {
  shellProbe.mockReset();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async () => {
    return { data: {} };
  });
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe.each(CASES)(
  "$name pinned to a host's window",
  (viewerCase: ViewerCase) => {
    test("starts on the pinned window", async () => {
      await act(async () => {
        render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      expect(shellWindow()).toBe(`${FIRST_START}..${FIRST_END}`);
      await waitFor(() => {
        expect(lastHistogramWindow(viewerCase.histogramPath)).toBe(
          `${FIRST_START}..${FIRST_END}`,
        );
      });
    });

    test("follows a new pinned window, chart request included", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        rendered!.rerender(
          viewerCase.element(between(SECOND_START, SECOND_END)),
        );
      });

      expect(shellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
      await waitFor(() => {
        expect(lastHistogramWindow(viewerCase.histogramPath)).toBe(
          `${SECOND_START}..${SECOND_END}`,
        );
      });
    });

    test("an equal but rebuilt pin does not undo a zoom the reader made inside", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        lastShellProps().onHistogramTimeRangeSelect!(
          new Date("2026-08-20T10:07:00.000Z"),
          new Date("2026-08-20T10:08:00.000Z"),
        );
      });
      expect(shellWindow()).toBe(
        "2026-08-20T10:07:00.000Z..2026-08-20T10:08:00.000Z",
      );

      // The host re-renders with a NEW query object for the SAME window.
      await act(async () => {
        rendered!.rerender(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      expect(shellWindow()).toBe(
        "2026-08-20T10:07:00.000Z..2026-08-20T10:08:00.000Z",
      );
    });

    test("a new pin after a zoom inside still wins: the host moved", async () => {
      let rendered: ReturnType<typeof render> | null = null;
      await act(async () => {
        rendered = render(viewerCase.element(between(FIRST_START, FIRST_END)));
      });

      await act(async () => {
        lastShellProps().onHistogramTimeRangeSelect!(
          new Date("2026-08-20T10:07:00.000Z"),
          new Date("2026-08-20T10:08:00.000Z"),
        );
      });

      await act(async () => {
        rendered!.rerender(
          viewerCase.element(between(SECOND_START, SECOND_END)),
        );
      });

      expect(shellWindow()).toBe(`${SECOND_START}..${SECOND_END}`);
    });
  },
);
