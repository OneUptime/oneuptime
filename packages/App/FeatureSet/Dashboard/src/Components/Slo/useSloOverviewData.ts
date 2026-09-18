import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { isRollingWindowNotYetFull } from "Common/Utils/Slo/SloHealth";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The worker evaluates every five minutes and this page is what someone
 * keeps open during an incident; a minute keeps the numbers honest without
 * hammering the API.
 */
export const SLO_OVERVIEW_REFRESH_INTERVAL_MS: number = 60 * 1000;

/*
 * Every column the overview and its cards read from the SLO row, in ONE
 * request. The old page fetched this row three times a minute — the hero,
 * the notice banner and the details card each on their own.
 */
export const SLO_OVERVIEW_SELECT: Select<ServiceLevelObjective> = {
  _id: true,
  name: true,
  description: true,
  labels: {
    name: true,
    color: true,
  },
  isEnabled: true,
  isArchived: true,
  sliType: true,
  multiMonitorMode: true,
  targetPercentage: true,
  windowType: true,
  windowDays: true,
  timezone: true,
  atRiskThresholdPercentage: true,
  currentSliPercentage: true,
  errorBudgetRemainingPercentage: true,
  errorBudgetRemainingSeconds: true,
  errorBudgetTotalSeconds: true,
  currentBurnRate: true,
  sloStatus: true,
  lastEvaluatedAt: true,
  monitors: {
    _id: true,
  },
  downtimeMonitorStatuses: {
    _id: true,
    name: true,
    color: true,
  },
};

/*
 * The fields any SLO notice is derived from. The banner fetches its own row
 * (its props are shared by every SLO sub-page), so the overview bumps the
 * banner's refresh token only when one of these changes — not on every poll,
 * which re-fetched the banner once a minute for nothing.
 */
export type GetSloNoticeFingerprintFunction = (
  slo: ServiceLevelObjective,
) => string;

export const getSloNoticeFingerprint: GetSloNoticeFingerprintFunction = (
  slo: ServiceLevelObjective,
): string => {
  const monitors: Array<Monitor> =
    (slo.monitors as Array<Monitor> | undefined) || [];

  return JSON.stringify([
    slo.isEnabled ?? null,
    slo.isArchived ?? null,
    slo.sloStatus ?? null,
    slo.sliType ?? null,
    slo.targetPercentage ?? null,
    slo.windowType ?? null,
    slo.windowDays ?? null,
    slo.multiMonitorMode ?? null,
    Boolean(slo.lastEvaluatedAt),
    monitors.length,
    isRollingWindowNotYetFull({
      windowType: slo.windowType,
      windowDays: slo.windowDays,
      targetPercentage: slo.targetPercentage,
      errorBudgetTotalSeconds: slo.errorBudgetTotalSeconds,
      multiMonitorMode: slo.multiMonitorMode,
    }),
  ]);
};

export interface UseSloOverviewDataResult {
  slo: ServiceLevelObjective | null;
  // Every burn rate rule of the SLO, enabled or not.
  burnRateRules: Array<ServiceLevelObjectiveBurnRateRule>;
  burnRateRulesError: string;
  // Null when the count could not be loaded — never guessed as zero.
  monitorRuleCount: number | null;
  enabledMonitorRuleCount: number | null;
  // Undefined while loading or when the lookup failed.
  owners: Array<ResourceOwnerEntry> | undefined;
  isLoadingOwners: boolean;
  // True once the first load for this SLO has finished, successfully or not.
  hasLoaded: boolean;
  // A first-load failure: there is nothing to show.
  error: string;
  // A background-refresh failure: the last good numbers stay on screen.
  refreshError: string;
  isRefreshing: boolean;
  // Bumped after every successful load, so cards can re-read what changes between polls.
  refreshCount: number;
  refresh: () => void;
}

interface BurnRateRulesResult {
  rules: Array<ServiceLevelObjectiveBurnRateRule>;
  error: string;
}

/*
 * The SLO overview's one poll.
 *
 * Loads the SLO row, its burn rate rules and its monitor rule counts
 * together, once a minute, and hands them to every card — the KPI strip,
 * the rules card and the getting-started check all read the same response.
 * The SLO row failing fails the load; a rules or count failure only blanks
 * the part of the page that needs it.
 *
 * A background refresh never replaces the page with a loader or an error: a
 * failure keeps the last good numbers and reports itself in the hero. The
 * poll skips hidden tabs and catches up when the tab is shown again.
 */
const useSloOverviewData: (options: {
  sloId: ObjectID;
}) => UseSloOverviewDataResult = (options: {
  sloId: ObjectID;
}): UseSloOverviewDataResult => {
  const sloIdString: string = options.sloId.toString();

  const [slo, setSlo] = useState<ServiceLevelObjective | null>(null);
  const [burnRateRules, setBurnRateRules] = useState<
    Array<ServiceLevelObjectiveBurnRateRule>
  >([]);
  const [burnRateRulesError, setBurnRateRulesError] = useState<string>("");
  const [monitorRuleCount, setMonitorRuleCount] = useState<number | null>(null);
  const [enabledMonitorRuleCount, setEnabledMonitorRuleCount] = useState<
    number | null
  >(null);
  const [loadedSloId, setLoadedSloId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [owners, setOwners] = useState<Array<ResourceOwnerEntry> | undefined>(
    undefined,
  );
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(true);

  /*
   * Every load takes a generation number, and only the newest may write
   * state: a slow poll that lands after a manual refresh (or after moving to
   * another SLO) must not overwrite newer numbers with older ones.
   */
  const generationRef: MutableRefObject<number> = useRef<number>(0);
  // Which SLO the numbers on screen belong to, readable inside async code.
  const shownSloIdRef: MutableRefObject<string> = useRef<string>("");

  const fetchData: (isBackgroundRefresh: boolean) => Promise<void> =
    useCallback(
      async (isBackgroundRefresh: boolean): Promise<void> => {
        generationRef.current += 1;
        const generation: number = generationRef.current;
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (isBackgroundRefresh) {
          setIsRefreshing(true);
        }

        const rulesPromise: Promise<BurnRateRulesResult> =
          ModelAPI.getList<ServiceLevelObjectiveBurnRateRule>({
            modelType: ServiceLevelObjectiveBurnRateRule,
            query: {
              serviceLevelObjectiveId: options.sloId,
              projectId: projectId!,
            },
            select: {
              _id: true,
              name: true,
              isEnabled: true,
              burnRateThreshold: true,
              longWindowInMinutes: true,
              shortWindowInMinutes: true,
              shouldCreateAlert: true,
              shouldCreateIncident: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              burnRateThreshold: SortOrder.Descending,
            },
          }).then(
            (
              result: ListResult<ServiceLevelObjectiveBurnRateRule>,
            ): BurnRateRulesResult => {
              return { rules: result.data, error: "" };
            },
            (err: unknown): BurnRateRulesResult => {
              return { rules: [], error: API.getFriendlyMessage(err) };
            },
          );

        type CountOrNullPromise = Promise<number | null>;

        const countMonitorRules: (
          onlyEnabled: boolean,
        ) => CountOrNullPromise = (
          onlyEnabled: boolean,
        ): CountOrNullPromise => {
          return ModelAPI.count<ServiceLevelObjectiveMonitorRule>({
            modelType: ServiceLevelObjectiveMonitorRule,
            query: onlyEnabled
              ? {
                  serviceLevelObjectiveId: options.sloId,
                  projectId: projectId!,
                  isEnabled: true,
                }
              : {
                  serviceLevelObjectiveId: options.sloId,
                  projectId: projectId!,
                },
          }).catch((): null => {
            return null;
          });
        };

        try {
          const [item, rulesResult, ruleCount, enabledRuleCount]: [
            ServiceLevelObjective | null,
            BurnRateRulesResult,
            number | null,
            number | null,
          ] = await Promise.all([
            ModelAPI.getItem<ServiceLevelObjective>({
              modelType: ServiceLevelObjective,
              id: options.sloId,
              select: SLO_OVERVIEW_SELECT,
            }),
            rulesPromise,
            countMonitorRules(false),
            countMonitorRules(true),
          ]);

          if (generation !== generationRef.current) {
            return;
          }

          if (!item) {
            throw new Error(
              "This SLO could not be found. It may have been deleted.",
            );
          }

          shownSloIdRef.current = sloIdString;
          setSlo(item);
          setBurnRateRules(rulesResult.rules);
          setBurnRateRulesError(rulesResult.error);
          setMonitorRuleCount(ruleCount);
          setEnabledMonitorRuleCount(enabledRuleCount);
          setError("");
          setRefreshError("");
          setLoadedSloId(sloIdString);
          setRefreshCount((count: number) => {
            return count + 1;
          });
        } catch (err) {
          if (generation !== generationRef.current) {
            return;
          }

          const message: string = API.getFriendlyMessage(err);

          if (shownSloIdRef.current === sloIdString) {
            setRefreshError(message);
          } else {
            setError(message);
            setLoadedSloId(sloIdString);
          }
        }

        if (generation === generationRef.current) {
          setIsRefreshing(false);
        }
      },
      [sloIdString],
    );

  useEffect(() => {
    setError("");
    setRefreshError("");

    fetchData(false).catch(() => {
      // fetchData records its own errors.
    });

    const isTabHidden: () => boolean = (): boolean => {
      return (
        typeof document !== "undefined" && document.visibilityState === "hidden"
      );
    };

    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
      if (isTabHidden()) {
        return;
      }

      fetchData(true).catch(() => {
        // fetchData records its own errors.
      });
    }, SLO_OVERVIEW_REFRESH_INTERVAL_MS);

    const onVisibilityChange: () => void = (): void => {
      if (!isTabHidden()) {
        fetchData(true).catch(() => {
          // fetchData records its own errors.
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Orphan any load still in flight for this SLO.
      generationRef.current += 1;
    };
  }, [sloIdString]);

  /*
   * Owners change rarely and are not part of the budget story, so they load
   * once per SLO rather than on every poll.
   */
  useEffect(() => {
    let cancelled: boolean = false;
    setIsLoadingOwners(true);
    setOwners(undefined);

    const loadOwners: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      try {
        const [ownerUsers, ownerTeams]: [
          ListResult<ServiceLevelObjectiveOwnerUser>,
          ListResult<ServiceLevelObjectiveOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<ServiceLevelObjectiveOwnerUser>({
            modelType: ServiceLevelObjectiveOwnerUser,
            query: {
              serviceLevelObjectiveId: options.sloId,
              projectId: projectId!,
            },
            select: {
              _id: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              createdAt: SortOrder.Ascending,
            },
          }),
          ModelAPI.getList<ServiceLevelObjectiveOwnerTeam>({
            modelType: ServiceLevelObjectiveOwnerTeam,
            query: {
              serviceLevelObjectiveId: options.sloId,
              projectId: projectId!,
            },
            select: {
              _id: true,
              team: {
                _id: true,
                name: true,
              },
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              createdAt: SortOrder.Ascending,
            },
          }),
        ]);

        if (cancelled) {
          return;
        }

        const entries: Array<ResourceOwnerEntry> = [];

        for (const ownerUser of ownerUsers.data) {
          if (ownerUser.user) {
            entries.push({ kind: "user", user: ownerUser.user });
          }
        }

        for (const ownerTeam of ownerTeams.data) {
          if (ownerTeam.team) {
            entries.push({ kind: "team", team: ownerTeam.team });
          }
        }

        setOwners(entries);
      } catch {
        // Supplementary: the hero shows the owners as unavailable.
        if (!cancelled) {
          setOwners(undefined);
        }
      }

      if (!cancelled) {
        setIsLoadingOwners(false);
      }
    };

    loadOwners().catch(() => {
      // loadOwners records its own state.
    });

    return () => {
      cancelled = true;
    };
  }, [sloIdString]);

  return {
    slo: loadedSloId === sloIdString ? slo : null,
    burnRateRules: burnRateRules,
    burnRateRulesError: burnRateRulesError,
    monitorRuleCount: monitorRuleCount,
    enabledMonitorRuleCount: enabledMonitorRuleCount,
    owners: owners,
    isLoadingOwners: isLoadingOwners,
    hasLoaded: loadedSloId === sloIdString,
    error: error,
    refreshError: refreshError,
    isRefreshing: isRefreshing,
    refreshCount: refreshCount,
    refresh: (): void => {
      fetchData(true).catch(() => {
        // fetchData records its own errors.
      });
    },
  };
};

export default useSloOverviewData;
