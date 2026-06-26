import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import React, {
  Fragment,
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
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Column from "Common/UI/Components/Table/Types/Column";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Search from "Common/Types/BaseDatabase/Search";
import Includes from "Common/Types/BaseDatabase/Includes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

/*
 * Ceph cluster log page (WI-16) — the Kubernetes View/Events.tsx analog.
 * The CephAgent's optional filelog receiver tails /var/log/ceph/ceph.log
 * and ships each line VERBATIM with only ceph.cluster.name stamped, so
 * this page does the parsing client-side. The ceph.log line shape is:
 *
 *   2024-01-15T10:12:01.123456+0000 mon.a (mon.0) 1234 : cluster [INF] overall HEALTH_OK
 *
 * i.e. <timestamp> <daemon> ... : <channel> [<LEVEL>] <message>, with
 * LEVEL one of INF / WRN / ERR (DBG when debug logging is cranked up).
 * Lines that don't match still render — raw body as the message.
 */

interface CephLogRow {
  timestamp: string;
  daemon: string;
  level: string;
  message: string;
}

const PAGE_SIZE: number = 25;

const LEVEL_PATTERN: RegExp = /\[(INF|WRN|ERR|DBG)\]/;
const DATE_ONLY_PATTERN: RegExp = /^\d{4}-\d{2}-\d{2}$/;
const DAEMON_PATTERN: RegExp = /^[a-z]+[.-]/;

const parseCephLogLine: (body: string, fallbackTime: string) => CephLogRow = (
  body: string,
  fallbackTime: string,
): CephLogRow => {
  const line: string = body.trim();

  // Level + message: everything after the [LVL] marker.
  const levelMatch: RegExpExecArray | null = LEVEL_PATTERN.exec(line);
  const level: string = levelMatch?.[1] || "";
  const message: string = levelMatch
    ? line.slice((levelMatch.index || 0) + levelMatch[0].length).trim()
    : line;

  /*
   * Timestamp: the first whitespace token (ISO-ish in modern releases,
   * `YYYY-MM-DD HH:MM:SS.ssssss` split over two tokens in older ones).
   * Fall back to the ingestion time when it doesn't parse.
   */
  const tokens: Array<string> = line.split(/\s+/);
  let timestamp: string = fallbackTime;
  if (tokens[0]) {
    const candidate: string =
      DATE_ONLY_PATTERN.test(tokens[0]) && tokens[1]
        ? `${tokens[0]} ${tokens[1]}`
        : tokens[0];
    const parsed: Date = new Date(candidate);
    if (!isNaN(parsed.getTime())) {
      timestamp = OneUptimeDate.getDateAsLocalFormattedString(parsed);
    }
  }

  // Daemon: the token following the timestamp (mon.a, osd.12, mgr.x…).
  const daemonIndex: number =
    tokens[0] && DATE_ONLY_PATTERN.test(tokens[0]) && tokens[1] ? 2 : 1;
  const daemonToken: string = tokens[daemonIndex] || "";
  const daemon: string = DAEMON_PATTERN.test(daemonToken) ? daemonToken : "";

  return {
    timestamp: timestamp,
    daemon: daemon || "—",
    level: level || "Unknown",
    message: message,
  };
};

const CephClusterClusterLog: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rows, setRows] = useState<Array<CephLogRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Descending);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [filterData, setFilterData] = useState<FilterData<CephLogRow>>({});

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const cluster: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!cluster?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logQueryOptions: any = {
        modelType: Log,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.ceph.cluster.name": cluster.name,
          },
        },
        limit: 500,
        skip: 0,
        select: {
          time: true,
          body: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const listResult: ListResult<Log> =
        await AnalyticsModelAPI.getList<Log>(logQueryOptions);

      const parsed: Array<CephLogRow> = [];
      for (const log of listResult.data) {
        const body: string =
          typeof log.body === "string" ? log.body : String(log.body ?? "");
        if (!body.trim()) {
          continue;
        }
        parsed.push(
          parseCephLogLine(
            body,
            log.time
              ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
              : "",
          ),
        );
      }

      setRows(parsed);
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

  const filters: Array<Filter<CephLogRow>> = useMemo(() => {
    const levels: Array<string> = Array.from(
      new Set(
        rows.map((r: CephLogRow) => {
          return r.level;
        }),
      ),
    ).sort();

    const daemons: Array<string> = Array.from(
      new Set(
        rows
          .map((r: CephLogRow) => {
            return r.daemon;
          })
          .filter((d: string) => {
            return Boolean(d) && d !== "—";
          }),
      ),
    ).sort();

    return [
      {
        title: "Level",
        key: "level",
        type: FieldType.Dropdown,
        filterDropdownOptions: levels.map((l: string) => {
          return { label: l, value: l };
        }),
      },
      {
        title: "Daemon",
        key: "daemon",
        type: FieldType.Dropdown,
        filterDropdownOptions: daemons.map((d: string) => {
          return { label: d, value: d };
        }),
      },
      {
        title: "Message",
        key: "message",
        type: FieldType.Text,
      },
    ];
  }, [rows]);

  const processedData: Array<CephLogRow> = useMemo(() => {
    let data: Array<CephLogRow> = [...rows];

    for (const key of Object.keys(filterData) as Array<keyof CephLogRow>) {
      const value: unknown = filterData[key];
      if (!value) {
        continue;
      }

      if (value instanceof Search) {
        const searchText: string = value.toString().toLowerCase();
        data = data.filter((r: CephLogRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue.toLowerCase().includes(searchText);
        });
      } else if (value instanceof Includes) {
        const includeValues: Array<string> = value.values as Array<string>;
        data = data.filter((r: CephLogRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      } else if (typeof value === "string") {
        data = data.filter((r: CephLogRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue === value;
        });
      } else if (Array.isArray(value)) {
        const includeValues: Array<string> = value.map((v: unknown) => {
          return String(v);
        });
        data = data.filter((r: CephLogRow) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      }
    }

    if (sortBy) {
      data.sort((a: CephLogRow, b: CephLogRow) => {
        const aVal: string = (a[sortBy as keyof CephLogRow] as string) || "";
        const bVal: string = (b[sortBy as keyof CephLogRow] as string) || "";
        const cmp: number = aVal.localeCompare(bVal);
        return sortOrder === SortOrder.Descending ? -cmp : cmp;
      });
    }

    return data;
  }, [rows, filterData, sortBy, sortOrder]);

  const paginatedData: Array<CephLogRow> = useMemo(() => {
    const start: number = (currentPage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, currentPage]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  const tableColumns: Array<Column<CephLogRow>> = [
    {
      title: "Time",
      type: FieldType.Element,
      key: "timestamp",
      getElement: (row: CephLogRow): ReactElement => {
        return (
          <span className="text-sm text-gray-500 whitespace-nowrap">
            {row.timestamp}
          </span>
        );
      },
    },
    {
      title: "Level",
      type: FieldType.Element,
      key: "level",
      getElement: (row: CephLogRow): ReactElement => {
        const badgeClass: string =
          row.level === "ERR"
            ? "bg-red-50 text-red-700"
            : row.level === "WRN"
              ? "bg-yellow-50 text-yellow-700"
              : row.level === "INF"
                ? "bg-green-50 text-green-700"
                : "bg-gray-50 text-gray-700";
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${badgeClass}`}
          >
            {row.level}
          </span>
        );
      },
    },
    {
      title: "Daemon",
      type: FieldType.Element,
      key: "daemon",
      getElement: (row: CephLogRow): ReactElement => {
        return <span className="font-medium text-gray-900">{row.daemon}</span>;
      },
    },
    {
      title: "Message",
      type: FieldType.Element,
      key: "message",
      disableSort: true,
      getElement: (row: CephLogRow): ReactElement => {
        return (
          <span className="text-sm text-gray-600 font-mono break-all">
            {row.message}
          </span>
        );
      },
    },
  ];

  const hasActiveFilters: boolean = Object.keys(filterData).length > 0;

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
    {
      title: "",
      buttonStyle: ButtonStyleType.ICON,
      className: "py-0 pr-0 pl-1 mt-1",
      onClick: () => {
        setShowFilterModal(true);
      },
      icon: IconProp.Filter,
    },
  ];

  return (
    <Fragment>
      {rows.length === 0 && !hasActiveFilters && (
        <div className="mb-5 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex-shrink-0 mt-0.5">
            <Icon icon={IconProp.Info} className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-800">
              Cluster Log Shipping Is Optional
            </p>
            <p className="mt-1 text-sm text-blue-600">
              No ceph.log lines arrived in the last 24 hours. To populate this
              page, uncomment the{" "}
              <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
                filelog
              </code>{" "}
              receiver and the logs pipeline in the Ceph agent&apos;s{" "}
              <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
                otel-collector-config.yaml
              </code>{" "}
              (the agent host must be able to read{" "}
              <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
                /var/log/ceph/ceph.log
              </code>
              ).
            </p>
          </div>
        </div>
      )}
      <Card
        title="Cluster Log"
        description="ceph.log lines from the last 24 hours, parsed into level / daemon / message."
        buttons={cardButtons}
      >
        <Table<CephLogRow>
          id="ceph-cluster-log-table"
          columns={tableColumns}
          data={paginatedData}
          singularLabel="Log Line"
          pluralLabel="Log Lines"
          isLoading={false}
          error=""
          currentPageNumber={currentPage}
          totalItemsCount={processedData.length}
          itemsOnPage={paginatedData.length}
          onNavigateToPage={(page: number) => {
            setCurrentPage(page);
          }}
          sortBy={sortBy as keyof CephLogRow | null}
          sortOrder={sortOrder}
          onSortChanged={(
            newSortBy: keyof CephLogRow | null,
            newSortOrder: SortOrder,
          ) => {
            setSortBy(newSortBy as string | null);
            setSortOrder(newSortOrder);
          }}
          filters={filters}
          showFilterModal={showFilterModal}
          filterData={filterData}
          onFilterChanged={(newFilterData: FilterData<CephLogRow>) => {
            setFilterData(newFilterData);
            setCurrentPage(1);
          }}
          onFilterModalOpen={() => {
            setShowFilterModal(true);
          }}
          onFilterModalClose={() => {
            setShowFilterModal(false);
          }}
          noItemsMessage={
            hasActiveFilters
              ? "No log lines match the current filters."
              : "No ceph.log lines found in the last 24 hours."
          }
        />
      </Card>
    </Fragment>
  );
};

export default CephClusterClusterLog;
