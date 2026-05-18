import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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
import Table from "Common/UI/Components/Table/Table";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

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

/*
 * The OTel hostmetrics `process` scraper attaches per-process identity
 * (pid, executable name, command, owner) to the *resource*, not the
 * datapoint. OneUptime's metric ingest prefixes resource attributes with
 * `resource.`, so they land in ClickHouse as `resource.process.*` —
 * matching the convention Docker container pages already use for their
 * resource attributes (`resource.container.name`, etc).
 */
const PROCESS_PID_ATTR: string = "resource.process.pid";
const PROCESS_NAME_ATTR: string = "resource.process.executable.name";
const PROCESS_COMMAND_ATTR: string = "resource.process.command";
const PROCESS_OWNER_ATTR: string = "resource.process.owner";

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
          totalMemoryBytes: true,
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

      /*
       * We derive memory % client-side from `process.memory.usage`
       * (RSS bytes) and `host.totalMemoryBytes` instead of trusting
       * `process.memory.utilization`. Windows OTel emits that metric
       * in percent (0–100) while the spec — and Linux —  emits it as
       * a fraction (0–1), so a single `* 100` scaling can't be right
       * for both. The usage / total ratio is OS-agnostic and stays
       * consistent with the bytes column the user sees alongside.
       */
      const [cpuResult, memBytesResult]: [
        ListResult<Metric>,
        ListResult<Metric>,
      ] = await Promise.all([
        AnalyticsModelAPI.getList<Metric>(
          buildQuery("process.cpu.utilization"),
        ),
        AnalyticsModelAPI.getList<Metric>(buildQuery("process.memory.usage")),
      ]);

      const totalMemoryBytes: number | null =
        item.totalMemoryBytes !== undefined && item.totalMemoryBytes !== null
          ? Number(item.totalMemoryBytes)
          : null;

      const byKey: Map<string, ProcessRow> = new Map();
      let newestSample: Date | null = null;

      const upsert: (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes",
      ) => void = (
        result: ListResult<Metric>,
        field: "cpuPercent" | "memoryBytes",
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
          } else {
            row.memoryBytes = Number(m.value);
          }
        }
      };

      upsert(cpuResult, "cpuPercent");
      upsert(memBytesResult, "memoryBytes");

      if (totalMemoryBytes !== null && totalMemoryBytes > 0) {
        for (const row of byKey.values()) {
          if (row.memoryBytes !== null) {
            row.memoryPercent = (row.memoryBytes / totalMemoryBytes) * 100;
          }
        }
      }

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
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const tableColumns: Array<Column<ProcessRow>> = useMemo(() => {
    return [
      {
        title: "Process",
        type: FieldType.Element,
        key: "executable",
        disableSort: true,
        getElement: (row: ProcessRow): ReactElement => {
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900 truncate">
                  {row.executable}
                </span>
                {row.pid && (
                  <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                    pid {row.pid}
                  </span>
                )}
              </div>
              {row.command && (
                <div className="text-xs text-gray-500 font-mono truncate max-w-xl">
                  {row.command}
                </div>
              )}
            </div>
          );
        },
      },
      {
        title: "User",
        type: FieldType.Text,
        key: "user",
        disableSort: true,
        hideOnMobile: true,
      },
      {
        title: "CPU",
        type: FieldType.Element,
        key: "cpuPercent",
        disableSort: true,
        getElement: (row: ProcessRow): ReactElement => {
          const pct: number = Math.min(100, Math.max(0, row.cpuPercent ?? 0));
          return (
            <div className="flex items-center gap-3 min-w-[140px]">
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-1.5 rounded-full ${cpuBarColor(row.cpuPercent)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm font-mono tabular-nums text-gray-900 w-14 text-right">
                {formatPercent(row.cpuPercent)}
              </span>
            </div>
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryBytes",
        disableSort: true,
        getElement: (row: ProcessRow): ReactElement => {
          const pct: number = Math.min(
            100,
            Math.max(0, row.memoryPercent ?? 0),
          );
          return (
            <div className="flex items-center gap-3 min-w-[160px]">
              <div className="flex-1">
                <div className="text-sm font-mono tabular-nums text-gray-900">
                  {formatBytes(row.memoryBytes)}
                </div>
                {row.memoryPercent !== null && (
                  <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-1 rounded-full ${memBarColor(row.memoryPercent)}`}
                      style={{ width: `${pct}%` }}
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
          );
        },
      },
    ];
  }, []);

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        fetchData().catch(() => {});
      },
      icon: IconProp.Refresh,
    },
  ];

  const description: ReactElement = (() => {
    const parts: Array<string> = [
      `Latest snapshot of processes on this host (last ${PROCESS_LOOKBACK_MINUTES} minutes), sorted by CPU usage.`,
    ];
    if (latestSampleAt) {
      parts.push(`Latest sample ${OneUptimeDate.fromNow(latestSampleAt)}.`);
    }
    if (refreshedAt) {
      parts.push(`Refreshed ${OneUptimeDate.fromNow(refreshedAt)}.`);
    }
    return <span>{parts.join(" ")}</span>;
  })();

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const noItemsMessage: string = `No process metrics in the last ${PROCESS_LOOKBACK_MINUTES} minutes. Enable the "process" scraper in your OTel collector "hostmetrics" receiver to see per-process CPU, memory, and ownership here. The Documentation tab has a ready-to-paste config snippet.`;

  return (
    <Card title="Processes" description={description} buttons={cardButtons}>
      <Table<ProcessRow>
        id="host-processes-table"
        columns={tableColumns}
        data={rows}
        singularLabel="Process"
        pluralLabel="Processes"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={rows.length}
        itemsOnPage={rows.length}
        onNavigateToPage={() => {}}
        sortOrder={SortOrder.Ascending}
        sortBy={null}
        onSortChanged={() => {}}
        noItemsMessage={noItemsMessage}
      />
    </Card>
  );
};

export default HostProcesses;
