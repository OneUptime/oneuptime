import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import URL from "Common/Types/API/URL";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
  MonitorOverviewLayout,
} from "Common/Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewProbeUtil, {
  MonitorEvaluationByProbe,
} from "Common/Utils/Monitor/MonitorOverviewProbeUtil";
import MonitorStatusHistoryUtil from "Common/Utils/Monitor/MonitorStatusHistoryUtil";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getReadableMonitorSecretKeySelect } from "../../../Utils/MonitorSecretKeySelect";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  getSectionForSubject,
  resolveSection,
  shouldAttemptRead,
} from "../../../Utils/OverviewSection";
import {
  getCurrentStatusId,
  getProbeLastResultAt,
} from "./MonitorOverviewInput";
import {
  MONITOR_OVERVIEW_BASE_SELECT,
  MONITOR_OVERVIEW_PROBE_FULL_SELECT,
  MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
  MONITOR_OVERVIEW_STATUS_ROW_LIMIT,
  MONITOR_OVERVIEW_STATUS_ROW_SELECT,
} from "./MonitorOverviewSelect";
import { MonitorOverviewProbeData } from "./MonitorOverviewTypes";

/*
 * The shortest monitoring interval is one minute, so a one-minute poll keeps
 * the page at most one check behind without hammering the API.
 */
export const MONITOR_OVERVIEW_REFRESH_INTERVAL_MS: number = 60 * 1000;

/*
 * The uptime aggregate changes slowly, so it reloads every fifth poll (and
 * at once on a status change or a manual refresh). Index derives the uptime
 * hook's refreshKey from this.
 */
export const MONITOR_OVERVIEW_UPTIME_POLLS_PER_RELOAD: number = 5;

/*
 * SyntheticMonitor results carry base64 screenshots, so its full probe rows
 * are re-downloaded at most this often, however many results come in.
 */
export const MONITOR_OVERVIEW_HEAVY_PROBE_RELOAD_MS: number = 5 * 60 * 1000;

/*
 * A network device monitor is evaluated on every device poll and trap, and
 * none of the Monitor row's timestamps move when that happens, so its
 * evaluation log is re-read on a fixed beat instead of on a signal.
 */
export const MONITOR_OVERVIEW_NETWORK_DEVICE_EVALUATION_POLLS: number = 5;

export const MONITOR_OVERVIEW_NOT_FOUND_MESSAGE: string =
  "This monitor could not be found. It may have been deleted, or you may not have permission to view it.";

// Why a supplementary read was not sent. The cards word their own copy.
export const MONITOR_OVERVIEW_ACCESS_REASONS: {
  probes: string;
  statusRows: string;
  evaluation: string;
} = {
  probes: "You need permission to read this monitor's probes.",
  statusRows: "You need permission to read this monitor's status timeline.",
  evaluation: "You need permission to read this monitor's logs.",
};

export type MonitorOverviewRefreshReason =
  | "first-load"
  | "poll"
  | "manual"
  | "details-saved"
  | "drift-heal";

export interface MonitorOverviewRefreshOptions {
  reason?: "manual" | "details-saved" | undefined;
}

export interface UseMonitorOverviewDataResult {
  // Null until the first load for THIS monitor id succeeds.
  monitor: Monitor | null;
  // True once the first load for this id has finished, successfully or not.
  hasLoaded: boolean;
  // A first-load failure: there is nothing to show.
  error: string;
  // A background-refresh failure: the last good data stays on screen.
  refreshError: string;
  isRefreshing: boolean;
  lastLoadedAt: Date | null;
  // Bumped after every successful load of the Monitor row.
  refreshCount: number;
  // Bumped by every poll tick that runs (hidden tabs do not count).
  pollCount: number;
  // Bumped by the Refresh button only.
  manualRefreshCount: number;
  // Bumped when the status fingerprint changes for the same monitor.
  statusChangeCount: number;
  statusFingerprint: string;
  resultFingerprint: string;
  probes: OverviewSection<MonitorOverviewProbeData>;
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>;
  evaluation: OverviewSection<MonitorEvaluationByProbe>;
  refresh: (options?: MonitorOverviewRefreshOptions) => void;
  retryFirstLoad: () => void;
}

// What one supplementary read came back with.
type ReadOutcome<T> =
  | { kind: "loaded"; value: T }
  | { kind: "failed"; message: string }
  | { kind: "forbidden"; reason: string }
  // Not attempted this round; the section keeps what it has.
  | { kind: "skipped" };

interface FullProbeRows {
  monitorId: string;
  rows: Array<MonitorProbe>;
  loadedAt: Date | null;
}

interface SubjectValue {
  monitorId: string;
  value: string;
}

type ProbeWeight = "none" | "light" | "full";

/*
 * A read that is sent unless the permission snapshot definitely refuses it.
 * It never rejects: a failure becomes an outcome, so only the Monitor read
 * can fail a load.
 */
function readIfPermitted<T>(data: {
  model: PermissionCheckableModel;
  forbiddenReason: string;
  read: () => Promise<T>;
}): Promise<ReadOutcome<T>> {
  if (!shouldAttemptRead(PermissionGate.check(data.model, ModelAction.Read))) {
    return Promise.resolve({ kind: "forbidden", reason: data.forbiddenReason });
  }

  let request: Promise<T>;

  try {
    request = data.read();
  } catch (err) {
    request = Promise.reject(err);
  }

  return request.then(
    (value: T): ReadOutcome<T> => {
      return { kind: "loaded", value: value };
    },
    (err: unknown): ReadOutcome<T> => {
      return { kind: "failed", message: API.getFriendlyMessage(err) };
    },
  );
}

function toSection<TValue, TRead>(data: {
  previous: OverviewSection<TValue>;
  outcome: ReadOutcome<TRead>;
  subjectId: string;
  toValue: (value: TRead) => TValue;
}): OverviewSection<TValue> {
  const outcome: ReadOutcome<TRead> = data.outcome;

  if (outcome.kind === "loaded") {
    return resolveSection({
      value: data.toValue(outcome.value),
      subjectId: data.subjectId,
    });
  }

  if (outcome.kind === "forbidden") {
    return forbidSection<TValue>({
      reason: outcome.reason,
      subjectId: data.subjectId,
    });
  }

  if (outcome.kind === "failed") {
    return failSection({
      previous: data.previous,
      message: outcome.message,
      subjectId: data.subjectId,
    });
  }

  return data.previous;
}

function getLayoutOrNull(
  monitorType: MonitorType | undefined,
): MonitorOverviewLayout | null {
  if (!monitorType) {
    return null;
  }

  try {
    return MonitorOverviewFamilyUtil.getLayout(monitorType);
  } catch {
    // A type this build does not know: show the row, skip the extras.
    return null;
  }
}

function countEnabledProbes(
  section: OverviewSection<MonitorOverviewProbeData>,
): number {
  return (section.value?.rows || []).filter((row: MonitorProbe) => {
    return Boolean(row?.probeId) && row.isEnabled !== false;
  }).length;
}

/*
 * The monitor overview's data, and its one poll.
 *
 * The Monitor row is the only required read. Probes, the newest status
 * rows and the evaluation log are sections: each can fail or be forbidden
 * on its own and keeps its last good value when a refresh fails, so a
 * Viewer, a MonitorViewer and a ReadProjectMonitor holder can all open the
 * page. A read is skipped only on a definite permission denial.
 *
 * - First load: refresh-status is fired and NOT awaited, then the Monitor
 *   row, the full probe rows and the status rows are read in parallel and
 *   committed together. The evaluation log follows without the skeleton.
 *   If the newest status row disagrees with the row's current status, the
 *   hook waits for refresh-status and reloads once.
 * - Poll (every minute, skipped while the tab is hidden, caught up when it
 *   is shown): the row, the LIGHT probe rows and the status rows; the full
 *   probe rows only when a probe has claimed a check newer than the newest
 *   result held; the evaluation log only when the newest signal moved.
 * - Manual refresh: everything in full, never refresh-status again.
 *
 * Every load takes a generation number and only the newest may write, so a
 * slow poll that lands after a manual refresh, or after moving to another
 * monitor, cannot overwrite newer data. What is returned is gated on the
 * monitor id, so monitor A's data is never shown on monitor B.
 */
export const useMonitorOverviewData: (options: {
  monitorId: ObjectID;
}) => UseMonitorOverviewDataResult = (options: {
  monitorId: ObjectID;
}): UseMonitorOverviewDataResult => {
  const monitorIdString: string = options.monitorId.toString();

  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [loadedMonitorId, setLoadedMonitorId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [pollCount, setPollCount] = useState<number>(0);
  const [manualRefreshCount, setManualRefreshCount] = useState<number>(0);
  const [statusChangeCount, setStatusChangeCount] = useState<number>(0);
  const [statusFingerprint, setStatusFingerprint] = useState<string>("");
  const [resultFingerprint, setResultFingerprint] = useState<string>("");
  const [probes, setProbes] =
    useState<OverviewSection<MonitorOverviewProbeData>>(
      getLoadingSection<MonitorOverviewProbeData>(),
    );
  const [statusRows, setStatusRows] =
    useState<OverviewSection<Array<MonitorStatusTimeline>>>(
      getLoadingSection<Array<MonitorStatusTimeline>>(),
    );
  const [evaluation, setEvaluation] =
    useState<OverviewSection<MonitorEvaluationByProbe>>(
      getLoadingSection<MonitorEvaluationByProbe>(),
    );

  const generationRef: MutableRefObject<number> = useRef<number>(0);
  // The evaluation log loads after the core commit, on its own generation.
  const evaluationGenerationRef: MutableRefObject<number> = useRef<number>(0);
  // The id the hook is currently for, readable inside async code.
  const activeMonitorIdRef: MutableRefObject<string> = useRef<string>("");
  // The id whose data is on screen; separates a first load from a refresh.
  const shownMonitorIdRef: MutableRefObject<string> = useRef<string>("");
  const monitorRef: MutableRefObject<Monitor | null> = useRef<Monitor | null>(
    null,
  );
  const probesRef: MutableRefObject<OverviewSection<MonitorOverviewProbeData>> =
    useRef<OverviewSection<MonitorOverviewProbeData>>(probes);
  const statusRowsRef: MutableRefObject<
    OverviewSection<Array<MonitorStatusTimeline>>
  > = useRef<OverviewSection<Array<MonitorStatusTimeline>>>(statusRows);
  const evaluationRef: MutableRefObject<
    OverviewSection<MonitorEvaluationByProbe>
  > = useRef<OverviewSection<MonitorEvaluationByProbe>>(evaluation);
  // The last FULL probe read: polls lay their light rows over it.
  const fullProbeRowsRef: MutableRefObject<FullProbeRows> =
    useRef<FullProbeRows>({ monitorId: "", rows: [], loadedAt: null });
  const lastStatusFingerprintRef: MutableRefObject<SubjectValue> =
    useRef<SubjectValue>({ monitorId: "", value: "" });
  const lastResultFingerprintRef: MutableRefObject<SubjectValue> =
    useRef<SubjectValue>({ monitorId: "", value: "" });
  const pollCountRef: MutableRefObject<number> = useRef<number>(0);
  const refreshStatusFiredForRef: MutableRefObject<string> = useRef<string>("");
  const refreshStatusPromiseRef: MutableRefObject<Promise<void> | null> =
    useRef<Promise<void> | null>(null);
  const driftHealedForRef: MutableRefObject<string> = useRef<string>("");

  const commitProbes: (
    section: OverviewSection<MonitorOverviewProbeData>,
  ) => void = (section: OverviewSection<MonitorOverviewProbeData>): void => {
    probesRef.current = section;
    setProbes(section);
  };

  const commitStatusRows: (
    section: OverviewSection<Array<MonitorStatusTimeline>>,
  ) => void = (
    section: OverviewSection<Array<MonitorStatusTimeline>>,
  ): void => {
    statusRowsRef.current = section;
    setStatusRows(section);
  };

  const commitEvaluation: (
    section: OverviewSection<MonitorEvaluationByProbe>,
  ) => void = (section: OverviewSection<MonitorEvaluationByProbe>): void => {
    evaluationRef.current = section;
    setEvaluation(section);
  };

  // R2: the monitor's own MonitorProbe rows, light or with their results.
  const readProbes: (
    isFull: boolean,
  ) => Promise<ReadOutcome<Array<MonitorProbe>>> = (
    isFull: boolean,
  ): Promise<ReadOutcome<Array<MonitorProbe>>> => {
    return readIfPermitted<Array<MonitorProbe>>({
      model: new MonitorProbe(),
      forbiddenReason: MONITOR_OVERVIEW_ACCESS_REASONS.probes,
      read: async (): Promise<Array<MonitorProbe>> => {
        const result: ListResult<MonitorProbe> =
          await ModelAPI.getList<MonitorProbe>({
            modelType: MonitorProbe,
            query: {
              monitorId: options.monitorId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              createdAt: SortOrder.Descending,
            },
            select: isFull
              ? MONITOR_OVERVIEW_PROBE_FULL_SELECT
              : MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
          });

        return result.data;
      },
    });
  };

  // R3: the newest few timeline rows, newest first.
  const readStatusRows: (
    projectId: ObjectID | null,
  ) => Promise<ReadOutcome<Array<MonitorStatusTimeline>>> = (
    projectId: ObjectID | null,
  ): Promise<ReadOutcome<Array<MonitorStatusTimeline>>> => {
    return readIfPermitted<Array<MonitorStatusTimeline>>({
      model: new MonitorStatusTimeline(),
      forbiddenReason: MONITOR_OVERVIEW_ACCESS_REASONS.statusRows,
      read: async (): Promise<Array<MonitorStatusTimeline>> => {
        const result: ListResult<MonitorStatusTimeline> =
          await ModelAPI.getList<MonitorStatusTimeline>({
            modelType: MonitorStatusTimeline,
            query: {
              monitorId: options.monitorId,
              projectId: projectId!,
            },
            limit: MONITOR_OVERVIEW_STATUS_ROW_LIMIT,
            skip: 0,
            sort: {
              startsAt: SortOrder.Descending,
            },
            select: MONITOR_OVERVIEW_STATUS_ROW_SELECT,
          });

        return result.data;
      },
    });
  };

  /*
   * R4: the criteria verdicts behind the latest results. They live only in
   * MonitorLog.logBody (a probe's lastMonitoringLog carries an empty
   * summary), so this is the only place the Summary card can get them.
   */
  const loadEvaluation: (data: {
    monitorType: MonitorType;
    subjectId: string;
  }) => void = (data: {
    monitorType: MonitorType;
    subjectId: string;
  }): void => {
    evaluationGenerationRef.current += 1;
    const evaluationGeneration: number = evaluationGenerationRef.current;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const enabledProbeCount: number =
      probesRef.current.loadedFor === data.subjectId
        ? countEnabledProbes(probesRef.current)
        : 0;

    readIfPermitted<ListResult<MonitorLog>>({
      model: new MonitorLog(),
      forbiddenReason: MONITOR_OVERVIEW_ACCESS_REASONS.evaluation,
      read: (): Promise<ListResult<MonitorLog>> => {
        return AnalyticsModelAPI.getList<MonitorLog>({
          modelType: MonitorLog,
          query: {
            projectId: projectId!.toString(),
            monitorId: options.monitorId.toString(),
          },
          limit: MonitorOverviewProbeUtil.getEvaluationLogLimit({
            monitorType: data.monitorType,
            enabledProbeCount: enabledProbeCount,
          }),
          skip: 0,
          select: {
            time: true,
            logBody: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
        });
      },
    })
      .then((outcome: ReadOutcome<ListResult<MonitorLog>>): void => {
        if (
          evaluationGeneration !== evaluationGenerationRef.current ||
          activeMonitorIdRef.current !== data.subjectId
        ) {
          return;
        }

        commitEvaluation(
          toSection<MonitorEvaluationByProbe, ListResult<MonitorLog>>({
            previous: evaluationRef.current,
            outcome: outcome,
            subjectId: data.subjectId,
            toValue: (
              result: ListResult<MonitorLog>,
            ): MonitorEvaluationByProbe => {
              return MonitorOverviewProbeUtil.getEvaluationByProbe(result.data);
            },
          }),
        );
      })
      .catch(() => {
        // readIfPermitted never rejects; nothing else here can throw.
      });
  };

  const fetchData: (reason: MonitorOverviewRefreshReason) => Promise<void> =
    useCallback(
      async (reason: MonitorOverviewRefreshReason): Promise<void> => {
        generationRef.current += 1;
        const generation: number = generationRef.current;
        const subjectId: string = monitorIdString;
        const isStillCurrent: () => boolean = (): boolean => {
          return (
            generation === generationRef.current &&
            activeMonitorIdRef.current === subjectId
          );
        };

        // No row on screen yet for this id, so nothing to keep on a failure.
        const isFirstLoad: boolean = shownMonitorIdRef.current !== subjectId;
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        /*
         * The type is unknown until the row arrives, so a first load reads
         * the probes for every type, in parallel with the row. After that,
         * only probe checks read them.
         */
        const knownLayout: MonitorOverviewLayout | null = isFirstLoad
          ? null
          : getLayoutOrNull(monitorRef.current?.monitorType);
        const isKnownProbeCheck: boolean =
          knownLayout?.family === MonitorOverviewFamily.ProbeCheck;
        const isFullRefresh: boolean =
          isFirstLoad || reason === "manual" || reason === "details-saved";

        let probeWeight: ProbeWeight = "none";

        if (isFirstLoad) {
          probeWeight = "full";
        } else if (isKnownProbeCheck) {
          probeWeight = isFullRefresh ? "full" : "light";
        }

        if (!isFirstLoad) {
          setIsRefreshing(true);
        }

        try {
          const [item, probeOutcome, statusRowsOutcome]: [
            Monitor | null,
            ReadOutcome<Array<MonitorProbe>>,
            ReadOutcome<Array<MonitorStatusTimeline>>,
          ] = await Promise.all([
            ModelAPI.getItem<Monitor>({
              modelType: Monitor,
              id: options.monitorId,
              select: {
                ...MONITOR_OVERVIEW_BASE_SELECT,
                ...getReadableMonitorSecretKeySelect(),
              },
            }),
            probeWeight === "none"
              ? Promise.resolve<ReadOutcome<Array<MonitorProbe>>>({
                  kind: "skipped",
                })
              : readProbes(probeWeight === "full"),
            readStatusRows(projectId),
          ]);

          if (!isStillCurrent()) {
            return;
          }

          if (!item) {
            throw new Error(MONITOR_OVERVIEW_NOT_FOUND_MESSAGE);
          }

          const layout: MonitorOverviewLayout | null = getLayoutOrNull(
            item.monitorType,
          );
          const isProbeCheck: boolean =
            layout?.family === MonitorOverviewFamily.ProbeCheck;
          const previousFull: FullProbeRows =
            fullProbeRowsRef.current.monitorId === subjectId
              ? fullProbeRowsRef.current
              : { monitorId: subjectId, rows: [], loadedAt: null };

          let nextFull: FullProbeRows = previousFull;
          let probeRefreshError: string = "";

          if (probeOutcome.kind === "loaded" && probeWeight === "full") {
            nextFull = {
              monitorId: subjectId,
              rows: probeOutcome.value,
              loadedAt: OneUptimeDate.getCurrentDate(),
            };
          }

          /*
           * Phase two of a poll: the light rows say a probe has claimed a
           * check newer than the newest result held (or the probe set
           * changed), so read the results. Synthetic results carry
           * screenshots and are re-read at most every five minutes.
           */
          if (
            probeOutcome.kind === "loaded" &&
            probeWeight === "light" &&
            isProbeCheck &&
            MonitorOverviewProbeUtil.hasPendingProbeResults({
              lightRows: probeOutcome.value,
              fullRows: previousFull.rows,
            })
          ) {
            const isHeavyReloadDue: boolean =
              item.monitorType !== MonitorType.SyntheticMonitor ||
              !previousFull.loadedAt ||
              OneUptimeDate.getCurrentDate().getTime() -
                previousFull.loadedAt.getTime() >=
                MONITOR_OVERVIEW_HEAVY_PROBE_RELOAD_MS;

            if (isHeavyReloadDue) {
              const fullOutcome: ReadOutcome<Array<MonitorProbe>> =
                await readProbes(true);

              if (!isStillCurrent()) {
                return;
              }

              if (fullOutcome.kind === "loaded") {
                nextFull = {
                  monitorId: subjectId,
                  rows: fullOutcome.value,
                  loadedAt: OneUptimeDate.getCurrentDate(),
                };
              } else if (fullOutcome.kind === "failed") {
                probeRefreshError = fullOutcome.message;
              }
            }
          }

          let probesSection: OverviewSection<MonitorOverviewProbeData> =
            toSection<MonitorOverviewProbeData, Array<MonitorProbe>>({
              previous: probesRef.current,
              outcome: probeOutcome,
              subjectId: subjectId,
              toValue: (
                rows: Array<MonitorProbe>,
              ): MonitorOverviewProbeData => {
                /*
                 * A full read is the rows as they are. Light rows take the
                 * results from the last full read of the same probe.
                 */
                const mergedRows: Array<MonitorProbe> =
                  probeWeight === "full"
                    ? rows
                    : MonitorOverviewProbeUtil.mergeProbeRows({
                        lightRows: rows,
                        fullRows: nextFull.rows,
                      });

                return {
                  rows: mergedRows,
                  attached:
                    MonitorOverviewProbeUtil.toAttachedProbes(mergedRows),
                  fullLoadedAt: nextFull.loadedAt,
                };
              },
            });

          if (probeRefreshError && probesSection.status === "loaded") {
            probesSection = {
              ...probesSection,
              refreshError: probeRefreshError,
            };
          }

          const statusRowsSection: OverviewSection<
            Array<MonitorStatusTimeline>
          > = toSection<
            Array<MonitorStatusTimeline>,
            Array<MonitorStatusTimeline>
          >({
            previous: statusRowsRef.current,
            outcome: statusRowsOutcome,
            subjectId: subjectId,
            toValue: (
              rows: Array<MonitorStatusTimeline>,
            ): Array<MonitorStatusTimeline> => {
              return rows;
            },
          });

          const currentStatusId: string | undefined = getCurrentStatusId(item);
          const latestRow: MonitorStatusTimeline | undefined =
            statusRowsSection.value?.[0];
          const nextStatusFingerprint: string =
            MonitorStatusHistoryUtil.getStatusFingerprint({
              currentStatusId: currentStatusId,
              latestRow: latestRow,
            });
          const nextResultFingerprint: string =
            MonitorCheckScheduleUtil.getLatestSignalAt({
              monitor: item,
              probeLastResultAt: isProbeCheck
                ? getProbeLastResultAt({
                    monitorSteps: item.monitorSteps,
                    rows: probesSection.value?.rows || [],
                  })
                : undefined,
            })?.toISOString() || "";
          const previousResultFingerprint: string | null =
            lastResultFingerprintRef.current.monitorId === subjectId
              ? lastResultFingerprintRef.current.value
              : null;

          if (
            lastStatusFingerprintRef.current.monitorId === subjectId &&
            lastStatusFingerprintRef.current.value !== nextStatusFingerprint
          ) {
            setStatusChangeCount((count: number) => {
              return count + 1;
            });
          }

          lastStatusFingerprintRef.current = {
            monitorId: subjectId,
            value: nextStatusFingerprint,
          };
          lastResultFingerprintRef.current = {
            monitorId: subjectId,
            value: nextResultFingerprint,
          };
          fullProbeRowsRef.current = nextFull;
          shownMonitorIdRef.current = subjectId;
          monitorRef.current = item;

          setMonitor(item);
          commitProbes(probesSection);
          commitStatusRows(statusRowsSection);
          setStatusFingerprint(nextStatusFingerprint);
          setResultFingerprint(nextResultFingerprint);
          setError("");
          setRefreshError("");
          setLoadedMonitorId(subjectId);
          setLastLoadedAt(OneUptimeDate.getCurrentDate());
          setRefreshCount((count: number) => {
            return count + 1;
          });

          // R4, after the commit so it never holds up the page.
          if (!layout || layout.evaluationPolicy === "None") {
            // Nothing is evaluated (Manual), so there is nothing to read.
            evaluationGenerationRef.current += 1;
            commitEvaluation(
              resolveSection<MonitorEvaluationByProbe>({
                value: { byProbeId: {} },
                subjectId: subjectId,
              }),
            );
          } else {
            const evaluationSection: OverviewSection<MonitorEvaluationByProbe> =
              evaluationRef.current;
            // A failed read is retried on the next load rather than left blank.
            const isEvaluationMissing: boolean =
              evaluationSection.loadedFor !== subjectId ||
              evaluationSection.status === "error";
            const isNetworkDeviceTurn: boolean =
              reason === "poll" &&
              layout.family === MonitorOverviewFamily.NetworkDevice &&
              pollCountRef.current %
                MONITOR_OVERVIEW_NETWORK_DEVICE_EVALUATION_POLLS ===
                0;

            if (
              isFullRefresh ||
              isEvaluationMissing ||
              isNetworkDeviceTurn ||
              nextResultFingerprint !== previousResultFingerprint
            ) {
              loadEvaluation({
                monitorType: item.monitorType!,
                subjectId: subjectId,
              });
            }
          }

          /*
           * Drift: the newest timeline row says one status and the row
           * another. refresh-status (fired on mount, not awaited) repairs
           * that on the server, so wait for it and reload once, rather than
           * show two different statuses on one page.
           */
          if (
            isFirstLoad &&
            driftHealedForRef.current !== subjectId &&
            MonitorStatusHistoryUtil.hasStatusDrift({
              currentStatusId: currentStatusId,
              latestRow: latestRow,
            })
          ) {
            driftHealedForRef.current = subjectId;

            const refreshStatus: Promise<void> =
              refreshStatusPromiseRef.current || Promise.resolve();

            refreshStatus
              .then((): void => {
                if (!isStillCurrent()) {
                  return;
                }

                fetchData("drift-heal").catch(() => {
                  // fetchData records its own errors.
                });
              })
              .catch(() => {
                // The refresh-status promise never rejects.
              });
          }
        } catch (err) {
          if (!isStillCurrent()) {
            return;
          }

          const message: string = API.getFriendlyMessage(err);

          if (isFirstLoad) {
            setError(message);
            setLoadedMonitorId(subjectId);
          } else {
            setRefreshError(message);
          }
        }

        if (isStillCurrent()) {
          setIsRefreshing(false);
        }
      },
      [monitorIdString],
    );

  useEffect(() => {
    activeMonitorIdRef.current = monitorIdString;
    shownMonitorIdRef.current = "";
    lastStatusFingerprintRef.current = { monitorId: "", value: "" };
    setError("");
    setRefreshError("");
    setIsRefreshing(false);
    setStatusChangeCount(0);

    /*
     * refresh-status repairs a drifted current status on the server. It is
     * fired once per monitor per visit and never awaited: the page does not
     * wait on it, and polls never repeat it. It is a custom route, so it
     * needs ModelAPI.getCommonHeaders() for the tenantid header; without it
     * the project-member check has no project and every call fails.
     */
    if (refreshStatusFiredForRef.current !== monitorIdString) {
      refreshStatusFiredForRef.current = monitorIdString;
      refreshStatusPromiseRef.current = API.get({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/monitor/refresh-status/" + options.monitorId.toString(),
        ),
        headers: ModelAPI.getCommonHeaders(),
      })
        .then((): void => {
          // Refused or not, the status is now as fresh as it will get.
        })
        .catch((): void => {
          // A failed repair must not fail the page.
        });
    }

    fetchData("first-load").catch(() => {
      // fetchData records its own errors.
    });

    const isTabHidden: () => boolean = (): boolean => {
      return (
        typeof document !== "undefined" && document.visibilityState === "hidden"
      );
    };

    const poll: () => void = (): void => {
      // Polls refresh what is on screen; a first load has its own retry.
      if (isTabHidden() || shownMonitorIdRef.current !== monitorIdString) {
        return;
      }

      pollCountRef.current += 1;
      setPollCount(pollCountRef.current);

      fetchData("poll").catch(() => {
        // fetchData records its own errors.
      });
    };

    const intervalId: ReturnType<typeof setInterval> = setInterval(
      poll,
      MONITOR_OVERVIEW_REFRESH_INTERVAL_MS,
    );

    const onVisibilityChange: () => void = (): void => {
      if (!isTabHidden()) {
        poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Orphan anything still in flight for this monitor.
      generationRef.current += 1;
      evaluationGenerationRef.current += 1;
      activeMonitorIdRef.current = "";
    };
  }, [monitorIdString]);

  const refresh: (refreshOptions?: MonitorOverviewRefreshOptions) => void =
    useCallback(
      (refreshOptions?: MonitorOverviewRefreshOptions): void => {
        const reason: "manual" | "details-saved" =
          refreshOptions?.reason || "manual";

        if (reason === "manual") {
          setManualRefreshCount((count: number) => {
            return count + 1;
          });
        }

        fetchData(reason).catch(() => {
          // fetchData records its own errors.
        });
      },
      [fetchData],
    );

  // The only way back to the skeleton for the same monitor.
  const retryFirstLoad: () => void = useCallback((): void => {
    shownMonitorIdRef.current = "";
    monitorRef.current = null;
    setMonitor(null);
    setError("");
    setRefreshError("");
    setLoadedMonitorId("");

    fetchData("first-load").catch(() => {
      // fetchData records its own errors.
    });
  }, [fetchData]);

  const hasLoaded: boolean = loadedMonitorId === monitorIdString;

  return {
    monitor: hasLoaded ? monitor : null,
    hasLoaded: hasLoaded,
    error: hasLoaded ? error : "",
    refreshError: hasLoaded ? refreshError : "",
    isRefreshing: hasLoaded ? isRefreshing : false,
    lastLoadedAt: hasLoaded ? lastLoadedAt : null,
    refreshCount: refreshCount,
    pollCount: pollCount,
    manualRefreshCount: manualRefreshCount,
    statusChangeCount: hasLoaded ? statusChangeCount : 0,
    statusFingerprint: hasLoaded ? statusFingerprint : "",
    resultFingerprint: hasLoaded ? resultFingerprint : "",
    probes: getSectionForSubject(probes, monitorIdString),
    statusRows: getSectionForSubject(statusRows, monitorIdString),
    evaluation: getSectionForSubject(evaluation, monitorIdString),
    refresh: refresh,
    retryFirstLoad: retryFirstLoad,
  };
};

export default useMonitorOverviewData;
