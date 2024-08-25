import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Query from "Common/Types/BaseDatabase/Query";
import DashboardNavigation from "../../Utils/Navigation";
import TelemetryServiceElement from "../TelemetryService/TelemetryServiceElement";
import TelemetryExceptionElement from "./ExceptionElement";

export interface ComponentProps {
  telemetryServiceId?: ObjectID | undefined;
  query: Query<TelemetryException>;
  title: string;
  description: string;
}

const TelemetryExceptionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
        noItemsMessage={"No TelemetryException found for this service."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
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
              isArchived: true,
            },
            title: "Archived",
            type: FieldType.Boolean,
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
