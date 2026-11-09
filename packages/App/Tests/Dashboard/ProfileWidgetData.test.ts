import { beforeAll, describe, expect, test } from "@jest/globals";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import {
  PROFILE_WIDGET_KINDS,
  PROFILE_WIDGET_KIND_OPTIONS,
  PROFILE_WIDGET_RANK_OPTIONS,
} from "Common/Utils/Dashboard/Components/DashboardProfileWidgetShared";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type { ProfileFunctionRow } from "../../FeatureSet/Dashboard/src/Utils/ProfilesView";
import type { ProfileWidgetFunctionRow } from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ProfileWidgetData";
import {
  PROFILED_SERVICE_ALL_VALUE,
  PROFILED_SERVICE_LOOKBACK_DAYS,
  ProfiledServiceChoice,
  getProfiledServiceChoices,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ProfiledServiceChoices";

/*
 * THE DASHBOARD'S PROFILE WIDGETS, IN PLAIN NODE.
 *
 * The Flame Graph and Top Functions widgets read what the Profiler reads;
 * what they decide for themselves lives in ProfileWidgetData and the
 * Service picker's ProfiledServiceChoices, both React-free, and is pinned
 * here: the window they read for a dashboard's range, whose profiles (a
 * pinned service, the dashboard's service variable, every service), the
 * rows Top Functions lists and their shares, and where each link goes.
 * The settings' words are held to the Profiler's own, so a reader meets
 * one vocabulary on the tile and one click later.
 */

type DataModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ProfileWidgetData");
type ViewModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ProfilesView");
type CopyModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy");
type UrlModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/ProfilesUrlState");

let Data: DataModule;
let View: ViewModule;
let Copy: CopyModule;
let Url: UrlModule;

/*
 * Common/UI/Config reads `window` the moment it loads, and these modules
 * reach it through RouteMap, so the browser stub has to exist before the
 * deferred imports run (as ProfilerViewRules.test.ts does).
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

  Data = await import(
    "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/ProfileWidgetData"
  );
  View = await import("../../FeatureSet/Dashboard/src/Utils/ProfilesView");
  Copy = await import(
    "../../FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy"
  );
  Url = await import("../../FeatureSet/Dashboard/src/Utils/ProfilesUrlState");
});

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;
const END: Date = new Date("2026-11-09T12:00:00.000Z");

const CHECKOUT: string = "60000000-0000-4000-8000-0000000000a1";
const PROFILER_PATH: RegExp = /\/profiles$/;
const UUID_SHAPE: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENTS: string = "60000000-0000-4000-8000-0000000000a2";

function variable(data: Partial<DashboardVariable>): DashboardVariable {
  return {
    id: data.id || "variable-1",
    name: data.name || "service",
    type: data.type || DashboardVariableType.TelemetryAttribute,
    ...data,
  } as DashboardVariable;
}

function row(
  functionName: string,
  fileName: string,
  values: { self: number; total: number; own?: number },
): ProfileFunctionRow {
  return {
    functionName,
    fileName,
    lineNumber: 12,
    frameType: "",
    selfValue: values.self,
    totalValue: values.total,
    sampleCount: 10,
    ownValue: values.own ?? 0,
  };
}

function queryOf(route: { toString: () => string }): URLSearchParams {
  const text: string = route.toString();
  const at: number = text.indexOf("?");

  return new URLSearchParams(at >= 0 ? text.slice(at + 1) : "");
}

function pathOf(route: { toString: () => string }): string {
  const text: string = route.toString();
  const at: number = text.indexOf("?");

  return at >= 0 ? text.slice(0, at) : text;
}

describe("the window a widget reads", () => {
  test("is the dashboard's range when it is 7 days or less", () => {
    const start: Date = new Date(END.getTime() - 6 * HOUR);

    expect(
      Data.getProfileWidgetWindow({ startTime: start, endTime: END }),
    ).toEqual({ startTime: start, endTime: END, isCapped: false });

    const week: Date = new Date(END.getTime() - 7 * DAY);

    expect(
      Data.getProfileWidgetWindow({ startTime: week, endTime: END }),
    ).toEqual({ startTime: week, endTime: END, isCapped: false });
  });

  test("is the newest 7 days of a longer range, and says it is cut", () => {
    const quarter: Date = new Date(END.getTime() - 90 * DAY);

    expect(
      Data.getProfileWidgetWindow({ startTime: quarter, endTime: END }),
    ).toEqual({
      startTime: new Date(END.getTime() - 7 * DAY),
      endTime: END,
      isCapped: true,
    });

    // A minute past the week is cut too: the Profiler reads no longer window.
    const weekAndAMinute: Date = new Date(END.getTime() - 7 * DAY - 60 * 1000);

    expect(
      Data.getProfileWidgetWindow({
        startTime: weekAndAMinute,
        endTime: END,
      })?.isCapped,
    ).toBe(true);
  });

  test("is the Profiler's longest window, in milliseconds", () => {
    expect(Data.PROFILE_WIDGET_MAX_WINDOW_MS).toBe(
      Url.MAX_PROFILES_WINDOW_MINUTES * 60 * 1000,
    );
    expect(Data.PROFILE_WIDGET_MAX_WINDOW_MS).toBe(7 * DAY);
  });

  test("is no window for a range with no start, no end, or an end before its start", () => {
    expect(
      Data.getProfileWidgetWindow({ startTime: undefined, endTime: END }),
    ).toBeNull();
    expect(
      Data.getProfileWidgetWindow({ startTime: END, endTime: undefined }),
    ).toBeNull();
    expect(
      Data.getProfileWidgetWindow({ startTime: END, endTime: END }),
    ).toBeNull();
    expect(
      Data.getProfileWidgetWindow({
        startTime: new Date(END.getTime() + HOUR),
        endTime: END,
      }),
    ).toBeNull();
    expect(
      Data.getProfileWidgetWindow({
        startTime: new Date("not a date"),
        endTime: END,
      }),
    ).toBeNull();
  });

  test("hands back dates of its own, never the range's", () => {
    const start: Date = new Date(END.getTime() - HOUR);
    const window: ReturnType<typeof Data.getProfileWidgetWindow> =
      Data.getProfileWidgetWindow({ startTime: start, endTime: END });

    expect(window?.startTime).not.toBe(start);
    expect(window?.endTime).not.toBe(END);
  });
});

describe("the dashboard's service variable", () => {
  test("picks nothing on a dashboard with no variable", () => {
    expect(Data.getProfileWidgetServiceNames(undefined)).toBeNull();
    expect(Data.getProfileWidgetServiceNames([])).toBeNull();
  });

  test("is a Telemetry Attribute variable on the service name, with or without its resource prefix", () => {
    expect(Data.PROFILE_WIDGET_SERVICE_VARIABLE_KEYS).toEqual([
      "resource.service.name",
      "service.name",
    ]);

    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          attributeKey: "resource.service.name",
          selectedValue: "checkout",
        }),
      ]),
    ).toEqual(["checkout"]);

    expect(
      Data.getProfileWidgetServiceNames([
        variable({ attributeKey: "service.name", selectedValue: "payments" }),
      ]),
    ).toEqual(["payments"]);
  });

  test("leaves out every other variable: another attribute, another source", () => {
    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          attributeKey: "resource.host.name",
          selectedValue: "web-01",
        }),
        variable({
          type: DashboardVariableType.CustomList,
          attributeKey: "resource.service.name",
          selectedValue: "checkout",
        }),
        variable({
          type: DashboardVariableType.TextInput,
          selectedValue: "checkout",
        }),
      ]),
    ).toBeNull();
  });

  test("on All picks nothing, and a single-select falls back to its default", () => {
    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          attributeKey: "resource.service.name",
          selectedValue: "",
          defaultValue: "checkout",
        }),
      ]),
    ).toBeNull();

    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          attributeKey: "resource.service.name",
          defaultValue: "checkout",
        }),
      ]),
    ).toEqual(["checkout"]);

    // A multi-select with no picks is All: its default never applies.
    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          attributeKey: "resource.service.name",
          isMultiSelect: true,
          selectedValues: [],
          defaultValue: "checkout",
        }),
      ]),
    ).toBeNull();
  });

  test("a multi-select picks each of its names, once, in order, across variables", () => {
    expect(
      Data.getProfileWidgetServiceNames([
        variable({
          id: "a",
          attributeKey: "resource.service.name",
          isMultiSelect: true,
          selectedValues: ["checkout", " payments ", "checkout", ""],
        }),
        variable({
          id: "b",
          attributeKey: "service.name",
          selectedValue: "payments",
        }),
        variable({
          id: "c",
          attributeKey: "service.name",
          selectedValue: "search",
        }),
      ]),
    ).toEqual(["checkout", "payments", "search"]);
  });
});

describe("whose profiles a widget reads", () => {
  test("a pinned service wins over the toolbar's pick", () => {
    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: CHECKOUT,
        variableServiceNames: ["payments"],
        variableServiceIds: [PAYMENTS],
      }),
    ).toEqual({ kind: "pinned", serviceIds: [CHECKOUT] });
  });

  test("with every service, the ones the dashboard's service variable picks", () => {
    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: null,
        variableServiceNames: ["checkout", "payments"],
        variableServiceIds: [CHECKOUT, PAYMENTS],
      }),
    ).toEqual({ kind: "variable", serviceIds: [CHECKOUT, PAYMENTS] });
  });

  test("picked names that match no service read no service at all", () => {
    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: null,
        variableServiceNames: ["gone"],
        variableServiceIds: [],
      }),
    ).toEqual({ kind: "variable", serviceIds: [] });

    // Not found yet: still none, never every service.
    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: null,
        variableServiceNames: ["checkout"],
        variableServiceIds: null,
      }),
    ).toEqual({ kind: "variable", serviceIds: [] });
  });

  test("with no pin and no pick, every profiled service", () => {
    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: null,
        variableServiceNames: null,
        variableServiceIds: null,
      }),
    ).toEqual({ kind: "all", serviceIds: undefined });

    expect(
      Data.getProfileWidgetScope({
        pinnedServiceId: null,
        variableServiceNames: [],
        variableServiceIds: [CHECKOUT],
      }),
    ).toEqual({ kind: "all", serviceIds: undefined });
  });

  test("the services' key is the same in any order, and tells every service from none", () => {
    expect(Data.getProfileWidgetServicesKey([PAYMENTS, CHECKOUT])).toBe(
      Data.getProfileWidgetServicesKey([CHECKOUT, PAYMENTS]),
    );
    expect(Data.getProfileWidgetServicesKey(undefined)).toBe("all");
    expect(Data.getProfileWidgetServicesKey([])).toBe("none");
    expect(Data.getProfileWidgetServicesKey([CHECKOUT])).not.toBe(
      Data.getProfileWidgetServicesKey([PAYMENTS]),
    );
  });

  test("the scope's key moves with the window and the services, and nothing else", () => {
    const window: { startTime: Date; endTime: Date; isCapped: boolean } = {
      startTime: new Date(END.getTime() - HOUR),
      endTime: END,
      isCapped: false,
    };

    const key: string = Data.getProfileWidgetScopeKey({
      window,
      serviceIds: [CHECKOUT],
    });

    expect(
      Data.getProfileWidgetScopeKey({
        window: { ...window },
        serviceIds: [CHECKOUT],
      }),
    ).toBe(key);
    expect(
      Data.getProfileWidgetScopeKey({
        window: { ...window, endTime: new Date(END.getTime() + 60 * 1000) },
        serviceIds: [CHECKOUT],
      }),
    ).not.toBe(key);
    expect(
      Data.getProfileWidgetScopeKey({ window, serviceIds: undefined }),
    ).not.toBe(key);
  });
});

describe("the rows Top Functions lists", () => {
  // Window total 1000: the shares are the values divided by ten.
  const ROWS: Array<ProfileFunctionRow> = [
    row("JSON.parse", "node:internal/json", { self: 400, total: 420 }),
    row("parseOrder", "src/orders/parse.ts", {
      self: 150,
      total: 700,
      own: 600,
    }),
    row("handleRequest", "src/server.ts", { self: 50, total: 900, own: 250 }),
    row("express.Router", "node_modules/express/lib/router.js", {
      self: 0,
      total: 950,
    }),
    row("main", "src/index.ts", { self: 0, total: 1000, own: 100 }),
  ];

  test("by Self: the Profiler's ranking, each with its self share", () => {
    const rows: Array<ProfileWidgetFunctionRow> =
      Data.getProfileWidgetFunctionRows({
        rows: ROWS,
        windowTotal: 1000,
        rank: "self",
        maxRows: 10,
      });

    expect(
      rows.map((shown: ProfileWidgetFunctionRow) => {
        return [shown.functionName, shown.share, shown.value];
      }),
    ).toEqual([
      ["JSON.parse", 40, 400],
      ["parseOrder", 15, 150],
      ["handleRequest", 5, 50],
    ]);

    // The very rows the Profiler's own list ranks.
    expect(
      rows.map((shown: ProfileWidgetFunctionRow) => {
        return shown.functionName;
      }),
    ).toEqual(
      View.getShownFunctionRows(ROWS, "self", 10).map(
        (shown: ProfileFunctionRow) => {
          return shown.functionName;
        },
      ),
    );
  });

  test("by Total: with everything each function calls", () => {
    expect(
      Data.getProfileWidgetFunctionRows({
        rows: ROWS,
        windowTotal: 1000,
        rank: "total",
        maxRows: 3,
      }).map((shown: ProfileWidgetFunctionRow) => {
        return [shown.functionName, shown.share];
      }),
    ).toEqual([
      ["main", 100],
      ["express.Router", 95],
      ["handleRequest", 90],
    ]);
  });

  test("Your code: only the application's own functions, by own-code time", () => {
    expect(
      Data.getProfileWidgetFunctionRows({
        rows: ROWS,
        windowTotal: 1000,
        rank: "own",
        maxRows: 10,
      }).map((shown: ProfileWidgetFunctionRow) => {
        return [shown.functionName, shown.share, shown.value];
      }),
    ).toEqual([
      ["parseOrder", 60, 600],
      ["handleRequest", 25, 250],
      ["main", 10, 100],
    ]);
  });

  test("at most the rows the widget is set to list", () => {
    expect(
      Data.getProfileWidgetFunctionRows({
        rows: ROWS,
        windowTotal: 1000,
        rank: "total",
        maxRows: 1,
      }),
    ).toHaveLength(1);
  });

  test("keep each function's file and line, for its line under the name", () => {
    expect(
      Data.getProfileWidgetFunctionRows({
        rows: ROWS,
        windowTotal: 1000,
        rank: "self",
        maxRows: 1,
      })[0],
    ).toEqual({
      functionName: "JSON.parse",
      fileName: "node:internal/json",
      lineNumber: 12,
      frameType: "",
      share: 40,
      value: 400,
    });
  });

  test("a window with no total gives every row no share, never a division by zero", () => {
    for (const shown of Data.getProfileWidgetFunctionRows({
      rows: ROWS,
      windowTotal: 0,
      rank: "self",
      maxRows: 10,
    })) {
      expect(shown.share).toBe(0);
    }
  });

  test("ask the server to sort as the Profiler asks it", () => {
    expect(Data.getProfileWidgetFunctionSort("self")).toBe("selfValue");
    expect(Data.getProfileWidgetFunctionSort("total")).toBe("totalValue");
    expect(Data.getProfileWidgetFunctionSort("own")).toBe("ownValue");
  });

  test("read more functions than the most rows a widget lists", () => {
    expect(Data.PROFILE_WIDGET_FUNCTION_READ_LIMIT).toBeGreaterThan(50);
  });
});

describe("the Profiler, opened from a widget", () => {
  const WINDOW: { startTime: Date; endTime: Date; isCapped: boolean } = {
    startTime: new Date("2026-11-09T11:00:00.000Z"),
    endTime: new Date("2026-11-09T12:00:00.000Z"),
    isCapped: false,
  };

  test("opens on the widget's service, kind and window", () => {
    const route: { toString: () => string } =
      Data.getProfileWidgetProfilerRoute({
        serviceIds: [CHECKOUT],
        kind: ProfileCategory.Memory,
        window: WINDOW,
      });

    expect(pathOf(route)).toMatch(PROFILER_PATH);

    const query: URLSearchParams = queryOf(route);

    expect(query.get("serviceId")).toBe(CHECKOUT);
    expect(query.get("profileType")).toBe("memory");
    expect(query.get("startTime")).toBe(WINDOW.startTime.toISOString());
    expect(query.get("endTime")).toBe(WINDOW.endTime.toISOString());
    expect(query.get("function")).toBeNull();
  });

  test("leaves CPU time out of the address, as the Profiler's default", () => {
    expect(
      queryOf(
        Data.getProfileWidgetProfilerRoute({
          serviceIds: [CHECKOUT],
          kind: ProfileCategory.Cpu,
          window: WINDOW,
        }),
      ).get("profileType"),
    ).toBeNull();
  });

  test("opens on every service for every service, or for several picked at once", () => {
    for (const serviceIds of [undefined, [CHECKOUT, PAYMENTS], []]) {
      expect(
        queryOf(
          Data.getProfileWidgetProfilerRoute({
            serviceIds,
            kind: ProfileCategory.Cpu,
            window: WINDOW,
          }),
        ).get("serviceId"),
      ).toBeNull();
    }
  });

  test("opens a function's panel, with its file", () => {
    const query: URLSearchParams = queryOf(
      Data.getProfileWidgetProfilerRoute({
        serviceIds: [CHECKOUT],
        kind: ProfileCategory.Cpu,
        window: WINDOW,
        functionName: "parseOrder",
        fileName: "src/orders/parse.ts",
      }),
    );

    expect(query.get("function")).toBe("parseOrder");
    expect(query.get("file")).toBe("src/orders/parse.ts");
  });

  test("names no file without a function", () => {
    expect(
      queryOf(
        Data.getProfileWidgetProfilerRoute({
          serviceIds: [CHECKOUT],
          kind: ProfileCategory.Cpu,
          window: WINDOW,
          functionName: "",
          fileName: "src/orders/parse.ts",
        }),
      ).get("file"),
    ).toBeNull();
  });

  test("opens on a window the Profiler accepts from its address", () => {
    const window: ReturnType<typeof Data.getProfileWidgetWindow> =
      Data.getProfileWidgetWindow({
        startTime: new Date(END.getTime() - 30 * DAY),
        endTime: END,
      });

    const route: { toString: () => string } =
      Data.getProfileWidgetProfilerRoute({
        serviceIds: [CHECKOUT],
        kind: ProfileCategory.Cpu,
        window: window!,
      });

    const query: URLSearchParams = queryOf(route);
    const state: ReturnType<typeof Url.parseProfilesUrlState> =
      Url.parseProfilesUrlState((name: string): string | null => {
        return query.get(name);
      });

    // A capped window is one the Profiler reads, not one it throws away.
    expect(state.startTime?.toISOString()).toBe(
      window!.startTime.toISOString(),
    );
    expect(state.endTime?.toISOString()).toBe(window!.endTime.toISOString());
    expect(state.serviceId).toBe(CHECKOUT);
  });
});

describe("the settings, in the Profiler's own words", () => {
  test("offer every kind the Profiler offers, but Other", () => {
    expect([...PROFILE_WIDGET_KINDS]).toEqual(
      View.PROFILE_KINDS_IN_ORDER.filter((kind: ProfileCategory) => {
        return kind !== ProfileCategory.Other;
      }),
    );

    expect(
      PROFILE_WIDGET_KIND_OPTIONS.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([...PROFILE_WIDGET_KINDS]);
  });

  test("name and describe each kind as the Profiler's kind picker does", () => {
    for (const option of PROFILE_WIDGET_KIND_OPTIONS) {
      const kind: ProfileCategory = option.value as ProfileCategory;

      expect({ kind, label: option.label }).toEqual({
        kind,
        label: View.PROFILE_KIND_LABELS[kind],
      });
      expect({ kind, description: option.description }).toEqual({
        kind,
        description: View.PROFILE_KIND_DESCRIPTIONS[kind],
      });
    }
  });

  test("name each ranking as the Profiler's Self / Total / Your code switch does", () => {
    expect(
      PROFILE_WIDGET_RANK_OPTIONS.map((option: DropdownOption) => {
        return [option.value, option.label, option.description];
      }),
    ).toEqual([
      ["self", Copy.SORT_BY_SELF, Copy.SELF_EXPLAINED],
      ["total", Copy.SORT_BY_TOTAL, Copy.TOTAL_EXPLAINED],
      ["own", Copy.VIEW_YOUR_CODE, Copy.OWN_CODE_SENTENCE],
    ]);
  });
});

describe("the Service setting's choices", () => {
  const NAMES: Record<string, string> = {
    [CHECKOUT]: "checkout",
    [PAYMENTS]: "payments",
    "60000000-0000-4000-8000-0000000000a3": "web-01",
  };

  const getName: (id: string) => string | undefined = (
    id: string,
  ): string | undefined => {
    return NAMES[id];
  };

  test("list what sent profiles, busiest first, then by name", () => {
    const choices: Array<ProfiledServiceChoice> = getProfiledServiceChoices({
      entities: [
        { id: PAYMENTS, sampleCount: 10 },
        { id: "60000000-0000-4000-8000-0000000000a3", sampleCount: 500 },
        { id: CHECKOUT, sampleCount: 10 },
      ],
      selectedId: null,
      getName,
      getTypeLabel: (id: string): string | undefined => {
        return id.endsWith("a3") ? "Host" : undefined;
      },
    });

    expect(
      choices.map((choice: ProfiledServiceChoice) => {
        return [choice.name, choice.typeLabel];
      }),
    ).toEqual([
      ["web-01", "Host"],
      ["checkout", undefined],
      ["payments", undefined],
    ]);
  });

  test("keep a pinned service that sent nothing lately, last", () => {
    const choices: Array<ProfiledServiceChoice> = getProfiledServiceChoices({
      entities: [{ id: PAYMENTS, sampleCount: 10 }],
      selectedId: CHECKOUT,
      getName,
      getTypeLabel: (): undefined => {
        return undefined;
      },
    });

    expect(
      choices.map((choice: ProfiledServiceChoice) => {
        return [choice.id, choice.sampleCount];
      }),
    ).toEqual([
      [PAYMENTS, 10],
      [CHECKOUT, 0],
    ]);
  });

  test("name a service by its id until its name is found, and list each once", () => {
    const unnamed: string = "60000000-0000-4000-8000-0000000000ff";

    const choices: Array<ProfiledServiceChoice> = getProfiledServiceChoices({
      entities: [
        { id: unnamed, sampleCount: 3 },
        { id: unnamed, sampleCount: 4 },
        { id: " ", sampleCount: 9 },
      ],
      selectedId: unnamed,
      getName,
      getTypeLabel: (): undefined => {
        return undefined;
      },
    });

    expect(choices).toEqual([
      { id: unnamed, name: unnamed, typeLabel: undefined, sampleCount: 7 },
    ]);
  });

  test("All services is a value no id can be, and the picker looks back as far as the Profiler's first steps", () => {
    expect(PROFILED_SERVICE_ALL_VALUE.length).toBeGreaterThan(0);
    expect(PROFILED_SERVICE_ALL_VALUE).not.toMatch(UUID_SHAPE);
    expect(PROFILED_SERVICE_LOOKBACK_DAYS).toBe(30);
  });
});
