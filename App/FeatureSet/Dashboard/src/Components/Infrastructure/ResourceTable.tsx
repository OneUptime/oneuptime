import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import Navigation from "Common/UI/Utils/Navigation";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { getRefreshButton } from "Common/UI/Components/Card/CardButtons/Refresh";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Link from "Common/UI/Components/Link/Link";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import Column from "Common/UI/Components/Table/Types/Column";
import Filter from "Common/UI/Components/Filters/Types/Filter";
import FilterData from "Common/UI/Components/Filters/Types/FilterData";
import Search from "Common/Types/BaseDatabase/Search";
import Includes from "Common/Types/BaseDatabase/Includes";

/*
 * Product-neutral client-side view-model for infrastructure resource
 * lists (Kubernetes pods/nodes, Proxmox nodes/guests/storages, Ceph
 * OSDs/pools/daemons). Kept structurally IDENTICAL to the
 * `KubernetesResource` interface in
 * Pages/Kubernetes/Utils/KubernetesResourceUtils.ts — keep the two in
 * sync so the Kubernetes wrapper stays a pass-through.
 */
export interface InfrastructureResource {
  name: string;
  /*
   * Grouping dimension rendered as the badge column: the namespace for
   * Kubernetes, the parent node for Proxmox guests/storages, the host
   * for Ceph OSDs. Set to "" and pass showGroupColumn={false} when not
   * applicable.
   */
  namespace: string;
  cpuUtilization: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  /*
   * Memory usage as a percent of a denominator, used by aggregate list
   * views where memory is a summed "% of allocatable" coming off the
   * server — parallel to cpuUtilization. Leave undefined to render
   * from memoryUsageBytes + memoryLimitBytes instead.
   */
  memoryUtilization?: number | null;
  status: string;
  age: string;
  additionalAttributes: Record<string, string>;
}

export interface ResourceColumn {
  title: string;
  key: string;
  getValue?: (resource: InfrastructureResource) => string;
}

export interface ComponentProps {
  resources: Array<InfrastructureResource>;
  title: string;
  description: string;
  columns?: Array<ResourceColumn> | undefined;
  /* Defaults to true. The grouping column renders `resource.namespace`. */
  showGroupColumn?: boolean | undefined;
  /* Column + filter title for the grouping column. Defaults to "Group". */
  groupColumnTitle?: string | undefined;
  /* Badge text when `resource.namespace` is empty. Defaults to "-". */
  groupFallbackLabel?: string | undefined;
  showStatus?: boolean | undefined;
  showResourceMetrics?: boolean | undefined;
  getViewRoute?: ((resource: InfrastructureResource) => Route) | undefined;
  /*
   * Extra row actions rendered after the built-in View button (e.g. the
   * Kubernetes "Logs" / "Metrics" explorer pivots).
   */
  extraActionButtons?:
    | Array<ActionButtonSchema<InfrastructureResource>>
    | undefined;
  emptyMessage?: string | undefined;
  isLoading?: boolean | undefined;
  onRefreshClick?: (() => void) | undefined;
  /* Prefix for the DOM table id. Defaults to "infrastructure". */
  tableIdPrefix?: string | undefined;
}

const PAGE_SIZE: number = 25;

export function formatCpuValue(value: number | null): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${value.toFixed(1)}%`;
}

export function formatMemoryValue(bytes: number | null): string {
  if (bytes === null || bytes === undefined) {
    return "N/A";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getStatusBadgeClass(status: string): string {
  const s: string = status.toLowerCase();
  if (
    s === "running" ||
    s === "ready" ||
    s === "active" ||
    s === "bound" ||
    s === "succeeded" ||
    s === "available" ||
    s === "true" ||
    s === "up" ||
    s === "online" ||
    s === "connected" ||
    s === "healthy" ||
    s === "ok"
  ) {
    return "bg-green-50 text-green-700";
  }
  if (
    s === "pending" ||
    s === "unknown" ||
    s === "waiting" ||
    s === "terminating" ||
    s === "degraded" ||
    s === "warn" ||
    s === "warning"
  ) {
    return "bg-yellow-50 text-yellow-700";
  }
  if (
    s === "failed" ||
    s === "crashloopbackoff" ||
    s === "error" ||
    s === "lost" ||
    s === "notready" ||
    s === "imagepullbackoff" ||
    s === "false" ||
    s === "down" ||
    s === "offline" ||
    s === "err"
  ) {
    return "bg-red-50 text-red-700";
  }
  return "bg-gray-50 text-gray-700";
}

function getCpuBarColor(pct: number): string {
  if (pct > 80) {
    return "bg-red-500";
  }
  if (pct > 60) {
    return "bg-yellow-500";
  }
  return "bg-green-500";
}

function getMemoryBarColor(pct: number): string {
  if (pct > 85) {
    return "bg-red-500";
  }
  if (pct > 70) {
    return "bg-yellow-500";
  }
  return "bg-blue-500";
}

const ResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showGroupColumn: boolean = props.showGroupColumn !== false;
  const groupColumnTitle: string = props.groupColumnTitle || "Group";
  const groupFallbackLabel: string = props.groupFallbackLabel || "-";
  const showStatus: boolean = props.showStatus !== false;
  const showResourceMetrics: boolean = props.showResourceMetrics !== false;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [filterData, setFilterData] = useState<
    FilterData<InfrastructureResource>
  >({});

  // Build filter definitions from data
  const filters: Array<Filter<InfrastructureResource>> = useMemo(() => {
    const result: Array<Filter<InfrastructureResource>> = [
      {
        title: "Name",
        key: "name",
        type: FieldType.Text,
      },
    ];

    if (showGroupColumn) {
      const groups: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: InfrastructureResource) => {
              return r.namespace;
            })
            .filter(Boolean),
        ),
      ).sort();
      result.push({
        title: groupColumnTitle,
        key: "namespace",
        type: FieldType.Dropdown,
        filterDropdownOptions: groups.map((group: string) => {
          return { label: group, value: group };
        }),
      });
    }

    if (showStatus) {
      const statuses: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: InfrastructureResource) => {
              return r.status;
            })
            .filter(Boolean),
        ),
      ).sort();
      result.push({
        title: "Status",
        key: "status",
        type: FieldType.Dropdown,
        filterDropdownOptions: statuses.map((s: string) => {
          return { label: s, value: s };
        }),
      });
    }

    return result;
  }, [props.resources, showGroupColumn, groupColumnTitle, showStatus]);

  // Filter and sort data client-side
  const processedData: Array<InfrastructureResource> = useMemo(() => {
    let data: Array<InfrastructureResource> = [...props.resources];

    // Apply filters from filterData
    for (const key of Object.keys(filterData) as Array<
      keyof InfrastructureResource
    >) {
      const value: unknown = filterData[key];
      if (!value) {
        continue;
      }

      if (value instanceof Search) {
        const searchText: string = value.toString().toLowerCase();
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue.toLowerCase().includes(searchText);
        });
      } else if (value instanceof Includes) {
        const includeValues: Array<string> = value.values as Array<string>;
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      } else if (typeof value === "string") {
        // Dropdown single selection stores as plain string
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue === value;
        });
      } else if (Array.isArray(value)) {
        // Dropdown multi-selection stores as plain array
        const includeValues: Array<string> = value.map((v: unknown) => {
          return String(v);
        });
        data = data.filter((r: InfrastructureResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      }
    }

    // Sort
    if (sortBy) {
      data.sort((a: InfrastructureResource, b: InfrastructureResource) => {
        let cmp: number = 0;
        if (sortBy === "name") {
          cmp = a.name.localeCompare(b.name);
        } else if (sortBy === "namespace") {
          cmp = a.namespace.localeCompare(b.namespace);
        } else if (sortBy === "status") {
          cmp = a.status.localeCompare(b.status);
        } else if (sortBy === "cpuUtilization") {
          cmp = (a.cpuUtilization ?? -1) - (b.cpuUtilization ?? -1);
        } else if (sortBy === "memoryUsageBytes") {
          cmp = (a.memoryUsageBytes ?? -1) - (b.memoryUsageBytes ?? -1);
        } else if (sortBy === "age") {
          cmp = a.age.localeCompare(b.age);
        }
        return sortOrder === SortOrder.Descending ? -cmp : cmp;
      });
    }

    return data;
  }, [props.resources, filterData, sortBy, sortOrder]);

  // Paginate
  const paginatedData: Array<InfrastructureResource> = useMemo(() => {
    const start: number = (currentPage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, currentPage]);

  const tableColumns: Array<Column<InfrastructureResource>> = [
    {
      title: "Name",
      type: FieldType.Element,
      key: "name",
      getElement: (resource: InfrastructureResource): ReactElement => {
        if (props.getViewRoute) {
          return (
            <Link
              to={props.getViewRoute(resource)}
              className="font-medium text-gray-900 hover:text-indigo-600 hover:underline"
            >
              {resource.name}
            </Link>
          );
        }
        return (
          <span className="font-medium text-gray-900">{resource.name}</span>
        );
      },
    },
  ];

  if (showGroupColumn) {
    tableColumns.push({
      title: groupColumnTitle,
      type: FieldType.Element,
      key: "namespace",
      getElement: (resource: InfrastructureResource): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {resource.namespace || groupFallbackLabel}
          </span>
        );
      },
    });
  }

  if (showStatus) {
    tableColumns.push({
      title: "Status",
      type: FieldType.Element,
      key: "status",
      getElement: (resource: InfrastructureResource): ReactElement => {
        if (!resource.status) {
          return <span className="text-gray-400">-</span>;
        }
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getStatusBadgeClass(resource.status)}`}
          >
            {resource.status}
          </span>
        );
      },
    });
  }

  if (props.columns) {
    for (const col of props.columns) {
      tableColumns.push({
        title: col.title,
        type: FieldType.Element,
        key: col.key as keyof InfrastructureResource,
        disableSort: true,
        getElement: (resource: InfrastructureResource): ReactElement => {
          const value: string = col.getValue
            ? col.getValue(resource)
            : resource.additionalAttributes[col.key] || "";
          return <span>{value}</span>;
        },
      });
    }
  }

  if (showResourceMetrics) {
    tableColumns.push(
      {
        title: "CPU",
        type: FieldType.Element,
        key: "cpuUtilization",
        getElement: (resource: InfrastructureResource): ReactElement => {
          if (
            resource.cpuUtilization === null ||
            resource.cpuUtilization === undefined
          ) {
            return <span className="text-gray-400">N/A</span>;
          }
          const pct: number = Math.min(resource.cpuUtilization, 100);
          return (
            <div className="flex items-center gap-2 min-w-[120px]">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${getCpuBarColor(pct)}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap w-10 text-right">
                {formatCpuValue(resource.cpuUtilization)}
              </span>
            </div>
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryUsageBytes",
        getElement: (resource: InfrastructureResource): ReactElement => {
          if (
            resource.memoryUsageBytes === null ||
            resource.memoryUsageBytes === undefined
          ) {
            return <span className="text-gray-400">N/A</span>;
          }

          /*
           * Aggregate views supply a pre-summed memory percentage
           * (memoryUtilization), parallel to cpuUtilization. Render it
           * like the CPU bar, with summed usage bytes as the sub-line.
           * Can exceed 100% the same way summed CPU% does, so clamp
           * the bar but keep the real number.
           */
          if (
            resource.memoryUtilization !== null &&
            resource.memoryUtilization !== undefined
          ) {
            const pct: number = Math.min(resource.memoryUtilization, 100);
            return (
              <div className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${getMemoryBarColor(pct)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {resource.memoryUtilization.toFixed(1)}%
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatMemoryValue(resource.memoryUsageBytes)}
                </div>
              </div>
            );
          }

          if (
            resource.memoryLimitBytes !== null &&
            resource.memoryLimitBytes !== undefined &&
            resource.memoryLimitBytes > 0
          ) {
            const pct: number = Math.min(
              (resource.memoryUsageBytes / resource.memoryLimitBytes) * 100,
              100,
            );
            return (
              <div className="min-w-[140px]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${getMemoryBarColor(pct)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {Math.round(pct)}%
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatMemoryValue(resource.memoryUsageBytes)} /{" "}
                  {formatMemoryValue(resource.memoryLimitBytes)}
                </div>
              </div>
            );
          }

          return (
            <span className="text-sm text-gray-700">
              {formatMemoryValue(resource.memoryUsageBytes)}
            </span>
          );
        },
      },
    );
  }

  if (showStatus) {
    tableColumns.push({
      title: "Age",
      type: FieldType.Element,
      key: "age",
      getElement: (resource: InfrastructureResource): ReactElement => {
        if (!resource.age) {
          return <span className="text-gray-400">-</span>;
        }
        return <span className="text-sm text-gray-600">{resource.age}</span>;
      },
    });
  }

  const actionButtons: Array<ActionButtonSchema<InfrastructureResource>> = [];

  if (props.getViewRoute) {
    actionButtons.push({
      title: "View",
      buttonStyleType: ButtonStyleType.NORMAL,
      onClick: (
        resource: InfrastructureResource,
        onCompleteAction: VoidFunction,
        onError: ErrorFunction,
      ): void => {
        try {
          Navigation.navigate(props.getViewRoute!(resource));
          onCompleteAction();
        } catch (err) {
          onError(err as Error);
        }
      },
    });
  }

  if (props.extraActionButtons && props.extraActionButtons.length > 0) {
    actionButtons.push(...props.extraActionButtons);
  }

  if (actionButtons.length > 0) {
    tableColumns.push({
      title: "",
      type: FieldType.Actions,
      key: null,
      disableSort: true,
    });
  }

  const hasActiveFilters: boolean = Object.keys(filterData).length > 0;

  const cardButtons: Array<CardButtonSchema> = [];

  if (props.onRefreshClick) {
    cardButtons.push({
      ...getRefreshButton(),
      className: "py-0 pr-0 pl-0 mt-1",
      onClick: props.onRefreshClick,
    });
  }

  cardButtons.push({
    title: "",
    buttonStyle: ButtonStyleType.ICON,
    className: "py-0 pr-0 pl-1 mt-1",
    onClick: () => {
      setShowFilterModal(true);
    },
    icon: IconProp.Filter,
  });

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={cardButtons}
    >
      <Table<InfrastructureResource>
        id={`${props.tableIdPrefix || "infrastructure"}-${props.title.toLowerCase().replace(/\s+/g, "-")}-table`}
        columns={tableColumns}
        actionButtons={actionButtons}
        data={paginatedData}
        singularLabel={props.title}
        pluralLabel={props.title}
        isLoading={props.isLoading || false}
        error=""
        currentPageNumber={currentPage}
        totalItemsCount={processedData.length}
        itemsOnPage={paginatedData.length}
        onNavigateToPage={(page: number) => {
          setCurrentPage(page);
        }}
        sortBy={sortBy as keyof InfrastructureResource | null}
        sortOrder={sortOrder}
        onSortChanged={(
          newSortBy: keyof InfrastructureResource | null,
          newSortOrder: SortOrder,
        ) => {
          setSortBy(newSortBy as string | null);
          setSortOrder(newSortOrder);
        }}
        filters={filters}
        showFilterModal={showFilterModal}
        filterData={filterData}
        onFilterChanged={(
          newFilterData: FilterData<InfrastructureResource>,
        ) => {
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
            ? "No resources match the current filters."
            : props.emptyMessage || "No resources found."
        }
      />
    </Card>
  );
};

export default ResourceTable;
