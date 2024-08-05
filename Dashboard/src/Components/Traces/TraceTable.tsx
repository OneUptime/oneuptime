import SpanStatusElement from "../Span/SpanStatusElement";
import DashboardNavigation from "../../Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "CommonUI/src/Components/Dropdown/Dropdown";
import AnalyticsModelTable from "CommonUI/src/Components/ModelTable/AnalyticsModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import DropdownUtil from "CommonUI/src/Utils/Dropdown";
import Span, {
  SpanKind,
  SpanStatus,
} from "Common/Models/AnalyticsModels/Span";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/Utils/API";
import { APP_API_URL } from "CommonUI/src/Config";
import URL from "Common/Types/API/URL";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import PageLoader from "CommonUI/src/Components/Loader/PageLoader";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  modelId?: ObjectID | undefined;
}

const TraceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID | undefined = props.modelId;

  const [attributes, setAttributes] = React.useState<Array<string>>([]);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

      const attributeRepsonse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post(
          URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/traces/get-attributes",
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

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage error={pageError} />;
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
            title: "Span Name",
          },
          {
            field: {
              kind: true,
            },
            type: FieldType.Text,
            title: "Span Kind",
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
            jsonKeys: attributes,
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
                    traceId={span.traceId?.toString()}
                    spanStatusCode={span.statusCode!}
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
