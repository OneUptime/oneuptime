import ProfileAggregationService, {
  FunctionFocusResult,
  FunctionListItem,
  ProfileFlamegraphNode,
} from "../../../../Server/Services/ProfileAggregationService";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
} from "../../../../Server/Utils/Profile/ProfileEvidence";
import ObjectID from "../../../../Types/ObjectID";
import { ProfileFrameOrigin } from "../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCategory,
  ProfileTypeActivity,
  ProfileValueUnit,
} from "../../../../Utils/Profiles/ProfileTypes";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The evidence a profile gives about one function - for the AI's tools, a
 * Code task's context and the fix rule alike: which kind of profile to
 * read (what the scope has data for, in one unit), and the function's
 * shares of the window - self, total and own-code time - with who calls it
 * and what it calls, and how it changed since an earlier window.
 */

const projectId: ObjectID = ObjectID.generate();
const WINDOW: { startTime: Date; endTime: Date } = {
  startTime: new Date("2026-10-20T11:00:00.000Z"),
  endTime: new Date("2026-10-20T12:00:00.000Z"),
};
const BEFORE: { startTime: Date; endTime: Date } = {
  startTime: new Date("2026-10-20T10:00:00.000Z"),
  endTime: new Date("2026-10-20T11:00:00.000Z"),
};

const CPU: ProfileKind = {
  selection: "cpu",
  category: ProfileCategory.Cpu,
  queryTypes: ["cpu"],
  unit: ProfileValueUnit.Nanoseconds,
};

function activity(rows: Array<Partial<ProfileTypeActivity>>): void {
  jest
    .spyOn(ProfileAggregationService, "getProfileTypeActivity")
    .mockResolvedValue(
      rows.map((row: Partial<ProfileTypeActivity>): ProfileTypeActivity => {
        return {
          profileType: "cpu",
          unit: "nanoseconds",
          sampleCount: 100,
          profileCount: 10,
          ...row,
        };
      }),
    );
}

function node(
  functionName: string,
  fileName: string,
  values: { self?: number; total: number },
  children: Array<ProfileFlamegraphNode> = [],
): ProfileFlamegraphNode {
  return {
    functionName,
    fileName,
    lineNumber: 0,
    selfValue: values.self ?? 0,
    totalValue: values.total,
    children,
    frameType: "",
  };
}

function focus(change: Partial<FunctionFocusResult> = {}): FunctionFocusResult {
  return {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 88,
    totalValue: 560,
    selfValue: 10,
    sampleCount: 5600,
    windowTotal: 1000,
    windowSampleCount: 10000,
    callers: node("parseOrder", "src/orders/parse.ts", { total: 560 }, [
      node("handleCheckout", "src/routes/checkout.ts", { total: 560 }, [
        node("main", "src/server.ts", { self: 560, total: 560 }),
      ]),
    ]),
    callees: node(
      "parseOrder",
      "src/orders/parse.ts",
      { self: 10, total: 560 },
      [
        node("JSON.parse", "node:internal/json", { self: 410, total: 410 }),
        node("normalizeLineItems", "src/orders/normalize.ts", {
          self: 140,
          total: 140,
        }),
      ],
    ),
    truncated: false,
    ...change,
  } as FunctionFocusResult;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which kind of profile to read", () => {
  test("a kind the scope has data for, as its own raw types in one unit", async () => {
    activity([
      { profileType: "cpu", unit: "nanoseconds", sampleCount: 900 },
      { profileType: "samples", unit: "count", sampleCount: 50 },
    ]);

    expect(
      await ProfileEvidence.resolveKind({
        projectId,
        window: WINDOW,
        serviceFilter: {},
        selection: "cpu",
      }),
    ).toEqual(CPU);
  });

  test("CPU time by default - or, for a service profiled for memory only, its memory", async () => {
    activity([{ profileType: "inuse_space", unit: "bytes", sampleCount: 300 }]);

    const kind: ProfileKind | null = await ProfileEvidence.resolveKind({
      projectId,
      window: WINDOW,
      serviceFilter: {},
    });

    expect(kind).toEqual({
      selection: "memory",
      category: ProfileCategory.Memory,
      queryTypes: ["inuse_space"],
      unit: ProfileValueUnit.Bytes,
      insteadOf: ProfileCategory.Cpu,
    });
  });

  test("a kind asked for by name that the scope has no data for reads as nothing", async () => {
    activity([{ profileType: "inuse_space", unit: "bytes", sampleCount: 300 }]);

    expect(
      await ProfileEvidence.resolveKind({
        projectId,
        window: WINDOW,
        serviceFilter: {},
        selection: "cpu",
      }),
    ).toBeNull();
  });

  test("one raw type, by its own name, in the unit its rows declare", async () => {
    activity([
      { profileType: "inuse_objects", unit: "count", sampleCount: 30 },
      { profileType: "custom_metric", unit: "bytes", sampleCount: 5 },
    ]);

    expect(
      await ProfileEvidence.resolveKind({
        projectId,
        window: WINDOW,
        serviceFilter: {},
        selection: "inuse_objects",
      }),
    ).toEqual({
      selection: "inuse_objects",
      category: ProfileCategory.Memory,
      queryTypes: ["inuse_objects"],
      unit: ProfileValueUnit.Count,
    });
    expect(
      (
        await ProfileEvidence.resolveKind({
          projectId,
          window: WINDOW,
          serviceFilter: {},
          selection: "custom_metric",
        })
      )?.category,
    ).toBeNull();
    expect(
      await ProfileEvidence.resolveKind({
        projectId,
        window: WINDOW,
        serviceFilter: {},
        selection: "wall",
      }),
    ).toBeNull();
  });
});

describe("one function's evidence", () => {
  test("its shares of the window, whose code it is, and who calls it and what it calls", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionFocus")
      .mockResolvedValue(focus());

    const evidence: ProfileFunctionEvidence | null =
      await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        window: WINDOW,
      });

    expect(evidence!.origin).toBe(ProfileFrameOrigin.Own);
    expect(evidence!.selfShare).toBeCloseTo(1, 6);
    expect(evidence!.totalShare).toBeCloseTo(56, 6);
    // Itself and JSON.parse below it; not its own helper.
    expect(evidence!.ownValue).toBe(420);
    expect(evidence!.ownShare).toBeCloseTo(42, 6);
    expect(evidence!.lineNumber).toBe(88);
    expect(evidence!.callerChains[0]!.frames[0]!.functionName).toBe(
      "handleCheckout",
    );
    expect(evidence!.callees[0]!.functionName).toBe("JSON.parse");
  });

  test("compared with an earlier window, its shares then", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionFocus")
      .mockImplementation(async (request: { startTime?: Date | undefined }) => {
        return request.startTime?.getTime() === BEFORE.startTime.getTime()
          ? focus({
              totalValue: 200,
              selfValue: 10,
              windowTotal: 1000,
              windowSampleCount: 9000,
              callees: node(
                "parseOrder",
                "src/orders/parse.ts",
                { self: 10, total: 200 },
                [
                  node("JSON.parse", "node:internal/json", {
                    self: 110,
                    total: 110,
                  }),
                ],
              ),
            })
          : focus();
      });

    const evidence: ProfileFunctionEvidence | null =
      await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        window: WINDOW,
        beforeWindow: BEFORE,
      });

    expect(evidence!.before!.ownShare).toBeCloseTo(12, 6);
    expect(evidence!.before!.windowSampleCount).toBe(9000);
    expect(ProfileEvidence.toText(evidence!)).toContain(
      "own-code time 12% -> 42%",
    );
  });

  test("with no file given, the file it takes the most time in - and the others it ran in", async () => {
    jest.spyOn(ProfileAggregationService, "getFunctionList").mockResolvedValue({
      functions: [
        { functionName: "parse", fileName: "src/json.ts", totalValue: 500 },
        { functionName: "parse", fileName: "src/csv.ts", totalValue: 100 },
        { functionName: "other", fileName: "src/other.ts", totalValue: 50 },
      ] as Array<FunctionListItem>,
      windowTotal: 1000,
      windowSampleCount: 1000,
      truncated: false,
    });
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getFunctionFocus
    > = jest
      .spyOn(ProfileAggregationService, "getFunctionFocus")
      .mockResolvedValue(
        focus({ functionName: "parse", fileName: "src/json.ts" }),
      );

    const evidence: ProfileFunctionEvidence | null =
      await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parse",
        window: WINDOW,
      });

    expect(read.mock.calls[0]![0].fileName).toBe("src/json.ts");
    expect(evidence!.otherFiles).toEqual(["src/csv.ts"]);
  });

  test("a function that took no time there is no evidence", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionFocus")
      .mockResolvedValue(focus({ totalValue: 0 }));

    expect(
      await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        window: WINDOW,
      }),
    ).toBeNull();

    jest.spyOn(ProfileAggregationService, "getFunctionList").mockResolvedValue({
      functions: [],
      windowTotal: 0,
      windowSampleCount: 0,
      truncated: false,
    });

    expect(
      await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parseOrder",
        window: WINDOW,
      }),
    ).toBeNull();
  });

  test("as text, it says what each share means", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionFocus")
      .mockResolvedValue(focus({ truncated: true }));

    const text: string = ProfileEvidence.toText(
      (await ProfileEvidence.readFunction({
        projectId,
        serviceFilter: {},
        kind: CPU,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        window: WINDOW,
      }))!,
      { serviceName: "checkout" },
    );

    expect(text).toContain("Function: parseOrder");
    expect(text).toContain("File: src/orders/parse.ts:88");
    expect(text).toContain("Whose code: the application's own code");
    expect(text).toContain("Profile: CPU time of checkout");
    expect(text).toContain("Own-code time: 42%");
    expect(text).toContain(
      "Called from (heaviest chains, direct caller first):",
    );
    expect(text).toContain("Spends its time calling:");
    expect(text).toContain(
      "The window held more distinct stacks than are read at once",
    );
  });
});

describe("a kind in words", () => {
  test("a kind by its noun, a raw type of no kind by its name", () => {
    expect(ProfileEvidence.describeKind(CPU)).toBe("CPU time");
    expect(
      ProfileEvidence.describeKind({
        selection: "custom_metric",
        category: null,
        queryTypes: ["custom_metric"],
        unit: ProfileValueUnit.Count,
      }),
    ).toBe('the "custom_metric" profile');
  });
});
