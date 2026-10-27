import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { getLogSeverityClassName } from "../../../Utils/TraceDetailPresentation";
import {
  MergedPodLogReads,
  POD_LOGS_OTHER_REQUESTS,
  PodLogLine,
  PodLogLineGroup,
  PodLogWindow,
  SPAN_LOGS_NONE_LINKED,
  SPAN_POD_LOGS_EMPTY,
  SPAN_POD_LOGS_LOOK_AROUND,
  SPAN_POD_LOGS_TITLE,
  SPAN_POD_LOG_BEFORE_LIMIT,
  SPAN_POD_LOG_LIMIT,
  SpanPodLogReads,
  buildSpanPodLogReads,
  describePodLogCut,
  describeSpanPodLogWindow,
  formatPodLogPadding,
  getLogTimeUnixNano,
  getPodLogGroupTitle,
  getPodLogPaddingChoices,
  getPodLogPaddingMs,
  getPodLogWindow,
  groupPodLogLines,
  mergePodLogReads,
} from "../../../Utils/TracePodLogs";
import ExceptionSegmentedControl from "../../Exceptions/ExceptionSegmentedControl";

export interface ComponentProps {
  podEntityKey: string;
  // The pod's name (k8s.pod.name) when the span's resource gives it.
  podName?: string | undefined;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  /*
   * Whether some logs carry the span's ID. Without any, these lines are all
   * the span has: the section says so and opens on its own. With some, it
   * starts folded under them.
   */
  hasLinkedLogs: boolean;
}

const POD_LOG_SELECT: Select<Log> = {
  _id: true,
  time: true,
  timeUnixNano: true,
  severityText: true,
  body: true,
};

/*
 * "Logs from this pod during this span (not linked by trace ID)": what the
 * span's pod wrote over the span's own time and a little either side, read
 * by pod and time (Utils/TracePodLogs) for spans whose logs carry no trace
 * context - every eBPF span. The lines before and after the span are set
 * apart and muted, since the pod serves other requests meanwhile. Read when
 * opened, and again when Advanced widens the window.
 */
const SpanPodLogs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyId: string = useId();

  const [isOpen, setIsOpen] = useState<boolean>(!props.hasLinkedLogs);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  // Null: the span's own default padding.
  const [chosenPaddingMs, setChosenPaddingMs] = useState<number | null>(null);
  const [result, setResult] = useState<MergedPodLogReads<Log> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // The read the lines on screen answer; an unchanged window is not read again.
  const [shownReadKey, setShownReadKey] = useState<string>("");

  /*
   * Generation counter, as for the panel's own tabs: bumped when the read
   * changes or the section closes or unmounts, so a stale answer never lands.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const defaultPaddingMs: number = getPodLogPaddingMs(
    props.endTimeUnixNano - props.startTimeUnixNano,
  );
  const paddingMs: number = chosenPaddingMs ?? defaultPaddingMs;

  const podLogWindow: PodLogWindow | null = useMemo(() => {
    return getPodLogWindow({
      startTimeUnixNano: props.startTimeUnixNano,
      endTimeUnixNano: props.endTimeUnixNano,
      paddingMs,
    });
  }, [props.startTimeUnixNano, props.endTimeUnixNano, paddingMs]);

  const reads: SpanPodLogReads | null = useMemo(() => {
    if (!podLogWindow) {
      return null;
    }

    return buildSpanPodLogReads({
      podEntityKey: props.podEntityKey,
      startTimeUnixNano: props.startTimeUnixNano,
      window: podLogWindow,
    });
  }, [props.podEntityKey, props.startTimeUnixNano, podLogWindow]);

  const readKey: string =
    reads && podLogWindow
      ? `${props.podEntityKey}|${podLogWindow.startTime.getTime()}|${podLogWindow.endTime.getTime()}`
      : "";

  useEffect(() => {
    if (!isOpen || !reads || readKey === shownReadKey) {
      return;
    }

    loadGenerationRef.current += 1;
    const generation: number = loadGenerationRef.current;

    const loadPodLogs: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        const readPart: (
          query: Query<Log>,
          sortOrder: SortOrder,
          limit: number,
        ) => Promise<ListResult<Log>> = (
          query: Query<Log>,
          sortOrder: SortOrder,
          limit: number,
        ): Promise<ListResult<Log>> => {
          return AnalyticsModelAPI.getList<Log>({
            modelType: Log,
            query: {
              ...(projectId ? { projectId } : {}),
              ...query,
            } as Query<Log>,
            select: POD_LOG_SELECT,
            sort: { time: sortOrder } as Record<string, SortOrder>,
            limit,
            skip: 0,
            requestOptions: {},
          });
        };

        const [before, fromStart] = await Promise.all([
          readPart(
            reads.before,
            SortOrder.Descending,
            SPAN_POD_LOG_BEFORE_LIMIT,
          ),
          readPart(reads.fromStart, SortOrder.Ascending, SPAN_POD_LOG_LIMIT),
        ]);

        if (generation === loadGenerationRef.current) {
          setResult(
            mergePodLogReads({
              before: before.data,
              fromStart: fromStart.data,
            }),
          );
        }
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setError(API.getFriendlyMessage(err));
          setResult(null);
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
          setShownReadKey(readKey);
        }
      }
    };

    void loadPodLogs();

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [isOpen, reads, readKey, shownReadKey]);

  const groups: Array<PodLogLineGroup<Log>> = useMemo(() => {
    if (!result) {
      return [];
    }

    return groupPodLogLines({
      logs: result.logs,
      startTimeUnixNano: props.startTimeUnixNano,
      endTimeUnixNano: props.endTimeUnixNano,
    });
  }, [result, props.startTimeUnixNano, props.endTimeUnixNano]);

  const renderLine: (
    line: PodLogLine<Log>,
    group: PodLogLineGroup<Log>,
    index: number,
  ) => ReactElement = (
    line: PodLogLine<Log>,
    group: PodLogLineGroup<Log>,
    index: number,
  ): ReactElement => {
    const severity: string = line.log.severityText?.toString() || "INFO";
    const timeUnixNano: number = getLogTimeUnixNano(line.log);
    const isDuringSpan: boolean = group.position === "during";

    return (
      <li
        key={`${group.position}-${index}`}
        className={`flex items-start gap-2 rounded-md border px-2 py-1.5 font-mono text-[11px] ${
          isDuringSpan
            ? "border-gray-200 bg-white"
            : "border-gray-100 bg-gray-50"
        }`}
      >
        <span
          className={`flex-none rounded px-1 font-semibold uppercase ${getLogSeverityClassName(severity)} ${
            isDuringSpan ? "" : "opacity-70"
          }`}
        >
          {severity}
        </span>
        <span
          className={`min-w-0 flex-1 break-words ${
            isDuringSpan ? "text-gray-800" : "text-gray-500"
          }`}
        >
          {line.log.body?.toString() || ""}
        </span>
        <span
          className="flex-none tabular-nums text-gray-400"
          title={
            Number.isFinite(timeUnixNano)
              ? OneUptimeDate.getLocalTimeString(
                  new Date(Math.floor(timeUnixNano / 1000000)),
                  { includeSeconds: true },
                )
              : undefined
          }
        >
          {line.offsetLabel}
        </span>
      </li>
    );
  };

  const renderLines: () => ReactElement = (): ReactElement => {
    if (isLoading || readKey !== shownReadKey) {
      return (
        <div className="flex h-16 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (error) {
      return (
        <div
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
          role="alert"
        >
          {error}
        </div>
      );
    }

    if (!result || groups.length === 0) {
      return (
        <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">
          {translator.translateText(SPAN_POD_LOGS_EMPTY)}
        </div>
      );
    }

    return (
      <div className="space-y-3" data-testid="span-pod-log-lines">
        {groups.map((group: PodLogLineGroup<Log>): ReactElement => {
          return (
            <div
              key={group.position}
              data-testid={`span-pod-logs-${group.position}`}
            >
              <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {getPodLogGroupTitle(translator, group.position)}
              </h5>
              {group.position === "before" && result.isBeforeCut && (
                <p className="mb-1 text-[11px] text-gray-400">
                  {describePodLogCut({ translator, part: "before" })}
                </p>
              )}
              <ul className="space-y-1">
                {group.lines.map(
                  (line: PodLogLine<Log>, index: number): ReactElement => {
                    return renderLine(line, group, index);
                  },
                )}
              </ul>
            </div>
          );
        })}
        {result.isAfterCut && (
          <p className="text-[11px] text-gray-400">
            {describePodLogCut({ translator, part: "fromStart" })}
          </p>
        )}
      </div>
    );
  };

  const renderAdvanced: () => ReactElement = (): ReactElement => {
    return (
      <div>
        <button
          type="button"
          aria-expanded={isAdvancedOpen}
          className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid="span-pod-logs-advanced"
          onClick={() => {
            setIsAdvancedOpen(!isAdvancedOpen);
          }}
        >
          <Icon
            icon={isAdvancedOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
            className="h-3 w-3"
          />
          {translator.translateText("Advanced")}
        </button>
        {isAdvancedOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-gray-500">
              {translator.translateText(SPAN_POD_LOGS_LOOK_AROUND)}
            </span>
            <ExceptionSegmentedControl<string>
              label={SPAN_POD_LOGS_LOOK_AROUND}
              testId="span-pod-logs-padding"
              value={String(paddingMs)}
              onChange={(value: string) => {
                setChosenPaddingMs(Number(value));
              }}
              options={getPodLogPaddingChoices(defaultPaddingMs).map(
                (padding: number) => {
                  return {
                    value: String(padding),
                    label: `±${formatPodLogPadding(padding)}`,
                  };
                },
              )}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-2" data-testid="span-pod-logs">
      {!props.hasLinkedLogs && (
        <p className="text-xs text-gray-500">
          {translator.translateText(SPAN_LOGS_NONE_LINKED)}
        </p>
      )}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="flex w-full items-start gap-1.5 rounded text-left text-xs font-semibold text-gray-800 hover:text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid="span-pod-logs-toggle"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon
          icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
        />
        <span>{translator.translateText(SPAN_POD_LOGS_TITLE)}</span>
      </button>
      {isOpen && (
        <div id={bodyId} className="space-y-3">
          <p
            className="text-[11px] leading-relaxed text-gray-500"
            data-testid="span-pod-logs-window"
          >
            {describeSpanPodLogWindow({
              translator,
              podName: props.podName,
              paddingMs,
            })}{" "}
            {translator.translateText(POD_LOGS_OTHER_REQUESTS)}
          </p>
          {renderLines()}
          {renderAdvanced()}
        </div>
      )}
    </section>
  );
};

export default SpanPodLogs;
