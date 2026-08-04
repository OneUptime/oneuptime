import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumSessionReplayView";
import ColumnLength from "../../Types/Database/ColumnLength";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Session replay read audit.
 *
 * Every write here happens as root from the playback API, not from a
 * client, because the audit row has to be written whether or not the
 * caller would have had permission to create it - and because the caller
 * must not be able to choose what it says.
 *
 * No hardDeleteItemsOlderThanInDays: unlike the SCIM logs this table is
 * modelled on, the whole point of the audit is that it outlives the
 * recording it describes.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Record that somebody opened a recording for playback. Called from the
   * manifest endpoint BEFORE any payload byte is served, so a read that
   * fails halfway through is still audited.
   */
  @CaptureSpan()
  public async recordView(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    sessionId: string;
    viewedByUserId?: ObjectID | undefined;
    viewedByApiKeyId?: ObjectID | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    accessReason?: string | undefined;
    linkedIncidentId?: ObjectID | undefined;
    linkedExceptionFingerprint?: string | undefined;
  }): Promise<Model> {
    const item: Model = new Model();

    item.projectId = data.projectId;
    item.rumApplicationId = data.rumApplicationId;
    item.sessionId = data.sessionId;
    item.viewedAt = OneUptimeDate.getCurrentDate();
    item.secondsWatched = 0;

    if (data.viewedByUserId) {
      item.viewedByUserId = data.viewedByUserId;
      /*
       * The row is created as root, so createdByUserId would otherwise be
       * null and the audit would not name the human behind the read.
       */
      item.createdByUserId = data.viewedByUserId;
    }

    if (data.viewedByApiKeyId) {
      item.viewedByApiKeyId = data.viewedByApiKeyId;
    }

    /*
     * All three come straight off an untrusted request: a header, or a
     * free-text field in the body. Truncated rather than validated because
     * failing the audit write would fail the playback it is auditing, and
     * DatabaseService.checkMaxLengthOfFields throws on anything longer
     * than the column. An oversized user agent must not be able to stop a
     * read from being recorded.
     */
    if (data.ipAddress) {
      item.ipAddress = data.ipAddress.substring(0, ColumnLength.ShortText);
    }

    if (data.userAgent) {
      item.userAgent = data.userAgent.substring(0, ColumnLength.LongText);
    }

    if (data.accessReason) {
      item.accessReason = data.accessReason.substring(0, ColumnLength.LongText);
    }

    if (data.linkedIncidentId) {
      item.linkedIncidentId = data.linkedIncidentId;
    }

    if (data.linkedExceptionFingerprint) {
      item.linkedExceptionFingerprint = data.linkedExceptionFingerprint;
    }

    return await this.create({
      data: item,
      props: { isRoot: true },
    });
  }

  /*
   * Advance how much of the recording was actually watched, from the
   * player's throttled heartbeat.
   *
   * Monotonic on purpose: the heartbeat carries a cumulative total, and a
   * player that seeks backwards or reloads would otherwise walk the
   * recorded figure back down and make a full viewing look like a glance.
   */
  @CaptureSpan()
  public async recordSecondsWatched(data: {
    viewId: ObjectID;
    projectId: ObjectID;
    secondsWatched: number;
  }): Promise<void> {
    if (!Number.isFinite(data.secondsWatched) || data.secondsWatched <= 0) {
      return;
    }

    const existing: Model | null = await this.findOneBy({
      query: {
        _id: data.viewId.toString(),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        secondsWatched: true,
      },
      props: { isRoot: true },
    });

    if (!existing) {
      return;
    }

    const seconds: number = Math.floor(data.secondsWatched);

    if ((existing.secondsWatched || 0) >= seconds) {
      return;
    }

    await this.updateOneById({
      id: data.viewId,
      data: {
        secondsWatched: seconds,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Who has watched this recording. Shown on the player itself, not only
   * in a log - inward visibility changes behaviour more than an audit
   * trail nobody reads.
   */
  @CaptureSpan()
  public async getViewsForSession(data: {
    projectId: ObjectID;
    /*
     * Required, not optional. A sessionId is only unique within an
     * application, and the caller has been authorised against one
     * application - listing every project-wide view of a colliding id
     * would leak audit rows from an application they cannot see.
     */
    rumApplicationId: ObjectID;
    sessionId: string;
    limit: number;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: data.projectId,
        rumApplicationId: data.rumApplicationId,
        sessionId: data.sessionId,
      },
      select: {
        _id: true,
        viewedAt: true,
        secondsWatched: true,
        accessReason: true,
        viewedByUserId: true,
        viewedByUser: {
          _id: true,
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      sort: {
        viewedAt: SortOrder.Descending,
      },
      skip: 0,
      /*
       * Clamped rather than passed through: findBy rejects anything above
       * LIMIT_PER_PROJECT with an exception, and a too-large page is not
       * worth failing an audit listing over.
       */
      limit: Math.min(Math.max(data.limit, 1), LIMIT_PER_PROJECT),
      props: { isRoot: true },
    });
  }
}

export default new Service();
