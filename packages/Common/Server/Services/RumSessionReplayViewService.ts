import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumSessionReplayView";
import QueryHelper from "../Types/Database/QueryHelper";
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

/*
 * The heartbeat cadence the player reports on. secondsWatched is floored
 * to it so a chatty client costs at most one write per bucket, and the
 * figure shown to viewers ("watched 1m 30s") never pretends to more
 * precision than the heartbeat had.
 */
export const SESSION_REPLAY_WATCH_BUCKET_SECONDS: number = 15;

/*
 * Ceiling on one view's watched time: the longest session the recorder
 * will ever produce, at the slowest speed anyone would watch it, with
 * headroom for pauses. A client cannot report more than this; the audit
 * figure is a privacy control shown to other viewers, and an unbounded
 * number would let a buggy or hostile client render a nonsense one.
 */
export const SESSION_REPLAY_MAX_SECONDS_WATCHED: number = 24 * 60 * 60;

/*
 * Floor a client-reported figure to the heartbeat bucket and clamp it.
 * Module-level so the route and the service agree on the one rounding
 * rule without the route reaching for the class behind the instance.
 */
export function normalizeSecondsWatched(secondsWatched: number): number {
  if (!Number.isFinite(secondsWatched) || secondsWatched <= 0) {
    return 0;
  }

  const clamped: number = Math.min(
    secondsWatched,
    SESSION_REPLAY_MAX_SECONDS_WATCHED,
  );

  return (
    Math.floor(clamped / SESSION_REPLAY_WATCH_BUCKET_SECONDS) *
    SESSION_REPLAY_WATCH_BUCKET_SECONDS
  );
}

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
     * All four come straight off an untrusted request: a header, or a
     * free-text field in the body. Truncated rather than validated because
     * failing the audit write would fail the playback it is auditing, and
     * DatabaseService.checkMaxLengthOfFields throws on anything longer
     * than the column. An oversized user agent - or a fingerprint longer
     * than its ShortText column - must not be able to stop a read from
     * being recorded.
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
      item.linkedExceptionFingerprint =
        data.linkedExceptionFingerprint.substring(0, ColumnLength.ShortText);
    }

    return await this.create({
      data: item,
      props: { isRoot: true },
    });
  }

  /*
   * The caller's OWN view row, or null. The heartbeat and the manifest
   * refresh both need "does this viewId belong to this user, this
   * project, and (for the refresh) this session" answered in one lookup,
   * and both must refuse somebody else's row indistinguishably from a
   * missing one: secondsWatched is a privacy control, and the refresh
   * would otherwise let a caller reuse a colleague's audit row.
   */
  @CaptureSpan()
  public async findOwnView(data: {
    viewId: ObjectID;
    projectId: ObjectID;
    viewedByUserId: ObjectID;
    sessionId?: string | undefined;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        _id: data.viewId.toString(),
        projectId: data.projectId,
        viewedByUserId: data.viewedByUserId,
        ...(data.sessionId !== undefined && { sessionId: data.sessionId }),
      },
      select: {
        _id: true,
        rumApplicationId: true,
        sessionId: true,
        secondsWatched: true,
      },
      props: { isRoot: true },
    });
  }

  /*
   * Advance how much of the recording was actually watched.
   *
   * SEMANTICS: secondsWatched is the cumulative number of seconds of
   * footage the player has PLAYED for this view - accumulated client-side
   * only while playback is running, scaled by speed - not the furthest
   * offset the playhead reached. Dragging the scrubber to the end of a
   * recording is not watching it, and the audit figure is shown to other
   * viewers as "who watched how much", so it must not over-report.
   *
   * Monotonic on purpose: the heartbeat carries a cumulative total, and a
   * player that reloads would otherwise walk the recorded figure back
   * down and make a full viewing look like a glance. The guard is in the
   * UPDATE's own predicate (secondsWatched < new value) rather than in a
   * read-then-write, so two heartbeats racing for the same row cannot
   * regress it; a heartbeat that does not advance writes nothing.
   *
   * When the caller already holds the row's current figure (the route
   * reads it in the same lookup that proves ownership) it passes it as
   * currentSecondsWatched and a non-advancing heartbeat costs no query at
   * all.
   */
  @CaptureSpan()
  public async recordSecondsWatched(data: {
    viewId: ObjectID;
    projectId: ObjectID;
    secondsWatched: number;
    currentSecondsWatched?: number | undefined;
  }): Promise<void> {
    const seconds: number = normalizeSecondsWatched(data.secondsWatched);

    if (seconds <= 0) {
      return;
    }

    if (
      data.currentSecondsWatched !== undefined &&
      data.currentSecondsWatched >= seconds
    ) {
      return;
    }

    await this.updateOneBy({
      query: {
        _id: data.viewId.toString(),
        projectId: data.projectId,
        secondsWatched: QueryHelper.lessThanOrNull(seconds),
      },
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
