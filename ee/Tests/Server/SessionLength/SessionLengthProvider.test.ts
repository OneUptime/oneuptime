import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import logger from "Common/Server/Utils/Logger";
import { SessionLengths } from "Common/Types/UserSession/SessionLength";
import {
  SESSION_LENGTHS_CACHE_TTL_IN_MS,
  SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS,
  SESSION_LENGTHS_UNREAD_MESSAGE,
  SessionLengthProvider,
} from "../../../Server/SessionLength/SessionLengthProvider";

/*
 * The session lengths a process holds, and what core is told
 * (EnterpriseServerModule.getUserSessionLengths) at every sign-in, renewal
 * and request that carries a session.
 *
 * What these pin:
 *   - read once, held for the TTL, and read again in the background once
 *     stale: an ask is answered at once from what is held;
 *   - a change (forget) is never answered from what was read before it: the
 *     next ask waits for a read made after it, and a read that was on its
 *     way when the change came never replaces it - whichever lands first;
 *   - asks made together share one read;
 *   - a failed read keeps what was read before and is tried again after a
 *     pause; with nothing read at all the ask throws - a session check that
 *     cannot know the lengths refuses, never "no limit" - and a change ends
 *     the pause at once;
 *   - the read at boot never throws.
 */

const EIGHT_HOURS: SessionLengths = {
  standard: { lengthInMinutes: 480, idleTimeoutInMinutes: null },
  sso: { lengthInMinutes: 480, idleTimeoutInMinutes: null },
};

const ONE_HOUR_IDLE: SessionLengths = {
  standard: { lengthInMinutes: null, idleTimeoutInMinutes: 60 },
  sso: { lengthInMinutes: 720, idleTimeoutInMinutes: 60 },
};

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

const createGate: () => Gate = (): Gate => {
  let open: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return { promise, open };
};

interface Harness {
  provider: SessionLengthProvider;
  clock: { nowMs: number };
  loads: { count: number };
  stored: { value: SessionLengths };
  failure: { value: Error | null };
  // Held reads, in the order they were asked; each answers once opened.
  gates: Array<Gate> | null;
}

const createHarness: (options?: {
  holdReads?: boolean;
}) => Harness = (options?: { holdReads?: boolean }): Harness => {
  const harness: Harness = {
    provider: undefined as unknown as SessionLengthProvider,
    clock: { nowMs: Date.parse("2026-11-02T10:00:00.000Z") },
    loads: { count: 0 },
    stored: { value: EIGHT_HOURS },
    failure: { value: null },
    gates: options?.holdReads ? [] : null,
  };

  harness.provider = new SessionLengthProvider({
    loadLengths: async (): Promise<SessionLengths> => {
      harness.loads.count++;
      // What the database holds when the read is made.
      const value: SessionLengths = harness.stored.value;
      const failure: Error | null = harness.failure.value;

      if (harness.gates) {
        const gate: Gate = createGate();
        harness.gates.push(gate);
        await gate.promise;
      }

      if (failure) {
        throw failure;
      }

      return value;
    },
    now: (): Date => {
      return new Date(harness.clock.nowMs);
    },
    cacheTtlInMs: SESSION_LENGTHS_CACHE_TTL_IN_MS,
    retryAfterFailureInMs: SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS,
  });

  return harness;
};

// Lets every read already on its way land.
const settle: () => Promise<void> = async (): Promise<void> => {
  for (let index: number = 0; index < 10; index++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading and holding the lengths", () => {
  test("the first ask reads them; asks within the TTL are answered from what is held", async () => {
    const harness: Harness = createHarness();

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);

    harness.stored.value = ONE_HOUR_IDLE;
    harness.clock.nowMs += SESSION_LENGTHS_CACHE_TTL_IN_MS - 1;

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    expect(harness.loads.count).toBe(1);
  });

  test("once stale, an ask is answered at once and they are read again behind it", async () => {
    const harness: Harness = createHarness();

    await harness.provider.getLengths();

    harness.stored.value = ONE_HOUR_IDLE;
    harness.clock.nowMs += SESSION_LENGTHS_CACHE_TTL_IN_MS;

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    await settle();

    expect(harness.loads.count).toBe(2);
    await expect(harness.provider.getLengths()).resolves.toEqual(ONE_HOUR_IDLE);
  });

  test("asks made together share one read", async () => {
    const harness: Harness = createHarness({ holdReads: true });

    const asks: Array<Promise<SessionLengths>> = [
      harness.provider.getLengths(),
      harness.provider.getLengths(),
      harness.provider.getLengths(),
    ];

    await settle();
    expect(harness.loads.count).toBe(1);

    harness.gates![0]!.open();

    await expect(Promise.all(asks)).resolves.toEqual([
      EIGHT_HOURS,
      EIGHT_HOURS,
      EIGHT_HOURS,
    ]);
  });

  test("refresh, at boot, reads them for the first request", async () => {
    const harness: Harness = createHarness();

    await expect(harness.provider.refresh()).resolves.toEqual(EIGHT_HOURS);
    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    expect(harness.loads.count).toBe(1);
  });
});

describe("a change of the lengths (forget)", () => {
  test("the very next ask waits for a read made after it", async () => {
    const harness: Harness = createHarness();

    await harness.provider.getLengths();

    harness.stored.value = ONE_HOUR_IDLE;
    harness.provider.forget();

    await expect(harness.provider.getLengths()).resolves.toEqual(ONE_HOUR_IDLE);
    expect(harness.loads.count).toBe(2);
  });

  test("a read on its way when the change came is not the answer, even when it lands last", async () => {
    const harness: Harness = createHarness({ holdReads: true });

    // A read made before the change, still on its way.
    const before: Promise<SessionLengths> = harness.provider.getLengths();
    await settle();

    harness.stored.value = ONE_HOUR_IDLE;
    harness.provider.forget();

    const after: Promise<SessionLengths> = harness.provider.getLengths();
    await settle();

    expect(harness.loads.count).toBe(2);

    // The read made after the change lands first, then the old one.
    harness.gates![1]!.open();
    await expect(after).resolves.toEqual(ONE_HOUR_IDLE);

    harness.gates![0]!.open();
    await expect(before).resolves.toEqual(EIGHT_HOURS);

    await expect(harness.provider.getLengths()).resolves.toEqual(ONE_HOUR_IDLE);
    expect(harness.loads.count).toBe(2);
  });

  test("a read on its way when the change came is not the answer when it lands first, either", async () => {
    const harness: Harness = createHarness({ holdReads: true });

    const before: Promise<SessionLengths> = harness.provider.getLengths();
    await settle();

    harness.stored.value = ONE_HOUR_IDLE;
    harness.provider.forget();

    harness.gates![0]!.open();
    await expect(before).resolves.toEqual(EIGHT_HOURS);

    // The next ask still waits for a read made after the change.
    const after: Promise<SessionLengths> = harness.provider.getLengths();
    await settle();

    expect(harness.loads.count).toBe(2);

    harness.gates![1]!.open();
    await expect(after).resolves.toEqual(ONE_HOUR_IDLE);
  });

  test("never throws", () => {
    const harness: Harness = createHarness();

    expect(() => {
      harness.provider.forget();
      harness.provider.forget();
    }).not.toThrow();
  });
});

describe("a read that fails", () => {
  test("with nothing read yet, the ask throws: a session check that cannot know the lengths refuses", async () => {
    const harness: Harness = createHarness();
    harness.failure.value = new Error("the database went away");

    await expect(harness.provider.getLengths()).rejects.toThrow(
      SESSION_LENGTHS_UNREAD_MESSAGE,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test("with nothing read yet, asks during the pause throw without reading again, and the read is tried after it", async () => {
    const harness: Harness = createHarness();
    harness.failure.value = new Error("the database went away");

    await expect(harness.provider.getLengths()).rejects.toThrow(
      SESSION_LENGTHS_UNREAD_MESSAGE,
    );

    harness.clock.nowMs += SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS - 1;
    await expect(harness.provider.getLengths()).rejects.toThrow(
      SESSION_LENGTHS_UNREAD_MESSAGE,
    );
    expect(harness.loads.count).toBe(1);

    harness.failure.value = null;
    harness.clock.nowMs += 1;

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    expect(harness.loads.count).toBe(2);
  });

  test("with lengths read before, they are kept: a database blip changes nobody's sign-in", async () => {
    const harness: Harness = createHarness();

    await harness.provider.getLengths();

    harness.failure.value = new Error("the database went away");
    harness.clock.nowMs += SESSION_LENGTHS_CACHE_TTL_IN_MS;

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    await settle();

    // In the pause: answered from what is held, nothing read.
    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    expect(harness.loads.count).toBe(2);
  });

  test("after a change, a failed read answers with what was held before: never no lengths", async () => {
    const harness: Harness = createHarness();

    await harness.provider.getLengths();

    harness.failure.value = new Error("the database went away");
    harness.provider.forget();

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
  });

  test("a change ends the pause: the database has just answered a write", async () => {
    const harness: Harness = createHarness();
    harness.failure.value = new Error("the database went away");

    await expect(harness.provider.getLengths()).rejects.toThrow(
      SESSION_LENGTHS_UNREAD_MESSAGE,
    );

    harness.failure.value = null;
    harness.provider.forget();

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
    expect(harness.loads.count).toBe(2);
  });

  test("refresh never throws: a failed read at boot is tried again at the next ask", async () => {
    const harness: Harness = createHarness();
    harness.failure.value = new Error("not up yet");

    await expect(harness.provider.refresh()).resolves.toBeNull();

    harness.failure.value = null;
    harness.clock.nowMs += SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS;

    await expect(harness.provider.getLengths()).resolves.toEqual(EIGHT_HOURS);
  });
});

describe("the defaults", () => {
  test("held for 30 seconds, and a failed read tried again after 5", () => {
    expect(SESSION_LENGTHS_CACHE_TTL_IN_MS).toBe(30 * 1000);
    expect(SESSION_LENGTHS_RETRY_AFTER_FAILURE_IN_MS).toBe(5 * 1000);
  });
});
