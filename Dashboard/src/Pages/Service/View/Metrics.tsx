import MetricsTable from "../../../Components/Metrics/MetricsTable";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ServiceTelemetryService from "Common/Models/DatabaseModels/ServiceTelemetryService";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";

const ServiceMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [telemetryServiceIds, setTelemetryServiceIds] =
    useState<Array<ObjectID> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetryServices: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);
        const response: ListResult<ServiceTelemetryService> =
          await ModelAPI.getList<ServiceTelemetryService>({
            modelType: ServiceTelemetryService,
            query: {
              serviceId: modelId,
            },
            select: {
              telemetryServiceId: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {},
          });

        const ids: ObjectID[] = response.data.map(
          (serviceTelemetryService: ServiceTelemetryService) => {
            return serviceTelemetryService.telemetryServiceId!;
          },
        );

        setTelemetryServiceIds(ids);
        setIsLoading(false);
      } catch (err) {
        setIsLoading(false);
        setError(API.getFriendlyMessage(err));
      }
    };

  useEffect(() => {
    fetchTelemetryServices().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading || telemetryServiceIds === null) {
    return <PageLoader isVisible={true} />;
  }

  if (telemetryServiceIds.length === 0) {
    return (
      <ErrorMessage message="Assign telemetry services to this service to view metrics." />
    );
  }
  return (
    <Fragment>
      <MetricsTable telemetryServiceIds={telemetryServiceIds} />
    </Fragment>
  );
};

export default ServiceMetrics;
