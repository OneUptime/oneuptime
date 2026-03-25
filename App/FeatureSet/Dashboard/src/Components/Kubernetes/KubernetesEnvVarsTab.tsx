import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import {
  KubernetesContainerEnvVar,
  KubernetesContainerSpec,
  KubernetesContainerStatus,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Input from "Common/UI/Components/Input/Input";

export interface ComponentProps {
  containers: Array<KubernetesContainerSpec>;
  initContainers: Array<KubernetesContainerSpec>;
  containerStatuses?: Array<KubernetesContainerStatus> | undefined;
  initContainerStatuses?: Array<KubernetesContainerStatus> | undefined;
}

interface EnvVarRow {
  name: string;
  value: string;
}

const KubernetesEnvVarsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [search, setSearch] = useState<string>("");

  const getStatus: (
    name: string,
    isInit: boolean,
  ) => KubernetesContainerStatus | undefined = (
    name: string,
    isInit: boolean,
  ): KubernetesContainerStatus | undefined => {
    const statuses: Array<KubernetesContainerStatus> | undefined = isInit
      ? props.initContainerStatuses
      : props.containerStatuses;
    return statuses?.find((s: KubernetesContainerStatus) => {
      return s.name === name;
    });
  };

  function getStatePriority(state: string): number {
    const s: string = state.toLowerCase();
    if (s === "running") {
      return 0;
    }
    if (s === "waiting") {
      return 1;
    }
    if (s === "terminated") {
      return 2;
    }
    return 3;
  }

  const sortedContainers: Array<{
    container: KubernetesContainerSpec;
    isInit: boolean;
  }> = [
    ...props.initContainers.map((container: KubernetesContainerSpec) => {
      return { container, isInit: true };
    }),
    ...props.containers.map((container: KubernetesContainerSpec) => {
      return { container, isInit: false };
    }),
  ].sort(
    (
      a: { container: KubernetesContainerSpec; isInit: boolean },
      b: { container: KubernetesContainerSpec; isInit: boolean },
    ) => {
      const aStatus: KubernetesContainerStatus | undefined = getStatus(
        a.container.name,
        a.isInit,
      );
      const bStatus: KubernetesContainerStatus | undefined = getStatus(
        b.container.name,
        b.isInit,
      );
      const aPriority: number = getStatePriority(aStatus?.state || "unknown");
      const bPriority: number = getStatePriority(bStatus?.state || "unknown");
      return aPriority - bPriority;
    },
  );

  const allContainers: Array<KubernetesContainerSpec> = sortedContainers.map(
    (item: { container: KubernetesContainerSpec; isInit: boolean }) => {
      return item.container;
    },
  );

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
      <Card
        title="Environment Variables"
        description={`${totalEnvCount} variable${totalEnvCount !== 1 ? "s" : ""} across ${allContainers.filter((c: KubernetesContainerSpec) => { return c.env.length > 0; }).length} container${allContainers.filter((c: KubernetesContainerSpec) => { return c.env.length > 0; }).length !== 1 ? "s" : ""}`}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Icon
                icon={IconProp.Search}
                className="h-4 w-4 text-gray-400"
              />
            </div>
            <Input
              placeholder="Search environment variables..."
              value={search}
              onChange={(value: string) => {
                setSearch(value);
              }}
              className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          {search && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-sm text-gray-500 tabular-nums">
                {totalMatchCount} of {totalEnvCount}
              </span>
              <button
                onClick={() => {
                  setSearch("");
                }}
                className="rounded-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <Icon icon={IconProp.Close} className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </Card>

      {sortedContainers.map(
        (
          item: { container: KubernetesContainerSpec; isInit: boolean },
          containerIdx: number,
        ) => {
          if (item.container.env.length === 0) {
            return null;
          }

          const filteredEnv: Array<KubernetesContainerEnvVar> = search
            ? item.container.env.filter((env: KubernetesContainerEnvVar) => {
                return (
                  env.name.toLowerCase().includes(searchLower) ||
                  env.value.toLowerCase().includes(searchLower)
                );
              })
            : item.container.env;

          if (filteredEnv.length === 0) {
            return null;
          }

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
              title={`${item.isInit ? "Init Container: " : ""}${item.container.name}`}
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
