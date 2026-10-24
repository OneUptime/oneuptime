/*
 * The gates slow code is filed by (Utils/Profiles/ProfileInsight): nobody
 * asked for these findings, so they are held to more than the Profiler's
 * "Fix with AI" offer, and never to less.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import {
  PROFILE_INSIGHT_BASELINE_OFFSET_HOURS,
  PROFILE_INSIGHT_CATEGORIES,
  PROFILE_INSIGHT_HIGH_GROWTH_POINTS,
  PROFILE_INSIGHT_HIGH_SHARE_PERCENT,
  PROFILE_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  PROFILE_INSIGHT_MAX_SERVICES_PER_SCAN,
  PROFILE_INSIGHT_MIN_BASELINE_SAMPLES,
  PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES,
  PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT,
  PROFILE_INSIGHT_MIN_GROWTH_POINTS,
  PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT,
  PROFILE_INSIGHT_MIN_WINDOW_SAMPLES,
  PROFILE_INSIGHT_WINDOW_MINUTES,
  ProfileInsightReading,
  getProfileInsightFingerprint,
  getProfileInsightReason,
  getProfileInsightSeverity,
  getProfileInsightTitle,
  getProfileInsightWindows,
  isProfileInsightScanTick,
} from "../../../Utils/Profiles/ProfileInsight";
import { ProfileCategory } from "../../../Utils/Profiles/ProfileTypes";
import {
  PROFILE_FIX_MIN_FUNCTION_SAMPLES,
  PROFILE_FIX_MIN_GROWTH_POINTS,
  PROFILE_FIX_MIN_OWN_SHARE_PERCENT,
  PROFILE_FIX_MIN_WINDOW_SAMPLES,
  ProfileFixReason,
  getProfileFixReason,
} from "../../../Utils/Suggestions/ProfileFixSuggestion";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

// A hot function of the application's own code, well past every gate.
function reading(
  overrides: Partial<ProfileInsightReading> = {},
): ProfileInsightReading {
  return {
    category: ProfileCategory.Cpu,
    isOwnCode: true,
    ownShare: 18,
    functionSampleCount: 900,
    windowSampleCount: 5000,
    ...overrides,
  };
}

describe("the gates", () => {
  test("are stricter than Fix with AI's on every count", () => {
    expect(PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT).toBeGreaterThan(
      PROFILE_FIX_MIN_OWN_SHARE_PERCENT,
    );
    expect(PROFILE_INSIGHT_MIN_GROWTH_POINTS).toBeGreaterThan(
      PROFILE_FIX_MIN_GROWTH_POINTS,
    );
    expect(PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES).toBeGreaterThan(
      PROFILE_FIX_MIN_FUNCTION_SAMPLES,
    );
    expect(PROFILE_INSIGHT_MIN_WINDOW_SAMPLES).toBeGreaterThan(
      PROFILE_FIX_MIN_WINDOW_SAMPLES,
    );
  });

  test("are the numbers the docs and the settings page say", () => {
    expect(PROFILE_INSIGHT_MIN_OWN_SHARE_PERCENT).toBe(10);
    expect(PROFILE_INSIGHT_MIN_GROWTH_POINTS).toBe(5);
    expect(PROFILE_INSIGHT_MIN_GROWN_SHARE_PERCENT).toBe(5);
    expect(PROFILE_INSIGHT_MIN_WINDOW_SAMPLES).toBe(500);
    expect(PROFILE_INSIGHT_MIN_FUNCTION_SAMPLES).toBe(50);
    expect(PROFILE_INSIGHT_MIN_BASELINE_SAMPLES).toBe(500);
    expect(PROFILE_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(PROFILE_INSIGHT_BASELINE_OFFSET_HOURS).toBe(24);
    expect(PROFILE_INSIGHT_MAX_SERVICES_PER_SCAN).toBe(10);
    expect(PROFILE_INSIGHT_MAX_FINDINGS_PER_SERVICE).toBe(2);
    expect(PROFILE_INSIGHT_CATEGORIES).toEqual([
      ProfileCategory.Cpu,
      ProfileCategory.Wall,
    ]);
  });
});

describe("getProfileInsightReason", () => {
  test("a large share of the hour is Hot", () => {
    expect(getProfileInsightReason(reading())).toBe(ProfileFixReason.Hot);
  });

  test("10% is the line: just under is nothing, on it is Hot", () => {
    expect(getProfileInsightReason(reading({ ownShare: 9.99 }))).toBeNull();
    expect(getProfileInsightReason(reading({ ownShare: 10 }))).toBe(
      ProfileFixReason.Hot,
    );
  });

  test("a library's or the runtime's function is never filed", () => {
    expect(
      getProfileInsightReason(reading({ isOwnCode: false, ownShare: 60 })),
    ).toBeNull();
  });

  test("time only: CPU and wall time are read, memory, locks and goroutines are not", () => {
    expect(
      getProfileInsightReason(reading({ category: ProfileCategory.Wall })),
    ).toBe(ProfileFixReason.Hot);

    for (const category of [
      ProfileCategory.Memory,
      ProfileCategory.Allocations,
      ProfileCategory.Locks,
      ProfileCategory.Goroutines,
      ProfileCategory.Other,
    ]) {
      expect(getProfileInsightReason(reading({ category }))).toBeNull();
    }
  });

  test("too few samples in the hour, or through the function, is nothing", () => {
    expect(
      getProfileInsightReason(reading({ windowSampleCount: 499 })),
    ).toBeNull();
    expect(
      getProfileInsightReason(reading({ functionSampleCount: 49 })),
    ).toBeNull();
    expect(
      getProfileInsightReason(
        reading({ windowSampleCount: 500, functionSampleCount: 50 }),
      ),
    ).toBe(ProfileFixReason.Hot);
  });

  test("a share that grew 5 points or more, to 5% or more, is Grew - before a large share", () => {
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 6,
          ownShareBefore: 1,
          baselineWindowSampleCount: 800,
        }),
      ),
    ).toBe(ProfileFixReason.Grew);

    // Grew is named first even when the share is large too.
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 30,
          ownShareBefore: 2,
          baselineWindowSampleCount: 800,
        }),
      ),
    ).toBe(ProfileFixReason.Grew);
  });

  test("growth under 5 points is not Grew; a share still large is Hot", () => {
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 8,
          ownShareBefore: 3.01,
          baselineWindowSampleCount: 800,
        }),
      ),
    ).toBeNull();
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 14,
          ownShareBefore: 10,
          baselineWindowSampleCount: 800,
        }),
      ),
    ).toBe(ProfileFixReason.Hot);
  });

  test("a baseline with too few samples to compare with makes no Grew", () => {
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 8,
          ownShareBefore: 0,
          baselineWindowSampleCount: 499,
        }),
      ),
    ).toBeNull();
    expect(
      getProfileInsightReason(reading({ ownShare: 8, ownShareBefore: 0 })),
    ).toBeNull();
  });

  test("growth to under 5% is too small to file, however steep", () => {
    expect(
      getProfileInsightReason(
        reading({
          ownShare: 4.9,
          ownShareBefore: -10,
          baselineWindowSampleCount: 800,
        }),
      ),
    ).toBeNull();
  });

  test("figures that are not numbers are nothing", () => {
    expect(
      getProfileInsightReason(reading({ ownShare: Number.NaN })),
    ).toBeNull();
    expect(
      getProfileInsightReason(
        reading({ windowSampleCount: Number.POSITIVE_INFINITY }),
      ),
    ).toBeNull();
  });

  test("property: never files what Fix with AI would not offer (2,000 seeded readings)", () => {
    const random: SeededRandom = seededRandom(5092);
    const categories: Array<ProfileCategory> = Object.values(ProfileCategory);
    let filed: number = 0;

    for (let index: number = 0; index < 2000; index++) {
      const candidate: ProfileInsightReading = {
        category: categories[random(categories.length)]!,
        isOwnCode: random() < 0.8,
        ownShare: random() * 40,
        functionSampleCount: random(2000),
        windowSampleCount: random(5000),
        ...(random() < 0.6
          ? {
              ownShareBefore: random() * 30,
              baselineWindowSampleCount: random(3000),
            }
          : {}),
      };

      const reason: ProfileFixReason | null =
        getProfileInsightReason(candidate);

      if (reason !== null) {
        filed++;
        expect(getProfileFixReason(candidate)).not.toBeNull();
        expect(candidate.isOwnCode).toBe(true);
        expect(PROFILE_INSIGHT_CATEGORIES).toContain(candidate.category);
      }
    }

    // The sweep is not vacuous: plenty of readings pass.
    expect(filed).toBeGreaterThan(50);
  });
});

describe("getProfileInsightSeverity", () => {
  test("a quarter of the time, or 10 points of growth, is High; the rest Medium", () => {
    expect(
      getProfileInsightSeverity(
        reading({ ownShare: PROFILE_INSIGHT_HIGH_SHARE_PERCENT }),
        ProfileFixReason.Hot,
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      getProfileInsightSeverity(
        reading({ ownShare: 24.9 }),
        ProfileFixReason.Hot,
      ),
    ).toBe(AIInsightSeverity.Medium);
    expect(
      getProfileInsightSeverity(
        reading({
          ownShare: 12,
          ownShareBefore: 12 - PROFILE_INSIGHT_HIGH_GROWTH_POINTS,
        }),
        ProfileFixReason.Grew,
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      getProfileInsightSeverity(
        reading({ ownShare: 12, ownShareBefore: 6 }),
        ProfileFixReason.Grew,
      ),
    ).toBe(AIInsightSeverity.Medium);
  });

  test("growth only counts for a Grew finding", () => {
    expect(
      getProfileInsightSeverity(
        reading({ ownShare: 12, ownShareBefore: 0 }),
        ProfileFixReason.Hot,
      ),
    ).toBe(AIInsightSeverity.Medium);
  });
});

describe("getProfileInsightFingerprint", () => {
  test("is the service, the kind, the function and its file - one insight for the same slow code", () => {
    const fingerprint: string = getProfileInsightFingerprint({
      serviceId: " 7E6A3C1A-1111-4222-8333-944455556666 ",
      category: ProfileCategory.Cpu,
      functionName: "OrderParser.parse",
      fileName: "src/orders/parser.ts",
    });

    expect(fingerprint).toBe(
      "profile-hotspot:7e6a3c1a-1111-4222-8333-944455556666:cpu:OrderParser.parse:src/orders/parser.ts",
    );
  });

  test("keeps the function's case, and tells kinds and files apart", () => {
    const base: {
      serviceId: string;
      category: ProfileCategory;
      functionName: string;
      fileName: string;
    } = {
      serviceId: "a",
      category: ProfileCategory.Cpu,
      functionName: "Parse",
      fileName: "x.ts",
    };

    const fingerprints: Set<string> = new Set<string>([
      getProfileInsightFingerprint(base),
      getProfileInsightFingerprint({ ...base, functionName: "parse" }),
      getProfileInsightFingerprint({
        ...base,
        category: ProfileCategory.Wall,
      }),
      getProfileInsightFingerprint({ ...base, fileName: "y.ts" }),
    ]);

    expect(fingerprints.size).toBe(4);
  });
});

describe("when and what a look reads", () => {
  test("profiles are read on the scanner's first look of each hour", () => {
    expect(isProfileInsightScanTick(new Date("2026-10-24T08:00:03.000Z"))).toBe(
      true,
    );
    expect(isProfileInsightScanTick(new Date("2026-10-24T08:14:59.000Z"))).toBe(
      true,
    );
    expect(isProfileInsightScanTick(new Date("2026-10-24T08:15:00.000Z"))).toBe(
      false,
    );
    expect(isProfileInsightScanTick(new Date("2026-10-24T08:45:00.000Z"))).toBe(
      false,
    );
  });

  test("the last hour, compared with the same hour the day before", () => {
    const now: Date = new Date("2026-10-24T09:00:05.000Z");

    expect(getProfileInsightWindows(now)).toEqual({
      window: {
        startTime: new Date("2026-10-24T08:00:05.000Z"),
        endTime: new Date("2026-10-24T09:00:05.000Z"),
      },
      baseline: {
        startTime: new Date("2026-10-23T08:00:05.000Z"),
        endTime: new Date("2026-10-23T09:00:05.000Z"),
      },
    });
  });
});

describe("getProfileInsightTitle", () => {
  test("in the Profiler's own words: what the function takes, in which service", () => {
    expect(
      getProfileInsightTitle({
        functionName: "JSON.parse",
        serviceName: "checkout",
        category: ProfileCategory.Cpu,
        reason: ProfileFixReason.Hot,
        ownShare: 42.4,
      }),
    ).toBe("JSON.parse takes 42% of the CPU time in checkout");
  });

  test("a regression says what it grew to, and from", () => {
    expect(
      getProfileInsightTitle({
        functionName: "OrderParser.parse",
        serviceName: "checkout",
        category: ProfileCategory.Wall,
        reason: ProfileFixReason.Grew,
        ownShare: 12.4,
        ownShareBefore: 3.25,
      }),
    ).toBe(
      "OrderParser.parse grew to 12% of the wall time in checkout, from 3.3%",
    );
  });

  test("with no service name or function name it still reads", () => {
    expect(
      getProfileInsightTitle({
        functionName: "",
        category: ProfileCategory.Cpu,
        reason: ProfileFixReason.Hot,
        ownShare: 10,
      }),
    ).toBe("A function takes 10% of the CPU time");
  });

  test("a Grew finding without its before reads as what it takes", () => {
    expect(
      getProfileInsightTitle({
        functionName: "f",
        serviceName: "api",
        category: ProfileCategory.Cpu,
        reason: ProfileFixReason.Grew,
        ownShare: 7,
      }),
    ).toBe("f takes 7.0% of the CPU time in api");
  });
});
