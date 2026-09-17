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
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
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
  HOST_NAME_ATTR,
  MIN_OTELCOL_CONTRIB_VERSION,
  SYSTEMD_UNIT_STATE_METRIC_NAME,
  SystemdMetricDatapoint,
  SystemdStateMeta,
  SystemdUnitRollup,
  SystemdUnitRow,
  activeStateMeta,
  buildSystemdUnitRows,
  encodeUnitNameForUrl,
  hasSingleSampleTimestamp,
} from "../Utils/SystemdUnits";

/*
 * Like processes and Windows services, unit state is a point-in-time sample
 * re-emitted on every collector scrape (30s in the OneUptime config). A
 * 15-minute window shows the latest state of every unit without surfacing
 * stale ghosts from units that were removed a while ago, and is wide enough
 * to still hold a scrape when the interval has been slowed down. Refresh
 * re-queries.
 */
const UNIT_LOOKBACK_MINUTES: number = 15;

/*
 * `systemd.unit.state` is a state set — every scrape emits one datapoint per
 * possible state per unit — so the query drops the zero-valued rows
 * server-side and only the asserted state of each unit comes back. That is
 * ~8x fewer rows; the cap is what is left over for hosts tracking a very
 * large `units:` set.
 */
const UNIT_FETCH_LIMIT: number = 5000;

const PAGE_SIZE: number = 25;

const HostSystemdUnits: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<Host | null>(null);
  const [rows, setRows] = useState<Array<SystemdUnitRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [latestSampleAt, setLatestSampleAt] = useState<Date | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  /*
   * True only when the fetch cap could actually have hidden units: it took
   * the full limit and every row it returned shares one timestamp, meaning
   * the newest scrape itself was cut off mid-way.
   */
  const [isSnapshotTruncated, setIsSnapshotTruncated] =
    useState<boolean>(false);

  const [searchText, setSearchText] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<Array<string>>([]);
  const [unitTypeFilter, setUnitTypeFilter] = useState<Array<string>>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<keyof SystemdUnitRow | null>("name");
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
        -UNIT_LOOKBACK_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: SYSTEMD_UNIT_STATE_METRIC_NAME,
          time: new InBetween<Date>(startDate, endDate),
          // Keep only the asserted state of each unit; drop the zeros.
          value: new GreaterThan<number>(0),
          attributes: {
            [HOST_NAME_ATTR]: item.hostIdentifier,
          },
        },
        limit: UNIT_FETCH_LIMIT,
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

      const datapoints: Array<SystemdMetricDatapoint> = result.data.map(
        (metric: Metric): SystemdMetricDatapoint => {
          return {
            time: metric.time as Date | undefined,
            value: metric.value as number | undefined,
            attributes: (metric.attributes as Record<string, unknown>) || {},
          };
        },
      );

      const rollup: SystemdUnitRollup = buildSystemdUnitRows(datapoints);

      setRows(rollup.rows);
      setLatestSampleAt(rollup.latestSampleAt);
      setIsSnapshotTruncated(
        result.data.length >= UNIT_FETCH_LIMIT &&
          hasSingleSampleTimestamp(datapoints),
      );
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

  const unitViewRouteFor: (row: SystemdUnitRow) => Route | null = (
    row: SystemdUnitRow,
  ): Route | null => {
    /*
     * Browsers resolve "." and ".." path segments (even percent-encoded)
     * before the router sees them, so a unit with one of those names
     * would silently navigate to the wrong page. Leave such rows unlinked.
     */
    if (row.name === "." || row.name === "..") {
      return null;
    }
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_SYSTEMD_UNIT_VIEW] as Route,
      {
        modelId: modelId,
        subModelId: encodeUnitNameForUrl(row.name),
      },
    );
  };

  // Facet options are built from the data so they always reflect this host.
  const stateOptions: Array<FilterChipDropdownOption> = useMemo(() => {
    const counts: Map<string, { count: number; hex: string }> = new Map();
    for (const row of rows) {
      const existing: { count: number; hex: string } | undefined = counts.get(
        row.stateLabel,
      );
      if (existing) {
        existing.count++;
      } else {
        counts.set(row.stateLabel, {
          count: 1,
          hex: activeStateMeta(row.activeState).hex,
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
          sublabel: `${info.count} unit${info.count === 1 ? "" : "s"}`,
          color: info.hex,
        };
      });
  }, [rows]);

  const unitTypeOptions: Array<FilterChipDropdownOption> = useMemo(() => {
    const counts: Map<string, number> = new Map();
    for (const row of rows) {
      counts.set(row.unitTypeLabel, (counts.get(row.unitTypeLabel) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a: [string, number], b: [string, number]) => {
        return a[0].localeCompare(b[0]);
      })
      .map(([label, count]: [string, number]) => {
        return {
          value: label,
          label: label,
          sublabel: `${count} unit${count === 1 ? "" : "s"}`,
        };
      });
  }, [rows]);

  // Search + facet filters + sort, all client-side over the snapshot.
  const processedData: Array<SystemdUnitRow> = useMemo(() => {
    let data: Array<SystemdUnitRow> = [...rows];

    const search: string = searchText.trim().toLowerCase();
    if (search) {
      data = data.filter((row: SystemdUnitRow) => {
        return row.name.toLowerCase().includes(search);
      });
    }

    if (stateFilter.length > 0) {
      data = data.filter((row: SystemdUnitRow) => {
        return stateFilter.includes(row.stateLabel);
      });
    }

    if (unitTypeFilter.length > 0) {
      data = data.filter((row: SystemdUnitRow) => {
        return unitTypeFilter.includes(row.unitTypeLabel);
      });
    }

    const sortKey: keyof SystemdUnitRow = sortBy || "name";
    data.sort((a: SystemdUnitRow, b: SystemdUnitRow) => {
      const aVal: string =
        sortKey === "activeState"
          ? a.stateLabel
          : sortKey === "unitType"
            ? a.unitTypeLabel
            : a.name;
      const bVal: string =
        sortKey === "activeState"
          ? b.stateLabel
          : sortKey === "unitType"
            ? b.unitTypeLabel
            : b.name;
      const cmp: number = aVal.localeCompare(bVal, undefined, {
        sensitivity: "base",
      });
      // Tie-break on name so ordering is stable within a state/type group.
      const withTieBreak: number =
        cmp !== 0
          ? cmp
          : a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return sortOrder === SortOrder.Descending ? -withTieBreak : withTieBreak;
    });

    return data;
  }, [rows, searchText, stateFilter, unitTypeFilter, sortBy, sortOrder]);

  /*
   * A refresh can shrink the data set (units age out of the 15-minute
   * window), so clamp instead of trusting currentPage — otherwise the
   * user is stranded on a page past the end, staring at an empty table.
   */
  const totalPages: number = Math.max(
    1,
    Math.ceil(processedData.length / PAGE_SIZE),
  );
  const effectivePage: number = Math.min(currentPage, totalPages);

  const paginatedData: Array<SystemdUnitRow> = useMemo(() => {
    const start: number = (effectivePage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, effectivePage]);

  const hasActiveFilters: boolean =
    searchText.trim() !== "" ||
    stateFilter.length > 0 ||
    unitTypeFilter.length > 0;

  const tableColumns: Array<Column<SystemdUnitRow>> = useMemo(() => {
    return [
      {
        title: "Unit",
        type: FieldType.Element,
        key: "name",
        getElement: (row: SystemdUnitRow): ReactElement => {
          const route: Route | null = unitViewRouteFor(row);
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
        title: "Type",
        type: FieldType.Element,
        key: "unitType",
        hideOnMobile: true,
        getElement: (row: SystemdUnitRow): ReactElement => {
          return (
            <span className="text-sm text-gray-600">{row.unitTypeLabel}</span>
          );
        },
      },
      {
        title: "State",
        type: FieldType.Element,
        key: "activeState",
        getElement: (row: SystemdUnitRow): ReactElement => {
          const meta: SystemdStateMeta = activeStateMeta(row.activeState);
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

  const actionButtons: Array<ActionButtonSchema<SystemdUnitRow>> = [
    {
      title: "View",
      buttonStyleType: ButtonStyleType.NORMAL,
      isVisible: (row: SystemdUnitRow): boolean => {
        return unitViewRouteFor(row) !== null;
      },
      onClick: (
        row: SystemdUnitRow,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          const route: Route | null = unitViewRouteFor(row);
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
      `Systemd units on this host (last ${UNIT_LOOKBACK_MINUTES} minutes).`,
    ];
    if (latestSampleAt) {
      parts.push(`Latest sample ${OneUptimeDate.fromNow(latestSampleAt)}.`);
    }
    if (refreshedAt) {
      parts.push(`Refreshed ${OneUptimeDate.fromNow(refreshedAt)}.`);
    }
    if (isSnapshotTruncated) {
      parts.push(
        `This host reports more than ${UNIT_FETCH_LIMIT} units per scrape, so some are not listed — narrow the receiver's "units" patterns to see a complete list.`,
      );
    }
    return <span>{parts.join(" ")}</span>;
  })();

  const clearFilters: VoidFunction = (): void => {
    setSearchText("");
    setStateFilter([]);
    setUnitTypeFilter([]);
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
          placeholder="Search units..."
          className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-7 pr-2 text-sm placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      </div>
      <span
        aria-hidden="true"
        className="hidden h-5 w-px bg-gray-200 sm:inline-block"
      />
      <FilterChipDropdown
        label="State"
        emptyIcon={IconProp.Bolt}
        options={stateOptions}
        isMultiSelect={true}
        value={stateFilter}
        supportedOperators={["is"]}
        onChange={(value: string | Array<string> | null) => {
          setStateFilter(toMultiSelectValue(value));
          setCurrentPage(1);
        }}
      />
      <FilterChipDropdown
        label="Type"
        emptyIcon={IconProp.Cog}
        options={unitTypeOptions}
        isMultiSelect={true}
        value={unitTypeFilter}
        supportedOperators={["is"]}
        onChange={(value: string | Array<string> | null) => {
          setUnitTypeFilter(toMultiSelectValue(value));
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
          ? `${processedData.length} of ${rows.length} units`
          : `${rows.length} unit${rows.length === 1 ? "" : "s"}`}
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
      ? `No systemd unit metrics in the last ${UNIT_LOOKBACK_MINUTES} minutes. Unit state comes from the "systemd" receiver (alpha, Linux-only), which needs otelcol-contrib ${MIN_OTELCOL_CONTRIB_VERSION} or newer. Make sure this host runs a native collector with systemd added to the metrics pipeline, alongside resourcedetection — without it the samples never attach to a host. See the Documentation tab for setup steps.`
      : "No units match the current filters.";

  return (
    <Card title="Systemd Units" description={description} buttons={cardButtons}>
      <div>
        {(rows.length > 0 || hasActiveFilters) && filterBar}
        <Table<SystemdUnitRow>
          id="host-systemd-units-table"
          columns={tableColumns}
          actionButtons={actionButtons}
          data={paginatedData}
          singularLabel="Unit"
          pluralLabel="Units"
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
            newSortBy: keyof SystemdUnitRow | null,
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

export default HostSystemdUnits;
