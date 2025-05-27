import SpanStatusElement from "../Span/SpanStatusElement";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Span from "Common/Models/AnalyticsModels/Span";
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
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Query from "Common/Types/BaseDatabase/Query";
import SpanUtil from "../../Utils/SpanUtil";
import TraceElement from "./TraceElement";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import TelemetryServiceElement from "../TelemetryService/TelemetryServiceElement";

export interface ComponentProps {
  modelId?: ObjectID | undefined;
  spanQuery?: Query<Span> | undefined;
  isMinimalTable?: boolean | undefined;
  noItemsMessage?: string | undefined;
}

const TraceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID | undefined = props.modelId;

  const [attributes, setAttributes] = React.useState<Array<string>>([]);

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const [spanQuery, setSpanQuery] = React.useState<Query<Span> | null>(
    props.spanQuery || null,
  );

  const [telemetryServices, setTelemetryServices] = React.useState<
    Array<TelemetryService>
  >([]);

  useEffect(() => {
    if (props.spanQuery) {
      setSpanQuery(props.spanQuery);
    }
  }, [props.spanQuery]);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
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

      // Load telemetry services
      const telemetryServices: ListResult<TelemetryService> =
        await ModelAPI.getList({
          modelType: TelemetryService,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            serviceColor: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setTelemetryServices(telemetryServices.data || []);

      setIsPageLoading(false);
      setPageError("");
    } catch (err) {
      setIsPageLoading(false);
      setPageError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  useEffect(() => {
    loadItems().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  const spanKindDropdownOptions: Array<DropdownOption> =
    SpanUtil.getSpanKindDropdownOptions();

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
    return <ErrorMessage message={pageError} />;
  }

  return (
    <Fragment>
      <div className="rounded">
        <AnalyticsModelTable<Span>
          userPreferencesKey="trace-table"
          disablePagination={props.isMinimalTable}
          modelType={Span}
          id="traces-table"
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          singularName="Span"
          pluralName="Spans"
          name="Spans"
          isViewable={true}
          cardProps={
            props.isMinimalTable
              ? undefined
              : {
                  title: "Spans",
                  description:
                    "Collection of spans make up a trace. Spans are the building blocks of a trace and represent the individual units of work done in a distributed system.",
                }
          }
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            serviceId: modelId ? modelId : undefined,
            ...spanQuery,
          }}
          showViewIdButton={true}
          noItemsMessage={
            props.noItemsMessage ? props.noItemsMessage : "No spans found."
          }
          showRefreshButton={true}
          sortBy="startTime"
          sortOrder={SortOrder.Descending}
          onViewPage={(span: Span) => {
            return Promise.resolve(
              new Route(viewRoute.toString()).addRoute(
                span.traceId!.toString(),
              ),
            );
          }}
          filters={[
            {
              field: {
                serviceId: true,
              },
              type: FieldType.MultiSelectDropdown,
              filterDropdownOptions: telemetryServices.map(
                (service: TelemetryService) => {
                  return {
                    label: service.name!,
                    value: service.id!.toString(),
                  };
                },
              ),
              title: "Service",
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
                traceId: true,
              },
              type: FieldType.Text,
              title: "Trace ID",
            },
            {
              field: {
                statusCode: true,
              },
              type: FieldType.MultiSelectDropdown,
              filterDropdownOptions: SpanUtil.getSpanStatusDropdownOptions(),
              title: "Span Status",
            },
            {
              field: {
                kind: true,
              },
              type: FieldType.MultiSelectDropdown,
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
              type: FieldType.Element,
              getElement: (span: Span): ReactElement => {
                return (
                  <Fragment>
                    <TraceElement traceId={span.traceId?.toString()} />
                  </Fragment>
                );
              },
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
                serviceId: true,
              },
              title: "Service",
              type: FieldType.Element,
              getElement: (span: Span): ReactElement => {
                const telemetryService: TelemetryService | undefined =
                  telemetryServices.find((service: TelemetryService) => {
                    return (
                      service.id?.toString() === span.serviceId?.toString()
                    );
                  });

                if (!telemetryService) {
                  return <p>Unknown</p>;
                }

                return (
                  <Fragment>
                    <TelemetryServiceElement
                      telemetryService={telemetryService}
                    />
                  </Fragment>
                );
              },
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
      </div>
    </Fragment>
  );
};

export default TraceTable;
