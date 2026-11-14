import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MonitorHeartbeatState, {
  HeartbeatKind,
  HeartbeatWrite,
} from "../../../../Server/Utils/Monitor/MonitorHeartbeatState";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What the heartbeat paths keep in Redis instead of rewriting the Monitor
 * row (MonitorHeartbeatState): write fences, server report arrivals, and
 * what the last evaluation of a heartbeat judged.
 *
 * The rule that matters most: a sweep may skip evaluating a heartbeat
 * monitor only when the evaluation would judge exactly what the last one
 * did. So the cases here are every way that could stop being true - a new
 * arrival, a window that has passed, other criteria, another status, a
 * filter that changes without an arrival, a Redis that fails.
 *
 * Redis is a map; it can be made to fail.
 */

jest.mock("../../../../Server/Utils/Logger");

let redis: Map<string, string>;
let expiries: Map<string, number>;
let redisFails: boolean;

const monitorId: ObjectID = ObjectID.generate();
const otherMonitorId: ObjectID = ObjectID.generate();
const ONLINE: ObjectID = ObjectID.generate();
const OFFLINE: ObjectID = ObjectID.generate();

const ARRIVED_AT: Date = new Date("2026-11-14T10:00:00.000Z");

function minutesAfterArrival(minutes: number): Date {
  return new Date(ARRIVED_AT.getTime() + minutes * 60 * 1000);
}

function filter(values: Partial<CriteriaFilter>): CriteriaFilter {
  return {
    checkOn: CheckOn.IncomingRequest,
    filterType: FilterType.RecievedInMinutes,
    value: 5,
    ...values,
  } as CriteriaFilter;
}

function stepsWith(
  ...filtersOfEachCriteria: Array<Array<CriteriaFilter>>
): MonitorSteps {
  const instances: Array<MonitorCriteriaInstance> = filtersOfEachCriteria.map(
    (filters: Array<CriteriaFilter>) => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data!.filters = filters;
      return instance;
    },
  );

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

// The default heartbeat criteria: received in 5 minutes / not received in 5.
const HEARTBEAT_STEPS: MonitorSteps = stepsWith(
  [filter({ filterType: FilterType.RecievedInMinutes, value: 5 })],
  [filter({ filterType: FilterType.NotRecievedInMinutes, value: 5 })],
);

beforeEach(() => {
  redis = new Map<string, string>();
  expiries = new Map<string, number>();
  redisFails = false;

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        redis.set(`${namespace}-${key}`, value);
        expiries.set(`${namespace}-${key}`, options?.expiresInSeconds || 0);
      },
    );

  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: number,
        options: { expiresInSeconds: number },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        const name: string = `${namespace}-${key}`;
        const stored: number | undefined = redis.has(name)
          ? Number(redis.get(name))
          : undefined;

        expiries.set(name, options.expiresInSeconds);

        if (stored === undefined || value > stored) {
          redis.set(name, String(value));
          return value;
        }

        return stored;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("write fences", () => {
  test("a write nothing fenced is due", async () => {
    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.ServerReport,
      }),
    ).toBe(true);
  });

  test("a write just made is not due again until its fence expires", async () => {
    await MonitorHeartbeatState.markWritten({
      monitorId,
      write: HeartbeatWrite.ServerReport,
      everySeconds: 120,
    });

    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.ServerReport,
      }),
    ).toBe(false);
    expect(Array.from(expiries.values())).toEqual([120]);

    // Redis expired it.
    redis.clear();

    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.ServerReport,
      }),
    ).toBe(true);
  });

  test("a different fingerprint is due at once; the same one is not", async () => {
    await MonitorHeartbeatState.markWritten({
      monitorId,
      write: HeartbeatWrite.IncomingRequest,
      fingerprint: "a",
      everySeconds: 120,
    });

    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.IncomingRequest,
        fingerprint: "a",
      }),
    ).toBe(false);
    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.IncomingRequest,
        fingerprint: "b",
      }),
    ).toBe(true);
  });

  test("fences are per monitor and per kind of write", async () => {
    await MonitorHeartbeatState.markWritten({
      monitorId,
      write: HeartbeatWrite.IncomingRequestCheck,
      everySeconds: 300,
    });

    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId: otherMonitorId,
        write: HeartbeatWrite.IncomingRequestCheck,
      }),
    ).toBe(true);
    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.IncomingEmailCheck,
      }),
    ).toBe(true);
  });

  test("a Redis that fails fences nothing: every write is due", async () => {
    await MonitorHeartbeatState.markWritten({
      monitorId,
      write: HeartbeatWrite.ServerReport,
      everySeconds: 120,
    });

    redisFails = true;

    expect(
      await MonitorHeartbeatState.isWriteDue({
        monitorId,
        write: HeartbeatWrite.ServerReport,
      }),
    ).toBe(true);
    await expect(
      MonitorHeartbeatState.markWritten({
        monitorId,
        write: HeartbeatWrite.ServerReport,
        everySeconds: 120,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("server report arrivals", () => {
  test("the latest report is kept, whatever order they arrive in", async () => {
    await MonitorHeartbeatState.recordServerReport({
      monitorId,
      receivedAt: minutesAfterArrival(1),
    });
    await MonitorHeartbeatState.recordServerReport({
      monitorId,
      receivedAt: ARRIVED_AT,
    });

    expect(
      (
        await MonitorHeartbeatState.getServerReportReceivedAt(monitorId)
      )?.getTime(),
    ).toBe(minutesAfterArrival(1).getTime());
    expect(Array.from(expiries.values())).toEqual([
      MonitorHeartbeatState.RECEIPT_EXPIRES_IN_SECONDS,
    ]);
  });

  test("a time sent as text is kept as the same moment", async () => {
    await MonitorHeartbeatState.recordServerReport({
      monitorId,
      receivedAt: ARRIVED_AT.toISOString(),
    });

    expect(
      (
        await MonitorHeartbeatState.getServerReportReceivedAt(monitorId)
      )?.getTime(),
    ).toBe(ARRIVED_AT.getTime());
  });

  test("another monitor's reports are not this one's, and nothing kept is unknown", async () => {
    await MonitorHeartbeatState.recordServerReport({
      monitorId: otherMonitorId,
      receivedAt: ARRIVED_AT,
    });

    expect(
      await MonitorHeartbeatState.getServerReportReceivedAt(monitorId),
    ).toBeNull();
  });

  test("a Redis that fails keeps nothing and knows nothing, and never throws", async () => {
    redisFails = true;

    await expect(
      MonitorHeartbeatState.recordServerReport({
        monitorId,
        receivedAt: ARRIVED_AT,
      }),
    ).resolves.toBeUndefined();
    await expect(
      MonitorHeartbeatState.getServerReportReceivedAt(monitorId),
    ).resolves.toBeNull();
  });
});

describe("the shortest heartbeat window", () => {
  test("is the shortest received / not-received window any criteria names", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: stepsWith(
          [filter({ value: 10 })],
          [filter({ filterType: FilterType.NotRecievedInMinutes, value: 3 })],
        ),
      }),
    ).toBe(3 * 60 * 1000);
  });

  test("reads the minutes as the criteria do, from text too", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: stepsWith([filter({ value: "7" })]),
      }),
    ).toBe(7 * 60 * 1000);
  });

  test("filters only an arrival changes leave it as it is", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: stepsWith([
          filter({ value: 5 }),
          filter({
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "ok",
          }),
          filter({
            checkOn: CheckOn.RequestHeader,
            filterType: FilterType.Contains,
            value: "x-token",
          }),
        ]),
      }),
    ).toBe(5 * 60 * 1000);
  });

  test("there is none when a filter can change without an arrival", () => {
    for (const other of [
      filter({ checkOn: CheckOn.JavaScriptExpression, value: "true" }),
      filter({ checkOn: CheckOn.IsOnline, filterType: FilterType.True }),
      filter({ value: 5, evaluateOverTime: true }),
      filter({
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "ok",
        evaluateOverTime: true,
      }),
    ]) {
      expect(
        MonitorHeartbeatState.getShortestWindowInMs({
          kind: HeartbeatKind.IncomingRequest,
          monitorSteps: stepsWith([filter({ value: 5 })], [other]),
        }),
      ).toBeNull();
    }
  });

  test("there is none when no criteria names a window, or there are no steps", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: stepsWith([
          filter({
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "ok",
          }),
        ]),
      }),
    ).toBeNull();
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: undefined,
      }),
    ).toBeNull();
  });

  test("a filter that names no minutes is never met, and names no window", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: stepsWith([filter({ value: 0 })], [filter({ value: 5 })]),
      }),
    ).toBe(5 * 60 * 1000);
  });

  test("an email monitor's window is its Email Received filters', and the email's own fields leave it as it is", () => {
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingEmail,
        monitorSteps: stepsWith([
          filter({ checkOn: CheckOn.EmailReceivedAt, value: 60 }),
          filter({
            checkOn: CheckOn.EmailSubject,
            filterType: FilterType.Contains,
            value: "backup ok",
          }),
        ]),
      }),
    ).toBe(60 * 60 * 1000);

    // An incoming request filter on an email monitor is no email filter.
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingEmail,
        monitorSteps: stepsWith([filter({ value: 5 })]),
      }),
    ).toBeNull();
  });
});

describe("skipping an evaluation that would judge what the last one did", () => {
  async function evaluated(
    values: {
      receivedAt?: Date;
      monitorSteps?: MonitorSteps;
      monitorStatusId?: ObjectID;
    } = {},
  ): Promise<void> {
    await MonitorHeartbeatState.markEvaluated({
      kind: HeartbeatKind.IncomingRequest,
      monitorId,
      receivedAt: values.receivedAt || ARRIVED_AT,
      monitorSteps: values.monitorSteps || HEARTBEAT_STEPS,
      monitorStatusId: values.monitorStatusId || ONLINE,
    });
  }

  async function canSkip(values: {
    now: Date;
    receivedAt?: Date | string;
    monitorSteps?: MonitorSteps;
    monitorStatusId?: ObjectID;
    kind?: HeartbeatKind;
    monitor?: ObjectID;
  }): Promise<boolean> {
    return await MonitorHeartbeatState.canSkipEvaluation({
      kind: values.kind || HeartbeatKind.IncomingRequest,
      monitorId: values.monitor || monitorId,
      receivedAt: values.receivedAt || ARRIVED_AT,
      monitorSteps: values.monitorSteps || HEARTBEAT_STEPS,
      monitorStatusId: values.monitorStatusId || ONLINE,
      now: values.now,
    });
  }

  test("the same arrival, criteria and status, inside the window: skipped", async () => {
    await evaluated();

    expect(await canSkip({ now: minutesAfterArrival(1) })).toBe(true);
    expect(await canSkip({ now: minutesAfterArrival(4.99) })).toBe(true);
  });

  test("once the window has passed it is evaluated, every sweep", async () => {
    await evaluated();

    expect(await canSkip({ now: minutesAfterArrival(5) })).toBe(false);
    expect(await canSkip({ now: minutesAfterArrival(30) })).toBe(false);
  });

  test("a newer arrival than the one evaluated is evaluated", async () => {
    await evaluated();

    expect(
      await canSkip({
        now: minutesAfterArrival(2),
        receivedAt: minutesAfterArrival(1),
      }),
    ).toBe(false);
  });

  test("a monitor nothing was evaluated for is evaluated", async () => {
    expect(await canSkip({ now: minutesAfterArrival(1) })).toBe(false);
    await evaluated();
    expect(
      await canSkip({ now: minutesAfterArrival(1), monitor: otherMonitorId }),
    ).toBe(false);
  });

  test("criteria edited since are evaluated", async () => {
    await evaluated();

    expect(
      await canSkip({
        now: minutesAfterArrival(1),
        monitorSteps: stepsWith(
          [filter({ filterType: FilterType.RecievedInMinutes, value: 6 })],
          [filter({ filterType: FilterType.NotRecievedInMinutes, value: 6 })],
        ),
      }),
    ).toBe(false);
  });

  test("a status changed since - by a person, a maintenance event, another evaluation - is evaluated", async () => {
    await evaluated({ monitorStatusId: ONLINE });

    expect(
      await canSkip({ now: minutesAfterArrival(1), monitorStatusId: OFFLINE }),
    ).toBe(false);
  });

  test("a monitor whose criteria judge something that changes without an arrival is never skipped", async () => {
    const steps: MonitorSteps = stepsWith(
      [filter({ value: 5 })],
      [filter({ checkOn: CheckOn.JavaScriptExpression, value: "true" })],
    );

    await evaluated({ monitorSteps: steps });

    expect(
      await canSkip({ now: minutesAfterArrival(1), monitorSteps: steps }),
    ).toBe(false);
  });

  test("an email evaluation is not an incoming request one", async () => {
    await evaluated();

    expect(
      await canSkip({
        now: minutesAfterArrival(1),
        kind: HeartbeatKind.IncomingEmail,
      }),
    ).toBe(false);
  });

  test("an arrival given as text is the same arrival", async () => {
    await evaluated();

    expect(
      await canSkip({
        now: minutesAfterArrival(1),
        receivedAt: ARRIVED_AT.toISOString(),
      }),
    ).toBe(true);
  });

  test("what an evaluation judged is kept for an hour", async () => {
    await evaluated();

    expect(Array.from(expiries.values())).toEqual([
      MonitorHeartbeatState.EVALUATION_EXPIRES_IN_SECONDS,
    ]);
  });

  test("a Redis that fails skips nothing, and never throws", async () => {
    await evaluated();

    redisFails = true;

    await expect(canSkip({ now: minutesAfterArrival(1) })).resolves.toBe(false);
    await expect(evaluated()).resolves.toBeUndefined();
  });
});

describe("fingerprints", () => {
  test("the same content has the same fingerprint, other content another", () => {
    expect(MonitorHeartbeatState.getFingerprint({ a: 1, b: "x" })).toBe(
      MonitorHeartbeatState.getFingerprint({ a: 1, b: "x" }),
    );
    expect(MonitorHeartbeatState.getFingerprint({ a: 1 })).not.toBe(
      MonitorHeartbeatState.getFingerprint({ a: 2 }),
    );
  });
});

describe("an incoming request's fingerprint and write fence", () => {
  const PING: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: monitorId,
    requestHeaders: { "user-agent": "curl/8.12.1", "x-request-id": "a1" },
    requestBody: { status: "ok" },
    requestMethod: HTTPMethod.POST,
    incomingRequestReceivedAt: ARRIVED_AT,
    checkedAt: ARRIVED_AT,
  };

  function fingerprintOf(
    request: Partial<IncomingMonitorRequest>,
    monitorSteps: MonitorSteps = HEARTBEAT_STEPS,
  ): string {
    return MonitorHeartbeatState.getIncomingRequestFingerprint({
      request: { ...PING, ...request },
      monitorSteps: monitorSteps,
    });
  }

  test("the same ping arriving later has the same fingerprint", () => {
    expect(
      fingerprintOf({
        incomingRequestReceivedAt: minutesAfterArrival(1),
        checkedAt: minutesAfterArrival(1),
      }),
    ).toBe(fingerprintOf({}));
  });

  test("another body or method is another fingerprint", () => {
    expect(fingerprintOf({ requestBody: { status: "degraded" } })).not.toBe(
      fingerprintOf({}),
    );
    expect(fingerprintOf({ requestMethod: HTTPMethod.GET })).not.toBe(
      fingerprintOf({}),
    );
  });

  test("headers count only when a filter could read them", () => {
    const otherHeaders: Partial<IncomingMonitorRequest> = {
      requestHeaders: { "user-agent": "curl/8.12.1", "x-request-id": "b2" },
    };

    // Received-in and body filters read no header.
    expect(
      fingerprintOf(
        otherHeaders,
        stepsWith([
          filter({ value: 5 }),
          filter({
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "ok",
          }),
        ]),
      ),
    ).toBe(
      fingerprintOf(
        {},
        stepsWith([
          filter({ value: 5 }),
          filter({
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "ok",
          }),
        ]),
      ),
    );

    for (const readsHeaders of [
      filter({
        checkOn: CheckOn.RequestHeader,
        filterType: FilterType.Contains,
        value: "x-request-id",
      }),
      filter({
        checkOn: CheckOn.RequestHeaderValue,
        filterType: FilterType.Contains,
        value: "a1",
      }),
      filter({ checkOn: CheckOn.JavaScriptExpression, value: "true" }),
    ]) {
      const steps: MonitorSteps = stepsWith([
        filter({ value: 5 }),
        readsHeaders,
      ]);

      expect(fingerprintOf(otherHeaders, steps)).not.toBe(
        fingerprintOf({}, steps),
      );
    }
  });

  test("an unchanged request is fenced for half the shortest window, between fifteen seconds and two minutes", () => {
    for (const [minutes, seconds] of [
      [1, 30],
      [3, 90],
      [5, 120],
      [60, 120],
      [0.25, 15],
    ] as Array<[number, number]>) {
      expect(
        MonitorHeartbeatState.getIncomingRequestWriteEverySeconds(
          stepsWith([filter({ value: minutes })]),
        ),
      ).toBe(seconds);
    }

    // No window at all: the longest fence.
    expect(
      MonitorHeartbeatState.getIncomingRequestWriteEverySeconds(
        stepsWith([
          filter({
            checkOn: CheckOn.RequestBody,
            filterType: FilterType.Contains,
            value: "ok",
          }),
        ]),
      ),
    ).toBe(MonitorHeartbeatState.INCOMING_REQUEST_WRITE_EVERY_SECONDS);
  });

  test("a window filter evaluated over time still sets the fence, though it is never skipped", () => {
    const steps: MonitorSteps = stepsWith([
      filter({ value: 1, evaluateOverTime: true }),
    ]);

    expect(
      MonitorHeartbeatState.getIncomingRequestWriteEverySeconds(steps),
    ).toBe(30);
    expect(
      MonitorHeartbeatState.getShortestWindowInMs({
        kind: HeartbeatKind.IncomingRequest,
        monitorSteps: steps,
      }),
    ).toBeNull();
  });
});
