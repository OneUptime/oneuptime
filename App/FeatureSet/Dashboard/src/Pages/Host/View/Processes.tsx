import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";

interface ProcessRow {
  key: string;
  pid: string;
  executable: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  command: string | null;
  user: string | null;
}

const PROCESS_PID_ATTR: string = "process.pid";
const PROCESS_NAME_ATTR: string = "process.executable.name";
const PROCESS_COMMAND_ATTR: string = "process.command";
const PROCESS_OWNER_ATTR: string = "process.owner";

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatBytes: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = value;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

/*
 * Processes are ephemeral — pids come and go on every collector scrape
 * (typically every 30s). 15 minutes balances "show recent processes"
 * with "don't show ghosts that exited 30 minutes ago". A user who needs
 * a fresher snapshot can hit Refresh.
 */
const PROCESS_LOOKBACK_MINUTES: number = 15;

const HostProcesses: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<ProcessRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [latestSampleAt, setLatestSampleAt] = useState<Date | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -PROCESS_LOOKBACK_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              "resource.host.name": item.hostIdentifier,
            },
          },
          limit: 2000,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };
      };

      const [cpuResult, memBytesResult, memPctResult]: [
        ListResult<Metric>,
        ListResult<Metric>,
        ListResult<Metric>,
      ] = await Promise.all([
        AnalyticsModelAPI.getList<Metric>(
          buildQuery("process.cpu.utilization"),
        ),
        AnalyticsModelAPI.getList<Metric>(buildQuery("process.memory.usage")),
        AnalyticsModelAPI.getList<Metric>(
          buildQuery("process.memory.utilization"),
        ),
      ]);

      const byKey: Map<string, ProcessRow> = new Map();
      let newestSample: Date | null = null;

      const upsert: (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes" | "memoryPercent",
      ) => void = (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes" | "memoryPercent",
      ): void => {
        for (const m of result.data) {
          if (m.time) {
            const t: Date = new Date(m.time as unknown as string | Date);
            if (
              !Number.isNaN(t.getTime()) &&
              (newestSample === null || t > newestSample)
            ) {
              newestSample = t;
            }
          }
          const attrs: Record<string, unknown> =
            (m.attributes as Record<string, unknown>) || {};
          const pidRaw: unknown = attrs[PROCESS_PID_ATTR];
          const pid: string =
            pidRaw === undefined || pidRaw === null ? "" : String(pidRaw);
          const exe: string =
            (attrs[PROCESS_NAME_ATTR] as string | undefined) || "";
          if (!pid && !exe) {
            continue;
          }
          const key: string = `${pid}-${exe}`;
          let row: ProcessRow | undefined = byKey.get(key);
          if (!row) {
            row = {
              key,
              pid,
              executable: exe || "(unknown)",
              cpuPercent: null,
              memoryBytes: null,
              memoryPercent: null,
              command:
                (attrs[PROCESS_COMMAND_ATTR] as string | undefined) || null,
              user: (attrs[PROCESS_OWNER_ATTR] as string | undefined) || null,
            };
            byKey.set(key, row);
          }
          if (m.value === undefined || m.value === null) {
            continue;
          }
          if (row[field] !== null) {
            // Skip — first datapoint per key is the most recent (sorted DESC).
            continue;
          }
          if (field === "cpuPercent") {
            row.cpuPercent = Number(m.value) * 100;
          } else if (field === "memoryPercent") {
            row.memoryPercent = Number(m.value) * 100;
          } else {
            row.memoryBytes = Number(m.value);
          }
        }
      };

      upsert(cpuResult, "cpuPercent");
      upsert(memBytesResult, "memoryBytes");
      upsert(memPctResult, "memoryPercent");

      const sorted: Array<ProcessRow> = Array.from(byKey.values()).sort(
        (a: ProcessRow, b: ProcessRow) => {
          return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
        },
      );

      setRows(sorted);
      setLatestSampleAt(newestSample);
      setRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
    setIsRefreshing(false);
  };

  const refresh: () => void = (): void => {
    setIsRefreshing(true);
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const renderRefreshButton: () => ReactElement = (): ReactElement => {
    return (
      <button
        type="button"
        onClick={refresh}
        disabled={isRefreshing}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.003 8.003 0 01-15.356-2m15.356 2H15"
          />
        </svg>
        {isRefreshing ? "Refreshing…" : "Refresh"}
      </button>
    );
  };

  const renderFreshness: () => ReactElement = (): ReactElement => {
    const parts: Array<string> = [];
    if (latestSampleAt) {
      parts.push(`latest sample ${OneUptimeDate.fromNow(latestSampleAt)}`);
    }
    if (refreshedAt) {
      parts.push(`refreshed ${OneUptimeDate.fromNow(refreshedAt)}`);
    }
    return (
      <span className="text-xs text-gray-500">
        Looking back {PROCESS_LOOKBACK_MINUTES} minutes
        {parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}
      </span>
    );
  };

  if (rows.length === 0) {
    return (
      <Card
        title="Processes"
        description="Per-process CPU, memory, and ownership data from the OTel `process` scraper."
        rightElement={renderRefreshButton()}
      >
        <div className="px-4 py-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center mb-4">
            <svg
              className="h-6 w-6 text-slate-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-900 mb-1">
            No process metrics in the last {PROCESS_LOOKBACK_MINUTES} minutes
          </p>
          <p className="text-xs text-gray-500 max-w-md mx-auto">
            Enable the{" "}
            <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">
              process
            </code>{" "}
            scraper in your OTel collector{" "}
            <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">
              hostmetrics
            </code>{" "}
            receiver to see per-process CPU, memory, and ownership here. The
            Documentation tab has a ready-to-paste config snippet.
          </p>
        </div>
      </Card>
    );
  }

  /*
   * Process executables get a small colored avatar so the eye can scan
   * the table by shape, not just by reading the executable name. Colors
   * are deterministic (hash-based) so the same process always gets the
   * same color across refreshes.
   */
  const avatarPalette: Array<{ bg: string; text: string; ring: string }> = [
    { bg: "bg-blue-50", text: "text-blue-700", ring: "ring-blue-200" },
    { bg: "bg-violet-50", text: "text-violet-700", ring: "ring-violet-200" },
    { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
    { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
    { bg: "bg-cyan-50", text: "text-cyan-700", ring: "ring-cyan-200" },
    { bg: "bg-pink-50", text: "text-pink-700", ring: "ring-pink-200" },
    { bg: "bg-indigo-50", text: "text-indigo-700", ring: "ring-indigo-200" },
    { bg: "bg-teal-50", text: "text-teal-700", ring: "ring-teal-200" },
  ];

  const avatarFor: (name: string) => {
    initial: string;
    bg: string;
    text: string;
    ring: string;
  } = (name: string) => {
    const trimmed: string = (name || "?").trim() || "?";
    const initial: string = trimmed.charAt(0).toUpperCase();
    let hash: number = 0;
    for (let i: number = 0; i < trimmed.length; i++) {
      hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
    }
    const slot: { bg: string; text: string; ring: string } =
      avatarPalette[hash % avatarPalette.length]!;
    return {
      initial,
      bg: slot.bg,
      text: slot.text,
      ring: slot.ring,
    };
  };

  /*
   * Color the inline CPU and memory bars by absolute thresholds. CPU
   * percent of an 8-core box can legally hit 800%, but anything past
   * 100% on a single-core perspective is already "this process owns a
   * core" and worth flagging.
   */
  const cpuBarColor: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "bg-gray-300";
    }
    if (value >= 80) {
      return "bg-red-500";
    }
    if (value >= 50) {
      return "bg-amber-500";
    }
    return "bg-blue-500";
  };

  const memBarColor: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "bg-gray-300";
    }
    if (value >= 20) {
      return "bg-red-500";
    }
    if (value >= 10) {
      return "bg-amber-500";
    }
    return "bg-violet-500";
  };

  const cpuValueColor: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "text-gray-400";
    }
    if (value >= 80) {
      return "text-red-700 font-semibold";
    }
    if (value >= 50) {
      return "text-amber-700 font-semibold";
    }
    return "text-gray-900 font-medium";
  };

  return (
    <Card
      title="Processes"
      description={`Latest snapshot of processes on this host (last ${PROCESS_LOOKBACK_MINUTES} minutes), sorted by CPU usage.`}
      rightElement={renderRefreshButton()}
    >
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60">
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Process
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-24 hidden md:table-cell">
                User
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-56">
                <span className="inline-flex items-center gap-1">
                  CPU
                  <svg
                    className="h-3 w-3 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 14l-7 7m0 0l-7-7m7 7V3"
                    />
                  </svg>
                </span>
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider w-56">
                Memory
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row: ProcessRow, index: number): ReactElement => {
              const av: {
                initial: string;
                bg: string;
                text: string;
                ring: string;
              } = avatarFor(row.executable);
              const cpuPct: number = Math.min(
                100,
                Math.max(0, row.cpuPercent ?? 0),
              );
              const memPct: number = Math.min(
                100,
                Math.max(0, row.memoryPercent ?? 0),
              );
              const isTop: boolean = index === 0 && (row.cpuPercent ?? 0) >= 50;

              return (
                <tr
                  key={row.key}
                  className={`group transition-colors ${
                    isTop ? "bg-amber-50/40" : ""
                  } hover:bg-gray-50`}
                >
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${av.bg} ring-1 ring-inset ${av.ring}`}
                      >
                        <span className={`text-sm font-semibold ${av.text}`}>
                          {av.initial}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {row.executable}
                          </span>
                          {row.pid && (
                            <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                              pid {row.pid}
                            </span>
                          )}
                          {isTop && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                              <svg
                                className="h-2.5 w-2.5"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.49 2.927a.5.5 0 011.02 0l1.42 4.063a.5.5 0 00.412.336l4.27.49a.5.5 0 01.286.85l-3.183 2.95a.5.5 0 00-.155.466l.93 4.236a.5.5 0 01-.74.527L10.24 14.6a.5.5 0 00-.48 0l-3.51 2.243a.5.5 0 01-.74-.527l.93-4.236a.5.5 0 00-.156-.466L3.1 8.665a.5.5 0 01.287-.85l4.27-.489a.5.5 0 00.41-.336l1.422-4.063z" />
                              </svg>
                              Top
                            </span>
                          )}
                        </div>
                        {row.command && (
                          <div className="text-xs text-gray-500 font-mono truncate max-w-xl">
                            {row.command}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle hidden md:table-cell">
                    {row.user ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-medium text-gray-700">
                        {row.user}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[80px]">
                        <div
                          className={`h-1.5 rounded-full ${cpuBarColor(row.cpuPercent)} transition-all`}
                          style={{ width: `${cpuPct}%` }}
                        />
                      </div>
                      <span
                        className={`text-sm font-mono tabular-nums w-14 text-right ${cpuValueColor(row.cpuPercent)}`}
                      >
                        {formatPercent(row.cpuPercent)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-[80px]">
                        <div className="text-sm font-mono tabular-nums text-gray-900">
                          {formatBytes(row.memoryBytes)}
                        </div>
                        {row.memoryPercent !== null && (
                          <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-1 rounded-full ${memBarColor(row.memoryPercent)} transition-all`}
                              style={{ width: `${memPct}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <span className="text-xs font-mono tabular-nums text-gray-500 w-12 text-right">
                        {row.memoryPercent !== null
                          ? formatPercent(row.memoryPercent)
                          : "—"}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/40 flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-gray-600">
          <span className="font-medium text-gray-900">{rows.length}</span>{" "}
          process{rows.length === 1 ? "" : "es"}
        </span>
        {renderFreshness()}
      </div>
    </Card>
  );
};

export default HostProcesses;
