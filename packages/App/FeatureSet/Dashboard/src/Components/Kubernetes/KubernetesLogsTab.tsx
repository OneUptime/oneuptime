import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardLogsViewer from "../Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import {
  KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS,
  buildKubernetesLogsAttributeDisplayValues,
  buildKubernetesLogsAttributeFilters,
} from "./KubernetesLogsScope";

export interface ComponentProps {
  clusterIdentifier: string;
  /*
   * The cluster's friendly name. Display only — the logs are still matched
   * on clusterIdentifier, which is what telemetry carries in
   * k8s.cluster.name.
   */
  clusterName?: string | undefined;
  podName: string;
  containerName?: string | undefined;
  namespace?: string | undefined;
}

const KubernetesLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const logQuery: Query<Log> = useMemo(() => {
    return {
      attributes: buildKubernetesLogsAttributeFilters({
        clusterIdentifier: props.clusterIdentifier,
        podName: props.podName,
        containerName: props.containerName,
        namespace: props.namespace,
      }),
    } as Query<Log>;
  }, [
    props.clusterIdentifier,
    props.podName,
    props.containerName,
    props.namespace,
  ]);

  /*
   * The locked cluster chip would otherwise read the machine identifier;
   * show the cluster's name instead without touching the filter.
   */
  const attributeFilterDisplayValues: Record<string, string> = useMemo(() => {
    return buildKubernetesLogsAttributeDisplayValues({
      clusterIdentifier: props.clusterIdentifier,
      clusterName: props.clusterName,
    });
  }, [props.clusterIdentifier, props.clusterName]);

  return (
    <DashboardLogsViewer
      id={`k8s-logs-${props.podName}`}
      logQuery={logQuery}
      attributeFilterDisplayKeys={KUBERNETES_LOGS_ATTRIBUTE_DISPLAY_KEYS}
      attributeFilterDisplayValues={attributeFilterDisplayValues}
      showFilters={true}
      noLogsMessage="No application logs found for this pod. Logs will appear here once the kubernetes-agent's filelog receiver is collecting data."
    />
  );
};

export default KubernetesLogsTab;
