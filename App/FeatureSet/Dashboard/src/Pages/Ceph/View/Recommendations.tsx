import PageComponentProps from "../../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const CephClusterRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setCluster(
        await ModelAPI.getItem({
          modelType: CephCluster,
          id: modelId,
          select: {
            name: true,
          },
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Ceph cluster not found." />;
  }

  return (
    <Fragment>
      {/*
       * CephCluster has no identifier column — the cluster's NAME is the
       * identifier the telemetry carries (`resource.ceph.cluster.name`), and it
       * is what the monitor step form feeds into `clusterIdentifier`.
       */}
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.Ceph}
        resourceIdentifier={cluster.name || ""}
        resourceDisplayName={cluster.name || ""}
      />
    </Fragment>
  );
};

export default CephClusterRecommendations;
