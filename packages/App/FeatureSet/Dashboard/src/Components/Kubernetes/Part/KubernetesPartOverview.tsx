import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { kubernetesObjectKey } from "Common/Types/Kubernetes/KubernetesHealth";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { KUBERNETES_CURRENT_PART_LABELS } from "../../../Pages/Kubernetes/Utils/KubernetesAttention";
import {
  KUBERNETES_PART_ALERT_TEMPLATE_IDS,
  KUBERNETES_PART_COPY,
  KubernetesPartCopy,
  KubernetesPartRead,
  getKubernetesPartAttentionItems,
  isKubernetesIssueAbout,
} from "../../../Pages/Kubernetes/Utils/KubernetesPartFacts";
import { KubernetesPartRoutes } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * A Kubernetes object's Overview tab: what about it and the pods it runs
 * is broken or needs a look (the most urgent first, its own row first
 * among equals, each pod a step from that pod's page), what is open on it, whether the cluster's alerts watch
 * it with one step to turn on the rest, and then its details - labels,
 * annotations, conditions - as the page showed them before (children).
 * The Proxmox node page's story, for a pod, a workload or a node.
 */

export interface ComponentProps {
  clusterId: ObjectID;
  // What the cluster's monitors are matched on.
  clusterIdentifier: string;
  kind: string;
  // The object's own read; null while it loads.
  read: KubernetesPartRead | null;
  error: string;
  routes: KubernetesPartRoutes;
  refreshToken?: number | undefined;
  children?: ReactNode | undefined;
}

const KubernetesPartOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: KubernetesPartCopy | undefined = KUBERNETES_PART_COPY[props.kind];
  const read: KubernetesPartRead | null = props.read;
  const testId: string = `kubernetes-${props.kind.toLowerCase()}`;

  const items: Array<ResourceAttentionItem> = read
    ? getKubernetesPartAttentionItems({
        read: read,
        routeFor: props.routes.getPartRoute,
      })
    : [];

  const currentKey: string | undefined = read?.part
    ? kubernetesObjectKey(
        read.part.kind || props.kind,
        read.part.namespaceKey || "",
        read.part.name || "",
      )
    : undefined;
  const currentLabel: string | undefined =
    KUBERNETES_CURRENT_PART_LABELS[props.kind];

  const templateIds: Array<string> =
    KUBERNETES_PART_ALERT_TEMPLATE_IDS[props.kind] || [];

  return (
    <div data-testid={`${testId}-overview`}>
      {props.error ? (
        <div className="mb-6" data-testid={`${testId}-part-error`}>
          <ErrorMessage message={props.error} />
        </div>
      ) : (
        <></>
      )}

      {read && copy ? (
        <NeedsAttentionCard
          testId={`${testId}-attention`}
          items={items}
          description={copy.attentionDescription}
          current={
            currentKey && currentLabel
              ? { key: currentKey, label: currentLabel }
              : undefined
          }
        />
      ) : (
        <></>
      )}

      {/*
       * Once the object and its pods are read, so an alert about one of its
       * pods is counted as its own.
       */}
      {read && read.part && copy ? (
        <ResourcePartOpenEventsCard
          testId={`${testId}-open`}
          title={copy.openTitle}
          description={copy.openDescription}
          resourceRelation="kubernetesClusters"
          resourceId={props.clusterId}
          relations={[{ name: "kubernetesResources", select: { _id: true } }]}
          isAbout={(record: OpenIssueRecord): boolean => {
            return isKubernetesIssueAbout(record, read);
          }}
          getIncidentRoute={props.routes.getIncidentRoute}
          getAlertRoute={props.routes.getAlertRoute}
          incidentsRoute={props.routes.incidentsRoute}
          alertsRoute={props.routes.alertsRoute}
          refreshToken={props.refreshToken}
        />
      ) : (
        <></>
      )}

      {copy && templateIds.length > 0 && props.clusterIdentifier ? (
        <ResourcePartAlertsCard
          testId={`${testId}-alerts`}
          title={copy.alertsTitle}
          description={copy.alertsDescription}
          resourceType={MonitorRecommendationResourceType.Kubernetes}
          templateIds={templateIds}
          resourceId={props.clusterId}
          resourceIdentifier={props.clusterIdentifier}
          getRecommendationsRoute={props.routes.getRecommendationsRoute}
          getMonitorRoute={props.routes.getMonitorRoute}
          refreshToken={props.refreshToken}
        />
      ) : (
        <></>
      )}

      {props.children}
    </div>
  );
};

export default KubernetesPartOverview;
