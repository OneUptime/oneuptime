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
 * A queue's Traces and Metrics tabs, rendered for real with the viewers
 * replaced by markers. What they must get right:
 *
 *   - the viewer is scoped by EXACTLY the queue's one key — built from its
 *     queueIdentifier (the identity family ingest keys telemetry on), never
 *     from its specific messagingSystem — and by nothing else: no attribute
 *     filter, no service scope;
 *   - the key's locked chip names the queue, not a hash;
 *   - a row whose identifier does not parse, or a page with no project, has
 *     no key: the "no telemetry scope" banner renders and NO viewer is
 *     mounted (an unscoped viewer shows the whole project);
 *   - loading, a failed lookup and a missing row (the API's empty model)
 *     render their own states;
 *   - the viewer renders bare, straight into the page — the rule every
 *     resource's telemetry tab follows;
 *   - the Metrics tab charts a clicked metric in place, under the queue's
 *     key (the explorer would chart it across every queue), and a curated
 *     broker metric's row reads as its Broker health tile does.
 */

const MODEL_ID_STRING: string = "84858d6c-2222-4aaa-8bbb-000000000001";
const PROJECT_ID_STRING: string = "10000000-0000-4000-8000-000000000002";

// What ProjectUtil.getCurrentProjectId returns; null for "no project".
let mockCurrentProjectId: string | null = PROJECT_ID_STRING;

const getItemMock: MockFunction = getJestMockFunction();
const tracesViewerMock: MockFunction = getJestMockFunction();
const metricsViewerMock: MockFunction = getJestMockFunction();
const metricChartMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

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

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricChartModal",
  () => {
    return {
      __esModule: true,
      default: (props: { metricName: string; onClose: () => void }) => {
        metricChartMock(props);
        return (
          <div data-testid="message-queue-metric-chart-modal">
            {props.metricName}
            <button onClick={props.onClose}>Close chart</button>
          </div>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (position?: number) => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        // The tabs sit one segment below the queue's id.
        return new ObjectIDType(
          position === 1
            ? "84858d6c-2222-4aaa-8bbb-000000000001"
            : "00000000-0000-4000-8000-00000000dead",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return mockCurrentProjectId
          ? new ObjectIDType(mockCurrentProjectId)
          : null;
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        tracesViewerMock(props);
        return <div data-testid="traces-viewer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        metricsViewerMock(props);
        return <div data-testid="metrics-viewer" />;
      },
    };
  },
);

import MessageQueueTraces from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Traces";
import MessageQueueMetrics, {
  toMessageQueueMetricRowValueOverrides,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { MESSAGE_QUEUE_NOT_FOUND_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import { MESSAGE_QUEUE_UNSCOPED_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueUnscopedBanner";
import { MetricRowValueOverrideMap } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";
import { MessageQueueMetricListValue } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/queues/test/traces"),
  currentProject: null,
  hasPaymentMethod: true,
};

function messageQueue(data: {
  queueIdentifier?: string | undefined;
  messagingSystem?: string | undefined;
  name?: string | undefined;
  withoutProject?: boolean | undefined;
}): MessageQueue {
  const item: MessageQueue = new MessageQueue();
  item.id = new ObjectID(MODEL_ID_STRING);
  item.name = data.name ?? "orders";
  if (!data.withoutProject) {
    item.projectId = new ObjectID(PROJECT_ID_STRING);
  }
  item.queueIdentifier = data.queueIdentifier ?? "kafka||orders";
  item.messagingSystem = data.messagingSystem ?? "kafka";
  return item;
}

type ViewerProps = Record<string, unknown>;

function lastProps(mock: MockFunction): ViewerProps {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ViewerProps;
}

interface TabCase {
  Page: React.FunctionComponent<PageComponentProps>;
  viewerTestId: string;
  viewerMock: MockFunction;
}

const TABS: Array<[string, TabCase]> = [
  [
    "Traces",
    {
      Page: MessageQueueTraces,
      viewerTestId: "traces-viewer",
      viewerMock: tracesViewerMock,
    },
  ],
  [
    "Metrics",
    {
      Page: MessageQueueMetrics,
      viewerTestId: "metrics-viewer",
      viewerMock: metricsViewerMock,
    },
  ],
];

const KAFKA_ORDERS_KEY: string = keyForMessageQueue(PROJECT_ID_STRING, {
  system: "kafka",
  brokerScope: "",
  destination: "orders",
});

beforeEach(() => {
  getItemMock.mockReset();
  tracesViewerMock.mockReset();
  metricsViewerMock.mockReset();
  metricChartMock.mockReset();
  aggregateMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
  mockCurrentProjectId = PROJECT_ID_STRING;
});

afterEach(() => {
  cleanup();
});

describe.each(TABS)("the queue's %s tab", (_name: string, tab: TabCase) => {
  test("scopes the viewer by exactly the queue's key, and nothing else", async () => {
    getItemMock.mockResolvedValue(messageQueue({}));

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tab.viewerTestId);

    const props: ViewerProps = lastProps(tab.viewerMock);
    expect(props["entityKeysFilter"]).toEqual([KAFKA_ORDERS_KEY]);
    expect(props["attributeFilters"]).toBeUndefined();
    expect(props["serviceIds"]).toBeUndefined();
    expect(props["entityScope"]).toBeUndefined();
    expect(props["entityKeyDisplays"]).toEqual({
      [KAFKA_ORDERS_KEY]: {
        displayKey: "Queue",
        displayValue: "orders (Apache Kafka)",
      },
    });
    // Rendered once, with no banner beside it.
    expect(screen.getAllByTestId(tab.viewerTestId)).toHaveLength(1);
    expect(
      screen.queryByTestId("message-queue-unscoped-banner"),
    ).not.toBeInTheDocument();
  });

  test("reads the row it scopes by, by the tab's own id, and only what the scope needs", async () => {
    getItemMock.mockResolvedValue(messageQueue({}));

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tab.viewerTestId);

    expect(getItemMock).toHaveBeenCalledTimes(1);
    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };
    expect(request.modelType).toBe(MessageQueue);
    expect(request.id.toString()).toBe(MODEL_ID_STRING);
    expect(request.select).toEqual({
      name: true,
      projectId: true,
      queueIdentifier: true,
      messagingSystem: true,
    });
  });

  test("an ActiveMQ queue is scoped by its JMS family key, named by its broker", async () => {
    getItemMock.mockResolvedValue(
      messageQueue({
        queueIdentifier: "jms||orders",
        messagingSystem: "activemq",
      }),
    );

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tab.viewerTestId);

    const familyKey: string = keyForMessageQueue(PROJECT_ID_STRING, {
      system: "jms",
      brokerScope: "",
      destination: "orders",
    });
    const props: ViewerProps = lastProps(tab.viewerMock);
    expect(props["entityKeysFilter"]).toEqual([familyKey]);
    expect(props["entityKeysFilter"]).not.toContain(
      keyForMessageQueue(PROJECT_ID_STRING, {
        system: "activemq",
        brokerScope: "",
        destination: "orders",
      }),
    );
    expect(
      (props["entityKeyDisplays"] as Record<string, { displayValue: string }>)[
        familyKey
      ]!.displayValue,
    ).toBe("orders (Apache ActiveMQ)");
  });

  test("a Service Bus queue's key carries its namespace", async () => {
    getItemMock.mockResolvedValue(
      messageQueue({
        queueIdentifier: "servicebus|orders-prod|orders",
        messagingSystem: "servicebus",
      }),
    );

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tab.viewerTestId);

    expect(lastProps(tab.viewerMock)["entityKeysFilter"]).toEqual([
      keyForMessageQueue(PROJECT_ID_STRING, {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ]);
  });

  test("an identifier that does not parse mounts no viewer: the banner says why", async () => {
    getItemMock.mockResolvedValue(
      messageQueue({ queueIdentifier: "not-an-identifier" }),
    );

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId("message-queue-unscoped-banner");

    expect(screen.getByText(MESSAGE_QUEUE_UNSCOPED_TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId(tab.viewerTestId)).not.toBeInTheDocument();
    expect(tab.viewerMock).not.toHaveBeenCalled();
  });

  test("no project to hash the key with mounts no viewer either", async () => {
    mockCurrentProjectId = null;
    getItemMock.mockResolvedValue(messageQueue({ withoutProject: true }));

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId("message-queue-unscoped-banner");

    expect(tab.viewerMock).not.toHaveBeenCalled();
  });

  test("a row without its project falls back to the current project", async () => {
    getItemMock.mockResolvedValue(messageQueue({ withoutProject: true }));

    render(<tab.Page {...PAGE_PROPS} />);
    await screen.findByTestId(tab.viewerTestId);

    expect(lastProps(tab.viewerMock)["entityKeysFilter"]).toEqual([
      KAFKA_ORDERS_KEY,
    ]);
  });

  test("a deleted or unknown id (the API's empty model) is 'Queue not found.'", async () => {
    getItemMock.mockResolvedValue(new MessageQueue());

    render(<tab.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
    );
    expect(tab.viewerMock).not.toHaveBeenCalled();
  });

  test("a null answer is 'Queue not found.' too", async () => {
    getItemMock.mockResolvedValue(null);

    render(<tab.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
    );
  });

  test("a failed lookup shows its error and mounts no viewer", async () => {
    getItemMock.mockRejectedValue(new Error("Permission denied"));

    render(<tab.Page {...PAGE_PROPS} />);

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Permission denied",
    );
    expect(tab.viewerMock).not.toHaveBeenCalled();
  });

  test("shows the page loader while the row loads", () => {
    getItemMock.mockReturnValue(new Promise<never>(() => {}));

    render(<tab.Page {...PAGE_PROPS} />);

    expect(screen.getByTestId("page-loader")).toBeInTheDocument();
    expect(tab.viewerMock).not.toHaveBeenCalled();
  });
});

describe("the tabs hand the viewer stable scope values", () => {
  test.each(TABS)(
    "%s: a re-render keeps the same key array and chip map",
    async (_name: string, tab: TabCase) => {
      getItemMock.mockResolvedValue(messageQueue({}));

      const view: ReturnType<typeof render> = render(
        <tab.Page {...PAGE_PROPS} />,
      );
      await screen.findByTestId(tab.viewerTestId);
      const first: ViewerProps = lastProps(tab.viewerMock);

      view.rerender(<tab.Page {...PAGE_PROPS} />);
      const second: ViewerProps = lastProps(tab.viewerMock);

      // The viewers key their query and chip memos on these identities.
      expect(second["entityKeysFilter"]).toBe(first["entityKeysFilter"]);
      expect(second["entityKeyDisplays"]).toBe(first["entityKeyDisplays"]);
    },
  );
});

describe("the queue's Metrics tab", () => {
  function metricType(name: string, unit?: string): MetricType {
    const metric: MetricType = new MetricType();
    metric.name = name;
    if (unit) {
      metric.unit = unit;
    }
    return metric;
  }

  test("a row click charts the metric in place, under the queue's key, on the list's range", async () => {
    getItemMock.mockResolvedValue(
      messageQueue({
        queueIdentifier: "jms||orders",
        messagingSystem: "activemq",
      }),
    );

    render(<MessageQueueMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const props: ViewerProps = lastProps(metricsViewerMock);
    // The list's range, as the reader changes it.
    act(() => {
      (props["onTimeRangeChange"] as (range: { range: string }) => void)({
        range: "Past 1 Day",
      });
    });
    act(() => {
      (props["onMetricClick"] as (metric: MetricType) => void)(
        metricType(" activemq.message.queue.size ", "{messages}"),
      );
    });

    expect(
      await screen.findByTestId("message-queue-metric-chart-modal"),
    ).toHaveTextContent("activemq.message.queue.size");
    const chart: ViewerProps = lastProps(metricChartMock);
    const familyKey: string = keyForMessageQueue(PROJECT_ID_STRING, {
      system: "jms",
      brokerScope: "",
      destination: "orders",
    });
    expect(chart["metricName"]).toBe("activemq.message.queue.size");
    expect(chart["unit"]).toBe("{messages}");
    expect(chart["keys"]).toEqual([familyKey]);
    expect(String(chart["projectId"])).toBe(PROJECT_ID_STRING);
    // The specific system picks the catalog; the family identity the monitor.
    expect(chart["messagingSystem"]).toBe("activemq");
    expect(chart["identity"]).toEqual({
      system: "jms",
      brokerScope: "",
      destination: "orders",
    });
    expect(chart["queueName"]).toBe("orders");
    expect(chart["initialTimeRange"]).toEqual({ range: "Past 1 Day" });

    fireEvent.click(screen.getByText("Close chart"));
    expect(screen.queryByTestId("message-queue-metric-chart-modal")).toBeNull();
  });

  test("a row without a name opens nothing", async () => {
    getItemMock.mockResolvedValue(messageQueue({}));

    render(<MessageQueueMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    act(() => {
      (
        lastProps(metricsViewerMock)["onMetricClick"] as (
          metric: MetricType,
        ) => void
      )(metricType("  "));
    });
    expect(screen.queryByTestId("message-queue-metric-chart-modal")).toBeNull();
  });

  test("a curated broker metric's row reads as its Broker health tile; any other keeps the list's value", async () => {
    getItemMock.mockResolvedValue(
      messageQueue({
        queueIdentifier: "rabbitmq||orders",
        messagingSystem: "rabbitmq",
      }),
    );
    aggregateMock.mockResolvedValue({
      data: [
        {
          timestamp: new Date("2026-09-24T10:00:00.000Z"),
          value: 10,
          attributes: { state: "ready" },
        },
        {
          timestamp: new Date("2026-09-24T10:00:00.000Z"),
          value: 5,
          attributes: { state: "unacknowledged" },
        },
      ],
    });

    render(<MessageQueueMetrics {...PAGE_PROPS} />);
    await screen.findByTestId("metrics-viewer");

    const props: ViewerProps = lastProps(metricsViewerMock);
    expect(props["defaultRowValueCaption"]).toBe("average of series");
    const overrides: MetricRowValueOverrideMap = await (
      props["fetchRowValueOverrides"] as (data: {
        metricNames: Array<string>;
        startAndEndDate: InBetween<Date>;
      }) => Promise<MetricRowValueOverrideMap>
    )({
      metricNames: [
        "rabbitmq.message.current",
        "messaging.client.sent.messages",
      ],
      startAndEndDate: new InBetween<Date>(
        new Date("2026-09-24T09:00:00.000Z"),
        new Date("2026-09-24T11:00:00.000Z"),
      ),
    });

    expect(Array.from(overrides.keys())).toEqual(["rabbitmq.message.current"]);
    expect(overrides.get("rabbitmq.message.current")).toEqual({
      points: [{ time: "2026-09-24T10:00:00.000Z", value: 15 }],
      value: 15,
      valueSuffix: undefined,
      caption: "total of series",
    });
    // Only the curated name was read, under the queue's key.
    expect(aggregateMock).toHaveBeenCalledTimes(1);
    const request: { aggregateBy: { query: Record<string, unknown> } } =
      aggregateMock.mock.calls[0]![0] as {
        aggregateBy: { query: Record<string, unknown> };
      };
    expect(request.aggregateBy.query["name"]).toBe("rabbitmq.message.current");
    expect(
      (request.aggregateBy.query["entityKeys"] as Includes).values,
    ).toEqual([
      keyForMessageQueue(PROJECT_ID_STRING, {
        system: "rabbitmq",
        brokerScope: "",
        destination: "orders",
      }),
    ]);
  });

  test("a counter's row reads per second", () => {
    const published: MessageQueueMetricDescriptor =
      getMessageQueueMetricDescriptorsByName("rabbitmq.message.published")[0]!;
    const values: Map<string, MessageQueueMetricListValue> = new Map([
      [
        "rabbitmq.message.published",
        {
          descriptor: published,
          points: [{ x: new Date("2026-09-24T10:01:00.000Z"), y: 2.5 }],
          value: 2.5,
          isRate: true,
        },
      ],
    ]);

    expect(
      toMessageQueueMetricRowValueOverrides(values).get(
        "rabbitmq.message.published",
      ),
    ).toEqual({
      points: [{ time: "2026-09-24T10:01:00.000Z", value: 2.5 }],
      value: 2.5,
      valueSuffix: "/s",
      caption: "per second, all series",
    });
  });
});
