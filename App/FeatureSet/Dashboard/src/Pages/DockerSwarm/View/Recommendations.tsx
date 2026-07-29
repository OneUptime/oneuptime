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
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const DockerSwarmClusterRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setCluster(
        await ModelAPI.getItem({
          modelType: DockerSwarmCluster,
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
    return <ErrorMessage message="Docker Swarm cluster not found." />;
  }

  return (
    <Fragment>
      {/*
       * DockerSwarmCluster has no identifier column. The cluster's NAME is the
       * identifier: the agent stamps `docker.swarm.cluster.name` as a resource
       * attribute, the ingest-side resolver keys the cluster off it, and the
       * monitor step form feeds `cluster.name` into `clusterIdentifier`. Using
       * anything else here would scope monitors to a value no telemetry carries
       * and silently match nothing.
       */}
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.DockerSwarm}
        resourceIdentifier={cluster.name || ""}
        resourceDisplayName={cluster.name || ""}
      />
    </Fragment>
  );
};

export default DockerSwarmClusterRecommendations;
