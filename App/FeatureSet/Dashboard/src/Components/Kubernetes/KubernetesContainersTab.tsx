import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import {
  KubernetesContainerPort,
  KubernetesContainerSpec,
  KubernetesContainerStatus,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";

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
      <div className="space-y-4">
        {/* Status */}
        {props.status && (
          <div className="flex gap-4 text-sm">
            <div>
              <span className="text-gray-500">State:</span>{" "}
              <span
                className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
                  props.status.state === "running"
                    ? "bg-green-50 text-green-700"
                    : props.status.state === "waiting"
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-red-50 text-red-700"
                }`}
              >
                {props.status.state}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Ready:</span>{" "}
              <span
                className={
                  props.status.ready ? "text-green-700" : "text-red-700"
                }
              >
                {props.status.ready ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Restarts:</span>{" "}
              <span
                className={
                  props.status.restartCount > 0
                    ? "text-yellow-700"
                    : "text-gray-700"
                }
              >
                {props.status.restartCount}
              </span>
            </div>
          </div>
        )}

        {/* Command & Args */}
        {props.container.command.length > 0 && (
          <div className="text-sm">
            <span className="text-gray-500 font-medium">Command:</span>{" "}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
              {props.container.command.join(" ")}
            </code>
          </div>
        )}
        {props.container.args.length > 0 && (
          <div className="text-sm">
            <span className="text-gray-500 font-medium">Args:</span>{" "}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
              {props.container.args.join(" ")}
            </code>
          </div>
        )}

        {/* Ports */}
        {props.container.ports.length > 0 && (
          <div className="text-sm">
            <span className="text-gray-500 font-medium">Ports:</span>{" "}
            {props.container.ports.map(
              (port: KubernetesContainerPort, idx: number) => {
                return (
                  <span
                    key={idx}
                    className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700 mr-1"
                  >
                    {port.name ? `${port.name}: ` : ""}
                    {port.containerPort}/{port.protocol}
                  </span>
                );
              },
            )}
          </div>
        )}

        {/* Resources */}
        {hasResources && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {Object.keys(props.container.resources.requests).length > 0 && (
              <div>
                <span className="text-gray-500 font-medium block mb-1">
                  Requests:
                </span>
                <DictionaryOfStringsViewer
                  value={props.container.resources.requests}
                />
              </div>
            )}
            {Object.keys(props.container.resources.limits).length > 0 && (
              <div>
                <span className="text-gray-500 font-medium block mb-1">
                  Limits:
                </span>
                <DictionaryOfStringsViewer
                  value={props.container.resources.limits}
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
              className="text-sm text-indigo-600 hover:text-indigo-900 font-medium"
            >
              {showEnv ? "Hide" : "Show"} Environment Variables (
              {props.container.env.length})
            </button>
            {showEnv && (
              <div className="mt-2">
                <DictionaryOfStringsViewer value={envRecord} />
              </div>
            )}
          </div>
        )}

        {/* Volume Mounts (expandable) */}
        {props.container.volumeMounts.length > 0 && (
          <div>
            <button
              onClick={() => {
                setShowMounts(!showMounts);
              }}
              className="text-sm text-indigo-600 hover:text-indigo-900 font-medium"
            >
              {showMounts ? "Hide" : "Show"} Volume Mounts (
              {props.container.volumeMounts.length})
            </button>
            {showMounts && (
              <div className="mt-2 space-y-1">
                {props.container.volumeMounts.map(
                  (
                    mount: {
                      name: string;
                      mountPath: string;
                      readOnly: boolean;
                    },
                    idx: number,
                  ) => {
                    return (
                      <div key={idx} className="text-sm flex gap-2">
                        <span className="font-medium text-gray-700">
                          {mount.name}
                        </span>
                        <span className="text-gray-500">→</span>
                        <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                          {mount.mountPath}
                        </code>
                        {mount.readOnly && (
                          <span className="text-xs text-gray-400">
                            (read-only)
                          </span>
                        )}
                      </div>
                    );
                  },
                )}
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
