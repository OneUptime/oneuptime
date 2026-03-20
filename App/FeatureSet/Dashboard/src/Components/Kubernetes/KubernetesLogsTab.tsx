import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardLogsViewer from "../Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";

export interface ComponentProps {
  clusterIdentifier: string;
  podName: string;
  containerName?: string | undefined;
  namespace?: string | undefined;
}

const KubernetesLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const logQuery: Query<Log> = useMemo(() => {
    const attributeFilters: Record<string, string> = {
      "resource.k8s.cluster.name": props.clusterIdentifier,
      "resource.k8s.pod.name": props.podName,
    };

    if (props.containerName) {
      attributeFilters["resource.k8s.container.name"] = props.containerName;
    }

    if (props.namespace) {
      attributeFilters["resource.k8s.namespace.name"] = props.namespace;
    }

    return {
      attributes: attributeFilters,
    } as Query<Log>;
  }, [
    props.clusterIdentifier,
    props.podName,
    props.containerName,
    props.namespace,
  ]);

  return (
    <DashboardLogsViewer
      id={`k8s-logs-${props.podName}`}
      logQuery={logQuery}
      showFilters={true}
      noLogsMessage="No application logs found for this pod. Logs will appear here once the kubernetes-agent's filelog receiver is collecting data."
    />
  );
};

export default KubernetesLogsTab;
