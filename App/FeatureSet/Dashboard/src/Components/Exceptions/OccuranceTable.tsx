import SpanStatusElement from "../Span/SpanStatusElement";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TraceElement from "../Traces/TraceElement";

export interface ComponentProps {
  exceptionFingerprint: string;
}

const OccouranceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div className="rounded">
        <AnalyticsModelTable<ExceptionInstance>
          userPreferencesKey="exception-instance-table"
          modelType={ExceptionInstance}
          id="traces-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          singularName="Exception"
          pluralName="Exceptions"
          name="Exception"
          isViewable={false}
          cardProps={{
            title: "Exception Occurrences",
            description:
              "View all the traces that are related to this exception.",
          }}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            fingerprint: props.exceptionFingerprint,
          }}
          showViewIdButton={true}
          noItemsMessage={"No exception found."}
          showRefreshButton={true}
          sortBy="time"
          sortOrder={SortOrder.Descending}
          filters={[
            {
              field: {
                traceId: true,
              },
              type: FieldType.Text,
              title: "Trace ID",
            },
            {
              field: {
                spanId: true,
              },
              type: FieldType.Text,
              title: "Span ID",
            },
            {
              field: {
                time: true,
              },
              type: FieldType.DateTime,
              title: "Time of Occurrence",
            },
            {
              field: {
                spanName: true,
              },
              type: FieldType.Text,
              title: "Span Name",
            },
            {
              field: {
                release: true,
              },
              type: FieldType.Text,
              title: "Release",
            },
            {
              field: {
                environment: true,
              },
              type: FieldType.Text,
              title: "Environment",
            },
          ]}
          selectMoreFields={{
            spanStatusCode: true,
          }}
          columns={[
            {
              field: {
                spanId: true,
              },
              title: "Span ID",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <Fragment>
                    <SpanStatusElement
                      traceId={exceptionInstance.traceId?.toString()}
                      spanStatusCode={exceptionInstance.spanStatusCode!}
                      title={exceptionInstance.spanId?.toString()}
                    />
                  </Fragment>
                );
              },
            },
            {
              field: {
                traceId: true,
              },
              title: "Trace ID",
              type: FieldType.Element,
              getElement: (
                exceptionInstance: ExceptionInstance,
              ): ReactElement => {
                return (
                  <Fragment>
                    <TraceElement
                      traceId={exceptionInstance.traceId?.toString()}
                    />
                  </Fragment>
                );
              },
            },
            {
              field: {
                spanName: true,
              },
              title: "Span Name",
              type: FieldType.Text,
            },
            {
              field: {
                release: true,
              },
              title: "Release",
              type: FieldType.Text,
            },
            {
              field: {
                environment: true,
              },
              title: "Environment",
              type: FieldType.Text,
            },
            {
              field: {
                time: true,
              },
              title: "Time of Occurrence",
              type: FieldType.DateTime,
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default OccouranceTable;
