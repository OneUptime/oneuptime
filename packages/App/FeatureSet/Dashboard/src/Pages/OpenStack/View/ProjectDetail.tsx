import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackProjectQuota,
  getOpenStackProjectQuotas,
} from "Common/Types/OpenStack/OpenStackQuota";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import OpenStackProjectUsageCard from "../../../Components/OpenStack/OpenStackProjectUsageCard";
import OpenStackQuotaCard from "../../../Components/OpenStack/OpenStackQuotaCard";
import OpenStackProjectNoticesCard from "../../../Components/OpenStack/OpenStackProjectNoticesCard";
import OpenStackProjectPageButton from "../../../Components/OpenStack/OpenStackProjectPageButton";
import OpenStackScopedRulesCard, {
  OpenStackRuleScope,
} from "../../../Components/OpenStack/OpenStackScopedRulesCard";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
  openStackIdFromRouteParam,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import { OPENSTACK_LIST_PROJECT_PARAM } from "../../../Components/OpenStack/UseOpenStackDomainFilter";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import ResourcePartHero from "../../../Components/ResourcePart/ResourcePartHero";
import ResourcePartOpenEventsCard from "../../../Components/ResourcePart/ResourcePartOpenEventsCard";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import {
  OpenIssueRecord,
  readSeriesLabel,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  OpenStackProjectHostDown,
  OpenStackProjectLabel,
  OpenStackProjectOverview,
  fetchOpenStackDomainOptions,
  fetchOpenStackProjectOverview,
} from "../Utils/OpenStackProjectReads";
import { getOpenStackFactText } from "../Utils/OpenStackResourceUtils";

/*
 * One OpenStack project: whose it is, what it runs, what in it needs someone, how close
 * it is to its quotas, and who is told when something it depends on fails. A hypervisor
 * that goes down is nobody in the project's fault and everybody in it's problem, so the
 * hosts under it are said here as well as its own parts.
 */

const LABEL_FLAG: string = "--nova.metadata-extra-labels";

// A sentence kept here, and looked up where Needs attention draws it.
const REASON_HOST_DOWN: { one: string; other: string } = {
  one: translationKey("Down, with {{count}} of this project's instances on it"),
  other: translationKey(
    "Down, with {{count}} of this project's instances on it",
  ),
};

// What a list opens on when this page links to it.
const WHAT_IT_RUNS: ReadonlyArray<{
  key:
    | "instanceCount"
    | "volumeCount"
    | "networkCount"
    | "routerCount"
    | "floatingIpCount"
    | "stackCount"
    | "containerClusterCount"
    | "shareCount"
    | "loadBalancerCount"
    | "databaseInstanceCount"
    | "dnsZoneCount"
    | "objectContainerCount";
  page: PageMap;
  one: string;
  other: string;
}> = [
  {
    key: "instanceCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
    one: "{{count}} instance",
    other: "{{count}} instances",
  },
  {
    key: "volumeCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
    one: "{{count}} volume",
    other: "{{count}} volumes",
  },
  {
    key: "networkCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
    one: "{{count}} network",
    other: "{{count}} networks",
  },
  {
    key: "routerCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
    one: "{{count}} router",
    other: "{{count}} routers",
  },
  {
    key: "floatingIpCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
    one: "{{count}} floating IP",
    other: "{{count}} floating IPs",
  },
  {
    key: "stackCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_STACKS,
    one: "{{count}} stack",
    other: "{{count}} stacks",
  },
  {
    key: "containerClusterCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS,
    one: "{{count}} Kubernetes cluster",
    other: "{{count}} Kubernetes clusters",
  },
  {
    key: "shareCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_SHARES,
    one: "{{count}} share",
    other: "{{count}} shares",
  },
  {
    key: "loadBalancerCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_LOAD_BALANCERS,
    one: "{{count}} load balancer",
    other: "{{count}} load balancers",
  },
  {
    key: "databaseInstanceCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCES,
    one: "{{count}} database",
    other: "{{count}} databases",
  },
  {
    key: "objectContainerCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINERS,
    one: "{{count}} container",
    other: "{{count}} containers",
  },
  {
    key: "dnsZoneCount",
    page: PageMap.OPENSTACK_CLOUD_VIEW_DNS_ZONES,
    one: "{{count}} DNS zone",
    other: "{{count}} DNS zones",
  },
];

// What is about this project: it names the project, or a host holding its instances.
export function isOpenStackIssueAboutProject(data: {
  record: OpenIssueRecord;
  projectId: string;
  hostsDown: Array<OpenStackProjectHostDown>;
}): boolean {
  const labels: JSONObject | null = data.record.seriesLabels;
  const named: string | null =
    readSeriesLabel(labels, "tenant_id") ||
    readSeriesLabel(labels, "project_id");

  if (named) {
    return named === data.projectId;
  }

  const host: string | null =
    readSeriesLabel(labels, "hostname") ||
    readSeriesLabel(labels, "hypervisor_hostname");

  return Boolean(
    host &&
      data.hostsDown.some((down: OpenStackProjectHostDown): boolean => {
        return (
          down.hypervisorName === host ||
          down.hypervisorName.startsWith(`${host}.`)
        );
      }),
  );
}

const OpenStackCloudProjectDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const projectId: string = openStackIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(modelId);

  const [row, setRow] = useState<OpenStackResource | null>(null);
  const [overview, setOverview] = useState<OpenStackProjectOverview | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [domainNames, setDomainNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchOpenStackDomainOptions(modelId)
      .then((options: Array<DropdownOption>) => {
        const names: Record<string, string> = {};
        for (const option of options) {
          names[String(option.value)] = option.label;
        }
        setDomainNames(names);
      })
      .catch(() => {
        // The domain's ID stands in for its name, and is just as true.
      });
  }, [modelId.toString()]);

  const load: () => void = useCallback((): void => {
    setIsLoading(true);
    setError("");

    Promise.all([
      ModelAPI.getList<OpenStackResource>({
        modelType: OpenStackResource,
        query: {
          openStackCloudId: modelId,
          kind: OpenStackResourceKind.Project,
          externalId: projectId,
        },
        limit: 1,
        skip: 0,
        select: {
          kind: true,
          name: true,
          externalId: true,
          openStackProjectId: true,
          status: true,
          facts: true,
          lastSeenAt: true,
        },
        sort: {},
      }),
      fetchOpenStackProjectOverview({
        openStackCloudId: modelId,
        projectId: projectId,
      }),
    ])
      .then(
        ([rows, answer]: [
          ListResult<OpenStackResource>,
          OpenStackProjectOverview,
        ]) => {
          setRow(rows.data[0] || null);
          setOverview(answer);
        },
      )
      .catch((err: unknown) => {
        setError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [modelId.toString(), projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading && !overview) {
    return <ComponentLoader />;
  }

  if (error) {
    return (
      <ResourcePartReadError
        testId="openstack-project-error"
        title="Couldn't load this project"
        message={error}
        onRetry={load}
      />
    );
  }

  if (!row || !overview) {
    return (
      <ResourcePartReadError
        testId="openstack-project-missing"
        title="This project is not in this cloud's inventory"
        message={
          translator.translateText(
            "It may have been deleted, or this cloud's credential may no longer see it.",
          ) || ""
        }
        onRetry={load}
      />
    );
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const name: string = row.name || projectId;
  const facts: JSONObject = (row.facts as JSONObject | undefined) || {};
  const quotas: Array<OpenStackProjectQuota> = getOpenStackProjectQuotas(
    facts,
    now,
  );
  const scope: OpenStackRuleScope = {
    kind: "project",
    id: projectId,
    name: name,
  };
  const domainId: string = getOpenStackFactText(row, "domainId");
  const description: string = getOpenStackFactText(row, "description");
  const parentId: string = getOpenStackFactText(row, "parentId");
  const tags: string = getOpenStackFactText(row, "tags");

  const hostItems: Array<ResourceAttentionItem> = overview.hostsDown.map(
    (host: OpenStackProjectHostDown): ResourceAttentionItem => {
      return {
        key: `host/${host.externalId}`,
        kind: translationKey("Hypervisor"),
        icon: IconProp.ServerStack,
        name: host.hypervisorName,
        detail: host.regionName || undefined,
        severity: ResourceAttentionSeverity.Critical,
        reasons: [
          {
            text: REASON_HOST_DOWN.other,
            values: { count: `${host.instanceCount}` },
            plural: { one: REASON_HOST_DOWN.one, count: host.instanceCount },
          },
        ],
        route: routes.getPartRoute(
          OpenStackResourceKind.Hypervisor,
          host.externalId,
        ),
      };
    },
  );

  const items: Array<ResourceAttentionItem> = [
    ...hostItems,
    ...getOpenStackAttentionItems({
      // The project's own row is among them when it is at a quota.
      rows: overview.attentionRows,
      now: now,
      routeFor: routes.routeFor,
    }),
  ];

  return (
    <div className="space-y-5" data-testid="openstack-project">
      <ResourcePartHero
        testId="openstack-project-hero"
        icon={IconProp.Folder}
        accent="indigo"
        name={name}
        status={
          row.status
            ? {
                label: "{{status}}",
                values: { status: row.status },
                tone: row.status === "enabled" ? "positive" : "neutral",
              }
            : undefined
        }
        location={
          domainId ? (
            <bdi>
              {translator.translateTemplate("Domain {{domain}}", {
                domain: domainNames[domainId] || domainId,
              })}
            </bdi>
          ) : undefined
        }
        lastReportAt={row.lastSeenAt}
        tags={overview.labels.map((label: OpenStackProjectLabel): string => {
          return `${label.key}=${label.value}`;
        })}
      />

      <NeedsAttentionCard
        items={items}
        testId="openstack-project-attention"
        description="What in this project needs someone, and the hosts down under it."
      />

      <Card
        title="What it runs"
        description="Everything this project owns, each opening the list on this project."
      >
        <ul
          data-testid="openstack-project-runs"
          className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
        >
          {WHAT_IT_RUNS.map(
            (thing: (typeof WHAT_IT_RUNS)[number]): ReactElement => {
              return (
                <li key={thing.key}>
                  <Link
                    to={RouteUtil.addQuery(
                      RouteUtil.populateRouteParams(
                        RouteMap[thing.page] as Route,
                        { modelId: modelId },
                      ),
                      { [OPENSTACK_LIST_PROJECT_PARAM]: projectId },
                    )}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    <>
                      {translator.translatePlural(
                        { one: thing.one, other: thing.other },
                        overview.summary[thing.key],
                      )}
                    </>
                  </Link>
                </li>
              );
            },
          )}
        </ul>
      </Card>

      <OpenStackQuotaCard openStackCloudId={modelId} quotas={quotas} />

      <OpenStackProjectUsageCard
        openStackCloudId={modelId}
        openStackProjectId={projectId}
      />

      <ResourcePartOpenEventsCard
        testId="openstack-project-open"
        title="Open on this project"
        description="Unresolved incidents and alerts that name this project, or a host holding its instances."
        resourceRelation="openStackClouds"
        resourceId={modelId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isOpenStackIssueAboutProject({
            record,
            projectId,
            hostsDown: overview.hostsDown,
          });
        }}
        getIncidentRoute={routes.getIncidentRoute}
        getAlertRoute={routes.getAlertRoute}
        incidentsRoute={routes.incidentsRoute}
        alertsRoute={routes.alertsRoute}
      />

      <div className="mb-6">
        <OpenStackProjectNoticesCard
          openStackCloudId={modelId}
          openStackProjectId={projectId}
        />
      </div>
      <div className="mb-6">
        <OpenStackProjectPageButton
          openStackCloudId={modelId}
          openStackProjectId={projectId}
        />
      </div>
      <OpenStackScopedRulesCard mode="owner" scope={scope} />
      <OpenStackScopedRulesCard mode="label" scope={scope} />

      {overview.labels.length === 0 ? (
        <p
          data-testid="openstack-project-labels-how"
          className="px-1 text-sm text-gray-500"
        >
          {translator.translateTemplate(
            "Labels here come from Nova metadata. To see a key, add {{flag}} with it to the exporter's command.",
            { flag: LABEL_FLAG },
          )}
        </p>
      ) : null}

      <ResourcePartDetailsCard
        testId="openstack-project-details"
        description="What Keystone says about this project."
        rows={[
          {
            key: "id",
            label: "ID",
            value: projectId,
            mono: true,
            copyText: projectId,
          },
          ...(domainId
            ? [
                {
                  key: "domain",
                  label: "Domain ID",
                  value: domainId,
                  mono: true,
                  copyText: domainId,
                },
              ]
            : []),
          ...(parentId && parentId !== domainId
            ? [
                {
                  key: "parent",
                  label: "Parent",
                  value: parentId,
                  mono: true,
                  copyText: parentId,
                },
              ]
            : []),
          ...(description
            ? [{ key: "description", label: "Description", value: description }]
            : []),
          ...(tags ? [{ key: "tags", label: "Tags", value: tags }] : []),
        ]}
      />
    </div>
  );
};

export default OpenStackCloudProjectDetail;
