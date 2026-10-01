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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A queue's Overview, rendered for real — ResourceOverview, the Producers
 * and Consumers cards, the Broker health section — with the API answered
 * by a mock that reads each request the way the server would and the charts
 * replaced by markers. What it pins:
 *
 *   - every telemetry request is scoped by the queue's ONE entity key (built
 *     from its family identifier) and its project; an attribute filter only
 *     tells its spans apart (the operation they record, a batch's size);
 *   - the tiles read the spans by kind and operation
 *     (MessageQueueSpanPopulation; MessageQueueSpanPopulations pins which
 *     spans each group holds): Published = PRODUCER spans plus the client
 *     sends of services with none, Consumed = CONSUMER spans that handled
 *     messages, Errors = failed spans of any kind over all of them, p95
 *     processing time = ONE percentile of those consumer spans;
 *   - the charts are per interval; the cards group the spans by service, and
 *     an empty card says whether the queue had no span or none of its side;
 *   - Broker health reads the row's SPECIFIC system's catalog (an ActiveMQ
 *     row reads ActiveMQ's metrics under its JMS family key; a JMS row reads
 *     none and shows the JMS guidance), pooled on the server where the fold
 *     composes (Kafka's lag), and gives each gauge with data a Create monitor
 *     link filtered on its observed series; a Service Bus queue without a
 *     namespace, which its broker metrics never reach, is not offered their
 *     setup;
 *   - no key (an identifier that does not parse) is no request at all;
 *   - a slow, wider range never overwrites a newer one, and an auto-refresh
 *     tick never supersedes a load still running.
 */

const MODEL_ID_STRING: string = "5c1e0d2a-7b3c-4d5e-8f60-000000000123";
const PROJECT_ID_STRING: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const CHECKOUT_ID: string = "3c0e7b2a-1111-4111-8111-000000000001";
const BILLING_ID: string = "3c0e7b2a-1111-4111-8111-000000000002";
const MAILER_ID: string = "3c0e7b2a-1111-4111-8111-000000000003";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const chartCardMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

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
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("5c1e0d2a-7b3c-4d5e-8f60-000000000123");
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
        return new ObjectIDType("8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
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

// The picker, as buttons that pick a preset.
jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: {
        value?: { range?: string };
        onChange: (value: { range: string }) => void;
      }) => {
        return (
          <div data-testid="time-range-picker" data-range={props.value?.range}>
            <button
              onClick={() => {
                props.onChange({ range: "Past 1 Day" });
              }}
            >
              Pick past day
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onManualRefresh: () => void;
        timeRangePicker?: React.ReactElement;
      }) => {
        return (
          <div data-testid="auto-refresh">
            {props.timeRangePicker}
            <button onClick={props.onManualRefresh}>Refresh now</button>
          </div>
        );
      },
    };
  },
);

// The auto-refresh timer, as a callback a test calls for a tick.
let mockAutoRefreshTick: (() => void) | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: (options: { onRefresh: () => void }) => {
        mockAutoRefreshTick = options.onRefresh;
        return {
          autoRefreshInterval: "30s",
          setAutoRefreshInterval: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        chartCardMock(props);
        return (
          <div data-testid="chart-card" data-title={props.title}>
            {props.title}
          </div>
        );
      },
    };
  },
);

import MessageQueueOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { MESSAGE_QUEUE_NOT_FOUND_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import {
  BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON,
  BROKER_HEALTH_NO_DATA_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerHealthSection";
import { getMessageQueueServicesEmptyText } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueServicesCard";
import {
  MESSAGE_QUEUE_OBSERVED_SERIES_TTL_MS,
  MessageQueueObservedSeriesCache,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Service from "../../../Models/DatabaseModels/Service";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Route from "../../../Types/API/Route";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import ObjectID from "../../../Types/ObjectID";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/queues/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

const KAFKA_ORDERS_KEY: string = keyForMessageQueue(PROJECT_ID_STRING, {
  system: "kafka",
  brokerScope: "",
  destination: "orders",
});

const JMS_ORDERS_KEY: string = keyForMessageQueue(PROJECT_ID_STRING, {
  system: "jms",
  brokerScope: "",
  destination: "orders",
});

// ---- the backend ---------------------------------------------------------

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregationInterval?: AggregationInterval | undefined;
    groupBy?: Record<string, unknown> | undefined;
    groupByAttributeKeys?: Array<string> | undefined;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

// Twelve one-minute buckets, 30 to 19 minutes ago, inside any default window.
const NOW: number = Date.now();
const MINUTES: Array<Date> = Array.from(
  { length: 12 },
  (_: unknown, index: number): Date => {
    return new Date(
      Math.floor((NOW - (30 - index) * 60 * 1000) / 60000) * 60000,
    );
  },
);

type Rows = Array<Record<string, unknown>>;

function perMinute(value: number, extra?: Record<string, unknown>): Rows {
  return MINUTES.map((timestamp: Date): Record<string, unknown> => {
    return { timestamp: timestamp, value: value, ...(extra || {}) };
  });
}

interface ServiceSpans {
  id: string;
  count: number;
  errors: number;
  p95Ns: number;
}

/*
 * What the queue's spans and metrics are in one scenario. `scale` lets a
 * wider window hold more, so a test can tell which window's answer landed.
 */
interface Scenario {
  publishedPerMinute: number;
  consumedPerMinute: number;
  allPerMinute: number;
  errorsPerMinute: number;
  windowP95Ns: number | null;
  producers: Array<ServiceSpans>;
  consumers: Array<ServiceSpans>;
  // Per service: its client spans that record a send (the "send" group).
  sends?: Array<ServiceSpans> | undefined;
  // The "send" group's spans per minute, of the services in `sends`.
  sendsPerMinute?: number | undefined;
  // Metric name → the rows its chart query answers.
  metrics: Record<string, (request: AggregateRequest) => Rows>;
  // Metric name → the observed series (attributes) its monitor query sees.
  observed: Record<string, Array<Record<string, string>>>;
}

function kafkaScenario(): Scenario {
  return {
    publishedPerMinute: 10,
    consumedPerMinute: 9,
    allPerMinute: 25,
    errorsPerMinute: 1,
    windowP95Ns: 12_300_000,
    producers: [
      { id: CHECKOUT_ID, count: 100, errors: 0, p95Ns: 3_000_000 },
      { id: BILLING_ID, count: 20, errors: 2, p95Ns: 5_000_000 },
    ],
    consumers: [{ id: MAILER_ID, count: 108, errors: 4, p95Ns: 40_000_000 }],
    metrics: {
      "kafka.consumer_group.lag_sum": (request: AggregateRequest): Rows => {
        // Read per group, billing trails by 40 and shipping by 70.
        if (request.aggregateBy.groupByAttributeKeys) {
          return [
            ...perMinute(40, { attributes: { group: "billing" } }),
            ...perMinute(70, { attributes: { group: "shipping" } }),
          ];
        }
        // Pooled, the server folds them: the Max, 70.
        return perMinute(70);
      },
      "kafka.consumer_group.offset_sum": (): Rows => {
        // Each group commits 60 messages a minute: 2 messages/s in all.
        return ["billing", "shipping"].flatMap((group: string): Rows => {
          return MINUTES.map(
            (timestamp: Date, index: number): Record<string, unknown> => {
              return {
                timestamp: timestamp,
                value: 1000 + 60 * index,
                attributes: { topic: "orders", group: group },
              };
            },
          );
        });
      },
    },
    observed: {
      "kafka.consumer_group.lag_sum": [{ topic: "orders" }],
    },
  };
}

let scenario: Scenario = kafkaScenario();
let requests: Array<AggregateRequest> = [];

/*
 * While set, every telemetry request it picks waits until a test releases
 * it; the rest are answered at once (a load's follow-up requests included).
 */
let parkWhen: ((request: AggregateRequest) => boolean) | null = null;
let parked: Array<{ request: AggregateRequest; release: () => void }> = [];

function isDayWindow(request: AggregateRequest): boolean {
  return (
    request.aggregateBy.endTimestamp.getTime() -
      request.aggregateBy.startTimestamp.getTime() >
    3 * 60 * 60 * 1000
  );
}

/*
 * Which of the queue's span groups (MessageQueueSpanPopulation) a request
 * reads, told apart by its kind and operation filters — so a request for a
 * group this mock does not know fails the test instead of reading another.
 */
function populationOf(query: Record<string, unknown>): string {
  const kind: unknown = query["kind"];
  const attributes: Record<string, unknown> =
    (query["attributes"] as Record<string, unknown> | undefined) || {};
  if (kind === undefined) {
    return "all";
  }
  if (kind === SpanKind.Producer) {
    return "publish";
  }
  if (kind === SpanKind.Client) {
    return attributes["rpc.method"] !== undefined ? "awsSend" : "send";
  }
  if (kind === SpanKind.Consumer) {
    return attributes["messaging.operation.type"] === "receive"
      ? "receivedBatch"
      : "consume";
  }
  throw new Error(`No span group reads kind ${String(kind)}`);
}

function spanRows(request: AggregateRequest, scale: number): Rows {
  const by: AggregateRequest["aggregateBy"] = request.aggregateBy;
  const population: string = populationOf(by.query);
  const errorsOnly: boolean = by.query["statusCode"] === SpanStatus.Error;
  // Only the client-only publishers' own line asks by service id.
  const serviceIds: Array<string> | null = by.query["primaryEntityId"]
    ? (by.query["primaryEntityId"] as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      )
    : null;

  if (by.groupBy && by.groupBy["primaryEntityId"]) {
    const services: Array<ServiceSpans> =
      population === "publish"
        ? scenario.producers
        : population === "consume"
          ? scenario.consumers
          : population === "send"
            ? scenario.sends || []
            : [];
    return services.map((service: ServiceSpans): Record<string, unknown> => {
      return {
        timestamp: MINUTES[0],
        primaryEntityId: service.id,
        value:
          by.aggregationType === AggregationType.P95
            ? service.p95Ns
            : errorsOnly
              ? service.errors
              : service.count,
      };
    });
  }

  if (by.aggregationType === AggregationType.P95) {
    if (by.aggregationInterval === AggregationInterval.Total) {
      return scenario.windowP95Ns === null
        ? []
        : [{ timestamp: MINUTES[0], value: scenario.windowP95Ns }];
    }
    return perMinute(10_000_000);
  }

  if (population === "send") {
    // The client-only publishers' line: their sends per minute.
    expect(serviceIds).not.toBeNull();
    return perMinute((scenario.sendsPerMinute || 0) * scale);
  }
  if (population === "awsSend" || population === "receivedBatch") {
    return [];
  }
  if (errorsOnly) {
    expect(population).toBe("all");
    return perMinute(scenario.errorsPerMinute * scale);
  }
  if (population === "publish") {
    return perMinute(scenario.publishedPerMinute * scale);
  }
  if (population === "consume") {
    return perMinute(scenario.consumedPerMinute * scale);
  }
  return perMinute(scenario.allPerMinute * scale);
}

function metricRows(request: AggregateRequest): Rows {
  const by: AggregateRequest["aggregateBy"] = request.aggregateBy;
  const name: string = String(by.query["name"] || "");
  if (by.aggregationInterval === AggregationInterval.Total) {
    return (scenario.observed[name] || []).map(
      (attributes: Record<string, string>): Record<string, unknown> => {
        return { timestamp: MINUTES[0], value: 12, attributes: attributes };
      },
    );
  }
  const rows: ((request: AggregateRequest) => Rows) | undefined =
    scenario.metrics[name];
  return rows ? rows(request) : [];
}

function answer(request: AggregateRequest): { data: Rows } {
  const scale: number = isDayWindow(request) ? 5 : 1;
  if (request.modelType === Span) {
    return { data: spanRows(request, scale) };
  }
  if (request.modelType === Metric) {
    return { data: metricRows(request) };
  }
  return { data: [] };
}

function spanRequests(): Array<AggregateRequest> {
  return requests.filter((request: AggregateRequest): boolean => {
    return request.modelType === Span;
  });
}

function metricRequests(): Array<AggregateRequest> {
  return requests.filter((request: AggregateRequest): boolean => {
    return request.modelType === Metric;
  });
}

async function releaseParked(
  which: (request: AggregateRequest) => boolean,
): Promise<void> {
  const taken: Array<{ request: AggregateRequest; release: () => void }> =
    parked.filter((entry: { request: AggregateRequest }): boolean => {
      return which(entry.request);
    });
  expect(taken.length).toBeGreaterThan(0);
  parked = parked.filter(
    (entry: { request: AggregateRequest; release: () => void }): boolean => {
      return !taken.includes(entry);
    },
  );
  await act(async () => {
    for (const entry of taken) {
      entry.release();
    }
    await Promise.resolve();
  });
}

// ---- the row -------------------------------------------------------------

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function queueRow(data?: Partial<MessageQueue>): MessageQueue {
  const row: MessageQueue = new MessageQueue();
  row.id = new ObjectID(MODEL_ID_STRING);
  row.projectId = new ObjectID(PROJECT_ID_STRING);
  row.name = "orders";
  row.queueIdentifier = "kafka||orders";
  row.messagingSystem = "kafka";
  row.destinationName = "orders";
  row.discoverySource = "traces";
  row.lastSeenAt = minutesAgo(2);
  Object.assign(row, data || {});
  return row;
}

function serveServiceNames(): void {
  getListMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType?: unknown }).modelType;
    if (modelType === Service) {
      return Promise.resolve({
        data: [
          { _id: CHECKOUT_ID, name: "checkout" },
          { _id: BILLING_ID, name: "billing" },
          { _id: MAILER_ID, name: "mailer" },
        ],
        count: 3,
      });
    }
    return Promise.resolve({ data: [], count: 0 });
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <MessageQueueOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByText("Producers", undefined, { timeout: 3000 });
}

// Waits until the telemetry has landed: the tiles have left their skeleton.
async function renderLoaded(): Promise<void> {
  await renderOverview();
  await waitFor(() => {
    expect(screen.queryAllByText(/^Loading /)).toHaveLength(0);
  });
}

// A tile's title is the uppercase label above its value.
const TILE_LABEL_CLASS: RegExp = /uppercase/;

function tile(title: string): HTMLElement {
  const label: HTMLElement = screen
    .getAllByText(title)
    .find((element: HTMLElement): boolean => {
      return (
        element.tagName === "SPAN" && TILE_LABEL_CLASS.test(element.className)
      );
    })!;
  return label.closest("div.relative") as HTMLElement;
}

function chartProps(title: string): Record<string, unknown> {
  const calls: Array<Array<unknown>> = chartCardMock.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return (call[0] as { title: string }).title === title;
    },
  );
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  chartCardMock.mockReset();
  requests = [];
  parked = [];
  parkWhen = null;
  scenario = kafkaScenario();
  mockAutoRefreshTick = null;
  serveServiceNames();
  aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
    const typed: AggregateRequest = request as AggregateRequest;
    requests.push(typed);
    const result: { data: Rows } = answer(typed);
    if (parkWhen && parkWhen(typed)) {
      return new Promise((resolve: (value: unknown) => void): void => {
        parked.push({
          request: typed,
          release: (): void => {
            resolve(result);
          },
        });
      });
    }
    return Promise.resolve(result);
  });
});

afterEach(() => {
  cleanup();
});

// ---- the tests -------------------------------------------------------------

describe("the queue Overview's scope", () => {
  test("every telemetry request is scoped by the queue's key and project; an attribute only tells its spans apart", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(requests.length).toBeGreaterThan(10);
    for (const request of requests) {
      const query: Record<string, unknown> = request.aggregateBy.query;
      expect(query["entityKeys"]).toBeInstanceOf(Includes);
      expect((query["entityKeys"] as Includes).values).toEqual([
        KAFKA_ORDERS_KEY,
      ]);
      expect(String(query["projectId"])).toBe(PROJECT_ID_STRING);
      if (request.modelType === Metric) {
        // The key IS the queue: never an attribute filter on its metrics.
        expect(query["attributes"]).toBeUndefined();
        continue;
      }
      // A span attribute filter reads the operation or a batch's size only.
      for (const key of Object.keys(
        (query["attributes"] as Record<string, unknown> | undefined) || {},
      )) {
        expect([
          "messaging.operation.type",
          "messaging.operation",
          "rpc.method",
          "messaging.batch.message_count",
        ]).toContain(key);
      }
    }
  });

  test("reads the row it needs by the page's id", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

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
    expect(request.select).toEqual(
      expect.objectContaining({
        queueIdentifier: true,
        messagingSystem: true,
        destinationName: true,
        brokerScope: true,
        brokerAddress: true,
        lastSeenAt: true,
        brokerMetricsLastSeenAt: true,
        labels: { name: true, color: true },
      }),
    );
  });

  test("an identifier that does not parse sends no telemetry request at all", async () => {
    getItemMock.mockResolvedValue(
      queueRow({ queueIdentifier: "not-an-identifier" }),
    );

    await renderOverview();

    expect(
      await screen.findByTestId("message-queue-unscoped-banner"),
    ).toBeInTheDocument();
    // The sections render empty, not as loaders forever.
    expect(
      await screen.findByTestId("message-queue-producers-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("message-queue-consumers-empty"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("message-queue-broker-health-guidance"),
    ).toBeInTheDocument();
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a deleted or unknown id (the API's empty model) is 'Queue not found.' and queries nothing", async () => {
    getItemMock.mockResolvedValue(new MessageQueue());

    render(
      <MemoryRouter>
        <MessageQueueOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
    );
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a failed row lookup shows its error", async () => {
    getItemMock.mockRejectedValue(new Error("Permission denied"));

    render(
      <MemoryRouter>
        <MessageQueueOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Permission denied",
    );
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("the message tiles and charts", () => {
  test("Published counts the producer spans, Consumed the consumer spans that handled messages", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    // 10 and 9 a minute over twelve minutes.
    expect(within(tile("Published")).getByText("120")).toBeInTheDocument();
    expect(within(tile("Consumed")).getByText("108")).toBeInTheDocument();
    // Consumed leaves out the receives that returned nothing.
    const consumed: AggregateRequest | undefined = spanRequests().find(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationType === AggregationType.Count &&
          !request.aggregateBy.groupBy &&
          request.aggregateBy.query["kind"] === SpanKind.Consumer
        );
      },
    );
    expect(
      (consumed!.aggregateBy.query["attributes"] as Record<string, unknown>)[
        "messaging.batch.message_count"
      ],
    ).toEqual(new IncludesNone(["0"]));

    const counts: Array<AggregateRequest> = spanRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationType === AggregationType.Count &&
          !request.aggregateBy.groupBy
        );
      },
    );
    const kinds: Array<unknown> = counts.map(
      (request: AggregateRequest): unknown => {
        return request.aggregateBy.query["kind"];
      },
    );
    expect(kinds).toEqual(
      expect.arrayContaining([SpanKind.Producer, SpanKind.Consumer]),
    );
    // Never a SERVER filter; a CLIENT one only for client-only publishers.
    expect(kinds).not.toContain(SpanKind.Server);
    expect(kinds).not.toContain(SpanKind.Client);
  });

  test("a publisher that records its sends only as client spans is counted: the tile, the chart and its card", async () => {
    // An SNS topic the Java agent publishes to: CLIENT spans, no PRODUCER.
    scenario = {
      ...kafkaScenario(),
      publishedPerMinute: 0,
      producers: [],
      sends: [{ id: BILLING_ID, count: 60, errors: 3, p95Ns: 7_000_000 }],
      sendsPerMinute: 5,
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    // Its 60 sends, not the 0 producer spans.
    expect(within(tile("Published")).getByText("60")).toBeInTheDocument();
    const published: Array<{ y: number }> = (
      chartProps("Messages")["series"] as Array<{
        seriesName: string;
        data: Array<{ y: number }>;
      }>
    )[0]!.data;
    expect(published.length).toBeGreaterThan(0);
    expect(published[0]!.y).toBe(5);
    // The line reads exactly the client-only publishers' sends.
    const line: AggregateRequest | undefined = spanRequests().find(
      (request: AggregateRequest): boolean => {
        return Boolean(request.aggregateBy.query["primaryEntityId"]);
      },
    );
    expect(line!.aggregateBy.query["kind"]).toBe(SpanKind.Client);
    expect(
      (line!.aggregateBy.query["primaryEntityId"] as Includes).values.map(
        (id: unknown): string => {
          return String(id);
        },
      ),
    ).toEqual([BILLING_ID]);

    await waitFor(() => {
      expect(screen.getByText("billing")).toBeInTheDocument();
    });
    const [producer] = screen.getAllByTestId("message-queue-producers-row");
    expect(within(producer!).getByText("60")).toBeInTheDocument();
    expect(within(producer!).getByText("5.0%")).toBeInTheDocument();
    expect(within(producer!).getByText("7.0 ms")).toBeInTheDocument();
  });

  test("Errors counts failed spans of every kind, over all of the queue's spans", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    // 1 of 25 a minute: 12 of 300, 4.0%.
    const errors: HTMLElement = tile("Errors");
    expect(within(errors).getByText("12")).toBeInTheDocument();
    expect(within(errors).getByText("4.0% of 300 spans")).toBeInTheDocument();

    const errorRequests: Array<AggregateRequest> = spanRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.query["statusCode"] === SpanStatus.Error &&
          !request.aggregateBy.groupBy
        );
      },
    );
    expect(errorRequests).toHaveLength(1);
    expect(errorRequests[0]!.aggregateBy.query["kind"]).toBeUndefined();

    const all: Array<AggregateRequest> = spanRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationType === AggregationType.Count &&
          !request.aggregateBy.groupBy &&
          request.aggregateBy.query["kind"] === undefined &&
          request.aggregateBy.query["statusCode"] === undefined
        );
      },
    );
    expect(all).toHaveLength(1);
  });

  test("p95 processing time is ONE percentile of the CONSUMER spans over the range", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(
      within(tile("p95 processing time")).getByText("12 ms"),
    ).toBeInTheDocument();

    const p95: Array<AggregateRequest> = spanRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationType === AggregationType.P95 &&
          !request.aggregateBy.groupBy
        );
      },
    );
    expect(p95).toHaveLength(2);
    for (const request of p95) {
      expect(request.aggregateBy.query["kind"]).toBe(SpanKind.Consumer);
    }
    expect(
      p95.map((request: AggregateRequest): unknown => {
        return request.aggregateBy.aggregationInterval;
      }),
    ).toEqual(expect.arrayContaining([AggregationInterval.Total, undefined]));
  });

  test("a queue with no span at all reads '—', not 0", async () => {
    scenario = {
      ...kafkaScenario(),
      publishedPerMinute: 0,
      consumedPerMinute: 0,
      allPerMinute: 0,
      errorsPerMinute: 0,
      windowP95Ns: null,
      producers: [],
      consumers: [],
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    for (const title of ["Published", "Consumed", "Errors"]) {
      expect(within(tile(title)).getByText("—")).toBeInTheDocument();
    }
    expect(
      within(tile("p95 processing time")).getByText("—"),
    ).toBeInTheDocument();
  });

  test("spans of other kinds only: Published and Consumed read 0", async () => {
    scenario = {
      ...kafkaScenario(),
      publishedPerMinute: 0,
      consumedPerMinute: 0,
      windowP95Ns: null,
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(within(tile("Published")).getByText("0")).toBeInTheDocument();
    expect(within(tile("Consumed")).getByText("0")).toBeInTheDocument();
  });

  test("the charts: Published, Consumed and Errors per interval, and the p95 per interval", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    const messages: Record<string, unknown> = chartProps("Messages");
    const series: Array<{ seriesName: string; data: Array<{ y: number }> }> =
      messages["series"] as Array<{
        seriesName: string;
        data: Array<{ y: number }>;
      }>;
    expect(
      series.map((entry: { seriesName: string }): string => {
        return entry.seriesName;
      }),
    ).toEqual(["Published", "Consumed", "Errors"]);
    expect(series[0]!.data).toHaveLength(12);
    expect(series[0]!.data[0]!.y).toBe(10);
    expect(series[1]!.data[0]!.y).toBe(9);
    expect(series[2]!.data[0]!.y).toBe(1);
    expect(messages["syncId"]).toBe(`message-queue-${MODEL_ID_STRING}`);

    const p95: Record<string, unknown> = chartProps("p95 processing time");
    const p95Series: Array<{ data: Array<{ y: number }> }> = p95[
      "series"
    ] as Array<{ data: Array<{ y: number }> }>;
    // 10,000,000 ns per interval: 10 ms.
    expect(p95Series[0]!.data[0]!.y).toBe(10);
    expect(p95["syncId"]).toBe(`message-queue-${MODEL_ID_STRING}`);
  });

  test("the hero: name, destination, system, discovery source and liveness", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(screen.getByRole("heading", { name: "orders" })).toBeInTheDocument();
    expect(screen.getByText("destination: orders")).toBeInTheDocument();
    expect(screen.getAllByText("Apache Kafka").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Application traces").length).toBeGreaterThan(0);
    expect(screen.getByTestId("resource-overview-status")).toHaveTextContent(
      "Seen recently",
    );
  });

  test("a Service Bus queue shows its namespace", async () => {
    scenario = { ...kafkaScenario(), metrics: {}, observed: {} };
    getItemMock.mockResolvedValue(
      queueRow({
        queueIdentifier: "servicebus|orders-prod|orders",
        messagingSystem: "servicebus",
        brokerScope: "orders-prod",
        brokerAddress: "orders-prod.servicebus.windows.net:5671",
      }),
    );

    await renderLoaded();

    expect(screen.getByText("Namespace: orders-prod")).toBeInTheDocument();
    expect(screen.getByText("Namespace")).toBeInTheDocument();
  });

  test("a queue nothing has seen lately reads so", async () => {
    getItemMock.mockResolvedValue(queueRow({ lastSeenAt: minutesAgo(90) }));

    await renderLoaded();

    expect(screen.getByTestId("resource-overview-status")).toHaveTextContent(
      "Not seen recently",
    );
  });
});

describe("Producers and Consumers", () => {
  test("group the publishes and the consumes by the service that recorded them", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    const grouped: Array<AggregateRequest> = spanRequests().filter(
      (request: AggregateRequest): boolean => {
        return Boolean(request.aggregateBy.groupBy);
      },
    );
    /*
     * Count, failed count and p95 of each group a Kafka queue reads: its
     * producer spans, its client sends and its consumer spans.
     */
    expect(grouped).toHaveLength(9);
    expect(
      grouped
        .map((request: AggregateRequest): string => {
          return populationOf(request.aggregateBy.query);
        })
        .sort(),
    ).toEqual([
      "consume",
      "consume",
      "consume",
      "publish",
      "publish",
      "publish",
      "send",
      "send",
      "send",
    ]);
    for (const request of grouped) {
      expect(request.aggregateBy.groupBy).toEqual({ primaryEntityId: true });
      expect(request.aggregateBy.aggregationInterval).toBe(
        AggregationInterval.Total,
      );
    }

    await waitFor(() => {
      expect(screen.getByText("checkout")).toBeInTheDocument();
    });

    const producers: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-producers-row",
    );
    expect(
      producers.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-service-id");
      }),
    ).toEqual([CHECKOUT_ID, BILLING_ID]);
    expect(within(producers[0]!).getByText("checkout")).toBeInTheDocument();
    expect(within(producers[1]!).getByText("10.0%")).toBeInTheDocument();
    expect(within(producers[1]!).getByText("5.0 ms")).toBeInTheDocument();

    const consumers: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-consumers-row",
    );
    expect(consumers).toHaveLength(1);
    expect(within(consumers[0]!).getByText("mailer")).toBeInTheDocument();
    expect(within(consumers[0]!).getByText("108")).toBeInTheDocument();
    expect(within(consumers[0]!).getByText("40 ms")).toBeInTheDocument();

    // One name lookup for both sides.
    const serviceLookups: Array<Array<unknown>> = getListMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (call[0] as { modelType?: unknown }).modelType === Service;
      },
    );
    expect(serviceLookups).toHaveLength(1);
    const ids: Array<string> = (
      (serviceLookups[0]![0] as { query: { _id: Includes } }).query._id
        .values as Array<ObjectID>
    )
      .map((id: ObjectID): string => {
        return id.toString();
      })
      .sort();
    expect(ids).toEqual([CHECKOUT_ID, BILLING_ID, MAILER_ID].sort());
  });

  test("spans, but none of a side's: each card says so, and never that nothing published", async () => {
    scenario = {
      ...kafkaScenario(),
      publishedPerMinute: 0,
      consumedPerMinute: 0,
      windowP95Ns: null,
      producers: [],
      consumers: [],
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(
      screen.getByTestId("message-queue-producers-empty"),
    ).toHaveTextContent(getMessageQueueServicesEmptyText("producers", true));
    expect(
      screen.getByTestId("message-queue-consumers-empty"),
    ).toHaveTextContent(getMessageQueueServicesEmptyText("consumers", true));
    expect(
      screen.queryByText(
        "No instrumented application published to this queue in the selected range.",
      ),
    ).toBeNull();
    // Nothing to name: no lookup.
    expect(
      getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { modelType?: unknown }).modelType === Service;
      }),
    ).toHaveLength(0);
  });

  test("no span at all: each card says nothing was there", async () => {
    scenario = {
      ...kafkaScenario(),
      publishedPerMinute: 0,
      consumedPerMinute: 0,
      allPerMinute: 0,
      errorsPerMinute: 0,
      windowP95Ns: null,
      producers: [],
      consumers: [],
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    expect(
      screen.getByTestId("message-queue-producers-empty"),
    ).toHaveTextContent(
      "No instrumented application published to this queue in the selected range.",
    );
    expect(
      screen.getByTestId("message-queue-consumers-empty"),
    ).toHaveTextContent(
      "No instrumented application consumed from this queue in the selected range.",
    );
  });
});

describe("Broker health", () => {
  test("reads the Kafka catalog: the lag pooled as its monitor reads it, counters per series as a rate", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    const catalog: ReadonlyArray<MessageQueueMetricDescriptor> =
      getMessageQueueMetricsForSystem("kafka");
    const charted: Array<AggregateRequest> = metricRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationInterval !== AggregationInterval.Total
        );
      },
    );
    expect(
      charted
        .map((request: AggregateRequest): string => {
          return String(request.aggregateBy.query["name"]);
        })
        .sort(),
    ).toEqual(
      catalog
        .map((descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        })
        .sort(),
    );

    const lag: AggregateRequest = charted.find(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.query["name"] === "kafka.consumer_group.lag_sum"
        );
      },
    )!;
    // The Max of every group's Max is the Max of all: one row per interval.
    expect(lag.aggregateBy.aggregationType).toBe(AggregationType.Max);
    expect(lag.aggregateBy.groupByAttributeKeys).toBeUndefined();
    expect(lag.aggregateBy.groupBy).toBeUndefined();

    const offsets: AggregateRequest = charted.find(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.query["name"] ===
          "kafka.consumer_group.offset_sum"
        );
      },
    )!;
    expect(offsets.aggregateBy.aggregationType).toBe(AggregationType.Max);
    expect(offsets.aggregateBy.groupBy).toEqual({ attributes: true });

    await screen.findByTestId("message-queue-broker-health");
    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-broker-metric-tile",
    );
    // Only the metrics with data.
    expect(
      tiles.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-metric-id");
      }),
    ).toEqual([
      "kafka:kafka.consumer_group.lag_sum",
      "kafka:kafka.consumer_group.offset_sum",
    ]);
    // The group furthest behind; the offsets' growth per second, both groups.
    expect(within(tiles[0]!).getByText("70 messages")).toBeInTheDocument();
    expect(within(tiles[1]!).getByText("2 messages/s")).toBeInTheDocument();
  });

  test("each gauge with data gets a Create monitor link on its observed series; counters none", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();
    await screen.findByTestId("message-queue-broker-health");

    // The observed series are read for the gauge with data, and only for it.
    const observed: Array<AggregateRequest> = metricRequests().filter(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationInterval === AggregationInterval.Total
        );
      },
    );
    expect(
      observed.map((request: AggregateRequest): unknown => {
        return [
          request.aggregateBy.query["name"],
          request.aggregateBy.groupByAttributeKeys,
        ];
      }),
    ).toEqual([["kafka.consumer_group.lag_sum", ["topic"]]]);

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-create-monitor",
    );
    expect(
      links.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-metric-id");
      }),
    ).toEqual(["kafka:kafka.consumer_group.lag_sum"]);

    const href: string = within(links[0]!)
      .getByText("Create monitor")
      .closest("a")!
      .getAttribute("href")!;
    expect(
      href.startsWith(`/dashboard/${PROJECT_ID_STRING}/monitors/create?`),
    ).toBe(true);
    const search: URLSearchParams = new URLSearchParams(href.split("?")[1]);
    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(
        search.get("metricQueries") || "",
      );
    expect(queries).toEqual([
      expect.objectContaining({
        metricName: "kafka.consumer_group.lag_sum",
        attributes: { topic: "orders" },
        warningThreshold: 10000,
      }),
    ]);
    expect(search.get("monitorDescription")).toBe("Created from queue orders.");
    expect(
      screen.getByTestId("message-queue-create-monitor-hint"),
    ).toHaveTextContent(
      "Warning when any point in the last 10 minutes is above 10,000 messages",
    );

    // The counter's chart has no link and no disabled button.
    const counterChart: HTMLElement = screen
      .getAllByTestId("message-queue-broker-metric-chart")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-metric-id") ===
          "kafka:kafka.consumer_group.offset_sum"
        );
      })!;
    expect(within(counterChart).queryByText("Create monitor")).toBeNull();
  });

  test("a gauge whose observed series are another queue's gets no link, and says why", async () => {
    scenario = {
      ...kafkaScenario(),
      observed: { "kafka.consumer_group.lag_sum": [{ topic: "payments" }] },
    };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();
    await screen.findByTestId("message-queue-broker-health");

    expect(screen.queryByTestId("message-queue-create-monitor")).toBeNull();
    const unavailable: HTMLElement = screen.getByTestId(
      "message-queue-create-monitor-unavailable",
    );
    expect(unavailable).toBeDisabled();
    expect(unavailable.getAttribute("title")).toContain("would watch nothing");
    /*
     * The reason is on screen, not only on hover: a disabled button takes no
     * focus and a title shows to a mouse alone.
     */
    const hint: HTMLElement = screen.getByTestId(
      "message-queue-create-monitor-hint",
    );
    expect(hint).toBeVisible();
    expect(hint).toHaveTextContent(BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON);
    expect(unavailable).toHaveAccessibleDescription(
      BROKER_HEALTH_MONITOR_UNAVAILABLE_REASON,
    );
  });

  test("an ActiveMQ queue reads ActiveMQ's metrics under its JMS family key", async () => {
    scenario = {
      ...kafkaScenario(),
      metrics: {
        "activemq.message.queue.size": (): Rows => {
          return perMinute(5, {
            attributes: {
              "activemq.broker.name": "localhost",
              "activemq.destination.type": "queue",
            },
          });
        },
      },
      observed: {
        "activemq.message.queue.size": [
          { "messaging.destination.name": "orders" },
        ],
      },
    };
    getItemMock.mockResolvedValue(
      queueRow({ queueIdentifier: "jms||orders", messagingSystem: "activemq" }),
    );

    await renderLoaded();
    await screen.findByTestId("message-queue-broker-health");

    for (const request of requests) {
      expect(
        (request.aggregateBy.query["entityKeys"] as Includes).values,
      ).toEqual([JMS_ORDERS_KEY]);
    }
    const names: Array<string> = metricRequests()
      .filter((request: AggregateRequest): boolean => {
        return (
          request.aggregateBy.aggregationInterval !== AggregationInterval.Total
        );
      })
      .map((request: AggregateRequest): string => {
        return String(request.aggregateBy.query["name"]);
      })
      .sort();
    expect(names).toEqual(
      getMessageQueueMetricsForSystem("activemq")
        .map((descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        })
        .sort(),
    );
    // Its monitor is matched on the JMS family identity.
    expect(screen.getByTestId("message-queue-create-monitor")).toHaveAttribute(
      "data-metric-id",
      "activemq:activemq.message.queue.size",
    );
    // The per-broker note of an open series set.
    expect(
      screen.getByTestId("message-queue-create-monitor-note"),
    ).toHaveTextContent("alerts on each series separately");
  });

  test("a JMS queue reads no broker metric and shows the JMS guidance", async () => {
    getItemMock.mockResolvedValue(
      queueRow({ queueIdentifier: "jms||orders", messagingSystem: "jms" }),
    );

    await renderLoaded();

    expect(metricRequests()).toHaveLength(0);
    const guidance: HTMLElement = await screen.findByTestId(
      "message-queue-broker-health-guidance",
    );
    expect(guidance).toHaveAttribute("data-source-kind", "none");
    expect(guidance).toHaveTextContent("JMS is an API");
    expect(
      within(guidance)
        .getByText("JMS broker metrics in the Queues guide →")
        .closest("a"),
    ).toHaveAttribute("href", "/docs/telemetry/queues#jms");
  });

  test("a Kafka queue with no broker metric yet: where they come from, and its section of the guide", async () => {
    scenario = { ...kafkaScenario(), metrics: {}, observed: {} };
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();

    const guidance: HTMLElement = await screen.findByTestId(
      "message-queue-broker-health-guidance",
    );
    expect(guidance).toHaveAttribute("data-source-kind", "receiver");
    expect(guidance).toHaveTextContent(
      "No Apache Kafka broker metric has arrived for this queue yet.",
    );
    expect(guidance).toHaveTextContent(
      "OpenTelemetry Collector receiver: kafka_metrics",
    );
    const docs: HTMLElement = within(guidance)
      .getByText("Apache Kafka broker metrics in the Queues guide →")
      .closest("a")!;
    expect(docs).toHaveAttribute("href", "/docs/telemetry/queues#apache-kafka");
    expect(docs).toHaveAttribute("target", "_blank");
    // The Documentation tab has this queue's collector config.
    expect(
      within(guidance)
        .getByText("Set up broker metrics for this queue →")
        .closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID_STRING}/queues/${MODEL_ID_STRING}/documentation`,
    );
  });

  test("a Service Bus queue without a namespace: told where its broker metrics go, never offered their setup", async () => {
    scenario = { ...kafkaScenario(), metrics: {}, observed: {} };
    // Its spans came from the emulator: no namespace in its identity.
    getItemMock.mockResolvedValue(
      queueRow({
        queueIdentifier: "servicebus||orders",
        messagingSystem: "servicebus",
        brokerScope: "",
        brokerAddress: "localhost:5672",
      }),
    );

    await renderLoaded();

    const guidance: HTMLElement = await screen.findByTestId(
      "message-queue-broker-health-guidance",
    );
    expect(guidance).toHaveAttribute("data-source-kind", "cloud-monitoring");
    expect(guidance).toHaveTextContent(
      "Azure Service Bus broker metrics name the namespace they come from, and this queue has none",
    );
    expect(guidance).not.toHaveTextContent("has arrived");
    expect(
      within(guidance).queryByText("Set up broker metrics for this queue →"),
    ).toBeNull();
    expect(
      within(guidance).getByText("Open the Metrics explorer →").closest("a"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID_STRING}/metrics`);
  });

  test("broker metrics arrived before but not in this range: says so, with when", async () => {
    scenario = { ...kafkaScenario(), metrics: {}, observed: {} };
    getItemMock.mockResolvedValue(
      queueRow({ brokerMetricsLastSeenAt: minutesAgo(600) }),
    );

    await renderLoaded();

    expect(
      await screen.findByTestId("message-queue-broker-health-no-data"),
    ).toBeInTheDocument();
    expect(screen.getByText(BROKER_HEALTH_NO_DATA_TITLE)).toBeInTheDocument();
    expect(
      screen.queryByTestId("message-queue-broker-health-guidance"),
    ).toBeNull();
  });
});

/*
 * The observed series of the broker metrics only build the Create monitor
 * links. Re-read on every auto-refresh tick they cost a request per
 * monitorable gauge each time, for attributes that change when a partition
 * or a consumer group appears, not every 30 seconds.
 */
describe("the Create monitor links' observed series", () => {
  // The observed-series reads: one per gauge, over the whole window.
  function observedReads(): number {
    return metricRequests().filter((request: AggregateRequest): boolean => {
      return (
        request.aggregateBy.aggregationInterval === AggregationInterval.Total
      );
    }).length;
  }

  async function settle(): Promise<void> {
    for (let turn: number = 0; turn < 5; turn++) {
      await act(async () => {
        await new Promise((resolve: (value: unknown) => void): void => {
          setTimeout(resolve, 10);
        });
      });
    }
  }

  test("an auto-refresh tick reuses them; a new range reads them again", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();
    await screen.findByTestId("message-queue-create-monitor");
    await settle();
    const first: number = observedReads();
    expect(first).toBeGreaterThan(0);

    // A tick reloads every chart, but none of the observed series.
    const loaded: number = requests.length;
    await act(async () => {
      mockAutoRefreshTick!();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(requests.length).toBeGreaterThan(loaded);
    });
    await settle();
    expect(observedReads()).toBe(first);
    // The link is still built from them.
    expect(
      screen.getByTestId("message-queue-create-monitor"),
    ).toBeInTheDocument();

    // A range the reader picks reads them for that range.
    fireEvent.click(screen.getByText("Pick past day"));
    await waitFor(() => {
      expect(observedReads()).toBeGreaterThan(first);
    });
  });

  test("the cache keeps a metric's series per queue, range and metric, for a while, and never an empty answer", () => {
    const cache: MessageQueueObservedSeriesCache =
      new MessageQueueObservedSeriesCache();
    const window: {
      projectId: string;
      keys: Array<string>;
      start: Date;
      end: Date;
    } = {
      projectId: PROJECT_ID_STRING,
      keys: [KAFKA_ORDERS_KEY],
      start: new Date(NOW - 60 * 60 * 1000),
      end: new Date(NOW),
    };
    const key: string = MessageQueueObservedSeriesCache.keyOf({
      window,
      rangeKey: '{"range":"Past 1 Hour"}',
      metricName: "kafka.consumer_group.lag_sum",
    });

    cache.set(key, [{ topic: "orders" }], NOW);
    expect(cache.get(key, NOW + 30 * 1000)).toEqual([{ topic: "orders" }]);
    // The window a relative range moves each tick is not part of the key.
    expect(
      MessageQueueObservedSeriesCache.keyOf({
        window: {
          ...window,
          start: new Date(window.start.getTime() + 30 * 1000),
          end: new Date(window.end.getTime() + 30 * 1000),
        },
        rangeKey: '{"range":"Past 1 Hour"}',
        metricName: "kafka.consumer_group.lag_sum",
      }),
    ).toBe(key);
    // Another range, metric or queue is another entry.
    for (const other of [
      MessageQueueObservedSeriesCache.keyOf({
        window,
        rangeKey: '{"range":"Past 1 Day"}',
        metricName: "kafka.consumer_group.lag_sum",
      }),
      MessageQueueObservedSeriesCache.keyOf({
        window,
        rangeKey: '{"range":"Past 1 Hour"}',
        metricName: "kafka.consumer_group.lag",
      }),
      MessageQueueObservedSeriesCache.keyOf({
        window: { ...window, keys: [JMS_ORDERS_KEY] },
        rangeKey: '{"range":"Past 1 Hour"}',
        metricName: "kafka.consumer_group.lag_sum",
      }),
    ]) {
      expect(other).not.toBe(key);
      expect(cache.get(other, NOW)).toBeNull();
    }
    // Expired.
    expect(
      cache.get(key, NOW + MESSAGE_QUEUE_OBSERVED_SERIES_TTL_MS),
    ).toBeNull();
    // An empty answer (none yet, or a failed read) is read again next time.
    cache.set(key, [], NOW);
    expect(cache.get(key, NOW)).toBeNull();
  });
});

describe("the telemetry load", () => {
  test("a slow wider range never overwrites the newer one", async () => {
    getItemMock.mockResolvedValue(queueRow());
    // The hour's requests wait; the day's are answered as they come.
    parkWhen = (request: AggregateRequest): boolean => {
      return !isDayWindow(request);
    };

    await renderOverview();
    await waitFor(() => {
      expect(parked.length).toBeGreaterThan(0);
    });

    // The reader picks a day while the hour is still loading: the day lands.
    fireEvent.click(screen.getByText("Pick past day"));
    await waitFor(() => {
      expect(within(tile("Published")).getByText("600")).toBeInTheDocument();
    });
    expect(
      requests.some((request: AggregateRequest): boolean => {
        return isDayWindow(request);
      }),
    ).toBe(true);

    // Then the hour, late — every request of it: it must not replace the day.
    parkWhen = null;
    await releaseParked((request: AggregateRequest): boolean => {
      return !isDayWindow(request);
    });
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(resolve, 50);
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(tile("Published")).getByText("600")).toBeInTheDocument();
    expect(within(tile("Published")).queryByText("120")).toBeNull();
  });

  test("an auto-refresh tick while a load runs leaves it alone; Refresh replaces it", async () => {
    getItemMock.mockResolvedValue(queueRow());
    parkWhen = (): boolean => {
      return true;
    };

    await renderOverview();
    await waitFor(() => {
      expect(parked.length).toBeGreaterThan(0);
    });
    const first: number = requests.length;

    // A tick reloads the row, but not the telemetry still loading.
    await act(async () => {
      mockAutoRefreshTick!();
      await Promise.resolve();
    });
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(requests.length).toBe(first);

    // Refresh is the reader's own: it replaces the running load.
    fireEvent.click(screen.getByText("Refresh now"));
    await waitFor(() => {
      expect(requests.length).toBeGreaterThan(first);
    });

    // Once everything has landed, the next tick reloads the telemetry.
    parkWhen = null;
    await releaseParked((): boolean => {
      return true;
    });
    await waitFor(() => {
      expect(within(tile("Published")).getByText("120")).toBeInTheDocument();
    });
    const settled: number = requests.length;
    await act(async () => {
      mockAutoRefreshTick!();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(requests.length).toBeGreaterThan(settled);
    });
  });

  test("a reload that changes nothing the scope depends on starts no new load", async () => {
    getItemMock.mockResolvedValue(queueRow());

    await renderLoaded();
    const loaded: number = requests.length;

    // A background reload re-stamps lastSeenAt: the same scope.
    getItemMock.mockResolvedValue(queueRow({ lastSeenAt: minutesAgo(1) }));
    await act(async () => {
      mockAutoRefreshTick!();
      await Promise.resolve();
    });
    // The tick itself reloads the telemetry once, as a refresh…
    await waitFor(() => {
      expect(requests.length).toBeGreaterThan(loaded);
    });
    const afterTick: number = requests.length;
    // …but the new row object does not start a second one.
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests.length).toBe(afterTick);
  });
});
