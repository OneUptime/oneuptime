import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import TraceElement from "../Traces/TraceElement";
import SpanStatusElement from "../Span/SpanStatusElement";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  title: string;
  description: string;
  query: Query<ExceptionInstance>;
}

const ExceptionInstanceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const computedQuery: Query<ExceptionInstance> = useMemo(() => {
    const query: Query<ExceptionInstance> = {
      ...(props.query || {}),
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId && !query.projectId) {
      query.projectId = projectId;
    }

    return query;
  }, [props.query]);

  return (
    <AnalyticsModelTable<ExceptionInstance>
      modelType={ExceptionInstance}
      id="exception-instance-table"
      name="ExceptionInstance"
      singularName="Exception"
      pluralName="Exceptions"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      userPreferencesKey="exception-instance-table"
      cardProps={{
        title: props.title,
        description: props.description,
      }}
      query={computedQuery}
      sortBy="time"
      sortOrder={SortOrder.Descending}
      noItemsMessage="No exception instances found."
      showRefreshButton={true}
      showViewIdButton={true}
      filters={[
        {
          field: {
            serviceId: true,
          },
          type: FieldType.Text,
          title: "Telemetry Service",
        },
        {
          field: {
            exceptionType: true,
          },
          type: FieldType.Text,
          title: "Exception Type",
        },
        {
          field: {
            time: true,
          },
          type: FieldType.DateTime,
          title: "Time",
        },
        {
          field: {
            traceId: true,
          },
          type: FieldType.Text,
          title: "Trace ID",
        },
      ]}
      selectMoreFields={{
        spanStatusCode: true,
      }}
      columns={[
        {
          field: {
            time: true,
          },
          title: "Time",
          type: FieldType.DateTime,
        },
        {
          field: {
            serviceId: true,
          },
          title: "Telemetry Service ID",
          type: FieldType.Text,
        },
        {
          field: {
            exceptionType: true,
          },
          title: "Exception Type",
          type: FieldType.Text,
        },
        {
          field: {
            message: true,
          },
          title: "Message",
          type: FieldType.Text,
        },
        {
          field: {
            spanId: true,
          },
          title: "Span",
          type: FieldType.Element,
          getElement: (exceptionInstance: ExceptionInstance): ReactElement => {
            if (!exceptionInstance.spanId) {
              return <Fragment />;
            }

            return (
              <SpanStatusElement
                traceId={exceptionInstance.traceId?.toString()}
                spanStatusCode={exceptionInstance.spanStatusCode || 0}
                title={exceptionInstance.spanId?.toString()}
              />
            );
          },
        },
        {
          field: {
            traceId: true,
          },
          title: "Trace",
          type: FieldType.Element,
          getElement: (exceptionInstance: ExceptionInstance): ReactElement => {
            if (!exceptionInstance.traceId) {
              return <Fragment />;
            }

            return (
              <TraceElement traceId={exceptionInstance.traceId.toString()} />
            );
          },
        },
      ]}
    />
  );
};

export default ExceptionInstanceTable;
