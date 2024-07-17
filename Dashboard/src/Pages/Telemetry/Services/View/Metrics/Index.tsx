import DashboardNavigation from "../../../../../Utils/Navigation";
import PageComponentProps from "../../../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelTable from "CommonUI/src/Components/ModelTable/AnalyticsModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Metric from "Model/AnalyticsModels/Metric";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import RouteMap, { RouteUtil } from "../../../../../Utils/RouteMap";
import PageMap from "../../../../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import TelemetryService from "Model/Models/TelemetryService";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import API from "CommonUI/src/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

const ServiceDelete: FunctionComponent<
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
    <Fragment>
      <AnalyticsModelTable<Metric>
        modelType={Metric}
        id="metrics-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        singularName="Metric"
        pluralName="Metrics"
        name="Metrics"
        isViewable={true}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: "Metrics",
          description:
            "Metrics are the individual data points that make up a service. They are the building blocks of a service and represent the work done by a single service.",
        }}
        groupBy={{
          name: true,
        }}
        onViewPage={async (item: Metric) => {
          const route: Route = RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_METRIC]!,
            {
              modelId: modelId,
            },
          );

          const currentUrl: URL = Navigation.getCurrentURL();

          return new URL(
            currentUrl.protocol,
            currentUrl.hostname,
            route,
            `metricName=${item.name}&serviceName=${telemetryService.name}`,
          );
        }}
        query={{
          projectId: DashboardNavigation.getProjectId(),
          serviceId: modelId,
        }}
        showViewIdButton={false}
        noItemsMessage={"No metrics found for this service."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              attributes: true,
            },
            type: FieldType.JSON,
            title: "Attributes",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default ServiceDelete;
