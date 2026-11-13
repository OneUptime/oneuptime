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
  /*
   * The title and description of the card the table is drawn in. A table
   * drawn without a card (isMinimalTable) shows neither.
   */
  title?: string | undefined;
  description?: string | undefined;
  query: Query<ExceptionInstance>;
  // Rendered in the card header, e.g. the snapshot window an incident is scoped to.
  rightElement?: ReactElement | undefined;
  /*
   * Set by hosts that pin the query to a fixed window (incident / alert
   * previews). Without it the table restores a "Time" filter from the URL on
   * mount, which replaces the pinned window with an unrelated one and gives no
   * sign it happened.
   */
  disableUrlState?: boolean | undefined;
  /*
   * The table on its own, framed, with no card round it - as TraceTable's
   * isMinimalTable is: for the Exceptions monitor's preview, which the fold
   * it sits in already names ("Matching exceptions"). In a card it was a
   * second "Matching exceptions" header under the fold's own, and in Create
   * Monitor's criteria step that card was drawn as a section of the step
   * (CardFormSections): a rule and a title in the middle of "Exceptions to
   * watch", its rows unframed, where the Logs and Traces monitors show a
   * framed list.
   */
  isMinimalTable?: boolean | undefined;
  // What the table says when no exception matches its query.
  noItemsMessage?: string | undefined;
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
      disableUrlState={props.disableUrlState}
      cardProps={
        props.isMinimalTable
          ? undefined
          : {
              title: props.title || "",
              description: props.description,
              rightElement: props.rightElement,
            }
      }
      query={computedQuery}
      sortBy="time"
      sortOrder={SortOrder.Descending}
      noItemsMessage={props.noItemsMessage || "No exception instances found."}
      showRefreshButton={true}
      showViewIdButton={true}
      filters={[
        {
          field: {
            primaryEntityId: true,
          },
          type: FieldType.Text,
          title: "Service",
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
            primaryEntityId: true,
          },
          title: "Service ID",
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
                plainLabel={true}
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
