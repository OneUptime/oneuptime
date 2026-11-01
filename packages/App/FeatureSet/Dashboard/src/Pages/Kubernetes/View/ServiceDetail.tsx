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
import KubernetesOverviewTab, {
  SummaryField,
} from "../../../Components/Kubernetes/KubernetesOverviewTab";
import { useKubernetesEventsTab } from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesLabelSelector from "../../../Components/Kubernetes/KubernetesLabelSelector";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";
import {
  KubernetesObjectType,
  fetchK8sObjectsBatch,
  fetchLatestK8sObject,
} from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import { KubernetesServiceObject } from "../Utils/KubernetesObjectParser";
import {
  OpenShiftKind,
  OpenShiftResourceType,
  OpenShiftRouteObject,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import {
  getServicePortsLabel,
  isRouteToService,
} from "../Utils/KubernetesOpenShiftResources";

const KubernetesClusterServiceDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const serviceName: string = Navigation.getLastParamAsString();
  // Services of one name repeat across namespaces: the list says which.
  const namespace: string | undefined =
    Navigation.getQueryStringByName("namespace") || undefined;

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] = useState<KubernetesServiceObject | null>(
    null,
  );
  const [routes, setRoutes] = useState<Array<OpenShiftRouteObject>>([]);
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
        const [service, allRoutes]: [
          KubernetesServiceObject | null,
          Map<string, KubernetesObjectType>,
        ] = await Promise.all([
          fetchLatestK8sObject<KubernetesServiceObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "services",
            resourceName: serviceName,
            namespace: namespace,
          }),
          fetchK8sObjectsBatch({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: OpenShiftResourceType.Routes,
          }),
        ]);

        setObjectData(service);

        if (service) {
          setRoutes(
            Array.from(allRoutes.values())
              .map((route: KubernetesObjectType): OpenShiftRouteObject => {
                return route as OpenShiftRouteObject;
              })
              .filter((route: OpenShiftRouteObject): boolean => {
                return isRouteToService(route, service);
              }),
          );
        }
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, serviceName, namespace]);

  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "object",
          objectKind: "Service",
          objectName: serviceName,
          namespace: objectData?.metadata.namespace || namespace,
        },
    title: "Service Events",
    description: "Kubernetes events for this Service in the last 24 hours.",
    resourceKind: "Service",
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
    { title: "Name", value: serviceName },
    { title: "Cluster", value: clusterIdentifier },
  ];

  if (objectData) {
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
        title: "Type",
        value: objectData.spec.type || "N/A",
      },
    );

    if (objectData.spec.externalName) {
      summaryFields.push({
        title: "External Name",
        value: objectData.spec.externalName,
      });
    } else {
      summaryFields.push({
        title: "Cluster IP",
        value: objectData.spec.clusterIP || "N/A",
      });
    }

    summaryFields.push({
      title: "Ports",
      value: getServicePortsLabel(objectData.spec.ports) || "N/A",
    });

    if (objectData.status.loadBalancerIngress.length > 0) {
      summaryFields.push({
        title: "Load Balancer",
        value: objectData.status.loadBalancerIngress.join(", "),
      });
    }

    summaryFields.push({
      title: "Selector",
      value: <KubernetesLabelSelector selector={objectData.spec.selector} />,
    });

    if (routes.length > 0) {
      summaryFields.push({
        title: "Routes",
        value: (
          <div className="space-y-1">
            {routes.map((route: OpenShiftRouteObject): ReactElement => {
              return (
                <div key={route.metadata.name}>
                  <KubernetesResourceLink
                    modelId={modelId}
                    resourceKind={OpenShiftKind.Route}
                    resourceName={route.metadata.name}
                    namespace={route.metadata.namespace}
                  />
                </div>
              );
            })}
          </div>
        ),
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
          resourceType="services"
          resourceName={serviceName}
          namespace={objectData?.metadata.namespace || namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterServiceDetail;
