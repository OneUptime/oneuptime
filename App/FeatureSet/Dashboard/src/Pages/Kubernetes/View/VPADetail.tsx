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
import { KubernetesVPAObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";

const KubernetesClusterVPADetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const vpaName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] = useState<KubernetesVPAObject | null>(
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
        const obj: KubernetesVPAObject | null =
          await fetchLatestK8sObject<KubernetesVPAObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "verticalpodautoscalers",
            resourceName: vpaName,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, vpaName]);

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
      { title: "Name", value: vpaName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (objectData) {
    const hasRecommendations: boolean =
      objectData.status.recommendation.containerRecommendations.length > 0;

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
        value: objectData.spec.targetRef.kind || "N/A",
      },
      {
        title: "Target Name",
        value: objectData.spec.targetRef.name || "N/A",
      },
      {
        title: "Update Mode",
        value: objectData.spec.updatePolicy.updateMode || "N/A",
      },
      {
        title: "Status",
        value: (
          <StatusBadge
            text={hasRecommendations ? "Active" : "Pending"}
            type={
              hasRecommendations
                ? StatusBadgeType.Success
                : StatusBadgeType.Warning
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

    // Add container recommendations
    if (hasRecommendations) {
      for (const rec of objectData.status.recommendation
        .containerRecommendations) {
        const targetCpu: string = rec.target["cpu"] || "N/A";
        const targetMemory: string = rec.target["memory"] || "N/A";
        summaryFields.push({
          title: `Recommendation (${rec.containerName})`,
          value: `CPU: ${targetCpu}, Memory: ${targetMemory}`,
        });
      }
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
          title="VPA Events"
          description="Kubernetes events for this VPA in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="VerticalPodAutoscaler"
            resourceName={vpaName}
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
          resourceType="verticalpodautoscalers"
          resourceName={vpaName}
          namespace={objectData?.metadata.namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterVPADetail;
