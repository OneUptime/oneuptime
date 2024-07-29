import DashboardNavigation from "../../Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelTable from "CommonUI/src/Components/ModelTable/AnalyticsModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import Metric from "Model/AnalyticsModels/Metric";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/Utils/API";
import { APP_API_URL } from "CommonUI/src/Config";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  telemetryServiceId?: ObjectID | undefined;
  telemetryServiceName?: string | undefined;
}

const MetricsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [attributes, setAttributes] = React.useState<Array<string>>([]);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

      const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post(
          URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/metrics/get-attributes",
          ),
          {},
          {
            ...ModelAPI.getCommonHeaders(),
          },
        );

      if (attributeRepsonse instanceof HTTPErrorResponse) {
        throw attributeRepsonse;
      } else {
        const attributes: Array<string> = attributeRepsonse.data[
          "attributes"
        ] as Array<string>;
        setAttributes(attributes);
      }

      setIsPageLoading(false);
      setPageError("");
    } catch (err) {
      setIsPageLoading(false);
      setPageError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  useEffect(() => {
    loadAttributes().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage error={pageError} />;
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
          if (!props.telemetryServiceId || !props.telemetryServiceName) {
            const route: Route = RouteUtil.populateRouteParams(
              RouteMap[PageMap.TELEMETRY_METRIC_VIEW]!,
            );

            const currentUrl: URL = Navigation.getCurrentURL();

            return new URL(
              currentUrl.protocol,
              currentUrl.hostname,
              route,
              `metricName=${item.name}`,
            );
          }

          const route: Route = RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_METRIC]!,
            {
              modelId: props.telemetryServiceId,
            },
          );

          const currentUrl: URL = Navigation.getCurrentURL();

          return new URL(
            currentUrl.protocol,
            currentUrl.hostname,
            route,
            `metricName=${item.name}&serviceName=${props.telemetryServiceName}`,
          );
        }}
        query={{
          projectId: DashboardNavigation.getProjectId(),
          serviceId: props.telemetryServiceId
            ? props.telemetryServiceId
            : undefined,
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
            jsonKeys: attributes,
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

export default MetricsTable;
