import AIWorkloadLimits, {
  MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES,
  MIN_AI_MAX_CONCURRENT_INVESTIGATIONS,
} from "../../../Types/AI/AIWorkloadLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * The rules every limit on autonomous AI work shares. The product promise
 * these pin: AI works out of the box, so a limit a project has not set is no
 * limit at all — not a built-in default that quietly holds AI back — while a
 * limit a project does set is honoured.
 */

describe("AIWorkloadLimits.getMaxConcurrentInvestigations", () => {
  test.each([
    [null],
    [undefined],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [""],
    ["abc"],
  ])("%p means no cap", (value: number | string | null | undefined) => {
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(value)).toBeNull();
  });

  test("a set cap is honoured as it is", () => {
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(1)).toBe(1);
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(3)).toBe(3);
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(25)).toBe(25);
  });

  /*
   * The cap used to be clamped to 25 even when a project asked for more, so a
   * project could not get past an artificial ceiling by raising the setting.
   */
  test("there is no ceiling on a cap a project asks for", () => {
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(26)).toBe(26);
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(500)).toBe(500);
  });

  test.each([[0], [-1], [-50]])(
    "a cap of %p reads as the minimum, never as paused",
    (value: number) => {
      expect(AIWorkloadLimits.getMaxConcurrentInvestigations(value)).toBe(
        MIN_AI_MAX_CONCURRENT_INVESTIGATIONS,
      );
    },
  );

  test("the minimum is one investigation at a time", () => {
    expect(MIN_AI_MAX_CONCURRENT_INVESTIGATIONS).toBe(1);
  });

  test("a fractional cap rounds down to whole investigations", () => {
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations(2.9)).toBe(2);
  });

  test("a numeric string is read as its number", () => {
    expect(AIWorkloadLimits.getMaxConcurrentInvestigations("7")).toBe(7);
  });
});

describe("AIWorkloadLimits.getCooldownInMinutes", () => {
  test.each([[null], [undefined], [Number.NaN], [""], ["abc"]])(
    "%p means no cooldown",
    (value: number | string | null | undefined) => {
      expect(AIWorkloadLimits.getCooldownInMinutes(value)).toBe(0);
    },
  );

  test.each([[0], [-1], [-30]])(
    "%p means no cooldown rather than an inverted window",
    (value: number) => {
      expect(AIWorkloadLimits.getCooldownInMinutes(value)).toBe(0);
    },
  );

  test("a set cooldown is honoured as it is", () => {
    expect(AIWorkloadLimits.getCooldownInMinutes(1)).toBe(1);
    expect(AIWorkloadLimits.getCooldownInMinutes(30)).toBe(30);
    expect(AIWorkloadLimits.getCooldownInMinutes(45)).toBe(45);
  });

  test("a cooldown longer than a day is clamped to a day", () => {
    expect(MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES).toBe(24 * 60);
    expect(AIWorkloadLimits.getCooldownInMinutes(24 * 60)).toBe(24 * 60);
    expect(AIWorkloadLimits.getCooldownInMinutes(24 * 60 + 1)).toBe(24 * 60);
    expect(AIWorkloadLimits.getCooldownInMinutes(60 * 24 * 365)).toBe(
      MAX_AI_INVESTIGATION_COOLDOWN_IN_MINUTES,
    );
  });

  test("a fractional cooldown rounds down to whole minutes", () => {
    expect(AIWorkloadLimits.getCooldownInMinutes(10.7)).toBe(10);
    expect(AIWorkloadLimits.getCooldownInMinutes(0.5)).toBe(0);
  });

  test("a numeric string is read as its number", () => {
    expect(AIWorkloadLimits.getCooldownInMinutes("15")).toBe(15);
  });
});
