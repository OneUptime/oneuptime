import { beforeAll, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "Common/Utils/Profiles/ProfileComparison";
import { ProfileTreeNode } from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileCategory,
  ProfileTypeActivity,
  ProfileValueUnit,
} from "Common/Utils/Profiles/ProfileTypes";
import type {
  ProfileFunctionRow,
  ProfileHeadlineFacts,
  ProfileKindChoice,
  ProfileKindChoices,
  ProfilesWindow,
  ProfilesWindowPair,
} from "../../FeatureSet/Dashboard/src/Utils/ProfilesView";
import type { ProfilesUrlState } from "../../FeatureSet/Dashboard/src/Utils/ProfilesUrlState";
import type { ProfileMonitorLink } from "../../FeatureSet/Dashboard/src/Utils/ProfileMonitorPrefill";

/*
 * THE PROFILER'S RULES, IN PLAIN NODE.
 *
 * The Profiler keeps its whole view in its address (ProfilesUrlState),
 * works out from it and from the scope's data what to read and how to say
 * it (ProfilesView), and opens Create Monitor on a function's share
 * (ProfileMonitorPrefill). All three are React-free: every rule the pages
 * draw from is pinned here - which windows a comparison reads, which kinds
 * are offered and in which unit, what the headline names, which rows a
 * ranking lists, which of the application's own functions to point at, and
 * the monitor a link builds.
 */

type UrlStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ProfilesUrlState");
type ViewModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ProfilesView");
type PrefillModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ProfileMonitorPrefill");

let Url: UrlStateModule;
let View: ViewModule;
let Prefill: PrefillModule;

/*
 * Common/UI/Config reads `window` the moment it loads, and these modules
 * reach it through RouteMap, so the browser stub has to exist before the
 * deferred imports run (as AIInsightMonitorPrefill.test.ts does).
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Url = await import(
    "../../FeatureSet/Dashboard/src/Utils/ProfilesUrlState"
  );
  View = await import("../../FeatureSet/Dashboard/src/Utils/ProfilesView");
  Prefill = await import(
    "../../FeatureSet/Dashboard/src/Utils/ProfileMonitorPrefill"
  );
});

const SERVICE_ID: string = "60000000-0000-4000-8000-0000000000a1";
const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-10-20T12:00:00.000Z");

function params(query: string): (name: string) => string | null {
  const search: URLSearchParams = new URLSearchParams(query);

  return (name: string): string | null => {
    return search.get(name);
  };
}

function row(
  functionName: string,
  fileName: string,
  values: { self: number; total: number; own?: number; samples?: number },
): ProfileFunctionRow {
  return {
    functionName,
    fileName,
    lineNumber: 1,
    frameType: "",
    selfValue: values.self,
    totalValue: values.total,
    sampleCount: values.samples ?? 10,
    ownValue: values.own ?? 0,
  };
}

function tree(
  functionName: string,
  fileName: string,
  totalValue: number,
  children: Array<ProfileTreeNode> = [],
): ProfileTreeNode {
  return {
    functionName,
    fileName,
    selfValue: 0,
    totalValue,
    children,
  };
}

describe("the Profiler's address", () => {
  test("a plain address is the default view", () => {
    expect(Url.parseProfilesUrlState(params(""))).toEqual({});
  });

  test("reads every part of a view", () => {
    const state: ProfilesUrlState = Url.parseProfilesUrlState(
      params(
        `serviceId=${SERVICE_ID}&profileType=memory&rangeMinutes=360&compare=previous&function=parseOrder&file=src%2Forders%2Fparse.ts`,
      ),
    );

    expect(state).toEqual({
      serviceId: SERVICE_ID,
      profileType: "memory",
      rangeMinutes: 360,
      compare: Url.ProfilesCompareMode.Previous,
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
    });
  });

  test("a window of its own, and a deploy to compare across", () => {
    const state: ProfilesUrlState = Url.parseProfilesUrlState(
      params(
        "startTime=2026-10-20T10:00:00.000Z&endTime=2026-10-20T11:00:00.000Z&compare=change&changeTime=2026-10-20T10:30:00.000Z",
      ),
    );

    expect(state.startTime?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(state.endTime?.toISOString()).toBe("2026-10-20T11:00:00.000Z");
    expect(state.compare).toBe(Url.ProfilesCompareMode.Change);
    expect(state.changeTime?.toISOString()).toBe("2026-10-20T10:30:00.000Z");
  });

  test.each([
    ["a service id that is not one", "serviceId=checkout"],
    ["a type with a space in it", "profileType=cpu%20time"],
    ["a type that is too long", `profileType=${"a".repeat(65)}`],
    ["a window that is not a preset", "rangeMinutes=7"],
    [
      "a window that ends before it starts",
      "startTime=2026-10-20T11:00:00.000Z&endTime=2026-10-20T10:00:00.000Z",
    ],
    [
      "a window longer than a week",
      "startTime=2026-10-01T00:00:00.000Z&endTime=2026-10-20T00:00:00.000Z",
    ],
    ["a compare mode this build does not know", "compare=month"],
    ["a deploy compare without its time", "compare=change"],
    ["a file without its function", "file=src%2Fa.ts"],
    ["a function name of over a thousand characters", `function=${"f".repeat(1001)}`],
  ])("%s is read as the default", (_name: string, query: string) => {
    expect(Url.parseProfilesUrlState(params(query))).toEqual({});
  });

  test("a default is written as nothing, so the plain address stays plain", () => {
    expect(
      Url.getProfilesQueryParams({ profileType: "cpu", rangeMinutes: 60 }),
    ).toEqual({
      serviceId: null,
      profileType: null,
      rangeMinutes: null,
      startTime: null,
      endTime: null,
      compare: null,
      changeTime: null,
      function: null,
      file: null,
    });
  });

  test("a window of its own wins over a preset, and a change time goes only with a deploy compare", () => {
    const written: Record<string, string | null> = Url.getProfilesQueryParams(
      {
        rangeMinutes: 360,
        startTime: new Date("2026-10-20T10:00:00.000Z"),
        endTime: new Date("2026-10-20T11:00:00.000Z"),
        compare: Url.ProfilesCompareMode.Day,
        changeTime: new Date("2026-10-20T10:30:00.000Z"),
      },
    );

    expect(written["rangeMinutes"]).toBeNull();
    expect(written["startTime"]).toBe("2026-10-20T10:00:00.000Z");
    expect(written["compare"]).toBe("day");
    expect(written["changeTime"]).toBeNull();
  });

  test("what is written reads back as the same view", () => {
    const state: ProfilesUrlState = {
      serviceId: SERVICE_ID,
      profileType: "alloc_objects",
      startTime: new Date("2026-10-20T10:00:00.000Z"),
      endTime: new Date("2026-10-20T11:00:00.000Z"),
      compare: Url.ProfilesCompareMode.Change,
      changeTime: new Date("2026-10-20T10:20:00.000Z"),
      functionName: "search.(*Index).Lookup",
      fileName: "/app/internal/search/index.go",
    };
    const search: URLSearchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(
      Url.getProfilesQueryParams(state),
    )) {
      if (value !== null) {
        search.set(key, value);
      }
    }

    expect(Url.parseProfilesUrlState(params(search.toString()))).toEqual(
      state,
    );
  });

  test("the Profiler's route carries the view", () => {
    const route: string = Url.buildProfilesRoute({
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
    }).toString();

    expect(route).toContain("/profiles?");
    expect(route).toContain(`serviceId=${SERVICE_ID}`);
    expect(route).toContain("function=parseOrder");
    expect(Url.buildProfilesRoute({}).toString()).not.toContain("?");
  });

  test("a window around a moment never ends in the future", () => {
    const around: { startTime: Date; endTime: Date } =
      Url.getProfilesWindowAround({
        time: new Date(NOW.getTime() - 5 * MINUTE),
        beforeMinutes: 15,
        afterMinutes: 15,
        now: NOW,
      });

    expect(around.startTime.toISOString()).toBe("2026-10-20T11:40:00.000Z");
    expect(around.endTime.toISOString()).toBe(NOW.toISOString());

    // A moment in the future still gets a window of a minute.
    const ahead: { startTime: Date; endTime: Date } =
      Url.getProfilesWindowAround({
        time: new Date(NOW.getTime() + 30 * MINUTE),
        beforeMinutes: 15,
        afterMinutes: 15,
        now: NOW,
      });

    expect(ahead.endTime.getTime() - ahead.startTime.getTime()).toBe(MINUTE);
  });
});

describe("the windows the Profiler reads", () => {
  test("a preset ends now; a window of its own is read as it is", () => {
    const preset: ProfilesWindow = View.getProfilesWindow(
      { rangeMinutes: 15 },
      NOW,
    );

    expect(preset).toEqual({
      startTime: new Date(NOW.getTime() - 15 * MINUTE),
      endTime: NOW,
      isCustom: false,
    });
    // The last hour, by default.
    expect(
      View.getProfilesWindow({}, NOW).startTime.getTime(),
    ).toBe(NOW.getTime() - 60 * MINUTE);

    const custom: ProfilesWindow = View.getProfilesWindow(
      {
        startTime: new Date("2026-10-19T10:00:00.000Z"),
        endTime: new Date("2026-10-19T12:00:00.000Z"),
      },
      NOW,
    );

    expect(custom.isCustom).toBe(true);
    expect(custom.startTime.toISOString()).toBe("2026-10-19T10:00:00.000Z");
  });

  test("the period before: the same length just before", () => {
    const window: ProfilesWindow = View.getProfilesWindow({}, NOW);
    const pair: ProfilesWindowPair | null = View.getProfilesComparison(
      { compare: Url.ProfilesCompareMode.Previous },
      window,
      NOW,
    );

    expect(pair!.before.startTime.getTime()).toBe(
      NOW.getTime() - 120 * MINUTE,
    );
    expect(pair!.before.endTime.getTime()).toBe(window.startTime.getTime());
    expect(pair!.after.endTime.getTime()).toBe(NOW.getTime());
  });

  // The table is read before the modules load: the modes by their values.
  test.each([
    ["day", 24 * 60],
    ["week", 7 * 24 * 60],
  ])("%s: the same window, that much earlier", (mode: string, minutes: number) => {
    const window: ProfilesWindow = View.getProfilesWindow({}, NOW);
    const pair: ProfilesWindowPair | null = View.getProfilesComparison(
      { compare: mode as never },
      window,
      NOW,
    );

    expect(pair!.before.endTime.getTime()).toBe(
      NOW.getTime() - minutes * MINUTE,
    );
    expect(
      pair!.before.endTime.getTime() - pair!.before.startTime.getTime(),
    ).toBe(60 * MINUTE);
  });

  test("a deploy: as long as the window either side, no longer than the time since it", () => {
    const window: ProfilesWindow = View.getProfilesWindow({}, NOW);
    const changeTime: Date = new Date(NOW.getTime() - 40 * MINUTE);
    const pair: ProfilesWindowPair | null = View.getProfilesComparison(
      { compare: Url.ProfilesCompareMode.Change, changeTime },
      window,
      NOW,
    );

    expect(pair!.before).toEqual({
      startTime: new Date(changeTime.getTime() - 40 * MINUTE),
      endTime: changeTime,
    });
    expect(pair!.after).toEqual({ startTime: changeTime, endTime: NOW });
  });

  test("a deploy minutes old has nothing to compare yet", () => {
    expect(
      View.getProfilesComparison(
        {
          compare: Url.ProfilesCompareMode.Change,
          changeTime: new Date(
            NOW.getTime() - (View.MIN_MINUTES_AFTER_A_CHANGE - 1) * MINUTE,
          ),
        },
        View.getProfilesWindow({}, NOW),
        NOW,
      ),
    ).toBeNull();
    expect(
      View.getProfilesComparison({}, View.getProfilesWindow({}, NOW), NOW),
    ).toBeNull();
  });
});

describe("the kinds the Profiler offers", () => {
  const activity: Array<ProfileTypeActivity> = [
    { profileType: "cpu", unit: "nanoseconds", sampleCount: 900, profileCount: 9 },
    // The eBPF profiler's CPU samples: counts, left out of CPU time here.
    { profileType: "samples", unit: "count", sampleCount: 50, profileCount: 2 },
    { profileType: "inuse_space", unit: "bytes", sampleCount: 300, profileCount: 9 },
    { profileType: "inuse_objects", unit: "count", sampleCount: 300, profileCount: 9 },
    { profileType: "custom_metric", unit: "count", sampleCount: 10, profileCount: 1 },
    { profileType: "mutex", unit: "nanoseconds", sampleCount: 0, profileCount: 0 },
  ];

  test("only kinds with data, in the order a person looks for them, one unit each", () => {
    const choices: ProfileKindChoices = View.getProfileKindChoices(activity);

    expect(
      choices.kinds.map((kind: ProfileKindChoice) => {
        return [kind.selection, kind.queryTypes, kind.unit];
      }),
    ).toEqual([
      ["cpu", ["cpu"], ProfileValueUnit.Nanoseconds],
      ["memory", ["inuse_space"], ProfileValueUnit.Bytes],
    ]);
  });

  test("everything else with data is one raw type each, busiest first", () => {
    const choices: ProfileKindChoices = View.getProfileKindChoices(activity);

    expect(
      choices.rawTypes.map((choice: ProfileKindChoice) => {
        return [choice.selection, choice.category, choice.unit];
      }),
    ).toEqual([
      ["inuse_objects", ProfileCategory.Memory, ProfileValueUnit.Count],
      ["samples", ProfileCategory.Cpu, ProfileValueUnit.Count],
      ["custom_metric", ProfileCategory.Other, ProfileValueUnit.Count],
    ]);
  });

  test("a page opens on CPU time when the scope has it, else the first kind, else a raw type", () => {
    expect(
      View.getDefaultProfileSelection(View.getProfileKindChoices(activity)),
    ).toBe("cpu");
    expect(
      View.getDefaultProfileSelection(
        View.getProfileKindChoices([
          { profileType: "alloc_space", unit: "bytes", sampleCount: 5, profileCount: 1 },
        ]),
      ),
    ).toBe("allocations");
    // A host's eBPF profiler alone: its samples are CPU time, in counts.
    expect(
      View.getDefaultProfileSelection(
        View.getProfileKindChoices([
          { profileType: "samples", unit: "count", sampleCount: 5, profileCount: 1 },
        ]),
      ),
    ).toBe("cpu");
    expect(
      View.getDefaultProfileSelection(View.getProfileKindChoices([])),
    ).toBeUndefined();
  });

  test("a kind the scope has no data for is still read, as every raw name of the kind", () => {
    const kind: ProfileKindChoice = View.resolveProfileKind({
      selection: "locks",
      choices: View.getProfileKindChoices(activity),
    });

    expect(kind.category).toBe(ProfileCategory.Locks);
    expect(kind.queryTypes).toContain("mutex");
    expect(kind.isRawType).toBe(false);
    expect(kind.sampleCount).toBe(0);

    const raw: ProfileKindChoice = View.resolveProfileKind({
      selection: "custom_metric",
      choices: View.getProfileKindChoices(activity),
    });

    expect(raw.isRawType).toBe(true);
    expect(raw.queryTypes).toEqual(["custom_metric"]);
    // No selection at all reads CPU time.
    expect(
      View.resolveProfileKind({
        selection: undefined,
        choices: View.getProfileKindChoices([]),
      }).category,
    ).toBe(ProfileCategory.Cpu);
  });
});

describe("what the headline says", () => {
  const WINDOW: number = 1000;
  const functions: Array<ProfileFunctionRow> = [
    row("JSON.parse", "node:internal/json", { self: 420, total: 420 }),
    row("parseOrder", "src/orders/parse.ts", { self: 0, total: 560, own: 420 }),
    row("handleCheckout", "src/routes/checkout.ts", { self: 0, total: 950, own: 160 }),
    row("main", "src/server.ts", { self: 0, total: 1000, own: 5 }),
    row("Socket.write", "node:net", { self: 160, total: 160 }),
    row("validateCart", "src/cart/validate.ts", { self: 100, total: 100, own: 100 }),
  ];

  test("the leader, the top three, and the own code with the most own-code time", () => {
    const facts: ProfileHeadlineFacts = View.getProfileHeadlineFacts(
      functions,
      WINDOW,
    );

    expect(facts.leader!.functionName).toBe("JSON.parse");
    expect(facts.leaderShare).toBeCloseTo(42, 6);
    expect(facts.topThreeCount).toBe(3);
    expect(facts.topThreeShare).toBeCloseTo(68, 6);
    // Not the handler every request runs through: the parser.
    expect(facts.topOwn!.functionName).toBe("parseOrder");
    expect(facts.topOwnShare).toBeCloseTo(42, 6);
  });

  test("when the leader is the application's own code, it is named once", () => {
    const facts: ProfileHeadlineFacts = View.getProfileHeadlineFacts(
      [row("validateCart", "src/cart/validate.ts", { self: 100, total: 100, own: 100 })],
      WINDOW,
    );

    expect(facts.leader!.functionName).toBe("validateCart");
    expect(facts.topOwn).toBeNull();
  });

  test("nothing sampled: no leader", () => {
    const facts: ProfileHeadlineFacts = View.getProfileHeadlineFacts([], 0);

    expect(facts.leader).toBeNull();
    expect(facts.topThreeCount).toBe(0);
  });
});

describe("the rows each ranking lists", () => {
  const rows: Array<ProfileFunctionRow> = [
    row("JSON.parse", "node:internal/json", { self: 420, total: 420 }),
    row("parseOrder", "src/orders/parse.ts", { self: 0, total: 560, own: 420 }),
    row("handleCheckout", "src/routes/checkout.ts", { self: 0, total: 950, own: 160 }),
    row("validateCart", "src/cart/validate.ts", { self: 100, total: 100, own: 100 }),
    row("Pool.query", "node_modules/pg/lib/pool.js", { self: 50, total: 160 }),
  ];

  const names: (shown: Array<ProfileFunctionRow>) => Array<string> = (
    shown: Array<ProfileFunctionRow>,
  ): Array<string> => {
    return shown.map((shownRow: ProfileFunctionRow): string => {
      return shownRow.functionName;
    });
  };

  test("Self lists the functions that did work themselves, most first", () => {
    expect(names(View.getShownFunctionRows(rows, "self"))).toEqual([
      "JSON.parse",
      "validateCart",
      "Pool.query",
    ]);
  });

  test("Total lists every function on the stack, most first", () => {
    expect(names(View.getShownFunctionRows(rows, "total"))).toEqual([
      "handleCheckout",
      "parseOrder",
      "JSON.parse",
      "Pool.query",
      "validateCart",
    ]);
  });

  test("Your code lists only the application's own, by own-code time", () => {
    expect(names(View.getShownFunctionRows(rows, "own"))).toEqual([
      "parseOrder",
      "handleCheckout",
      "validateCart",
    ]);
  });

  test("at most ten rows at first, fifty when asked for all", () => {
    const many: Array<ProfileFunctionRow> = Array.from(
      { length: 70 },
      (_value: unknown, index: number): ProfileFunctionRow => {
        return row(`fn${index}`, `src/f${index}.ts`, {
          self: 100 - index,
          total: 100,
        });
      },
    );

    expect(View.getShownFunctionRows(many, "self")).toHaveLength(
      View.PROFILE_FUNCTION_ROWS,
    );
    expect(
      View.getShownFunctionRows(many, "self", View.PROFILE_FUNCTION_ROWS_ALL),
    ).toHaveLength(50);
  });

  test("each ranking reads as its own sort on the server", () => {
    expect(View.getFunctionListSort("self")).toBe("selfValue");
    expect(View.getFunctionListSort("total")).toBe("totalValue");
    expect(View.getFunctionListSort("own")).toBe("ownValue");
  });

  test("comparing: the biggest self moves either way, or the own code's own-code moves", () => {
    const change: (
      functionName: string,
      fileName: string,
      selfShareChange: number,
      ownShareChange: number,
    ) => ProfileFunctionChange = (
      functionName: string,
      fileName: string,
      selfShareChange: number,
      ownShareChange: number,
    ): ProfileFunctionChange => {
      return {
        functionName,
        fileName,
        lineNumber: 0,
        frameType: "",
        before: null,
        after: null,
        selfShareChange,
        totalShareChange: 0,
        ownShareChange,
        direction:
          Math.abs(selfShareChange) < 0.5
            ? ProfileChangeDirection.Same
            : selfShareChange > 0
              ? ProfileChangeDirection.Slower
              : ProfileChangeDirection.Faster,
      };
    };
    const changes: Array<ProfileFunctionChange> = [
      change("JSON.parse", "node:internal/json", 21, 0),
      change("Socket.write", "node:net", -12, 0),
      change("parseOrder", "src/orders/parse.ts", 0, 21),
      change("validateCart", "src/cart/validate.ts", -7, -7),
      change("main", "src/server.ts", 0.1, 0.2),
    ];

    expect(
      View.getShownFunctionChanges(changes, false).map(
        (shown: ProfileFunctionChange): string => {
          return shown.functionName;
        },
      ),
    ).toEqual(["JSON.parse", "Socket.write", "validateCart"]);
    expect(
      View.getShownFunctionChanges(changes, true).map(
        (shown: ProfileFunctionChange): string => {
          return shown.functionName;
        },
      ),
    ).toEqual(["parseOrder", "validateCart"]);
  });
});

describe("the own code to change, for code that is not", () => {
  test("the own caller of the most time, nearest first", () => {
    const callers: ProfileTreeNode = tree("JSON.parse", "node:internal/json", 600, [
      tree("JSON.parse", "node:internal/json", 100, [
        tree("loadCatalog", "src/catalog.ts", 100),
      ]),
      tree("Router.handle", "node_modules/express/lib/router/index.js", 500, [
        tree("parseOrder", "src/orders/parse.ts", 500),
      ]),
    ]);

    expect(View.getNearestOwnCaller(callers)).toEqual({
      functionName: "parseOrder",
      fileName: "src/orders/parse.ts",
    });
  });

  test("none when no own code calls it", () => {
    expect(
      View.getNearestOwnCaller(
        tree("epoll_wait", "/lib/x86_64-linux-gnu/libc.so.6", 10, [
          tree("start_thread", "/lib/x86_64-linux-gnu/libc.so.6", 10),
        ]),
      ),
    ).toBeNull();
    expect(View.getNearestOwnCaller(null)).toBeNull();
  });
});

describe("a monitor on a function's share", () => {
  test.each([
    [0, 10],
    [12, 25],
    [56, 85],
    [90, 95],
    [Number.NaN, 10],
  ])("a function taking %s%% is watched above %s%%", (share: number, threshold: number) => {
    expect(View.suggestFunctionShareThreshold(share)).toBe(threshold);
  });

  test("Create Monitor is opened with the service, the function, the kind and the threshold", () => {
    const route: string = View.buildProfileMonitorRoute({
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
      profileType: "cpu",
      threshold: 85,
    }).toString();

    expect(route).toContain("/monitors/create?");
    expect(route).toContain(`profileServiceId=${SERVICE_ID}`);
    expect(route).toContain("profileFunction=parseOrder");
    expect(route).toContain("profileType=cpu");
    expect(route).toContain("profileThreshold=85");
  });

  test("the link reads back as the monitor it asks for", () => {
    const link: ProfileMonitorLink | null = Prefill.readProfileMonitorLink(
      params(
        `profileServiceId=${SERVICE_ID}&profileFunction=parseOrder&profileType=memory&profileThreshold=40`,
      ),
    );

    expect(link).toEqual({
      serviceId: SERVICE_ID,
      functionName: "parseOrder",
      profileType: "memory",
      threshold: 40,
    });
  });

  test("a link with no function is no link; anything else that does not hold up reads as its default", () => {
    expect(Prefill.readProfileMonitorLink(params("profileType=cpu"))).toBeNull();
    expect(
      Prefill.readProfileMonitorLink(
        params(
          "profileServiceId=checkout&profileFunction=parseOrder&profileType=cpu%20time&profileThreshold=140",
        ),
      ),
    ).toEqual({
      functionName: "parseOrder",
      profileType: "cpu",
      threshold: 25,
    });
  });

  test("the step reads the service's profiles of the kind, over five minutes", () => {
    const step: ReturnType<PrefillModule["buildProfileMonitorStep"]> =
      Prefill.buildProfileMonitorStep({
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        profileType: "memory",
        threshold: 40,
      });

    expect(step.functionName).toBe("parseOrder");
    expect(step.profileTypes).toEqual(["inuse_space", "heap", "space"]);
    expect(
      step.telemetryServiceIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SERVICE_ID]);
    expect(step.lastXSecondsOfProfiles).toBe(300);
  });

  const SEEDS: Parameters<PrefillModule["buildProfileMonitorCriteria"]>[0]["seeds"] =
    {
      operationalMonitorStatusId: new ObjectID(
        "aaaaaaaa-0000-4000-8000-000000000001",
      ),
      unhealthyMonitorStatusId: new ObjectID(
        "aaaaaaaa-0000-4000-8000-000000000002",
      ),
      rankedIncidentSeverityIds: [
        new ObjectID("bbbbbbbb-0000-4000-8000-000000000001"),
        new ObjectID("bbbbbbbb-0000-4000-8000-000000000002"),
      ],
      rankedAlertSeverityIds: [
        new ObjectID("cccccccc-0000-4000-8000-000000000001"),
        new ObjectID("cccccccc-0000-4000-8000-000000000002"),
      ],
    };

  test("an alert above the threshold that resolves itself, and its healthy mirror", () => {
    const instances: Array<MonitorCriteriaInstance> =
      Prefill.buildProfileMonitorCriteria({
        link: {
          serviceId: SERVICE_ID,
          functionName: "parseOrder",
          profileType: "cpu",
          threshold: 40,
        },
        seeds: SEEDS,
      }).data!.monitorCriteriaInstanceArray;

    const [unhealthy, healthy] = instances;

    expect(unhealthy!.data!.filters).toEqual([
      {
        checkOn: CheckOn.ProfileFunctionShare,
        filterType: FilterType.GreaterThan,
        value: 40,
      },
    ]);
    expect(unhealthy!.data!.monitorStatusId?.toString()).toBe(
      "aaaaaaaa-0000-4000-8000-000000000002",
    );
    expect(unhealthy!.data!.createAlerts).toBe(true);
    expect(unhealthy!.data!.alerts[0]!.autoResolveAlert).toBe(true);
    // An incident is filled in and left off: one switch to page on it.
    expect(unhealthy!.data!.createIncidents).toBe(false);
    expect(unhealthy!.data!.incidents).toHaveLength(1);
    expect(unhealthy!.data!.name).toBe("parseOrder: share of the CPU time");

    expect(healthy!.data!.filters).toEqual([
      {
        checkOn: CheckOn.ProfileFunctionShare,
        filterType: FilterType.LessThanOrEqualTo,
        value: 40,
      },
    ]);
    expect(healthy!.data!.monitorStatusId?.toString()).toBe(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
  });

  test("Create Monitor opens on a Profiles monitor its form accepts as it is", () => {
    const prefill: JSONObject | null = Prefill.buildProfileMonitorPrefill({
      link: {
        serviceId: SERVICE_ID,
        functionName: "parseOrder",
        profileType: "cpu",
        threshold: 40,
      },
      seeds: SEEDS,
    });

    expect(prefill!["monitorType"]).toBe(MonitorType.Profiles);
    expect(prefill!["name"]).toBe("parseOrder: share of the CPU time");
    expect(prefill!["description"]).toBe(
      "Alerts when parseOrder takes more than 40% of the CPU time.",
    );

    const steps: MonitorSteps = MonitorSteps.fromJSON(
      prefill!["monitorSteps"] as JSONObject,
    );
    const step: MonitorStep = steps.data!.monitorStepsInstanceArray[0]!;

    expect(step.data!.profileMonitor!.functionName).toBe("parseOrder");
    expect(
      MonitorSteps.getValidationError(steps, MonitorType.Profiles),
    ).toBeNull();
  });

  test("a project missing a status or a severity gets criteria without that part, not ones that cannot be saved", () => {
    const instances: Array<MonitorCriteriaInstance> =
      Prefill.buildProfileMonitorCriteria({
        link: { functionName: "parseOrder", profileType: "cpu", threshold: 40 },
        seeds: {
          operationalMonitorStatusId: null,
          unhealthyMonitorStatusId: null,
          rankedIncidentSeverityIds: [],
          rankedAlertSeverityIds: [],
        },
      }).data!.monitorCriteriaInstanceArray;

    expect(instances[0]!.data!.changeMonitorStatus).toBe(false);
    expect(instances[0]!.data!.alerts).toEqual([]);
    expect(instances[0]!.data!.createAlerts).toBe(false);
  });
});
