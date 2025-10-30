import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Includes from "Common/Types/BaseDatabase/Includes";
import TelemetryServicesElement from "../TelemetryService/TelemetryServiceElements";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

export interface ComponentProps {
  telemetryServiceIds?: Array<ObjectID> | undefined;
}

const MetricsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const telemetryServiceFilterIds: Array<ObjectID> =
    props.telemetryServiceIds || [];

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
          const route: Route = RouteUtil.populateRouteParams(
            RouteMap[PageMap.TELEMETRY_METRIC_VIEW]!,
          );

          const currentUrl: URL = Navigation.getCurrentURL();
          const metricUrl: URL = new URL(
            currentUrl.protocol,
            currentUrl.hostname,
            route,
          );

          const metricAttributes: Record<string, string> = {};

          if (telemetryServiceFilterIds.length === 1) {
            const telemetryServiceId: ObjectID | undefined =
              telemetryServiceFilterIds[0];

            const serviceIdString: string | undefined =
              telemetryServiceId?.toString();

            if (serviceIdString) {
              metricAttributes["oneuptime.service.id"] = serviceIdString;

              const matchingService: TelemetryService | undefined = (
                item.telemetryServices || []
              ).find((service: TelemetryService) => {
                return service._id?.toString() === serviceIdString;
              });

              if (matchingService?.name) {
                metricAttributes["oneuptime.service.name"] =
                  matchingService.name;
              }
            }
          }

          const metricQueriesPayload: Array<Record<string, unknown>> = [
            {
              metricName: item.name || "",
              ...(Object.keys(metricAttributes).length > 0
                ? { attributes: metricAttributes }
                : {}),
              aggregationType: MetricsAggregationType.Avg,
            },
          ];

          metricUrl.addQueryParam(
            "metricQueries",
            JSON.stringify(metricQueriesPayload),
            true,
          );

          return metricUrl;
        }}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          telemetryServices:
            telemetryServiceFilterIds.length > 0
              ? new Includes(telemetryServiceFilterIds)
              : undefined,
        }}
        selectMoreFields={{
          telemetryServices: {
            _id: true,
            name: true,
            serviceColor: true,
          },
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
              telemetryServices: {
                name: true,
              },
            },
            title: "Telemetry Service",
            type: FieldType.EntityArray,
            filterEntityType: TelemetryService,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
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
          {
            field: {
              telemetryServices: {
                name: true,
                _id: true,
                serviceColor: true,
              },
            },
            title: "Telemetry Services",
            type: FieldType.Element,
            getElement: (item: MetricType): ReactElement => {
              return (
                <TelemetryServicesElement
                  telemetryServices={item.telemetryServices || []}
                />
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default MetricsTable;
