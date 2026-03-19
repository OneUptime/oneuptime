import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
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
import {
  fetchK8sObjectsBatch,
  KubernetesObjectType,
} from "../Utils/KubernetesObjectFetcher";
import { KubernetesPVObject } from "../Utils/KubernetesObjectParser";

const KubernetesClusterPVs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const cluster: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });

      if (!cluster?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const pvObjects: Map<string, KubernetesObjectType> =
        await fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "persistentvolumes",
        });

      const pvResources: Array<KubernetesResource> = [];

      for (const pvObj of pvObjects.values()) {
        const pv: KubernetesPVObject = pvObj as KubernetesPVObject;
        pvResources.push({
          name: pv.metadata.name,
          namespace: "",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: pv.status.phase || "Unknown",
          age: KubernetesResourceUtils.formatAge(
            pv.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            capacity: pv.spec.capacity.storage || "N/A",
            storageClass: pv.spec.storageClassName || "N/A",
            reclaimPolicy: pv.spec.persistentVolumeReclaimPolicy || "N/A",
            claimRef: pv.spec.claimRef.name
              ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}`
              : "N/A",
          },
        });
      }

      setResources(pvResources);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <KubernetesResourceTable
      title="Persistent Volumes"
      description="All PVs in this cluster with their current status."
      resources={resources}
      showNamespace={false}
      showResourceMetrics={false}
      columns={[
        {
          title: "Capacity",
          key: "capacity",
        },
        {
          title: "Storage Class",
          key: "storageClass",
        },
        {
          title: "Reclaim Policy",
          key: "reclaimPolicy",
        },
        {
          title: "Claim",
          key: "claimRef",
        },
      ]}
      emptyMessage="No PVs found. PV data will appear here once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes persistentvolumes."
    />
  );
};

export default KubernetesClusterPVs;
