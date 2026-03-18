import React, { FunctionComponent, ReactElement } from "react";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../../Pages/Kubernetes/Utils/KubernetesResourceUtils";
import Card from "Common/UI/Components/Card/Card";
import Route from "Common/Types/API/Route";

export interface Column {
  title: string;
  key: string;
  getValue?: (resource: KubernetesResource) => string;
}

export interface ComponentProps {
  resources: Array<KubernetesResource>;
  title: string;
  description: string;
  columns?: Array<Column>;
  showNamespace?: boolean;
  getViewRoute?: (resource: KubernetesResource) => Route;
  emptyMessage?: string;
}

const KubernetesResourceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const showNamespace: boolean = props.showNamespace !== false;

  return (
    <Card title={props.title} description={props.description}>
      {props.resources.length === 0 ? (
        <p className="text-gray-500 text-sm p-4">
          {props.emptyMessage ||
            "No resources found. Resources will appear here once the kubernetes-agent is sending data."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                {showNamespace && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Namespace
                  </th>
                )}
                {props.columns?.map((column: Column) => {
                  return (
                    <th
                      key={column.key}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {column.title}
                    </th>
                  );
                })}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CPU
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Memory
                </th>
                {props.getViewRoute && (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {props.resources.map(
                (resource: KubernetesResource, index: number) => {
                  return (
                    <tr
                      key={index}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {resource.name}
                      </td>
                      {showNamespace && (
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                            {resource.namespace || "default"}
                          </span>
                        </td>
                      )}
                      {props.columns?.map((column: Column) => {
                        return (
                          <td
                            key={column.key}
                            className="px-4 py-3 whitespace-nowrap text-sm text-gray-500"
                          >
                            {column.getValue
                              ? column.getValue(resource)
                              : resource.additionalAttributes[column.key] ||
                                ""}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                            resource.cpuUtilization !== null &&
                            resource.cpuUtilization > 80
                              ? "bg-red-50 text-red-700"
                              : resource.cpuUtilization !== null &&
                                  resource.cpuUtilization > 60
                                ? "bg-yellow-50 text-yellow-700"
                                : "bg-green-50 text-green-700"
                          }`}
                        >
                          {KubernetesResourceUtils.formatCpuValue(
                            resource.cpuUtilization,
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {KubernetesResourceUtils.formatMemoryValue(
                          resource.memoryUsageBytes,
                        )}
                      </td>
                      {props.getViewRoute && (
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <a
                            href={props.getViewRoute(resource).toString()}
                            className="text-indigo-600 hover:text-indigo-900 font-medium"
                          >
                            View
                          </a>
                        </td>
                      )}
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export default KubernetesResourceTable;
