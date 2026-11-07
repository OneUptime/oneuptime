import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE_MS,
  MESSAGE_QUEUE_TOPOLOGY_GROUPS,
  MessageQueueTopologyKeys,
  MessageQueueTopologyPairRow,
  MessageQueueTopologyQueueRow,
  assembleMessageQueueTopology,
  buildMessageQueueTopologyKeys,
  buildMessageQueueTopologyStatement,
  readMessageQueueTopologyRows,
  resolveMessageQueueTopologyWindow,
} from "../../../../Server/Utils/Telemetry/MessageQueueTopology";
import Span from "../../../../Models/AnalyticsModels/Span";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { parseMessageQueueIdentifier } from "../../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS,
  MessageQueueTopologyFlow,
  MessageQueueTopologyResponse,
} from "../../../../Types/MessageQueue/MessageQueueTopology";
import {
  MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
} from "../../../../Types/MessageQueue/MessageQueueSpanPopulation";
import { keyForMessageQueue } from "../../../../Utils/Telemetry/EntityKey";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The Queues topology's read, its pure half (Server/Utils/Telemetry/
 * MessageQueueTopology): the range a request asks for, the queue keys the
 * read is scoped by, the one statement, how its rows are read and how they
 * become the map. The statement's semantics are held by the read twin and
 * the real-ClickHouse suite; what it builds them FROM is held here - the
 * Overview's own filters, per system, over the right keys.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
);
const NOW: Date = new Date("2026-11-07T12:00:00.000Z");
const START: Date = new Date("2026-11-07T11:00:00.000Z");
const END: Date = new Date("2026-11-07T12:00:00.000Z");

const SERVICE_A: string = "3c0e7b2a-1111-4111-8111-000000000001";
const SERVICE_B: string = "3c0e7b2a-1111-4111-8111-000000000002";
const SERVICE_C: string = "3c0e7b2a-1111-4111-8111-000000000003";

function generator(): StatementGenerator<Span> {
  return new StatementGenerator<Span>({
    modelType: Span,
    database: ClickhouseAppInstance,
  });
}

function queue(
  id: string,
  system: string,
  destination: string,
  extra?: Partial<MessageQueueTopologyQueueRow>,
): MessageQueueTopologyQueueRow {
  return {
    id: id,
    name: destination,
    messagingSystem: system,
    destinationName: destination,
    brokerScope: "",
    brokerAddress: "",
    queueIdentifier: `${system}||${destination}`,
    discoverySource: "traces",
    lastSeenAt: new Date("2026-11-07T11:55:00.000Z"),
    brokerMetricsLastSeenAt: null,
    ...extra,
  };
}

function keyOf(row: MessageQueueTopologyQueueRow): string {
  return keyForMessageQueue(
    PROJECT_ID.toString(),
    parseMessageQueueIdentifier(row.queueIdentifier)!,
  );
}

function emptyGroups(): MessageQueueTopologyPairRow["groups"] {
  const groups: MessageQueueTopologyPairRow["groups"] = {};
  for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
    groups[population] = { count: 0, errors: 0, p95Ms: null };
  }
  return groups;
}

function pair(
  queueKey: string,
  serviceId: string,
  groups: Partial<
    Record<string, { count: number; errors?: number; p95Ms?: number | null }>
  >,
  spans?: number,
  errors?: number,
): MessageQueueTopologyPairRow {
  const all: MessageQueueTopologyPairRow["groups"] = emptyGroups();
  let total: number = 0;
  for (const [population, figures] of Object.entries(groups)) {
    all[population] = {
      count: figures!.count,
      errors: figures!.errors || 0,
      p95Ms: figures!.p95Ms === undefined ? 10 : figures!.p95Ms,
    };
    total += figures!.count;
  }
  return {
    queueKey: queueKey,
    serviceId: serviceId,
    spans: spans === undefined ? total : spans,
    errors: errors || 0,
    groups: all,
  };
}

describe("the range a request reads", () => {
  test("both edges as asked", () => {
    expect(
      resolveMessageQueueTopologyWindow({
        startTime: START.toISOString(),
        endTime: END.toISOString(),
        now: NOW,
      }),
    ).toEqual({ startTime: START, endTime: END });
  });

  test("no start is the hour before the end; no end is now", () => {
    const window: { startTime: Date; endTime: Date } =
      resolveMessageQueueTopologyWindow({
        startTime: undefined,
        endTime: undefined,
        now: NOW,
      });
    expect(window.endTime).toEqual(NOW);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      MESSAGE_QUEUE_TOPOLOGY_DEFAULT_RANGE_MS,
    );

    const ending: { startTime: Date; endTime: Date } =
      resolveMessageQueueTopologyWindow({
        startTime: "",
        endTime: "2026-11-01T00:00:00.000Z",
        now: NOW,
      });
    expect(ending.startTime.toISOString()).toBe("2026-10-31T23:00:00.000Z");

    const starting: { startTime: Date; endTime: Date } =
      resolveMessageQueueTopologyWindow({
        startTime: START.toISOString(),
        endTime: null,
        now: NOW,
      });
    expect(starting).toEqual({ startTime: START, endTime: NOW });
  });

  test.each([
    ["not a date", "startTime"],
    [42, "startTime"],
    [{}, "startTime"],
    [[START.toISOString()], "startTime"],
  ])("a start of %j is refused, naming the field", (value: unknown) => {
    expect(() => {
      return resolveMessageQueueTopologyWindow({
        startTime: value,
        endTime: END.toISOString(),
        now: NOW,
      });
    }).toThrow(new BadDataException("startTime must be a date"));
  });

  test("an end that is not a date is refused, naming the field", () => {
    expect(() => {
      return resolveMessageQueueTopologyWindow({
        startTime: START.toISOString(),
        endTime: "soon",
        now: NOW,
      });
    }).toThrow(new BadDataException("endTime must be a date"));
  });

  test("a start after its end is refused", () => {
    expect(() => {
      return resolveMessageQueueTopologyWindow({
        startTime: END.toISOString(),
        endTime: START.toISOString(),
        now: NOW,
      });
    }).toThrow(new BadDataException("startTime must not be after endTime"));
  });

  test("an empty range (start = end) is read", () => {
    expect(
      resolveMessageQueueTopologyWindow({
        startTime: END.toISOString(),
        endTime: END.toISOString(),
        now: NOW,
      }),
    ).toEqual({ startTime: END, endTime: END });
  });

  test("the widest range is read, and one millisecond more is refused rather than cut", () => {
    const end: Date = END;
    const widest: Date = new Date(
      end.getTime() - MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS,
    );
    expect(
      resolveMessageQueueTopologyWindow({
        startTime: widest.toISOString(),
        endTime: end.toISOString(),
        now: NOW,
      }).startTime,
    ).toEqual(widest);
    expect(() => {
      return resolveMessageQueueTopologyWindow({
        startTime: new Date(widest.getTime() - 1).toISOString(),
        endTime: end.toISOString(),
        now: NOW,
      });
    }).toThrow(BadDataException);
  });
});

describe("the queue keys the read is scoped by", () => {
  test("each queue's key is the one its Overview reads it by, with its specific system", () => {
    const kafka: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const activemq: MessageQueueTopologyQueueRow = queue(
      "q2",
      "activemq",
      "billing",
      { queueIdentifier: "jms||billing" },
    );
    const keys: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
      PROJECT_ID,
      [kafka, activemq],
    );

    expect(keys.keys).toEqual([keyOf(kafka), keyOf(activemq)]);
    expect(keys.queueIdByKey.get(keyOf(kafka))).toBe("q1");
    expect(keys.queueIdByKey.get(keyOf(activemq))).toBe("q2");
    // The key is the family's (jms); the system the row's own (activemq).
    expect(keys.systemByKey.get(keyOf(activemq))).toBe("activemq");
  });

  test("a row whose identifier names no queue, or that has no id, has no key", () => {
    const keys: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
      PROJECT_ID,
      [
        queue("q1", "kafka", "orders", { queueIdentifier: "not-an-identifier" }),
        queue("q2", "kafka", "orders", { queueIdentifier: null }),
        queue("", "kafka", "payments"),
        queue("q4", "kafka", "events"),
      ],
    );
    expect(keys.keys).toHaveLength(1);
    expect(Array.from(keys.queueIdByKey.values())).toEqual(["q4"]);
  });

  test("two rows that build one key keep the first", () => {
    const first: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const second: MessageQueueTopologyQueueRow = queue("q2", "kafka", "ORDERS", {
      queueIdentifier: "Kafka||Orders",
    });
    const keys: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
      PROJECT_ID,
      [first, second],
    );
    expect(keys.keys).toEqual([keyOf(first)]);
    expect(keys.queueIdByKey.get(keyOf(first))).toBe("q1");
  });

  test("no project, no keys", () => {
    expect(
      buildMessageQueueTopologyKeys("  ", [queue("q1", "kafka", "orders")])
        .keys,
    ).toEqual([]);
  });

  test("keys belong to their project: another project builds other keys", () => {
    const row: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const other: MessageQueueTopologyKeys = buildMessageQueueTopologyKeys(
      ObjectID.generate(),
      [row],
    );
    expect(other.keys[0]).not.toBe(keyOf(row));
  });
});

function statementFor(
  queues: Array<MessageQueueTopologyQueueRow>,
  serviceFilter?: { serviceIds?: Array<ObjectID>; excludedServiceIds?: Array<ObjectID> },
): Statement {
  return buildMessageQueueTopologyStatement({
    generator: generator(),
    projectId: PROJECT_ID,
    keys: buildMessageQueueTopologyKeys(PROJECT_ID, queues),
    window: { startTime: START, endTime: END },
    serviceFilter: serviceFilter || {},
    rowLimit: 50000,
  });
}

/*
 * The query with every bound column name written in: the query builder
 * binds a column as an Identifier parameter (`{p0:Identifier}`), so the
 * text says which column a condition reads only once they are put back.
 */
function withIdentifiers(statement: Statement): string {
  const params: Record<string, unknown> = statement.query_params;
  return statement.query.replace(
    /\{(p\d+):Identifier\}/g,
    (whole: string, name: string): string => {
      const value: unknown = params[name];
      return typeof value === "string" ? value : whole;
    },
  );
}

describe("the statement", () => {
  test("refuses a read that names no queue, and a row limit that is not one", () => {
    expect(() => {
      return statementFor([]);
    }).toThrow(BadDataException);
    for (const rowLimit of [0, -1, 1.5, Number.NaN]) {
      expect(() => {
        return buildMessageQueueTopologyStatement({
          generator: generator(),
          projectId: PROJECT_ID,
          keys: buildMessageQueueTopologyKeys(PROJECT_ID, [
            queue("q1", "kafka", "orders"),
          ]),
          window: { startTime: START, endTime: END },
          serviceFilter: {},
          rowLimit: rowLimit,
        });
      }).toThrow(BadDataException);
    }
  });

  test("reads the span table once, the key array joined out, per queue key and service, busiest first", () => {
    const statement: Statement = statementFor([queue("q1", "kafka", "orders")]);
    const query: string = statement.query;

    expect(query).toMatch(/^SELECT queueKey, primaryEntityId AS serviceId, count\(\) AS spanCount, /);
    expect(query).toContain("ARRAY JOIN entityKeys AS queueKey WHERE TRUE");
    expect(query).toContain(
      "GROUP BY queueKey, serviceId ORDER BY spanCount DESC, queueKey ASC, serviceId ASC LIMIT",
    );
    expect(query).toContain(" AND retentionDate >= now()");
    // An interactive read: stopped with an error at 45 s, its scan bounded.
    expect(query).toContain("max_execution_time = 45");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).toContain("max_threads = 4");
    expect(query).toContain("optimize_move_to_prewhere = 1");
    // Every group has its spans, failed spans and p95.
    for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
      expect(query).toContain(`AS ${population}Count`);
      expect(query).toContain(`AS ${population}Errors`);
      expect(query).toContain(`AS ${population}P95`);
    }
    expect(query).toContain("quantileIf(0.95)(durationUnixNano, ");
  });

  test("the project, the range and the keys are the Overview's own filter, every value bound", () => {
    const rows: Array<MessageQueueTopologyQueueRow> = [
      queue("q1", "kafka", "orders"),
      queue("q2", "rabbitmq", "emails"),
    ];
    const statement: Statement = statementFor(rows);
    const query: string = statement.query;
    const params: Record<string, unknown> = statement.query_params;

    const named: string = withIdentifiers(statement);
    expect(named).toMatch(
      /WHERE TRUE AND projectId = \{p\d+:String\} AND startTime >= \{p\d+:DateTime64\(9\)\} AND startTime <= \{p\d+:DateTime64\(9\)\} AND hasAny\(entityKeys, \{p\d+:Array\(String\)\}\) AND queueKey IN \{p\d+:Array\(String\)\}/,
    );
    expect(named).toContain("FROM SpanItemV3 ARRAY JOIN entityKeys AS queueKey");
    expect(query).toMatch(/AND queueKey IN \{p\d+:Array\(String\)\}/);

    const values: Array<unknown> = Object.values(params);
    expect(values).toContain(PROJECT_ID.toString());
    const keyLists: Array<Array<string>> = values.filter(
      (value: unknown): value is Array<string> => {
        return (
          Array.isArray(value) &&
          value.includes(keyOf(rows[0]!)) &&
          value.includes(keyOf(rows[1]!))
        );
      },
    );
    // Once for the bloom-indexed prefilter, once for the joined key.
    expect(keyLists.length).toBeGreaterThanOrEqual(2);
    // No key or project id is written into the SQL text.
    expect(query).not.toContain(keyOf(rows[0]!));
    expect(query).not.toContain(PROJECT_ID.toString());
  });

  test("a group every queue reads alike is one filter; the groups no queue reads count nothing", () => {
    const query: string = statementFor([
      queue("q1", "kafka", "orders"),
      queue("q2", "rabbitmq", "emails"),
    ]).query;

    // Kafka and RabbitMQ read "consume" alike: no per-key branch.
    const consume: string = query.slice(
      query.indexOf("AS sendP95"),
      query.indexOf("AS consumeCount"),
    );
    expect(consume).not.toContain("has(");
    expect(consume).toContain("(1 AND ");
    // Neither reads AWS sends nor received batches.
    expect(query).toContain("countIf(0) AS awsSendCount");
    expect(query).toContain("countIf(0) AS receivedBatchCount");
  });

  test("SQS reads its receives apart: one branch per filter, each over its own queues' keys", () => {
    const kafka: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const sqs: MessageQueueTopologyQueueRow = queue("q2", "aws_sqs", "payments");
    const statement: Statement = statementFor([kafka, sqs]);
    const query: string = statement.query;
    const params: Record<string, unknown> = statement.query_params;

    const consume: string = query.slice(
      query.indexOf("AS awsSendP95"),
      query.indexOf("AS consumeCount"),
    );
    // Two branches, each `has(<its keys>, queueKey)`.
    expect(consume.match(/has\(\{p\d+:Array\(String\)\}, queueKey\)/g)).toHaveLength(2);

    // The received batches: SQS only, so a branch over the SQS key alone.
    const batches: string = query.slice(
      query.indexOf("AS consumeP95"),
      query.indexOf("AS receivedBatchCount"),
    );
    const branchParams: Array<string> = Array.from(
      batches.matchAll(/has\(\{(p\d+):Array\(String\)\}, queueKey\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(branchParams).toHaveLength(1);
    expect(params[branchParams[0]!]).toEqual([keyOf(sqs)]);

    // AWS sends: SQS only too.
    const awsSend: string = query.slice(
      query.indexOf("AS sendP95"),
      query.indexOf("AS awsSendCount"),
    );
    const awsParams: Array<string> = Array.from(
      awsSend.matchAll(/has\(\{(p\d+):Array\(String\)\}, queueKey\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(awsParams).toHaveLength(1);
    expect(params[awsParams[0]!]).toEqual([keyOf(sqs)]);
  });

  test("a project whose every queue is SQS reads its groups with no branch at all", () => {
    const query: string = statementFor([
      queue("q1", "aws_sqs", "orders"),
      queue("q2", "aws_sqs", "payments"),
    ]).query;
    expect(query).not.toContain("has(");
    expect(query).not.toContain("countIf(0)");
  });

  test("the failed spans of a group are the group's, filtered as errorsOnly filters them", () => {
    const query: string = statementFor([queue("q1", "kafka", "orders")]).query;
    const publishErrors: string = query.slice(
      query.indexOf("AS publishCount"),
      query.indexOf("AS publishErrors"),
    );
    expect(publishErrors).toMatch(/\{p\d+:Identifier\} = \{p\d+:Int32\}\)\) $/);
    const statement: Statement = statementFor([queue("q1", "kafka", "orders")]);
    const match: RegExpMatchArray | null = withIdentifiers(statement).match(
      /countIf\(\(\(1 AND kind = \{(p\d+):String\}\) AND statusCode = \{(p\d+):Int32\}\)\) AS publishErrors/,
    );
    expect(match).not.toBeNull();
    // The publish group is PRODUCER spans, its failures the error status.
    expect(statement.query_params[match![1]!]).toBe("SPAN_KIND_PRODUCER");
    expect(statement.query_params[match![2]!]).toBe(2);
  });

  test("the caller's read scope narrows the services, both ways", () => {
    const kept: ObjectID = new ObjectID(SERVICE_A);
    const blocked: ObjectID = new ObjectID(SERVICE_B);
    const statement: Statement = statementFor(
      [queue("q1", "kafka", "orders")],
      { serviceIds: [kept], excludedServiceIds: [blocked] },
    );
    expect(statement.query).toMatch(
      /AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(statement.query).toMatch(
      /AND primaryEntityId NOT IN \(\{p\d+:Array\(String\)\}\)/,
    );
    const values: Array<unknown> = Object.values(statement.query_params);
    expect(values).toContainEqual([SERVICE_A]);
    expect(values).toContainEqual([SERVICE_B]);
  });

  test("a project-wide reader's read names no service", () => {
    expect(statementFor([queue("q1", "kafka", "orders")]).query).not.toContain(
      "primaryEntityId IN",
    );
  });

  test("the row limit is bound", () => {
    const statement: Statement = buildMessageQueueTopologyStatement({
      generator: generator(),
      projectId: PROJECT_ID,
      keys: buildMessageQueueTopologyKeys(PROJECT_ID, [
        queue("q1", "kafka", "orders"),
      ]),
      window: { startTime: START, endTime: END },
      serviceFilter: {},
      rowLimit: 1234,
    });
    expect(statement.query).toMatch(/LIMIT \{p\d+:Int32\}/);
    expect(Object.values(statement.query_params)).toContain(1234);
  });

});

describe("the rows", () => {
  test("counts arrive as text and are read as numbers; a p95 in nanoseconds is read in milliseconds", () => {
    const rows: Array<MessageQueueTopologyPairRow> =
      readMessageQueueTopologyRows([
        {
          queueKey: "k1",
          serviceId: SERVICE_A,
          spanCount: "12",
          errorCount: "2",
          publishCount: "10",
          publishErrors: "1",
          publishP95: 25_000_000,
          consumeCount: "0",
          consumeErrors: "0",
          consumeP95: null,
        } as JSONObject,
      ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spans).toBe(12);
    expect(rows[0]!.errors).toBe(2);
    expect(rows[0]!.groups["publish"]).toEqual({
      count: 10,
      errors: 1,
      p95Ms: 25,
    });
    expect(rows[0]!.groups["consume"]).toEqual({
      count: 0,
      errors: 0,
      p95Ms: null,
    });
    // A column the row lacks reads as nothing.
    expect(rows[0]!.groups["receivedBatch"]).toEqual({
      count: 0,
      errors: 0,
      p95Ms: null,
    });
  });

  test("a p95 is scaled as the cards scale theirs, to the last bit (ClickHouse's interpolated quantiles)", () => {
    /*
     * ClickHouse's quantile interpolates between ranks, so a p95 in
     * nanoseconds is seldom whole milliseconds; for these, dividing by a
     * million and multiplying by its reciprocal - as the cards do - give
     * two different doubles, and a line would not be its row.
     */
    const p95s: Array<number> = [22807691318, 13577981454.5, 9549999.999999999];
    const rows: Array<MessageQueueTopologyPairRow> =
      readMessageQueueTopologyRows(
        p95s.map((p95: number, index: number): JSONObject => {
          return {
            queueKey: `k${index}`,
            serviceId: SERVICE_A,
            spanCount: "1",
            publishCount: "1",
            publishP95: p95,
          } as JSONObject;
        }),
      );
    rows.forEach((row: MessageQueueTopologyPairRow, index: number) => {
      expect(row.groups["publish"]!.p95Ms).toBe(
        p95s[index]! * MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
      );
    });
    expect(rows[0]!.groups["publish"]!.p95Ms).not.toBe(22807691318 / 1_000_000);
    expect(MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND).toBe(1 / 1_000_000);
  });

  test("failed spans never exceed the spans; a p95 that is not a number reads as none", () => {
    const rows: Array<MessageQueueTopologyPairRow> =
      readMessageQueueTopologyRows([
        {
          queueKey: "k1",
          serviceId: SERVICE_A,
          spanCount: "3",
          errorCount: "9",
          sendCount: "2",
          sendErrors: "5",
          sendP95: "nan",
        } as JSONObject,
      ]);
    expect(rows[0]!.errors).toBe(3);
    expect(rows[0]!.groups["send"]).toEqual({ count: 2, errors: 2, p95Ms: null });
  });

  test("a row without a queue key is left out; a row without a service is the service-less row", () => {
    const rows: Array<MessageQueueTopologyPairRow> =
      readMessageQueueTopologyRows([
        { queueKey: "", serviceId: SERVICE_A, spanCount: "3" } as JSONObject,
        { serviceId: SERVICE_A, spanCount: "3" } as JSONObject,
        { queueKey: "k1", serviceId: null, spanCount: "4" } as JSONObject,
        { queueKey: " k2 ", spanCount: "1" } as JSONObject,
      ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.serviceId).toBe("");
    expect(rows[1]!.queueKey).toBe("k2");
    expect(rows[1]!.serviceId).toBe("");
  });

  test.each([["-4"], ["abc"], [""], [null], [Number.POSITIVE_INFINITY], ["7.9"]])(
    "a count of %j reads as a whole number of at least 0",
    (value: unknown) => {
      const rows: Array<MessageQueueTopologyPairRow> =
        readMessageQueueTopologyRows([
          { queueKey: "k1", serviceId: SERVICE_A, spanCount: value } as JSONObject,
        ]);
      expect(Number.isInteger(rows[0]!.spans)).toBe(true);
      expect(rows[0]!.spans).toBeGreaterThanOrEqual(0);
      if (value === "7.9") {
        expect(rows[0]!.spans).toBe(7);
      }
    },
  );
});

function assemble(
  queues: Array<MessageQueueTopologyQueueRow>,
  pairs: Array<MessageQueueTopologyPairRow>,
  names?: Map<string, string>,
): MessageQueueTopologyResponse {
  return assembleMessageQueueTopology({
    window: { startTime: START, endTime: END },
    queues: queues,
    keys: buildMessageQueueTopologyKeys(PROJECT_ID, queues),
    pairs: pairs,
    serviceNames: names || new Map<string, string>(),
    truncation: { queues: false, flows: false },
  });
}

function flowsOf(
  response: MessageQueueTopologyResponse,
  queueId: string,
  direction: "publish" | "consume",
): Array<MessageQueueTopologyFlow> {
  return response.flows.filter((flow: MessageQueueTopologyFlow): boolean => {
    return flow.queueId === queueId && flow.direction === direction;
  });
}

describe("the map", () => {
  test("a producer's and a consumer's row are their cards' rows; the queue's figures are the tiles'", () => {
    const orders: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const key: string = keyOf(orders);
    const response: MessageQueueTopologyResponse = assemble(
      [orders],
      [
        pair(key, SERVICE_A, { publish: { count: 100, errors: 2, p95Ms: 4 } }),
        pair(key, SERVICE_B, { consume: { count: 90, errors: 9, p95Ms: 30 } }),
      ],
      new Map([
        [SERVICE_A, "checkout"],
        [SERVICE_B, "fulfilment"],
      ]),
    );

    expect(response.queues).toHaveLength(1);
    expect(response.queues[0]).toMatchObject({
      id: "q1",
      name: "orders",
      messagingSystem: "kafka",
      spans: 190,
      errors: 0,
      published: 100,
      consumed: 90,
      queueIdentifier: "kafka||orders",
      lastSeenAt: "2026-11-07T11:55:00.000Z",
      brokerMetricsLastSeenAt: null,
    });
    expect(flowsOf(response, "q1", "publish")).toEqual([
      {
        queueId: "q1",
        serviceId: SERVICE_A,
        direction: "publish",
        messages: 100,
        errors: 2,
        errorRatePercent: 2,
        p95DurationMs: 4,
      },
    ]);
    expect(flowsOf(response, "q1", "consume")).toEqual([
      {
        queueId: "q1",
        serviceId: SERVICE_B,
        direction: "consume",
        messages: 90,
        errors: 9,
        errorRatePercent: 10,
        p95DurationMs: 30,
      },
    ]);
    expect(response.services).toEqual([
      { id: SERVICE_A, name: "checkout" },
      { id: SERVICE_B, name: "fulfilment" },
    ]);
    expect(response.startTime).toBe(START.toISOString());
    expect(response.endTime).toBe(END.toISOString());
  });

  test("a service that records its publishes only as client sends is counted from them, and Published adds them", () => {
    const orders: MessageQueueTopologyQueueRow = queue(
      "q1",
      "servicebus",
      "orders",
      { brokerScope: "orders-prod", queueIdentifier: "servicebus|orders-prod|orders" },
    );
    const key: string = keyOf(orders);
    const response: MessageQueueTopologyResponse = assemble(
      [orders],
      [
        // An Azure SDK sender: a producer marker per message, and its sends.
        pair(key, SERVICE_A, {
          publish: { count: 50, p95Ms: 0 },
          send: { count: 50, errors: 5, p95Ms: 12 },
        }),
        // A Go sender that records sends alone.
        pair(key, SERVICE_C, { send: { count: 20, errors: 0, p95Ms: 8 } }),
      ],
    );

    const producers: Array<MessageQueueTopologyFlow> = flowsOf(
      response,
      "q1",
      "publish",
    );
    expect(producers).toEqual([
      expect.objectContaining({
        serviceId: SERVICE_A,
        messages: 50,
        errors: 5,
        errorRatePercent: 10,
        p95DurationMs: 12,
      }),
      expect.objectContaining({
        serviceId: SERVICE_C,
        messages: 20,
        errors: 0,
        p95DurationMs: 8,
      }),
    ]);
    // The producer spans, and the client-only sender's sends.
    expect(response.queues[0]!.published).toBe(70);
  });

  test("on SQS the received batches are consumed messages, never a processing time", () => {
    const payments: MessageQueueTopologyQueueRow = queue(
      "q1",
      "aws_sqs",
      "payments",
    );
    const key: string = keyOf(payments);
    const response: MessageQueueTopologyResponse = assemble(
      [payments],
      [
        pair(key, SERVICE_B, {
          consume: { count: 30, errors: 3, p95Ms: 40 },
          receivedBatch: { count: 6, p95Ms: 20000 },
        }),
      ],
    );
    expect(flowsOf(response, "q1", "consume")).toEqual([
      expect.objectContaining({
        serviceId: SERVICE_B,
        messages: 36,
        errors: 3,
        p95DurationMs: 40,
      }),
    ]);
    expect(response.queues[0]!.consumed).toBe(36);
  });

  test("spans no service recorded count in the queue's figures, and make no line", () => {
    const orders: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const key: string = keyOf(orders);
    const response: MessageQueueTopologyResponse = assemble(
      [orders],
      [
        pair(key, "", { publish: { count: 7 }, consume: { count: 3 } }, 12, 4),
        pair(key, SERVICE_A, { publish: { count: 5 } }),
      ],
    );
    expect(response.queues[0]).toMatchObject({
      spans: 17,
      errors: 4,
      published: 12,
      consumed: 3,
    });
    expect(response.flows).toHaveLength(1);
    expect(response.services.map((service) => service.id)).toEqual([SERVICE_A]);
  });

  test("a queue with no span is listed with nothing on it; a row for a key of no queue is left out", () => {
    const quiet: MessageQueueTopologyQueueRow = queue("q1", "kafka", "audit");
    const response: MessageQueueTopologyResponse = assemble(
      [quiet],
      [pair("a-key-no-queue-has", SERVICE_A, { publish: { count: 5 } })],
    );
    expect(response.queues[0]).toMatchObject({
      spans: 0,
      errors: 0,
      published: 0,
      consumed: 0,
    });
    expect(response.flows).toEqual([]);
    expect(response.services).toEqual([]);
  });

  test("every service is a line, not the cards' busiest ten", () => {
    const orders: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const key: string = keyOf(orders);
    const pairs: Array<MessageQueueTopologyPairRow> = [];
    for (let index: number = 0; index < 25; index++) {
      pairs.push(
        pair(
          key,
          `3c0e7b2a-1111-4111-8111-0000000001${String(index).padStart(2, "0")}`,
          { consume: { count: index + 1 } },
        ),
      );
    }
    const response: MessageQueueTopologyResponse = assemble([orders], pairs);
    expect(flowsOf(response, "q1", "consume")).toHaveLength(25);
    // Busiest first, as the cards order them.
    expect(flowsOf(response, "q1", "consume")[0]!.messages).toBe(25);
  });

  test("an unnamed service is listed with no name", () => {
    const orders: MessageQueueTopologyQueueRow = queue("q1", "kafka", "orders");
    const response: MessageQueueTopologyResponse = assemble(
      [orders],
      [pair(keyOf(orders), SERVICE_A, { publish: { count: 1 } })],
      new Map([[SERVICE_B, "someone else"]]),
    );
    expect(response.services).toEqual([{ id: SERVICE_A, name: "" }]);
  });

  test("the truncation is the read's, and dates that are no date read as none", () => {
    const response: MessageQueueTopologyResponse = assembleMessageQueueTopology(
      {
        window: { startTime: START, endTime: END },
        queues: [
          queue("q1", "kafka", "orders", {
            lastSeenAt: "garbage",
            brokerMetricsLastSeenAt: "2026-11-07T10:00:00.000Z",
          }),
        ],
        keys: buildMessageQueueTopologyKeys(PROJECT_ID, []),
        pairs: [],
        serviceNames: new Map(),
        truncation: { queues: true, flows: false },
      },
    );
    expect(response.truncation).toEqual({ queues: true, flows: false });
    expect(response.queues[0]!.lastSeenAt).toBeNull();
    expect(response.queues[0]!.brokerMetricsLastSeenAt).toBe(
      "2026-11-07T10:00:00.000Z",
    );
  });

  test("over random pairs, every line is its card's row and every figure holds together", () => {
    const random: SeededRandom = seededRandom(6189);
    const services: Array<string> = [SERVICE_A, SERVICE_B, SERVICE_C, ""];
    for (let round: number = 0; round < 200; round++) {
      const queues: Array<MessageQueueTopologyQueueRow> = [
        queue("q1", "kafka", "orders"),
        queue("q2", "aws_sqs", "payments"),
        queue("q3", "servicebus", "emails"),
      ];
      const pairs: Array<MessageQueueTopologyPairRow> = [];
      for (const row of queues) {
        for (const service of services) {
          if (random(3) === 0) {
            continue;
          }
          const groups: Record<string, { count: number; errors: number; p95Ms: number }> = {};
          let spans: number = 0;
          let errors: number = 0;
          for (const population of MESSAGE_QUEUE_TOPOLOGY_GROUPS) {
            const count: number = random(2) === 0 ? 0 : random(40);
            const failed: number = count > 0 ? random(count + 1) : 0;
            groups[population] = { count, errors: failed, p95Ms: random(500) };
            spans += count;
            errors += failed;
          }
          pairs.push(pair(keyOf(row), service, groups, spans + random(5), errors));
        }
      }
      const response: MessageQueueTopologyResponse = assemble(queues, pairs);

      for (const row of queues) {
        const own: Array<MessageQueueTopologyPairRow> = pairs.filter(
          (candidate: MessageQueueTopologyPairRow): boolean => {
            return candidate.queueKey === keyOf(row);
          },
        );
        const figures = (population: string) => {
          const counts: Map<string, number> = new Map();
          const errorsByService: Map<string, number> = new Map();
          const p95: Map<string, number> = new Map();
          for (const candidate of own) {
            const group = candidate.groups[population]!;
            if (!candidate.serviceId || group.count <= 0) {
              continue;
            }
            counts.set(candidate.serviceId, group.count);
            errorsByService.set(candidate.serviceId, group.errors);
            if (group.p95Ms !== null) {
              p95.set(candidate.serviceId, group.p95Ms);
            }
          }
          return { counts, errors: errorsByService, p95Ms: p95 };
        };
        const producers = combineMessageQueueProducerServices({
          producer: figures("publish"),
          sends: [figures("send"), figures("awsSend")],
          limit: Number.POSITIVE_INFINITY,
        });
        const consumers = combineMessageQueueConsumerServices({
          consume: figures("consume"),
          receivedBatches: figures("receivedBatch"),
          limit: Number.POSITIVE_INFINITY,
        });
        expect(
          flowsOf(response, row.id, "publish").map((flow) => {
            return [flow.serviceId, flow.messages, flow.errors, flow.p95DurationMs];
          }),
        ).toEqual(
          producers.services.map((service) => {
            return [service.serviceId, service.calls, service.errors, service.p95DurationMs];
          }),
        );
        expect(
          flowsOf(response, row.id, "consume").map((flow) => {
            return [flow.serviceId, flow.messages, flow.errors, flow.p95DurationMs];
          }),
        ).toEqual(
          consumers.services.map((service) => {
            return [service.serviceId, service.calls, service.errors, service.p95DurationMs];
          }),
        );
        const assembled = response.queues.find((candidate) => {
          return candidate.id === row.id;
        })!;
        expect(assembled.errors).toBeLessThanOrEqual(assembled.spans);
        expect(assembled.published).toBeGreaterThanOrEqual(
          flowsOf(response, row.id, "publish")
            .filter((flow) => {
              return !producers.clientOnlyServiceIds.includes(flow.serviceId);
            })
            .reduce((total: number, flow) => {
              return total + flow.messages;
            }, 0),
        );
      }
      for (const flow of response.flows) {
        /*
         * A sender counted from producer markers fails by its sends, which
         * can outnumber its messages: its rate, not its errors, is bounded.
         */
        if (flow.errorRatePercent !== null) {
          expect(flow.errorRatePercent).toBeGreaterThanOrEqual(0);
          expect(flow.errorRatePercent).toBeLessThanOrEqual(100);
        }
        expect(flow.messages).toBeGreaterThan(0);
        expect(
          response.services.some((service) => {
            return service.id === flow.serviceId;
          }),
        ).toBe(true);
      }
    }
  });
});
