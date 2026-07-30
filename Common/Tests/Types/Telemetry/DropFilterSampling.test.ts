import {
  isSamplePercentageConfigured,
  KEEP_ALL_PERCENTAGE,
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
  resolveSamplePercentage,
  shouldDropBySampling,
} from "../../../Types/Telemetry/DropFilterSampling";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — how a drop filter's `samplePercentage` turns into a
 * keep/discard decision.
 *
 * This replaced `filter.samplePercentage || 50`, duplicated in the log and
 * trace drop-filter engines. That expression silently destroyed data three
 * ways, and each one has a test below:
 *
 *   1. `samplePercentage` is nullable with no default and its form field was
 *      optional, so an UNSET percentage meant "discard half of every
 *      matching record" — a number nobody chose.
 *   2. A stored `0` is falsy, so it was indistinguishable from unset and
 *      also kept 50%, contradicting both the literal reading ("keep 0%") and
 *      the view page's display of "0% kept".
 *   3. Two copies of the expression could drift apart.
 *
 * The rule now is to fail SAFE: any percentage we cannot honour makes the
 * filter a no-op rather than a shredder. `drop` exists for "discard
 * everything matching", so nothing of value is lost by refusing to guess.
 */

describe("resolveSamplePercentage", () => {
  it("honours a percentage inside the usable range", () => {
    expect(resolveSamplePercentage(1)).toBe(1);
    expect(resolveSamplePercentage(10)).toBe(10);
    expect(resolveSamplePercentage(50)).toBe(50);
    expect(resolveSamplePercentage(99)).toBe(99);
  });

  it("honours a fractional percentage inside the range", () => {
    expect(resolveSamplePercentage(0.5)).toBe(0.5);
    expect(resolveSamplePercentage(99.9)).toBe(99.9);
  });

  /*
   * The headline regression. `undefined || 50` was 50, so a sample filter
   * saved with no percentage threw away roughly half of everything it
   * matched, and nothing recorded that it had happened.
   */
  it("resolves an UNSET percentage to keep-everything, not the old 50", () => {
    expect(resolveSamplePercentage(undefined)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(null)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(undefined)).not.toBe(50);
    expect(resolveSamplePercentage(null)).not.toBe(50);
  });

  /*
   * 0 never meant "keep nothing" in any shipped version — it was falsy, so
   * it kept half. Honouring it literally now would start deleting data that
   * used to survive, so it is treated as misconfigured instead.
   */
  it("treats 0 as misconfigured rather than 'discard everything'", () => {
    expect(resolveSamplePercentage(0)).toBe(KEEP_ALL_PERCENTAGE);
  });

  it("treats a negative percentage as misconfigured", () => {
    expect(resolveSamplePercentage(-1)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(-100)).toBe(KEEP_ALL_PERCENTAGE);
  });

  it("clamps 100 and above to keep-everything", () => {
    expect(resolveSamplePercentage(100)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(1000)).toBe(KEEP_ALL_PERCENTAGE);
  });

  it("rejects non-finite numbers", () => {
    expect(resolveSamplePercentage(NaN)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(Infinity)).toBe(KEEP_ALL_PERCENTAGE);
    expect(resolveSamplePercentage(-Infinity)).toBe(KEEP_ALL_PERCENTAGE);
  });

  /*
   * The column is nullable and typed `number`, but the value arrives through
   * a bigint-free JSON boundary and a form. A string that happens to look
   * like a number must not be treated as one — `"50" || 50` would have been
   * "50", and `Math.random() * 100 >= "50"` coerces, so the old code would
   * have sampled on a string. Now it fails safe.
   */
  it("rejects a value that is not a number at all", () => {
    expect(resolveSamplePercentage("10" as unknown as number)).toBe(
      KEEP_ALL_PERCENTAGE,
    );
    expect(resolveSamplePercentage({} as unknown as number)).toBe(
      KEEP_ALL_PERCENTAGE,
    );
    expect(resolveSamplePercentage([] as unknown as number)).toBe(
      KEEP_ALL_PERCENTAGE,
    );
    expect(resolveSamplePercentage(true as unknown as number)).toBe(
      KEEP_ALL_PERCENTAGE,
    );
  });

  it("accepts both ends of the range the validator enforces", () => {
    expect(resolveSamplePercentage(MIN_SAMPLE_PERCENTAGE)).toBe(
      MIN_SAMPLE_PERCENTAGE,
    );
    expect(resolveSamplePercentage(MAX_SAMPLE_PERCENTAGE)).toBe(
      MAX_SAMPLE_PERCENTAGE,
    );
  });
});

describe("isSamplePercentageConfigured", () => {
  it("is true only for a percentage the engine will actually sample on", () => {
    expect(isSamplePercentageConfigured(1)).toBe(true);
    expect(isSamplePercentageConfigured(50)).toBe(true);
    expect(isSamplePercentageConfigured(99)).toBe(true);
  });

  /*
   * This is what the view page keys off. It used to render `|| 0` as
   * "0% kept / 100% discarded" for an unset percentage while the engine kept
   * half — the display and the behaviour disagreed, and both were wrong.
   */
  it("is false for the values that used to render as '0% kept'", () => {
    expect(isSamplePercentageConfigured(undefined)).toBe(false);
    expect(isSamplePercentageConfigured(null)).toBe(false);
    expect(isSamplePercentageConfigured(0)).toBe(false);
  });

  it("is false at and above 100, where sampling is a no-op", () => {
    expect(isSamplePercentageConfigured(100)).toBe(false);
    expect(isSamplePercentageConfigured(150)).toBe(false);
  });
});

describe("shouldDropBySampling", () => {
  /*
   * `random` is injected so these are exact assertions rather than
   * statistical ones. The engine keeps a record when
   * `random() * 100 < keepPercentage`.
   */
  const fixedRandom: (value: number) => () => number = (
    value: number,
  ): (() => number) => {
    return (): number => {
      return value;
    };
  };

  it("keeps a record when the draw lands inside the keep window", () => {
    // 0.05 * 100 = 5, which is < 10, so this record is kept.
    expect(shouldDropBySampling(10, fixedRandom(0.05))).toBe(false);
  });

  it("drops a record when the draw lands outside the keep window", () => {
    // 0.5 * 100 = 50, which is >= 10, so this record is dropped.
    expect(shouldDropBySampling(10, fixedRandom(0.5))).toBe(true);
  });

  it("drops exactly at the boundary, so keep-10% never keeps 11%", () => {
    // >= is the comparison, so a draw of exactly the keep percentage drops.
    expect(shouldDropBySampling(10, fixedRandom(0.1))).toBe(true);
  });

  it("keeps everything when the percentage is unset", () => {
    for (const draw of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(shouldDropBySampling(undefined, fixedRandom(draw))).toBe(false);
    }
  });

  it("keeps everything when the percentage is 0", () => {
    for (const draw of [0, 0.5, 0.999]) {
      expect(shouldDropBySampling(0, fixedRandom(draw))).toBe(false);
    }
  });

  /*
   * A keep-everything filter should not even consume entropy: the cheap
   * check has to come before the draw, because this runs once per ingested
   * record on the hot path.
   */
  it("does not consult random at all when it is keeping everything", () => {
    let calls: number = 0;
    const countingRandom: () => number = (): number => {
      calls++;
      return 0.5;
    };

    expect(shouldDropBySampling(undefined, countingRandom)).toBe(false);
    expect(shouldDropBySampling(0, countingRandom)).toBe(false);
    expect(shouldDropBySampling(100, countingRandom)).toBe(false);
    expect(calls).toBe(0);
  });

  it("consults random exactly once when it is sampling", () => {
    let calls: number = 0;
    const countingRandom: () => number = (): number => {
      calls++;
      return 0.5;
    };

    shouldDropBySampling(10, countingRandom);
    expect(calls).toBe(1);
  });

  /*
   * End-to-end sanity on the distribution, using a deterministic sweep
   * rather than real randomness so this can never flake.
   */
  it("keeps approximately the requested share over a uniform sweep", () => {
    const draws: Array<number> = [];
    for (let i: number = 0; i < 1000; i++) {
      draws.push(i / 1000);
    }

    for (const keepPercentage of [1, 10, 25, 50, 90, 99]) {
      let kept: number = 0;
      for (const draw of draws) {
        if (!shouldDropBySampling(keepPercentage, fixedRandom(draw))) {
          kept++;
        }
      }
      // Exact for a uniform sweep of 1000 draws over [0, 1).
      expect(kept / 10).toBeCloseTo(keepPercentage, 5);
    }
  });

  it("defaults to Math.random when no generator is injected", () => {
    // keep-99% over many real draws should keep at least one record.
    let keptAtLeastOne: boolean = false;
    for (let i: number = 0; i < 200; i++) {
      if (!shouldDropBySampling(99)) {
        keptAtLeastOne = true;
        break;
      }
    }
    expect(keptAtLeastOne).toBe(true);
  });
});
