import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
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

export interface ResourceColumn {
  title: string;
  key: string;
  getValue?: (resource: KubernetesResource) => string;
}

export interface ComponentProps {
  resources: Array<KubernetesResource>;
  title: string;
  description: string;
  columns?: Array<ResourceColumn>;
  showNamespace?: boolean;
  showStatus?: boolean;
  showResourceMetrics?: boolean;
  getViewRoute?: (resource: KubernetesResource) => Route;
  emptyMessage?: string;
  isLoading?: boolean;
  onRefreshClick?: (() => void) | undefined;
}

const PAGE_SIZE: number = 25;

function getStatusBadgeClass(status: string): string {
  const s: string = status.toLowerCase();
  if (
    s === "running" ||
    s === "ready" ||
    s === "active" ||
    s === "bound" ||
    s === "succeeded" ||
    s === "available" ||
    s === "true"
  ) {
    return "bg-green-50 text-green-700";
  }
  if (
    s === "pending" ||
    s === "unknown" ||
    s === "waiting" ||
    s === "terminating"
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
    s === "false"
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

const KubernetesResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showNamespace: boolean = props.showNamespace !== false;
  const showStatus: boolean = props.showStatus !== false;
  const showResourceMetrics: boolean = props.showResourceMetrics !== false;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
  const [showFilterModal, setShowFilterModal] = useState<boolean>(false);
  const [filterData, setFilterData] = useState<FilterData<KubernetesResource>>(
    {},
  );

  // Build filter definitions from data
  const filters: Array<Filter<KubernetesResource>> = useMemo(() => {
    const result: Array<Filter<KubernetesResource>> = [
      {
        title: "Name",
        key: "name",
        type: FieldType.Text,
      },
    ];

    if (showNamespace) {
      const namespaces: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: KubernetesResource) => {
              return r.namespace;
            })
            .filter(Boolean),
        ),
      ).sort();
      result.push({
        title: "Namespace",
        key: "namespace",
        type: FieldType.Dropdown,
        filterDropdownOptions: namespaces.map((ns: string) => {
          return { label: ns, value: ns };
        }),
      });
    }

    if (showStatus) {
      const statuses: Array<string> = Array.from(
        new Set(
          props.resources
            .map((r: KubernetesResource) => {
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
  }, [props.resources, showNamespace, showStatus]);

  // Filter and sort data client-side
  const processedData: Array<KubernetesResource> = useMemo(() => {
    let data: Array<KubernetesResource> = [...props.resources];

    // Apply filters from filterData
    for (const key of Object.keys(filterData) as Array<
      keyof KubernetesResource
    >) {
      const value: unknown = filterData[key];
      if (!value) {
        continue;
      }

      if (value instanceof Search) {
        const searchText: string = value.toString().toLowerCase();
        data = data.filter((r: KubernetesResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue.toLowerCase().includes(searchText);
        });
      } else if (value instanceof Includes) {
        const includeValues: Array<string> = value.values as Array<string>;
        data = data.filter((r: KubernetesResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      } else if (typeof value === "string") {
        // Dropdown single selection stores as plain string
        data = data.filter((r: KubernetesResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return fieldValue === value;
        });
      } else if (Array.isArray(value)) {
        // Dropdown multi-selection stores as plain array
        const includeValues: Array<string> = value.map((v: unknown) => {
          return String(v);
        });
        data = data.filter((r: KubernetesResource) => {
          const fieldValue: string = (r[key] as string) || "";
          return includeValues.includes(fieldValue);
        });
      }
    }

    // Sort
    if (sortBy) {
      data.sort((a: KubernetesResource, b: KubernetesResource) => {
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
  const paginatedData: Array<KubernetesResource> = useMemo(() => {
    const start: number = (currentPage - 1) * PAGE_SIZE;
    return processedData.slice(start, start + PAGE_SIZE);
  }, [processedData, currentPage]);

  const tableColumns: Array<Column<KubernetesResource>> = [
    {
      title: "Name",
      type: FieldType.Element,
      key: "name",
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <span className="font-medium text-gray-900">{resource.name}</span>
        );
      },
    },
  ];

  if (showNamespace) {
    tableColumns.push({
      title: "Namespace",
      type: FieldType.Element,
      key: "namespace",
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {resource.namespace || "default"}
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
      getElement: (resource: KubernetesResource): ReactElement => {
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
        key: col.key as keyof KubernetesResource,
        disableSort: true,
        getElement: (resource: KubernetesResource): ReactElement => {
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
        getElement: (resource: KubernetesResource): ReactElement => {
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
                {KubernetesResourceUtils.formatCpuValue(
                  resource.cpuUtilization,
                )}
              </span>
            </div>
          );
        },
      },
      {
        title: "Memory",
        type: FieldType.Element,
        key: "memoryUsageBytes",
        getElement: (resource: KubernetesResource): ReactElement => {
          if (
            resource.memoryUsageBytes === null ||
            resource.memoryUsageBytes === undefined
          ) {
            return <span className="text-gray-400">N/A</span>;
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
                  {KubernetesResourceUtils.formatMemoryValue(
                    resource.memoryUsageBytes,
                  )}{" "}
                  /{" "}
                  {KubernetesResourceUtils.formatMemoryValue(
                    resource.memoryLimitBytes,
                  )}
                </div>
              </div>
            );
          }

          return (
            <span className="text-sm text-gray-700">
              {KubernetesResourceUtils.formatMemoryValue(
                resource.memoryUsageBytes,
              )}
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
      getElement: (resource: KubernetesResource): ReactElement => {
        if (!resource.age) {
          return <span className="text-gray-400">-</span>;
        }
        return <span className="text-sm text-gray-600">{resource.age}</span>;
      },
    });
  }

  if (props.getViewRoute) {
    tableColumns.push({
      title: "",
      type: FieldType.Element,
      key: "name",
      disableSort: true,
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <Link
            to={props.getViewRoute!(resource)}
            className="text-indigo-600 hover:text-indigo-900 font-medium"
          >
            View
          </Link>
        );
      },
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
      <Table<KubernetesResource>
        id={`kubernetes-${props.title.toLowerCase().replace(/\s+/g, "-")}-table`}
        columns={tableColumns}
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
        sortBy={sortBy as keyof KubernetesResource | null}
        sortOrder={sortOrder}
        onSortChanged={(
          newSortBy: keyof KubernetesResource | null,
          newSortOrder: SortOrder,
        ) => {
          setSortBy(newSortBy as string | null);
          setSortOrder(newSortOrder);
        }}
        filters={filters}
        showFilterModal={showFilterModal}
        filterData={filterData}
        onFilterChanged={(newFilterData: FilterData<KubernetesResource>) => {
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
            : props.emptyMessage ||
              "No resources found. Resources will appear here once the kubernetes-agent is sending data."
        }
      />
    </Card>
  );
};

export default KubernetesResourceTable;
