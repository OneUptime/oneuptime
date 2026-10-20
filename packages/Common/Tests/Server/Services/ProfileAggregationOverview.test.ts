import ProfileAggregationService, {
  FunctionComparisonResult,
  FunctionListItem,
  FunctionListResult,
  ProfileFlamegraphNode,
  ServiceActivityItem,
  StackShareResult,
} from "../../../Server/Services/ProfileAggregationService";
import ProfileSampleDatabaseService from "../../../Server/Services/ProfileSampleService";
import ProfileDatabaseService from "../../../Server/Services/ProfileService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "../../../Utils/Profiles/ProfileComparison";
import { ProfileTypeActivity } from "../../../Utils/Profiles/ProfileTypes";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The reads behind the Profiler's overview, its compare view, the AI tools
 * and the Profiles monitor's function share: the ClickHouse boundary
 * (executeQuery) answers fixture rows, everything after it is the real
 * code.
 */

// The stack-share read's bounds on the samples' own time.
const SAMPLE_WINDOW_START: RegExp = /AND time >= \{p\d+:DateTime\}/;
const SAMPLE_WINDOW_END: RegExp = /AND time <= \{p\d+:DateTime\}/;

// How a time reaches a statement's parameters: UTC, to the second.
function asParameter(iso: string): string {
  return iso.replace("T", " ").substring(0, 19);
}

function resultOf(rows: Array<JSONObject>): Results {
  return {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

/*
 * Answers each statement by what it reads: the grouped stacks of a window
 * (by its start time), or the window's total.
 */
function stubWindows(windows: {
  [startIso: string]: {
    stacks: Array<JSONObject>;
    windowTotal: number;
    windowSampleCount: number;
  };
}): Array<Statement> {
  const statements: Array<Statement> = [];

  jest
    .spyOn(ProfileSampleDatabaseService, "executeQuery")
    .mockImplementation((async (statement: Statement): Promise<Results> => {
      statements.push(statement);
      const values: Array<unknown> = Object.values(statement.query_params);

      for (const [startIso, window] of Object.entries(windows)) {
        const startsHere: boolean = values.includes(asParameter(startIso));

        if (!startsHere) {
          continue;
        }

        if (statement.query.includes("AS windowTotal")) {
          return resultOf([
            {
              windowTotal: window.windowTotal,
              windowSampleCount: window.windowSampleCount,
            },
          ]);
        }

        return resultOf(window.stacks);
      }

      return resultOf([]);
    }) as never);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("frames merge by function and file", () => {
  test("a function sampled at two lines is one flame graph frame, at the line of the heaviest stack", () => {
    const root: ProfileFlamegraphNode =
      ProfileAggregationService.buildFlamegraphTree([
        {
          stacktrace: ["parse@/app/src/parser.ts:40", "main@/app/src/main.ts:5"],
          frameTypes: ["v8js", "v8js"],
          totalValue: 70,
        },
        {
          stacktrace: ["parse@/app/src/parser.ts:12", "main@/app/src/main.ts:5"],
          frameTypes: ["v8js", "v8js"],
          totalValue: 30,
        },
      ]);

    expect(root.totalValue).toBe(100);
    expect(root.children.length).toBe(1);

    const main: ProfileFlamegraphNode = root.children[0]!;
    expect(main.children.length).toBe(1);

    const parse: ProfileFlamegraphNode = main.children[0]!;
    expect(parse.functionName).toBe("parse");
    expect(parse.totalValue).toBe(100);
    expect(parse.selfValue).toBe(100);
    expect(parse.lineNumber).toBe(40);
  });

  test("one name in two files stays two frames", () => {
    const root: ProfileFlamegraphNode =
      ProfileAggregationService.buildFlamegraphTree([
        {
          stacktrace: ["parse@/app/a.ts:1", "main@/app/main.ts:5"],
          frameTypes: [],
          totalValue: 10,
        },
        {
          stacktrace: ["parse@/app/b.ts:1", "main@/app/main.ts:5"],
          frameTypes: [],
          totalValue: 10,
        },
      ]);

    expect(root.children[0]!.children.length).toBe(2);
  });

  test("the function list counts one function once per stack, with the line of its heaviest stack", () => {
    const items: Array<FunctionListItem> =
      ProfileAggregationService.buildFunctionList([
        {
          stacktrace: [
            "parse@/app/src/parser.ts:40",
            "parse@/app/src/parser.ts:12",
            "main@/app/src/main.ts:5",
          ],
          frameTypes: ["v8js", "v8js", "v8js"],
          totalValue: 80,
          sampleCount: 8,
        },
        {
          stacktrace: ["parse@/app/src/parser.ts:12", "main@/app/src/main.ts:5"],
          frameTypes: ["v8js", "v8js"],
          totalValue: 20,
          sampleCount: 2,
        },
      ]);

    const parse: FunctionListItem | undefined = items.find(
      (item: FunctionListItem) => {
        return item.functionName === "parse";
      },
    );

    expect(items.length).toBe(2);
    expect(parse).toEqual({
      functionName: "parse",
      fileName: "/app/src/parser.ts",
      lineNumber: 40,
      selfValue: 100,
      totalValue: 100,
      sampleCount: 10,
      frameType: "v8js",
    });
  });
});

describe("ProfileAggregationService.getFunctionList", () => {
  test("reports the window's total and its sample count beside the functions", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const startTime: Date = new Date("2026-10-20T10:00:00.000Z");

    stubWindows({
      [startTime.toISOString()]: {
        stacks: [
          {
            stacktrace: ["work@/app/w.go:3", "main@/app/main.go:1"],
            frameTypes: ["go", "go"],
            totalValue: "600",
            sampleCount: "6",
          },
        ],
        windowTotal: 1000,
        windowSampleCount: 12,
      },
    });

    const result: FunctionListResult =
      await ProfileAggregationService.getFunctionList({
        projectId,
        startTime,
        endTime: new Date("2026-10-20T11:00:00.000Z"),
      });

    expect(result.windowTotal).toBe(1000);
    expect(result.windowSampleCount).toBe(12);
    expect(result.functions[0]!.functionName).toBe("work");
    expect(result.functions[0]!.lineNumber).toBe(3);
  });
});

describe("ProfileAggregationService.getFunctionComparison", () => {
  const projectId: ObjectID = ObjectID.generate();
  const beforeStart: Date = new Date("2026-10-20T08:00:00.000Z");
  const beforeEnd: Date = new Date("2026-10-20T09:00:00.000Z");
  const afterStart: Date = new Date("2026-10-20T09:00:00.000Z");
  const afterEnd: Date = new Date("2026-10-20T10:00:00.000Z");

  /*
   * Before the deploy the order parser took a tenth of the CPU time; after
   * it, with twice the traffic, nearly half.
   */
  const windows: Parameters<typeof stubWindows>[0] = {
    [beforeStart.toISOString()]: {
      stacks: [
        {
          stacktrace: ["queryDb@/app/db.ts:9", "handle@/app/http.ts:2"],
          frameTypes: [],
          totalValue: 900,
          sampleCount: 90,
        },
        {
          stacktrace: ["parseOrder@/app/orders.ts:88", "handle@/app/http.ts:2"],
          frameTypes: [],
          totalValue: 100,
          sampleCount: 10,
        },
      ],
      windowTotal: 1000,
      windowSampleCount: 100,
    },
    [afterStart.toISOString()]: {
      stacks: [
        {
          stacktrace: ["queryDb@/app/db.ts:9", "handle@/app/http.ts:2"],
          frameTypes: [],
          totalValue: 1100,
          sampleCount: 110,
        },
        {
          stacktrace: ["parseOrder@/app/orders.ts:91", "handle@/app/http.ts:2"],
          frameTypes: [],
          totalValue: 900,
          sampleCount: 90,
        },
      ],
      windowTotal: 2000,
      windowSampleCount: 200,
    },
  };

  test("lines the functions up by share of their own window, the biggest change first", async () => {
    stubWindows(windows);

    const result: FunctionComparisonResult =
      await ProfileAggregationService.getFunctionComparison({
        projectId,
        beforeStartTime: beforeStart,
        beforeEndTime: beforeEnd,
        afterStartTime: afterStart,
        afterEndTime: afterEnd,
        profileTypes: ["cpu"],
      });

    expect(result.isFooted).toBe(true);
    expect(result.before.windowTotal).toBe(1000);
    expect(result.after.windowTotal).toBe(2000);

    const parseOrder: ProfileFunctionChange = result.changes[0]!;
    expect(parseOrder.functionName).toBe("parseOrder");
    expect(parseOrder.before!.selfShare).toBeCloseTo(10, 6);
    expect(parseOrder.after!.selfShare).toBeCloseTo(45, 6);
    expect(parseOrder.direction).toBe(ProfileChangeDirection.Slower);
    // The deploy moved it from line 88 to 91: still one function.
    expect(parseOrder.lineNumber).toBe(91);

    const queryDb: ProfileFunctionChange = result.changes.find(
      (change: ProfileFunctionChange) => {
        return change.functionName === "queryDb";
      },
    )!;
    expect(queryDb.direction).toBe(ProfileChangeDirection.Faster);
  });

  test("reads both windows with the same filters", async () => {
    const statements: Array<Statement> = stubWindows(windows);
    const serviceId: ObjectID = ObjectID.generate();

    await ProfileAggregationService.getFunctionComparison({
      projectId,
      beforeStartTime: beforeStart,
      beforeEndTime: beforeEnd,
      afterStartTime: afterStart,
      afterEndTime: afterEnd,
      serviceIds: [serviceId],
      profileTypes: ["cpu", "process_cpu"],
    });

    // Two windows: grouped stacks and a total each.
    expect(statements.length).toBe(4);

    for (const statement of statements) {
      expect(statement.query).toMatch(/AND profileType IN/);
      expect(Object.values(statement.query_params)).toContainEqual([
        "cpu",
        "process_cpu",
      ]);
      expect(Object.values(statement.query_params)).toContainEqual([
        serviceId.toString(),
      ]);
    }
  });

  test("keeps at most the asked number of changes", async () => {
    stubWindows(windows);

    const result: FunctionComparisonResult =
      await ProfileAggregationService.getFunctionComparison({
        projectId,
        beforeStartTime: beforeStart,
        beforeEndTime: beforeEnd,
        afterStartTime: afterStart,
        afterEndTime: afterEnd,
        limit: 1,
      });

    expect(result.changes.length).toBe(1);
  });

  test("a window with too few samples is not footed", async () => {
    stubWindows({
      ...windows,
      [beforeStart.toISOString()]: {
        stacks: windows[beforeStart.toISOString()]!.stacks,
        windowTotal: 1000,
        windowSampleCount: 3,
      },
    });

    const result: FunctionComparisonResult =
      await ProfileAggregationService.getFunctionComparison({
        projectId,
        beforeStartTime: beforeStart,
        beforeEndTime: beforeEnd,
        afterStartTime: afterStart,
        afterEndTime: afterEnd,
      });

    expect(result.isFooted).toBe(false);
  });
});

describe("ProfileAggregationService.getProfileTypeActivity", () => {
  test("reads profile types, units and volumes from the Profile table, in the caller's scope", async () => {
    const statements: Array<Statement> = [];

    jest
      .spyOn(ProfileDatabaseService, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);
        return resultOf([
          {
            profileType: "cpu",
            unit: "nanoseconds",
            totalSampleCount: "900",
            profileCount: "30",
          },
          {
            profileType: "",
            unit: "bytes",
            totalSampleCount: "5",
            profileCount: "1",
          },
          {
            profileType: "inuse_space",
            unit: "bytes",
            totalSampleCount: 40,
            profileCount: 4,
          },
        ]);
      }) as never);

    const serviceId: ObjectID = ObjectID.generate();
    const excluded: ObjectID = ObjectID.generate();

    const activity: Array<ProfileTypeActivity> =
      await ProfileAggregationService.getProfileTypeActivity({
        projectId: ObjectID.generate(),
        startTime: new Date("2026-10-20T10:00:00.000Z"),
        endTime: new Date("2026-10-20T11:00:00.000Z"),
        serviceIds: [serviceId],
        excludedServiceIds: [excluded],
      });

    expect(activity).toEqual([
      {
        profileType: "cpu",
        unit: "nanoseconds",
        sampleCount: 900,
        profileCount: 30,
      },
      {
        profileType: "inuse_space",
        unit: "bytes",
        sampleCount: 40,
        profileCount: 4,
      },
    ]);

    const statement: Statement = statements[0]!;
    expect(statement.query).toMatch(/GROUP BY profileType/);
    expect(statement.query).toMatch(/retentionDate >= now\(\)/);
    expect(Object.values(statement.query_params)).toContainEqual([
      serviceId.toString(),
    ]);
    expect(Object.values(statement.query_params)).toContainEqual([
      excluded.toString(),
    ]);
  });
});

describe("ProfileAggregationService.resolveQueryProfileTypes", () => {
  const request: {
    projectId: ObjectID;
    startTime: Date;
    endTime: Date;
  } = {
    projectId: ObjectID.generate(),
    startTime: new Date("2026-10-20T10:00:00.000Z"),
    endTime: new Date("2026-10-20T11:00:00.000Z"),
  };

  test("a kind is read as the raw types the scope has, in one unit", async () => {
    jest
      .spyOn(ProfileAggregationService, "getProfileTypeActivity")
      .mockResolvedValue([
        {
          profileType: "samples",
          unit: "count",
          sampleCount: 5000,
          profileCount: 10,
        },
        {
          profileType: "cpu",
          unit: "nanoseconds",
          sampleCount: 10,
          profileCount: 1,
        },
      ]);

    expect(
      await ProfileAggregationService.resolveQueryProfileTypes({
        request,
        selection: "cpu",
      }),
    ).toEqual(["samples"]);
  });

  test("a kind the scope has no data for falls back to every raw name of the kind", async () => {
    jest
      .spyOn(ProfileAggregationService, "getProfileTypeActivity")
      .mockResolvedValue([]);

    expect(
      await ProfileAggregationService.resolveQueryProfileTypes({
        request,
        selection: "memory",
      }),
    ).toEqual(["inuse_space", "heap", "space"]);
  });

  test("a raw type is read as itself, with no read of the scope", async () => {
    const activity: jest.SpiedFunction<
      typeof ProfileAggregationService.getProfileTypeActivity
    > = jest.spyOn(ProfileAggregationService, "getProfileTypeActivity");

    expect(
      await ProfileAggregationService.resolveQueryProfileTypes({
        request,
        selection: "alloc_objects",
      }),
    ).toEqual(["alloc_objects"]);
    expect(activity).not.toHaveBeenCalled();
  });

  test("nothing picked reads every type", async () => {
    expect(
      await ProfileAggregationService.resolveQueryProfileTypes({
        request,
        selection: "",
      }),
    ).toBeUndefined();
  });
});

describe("ProfileAggregationService.getStackShare", () => {
  test("measures the matching stacks against the window, over the monitor's own profiles", async () => {
    const statements: Array<Statement> = [];

    jest
      .spyOn(ProfileSampleDatabaseService, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);
        return resultOf([
          { matchedValue: "250", windowTotal: "1000", windowSampleCount: "40" },
        ]);
      }) as never);

    const projectId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();
    const startTime: Date = new Date("2026-10-20T10:00:00.000Z");
    const endTime: Date = new Date("2026-10-20T10:05:00.000Z");

    const result: StackShareResult =
      await ProfileAggregationService.getStackShare({
        projectId,
        frameText: "parseOrder",
        profileQuery: {
          primaryEntityId: new Includes([serviceId]),
          profileType: new Includes(["cpu"]),
          startTime: new InBetween(startTime, endTime),
        },
        startTime,
        endTime,
      });

    expect(result).toEqual({
      matchedValue: 250,
      windowTotal: 1000,
      windowSampleCount: 40,
      sharePercent: 25,
    });

    const statement: Statement = statements[0]!;
    const values: Array<unknown> = Object.values(statement.query_params);

    // The text is a bound value, matched in any case inside each frame.
    expect(statement.query).toMatch(/positionCaseInsensitiveUTF8\(x, \{p\d+:String\}\)/);
    expect(values).toContain("parseOrder");

    // The profiles are the monitor's, read from the Profile table.
    expect(statement.query).toMatch(/profileId GLOBAL IN \(SELECT profileId FROM/);
    expect(values).toContain(AnalyticsTableName.Profile);
    expect(values).toContainEqual([serviceId.toString()]);
    expect(values).toContainEqual(["cpu"]);

    // The samples are read around the window only.
    expect(statement.query).toMatch(SAMPLE_WINDOW_START);
    expect(statement.query).toMatch(SAMPLE_WINDOW_END);
    expect(values).toContain(asParameter("2026-10-20T09:50:00.000Z"));
    expect(values).toContain(asParameter("2026-10-20T10:15:00.000Z"));
  });

  test("an empty window shares nothing", async () => {
    jest
      .spyOn(ProfileSampleDatabaseService, "executeQuery")
      .mockResolvedValue(
        resultOf([{ matchedValue: 0, windowTotal: 0, windowSampleCount: 0 }]),
      );

    const result: StackShareResult =
      await ProfileAggregationService.getStackShare({
        projectId: ObjectID.generate(),
        frameText: "x",
        profileQuery: {},
        startTime: new Date(),
        endTime: new Date(),
      });

    expect(result.sharePercent).toBe(0);
  });
});

describe("ProfileAggregationService.getServiceActivity", () => {
  test("names each resource's type and folds one resource seen under two types into one row", async () => {
    const serviceId: string = ObjectID.generate().toString();
    const hostId: string = ObjectID.generate().toString();

    jest.spyOn(ProfileDatabaseService, "executeQuery").mockResolvedValue(
      resultOf([
        {
          primaryEntityId: serviceId,
          primaryEntityType: "OpenTelemetry",
          totalSampleCount: 300,
          profileCount: 3,
        },
        {
          primaryEntityId: hostId,
          primaryEntityType: "Host",
          totalSampleCount: 200,
          profileCount: 2,
        },
        {
          primaryEntityId: serviceId,
          primaryEntityType: "",
          totalSampleCount: 50,
          profileCount: 1,
        },
      ]),
    );

    const activity: Array<ServiceActivityItem> =
      await ProfileAggregationService.getServiceActivity({
        projectId: ObjectID.generate(),
        startTime: new Date(),
        endTime: new Date(),
      });

    expect(activity).toEqual([
      {
        primaryEntityId: serviceId,
        primaryEntityType: "OpenTelemetry",
        sampleCount: 350,
        profileCount: 4,
        totalValue: 0,
      },
      {
        primaryEntityId: hostId,
        primaryEntityType: "Host",
        sampleCount: 200,
        profileCount: 2,
        totalValue: 0,
      },
    ]);
  });
});
