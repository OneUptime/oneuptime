import PageComponentProps from "../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricsTable from "../../../../../Components/Metrics/MetricsTable";

const MetricsTablePage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [telemetryService, setTelemetryService] =
    useState<TelemetryService | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    fetchTelemetryService().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const fetchTelemetryService: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);

        const telemetryService: TelemetryService | null =
          await ModelAPI.getItem({
            modelType: TelemetryService,
            id: modelId,
            select: {
              name: true,
            },
          });

        if (!telemetryService) {
          setIsLoading(false);
          setError("Telemetry Service not found.");
          return;
        }

        setTelemetryService(telemetryService);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    };

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!telemetryService) {
    return <ErrorMessage message="Telemetry Service not found." />;
  }

  return <MetricsTable telemetryServiceIds={[telemetryService.id!]} />;
};

export default MetricsTablePage;
