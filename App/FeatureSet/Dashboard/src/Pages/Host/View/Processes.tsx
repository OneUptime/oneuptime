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

const HostProcesses: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<ProcessRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);
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

      const upsert: (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes" | "memoryPercent",
      ) => void = (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes" | "memoryPercent",
      ): void => {
        for (const m of result.data) {
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
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
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

  if (rows.length === 0) {
    return (
      <Card
        title="Processes"
        description="Per-process CPU, memory, and ownership data from the OTel `process` scraper."
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
            No process metrics yet
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
            receiver to see per-process CPU, memory, and ownership here. The{" "}
            Documentation tab has a ready-to-paste config snippet.
          </p>
        </div>
      </Card>
    );
  }

  const cpuClass: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "text-gray-400";
    }
    if (value >= 80) {
      return "text-red-600 font-semibold";
    }
    if (value >= 50) {
      return "text-amber-600 font-medium";
    }
    return "text-gray-900";
  };

  const memClass: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null) {
      return "text-gray-400";
    }
    if (value >= 20) {
      return "text-red-600 font-semibold";
    }
    if (value >= 10) {
      return "text-amber-600 font-medium";
    }
    return "text-gray-900";
  };

  return (
    <Card
      title="Processes"
      description="Latest snapshot of processes on this host (last 5 minutes), sorted by CPU usage."
    >
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                PID
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Executable
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                CPU
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Memory
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                Memory %
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {rows.map((row: ProcessRow): ReactElement => {
              return (
                <tr
                  key={row.key}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-2.5 text-sm text-gray-700 font-mono whitespace-nowrap align-top">
                    {row.pid || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm align-top">
                    <div className="font-medium text-gray-900 truncate max-w-xs">
                      {row.executable}
                    </div>
                    {row.command && (
                      <div className="text-xs text-gray-500 font-mono truncate max-w-md">
                        {row.command}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm align-top">
                    {row.user ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 text-xs font-medium text-gray-700">
                        {row.user}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-sm text-right font-mono whitespace-nowrap align-top ${cpuClass(row.cpuPercent)}`}
                  >
                    {formatPercent(row.cpuPercent)}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right font-mono text-gray-900 whitespace-nowrap align-top">
                    {formatBytes(row.memoryBytes)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-sm text-right font-mono whitespace-nowrap align-top ${memClass(row.memoryPercent)}`}
                  >
                    {formatPercent(row.memoryPercent)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 text-xs text-gray-500 border-t border-gray-100 bg-gray-50/50">
        {rows.length} process{rows.length === 1 ? "" : "es"} · refreshes when
        you reload the page
      </div>
    </Card>
  );
};

export default HostProcesses;
