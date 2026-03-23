import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import {
  KubernetesContainerPort,
  KubernetesContainerSpec,
  KubernetesContainerStatus,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";

function formatK8sResourceValue(key: string, value: string): string {
  if (!value) {
    return value;
  }

  // CPU values: millicores (e.g. "250m" = 0.25 cores)
  const cpuMilliMatch: RegExpMatchArray | null = value.match(/^(\d+)m$/);
  if (cpuMilliMatch && key.toLowerCase() === "cpu") {
    const millis: number = parseInt(cpuMilliMatch[1] || "0");
    if (millis >= 1000) {
      return `${value} (${millis / 1000} CPU cores)`;
    }
    return `${value} (${(millis / 1000).toFixed(2)} CPU cores)`;
  }

  // CPU whole cores (e.g. "2" = 2 cores)
  if (key.toLowerCase() === "cpu" && (/^\d+$/).test(value)) {
    const cores: number = parseInt(value);
    return `${value} (${cores} CPU core${cores !== 1 ? "s" : ""})`;
  }

  // Memory values: Ki, Mi, Gi, Ti
  const memMatch: RegExpMatchArray | null = value.match(/^(\d+)(Ki|Mi|Gi|Ti)$/);
  if (memMatch) {
    const num: number = parseInt(memMatch[1] || "0");
    const unit: string = memMatch[2] || "";
    const explanations: Record<string, string> = {
      Ki: `${(num / 1024).toFixed(num >= 1024 ? 1 : 2)} MB`,
      Mi: num >= 1024 ? `${(num / 1024).toFixed(1)} GB` : `${num} MB`,
      Gi: `${num} GB`,
      Ti: `${num} TB`,
    };
    const readable: string | undefined = explanations[unit];
    if (readable) {
      return `${value} (${readable})`;
    }
  }

  // Ephemeral storage: same units
  const storageMatch: RegExpMatchArray | null = value.match(/^(\d+)(K|M|G|T)$/);
  if (storageMatch) {
    const num: number = parseInt(storageMatch[1] || "0");
    const unit: string = storageMatch[2] || "";
    const explanations: Record<string, string> = {
      K: `${(num / 1000).toFixed(num >= 1000 ? 1 : 2)} MB`,
      M: num >= 1000 ? `${(num / 1000).toFixed(1)} GB` : `${num} MB`,
      G: `${num} GB`,
      T: `${num} TB`,
    };
    const readable: string | undefined = explanations[unit];
    if (readable) {
      return `${value} (${readable})`;
    }
  }

  return value;
}

function annotateResourceValues(
  resources: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.keys(resources)) {
    result[key] = formatK8sResourceValue(key, resources[key] || "");
  }
  return result;
}

export interface ComponentProps {
  containers: Array<KubernetesContainerSpec>;
  initContainers: Array<KubernetesContainerSpec>;
  containerStatuses?: Array<KubernetesContainerStatus> | undefined;
  initContainerStatuses?: Array<KubernetesContainerStatus> | undefined;
}

interface ContainerCardProps {
  container: KubernetesContainerSpec;
  status?: KubernetesContainerStatus | undefined;
  isInit: boolean;
}

interface VolumeMountRow {
  name: string;
  mountPath: string;
  readOnly: string;
}

const volumeMountColumns: Columns<VolumeMountRow> = [
  {
    title: "Volume Name",
    type: FieldType.Text,
    key: "name",
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

const ContainerCard: FunctionComponent<ContainerCardProps> = (
  props: ContainerCardProps,
): ReactElement => {
  const [showEnv, setShowEnv] = useState<boolean>(false);
  const [showMounts, setShowMounts] = useState<boolean>(false);

  const envRecord: Record<string, string> = {};
  for (const env of props.container.env) {
    envRecord[env.name] = env.value;
  }

  const hasResources: boolean =
    Object.keys(props.container.resources.requests).length > 0 ||
    Object.keys(props.container.resources.limits).length > 0;

  return (
    <Card
      title={`${props.isInit ? "Init Container: " : "Container: "}${props.container.name}`}
      description={props.container.image}
    >
      <div className="space-y-5">
        {/* Status Info Cards */}
        {props.status && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoCard
              title="State"
              value={
                <StatusBadge
                  text={props.status.state}
                  type={
                    props.status.state === "running"
                      ? StatusBadgeType.Success
                      : props.status.state === "waiting"
                        ? StatusBadgeType.Warning
                        : StatusBadgeType.Danger
                  }
                />
              }
            />
            <InfoCard
              title="Ready"
              value={
                <StatusBadge
                  text={props.status.ready ? "Yes" : "No"}
                  type={
                    props.status.ready
                      ? StatusBadgeType.Success
                      : StatusBadgeType.Danger
                  }
                />
              }
            />
            <InfoCard
              title="Restarts"
              value={
                <StatusBadge
                  text={String(props.status.restartCount)}
                  type={
                    props.status.restartCount > 0
                      ? StatusBadgeType.Warning
                      : StatusBadgeType.Neutral
                  }
                />
              }
            />
          </div>
        )}

        {/* Command & Args */}
        {props.container.command.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Command
            </div>
            <code className="text-sm bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg block font-mono text-gray-800">
              {props.container.command.join(" ")}
            </code>
          </div>
        )}
        {props.container.args.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Args
            </div>
            <code className="text-sm bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg block font-mono text-gray-800">
              {props.container.args.join(" ")}
            </code>
          </div>
        )}

        {/* Ports */}
        {props.container.ports.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Ports
            </div>
            <div className="flex flex-wrap gap-1.5">
              {props.container.ports.map(
                (port: KubernetesContainerPort, idx: number) => {
                  return (
                    <StatusBadge
                      key={idx}
                      text={`${port.name ? `${port.name}: ` : ""}${port.containerPort}/${port.protocol}`}
                      type={StatusBadgeType.Info}
                    />
                  );
                },
              )}
            </div>
          </div>
        )}

        {/* Resources */}
        {hasResources && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.keys(props.container.resources.requests).length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  Requests
                </div>
                <DictionaryOfStringsViewer
                  value={annotateResourceValues(
                    props.container.resources.requests,
                  )}
                />
              </div>
            )}
            {Object.keys(props.container.resources.limits).length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  Limits
                </div>
                <DictionaryOfStringsViewer
                  value={annotateResourceValues(
                    props.container.resources.limits,
                  )}
                />
              </div>
            )}
          </div>
        )}

        {/* Environment Variables (expandable) */}
        {props.container.env.length > 0 && (
          <div>
            <button
              onClick={() => {
                setShowEnv(!showEnv);
              }}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
            >
              <span className="text-xs">{showEnv ? "▼" : "▶"}</span>
              Environment Variables ({props.container.env.length})
            </button>
            {showEnv && (
              <div className="mt-3">
                <DictionaryOfStringsViewer value={envRecord} />
              </div>
            )}
          </div>
        )}

        {/* Volume Mounts (expandable with table) */}
        {props.container.volumeMounts.length > 0 && (
          <div>
            <button
              onClick={() => {
                setShowMounts(!showMounts);
              }}
              className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
            >
              <span className="text-xs">{showMounts ? "▼" : "▶"}</span>
              Volume Mounts ({props.container.volumeMounts.length})
            </button>
            {showMounts && (
              <div className="mt-3">
                <LocalTable
                  id={`volume-mounts-${props.container.name}`}
                  data={props.container.volumeMounts.map(
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
                  )}
                  columns={volumeMountColumns}
                  singularLabel="Mount"
                  pluralLabel="Mounts"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

const KubernetesContainersTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.containers.length === 0 && props.initContainers.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No container information available.
      </div>
    );
  }

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

  return (
    <div className="space-y-4">
      {props.initContainers.map(
        (container: KubernetesContainerSpec, index: number) => {
          return (
            <ContainerCard
              key={`init-${index}`}
              container={container}
              status={getStatus(container.name, true)}
              isInit={true}
            />
          );
        },
      )}
      {props.containers.map(
        (container: KubernetesContainerSpec, index: number) => {
          return (
            <ContainerCard
              key={`container-${index}`}
              container={container}
              status={getStatus(container.name, false)}
              isInit={false}
            />
          );
        },
      )}
    </div>
  );
};

export default KubernetesContainersTab;
