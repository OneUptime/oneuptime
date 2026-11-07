import {
  EMPTY_MESSAGE_QUEUE_TOPOLOGY_TRUNCATION,
  MESSAGE_QUEUE_TOPOLOGY_API_PATH,
  MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
  MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES,
  MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS,
  MessageQueueTopologyFlow,
  MessageQueueTopologyResponse,
  MessageQueueTopologyService,
  getMessageQueueTopologyFlowKey,
  readMessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * The Queues topology's contract: the path, the limits, and how the
 * Dashboard reads an answer - defensively, so an odd row from an older or
 * newer server is left out rather than breaking the map, and never by
 * throwing.
 */

const QUEUE: Record<string, unknown> = {
  id: "q1",
  name: "orders",
  messagingSystem: "kafka",
  destinationName: "orders",
  brokerScope: "",
  brokerAddress: "kafka-1:9092",
  queueIdentifier: "kafka||orders",
  discoverySource: "traces",
  lastSeenAt: "2026-11-07T11:55:00.000Z",
  brokerMetricsLastSeenAt: null,
  spans: 190,
  errors: 4,
  published: 100,
  consumed: 90,
};

const FLOW: Record<string, unknown> = {
  queueId: "q1",
  serviceId: "s1",
  direction: "publish",
  messages: 100,
  errors: 2,
  errorRatePercent: 2,
  p95DurationMs: 4.5,
};

function answer(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    startTime: "2026-11-07T11:00:00.000Z",
    endTime: "2026-11-07T12:00:00.000Z",
    queues: [QUEUE],
    services: [{ id: "s1", name: "checkout" }],
    flows: [FLOW],
    truncation: { queues: false, flows: false },
    ...overrides,
  };
}

describe("the contract", () => {
  test("the path is under /telemetry, which no CRUD router claims", () => {
    expect(MESSAGE_QUEUE_TOPOLOGY_API_PATH).toBe(
      "/telemetry/message-queues/topology",
    );
  });

  test("the limits: 93 days, the project's live queues in one read, a cap on pairs", () => {
    expect(MESSAGE_QUEUE_TOPOLOGY_MAX_RANGE_MS).toBe(93 * 24 * 60 * 60 * 1000);
    // The queues are read in one findBy, whose limit is at most LIMIT_MAX.
    expect(MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES).toBeLessThanOrEqual(LIMIT_MAX);
    expect(MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS).toBeGreaterThan(
      MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES,
    );
    expect(EMPTY_MESSAGE_QUEUE_TOPOLOGY_TRUNCATION).toEqual({
      queues: false,
      flows: false,
    });
  });

  test("a flow's key is its direction, service and queue", () => {
    expect(
      getMessageQueueTopologyFlowKey({
        queueId: "q1",
        serviceId: "s1",
        direction: "consume",
      }),
    ).toBe("consume|s1|q1");
  });
});

describe("reading an answer", () => {
  test("a whole answer reads as it was sent", () => {
    const read: MessageQueueTopologyResponse =
      readMessageQueueTopologyResponse(answer());
    expect(read).toEqual({
      startTime: "2026-11-07T11:00:00.000Z",
      endTime: "2026-11-07T12:00:00.000Z",
      queues: [QUEUE],
      services: [{ id: "s1", name: "checkout" }],
      flows: [FLOW],
      truncation: { queues: false, flows: false },
    });
  });

  test.each([[null], [undefined], ["a string"], [42], [[]], [true]])(
    "%j reads as an empty topology",
    (value: unknown) => {
      expect(readMessageQueueTopologyResponse(value)).toEqual({
        startTime: "",
        endTime: "",
        queues: [],
        services: [],
        flows: [],
        truncation: { queues: false, flows: false },
      });
    },
  );

  test("a queue without an id, or that is not an object, is left out; one listed twice is kept once", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({
        queues: [
          QUEUE,
          { ...QUEUE, name: "a second copy" },
          { ...QUEUE, id: "" },
          { ...QUEUE, id: "   " },
          "q2",
          null,
          [QUEUE],
        ],
      }),
    );
    expect(read.queues).toHaveLength(1);
    expect(read.queues[0]!.name).toBe("orders");
  });

  test("a queue's counts are whole numbers of at least 0, its failed spans some of its spans", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({
        queues: [
          {
            ...QUEUE,
            spans: "12",
            errors: 50,
            published: -3,
            consumed: "lots",
          },
        ],
        flows: [],
      }),
    );
    expect(read.queues[0]).toMatchObject({
      spans: 12,
      errors: 12,
      published: 0,
      consumed: 0,
    });
  });

  test("text fields that are not text read as empty, and dates that do not parse as none", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({
        queues: [
          {
            id: 7,
            name: { not: "text" },
            messagingSystem: null,
            lastSeenAt: "yesterday-ish",
            brokerMetricsLastSeenAt: "2026-11-07T10:00:00.000Z",
          },
        ],
        flows: [],
      }),
    );
    expect(read.queues[0]).toEqual({
      id: "7",
      name: "",
      messagingSystem: "",
      destinationName: "",
      brokerScope: "",
      brokerAddress: "",
      queueIdentifier: "",
      discoverySource: "",
      lastSeenAt: null,
      brokerMetricsLastSeenAt: "2026-11-07T10:00:00.000Z",
      spans: 0,
      errors: 0,
      published: 0,
      consumed: 0,
    });
  });

  test("a flow of no queue in the answer, no direction, or no message is left out", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({
        flows: [
          FLOW,
          { ...FLOW, queueId: "q-unknown" },
          { ...FLOW, direction: "sideways" },
          { ...FLOW, serviceId: "" },
          { ...FLOW, messages: 0 },
          { ...FLOW, direction: "consume", messages: "-1" },
          "flow",
        ],
      }),
    );
    expect(read.flows).toEqual([FLOW]);
  });

  test("a flow's failures are the card's, even past its messages; its rate is held to 0-100", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({
        flows: [
          { ...FLOW, messages: 13, errors: 31, errorRatePercent: 77.5 },
          {
            ...FLOW,
            direction: "consume",
            errorRatePercent: 250,
            p95DurationMs: -5,
          },
        ],
      }),
    );
    expect(read.flows[0]).toMatchObject({
      messages: 13,
      errors: 31,
      errorRatePercent: 77.5,
    });
    expect(read.flows[1]).toMatchObject({
      errorRatePercent: 100,
      p95DurationMs: null,
    });
  });

  test("a flow listed twice is kept once, the first", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({ flows: [FLOW, { ...FLOW, messages: 999 }] }),
    );
    expect(read.flows).toHaveLength(1);
    expect(read.flows[0]!.messages).toBe(100);
  });

  test("a service a flow names but the answer does not list is added, unnamed", () => {
    const read: MessageQueueTopologyResponse = readMessageQueueTopologyResponse(
      answer({ services: [], flows: [FLOW] }),
    );
    expect(read.services).toEqual([{ id: "s1", name: "" }]);
  });

  test("the truncation reads true only for true", () => {
    expect(
      readMessageQueueTopologyResponse(
        answer({ truncation: { queues: "yes", flows: true } }),
      ).truncation,
    ).toEqual({ queues: false, flows: true });
    expect(
      readMessageQueueTopologyResponse(answer({ truncation: "all" }))
        .truncation,
    ).toEqual({ queues: false, flows: false });
  });

  test("over generated junk, reading never throws and every row it keeps holds together", () => {
    const random: SeededRandom = seededRandom(61891);
    const texts: Array<string> = generatedTexts(400, 6189, [
      "q1",
      "s1",
      "publish",
      "consume",
      "",
      " ",
      "-",
      "7",
      "nan",
      "1e3",
      "null",
    ]);
    const values: Array<unknown> = [
      ...texts,
      null,
      undefined,
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      [],
      true,
    ];
    const pick: () => unknown = (): unknown => {
      return values[random(values.length)];
    };

    for (let round: number = 0; round < 400; round++) {
      const queues: Array<unknown> = [];
      const flows: Array<unknown> = [];
      for (let index: number = 0; index < random(6); index++) {
        queues.push({
          id: random(2) === 0 ? "q1" : pick(),
          name: pick(),
          spans: pick(),
          errors: pick(),
          published: pick(),
          consumed: pick(),
          lastSeenAt: pick(),
        });
      }
      for (let index: number = 0; index < random(8); index++) {
        flows.push({
          queueId: random(2) === 0 ? "q1" : pick(),
          serviceId: random(2) === 0 ? "s1" : pick(),
          direction: random(2) === 0 ? "publish" : pick(),
          messages: pick(),
          errors: pick(),
          errorRatePercent: pick(),
          p95DurationMs: pick(),
        });
      }
      const read: MessageQueueTopologyResponse =
        readMessageQueueTopologyResponse({
          queues: random(5) === 0 ? pick() : queues,
          services: random(3) === 0 ? pick() : [{ id: pick(), name: pick() }],
          flows: flows,
          startTime: pick(),
        });

      const queueIds: Set<string> = new Set<string>();
      for (const queue of read.queues) {
        expect(queue.id.trim()).not.toBe("");
        expect(queueIds.has(queue.id)).toBe(false);
        queueIds.add(queue.id);
        expect(queue.errors).toBeLessThanOrEqual(queue.spans);
        for (const count of [
          queue.spans,
          queue.errors,
          queue.published,
          queue.consumed,
        ]) {
          expect(Number.isInteger(count) && count >= 0).toBe(true);
        }
      }
      const flowKeys: Set<string> = new Set<string>();
      for (const flow of read.flows as Array<MessageQueueTopologyFlow>) {
        expect(queueIds.has(flow.queueId)).toBe(true);
        expect(["publish", "consume"]).toContain(flow.direction);
        expect(flow.messages).toBeGreaterThan(0);
        expect(
          read.services.some((service: MessageQueueTopologyService) => {
            return service.id === flow.serviceId;
          }),
        ).toBe(true);
        if (flow.errorRatePercent !== null) {
          expect(flow.errorRatePercent).toBeGreaterThanOrEqual(0);
          expect(flow.errorRatePercent).toBeLessThanOrEqual(100);
        }
        const key: string = getMessageQueueTopologyFlowKey(flow);
        expect(flowKeys.has(key)).toBe(false);
        flowKeys.add(key);
      }
    }
  });
});
