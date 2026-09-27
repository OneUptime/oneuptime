import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import DatabaseService from "../../Services/DatabaseService";

/*
 * The two writes that move a subscriber notification in and out of
 * InProgress without racing anyone: a job claiming a Pending notification to
 * send it, and the sweeper failing one whose send was interrupted.
 *
 * Why a claim. The subscriber jobs run every minute, and a run can now take
 * as long as its sends (SubscriberNotificationTiming), so the next run starts
 * while the last is still going - on another worker slot, or another worker.
 * Each run reads the Pending notifications when it starts. Without a claim,
 * a run still working through its list would send a notification a later run
 * had already sent, or pick up one that was re-queued since it read it and
 * send it with what it read before (for the incident created notification,
 * an old record of the pages already told, so those pages would be told
 * again).
 *
 * A claim is one conditional UPDATE: Pending to InProgress, only if the row
 * is still Pending and its version is still the one the job read. Every
 * write through the services bumps the version, so a notification that was
 * sent, re-queued or edited since is left for a run that reads it afresh.
 * Exactly one run wins a notification. The claim is a hook-free write: it
 * fires none of the row's 'on update' workflows, realtime events or audit
 * log entries (the status the send settles on does). It stamps updatedAt,
 * and, for a notification with one, its claimed-at column: the sweeper times
 * an InProgress row from the claimed-at column where there is one, since
 * other code writes those rows (an open incident or episode) all the time,
 * and from updatedAt otherwise.
 */
export default class SubscriberNotificationClaim {
  /*
   * Claim a Pending notification for this run. True when this run is now the
   * one sending it; false when it is no longer Pending, or changed since the
   * job read it (another run has it, or will read it afresh).
   *
   * `version` is the row's version as the job read it. A row read without
   * one is claimed on its status alone.
   *
   * `claimedAtColumn` is stamped with the time of the claim, for the
   * sweeper (see Incident.subscriberNotificationClaimedAtOnIncidentCreated).
   *
   * `alsoSet` settles other columns of the row in the same write, only if
   * they still hold `expected`: the public note jobs use it to skip a note's
   * update notification that the 'posted' notification they are claiming
   * already covers (see the note jobs).
   */
  public static async claim<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    id: ObjectID;
    statusColumn: keyof TBaseModel & string;
    version: number | undefined | null;
    claimedAtColumn?: (keyof TBaseModel & string) | undefined;
    alsoSet?:
      | {
          data: PartialEntity<TBaseModel>;
          expected: PartialEntity<TBaseModel>;
        }
      | undefined;
  }): Promise<boolean> {
    return await data.service.compareAndSetColumnsByIdWithoutHooks({
      id: data.id,
      data: {
        ...(data.alsoSet?.data || {}),
        [data.statusColumn]: StatusPageSubscriberNotificationStatus.InProgress,
        ...(data.claimedAtColumn
          ? { [data.claimedAtColumn]: OneUptimeDate.getCurrentDate() }
          : {}),
      } as unknown as PartialEntity<TBaseModel>,
      expectedData: {
        ...(data.alsoSet?.expected || {}),
        [data.statusColumn]: StatusPageSubscriberNotificationStatus.Pending,
        ...(typeof data.version === "number" ? { version: data.version } : {}),
      } as unknown as PartialEntity<TBaseModel>,
    });
  }

  /*
   * Fail a notification whose send was interrupted, with the reason, if it
   * is still InProgress at the version the sweeper read. False when its send
   * settled, or it was sent again, in the meantime.
   */
  public static async failInterrupted<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    id: ObjectID;
    statusColumn: keyof TBaseModel & string;
    messageColumn: keyof TBaseModel & string;
    message: string;
    version: number | undefined | null;
  }): Promise<boolean> {
    return await data.service.compareAndSetColumnsByIdWithoutHooks({
      id: data.id,
      data: {
        [data.statusColumn]: StatusPageSubscriberNotificationStatus.Failed,
        [data.messageColumn]: data.message,
      } as unknown as PartialEntity<TBaseModel>,
      expectedData: {
        [data.statusColumn]: StatusPageSubscriberNotificationStatus.InProgress,
        ...(typeof data.version === "number" ? { version: data.version } : {}),
      } as unknown as PartialEntity<TBaseModel>,
    });
  }
}
