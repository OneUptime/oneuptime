import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import VercelMarketplaceConnection from "Common/Models/DatabaseModels/VercelMarketplaceConnection";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import ObjectID from "Common/Types/ObjectID";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import VercelMarketplaceConnectionService from "Common/Server/Services/VercelMarketplaceConnectionService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import logger from "Common/Server/Utils/Logger";
import VercelMarketplaceAPI from "./VercelMarketplaceAPI";
import VercelMarketplaceResources from "./VercelMarketplaceResources";
import VercelResource, {
  VERCEL_METADATA_KEYS,
  VercelResourceDetails,
} from "./VercelResource";

/*
 * Uptime monitoring for the Vercel projects connected to a OneUptime
 * resource.
 *
 * When a team connects a Vercel project to the resource, Vercel tells
 * OneUptime (integration-resource.project-connected) and names the
 * project's production domain. OneUptime then watches it with a website
 * monitor in the resource's project - checked from OneUptime's probes, like
 * one made in the dashboard, and billed as any active monitor - and adds it
 * to the resource's status page. A project connected before its first
 * production deployment has no domain yet: its monitor is made at that
 * deployment (deployment.succeeded), from the domains Vercel lists for it.
 * Disconnecting the project deletes its monitor.
 *
 * A resource whose "Monitor production domains" setting is off gets none;
 * turning it on later makes the ones still missing (addMissingMonitors).
 * A monitor that cannot be made - the plan's monitor limit, say - is logged
 * and left out; the connection is remembered, and turning the setting off
 * and on, or the next production deployment, tries again.
 */

export interface VercelProjectConnectionEvent {
  installationId: string;
  resourceId: string;
  vercelProjectId: string;
  vercelProjectName?: string | undefined;
  productionDomain?: string | undefined;
}

export interface VercelProductionDeploymentEvent {
  vercelProjectId: string;
  // The installations (and their resources) Vercel says the deployment is for, when it says.
  installationIds: Array<string>;
  resourceIds: Array<string>;
}

// A domain as Vercel names it - a host name, no scheme, path or port.
const DOMAIN_PATTERN: RegExp =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

// Every character JavaScript's . does not match.
const LINE_BREAK: RegExp = /[\n\r\u2028\u2029]/;

export default class VercelMarketplaceMonitors {
  public static normalizeDomain(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    let domain: string = value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "");

    // A domain is one line: a value with a line break in it is none.
    if (LINE_BREAK.test(domain)) {
      return null;
    }

    /*
     * Only the host: whatever follows its first slash goes. Cut with indexOf
     * rather than a pattern - /\/.*$/ tried every slash in turn, in time
     * that grew with the square of a run of them (code scanning #2311).
     */
    const pathStart: number = domain.indexOf("/");

    if (pathStart !== -1) {
      domain = domain.slice(0, pathStart);
    }

    if (domain.endsWith(".")) {
      domain = domain.slice(0, -1);
    }

    return DOMAIN_PATTERN.test(domain) ? domain : null;
  }

  public static async onProjectConnected(
    event: VercelProjectConnectionEvent,
  ): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await VercelMarketplaceResources.findPurchase({
        installationId: event.installationId,
        resourceId: event.resourceId,
      });

    if (
      !purchase ||
      purchase.status === MarketplaceSubscriptionStatus.Cancelled
    ) {
      return;
    }

    const domain: string | null = VercelMarketplaceMonitors.normalizeDomain(
      event.productionDomain,
    );

    let connection: VercelMarketplaceConnection | null =
      await VercelMarketplaceMonitors.findConnection(
        purchase.id!,
        event.vercelProjectId,
      );

    if (!connection) {
      const created: VercelMarketplaceConnection =
        new VercelMarketplaceConnection();
      created.marketplaceSubscriptionId = purchase.id!;
      created.projectId = purchase.projectId!;
      created.vercelProjectId = event.vercelProjectId;

      if (event.vercelProjectName) {
        created.vercelProjectName = event.vercelProjectName.substring(0, 500);
      }

      if (domain) {
        created.productionDomain = domain;
      }

      try {
        connection = await VercelMarketplaceConnectionService.create({
          data: created,
          props: { isRoot: true },
        });
      } catch (err) {
        // The same webhook delivered twice at once: the other made it.
        connection = await VercelMarketplaceMonitors.findConnection(
          purchase.id!,
          event.vercelProjectId,
        );

        if (!connection) {
          throw err;
        }
      }
    } else if (
      (domain && connection.productionDomain !== domain) ||
      (event.vercelProjectName &&
        connection.vercelProjectName !== event.vercelProjectName)
    ) {
      await VercelMarketplaceConnectionService.updateOneById({
        id: connection.id!,
        data: {
          ...(domain ? { productionDomain: domain } : {}),
          ...(event.vercelProjectName
            ? { vercelProjectName: event.vercelProjectName.substring(0, 500) }
            : {}),
        },
        props: { isRoot: true },
      });

      if (domain) {
        connection.productionDomain = domain;
      }

      if (event.vercelProjectName) {
        connection.vercelProjectName = event.vercelProjectName;
      }
    }

    await VercelMarketplaceMonitors.ensureMonitor(purchase, connection);
  }

  public static async onProjectDisconnected(
    event: VercelProjectConnectionEvent,
  ): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await VercelMarketplaceResources.findPurchase({
        installationId: event.installationId,
        resourceId: event.resourceId,
      });

    if (!purchase) {
      return;
    }

    const connection: VercelMarketplaceConnection | null =
      await VercelMarketplaceMonitors.findConnection(
        purchase.id!,
        event.vercelProjectId,
      );

    if (!connection) {
      return;
    }

    if (connection.monitorId) {
      try {
        await MonitorService.deleteOneById({
          id: connection.monitorId,
          props: { isRoot: true },
        });
      } catch (err) {
        // Deleted in OneUptime already.
        logger.debug(err);
      }
    }

    await VercelMarketplaceConnectionService.deleteOneById({
      id: connection.id!,
      props: { isRoot: true },
    });
  }

  /*
   * A production deployment of a connected project: its monitor is made now
   * if it could not be when the project was connected, because the project
   * had no production domain yet.
   */
  public static async onProductionDeployment(
    event: VercelProductionDeploymentEvent,
  ): Promise<void> {
    const connections: Array<VercelMarketplaceConnection> =
      await VercelMarketplaceConnectionService.findBy({
        query: {
          vercelProjectId: event.vercelProjectId,
        },
        select: VercelMarketplaceMonitors.getConnectionSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const connection of connections) {
      if (connection.monitorId) {
        continue;
      }

      const purchase: MarketplaceSubscription | null =
        await VercelMarketplaceMonitors.findPurchaseById(
          connection.marketplaceSubscriptionId!,
        );

      if (
        !purchase ||
        purchase.status === MarketplaceSubscriptionStatus.Cancelled ||
        (event.installationIds.length > 0 &&
          !event.installationIds.includes(purchase.externalCustomerId || "")) ||
        (event.resourceIds.length > 0 &&
          !event.resourceIds.includes(purchase.externalSubscriptionId || ""))
      ) {
        continue;
      }

      if (!connection.productionDomain) {
        const domain: string | null =
          await VercelMarketplaceMonitors.lookUpProductionDomain(
            purchase,
            event.vercelProjectId,
          );

        if (!domain) {
          continue;
        }

        await VercelMarketplaceConnectionService.updateOneById({
          id: connection.id!,
          data: { productionDomain: domain },
          props: { isRoot: true },
        });

        connection.productionDomain = domain;
      }

      await VercelMarketplaceMonitors.ensureMonitor(purchase, connection);
    }
  }

  // The resource's setting was turned on: a monitor for each connected project still without one.
  public static async addMissingMonitors(
    purchase: MarketplaceSubscription,
  ): Promise<void> {
    const connections: Array<VercelMarketplaceConnection> =
      await VercelMarketplaceConnectionService.findBy({
        query: { marketplaceSubscriptionId: purchase.id! },
        select: VercelMarketplaceMonitors.getConnectionSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const connection of connections) {
      try {
        await VercelMarketplaceMonitors.ensureMonitor(purchase, connection);
      } catch (err) {
        logger.error(err);
      }
    }
  }

  /*
   * The connected project's monitor, made unless it is there already, its
   * domain is not known yet, or the resource's setting is off.
   */
  private static async ensureMonitor(
    purchase: MarketplaceSubscription,
    connection: VercelMarketplaceConnection,
  ): Promise<void> {
    const details: VercelResourceDetails = VercelResource.readDetails(purchase);

    if (
      connection.monitorId ||
      !connection.productionDomain ||
      !purchase.projectId ||
      !VercelResource.isSettingOn(
        details.metadata,
        VERCEL_METADATA_KEYS.monitorProductionDomains,
      )
    ) {
      return;
    }

    const name: string =
      connection.vercelProjectName || connection.productionDomain;

    let monitorId: ObjectID;

    try {
      monitorId = await VercelMarketplaceMonitors.createWebsiteMonitor({
        projectId: purchase.projectId,
        name: name,
        domain: connection.productionDomain,
      });
    } catch (err) {
      logger.error(
        `Could not make a monitor for ${connection.productionDomain} (Vercel project ${connection.vercelProjectId}) in project ${purchase.projectId.toString()}: ${(err as Error).message}`,
      );
      return;
    }

    await VercelMarketplaceConnectionService.updateOneById({
      id: connection.id!,
      data: { monitorId: monitorId },
      props: { isRoot: true },
    });

    connection.monitorId = monitorId;

    if (details.statusPageId) {
      await VercelMarketplaceMonitors.addToStatusPage({
        projectId: purchase.projectId,
        statusPageId: new ObjectID(details.statusPageId),
        monitorId: monitorId,
        displayName: name,
      });
    }
  }

  private static async createWebsiteMonitor(data: {
    projectId: ObjectID;
    name: string;
    domain: string;
  }): Promise<ObjectID> {
    const defaults: {
      onlineMonitorStatusId: ObjectID;
      offlineMonitorStatusId: ObjectID;
      defaultIncidentSeverityId: ObjectID;
      defaultAlertSeverityId: ObjectID;
      warningAlertSeverityId: ObjectID;
    } = await VercelMarketplaceMonitors.getMonitorDefaults(data.projectId);

    const monitorSteps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      defaultMonitorStatusId: defaults.onlineMonitorStatusId,
      monitorType: MonitorType.Website,
      monitorName: data.name,
      onlineMonitorStatusId: defaults.onlineMonitorStatusId,
      offlineMonitorStatusId: defaults.offlineMonitorStatusId,
      defaultIncidentSeverityId: defaults.defaultIncidentSeverityId,
      defaultAlertSeverityId: defaults.defaultAlertSeverityId,
      warningAlertSeverityId: defaults.warningAlertSeverityId,
    });

    monitorSteps.data!.monitorStepsInstanceArray[0]!.setMonitorDestination(
      URL.fromString(`https://${data.domain}`),
    );

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = data.name;
    monitor.description = `The production domain of the Vercel project ${data.name}, watched from Vercel Marketplace.`;
    monitor.monitorType = MonitorType.Website;
    monitor.monitorSteps = monitorSteps;

    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: { isRoot: true, tenantId: data.projectId },
    });

    return created.id!;
  }

  private static async addToStatusPage(data: {
    projectId: ObjectID;
    statusPageId: ObjectID;
    monitorId: ObjectID;
    displayName: string;
  }): Promise<void> {
    try {
      const resource: StatusPageResource = new StatusPageResource();
      resource.projectId = data.projectId;
      resource.statusPageId = data.statusPageId;
      resource.monitorId = data.monitorId;
      resource.displayName = data.displayName.substring(0, 100);
      resource.showCurrentStatus = true;
      resource.showUptimePercent = true;
      resource.showStatusHistoryChart = true;

      await StatusPageResourceService.create({
        data: resource,
        props: { isRoot: true, tenantId: data.projectId },
      });
    } catch (err) {
      // The status page was deleted in OneUptime, or the plan does not allow another resource on it.
      logger.error(
        `Could not add monitor ${data.monitorId.toString()} to status page ${data.statusPageId.toString()}: ${(err as Error).message}`,
      );
    }
  }

  private static async getMonitorDefaults(projectId: ObjectID): Promise<{
    onlineMonitorStatusId: ObjectID;
    offlineMonitorStatusId: ObjectID;
    defaultIncidentSeverityId: ObjectID;
    defaultAlertSeverityId: ObjectID;
    warningAlertSeverityId: ObjectID;
  }> {
    const statuses: Array<MonitorStatus> = await MonitorStatusService.findBy({
      query: { projectId: projectId },
      select: { _id: true, isOperationalState: true, isOfflineState: true },
      sort: { priority: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    // A new monitor is set up with severities that can be picked.
    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: { projectId: projectId, isArchived: false },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    const alertSeverities: Array<AlertSeverity> =
      await AlertSeverityService.findBy({
        query: { projectId: projectId, isArchived: false },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

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
    const alertSeverityIds: Array<ObjectID> = alertSeverities
      .map((severity: AlertSeverity): ObjectID | null => {
        return severity.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    if (
      !online?.id ||
      !offline?.id ||
      !incidentSeverities[0]?.id ||
      !alertSeverityIds[0]
    ) {
      throw new Error(
        "The project needs an operational and an offline monitor status, an incident severity and an alert severity before monitors can be made.",
      );
    }

    return {
      onlineMonitorStatusId: online.id,
      offlineMonitorStatusId: offline.id,
      defaultIncidentSeverityId: incidentSeverities[0].id,
      defaultAlertSeverityId: alertSeverityIds[0],
      warningAlertSeverityId:
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
          alertSeverityIds,
        ).Warning || alertSeverityIds[0],
    };
  }

  // Needs the integration's "Projects: Read" scope; without it the monitor waits for a project-connected event that names the domain.
  private static async lookUpProductionDomain(
    purchase: MarketplaceSubscription,
    vercelProjectId: string,
  ): Promise<string | null> {
    const installation: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        purchase.externalCustomerId || "",
      );

    if (!installation?.accessToken) {
      return null;
    }

    try {
      return VercelMarketplaceMonitors.normalizeDomain(
        await new VercelMarketplaceAPI().getProductionDomain(
          {
            installationId: installation.installationId!,
            accessToken: installation.accessToken,
          },
          vercelProjectId,
        ),
      );
    } catch (err) {
      logger.error(
        `Could not read the production domain of Vercel project ${vercelProjectId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private static getConnectionSelect(): Record<string, true> {
    return {
      _id: true,
      marketplaceSubscriptionId: true,
      projectId: true,
      vercelProjectId: true,
      vercelProjectName: true,
      productionDomain: true,
      monitorId: true,
    };
  }

  private static async findConnection(
    marketplaceSubscriptionId: ObjectID,
    vercelProjectId: string,
  ): Promise<VercelMarketplaceConnection | null> {
    return await VercelMarketplaceConnectionService.findOneBy({
      query: {
        marketplaceSubscriptionId: marketplaceSubscriptionId,
        vercelProjectId: vercelProjectId,
      },
      select: VercelMarketplaceMonitors.getConnectionSelect(),
      props: { isRoot: true },
    });
  }

  private static async findPurchaseById(
    id: ObjectID,
  ): Promise<MarketplaceSubscription | null> {
    return await MarketplaceSubscriptionService.findPurchaseById(id);
  }
}
