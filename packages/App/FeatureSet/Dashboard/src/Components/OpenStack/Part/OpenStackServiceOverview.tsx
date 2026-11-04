import Host from "Common/Models/DatabaseModels/Host";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { OPENSTACK_API_UP_METRIC_BY_SERVICE } from "Common/Types/Monitor/OpenStackAlertTemplates";
import { JSONValue } from "Common/Types/JSON";
import {
  isOpenStackServiceDown,
  isSameOpenStackHost,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceMetricsTab from "../../Infrastructure/ResourceMetricsTab";
import { OPENSTACK_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/OpenStackMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartReadError from "../../ResourcePart/ResourcePartReadError";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getOpenStackAttentionItems } from "../../../Pages/OpenStack/Utils/OpenStackHealth";
import {
  OpenStackAttentionAnswer,
  fetchOpenStackAttention,
} from "../../../Pages/OpenStack/Utils/OpenStackOverviewReads";
import {
  fetchOpenStackHostOf,
  fetchOpenStackRow,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  isOpenStackIssueAbout,
  getOpenStackTimeInState,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  getOpenStackAttentionName,
  getOpenStackCollectionSeconds,
  getOpenStackServiceAlertTemplateIds,
  getOpenStackServiceTitle,
  getOpenStackStaleAgentIds,
  getOpenStackWorkerAlertTemplateIds,
  getOpenStackWorkerFamily,
  getOpenStackWorkerHost,
  getOpenStackWorkerMachine,
  isOpenStackIssueAboutService,
  sortOpenStackWorkers,
} from "../../../Pages/OpenStack/Utils/OpenStackServices";
import {
  OpenStackWorkerRow,
  getOpenStackAdminStateText,
} from "../OpenStackServiceGroupCard";
import OpenStackBlastRadiusCard from "./OpenStackBlastRadiusCard";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "./OpenStackPartActivity";
import OpenStackPartNotice from "./OpenStackPartNotice";
import { OpenStackPart } from "./UseOpenStackPart";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * A service's page: the same questions in the same places as every part of a cloud. What
 * needs attention on it, how far its failure reaches and whose that is, how it has been
 * over time, what is open on it, whether anyone will hear, and its details. Both an API and
 * a worker have one, and each is read in OpenStack's own words.
 *
 * What needs attention comes from the same read and the same rules as the Overview,
 * because whether one scheduler down matters depends on how many others are up.
 */

const CLOUD_ATTRIBUTE: string = "resource.openstack.cloud.name";
const REGION_ATTRIBUTE: string = "openstack.region.name";
const COLLECTED_SERVICE_ATTRIBUTE: string = "openstack_service";

const THIS_API: string = translationKey("This API");
const THIS_SERVICE: string = translationKey("This service");

const AGENT_STATE_METRICS: Record<string, string> = {
  [OpenStackServiceFamily.Compute]: "openstack_nova_agent_state",
  [OpenStackServiceFamily.Network]: "openstack_neutron_agent_state",
  [OpenStackServiceFamily.Volume]: "openstack_cinder_agent_state",
};

const SERVICE_OF_FAMILY: Record<string, string> = {
  [OpenStackServiceFamily.Compute]: OpenStackServiceType.Compute,
  [OpenStackServiceFamily.Network]: OpenStackServiceType.Network,
  [OpenStackServiceFamily.Volume]: OpenStackServiceType.Volume,
};

export interface ComponentProps {
  part: OpenStackPart;
  row: OpenStackResource;
}

/*
 * A service's charts: whether it has been answering, and for an API how long collecting
 * it took, on the shared picker and charts. A failed read says so in the chart's frame.
 */
export const OpenStackServiceMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const isApi: boolean = row.kind === OpenStackResourceKind.Api;
  const queries: Array<MetricQueryConfigData> = isApi
    ? getApiQueries(part.cloudName, row, translator)
    : getWorkerQueries(part.cloudName, row, translator);

  return (
    <div data-testid="openstack-service-charts">
      <Card
        title={isApi ? "API metrics" : "Worker metrics"}
        description={
          isApi
            ? "Whether this API has been answering, and how long collecting it took, over the selected time range."
            : "Whether this worker has been reporting to its service, over the selected time range."
        }
      >
        <ResourceMetricsTab queryConfigs={queries} />
      </Card>
    </div>
  );
};

function getChartAttributes(
  cloudName: string,
  row: OpenStackResource,
): Record<string, string> {
  return {
    [CLOUD_ATTRIBUTE]: cloudName,
    ...(row.regionName ? { [REGION_ATTRIBUTE]: row.regionName } : {}),
  };
}

function getApiQueries(
  cloudName: string,
  row: OpenStackResource,
  translator: Translator,
): Array<MetricQueryConfigData> {
  const service: string = row.name || "";
  const upMetric: string | undefined =
    OPENSTACK_API_UP_METRIC_BY_SERVICE[service as OpenStackServiceType];
  const attributes: Record<string, string> = getChartAttributes(cloudName, row);
  const title: string = getOpenStackServiceTitle(service);
  const queries: Array<MetricQueryConfigData> = [];

  if (upMetric) {
    queries.push({
      metricAliasData: {
        metricVariable: "api_up",
        title: translator.translateTemplate("{{service}} API answering", {
          service: title,
        }),
        description: OPENSTACK_METRIC_DESCRIPTIONS.apiState,
        legend: "Up",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: upMetric,
          attributes: attributes,
          aggegationType: AggregationType.Min,
          aggregateBy: {},
        },
        groupBy: { attributes: true },
      },
    });
  }

  queries.push({
    metricAliasData: {
      metricVariable: "collection_time",
      title: translator.translateTemplate("{{service}} collection time", {
        service: title,
      }),
      description: OPENSTACK_METRIC_DESCRIPTIONS.apiCollectionTime,
      legend: "Collection",
      legendUnit: "s",
    },
    metricQueryData: {
      filterData: {
        metricName: "scrape_duration_seconds",
        attributes: { ...attributes, [COLLECTED_SERVICE_ATTRIBUTE]: service },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: { attributes: true },
    },
  });

  return queries;
}

function getWorkerQueries(
  cloudName: string,
  row: OpenStackResource,
  translator: Translator,
): Array<MetricQueryConfigData> {
  const metric: string | undefined =
    AGENT_STATE_METRICS[getOpenStackWorkerFamily(row)];
  if (!metric) {
    return [];
  }
  return [
    {
      metricAliasData: {
        metricVariable: "worker_state",
        title: translator.translateTemplate("{{service}} state", {
          service: row.name || "",
        }),
        description: OPENSTACK_METRIC_DESCRIPTIONS.workerState,
        legend: "Up",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: metric,
          attributes: {
            ...getChartAttributes(cloudName, row),
            hostname: getOpenStackWorkerHost(row),
            service: row.name || "",
          },
          aggegationType: AggregationType.Min,
          aggregateBy: {},
        },
        groupBy: { attributes: true },
      },
    },
  ];
}

const OpenStackServiceOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { part, row } = props;
  const now: Date = OneUptimeDate.getCurrentDate();

  const isApi: boolean = row.kind === OpenStackResourceKind.Api;
  const family: string = getOpenStackWorkerFamily(row);
  const service: string = isApi
    ? row.name || ""
    : SERVICE_OF_FAMILY[family] || "";

  // The region's services and hosts, which the rules need to judge any one of them.
  const attention: OpenStackRead<OpenStackAttentionAnswer> =
    useOpenStackRead<OpenStackAttentionAnswer>(() => {
      return fetchOpenStackAttention({
        openStackCloudId: part.openStackCloudId,
        regionName: row.regionName,
      });
    }, [part.openStackCloudId.toString(), row.regionName, part.refreshToken]);

  // The API that answers for a worker: when it is down, what the worker says is old.
  const api: OpenStackRead<OpenStackResource | null> =
    useOpenStackRead<OpenStackResource | null>(() => {
      return isApi || !service
        ? Promise.resolve(isApi ? row : null)
        : fetchOpenStackRow({
            openStackCloudId: part.openStackCloudId,
            kind: OpenStackResourceKind.Api,
            externalId: `${row.regionName || "default"}/${service}`,
          });
    }, [part.openStackCloudId.toString(), row.externalId, part.refreshToken]);

  // A host the Hosts product hears from under the same name.
  const machine: string = isApi ? "" : getOpenStackWorkerMachine(row);
  const host: OpenStackRead<Host | null> = useOpenStackRead<Host | null>(() => {
    return machine ? fetchOpenStackHostOf(machine) : Promise.resolve(null);
  }, [machine]);

  const rows: Array<OpenStackResource> = attention.data?.rows || [];
  const workers: Array<OpenStackResource> = rows.filter(
    (candidate: OpenStackResource): boolean => {
      return (
        candidate.kind === OpenStackResourceKind.Service &&
        SERVICE_OF_FAMILY[getOpenStackWorkerFamily(candidate)] === service
      );
    },
  );

  // The hypervisor on this nova-compute's host: Nova names the two differently.
  const hypervisor: OpenStackResource | undefined =
    row.name === "nova-compute"
      ? rows.find((candidate: OpenStackResource): boolean => {
          return (
            candidate.kind === OpenStackResourceKind.Hypervisor &&
            isSameOpenStackHost(
              candidate.hypervisorName,
              getOpenStackWorkerHost(row),
            )
          );
        })
      : undefined;

  const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [
      ...(api.data ? [api.data] : []),
      ...workers,
      ...(hypervisor ? [hypervisor] : []),
    ],
    now: now,
    routeFor: part.routes.routeFor,
    nameFor: getOpenStackAttentionName,
  }).filter((item: ResourceAttentionItem): boolean => {
    /*
     * An API's page lists what is wrong with it and everything it answers for. A
     * worker's lists itself, and every worker like it when none of them is left.
     */
    if (isApi) {
      return true;
    }
    return (
      item.key === `${row.kind}/${row.externalId}` ||
      item.key === `every-${row.regionName || ""}-${row.name || ""}`
    );
  });

  const isLastKnown: boolean = !isApi && api.data?.status === "down";
  const staleAgentIds: Array<string> = isApi
    ? []
    : getOpenStackStaleAgentIds(row);

  const details: Array<ResourcePartDetailRow> = [];
  if (isApi) {
    details.push({
      key: "service",
      label: "Service",
      value: getOpenStackServiceTitle(service),
    });
    details.push({
      key: "type",
      label: "Catalog type",
      value: service,
      mono: true,
      copyText: service,
    });
    const seconds: number | null = getOpenStackCollectionSeconds(row);
    if (seconds !== null) {
      details.push({
        key: "collection",
        label: "Last collection took",
        value: `${translator.formatNumber(Math.round(seconds * 100) / 100)} s`,
        description: OPENSTACK_METRIC_DESCRIPTIONS.apiCollectionTime,
      });
    }
  } else {
    details.push({
      key: "binary",
      label: "Binary",
      value: row.name || "",
      mono: true,
      copyText: row.name || "",
    });
    details.push({
      key: "host",
      label: "Host",
      value: host.data ? (
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOST_VIEW] as Route,
            {
              modelId: host.data.id!,
            },
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
          dataTestId="openstack-service-host-link"
        >
          <bdi>{getOpenStackWorkerHost(row)}</bdi>
        </Link>
      ) : (
        getOpenStackWorkerHost(row)
      ),
      copyText: getOpenStackWorkerHost(row),
    });
    const adminState: string = getOpenStackAdminStateText(row, translator);
    if (adminState) {
      details.push({
        key: "admin-state",
        label: "Admin state",
        value: adminState,
        description: OPENSTACK_METRIC_DESCRIPTIONS.workerAdminState,
      });
    }
    if (row.disabledReason) {
      details.push({
        key: "disabled-reason",
        label: "Disabled reason",
        value: row.disabledReason,
      });
    }
    if (row.availabilityZone) {
      details.push({
        key: "zone",
        label: "Availability zone",
        value: row.availabilityZone,
      });
    }
    if (hypervisor) {
      const route: Route | undefined = part.routes.routeFor(hypervisor);
      details.push({
        key: "hypervisor",
        label: "Hypervisor",
        value: route ? (
          <Link
            to={route}
            className="text-indigo-600 hover:text-indigo-700 hover:underline"
            dataTestId="openstack-service-hypervisor-link"
          >
            <bdi>{hypervisor.name}</bdi>
          </Link>
        ) : (
          hypervisor.name || ""
        ),
      });
    }
    const agentId: JSONValue | undefined = (row.facts || {})["agentId"];
    if (typeof agentId === "string") {
      details.push({
        key: "id",
        label: "ID",
        value: agentId,
        mono: true,
        copyText: agentId,
      });
    }
  }
  if (row.regionName) {
    details.push({ key: "region", label: "Region", value: row.regionName });
  }
  const timeInState: string = getOpenStackTimeInState(row, now);
  if (timeInState) {
    details.push({
      key: "state-since",
      label: "In this state for",
      value: timeInState,
      description: translationKey(
        "As far as OneUptime has seen. It counts from the first report that showed this state.",
      ),
    });
  }

  const isDown: boolean = isApi
    ? row.status === "down"
    : isOpenStackServiceDown({
        status: row.status,
        adminState: row.adminState,
      });

  return (
    <div data-testid="openstack-service-overview">
      {isLastKnown ? (
        <OpenStackPartNotice
          testId="openstack-service-last-known"
          tone="warning"
          text="Its API isn't answering, so nothing has been able to read this worker since. It reads as it last did."
        />
      ) : (
        <></>
      )}
      {staleAgentIds.length > 0 ? (
        <OpenStackPartNotice
          testId="openstack-service-stale-records"
          tone="neutral"
        >
          {translator.translatePlural(
            {
              one: "Neutron still lists {{count}} stale record for this agent, left by a crash or a new system-id. The agent itself is up, and this is not an outage. To clear it: openstack network agent delete {{ids}}",
              other:
                "Neutron still lists {{count}} stale records for this agent, left by a crash or a new system-id. The agent itself is up, and this is not an outage. To clear them: openstack network agent delete {{ids}}",
            },
            staleAgentIds.length,
            { ids: staleAgentIds.join(" ") },
          )}
        </OpenStackPartNotice>
      ) : (
        <></>
      )}

      {attention.error ? (
        <div className="mb-6">
          <ResourcePartReadError
            testId="openstack-service-attention-error"
            title="Couldn't read what needs attention"
            message={attention.error}
            onRetry={attention.reload}
          />
        </div>
      ) : (
        <NeedsAttentionCard
          testId="openstack-service-attention"
          items={items}
          current={{
            key: `${row.kind}/${row.externalId}`,
            label: isApi ? THIS_API : THIS_SERVICE,
          }}
          description={
            isApi
              ? "What is wrong with this API and the workers it answers for, the most urgent first."
              : "What is wrong with this worker, by the same rules as the cloud's."
          }
        />
      )}

      {/*
       * "What runs on it, and whose is it?" is what a failure asks. Asked of everything
       * that is fine, it is a list of every project in the region.
       */}
      {isDown &&
      (isApi ||
        row.name === "nova-compute" ||
        row.name === "neutron-l3-agent") ? (
        <OpenStackBlastRadiusCard
          testId="openstack-service-blast-radius"
          openStackCloudId={part.openStackCloudId}
          kind={row.kind as OpenStackResourceKind}
          externalId={row.externalId || ""}
          routes={part.routes}
          description={
            isApi
              ? "What nobody can manage in this region while this API isn't answering, and whose it is."
              : "What nobody can manage while this worker is down, and whose it is."
          }
          refreshToken={part.refreshToken}
        />
      ) : (
        <></>
      )}

      {isApi && workers.length > 0 ? (
        <div className="mb-6" data-testid="openstack-service-workers">
          <Card
            title="Workers"
            description="The workers this API answers for, what needs someone first."
          >
            <ul className={listClassName}>
              {sortOpenStackWorkers(workers, now).map(
                (worker: OpenStackResource): ReactElement => {
                  return (
                    <OpenStackWorkerRow
                      key={worker.externalId}
                      row={worker}
                      to={part.routes.routeFor(worker)}
                      now={now}
                    />
                  );
                },
              )}
            </ul>
          </Card>
        </div>
      ) : (
        <></>
      )}

      <OpenStackPartOpenEvents
        testId="openstack-service-open"
        title={isApi ? "Open on this API" : "Open on this worker"}
        description="Unresolved incidents and alerts about it, incidents first."
        part={part}
        row={row}
        isAbout={
          isApi
            ? (record: OpenIssueRecord): boolean => {
                return isOpenStackIssueAboutService({
                  labels: record.seriesLabels,
                  service: service,
                  regionName: row.regionName,
                  workers: workers,
                });
              }
            : (record: OpenIssueRecord): boolean => {
                return isOpenStackIssueAbout(record, row);
              }
        }
      />

      <OpenStackPartAlerts
        testId="openstack-service-alerts"
        title={isApi ? "Alerts on this service" : "Alerts on this worker"}
        description="The cloud's alerts that watch this: each is one monitor that fires for any part that crosses it, in any region."
        templateIds={
          isApi
            ? getOpenStackServiceAlertTemplateIds(service)
            : getOpenStackWorkerAlertTemplateIds(row)
        }
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-service-details"
        description={
          isApi
            ? "What Keystone's catalog and the agent's collection say about this API."
            : "What OpenStack's own service list says about this worker."
        }
        rows={details}
      />
    </div>
  );
};

export default OpenStackServiceOverview;
