import ProbeSchedulingLane from "../../../../Server/Utils/Probe/ProbeSchedulingLane";
import ProbeSchedulingReconnectInstance, {
  PROBE_SCHEDULING_RECONNECT_EVERY_MS,
  ProbeSchedulingReconnect,
} from "../../../../Server/Utils/Probe/ProbeSchedulingReconnect";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A PROBE SCHEDULING ANSWER ASKS ITS CLIENT TO RECONNECT (issue #11121).
 *
 * While a lane of a process has requests waiting for a slot, the answer to
 * a request it ran says "Connection: close", so the probe's (or nginx's)
 * next request opens a new connection, which kube-proxy may send to a pod
 * KEDA added. At most one answer per lane every
 * PROBE_SCHEDULING_RECONNECT_EVERY_MS asks: a backed-up pod sheds a few
 * connections a second, never one per request. A clock of the test's own.
 */

function withClock(start: number = 1_000_000): {
  reconnect: ProbeSchedulingReconnect;
  advance: (ms: number) => void;
  set: (at: number) => void;
} {
  let now: number = start;

  return {
    reconnect: new ProbeSchedulingReconnect(
      PROBE_SCHEDULING_RECONNECT_EVERY_MS,
      (): number => {
        return now;
      },
    ),
    advance: (ms: number): void => {
      now += ms;
    },
    set: (at: number): void => {
      now = at;
    },
  };
}

const WORK: ProbeSchedulingLane = ProbeSchedulingLane.Work;
const TESTS: ProbeSchedulingLane = ProbeSchedulingLane.MonitorTests;

describe("ProbeSchedulingReconnect", () => {
  test("sheds a few connections a second, never one a request", () => {
    expect(PROBE_SCHEDULING_RECONNECT_EVERY_MS).toBeGreaterThanOrEqual(50);
    expect(PROBE_SCHEDULING_RECONNECT_EVERY_MS).toBeLessThanOrEqual(1000);
  });

  test("a lane with nothing waiting asks nobody to reconnect, however often it answers", () => {
    const { reconnect, advance } = withClock();

    for (let answer: number = 0; answer < 100; answer++) {
      expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 0 })).toBe(
        false,
      );
      advance(PROBE_SCHEDULING_RECONNECT_EVERY_MS * 2);
    }
  });

  test("while requests wait, the first answer asks, and the next ones only once the interval has passed", () => {
    const { reconnect, advance } = withClock();

    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 3 })).toBe(
      true,
    );
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 3 })).toBe(
      false,
    );

    advance(PROBE_SCHEDULING_RECONNECT_EVERY_MS - 1);
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 9 })).toBe(
      false,
    );

    advance(1);
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 1 })).toBe(
      true,
    );
  });

  test("a burst of answers while backed up asks once per interval: a second of them, ten at most", () => {
    const { reconnect, advance } = withClock();
    let asked: number = 0;

    // 200 answers over one second, all while requests wait.
    for (let answer: number = 0; answer < 200; answer++) {
      if (reconnect.shouldAskToReconnect({ lane: WORK, waiting: 20 })) {
        asked++;
      }
      advance(5);
    }

    expect(asked).toBe(1000 / PROBE_SCHEDULING_RECONNECT_EVERY_MS);
  });

  test("an answer while nothing waits neither asks nor counts: the next backed-up answer still may", () => {
    const { reconnect, advance } = withClock();

    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 2 })).toBe(
      true,
    );
    advance(PROBE_SCHEDULING_RECONNECT_EVERY_MS);
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 0 })).toBe(
      false,
    );
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 2 })).toBe(
      true,
    );
  });

  test("each lane sheds on its own: a backed-up work lane does not spend the Test Monitor lane's ask", () => {
    const { reconnect } = withClock();

    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 5 })).toBe(
      true,
    );
    expect(reconnect.shouldAskToReconnect({ lane: TESTS, waiting: 1 })).toBe(
      true,
    );
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 5 })).toBe(
      false,
    );
    expect(reconnect.shouldAskToReconnect({ lane: TESTS, waiting: 1 })).toBe(
      false,
    );
  });

  test("a clock that went back does not stop it asking", () => {
    const { reconnect, set } = withClock(5_000_000);

    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 1 })).toBe(
      true,
    );
    set(4_000_000);
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 1 })).toBe(
      true,
    );
  });

  test("a count of waiting requests that is not a number above 0 asks nobody", () => {
    const { reconnect } = withClock();

    for (const waiting of [-1, Number.NaN, 0]) {
      expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting })).toBe(
        false,
      );
    }
  });

  test("by default it reads the real clock", () => {
    const reconnect: ProbeSchedulingReconnect = new ProbeSchedulingReconnect();

    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 1 })).toBe(
      true,
    );
    expect(reconnect.shouldAskToReconnect({ lane: WORK, waiting: 1 })).toBe(
      false,
    );
  });

  test("the process has one, which the probe scheduling middleware asks", () => {
    expect(ProbeSchedulingReconnectInstance).toBeInstanceOf(
      ProbeSchedulingReconnect,
    );
  });
});
