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
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const ProxmoxClusterRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setCluster(
        await ModelAPI.getItem({
          modelType: ProxmoxCluster,
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
    return <ErrorMessage message="Proxmox cluster not found." />;
  }

  return (
    <Fragment>
      {/*
       * ProxmoxCluster has no identifier column — the cluster's NAME is the
       * identifier the telemetry carries (`resource.proxmox.cluster.name`), and
       * it is what the monitor step form feeds into `clusterIdentifier`.
       */}
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.Proxmox}
        resourceIdentifier={cluster.name || ""}
        resourceDisplayName={cluster.name || ""}
      />
    </Fragment>
  );
};

export default ProxmoxClusterRecommendations;
