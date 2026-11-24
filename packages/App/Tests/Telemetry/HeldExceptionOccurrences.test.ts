import HeldExceptionOccurrences, {
  HELD_OCCURRENCE_RETRY_MS,
  MAX_HELD_EXCEPTION_GROUPS,
} from "../../FeatureSet/Telemetry/Utils/HeldExceptionOccurrences";
import ExceptionUtil, {
  AggregatedException,
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE OCCURRENCES HELD WHILE THEIR EXCEPTIONS CANNOT BE READ (#11027).
 *
 * An occurrence whose exception could not be known is held, and goes with a
 * later batch's upsert. Held, the occurrences of one exception and release
 * are kept as two - the earliest and the latest, the latest counting those
 * between - and the upsert must count them exactly as it would have counted
 * every one of them: how many, the first and last seen and the release of
 * each, whether any escaped uncaught, and the texts.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-000000011027",
);
const PROJECT_B: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000011027",
);
const SERVICE: ObjectID = new ObjectID("c0000000-0000-4000-8000-000000011027");
const T0: number = Date.UTC(2026, 10, 24, 12, 0, 0);

function payload(data: {
  at: number;
  projectId?: ObjectID;
  release?: string;
  unhandled?: boolean;
  message?: string;
  fingerprint?: string;
}): TelemetryExceptionPayload {
  return {
    fingerprint: data.fingerprint || "v1",
    fingerprintV2: "v2",
    fingerprintCandidates: ["v1", "v2"],
    projectId: data.projectId || PROJECT_A,
    primaryEntityId: SERVICE,
    exceptionType: "TypeError",
    message: data.message === undefined ? "boom" : data.message,
    stackTrace: "",
    occurredAt: new Date(data.at),
    ...(data.release !== undefined ? { release: data.release } : {}),
    ...(data.unhandled !== undefined ? { unhandled: data.unhandled } : {}),
  };
}

// What the upsert counts for these payloads, once they are all of one exception.
function counted(
  payloads: Array<TelemetryExceptionPayload>,
): AggregatedException {
  const aggregated: Map<string, AggregatedException> =
    ExceptionUtil.aggregateExceptions(
      payloads.map((each: TelemetryExceptionPayload) => {
        return { ...each, fingerprint: "chosen" };
      }),
      new Date(T0 + 24 * 60 * 60 * 1000),
    );

  expect(aggregated.size).toBe(1);

  return Array.from(aggregated.values())[0]!;
}

function hold(
  payloads: Array<TelemetryExceptionPayload>,
  key: string = "exception-1",
  now: number = T0,
): void {
  HeldExceptionOccurrences.hold(
    payloads.map((each: TelemetryExceptionPayload) => {
      return { key, payload: each };
    }),
    now,
  );
}

function takeAll(): Array<TelemetryExceptionPayload> {
  return HeldExceptionOccurrences.take(Number.MAX_SAFE_INTEGER);
}

describe("held exception occurrences", () => {
  beforeEach(() => {
    HeldExceptionOccurrences.clear();
    jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    HeldExceptionOccurrences.clear();
    jest.restoreAllMocks();
  });

  test("one held occurrence comes back as it went in", () => {
    const one: TelemetryExceptionPayload = payload({ at: T0, release: "1.0" });

    hold([one]);

    expect(HeldExceptionOccurrences.count()).toBe(1);
    expect(takeAll()).toEqual([one]);
    expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
  });

  test("a burst of one exception is held as two, and counted as every one of them", () => {
    const burst: Array<TelemetryExceptionPayload> = [];

    // Out of order, as a backed-up queue delivers them.
    for (let index: number = 0; index < 1000; index++) {
      burst.push(
        payload({ at: T0 + ((index * 7919) % 1000) * 1000, release: "1.0" }),
      );
    }

    hold(burst);

    const back: Array<TelemetryExceptionPayload> = takeAll();

    expect(back).toHaveLength(2);
    expect(counted(back)).toEqual(counted(burst));
    expect(counted(back).occuranceCount).toBe(1000);
    expect(counted(back).firstSeenAt.getTime()).toBe(T0);
    expect(counted(back).lastSeenAt.getTime()).toBe(T0 + 999 * 1000);
  });

  test("each release is held apart, so the first and last seen releases are the earliest's and the latest's", () => {
    const occurrences: Array<TelemetryExceptionPayload> = [
      payload({ at: T0 + 5000, release: "1.1" }),
      payload({ at: T0 + 1000, release: "1.0" }),
      payload({ at: T0 + 9000, release: "1.1" }),
      payload({ at: T0 + 3000, release: "1.0" }),
      payload({ at: T0 + 7000, release: "" }),
      payload({ at: T0 + 2000, release: "1.0" }),
    ];

    hold(occurrences);

    const back: Array<TelemetryExceptionPayload> = takeAll();

    expect(counted(back)).toEqual(counted(occurrences));
    expect(counted(back).firstSeenInRelease).toBe("1.0");
    expect(counted(back).lastSeenInRelease).toBe("1.1");
    expect(counted(back).occuranceCount).toBe(6);
  });

  test("one occurrence that escaped uncaught, anywhere in the burst, makes the exception unhandled", () => {
    for (const unhandledAt of [0, 1, 2, 3, 4]) {
      HeldExceptionOccurrences.clear();

      const occurrences: Array<TelemetryExceptionPayload> = [0, 1, 2, 3, 4].map(
        (index: number) => {
          return payload({
            at: T0 + [3, 1, 4, 0, 2][index]! * 1000,
            unhandled: index === unhandledAt,
          });
        },
      );

      hold(occurrences);

      expect(counted(takeAll()).unhandled).toBe(true);
    }
  });

  test("the texts survive when only some occurrences carry them", () => {
    const occurrences: Array<TelemetryExceptionPayload> = [
      payload({ at: T0, message: "" }),
      payload({ at: T0 + 2000, message: "" }),
      payload({ at: T0 + 1000, message: "Order failed" }),
    ];

    hold(occurrences);

    expect(counted(takeAll()).message).toBe("Order failed");
  });

  test("occurrences of two exceptions are held apart", () => {
    hold([payload({ at: T0 }), payload({ at: T0 + 1000 })], "first");
    hold([payload({ at: T0 + 500, fingerprint: "other-v1" })], "second");

    const back: Array<TelemetryExceptionPayload> = takeAll();

    expect(back).toHaveLength(3);
    expect(
      back.filter((each: TelemetryExceptionPayload) => {
        return each.fingerprint === "other-v1";
      }),
    ).toHaveLength(1);
  });

  test("held ones are taken with a batch of their project at once, and with any batch once they have waited", () => {
    hold([payload({ at: T0, projectId: PROJECT_A })], "a", T0);
    hold([payload({ at: T0, projectId: PROJECT_B })], "b", T0);

    // A batch of project A: A's are tried, B's wait.
    const withA: Array<TelemetryExceptionPayload> =
      HeldExceptionOccurrences.take(
        T0 + 1,
        new Set<string>([PROJECT_A.toString()]),
      );

    expect(
      withA.map((each: TelemetryExceptionPayload) => {
        return each.projectId.toString();
      }),
    ).toEqual([PROJECT_A.toString()]);

    // Another of project A before B's have waited: B's still wait.
    expect(
      HeldExceptionOccurrences.take(
        T0 + HELD_OCCURRENCE_RETRY_MS - 1,
        new Set<string>([PROJECT_A.toString()]),
      ),
    ).toEqual([]);

    // Once they have, any batch takes them.
    expect(
      HeldExceptionOccurrences.take(
        T0 + HELD_OCCURRENCE_RETRY_MS,
        new Set<string>(),
      ).map((each: TelemetryExceptionPayload) => {
        return each.projectId.toString();
      }),
    ).toEqual([PROJECT_B.toString()]);
    expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
  });

  test("held again after another failed try, an occurrence waits again from then", () => {
    hold([payload({ at: T0 })], "a", T0);

    const back: Array<TelemetryExceptionPayload> =
      HeldExceptionOccurrences.take(T0 + HELD_OCCURRENCE_RETRY_MS);

    hold(back, "a", T0 + HELD_OCCURRENCE_RETRY_MS);

    expect(
      HeldExceptionOccurrences.take(T0 + HELD_OCCURRENCE_RETRY_MS + 1),
    ).toEqual([]);
    expect(
      HeldExceptionOccurrences.take(T0 + 2 * HELD_OCCURRENCE_RETRY_MS),
    ).toHaveLength(1);
  });

  test("held and taken again and again, a burst is still counted exactly", () => {
    const occurrences: Array<TelemetryExceptionPayload> = [];

    for (let round: number = 0; round < 5; round++) {
      const batch: Array<TelemetryExceptionPayload> = [];

      for (let index: number = 0; index < 20; index++) {
        batch.push(
          payload({
            at: T0 + (((round * 20 + index) * 4099) % 100000),
            release: index % 2 === 0 ? "1.0" : "1.1",
            unhandled: round === 3 && index === 7,
          }),
        );
      }

      occurrences.push(...batch);
      // Each round, what was held is tried and fails again, with the round's own.
      hold([...takeAll(), ...batch]);
    }

    const back: Array<TelemetryExceptionPayload> = takeAll();

    expect(back.length).toBeLessThanOrEqual(4);
    expect(counted(back)).toEqual(counted(occurrences));
    expect(counted(back).occuranceCount).toBe(100);
  });

  test("never more than MAX_HELD_EXCEPTION_GROUPS exceptions: the one held longest is let go, and says so", () => {
    for (let index: number = 0; index <= MAX_HELD_EXCEPTION_GROUPS; index++) {
      hold([payload({ at: T0, fingerprint: `v1-${index}` })], `key-${index}`);
    }

    const back: Array<TelemetryExceptionPayload> = takeAll();

    expect(back).toHaveLength(MAX_HELD_EXCEPTION_GROUPS);
    expect(
      back.some((each: TelemetryExceptionPayload) => {
        return each.fingerprint === "v1-0";
      }),
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("a payload held keeps nothing of the caller's object: changing one never changes the other", () => {
    const one: TelemetryExceptionPayload = payload({ at: T0 });
    const two: TelemetryExceptionPayload = payload({ at: T0 + 1000 });
    const three: TelemetryExceptionPayload = payload({ at: T0 + 2000 });

    hold([one, two, three]);

    expect(one.occurrences).toBeUndefined();
    expect(two.occurrences).toBeUndefined();
    expect(three.occurrences).toBeUndefined();
  });
});
