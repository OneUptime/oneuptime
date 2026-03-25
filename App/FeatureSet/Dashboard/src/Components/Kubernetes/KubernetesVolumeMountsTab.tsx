import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import {
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

interface VolumeMountRow {
  name: string;
  mountPath: string;
  readOnly: string;
}

const KubernetesVolumeMountsTab: FunctionComponent<ComponentProps> = (
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

  const totalMountCount: number = allContainers.reduce(
    (sum: number, c: KubernetesContainerSpec) => {
      return sum + c.volumeMounts.length;
    },
    0,
  );

  if (totalMountCount === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No volume mounts defined for any container.
      </div>
    );
  }

  const searchLower: string = search.toLowerCase();

  const totalMatchCount: number = search
    ? allContainers.reduce((sum: number, c: KubernetesContainerSpec) => {
        return (
          sum +
          c.volumeMounts.filter(
            (m: { name: string; mountPath: string; readOnly: boolean }) => {
              return (
                m.name.toLowerCase().includes(searchLower) ||
                m.mountPath.toLowerCase().includes(searchLower)
              );
            },
          ).length
        );
      }, 0)
    : totalMountCount;

  const columns: Columns<VolumeMountRow> = [
    {
      title: "Volume Name",
      type: FieldType.Element,
      key: "name",
      getElement: (item: VolumeMountRow): ReactElement => {
        return (
          <span className="font-mono font-medium text-gray-900">
            {item.name}
          </span>
        );
      },
    },
    {
      title: "Mount Path",
      type: FieldType.Element,
      key: "mountPath",
      getElement: (item: VolumeMountRow): ReactElement => {
        return (
          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">
            {item.mountPath}
          </code>
        );
      },
    },
    {
      title: "Access",
      type: FieldType.Element,
      key: "readOnly",
      getElement: (item: VolumeMountRow): ReactElement => {
        return (
          <StatusBadge
            text={item.readOnly === "true" ? "Read-Only" : "Read-Write"}
            type={
              item.readOnly === "true"
                ? StatusBadgeType.Warning
                : StatusBadgeType.Neutral
            }
          />
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <Card
        title="Volume Mounts"
        description={`${totalMountCount} mount${totalMountCount !== 1 ? "s" : ""} across ${
          allContainers.filter((c: KubernetesContainerSpec) => {
            return c.volumeMounts.length > 0;
          }).length
        } container${
          allContainers.filter((c: KubernetesContainerSpec) => {
            return c.volumeMounts.length > 0;
          }).length !== 1
            ? "s"
            : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
            </div>
            <Input
              placeholder="Search by volume name or mount path..."
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
                {totalMatchCount} of {totalMountCount}
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
          if (item.container.volumeMounts.length === 0) {
            return null;
          }

          const filteredMounts: Array<{
            name: string;
            mountPath: string;
            readOnly: boolean;
          }> = search
            ? item.container.volumeMounts.filter(
                (m: { name: string; mountPath: string; readOnly: boolean }) => {
                  return (
                    m.name.toLowerCase().includes(searchLower) ||
                    m.mountPath.toLowerCase().includes(searchLower)
                  );
                },
              )
            : item.container.volumeMounts;

          if (filteredMounts.length === 0) {
            return null;
          }

          const tableData: Array<VolumeMountRow> = filteredMounts.map(
            (mount: {
              name: string;
              mountPath: string;
              readOnly: boolean;
            }): VolumeMountRow => {
              return {
                name: mount.name,
                mountPath: mount.mountPath,
                readOnly: String(mount.readOnly),
              };
            },
          );

          return (
            <Card
              key={containerIdx}
              title={`${item.isInit ? "Init Container: " : ""}${item.container.name}`}
              description={`${filteredMounts.length} volume mount${filteredMounts.length !== 1 ? "s" : ""}`}
            >
              <LocalTable
                id={`volume-mounts-${containerIdx}`}
                data={tableData}
                columns={columns}
                singularLabel="Mount"
                pluralLabel="Mounts"
              />
            </Card>
          );
        },
      )}
    </div>
  );
};

export default KubernetesVolumeMountsTab;
