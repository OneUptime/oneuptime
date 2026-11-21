import DatabaseService from "./DatabaseService";
import CloudResourceService from "./CloudResourceService";
import Model from "../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import { CloudAppIdentity } from "../Utils/Telemetry/CloudAppIdentity";
import {
  CloudAppSignalColumn,
  CloudAppTelemetrySignal,
  getCloudAppSignalColumn,
} from "../../Types/Cloud/CloudAppTelemetrySignal";
import {
  APP_SERVICE_SITE_TYPE,
  CloudAppPlatformEnvironment,
  CloudAppSiteResolution,
  isAppServiceApp,
  resolveCloudAppSite,
} from "../../Types/Cloud/CloudAppPlatformResourceMatch";
import {
  CloudProvider,
  ManagedCloudPlatform,
} from "../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../Types/Cloud/CloudResourceKind";

/*
 * The apps of App Platforms environments (CloudApp): written by the
 * telemetry ingest (OtelIngestBaseService), read by the dashboard, pruned by
 * the Cloud:CleanupStaleResources worker once an app has sent nothing for
 * CLOUD_APP_RETENTION_DAYS.
 *
 * Each App Service app is also tied to the site Azure Monitor reports it as
 * (linkPlatformResources, #10407), and keeps it
 * (CloudApp.platformCloudResourceId): its page, its lists, monitors and the
 * AI then read the site without looking it up again.
 */

// How long an app that sends nothing stays listed, by default.
export const DEFAULT_CLOUD_APP_RETENTION_DAYS: number = 30;

// What a link is decided by, of each app.
export interface CloudAppLinkSource {
  id: string;
  name: string;
  groupName: string;
  cloudPlatform: string;
  providerResourceId: string;
  environmentId: string;
  // The site it keeps now; empty for none.
  keptSiteId: string;
}

// A site an app could be tied to, as the matching reads it.
export interface CloudAppSiteCandidate {
  id: string;
  providerResourceId: string;
  lastSeenAt: Date | null;
  cloudRegion: string;
}

// One app whose kept site changes, and to what (empty: none).
export interface CloudAppPlatformLinkChange {
  appId: string;
  siteId: string;
}

/*
 * The links the site rows call for, by the rules the app's page reads by
 * (resolveCloudAppSite): for each app, the site it should keep when that is
 * not the one it keeps - another, or none. Pure, so the decisions are
 * tested alone.
 */
export function getCloudAppPlatformLinkChanges(data: {
  apps: ReadonlyArray<CloudAppLinkSource>;
  sites: ReadonlyArray<CloudAppSiteCandidate>;
  environments: ReadonlyMap<string, CloudAppPlatformEnvironment>;
}): Array<CloudAppPlatformLinkChange> {
  const changes: Array<CloudAppPlatformLinkChange> = [];

  for (const app of data.apps) {
    const resolution: CloudAppSiteResolution<CloudAppSiteCandidate> =
      resolveCloudAppSite({
        app: {
          name: app.name,
          groupName: app.groupName,
          cloudPlatform: app.cloudPlatform,
          providerResourceId: app.providerResourceId,
        },
        candidates: data.sites,
        environment: data.environments.get(app.environmentId) || null,
      });
    const siteId: string = resolution.site ? resolution.site.id : "";

    if (siteId !== app.keptSiteId) {
      changes.push({ appId: app.id, siteId });
    }
  }

  return changes;
}

function idText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Find the app an identity names in an environment, or create it, and
   * mark it seen - and seen sending `signal`, the kind of telemetry the
   * ingest that called is reading (CloudAppTelemetrySignal): its page tells
   * what it never received from what it measured as zero by them. Called at
   * most once per app and kind per ingest fence window, so the update is
   * cheap at fleet scale. Returns the app's id.
   */
  @CaptureSpan()
  public async recordApp(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    cloudPlatform: string;
    identity: CloudAppIdentity;
    signal?: CloudAppTelemetrySignal | undefined;
    now?: Date | undefined;
  }): Promise<ObjectID> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const signalColumn: CloudAppSignalColumn | null = getCloudAppSignalColumn(
      data.signal,
    );
    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        cloudResourceId: data.cloudResourceId,
        appKey: data.identity.appKey,
      },
      select: { _id: true, providerResourceId: true },
      props: { isRoot: true },
    });
    const existingId: ObjectID | null = existing?._id
      ? new ObjectID(existing._id.toString())
      : null;

    const seen: JSONObject = {
      lastSeenAt: now,
      cloudPlatform: data.cloudPlatform,
      telemetryAttributes: data.identity.telemetryAttributes,
    };

    if (data.identity.serviceName) {
      seen["serviceName"] = data.identity.serviceName;
    }

    if (data.identity.image) {
      seen["image"] = data.identity.image;
    }

    if (data.identity.revisionAttribute) {
      seen["revisionAttribute"] = data.identity.revisionAttribute;
    }

    /*
     * Kept once sent: what a sidecar's metrics leave out is not taken off the
     * app the app's own spans named.
     */
    if (data.identity.providerResourceId) {
      seen["providerResourceId"] = data.identity.providerResourceId;
    }

    if (signalColumn) {
      seen[signalColumn] = now;
    }

    if (existingId) {
      await this.updateOneById({
        id: existingId,
        data: seen as never,
        props: { isRoot: true },
      });

      /*
       * Its telemetry names another site (#10407): the app is tied to that
       * one. Unchanged, nothing is looked up - this runs once per app and
       * kind per ingest window.
       */
      if (
        data.identity.providerResourceId &&
        data.identity.providerResourceId.trim().toLowerCase() !==
          (existing?.providerResourceId || "").trim().toLowerCase()
      ) {
        await this.linkPlatformResourcesSafely({
          projectId: data.projectId,
          appIds: [existingId],
          cloudPlatform: data.cloudPlatform,
        });
      }

      return existingId;
    }

    const app: Model = new Model();
    app.projectId = data.projectId;
    app.cloudResourceId = data.cloudResourceId;
    app.appKey = data.identity.appKey;
    app.name = data.identity.name;
    app.lastSeenAt = now;
    app.cloudPlatform = data.cloudPlatform;
    app.telemetryAttributes = data.identity.telemetryAttributes;

    if (data.identity.groupName) {
      app.groupName = data.identity.groupName;
    }

    if (data.identity.serviceName) {
      app.serviceName = data.identity.serviceName;
    }

    if (data.identity.image) {
      app.image = data.identity.image;
    }

    if (data.identity.revisionAttribute) {
      app.revisionAttribute = data.identity.revisionAttribute;
    }

    if (data.identity.providerResourceId) {
      app.providerResourceId = data.identity.providerResourceId;
    }

    if (signalColumn) {
      app[signalColumn] = now;
    }

    let createdId: ObjectID;

    try {
      const created: Model = await this.create({
        data: app,
        props: { isRoot: true },
      });

      createdId = new ObjectID(created._id!.toString());
    } catch (error) {
      /*
       * Two workers met the same new app at once: the unique index let one
       * create it, and the other takes its row.
       */
      if (!PostgresErrorTranslator.isUniqueViolation(error)) {
        throw error;
      }

      const raced: ObjectID | null = await this.findAppId({
        projectId: data.projectId,
        cloudResourceId: data.cloudResourceId,
        appKey: data.identity.appKey,
      });

      if (!raced) {
        throw error;
      }

      return raced;
    }

    // A new App Service app is tied to its site at once (#10407).
    await this.linkPlatformResourcesSafely({
      projectId: data.projectId,
      appIds: [createdId],
      cloudPlatform: data.cloudPlatform,
    });

    return createdId;
  }

  // The id of the app with this key in an environment, or null.
  @CaptureSpan()
  public async findAppId(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    appKey: string;
  }): Promise<ObjectID | null> {
    const existing: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        cloudResourceId: data.cloudResourceId,
        appKey: data.appKey,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    return existing?._id ? new ObjectID(existing._id.toString()) : null;
  }

  /*
   * Remove an environment's apps that have sent nothing since `olderThan`,
   * with their revisions (the foreign key cascades) - a service that was
   * deleted on its platform simply stops sending, and nothing else ever
   * says it is gone. Their instances keep their rows and lose the link.
   * Returns how many were removed.
   */
  @CaptureSpan()
  public async deleteUnseenForResource(data: {
    cloudResourceId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    return await this.deleteBy({
      query: {
        cloudResourceId: data.cloudResourceId,
        lastSeenAt: QueryHelper.lessThan(data.olderThan),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * Ties each App Service app of the project - or only `appIds` - to the
   * site Azure Monitor reports it as, and keeps it on the app
   * (CloudApp.platformCloudResourceId, #10407), by the rules the app's page
   * reads it by (resolveCloudAppSite): its cloud.resource_id's site, else
   * one of its name in the subscription its telemetry names, its region
   * first. Only a live site is one: a site gone from its subscription (or
   * silent for a week) is archived, and an app tied to it is untied - or
   * tied to the site that took its place, as a site moved to another
   * resource group or subscription gets a new id, and a new row.
   *
   * Read and written as root: the link is a fact about the two rows, and
   * every reader of it reads the site itself with their own permissions
   * (the page and lists never show a site the reader may not read). Only
   * the links that change are written. Returns how many did.
   */
  @CaptureSpan()
  public async linkPlatformResources(data: {
    projectId: ObjectID;
    appIds?: Array<ObjectID> | undefined;
  }): Promise<number> {
    if (data.appIds && data.appIds.length === 0) {
      return 0;
    }

    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        cloudPlatform: ManagedCloudPlatform.AzureAppService,
        ...(data.appIds ? { _id: QueryHelper.any(data.appIds) } : {}),
      },
      select: {
        _id: true,
        name: true,
        groupName: true,
        cloudPlatform: true,
        providerResourceId: true,
        cloudResourceId: true,
        platformCloudResourceId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    const apps: Array<CloudAppLinkSource> = rows
      .map((row: Model): CloudAppLinkSource => {
        return {
          id: idText(row._id),
          name: row.name || "",
          groupName: row.groupName || "",
          cloudPlatform: row.cloudPlatform || "",
          providerResourceId: row.providerResourceId || "",
          environmentId: idText(row.cloudResourceId),
          keptSiteId: idText(row.platformCloudResourceId),
        };
      })
      .filter((app: CloudAppLinkSource): boolean => {
        return Boolean(app.id) && isAppServiceApp(app);
      });

    if (apps.length === 0) {
      return 0;
    }

    const environmentIds: Array<string> = Array.from(
      new Set<string>(
        apps
          .map((app: CloudAppLinkSource): string => {
            return app.environmentId;
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      ),
    );

    const [environmentRows, siteRows]: [
      Array<CloudResource>,
      Array<CloudResource>,
    ] = await Promise.all([
      environmentIds.length > 0
        ? CloudResourceService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(environmentIds),
            },
            select: { _id: true, cloudAccountId: true, cloudRegion: true },
            skip: 0,
            limit: LIMIT_MAX,
            props: { isRoot: true },
          })
        : Promise.resolve([] as Array<CloudResource>),
      CloudResourceService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceKind: CloudResourceKind.Resource,
          cloudProvider: CloudProvider.Azure,
          cloudResourceType: APP_SERVICE_SITE_TYPE,
          isArchived: false,
        },
        select: {
          _id: true,
          providerResourceId: true,
          lastSeenAt: true,
          cloudRegion: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      }),
    ]);

    const environments: Map<string, CloudAppPlatformEnvironment> = new Map<
      string,
      CloudAppPlatformEnvironment
    >();

    for (const environment of environmentRows) {
      environments.set(idText(environment._id), {
        cloudAccountId: environment.cloudAccountId || null,
        cloudRegion: environment.cloudRegion || null,
      });
    }

    const sites: Array<CloudAppSiteCandidate> = siteRows
      .map((site: CloudResource): CloudAppSiteCandidate => {
        return {
          id: idText(site._id),
          providerResourceId: site.providerResourceId || "",
          lastSeenAt: site.lastSeenAt ? new Date(site.lastSeenAt) : null,
          cloudRegion: site.cloudRegion || "",
        };
      })
      .filter((site: CloudAppSiteCandidate): boolean => {
        return Boolean(site.id && site.providerResourceId);
      });

    const changes: Array<CloudAppPlatformLinkChange> =
      getCloudAppPlatformLinkChanges({ apps, sites, environments });

    for (const change of changes) {
      // Raw on purpose: a link is OneUptime's bookkeeping, not an edit.
      await this.getRepository().manager.query(
        `UPDATE "CloudApp"
          SET "platformCloudResourceId" = $1
          WHERE "projectId" = $2
            AND "_id" = $3
            AND "deletedAt" IS NULL`,
        [change.siteId || null, data.projectId.toString(), change.appId],
      );
    }

    return changes.length;
  }

  /*
   * linkPlatformResources where a failure must not fail what called it - an
   * ingest batch, a cloud connection's read, a sweep: logged, and the next
   * sweep links again. Nothing is read for an app of another platform.
   */
  public async linkPlatformResourcesSafely(data: {
    projectId: ObjectID;
    appIds?: Array<ObjectID> | undefined;
    // The calling app's platform, when known: only App Service apps link.
    cloudPlatform?: string | undefined;
  }): Promise<number> {
    if (
      data.cloudPlatform !== undefined &&
      data.cloudPlatform !== ManagedCloudPlatform.AzureAppService
    ) {
      return 0;
    }

    try {
      return await this.linkPlatformResources({
        projectId: data.projectId,
        appIds: data.appIds,
      });
    } catch (error) {
      logger.error(
        `CloudApp: could not tie the App Service apps of project ${data.projectId.toString()} to their sites: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return 0;
    }
  }

  // The projects that hold an App Service app, for the hourly link sweep.
  @CaptureSpan()
  public async findProjectIdsWithAppServiceApps(): Promise<Array<ObjectID>> {
    const rows: unknown = await this.getRepository().manager.query(
      `SELECT DISTINCT "projectId"
        FROM "CloudApp"
        WHERE "cloudPlatform" = $1
          AND "deletedAt" IS NULL`,
      [ManagedCloudPlatform.AzureAppService],
    );

    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown): string => {
        return idText(
          row && typeof row === "object"
            ? (row as Record<string, unknown>)["projectId"]
            : "",
        );
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /*
   * How many days an app that sends nothing stays listed:
   * CLOUD_APP_RETENTION_DAYS, at least 1, else 30. A job that runs once a
   * week or a month keeps its row between runs.
   */
  public getRetentionDays(): number {
    const raw: string | undefined = process.env["CLOUD_APP_RETENTION_DAYS"];

    if (raw) {
      const parsed: number = parseInt(raw, 10);

      if (!isNaN(parsed) && parsed >= 1) {
        return parsed;
      }
    }

    return DEFAULT_CLOUD_APP_RETENTION_DAYS;
  }

  public getUnseenThresholdDate(nowOverride?: Date): Date {
    return OneUptimeDate.addRemoveDurationInDays(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -this.getRetentionDays(),
    );
  }
}

export default new Service();
