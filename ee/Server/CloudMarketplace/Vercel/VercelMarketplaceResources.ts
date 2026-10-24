import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import SubscriptionPlan from "Common/Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY } from "Common/Utils/StatusPage/HistoryChartBarColors";
import MarketplaceSubscriptionService from "Common/Server/Services/MarketplaceSubscriptionService";
import ProjectService from "Common/Server/Services/ProjectService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import VercelMarketplaceConnectionService from "Common/Server/Services/VercelMarketplaceConnectionService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import MarketplacePurchaseClaim from "../MarketplacePurchaseClaim";
import MarketplaceUsageReporter from "../MarketplaceUsageReporter";
import VercelMarketplaceAPI, { VercelSecret } from "./VercelMarketplaceAPI";
import VercelMarketplacePlans from "./VercelMarketplacePlans";
import VercelResource, {
  VERCEL_METADATA_KEYS,
  VercelResourceDetails,
} from "./VercelResource";
import MarketplacePurchases from "../MarketplacePurchases";

/*
 * What OneUptime does to a Vercel resource, whoever asks: the provider API
 * (Vercel provisioning, changing or deleting it), the webhooks (an unpaid
 * invoice), the billing job (an uninstalled team) and the dashboard (its
 * project deleted, or its plan changed, in OneUptime).
 */

export const DELETED_FROM_VERCEL_REASON: string =
  "Deleted from Vercel Marketplace: the team deleted the OneUptime resource or uninstalled OneUptime.";

export interface ProvisionVercelResource {
  installation: VercelMarketplaceInstallation;
  // The purchase this provisioning started with, when it is being finished (a retry).
  purchase?: MarketplaceSubscription | undefined;
  resourceId: string;
  productId: string;
  name: string;
  metadata: Record<string, unknown>;
  plan: SubscriptionPlan;
  ownerUserId: ObjectID;
  ownerEmail?: string | undefined;
  vercelUserId?: string | undefined;
}

export interface ProvisionedVercelResource {
  purchase: MarketplaceSubscription;
  secrets: Array<VercelSecret>;
}

export default class VercelMarketplaceResources {
  public static async findPurchase(data: {
    installationId: string;
    resourceId: string;
  }): Promise<MarketplaceSubscription | null> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchase({
        marketplace: CloudMarketplace.Vercel,
        externalSubscriptionId: data.resourceId,
      });

    // A resource is only ever reached through its own installation.
    if (!purchase || purchase.externalCustomerId !== data.installationId) {
      return null;
    }

    return purchase;
  }

  public static async listPurchases(
    installationId: string,
  ): Promise<Array<MarketplaceSubscription>> {
    return await MarketplaceSubscriptionService.findBy({
      query: {
        marketplace: CloudMarketplace.Vercel,
        externalCustomerId: installationId,
      },
      select: MarketplaceSubscriptionService.getPurchaseSelect(),
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });
  }

  /*
   * Make, or finish making, the resource: its purchase, its project (owned
   * by the person who added it, on the plan they chose, billed through
   * Vercel), its ingestion key and - unless they turned it off - its status
   * page. Each step is done only if it is not done yet, so a provisioning
   * Vercel sends again after a timeout, or one that failed part way, ends
   * with one of each.
   */
  public static async provision(
    data: ProvisionVercelResource,
  ): Promise<ProvisionedVercelResource> {
    const metadata: Record<string, unknown> = VercelResource.readMetadata(
      data.metadata,
    );

    let purchase: MarketplaceSubscription =
      data.purchase ||
      (await MarketplacePurchases.recordPurchase({
        marketplace: CloudMarketplace.Vercel,
        externalSubscriptionId: data.resourceId,
        externalCustomerId: data.installation.installationId!,
        externalOfferId: data.productId,
        externalPlanId: VercelMarketplacePlans.getVercelPlanId(data.plan),
        purchaserEmail: data.ownerEmail,
        details: VercelResource.toDetailsJson({
          name: data.name,
          productId: data.productId,
          metadata: metadata as VercelResourceDetails["metadata"],
          provisionedByVercelUserId: data.vercelUserId,
        }),
      }));

    if (!purchase.projectId) {
      const projectId: ObjectID = await MarketplacePurchaseClaim.createProject({
        userId: data.ownerUserId,
        name: data.name,
        plan: data.plan,
        purchase: purchase,
      });

      await MarketplacePurchases.linkToProject({
        purchase: purchase,
        projectId: projectId,
        userId: data.ownerUserId,
        status: MarketplaceSubscriptionStatus.Active,
      });

      purchase = (await MarketplaceSubscriptionService.findPurchaseById(
        purchase.id!,
      ))!;
    }

    const projectId: ObjectID = purchase.projectId!;
    let details: VercelResourceDetails = VercelResource.readDetails(purchase);

    let key: TelemetryIngestionKey | null = details.telemetryIngestionKeyId
      ? await VercelMarketplaceResources.findKey(
          new ObjectID(details.telemetryIngestionKeyId),
        )
      : null;

    if (!key) {
      key = await VercelMarketplaceResources.createKey({
        projectId: projectId,
        resourceName: details.name,
        createdByUserId: data.ownerUserId,
      });

      details = { ...details, telemetryIngestionKeyId: key.id!.toString() };
      purchase = await VercelMarketplaceResources.saveDetails(
        purchase,
        details,
      );
    }

    if (
      !details.statusPageId &&
      VercelResource.isSettingOn(
        details.metadata,
        VERCEL_METADATA_KEYS.createStatusPage,
      )
    ) {
      const statusPageId: ObjectID | null =
        await VercelMarketplaceResources.createStatusPage({
          projectId: projectId,
          name: details.name,
          createdByUserId: data.ownerUserId,
        });

      if (statusPageId) {
        details = { ...details, statusPageId: statusPageId.toString() };
        purchase = await VercelMarketplaceResources.saveDetails(
          purchase,
          details,
        );
      }
    }

    return {
      purchase: purchase,
      secrets: VercelResource.getSecrets(key.secretKey!.toString()),
    };
  }

  // The resource's secrets as they are now: its current ingestion key's.
  public static async getSecrets(
    purchase: MarketplaceSubscription,
  ): Promise<Array<VercelSecret> | null> {
    const details: VercelResourceDetails = VercelResource.readDetails(purchase);

    if (!details.telemetryIngestionKeyId) {
      return null;
    }

    const key: TelemetryIngestionKey | null =
      await VercelMarketplaceResources.findKey(
        new ObjectID(details.telemetryIngestionKeyId),
      );

    return key?.secretKey
      ? VercelResource.getSecrets(key.secretKey.toString())
      : null;
  }

  /*
   * New secrets for the resource: a new ingestion key, and the old one kept
   * working for as many hours as Vercel asks (0 to 720), so deployments
   * built with it keep sending until they are deployed again.
   */
  public static async rotateSecrets(data: {
    purchase: MarketplaceSubscription;
    keepOldKeyForHours: number;
  }): Promise<Array<VercelSecret>> {
    const details: VercelResourceDetails = VercelResource.readDetails(
      data.purchase,
    );

    const key: TelemetryIngestionKey =
      await VercelMarketplaceResources.createKey({
        projectId: data.purchase.projectId!,
        resourceName: details.name,
        createdByUserId: data.purchase.linkedByUserId,
      });

    if (details.telemetryIngestionKeyId) {
      const keepForSeconds: number = Math.round(
        Math.min(Math.max(data.keepOldKeyForHours, 0), 720) * 60 * 60,
      );

      // A key cannot be given an expiry that is not in the future: one kept for no time is turned off.
      await TelemetryIngestionKeyService.updateOneById({
        id: new ObjectID(details.telemetryIngestionKeyId),
        data:
          keepForSeconds > 0
            ? {
                expiresAt: OneUptimeDate.addRemoveSeconds(
                  OneUptimeDate.getCurrentDate(),
                  keepForSeconds,
                ),
              }
            : { isEnabled: false },
        props: { isRoot: true },
      });
    }

    await VercelMarketplaceResources.saveDetails(data.purchase, {
      ...details,
      telemetryIngestionKeyId: key.id!.toString(),
    });

    return VercelResource.getSecrets(key.secretKey!.toString());
  }

  /*
   * The resource is gone from Vercel - deleted there, or OneUptime
   * uninstalled: stop taking its telemetry, bill what it used since the
   * last hourly report (before its project goes, while it can still be
   * priced), end the purchase, and delete the project and the records of
   * its connected Vercel projects. Done again, it does only what is left: a
   * project whose delete failed is deleted by the next run of the billing
   * job (deleteProjectsOfEndedResources).
   */
  public static async deprovision(
    purchase: MarketplaceSubscription,
  ): Promise<void> {
    const details: VercelResourceDetails = VercelResource.readDetails(purchase);

    if (details.telemetryIngestionKeyId) {
      try {
        await TelemetryIngestionKeyService.updateOneById({
          id: new ObjectID(details.telemetryIngestionKeyId),
          data: { isEnabled: false },
          props: { isRoot: true },
        });
      } catch (err) {
        // Its project may already be gone, and the key with it.
        logger.debug(err);
      }
    }

    if (purchase.status !== MarketplaceSubscriptionStatus.Cancelled) {
      if (
        purchase.status === MarketplaceSubscriptionStatus.Active &&
        purchase.projectId
      ) {
        await MarketplaceUsageReporter.reportFinalUsage(purchase);
      }

      await MarketplacePurchases.updatePurchase(purchase, {
        status: MarketplaceSubscriptionStatus.Cancelled,
        externalState: "deleted",
      });
    }

    await VercelMarketplaceConnectionService.deleteBy({
      query: { marketplaceSubscriptionId: purchase.id! },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    if (purchase.projectId) {
      await VercelMarketplaceResources.deleteProject(purchase.projectId);
    }
  }

  /*
   * The billing job's sweep: every ended Vercel resource whose project is
   * still there - its delete failed, or the process stopped - gets it
   * deleted now.
   */
  public static async deleteProjectsOfEndedResources(): Promise<void> {
    const ended: Array<MarketplaceSubscription> =
      await MarketplaceSubscriptionService.findBy({
        query: {
          marketplace: CloudMarketplace.Vercel,
          status: MarketplaceSubscriptionStatus.Cancelled,
          projectId: QueryHelper.notNull(),
        },
        select: MarketplaceSubscriptionService.getPurchaseSelect(),
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

    for (const purchase of ended) {
      try {
        await VercelMarketplaceResources.deleteProject(purchase.projectId!);
      } catch (err) {
        logger.error(
          `Could not delete project ${purchase.projectId?.toString()} of ended Vercel resource ${purchase.externalSubscriptionId}.`,
        );
        logger.error(err);
      }
    }
  }

  /*
   * Its project was deleted in OneUptime: the resource is deleted on Vercel
   * too, which takes its environment variables out of the projects
   * connected to it (at their next deployment). Best effort - the project is
   * gone whatever Vercel says. A resource Vercel deleted itself is Cancelled
   * already, and nothing is sent.
   */
  public static async onProjectDeleted(projectId: ObjectID): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseForProject(projectId);

    if (
      !purchase ||
      purchase.marketplace !== CloudMarketplace.Vercel ||
      purchase.status === MarketplaceSubscriptionStatus.Cancelled
    ) {
      return;
    }

    await MarketplacePurchases.updatePurchase(purchase, {
      status: MarketplaceSubscriptionStatus.Cancelled,
      externalState: "project-deleted",
    });

    await VercelMarketplaceConnectionService.deleteBy({
      query: { marketplaceSubscriptionId: purchase.id! },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const installation: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        purchase.externalCustomerId || "",
      );

    if (!installation?.accessToken) {
      return;
    }

    try {
      await new VercelMarketplaceAPI().deleteResource(
        {
          installationId: installation.installationId!,
          accessToken: installation.accessToken,
        },
        purchase.externalSubscriptionId!,
      );
    } catch (err) {
      logger.error(
        `Could not delete Vercel resource ${purchase.externalSubscriptionId} (installation ${installation.installationId}) after its OneUptime project was deleted. Delete it in the team's Vercel dashboard.`,
      );
      logger.error(err);
    }
  }

  /*
   * The project's plan was changed in OneUptime: the resource's plan on
   * Vercel follows. A change Vercel asked for itself is on the purchase
   * already, and nothing is sent back.
   */
  public static async onPlanChanged(data: {
    projectId: ObjectID;
    paymentProviderPlanId: string;
  }): Promise<void> {
    const purchase: MarketplaceSubscription | null =
      await MarketplaceSubscriptionService.findPurchaseForProject(
        data.projectId,
      );

    const vercelPlanId: string | null =
      VercelMarketplacePlans.getVercelPlanIdOfPlanId(
        data.paymentProviderPlanId,
      );

    if (
      !purchase ||
      purchase.marketplace !== CloudMarketplace.Vercel ||
      purchase.status === MarketplaceSubscriptionStatus.Cancelled ||
      !vercelPlanId ||
      purchase.externalPlanId === vercelPlanId
    ) {
      return;
    }

    await MarketplacePurchases.updatePurchase(purchase, {
      externalPlanId: vercelPlanId,
    });

    await VercelMarketplaceResources.tellVercelResourceChanged(purchase);
  }

  // Vercel reads the resource again (its plan, its status). Best effort.
  public static async tellVercelResourceChanged(
    purchase: MarketplaceSubscription,
  ): Promise<void> {
    try {
      const installation: VercelMarketplaceInstallation | null =
        await VercelMarketplaceInstallationService.findByInstallationId(
          purchase.externalCustomerId || "",
        );

      if (!installation?.accessToken) {
        return;
      }

      await new VercelMarketplaceAPI().sendResourceUpdated(
        {
          installationId: installation.installationId!,
          accessToken: installation.accessToken,
        },
        purchase.externalSubscriptionId!,
      );
    } catch (err) {
      logger.error(
        `Could not tell Vercel that resource ${purchase.externalSubscriptionId} changed.`,
      );
      logger.error(err);
    }
  }

  public static async saveDetails(
    purchase: MarketplaceSubscription,
    details: VercelResourceDetails,
  ): Promise<MarketplaceSubscription> {
    return await MarketplacePurchases.updatePurchase(purchase, {
      details: VercelResource.toDetailsJson(details),
    });
  }

  private static async deleteProject(projectId: ObjectID): Promise<void> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!project) {
      // Gone already: only the purchase still named it.
      await MarketplacePurchases.unlinkProject(projectId);
      return;
    }

    await ProjectService.deleteOneById({
      id: projectId,
      deletionReason: DELETED_FROM_VERCEL_REASON,
      props: { isRoot: true },
    });
  }

  private static async findKey(
    id: ObjectID,
  ): Promise<TelemetryIngestionKey | null> {
    return await TelemetryIngestionKeyService.findOneById({
      id: id,
      select: { _id: true, secretKey: true },
      props: { isRoot: true },
    });
  }

  private static async createKey(data: {
    projectId: ObjectID;
    resourceName: string;
    createdByUserId?: ObjectID | undefined;
  }): Promise<TelemetryIngestionKey> {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.projectId = data.projectId;
    key.name = "Vercel";
    key.description = `Made for the Vercel resource ${data.resourceName}. The Vercel projects connected to it send their traces with it (OTEL_EXPORTER_OTLP_HEADERS), and their log and trace drains too.`;
    key.keyType = TelemetryIngestionKeyType.Server;

    if (data.createdByUserId) {
      key.createdByUserId = data.createdByUserId;
    }

    const created: TelemetryIngestionKey =
      await TelemetryIngestionKeyService.create({
        data: key,
        props: { isRoot: true, tenantId: data.projectId },
      });

    const read: TelemetryIngestionKey | null =
      await VercelMarketplaceResources.findKey(created.id!);

    if (!read?.secretKey) {
      throw new Error("The resource's ingestion key could not be read back.");
    }

    return read;
  }

  /*
   * A public status page for the resource, named after it, which the
   * monitors of its connected projects' production domains are added to.
   * Best effort: a resource is never refused because its status page could
   * not be made (a plan limit, say) - the team can make one in OneUptime.
   */
  private static async createStatusPage(data: {
    projectId: ObjectID;
    name: string;
    createdByUserId: ObjectID;
  }): Promise<ObjectID | null> {
    try {
      const page: StatusPage = new StatusPage();
      page.projectId = data.projectId;
      page.name = data.name;
      page.pageTitle = data.name;
      page.isPublicStatusPage = true;
      page.createdByUserId = data.createdByUserId;

      const created: StatusPage = await StatusPageService.create({
        data: page,
        props: { isRoot: true, tenantId: data.projectId },
        miscDataProps: {
          [ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY]: true,
        },
      });

      return created.id || null;
    } catch (err) {
      logger.error(
        `Could not make a status page for the Vercel resource in project ${data.projectId.toString()}.`,
      );
      logger.error(err);
      return null;
    }
  }
}
