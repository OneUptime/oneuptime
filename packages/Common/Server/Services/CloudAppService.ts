import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudApp";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import { CloudAppIdentity } from "../Utils/Telemetry/CloudAppIdentity";

/*
 * The apps of App Platforms environments (CloudApp): written by the
 * telemetry ingest (OtelIngestBaseService), read by the dashboard, pruned by
 * the Cloud:CleanupStaleResources worker once an app has sent nothing for
 * CLOUD_APP_RETENTION_DAYS.
 */

// How long an app that sends nothing stays listed, by default.
export const DEFAULT_CLOUD_APP_RETENTION_DAYS: number = 30;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Find the app an identity names in an environment, or create it, and
   * mark it seen. Called at most once per app per ingest fence window, so
   * the update is cheap at fleet scale. Returns the app's id.
   */
  @CaptureSpan()
  public async recordApp(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    cloudPlatform: string;
    identity: CloudAppIdentity;
    now?: Date | undefined;
  }): Promise<ObjectID> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const existingId: ObjectID | null = await this.findAppId({
      projectId: data.projectId,
      cloudResourceId: data.cloudResourceId,
      appKey: data.identity.appKey,
    });

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

    if (existingId) {
      await this.updateOneById({
        id: existingId,
        data: seen as never,
        props: { isRoot: true },
      });

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

    try {
      const created: Model = await this.create({
        data: app,
        props: { isRoot: true },
      });

      return new ObjectID(created._id!.toString());
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
    return OneUptimeDate.addRemoveDays(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -this.getRetentionDays(),
    );
  }
}

export default new Service();
