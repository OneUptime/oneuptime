import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { OPENSTACK_ANCHOR_METRIC_ALIAS } from "../../../Types/Monitor/OpenStackAlertTemplates";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT,
  OpenStackBlastRadius,
  OpenStackBlastRadiusProject,
  describeOpenStackBlastRadius,
  describeOpenStackBlastRadiusCounts,
  isOpenStackBlastRadiusEmpty,
} from "../../../Types/OpenStack/OpenStackBlastRadius";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceUsageReading,
  mergeOpenStackInstanceUsage,
  rankOpenStackInstancesByCpu,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  OpenStackLinkedService,
  OpenStackReachAcrossProducts,
  describeOpenStackReachAcrossProducts,
  isOpenStackReachEmpty,
} from "../../../Types/OpenStack/OpenStackLinks";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import MetricService from "../../Services/MetricService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { OPENSTACK_API_UP_METRIC_NAMES } from "../Telemetry/OpenStackSnapshotScan";
import OpenStackAcrossProducts from "./OpenStackAcrossProducts";

/*
 * WHAT AN ALERT OR INCIDENT ON A PART OF AN OPENSTACK CLOUD TAKES WITH IT, AND WHOSE IT IS.
 *
 * A monitor's series says which part crossed the line: a nova-compute by its binary and
 * host, a router by its ID. From that this finds the part's row and reads its blast
 * radius (OpenStackResourceService.getBlastRadius, the one answer every page reads), so
 * the alert can say "3 instances in 2 projects" and name them.
 *
 * Naming them is also what reaches their owners. An owner or label rule on one project
 * matches the marker this writes (getOpenStackProjectMarker), so a project's incidents
 * reach the team that runs it through the rules every alert already goes through.
 *
 * Never in the way of the alert: if any of this fails, the alert opens without it.
 */

// One series' labels, in any of the spellings ingest and the exporter write them.
function readLabel(labels: JSONObject | undefined, key: string): string | null {
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = labels?.[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export interface OpenStackSeriesPart {
  kind: OpenStackResourceKind;
  externalId: string;
}

/*
 * The parts one series may be about, most likely first. A series names its part by
 * labels, and `id` means an instance on one series and a router on another, so each is a
 * candidate for a row to confirm. The ID labels are unique across a cloud, and a region
 * and host name together are what makes a worker's row: see serviceRowId in
 * OpenStackSnapshotScan. A series that names none of these is about a whole region, and
 * the metric it came from says which service's API that is.
 */
export function getOpenStackPartOfSeries(
  labels: JSONObject | undefined,
  metricNames?: ReadonlyArray<string> | undefined,
): Array<OpenStackSeriesPart> {
  const region: string =
    readLabel(labels, "openstack.region.name") || "default";
  const service: string | null = readLabel(labels, "service");
  const host: string | null = readLabel(labels, "hostname");
  const parts: Array<OpenStackSeriesPart> = [];

  if (service && host) {
    for (const family of ["compute", "network", "volume"]) {
      parts.push({
        kind: OpenStackResourceKind.Service,
        externalId: `${region}/${family}/${host}/${service}`,
      });
    }
  }

  if (host) {
    parts.push({
      kind: OpenStackResourceKind.Hypervisor,
      externalId: `${region}/${host}`,
    });
  }

  const hypervisor: string | null = readLabel(labels, "hypervisor_hostname");
  if (hypervisor && !host) {
    parts.push({
      kind: OpenStackResourceKind.Hypervisor,
      externalId: `${region}/${hypervisor}`,
    });
  }

  const router: string | null = readLabel(labels, "router_id");
  if (router) {
    parts.push({ kind: OpenStackResourceKind.Router, externalId: router });
  }

  const id: string | null =
    readLabel(labels, "uuid") ||
    readLabel(labels, "id") ||
    readLabel(labels, OPENSTACK_INSTANCE_ID_ATTRIBUTE);
  if (id) {
    parts.push(
      { kind: OpenStackResourceKind.Router, externalId: id },
      { kind: OpenStackResourceKind.Instance, externalId: id },
      { kind: OpenStackResourceKind.Volume, externalId: id },
    );
  }

  const name: string | null = readLabel(labels, "name");
  if (name && name.includes("@")) {
    // Cinder writes a pool as host@backend#pool, and nothing else takes that shape.
    parts.push({
      kind: OpenStackResourceKind.StoragePool,
      externalId: `${region}/${name}`,
    });
  }

  /*
   * Only a monitor of nothing but those APIs: one that also reads instances in ERROR per
   * region is about those instances, and must not say it takes the whole region with it.
   */
  const apis: Array<string | undefined> = (metricNames || []).map(
    (metricName: string): string | undefined => {
      return OPENSTACK_API_UP_METRIC_NAMES.get(metricName);
    },
  );
  if (parts.length === 0 && apis.length > 0 && apis.every(Boolean)) {
    for (const api of apis) {
      parts.push({
        kind: OpenStackResourceKind.Api,
        externalId: `${region}/${api}`,
      });
    }
  }

  return parts;
}

/*
 * The series an OpenStack monitor reads, from its steps. Step JSON is not schema-checked,
 * so each step is read for what it holds rather than trusted to hold it.
 */
export function getOpenStackMetricNamesOfMonitor(
  monitorSteps: unknown,
): Array<string> {
  const names: Array<string> = [];
  const steps: unknown = (monitorSteps as JSONObject | undefined)?.["data"];
  const list: unknown = (steps as JSONObject | undefined)?.[
    "monitorStepsInstanceArray"
  ];

  for (const step of Array.isArray(list) ? list : []) {
    const configs: unknown = (step as JSONObject)?.["data"];
    const openstack: unknown = (configs as JSONObject | undefined)?.[
      "openstackMonitor"
    ];
    const view: unknown = (openstack as JSONObject | undefined)?.[
      "metricViewConfig"
    ];
    const queries: unknown = (view as JSONObject | undefined)?.["queryConfigs"];

    for (const query of Array.isArray(queries) ? queries : []) {
      /*
       * A template's anchor reads an API's _up only to tell a part that went away from a
       * cloud that went quiet. It says nothing about what the monitor is about.
       */
      const alias: unknown = (
        (query as JSONObject)?.["metricAliasData"] as JSONObject | undefined
      )?.["metricVariable"];
      if (alias === OPENSTACK_ANCHOR_METRIC_ALIAS) {
        continue;
      }

      const name: unknown = (
        (query as JSONObject)?.["metricQueryData"] as JSONObject | undefined
      )?.["filterData"];
      const metricName: unknown = (name as JSONObject | undefined)?.[
        "metricName"
      ];
      if (typeof metricName === "string") {
        names.push(metricName);
      }
    }
  }

  return names;
}

// The project a series names for itself, which needs no radius to find.
export function getOpenStackProjectOfSeries(
  labels: JSONObject | undefined,
): string | null {
  return readLabel(labels, "tenant_id") || readLabel(labels, "project_id");
}

export interface OpenStackAlertContextResult {
  radius: OpenStackBlastRadius | null;
  // A project the series itself names, whether or not it has a radius.
  projectId: string | null;
  projectName: string | null;
  domainId: string | null;
  partKind: OpenStackResourceKind | null;
  // Its row's id, when the series names a part with a row.
  partExternalId?: string | undefined;
  /*
   * On a hypervisor that has passed a line on what its instances really use, the instances
   * responsible, with how long each is waiting where the source says.
   */
  busiestInstances?: Array<OpenStackBusyInstance> | undefined;
}

// One of a hypervisor's instances, by the name people know it by.
export interface OpenStackBusyInstance extends OpenStackInstanceUsageReading {
  name: string | null;
}

// A monitor on a hypervisor's real load is the one that names its instances.
const HYPERVISOR_USAGE_METRICS: ReadonlyArray<string> = Object.values(
  OpenStackHypervisorMetric,
);

const BUSIEST_INSTANCES_IN_AN_ALERT: number = 5;
// As long as the templates' own window, so what is named is what fired it.
const BUSIEST_INSTANCES_WINDOW_MINUTES: number = 15;

export default class OpenStackAlertContext {
  public static async read(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    seriesLabels: JSONObject | undefined;
    metricNames?: ReadonlyArray<string> | undefined;
  }): Promise<OpenStackAlertContextResult> {
    const result: OpenStackAlertContextResult = {
      radius: null,
      projectId: getOpenStackProjectOfSeries(data.seriesLabels),
      projectName: null,
      domainId: null,
      partKind: null,
    };

    for (const candidate of getOpenStackPartOfSeries(
      data.seriesLabels,
      data.metricNames,
    )) {
      const part: OpenStackResource | null =
        await OpenStackResourceService.findOneBy({
          query: {
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            kind: candidate.kind,
            externalId: candidate.externalId,
          },
          select: {
            kind: true,
            name: true,
            regionName: true,
            hypervisorName: true,
            openStackProjectId: true,
            externalId: true,
            facts: true,
          },
          props: { isRoot: true },
        });

      if (!part) {
        continue;
      }

      result.partKind = candidate.kind;
      result.partExternalId = candidate.externalId;
      result.projectId = result.projectId || part.openStackProjectId || null;
      result.radius = await OpenStackResourceService.getBlastRadius({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        part: {
          kind: candidate.kind,
          name: part.name,
          regionName: part.regionName,
          hypervisorName: part.hypervisorName,
          externalId: part.externalId,
          facts: part.facts,
        },
      });
      /*
       * Beyond the cloud: best effort on its own, so a Kubernetes or Host read that fails
       * leaves the alert with what the cloud itself said.
       */
      try {
        const reach: OpenStackReachAcrossProducts | null =
          await OpenStackAcrossProducts.getReachOfPart({
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            part: {
              kind: candidate.kind,
              name: part.name,
              regionName: part.regionName,
              hypervisorName: part.hypervisorName,
              facts: part.facts,
            },
          });
        if (reach && result.radius) {
          result.radius.acrossProducts = reach;
        }
      } catch (error) {
        logger.warn(
          `Could not read what an OpenStack part reaches beyond the cloud: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (
        candidate.kind === OpenStackResourceKind.Hypervisor &&
        part.hypervisorName &&
        (data.metricNames || []).some((name: string): boolean => {
          return HYPERVISOR_USAGE_METRICS.includes(name);
        })
      ) {
        result.busiestInstances = await this.readBusiestInstances({
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          hypervisorName: part.hypervisorName,
        });
      }
      break;
    }

    if (result.projectId) {
      const project: OpenStackResource | null =
        await OpenStackResourceService.findOneBy({
          query: {
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            kind: OpenStackResourceKind.Project,
            externalId: result.projectId,
          },
          select: { name: true, facts: true },
          props: { isRoot: true },
        });
      result.projectName = project?.name || null;
      const domainId: unknown = (project?.facts as JSONObject | undefined)?.[
        "domainId"
      ];
      result.domainId = typeof domainId === "string" ? domainId : null;
    }

    return result;
  }

  // Never in the way: an alert with no names beside it still fires, and its page has them.
  public static async readBusiestInstances(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    hypervisorName: string;
  }): Promise<Array<OpenStackBusyInstance>> {
    try {
      const cloud: OpenStackCloud | null =
        await OpenStackCloudService.findOneById({
          id: data.openStackCloudId,
          select: { name: true },
          props: { isRoot: true },
        });
      if (!cloud?.name) {
        return [];
      }
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -BUSIEST_INSTANCES_WINDOW_MINUTES,
      );
      const readSeries: (
        metricName: OpenStackInstanceMetric,
      ) => Promise<Map<string, number>> = async (
        metricName: OpenStackInstanceMetric,
      ): Promise<Map<string, number>> => {
        const series: AggregatedResult = await MetricService.aggregateBy({
          query: {
            projectId: data.projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              "resource.openstack.cloud.name": cloud.name as string,
              [OPENSTACK_HYPERVISOR_ATTRIBUTE]: data.hypervisorName,
            },
          } as never,
          aggregationType: AggregationType.Avg,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          aggregationInterval: AggregationInterval.Total,
          startTimestamp: startDate,
          endTimestamp: endDate,
          groupByAttributeKeys: [OPENSTACK_INSTANCE_ID_ATTRIBUTE],
          limit: 1000,
          skip: 0,
          props: { isRoot: true },
        });
        const values: Map<string, number> = new Map();
        for (const point of (series.data || []) as Array<AggregatedModel>) {
          const attributes: JSONObject =
            (point["attributes"] as unknown as JSONObject | undefined) || {};
          const instanceId: unknown =
            attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE];
          const value: number = Number(point["value"]);
          if (typeof instanceId === "string" && Number.isFinite(value)) {
            values.set(instanceId, value);
          }
        }
        return values;
      };

      const [cpuCores, cpuPercent, contentionPercent, memoryResidentBytes]: [
        Map<string, number>,
        Map<string, number>,
        Map<string, number>,
        Map<string, number>,
      ] = await Promise.all([
        readSeries(OpenStackInstanceMetric.CpuUsage),
        readSeries(OpenStackInstanceMetric.CpuUtilization),
        readSeries(OpenStackInstanceMetric.CpuContention),
        readSeries(OpenStackInstanceMetric.MemoryResident),
      ]);

      const busiest: Array<OpenStackInstanceUsageReading> =
        rankOpenStackInstancesByCpu(
          mergeOpenStackInstanceUsage({
            cpuCores,
            cpuPercent,
            contentionPercent,
            memoryResidentBytes,
          }),
          BUSIEST_INSTANCES_IN_AN_ALERT,
        );

      const rows: Array<OpenStackResource> =
        busiest.length > 0
          ? await OpenStackResourceService.findBy({
              query: {
                projectId: data.projectId,
                openStackCloudId: data.openStackCloudId,
                kind: OpenStackResourceKind.Instance,
                externalId: QueryHelper.any(
                  busiest.map(
                    (reading: OpenStackInstanceUsageReading): string => {
                      return reading.instanceId;
                    },
                  ),
                ),
              },
              select: { externalId: true, name: true },
              limit: busiest.length,
              skip: 0,
              props: { isRoot: true },
            })
          : [];

      return busiest.map(
        (reading: OpenStackInstanceUsageReading): OpenStackBusyInstance => {
          return {
            ...reading,
            name:
              rows.find((row: OpenStackResource): boolean => {
                return row.externalId === reading.instanceId;
              })?.name || null,
          };
        },
      );
    } catch (error) {
      logger.warn(
        `Could not name a hypervisor's busiest instances: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /*
   * The lines for a description: what it affects, then each project with the marker a
   * rule matches. Nothing at all when there is nothing to say: most series name no part
   * with a reach, and a radius the collector cannot read is for the part's page to say.
   */
  public static toMarkdown(context: OpenStackAlertContextResult): string {
    const sections: Array<MarkdownText> = [];

    if (context.projectId) {
      const domain: MarkdownText = context.domainId
        ? mdText`, OpenStack domain ${FeedMarkdown.code(context.domainId)}`
        : FeedMarkdown.empty();
      sections.push(
        mdText`**Project:** ${context.projectName || context.projectId} (OpenStack project ${FeedMarkdown.code(context.projectId)}${domain}).`,
      );
    }

    const radius: OpenStackBlastRadius | null = context.radius;

    if (radius && radius.isKnown && !isOpenStackBlastRadiusEmpty(radius)) {
      const projectLines: Array<MarkdownText> = radius.projects.map(
        (project: OpenStackBlastRadiusProject): MarkdownText => {
          const domain: MarkdownText = project.domainId
            ? mdText`, OpenStack domain ${FeedMarkdown.code(project.domainId)}`
            : FeedMarkdown.empty();
          return mdText`${project.name || project.projectId}: ${describeOpenStackBlastRadiusCounts(project)} (OpenStack project ${FeedMarkdown.code(project.projectId)}${domain})`;
        },
      );

      if (radius.projectCount > radius.projects.length) {
        projectLines.push(
          mdText`and ${radius.projectCount - radius.projects.length} more, past the ${OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT} named here`,
        );
      }

      sections.push(
        mdText`**What this affects:** ${describeOpenStackBlastRadius(radius)}.`,
      );

      if (projectLines.length > 0) {
        sections.push(FeedMarkdown.bulletList(projectLines));
      }
    }

    const reach: OpenStackReachAcrossProducts | null | undefined =
      radius?.acrossProducts;
    if (reach && !isOpenStackReachEmpty(reach)) {
      const lines: Array<MarkdownText> = [
        ...reach.kubernetesClusters.map(
          (cluster: { name: string; nodeCount: number }): MarkdownText => {
            return mdText`Kubernetes cluster ${cluster.name}: ${cluster.nodeCount} ${cluster.nodeCount === 1 ? "node" : "nodes"}`;
          },
        ),
        ...reach.services.map(
          (service: OpenStackLinkedService): MarkdownText => {
            return mdText`Service ${service.name}`;
          },
        ),
      ];
      sections.push(
        mdText`**Beyond the cloud:** ${describeOpenStackReachAcrossProducts(reach)}.`,
      );
      if (lines.length > 0) {
        sections.push(FeedMarkdown.bulletList(lines));
      }
    }

    if (context.busiestInstances && context.busiestInstances.length > 0) {
      sections.push(mdText`**Using the most of it:**`);
      sections.push(
        FeedMarkdown.bulletList(
          context.busiestInstances.map(
            (instance: OpenStackBusyInstance): MarkdownText => {
              const cores: string =
                instance.cpuCores === null
                  ? "no CPU reading"
                  : `${instance.cpuCores.toFixed(1)} CPU threads`;
              const waiting: string =
                instance.contentionPercent === null
                  ? ""
                  : `, waiting ${Math.round(instance.contentionPercent)}% of its time`;
              return mdText`${instance.name || instance.instanceId}: ${cores}${waiting} (OpenStack instance ${FeedMarkdown.code(instance.instanceId)})`;
            },
          ),
        ),
      );
    }

    return sections.length > 0
      ? FeedMarkdown.join(sections, "\n\n").toString()
      : "";
  }

  /*
   * A description with what the series affects added, or as it was. Takes the clouds the
   * alert or incident was just linked to, since only an OpenStack monitor's series has
   * any of this to say.
   */
  public static async addToDescription(data: {
    description: string | undefined;
    projectId: ObjectID;
    clouds: Array<OpenStackCloud> | undefined;
    seriesLabels: JSONObject | undefined;
    monitorSteps?: unknown;
  }): Promise<string | undefined> {
    const cloudId: ObjectID | null | undefined = data.clouds?.[0]?.id;

    if (!cloudId || !data.seriesLabels) {
      return data.description;
    }

    try {
      const lines: string = OpenStackAlertContext.toMarkdown(
        await OpenStackAlertContext.read({
          projectId: data.projectId,
          openStackCloudId: cloudId,
          seriesLabels: data.seriesLabels,
          metricNames: getOpenStackMetricNamesOfMonitor(data.monitorSteps),
        }),
      );

      if (!lines) {
        return data.description;
      }

      return data.description ? `${data.description}\n\n${lines}` : lines;
    } catch (error) {
      logger.error(
        `Could not say what an OpenStack alert affects: ${error instanceof Error ? error.message : String(error)}`,
      );
      return data.description;
    }
  }
}
