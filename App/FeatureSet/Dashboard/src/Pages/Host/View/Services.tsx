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
import {
  ErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
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
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import FilterChipDropdown, {
  FilterChipDropdownOption,
} from "../../../Components/ResourceOwners/FilterChipDropdown";
import {
  WINDOWS_SERVICE_METRIC_NAME,
  SERVICE_NAME_ATTR,
  SERVICE_STARTUP_MODE_ATTR,
  ServiceStatusMeta,
  statusMeta,
  startupModeLabel,
  encodeServiceNameForUrl,
} from "../Utils/WindowsServices";

interface ServiceRow {
  key: string;
  name: string;
  statusCode: number | null;
  statusLabel: string;
  startupMode: string | null;
  startupLabel: string;
}

/*
 * Like processes, service status is a point-in-time sample re-emitted on
 * every collector scrape (30s in the OneUptime config). A 15-minute window
 * shows the latest state of every service without surfacing stale ghosts
 * from services that were removed a while ago. Refresh re-queries.
 */
const SERVICE_LOOKBACK_MINUTES: number = 15;

const PAGE_SIZE: number = 25;

const HostServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<ServiceRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [latestSampleAt, setLatestSampleAt] = useState<Date | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const [searchText, setSearchText] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Array<string>>([]);
  const [startupFilter, setStartupFilter] = useState<Array<string>>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<keyof ServiceRow | null>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);

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
          osType: true,
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
        -SERVICE_LOOKBACK_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: WINDOWS_SERVICE_METRIC_NAME,
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

      const result: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(query);

      const byKey: Map<string, ServiceRow> = new Map();
      let newestSample: Date | null = null;

      // Datapoints arrive newest-first; the first row per service wins.
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
        const name: string =
          (attrs[SERVICE_NAME_ATTR] as string | undefined) || "";
        if (!name) {
          continue;
        }
        if (byKey.has(name)) {
          // Already captured the most recent sample for this service.
          continue;
        }

        const statusCode: number | null =
          m.value === undefined || m.value === null ? null : Number(m.value);
        const startupMode: string | null =
          (attrs[SERVICE_STARTUP_MODE_ATTR] as string | undefined) || null;

        byKey.set(name, {
          key: name,
          name,
          statusCode,
          statusLabel: statusMeta(statusCode).label,
          startupMode,
          startupLabel: startupModeLabel(startupMode),
        });
      }

      setRows(Array.from(byKey.values()));
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

  const serviceViewRouteFor: (row: ServiceRow) => Route | null = (
    row: ServiceRow,
  ): Route | null => {
    /*
     * Browsers resolve "." and ".." path segments (even percent-encoded)
     * before the router sees them, so a service with one of those names
     * would silently navigate to the wrong page. Leave such rows unlinked.
     */
    if (row.name === "." || row.name === "..") {
      return null;
    }
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_SERVICE_VIEW] as Route,
      {
        modelId: modelId,
        subModelId: encodeServiceNameForUrl(row.name),
      },
    );
  };

  // Facet options are built from the data so they always reflect this host.
  const statusOptions: Array<FilterChipDropdownOption> = useMemo(() => {
    const counts: Map<string, { count: number; hex: string }> = new Map();
    for (const row of rows) {
      const existing: { count: number; hex: string } | undefined = counts.get(
        row.statusLabel,
      );
      if (existing) {
        existing.count++;
      } else {
        counts.set(row.statusLabel, {
          count: 1,
          hex: statusMeta(row.statusCode).hex,
        });
      }
    }
    return Array.from(counts.entries())
      .sort(
        (
          a: [string, { count: number; hex: string }],
          b: [string, { count: number; hex: string }],
        ) => {
          return a[0].localeCompare(b[0]);
        },
      )
      .map(([label, info]: [string, { count: number; hex: string }]) => {
        return {
          value: label,
          label: label,
          sublabel: `${info.count} service${info.count === 1 ? "" : "s"}`,
          color: info.hex,
        };
      });
  }, [rows]);

  const startupOptions: Array<FilterChipDropdownOption> = useMemo(() => {
    const counts: Map<string, number> = new Map();
    for (const row of rows) {
      counts.set(row.startupLabel, (counts.get(row.startupLabel) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a: [string, number], b: [string, number]) => {
        return a[0].localeCompare(b[0]);
      })
      .map(([label, count]: [string, number]) => {
        return {
          value: label,
          label: label,
          sublabel: `${count} service${count === 1 ? "" : "s"}`,
        };
      });
  }, [rows]);

  // Search + facet filters + sort, all client-side over the snapshot.
  const processedData: Array<ServiceRow> = useMemo(() => {
    let data: Array<ServiceRow> = [...rows];

    const search: string = searchText.trim().toLowerCase();
    if (search) {
      data = data.filter((row: ServiceRow) => {
        return row.name.toLowerCase().includes(search);
      });
    }

    if (statusFilter.length > 0) {
      data = data.filter((row: ServiceRow) => {
        return statusFilter.includes(row.statusLabel);
      });
    }

    if (startupFilter.length > 0) {
      data = data.filter((row: ServiceRow) => {
        return startupFilter.includes(row.startupLabel);
      });
    }

    const sortKey: keyof ServiceRow = sortBy || "name";
    data.sort((a: ServiceRow, b: ServiceRow) => {
      const aVal: string =
        sortKey === "statusCode"
          ? a.statusLabel
          : sortKey === "startupMode"
            ? a.startupLabel
            : a.name;
      const bVal: string =
        sortKey === "statusCode"
          ? b.statusLabel
          : sortKey === "startupMode"
            ? b.startupLabel
            : b.name;
      const cmp: number = aVal.localeCompare(bVal, undefined, {
        sensitivity: "base",
      });
      // Tie-break on name so ordering is stable within a status/startup group.
      const withTieBreak: number =
        cmp !== 0
          ? cmp
          : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return sortOrder === SortOrder.Descending ? -withTieBreak : withTieBreak;
    });

    return data;
  }, [rows, searchText, statusFilter, startupFilter, sortBy, sortOrder]);

  /*
   * A refresh can shrink the data set (services age out of the 15-minute
   * window), so clamp instead of trusting currentPage — otherwise the
   * user is stranded on a page past the end, staring at an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(processedData.length / PAGE_SIZE),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);

  const paginatedData: Array<ServiceRow> = useMemo(() => {
    const start: number = (effectivePage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, effectivePage]);

  const hasActiveFilters: boolean =
    searchText.trim() !== "" ||
    statusFilter.length > 0 ||
    startupFilter.length > 0;

  const tableColumns: Array<Column<ServiceRow>> = useMemo(() => {
    return [
      {
        title: "Service",
        type: FieldType.Element,
        key: "name",
        getElement: (row: ServiceRow): ReactElement => {
          const route: Route | null = serviceViewRouteFor(row);
          if (!route) {
            return (
              <span className="text-sm font-medium text-gray-900 truncate">
                {row.name}
              </span>
            );
          }
          return (
            <Link
              to={route}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate"
            >
              {row.name}
            </Link>
          );
        },
      },
      {
        title: "Startup",
        type: FieldType.Element,
        key: "startupMode",
        hideOnMobile: true,
        getElement: (row: ServiceRow): ReactElement => {
          return (
            <span className="text-sm text-gray-600">{row.startupLabel}</span>
          );
        },
      },
      {
        title: "Status",
        type: FieldType.Element,
        key: "statusCode",
        getElement: (row: ServiceRow): ReactElement => {
          const meta: ServiceStatusMeta = statusMeta(row.statusCode);
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${meta.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          );
        },
      },
      {
        title: "",
        type: FieldType.Actions,
        key: null,
        disableSort: true,
      },
    ];
  }, [modelId]);

  const actionButtons: Array<ActionButtonSchema<ServiceRow>> = [
    {
      title: "View",
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (row: ServiceRow): boolean => {
        return serviceViewRouteFor(row) !== null;
      },
      onClick: (
        row: ServiceRow,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          const route: Route | null = serviceViewRouteFor(row);
          if (route) {
            Navigation.navigate(route);
          }
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    },
  ];

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
      `Windows services on this host (last ${SERVICE_LOOKBACK_MINUTES} minutes).`,
    ];
    if (latestSampleAt) {
      parts.push(`Latest sample ${OneUptimeDate.fromNow(latestSampleAt)}.`);
    }
    if (refreshedAt) {
      parts.push(`Refreshed ${OneUptimeDate.fromNow(refreshedAt)}.`);
    }
    return <span>{parts.join(" ")}</span>;
  })();

  const clearFilters: VoidFunction = (): void => {
    setSearchText("");
    setStatusFilter([]);
    setStartupFilter([]);
    setCurrentPage(1);
  };

  const toMultiSelectValue: (
    value: string | Array<string> | null,
  ) => Array<string> = (
    value: string | Array<string> | null,
  ): Array<string> => {
    if (value === null) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  };

  const filterBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
      <div className="relative w-full sm:w-64">
        <Icon
          icon={IconProp.Search}
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={searchText}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setSearchText(e.target.value);
            setCurrentPage(1);
          }}
          placeholder="Search services..."
          className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
      <span
        aria-hidden="true"
        className="hidden h-5 w-px bg-gray-200 sm:inline-block"
      />
      <FilterChipDropdown
        label="Status"
        emptyIcon={IconProp.Bolt}
        options={statusOptions}
        isMultiSelect={true}
        value={statusFilter}
        supportedOperators={["is"]}
        onChange={(value: string | Array<string> | null) => {
          setStatusFilter(toMultiSelectValue(value));
          setCurrentPage(1);
        }}
      />
      <FilterChipDropdown
        label="Startup"
        emptyIcon={IconProp.Cog}
        options={startupOptions}
        isMultiSelect={true}
        value={startupFilter}
        supportedOperators={["is"]}
        onChange={(value: string | Array<string> | null) => {
          setStartupFilter(toMultiSelectValue(value));
          setCurrentPage(1);
        }}
      />
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
        >
          Clear filters
        </button>
      )}
      <span className="ml-auto text-xs text-gray-500">
        {hasActiveFilters
          ? `${processedData.length} of ${rows.length} services`
          : `${rows.length} service${rows.length === 1 ? "" : "s"}`}
      </span>
    </div>
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  /*
   * Blame the filters only when there is data they filtered out — when
   * the fetch itself came back empty, the collector guidance is the
   * actionable message no matter what filters are set.
   */
  const noItemsMessage: string =
    rows.length === 0
      ? `No Windows service metrics in the last ${SERVICE_LOOKBACK_MINUTES} minutes. Service status comes from the "windows_service" receiver (alpha, Windows-only), which is bundled in the upstream otelcol-contrib build from v0.155.0. Make sure the host runs otelcol-contrib v0.155.0+ with windows_service added to the metrics pipeline — see the Documentation tab for setup steps.`
      : "No services match the current filters.";

  return (
    <Card
      title="Windows Services"
      description={description}
      buttons={cardButtons}
    >
      <div>
        {(rows.length > 0 || hasActiveFilters) && filterBar}
        <Table<ServiceRow>
          id="host-services-table"
          columns={tableColumns}
          actionButtons={actionButtons}
          data={paginatedData}
          singularLabel="Service"
          pluralLabel="Services"
          isLoading={false}
          error=""
          currentPageNumber={effectivePage}
          totalItemsCount={processedData.length}
          itemsOnPage={PAGE_SIZE}
          onNavigateToPage={(page: number) => {
            setCurrentPage(page);
          }}
          sortOrder={sortOrder}
          sortBy={sortBy}
          onSortChanged={(
            newSortBy: keyof ServiceRow | null,
            newSortOrder: SortOrder,
          ) => {
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
            setCurrentPage(1);
          }}
          noItemsMessage={noItemsMessage}
        />
      </div>
    </Card>
  );
};

export default HostServices;
