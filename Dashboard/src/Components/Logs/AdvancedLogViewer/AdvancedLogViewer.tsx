import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Realtime from "Common/UI/Utils/Realtime";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import Select from "Common/Types/BaseDatabase/Select";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import OneUptimeDate from "Common/Types/Date";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
// Subcomponents
import Toolbar from "./SubComponents/Toolbar";
import FilterChips from "./SubComponents/FilterChips";
import VolumeChartPanel from "./SubComponents/VolumeChartPanel";
import LogListVirtualized from "./SubComponents/LogListVirtualized";
import LogDetailsSideOver from "./SubComponents/LogDetailsSideOver";


// Props mirror existing simple LogsViewer container (Dashboard version)
export interface ComponentProps {
  id: string;
  telemetryServiceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  limit?: number | undefined;
}
export interface VirtualItem {
  index: number;
  start: number;
  end: number;
}
export const ROW_HEIGHT = 28;
export const BUFFER_ROWS = 20;

const AdvancedLogViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const refreshQuery = (): Query<Log> => {
    const q: Query<Log> = {};
    if (props.telemetryServiceIds?.length) {
      q.serviceId = new Includes(props.telemetryServiceIds);
    }
    if (props.traceIds?.length) {
      q.traceId = new Includes(props.traceIds);
    }
    if (props.spanIds?.length) {
      q.spanId = new Includes(props.spanIds);
    }
    if (props.logQuery) {
      Object.keys(props.logQuery).forEach((k) => {
        return ((q as any)[k] = (props.logQuery as any)[k]);
      });
    }
    return q;
  };
  const select: Select<Log> = {
    body: true,
    time: true,
    projectId: true,
    serviceId: true,
    spanId: true,
    traceId: true,
    severityText: true,
    attributes: true,
  };
  const [logs, setLogs] = useState<Array<Log>>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [filterOptions, setFilterOptions] =
    useState<Query<Log>>(refreshQuery());
  const [liveTail, setLiveTail] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);
  const [showJSON, setShowJSON] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Array<LogSeverity>>([]);
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logAttributes, setLogAttributes] = useState<Array<string>>([]);
  const [initialLoadingAttributes, setInitialLoadingAttributes] =
    useState(true);
  const [attributeError, setAttributeError] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const [timeRangePreset, setTimeRangePreset] = useState("");
  useEffect(() => {
    setFilterOptions(refreshQuery());
  }, [
    props.telemetryServiceIds,
    props.traceIds,
    props.spanIds,
    props.logQuery,
  ]);
  useEffect(() => {
    fetchLogs().catch((e) => {
      return setError(API.getFriendlyMessage(e));
    });
  }, [filterOptions]);
  useEffect(() => {
    if (!props.enableRealtime || !liveTail) {
      return;
    }
    let buffer: Log[] = [];
    let raf: number | null = null;
    const flush = () => {
      if (!buffer.length) {
        return;
      }
      setLogs((prev) => {
        return [...prev, ...buffer];
      });
      buffer = [];
      raf = null;
    };
    const schedule = () => {
      if (raf === null) {
        raf = requestAnimationFrame(flush);
      }
    };
    const disconnect = Realtime.listenToAnalyticsModelEvent(
      {
        modelType: Log,
        eventType: ModelEventType.Create,
        tenantId: ProjectUtil.getCurrentProjectId()!,
      },
      (l: Log) => {
        buffer.push(l);
        schedule();
      },
    );
    return () => {
      disconnect();
      if (raf) {
        cancelAnimationFrame(raf);
      }
      flush();
    };
  }, [props.enableRealtime, liveTail]);
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);
  useEffect(() => {
    const r = () => {
      return (
        containerRef.current &&
        setViewportHeight(containerRef.current.clientHeight)
      );
    };
    window.addEventListener("resize", r);
    r();
    return () => {
      return window.removeEventListener("resize", r);
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setInitialLoadingAttributes(true);
        setAttributeError("");
        const resp: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post(
            URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/get-attributes",
            ),
            {},
            { ...ModelAPI.getCommonHeaders() },
          );
        if (resp instanceof HTTPErrorResponse) {
          throw resp;
        }
        if (mounted) {
          setLogAttributes(
            ((resp.data["attributes"] as string[]) || []).sort(),
          );
          setInitialLoadingAttributes(false);
        }
      } catch (e) {
        if (mounted) {
          setAttributeError(API.getFriendlyMessage(e));
          setInitialLoadingAttributes(false);
        }
      }
    };
    run().catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const fetchLogs = async () => {
    setError("");
    setIsLoading(true);
    try {
      const res: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
        modelType: Log,
        query: filterOptions,
        limit: props.limit || LIMIT_PER_PROJECT,
        skip: 0,
        select,
        sort: { time: SortOrder.Descending },
        requestOptions: {},
      });
      res.data.reverse();
      setLogs(res.data);
    } catch (e) {
      setError(API.getFriendlyMessage(e));
    }
    setIsLoading(false);
  };
  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (
        severityFilter.length &&
        l.severityText &&
        !severityFilter.includes(l.severityText as LogSeverity)
      ) {
        return false;
      }
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        const b = (l.body || "").toString().toLowerCase();
        if (
          !b.includes(t) &&
          !(l.traceId || "").toString().toLowerCase().includes(t) &&
          !(l.spanId || "").toString().toLowerCase().includes(t)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [logs, severityFilter, searchTerm]);
  const currentTimeFilter = filterOptions.time as any | undefined;
  const chartFrom: Date | null = currentTimeFilter?.$gte || null;
  const chartTo: Date | null = currentTimeFilter?.$lte || null;
  const addAttributeFilter = useCallback((k: string, v: string) => {
    setFilterOptions((p) => {
      const attrs = { ...((p.attributes as any) || {}) };
      attrs[k] = v;
      return { ...p, attributes: attrs };
    });
  }, []);
  const activeChips: Array<{ label: string; onRemove: () => void }> = [];
  if (searchTerm) {
    activeChips.push({
      label: `Search: ${searchTerm}`,
      onRemove: () => {
        return setSearchTerm("");
      },
    });
  }
  severityFilter.forEach((s) => {
    return activeChips.push({
      label: `Severity: ${s}`,
      onRemove: () => {
        return setSeverityFilter((p) => {
          return p.filter((x) => {
            return x !== s;
          });
        });
      },
    });
  });
  if (timeRangePreset) {
    activeChips.push({
      label: `Range: ${timeRangePreset}`,
      onRemove: () => {
        setTimeRangePreset("");
        setFilterOptions((p) => {
          const c = { ...p };
          delete (c as any).time;
          return c;
        });
      },
    });
  }
  const attributeFilters: any = (filterOptions as any).attributes;
  if (attributeFilters && typeof attributeFilters === "object") {
    Object.keys(attributeFilters).forEach((k) => {
      return activeChips.push({
        label: `${k}: ${attributeFilters[k]}`,
        onRemove: () => {
          return setFilterOptions((p) => {
            const c: any = { ...p };
            const a = { ...(c.attributes || {}) };
            delete a[k];
            if (Object.keys(a).length) {
              c.attributes = a;
            } else {
              delete c.attributes;
            }
            return c;
          });
        },
      });
    });
  }
  const total = filteredLogs.length;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS,
  );
  const endIndex = Math.min(
    total - 1,
    Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS,
  );
  const virtualItems: VirtualItem[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    virtualItems.push({
      index: i,
      start: i * ROW_HEIGHT,
      end: (i + 1) * ROW_HEIGHT,
    });
  }
  const totalHeight = total * ROW_HEIGHT;
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const t = e.currentTarget;
    setScrollTop(t.scrollTop);
    if (autoScroll && t.scrollHeight - t.scrollTop - t.clientHeight > 10) {
      setAutoScroll(false);
    }
  };
  const getSeverityColor = (s?: LogSeverity) => {
    switch (s) {
      case LogSeverity.Error:
        return "text-rose-400";
      case LogSeverity.Fatal:
        return "text-rose-500";
      case LogSeverity.Warning:
        return "text-amber-400";
      case LogSeverity.Debug:
      case LogSeverity.Trace:
        return "text-slate-400";
      case LogSeverity.Information:
        return "text-sky-400";
      default:
        return "text-slate-200";
    }
  };
  const toggleSeverity = (sev: LogSeverity) => {
    return setSeverityFilter((p) => {
      return p.includes(sev)
        ? p.filter((x) => {
            return x !== sev;
          })
        : [...p, sev];
    });
  };
  const applyTimeRangePreset = (preset: string) => {
    const now = new Date();
    let from: Date | null = null;
    const map: Record<string, number> = {
      "5m": 5,
      "15m": 15,
      "1h": 60,
      "6h": 360,
      "24h": 1440,
    };
    if (map[preset]) {
      from = new Date(now.getTime() - map[preset] * 60_000);
    }
    setTimeRangePreset(preset);
    if (from) {
      setFilterOptions((p) => {
        return {
          ...p,
          time: { $gte: from, $lte: now } as any,
        };
      });
    } else {
      setFilterOptions((p) => {
        const c = { ...p };
        delete (c as any).time;
        return c;
      });
    }
  };
  if (error) {
    return <ErrorMessage message={error} />;
  }
  return (
    <div id={props.id} className="space-y-5">
      <Toolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        timeRangePreset={timeRangePreset}
        onTimePresetChange={applyTimeRangePreset}
        severityFilter={severityFilter}
        toggleSeverity={toggleSeverity}
        wrapLines={wrapLines}
        onToggleWrap={setWrapLines}
        showJSON={showJSON}
        onToggleJSON={setShowJSON}
        liveTail={liveTail}
        onToggleLiveTail={setLiveTail}
        autoScroll={autoScroll}
        onToggleAutoScroll={setAutoScroll}
        enableRealtime={props.enableRealtime || false}
        onRefresh={fetchLogs}
        showFilters={props.showFilters || false}
        onApplyFilters={fetchLogs}
        initialLoadingAttributes={initialLoadingAttributes}
        attributeError={attributeError}
        showAdvancedFilters={props.showFilters || false}
        filterOptions={filterOptions}
        setFilterOptions={setFilterOptions}
        logAttributes={logAttributes}
      />{" "}
      <FilterChips chips={activeChips} />{" "}
      <VolumeChartPanel
        logs={filteredLogs}
        from={chartFrom}
        to={chartTo}
        timeRangePreset={timeRangePreset}
      />{" "}
      <LogListVirtualized
        containerRef={containerRef}
        onScroll={onScroll}
        isLoading={isLoading}
        filteredLogs={filteredLogs}
        totalHeight={totalHeight}
        virtualItems={virtualItems}
        wrapLines={wrapLines}
        showJSON={showJSON}
        liveTail={liveTail}
        enableRealtime={Boolean(props.enableRealtime)}
        noLogsMessage={props.noLogsMessage}
        onClearFilters={() => {
          setSearchTerm("");
          setSeverityFilter([]);
          setTimeRangePreset("");
          setFilterOptions(refreshQuery());
        }}
        setSelectedLog={setSelectedLog}
        selectedLog={selectedLog}
        getSeverityColor={getSeverityColor}
        OneUptimeDate={OneUptimeDate}
        fetchLogs={fetchLogs}
        setLiveTail={setLiveTail}
      />{" "}
      <LogDetailsSideOver
        selectedLog={selectedLog}
        onClose={() => {
          return setSelectedLog(null);
        }}
        addAttributeFilter={addAttributeFilter}
        wrapLines={wrapLines}
        onToggleWrap={() => {
          return setWrapLines((w) => {
            return !w;
          });
        }}
      />
    </div>
  );
};
export default AdvancedLogViewer;
