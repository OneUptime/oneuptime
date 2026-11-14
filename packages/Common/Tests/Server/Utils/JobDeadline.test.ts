import JobDeadline from "../../../Server/Utils/JobDeadline";
import TimeoutException from "../../../Types/Exception/TimeoutException";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * A queue job's deadline (JobDeadline): it passes when the job's time limit
 * runs out, or when whoever runs the job ends it, and a job that loops
 * stops at its next check. These pin what the jobs rely on: it passes once,
 * with the first reason; it tells every listener, its AbortSignal and its
 * children; and a deadline nobody ends never passes.
 */

describe("JobDeadline", () => {
  test("has not passed until it is ended", () => {
    const deadline: JobDeadline = new JobDeadline({
      endsAt: new Date(Date.now() + 60_000),
    });

    expect(deadline.hasPassed()).toBe(false);
    expect(deadline.getReason()).toBeNull();
    expect(deadline.signal.aborted).toBe(false);
    expect(() => {
      deadline.throwIfPassed();
    }).not.toThrow();
  });

  test("passes when ended, with the reason given, and aborts its signal", () => {
    const deadline: JobDeadline = new JobDeadline();
    const reason: Error = new Error("the run lost its lock");

    deadline.end(reason);

    expect(deadline.hasPassed()).toBe(true);
    expect(deadline.getReason()).toBe(reason);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(() => {
      deadline.throwIfPassed();
    }).toThrow(reason);
  });

  test("passes as a TimeoutException when ended without a reason", () => {
    const deadline: JobDeadline = new JobDeadline();

    deadline.end();

    expect(deadline.getReason()).toBeInstanceOf(TimeoutException);
  });

  test("keeps the first reason: ending it again changes nothing", () => {
    const deadline: JobDeadline = new JobDeadline();
    const first: Error = new Error("first");
    const listener: jest.Mock = jest.fn();

    deadline.onPassed(listener);
    deadline.end(first);
    deadline.end(new Error("second"));

    expect(deadline.getReason()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(first);
  });

  test("tells a listener that came late at once", () => {
    const deadline: JobDeadline = new JobDeadline();
    const reason: Error = new Error("over");
    deadline.end(reason);

    const listener: jest.Mock = jest.fn();
    deadline.onPassed(listener);

    expect(listener).toHaveBeenCalledWith(reason);
  });

  test("tells no listener that stopped listening", () => {
    const deadline: JobDeadline = new JobDeadline();
    const listener: jest.Mock = jest.fn();

    const stop: () => void = deadline.onPassed(listener);
    stop();
    deadline.end();

    expect(listener).not.toHaveBeenCalled();
  });

  test("a listener that throws does not keep the others from hearing it", () => {
    const deadline: JobDeadline = new JobDeadline();
    const after: jest.Mock = jest.fn();

    deadline.onPassed(() => {
      throw new Error("listener failed");
    });
    deadline.onPassed(after);

    expect(() => {
      deadline.end();
    }).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  test("a child passes when its parent does, with the parent's reason", () => {
    const parent: JobDeadline = new JobDeadline({
      endsAt: new Date(Date.now() + 1000),
    });
    const child: JobDeadline = new JobDeadline({ parent });
    const reason: TimeoutException = new TimeoutException("Job Timeout");

    expect(child.endsAt).toEqual(parent.endsAt);

    parent.end(reason);

    expect(child.hasPassed()).toBe(true);
    expect(child.getReason()).toBe(reason);
    expect(child.signal.aborted).toBe(true);
  });

  test("a child can be ended on its own, and its parent goes on", () => {
    const parent: JobDeadline = new JobDeadline();
    const child: JobDeadline = new JobDeadline({ parent });

    child.end(new Error("lock lost"));

    expect(child.hasPassed()).toBe(true);
    expect(parent.hasPassed()).toBe(false);

    // The ended child no longer listens to its parent.
    parent.end(new Error("later"));
    expect(child.getReason()?.message).toBe("lock lost");
  });

  test("a child of a parent that passed already starts passed", () => {
    const parent: JobDeadline = new JobDeadline();
    const reason: Error = new Error("over");
    parent.end(reason);

    const child: JobDeadline = new JobDeadline({ parent });

    expect(child.hasPassed()).toBe(true);
    expect(child.getReason()).toBe(reason);
  });

  test("says how long is left of its time limit, and nothing without one", () => {
    const now: Date = new Date("2026-11-14T10:00:00.000Z");
    const deadline: JobDeadline = new JobDeadline({
      endsAt: new Date("2026-11-14T10:00:30.000Z"),
    });

    expect(deadline.getRemainingMs(now)).toBe(30_000);
    expect(
      deadline.getRemainingMs(new Date("2026-11-14T10:01:00.000Z")),
    ).toBe(0);
    expect(JobDeadline.none().getRemainingMs(now)).toBeNull();
  });

  test("none() never passes on its own", () => {
    const deadline: JobDeadline = JobDeadline.none();

    expect(deadline.endsAt).toBeNull();
    expect(deadline.hasPassed()).toBe(false);
  });
});
