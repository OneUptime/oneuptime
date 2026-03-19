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
import { KubernetesPVObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";

const KubernetesClusterPVDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const pvName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [pvObject, setPvObject] = useState<KubernetesPVObject | null>(null);
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

    const fetchPvObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesPVObject | null =
          await fetchLatestK8sObject<KubernetesPVObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "persistentvolumes",
            resourceName: pvName,
          });
        setPvObject(obj);
      } catch {
        // Graceful degradation
      }
      setIsLoadingObject(false);
    };

    fetchPvObject().catch(() => {});
  }, [cluster?.clusterIdentifier, pvName]);

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
    { title: "PV Name", value: pvName },
    { title: "Cluster", value: clusterIdentifier },
  ];

  if (pvObject) {
    summaryFields.push(
      {
        title: "Status",
        value: (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              pvObject.status.phase === "Bound" ||
              pvObject.status.phase === "Available"
                ? "bg-green-50 text-green-700"
                : pvObject.status.phase === "Released"
                  ? "bg-yellow-50 text-yellow-700"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {pvObject.status.phase || "Unknown"}
          </span>
        ),
      },
      {
        title: "Capacity",
        value: pvObject.spec.capacity.storage || "N/A",
      },
      {
        title: "Storage Class",
        value: pvObject.spec.storageClassName || "N/A",
      },
      {
        title: "Reclaim Policy",
        value: pvObject.spec.persistentVolumeReclaimPolicy || "N/A",
      },
      {
        title: "Access Modes",
        value: pvObject.spec.accessModes.join(", ") || "N/A",
      },
      {
        title: "Claim",
        value: pvObject.spec.claimRef.name
          ? `${pvObject.spec.claimRef.namespace}/${pvObject.spec.claimRef.name}`
          : "N/A",
      },
      {
        title: "Created",
        value: pvObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={pvObject?.metadata.labels || {}}
          annotations={pvObject?.metadata.annotations || {}}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="PV Events"
          description="Kubernetes events for this PV in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="PersistentVolume"
            resourceName={pvName}
          />
        </Card>
      ),
    },
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType="persistentvolumes"
          resourceName={pvName}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterPVDetail;
