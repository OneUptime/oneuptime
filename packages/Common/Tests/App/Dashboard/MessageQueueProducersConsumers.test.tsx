import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The two sides of a queue: the services that publish to it (its PRODUCER
 * spans) and the ones that consume from it (its CONSUMER spans), grouped by
 * the service that recorded them — the Databases product's calling-services
 * card, once per direction. What it pins:
 *
 *   - each side is three aggregates over the whole window — spans, failed
 *     spans and the p95 duration — grouped by primaryEntityId, filtered by
 *     the side's span KIND and scoped by the queue's key, nothing else;
 *   - the rows: busiest first, error rate of the side's own spans, p95 in
 *     milliseconds, at most ten, with how many there were in all;
 *   - no key is no request; a failure is an empty side;
 *   - the card: names link to the service, an unnamed id stays readable,
 *     the columns and the empty state say which side it is, a footer counts
 *     the services the table leaves out.
 */

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

import MessageQueueServicesCard, {
  getMessageQueueServicesCopy,
  getMessageQueueServicesFooter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueServicesCard";
import {
  MESSAGE_QUEUE_CONSUME_SPAN_KIND,
  MESSAGE_QUEUE_PUBLISH_SPAN_KIND,
  MESSAGE_QUEUE_SERVICE_LIMIT,
  MessageQueueServiceRow,
  MessageQueueServices,
  buildMessageQueueSpanQuery,
  fetchMessageQueueServices,
  getMessageQueueServiceIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { MESSAGE_QUEUE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/MessageQueueMetricDescriptions";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const KEY: string = "0123456789abcdef";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

const CHECKOUT: string = "3c0e7b2a-1111-4111-8111-000000000001";
const BILLING: string = "3c0e7b2a-1111-4111-8111-000000000002";
const MAILER: string = "3c0e7b2a-1111-4111-8111-000000000003";

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: Record<string, unknown> & { query: Record<string, unknown> };
}

function service(id: number): string {
  return `3c0e7b2a-2222-4222-8222-${String(id).padStart(12, "0")}`;
}

// Per service: spans, failed spans, p95 in ns.
function answerFor(
  sides: Record<string, Array<[string, number, number, number]>>,
): (request: unknown) => Promise<unknown> {
  return (request: unknown): Promise<unknown> => {
    const by: AggregateRequest["aggregateBy"] = (request as AggregateRequest)
      .aggregateBy;
    const rows: Array<[string, number, number, number]> =
      sides[String(by.query["kind"])] || [];
    return Promise.resolve({
      data: rows.map(
        ([id, count, errors, p95]: [string, number, number, number]): Record<
          string,
          unknown
        > => {
          return {
            timestamp: START,
            primaryEntityId: id,
            value:
              by["aggregationType"] === AggregationType.P95
                ? p95
                : by.query["statusCode"] === SpanStatus.Error
                  ? errors
                  : count,
          };
        },
      ),
    });
  };
}

beforeEach(() => {
  aggregateMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
});

afterEach(() => {
  cleanup();
});

describe("fetching one side of the queue", () => {
  test.each([
    ["producers", MESSAGE_QUEUE_PUBLISH_SPAN_KIND, SpanKind.Producer],
    ["consumers", MESSAGE_QUEUE_CONSUME_SPAN_KIND, SpanKind.Consumer],
  ])(
    "%s: spans, failed spans and p95 of the side's kind, grouped by service over the whole window",
    async (_side: string, kind: SpanKind, expected: SpanKind) => {
      expect(kind).toBe(expected);

      await fetchMessageQueueServices({
        projectId: PROJECT_ID,
        keys: [KEY],
        start: START,
        end: END,
        kind: kind,
      });

      expect(aggregateMock).toHaveBeenCalledTimes(3);
      const requests: Array<AggregateRequest> = aggregateMock.mock.calls.map(
        (call: Array<unknown>): AggregateRequest => {
          return call[0] as AggregateRequest;
        },
      );
      for (const request of requests) {
        expect(request.modelType).toBe(Span);
        expect(request.aggregateBy["groupBy"]).toEqual({
          primaryEntityId: true,
        });
        expect(request.aggregateBy["aggregationInterval"]).toBe(
          AggregationInterval.Total,
        );
        expect(request.aggregateBy["aggregateColumnName"]).toBe(
          "durationUnixNano",
        );
        expect(request.aggregateBy.query["kind"]).toBe(expected);
        expect(
          (request.aggregateBy.query["entityKeys"] as Includes).values,
        ).toEqual([KEY]);
        expect(String(request.aggregateBy.query["projectId"])).toBe(PROJECT_ID);
        expect(request.aggregateBy.query["startTime"]).toBeInstanceOf(
          InBetween,
        );
        expect(request.aggregateBy.query["attributes"]).toBeUndefined();
      }
      expect(
        requests.map((request: AggregateRequest): unknown => {
          return [
            request.aggregateBy["aggregationType"],
            request.aggregateBy.query["statusCode"],
          ];
        }),
      ).toEqual([
        [AggregationType.Count, undefined],
        [AggregationType.Count, SpanStatus.Error],
        [AggregationType.P95, undefined],
      ]);
    },
  );

  test("busiest first, with the side's own error rate and p95 in milliseconds", async () => {
    aggregateMock.mockImplementation(
      answerFor({
        [SpanKind.Producer]: [
          [BILLING, 20, 2, 5_000_000],
          [CHECKOUT, 100, 0, 3_000_000],
        ],
      }),
    );

    const producers: MessageQueueServices = await fetchMessageQueueServices({
      projectId: PROJECT_ID,
      keys: [KEY],
      start: START,
      end: END,
      kind: SpanKind.Producer,
    });

    expect(producers).toEqual({
      services: [
        {
          serviceId: CHECKOUT,
          calls: 100,
          errors: 0,
          errorRatePercent: 0,
          p95DurationMs: 3,
        },
        {
          serviceId: BILLING,
          calls: 20,
          errors: 2,
          errorRatePercent: 10,
          p95DurationMs: 5,
        },
      ],
      total: 2,
    });
  });

  test("at most ten rows, and how many services there were in all", async () => {
    const many: Array<[string, number, number, number]> = Array.from(
      { length: 25 },
      (_: unknown, index: number): [string, number, number, number] => {
        return [service(index), 100 + index, 0, 1_000_000];
      },
    );
    aggregateMock.mockImplementation(answerFor({ [SpanKind.Consumer]: many }));

    const consumers: MessageQueueServices = await fetchMessageQueueServices({
      projectId: PROJECT_ID,
      keys: [KEY],
      start: START,
      end: END,
      kind: SpanKind.Consumer,
    });

    expect(consumers.services).toHaveLength(MESSAGE_QUEUE_SERVICE_LIMIT);
    expect(consumers.total).toBe(25);
    expect(consumers.services[0]!.serviceId).toBe(service(24));

    const three: MessageQueueServices = await fetchMessageQueueServices({
      projectId: PROJECT_ID,
      keys: [KEY],
      start: START,
      end: END,
      kind: SpanKind.Consumer,
      limit: 3,
    });
    expect(three.services).toHaveLength(3);
    expect(three.total).toBe(25);
  });

  test("never more failures than spans, whatever the counts say", async () => {
    aggregateMock.mockImplementation(
      answerFor({ [SpanKind.Consumer]: [[MAILER, 4, 9, 1_000_000]] }),
    );

    const consumers: MessageQueueServices = await fetchMessageQueueServices({
      projectId: PROJECT_ID,
      keys: [KEY],
      start: START,
      end: END,
      kind: SpanKind.Consumer,
    });

    expect(consumers.services[0]!.errors).toBe(4);
    expect(consumers.services[0]!.errorRatePercent).toBe(100);
  });

  test("no key or no project: no request; a failure: an empty side", async () => {
    expect(
      await fetchMessageQueueServices({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
        kind: SpanKind.Producer,
      }),
    ).toEqual({ services: [], total: 0 });
    expect(
      await fetchMessageQueueServices({
        projectId: null,
        keys: [KEY],
        start: START,
        end: END,
        kind: SpanKind.Producer,
      }),
    ).toEqual({ services: [], total: 0 });
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockRejectedValue(new Error("boom"));
    expect(
      await fetchMessageQueueServices({
        projectId: PROJECT_ID,
        keys: [KEY],
        start: START,
        end: END,
        kind: SpanKind.Producer,
      }),
    ).toEqual({ services: [], total: 0 });
  });

  test("the span query: key, project and window, a kind and failures only when asked", () => {
    const window: {
      projectId: ObjectID;
      keys: Array<string>;
      start: Date;
      end: Date;
    } = {
      projectId: new ObjectID(PROJECT_ID),
      keys: [KEY],
      start: START,
      end: END,
    };

    const all: Record<string, unknown> | null =
      buildMessageQueueSpanQuery(window);
    expect(Object.keys(all!).sort()).toEqual(
      ["entityKeys", "projectId", "startTime"].sort(),
    );
    expect(
      buildMessageQueueSpanQuery(window, {
        kind: SpanKind.Consumer,
        errorsOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: SpanKind.Consumer,
        statusCode: SpanStatus.Error,
      }),
    );
    expect(buildMessageQueueSpanQuery({ ...window, keys: [] })).toBeNull();
  });

  test("the name lookup asks for each service once, across both sides", () => {
    const row: (id: string) => MessageQueueServiceRow = (
      id: string,
    ): MessageQueueServiceRow => {
      return {
        serviceId: id,
        calls: 1,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 1,
      };
    };
    expect(
      getMessageQueueServiceIds(
        { services: [row(CHECKOUT), row(BILLING)], total: 2 },
        { services: [row(BILLING), row(MAILER)], total: 2 },
        { services: [], total: 0 },
      ),
    ).toEqual([CHECKOUT, BILLING, MAILER]);
  });
});

describe("the Producers and Consumers cards", () => {
  function rows(): Array<MessageQueueServiceRow> {
    return [
      {
        serviceId: CHECKOUT,
        calls: 1200,
        errors: 12,
        errorRatePercent: 1,
        p95DurationMs: 3.25,
      },
      {
        serviceId: BILLING,
        calls: 20,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 0.4,
      },
    ];
  }

  test("producers: named services link to their page; an unnamed one shows its id", () => {
    render(
      <MemoryRouter>
        <MessageQueueServicesCard
          side="producers"
          description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.producers}
          services={rows()}
          serviceNames={{ [CHECKOUT]: "checkout" }}
          isLoading={false}
          totalServices={2}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Producers")).toBeInTheDocument();
    expect(
      screen.getByText(MESSAGE_QUEUE_METRIC_DESCRIPTIONS.producers),
    ).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("p95 publish")).toBeInTheDocument();

    const [checkout, billing] = screen.getAllByTestId(
      "message-queue-producers-row",
    );
    expect(
      within(checkout!).getByText("checkout").closest("a"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/service/${CHECKOUT}`);
    expect(within(checkout!).getByText("1.2k")).toBeInTheDocument();
    expect(within(checkout!).getByText("1.0%")).toBeInTheDocument();
    expect(within(checkout!).getByText("3.3 ms")).toBeInTheDocument();
    expect(within(billing!).getByText(BILLING)).toBeInTheDocument();
    expect(within(billing!).queryByRole("link")).toBeNull();
    expect(within(billing!).getByText("400 µs")).toBeInTheDocument();
    // The whole list is shown: no footer.
    expect(screen.queryByTestId("message-queue-producers-footer")).toBeNull();
  });

  test("consumers: their own columns, and a footer when the table leaves services out", () => {
    render(
      <MemoryRouter>
        <MessageQueueServicesCard
          side="consumers"
          description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS.consumers}
          services={rows()}
          serviceNames={{}}
          isLoading={false}
          totalServices={25}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Consumers")).toBeInTheDocument();
    expect(screen.getByText("Consumed")).toBeInTheDocument();
    expect(screen.getByText("p95 processing")).toBeInTheDocument();
    expect(
      screen.getByTestId("message-queue-consumers-footer"),
    ).toHaveTextContent("Showing the 2 busiest of 25 consuming services.");
  });

  test.each([
    [
      "producers" as const,
      "No instrumented application published to this queue in the selected range.",
    ],
    [
      "consumers" as const,
      "No instrumented application consumed from this queue in the selected range.",
    ],
  ])(
    "%s: an empty side says so; a loading one shows a loader",
    (side: "producers" | "consumers", empty: string) => {
      const view: ReturnType<typeof render> = render(
        <MemoryRouter>
          <MessageQueueServicesCard
            side={side}
            description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS[side]}
            services={[]}
            serviceNames={{}}
            isLoading={false}
          />
        </MemoryRouter>,
      );
      expect(
        screen.getByTestId(`message-queue-${side}-empty`),
      ).toHaveTextContent(empty);
      expect(getMessageQueueServicesCopy(side).empty).toBe(empty);

      view.rerender(
        <MemoryRouter>
          <MessageQueueServicesCard
            side={side}
            description={MESSAGE_QUEUE_METRIC_DESCRIPTIONS[side]}
            services={[]}
            serviceNames={{}}
            isLoading={true}
          />
        </MemoryRouter>,
      );
      expect(screen.getByTestId("component-loader")).toBeInTheDocument();
      expect(screen.queryByTestId(`message-queue-${side}-empty`)).toBeNull();
    },
  );

  test("the footer counts only what the table leaves out", () => {
    expect(getMessageQueueServicesFooter("producers", 10, 10)).toBe("");
    expect(getMessageQueueServicesFooter("producers", 10, undefined)).toBe("");
    expect(getMessageQueueServicesFooter("producers", 10, 1234)).toBe(
      "Showing the 10 busiest of 1.2k publishing services.",
    );
  });
});
