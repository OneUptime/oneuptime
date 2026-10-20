import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ProfileAggregationService, {
  FunctionComparisonResult,
  FunctionListItem,
  FunctionListResult,
} from "../../../../../Server/Services/ProfileAggregationService";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
} from "../../../../../Server/Utils/Profile/ProfileEvidence";
import {
  CompareProfilesTool,
  GetProfileFunctionTool,
  GetProfileHotspotsTool,
} from "../../../../../Server/Utils/AI/Toolbox/ProfileTools";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "../../../../../Utils/Profiles/ProfileComparison";
import { ProfileFrameOrigin } from "../../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCategory,
  ProfileValueUnit,
} from "../../../../../Utils/Profiles/ProfileTypes";

/*
 * Continuous profiling, for the AI: where a service spends its time
 * (get_profile_hotspots), what got slower between two windows
 * (compare_profiles) and one function's part (get_profile_function). Each
 * reads under the asker's own scope, says what its shares mean, and cites
 * the Profiler page it read from.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9c4e2a10-0000-4000-8000-0000000000a0",
);
const SERVICE_ID: string = "9c4e2a10-0000-4000-8000-0000000000a1";
const HIDDEN_ID: string = "9c4e2a10-0000-4000-8000-0000000000a2";

const CPU: ProfileKind = {
  selection: "cpu",
  category: ProfileCategory.Cpu,
  queryTypes: ["cpu"],
  unit: ProfileValueUnit.Nanoseconds,
};

function context(): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    } as DatabaseCommonInteractionProps,
  };
}

function item(
  functionName: string,
  fileName: string,
  values: { self: number; total: number; own?: number },
): FunctionListItem {
  return {
    functionName,
    fileName,
    lineNumber: 1,
    frameType: "",
    selfValue: values.self,
    totalValue: values.total,
    sampleCount: 10,
    ownValue: values.own ?? 0,
  };
}

const LIST: FunctionListResult = {
  functions: [
    item("JSON.parse", "node:internal/json", { self: 420, total: 420 }),
    item("Socket.write", "node:net", { self: 160, total: 160 }),
    item("validateCart", "src/cart/validate.ts", {
      self: 100,
      total: 100,
      own: 100,
    }),
    item("parseOrder", "src/orders/parse.ts", {
      self: 0,
      total: 560,
      own: 420,
    }),
  ],
  windowTotal: 1000,
  windowSampleCount: 29500,
  truncated: false,
};

let scopeIds: Array<string> | null = null;

beforeEach(() => {
  scopeIds = null;
  jest.spyOn(TelemetryReadAccess, "getScope").mockImplementation(async () => {
    return { readableIds: scopeIds, blockedIds: [HIDDEN_ID] };
  });
  jest.spyOn(ProfileEvidence, "resolveKind").mockResolvedValue(CPU);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the profile tools are in the toolbox", () => {
  test("each by its name, and none of them changes anything", () => {
    expect(AIToolbox.getToolByName("get_profile_hotspots")).toBe(
      GetProfileHotspotsTool,
    );
    expect(AIToolbox.getToolByName("compare_profiles")).toBe(
      CompareProfilesTool,
    );
    expect(AIToolbox.getToolByName("get_profile_function")).toBe(
      GetProfileFunctionTool,
    );

    for (const name of [
      "get_profile_hotspots",
      "compare_profiles",
      "get_profile_function",
    ]) {
      expect(AIToolbox.isMutationTool(name)).toBe(false);
    }
  });
});

describe("get_profile_hotspots", () => {
  test("the functions ranked by self time, with the shares explained", async () => {
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getFunctionList
    > = jest
      .spyOn(ProfileAggregationService, "getFunctionList")
      .mockResolvedValue(LIST);

    const result: ToolExecutionResult = await GetProfileHotspotsTool.execute(
      { serviceId: SERVICE_ID },
      context(),
    );

    expect(result.dataForLlm).toContain("CPU time");
    expect(result.dataForLlm).toContain("29500 samples");
    expect(result.dataForLlm).toContain(
      "ownCode (the application's own functions only)",
    );
    expect(result.dataForLlm.indexOf("JSON.parse")).toBeLessThan(
      result.dataForLlm.indexOf("validateCart"),
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Profiles,
      params: expect.objectContaining({
        serviceId: SERVICE_ID,
        profileType: "cpu",
      }),
    });

    // Read under the asker's scope: the blocked resource is left out.
    const request: Parameters<
      typeof ProfileAggregationService.getFunctionList
    >[0] = read.mock.calls[0]![0];
    expect(request.profileTypes).toEqual(["cpu"]);
    expect(
      (request.serviceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SERVICE_ID]);
    expect(
      (request.excludedServiceIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toContain(HIDDEN_ID);
  });

  test("only the application's own code, ranked by own-code time", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionList")
      .mockResolvedValue(LIST);

    const result: ToolExecutionResult = await GetProfileHotspotsTool.execute(
      { onlyOwnCode: true },
      context(),
    );

    expect(result.dataForLlm).not.toContain("JSON.parse");
    // The parser leads: no self time, but the most own-code time.
    expect(result.dataForLlm.indexOf("parseOrder")).toBeLessThan(
      result.dataForLlm.indexOf("validateCart"),
    );
    expect(result.rowCount).toBe(2);
  });

  test("no profiles in the window says so, with where to look", async () => {
    jest.spyOn(ProfileEvidence, "resolveKind").mockResolvedValue(null);

    const result: ToolExecutionResult = await GetProfileHotspotsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("No profiles were received");
  });
});

describe("compare_profiles", () => {
  function change(
    functionName: string,
    fileName: string,
    selfShareChange: number,
    ownShareChange: number,
  ): ProfileFunctionChange {
    return {
      functionName,
      fileName,
      lineNumber: 1,
      frameType: "",
      before: {
        selfValue: 0,
        totalValue: 0,
        sampleCount: 0,
        selfShare: 10,
        totalShare: 20,
        ownValue: 0,
        ownShare: 12,
      },
      after: {
        selfValue: 0,
        totalValue: 0,
        sampleCount: 0,
        selfShare: 10 + selfShareChange,
        totalShare: 20,
        ownValue: 0,
        ownShare: 12 + ownShareChange,
      },
      selfShareChange,
      totalShareChange: 0,
      ownShareChange,
      direction:
        selfShareChange > 0.5
          ? ProfileChangeDirection.Slower
          : selfShareChange < -0.5
            ? ProfileChangeDirection.Faster
            : ProfileChangeDirection.Same,
    };
  }

  test("what grew, what shrank, and the application's own code that grew", async () => {
    const comparison: FunctionComparisonResult = {
      changes: [
        change("JSON.parse", "node:internal/json", 21, 0),
        change("Socket.write", "node:net", -12, 0),
        change("parseOrder", "src/orders/parse.ts", 0, 21),
      ],
      before: { windowTotal: 1000, windowSampleCount: 9000, truncated: false },
      after: { windowTotal: 2000, windowSampleCount: 18000, truncated: false },
      isFooted: true,
    } as FunctionComparisonResult;
    const read: jest.SpiedFunction<
      typeof ProfileAggregationService.getFunctionComparison
    > = jest
      .spyOn(ProfileAggregationService, "getFunctionComparison")
      .mockResolvedValue(comparison);

    // A deploy two hours ago.
    const changeTime: Date = new Date(
      Math.floor(Date.now() / 60000) * 60000 - 2 * 60 * 60 * 1000,
    );

    const result: ToolExecutionResult = await CompareProfilesTool.execute(
      {
        serviceId: SERVICE_ID,
        changeTime: changeTime.toISOString(),
        windowMinutes: 30,
      },
      context(),
    );

    expect(result.dataForLlm).toContain("Took a bigger share after");
    expect(result.dataForLlm).toContain("JSON.parse");
    expect(result.dataForLlm).toContain("Took a smaller share after");
    expect(result.dataForLlm).toContain(
      "The application's own functions whose own-code share grew",
    );
    expect(result.dataForLlm).toContain("parseOrder");
    expect(result.rowCount).toBe(3);

    // Thirty minutes either side of the change.
    const request: Parameters<
      typeof ProfileAggregationService.getFunctionComparison
    >[0] = read.mock.calls[0]![0];
    expect(request.beforeStartTime.getTime()).toBe(
      changeTime.getTime() - 30 * 60 * 1000,
    );
    expect(request.afterStartTime.getTime()).toBe(changeTime.getTime());
    expect(request.afterEndTime.getTime()).toBe(
      changeTime.getTime() + 30 * 60 * 1000,
    );
  });

  test("windows too thin to compare are said to be hints", async () => {
    jest
      .spyOn(ProfileAggregationService, "getFunctionComparison")
      .mockResolvedValue({
        changes: [],
        before: { windowTotal: 10, windowSampleCount: 3, truncated: false },
        after: { windowTotal: 10, windowSampleCount: 3, truncated: false },
        isFooted: false,
      } as FunctionComparisonResult);

    const result: ToolExecutionResult = await CompareProfilesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).toContain("treat the changes as hints");
    expect(result.dataForLlm).toContain(
      "No function's share grew past the noise floor.",
    );
  });
});

describe("get_profile_function", () => {
  const EVIDENCE: ProfileFunctionEvidence = {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 88,
    frameType: "",
    origin: ProfileFrameOrigin.Own,
    kind: CPU,
    window: {
      startTime: new Date("2026-10-20T11:00:00.000Z"),
      endTime: new Date("2026-10-20T12:00:00.000Z"),
    },
    selfValue: 0,
    totalValue: 560,
    ownValue: 420,
    sampleCount: 16400,
    windowTotal: 1000,
    windowSampleCount: 29500,
    selfShare: 0,
    totalShare: 56,
    ownShare: 42,
    callerChains: [],
    callees: [],
    otherFiles: [],
    truncated: false,
  };

  test("the function's evidence as text, citing the Profiler", async () => {
    const readFunction: jest.SpiedFunction<
      typeof ProfileEvidence.readFunction
    > = jest.spyOn(ProfileEvidence, "readFunction").mockResolvedValue(EVIDENCE);

    const result: ToolExecutionResult = await GetProfileFunctionTool.execute(
      {
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
        beforeStartTime: "2026-10-20T10:00:00Z",
        beforeEndTime: "2026-10-20T11:00:00Z",
      },
      context(),
    );

    expect(result.dataForLlm).toContain("Own-code time: 42%");
    expect(result.citationTarget?.type).toBe(AIChatCitationTargetType.Profiles);
    expect(
      readFunction.mock.calls[0]![0].beforeWindow?.startTime.toISOString(),
    ).toBe("2026-10-20T10:00:00.000Z");
  });

  test("a function that took no time says how to find the right one", async () => {
    jest.spyOn(ProfileEvidence, "readFunction").mockResolvedValue(null);

    const result: ToolExecutionResult = await GetProfileFunctionTool.execute(
      { functionName: "parseOrdr" },
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain(
      "Check its name against get_profile_hotspots",
    );
  });

  test("a call with no function is refused", async () => {
    await expect(GetProfileFunctionTool.execute({}, context())).rejects.toThrow(
      "functionName is required.",
    );
  });
});
