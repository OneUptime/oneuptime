import SpanStatusElement from "../Span/SpanStatusElement";
import DashboardNavigation from "../../Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";
import AnalyticsModelTable from "CommonUI/src/Components/ModelTable/AnalyticsModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import Span, { SpanKind, SpanStatus } from "Model/AnalyticsModels/Span";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";

export interface ComponentProps {
  modelId?: ObjectID | undefined;
}

const TraceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID | undefined = props.modelId;

  const spanKindDropdownOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(SpanKind);

  let viewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TELEMETRY_TRACE_ROOT]!,
  );

  if (modelId) {
    viewRoute = RouteUtil.populateRouteParams(
      RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_TRACES]!,
      {
        modelId: modelId,
      },
    );
  }

  return (
    <Fragment>
      <AnalyticsModelTable<Span>
        modelType={Span}
        id="traces-table"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        singularName="Trace"
        pluralName="Traces"
        name="Traces"
        isViewable={true}
        cardProps={{
          title: "Traces",
          description:
            "Traces are the individual spans that make up a request. They are the building blocks of a trace and represent the work done by a single service.",
        }}
        query={{
          projectId: DashboardNavigation.getProjectId(),
          serviceId: modelId ? modelId : undefined,
        }}
        showViewIdButton={true}
        noItemsMessage={"No traces found for this service."}
        showRefreshButton={true}
        sortBy="startTime"
        sortOrder={SortOrder.Descending}
        onViewPage={(span: Span) => {
          return Promise.resolve(
            new Route(viewRoute.toString()).addRoute(span.traceId!.toString()),
          );
        }}
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
              statusCode: true,
            },
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              SpanStatus,
              true,
            ).filter((dropdownOption: DropdownOption) => {
              return (
                dropdownOption.label === "Unset" ||
                dropdownOption.label === "Ok" ||
                dropdownOption.label === "Error"
              );
            }),
            title: "Span Status",
          },
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Root Span Name",
          },
          {
            field: {
              kind: true,
            },
            type: FieldType.Text,
            title: "Root Span Kind",
            filterDropdownOptions: spanKindDropdownOptions,
          },
          {
            field: {
              startTime: true,
            },
            type: FieldType.DateTime,
            title: "Seen At",
          },
          {
            field: {
              attributes: true,
            },
            type: FieldType.JSON,
            title: "Attributes",
          },
        ]}
        selectMoreFields={{
          statusCode: true,
        }}
        columns={[
          {
            field: {
              spanId: true,
            },
            title: "Span ID",
            type: FieldType.Element,
            getElement: (span: Span): ReactElement => {
              return (
                <Fragment>
                  <SpanStatusElement
                    span={span}
                    title={span.spanId?.toString()}
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
            type: FieldType.Text,
          },
          {
            field: {
              name: true,
            },
            title: "Span Name",
            type: FieldType.Text,
          },
          {
            field: {
              startTime: true,
            },
            title: "Seen At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default TraceTable;
