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
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">
            No process metrics in the last 5 minutes
          </p>
          <p className="text-xs text-gray-500">
            Enable the <code>process</code> scraper in your OTel collector
            <code> hostmetrics </code> receiver to populate this view. See the
            Documentation tab for a config snippet.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Processes"
      description="Latest snapshot of processes on this host (last 5 minutes), sorted by CPU usage."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                PID
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Executable
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                CPU
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Memory
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Memory %
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {rows.map((row: ProcessRow): ReactElement => {
              return (
                <tr key={row.key}>
                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                    {row.pid || "—"}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900">
                    <div className="font-medium">{row.executable}</div>
                    {row.command && (
                      <div className="text-xs text-gray-500 truncate max-w-md">
                        {row.command}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    {row.user || "—"}
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-gray-900">
                    {formatPercent(row.cpuPercent)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-gray-900">
                    {formatBytes(row.memoryBytes)}
                  </td>
                  <td className="px-4 py-2 text-sm text-right font-mono text-gray-900">
                    {formatPercent(row.memoryPercent)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export default HostProcesses;
