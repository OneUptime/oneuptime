import MetricsViewer from "../../../Components/Metrics/MetricsViewer";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

const ServiceMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [serviceName, setServiceName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Load the service name so telemetry can be scoped by the `service.name`
   * attribute rather than the service id — consistent with how the Host /
   * Kubernetes metric views scope by their resource attribute.
   */
  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: Service | null = await ModelAPI.getItem({
        modelType: Service,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Service not found.");
        setIsLoading(false);
        return;
      }

      setServiceName(item.name.toString());
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

  if (!serviceName) {
    return <ErrorMessage message="Service not found." />;
  }

  return (
    <Fragment>
      {/*
       * Scope by the OTel `service.name` resource attribute (stored as
       * `resource.service.name` at ingest), consistent with how the Host
       * (`resource.host.name`), Kubernetes (`resource.k8s.cluster.name`),
       * Podman, etc. metric views scope by their own resource attribute. This
       * single filter drives the metric-name list, the per-row sparklines, the
       * read-only "Service" chip, and — via row-click propagation — the metric
       * detail chart. `Service.name` is the value the service reports as
       * `service.name`.
       */}
      <MetricsViewer
        attributeFilters={{
          "resource.service.name": serviceName,
        }}
        attributeFilterDisplayKeys={{
          "resource.service.name": "Service",
        }}
        serviceIdsToDisplay={[modelId]}
      />
    </Fragment>
  );
};

export default ServiceMetrics;
