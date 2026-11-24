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
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Query from "Common/Types/BaseDatabase/Query";
import SpanUtil from "../../Utils/SpanUtil";
import TraceElement from "./TraceElement";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceElement from "../Service/ServiceElement";
import { UNKNOWN_RESOURCE_LABEL } from "Common/UI/Utils/TelemetryService";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import {
  TelemetryServicesOnPage,
  useTelemetryServicesOnPage,
} from "../Telemetry/TelemetryServicesOnPage";
import { getUnknownServiceScopeOption } from "../Telemetry/TelemetryServiceScope";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

export interface ComponentProps {
  modelId?: ObjectID | undefined;
  spanQuery?: Query<Span> | undefined;
  isMinimalTable?: boolean | undefined;
  noItemsMessage?: string | undefined;
  // Rendered in the card header, e.g. the snapshot window an incident is scoped to.
  rightElement?: ReactElement | undefined;
  /*
   * Set by hosts that pin the query to a fixed window (incident / alert
   * previews). Without it the table restores a "Seen At" filter from the URL
   * on mount, which replaces the pinned window with an unrelated one and gives
   * no sign it happened.
   */
  disableUrlState?: boolean | undefined;
  onFetchSuccess?:
    | ((data: Array<Span>, totalCount: number) => void)
    | undefined;
}

const TraceTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID | undefined = props.modelId;
  const translator: Translator = useTranslator();

  const [attributes, setAttributes] = React.useState<Array<string>>([]);
  const [attributesLoaded, setAttributesLoaded] =
    React.useState<boolean>(false);
  const [attributesLoading, setAttributesLoading] =
    React.useState<boolean>(false);
  const [attributesError, setAttributesError] = React.useState<string>("");

  const [spanQuery, setSpanQuery] = React.useState<Query<Span> | null>(
    props.spanQuery || null,
  );

  /*
   * The services the shown rows name, read by their ids as each page of
   * rows arrives - never the project's first 10,000 by name, which left a
   * row whose service sorted past them reading "Unknown" (#10764).
   */
  const servicesOnPage: TelemetryServicesOnPage = useTelemetryServicesOnPage();

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
      baseQuery.primaryEntityId = modelId;
    }

    if (activeTab === "root") {
      baseQuery.isRootSpan = true;
    }

    return baseQuery;
  }, [spanQuery, modelId, activeTab]);

  useEffect(() => {
    if (props.spanQuery) {
      setSpanQuery(props.spanQuery);
    }
  }, [props.spanQuery]);

  /*
   * Traces without a service.name are tagged with the projectId
   * (ServiceType.Unknown) and have no Service row: the filter offers them
   * as "Unknown Service" beside its search, so the list can be narrowed to
   * them.
   */
  const unknownServiceOptions: Array<DropdownOption> = useMemo(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    return projectId
      ? [getUnknownServiceScopeOption(projectId.toString())]
      : [];
  }, []);

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
    RouteMap[PageMap.TRACE_VIEW]!,
  );

  if (modelId) {
    viewRoute = RouteUtil.populateRouteParams(
      RouteMap[PageMap.SERVICE_VIEW_TRACES]!,
      {
        modelId: modelId,
      },
    );
  }

  return (
    <Fragment>
      {servicesOnPage.error && (
        <div className="mb-4">
          <ErrorMessage
            message={
              <ErrorSentence
                template="We couldn't load telemetry services. {{error}}"
                error={servicesOnPage.error}
              />
            }
            onRefreshClick={() => {
              void servicesOnPage.retry();
            }}
          />
        </div>
      )}

      {areAdvancedFiltersVisible && attributesError && (
        <div className="mb-4">
          <ErrorMessage
            message={
              <ErrorSentence
                template="We couldn't load trace attributes. {{error}}"
                error={attributesError}
              />
            }
            onRefreshClick={() => {
              setAttributesLoaded(false);
              void loadAttributes();
            }}
          />
        </div>
      )}

      <Tabs label="Spans" tabs={tabItems} onTabChange={handleTabChange} />

      <div className="rounded">
        <AnalyticsModelTable<Span>
          userPreferencesKey="trace-table"
          disableUrlState={props.disableUrlState}
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
                  rightElement: props.rightElement,
                }
          }
          query={getQueryForActiveTab}
          showViewIdButton={true}
          noItemsMessage={
            props.noItemsMessage ? props.noItemsMessage : "No spans found."
          }
          onFetchSuccess={(data: Array<Span>, totalCount: number) => {
            // The services the page's rows name, read by their ids.
            void servicesOnPage.readServicesOf(
              data.map((span: Span): ObjectID | undefined => {
                return span.primaryEntityId;
              }),
            );
            props.onFetchSuccess?.(data, totalCount);
          }}
          showRefreshButton={true}
          sortBy="startTime"
          sortOrder={SortOrder.Descending}
          onViewPage={(span: Span) => {
            let route: Route;

            if (modelId) {
              route = new Route(viewRoute.toString()).addRoute(
                span.traceId!.toString(),
              );
            } else {
              route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.TRACE_VIEW]!,
                {
                  modelId: span.traceId!.toString(),
                },
              );
            }

            /*
             * Pass the clicked span so the trace explorer can highlight and
             * scroll to it.
             */
            if (span.spanId) {
              route = new Route(route.toString()).addQueryParams({
                spanId: span.spanId.toString(),
              });
            }

            return Promise.resolve(route);
          }}
          filters={[
            {
              field: {
                primaryEntityId: true,
              },
              type: FieldType.MultiSelectDropdown,
              /*
               * Searched on the server as it is typed in, 50 by name; what
               * the filter holds - from a link or a saved view - is named by
               * its ids, one gone as "No longer available" (#10764).
               * Archived services keep sending traces: offered, marked.
               */
              filterEntityType: Service,
              filterDropdownField: { label: "name", value: "_id" },
              marksArchivedRecords: true,
              filterDropdownOptions: unknownServiceOptions,
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
                primaryEntityId: true,
              },
              title: "Service",
              type: FieldType.Element,
              getElement: (span: Span): ReactElement => {
                const telemetryService: Service | undefined =
                  servicesOnPage.getService(span.primaryEntityId);

                if (!telemetryService) {
                  // Its name is on its way: never "Unknown" meanwhile.
                  if (servicesOnPage.isReading(span.primaryEntityId)) {
                    return <InlineValueSkeleton widthClassName="w-24" />;
                  }

                  return (
                    <p>{translator.translateText(UNKNOWN_RESOURCE_LABEL)}</p>
                  );
                }

                return (
                  <Fragment>
                    <ServiceElement service={telemetryService} />
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
