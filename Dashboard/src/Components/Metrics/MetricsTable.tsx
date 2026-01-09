import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Service from "Common/Models/DatabaseModels/Service";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Includes from "Common/Types/BaseDatabase/Includes";
import ServicesElement from "../Service/ServiceElements";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

export interface ComponentProps {
  serviceIds?: Array<ObjectID> | undefined;
}

const MetricsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const serviceFilterIds: Array<ObjectID> =
    props.serviceIds || [];

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

          if (serviceFilterIds.length === 1) {
            const serviceId: ObjectID | undefined =
              serviceFilterIds[0];

            const serviceIdString: string | undefined =
              serviceId?.toString();

            if (serviceIdString) {
              metricAttributes["oneuptime.service.id"] = serviceIdString;

              const matchingService: Service | undefined = (
                item.services || []
              ).find((service: Service) => {
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
          services:
            serviceFilterIds.length > 0
              ? new Includes(serviceFilterIds)
              : undefined,
        }}
        selectMoreFields={{
          services: {
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
              services: {
                name: true,
              },
            },
            title: "Service",
            type: FieldType.EntityArray,
            filterEntityType: Service,
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
              services: {
                name: true,
                _id: true,
                serviceColor: true,
              },
            },
            title: "Services",
            type: FieldType.Element,
            getElement: (item: MetricType): ReactElement => {
              return (
                <ServicesElement
                  telemetryServices={item.services || []}
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
