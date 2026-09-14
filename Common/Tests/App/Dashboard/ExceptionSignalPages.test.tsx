import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import ExceptionOccurrences from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrences";
import ExceptionLogs from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionLogs";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The Occurrences and Logs pages host the platform's own Traces and Logs
 * explorers. What matters here is the scope they hand those explorers, so the
 * explorers are replaced by recorders.
 */

type Props = Record<string, unknown>;

const tracesViewerProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();
const logsViewerProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();
const occurrenceTableProps: Mock<(props: Props) => void> =
  jest.fn<(props: Props) => void>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        tracesViewerProps(props);
        return <div data-testid="traces-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        logsViewerProps(props);
        return <div data-testid="logs-viewer" data-id={String(props["id"])} />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/OccuranceTable",
  () => {
    return {
      __esModule: true,
      default: (props: Props) => {
        occurrenceTableProps(props);
        return <div data-testid="occurrence-table" />;
      },
    };
  },
);

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

const FINGERPRINT: string = "9f86d081884c7d659a2feaa0c55ad015";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

function lastProps(mock: Mock<(props: Props) => void>): Props {
  const calls: Array<[Props]> = mock.mock.calls;
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  tracesViewerProps.mockReset();
  logsViewerProps.mockReset();
  occurrenceTableProps.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ExceptionOccurrences", () => {
  function exceptionWith(values: Partial<TelemetryException>): TelemetryException {
    const exception: TelemetryException = new TelemetryException();
    Object.assign(exception, {
      exceptionType: "InventoryReservationError",
      fingerprint: FINGERPRINT,
      primaryEntityId: new ObjectID(SERVICE_ID),
      primaryEntityType: ServiceType.OpenTelemetry,
      lastSeenAt: new Date(Date.now() - 4 * MINUTE),
      ...values,
    });
    return exception;
  }

  test("opens on the span list scoped to exactly this exception", () => {
    render(
      <ExceptionOccurrences
        exception={exceptionWith({})}
        fingerprint={FINGERPRINT}
      />,
    );

    expect(screen.getByTestId("traces-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("occurrence-table")).not.toBeInTheDocument();

    const props: Props = lastProps(tracesViewerProps);
    expect(props["exceptionScope"]).toEqual({
      fingerprint: FINGERPRINT,
      primaryEntityId: SERVICE_ID,
    });
    expect(props["exceptionScopeLabel"]).toBe("InventoryReservationError");
    expect(String(props["primaryEntityId"])).toBe(SERVICE_ID);
    expect(props["scopeEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(props["disableUrlSync"]).toBe(true);
    expect(props["timeRangeOverride"]).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });
    expect(typeof props["onTimeRangeChange"]).toBe("function");
  });

  test("an older exception opens on a window that still contains it", () => {
    render(
      <ExceptionOccurrences
        exception={exceptionWith({ lastSeenAt: new Date(Date.now() - 3 * DAY) })}
        fingerprint={FINGERPRINT}
      />,
    );

    expect(lastProps(tracesViewerProps)["timeRangeOverride"]).toEqual({
      range: TimeRange.PAST_ONE_WEEK,
    });
  });

  test("keeps the window the user picks in the span list", () => {
    render(
      <ExceptionOccurrences
        exception={exceptionWith({})}
        fingerprint={FINGERPRINT}
      />,
    );

    const onTimeRangeChange: (range: unknown) => void = lastProps(
      tracesViewerProps,
    )["onTimeRangeChange"] as (range: unknown) => void;

    React.act(() => {
      onTimeRangeChange({ range: TimeRange.PAST_ONE_MONTH });
    });

    expect(lastProps(tracesViewerProps)["timeRangeOverride"]).toEqual({
      range: TimeRange.PAST_ONE_MONTH,
    });
  });

  test("omits the service for an unattributed exception", () => {
    render(
      <ExceptionOccurrences
        exception={exceptionWith({
          primaryEntityId: undefined,
          primaryEntityType: undefined,
          exceptionType: undefined,
        })}
        fingerprint={FINGERPRINT}
      />,
    );

    const props: Props = lastProps(tracesViewerProps);
    expect(props["exceptionScope"]).toEqual({ fingerprint: FINGERPRINT });
    expect(props).not.toHaveProperty("primaryEntityId");
    expect(props["exceptionScopeLabel"]).toBe("This exception");
  });

  test("switches to the per-occurrence details table", () => {
    render(
      <ExceptionOccurrences
        exception={exceptionWith({})}
        fingerprint={FINGERPRINT}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-occurrences-view-details"));

    expect(screen.getByTestId("occurrence-table")).toBeInTheDocument();
    expect(screen.queryByTestId("traces-viewer")).not.toBeInTheDocument();
    expect(lastProps(occurrenceTableProps)["exceptionFingerprint"]).toBe(
      FINGERPRINT,
    );
    expect(
      screen.getByRole("heading", { name: "Occurrence details" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("exception-occurrences-view-spans"));
    expect(screen.getByTestId("traces-viewer")).toBeInTheDocument();
  });
});

describe("ExceptionLogs", () => {
  const occurredAt: Date = new Date(Date.now() - 60 * MINUTE);

  function occurrence(values: Partial<ExceptionInstance>): ExceptionInstance {
    const instance: ExceptionInstance = new ExceptionInstance();
    Object.assign(instance, {
      traceId: TRACE_ID,
      primaryEntityId: new ObjectID(SERVICE_ID),
      time: occurredAt,
      ...values,
    });
    return instance;
  }

  test("shows the latest trace's logs, pinned around the occurrence", () => {
    render(
      <ExceptionLogs
        isLoading={false}
        instance={occurrence({})}
        primaryEntityType={ServiceType.OpenTelemetry}
      />,
    );

    const props: Props = lastProps(logsViewerProps);
    expect(props["id"]).toBe("exception-logs-trace");
    expect(props["traceIds"]).toEqual([TRACE_ID]);
    expect(props).not.toHaveProperty("serviceIds");
    expect(props["showFilters"]).toBe(true);

    const pinned: InBetween<Date> = (props["logQuery"] as {
      time: InBetween<Date>;
    }).time;
    expect(pinned.startValue.getTime()).toBe(occurredAt.getTime() - 5 * MINUTE);
    expect(pinned.endValue.getTime()).toBe(occurredAt.getTime() + 5 * MINUTE);

    expect(
      screen.getByTestId("exception-logs-scope-description"),
    ).toHaveTextContent("latest occurrence's trace");
  });

  test("can switch to everything the service logged around the occurrence", () => {
    render(
      <ExceptionLogs
        isLoading={false}
        instance={occurrence({})}
        primaryEntityType={ServiceType.OpenTelemetry}
      />,
    );

    fireEvent.click(screen.getByTestId("exception-logs-scope-service"));

    const props: Props = lastProps(logsViewerProps);
    expect(props["id"]).toBe("exception-logs-service");
    expect(props).not.toHaveProperty("traceIds");
    expect(
      (props["serviceIds"] as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([SERVICE_ID]);
    expect(props["scopeEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(screen.getByTestId("logs-viewer")).toHaveAttribute(
      "data-id",
      "exception-logs-service",
    );
  });

  test("uses the service scope alone when the occurrence has no trace", () => {
    render(
      <ExceptionLogs isLoading={false} instance={occurrence({ traceId: "" })} />,
    );

    expect(screen.queryByTestId("exception-logs-scope")).not.toBeInTheDocument();
    expect(lastProps(logsViewerProps)["id"]).toBe("exception-logs-service");
  });

  test("waits for the occurrence before mounting a viewer", () => {
    render(<ExceptionLogs isLoading={true} instance={undefined} />);

    expect(screen.getByText("Finding the latest occurrence…")).toBeInTheDocument();
    expect(logsViewerProps).not.toHaveBeenCalled();
  });

  test("explains why there are no logs when nothing can be correlated", () => {
    render(<ExceptionLogs isLoading={false} instance={undefined} />);

    expect(screen.getByTestId("exception-logs-empty")).toBeInTheDocument();
    expect(logsViewerProps).not.toHaveBeenCalled();
  });
});
