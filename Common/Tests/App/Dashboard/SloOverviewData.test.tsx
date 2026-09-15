import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * useSloOverviewData — the SLO overview's single poll.
 *
 * It replaced three independent fetches of the same SLO row per minute, so
 * the tests count requests: one SLO read per load, a poll that does not run
 * in a hidden tab, and a background failure that keeps the last numbers
 * instead of blanking the page. The notice fingerprint that decides when the
 * banner re-reads is covered too.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

// Lazy wrappers: jest.mock is hoisted above the mocks' own declarations.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
    },
  };
});

import useSloOverviewData, {
  getSloNoticeFingerprint,
  SLO_OVERVIEW_REFRESH_INTERVAL_MS,
  SLO_OVERVIEW_SELECT,
  UseSloOverviewDataResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloOverviewData";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import ObjectID from "../../../Types/ObjectID";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";

// A real UUID: ProjectUtil ignores a URL project id that is not one.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");

interface ModelRequest {
  modelType: unknown;
  id?: ObjectID;
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
}

// Partial<T> under exactOptionalPropertyTypes forbids the explicit undefined of an unset column.
type SloOverrides = {
  [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | undefined;
};

type BuildSloFunction = (overrides: SloOverrides) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: SloOverrides,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.isEnabled = true;
  slo.isArchived = false;
  slo.sloStatus = SloStatus.Healthy;
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.errorBudgetTotalSeconds = 2592;
  slo.currentSliPercentage = 99.95;
  slo.lastEvaluatedAt = new Date("2026-09-15T11:58:00.000Z");
  slo.monitors = [];
  Object.assign(slo, overrides);
  return slo;
};

const burnRule: ServiceLevelObjectiveBurnRateRule =
  new ServiceLevelObjectiveBurnRateRule();
burnRule._id = "5f8b7c1e2d3a4b5c6d7e6001";
burnRule.name = "Fast burn";
burnRule.isEnabled = true;
burnRule.burnRateThreshold = 14.4;

const ownerUser: ServiceLevelObjectiveOwnerUser =
  new ServiceLevelObjectiveOwnerUser();
ownerUser.user = new User();
ownerUser.user._id = "5f8b7c1e2d3a4b5c6d7e7001";

const ownerTeam: ServiceLevelObjectiveOwnerTeam =
  new ServiceLevelObjectiveOwnerTeam();
ownerTeam.team = new Team();
ownerTeam.team._id = "5f8b7c1e2d3a4b5c6d7e7002";
ownerTeam.team.name = "Payments";

type ListResultOfFunction = (data: Array<unknown>) => {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
};

const listResultOf: ListResultOfFunction = (
  data: Array<unknown>,
): { data: Array<unknown>; count: number; skip: number; limit: number } => {
  return { data: data, count: data.length, skip: 0, limit: data.length };
};

type StubApiFunction = (options: {
  slo?: ServiceLevelObjective | null;
  rulesError?: Error | undefined;
  countError?: Error | undefined;
  ownersError?: Error | undefined;
}) => void;

const stubApi: StubApiFunction = (options: {
  slo?: ServiceLevelObjective | null;
  rulesError?: Error | undefined;
  countError?: Error | undefined;
  ownersError?: Error | undefined;
}): void => {
  getItemMock.mockResolvedValue(
    options.slo === undefined ? buildSlo({}) : options.slo,
  );

  getListMock.mockImplementation((...args: Array<unknown>): unknown => {
    const request: ModelRequest = args[0] as ModelRequest;

    if (request.modelType === ServiceLevelObjectiveBurnRateRule) {
      return options.rulesError
        ? Promise.reject(options.rulesError)
        : Promise.resolve(listResultOf([burnRule]));
    }

    if (options.ownersError) {
      return Promise.reject(options.ownersError);
    }

    if (request.modelType === ServiceLevelObjectiveOwnerUser) {
      return Promise.resolve(listResultOf([ownerUser]));
    }

    return Promise.resolve(listResultOf([ownerTeam]));
  });

  countMock.mockImplementation((...args: Array<unknown>): unknown => {
    if (options.countError) {
      return Promise.reject(options.countError);
    }

    const request: ModelRequest = args[0] as ModelRequest;
    return Promise.resolve(request.query && request.query["isEnabled"] ? 1 : 2);
  });
};

/*
 * The poll's own interval is captured rather than faked: real timers keep
 * Testing Library's waitFor honest, and invoking the callback by hand makes
 * "one tick" exact.
 */
const pollCallbacks: Array<() => void> = [];
const realSetInterval: typeof setInterval = global.setInterval;

let visibilityState: DocumentVisibilityState = "visible";

type RenderDataHookFunction = () => {
  result: { current: UseSloOverviewDataResult };
  unmount: () => void;
};

const renderDataHook: RenderDataHookFunction = (): {
  result: { current: UseSloOverviewDataResult };
  unmount: () => void;
} => {
  return renderHook((): UseSloOverviewDataResult => {
    return useSloOverviewData({ sloId: SLO_ID });
  });
};

type TickFunction = () => void;

const tick: TickFunction = (): void => {
  act(() => {
    for (const callback of pollCallbacks) {
      callback();
    }
  });
};

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
  );
  getItemMock.mockReset();
  getListMock.mockReset();
  countMock.mockReset();
  pollCallbacks.length = 0;
  visibilityState = "visible";

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return visibilityState;
    },
  });

  global.setInterval = ((
    callback: () => void,
    milliseconds?: number,
  ): ReturnType<typeof setInterval> => {
    if (milliseconds === SLO_OVERVIEW_REFRESH_INTERVAL_MS) {
      pollCallbacks.push(callback);
      return 0 as unknown as ReturnType<typeof setInterval>;
    }

    return realSetInterval(callback, milliseconds);
  }) as typeof setInterval;
});

afterEach(() => {
  cleanup();
  global.setInterval = realSetInterval;
});

describe("useSloOverviewData", () => {
  test("loads the SLO row once, with every column the overview reads, plus rules, counts and owners", async () => {
    stubApi({});

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const itemRequest: ModelRequest = getItemMock.mock.calls[0]![0];
    expect(itemRequest.modelType).toBe(ServiceLevelObjective);
    expect(itemRequest.id).toBe(SLO_ID);
    expect(itemRequest.select).toBe(SLO_OVERVIEW_SELECT);

    const rulesRequest: ModelRequest = getListMock.mock.calls
      .map((args: Array<unknown>) => {
        return args[0] as ModelRequest;
      })
      .find((request: ModelRequest) => {
        return request.modelType === ServiceLevelObjectiveBurnRateRule;
      })!;
    expect(rulesRequest.query!["serviceLevelObjectiveId"]).toBe(SLO_ID);

    const countQueries: Array<Record<string, unknown>> =
      countMock.mock.calls.map((args: Array<unknown>) => {
        const request: ModelRequest = args[0] as ModelRequest;
        expect(request.modelType).toBe(ServiceLevelObjectiveMonitorRule);
        return request.query!;
      });
    expect(countQueries).toHaveLength(2);
    expect(
      countQueries.filter((query: Record<string, unknown>) => {
        return query["isEnabled"] === true;
      }),
    ).toHaveLength(1);

    expect(result.current.slo!.sloStatus).toBe(SloStatus.Healthy);
    expect(result.current.burnRateRules).toEqual([burnRule]);
    expect(result.current.burnRateRulesError).toBe("");
    expect(result.current.monitorRuleCount).toBe(2);
    expect(result.current.enabledMonitorRuleCount).toBe(1);
    expect(result.current.refreshCount).toBe(1);
    expect(result.current.error).toBe("");

    await waitFor(() => {
      expect(result.current.isLoadingOwners).toBe(false);
    });
    expect(result.current.owners).toEqual([
      { kind: "user", user: ownerUser.user },
      { kind: "team", team: ownerTeam.team },
    ]);
  });

  test("the select covers what the cards read, and never the deprecated monitorLabels", () => {
    expect(Object.keys(SLO_OVERVIEW_SELECT)).toEqual(
      expect.arrayContaining([
        "description",
        "labels",
        "isEnabled",
        "isArchived",
        "sliType",
        "multiMonitorMode",
        "targetPercentage",
        "windowType",
        "windowDays",
        "timezone",
        "atRiskThresholdPercentage",
        "currentSliPercentage",
        "errorBudgetRemainingPercentage",
        "errorBudgetRemainingSeconds",
        "errorBudgetTotalSeconds",
        "currentBurnRate",
        "sloStatus",
        "lastEvaluatedAt",
        "monitors",
        "downtimeMonitorStatuses",
      ]),
    );
    expect(SLO_OVERVIEW_SELECT).not.toHaveProperty("monitorLabels");
  });

  test("polls once a minute, bumping the refresh count every time", async () => {
    stubApi({});

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.refreshCount).toBe(1);
    });

    expect(pollCallbacks).toHaveLength(1);

    getItemMock.mockResolvedValue(buildSlo({ sloStatus: SloStatus.AtRisk }));
    tick();

    await waitFor(() => {
      expect(result.current.refreshCount).toBe(2);
    });
    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(result.current.slo!.sloStatus).toBe(SloStatus.AtRisk);
    // Owners are not part of the poll.
    expect(
      getListMock.mock.calls.filter((args: Array<unknown>) => {
        return (
          (args[0] as ModelRequest).modelType === ServiceLevelObjectiveOwnerUser
        );
      }),
    ).toHaveLength(1);
  });

  test("a hidden tab skips the poll and catches up when shown again", async () => {
    stubApi({});

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.refreshCount).toBe(1);
    });

    visibilityState = "hidden";
    tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    visibilityState = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(result.current.refreshCount).toBe(2);
    });
  });

  test("a failed background refresh keeps the last numbers and reports itself", async () => {
    stubApi({});

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.refreshCount).toBe(1);
    });

    getItemMock.mockRejectedValue(new Error("Network error."));
    tick();

    await waitFor(() => {
      expect(result.current.refreshError).toBe("Network error.");
    });

    expect(result.current.slo!.sloStatus).toBe(SloStatus.Healthy);
    expect(result.current.error).toBe("");
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.isRefreshing).toBe(false);

    // The next good refresh clears it.
    getItemMock.mockResolvedValue(buildSlo({}));
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.refreshError).toBe("");
    });
  });

  test("a failed first load is an error, with nothing to show", async () => {
    stubApi({});
    getItemMock.mockRejectedValue(new Error("Forbidden."));

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    expect(result.current.error).toBe("Forbidden.");
    expect(result.current.slo).toBeNull();
    expect(result.current.refreshError).toBe("");
  });

  test("a deleted SLO says so", async () => {
    stubApi({ slo: null });

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.error).toBe(
        "This SLO could not be found. It may have been deleted.",
      );
    });
  });

  test("a rules failure blanks only the rules; a count failure is unknown, never zero", async () => {
    stubApi({
      rulesError: new Error("Rules are unavailable."),
      countError: new Error("Counts are unavailable."),
    });

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    expect(result.current.slo).not.toBeNull();
    expect(result.current.error).toBe("");
    expect(result.current.burnRateRules).toEqual([]);
    expect(result.current.burnRateRulesError).toBe("Rules are unavailable.");
    expect(result.current.monitorRuleCount).toBeNull();
    expect(result.current.enabledMonitorRuleCount).toBeNull();
  });

  test("an owners failure leaves owners unknown rather than empty", async () => {
    stubApi({ ownersError: new Error("Owners are unavailable.") });

    const { result } = renderDataHook();

    await waitFor(() => {
      expect(result.current.isLoadingOwners).toBe(false);
    });

    expect(result.current.owners).toBeUndefined();
  });

  test("a slow response that lands after a newer refresh is ignored", async () => {
    stubApi({});

    let resolveFirst: (slo: ServiceLevelObjective) => void = () => {};

    getItemMock.mockReturnValueOnce(
      new Promise<ServiceLevelObjective>(
        (resolve: (slo: ServiceLevelObjective) => void) => {
          resolveFirst = resolve;
        },
      ),
    );
    getItemMock.mockResolvedValueOnce(
      buildSlo({ sloStatus: SloStatus.BudgetExhausted }),
    );

    const { result } = renderDataHook();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.slo?.sloStatus).toBe(SloStatus.BudgetExhausted);
    });

    await act(async () => {
      resolveFirst(buildSlo({ sloStatus: SloStatus.Healthy }));
    });

    expect(result.current.slo!.sloStatus).toBe(SloStatus.BudgetExhausted);
  });

  test("unmounting stops the poll's listeners", async () => {
    stubApi({});

    const { result, unmount } = renderDataHook();

    await waitFor(() => {
      expect(result.current.hasLoaded).toBe(true);
    });

    unmount();

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("getSloNoticeFingerprint", () => {
  const monitor: Monitor = new Monitor();
  monitor._id = "5f8b7c1e2d3a4b5c6d7e1001";

  const base: string = getSloNoticeFingerprint(buildSlo({}));

  test("ignores the numbers that change on every evaluation", () => {
    expect(
      getSloNoticeFingerprint(
        buildSlo({
          currentSliPercentage: 98,
          errorBudgetRemainingPercentage: 12,
          currentBurnRate: 9,
          lastEvaluatedAt: new Date("2026-09-15T12:03:00.000Z"),
        }),
      ),
    ).toBe(base);
  });

  test.each([
    ["the status", { sloStatus: SloStatus.Misconfigured }],
    ["enabled", { isEnabled: false }],
    ["archived", { isArchived: true }],
    ["the target", { targetPercentage: 100 }],
    ["the first evaluation", { lastEvaluatedAt: undefined }],
    ["the monitor count", { monitors: [monitor] }],
    ["the window type", { windowType: SloWindowType.CalendarMonth }],
    ["the window filling", { errorBudgetTotalSeconds: 600 }],
  ])("changes with %s", (_label: string, overrides: SloOverrides) => {
    expect(getSloNoticeFingerprint(buildSlo(overrides))).not.toBe(base);
  });
});
