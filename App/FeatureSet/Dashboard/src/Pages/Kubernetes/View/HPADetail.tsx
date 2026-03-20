import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
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
import KubernetesOverviewTab from "../../../Components/Kubernetes/KubernetesOverviewTab";
import KubernetesEventsTab from "../../../Components/Kubernetes/KubernetesEventsTab";
import { KubernetesHPAObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";

const KubernetesClusterHPADetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const hpaName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] =
    useState<KubernetesHPAObject | null>(null);
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
        const obj: KubernetesHPAObject | null =
          await fetchLatestK8sObject<KubernetesHPAObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "horizontalpodautoscalers",
            resourceName: hpaName,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, hpaName]);

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

  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "Name", value: hpaName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (objectData) {
    const currentReplicas: number = objectData.status.currentReplicas;
    const desiredReplicas: number = objectData.status.desiredReplicas;
    const isStable: boolean = currentReplicas === desiredReplicas;

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
        title: "Target Kind",
        value: objectData.spec.scaleTargetRef.kind || "N/A",
      },
      {
        title: "Target Name",
        value: objectData.spec.scaleTargetRef.name || "N/A",
      },
      {
        title: "Min Replicas",
        value: String(objectData.spec.minReplicas),
      },
      {
        title: "Max Replicas",
        value: String(objectData.spec.maxReplicas),
      },
      {
        title: "Current Replicas",
        value: String(currentReplicas),
      },
      {
        title: "Desired Replicas",
        value: String(desiredReplicas),
      },
      {
        title: "Scaling Status",
        value: (
          <StatusBadge
            text={isStable ? "Stable" : "Scaling"}
            type={
              isStable ? StatusBadgeType.Success : StatusBadgeType.Warning
            }
          />
        ),
      },
      {
        title: "Created",
        value: objectData.metadata.creationTimestamp
          ? KubernetesResourceUtils.formatAge(
              objectData.metadata.creationTimestamp,
            )
          : "N/A",
      },
    );

    if (objectData.spec.metrics.length > 0) {
      const metricsDisplay: string = objectData.spec.metrics
        .map((m) => {
          if (m.resourceName) {
            return `${m.resourceName} (${m.targetType}: ${m.targetValue})`;
          }
          return m.type;
        })
        .join(", ");
      summaryFields.push({
        title: "Metrics",
        value: metricsDisplay || "N/A",
      });
    }
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
    {
      name: "Events",
      children: (
        <Card
          title="HPA Events"
          description="Kubernetes events for this HPA in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="HorizontalPodAutoscaler"
            resourceName={hpaName}
            namespace={objectData?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType="horizontalpodautoscalers"
          resourceName={hpaName}
          namespace={objectData?.metadata.namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterHPADetail;
