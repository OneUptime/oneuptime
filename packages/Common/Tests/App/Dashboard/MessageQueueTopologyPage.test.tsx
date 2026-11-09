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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Queues topology's page: the range it reads (the past hour unless
 * picked), a refresh, what it says while it loads, when it could not read,
 * and when a refresh failed with a map already on screen - and a queue's
 * Topology tab, which is the same page anchored on the queue in its URL.
 */

const mockFetch: MockFunction = getJestMockFunction();
const mockExplorer: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyApi",
  () => {
    return {
      fetchMessageQueueTopology: (window: { start: Date; end: Date }) => {
        return mockFetch(window);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyExplorer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        data: { queues: Array<unknown> };
        window: { start: Date; end: Date };
        anchorQueueId?: string;
      }) => {
        mockExplorer(props);
        return (
          <div data-testid="explorer">
            {props.data.queues.length} queues · anchor{" "}
            {props.anchorQueueId || "none"}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: { onChange: (value: unknown) => void }) => {
        const { default: Ranges } = jest.requireActual(
          "../../../Types/Time/TimeRange",
        ) as { default: { PAST_ONE_DAY: string } };
        return (
          <button
            data-testid="pick-range"
            onClick={() => {
              props.onChange({ range: Ranges.PAST_ONE_DAY });
            }}
          >
            pick
          </button>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1");
      },
      getQueryStringByName: () => {
        return null;
      },
      setQueryString: () => {},
    },
  };
});

import MessageQueueTopologyPage, {
  MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyPage";
import MessageQueueViewTopology from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Topology";
import MessageQueueTopology from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Topology";
import TimeRange from "../../../Types/Time/TimeRange";
import Route from "../../../Types/API/Route";

const ANSWER: Record<string, unknown> = {
  startTime: "2026-11-07T11:00:00.000Z",
  endTime: "2026-11-07T12:00:00.000Z",
  queues: [{ id: "q1" }, { id: "q2" }],
  services: [],
  flows: [],
  truncation: { queues: false, flows: false },
};

function deferred(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise: Promise<unknown> = new Promise<unknown>(
    (yes: (value: unknown) => void, no: (reason: unknown) => void) => {
      resolve = yes;
      reject = no;
    },
  );
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockExplorer.mockReset();
});

afterEach(() => {
  cleanup();
});

function show(element: React.ReactElement): void {
  render(<MemoryRouter>{element}</MemoryRouter>);
}

describe("the Queues topology page", () => {
  test("reads the past hour by default", () => {
    expect(MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE).toEqual({
      range: TimeRange.PAST_ONE_HOUR,
    });
  });

  test("says it is loading, then draws the answer for the range it read", async () => {
    const pending: ReturnType<typeof deferred> = deferred();
    mockFetch.mockReturnValue(pending.promise);
    show(<MessageQueueTopologyPage />);
    expect(
      screen.getByTestId("message-queue-topology-loading"),
    ).toHaveTextContent("Loading the message flow…");
    const window: { start: Date; end: Date } = mockFetch.mock.calls[0]![0] as {
      start: Date;
      end: Date;
    };
    expect(window.end.getTime() - window.start.getTime()).toBeGreaterThan(
      59 * 60 * 1000,
    );
    expect(window.end.getTime() - window.start.getTime()).toBeLessThanOrEqual(
      60 * 60 * 1000 + 1000,
    );
    await act(async () => {
      pending.resolve(ANSWER);
    });
    expect(screen.getByTestId("explorer")).toHaveTextContent(
      "2 queues · anchor none",
    );
    const props: { window: { start: Date; end: Date } } = mockExplorer.mock
      .calls[mockExplorer.mock.calls.length - 1]![0] as {
      window: { start: Date; end: Date };
    };
    expect(props.window).toEqual(window);
  });

  test("a read that fails says why, and Try again reads again", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ClickHouse is away"));
    show(<MessageQueueTopologyPage />);
    await waitFor(() => {
      expect(
        screen.getByTestId("message-queue-topology-error"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("message-queue-topology-error"),
    ).toHaveTextContent("ClickHouse is away");
    mockFetch.mockResolvedValueOnce(ANSWER);
    await act(async () => {
      fireEvent.click(screen.getByText("Try again"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("explorer")).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("a refresh that fails keeps the map it had, and says so", async () => {
    mockFetch.mockResolvedValueOnce(ANSWER);
    show(<MessageQueueTopologyPage />);
    await waitFor(() => {
      expect(screen.getByTestId("explorer")).toBeInTheDocument();
    });
    mockFetch.mockRejectedValueOnce(new Error("timeout"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("message-queue-topology-refresh"));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("message-queue-topology-refresh-failed"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("explorer")).toBeInTheDocument();
  });

  test("a new range is read, and an answer for the old one that lands late is dropped", async () => {
    const slow: ReturnType<typeof deferred> = deferred();
    mockFetch.mockReturnValueOnce(slow.promise);
    mockFetch.mockResolvedValueOnce({ ...ANSWER, queues: [{ id: "only" }] });
    show(<MessageQueueTopologyPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("pick-range"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("explorer")).toHaveTextContent("1 queues");
    });
    await act(async () => {
      slow.resolve(ANSWER);
    });
    expect(screen.getByTestId("explorer")).toHaveTextContent("1 queues");
    const window: { start: Date; end: Date } = mockFetch.mock.calls[1]![0] as {
      start: Date;
      end: Date;
    };
    expect(window.end.getTime() - window.start.getTime()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );
  });
});

describe("the pages", () => {
  test("Queues → Topology is the whole project's", async () => {
    mockFetch.mockResolvedValue(ANSWER);
    show(
      <MessageQueueTopology
        pageRoute={new Route("/dashboard/p/queues/topology")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("explorer")).toHaveTextContent("anchor none");
    });
  });

  test("a queue's Topology tab is anchored on the queue of its URL", async () => {
    mockFetch.mockResolvedValue(ANSWER);
    show(
      <MessageQueueViewTopology
        pageRoute={new Route("/dashboard/p/queues/x/topology")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("explorer")).toHaveTextContent(
        "anchor 5d9e2c11-7a3b-4c1d-9e8f-00000000a0b1",
      );
    });
  });
});
