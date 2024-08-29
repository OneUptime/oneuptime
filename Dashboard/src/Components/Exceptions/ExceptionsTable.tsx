import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import DashboardNavigation from "../../Utils/Navigation";
import TelemetryServiceElement from "../TelemetryService/TelemetryServiceElement";
import TelemetryExceptionElement from "./ExceptionElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import PageMap from "../../Utils/PageMap";
import User from "Common/Models/DatabaseModels/User";

export interface ComponentProps {
  telemetryServiceId?: ObjectID | undefined;
  query: Query<TelemetryException>;
  title: string;
  description: string;
}

const TelemetryExceptionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TELEMETRY_EXCEPTIONS_ROOT]!,
  );

  if (props.telemetryServiceId) {
    viewRoute = RouteUtil.populateRouteParams(
      RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_EXCEPTIONS]!,
      {
        modelId: props.telemetryServiceId,
      },
    );
  }

  return (
    <Fragment>
      <ModelTable<TelemetryException>
        modelType={TelemetryException}
        id="TelemetryException-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        singularName="Exception"
        pluralName="Exceptions"
        name="TelemetryException"
        isViewable={true}
        sortBy="lastSeenAt"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: props.title,
          description: props.description,
        }}
        query={{
          projectId: DashboardNavigation.getProjectId()!,
          telemetryServiceId: props.telemetryServiceId
            ? props.telemetryServiceId
            : undefined,
          ...props.query,
        }}
        showViewIdButton={false}
        noItemsMessage={"No exceptions found."}
        showRefreshButton={true}
        viewPageRoute={viewRoute}
        filters={[
          {
            field: {
              message: true,
            },
            title: "Exception Message",
            type: FieldType.Text,
          },
          {
            field: {
              stackTrace: true,
            },
            title: "Stack Trace",
            type: FieldType.Text,
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen At",
            type: FieldType.DateTime,
          },
          {
            field: {
              firstSeenAt: true,
            },
            title: "First Seen At",
            type: FieldType.DateTime,
          },
          {
            field: {
              isResolved: true,
            },
            title: "Resolved",
            type: FieldType.Boolean,
          },
          {
            field: {
              markedAsResolvedAt: true,
            },
            title: "Marked As Resolved At",
            type: FieldType.Date,
          },
          {
            field: {
              markedAsResolvedByUser: true,
            },
            title: "Marked As Resolved At",
            type: FieldType.EntityArray,
            filterEntityType: User,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              isArchived: true,
            },
            title: "Archived",
            type: FieldType.Boolean,
          },
          {
            field: {
              markedAsArchivedAt: true,
            },
            title: "Marked As Archived At",
            type: FieldType.Date,
          },
          {
            field: {
              markedAsArchivedByUser: true,
            },
            title: "Marked As Archived At",
            type: FieldType.EntityArray,
            filterEntityType: User,
            filterQuery: {
              projectId: DashboardNavigation.getProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        selectMoreFields={{
          isResolved: true,
          isArchived: true,
          exceptionType: true,
        }}
        columns={[
          {
            field: {
              message: true,
            },
            title: "Exception Message",
            type: FieldType.Element,
            getElement: (exception: TelemetryException) => {
              return (
                <TelemetryExceptionElement
                  message={exception.message || exception.exceptionType || ""}
                  isResolved={exception.isResolved || false}
                  isArchived={exception.isArchived || false}
                />
              );
            },
          },
          {
            field: {
              telemetryService: {
                name: true,
                serviceColor: true,
              },
            },
            title: "Service",
            type: FieldType.Entity,
            getElement: (exception: TelemetryException) => {
              if (!exception.telemetryService) {
                // this should never happen.
                return <div>Unknown</div>;
              }

              return (
                <TelemetryServiceElement
                  telemetryService={exception.telemetryService!}
                />
              );
            },
          },
          {
            field: {
              lastSeenAt: true,
            },
            title: "Last Seen At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default TelemetryExceptionTable;
