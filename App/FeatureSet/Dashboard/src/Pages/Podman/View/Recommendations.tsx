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
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const PodmanHostRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<PodmanHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setHost(
        await ModelAPI.getItem({
          modelType: PodmanHost,
          id: modelId,
          select: {
            name: true,
            hostIdentifier: true,
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

  if (!host) {
    return <ErrorMessage message="Podman host not found." />;
  }

  return (
    <Fragment>
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.Podman}
        resourceIdentifier={host.hostIdentifier || ""}
        resourceDisplayName={host.name || host.hostIdentifier || ""}
      />
    </Fragment>
  );
};

export default PodmanHostRecommendations;
