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
import MetricsViewer from "../../../Components/Metrics/MetricsViewer";

const IoTFleetMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: IoTFleet | null = await ModelAPI.getItem({
        modelType: IoTFleet,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Fleet not found.");
        setIsLoading(false);
        return;
      }

      setFleet(item);
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

  if (!fleet?.name) {
    return <ErrorMessage message="Fleet not found." />;
  }

  return (
    <Fragment>
      {/*
       * `attributeFilters` scopes the metric query to this fleet via the
       * `iot.fleet.name` resource attribute that the IoT agent stamps on every
       * telemetry record, and also drives the read-only scope chip and the
       * metric-name / sparkline scoping.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.iot.fleet.name": fleet.name,
        }}
        attributeFilterDisplayKeys={{
          "resource.iot.fleet.name": "Fleet",
        }}
      />
    </Fragment>
  );
};

export default IoTFleetMetrics;
