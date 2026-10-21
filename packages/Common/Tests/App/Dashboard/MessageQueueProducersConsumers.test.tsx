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
 * The two sides of a queue: the services that publish to it and the ones
 * that consume from it, grouped by the service that recorded them — the
 * Databases product's calling-services card, once per direction. Which spans
 * are a side's (MessageQueueSpanPopulation) is pinned, span shape by span
 * shape, in MessageQueueSpanPopulations. What this pins:
 *
 *   - each group a side reads is three aggregates over the whole window —
 *     spans, failed spans and the p95 duration — grouped by primaryEntityId
 *     and scoped by the queue's key;
 *   - how a side's groups combine: a producer's messages from its producer
 *     spans, its failures and time from its client sends when it records
 *     any; a consumer's messages plus the SQS batches it received, never a
 *     poll's time;
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
  MESSAGE_QUEUE_SERVICE_LIMIT,
  MessageQueueProducerServices,
  MessageQueueServiceRow,
  MessageQueueServiceSpanFigures,
  MessageQueueServices,
  MessageQueueSpanOverview,
  buildMessageQueueSpanQuery,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
  fetchMessageQueueSpanOverview,
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

/*
 * Which of the queue's span groups (MessageQueueSpanPopulation) a request
 * reads, told apart by its kind and operation filters.
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

// Per group, per service: spans, failed spans, p95 in ns.
function answerFor(
  groups: Record<string, Array<[string, number, number, number]>>,
): (request: unknown) => Promise<unknown> {
  return (request: unknown): Promise<unknown> => {
    const by: AggregateRequest["aggregateBy"] = (request as AggregateRequest)
      .aggregateBy;
    // Only the cards' reads group by service.
    const rows: Array<[string, number, number, number]> = by["groupBy"]
      ? groups[populationOf(by.query)] || []
      : [];
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

describe("fetching the two sides of the queue", () => {
  function overview(
    system: string,
    serviceLimit?: number,
  ): Promise<MessageQueueSpanOverview> {
    return fetchMessageQueueSpanOverview({
      projectId: PROJECT_ID,
      keys: [KEY],
      start: START,
      end: END,
      messagingSystem: system,
      serviceLimit: serviceLimit,
    });
  }

  function groupedRequests(): Array<AggregateRequest> {
    return aggregateMock.mock.calls
      .map((call: Array<unknown>): AggregateRequest => {
        return call[0] as AggregateRequest;
      })
      .filter((request: AggregateRequest): boolean => {
        return Boolean(request.aggregateBy["groupBy"]);
      });
  }

  test("each side's groups: spans, failed spans and p95, grouped by service over the whole window, scoped by the queue's key", async () => {
    await overview("kafka");

    const requests: Array<AggregateRequest> = groupedRequests();
    // Producer spans, client sends and consumer spans: three reads each.
    expect(requests).toHaveLength(9);
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
      expect(
        (request.aggregateBy.query["entityKeys"] as Includes).values,
      ).toEqual([KEY]);
      expect(String(request.aggregateBy.query["projectId"])).toBe(PROJECT_ID);
      expect(request.aggregateBy.query["startTime"]).toBeInstanceOf(InBetween);
    }
    expect(
      requests
        .map((request: AggregateRequest): string => {
          return [
            populationOf(request.aggregateBy.query),
            request.aggregateBy["aggregationType"],
            request.aggregateBy.query["statusCode"] ?? "",
          ].join(" ");
        })
        .sort(),
    ).toEqual(
      ["publish", "send", "consume"]
        .flatMap((population: string): Array<string> => {
          return [
            `${population} ${AggregationType.Count} `,
            `${population} ${AggregationType.Count} ${SpanStatus.Error}`,
            `${population} ${AggregationType.P95} `,
          ];
        })
        .sort(),
    );
  });

  test("an AWS queue also reads the sends named by the AWS SDK operation; an SQS one its receives that returned messages", async () => {
    await overview("aws_sqs");

    const populations: Array<string> = groupedRequests().map(
      (request: AggregateRequest): string => {
        return populationOf(request.aggregateBy.query);
      },
    );
    expect(
      populations.filter((population: string): boolean => {
        return population === "awsSend";
      }),
    ).toHaveLength(3);
    // A batch's time is the poll's: only counted.
    expect(
      populations.filter((population: string): boolean => {
        return population === "receivedBatch";
      }),
    ).toHaveLength(1);
  });

  test("busiest first, with the side's own error rate and p95 in milliseconds", async () => {
    aggregateMock.mockImplementation(
      answerFor({
        publish: [
          [BILLING, 20, 2, 5_000_000],
          [CHECKOUT, 100, 0, 3_000_000],
        ],
      }),
    );

    const producers: MessageQueueServices = (await overview("kafka")).producers;

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
    aggregateMock.mockImplementation(answerFor({ consume: many }));

    const consumers: MessageQueueServices = (await overview("kafka")).consumers;

    expect(consumers.services).toHaveLength(MESSAGE_QUEUE_SERVICE_LIMIT);
    expect(consumers.total).toBe(25);
    expect(consumers.services[0]!.serviceId).toBe(service(24));

    const three: MessageQueueServices = (await overview("kafka", 3)).consumers;
    expect(three.services).toHaveLength(3);
    expect(three.total).toBe(25);
  });

  test("never more failures than spans, whatever the counts say", async () => {
    aggregateMock.mockImplementation(
      answerFor({ consume: [[MAILER, 4, 9, 1_000_000]] }),
    );

    const consumers: MessageQueueServices = (await overview("kafka")).consumers;

    expect(consumers.services[0]!.errors).toBe(4);
    expect(consumers.services[0]!.errorRatePercent).toBe(100);
  });

  test("no key or no project: no request; a failure: an empty side", async () => {
    const empty: MessageQueueServices = { services: [], total: 0 };
    const unscoped: MessageQueueSpanOverview =
      await fetchMessageQueueSpanOverview({
        projectId: PROJECT_ID,
        keys: [],
        start: START,
        end: END,
      });
    expect(unscoped.producers).toEqual(empty);
    expect(unscoped.consumers).toEqual(empty);
    const noProject: MessageQueueSpanOverview =
      await fetchMessageQueueSpanOverview({
        projectId: null,
        keys: [KEY],
        start: START,
        end: END,
      });
    expect(noProject.producers).toEqual(empty);
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockImplementation((): Promise<never> => {
      return Promise.resolve().then((): never => {
        throw new Error("boom");
      });
    });
    const failed: MessageQueueSpanOverview = await overview("kafka");
    expect(failed.producers).toEqual(empty);
    expect(failed.consumers).toEqual(empty);
  });

  test("the span query: key, project and window; a group and failures only when asked", () => {
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
        population: "consume",
        errorsOnly: true,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: SpanKind.Consumer,
        statusCode: SpanStatus.Error,
      }),
    );
    expect(
      buildMessageQueueSpanQuery(window, { population: "publish" }),
    ).toEqual(expect.objectContaining({ kind: SpanKind.Producer }));
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

describe("combining a side's groups", () => {
  function figures(
    rows: Array<[string, number, number, number]>,
  ): MessageQueueServiceSpanFigures {
    return {
      counts: new Map(
        rows.map(
          ([id, count]: [string, number, number, number]): [string, number] => {
            return [id, count];
          },
        ),
      ),
      errors: new Map(
        rows.map(
          ([id, , errors]: [string, number, number, number]): [
            string,
            number,
          ] => {
            return [id, errors];
          },
        ),
      ),
      p95Ms: new Map(
        rows.map(
          ([id, , , p95]: [string, number, number, number]): [
            string,
            number,
          ] => {
            return [id, p95];
          },
        ),
      ),
    };
  }

  const none: MessageQueueServiceSpanFigures = figures([]);

  test("a producer's messages are its producer spans; its failures and time its sends when it records any", () => {
    // The Azure SDKs: a zero-length producer span per message, one send.
    const producers: MessageQueueProducerServices =
      combineMessageQueueProducerServices({
        producer: figures([[CHECKOUT, 300, 0, 0.004]]),
        sends: [figures([[CHECKOUT, 100, 25, 42]]), none],
      });

    expect(producers.services).toEqual([
      {
        serviceId: CHECKOUT,
        calls: 300,
        errors: 25,
        errorRatePercent: 25,
        p95DurationMs: 42,
      },
    ]);
    // Counted from its producer spans: nothing to add to Published.
    expect(producers.clientOnlyServiceIds).toEqual([]);
    expect(producers.clientOnlyPublished).toBe(0);
  });

  test("a producer with client sends only is counted from them, and added to Published", () => {
    const producers: MessageQueueProducerServices =
      combineMessageQueueProducerServices({
        producer: figures([[CHECKOUT, 50, 1, 3]]),
        sends: [none, figures([[BILLING, 80, 4, 30]])],
      });

    expect(producers.services).toEqual([
      {
        serviceId: BILLING,
        calls: 80,
        errors: 4,
        errorRatePercent: 5,
        p95DurationMs: 30,
      },
      {
        serviceId: CHECKOUT,
        calls: 50,
        errors: 1,
        errorRatePercent: 2,
        p95DurationMs: 3,
      },
    ]);
    expect(producers.clientOnlyServiceIds).toEqual([BILLING]);
    expect(producers.clientOnlyPublished).toBe(80);
  });

  test("a consumer's messages add the SQS batches it received; its failures and time are its consumer spans'", () => {
    const consumers: MessageQueueServices = combineMessageQueueConsumerServices(
      {
        consume: figures([[MAILER, 40, 2, 12]]),
        receivedBatches: figures([
          [MAILER, 10, 0, 20_000],
          [BILLING, 6, 0, 20_000],
        ]),
      },
    );

    expect(consumers.services).toEqual([
      {
        serviceId: MAILER,
        calls: 50,
        errors: 2,
        errorRatePercent: 4,
        p95DurationMs: 12,
      },
      {
        // Receives only: a poll's time is never a processing time.
        serviceId: BILLING,
        calls: 6,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
      },
    ]);
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
