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
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/KubernetesResourceMetricDescriptions";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import OneUptimeDate from "Common/Types/Date";
import { KUBERNETES_FAILING_WAIT_REASONS } from "Common/Types/Kubernetes/KubernetesHealth";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  KubernetesResourceReading,
  readKubernetesResourceValue,
} from "./KubernetesResourceQuantity";

/*
 * A container's state as kubectl shows it: the reason when Kubernetes
 * gives one ("CrashLoopBackOff", "OOMKilled", "Completed"), else the state
 * itself; red when it cannot run or ended in an error.
 */
export function getContainerStateBadge(status: KubernetesContainerStatus): {
  text: string;
  type: StatusBadgeType;
} {
  const text: string = status.reason || status.state;
  if (status.state === "running") {
    return { text: text, type: StatusBadgeType.Success };
  }
  if (status.state === "waiting") {
    return {
      text: text,
      type: KUBERNETES_FAILING_WAIT_REASONS.has(status.reason)
        ? StatusBadgeType.Danger
        : StatusBadgeType.Warning,
    };
  }
  if (status.state === "terminated" && status.reason === "Completed") {
    return { text: text, type: StatusBadgeType.Neutral };
  }
  return { text: text, type: StatusBadgeType.Danger };
}

/*
 * A request's or a limit's value: Kubernetes' own ("250m"), as written and
 * set apart, then what it means in the reader's words and digits - "(0.25
 * CPU cores)", "(۰٫۲۵ هستهٔ پردازنده)", "(۵۱۲ MB)" - each part reading its
 * own way on an Arabic or Persian page.
 */
export const KubernetesResourceValue: FunctionComponent<{
  reading: KubernetesResourceReading;
}> = (props: { reading: KubernetesResourceReading }): ReactElement => {
  return (
    <span className="text-gray-600" data-testid="kubernetes-resource-value">
      <IsolatedText
        text={props.reading.quantity}
        className="font-mono"
        dataTestId="kubernetes-resource-quantity"
      />
      {props.reading.meaning ? (
        <>
          {" "}
          <span
            className="text-gray-500"
            data-testid="kubernetes-resource-meaning"
          >
            (<IsolatedText text={props.reading.meaning} />)
          </span>
        </>
      ) : (
        <></>
      )}
    </span>
  );
};

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
  const translator: Translator = useTranslator();
  const [showEnv, setShowEnv] = useState<boolean>(false);
  const [showMounts, setShowMounts] = useState<boolean>(false);

  const envRecord: Record<string, string> = {};
  for (const env of props.container.env) {
    envRecord[env.name] = env.value;
  }

  const hasResources: boolean =
    Object.keys(props.container.resources.requests).length > 0 ||
    Object.keys(props.container.resources.limits).length > 0;

  const renderResourceValue: (key: string, value: string) => ReactElement = (
    key: string,
    value: string,
  ): ReactElement => {
    return (
      <KubernetesResourceValue
        reading={readKubernetesResourceValue({ key, value, translator })}
      />
    );
  };

  // Its state as its badge colours it: red when it cannot run.
  const isCritical: boolean = Boolean(
    props.status &&
      getContainerStateBadge(props.status).type === StatusBadgeType.Danger,
  );

  return (
    <Card
      title={translator.translateTemplate(
        props.isInit ? "Init Container: {{name}}" : "Container: {{name}}",
        { name: props.container.name },
      )}
      description={props.container.image}
    >
      <div className="space-y-5">
        {/* Status Info Cards */}
        {props.status && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InfoCard
              title="State"
              tooltip={KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerState}
              value={
                <span data-testid="kubernetes-container-state">
                  <StatusBadge
                    text={getContainerStateBadge(props.status).text}
                    type={getContainerStateBadge(props.status).type}
                  />
                </span>
              }
            />
            <InfoCard
              title="Ready"
              tooltip={KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerReady}
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
              tooltip={
                KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerRestarts
              }
              value={
                <StatusBadge
                  /*
                   * A count, in the reader's digits ("۲" on a Persian page),
                   * as the cores beside it are.
                   */
                  text={translator.formatNumber(props.status.restartCount)}
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

        {/*
         * Why it is not running, and how its last run ended - the first
         * thing kubectl describe is opened for: the kubelet's own words
         * about a wait, and an OOM kill or an exit code with when it
         * happened. Red beside a red state (CrashLoopBackOff, an error),
         * as its badge above is; amber otherwise.
         */}
        {props.status &&
        (props.status.message || props.status.lastTerminationReason) ? (
          <div
            data-testid="kubernetes-container-diagnosis"
            data-tone={isCritical ? "danger" : "warning"}
            className={`space-y-1 rounded-lg border px-4 py-3 text-sm ${
              isCritical
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {props.status.message ? (
              <p className="[overflow-wrap:anywhere]">
                {props.status.reason ? (
                  <span className="font-medium">
                    <bdi>{props.status.reason}</bdi>
                    {": "}
                  </span>
                ) : (
                  <></>
                )}
                <bdi>{props.status.message}</bdi>
              </p>
            ) : (
              <></>
            )}
            {props.status.lastTerminationReason ? (
              <p data-testid="kubernetes-container-last-restart">
                <span className="font-medium">
                  {props.status.lastTerminationExitCode !== null &&
                  props.status.lastTerminationExitCode !== undefined &&
                  props.status.lastTerminationReason !== "OOMKilled" &&
                  props.status.lastTerminationExitCode !== 0
                    ? translator.translateTemplate(
                        "Last restart: {{reason}}, exit code {{code}}",
                        {
                          reason: props.status.lastTerminationReason,
                          code: String(props.status.lastTerminationExitCode),
                        },
                      )
                    : translator.translateTemplate("Last restart: {{reason}}", {
                        reason: props.status.lastTerminationReason,
                      })}
                </span>
                {props.status.lastTerminatedAt &&
                Number.isFinite(
                  new Date(props.status.lastTerminatedAt).getTime(),
                ) ? (
                  <span
                    className={isCritical ? "text-red-800" : "text-amber-800"}
                  >
                    <InlineSeparator />
                    {translator.translateTemplate("Ended {{time}}", {
                      time: OneUptimeDate.fromNow(
                        new Date(props.status.lastTerminatedAt),
                      ),
                    })}
                  </span>
                ) : (
                  <></>
                )}
              </p>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {/* Command & Args */}
        {props.container.command.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {translator.translateText("Command")}
            </div>
            <code className="text-sm bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg block font-mono text-gray-800">
              {props.container.command.join(" ")}
            </code>
          </div>
        )}
        {props.container.args.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {translator.translateText("Args")}
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
              {translator.translateText("Ports")}
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
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <span>{translator.translateText("Requests")}</span>
                  <InfoTooltip
                    label="Requests"
                    text={
                      KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerRequests
                    }
                    className="normal-case tracking-normal"
                  />
                </div>
                <DictionaryOfStringsViewer
                  value={props.container.resources.requests}
                  renderValue={renderResourceValue}
                />
              </div>
            )}
            {Object.keys(props.container.resources.limits).length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <span>{translator.translateText("Limits")}</span>
                  <InfoTooltip
                    label="Limits"
                    text={
                      KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerLimits
                    }
                    className="normal-case tracking-normal"
                  />
                </div>
                <DictionaryOfStringsViewer
                  value={props.container.resources.limits}
                  renderValue={renderResourceValue}
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
              {translator.translateText("Environment Variables")} (
              {props.container.env.length})
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
              {translator.translateText("Volume Mounts")} (
              {props.container.volumeMounts.length})
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
  const translator: Translator = useTranslator();
  if (props.containers.length === 0 && props.initContainers.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        {translator.translateText("No container information available.")}
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

  // Sort containers: running first, then waiting, then terminated
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

  return (
    <div className="space-y-4">
      {sortedContainers.map(
        (
          item: { container: KubernetesContainerSpec; isInit: boolean },
          index: number,
        ) => {
          return (
            <ContainerCard
              key={`${item.isInit ? "init" : "container"}-${index}`}
              container={item.container}
              status={getStatus(item.container.name, item.isInit)}
              isInit={item.isInit}
            />
          );
        },
      )}
    </div>
  );
};

export default KubernetesContainersTab;
