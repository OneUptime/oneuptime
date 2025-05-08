import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Includes from "Common/Types/BaseDatabase/Includes";

export interface ComponentProps {
  telemetryServiceId?: ObjectID | undefined;
  telemetryServiceName?: string | undefined;
}

const MetricsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<MetricType>
        modelType={MetricType}
        id="metrics-table"
        userPreferencesKey="metrics-table"
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
        onViewPage={async (item: MetricType) => {
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
          projectId: ProjectUtil.getCurrentProjectId()!,
          telemetryServices: props.telemetryServiceId
            ? new Includes([props.telemetryServiceId])
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
