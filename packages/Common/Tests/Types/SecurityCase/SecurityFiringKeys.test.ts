import {
  SECURITY_FIRING_KEYS_KEPT,
  SECURITY_FIRING_KEY_MAX_LENGTH,
  hasTakenFiring,
  readFiringKeys,
  takeFiring,
} from "../../../Types/SecurityCase/SecurityFiringKeys";
import { describe, expect, test } from "@jest/globals";

/*
 * A FIRING, TAKEN ONCE (#10489): the names a case detection, or a source of
 * an entity's risk, keeps of the firings it took - text only, each once,
 * the latest SECURITY_FIRING_KEYS_KEPT - so a rule's run judged again after
 * its worker stopped hands a firing that is taken once.
 */

function keys(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `run:${index}:each:group`;
  });
}

describe("the names kept", () => {
  test("text only, each once, in the order they were taken", () => {
    expect(
      readFiringKeys(["run:1", 7, null, "", "run:2", "run:1", { a: 1 }]),
    ).toEqual(["run:1", "run:2"]);
  });

  test("anything that is no list keeps none", () => {
    for (const value of [undefined, null, "run:1", 7, { 0: "run:1" }]) {
      expect(readFiringKeys(value)).toEqual([]);
    }
  });

  test("at most the latest few dozen", () => {
    expect(SECURITY_FIRING_KEYS_KEPT).toBe(32);
    expect(readFiringKeys(keys(40))).toEqual(keys(40).slice(-32));
  });

  test("a name too long to be one is not kept", () => {
    expect(
      readFiringKeys(["x".repeat(SECURITY_FIRING_KEY_MAX_LENGTH + 1), "run:1"]),
    ).toEqual(["run:1"]);
  });
});

describe("taking a firing", () => {
  test("a firing is taken once: then it has been", () => {
    const kept: Array<string> = takeFiring([], "run:1");

    expect(kept).toEqual(["run:1"]);
    expect(hasTakenFiring(kept, "run:1")).toBe(true);
    expect(hasTakenFiring(kept, "run:2")).toBe(false);
  });

  test("a firing with no name was never taken, and taking it keeps nothing new", () => {
    expect(hasTakenFiring(["run:1"], undefined)).toBe(false);
    expect(hasTakenFiring(["run:1"], "")).toBe(false);
    expect(takeFiring(["run:1"], undefined)).toEqual(["run:1"]);
  });

  test("the latest last, the oldest dropped past the limit, and one taken again moved last", () => {
    expect(takeFiring(keys(32), "run:new")).toEqual([
      ...keys(32).slice(1),
      "run:new",
    ]);
    expect(takeFiring(["run:1", "run:2"], "run:1")).toEqual(["run:2", "run:1"]);
  });

  test("a stretch's dozen windows of one detection are all among what is kept", () => {
    let kept: Array<string> = keys(20);

    const stretch: Array<string> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): string => {
        return `run:500:${index}:group`;
      },
    );

    for (const key of stretch) {
      kept = takeFiring(kept, key);
    }

    for (const key of stretch) {
      expect(hasTakenFiring(kept, key)).toBe(true);
    }
  });
});
