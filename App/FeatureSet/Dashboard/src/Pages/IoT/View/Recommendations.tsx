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
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import MonitorRecommendations from "../../../Components/MonitorRecommendations/MonitorRecommendations";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

const IoTFleetRecommendations: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useAsyncEffect(async () => {
    setIsLoading(true);

    try {
      setFleet(
        await ModelAPI.getItem({
          modelType: IoTFleet,
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

  if (!fleet) {
    return <ErrorMessage message="IoT fleet not found." />;
  }

  return (
    <Fragment>
      {/*
       * IoTFleet has no identifier column — the fleet's NAME is the identifier
       * the telemetry carries (`resource.iot.fleet.name`), and it is what the
       * monitor step form feeds into `fleetIdentifier`.
       */}
      <MonitorRecommendations
        resourceType={MonitorRecommendationResourceType.IoTDevice}
        resourceIdentifier={fleet.name || ""}
        resourceDisplayName={fleet.name || ""}
      />
    </Fragment>
  );
};

export default IoTFleetRecommendations;
