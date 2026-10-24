import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ProfileAggregationService, {
  FunctionListItem,
  FunctionListResult,
  ServiceActivityItem,
} from "../../../../../Server/Services/ProfileAggregationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import ProfileHotspotDetector, {
  ProfileHotspotListReading,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ProfileHotspotDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import ProfileEvidence, {
  ProfileFunctionEvidence,
  ProfileKind,
} from "../../../../../Server/Utils/Profile/ProfileEvidence";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { ProfileFrameOrigin } from "../../../../../Utils/Profiles/ProfileFrames";
import {
  ProfileCategory,
  ProfileValueUnit,
} from "../../../../../Utils/Profiles/ProfileTypes";
import { ProfileFixReason } from "../../../../../Utils/Suggestions/ProfileFixSuggestion";

/*
 * Slow code, found in a service's profiles (ProfileHotspotDetector): once
 * an hour, the ten busiest profiled services, a function of a service's own
 * code that takes 10% or more of its time - or whose share grew 5 points or
 * more over the same hour the day before - confirmed by the function's own
 * reading, the one the Profiler's Fix with AI is decided on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5092aaaa-0000-4000-8000-000000000001",
);
const CHECKOUT_ID: string = "5092aaaa-0000-4000-8000-000000000002";
const BILLING_ID: string = "5092aaaa-0000-4000-8000-000000000003";
const HOST_ID: string = "5092aaaa-0000-4000-8000-000000000004";
// A callee named like a tag, written as code with the tag broken.
const BROKEN_TAG_LINE: RegExp =
  /^- Spends its time calling: `<.img src=x>` \(0\.1%\)$/u;

// The scanner's first look of an hour: profiles are read.
const SCAN_TICK: Date = new Date("2026-10-24T09:00:04.000Z");

const CPU: ProfileKind = {
  selection: "cpu",
  category: ProfileCategory.Cpu,
  queryTypes: ["cpu"],
  unit: ProfileValueUnit.Nanoseconds,
};

function activity(
  overrides: Partial<ServiceActivityItem> = {},
): ServiceActivityItem {
  return {
    primaryEntityId: CHECKOUT_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    sampleCount: 5000,
    profileCount: 60,
    totalValue: 0,
    ...overrides,
  };
}

function item(overrides: Partial<FunctionListItem> = {}): FunctionListItem {
  return {
    functionName: "OrderParser.parse",
    fileName: "src/orders/parser.ts",
    lineNumber: 42,
    selfValue: 100,
    totalValue: 300,
    sampleCount: 900,
    frameType: "",
    ownValue: 1800,
    ...overrides,
  };
}

function list(
  functions: Array<FunctionListItem>,
  overrides: Partial<FunctionListResult> = {},
): FunctionListResult {
  return {
    functions,
    windowTotal: 10000,
    windowSampleCount: 5000,
    truncated: false,
    ...overrides,
  };
}

function evidence(
  overrides: Partial<ProfileFunctionEvidence> = {},
): ProfileFunctionEvidence {
  return {
    functionName: "OrderParser.parse",
    fileName: "src/orders/parser.ts",
    lineNumber: 42,
    frameType: "",
    origin: ProfileFrameOrigin.Own,
    kind: CPU,
    window: {
      startTime: new Date("2026-10-24T08:00:04.000Z"),
      endTime: SCAN_TICK,
    },
    selfValue: 100,
    totalValue: 3000,
    ownValue: 1800,
    sampleCount: 900,
    windowTotal: 10000,
    windowSampleCount: 5000,
    selfShare: 1,
    totalShare: 30,
    ownShare: 18,
    callerChains: [
      {
        frames: [
          { functionName: "handleOrder", fileName: "src/orders/api.ts" },
          { functionName: "router", fileName: "src/server.ts" },
        ],
        value: 1700,
      },
    ],
    callees: [
      {
        functionName: "JSON.parse",
        fileName: "",
        frameType: "",
        value: 1500,
      },
    ],
    otherFiles: [],
    truncated: false,
    ...overrides,
  };
}

describe("ProfileHotspotDetector.pickServices", () => {
  test("services only, busiest first, with enough samples, not a company AI tool's", () => {
    const picked: Array<string> = ProfileHotspotDetector.pickServices({
      activity: [
        activity({ primaryEntityId: BILLING_ID, sampleCount: 9000 }),
        activity({ primaryEntityId: CHECKOUT_ID, sampleCount: 7000 }),
        activity({
          primaryEntityId: HOST_ID,
          primaryEntityType: ServiceType.Host,
          sampleCount: 99999,
        }),
        activity({
          primaryEntityId: "5092aaaa-0000-4000-8000-000000000005",
          sampleCount: 499,
        }),
        activity({
          primaryEntityId: "5092AAAA-0000-4000-8000-000000000006",
          sampleCount: 8000,
        }),
      ],
      excludedServiceIds: new Set<string>([
        "5092aaaa-0000-4000-8000-000000000006",
      ]),
    });

    expect(picked).toEqual([BILLING_ID, CHECKOUT_ID]);
  });

  test("a profile from before the type was stamped is read as a service", () => {
    expect(
      ProfileHotspotDetector.pickServices({
        activity: [activity({ primaryEntityType: "" })],
        excludedServiceIds: new Set<string>(),
      }),
    ).toEqual([CHECKOUT_ID]);
  });

  test("at most ten services a look, ids lower-cased", () => {
    const many: Array<ServiceActivityItem> = [];

    for (let index: number = 0; index < 15; index++) {
      many.push(
        activity({
          primaryEntityId: `5092AAAA-0000-4000-8000-0000000000${(10 + index).toString()}`,
          sampleCount: 1000 + index,
        }),
      );
    }

    const picked: Array<string> = ProfileHotspotDetector.pickServices({
      activity: many,
      excludedServiceIds: new Set<string>(),
    });

    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe("5092aaaa-0000-4000-8000-000000000024");
  });
});

describe("ProfileHotspotDetector.pickCandidates", () => {
  test("the application's own functions that pass the gates on the lists, regressions first", () => {
    const picked: Array<ProfileHotspotListReading> =
      ProfileHotspotDetector.pickCandidates({
        category: ProfileCategory.Cpu,
        recent: list([
          // 18%: hot.
          item(),
          // A library: never.
          item({
            functionName: "lodash.cloneDeep",
            fileName: "node_modules/lodash/clone.js",
            ownValue: 5000,
          }),
          // 7%, up from 1%: grew.
          item({
            functionName: "Cart.total",
            fileName: "src/cart.ts",
            ownValue: 700,
          }),
          // 3%: nothing.
          item({
            functionName: "Tax.rate",
            fileName: "src/tax.ts",
            ownValue: 300,
          }),
        ]),
        baseline: list([
          item({ ownValue: 1700 }),
          item({
            functionName: "Cart.total",
            fileName: "src/cart.ts",
            ownValue: 100,
          }),
        ]),
      });

    expect(
      picked.map((candidate: ProfileHotspotListReading) => {
        return [candidate.item.functionName, candidate.reason];
      }),
    ).toEqual([
      ["Cart.total", ProfileFixReason.Grew],
      ["OrderParser.parse", ProfileFixReason.Hot],
    ]);
    expect(picked[0]!.reading.ownShareBefore).toBe(1);
    expect(picked[0]!.reading.baselineWindowSampleCount).toBe(5000);
  });

  test("a function missing from the baseline list grew from nothing", () => {
    const picked: Array<ProfileHotspotListReading> =
      ProfileHotspotDetector.pickCandidates({
        category: ProfileCategory.Cpu,
        recent: list([item({ ownValue: 600 })]),
        baseline: list([]),
      });

    expect(picked).toHaveLength(1);
    expect(picked[0]!.reason).toBe(ProfileFixReason.Grew);
    expect(picked[0]!.reading.ownShareBefore).toBe(0);
  });

  test("with no baseline, only a large share counts", () => {
    expect(
      ProfileHotspotDetector.pickCandidates({
        category: ProfileCategory.Cpu,
        recent: list([item({ ownValue: 600 })]),
        baseline: null,
      }),
    ).toEqual([]);
  });

  test("a kind slow code is not looked for in is never picked", () => {
    expect(
      ProfileHotspotDetector.pickCandidates({
        category: ProfileCategory.Memory,
        recent: list([item({ ownValue: 9000 })]),
        baseline: null,
      }),
    ).toEqual([]);
  });

  test("at most five a service, the largest first, in a stable order", () => {
    const functions: Array<FunctionListItem> = [];

    for (let index: number = 0; index < 8; index++) {
      functions.push(
        item({
          functionName: `f${index}`,
          fileName: `src/f${index}.ts`,
          ownValue: 1000 + index * 10,
        }),
      );
    }

    const picked: Array<ProfileHotspotListReading> =
      ProfileHotspotDetector.pickCandidates({
        category: ProfileCategory.Cpu,
        recent: list(functions),
        baseline: null,
      });

    expect(
      picked.map((candidate: ProfileHotspotListReading) => {
        return candidate.item.functionName;
      }),
    ).toEqual(["f7", "f6", "f5", "f4", "f3"]);
  });
});

describe("ProfileHotspotDetector.buildCandidate", () => {
  test("the insight: its fingerprint, title, severity, service and evidence", () => {
    const candidate: InsightCandidate = ProfileHotspotDetector.buildCandidate({
      serviceId: CHECKOUT_ID,
      serviceName: "checkout",
      kind: CPU,
      category: ProfileCategory.Cpu,
      evidence: evidence(),
      reading: ProfileHotspotDetector.toReading(
        evidence(),
        ProfileCategory.Cpu,
      ),
      reason: ProfileFixReason.Hot,
      baseline: {
        startTime: new Date("2026-10-23T08:00:04.000Z"),
        endTime: new Date("2026-10-23T09:00:04.000Z"),
      },
    });

    expect(candidate.insightType).toBe(AIInsightType.ProfileHotspot);
    expect(candidate.fingerprint).toBe(
      `profile-hotspot:${CHECKOUT_ID}:cpu:OrderParser.parse:src/orders/parser.ts`,
    );
    expect(candidate.title).toBe(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );
    expect(candidate.severity).toBe(AIInsightSeverity.Medium);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(CHECKOUT_ID);
    expect(candidate.evidence.profile).toEqual({
      serviceId: CHECKOUT_ID,
      functionName: "OrderParser.parse",
      fileName: "src/orders/parser.ts",
      lineNumber: 42,
      profileType: "cpu",
      category: "cpu",
      reason: "Hot",
      ownShare: 18,
      functionSampleCount: 900,
      windowSampleCount: 5000,
      windowStartTime: "2026-10-24T08:00:04.000Z",
      windowEndTime: "2026-10-24T09:00:04.000Z",
      callers: [
        {
          functionName: "handleOrder",
          fileName: "src/orders/api.ts",
          share: 17,
        },
      ],
      callees: [{ functionName: "JSON.parse", fileName: "", share: 15 }],
    });
    expect(candidate.detailMarkdown.split("\n")).toEqual([
      "**Slow code in checkout**",
      "",
      "- Function: `OrderParser.parse` in `src/orders/parser.ts:42`",
      "- Takes 18% of the service's CPU time over the hour, with the library and runtime code it calls (900 of 5,000 samples)",
      "- Spends its time calling: `JSON.parse` (15%)",
      "- Called from: `handleOrder`",
    ]);
  });

  test("a regression carries what it took the day before, and its window", () => {
    const grown: ProfileFunctionEvidence = evidence({
      ownShare: 12,
      before: {
        window: {
          startTime: new Date("2026-10-23T08:00:04.000Z"),
          endTime: new Date("2026-10-23T09:00:04.000Z"),
        },
        selfShare: 0.5,
        totalShare: 4,
        ownShare: 1.5,
        sampleCount: 100,
        windowSampleCount: 4800,
      },
    });

    const candidate: InsightCandidate = ProfileHotspotDetector.buildCandidate({
      serviceId: CHECKOUT_ID,
      serviceName: "checkout",
      kind: CPU,
      category: ProfileCategory.Cpu,
      evidence: grown,
      reading: ProfileHotspotDetector.toReading(grown, ProfileCategory.Cpu),
      reason: ProfileFixReason.Grew,
      baseline: grown.before!.window,
    });

    expect(candidate.title).toBe(
      "OrderParser.parse grew to 12% of the CPU time in checkout, from 1.5%",
    );
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    expect(candidate.evidence.profile?.ownShareBefore).toBe(1.5);
    expect(candidate.evidence.profile?.baselineStartTime).toBe(
      "2026-10-23T08:00:04.000Z",
    );
    expect(candidate.detailMarkdown).toContain(
      "- At the same time the day before: 1.5%",
    );
  });

  test("names from the profiler are written into the Markdown as text, never as Markdown", () => {
    const sly: ProfileFunctionEvidence = evidence({
      functionName: "a`b](javascript:x)*c*",
      fileName: "src/[x].ts",
      callees: [
        { functionName: "<img src=x>", fileName: "", frameType: "", value: 10 },
      ],
      callerChains: [],
    });

    const candidate: InsightCandidate = ProfileHotspotDetector.buildCandidate({
      serviceId: CHECKOUT_ID,
      serviceName: "**loud**\n# heading",
      kind: CPU,
      category: ProfileCategory.Cpu,
      evidence: sly,
      reading: ProfileHotspotDetector.toReading(sly, ProfileCategory.Cpu),
      reason: ProfileFixReason.Hot,
      baseline: sly.window,
    });

    const lines: Array<string> = candidate.detailMarkdown.split("\n");

    // The service's name stays inside the heading line: no heading of its own.
    expect(
      lines.filter((line: string) => {
        return line.startsWith("#");
      }),
    ).toEqual([]);
    expect(lines[0]).not.toContain("****loud**");
    // Code spans hold their backticks: the function name cannot close one.
    expect(lines[2]).toBe(
      "- Function: `` a`b](javascript:x)*c* `` in `src/[x].ts:42`",
    );
    // An HTML-looking name is shown as code, broken so it is never a tag.
    expect(lines[4]).toMatch(BROKEN_TAG_LINE);
    expect(lines[4]).not.toContain("<img");
  });
});

describe("ProfileHotspotDetector.detect", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function wire(data: {
    activity?: Array<ServiceActivityItem>;
    services?: Array<{ id: string; name: string }>;
    restricted?: Array<string>;
    kind?: ProfileKind | null;
    lists?: (request: JSONObject) => FunctionListResult;
    read?: (request: JSONObject) => ProfileFunctionEvidence | null;
  }): {
    activity: SpyInstance<typeof ProfileAggregationService.getServiceActivity>;
    functionList: SpyInstance<typeof ProfileAggregationService.getFunctionList>;
    readFunction: SpyInstance<typeof ProfileEvidence.readFunction>;
  } {
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue(data.restricted || []);

    const activitySpy: SpyInstance<
      typeof ProfileAggregationService.getServiceActivity
    > = jest
      .spyOn(ProfileAggregationService, "getServiceActivity")
      .mockResolvedValue(data.activity || [activity()]);

    jest.spyOn(ServiceService, "findBy").mockResolvedValue(
      (data.services || [{ id: CHECKOUT_ID, name: "checkout" }]).map(
        (row: { id: string; name: string }): Service => {
          const service: Service = new Service();
          service.id = new ObjectID(row.id);
          service.name = row.name;
          return service;
        },
      ),
    );

    jest
      .spyOn(ProfileEvidence, "resolveKind")
      .mockResolvedValue(data.kind === undefined ? CPU : data.kind);

    const functionList: SpyInstance<
      typeof ProfileAggregationService.getFunctionList
    > = jest
      .spyOn(ProfileAggregationService, "getFunctionList")
      .mockImplementation(async (request: unknown) => {
        return data.lists ? data.lists(request as JSONObject) : list([item()]);
      });

    const readFunction: SpyInstance<typeof ProfileEvidence.readFunction> = jest
      .spyOn(ProfileEvidence, "readFunction")
      .mockImplementation(async (request: unknown) => {
        return data.read ? data.read(request as JSONObject) : evidence();
      });

    return { activity: activitySpy, functionList, readFunction };
  }

  test("not the hour's first look: nothing is read", async () => {
    const spies: ReturnType<typeof wire> = wire({});

    const candidates: Array<InsightCandidate> =
      await new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: new Date("2026-10-24T09:15:00.000Z"),
      });

    expect(candidates).toEqual([]);
    expect(spies.activity).not.toHaveBeenCalled();
    expect(spies.functionList).not.toHaveBeenCalled();
  });

  test("files a hot function of a busy service, read the way Fix with AI reads it", async () => {
    const spies: ReturnType<typeof wire> = wire({});

    const candidates: Array<InsightCandidate> =
      await new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );

    // The last hour, and the same hour the day before.
    const lists: Array<JSONObject> = spies.functionList.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as JSONObject;
      },
    );
    expect(lists[0]!["startTime"]).toEqual(
      new Date("2026-10-24T08:00:04.000Z"),
    );
    expect(lists[0]!["sortBy"]).toBe("ownValue");
    expect(lists[1]!["endTime"]).toEqual(new Date("2026-10-23T09:00:04.000Z"));
    expect((lists[0]!["serviceIds"] as Array<ObjectID>).map(String)).toEqual([
      CHECKOUT_ID,
    ]);

    // The function's own reading, by its file, compared with the day before.
    const read: JSONObject = spies.readFunction.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(read["functionName"]).toBe("OrderParser.parse");
    expect(read["fileName"]).toBe("src/orders/parser.ts");
    expect(read["beforeWindow"]).toEqual({
      startTime: new Date("2026-10-23T08:00:04.000Z"),
      endTime: new Date("2026-10-23T09:00:04.000Z"),
    });
  });

  test("the function's own reading decides: a list that overstates it files nothing", async () => {
    wire({
      read: () => {
        return evidence({ ownShare: 6, ownValue: 600 });
      },
    });

    await expect(
      new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      }),
    ).resolves.toEqual([]);
  });

  test("a function that took no time when read again files nothing", async () => {
    wire({
      read: () => {
        return null;
      },
    });

    await expect(
      new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      }),
    ).resolves.toEqual([]);
  });

  test("a service profiled for memory only is not read for slow code", async () => {
    const spies: ReturnType<typeof wire> = wire({
      kind: {
        selection: "memory",
        category: ProfileCategory.Memory,
        queryTypes: ["inuse_space"],
        unit: ProfileValueUnit.Bytes,
      },
    });

    await expect(
      new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      }),
    ).resolves.toEqual([]);
    expect(spies.functionList).not.toHaveBeenCalled();
  });

  test("at most two findings a service", async () => {
    const functions: Array<FunctionListItem> = [];

    for (let index: number = 0; index < 4; index++) {
      functions.push(
        item({
          functionName: `f${index}`,
          fileName: `src/f${index}.ts`,
          ownValue: 2000 - index,
        }),
      );
    }

    const spies: ReturnType<typeof wire> = wire({
      lists: () => {
        return list(functions);
      },
      read: (request: JSONObject) => {
        return evidence({
          functionName: request["functionName"] as string,
          fileName: request["fileName"] as string,
        });
      },
    });

    const candidates: Array<InsightCandidate> =
      await new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      });

    expect(candidates).toHaveLength(2);
    expect(spies.readFunction).toHaveBeenCalledTimes(2);
  });

  test("a company AI tool's service is left out of the read itself", async () => {
    const spies: ReturnType<typeof wire> = wire({
      restricted: [CHECKOUT_ID.toUpperCase()],
      activity: [activity()],
    });

    await expect(
      new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      }),
    ).resolves.toEqual([]);

    const request: JSONObject = spies.activity.mock
      .calls[0]![0] as unknown as JSONObject;
    expect(
      (request["excludedServiceIds"] as Array<ObjectID>).map(String),
    ).toEqual([CHECKOUT_ID]);
  });

  test("an id that is not one of the project's services is not read", async () => {
    const spies: ReturnType<typeof wire> = wire({ services: [] });

    await expect(
      new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      }),
    ).resolves.toEqual([]);
    expect(spies.functionList).not.toHaveBeenCalled();
  });

  test("one service failing to read does not stop the others", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    wire({
      activity: [
        activity({ primaryEntityId: BILLING_ID, sampleCount: 9000 }),
        activity({ primaryEntityId: CHECKOUT_ID, sampleCount: 8000 }),
      ],
      services: [
        { id: BILLING_ID, name: "billing" },
        { id: CHECKOUT_ID, name: "checkout" },
      ],
      lists: (request: JSONObject) => {
        const serviceIds: Array<string> = (
          request["serviceIds"] as Array<ObjectID>
        ).map(String);

        if (serviceIds.includes(BILLING_ID)) {
          throw new Error("ClickHouse timed out");
        }

        return list([item()]);
      },
    });

    const candidates: Array<InsightCandidate> =
      await new ProfileHotspotDetector().detect({
        projectId: PROJECT_ID,
        now: SCAN_TICK,
      });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.serviceName).toBe("checkout");
  });
});
