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
import { KubernetesPVCObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";

const KubernetesClusterPVCDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const pvcName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [pvcObject, setPvcObject] = useState<KubernetesPVCObject | null>(null);
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

    const fetchPvcObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesPVCObject | null =
          await fetchLatestK8sObject<KubernetesPVCObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "persistentvolumeclaims",
            resourceName: pvcName,
          });
        setPvcObject(obj);
      } catch {
        // Graceful degradation
      }
      setIsLoadingObject(false);
    };

    fetchPvcObject().catch(() => {});
  }, [cluster?.clusterIdentifier, pvcName]);

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

  const summaryFields: Array<{
    title: string;
    value: string | ReactElement;
  }> = [
    { title: "PVC Name", value: pvcName },
    { title: "Cluster", value: clusterIdentifier },
  ];

  if (pvcObject) {
    summaryFields.push(
      {
        title: "Namespace",
        value: pvcObject.metadata.namespace || "default",
      },
      {
        title: "Status",
        value: (
          <StatusBadge
            text={pvcObject.status.phase || "Unknown"}
            type={
              pvcObject.status.phase === "Bound"
                ? StatusBadgeType.Success
                : pvcObject.status.phase === "Pending"
                  ? StatusBadgeType.Warning
                  : StatusBadgeType.Danger
            }
          />
        ),
      },
      {
        title: "Storage Class",
        value: pvcObject.spec.storageClassName || "N/A",
      },
      {
        title: "Capacity",
        value: pvcObject.status.capacity.storage || "N/A",
      },
      {
        title: "Requested Storage",
        value: pvcObject.spec.resources.requests.storage || "N/A",
      },
      {
        title: "Volume Name",
        value: pvcObject.spec.volumeName || "N/A",
      },
      {
        title: "Access Modes",
        value: pvcObject.spec.accessModes.join(", ") || "N/A",
      },
      {
        title: "Created",
        value: pvcObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={pvcObject?.metadata.labels || {}}
          annotations={pvcObject?.metadata.annotations || {}}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="PVC Events"
          description="Kubernetes events for this PVC in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="PersistentVolumeClaim"
            resourceName={pvcName}
            namespace={pvcObject?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType="persistentvolumeclaims"
          resourceName={pvcName}
          namespace={pvcObject?.metadata.namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterPVCDetail;
