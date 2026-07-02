import React, { FunctionComponent, ReactElement, useMemo } from "react";
import DashboardLogsViewer from "../Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import { buildLogsExplorerRoute } from "../../Pages/Kubernetes/Utils/TelemetryPivot";

export interface ComponentProps {
  clusterIdentifier: string;
  podName: string;
  containerName?: string | undefined;
  namespace?: string | undefined;
}

const KubernetesLogsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const attributeFilters: Record<string, string> = useMemo(() => {
    const attributes: Record<string, string> = {
      "resource.k8s.cluster.name": props.clusterIdentifier,
      "resource.k8s.pod.name": props.podName,
    };

    if (props.containerName) {
      attributes["resource.k8s.container.name"] = props.containerName;
    }

    if (props.namespace) {
      attributes["resource.k8s.namespace.name"] = props.namespace;
    }

    return attributes;
  }, [
    props.clusterIdentifier,
    props.podName,
    props.containerName,
    props.namespace,
  ]);

  const logQuery: Query<Log> = useMemo(() => {
    return {
      attributes: attributeFilters,
    } as Query<Log>;
  }, [attributeFilters]);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Button
          title="Open in Logs Explorer"
          buttonSize={ButtonSize.Small}
          buttonStyle={ButtonStyleType.OUTLINE}
          icon={IconProp.ExternalLink}
          onClick={() => {
            Navigation.navigate(buildLogsExplorerRoute(attributeFilters));
          }}
        />
      </div>
      <DashboardLogsViewer
        id={`k8s-logs-${props.podName}`}
        logQuery={logQuery}
        showFilters={true}
        noLogsMessage="No application logs found for this pod. Logs will appear here once the kubernetes-agent's filelog receiver is collecting data."
      />
    </div>
  );
};

export default KubernetesLogsTab;
