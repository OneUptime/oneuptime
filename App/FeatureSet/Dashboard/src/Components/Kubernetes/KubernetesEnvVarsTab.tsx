import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import {
  KubernetesContainerEnvVar,
  KubernetesContainerSpec,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  containers: Array<KubernetesContainerSpec>;
  initContainers: Array<KubernetesContainerSpec>;
}

interface EnvVarRow {
  name: string;
  value: string;
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

  const totalMatchCount: number = search
    ? allContainers.reduce((sum: number, c: KubernetesContainerSpec) => {
        return (
          sum +
          c.env.filter((env: KubernetesContainerEnvVar) => {
            return (
              env.name.toLowerCase().includes(searchLower) ||
              env.value.toLowerCase().includes(searchLower)
            );
          }).length
        );
      }, 0)
    : totalEnvCount;

  const columns: Columns<EnvVarRow> = [
    {
      title: "Name",
      type: FieldType.Element,
      key: "name",
      getElement: (item: EnvVarRow): ReactElement => {
        return (
          <span className="font-mono font-medium text-gray-900">
            {item.name}
          </span>
        );
      },
    },
    {
      title: "Value",
      type: FieldType.Element,
      key: "value",
      getElement: (item: EnvVarRow): ReactElement => {
        const isSecret: boolean =
          item.value.startsWith("<Secret:") ||
          item.value.startsWith("<ConfigMap:") ||
          item.value.startsWith("<FieldRef:") ||
          item.value.startsWith("<ResourceFieldRef:");

        if (isSecret) {
          return (
            <StatusBadge
              text={item.value}
              type={
                item.value.startsWith("<Secret:")
                  ? StatusBadgeType.Warning
                  : StatusBadgeType.Info
              }
            />
          );
        }

        return (
          <span className="font-mono text-gray-600">
            {item.value || <span className="text-gray-400 italic">empty</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="px-4 pt-4">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search by name or value..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
            }}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-20 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
            {search && (
              <span className="text-xs text-gray-400 tabular-nums">
                {totalMatchCount}/{totalEnvCount}
              </span>
            )}
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                }}
                className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
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

          const tableData: Array<EnvVarRow> = filteredEnv.map(
            (env: KubernetesContainerEnvVar): EnvVarRow => {
              return {
                name: env.name,
                value: env.value,
              };
            },
          );

          return (
            <Card
              key={containerIdx}
              title={`${isInit ? "Init Container: " : ""}${container.name}`}
              description={`${filteredEnv.length} environment variable${filteredEnv.length !== 1 ? "s" : ""}`}
            >
              <LocalTable
                id={`env-vars-${containerIdx}`}
                data={tableData}
                columns={columns}
                singularLabel="Variable"
                pluralLabel="Variables"
              />
            </Card>
          );
        },
      )}
    </div>
  );
};

export default KubernetesEnvVarsTab;
