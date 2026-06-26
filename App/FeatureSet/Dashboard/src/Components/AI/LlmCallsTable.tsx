import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Span from "Common/Models/AnalyticsModels/Span";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Service from "Common/Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ServiceElement from "../Service/ServiceElement";
import SpanStatusElement from "../Span/SpanStatusElement";
import API from "Common/Utils/API";

export interface ComponentProps {
  // Extra query (merged with isLlmSpan + projectId).
  query?: Query<Span> | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disablePagination?: boolean | undefined;
}

const LlmCallsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [telemetryServices, setServices] = useState<Array<Service>>([]);

  useEffect(() => {
    const loadServices: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<Service> = await ModelAPI.getList({
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
        setServices(result.data || []);
      } catch (err) {
        // Non-critical — the table still renders without service labels.
        API.getFriendlyErrorMessage(err as Error);
      }
    };

    void loadServices();
  }, []);

  const computedQuery: Query<Span> = useMemo(() => {
    const query: Query<Span> = {
      ...(props.query || {}),
      isLlmSpan: true,
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      query.projectId = projectId;
    }

    return query;
  }, [props.query]);

  const renderServiceElement: (span: Span) => ReactElement = (
    span: Span,
  ): ReactElement => {
    const telemetryService: Service | undefined = telemetryServices.find(
      (service: Service) => {
        return service.id?.toString() === span.primaryEntityId?.toString();
      },
    );

    if (!telemetryService) {
      return <p className="text-gray-400">Unknown</p>;
    }

    return <ServiceElement service={telemetryService} />;
  };

  return (
    <AnalyticsModelTable<Span>
      modelType={Span}
      id="llm-calls-table"
      name="LLM Calls"
      singularName="LLM Call"
      pluralName="LLM Calls"
      userPreferencesKey="llm-calls-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={true}
      disablePagination={props.disablePagination}
      cardProps={{
        title: props.title || "AI / LLM Calls",
        description:
          props.description ||
          "Every LLM, embedding, agent and tool span ingested via OpenTelemetry GenAI conventions. Click a call to open it in the trace viewer.",
      }}
      query={computedQuery}
      sortBy="startTime"
      sortOrder={SortOrder.Descending}
      noItemsMessage="No LLM calls found. Instrument your app with the OpenTelemetry GenAI conventions to see calls here."
      showRefreshButton={true}
      showViewIdButton={true}
      onViewPage={(span: Span) => {
        let route: Route = RouteUtil.populateRouteParams(
          RouteMap[PageMap.TRACE_VIEW]!,
          {
            modelId: span.traceId!.toString(),
          },
        );

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
          filterDropdownOptions: telemetryServices.map((service: Service) => {
            return {
              label: service.name!,
              value: service.id!.toString(),
            };
          }),
          title: "Service",
        },
        {
          field: {
            llmSystem: true,
          },
          type: FieldType.Text,
          title: "Provider",
        },
        {
          field: {
            llmRequestModel: true,
          },
          type: FieldType.Text,
          title: "Model",
        },
        {
          field: {
            llmOperation: true,
          },
          type: FieldType.Text,
          title: "Operation",
        },
        {
          field: {
            startTime: true,
          },
          type: FieldType.DateTime,
          title: "Seen At",
        },
      ]}
      selectMoreFields={{
        spanId: true,
        traceId: true,
        statusCode: true,
        llmInputTokens: true,
        llmOutputTokens: true,
        llmResponseModel: true,
      }}
      columns={[
        {
          field: {
            startTime: true,
          },
          title: "Seen At",
          type: FieldType.DateTime,
        },
        {
          field: {
            primaryEntityId: true,
          },
          title: "Service",
          type: FieldType.Element,
          getElement: renderServiceElement,
        },
        {
          field: {
            llmSystem: true,
          },
          title: "Provider",
          type: FieldType.Text,
        },
        {
          field: {
            llmRequestModel: true,
          },
          title: "Model",
          type: FieldType.Text,
        },
        {
          field: {
            llmOperation: true,
          },
          title: "Operation",
          type: FieldType.Text,
        },
        {
          field: {
            llmTotalTokens: true,
          },
          title: "Tokens (in / out)",
          type: FieldType.Element,
          getElement: (span: Span): ReactElement => {
            const input: number = Number(span.llmInputTokens || 0);
            const output: number = Number(span.llmOutputTokens || 0);
            const total: number = Number(span.llmTotalTokens || 0);
            return (
              <span className="font-mono text-xs text-gray-700">
                {input.toLocaleString()} / {output.toLocaleString()}
                <span className="text-gray-400">
                  {" "}
                  ({total.toLocaleString()})
                </span>
              </span>
            );
          },
        },
        {
          field: {
            llmCost: true,
          },
          title: "Cost",
          type: FieldType.Element,
          getElement: (span: Span): ReactElement => {
            const cost: number = Number(span.llmCost || 0);
            if (cost <= 0) {
              return <span className="text-gray-400">—</span>;
            }
            return (
              <span className="font-mono text-xs text-gray-700">
                ${cost.toFixed(6)}
              </span>
            );
          },
        },
        {
          field: {
            statusCode: true,
          },
          title: "Status",
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
      ]}
    />
  );
};

export default LlmCallsTable;
