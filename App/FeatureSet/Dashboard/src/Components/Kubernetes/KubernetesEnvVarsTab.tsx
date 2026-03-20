import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import {
  KubernetesContainerEnvVar,
  KubernetesContainerSpec,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";

export interface ComponentProps {
  containers: Array<KubernetesContainerSpec>;
  initContainers: Array<KubernetesContainerSpec>;
}

const KubernetesEnvVarsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");

  const allContainers: Array<KubernetesContainerSpec> = [
    ...props.initContainers,
    ...props.containers,
  ];

  if (allContainers.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No container information available.
      </div>
    );
  }

  const totalEnvCount: number = allContainers.reduce(
    (sum: number, c: KubernetesContainerSpec) => {
      return sum + c.env.length;
    },
    0,
  );

  if (totalEnvCount === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No environment variables defined for any container.
      </div>
    );
  }

  const searchLower: string = search.toLowerCase();

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="px-4 pt-4">
        <input
          type="text"
          placeholder="Search environment variables..."
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
          }}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {allContainers.map(
        (container: KubernetesContainerSpec, containerIdx: number) => {
          if (container.env.length === 0) {
            return null;
          }

          const filteredEnv: Array<KubernetesContainerEnvVar> = search
            ? container.env.filter((env: KubernetesContainerEnvVar) => {
                return (
                  env.name.toLowerCase().includes(searchLower) ||
                  env.value.toLowerCase().includes(searchLower)
                );
              })
            : container.env;

          if (filteredEnv.length === 0) {
            return null;
          }

          const isInit: boolean = containerIdx < props.initContainers.length;

          return (
            <Card
              key={containerIdx}
              title={`${isInit ? "Init Container: " : ""}${container.name}`}
              description={`${filteredEnv.length} environment variable${filteredEnv.length !== 1 ? "s" : ""}`}
            >
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredEnv.map(
                      (env: KubernetesContainerEnvVar, envIdx: number) => {
                        const isSecret: boolean =
                          env.value.startsWith("<Secret:") ||
                          env.value.startsWith("<ConfigMap:") ||
                          env.value.startsWith("<FieldRef:") ||
                          env.value.startsWith("<ResourceFieldRef:");

                        return (
                          <tr key={envIdx} className="hover:bg-gray-50/50">
                            <td className="px-4 py-2 whitespace-nowrap text-sm font-mono font-medium text-gray-900">
                              {env.name}
                            </td>
                            <td className="px-4 py-2 text-sm font-mono break-all">
                              {isSecret ? (
                                <StatusBadge
                                  text={env.value}
                                  type={
                                    env.value.startsWith("<Secret:")
                                      ? StatusBadgeType.Warning
                                      : StatusBadgeType.Info
                                  }
                                />
                              ) : (
                                <span className="text-gray-600">
                                  {env.value || (
                                    <span className="text-gray-400 italic">
                                      empty
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        },
      )}
    </div>
  );
};

export default KubernetesEnvVarsTab;
