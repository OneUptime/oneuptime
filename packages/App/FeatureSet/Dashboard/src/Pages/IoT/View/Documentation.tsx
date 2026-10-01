import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
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
import IoTDocumentationCard from "../../../Components/IoT/DocumentationCard";

const IoTFleetDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchFleet: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: IoTFleet | null = await ModelAPI.getItem({
        modelType: IoTFleet,
        id: modelId,
        select: {
          name: true,
        },
      });
      setFleet(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchFleet().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!fleet) {
    return <ErrorMessage message="Fleet not found." />;
  }

  return (
    <Fragment>
      <IoTDocumentationCard
        title="Connect Your IoT Fleet"
        description={`Send readings to this fleet (${fleet.name}) with OpenTelemetry or MQTT — use its name as the fleet name in the steps below so the data lands here.`}
      />
    </Fragment>
  );
};

export default IoTFleetDocumentation;
