import PageComponentProps from "../../../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryService from "Model/Models/TelemetryService";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import API from "CommonUI/src/Utils/API/API";
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
    return <ErrorMessage error={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!telemetryService) {
    return <ErrorMessage error="Telemetry Service not found." />;
  }

  return (
    <MetricsTable
      telemetryServiceId={telemetryService.id!}
      telemetryServiceName={telemetryService.name!}
    />
  );
};

export default MetricsTablePage;
