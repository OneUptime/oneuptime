import { describe, expect, test } from "@jest/globals";
import {
  PROFILE_CHANGE_NOISE_FLOOR_POINTS,
  PROFILE_CHANGE_NOTABLE_POINTS,
  PROFILE_COMPARISON_MIN_WINDOW_SAMPLES,
  ProfileChangeDirection,
  ProfileFunctionChange,
  ProfileFunctionStat,
  ProfileWindowFunctions,
  PROFILE_COMPARISON_OWN_CODE_LEADERS,
  compareProfileWindows,
  getFasterFunctions,
  getNotableOwnCodeGrowth,
  getNotableSlowdown,
  getOwnCodeChanges,
  getSlowerFunctions,
  isComparisonFooted,
  isOwnCodeChange,
  limitProfileComparison,
} from "../../../Utils/Profiles/ProfileComparison";

/*
 * Two windows of one service lined up: before and after a deploy that made
 * the order parser slow. Shares are of each window's own total, so a
 * window with more traffic is not "slower" in every function.
 */

function stat(
  functionName: string,
  selfValue: number,
  totalValue: number,
  extra?: Partial<ProfileFunctionStat>,
): ProfileFunctionStat {
  return {
    functionName,
    fileName: `/app/src/${functionName}.ts`,
    lineNumber: 10,
    frameType: "v8js",
    selfValue,
    totalValue,
    sampleCount: Math.max(1, Math.round(totalValue / 10)),
    ...extra,
  };
}

function find(
  changes: Array<ProfileFunctionChange>,
  functionName: string,
): ProfileFunctionChange {
  const change: ProfileFunctionChange | undefined = changes.find(
    (candidate: ProfileFunctionChange) => {
      return candidate.functionName === functionName;
    },
  );
  expect(change).toBeDefined();
  return change!;
}

// Before the deploy: parseOrder is 10% of the CPU time.
const BEFORE: ProfileWindowFunctions = {
  functions: [
    stat("handleRequest", 50, 1000),
    stat("parseOrder", 100, 100),
    stat("renderJson", 300, 300),
    stat("queryDb", 550, 550),
    stat("legacyCache", 0, 0, { selfValue: 0, totalValue: 0 }),
    stat("oldPath", 40, 40),
  ],
  windowTotal: 1000,
  windowSampleCount: 1000,
};

/*
 * After it: twice the traffic, and parseOrder takes 45% of the time. Every
 * function does more work in absolute terms - only parseOrder's share grew.
 */
const AFTER: ProfileWindowFunctions = {
  functions: [
    stat("handleRequest", 100, 2000),
    stat("parseOrder", 900, 900),
    stat("renderJson", 400, 400),
    stat("queryDb", 600, 600),
    stat("newFeatureFlagCheck", 60, 60),
  ],
  windowTotal: 2000,
  windowSampleCount: 2000,
};

describe("compareProfileWindows", () => {
  const changes: Array<ProfileFunctionChange> = compareProfileWindows(
    BEFORE,
    AFTER,
  );

  test("lines every function of either window up once", () => {
    expect(
      changes
        .map((change: ProfileFunctionChange) => {
          return change.functionName;
        })
        .sort(),
    ).toEqual(
      [
        "handleRequest",
        "legacyCache",
        "newFeatureFlagCheck",
        "oldPath",
        "parseOrder",
        "queryDb",
        "renderJson",
      ].sort(),
    );
  });

  test("measures each side as a share of its own window", () => {
    const parseOrder: ProfileFunctionChange = find(changes, "parseOrder");

    expect(parseOrder.before!.selfShare).toBeCloseTo(10, 6);
    expect(parseOrder.after!.selfShare).toBeCloseTo(45, 6);
    expect(parseOrder.selfShareChange).toBeCloseTo(35, 6);
    expect(parseOrder.totalShareChange).toBeCloseTo(35, 6);
    expect(parseOrder.direction).toBe(ProfileChangeDirection.Slower);
  });

  test("more traffic alone is not slower: a function that kept its share is the same", () => {
    const handleRequest: ProfileFunctionChange = find(changes, "handleRequest");

    expect(handleRequest.after!.selfValue).toBeGreaterThan(
      handleRequest.before!.selfValue,
    );
    expect(handleRequest.selfShareChange).toBeCloseTo(0, 6);
    expect(handleRequest.direction).toBe(ProfileChangeDirection.Same);
  });

  test("a function that lost share is faster", () => {
    const renderJson: ProfileFunctionChange = find(changes, "renderJson");
    expect(renderJson.selfShareChange).toBeCloseTo(-10, 6);
    expect(renderJson.direction).toBe(ProfileChangeDirection.Faster);

    const queryDb: ProfileFunctionChange = find(changes, "queryDb");
    expect(queryDb.selfShareChange).toBeCloseTo(-25, 6);
    expect(queryDb.direction).toBe(ProfileChangeDirection.Faster);
  });

  test("a function only the second window has is new", () => {
    const flagCheck: ProfileFunctionChange = find(
      changes,
      "newFeatureFlagCheck",
    );
    expect(flagCheck.before).toBeNull();
    expect(flagCheck.after!.selfShare).toBeCloseTo(3, 6);
    expect(flagCheck.direction).toBe(ProfileChangeDirection.New);
  });

  test("a function only the first window has is gone", () => {
    const oldPath: ProfileFunctionChange = find(changes, "oldPath");
    expect(oldPath.after).toBeNull();
    expect(oldPath.selfShareChange).toBeCloseTo(-4, 6);
    expect(oldPath.direction).toBe(ProfileChangeDirection.Gone);
  });

  test("a function with no time on either side is the same", () => {
    expect(find(changes, "legacyCache").direction).toBe(
      ProfileChangeDirection.Same,
    );
  });

  test("ranks by the size of the change, growth first on a tie", () => {
    expect(
      changes.slice(0, 4).map((change: ProfileFunctionChange) => {
        return change.functionName;
      }),
    ).toEqual(["parseOrder", "queryDb", "renderJson", "oldPath"]);
  });

  test("keeps the line and frame type of the side that has the function", () => {
    expect(find(changes, "oldPath").lineNumber).toBe(10);
    expect(find(changes, "oldPath").frameType).toBe("v8js");
  });
});

describe("one function at two lines", () => {
  test("is one function, its line the heaviest one", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      {
        functions: [
          stat("parse", 30, 30, { lineNumber: 12 }),
          stat("parse", 70, 70, { lineNumber: 40 }),
        ],
        windowTotal: 100,
      },
      {
        functions: [stat("parse", 50, 50, { lineNumber: 41 })],
        windowTotal: 100,
      },
    );

    expect(changes.length).toBe(1);
    expect(changes[0]!.before!.selfShare).toBeCloseTo(100, 6);
    expect(changes[0]!.after!.selfShare).toBeCloseTo(50, 6);
    expect(changes[0]!.lineNumber).toBe(41);
  });

  test("a deploy that moved a function down the file is the same function", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      {
        functions: [stat("parse", 50, 50, { lineNumber: 12 })],
        windowTotal: 100,
      },
      {
        functions: [stat("parse", 50, 50, { lineNumber: 112 })],
        windowTotal: 100,
      },
    );

    expect(changes.length).toBe(1);
    expect(changes[0]!.direction).toBe(ProfileChangeDirection.Same);
  });
});

describe("the noise floor", () => {
  test("a change under the floor is the same", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      { functions: [stat("a", 100, 100)], windowTotal: 1000 },
      {
        functions: [
          stat("a", 100 + (PROFILE_CHANGE_NOISE_FLOOR_POINTS * 10) / 2, 100),
        ],
        windowTotal: 1000,
      },
    );

    expect(changes[0]!.direction).toBe(ProfileChangeDirection.Same);
  });

  test("a change at the floor counts", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      { functions: [stat("a", 100, 100)], windowTotal: 1000 },
      {
        functions: [
          stat("a", 100 + PROFILE_CHANGE_NOISE_FLOOR_POINTS * 10, 100),
        ],
        windowTotal: 1000,
      },
    );

    expect(changes[0]!.direction).toBe(ProfileChangeDirection.Slower);
  });
});

describe("an empty window", () => {
  test("shares nothing: every share is 0, not a division by zero", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      { functions: [], windowTotal: 0 },
      { functions: [stat("a", 10, 10)], windowTotal: 0 },
    );

    expect(changes[0]!.after!.selfShare).toBe(0);
    expect(Number.isFinite(changes[0]!.selfShareChange)).toBe(true);
  });
});

describe("getSlowerFunctions / getFasterFunctions", () => {
  const changes: Array<ProfileFunctionChange> = compareProfileWindows(
    BEFORE,
    AFTER,
  );

  test("slower: grew or new, biggest first", () => {
    expect(
      getSlowerFunctions(changes).map((change: ProfileFunctionChange) => {
        return change.functionName;
      }),
    ).toEqual(["parseOrder", "newFeatureFlagCheck"]);
  });

  test("faster: shrank or gone, biggest drop first", () => {
    expect(
      getFasterFunctions(changes).map((change: ProfileFunctionChange) => {
        return change.functionName;
      }),
    ).toEqual(["queryDb", "renderJson", "oldPath"]);
  });
});

describe("getNotableSlowdown", () => {
  test("names the function whose self share grew the most", () => {
    expect(
      getNotableSlowdown(compareProfileWindows(BEFORE, AFTER))!.functionName,
    ).toBe("parseOrder");
  });

  test("names nothing when no function grew by the notable amount", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      { functions: [stat("a", 100, 100)], windowTotal: 1000 },
      {
        functions: [
          stat("a", 100 + (PROFILE_CHANGE_NOTABLE_POINTS * 10) / 2, 100),
        ],
        windowTotal: 1000,
      },
    );

    expect(getNotableSlowdown(changes)).toBeNull();
  });

  test("names nothing when everything got faster", () => {
    expect(getNotableSlowdown(compareProfileWindows(AFTER, BEFORE))?.functionName).not.toBe(
      "parseOrder",
    );
  });
});

describe("isComparisonFooted", () => {
  test("needs a total on both sides", () => {
    expect(
      isComparisonFooted(
        { functions: [], windowTotal: 0, windowSampleCount: 0 },
        AFTER,
      ),
    ).toBe(false);
  });

  test("needs enough samples on both sides", () => {
    expect(
      isComparisonFooted(
        {
          functions: [],
          windowTotal: 100,
          windowSampleCount: PROFILE_COMPARISON_MIN_WINDOW_SAMPLES - 1,
        },
        AFTER,
      ),
    ).toBe(false);

    expect(
      isComparisonFooted(
        {
          functions: [],
          windowTotal: 100,
          windowSampleCount: PROFILE_COMPARISON_MIN_WINDOW_SAMPLES,
        },
        AFTER,
      ),
    ).toBe(true);
  });

  test("a window with no count reported is judged by its total", () => {
    expect(
      isComparisonFooted(
        { functions: [], windowTotal: 10 },
        { functions: [], windowTotal: 10 },
      ),
    ).toBe(true);
  });
});

/*
 * The application's own code, read by own-code share: the parser whose time
 * all went to JSON.parse after the deploy has no self time, so ranking by
 * self share would never name it - its own-code share did grow.
 */
describe("own-code shares", () => {
  const ownBefore: ProfileWindowFunctions = {
    functions: [
      stat("JSON.parse", 100, 100, { fileName: "node:internal/json" }),
      stat("parseOrder", 0, 120, { ownValue: 120 }),
      stat("handleRequest", 0, 1000, { ownValue: 30 }),
      stat("queryDb", 600, 600, { ownValue: 600 }),
    ],
    windowTotal: 1000,
    windowSampleCount: 1000,
  };
  const ownAfter: ProfileWindowFunctions = {
    functions: [
      stat("JSON.parse", 900, 900, { fileName: "node:internal/json" }),
      stat("parseOrder", 0, 940, { ownValue: 940 }),
      stat("handleRequest", 0, 2000, { ownValue: 60 }),
      stat("queryDb", 700, 700, { ownValue: 700 }),
    ],
    windowTotal: 2000,
    windowSampleCount: 2000,
  };

  test("each side carries its own-code share, and the change between them", () => {
    const parseOrder: ProfileFunctionChange = find(
      compareProfileWindows(ownBefore, ownAfter),
      "parseOrder",
    );

    expect(parseOrder.before?.ownShare).toBeCloseTo(12, 6);
    expect(parseOrder.after?.ownShare).toBeCloseTo(47, 6);
    expect(parseOrder.ownShareChange).toBeCloseTo(35, 6);
    // Its self share did not move: the self ranking would not name it.
    expect(parseOrder.selfShareChange).toBe(0);
  });

  test("a function sampled at two lines adds its own-code time once per line", () => {
    const change: ProfileFunctionChange = find(
      compareProfileWindows(
        {
          functions: [
            stat("parseOrder", 0, 50, { ownValue: 50, lineNumber: 88 }),
            stat("parseOrder", 0, 50, { ownValue: 50, lineNumber: 91 }),
          ],
          windowTotal: 1000,
        },
        { functions: [], windowTotal: 1000 },
      ),
      "parseOrder",
    );

    expect(change.before?.ownValue).toBe(100);
  });

  test("only the application's own functions, biggest own-code move first", () => {
    const changes: Array<ProfileFunctionChange> = getOwnCodeChanges(
      compareProfileWindows(ownBefore, ownAfter),
    );

    expect(
      changes.map((change: ProfileFunctionChange): string => {
        return change.functionName;
      }),
    ).toEqual(["parseOrder", "queryDb"]);
    // handleRequest's own-code share did not move past the noise floor.
    expect(changes.every(isOwnCodeChange)).toBe(true);
  });

  test("the own code to name: the one that grew the most, when it grew enough", () => {
    expect(
      getNotableOwnCodeGrowth(compareProfileWindows(ownBefore, ownAfter))
        ?.functionName,
    ).toBe("parseOrder");
    // The other way round, the database code is the one that grew.
    expect(
      getNotableOwnCodeGrowth(compareProfileWindows(ownAfter, ownBefore))
        ?.functionName,
    ).toBe("queryDb");
    // A window against itself: nothing grew.
    expect(
      getNotableOwnCodeGrowth(compareProfileWindows(ownBefore, ownBefore)),
    ).toBeNull();
  });

  test("a limited comparison keeps the own-code movers its limit left out", () => {
    const changes: Array<ProfileFunctionChange> = compareProfileWindows(
      ownBefore,
      ownAfter,
    );
    const limited: Array<ProfileFunctionChange> = limitProfileComparison(
      changes,
      1,
    );

    // JSON.parse leads by self share; parseOrder and queryDb follow it.
    expect(
      limited.map((change: ProfileFunctionChange): string => {
        return change.functionName;
      }),
    ).toEqual(["JSON.parse", "parseOrder", "queryDb"]);
    expect(limitProfileComparison(changes, changes.length)).toHaveLength(
      changes.length,
    );
    expect(PROFILE_COMPARISON_OWN_CODE_LEADERS).toBeGreaterThan(0);
  });
});
