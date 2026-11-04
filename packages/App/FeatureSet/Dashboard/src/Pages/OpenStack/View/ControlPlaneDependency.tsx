import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Route from "Common/Types/API/Route";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { JSONObject } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { getOpenStackControlPlaneTemplateIds } from "Common/Types/Monitor/OpenStackControlPlaneAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_CONTROL_PLANE_FACTS,
  OPENSTACK_DEPENDENCY_DEFINITIONS,
  OpenStackDependency,
  OpenStackDependencyDefinition,
  getOpenStackDependencyOfRow,
  isOpenStackControlPlaneRowCurrent,
  isOpenStackDependency,
} from "Common/Types/OpenStack/OpenStackControlPlane";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import OpenStackControlPlaneCard, {
  OpenStackDependencyStatePill,
  fetchOpenStackControlPlaneRows,
  useOpenStackDependencyLine,
} from "../../../Components/OpenStack/OpenStackControlPlaneCard";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import { useOpenStackRegion } from "../../../Components/OpenStack/OpenStackRegionContext";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../../Components/ResourcePart/ResourcePartAlertsCard";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import ResourcePartRow from "../../../Components/ResourcePart/ResourcePartRow";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import {
  OpenStackControlPlaneAssessment,
  OpenStackDependencySummary,
  assessOpenStackControlPlaneRow,
  getOpenStackControlPlaneAttentionItems,
  getOpenStackDependencySummaries,
} from "../Utils/OpenStackControlPlaneHealth";

/*
 * One thing the cloud stands on: how it is, what goes with it, each of its machines, and
 * whether anyone will hear. Where OneUptime has a product that goes deeper, this leads to
 * it, and says what that product needs, because the exporters read here do not feed it.
 */

const CLOUD_ATTRIBUTE: string = "resource.openstack.cloud.name";
const REGION_ATTRIBUTE: string = "openstack.region.name";

interface OpenStackDependencyChart {
  variable: string;
  title: string;
  description: string;
  metricName: string;
  legend: string;
  legendUnit?: string | undefined;
  aggregation: AggregationType;
}

// What it reads over time. Never Sum: a chart reads buckets across scrapes (issue #5433).
const CHARTS: Record<OpenStackDependency, Array<OpenStackDependencyChart>> = {
  [OpenStackDependency.RabbitMq]: [
    {
      variable: "messages",
      title: "Messages waiting",
      description: "How many messages are in this node's queues.",
      metricName: "rabbitmq_queue_messages",
      legend: "Messages",
      aggregation: AggregationType.Max,
    },
    {
      variable: "unacknowledged",
      title: "Messages unacknowledged",
      description:
        "Messages delivered and not yet acknowledged. A count that only climbs is a consumer that has stopped working without letting go.",
      metricName: "rabbitmq_queue_messages_unacked",
      legend: "Messages",
      aggregation: AggregationType.Max,
    },
    {
      variable: "connections",
      title: "Connections",
      description: "How many connections each node holds.",
      metricName: "rabbitmq_connections",
      legend: "Connections",
      aggregation: AggregationType.Max,
    },
  ],
  [OpenStackDependency.MariaDb]: [
    {
      variable: "cluster_size",
      title: "Galera cluster size",
      description: "How many nodes each node says the cluster has.",
      metricName: "mysql_global_status_wsrep_cluster_size",
      legend: "Nodes",
      aggregation: AggregationType.Min,
    },
    {
      variable: "threads_connected",
      title: "Connections",
      description: "How many connections each node holds.",
      metricName: "mysql_global_status_threads_connected",
      legend: "Connections",
      aggregation: AggregationType.Max,
    },
    {
      variable: "slow_queries",
      title: "Slow queries",
      description: "How many queries each scrape found took too long.",
      metricName: "mysql_slow_queries_increase",
      legend: "Queries",
      aggregation: AggregationType.Max,
    },
  ],
  [OpenStackDependency.Memcached]: [
    {
      variable: "connections",
      title: "Connections",
      description: "How many clients each Memcached holds.",
      metricName: "memcached_current_connections",
      legend: "Connections",
      aggregation: AggregationType.Max,
    },
    {
      variable: "evictions",
      title: "Evictions",
      description:
        "How many items each scrape found thrown out early to make room. Steady evictions mean tokens are validated again and again.",
      metricName: "memcached_items_evicted_increase",
      legend: "Items",
      aggregation: AggregationType.Max,
    },
  ],
  [OpenStackDependency.HaProxy]: [
    {
      variable: "responses",
      title: "Responses by code class",
      description: "How many responses each backend gave, by code class.",
      metricName: "haproxy_backend_http_responses_increase",
      legend: "Responses",
      aggregation: AggregationType.Max,
    },
    {
      variable: "active_servers",
      title: "Servers in each backend",
      description: "How many servers each backend has that are up.",
      metricName: "haproxy_backend_active_servers",
      legend: "Servers",
      aggregation: AggregationType.Min,
    },
  ],
  [OpenStackDependency.Network]: [
    {
      variable: "tx_errors",
      title: "Transmit errors",
      description:
        "How many packets each scrape found an interface failed to send. A Geneve port's are tunnels between hosts.",
      metricName: "ovs_interface_tx_errors_increase",
      legend: "Packets",
      aggregation: AggregationType.Max,
    },
    {
      variable: "bridge_ports",
      title: "Bridge ports",
      description: "How many ports each bridge has.",
      metricName: "ovs_bridge_port_count",
      legend: "Ports",
      aggregation: AggregationType.Max,
    },
  ],
  [OpenStackDependency.Libvirt]: [
    {
      variable: "libvirt_up",
      title: "libvirt answering",
      description: "Whether libvirt answers its exporter on each host.",
      metricName: "libvirt_up",
      legend: "Up",
      aggregation: AggregationType.Min,
    },
  ],
};

function factsOf(row: OpenStackResource): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

/*
 * What a machine says of itself, on its line. Only what it has said: a number it never
 * reported is no reading, not a 0.
 */
function useRowFacts(): (row: OpenStackResource) => Array<string> {
  const translator: Translator = useTranslator();

  return (row: OpenStackResource): Array<string> => {
    const facts: JSONObject = factsOf(row);
    const lines: Array<string> = [];
    const add: (template: string, fact: string) => void = (
      template: string,
      fact: string,
    ): void => {
      const value: unknown = facts[fact];
      if (typeof value === "number") {
        lines.push(
          translator.translateTemplate(template, {
            value: translator.formatNumber(value),
          }),
        );
      }
    };

    add("{{value}} connections", OPENSTACK_CONTROL_PLANE_FACTS.Connections);
    add("{{value}} queues", OPENSTACK_CONTROL_PLANE_FACTS.Queues);
    add("{{value}} consumers", OPENSTACK_CONTROL_PLANE_FACTS.Consumers);
    add(
      "{{value}} unacknowledged",
      OPENSTACK_CONTROL_PLANE_FACTS.MessagesUnacknowledged,
    );
    add(
      "Cluster of {{value}}",
      OPENSTACK_CONTROL_PLANE_FACTS.ClusterSize,
    );
    add(
      "{{value}} connections",
      OPENSTACK_CONTROL_PLANE_FACTS.ThreadsConnected,
    );
    add(
      "{{value}} connections",
      OPENSTACK_CONTROL_PLANE_FACTS.CurrentConnections,
    );

    return lines;
  };
}

const OpenStackCloudControlPlaneDependency: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const lineOf: (summary: OpenStackDependencySummary) => string =
    useOpenStackDependencyLine();
  const factsOfRow: (row: OpenStackResource) => Array<string> = useRowFacts();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const word: string = Navigation.getLastParamAsString();
  const { region } = useOpenStackRegion();
  const now: Date = useMemo(() => {
    return new Date();
  }, []);

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(modelId);
  }, [modelId.toString()]);

  const read: OpenStackRead<Array<OpenStackResource>> = useOpenStackRead<
    Array<OpenStackResource>
  >(() => {
    return fetchOpenStackControlPlaneRows(modelId);
  }, [modelId.toString()]);

  const cloud: OpenStackRead<OpenStackCloud | null> =
    useOpenStackRead<OpenStackCloud | null>(() => {
      return ModelAPI.getItem<OpenStackCloud>({
        modelType: OpenStackCloud,
        id: modelId,
        select: { name: true },
      });
    }, [modelId.toString()]);

  if (!isOpenStackDependency(word)) {
    return <OpenStackControlPlaneCard modelId={modelId} />;
  }

  const dependency: OpenStackDependency = word;
  const definition: OpenStackDependencyDefinition =
    OPENSTACK_DEPENDENCY_DEFINITIONS[dependency];

  if (read.error && !read.data) {
    return (
      <ResourcePartReadError
        testId="openstack-control-plane-read-error"
        title="Couldn't load what this cloud stands on"
        message={read.error}
        onRetry={read.reload}
      />
    );
  }

  if (!read.data) {
    return <PageLoader isVisible={true} />;
  }

  const inScope: Array<OpenStackResource> = read.data.filter(
    (row: OpenStackResource): boolean => {
      return (
        getOpenStackDependencyOfRow(row) === dependency &&
        (!region || row.regionName === region)
      );
    },
  );

  const summary: OpenStackDependencySummary | undefined =
    getOpenStackDependencySummaries({ rows: inScope, now }).find(
      (one: OpenStackDependencySummary): boolean => {
        return one.dependency === dependency;
      },
    );

  const cloudName: string = cloud.data?.name || "";
  const queries: Array<MetricQueryConfigData> = cloudName
    ? CHARTS[dependency].map(
        (chart: OpenStackDependencyChart): MetricQueryConfigData => {
          return {
            metricAliasData: {
              metricVariable: chart.variable,
              title: chart.title,
              description: chart.description,
              legend: chart.legend,
              legendUnit: chart.legendUnit || "",
            },
            metricQueryData: {
              filterData: {
                metricName: chart.metricName,
                attributes: {
                  [CLOUD_ATTRIBUTE]: cloudName,
                  ...(region ? { [REGION_ATTRIBUTE]: region } : {}),
                },
                aggegationType: chart.aggregation,
                aggregateBy: {},
              },
              groupBy: { attributes: true },
            },
          };
        },
      )
    : [];

  const deeperRoute: Route | undefined =
    definition.deeperProduct === "queues"
      ? (RouteMap[PageMap.MESSAGE_QUEUES] as Route)
      : definition.deeperProduct === "databases"
        ? (RouteMap[PageMap.DATABASES] as Route)
        : undefined;

  return (
    <div data-testid="openstack-control-plane-dependency" data-dependency={dependency}>
      <div className="mb-6" data-testid="openstack-control-plane-summary">
        <Card
          title={definition.title}
          description={definition.description}
          buttons={
            summary
              ? [
                  <OpenStackDependencyStatePill
                    key="state"
                    state={summary.state}
                  />,
                ]
              : []
          }
        >
          <div className="space-y-2 text-sm text-gray-700">
            {summary ? (
              <p data-testid="openstack-control-plane-line">{lineOf(summary)}</p>
            ) : (
              <></>
            )}
            <p data-testid="openstack-control-plane-takes-down">
              {translator.translateText(definition.takesDown) ||
                definition.takesDown}
            </p>
          </div>
        </Card>
      </div>

      {inScope.length === 0 ? (
        <OpenStackPartNotice
          testId="openstack-control-plane-not-watched"
          tone="warning"
        >
          <span>
            {translator.translateTemplate(
              "Nothing reads this, so nothing here says whether it is fine. Name its targets in {{variable}} in the agent's .env, then run docker compose up -d.",
              { variable: definition.targetsVariable },
            )}{" "}
            <Link
              to={new Route("/docs/telemetry/openstack-deployment-tools")}
              openInNewTab={true}
              className="underline"
            >
              {translator.translateText("Each deployment tool's steps") ||
                "Each deployment tool's steps"}
            </Link>
          </span>
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-control-plane-attention"
        items={getOpenStackControlPlaneAttentionItems({
          rows: inScope,
          now,
          routeFor: routes.routeFor,
        })}
        description="By the same rules as the cloud's Overview, and the same lines as its alerts."
      />

      {inScope.length > 0 ? (
        <div className="mb-6" data-testid="openstack-control-plane-machines">
          <Card
            title="Machines"
            description="Each one the agent reads, with what its exporter last said."
          >
            <ul className={listClassName}>
              {inScope.map((row: OpenStackResource): ReactElement => {
                const own: OpenStackControlPlaneAssessment =
                  assessOpenStackControlPlaneRow(row);
                const isCurrent: boolean = isOpenStackControlPlaneRowCurrent({
                  row,
                  now,
                });
                const lines: Array<string> = isCurrent
                  ? [
                      ...own.reasons.map((reason): string => {
                        return translator.translateTemplate(
                          reason.text,
                          reason.values || {},
                        );
                      }),
                      ...factsOfRow(row),
                    ]
                  : [];

                return (
                  <li
                    key={row.externalId}
                    data-testid="openstack-control-plane-machine"
                    data-name={row.name || ""}
                  >
                    <ResourcePartRow className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                          <bdi>{row.name}</bdi>
                          {row.regionName ? (
                            <span className="ms-2 text-xs font-normal text-gray-500">
                              <bdi>{row.regionName}</bdi>
                            </span>
                          ) : (
                            <></>
                          )}
                        </div>
                        {lines.length > 0 ? (
                          <div className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">
                            {lines.join(" · ")}
                          </div>
                        ) : (
                          <></>
                        )}
                      </div>
                      <OpenStackDependencyStatePill
                        state={
                          !isCurrent
                            ? "NoReading"
                            : own.severity === "critical"
                              ? "Broken"
                              : own.severity === "warning"
                                ? "NeedsALook"
                                : "Fine"
                        }
                      />
                    </ResourcePartRow>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : (
        <></>
      )}

      {deeperRoute ? (
        <OpenStackPartNotice testId="openstack-control-plane-deeper">
          <span>
            {translator.translateText(
              definition.deeperProduct === "queues"
                ? "The exporter read here says how each node is. To see each queue and consumer, point OneUptime's collector at RabbitMQ's management API: "
                : "The exporter read here says how each node is. To see each query and table, run the Database agent against it, which also reads Galera's state: ",
            )}
            <Link to={deeperRoute} className="underline">
              {translator.translateText(
                definition.deeperProduct === "queues" ? "Queues" : "Databases",
              )}
            </Link>
          </span>
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {queries.length > 0 && inScope.length > 0 ? (
        <div className="mb-6" data-testid="openstack-control-plane-charts">
          <Card
            title="Over time"
            description="What it has said over the selected time range."
          >
            <ResourceMetricsTab queryConfigs={queries} />
          </Card>
        </div>
      ) : (
        <></>
      )}

      {cloudName ? (
        <ResourcePartAlertsCard
          testId="openstack-control-plane-alerts"
          title="Its alerts"
          description="The cloud's alerts on this. Each opens one incident that names what it takes with it, and quiets the alerts on what goes with it."
          resourceType={MonitorRecommendationResourceType.OpenStack}
          templateIds={getOpenStackControlPlaneTemplateIds(dependency)}
          resourceId={modelId}
          resourceIdentifier={cloudName}
          getRecommendationsRoute={routes.getRecommendationsRoute}
          getMonitorRoute={routes.getMonitorRoute}
          refreshToken={0}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default OpenStackCloudControlPlaneDependency;
