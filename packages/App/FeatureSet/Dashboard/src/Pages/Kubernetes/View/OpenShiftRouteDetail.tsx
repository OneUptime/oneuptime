import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Link from "Common/UI/Components/Link/Link";
import URL from "Common/Types/API/URL";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import KubernetesOverviewTab, {
  SummaryField,
} from "../../../Components/Kubernetes/KubernetesOverviewTab";
import { useKubernetesEventsTab } from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import { KubernetesCondition } from "../Utils/KubernetesObjectParser";
import {
  OpenShiftKind,
  OpenShiftResourceType,
  OpenShiftRouteIngress,
  OpenShiftRouteObject,
  OpenShiftRouteState,
  getRouteState,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import {
  OpenShiftRouteTarget,
  getRouteHost,
  getRouteTargets,
  getRouteTlsLabel,
  getRouteUrl,
} from "../Utils/KubernetesOpenShiftResources";

const STATE_BADGES: Record<OpenShiftRouteState, StatusBadgeType> = {
  [OpenShiftRouteState.Admitted]: StatusBadgeType.Success,
  [OpenShiftRouteState.Pending]: StatusBadgeType.Warning,
  [OpenShiftRouteState.Rejected]: StatusBadgeType.Danger,
};

const KubernetesClusterOpenShiftRouteDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const routeName: string = Navigation.getLastParamAsString();
  // Routes of one name repeat across namespaces: the list says which.
  const namespace: string | undefined =
    Navigation.getQueryStringByName("namespace") || undefined;

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] = useState<OpenShiftRouteObject | null>(
    null,
  );
  const [isLoadingObject, setIsLoadingObject] = useState<boolean>(true);

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: OpenShiftRouteObject | null =
          await fetchLatestK8sObject<OpenShiftRouteObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: OpenShiftResourceType.Routes,
            resourceName: routeName,
            namespace: namespace,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, routeName, namespace]);

  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "object",
          objectKind: OpenShiftKind.Route,
          objectName: routeName,
          namespace: objectData?.metadata.namespace || namespace,
        },
    title: "Route Events",
    description: "Kubernetes events for this Route in the last 24 hours.",
    resourceKind: OpenShiftKind.Route,
  });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterIdentifier: string = cluster.clusterIdentifier || "";

  const summaryFields: Array<SummaryField> = [
    { title: "Name", value: routeName },
    { title: "Cluster", value: clusterIdentifier },
  ];

  /*
   * One row per router's answer: a Route is admitted by each router on its
   * own, and a rejected one's reason (a host another Route claims) is here.
   */
  const conditions: Array<KubernetesCondition> = (
    objectData?.status.ingress || []
  ).flatMap((router: OpenShiftRouteIngress): Array<KubernetesCondition> => {
    return router.conditions.map(
      (condition: KubernetesCondition): KubernetesCondition => {
        return {
          ...condition,
          type: router.routerName
            ? `${condition.type} (${router.routerName})`
            : condition.type,
        };
      },
    );
  });

  if (objectData) {
    const state: OpenShiftRouteState = getRouteState(objectData.status.ingress);
    const url: string = getRouteUrl(objectData);
    const host: string = getRouteHost(objectData);
    const targets: Array<OpenShiftRouteTarget> = getRouteTargets(objectData);

    summaryFields.push(
      {
        title: "Namespace",
        value: objectData.metadata.namespace ? (
          <KubernetesResourceLink
            modelId={modelId}
            resourceKind="Namespace"
            resourceName={objectData.metadata.namespace}
          />
        ) : (
          "default"
        ),
      },
      {
        title: "State",
        value: <StatusBadge text={state} type={STATE_BADGES[state]} />,
      },
      {
        title: "Host",
        value: url ? (
          <Link
            to={URL.fromString(url)}
            openInNewTab={true}
            className="text-indigo-600 hover:text-indigo-800 font-medium break-all"
          >
            {url}
          </Link>
        ) : (
          host || "N/A"
        ),
      },
      {
        title: targets.length > 1 ? "Services" : "Service",
        value:
          targets.length > 0 ? (
            <div className="space-y-1">
              {targets.map((target: OpenShiftRouteTarget): ReactElement => {
                return (
                  <div key={target.name} className="flex items-center gap-2">
                    <KubernetesResourceLink
                      modelId={modelId}
                      resourceKind={target.kind || "Service"}
                      resourceName={target.name}
                      namespace={objectData.metadata.namespace}
                    />
                    {target.sharePercent !== null && (
                      <span className="text-sm text-gray-600">
                        {`${target.sharePercent}%`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            "N/A"
          ),
      },
      {
        title: "Target Port",
        value: objectData.spec.targetPort || "N/A",
      },
      {
        title: "TLS",
        value: getRouteTlsLabel(objectData.spec.tlsTermination),
      },
    );

    if (objectData.spec.insecureEdgeTerminationPolicy) {
      summaryFields.push({
        title: "Insecure Traffic",
        value: objectData.spec.insecureEdgeTerminationPolicy,
      });
    }

    summaryFields.push({
      title: "Created",
      value: objectData.metadata.creationTimestamp
        ? KubernetesResourceUtils.formatAge(
            objectData.metadata.creationTimestamp,
          )
        : "N/A",
    });
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={objectData?.metadata.labels || {}}
          annotations={objectData?.metadata.annotations || {}}
          conditions={conditions}
          isLoading={isLoadingObject}
        />
      ),
    },
    eventsTab,
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType={OpenShiftResourceType.Routes}
          resourceName={routeName}
          namespace={objectData?.metadata.namespace || namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterOpenShiftRouteDetail;
