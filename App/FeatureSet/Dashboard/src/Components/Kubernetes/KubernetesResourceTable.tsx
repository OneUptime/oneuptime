import React, { FunctionComponent, ReactElement } from "react";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import Card from "Common/UI/Components/Card/Card";
import Table from "Common/UI/Components/Table/Table";
import FieldType from "Common/UI/Components/Types/FieldType";
import Link from "Common/UI/Components/Link/Link";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Route from "Common/Types/API/Route";
import Column from "Common/UI/Components/Table/Types/Column";

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
  getViewRoute?: (resource: KubernetesResource) => Route;
  emptyMessage?: string;
}

const KubernetesResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showNamespace: boolean = props.showNamespace !== false;

  const tableColumns: Array<Column<KubernetesResource>> = [
    {
      title: "Name",
      type: FieldType.Element,
      key: "name",
      disableSort: true,
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
      disableSort: true,
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
            {resource.namespace || "default"}
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

  tableColumns.push(
    {
      title: "CPU",
      type: FieldType.Element,
      key: "cpuUtilization",
      disableSort: true,
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              resource.cpuUtilization !== null && resource.cpuUtilization > 80
                ? "bg-red-50 text-red-700"
                : resource.cpuUtilization !== null &&
                    resource.cpuUtilization > 60
                  ? "bg-yellow-50 text-yellow-700"
                  : "bg-green-50 text-green-700"
            }`}
          >
            {KubernetesResourceUtils.formatCpuValue(resource.cpuUtilization)}
          </span>
        );
      },
    },
    {
      title: "Memory",
      type: FieldType.Element,
      key: "memoryUsageBytes",
      disableSort: true,
      getElement: (resource: KubernetesResource): ReactElement => {
        return (
          <span>
            {KubernetesResourceUtils.formatMemoryValue(
              resource.memoryUsageBytes,
            )}
          </span>
        );
      },
    },
  );

  if (props.getViewRoute) {
    tableColumns.push({
      title: "Actions",
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

  return (
    <Card title={props.title} description={props.description}>
      <Table<KubernetesResource>
        id={`kubernetes-${props.title.toLowerCase().replace(/\s+/g, "-")}-table`}
        columns={tableColumns}
        data={props.resources}
        singularLabel={props.title}
        pluralLabel={props.title}
        isLoading={false}
        error=""
        disablePagination={true}
        currentPageNumber={1}
        totalItemsCount={props.resources.length}
        itemsOnPage={props.resources.length}
        onNavigateToPage={() => {}}
        sortBy={null}
        sortOrder={SortOrder.Ascending}
        onSortChanged={() => {}}
        noItemsMessage={
          props.emptyMessage ||
          "No resources found. Resources will appear here once the kubernetes-agent is sending data."
        }
      />
    </Card>
  );
};

export default KubernetesResourceTable;
