import Route from "Common/Types/API/Route";
import {
  DEFAULT_PROFILE_CATEGORY,
  PROFILE_CATEGORY_ORDER,
  ProfileCategory,
  ProfileCategoryAvailability,
  ProfileTypeActivity,
  ProfileValueUnit,
  getAvailableProfileCategories,
  getOtherProfileTypes,
  getProfileCategory,
  getProfileValueUnit,
  getQueryProfileTypes,
  isProfileCategory,
} from "Common/Utils/Profiles/ProfileTypes";
import {
  ProfileFrameOrigin,
  getProfileFrameOrigin,
} from "Common/Utils/Profiles/ProfileFrames";
import {
  ProfileTreeNode,
  getShareOfWindow,
} from "Common/Utils/Profiles/ProfileHotspot";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
  getOwnCodeChanges,
} from "Common/Utils/Profiles/ProfileComparison";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import {
  DEFAULT_PROFILES_RANGE_MINUTES,
  ProfilesCompareMode,
  ProfilesUrlState,
} from "./ProfilesUrlState";

/*
 * WHAT THE PROFILER SHOWS, WORKED OUT FROM ITS ADDRESS AND ITS DATA.
 *
 * The windows it reads (the one on screen, and the one it is compared
 * with), the kinds of profile it offers (only those with data, each in one
 * unit), the facts its headline puts in words, and where its "watch this
 * with a monitor" link goes. React-free, so App/Tests pins every rule.
 */

export interface ProfilesWindow {
  startTime: Date;
  endTime: Date;
  // A window of its own (from a trace, a citation), not a preset ending now.
  isCustom: boolean;
}

export interface ProfilesWindowPair {
  before: { startTime: Date; endTime: Date };
  after: { startTime: Date; endTime: Date };
}

const MINUTE_MS: number = 60 * 1000;

// The window on screen: a custom one, or the preset ending now.
export function getProfilesWindow(
  state: ProfilesUrlState,
  now: Date,
): ProfilesWindow {
  if (state.startTime && state.endTime) {
    return {
      startTime: state.startTime,
      endTime: state.endTime,
      isCustom: true,
    };
  }

  const minutes: number = state.rangeMinutes || DEFAULT_PROFILES_RANGE_MINUTES;

  return {
    startTime: new Date(now.getTime() - minutes * MINUTE_MS),
    endTime: now,
    isCustom: false,
  };
}

/*
 * A change too recent to compare: a deploy two minutes ago has two minutes
 * of profiles after it - not enough to say what got slower.
 */
export const MIN_MINUTES_AFTER_A_CHANGE: number = 5;

/*
 * The two windows a comparison reads, or null when there is none to make:
 *
 *   previous  the same length just before the window
 *   day/week  the same window a day or a week earlier
 *   change    the same length before and after the change - as long as the
 *             window on screen, and no longer than the time since the change
 */
export function getProfilesComparison(
  state: ProfilesUrlState,
  window: ProfilesWindow,
  now: Date,
): ProfilesWindowPair | null {
  const length: number = window.endTime.getTime() - window.startTime.getTime();

  switch (state.compare) {
    case ProfilesCompareMode.Previous:
      return {
        before: {
          startTime: new Date(window.startTime.getTime() - length),
          endTime: window.startTime,
        },
        after: { startTime: window.startTime, endTime: window.endTime },
      };
    case ProfilesCompareMode.Day:
    case ProfilesCompareMode.Week: {
      const shift: number =
        (state.compare === ProfilesCompareMode.Day ? 24 : 7 * 24) *
        60 *
        MINUTE_MS;

      return {
        before: {
          startTime: new Date(window.startTime.getTime() - shift),
          endTime: new Date(window.endTime.getTime() - shift),
        },
        after: { startTime: window.startTime, endTime: window.endTime },
      };
    }
    case ProfilesCompareMode.Change: {
      if (!state.changeTime) {
        return null;
      }

      const sinceChange: number = now.getTime() - state.changeTime.getTime();

      if (sinceChange < MIN_MINUTES_AFTER_A_CHANGE * MINUTE_MS) {
        return null;
      }

      const side: number = Math.min(length, sinceChange);

      return {
        before: {
          startTime: new Date(state.changeTime.getTime() - side),
          endTime: state.changeTime,
        },
        after: {
          startTime: state.changeTime,
          endTime: new Date(state.changeTime.getTime() + side),
        },
      };
    }
    default:
      return null;
  }
}

// What each kind is called on the page, and what it answers.
export const PROFILE_KIND_LABELS: Record<ProfileCategory, string> = {
  [ProfileCategory.Cpu]: translationKey("CPU time"),
  [ProfileCategory.Wall]: translationKey("Wall time"),
  [ProfileCategory.Memory]: translationKey("Memory"),
  [ProfileCategory.Allocations]: translationKey("Allocations"),
  [ProfileCategory.Locks]: translationKey("Locks"),
  [ProfileCategory.Goroutines]: translationKey("Goroutines"),
  [ProfileCategory.Other]: translationKey("Other"),
};

export const PROFILE_KIND_DESCRIPTIONS: Record<ProfileCategory, string> = {
  [ProfileCategory.Cpu]: translationKey("Where the processor time goes"),
  [ProfileCategory.Wall]: translationKey(
    "Where the time goes, waiting included",
  ),
  [ProfileCategory.Memory]: translationKey("What holds memory right now"),
  [ProfileCategory.Allocations]: translationKey(
    "What allocates memory, and keeps the garbage collector busy",
  ),
  [ProfileCategory.Locks]: translationKey("Where code waits on a lock"),
  [ProfileCategory.Goroutines]: translationKey(
    "Where the goroutines are waiting",
  ),
  [ProfileCategory.Other]: translationKey("A profile type of its own"),
};

/*
 * "the CPU time" in "spent 41% of its CPU time in": the kind as the
 * headline's sentences name it.
 */
export const PROFILE_KIND_NOUNS: Record<ProfileCategory, string> = {
  [ProfileCategory.Cpu]: translationKey("CPU time"),
  [ProfileCategory.Wall]: translationKey("wall time"),
  [ProfileCategory.Memory]: translationKey("memory"),
  [ProfileCategory.Allocations]: translationKey("allocations"),
  [ProfileCategory.Locks]: translationKey("lock waits"),
  [ProfileCategory.Goroutines]: translationKey("goroutines"),
  [ProfileCategory.Other]: translationKey("samples"),
};

// One thing the Profiler can be asked to analyze, as the page offers it.
export interface ProfileKindChoice {
  // What goes in the address: a kind ("cpu") or one raw type.
  selection: string;
  category: ProfileCategory;
  // The raw types it is read as here, in one unit.
  queryTypes: Array<string>;
  unit: ProfileValueUnit;
  sampleCount: number;
  // True for one raw type (a count, or a type of no kind).
  isRawType: boolean;
}

export interface ProfileKindChoices {
  // The kinds with data, in the order a person looks for them.
  kinds: Array<ProfileKindChoice>;
  /*
   * Everything else with data, one raw type each: the count-valued types a
   * kind leaves out (objects, contentions) and types of no kind.
   */
  rawTypes: Array<ProfileKindChoice>;
}

export function getProfileKindChoices(
  activity: ReadonlyArray<ProfileTypeActivity>,
): ProfileKindChoices {
  const available: Array<ProfileCategoryAvailability> =
    getAvailableProfileCategories(activity);

  const kinds: Array<ProfileKindChoice> = available.map(
    (entry: ProfileCategoryAvailability): ProfileKindChoice => {
      return {
        selection: entry.category,
        category: entry.category,
        queryTypes: entry.queryTypes,
        unit: entry.unit,
        sampleCount: entry.sampleCount,
        isRawType: false,
      };
    },
  );

  const inKinds: Set<string> = new Set(
    kinds.flatMap((kind: ProfileKindChoice): Array<string> => {
      return kind.queryTypes;
    }),
  );

  const rawTypes: Array<ProfileKindChoice> = [];

  // The types a kind left out, busiest first, then those of no kind.
  const leftOut: Array<ProfileTypeActivity> = activity
    .filter((row: ProfileTypeActivity): boolean => {
      return (
        Boolean(row.profileType) &&
        row.sampleCount > 0 &&
        !inKinds.has(row.profileType) &&
        getProfileCategory(row.profileType) !== ProfileCategory.Other
      );
    })
    .sort((a: ProfileTypeActivity, b: ProfileTypeActivity): number => {
      return b.sampleCount - a.sampleCount;
    });

  for (const row of [...leftOut, ...getOtherProfileTypes(activity)]) {
    if (
      rawTypes.some((choice: ProfileKindChoice): boolean => {
        return choice.selection === row.profileType;
      })
    ) {
      continue;
    }

    rawTypes.push({
      selection: row.profileType,
      category: getProfileCategory(row.profileType),
      queryTypes: [row.profileType],
      unit: getProfileValueUnit(row.profileType, row.unit),
      sampleCount: row.sampleCount,
      isRawType: true,
    });
  }

  return { kinds, rawTypes };
}

/*
 * The kind to read for a selection. When the scope has data for it, it is
 * read as the scope's own raw types. When it has none - a kind picked in
 * another scope, or a scope with no profiles yet - it is still read (and
 * the page says it found nothing), with every raw name of the kind.
 */
export function resolveProfileKind(data: {
  selection: string | undefined;
  choices: ProfileKindChoices;
}): ProfileKindChoice {
  const selection: string = (data.selection || DEFAULT_PROFILE_CATEGORY).trim();

  const match: ProfileKindChoice | undefined = [
    ...data.choices.kinds,
    ...data.choices.rawTypes,
  ].find((choice: ProfileKindChoice): boolean => {
    return choice.selection === selection;
  });

  if (match) {
    return match;
  }

  if (isProfileCategory(selection)) {
    const queryTypes: Array<string> = getQueryProfileTypes(selection) || [];

    return {
      selection,
      category: selection,
      queryTypes,
      unit: getProfileValueUnit(queryTypes[0] || ""),
      sampleCount: 0,
      isRawType: false,
    };
  }

  return {
    selection,
    category: getProfileCategory(selection),
    queryTypes: [selection],
    unit: getProfileValueUnit(selection),
    sampleCount: 0,
    isRawType: true,
  };
}

/*
 * The kind a page with no kind in its address opens on: CPU time when the
 * scope has it, otherwise the first kind it has. Undefined while nothing
 * is known, and for a scope with no profiles.
 */
export function getDefaultProfileSelection(
  choices: ProfileKindChoices,
): string | undefined {
  const cpu: ProfileKindChoice | undefined = choices.kinds.find(
    (choice: ProfileKindChoice): boolean => {
      return choice.category === ProfileCategory.Cpu;
    },
  );

  return (cpu || choices.kinds[0] || choices.rawTypes[0])?.selection;
}

// The kinds in display order, for a list that must name them all.
export const PROFILE_KINDS_IN_ORDER: ReadonlyArray<ProfileCategory> =
  PROFILE_CATEGORY_ORDER.filter((category: ProfileCategory): boolean => {
    return category !== ProfileCategory.Other;
  });

// One function as the overview lists it.
export interface ProfileFunctionRow {
  functionName: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  /*
   * For the application's own code: the function with the library, runtime
   * and system code it calls, down to the next function of its own - the
   * time a change to it can win back. 0 for other code.
   */
  ownValue: number;
}

export interface ProfileHeadlineFacts {
  // The function with the most self time, and its share of the window.
  leader: ProfileFunctionRow | null;
  leaderShare: number;
  // The top three functions' self time, together.
  topThreeShare: number;
  topThreeCount: number;
  /*
   * The function of the application's own code with the most own-code
   * time, when the leader is not one (a runtime's JSON.parse leads, but
   * the fix is in the code that calls it), and that share.
   */
  topOwn: ProfileFunctionRow | null;
  topOwnShare: number;
}

/*
 * How the function list ranks: by self time, by total time, or only the
 * application's own functions by their own-code time ("Your code").
 * Comparing two windows, "own" keeps the application's own functions.
 */
export type ProfileFunctionView = "self" | "total" | "own";

export const PROFILE_FUNCTION_VIEWS: ReadonlyArray<ProfileFunctionView> = [
  "self",
  "total",
  "own",
];

/*
 * The rows the list shows at first, and the most it shows when asked for
 * all: the flame graph has the rest.
 */
export const PROFILE_FUNCTION_ROWS: number = 10;
export const PROFILE_FUNCTION_ROWS_ALL: number = 50;

// The function list's read sorts as the view ranks.
export function getFunctionListSort(
  view: ProfileFunctionView,
): "selfValue" | "totalValue" | "ownValue" {
  switch (view) {
    case "total":
      return "totalValue";
    case "own":
      return "ownValue";
    default:
      return "selfValue";
  }
}

// The rows a view shows, ranked, at most PROFILE_FUNCTION_ROWS.
export function getShownFunctionRows(
  rows: ReadonlyArray<ProfileFunctionRow>,
  view: ProfileFunctionView,
  limit: number = PROFILE_FUNCTION_ROWS,
): Array<ProfileFunctionRow> {
  /*
   * Each view lists what it ranks by: functions that did work themselves
   * (Self), that were on the stack at all (Total), or the application's
   * own functions with own-code time (Your code).
   */
  const shown: Array<ProfileFunctionRow> = rows.filter(
    (row: ProfileFunctionRow): boolean => {
      if (view === "own") {
        return (
          row.ownValue > 0 && getProfileOrigin(row) === ProfileFrameOrigin.Own
        );
      }

      return view === "total" ? row.totalValue > 0 : row.selfValue > 0;
    },
  );

  return shown
    .sort((a: ProfileFunctionRow, b: ProfileFunctionRow): number => {
      if (view === "own") {
        return b.ownValue - a.ownValue || b.selfValue - a.selfValue;
      }

      return view === "total"
        ? b.totalValue - a.totalValue || b.selfValue - a.selfValue
        : b.selfValue - a.selfValue || b.totalValue - a.totalValue;
    })
    .slice(0, limit);
}

/*
 * The functions whose share moved, the biggest moves first either way, at
 * most `limit`: by self share, or - only the application's own functions -
 * by own-code share.
 */
export function getShownFunctionChanges(
  changes: ReadonlyArray<ProfileFunctionChange>,
  onlyOwnCode: boolean,
  limit: number = PROFILE_FUNCTION_ROWS,
): Array<ProfileFunctionChange> {
  if (onlyOwnCode) {
    return getOwnCodeChanges(changes).slice(0, limit);
  }

  return changes
    .filter((change: ProfileFunctionChange): boolean => {
      return change.direction !== ProfileChangeDirection.Same;
    })
    .sort((a: ProfileFunctionChange, b: ProfileFunctionChange): number => {
      return (
        Math.abs(b.selfShareChange) - Math.abs(a.selfShareChange) ||
        a.functionName.localeCompare(b.functionName)
      );
    })
    .slice(0, limit);
}

export function getProfileOrigin(row: {
  fileName: string;
  functionName: string;
  frameType: string;
}): ProfileFrameOrigin {
  return getProfileFrameOrigin(row.fileName, row.functionName, row.frameType);
}

export function getProfileHeadlineFacts(
  functions: ReadonlyArray<ProfileFunctionRow>,
  windowTotal: number,
): ProfileHeadlineFacts {
  const bySelf: Array<ProfileFunctionRow> = [...functions].sort(
    (a: ProfileFunctionRow, b: ProfileFunctionRow): number => {
      return b.selfValue - a.selfValue;
    },
  );

  const leader: ProfileFunctionRow | null =
    bySelf[0] && bySelf[0].selfValue > 0 ? bySelf[0] : null;
  const topThree: Array<ProfileFunctionRow> = bySelf
    .slice(0, 3)
    .filter((row: ProfileFunctionRow): boolean => {
      return row.selfValue > 0;
    });

  let topOwn: ProfileFunctionRow | null = null;

  if (leader && getProfileOrigin(leader) !== ProfileFrameOrigin.Own) {
    /*
     * The own function with the most own-code time: the parser whose time
     * all goes to JSON.parse, not the request handler above it (whose own
     * code is the parser's caller, and takes nothing itself).
     */
    const own: Array<ProfileFunctionRow> = functions
      .filter((row: ProfileFunctionRow): boolean => {
        return (
          getProfileOrigin(row) === ProfileFrameOrigin.Own && row.ownValue > 0
        );
      })
      .sort((a: ProfileFunctionRow, b: ProfileFunctionRow): number => {
        return (
          b.ownValue - a.ownValue ||
          b.selfValue - a.selfValue ||
          a.functionName.localeCompare(b.functionName)
        );
      });

    topOwn = own[0] || null;
  }

  return {
    leader,
    leaderShare: leader ? getShareOfWindow(leader.selfValue, windowTotal) : 0,
    topThreeShare: getShareOfWindow(
      topThree.reduce((sum: number, row: ProfileFunctionRow): number => {
        return sum + row.selfValue;
      }, 0),
      windowTotal,
    ),
    topThreeCount: topThree.length,
    topOwn,
    topOwnShare: topOwn ? getShareOfWindow(topOwn.ownValue, windowTotal) : 0,
  };
}

/*
 * For a function that is not the application's own (JSON.parse, a
 * driver's query): the function of the application's own code that calls
 * it the most - where a change can make it run less. Read from its callers
 * tree, the heaviest callers first, each followed up the stack to the
 * first frame of the application's own. Null when no own code calls it.
 */
export function getNearestOwnCaller(
  callers: ProfileTreeNode | null | undefined,
): { functionName: string; fileName: string } | null {
  if (!callers) {
    return null;
  }

  const byWeight: (nodes: Array<ProfileTreeNode>) => Array<ProfileTreeNode> = (
    nodes: Array<ProfileTreeNode>,
  ): Array<ProfileTreeNode> => {
    return [...nodes].sort((a: ProfileTreeNode, b: ProfileTreeNode) => {
      return b.totalValue - a.totalValue;
    });
  };

  // Breadth first, heaviest first: the nearest own caller of the most time.
  let level: Array<ProfileTreeNode> = byWeight(callers.children);
  let depth: number = 0;

  while (level.length > 0 && depth < 64) {
    for (const node of level) {
      if (
        getProfileOrigin({
          fileName: node.fileName,
          functionName: node.functionName,
          frameType: node.frameType || "",
        }) === ProfileFrameOrigin.Own
      ) {
        return { functionName: node.functionName, fileName: node.fileName };
      }
    }

    level = byWeight(
      level.flatMap((node: ProfileTreeNode): Array<ProfileTreeNode> => {
        return node.children;
      }),
    );
    depth += 1;
  }

  return null;
}

/*
 * A monitor threshold for a function's share, from what it takes now:
 * comfortably above today (half again, at least ten points more), rounded
 * up to a multiple of five, between 5% and 95%.
 */
export function suggestFunctionShareThreshold(currentShare: number): number {
  const share: number = Number.isFinite(currentShare)
    ? Math.max(0, currentShare)
    : 0;
  const above: number = share + Math.max(10, share * 0.5);
  const rounded: number = Math.ceil(above / 5) * 5;

  return Math.min(95, Math.max(5, rounded));
}

// The query parameters Create Monitor reads to start a Profiles monitor.
export const PROFILE_MONITOR_QUERY_PARAMS: {
  serviceId: string;
  functionName: string;
  profileType: string;
  threshold: string;
} = {
  serviceId: "profileServiceId",
  functionName: "profileFunction",
  profileType: "profileType",
  threshold: "profileThreshold",
};

/*
 * Create Monitor, opened on a Profiles monitor that watches one function's
 * share of a service's time (Pages/Monitor/Create reads these).
 */
export function buildProfileMonitorRoute(data: {
  serviceId?: string | undefined;
  functionName: string;
  profileType: string;
  threshold: number;
}): Route {
  const base: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );
  const search: URLSearchParams = new URLSearchParams();

  if (data.serviceId) {
    search.set(PROFILE_MONITOR_QUERY_PARAMS.serviceId, data.serviceId);
  }

  search.set(PROFILE_MONITOR_QUERY_PARAMS.functionName, data.functionName);
  search.set(PROFILE_MONITOR_QUERY_PARAMS.profileType, data.profileType);
  search.set(PROFILE_MONITOR_QUERY_PARAMS.threshold, String(data.threshold));

  return new Route(`${base.toString()}?${search.toString()}`);
}
