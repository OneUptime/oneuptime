import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import TelemetryDetailPanel from "Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Log from "Common/Models/AnalyticsModels/Log";
import Service from "Common/Models/DatabaseModels/Service";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Select from "Common/Types/BaseDatabase/Select";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import SpanUtil from "../../Utils/SpanUtil";

export interface TraceDetailPanelProps {
  isOpen: boolean;
  span: Span | null;
  serviceById: Record<string, Service>;
  onClose: () => void;
}

type TabId = "overview" | "spans" | "attributes" | "logs";

function statusDotClass(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "bg-red-500";
  }
  if (status === SpanStatus.Ok) {
    return "bg-emerald-500";
  }
  return "bg-gray-300";
}

function statusLabel(status: number | undefined | null): string {
  if (status === SpanStatus.Error) {
    return "Error";
  }
  if (status === SpanStatus.Ok) {
    return "Ok";
  }
  return "Unset";
}

function formatDuration(durationNano: number): string {
  if (!durationNano) {
    return "0 ms";
  }
  const factor: ReturnType<typeof SpanUtil.getDivisibilityFactor> =
    SpanUtil.getDivisibilityFactor(durationNano);
  return SpanUtil.getSpanDurationAsString({
    divisibilityFactor: factor,
    spanDurationInUnixNano: durationNano,
  });
}

function flattenAttrs(
  obj: JSONObject | undefined,
  prefix: string = "",
): Array<[string, string]> {
  if (!obj) {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const key of Object.keys(obj)) {
    const value: unknown = (obj as Record<string, unknown>)[key];
    const full: string = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenAttrs(value as JSONObject, full));
    } else {
      out.push([full, Array.isArray(value) ? JSON.stringify(value) : String(value)]);
    }
  }
  return out;
}

const TraceDetailPanel: FunctionComponent<TraceDetailPanelProps> = (
  props: TraceDetailPanelProps,
): ReactElement | null => {
  const { span, serviceById } = props;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [childSpans, setChildSpans] = useState<Array<Span>>([]);
  const [spansLoading, setSpansLoading] = useState<boolean>(false);
  const [relatedLogs, setRelatedLogs] = useState<Array<Log>>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  // Reset when opening a new span
  useEffect(() => {
    if (span) {
      setActiveTab("overview");
      setChildSpans([]);
      setRelatedLogs([]);
    }
  }, [span?.spanId?.toString()]);

  const traceIdStr: string | undefined = span?.traceId?.toString();

  const fetchChildSpans: () => Promise<void> = useCallback(async () => {
    if (!traceIdStr) {
      return;
    }
    setSpansLoading(true);
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const result: ListResult<Span> = await AnalyticsModelAPI.getList<Span>({
        modelType: Span,
        query: {
          ...(projectId ? { projectId } : {}),
          traceId: traceIdStr,
        },
        limit: 500,
        skip: 0,
        select: {
          spanId: true,
          parentSpanId: true,
          name: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          durationUnixNano: true,
          startTimeUnixNano: true,
          statusCode: true,
          kind: true,
        } as Select<Span>,
        sort: { startTimeUnixNano: SortOrder.Ascending } as Record<
          string,
          SortOrder
        >,
        requestOptions: {},
      });
      setChildSpans(result.data);
    } catch {
      setChildSpans([]);
    } finally {
      setSpansLoading(false);
    }
  }, [traceIdStr]);

  const fetchRelatedLogs: () => Promise<void> = useCallback(async () => {
    if (!traceIdStr) {
      return;
    }
    setLogsLoading(true);
    try {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const result: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
        modelType: Log,
        query: {
          ...(projectId ? { projectId } : {}),
          traceId: traceIdStr,
        },
        limit: 200,
        skip: 0,
        select: {
          time: true,
          severityText: true,
          body: true,
          serviceId: true,
          spanId: true,
        } as Select<Log>,
        sort: { time: SortOrder.Ascending } as Record<string, SortOrder>,
        requestOptions: {},
      });
      setRelatedLogs(result.data);
    } catch {
      setRelatedLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [traceIdStr]);

  useEffect(() => {
    if (!props.isOpen || !traceIdStr) {
      return;
    }
    if (activeTab === "spans" && childSpans.length === 0 && !spansLoading) {
      void fetchChildSpans();
    }
    if (activeTab === "logs" && relatedLogs.length === 0 && !logsLoading) {
      void fetchRelatedLogs();
    }
  }, [
    activeTab,
    props.isOpen,
    traceIdStr,
    childSpans.length,
    relatedLogs.length,
    spansLoading,
    logsLoading,
    fetchChildSpans,
    fetchRelatedLogs,
  ]);

  // Waterfall scale — computed from child spans
  const waterfallScale: {
    minNano: number;
    totalNano: number;
  } | null = useMemo(() => {
    if (childSpans.length === 0) {
      return null;
    }
    let min: number = Number.MAX_SAFE_INTEGER;
    let max: number = 0;
    for (const s of childSpans) {
      const start: number = Number(s.startTimeUnixNano || 0);
      const end: number = start + Number(s.durationUnixNano || 0);
      if (start > 0 && start < min) {
        min = start;
      }
      if (end > max) {
        max = end;
      }
    }
    if (max === 0 || min === Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return { minNano: min, totalNano: Math.max(1, max - min) };
  }, [childSpans]);

  if (!span) {
    return null;
  }

  const service: Service | undefined = span.serviceId
    ? serviceById[span.serviceId.toString()]
    : undefined;

  const durationNano: number = Number(span.durationUnixNano || 0);

  const title: ReactElement = (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${statusDotClass(
          span.statusCode,
        )}`}
      />
      <span className="font-mono">{span.name || "(unnamed span)"}</span>
    </div>
  );

  const subtitle: ReactElement = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span>{service?.name || "unknown service"}</span>
      <span>·</span>
      <span>{statusLabel(span.statusCode)}</span>
      <span>·</span>
      <span className="font-mono">{formatDuration(durationNano)}</span>
      {span.traceId && (
        <>
          <span>·</span>
          <span className="font-mono text-gray-400">
            trace {span.traceId.toString().slice(0, 16)}…
          </span>
        </>
      )}
    </div>
  );

  const overviewTab: ReactElement = (
    <div className="space-y-4 px-4 py-4">
      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Summary
        </div>
        <dl className="divide-y divide-gray-100 rounded-md border border-gray-100 text-xs">
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Service</dt>
            <dd className="font-medium text-gray-800">
              {service?.name || "unknown"}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Span Name</dt>
            <dd className="font-mono text-gray-800">{span.name}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Status</dt>
            <dd className="text-gray-800">{statusLabel(span.statusCode)}</dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Duration</dt>
            <dd className="font-mono text-gray-800">
              {formatDuration(durationNano)}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Span Kind</dt>
            <dd className="text-gray-800">
              {SpanUtil.getSpanKindFriendlyName(span.kind as never)}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Trace ID</dt>
            <dd className="font-mono text-[11px] text-gray-700">
              {span.traceId?.toString()}
            </dd>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <dt className="text-gray-500">Span ID</dt>
            <dd className="font-mono text-[11px] text-gray-700">
              {span.spanId?.toString()}
            </dd>
          </div>
        </dl>
      </div>
      {span.statusMessage && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Status Message
          </div>
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
            {span.statusMessage as unknown as string}
          </div>
        </div>
      )}
    </div>
  );

  const spansTab: ReactElement = (
    <div className="px-4 py-4">
      {spansLoading && (
        <div className="flex h-32 items-center justify-center">
          <ComponentLoader />
        </div>
      )}
      {!spansLoading && childSpans.length === 0 && (
        <p className="text-xs text-gray-500">No spans found in this trace.</p>
      )}
      {!spansLoading && childSpans.length > 0 && waterfallScale && (
        <ul className="space-y-1">
          {childSpans.map((s: Span): ReactElement => {
            const start: number = Number(s.startTimeUnixNano || 0);
            const dur: number = Number(s.durationUnixNano || 0);
            const leftPct: number = Math.max(
              0,
              ((start - waterfallScale.minNano) / waterfallScale.totalNano) *
                100,
            );
            const widthPct: number = Math.max(
              0.5,
              (dur / waterfallScale.totalNano) * 100,
            );
            const childService: Service | undefined = s.serviceId
              ? serviceById[s.serviceId.toString()]
              : undefined;
            const color: string =
              childService?.serviceColor?.toString() || "#6366f1";
            return (
              <li
                key={s.spanId?.toString()}
                className="rounded-md border border-gray-100 px-2 py-1.5 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${statusDotClass(
                        s.statusCode,
                      )}`}
                    />
                    <span className="truncate font-mono text-gray-800">
                      {s.name}
                    </span>
                    <span className="text-gray-400">
                      {childService?.name || ""}
                    </span>
                  </div>
                  <span className="flex-shrink-0 font-mono tabular-nums text-gray-500">
                    {formatDuration(dur)}
                  </span>
                </div>
                <div className="relative mt-1 h-1 w-full rounded-full bg-gray-100">
                  <div
                    className="absolute top-0 h-full rounded-full"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const attrs: Array<[string, string]> = flattenAttrs(
    span.attributes as JSONObject | undefined,
  );

  const attributesTab: ReactElement = (
    <div className="px-4 py-4">
      {attrs.length === 0 ? (
        <p className="text-xs text-gray-500">No attributes.</p>
      ) : (
        <dl className="divide-y divide-gray-100 rounded-md border border-gray-100 text-xs">
          {attrs.map(([k, v]: [string, string]): ReactElement => {
            return (
              <div
                key={k}
                className="flex items-start justify-between gap-4 px-3 py-1.5"
              >
                <dt className="flex-shrink-0 font-mono text-[11px] text-gray-500">
                  {k}
                </dt>
                <dd className="break-all text-right font-mono text-[11px] text-gray-800">
                  {v}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );

  const logsTab: ReactElement = (
    <div className="px-4 py-4">
      {logsLoading && (
        <div className="flex h-32 items-center justify-center">
          <ComponentLoader />
        </div>
      )}
      {!logsLoading && relatedLogs.length === 0 && (
        <p className="text-xs text-gray-500">No related logs.</p>
      )}
      {!logsLoading && relatedLogs.length > 0 && (
        <ul className="space-y-1">
          {relatedLogs.map((log: Log, i: number): ReactElement => {
            const severity: string =
              (log.severityText as unknown as string) || "info";
            return (
              <li
                key={`${log.spanId?.toString() || "log"}-${i}`}
                className="rounded-md border border-gray-100 px-2 py-1.5 font-mono text-[11px]"
              >
                <div className="flex items-center gap-2 text-gray-400">
                  <span>{severity}</span>
                  <span className="truncate text-gray-700">
                    {(log.body as unknown as string) || ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <TelemetryDetailPanel
      isOpen={props.isOpen}
      title={title}
      subtitle={subtitle}
      onClose={props.onClose}
      activeTabId={activeTab}
      onTabChange={(id: string) => {
        setActiveTab(id as TabId);
      }}
      tabs={[
        { id: "overview", label: "Overview", content: overviewTab },
        {
          id: "spans",
          label: "Spans",
          content: spansTab,
          badge: childSpans.length || undefined,
        },
        {
          id: "attributes",
          label: "Attributes",
          content: attributesTab,
          badge: attrs.length || undefined,
        },
        {
          id: "logs",
          label: "Related Logs",
          content: logsTab,
          badge: relatedLogs.length || undefined,
        },
      ]}
    />
  );
};

export default TraceDetailPanel;
