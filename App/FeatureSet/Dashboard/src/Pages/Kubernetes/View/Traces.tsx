import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, {
  Fragment,
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
import TracesViewer from "../../../Components/Traces/TracesViewer";
import ProjectUtil from "Common/UI/Utils/Project";
import { keyForKubernetesCluster } from "Common/Utils/Telemetry/EntityKey";

const KubernetesClusterTraces: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
          name: true,
        },
      });

      if (!item?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      setCluster(item);
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

  if (!cluster?.clusterIdentifier) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Fragment>
      {/*
       * entityScope is the query scope (contract C4): new rows match via the
       * bloom-indexed `entityKeys` membership column, pre-column rows (no
       * backfill, empty array) via the attribute equality inside the same OR.
       * `attributeFilters` stays for the read-only scope chip and the
       * histogram / facet scoping — display behavior is unchanged. Drop the
       * attribute fallback (here and in the attributeFilters query merge)
       * once deploy-date + max retention has passed.
       */}
      <TracesViewer
        attributeFilters={{
          "resource.k8s.cluster.name": cluster.clusterIdentifier,
        }}
        attributeFilterDisplayKeys={{
          "resource.k8s.cluster.name": "Cluster",
        }}
        entityScope={{
          entityKeys: [
            keyForKubernetesCluster(
              ProjectUtil.getCurrentProjectId()!.toString(),
              cluster.clusterIdentifier,
            ),
          ],
          attributeKey: "resource.k8s.cluster.name",
          attributeValue: cluster.clusterIdentifier,
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterTraces;
