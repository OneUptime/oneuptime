import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import {
  MESSAGE_QUEUE_AWS_RPC_SYSTEMS,
  MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS,
  MESSAGE_QUEUE_SERVICE_LIMIT,
  MessageQueueServiceFigures,
  MessageQueueServiceSpanFigures,
  MessageQueueSpanPopulation,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
  emptyMessageQueueServiceSpanFigures,
  getMessageQueueSpanPopulationFilter,
  isMessageQueueAwsRpcSystem,
  isMessageQueuePolledReceiveSystem,
  isMessageQueueSpanPopulationRead,
} from "../../../Types/MessageQueue/MessageQueueSpanPopulation";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import { describe, expect, test } from "@jest/globals";

/*
 * The one definition of which of a queue's spans are publishes and which
 * consumes, and of how a service's spans make its card row - read by the
 * queue's Overview (as aggregate requests) and by the Queues topology (one
 * statement over every queue). What each group counts is held, shape by
 * shape, in Common/Tests/App/Dashboard/MessageQueueSpanPopulations; here are
 * the rules themselves: which system reads which group, and how the rows
 * combine at their edges.
 */

const POPULATIONS: ReadonlyArray<MessageQueueSpanPopulation> = [
  "all",
  "publish",
  "send",
  "awsSend",
  "consume",
  "receivedBatch",
];

function figures(
  entries: Array<[string, number, number?, number?]>,
): MessageQueueServiceSpanFigures {
  const result: MessageQueueServiceSpanFigures =
    emptyMessageQueueServiceSpanFigures();
  for (const [id, count, errors, p95] of entries) {
    result.counts.set(id, count);
    if (errors !== undefined) {
      result.errors.set(id, errors);
    }
    if (p95 !== undefined) {
      result.p95Ms.set(id, p95);
    }
  }
  return result;
}

describe("which system reads which group", () => {
  test("only SQS polls, and only SQS and SNS name a publish by the AWS operation", () => {
    expect(MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS).toEqual(["aws_sqs"]);
    expect(MESSAGE_QUEUE_AWS_RPC_SYSTEMS).toEqual(["aws_sqs", "aws.sns"]);
    // Aliases are folded first.
    expect(isMessageQueuePolledReceiveSystem("AmazonSQS")).toBe(true);
    expect(isMessageQueueAwsRpcSystem("aws.sqs")).toBe(true);
    expect(isMessageQueueAwsRpcSystem("kafka")).toBe(false);
    expect(isMessageQueuePolledReceiveSystem(null)).toBe(false);
    expect(isMessageQueuePolledReceiveSystem("ibmmq")).toBe(false);
  });

  test.each(
    MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    }),
  )(
    "%s reads AWS sends and received batches exactly when the Overview does",
    (system: string) => {
      for (const population of POPULATIONS) {
        const expected: boolean =
          population === "awsSend"
            ? isMessageQueueAwsRpcSystem(system)
            : population === "receivedBatch"
              ? isMessageQueuePolledReceiveSystem(system)
              : true;
        expect({
          population,
          read: isMessageQueueSpanPopulationRead(population, system),
        }).toEqual({ population, read: expected });
      }
    },
  );

  test("a system the catalog does not know reads every group but the AWS and SQS ones", () => {
    expect(isMessageQueueSpanPopulationRead("publish", "mqtt")).toBe(true);
    expect(isMessageQueueSpanPopulationRead("consume", "mqtt")).toBe(true);
    expect(isMessageQueueSpanPopulationRead("awsSend", "mqtt")).toBe(false);
    expect(isMessageQueueSpanPopulationRead("receivedBatch", "")).toBe(false);
  });
});

describe("the filters", () => {
  test("every span, and the publishes", () => {
    expect(getMessageQueueSpanPopulationFilter("all", "kafka")).toEqual({});
    expect(getMessageQueueSpanPopulationFilter("publish", "kafka")).toEqual({
      kind: SpanKind.Producer,
    });
  });

  test("a send is a CLIENT span whose operation keys are sends or absent, one of them present", () => {
    const send: Record<string, unknown> = getMessageQueueSpanPopulationFilter(
      "send",
      "servicebus",
    );
    expect(send["kind"]).toBe(SpanKind.Client);
    const attributes: Record<string, unknown> = send["attributes"] as Record<
      string,
      unknown
    >;
    for (const key of ["messaging.operation.type", "messaging.operation"]) {
      expect(attributes[key]).toBeInstanceOf(Includes);
      expect((attributes[key] as Includes).values).toEqual([
        "publish",
        "send",
        "",
      ]);
    }
    expect((send["attributeKeys"] as Includes).values).toEqual([
      "messaging.operation.type",
      "messaging.operation",
    ]);
  });

  test("an AWS send names the operation alone", () => {
    const awsSend: Record<string, unknown> =
      getMessageQueueSpanPopulationFilter("awsSend", "aws_sqs");
    const attributes: Record<string, unknown> = awsSend["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["messaging.operation.type"]).toBe("");
    expect(attributes["messaging.operation"]).toBe("");
    expect((attributes["rpc.method"] as Includes).values).toContain(
      "SNS/Publish",
    );
  });

  test("a consume leaves out empty batches everywhere, and receives where they are polls", () => {
    const kafka: Record<string, unknown> = getMessageQueueSpanPopulationFilter(
      "consume",
      "kafka",
    );
    const sqs: Record<string, unknown> = getMessageQueueSpanPopulationFilter(
      "consume",
      "aws_sqs",
    );
    expect(kafka["kind"]).toBe(SpanKind.Consumer);
    expect(Object.keys(kafka["attributes"] as Record<string, unknown>)).toEqual(
      ["messaging.batch.message_count"],
    );
    expect(
      (
        (kafka["attributes"] as Record<string, unknown>)[
          "messaging.batch.message_count"
        ] as IncludesNone
      ).values,
    ).toEqual(["0"]);
    expect(
      Object.keys(sqs["attributes"] as Record<string, unknown>).sort(),
    ).toEqual([
      "messaging.batch.message_count",
      "messaging.operation",
      "messaging.operation.type",
    ]);
  });

  test("a received batch is a receive that reports messages", () => {
    const batch: Record<string, unknown> = getMessageQueueSpanPopulationFilter(
      "receivedBatch",
      "aws_sqs",
    );
    const attributes: Record<string, unknown> = batch["attributes"] as Record<
      string,
      unknown
    >;
    expect(attributes["messaging.operation.type"]).toBe("receive");
    expect(attributes["messaging.batch.message_count"]).toBeInstanceOf(
      GreaterThan,
    );
  });

  test("a filter is new each time: a caller that adds to it changes no other", () => {
    const first: Record<string, unknown> = getMessageQueueSpanPopulationFilter(
      "consume",
      "aws_sqs",
    );
    (first["attributes"] as Record<string, unknown>)["extra"] = "x";
    expect(
      getMessageQueueSpanPopulationFilter("consume", "aws_sqs")["attributes"],
    ).not.toHaveProperty("extra");
  });
});

describe("a service's row on either side", () => {
  test("a producer counted from its producer spans, its failures and time its sends' when it records any", () => {
    const rows: ReturnType<typeof combineMessageQueueProducerServices> =
      combineMessageQueueProducerServices({
        producer: figures([
          ["a", 13, 0, 0],
          ["b", 40, 4, 6],
        ]),
        sends: [
          figures([["a", 40, 31, 50]]),
          emptyMessageQueueServiceSpanFigures(),
        ],
      });
    expect(rows.services).toEqual([
      {
        serviceId: "b",
        calls: 40,
        errors: 4,
        errorRatePercent: 10,
        p95DurationMs: 6,
      },
      {
        serviceId: "a",
        calls: 13,
        errors: 31,
        errorRatePercent: 77.5,
        p95DurationMs: 50,
      },
    ]);
    expect(rows.clientOnlyServiceIds).toEqual([]);
    expect(rows.clientOnlyPublished).toBe(0);
  });

  test("a sender with no producer span is counted from its sends, and is client-only", () => {
    const rows: ReturnType<typeof combineMessageQueueProducerServices> =
      combineMessageQueueProducerServices({
        producer: emptyMessageQueueServiceSpanFigures(),
        sends: [figures([["c", 5, 1, 8]]), figures([["d", 9, 0, 3]])],
      });
    expect(rows.clientOnlyServiceIds).toEqual(["d", "c"]);
    expect(rows.clientOnlyPublished).toBe(14);
    expect(rows.total).toBe(2);
  });

  test("a consumer counts its consumes and its received batches; its failures and time are its consumes' alone", () => {
    const rows: ReturnType<typeof combineMessageQueueConsumerServices> =
      combineMessageQueueConsumerServices({
        consume: figures([["e", 30, 3, 40]]),
        receivedBatches: figures([
          ["e", 6, 6, 20000],
          ["f", 2, 0, 20000],
        ]),
      });
    expect(rows.services).toEqual([
      {
        serviceId: "e",
        calls: 36,
        errors: 3,
        errorRatePercent: (3 / 36) * 100,
        p95DurationMs: 40,
      },
      {
        serviceId: "f",
        calls: 2,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: null,
      },
    ]);
  });

  test("the cards keep the busiest ten; a limit of every service keeps them all, busiest first, ties by id", () => {
    const many: MessageQueueServiceSpanFigures = figures(
      Array.from({ length: 14 }, (_value: unknown, index: number) => {
        return [
          `s${String(index).padStart(2, "0")}`,
          index % 3 === 0 ? 5 : index,
        ];
      }) as Array<[string, number]>,
    );
    const carded: ReturnType<typeof combineMessageQueueConsumerServices> =
      combineMessageQueueConsumerServices({ consume: many });
    expect(carded.services).toHaveLength(MESSAGE_QUEUE_SERVICE_LIMIT);
    expect(carded.total).toBe(14);

    const all: ReturnType<typeof combineMessageQueueConsumerServices> =
      combineMessageQueueConsumerServices({
        consume: many,
        limit: Number.POSITIVE_INFINITY,
      });
    expect(all.services).toHaveLength(14);
    const calls: Array<number> = all.services.map(
      (row: MessageQueueServiceFigures) => {
        return row.calls;
      },
    );
    expect(calls).toEqual(
      [...calls].sort((a: number, b: number) => {
        return b - a;
      }),
    );
    // Equal calls: by id.
    const fives: Array<string> = all.services
      .filter((row: MessageQueueServiceFigures) => {
        return row.calls === 5;
      })
      .map((row: MessageQueueServiceFigures) => {
        return row.serviceId;
      });
    expect(fives).toEqual([...fives].sort());
  });

  test.each([[0], [-3], [Number.NaN], [undefined]])(
    "a limit of %j is the cards' ten",
    (limit: number | undefined) => {
      const many: MessageQueueServiceSpanFigures = figures(
        Array.from({ length: 12 }, (_value: unknown, index: number) => {
          return [`s${index}`, index + 1];
        }) as Array<[string, number]>,
      );
      expect(
        combineMessageQueueConsumerServices({ consume: many, limit: limit })
          .services,
      ).toHaveLength(MESSAGE_QUEUE_SERVICE_LIMIT);
    },
  );

  test("a service with no message on a side is no row", () => {
    expect(
      combineMessageQueueProducerServices({
        producer: figures([["z", 0]]),
        sends: [figures([["z", 0]])],
      }).services,
    ).toEqual([]);
  });
});
