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
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const KubernetesClusterRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setCluster(
        await ModelAPI.getItem({
          modelType: KubernetesCluster,
          id: modelId,
          select: {
            name: true,
            clusterIdentifier: true,
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
    return <ErrorMessage message="Kubernetes cluster not found." />;
  }

  return (
    <Fragment>
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.Kubernetes}
        resourceIdentifier={cluster.clusterIdentifier || ""}
        resourceDisplayName={cluster.name || cluster.clusterIdentifier || ""}
      />
    </Fragment>
  );
};

export default KubernetesClusterRecommendations;
