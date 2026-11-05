import { JSONObject } from "../JSON";
import {
  OPENSTACK_STATUS_PAGE_SERVICES,
  OpenStackStatusPageService,
  OpenStackStatusPageServiceEntry,
} from "./OpenStackStatusPageService";
import { OpenStackResourceKind } from "./OpenStackResourceKind";

/*
 * WHAT MAKING A STATUS PAGE FOR A CLOUD WILL DO, BEFORE IT DOES IT.
 *
 * Regions as groups, and each region's services as rows, each backed by the monitors that say whether it
 * works. A monitor that already watches what a row needs is reused, because a second one beside it would
 * open a second incident for the same failure. Only what's missing is made, and the plan says which before
 * anything is. So making it is two steps with one answer: this says what would happen, a person reads it,
 * and the same answer is what's made, or the make is refused because the cloud has changed since.
 *
 * Pure, so a page, a test and the server can all read it.
 */

export interface OpenStackStatusPageRegion {
  // Null for a cloud whose API rows name no region at all.
  regionName: string | null;
  // The API rows it has: `compute`, `network`... A service it doesn't have shows no trace.
  apiNames: ReadonlyArray<string>;
}

// A monitor of this cloud already made from one of its templates.
export interface OpenStackStatusPageExistingMonitor {
  id: string;
  name: string;
  templateId: string;
  // Null for a monitor of the whole cloud.
  regionName: string | null;
}

export interface OpenStackStatusPagePlanMonitor {
  templateId: string;
  // What it is called, or will be.
  name: string;
  regionName: string | null;
  // Null when it will be made.
  existingMonitorId: string | null;
  /*
   * Set when this one will open nothing itself: a monitor of the whole cloud already opens the incident
   * for this failure, and this only says which region's row goes red.
   */
  incidentsOpenedBy?: string | undefined;
}

export interface OpenStackStatusPagePlanRow {
  service: OpenStackStatusPageService;
  monitors: Array<OpenStackStatusPagePlanMonitor>;
  // What an objective for this row reads too, once a check is on. Never on the page's row.
  checkMonitors: Array<OpenStackStatusPagePlanMonitor>;
}

export interface OpenStackStatusPagePlanGroup {
  regionName: string | null;
  name: string;
  rows: Array<OpenStackStatusPagePlanRow>;
}

export interface OpenStackStatusPagePlan {
  name: string;
  groups: Array<OpenStackStatusPagePlanGroup>;
  monitorsToMake: number;
  monitorsReused: number;
}

function monitorName(data: {
  cloudName: string;
  templateName: string;
  regionName: string | null;
}): string {
  const base: string = `${data.cloudName} - ${data.templateName}`;
  return data.regionName ? `${base} (${data.regionName})` : base;
}

function planMonitor(data: {
  templateId: string;
  regionName: string | null;
  cloudName: string;
  templateName: string;
  regionCount: number;
  existing: ReadonlyArray<OpenStackStatusPageExistingMonitor>;
}): OpenStackStatusPagePlanMonitor {
  const ofTemplate: Array<OpenStackStatusPageExistingMonitor> =
    data.existing.filter(
      (monitor: OpenStackStatusPageExistingMonitor): boolean => {
        return monitor.templateId === data.templateId;
      },
    );

  const sameRegion: OpenStackStatusPageExistingMonitor | undefined =
    ofTemplate.find((monitor: OpenStackStatusPageExistingMonitor): boolean => {
      return monitor.regionName === data.regionName;
    });

  if (sameRegion) {
    return {
      templateId: data.templateId,
      name: sameRegion.name,
      regionName: data.regionName,
      existingMonitorId: sameRegion.id,
    };
  }

  const wholeCloud: OpenStackStatusPageExistingMonitor | undefined =
    ofTemplate.find((monitor: OpenStackStatusPageExistingMonitor): boolean => {
      return monitor.regionName === null;
    });

  // With one region, one that reads the whole cloud reads that region. It is the row's monitor.
  if (wholeCloud && data.regionCount === 1) {
    return {
      templateId: data.templateId,
      name: wholeCloud.name,
      regionName: data.regionName,
      existingMonitorId: wholeCloud.id,
    };
  }

  /*
   * With several, one region failing would turn every region's row red on it, so the row needs its own.
   * That one opens nothing, or one failure would open two incidents.
   */
  return {
    templateId: data.templateId,
    name: monitorName({
      cloudName: data.cloudName,
      templateName: data.templateName,
      regionName: data.regionName,
    }),
    regionName: data.regionName,
    existingMonitorId: null,
    ...(wholeCloud ? { incidentsOpenedBy: wholeCloud.name } : {}),
  };
}

function sortedRegions(
  regions: ReadonlyArray<OpenStackStatusPageRegion>,
): Array<OpenStackStatusPageRegion> {
  return [...regions].sort(
    (
      first: OpenStackStatusPageRegion,
      second: OpenStackStatusPageRegion,
    ): number => {
      return (first.regionName || "").localeCompare(second.regionName || "");
    },
  );
}

export function buildOpenStackStatusPagePlan(data: {
  cloudName: string;
  regions: ReadonlyArray<OpenStackStatusPageRegion>;
  existingMonitors: ReadonlyArray<OpenStackStatusPageExistingMonitor>;
  // Every template's name, by its id. One that isn't here isn't planned.
  templateNames: Readonly<Record<string, string>>;
  // Which checks this cloud has on, by what they let an objective read.
  isTemplateOffered?: ((templateId: string) => boolean) | undefined;
}): OpenStackStatusPagePlan {
  const groups: Array<OpenStackStatusPagePlanGroup> = [];
  const regions: Array<OpenStackStatusPageRegion> = sortedRegions(data.regions);

  const plan: (
    templateIds: ReadonlyArray<string>,
    regionName: string | null,
  ) => Array<OpenStackStatusPagePlanMonitor> = (
    templateIds: ReadonlyArray<string>,
    regionName: string | null,
  ): Array<OpenStackStatusPagePlanMonitor> => {
    return templateIds
      .filter((templateId: string): boolean => {
        return (
          Boolean(data.templateNames[templateId]) &&
          (!data.isTemplateOffered || data.isTemplateOffered(templateId))
        );
      })
      .map((templateId: string): OpenStackStatusPagePlanMonitor => {
        return planMonitor({
          templateId,
          regionName,
          cloudName: data.cloudName,
          templateName: data.templateNames[templateId]!,
          regionCount: regions.length,
          existing: data.existingMonitors,
        });
      });
  };

  for (const region of regions) {
    const rows: Array<OpenStackStatusPagePlanRow> = [];

    for (const entry of OPENSTACK_STATUS_PAGE_SERVICES) {
      if (!region.apiNames.includes(entry.apiName)) {
        continue;
      }

      const monitors: Array<OpenStackStatusPagePlanMonitor> = plan(
        entry.templateIds,
        region.regionName,
      );

      // Nothing to say whether it works is nothing to show.
      if (monitors.length > 0) {
        rows.push({
          service: entry.service,
          monitors,
          checkMonitors: plan(entry.checkTemplateIds, region.regionName),
        });
      }
    }

    if (rows.length > 0) {
      groups.push({
        regionName: region.regionName,
        name: region.regionName || data.cloudName,
        rows,
      });
    }
  }

  const monitors: Array<OpenStackStatusPagePlanMonitor> = groups.flatMap(
    (group: OpenStackStatusPagePlanGroup) => {
      return group.rows.flatMap((row: OpenStackStatusPagePlanRow) => {
        return row.monitors;
      });
    },
  );

  return {
    name: `${data.cloudName} status`,
    groups,
    monitorsToMake: monitors.filter(
      (monitor: OpenStackStatusPagePlanMonitor): boolean => {
        return !monitor.existingMonitorId;
      },
    ).length,
    monitorsReused: new Set(
      monitors
        .map((monitor: OpenStackStatusPagePlanMonitor): string => {
          return monitor.existingMonitorId || "";
        })
        .filter(Boolean),
    ).size,
  };
}

/*
 * What a person was shown, as one string: a make is held to it, so a monitor added or a region gone since
 * then refuses the make rather than do something they never read.
 */
export function getOpenStackStatusPagePlanKey(
  plan: OpenStackStatusPagePlan,
): string {
  return JSON.stringify(
    plan.groups.map((group: OpenStackStatusPagePlanGroup) => {
      return [
        group.regionName,
        group.rows.map((row: OpenStackStatusPagePlanRow) => {
          return [
            row.service,
            row.monitors.map((monitor: OpenStackStatusPagePlanMonitor) => {
              return [monitor.templateId, monitor.existingMonitorId];
            }),
          ];
        }),
      ];
    }),
  );
}

/*
 * A PROJECT'S OWN PAGE.
 *
 * Its rows are what that project uses, and only that: Compute where it has instances, Networking where it
 * has routers or addresses, Block Storage where it has volumes, in each region it is in. Each is a monitor
 * of that page's alone, which goes red only when a failure reaches this project. So nothing on the page, or
 * its API, can come from anyone else: there is nothing of anyone else's for it to read.
 */

export interface OpenStackProjectPageRow {
  regionName: string | null;
  service: OpenStackStatusPageService;
  monitorId: string;
}

export interface OpenStackProjectPagePlanRow {
  regionName: string | null;
  service: OpenStackStatusPageService;
  monitorName: string;
  // How much of it the project has, so the plan reads as what the project will recognise.
  holdingCount: number;
}

export interface OpenStackProjectPagePlan {
  name: string;
  rows: Array<OpenStackProjectPagePlanRow>;
}

const SERVICE_OF_PROJECT_KIND: Readonly<
  Partial<Record<OpenStackResourceKind, OpenStackStatusPageService>>
> = {
  [OpenStackResourceKind.Instance]: OpenStackStatusPageService.Compute,
  [OpenStackResourceKind.Router]: OpenStackStatusPageService.Networking,
  [OpenStackResourceKind.FloatingIp]: OpenStackStatusPageService.Networking,
  [OpenStackResourceKind.Volume]: OpenStackStatusPageService.BlockStorage,
  [OpenStackResourceKind.LoadBalancer]:
    OpenStackStatusPageService.LoadBalancing,
};

export const OPENSTACK_PROJECT_PAGE_KINDS: ReadonlyArray<OpenStackResourceKind> =
  Object.keys(SERVICE_OF_PROJECT_KIND) as Array<OpenStackResourceKind>;

export function buildOpenStackProjectPagePlan(data: {
  projectName: string | null;
  projectId: string;
  // What the project holds, by kind and region.
  holdings: ReadonlyArray<{
    kind: string;
    regionName: string | null;
    count: number;
  }>;
}): OpenStackProjectPagePlan {
  const name: string = data.projectName || data.projectId;
  const rows: Map<string, OpenStackProjectPagePlanRow> = new Map();

  for (const holding of data.holdings) {
    const service: OpenStackStatusPageService | undefined =
      SERVICE_OF_PROJECT_KIND[holding.kind as OpenStackResourceKind];

    if (!service || holding.count <= 0) {
      continue;
    }

    const key: string = `${holding.regionName || ""}|${service}`;
    const row: OpenStackProjectPagePlanRow = rows.get(key) || {
      regionName: holding.regionName,
      service,
      monitorName: holding.regionName
        ? `${name} - ${service} (${holding.regionName})`
        : `${name} - ${service}`,
      holdingCount: 0,
    };
    row.holdingCount += holding.count;
    rows.set(key, row);
  }

  const order: Array<OpenStackStatusPageService> =
    OPENSTACK_STATUS_PAGE_SERVICES.map(
      (entry: OpenStackStatusPageServiceEntry): OpenStackStatusPageService => {
        return entry.service;
      },
    );

  return {
    name: `${name} status`,
    rows: Array.from(rows.values()).sort(
      (
        first: OpenStackProjectPagePlanRow,
        second: OpenStackProjectPagePlanRow,
      ): number => {
        return (
          (first.regionName || "").localeCompare(second.regionName || "") ||
          order.indexOf(first.service) - order.indexOf(second.service)
        );
      },
    ),
  };
}

// Step JSON and row JSON are not schema-checked, so every row is read for what it holds.
export function readOpenStackProjectPageRows(
  value: unknown,
): Array<OpenStackProjectPageRow> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<OpenStackProjectPageRow> = [];

  for (const item of value as Array<unknown>) {
    const row: JSONObject = (item || {}) as JSONObject;

    if (
      typeof row["monitorId"] === "string" &&
      Object.values(OpenStackStatusPageService).includes(
        row["service"] as OpenStackStatusPageService,
      )
    ) {
      rows.push({
        monitorId: row["monitorId"],
        service: row["service"] as OpenStackStatusPageService,
        regionName:
          typeof row["regionName"] === "string" ? row["regionName"] : null,
      });
    }
  }

  return rows;
}
