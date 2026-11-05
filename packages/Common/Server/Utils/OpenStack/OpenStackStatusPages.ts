import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "../../../Models/DatabaseModels/OpenStackCloudCheck";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplatesForCloud,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import { getOpenStackNoticeRecipient } from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_PROJECT_PAGE_KINDS,
  OpenStackProjectPagePlan,
  OpenStackProjectPagePlanRow,
  OpenStackProjectPageRow,
  OpenStackStatusPageExistingMonitor,
  OpenStackStatusPagePlan,
  OpenStackStatusPagePlanGroup,
  OpenStackStatusPagePlanMonitor,
  OpenStackStatusPagePlanRow,
  OpenStackStatusPageRegion,
  buildOpenStackProjectPagePlan,
  buildOpenStackStatusPagePlan,
  getOpenStackStatusPagePlanKey,
} from "../../../Types/OpenStack/OpenStackStatusPagePlan";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import AlertSeverityService from "../../Services/AlertSeverityService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MonitorGroupResourceService from "../../Services/MonitorGroupResourceService";
import MonitorGroupService from "../../Services/MonitorGroupService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import OpenStackCloudCheckService from "../../Services/OpenStackCloudCheckService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackProjectNoticeService from "../../Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";
import StatusPageGroupService from "../../Services/StatusPageGroupService";
import StatusPageResourceService from "../../Services/StatusPageResourceService";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  getCloudOfOpenStackMonitor,
  getOpenStackTemplateOfMonitors,
} from "./OpenStackMonitorDependencies";

/*
 * MAKING A CLOUD'S STATUS PAGES, AND WHAT BACKS THEM.
 *
 * Everything made here is an ordinary status page, group, resource, monitor and objective, made through
 * their own services with the permissions of whoever asked, so each stays editable where it always is,
 * and nothing about any of them reads differently afterwards. What's here is only the one step.
 *
 * Nothing is made that the person asking hasn't been shown: a make holds the plan's key, and a plan that
 * has changed since is refused and read again.
 */

export const OPENSTACK_OBJECTIVE_TARGET_PERCENT: number = 99.9;
export const OPENSTACK_OBJECTIVE_WINDOW_DAYS: number = 30;

interface ProjectDefaults {
  onlineStatusId: ObjectID;
  offlineStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

export interface OpenStackStatusPageMade {
  statusPageId: string;
  monitorsMade: number;
}

export interface OpenStackObjectivesMade {
  objectivesMade: number;
  // Already there, by name: making these again leaves them as they are.
  objectivesLeft: number;
  monitorsMade: number;
}

function monitorsOfPlan(
  plan: OpenStackStatusPagePlan,
  includeChecks: boolean,
): Array<OpenStackStatusPagePlanMonitor> {
  return plan.groups.flatMap((group: OpenStackStatusPagePlanGroup) => {
    return group.rows.flatMap((row: OpenStackStatusPagePlanRow) => {
      return includeChecks
        ? [...row.monitors, ...row.checkMonitors]
        : row.monitors;
    });
  });
}

// The filters a monitor reads through, when it reads the whole of a service and nothing narrower.
function getRegionOfWholeServiceMonitor(monitor: Monitor): {
  isWholeService: boolean;
  regionName: string | null;
} {
  let regionName: string | null = null;

  for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    const filters: Record<string, unknown> =
      (step.data?.openstackMonitor?.resourceFilters as
        | Record<string, unknown>
        | undefined) || {};

    for (const key of Object.keys(filters)) {
      if (!filters[key]) {
        continue;
      }
      if (key !== "regionName") {
        return { isWholeService: false, regionName: null };
      }
      regionName = String(filters[key]);
    }
  }

  return { isWholeService: true, regionName };
}

export default class OpenStackStatusPages {
  private static async readCloud(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackCloud> {
    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: data.openStackCloudId,
        select: { name: true, collectionMethod: true },
        props: { isRoot: true },
      });

    if (!cloud?.name) {
      throw new BadDataException("This cloud has no name to make a page for.");
    }

    return cloud;
  }

  private static async readRegions(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackStatusPageRegion>> {
    const apis: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Api,
        },
        select: { name: true, regionName: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });
    const regions: Map<string, OpenStackStatusPageRegion> = new Map();

    for (const api of apis) {
      const key: string = api.regionName || "";
      const region: OpenStackStatusPageRegion = regions.get(key) || {
        regionName: api.regionName || null,
        apiNames: [],
      };
      regions.set(key, {
        ...region,
        apiNames: [...region.apiNames, api.name || ""],
      });
    }

    return Array.from(regions.values());
  }

  public static async readExistingMonitors(data: {
    projectId: ObjectID;
    cloudName: string;
  }): Promise<Array<OpenStackStatusPageExistingMonitor>> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.OpenStack,
      },
      select: {
        _id: true,
        name: true,
        monitorSteps: true,
        disableActiveMonitoring: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const existing: Array<OpenStackStatusPageExistingMonitor> = [];

    for (const monitor of monitors) {
      if (
        monitor.disableActiveMonitoring ||
        getCloudOfOpenStackMonitor(monitor) !== data.cloudName
      ) {
        continue;
      }

      const { isWholeService, regionName } =
        getRegionOfWholeServiceMonitor(monitor);

      // One narrowed to a host or a project says nothing of the whole service.
      if (!isWholeService) {
        continue;
      }

      const templateId: string | undefined = Array.from(
        getOpenStackTemplateOfMonitors({
          cloud: data.cloudName,
          monitors: [monitor],
        }).keys(),
      )[0];

      if (templateId) {
        existing.push({
          id: (monitor._id || "").toString(),
          name: monitor.name || "",
          templateId,
          regionName,
        });
      }
    }

    return existing;
  }

  public static async readPlan(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackStatusPagePlan> {
    const cloud: OpenStackCloud = await this.readCloud(data);
    const [regions, existingMonitors, check]: [
      Array<OpenStackStatusPageRegion>,
      Array<OpenStackStatusPageExistingMonitor>,
      OpenStackCloudCheck | null,
    ] = await Promise.all([
      this.readRegions(data),
      this.readExistingMonitors({
        projectId: data.projectId,
        cloudName: cloud.name!,
      }),
      OpenStackCloudCheckService.findOneBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
        },
        select: { isApiCheckEnabled: true, isLifecycleCheckEnabled: true },
        props: { isRoot: true },
      }),
    ]);

    const offered: Set<string> = new Set(
      getOpenStackAlertTemplatesForCloud({
        isApiCheckOn: check?.isApiCheckEnabled,
        isLifecycleCheckOn: check?.isLifecycleCheckEnabled,
        services: regions.flatMap(
          (region: OpenStackStatusPageRegion): Array<string> => {
            return [...region.apiNames];
          },
        ),
      }).map((template: OpenStackAlertTemplate): string => {
        return template.id;
      }),
    );

    const templateNames: Record<string, string> = {};

    for (const template of getAllOpenStackAlertTemplates()) {
      templateNames[template.id] = template.name;
    }

    return buildOpenStackStatusPagePlan({
      cloudName: cloud.name!,
      regions,
      existingMonitors,
      templateNames,
      isTemplateOffered: (templateId: string): boolean => {
        return offered.has(templateId);
      },
    });
  }

  private static async readProjectDefaults(
    projectId: ObjectID,
  ): Promise<ProjectDefaults> {
    const [statuses, incidentSeverity, alertSeverity]: [
      Array<MonitorStatus>,
      IncidentSeverity | null,
      AlertSeverity | null,
    ] = await Promise.all([
      MonitorStatusService.findBy({
        query: { projectId },
        select: { _id: true, isOperationalState: true, isOfflineState: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      IncidentSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      }),
      AlertSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      }),
    ]);

    const online: MonitorStatus | undefined = statuses.find(
      (status: MonitorStatus): boolean => {
        return Boolean(status.isOperationalState);
      },
    );
    const offline: MonitorStatus | undefined = statuses.find(
      (status: MonitorStatus): boolean => {
        return Boolean(status.isOfflineState);
      },
    );

    if (!online?.id || !offline?.id || !incidentSeverity?.id || !alertSeverity?.id) {
      throw new BadDataException(
        "This project is missing a monitor status or a severity to make monitors with.",
      );
    }

    return {
      onlineStatusId: online.id,
      offlineStatusId: offline.id,
      incidentSeverityId: incidentSeverity.id,
      alertSeverityId: alertSeverity.id,
    };
  }

  // A monitor from one of the cloud's templates, exactly as Recommendations makes one, for one region.
  public static buildMonitor(data: {
    projectId: ObjectID;
    cloudName: string;
    plan: OpenStackStatusPagePlanMonitor;
    defaults: ProjectDefaults;
  }): Monitor {
    const recommendation: MonitorRecommendation | undefined =
      MonitorRecommendationCatalog.getAllPossibleRecommendations(
        MonitorRecommendationResourceType.OpenStack,
      ).find((candidate: MonitorRecommendation): boolean => {
        return (
          candidate.templateId === data.plan.templateId &&
          candidate.monitorType === MonitorType.OpenStack
        );
      });

    if (!recommendation) {
      throw new BadDataException(
        `There is no template to make ${data.plan.name} from.`,
      );
    }

    const monitorSteps: MonitorSteps =
      MonitorRecommendationUtil.buildMonitorSteps({
        recommendation,
        args: {
          resourceIdentifier: data.cloudName,
          onlineMonitorStatusId: data.defaults.onlineStatusId,
          offlineMonitorStatusId: data.defaults.offlineStatusId,
          defaultIncidentSeverityId: data.defaults.incidentSeverityId,
          defaultAlertSeverityId: data.defaults.alertSeverityId,
          monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
            recommendation,
            resourceDisplayName: data.cloudName,
          }),
        },
        defaultMonitorStatusId: data.defaults.onlineStatusId,
      });

    for (const step of (monitorSteps.data?.monitorStepsInstanceArray ||
      []) as Array<MonitorStep>) {
      const config: MonitorStep["data"] = step.data;

      if (config?.openstackMonitor && data.plan.regionName) {
        config.openstackMonitor.resourceFilters = {
          ...config.openstackMonitor.resourceFilters,
          regionName: data.plan.regionName,
        };
      }

      // Another monitor already opens the incident for this failure: this one says which region's row.
      if (data.plan.incidentsOpenedBy) {
        for (const instance of config?.monitorCriteria?.data
          ?.monitorCriteriaInstanceArray || []) {
          if (instance.data) {
            instance.data.createIncidents = false;
            instance.data.createAlerts = false;
          }
        }
      }
    }

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = data.plan.name;
    monitor.description = recommendation.description;
    monitor.monitorType = MonitorType.OpenStack;
    monitor.monitorSteps = monitorSteps;

    return monitor;
  }

  private static async makeMissingMonitors(data: {
    projectId: ObjectID;
    cloudName: string;
    plan: OpenStackStatusPagePlan;
    includeChecks: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ ids: Map<OpenStackStatusPagePlanMonitor, string>; made: number }> {
    const ids: Map<OpenStackStatusPagePlanMonitor, string> = new Map();
    const madeByName: Map<string, string> = new Map();
    const missing: Array<OpenStackStatusPagePlanMonitor> = monitorsOfPlan(
      data.plan,
      data.includeChecks,
    ).filter((monitor: OpenStackStatusPagePlanMonitor): boolean => {
      if (monitor.existingMonitorId) {
        ids.set(monitor, monitor.existingMonitorId);
        return false;
      }
      return true;
    });

    if (missing.length === 0) {
      return { ids, made: 0 };
    }

    const defaults: ProjectDefaults = await this.readProjectDefaults(
      data.projectId,
    );

    for (const plan of missing) {
      const already: string | undefined = madeByName.get(plan.name);

      if (already) {
        ids.set(plan, already);
        continue;
      }

      const created: Monitor = await MonitorService.create({
        data: this.buildMonitor({
          projectId: data.projectId,
          cloudName: data.cloudName,
          plan,
          defaults,
        }),
        props: data.props,
      });
      const id: string = created.id!.toString();
      madeByName.set(plan.name, id);
      ids.set(plan, id);
    }

    return { ids, made: madeByName.size };
  }

  /*
   * One monitor backs a row as it is. Several, which is what a service has, back it through a monitor group,
   * which reads as its worst one, on the page and in its uptime.
   */
  private static async backRow(data: {
    projectId: ObjectID;
    cloudName: string;
    group: OpenStackStatusPagePlanGroup;
    row: OpenStackStatusPagePlanRow;
    ids: Map<OpenStackStatusPagePlanMonitor, string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ monitorId?: ObjectID; monitorGroupId?: ObjectID }> {
    const monitorIds: Array<string> = data.row.monitors
      .map((monitor: OpenStackStatusPagePlanMonitor): string => {
        return data.ids.get(monitor) || "";
      })
      .filter(Boolean);

    if (monitorIds.length === 1) {
      return { monitorId: new ObjectID(monitorIds[0]!) };
    }

    const name: string = data.group.regionName
      ? `${data.cloudName} - ${data.row.service} (${data.group.regionName})`
      : `${data.cloudName} - ${data.row.service}`;

    const existing: MonitorGroup | null = await MonitorGroupService.findOneBy({
      query: { projectId: data.projectId, name },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (existing?.id) {
      return { monitorGroupId: existing.id };
    }

    const monitorGroup: MonitorGroup = new MonitorGroup();
    monitorGroup.projectId = data.projectId;
    monitorGroup.name = name;
    const created: MonitorGroup = await MonitorGroupService.create({
      data: monitorGroup,
      props: data.props,
    });

    for (const monitorId of monitorIds) {
      const resource: MonitorGroupResource = new MonitorGroupResource();
      resource.projectId = data.projectId;
      resource.monitorGroupId = created.id!;
      resource.monitorId = new ObjectID(monitorId);
      await MonitorGroupResourceService.create({
        data: resource,
        props: data.props,
      });
    }

    return { monitorGroupId: created.id! };
  }

  public static async makeStatusPage(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    planKey: unknown;
    name?: string | undefined;
    isPublic: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<OpenStackStatusPageMade> {
    const cloud: OpenStackCloud = await this.readCloud(data);
    const plan: OpenStackStatusPagePlan = await this.readPlan(data);

    if (data.planKey !== getOpenStackStatusPagePlanKey(plan)) {
      throw new BadDataException(
        "This cloud has changed since you looked. Look at what this would make again.",
      );
    }

    if (plan.groups.length === 0) {
      throw new BadDataException(
        "OneUptime sees none of this cloud's services yet, so there is nothing to put on a page.",
      );
    }

    const { ids, made } = await this.makeMissingMonitors({
      projectId: data.projectId,
      cloudName: cloud.name!,
      plan,
      includeChecks: false,
      props: data.props,
    });

    const page: StatusPage = new StatusPage();
    page.projectId = data.projectId;
    page.name = data.name?.trim() || plan.name;
    page.pageTitle = page.name;
    page.isPublicStatusPage = data.isPublic;

    const created: StatusPage = await StatusPageService.create({
      data: page,
      props: data.props,
    });

    try {
      let groupOrder: number = 0;

      for (const group of plan.groups) {
        groupOrder += 1;
        const statusPageGroup: StatusPageGroup = new StatusPageGroup();
        statusPageGroup.projectId = data.projectId;
        statusPageGroup.statusPageId = created.id!;
        statusPageGroup.name = group.name;
        statusPageGroup.order = groupOrder;
        statusPageGroup.isExpandedByDefault = true;
        statusPageGroup.showCurrentStatus = true;

        const createdGroup: StatusPageGroup =
          await StatusPageGroupService.create({
            data: statusPageGroup,
            props: data.props,
          });

        let rowOrder: number = 0;

        for (const row of group.rows) {
          rowOrder += 1;
          const backing: { monitorId?: ObjectID; monitorGroupId?: ObjectID } =
            await this.backRow({
              projectId: data.projectId,
              cloudName: cloud.name!,
              group,
              row,
              ids,
              props: data.props,
            });

          const resource: StatusPageResource = new StatusPageResource();
          resource.projectId = data.projectId;
          resource.statusPageId = created.id!;
          resource.statusPageGroupId = createdGroup.id!;
          resource.displayName = row.service;
          resource.order = rowOrder;
          resource.showCurrentStatus = true;
          resource.showStatusHistoryChart = true;
          resource.showUptimePercent = true;

          if (backing.monitorId) {
            resource.monitorId = backing.monitorId;
          }
          if (backing.monitorGroupId) {
            resource.monitorGroupId = backing.monitorGroupId;
          }

          await StatusPageResourceService.create({
            data: resource,
            props: data.props,
          });
        }
      }
    } catch (error) {
      // Half a page tells people less than no page. What it was backed by stays, and is reused.
      logger.error(
        `Could not finish a status page for an OpenStack cloud: ${error instanceof Error ? error.message : String(error)}`,
      );
      await StatusPageService.deleteOneById({
        id: created.id!,
        props: { isRoot: true },
      });
      throw error;
    }

    return { statusPageId: created.id!.toString(), monitorsMade: made };
  }

  /*
   * An objective for each row, in the SLO product: the uptime of its monitors, by region and service, and of
   * what a check from outside says of it, once that check is on. Uptime and not a metric, because a metric
   * objective is not evaluated yet (SliType.Metric). Those monitors read the same series with the windows
   * their alerts use, so an objective can't disagree with what paged.
   */
  public static async makeObjectives(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    planKey: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<OpenStackObjectivesMade> {
    const cloud: OpenStackCloud = await this.readCloud(data);
    const plan: OpenStackStatusPagePlan = await this.readPlan(data);

    if (data.planKey !== getOpenStackStatusPagePlanKey(plan)) {
      throw new BadDataException(
        "This cloud has changed since you looked. Look at what this would make again.",
      );
    }

    const { ids, made } = await this.makeMissingMonitors({
      projectId: data.projectId,
      cloudName: cloud.name!,
      plan,
      includeChecks: true,
      props: data.props,
    });

    let objectivesMade: number = 0;
    let objectivesLeft: number = 0;

    for (const group of plan.groups) {
      for (const row of group.rows) {
        const name: string = group.regionName
          ? `${cloud.name} - ${row.service} (${group.regionName})`
          : `${cloud.name} - ${row.service}`;

        const existing: ServiceLevelObjective | null =
          await ServiceLevelObjectiveService.findOneBy({
            query: { projectId: data.projectId, name },
            select: { _id: true },
            props: { isRoot: true },
          });

        if (existing) {
          objectivesLeft += 1;
          continue;
        }

        const monitors: Array<Monitor> = Array.from(
          new Set(
            [...row.monitors, ...row.checkMonitors].map(
              (monitor: OpenStackStatusPagePlanMonitor): string => {
                return ids.get(monitor) || "";
              },
            ),
          ),
        )
          .filter(Boolean)
          .map((id: string): Monitor => {
            const monitor: Monitor = new Monitor();
            monitor._id = id;
            return monitor;
          });

        const objective: ServiceLevelObjective = new ServiceLevelObjective();
        objective.projectId = data.projectId;
        objective.name = name;
        objective.description = `Whether ${row.service} works${group.regionName ? ` in ${group.regionName}` : ""}, from the monitors of this OpenStack cloud.`;
        objective.sliType = SliType.MonitorUptime;
        objective.multiMonitorMode = SloMultiMonitorMode.AnyDown;
        objective.monitors = monitors;
        objective.targetPercentage = OPENSTACK_OBJECTIVE_TARGET_PERCENT;
        objective.windowType = SloWindowType.Rolling;
        objective.windowDays = OPENSTACK_OBJECTIVE_WINDOW_DAYS;

        await ServiceLevelObjectiveService.create({
          data: objective,
          props: data.props,
        });
        objectivesMade += 1;
      }
    }

    return { objectivesMade, objectivesLeft, monitorsMade: made };
  }

  // What a project holds, by kind and region, for the rows of its page.
  public static async readProjectPagePlan(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    openStackProjectId: string;
  }): Promise<OpenStackProjectPagePlan & { isProjectInCloud: boolean }> {
    const projectRow: OpenStackResource | null =
      await OpenStackResourceService.findOneBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.Project,
          externalId: data.openStackProjectId,
        },
        select: { name: true },
        props: { isRoot: true },
      });

    const holdings: Array<{
      kind: string;
      regionName: string | null;
      count: number;
    }> = [];

    for (const kind of OPENSTACK_PROJECT_PAGE_KINDS) {
      const rows: Array<OpenStackResource> =
        await OpenStackResourceService.findBy({
          query: {
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            kind,
            openStackProjectId: data.openStackProjectId,
          },
          select: { regionName: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: { isRoot: true },
        });

      const byRegion: Map<string, number> = new Map();

      for (const row of rows) {
        const region: string = row.regionName || "";
        byRegion.set(region, (byRegion.get(region) || 0) + 1);
      }

      for (const [region, count] of byRegion.entries()) {
        holdings.push({ kind, regionName: region || null, count });
      }
    }

    return {
      ...buildOpenStackProjectPagePlan({
        projectName: projectRow?.name || null,
        projectId: data.openStackProjectId,
        holdings,
      }),
      isProjectInCloud: Boolean(projectRow),
    };
  }

  /*
   * A project's private page. Private from its first moment, and told about only what reaches that project:
   * see OpenStackProjectPages. Whoever made it has seen who it tells, which is nobody until they add a
   * private user to it, so it starts on. Someone can turn it off like any other notice.
   */
  public static async makeProjectPage(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    openStackProjectId: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<OpenStackStatusPageMade> {
    const plan: OpenStackProjectPagePlan & { isProjectInCloud: boolean } =
      await this.readProjectPagePlan(data);

    if (!plan.isProjectInCloud) {
      throw new BadDataException(
        "OneUptime does not see this project in the cloud.",
      );
    }

    const existing: OpenStackProjectNotice | null =
      await OpenStackProjectNoticeService.findOneBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          openStackProjectId: data.openStackProjectId,
          statusPageId: QueryHelper.notNull(),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (existing) {
      throw new BadDataException("This project already has its own page.");
    }

    const page: StatusPage = new StatusPage();
    page.projectId = data.projectId;
    page.name = plan.name;
    page.pageTitle = plan.name;
    page.isPublicStatusPage = false;
    // Whatever is added to it later, nothing reaches it that wasn't limited to it.
    page.onlyShowScopedIncidents = true;

    const created: StatusPage = await StatusPageService.create({
      data: page,
      props: data.props,
    });

    try {
      const rows: Array<OpenStackProjectPageRow> = [];
      const groups: Map<string, StatusPageGroup> = new Map();
      let rowOrder: number = 0;

      for (const row of plan.rows) {
        const groupKey: string = row.regionName || "";
        let group: StatusPageGroup | undefined = groups.get(groupKey);

        if (!group) {
          const statusPageGroup: StatusPageGroup = new StatusPageGroup();
          statusPageGroup.projectId = data.projectId;
          statusPageGroup.statusPageId = created.id!;
          statusPageGroup.name = row.regionName || plan.name;
          statusPageGroup.order = groups.size + 1;
          statusPageGroup.isExpandedByDefault = true;
          statusPageGroup.showCurrentStatus = true;
          group = await StatusPageGroupService.create({
            data: statusPageGroup,
            props: data.props,
          });
          groups.set(groupKey, group);
        }

        const monitor: Monitor = await this.makeRowMonitor({
          projectId: data.projectId,
          plan: row,
          props: data.props,
        });

        rowOrder += 1;
        const resource: StatusPageResource = new StatusPageResource();
        resource.projectId = data.projectId;
        resource.statusPageId = created.id!;
        resource.statusPageGroupId = group.id!;
        resource.monitorId = monitor.id!;
        resource.displayName = row.service;
        resource.order = rowOrder;
        resource.showCurrentStatus = true;
        resource.showStatusHistoryChart = true;
        resource.showUptimePercent = true;

        await StatusPageResourceService.create({
          data: resource,
          props: data.props,
        });

        rows.push({
          regionName: row.regionName,
          service: row.service,
          monitorId: monitor.id!.toString(),
        });
      }

      const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
      notice.projectId = data.projectId;
      notice.openStackCloudId = data.openStackCloudId;
      notice.openStackProjectId = data.openStackProjectId;
      notice.statusPageId = created.id!;
      notice.statusPageRows = rows;
      notice.isEnabled = false;

      const createdNotice: OpenStackProjectNotice =
        await OpenStackProjectNoticeService.create({
          data: notice,
          props: { isRoot: true },
        });

      await OpenStackProjectNoticeService.updateOneById({
        id: createdNotice.id!,
        data: {
          isEnabled: true,
          previewSeenAt: OneUptimeDate.getCurrentDate(),
          previewSeenByUserId: data.props.userId || null,
          previewedRecipient: getOpenStackNoticeRecipient({
            statusPageId: created.id!.toString(),
          }),
        } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Could not finish a status page for an OpenStack project: ${error instanceof Error ? error.message : String(error)}`,
      );
      await StatusPageService.deleteOneById({
        id: created.id!,
        props: { isRoot: true },
      });
      throw error;
    }

    return { statusPageId: created.id!.toString(), monitorsMade: plan.rows.length };
  }

  private static async makeRowMonitor(data: {
    projectId: ObjectID;
    plan: OpenStackProjectPagePlanRow;
    props: DatabaseCommonInteractionProps;
  }): Promise<Monitor> {
    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = data.plan.monitorName;
    monitor.description =
      "A row of an OpenStack project's private status page. OneUptime turns it red while a failure reaches this project.";
    monitor.monitorType = MonitorType.Manual;

    return await MonitorService.create({
      data: monitor,
      props: data.props,
    });
  }
}
