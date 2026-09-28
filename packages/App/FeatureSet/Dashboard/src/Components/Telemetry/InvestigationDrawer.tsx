import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TimeRange from "Common/Types/Time/TimeRange";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { HistogramBucket } from "Common/UI/Components/LogsViewer/types";
import LogsHistogram from "Common/UI/Components/LogsViewer/components/LogsHistogram";
import Navigation from "Common/UI/Utils/Navigation";
import HintChip from "../Metrics/HintChip";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import ExplorerLink from "../Metrics/Utils/ExplorerLink";
import TelemetryCompanionSignalTabs from "./TelemetryCompanionSignalTabs";
import { buildLogsHistogramRequest } from "../Logs/LogsHistogramRequest";
import {
  fetchLogsHistogramRaw,
  fetchTopErrorPatterns,
} from "../Logs/LogsInsightsApi";
import {
  LogVolumeSummary,
  LogsInsightsScope,
  TopErrorPatternRow,
  buildErrorPatternLogsRoute,
  describeOccurrenceCount,
  summarizeSeverityBuckets,
} from "../../Utils/LogsInsights";
import {
  MetricScopeFilterExtraction,
  extractScopeFiltersFromQueryConfigs,
  formatDroppedScopeHint,
  resolveServiceIdsByNames,
} from "../../Utils/MetricsCrossSignalPivot";
import useEventTimeReferenceLines, {
  EventTimeReferenceLines,
} from "../Metrics/Utils/UseEventTimeReferenceLines";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import {
  InvestigationEvidence,
  InvestigationFinding,
  InvestigationMarker,
  buildInvestigationFindings,
  buildInvestigationNoteMarkdown,
  buildInvestigationPrompt,
} from "../../Utils/InvestigationFindings";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import EventName from "../../Utils/EventName";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { computeBucketSizeInMinutes } from "../Dashboard/Components/LogChartData";

export interface ComponentProps {
  /** What the user is investigating, e.g. `CPU by host · 12:01–12:14`. */
  title?: string | undefined;
  /** The pinned window under investigation (a zoom, a bucket, a spike). */
  window: InBetween<Date>;
  /**
   * The metric view scoped to what the user clicked (series labels and
   * filters already folded into the query configs' attributes).
   */
  metricViewData: MetricViewData;
  onClose: () => void;
}

const TOP_ERROR_PATTERN_LIMIT: number = 5;

/*
 * A window other than the one the opener pinned: a zoom dragged out of a
 * chart in the drawer, or a range picked on its metric card. Tied to the
 * pinned window it was made over, so an opener that re-pins the drawer on
 * a new moment starts it fresh.
 */
interface DrawerWindowOverride {
  pinnedStartMs: number;
  pinnedEndMs: number;
  // What the metric card's picker shows (a relative pick stays relative).
  range: RangeStartAndEndDateTime;
  // The window every signal in the drawer is fetched for.
  window: InBetween<Date>;
}

interface LatestDrawerWindow {
  pinnedStartMs: number;
  pinnedEndMs: number;
  currentRange: RangeStartAndEndDateTime;
}

/**
 * The in-context investigation panel: everything that happened in one
 * window, without leaving the page. A log-signal summary (volume by
 * severity + top error patterns), the metric charts pinned to the
 * window, and the companion logs/traces/exceptions tabs scoped the same
 * way — with escape hatches into the full explorers.
 */
const InvestigationDrawer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const pinnedStartMs: number = props.window.startValue.getTime();
  const pinnedEndMs: number = props.window.endValue.getTime();

  /*
   * Drag-to-zoom inside the drawer (issue #4105). A drag across the log
   * volume chart or any metric chart narrows the WHOLE drawer — log stats,
   * top patterns, findings, the metric charts and the companion tabs — and
   * a double-click on any of them, or "Reset zoom", returns to the window
   * the opener pinned. It never reaches the page under the drawer: the
   * drawer offers its own zoom to everything inside it, shadowing any the
   * page offers.
   */
  const [windowOverride, setWindowOverride] =
    useState<DrawerWindowOverride | null>(null);

  const activeOverride: DrawerWindowOverride | null =
    windowOverride &&
    windowOverride.pinnedStartMs === pinnedStartMs &&
    windowOverride.pinnedEndMs === pinnedEndMs
      ? windowOverride
      : null;

  const windowStartMs: number = activeOverride
    ? activeOverride.window.startValue.getTime()
    : pinnedStartMs;
  const windowEndMs: number = activeOverride
    ? activeOverride.window.endValue.getTime()
    : pinnedEndMs;

  /*
   * Everything handed to the companion machinery MUST be referentially
   * stable — CompanionMetricsTab's discovery effect keys on spec
   * identity, and an inline-recreated query would put it in a refetch
   * loop.
   */
  const pinnedWindow: InBetween<Date> = useMemo(() => {
    return new InBetween<Date>(new Date(windowStartMs), new Date(windowEndMs));
  }, [windowStartMs, windowEndMs]);

  const pinnedViewData: MetricViewData = useMemo(() => {
    return {
      queryConfigs: props.metricViewData.queryConfigs,
      formulaConfigs: props.metricViewData.formulaConfigs || [],
      /*
       * Pinned on purpose — no rangeToken: an investigation window must
       * not re-anchor to "now" on refresh.
       */
      startAndEndDate: pinnedWindow,
    };
  }, [props.metricViewData, pinnedWindow]);

  const telemetryQuery: TelemetryQuery = useMemo(() => {
    return {
      telemetryType: TelemetryType.Metric,
      telemetryQuery: null,
      metricViewData: pinnedViewData,
    } as TelemetryQuery;
  }, [pinnedViewData]);

  const pinnedTimeRange: RangeStartAndEndDateTime = useMemo(() => {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: pinnedWindow,
    };
  }, [pinnedWindow]);

  // The window the opener pinned: where "Reset zoom" always goes back to.
  const openerTimeRange: RangeStartAndEndDateTime = useMemo(() => {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date(pinnedStartMs),
        new Date(pinnedEndMs),
      ),
    };
  }, [pinnedStartMs, pinnedEndMs]);

  // What the metric card shows in its picker.
  const cardTimeRange: RangeStartAndEndDateTime = activeOverride
    ? activeOverride.range
    : pinnedTimeRange;

  /*
   * The callbacks read the latest window through a ref so they can keep
   * their identity: the charts they are handed to are memoized.
   */
  const latestWindow: React.MutableRefObject<LatestDrawerWindow> =
    useRef<LatestDrawerWindow>({
      pinnedStartMs: pinnedStartMs,
      pinnedEndMs: pinnedEndMs,
      currentRange: cardTimeRange,
    });
  latestWindow.current = {
    pinnedStartMs: pinnedStartMs,
    pinnedEndMs: pinnedEndMs,
    currentRange: cardTimeRange,
  };

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const current: LatestDrawerWindow = latestWindow.current;
      const zoomedTo: RangeStartAndEndDateTime | null =
        TimeRangeZoomUtil.getZoomedRange({
          startTime: startTime,
          endTime: endTime,
          currentRange: current.currentRange,
        });

      if (!zoomedTo || !zoomedTo.startAndEndDate) {
        return;
      }

      setWindowOverride({
        pinnedStartMs: current.pinnedStartMs,
        pinnedEndMs: current.pinnedEndMs,
        range: zoomedTo,
        window: zoomedTo.startAndEndDate,
      });
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    setWindowOverride(null);
  }, []);

  /*
   * A range picked on the metric card moves the whole drawer too, so every
   * signal in it keeps describing one window. Unlike a page's picker it
   * does not forget the pinned window: an investigation is about the moment
   * the opener pinned, so "Reset zoom" still leads back there.
   */
  const pickTimeRange: (range: RangeStartAndEndDateTime) => void = useCallback(
    (range: RangeStartAndEndDateTime): void => {
      const current: LatestDrawerWindow = latestWindow.current;
      const pickedWindow: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(range);

      if (
        pickedWindow.startValue.getTime() === current.pinnedStartMs &&
        pickedWindow.endValue.getTime() === current.pinnedEndMs
      ) {
        setWindowOverride(null);
        return;
      }

      setWindowOverride({
        pinnedStartMs: current.pinnedStartMs,
        pinnedEndMs: current.pinnedEndMs,
        range: range,
        window: pickedWindow,
      });
    },
    [],
  );

  const isZoomed: boolean = activeOverride !== null;

  const drawerZoom: TimeRangeZoom = useMemo((): TimeRangeZoom => {
    return {
      isZoomed: isZoomed,
      rangeBeforeZoom: isZoomed ? openerTimeRange : null,
      zoomToTimeRange: zoomToTimeRange,
      resetZoom: resetZoom,
    };
  }, [isZoomed, openerTimeRange, zoomToTimeRange, resetZoom]);

  const extraction: MetricScopeFilterExtraction = useMemo(() => {
    return extractScopeFiltersFromQueryConfigs(
      pinnedViewData.queryConfigs || [],
    );
  }, [pinnedViewData]);

  // -- Log signal summary (volume + top error patterns) --

  const [logBuckets, setLogBuckets] = useState<Array<HistogramBucket> | null>(
    null,
  );
  /*
   * How much time one log volume bar covers, set together with the bars:
   * it is what lets a click on one bar zoom into it, and a drag zoom
   * through the end of the last bar it covered.
   */
  const [logBucketIntervalMs, setLogBucketIntervalMs] = useState<
    number | undefined
  >(undefined);
  const [errorPatterns, setErrorPatterns] =
    useState<Array<TopErrorPatternRow> | null>(null);

  useEffect(() => {
    let isCancelled: boolean = false;

    /*
     * A zoom (or its reset) moves the window: the previous window's numbers
     * must not sit under the new window's heading while the new ones load.
     */
    setLogBuckets(null);
    setErrorPatterns(null);

    const fetchLogSignal: () => Promise<void> = async (): Promise<void> => {
      /*
       * Service names resolve to ids first (cached) so the log queries
       * scope by the primaryEntityId column the log rows actually store.
       */
      let serviceIds: Array<string> = [];
      if (extraction.serviceNames.length > 0) {
        const mapping: Dictionary<string> = await resolveServiceIdsByNames(
          extraction.serviceNames,
        );
        serviceIds = extraction.serviceNames
          .map((serviceName: string): string => {
            return mapping[serviceName] || "";
          })
          .filter((serviceId: string): boolean => {
            return serviceId !== "";
          });
      }

      if (isCancelled) {
        return;
      }

      const scope: LogsInsightsScope = {
        timeRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(
            new Date(windowStartMs),
            new Date(windowEndMs),
          ),
        },
        ...(serviceIds.length > 0 ? { serviceIds } : {}),
      };

      /*
       * Asked for explicitly (the server's own default for the window), so
       * the drawer knows how wide its bars are without the response saying.
       */
      const bucketSizeInMinutes: number = computeBucketSizeInMinutes(
        new Date(windowStartMs),
        new Date(windowEndMs),
      );

      const [buckets, patterns]: [
        Array<JSONObject>,
        Array<TopErrorPatternRow>,
      ] = await Promise.all([
        fetchLogsHistogramRaw({
          ...buildLogsHistogramRequest({
            timeRange: scope.timeRange,
            ...(serviceIds.length > 0 ? { serviceIds } : {}),
            /*
             * Unlike the pattern analysis, the histogram can carry the
             * metric view's attribute filters — logs tagged the same way
             * the metric rows are.
             */
            attributes:
              Object.keys(extraction.attributes).length > 0
                ? extraction.attributes
                : undefined,
            appliedFacetFilters: new Map<string, Set<string>>(),
          }),
          bucketSizeInMinutes: bucketSizeInMinutes,
        }).catch((): Array<JSONObject> => {
          return [];
        }),
        fetchTopErrorPatterns(scope, TOP_ERROR_PATTERN_LIMIT).catch(
          (): Array<TopErrorPatternRow> => {
            return [];
          },
        ),
      ]);

      if (isCancelled) {
        return;
      }

      setLogBuckets(buckets as unknown as Array<HistogramBucket>);
      setLogBucketIntervalMs(bucketSizeInMinutes * 60 * 1000);
      setErrorPatterns(patterns);
    };

    void fetchLogSignal();

    return () => {
      isCancelled = true;
    };
  }, [windowStartMs, windowEndMs, extraction]);

  const logVolume: LogVolumeSummary | null = useMemo(() => {
    if (!logBuckets) {
      return null;
    }
    return summarizeSeverityBuckets(logBuckets as unknown as Array<JSONObject>);
  }, [logBuckets]);

  const droppedHint: string = formatDroppedScopeHint(
    extraction.droppedFilterKeys,
  );

  // -- Findings: deterministic "explain this spike" over the evidence --

  const { lines: eventLines }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: true,
      window: pinnedWindow,
      queryConfigs: pinnedViewData.queryConfigs,
    });

  const markers: Array<InvestigationMarker> = useMemo(() => {
    return eventLines.map(
      (line: ChartTimeReferenceLineProps): InvestigationMarker => {
        const label: string = line.label || "Event";
        const kind: InvestigationMarker["kind"] = label.startsWith("Incident:")
          ? "incident"
          : label.startsWith("Alert:")
            ? "alert"
            : "change";
        return { kind, label, timeMs: line.date.getTime() };
      },
    );
  }, [eventLines]);

  const scopeChipsForEvidence: Array<string> = useMemo(() => {
    const chips: Array<string> = [];
    for (const serviceName of extraction.serviceNames) {
      chips.push(`service = ${serviceName}`);
    }
    for (const key of Object.keys(extraction.attributes)) {
      chips.push(`${key} = ${extraction.attributes[key]}`);
    }
    return chips;
  }, [extraction]);

  const evidence: InvestigationEvidence = useMemo(() => {
    return {
      windowStartMs,
      windowEndMs,
      scopeChips: scopeChipsForEvidence,
      logVolume,
      errorPatterns: errorPatterns || [],
      logBuckets: (logBuckets || []) as unknown as Array<JSONObject>,
      markers,
    };
  }, [
    windowStartMs,
    windowEndMs,
    scopeChipsForEvidence,
    logVolume,
    errorPatterns,
    logBuckets,
    markers,
  ]);

  const findings: Array<InvestigationFinding> = useMemo(() => {
    return buildInvestigationFindings(evidence);
  }, [evidence]);

  const explainWithAi: VoidFunction = (): void => {
    /*
     * Opens (never toggles closed) the Ask AI panel with the evidence as
     * an editable prompt. The panel sits above the drawer (z-40 > z-30),
     * so the user keeps the evidence in view while they ask.
     */
    GlobalEvents.dispatchEvent(EventName.AI_CHAT_TOGGLE, {
      prompt: buildInvestigationPrompt(evidence, findings),
    });
  };

  // -- Save to incident: pin the investigation to a timeline --

  const [isIncidentPickerOpen, setIsIncidentPickerOpen] =
    useState<boolean>(false);
  const [recentIncidents, setRecentIncidents] =
    useState<Array<Incident> | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  /*
   * Saving the note either closes the picker (success) or leaves it open
   * carrying the reason it failed — the picker is the only place the user
   * is looking when they press Save.
   */
  const [saveNoteError, setSaveNoteError] = useState<string>("");

  const openIncidentPicker: VoidFunction = (): void => {
    setIsIncidentPickerOpen(true);
    setSaveNoteError("");
    if (recentIncidents !== null) {
      return;
    }
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      setRecentIncidents([]);
      return;
    }
    ModelAPI.getList<Incident>({
      modelType: Incident,
      query: { projectId },
      select: {
        _id: true,
        title: true,
        incidentNumberWithPrefix: true,
        incidentNumber: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 10,
      skip: 0,
    })
      .then((result: ListResult<Incident>) => {
        setRecentIncidents(result.data);
        if (result.data[0]?.id) {
          setSelectedIncidentId(result.data[0].id.toString());
        }
      })
      .catch(() => {
        setRecentIncidents([]);
      });
  };

  const saveNoteToIncident: VoidFunction = (): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId || !selectedIncidentId || isSavingNote) {
      return;
    }
    setIsSavingNote(true);
    setSaveNoteError("");

    const note: IncidentInternalNote = new IncidentInternalNote();
    note.projectId = projectId;
    note.incidentId = new ObjectID(selectedIncidentId);
    note.note = buildInvestigationNoteMarkdown({
      evidence,
      findings,
      explorerUrl: ExplorerLink.buildExplorerUrl(pinnedViewData).toString(),
    });

    ModelAPI.create<IncidentInternalNote>({
      model: note,
      modelType: IncidentInternalNote,
    })
      .then(() => {
        setIsIncidentPickerOpen(false);
      })
      .catch(() => {
        setSaveNoteError(
          "Could not save the note — the incident note API rejected the request.",
        );
      })
      .finally(() => {
        setIsSavingNote(false);
      });
  };

  const openPattern: (pattern: TopErrorPatternRow) => void = (
    pattern: TopErrorPatternRow,
  ): void => {
    const scope: LogsInsightsScope = {
      timeRange: pinnedTimeRange,
    };
    const route: ReturnType<typeof buildErrorPatternLogsRoute> =
      buildErrorPatternLogsRoute(pattern.pattern, scope, pattern.sampleBody);
    if (!route) {
      return;
    }
    // Navigation replaces the page under the drawer — close first.
    props.onClose();
    Navigation.navigate(route);
  };

  const openInExplorer: VoidFunction = (): void => {
    props.onClose();
    ExplorerLink.openInExplorer(pinnedViewData);
  };

  /*
   * The window this panel is pinned to is the one the user just picked in the
   * time range picker a click away, so it has to be written the same way that
   * button writes it: on the machine's own 12- or 24-hour clock, in the
   * configured timezone. getInBetweenDatesAsFormattedString cannot do that -
   * it forwards no options, so it is hardcoded to a 24-hour clock, and it
   * formats the digits in the browser's zone while labelling them with the
   * configured zone's abbreviation.
   */
  const formatPinnedWindow: () => string = (): string => {
    const format: (date: Date) => string = (date: Date): string => {
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
    };

    return `${format(pinnedWindow.startValue)} - ${format(pinnedWindow.endValue)}`;
  };

  return (
    <SideOver
      title={props.title || "Investigate window"}
      description={formatPinnedWindow()}
      size={SideOverSize.Large}
      onClose={props.onClose}
    >
      {/* One wrapper element — SideOver divides its children. */}
      <TimeRangeZoomProvider zoom={drawerZoom}>
        <div className="space-y-5 py-5">
          {/* Scope strip */}
          <div className="flex flex-wrap items-center gap-1.5">
            {scopeChipsForEvidence.length > 0 ? (
              scopeChipsForEvidence.map((chip: string) => {
                return (
                  <span
                    key={chip}
                    className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-600"
                  >
                    {chip}
                  </span>
                );
              })
            ) : (
              <span className="text-xs text-gray-500">
                Scoped by time window only — results cover the whole project.
              </span>
            )}
            {droppedHint ? (
              <HintChip variant="amber">{droppedHint}</HintChip>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {/*
               * The way back to the pinned window from anywhere in the
               * drawer — including the companion tabs, where no chart of the
               * drawer's is on screen to double-click. Renders nothing unless
               * zoomed.
               */}
              <ResetTimeRangeZoomButton />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={openInExplorer}
              >
                <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
                Open in Metric Explorer
              </button>
            </div>
          </div>

          {/* Findings — the deterministic "explain this spike" readout */}
          <Card
            title="Findings"
            description="What stands out in this window, from the evidence below."
            rightElement={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  title="Open Ask AI with this evidence as an editable prompt"
                  onClick={explainWithAi}
                >
                  <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5" />
                  Explain with AI
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  title="Pin this investigation to an incident as a private note"
                  onClick={openIncidentPicker}
                >
                  <Icon icon={IconProp.MapPin} className="h-3.5 w-3.5" />
                  Save to incident
                </button>
              </div>
            }
          >
            <div className="space-y-3">
              <ul className="space-y-1.5">
                {findings.map(
                  (finding: InvestigationFinding, index: number) => {
                    return (
                      <li key={index} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            finding.severity === "critical"
                              ? "bg-red-500"
                              : finding.severity === "warning"
                                ? "bg-amber-500"
                                : "bg-blue-400"
                          }`}
                        />
                        <span className="text-sm text-gray-700">
                          {finding.text}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>

              {isIncidentPickerOpen ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                  {recentIncidents === null ? (
                    <span className="text-xs text-gray-500">
                      Loading incidents…
                    </span>
                  ) : recentIncidents.length === 0 ? (
                    <span className="text-xs text-gray-500">
                      No incidents found in this project.
                    </span>
                  ) : (
                    <>
                      <label
                        htmlFor="investigation-incident-picker"
                        className="text-xs font-medium text-gray-700"
                      >
                        Pin to
                      </label>
                      <select
                        id="investigation-incident-picker"
                        value={selectedIncidentId}
                        onChange={(
                          event: React.ChangeEvent<HTMLSelectElement>,
                        ): void => {
                          setSelectedIncidentId(event.target.value);
                        }}
                        className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        {recentIncidents.map((incident: Incident) => {
                          return (
                            <option
                              key={incident.id?.toString()}
                              value={incident.id?.toString()}
                            >
                              {incident.incidentNumberWithPrefix ||
                                `#${incident.incidentNumber || "?"}`}{" "}
                              — {incident.title}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        disabled={isSavingNote || !selectedIncidentId}
                        className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                        onClick={saveNoteToIncident}
                      >
                        {isSavingNote ? "Saving…" : "Save note"}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    onClick={() => {
                      setIsIncidentPickerOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  {saveNoteError ? (
                    <p
                      role="alert"
                      className="w-full text-xs font-medium text-red-600"
                    >
                      {saveNoteError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          {/* Log signal summary */}
          <Card
            title="Log signal"
            description="Log volume and the loudest error patterns inside this window."
          >
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    label: "Log lines",
                    value: logVolume ? logVolume.total.toLocaleString() : "…",
                  },
                  {
                    label: "Errors",
                    value: logVolume
                      ? logVolume.errorCount.toLocaleString()
                      : "…",
                  },
                  {
                    label: "Error rate",
                    value: logVolume
                      ? `${logVolume.errorRatePercent.toFixed(1)}%`
                      : "…",
                  },
                ].map((stat: { label: string; value: string }) => {
                  return (
                    <div
                      key={stat.label}
                      className="rounded-lg border border-gray-200 bg-white p-3"
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        {stat.label}
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
                        {stat.value}
                      </p>
                    </div>
                  );
                })}
              </div>

              <LogsHistogram
                buckets={logBuckets || []}
                isLoading={logBuckets === null}
                bucketIntervalMs={logBucketIntervalMs}
                onTimeRangeSelect={zoomToTimeRange}
                onZoomOut={isZoomed ? resetZoom : undefined}
              />

              <div>
                <p className="text-xs font-medium text-gray-700">
                  Top error patterns
                </p>
                {errorPatterns === null ? (
                  <p className="mt-1 text-xs text-gray-400">Loading…</p>
                ) : errorPatterns.length === 0 ? (
                  <p className="mt-1 text-xs text-gray-500">
                    No error-severity logs in this window.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {errorPatterns.map((pattern: TopErrorPatternRow) => {
                      return (
                        <li key={pattern.pattern}>
                          <button
                            type="button"
                            className="group flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                            title="Open these logs in the explorer"
                            onClick={() => {
                              openPattern(pattern);
                            }}
                          >
                            <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-red-700">
                              {pattern.count.toLocaleString()}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 group-hover:text-gray-900">
                              {pattern.sampleBody || pattern.pattern}
                            </span>
                            <span className="max-sm:hidden shrink-0 text-[11px] text-gray-400 sm:inline">
                              {describeOccurrenceCount(
                                pattern.count,
                                pinnedTimeRange,
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {scopeChipsForEvidence.length > 0 &&
                Object.keys(extraction.attributes).length > 0 ? (
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    Patterns are scoped by service and window; attribute filters
                    apply to the volume chart above.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>

          {/* Metrics + companion signals, all pinned to the window */}
          <TelemetryCompanionSignalTabs
            telemetryQuery={telemetryQuery}
            snapshotWindow={pinnedWindow}
            eventNoun="view"
            primarySignalElement={
              /*
               * Controlled by the drawer's window, inside the drawer's zoom:
               * a drag or double-click on a metric chart zooms the whole
               * drawer, and the card's picker moves the whole drawer.
               */
              <EmbeddedMetricCard
                title="Metrics"
                description="The charts this investigation started from, pinned to the window."
                queryConfigs={pinnedViewData.queryConfigs}
                formulaConfigs={pinnedViewData.formulaConfigs}
                timeRange={cardTimeRange}
                onTimeRangeChange={pickTimeRange}
              />
            }
          />
        </div>
      </TimeRangeZoomProvider>
    </SideOver>
  );
};

export default InvestigationDrawer;
