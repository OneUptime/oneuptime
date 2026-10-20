import { describe, expect, test } from "@jest/globals";
import {
  PROFILE_CHANGE_NOISE_FLOOR_POINTS,
  PROFILE_CHANGE_NOTABLE_POINTS,
  PROFILE_COMPARISON_MIN_WINDOW_SAMPLES,
  ProfileChangeDirection,
  ProfileFunctionChange,
  ProfileFunctionStat,
  ProfileWindowFunctions,
  compareProfileWindows,
  getFasterFunctions,
  getNotableSlowdown,
  getSlowerFunctions,
  isComparisonFooted,
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
