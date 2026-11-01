import DatabaseService from "./DatabaseService";
import CloudAppService from "./CloudAppService";
import Model from "../../Models/DatabaseModels/CloudAppRevision";
import CloudApp from "../../Models/DatabaseModels/CloudApp";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import {
  CloudAppRevisionChange,
  CloudAppRevisionChangeKind,
} from "../Utils/Telemetry/ChangeDetection/CloudAppChangeEntries";

/*
 * An App Platforms app's revisions (CloudAppRevision): its deploy history.
 *
 * The ingest records the revision every instance reports, at most once per
 * app and revision per fence window (OtelIngestBaseService). recordRevision
 * says what that sighting means for the app:
 *
 *   - A revision the app never ran is a DEPLOY. Its row names the revision
 *     the app ran before (its previousRevision), and the app's current
 *     revision moves to it. The app's first revision is its baseline, not a
 *     deploy: telemetry that starts arriving for an app that has run for
 *     months is not a release.
 *   - A revision it ran before, while the current one still reports, is an
 *     old instance draining during a rollout (or the old side of a traffic
 *     split): nothing changes.
 *   - A revision it ran before, while the current one has reported nothing
 *     for CLOUD_APP_REVISION_LIVE_MINUTES, means the app went back to it:
 *     a ROLLBACK when it is older than the one that stopped, a deploy (a
 *     roll forward to it again) when it is newer.
 *
 * Exactly one sighting creates a revision's row (the unique index on app and
 * revision), so a deploy is recorded once however many workers see it.
 */

/*
 * How long the current revision may report nothing before an older one
 * that still reports is taken to have replaced it. Matches the live window
 * of the instances (CloudResourceInstanceService, the Dashboard's
 * CLOUD_INSTANCE_LIVE_WINDOW_MINUTES): a revision is refreshed at most once
 * per five-minute ingest fence, so fifteen minutes is three missed windows.
 */
export const CLOUD_APP_REVISION_LIVE_MINUTES: number = 15;

/*
 * The most new revisions one app records in an hour. An app whose
 * "revision" changes with every instance (a build timestamp in
 * service.version, a per-pod image tag) is not deploying every minute;
 * past this, new ones are not recorded until the hour is over.
 */
export const MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR: number = 12;

export interface RecordCloudAppRevisionResult {
  // The deploy or rollback this sighting was, or null when it was neither.
  change: CloudAppRevisionChange | null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async recordRevision(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    cloudAppId: ObjectID;
    revision: string;
    serviceVersion?: string | null | undefined;
    image?: string | null | undefined;
    now?: Date | undefined;
  }): Promise<RecordCloudAppRevisionResult> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const app: CloudApp | null = await CloudAppService.findOneById({
      id: data.cloudAppId,
      select: {
        _id: true,
        currentRevision: true,
      },
      props: { isRoot: true },
    });

    if (!app) {
      return { change: null };
    }

    const currentRevision: string = (app.currentRevision || "").trim();

    const existing: Model | null = await this.findRevision({
      projectId: data.projectId,
      cloudAppId: data.cloudAppId,
      revision: data.revision,
    });

    if (!existing) {
      return await this.recordNewRevision({
        ...data,
        now,
        currentRevision,
      });
    }

    await this.updateOneById({
      id: new ObjectID(existing._id!.toString()),
      data: this.getSeenData({
        now,
        serviceVersion: data.serviceVersion,
        image: data.image,
      }) as never,
      props: { isRoot: true },
    });

    if (currentRevision === data.revision) {
      return { change: null };
    }

    if (!currentRevision) {
      // A row whose app lost its current revision: take this one, quietly.
      await this.setCurrentRevision({
        cloudAppId: data.cloudAppId,
        revision: data.revision,
        since: existing.firstSeenAt || now,
      });

      return { change: null };
    }

    return await this.checkWentBack({
      projectId: data.projectId,
      cloudAppId: data.cloudAppId,
      revision: data.revision,
      revisionFirstSeenAt: existing.firstSeenAt || now,
      currentRevision,
      now,
    });
  }

  /*
   * Remove an environment's revisions that have not been reported since
   * `olderThan`, except the revision each app runs now. Returns how many
   * were removed.
   */
  @CaptureSpan()
  public async deleteUnseenForResource(data: {
    cloudResourceId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const apps: Array<CloudApp> = await CloudAppService.findBy({
      query: { cloudResourceId: data.cloudResourceId },
      select: { _id: true, currentRevision: true },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    });

    let removed: number = 0;

    for (const app of apps) {
      if (!app._id) {
        continue;
      }

      removed += await this.deleteBy({
        query: {
          cloudAppId: new ObjectID(app._id.toString()),
          lastSeenAt: QueryHelper.lessThan(data.olderThan),
          ...(app.currentRevision
            ? { revision: QueryHelper.notEquals(app.currentRevision) }
            : {}),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    }

    return removed;
  }

  private async findRevision(data: {
    projectId: ObjectID;
    cloudAppId: ObjectID;
    revision: string;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        cloudAppId: data.cloudAppId,
        revision: data.revision,
      },
      select: {
        _id: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
      props: { isRoot: true },
    });
  }

  private getSeenData(data: {
    now: Date;
    serviceVersion?: string | null | undefined;
    image?: string | null | undefined;
  }): JSONObject {
    const seen: JSONObject = { lastSeenAt: data.now };

    if (data.serviceVersion) {
      seen["serviceVersion"] = data.serviceVersion;
    }

    if (data.image) {
      seen["image"] = data.image;
    }

    return seen;
  }

  private async recordNewRevision(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    cloudAppId: ObjectID;
    revision: string;
    serviceVersion?: string | null | undefined;
    image?: string | null | undefined;
    now: Date;
    currentRevision: string;
  }): Promise<RecordCloudAppRevisionResult> {
    if (!(await this.isWithinHourlyBudget(data))) {
      return { change: null };
    }

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.cloudResourceId = data.cloudResourceId;
    row.cloudAppId = data.cloudAppId;
    row.revision = data.revision;
    row.firstSeenAt = data.now;
    row.lastSeenAt = data.now;

    if (data.currentRevision) {
      row.previousRevision = data.currentRevision;
    }

    if (data.serviceVersion) {
      row.serviceVersion = data.serviceVersion;
    }

    if (data.image) {
      row.image = data.image;
    }

    try {
      await this.create({ data: row, props: { isRoot: true } });
    } catch (error) {
      // Another worker recorded this revision first: it owns the deploy.
      if (PostgresErrorTranslator.isUniqueViolation(error)) {
        return { change: null };
      }

      throw error;
    }

    await this.setCurrentRevision({
      cloudAppId: data.cloudAppId,
      revision: data.revision,
      since: data.now,
      previousRevision: data.currentRevision || undefined,
    });

    if (!data.currentRevision) {
      // The first revision OneUptime saw: the app's baseline.
      return { change: null };
    }

    return {
      change: {
        kind: CloudAppRevisionChangeKind.Deployed,
        revision: data.revision,
        previousRevision: data.currentRevision,
        time: data.now,
      },
    };
  }

  /*
   * Whether the app went back to a revision it ran before: the current one
   * has reported nothing for CLOUD_APP_REVISION_LIVE_MINUTES while this one
   * still reports.
   */
  private async checkWentBack(data: {
    projectId: ObjectID;
    cloudAppId: ObjectID;
    revision: string;
    revisionFirstSeenAt: Date;
    currentRevision: string;
    now: Date;
  }): Promise<RecordCloudAppRevisionResult> {
    const current: Model | null = await this.findRevision({
      projectId: data.projectId,
      cloudAppId: data.cloudAppId,
      revision: data.currentRevision,
    });

    const currentLastSeenAt: Date | null = current?.lastSeenAt
      ? new Date(current.lastSeenAt)
      : null;

    const liveSince: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -CLOUD_APP_REVISION_LIVE_MINUTES,
    );

    if (currentLastSeenAt && currentLastSeenAt.getTime() > liveSince.getTime()) {
      // The current revision still runs: this is an instance draining.
      return { change: null };
    }

    /*
     * The current revision stopped when it was last seen: that is when the
     * app went back, as near as telemetry says.
     */
    const time: Date = currentLastSeenAt || data.now;

    await this.setCurrentRevision({
      cloudAppId: data.cloudAppId,
      revision: data.revision,
      since: time,
      previousRevision: data.currentRevision,
    });

    const currentFirstSeenAt: Date | null = current?.firstSeenAt
      ? new Date(current.firstSeenAt)
      : null;

    const isOlder: boolean =
      !currentFirstSeenAt ||
      new Date(data.revisionFirstSeenAt).getTime() <
        currentFirstSeenAt.getTime();

    return {
      change: {
        kind: isOlder
          ? CloudAppRevisionChangeKind.RolledBack
          : CloudAppRevisionChangeKind.Deployed,
        revision: data.revision,
        previousRevision: data.currentRevision,
        time,
      },
    };
  }

  private async setCurrentRevision(data: {
    cloudAppId: ObjectID;
    revision: string;
    since: Date;
    previousRevision?: string | undefined;
  }): Promise<void> {
    const update: JSONObject = {
      currentRevision: data.revision,
      currentRevisionSince: data.since,
    };

    if (data.previousRevision && data.previousRevision !== data.revision) {
      update["previousRevision"] = data.previousRevision;
    }

    await CloudAppService.updateOneById({
      id: data.cloudAppId,
      data: update as never,
      props: { isRoot: true },
    });
  }

  private async isWithinHourlyBudget(data: {
    cloudAppId: ObjectID;
    now: Date;
  }): Promise<boolean> {
    const recorded: number = (
      await this.countBy({
        query: {
          cloudAppId: data.cloudAppId,
          firstSeenAt: QueryHelper.greaterThan(
            OneUptimeDate.addRemoveHours(data.now, -1),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return recorded < MAX_NEW_CLOUD_APP_REVISIONS_PER_HOUR;
  }
}

export default new Service();
