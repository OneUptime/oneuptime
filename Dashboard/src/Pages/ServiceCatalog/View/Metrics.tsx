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
import ServiceCatalogTelemetryService from "Common/Models/DatabaseModels/ServiceCatalogTelemetryService";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Includes from "Common/Types/BaseDatabase/Includes";

const ServiceCatalogMetrics: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [telemetryServiceIds, setTelemetryServiceIds] =
    useState<Array<ObjectID> | null>(null);
  const [telemetryServices, setTelemetryServices] =
    useState<Array<TelemetryService>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTelemetryServices: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const response: ListResult<ServiceCatalogTelemetryService> =
        await ModelAPI.getList<ServiceCatalogTelemetryService>({
          modelType: ServiceCatalogTelemetryService,
          query: {
            serviceCatalogId: modelId,
          },
          select: {
            telemetryServiceId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        });

      const ids: ObjectID[] = response.data.map(
        (serviceCatalogTelemetryService: ServiceCatalogTelemetryService) => {
          return serviceCatalogTelemetryService.telemetryServiceId!;
        },
      );

      setTelemetryServiceIds(ids);

      if (ids.length === 0) {
        setTelemetryServices([]);
        setIsLoading(false);
        return;
      }

      const telemetryServicesResponse: ListResult<TelemetryService> =
        await ModelAPI.getList<TelemetryService>({
          modelType: TelemetryService,
          query: {
            _id: new Includes(ids),
          },
          select: {
            _id: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        });

      setTelemetryServices(telemetryServicesResponse.data || []);
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

  const singleTelemetryService: TelemetryService | undefined =
    telemetryServiceIds.length === 1
      ? telemetryServices.find((service: TelemetryService) => {
          return service.id?.toString() === telemetryServiceIds[0]?.toString();
        })
      : undefined;

  return (
    <Fragment>
      <MetricsTable
        telemetryServiceIds={telemetryServiceIds}
        telemetryServiceId={
          singleTelemetryService?.id ? singleTelemetryService.id : undefined
        }
        telemetryServiceName={singleTelemetryService?.name}
      />
    </Fragment>
  );
};

export default ServiceCatalogMetrics;
