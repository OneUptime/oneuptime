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
  useCallback,
  useEffect,
  useMemo,
  useState,
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
import Service from "Common/Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ServiceElement from "../Service/ServiceElement";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import IsNull from "Common/Types/BaseDatabase/IsNull";

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
  const [attributesLoaded, setAttributesLoaded] =
    React.useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] =
    React.useState<boolean>(false);
  const [attributesError, setAttributesError] = React.useState<string>("");

  const [isPageLoading, setIsPageLoading] = React.useState<boolean>(true);
  const [pageError, setPageError] = React.useState<string>("");

  const [spanQuery, setSpanQuery] = React.useState<Query<Span> | null>(
    props.spanQuery || null,
  );

  const [telemetryServices, setServices] = React.useState<
    Array<Service>
  >([]);

  const [areAdvancedFiltersVisible, setAreAdvancedFiltersVisible] =
    useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<"all" | "root">("all");

  const tabItems: Array<Tab> = useMemo(() => {
    return [
      {
        name: "All Spans",
        children: <div className="hidden" />,
      },
      {
        name: "Root Spans",
        children: <div className="hidden" />,
      },
    ];
  }, []);

  const handleTabChange: (tab: Tab) => void = useCallback((tab: Tab) => {
    if (tab.name === "Root Spans") {
      setActiveTab("root");
      return;
    }

    setActiveTab("all");
  }, []);

  const cardContent: {
    title: string;
    description: string;
  } = useMemo(() => {
    if (activeTab === "root") {
      return {
        title: "Root Spans",
        description:
          "Root spans act as entry points in a trace. They represent requests without a parent span and help you spot top-level operations quickly.",
      };
    }

    return {
      title: "All Spans",
      description:
        "Collection of spans make up a trace. Spans are the building blocks of a trace and represent individual units of work done in a distributed system.",
    };
  }, [activeTab]);

  const getQueryForActiveTab: Query<Span> = useMemo(() => {
    const baseQuery: Query<Span> = {
      ...(spanQuery || {}),
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      baseQuery.projectId = projectId;
    }

    if (modelId) {
      baseQuery.serviceId = modelId;
    }

    if (activeTab === "root") {
      baseQuery.parentSpanId = new IsNull();
    }

    return baseQuery;
  }, [spanQuery, modelId, activeTab]);

  useEffect(() => {
    if (props.spanQuery) {
      setSpanQuery(props.spanQuery);
    }
  }, [props.spanQuery]);

  const loadServices: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsPageLoading(true);
        setPageError("");

        const telemetryServicesResponse: ListResult<Service> =
          await ModelAPI.getList({
            modelType: Service,
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

        setServices(telemetryServicesResponse.data || []);
      } catch (err) {
        setPageError(API.getFriendlyErrorMessage(err as Error));
      } finally {
        setIsPageLoading(false);
      }
    };

  const loadAttributes: PromiseVoidFunction = async (): Promise<void> => {
    if (attributesLoading || attributesLoaded) {
      return;
    }

    try {
      setAttributesLoading(true);
      setAttributesError("");

      const attributeResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/traces/get-attributes",
          ),
          data: {},
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (attributeResponse instanceof HTTPErrorResponse) {
        throw attributeResponse;
      }

      const fetchedAttributes: Array<string> = (attributeResponse.data[
        "attributes"
      ] || []) as Array<string>;
      setAttributes(fetchedAttributes);
      setAttributesLoaded(true);
    } catch (err) {
      setAttributes([]);
      setAttributesLoaded(false);
      setAttributesError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setAttributesLoading(false);
    }
  };

  useEffect(() => {
    loadServices().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  const handleAdvancedFiltersToggle: (show: boolean) => void = (
    show: boolean,
  ): void => {
    setAreAdvancedFiltersVisible(show);

    if (show && !attributesLoaded && !attributesLoading) {
      void loadAttributes();
    }
  };

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

  return (
    <Fragment>
      {pageError && (
        <div className="mb-4">
          <ErrorMessage
            message={`We couldn't load telemetry services. ${pageError}`}
            onRefreshClick={() => {
              void loadServices();
            }}
          />
        </div>
      )}

      {areAdvancedFiltersVisible && attributesError && (
        <div className="mb-4">
          <ErrorMessage
            message={`We couldn't load trace attributes. ${attributesError}`}
            onRefreshClick={() => {
              setAttributesLoaded(false);
              void loadAttributes();
            }}
          />
        </div>
      )}

      <Tabs tabs={tabItems} onTabChange={handleTabChange} />

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
                  title: cardContent.title,
                  description: cardContent.description,
                }
          }
          query={getQueryForActiveTab}
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
                (service: Service) => {
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
              isAdvancedFilter: true,
            },
          ]}
          onAdvancedFiltersToggle={handleAdvancedFiltersToggle}
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
                const telemetryService: Service | undefined =
                  telemetryServices.find((service: Service) => {
                    return (
                      service.id?.toString() === span.serviceId?.toString()
                    );
                  });

                if (!telemetryService) {
                  return <p>Unknown</p>;
                }

                return (
                  <Fragment>
                    <ServiceElement
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
