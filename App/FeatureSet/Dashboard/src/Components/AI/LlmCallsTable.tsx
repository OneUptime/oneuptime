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

  /*
   * The employee who made the call, as one value. Email is preferred and the
   * id is the fallback rather than a second column, because an emitter almost
   * always populates exactly one of the two — the coding-agent CLIs stamp
   * user.email natively while the gateways report a key-owner id — so a
   * dedicated column for each would be empty on nearly every row.
   *
   * Note what is NOT consulted here: the caller's own downstream-customer
   * identity (gen_ai.user and friends, see LlmEndUserAttributeKeys) is never
   * denormalized into these columns, precisely so it can never be read as the
   * person to charge.
   */
  const getUserLabel: (span: Span) => string = (span: Span): string => {
    return (
      span.llmUserEmail?.toString().trim() ||
      span.llmUserId?.toString().trim() ||
      ""
    );
  };

  const renderUserElement: (span: Span) => ReactElement = (
    span: Span,
  ): ReactElement => {
    const label: string = getUserLabel(span);

    if (!label) {
      return <span className="text-gray-400">—</span>;
    }

    return <span className="text-xs text-gray-700">{label}</span>;
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
        /*
         * Employee identity is filtered as free text rather than a dropdown:
         * unlike services, the set of people who have made an LLM call is not
         * a bounded list the page can fetch upfront — it is whatever the
         * instrumentation happened to stamp, across the whole retention
         * window.
         *
         * Email and id are separate filters even though they render as one
         * "User" column, because a filter narrows one stored column and most
         * emitters populate exactly one of the two. Folding them into a
         * single input would silently return nothing for the half of the
         * fleet that reports the other one.
         */
        {
          field: {
            llmUserEmail: true,
          },
          type: FieldType.Text,
          title: "User Email",
        },
        {
          field: {
            llmUserId: true,
          },
          type: FieldType.Text,
          title: "User ID",
        },
        {
          field: {
            llmTeam: true,
          },
          type: FieldType.Text,
          title: "Team",
        },
        {
          field: {
            llmConversationId: true,
          },
          type: FieldType.Text,
          title: "Conversation ID",
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
        llmConversationId: true,
        /*
         * The User column reads llmUserEmail (its declared field) but falls
         * back to llmUserId, which no column declares on its own — without
         * this the fallback would render "Unknown" for every emitter that
         * reports an id and no email.
         */
        llmUserId: true,
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
        /*
         * Provider and Operation are shipped hidden so the two identity
         * columns below do not widen the table: adding them to the eight
         * columns this table already had would have pushed cost and status
         * off the side of a laptop screen.
         *
         * These two are the ones that earn their place least in the DEFAULT
         * view, and they are still one click away in the column picker and
         * still filterable. Provider is largely readable off the model name
         * for the dominant vendors (gpt-*, claude-*, gemini-*), and Operation
         * is "chat" on the overwhelming majority of rows — neither is the
         * reason someone opens this table, whereas "who spent this" is.
         *
         * Viewers who have already customized this table keep them: a stored
         * layout that lists a column in `order` wins over isHiddenByDefault
         * (see ColumnPreference.getCustomizableColumns), so this only
         * re-shapes the default for people who never opened the picker.
         */
        {
          field: {
            llmSystem: true,
          },
          title: "Provider",
          type: FieldType.Text,
          isHiddenByDefault: true,
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
          isHiddenByDefault: true,
        },
        {
          field: {
            llmUserEmail: true,
          },
          title: "User",
          type: FieldType.Element,
          getElement: renderUserElement,
          // The cell renders a fallback the declared field does not carry.
          getExportValue: getUserLabel,
        },
        {
          field: {
            llmTeam: true,
          },
          title: "Team",
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
