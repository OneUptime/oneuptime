import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { buildExceptionsGroupRoute } from "../../../Utils/TraceCorrelatedSignals";
import {
  POD_EXCEPTIONS_OTHER_REQUESTS,
  PodLogLine,
  PodLogLineGroup,
  PodLogWindow,
  SPAN_EXCEPTIONS_NONE_LINKED,
  SPAN_POD_EXCEPTIONS_EMPTY,
  SPAN_POD_EXCEPTIONS_TITLE,
  SPAN_POD_EXCEPTION_LIMIT,
  buildSpanPodExceptionQuery,
  describePodExceptionCut,
  describeSpanPodExceptionWindow,
  getPodLogGroupTitle,
  getPodLogWindow,
  groupPodLogLines,
  selectPodRecordsInWindow,
} from "../../../Utils/TracePodLogs";

export interface ComponentProps {
  podEntityKey: string;
  // The pod's name (k8s.pod.name) when the span's resource gives it.
  podName?: string | undefined;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  /*
   * Whether some exceptions carry the span's ID. Without any, these are all
   * the span has: the section says so and opens on its own. With some, it
   * starts folded under them.
   */
  hasLinkedExceptions: boolean;
}

const POD_EXCEPTION_SELECT: Select<ExceptionInstance> = {
  _id: true,
  time: true,
  timeUnixNano: true,
  exceptionType: true,
  message: true,
  stackTrace: true,
  fingerprint: true,
};

interface PodExceptionsRead {
  // In the window by their exact instant, oldest first.
  exceptions: Array<ExceptionInstance>;
  // The read came back full: later exceptions in the window are not shown.
  isCut: boolean;
}

/*
 * "Exceptions from this pod during this span (not linked by trace ID)": what
 * the span's pod raised over the span's own time and a little either side,
 * read by pod and time (Utils/TracePodLogs) - the exceptions ingest extracts
 * from an eBPF span's pod's log lines carry no trace ID. Those before and
 * after the span are set apart and muted. Read when opened.
 */
const SpanPodExceptions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const bodyId: string = useId();

  const [isOpen, setIsOpen] = useState<boolean>(!props.hasLinkedExceptions);
  const [result, setResult] = useState<PodExceptionsRead | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // The read the exceptions on screen answer; it is not read again.
  const [shownReadKey, setShownReadKey] = useState<string>("");

  // Generation counter, as for the panel's own tabs.
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const podLogWindow: PodLogWindow | null = useMemo(() => {
    return getPodLogWindow({
      startTimeUnixNano: props.startTimeUnixNano,
      endTimeUnixNano: props.endTimeUnixNano,
    });
  }, [props.startTimeUnixNano, props.endTimeUnixNano]);

  const query: Query<ExceptionInstance> | null = useMemo(() => {
    if (!podLogWindow) {
      return null;
    }

    return buildSpanPodExceptionQuery({
      podEntityKey: props.podEntityKey,
      window: podLogWindow,
    });
  }, [props.podEntityKey, podLogWindow]);

  const readKey: string =
    query && podLogWindow
      ? `${props.podEntityKey}|${podLogWindow.startTime.getTime()}|${podLogWindow.endTime.getTime()}`
      : "";

  useEffect(() => {
    if (!isOpen || !query || !podLogWindow || readKey === shownReadKey) {
      return;
    }

    loadGenerationRef.current += 1;
    const generation: number = loadGenerationRef.current;

    const loadPodExceptions: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        const read: ListResult<ExceptionInstance> =
          await AnalyticsModelAPI.getList<ExceptionInstance>({
            modelType: ExceptionInstance,
            query: {
              ...(projectId ? { projectId } : {}),
              ...query,
            } as Query<ExceptionInstance>,
            select: POD_EXCEPTION_SELECT,
            sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
            limit: SPAN_POD_EXCEPTION_LIMIT,
            skip: 0,
            requestOptions: {},
          });

        if (generation === loadGenerationRef.current) {
          setResult({
            exceptions: selectPodRecordsInWindow({
              records: read.data,
              window: podLogWindow,
            }),
            isCut: read.data.length >= SPAN_POD_EXCEPTION_LIMIT,
          });
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

    void loadPodExceptions();

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [isOpen, query, podLogWindow, readKey, shownReadKey]);

  const groups: Array<PodLogLineGroup<ExceptionInstance>> = useMemo(() => {
    if (!result) {
      return [];
    }

    return groupPodLogLines({
      logs: result.exceptions,
      startTimeUnixNano: props.startTimeUnixNano,
      endTimeUnixNano: props.endTimeUnixNano,
    });
  }, [result, props.startTimeUnixNano, props.endTimeUnixNano]);

  const renderException: (
    line: PodLogLine<ExceptionInstance>,
    group: PodLogLineGroup<ExceptionInstance>,
    index: number,
  ) => ReactElement = (
    line: PodLogLine<ExceptionInstance>,
    group: PodLogLineGroup<ExceptionInstance>,
    index: number,
  ): ReactElement => {
    const exception: ExceptionInstance = line.log;
    const isDuringSpan: boolean = group.position === "during";
    const groupRoute: Route | null = exception.fingerprint
      ? buildExceptionsGroupRoute({
          exceptionsListRoute: RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_UNRESOLVED]!,
          ),
          fingerprint: exception.fingerprint.toString(),
        })
      : null;

    return (
      <li
        key={`${group.position}-${index}`}
        className={`rounded-md border px-3 py-2 ${
          isDuringSpan
            ? "border-red-200 bg-red-50/60"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {exception.exceptionType && (
              <div
                className={`font-mono text-[11px] font-semibold ${
                  isDuringSpan ? "text-red-700" : "text-gray-500"
                }`}
              >
                {exception.exceptionType}
              </div>
            )}
            <div
              className={`break-words text-xs ${
                isDuringSpan ? "text-gray-900" : "text-gray-500"
              }`}
            >
              {exception.message || translator.translateText("Exception")}
            </div>
          </div>
          <div className="flex flex-none flex-col items-end gap-1">
            <span className="font-mono text-[11px] tabular-nums text-gray-400">
              {line.offsetLabel}
            </span>
            {groupRoute && (
              <Link
                to={groupRoute}
                openInNewTab={true}
                className="text-[11px] font-medium text-red-700 hover:underline"
              >
                {translator.translateText("View exception")}
              </Link>
            )}
          </div>
        </div>
        {exception.stackTrace && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-medium text-red-700">
              {translator.translateText("Stack trace")}
            </summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre rounded bg-white p-2 font-mono text-[11px] text-gray-800">
              {exception.stackTrace.replace(/\\n/g, "\n")}
            </pre>
          </details>
        )}
      </li>
    );
  };

  const renderExceptions: () => ReactElement = (): ReactElement => {
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
          {translator.translateText(SPAN_POD_EXCEPTIONS_EMPTY)}
        </div>
      );
    }

    return (
      <div className="space-y-3" data-testid="span-pod-exception-list">
        {groups.map(
          (group: PodLogLineGroup<ExceptionInstance>): ReactElement => {
            return (
              <div
                key={group.position}
                data-testid={`span-pod-exceptions-${group.position}`}
              >
                <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {getPodLogGroupTitle(translator, group.position)}
                </h5>
                <ul className="space-y-2">
                  {group.lines.map(
                    (
                      line: PodLogLine<ExceptionInstance>,
                      index: number,
                    ): ReactElement => {
                      return renderException(line, group, index);
                    },
                  )}
                </ul>
              </div>
            );
          },
        )}
        {result.isCut && (
          <p className="text-[11px] text-gray-400">
            {describePodExceptionCut(translator)}
          </p>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-2" data-testid="span-pod-exceptions">
      {!props.hasLinkedExceptions && (
        <p className="text-xs text-gray-500">
          {translator.translateText(SPAN_EXCEPTIONS_NONE_LINKED)}
        </p>
      )}
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="flex w-full items-start gap-1.5 rounded text-left text-xs font-semibold text-gray-800 hover:text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        data-testid="span-pod-exceptions-toggle"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon
          icon={isOpen ? IconProp.ChevronDown : IconProp.ChevronRight}
          className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
        />
        <span>{translator.translateText(SPAN_POD_EXCEPTIONS_TITLE)}</span>
      </button>
      {isOpen && (
        <div id={bodyId} className="space-y-3">
          <p
            className="text-[11px] leading-relaxed text-gray-500"
            data-testid="span-pod-exceptions-window"
          >
            {describeSpanPodExceptionWindow({
              translator,
              podName: props.podName,
              paddingMs: podLogWindow?.paddingMs || 0,
            })}{" "}
            {translator.translateText(POD_EXCEPTIONS_OTHER_REQUESTS)}
          </p>
          {renderExceptions()}
        </div>
      )}
    </section>
  );
};

export default SpanPodExceptions;
