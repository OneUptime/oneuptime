import GracefulShutdown, { ShutdownPriority } from "../GracefulShutdown";
import logger from "../Logger";
import WorkspaceCreatedMessageLine from "./WorkspaceCreatedMessageLine";
import { WorkspaceRecord } from "./WorkspaceRecordPeople";

/*
 * A RECORD'S CREATED MESSAGE IS THE FIRST THING ITS CHANNELS HEAR OF IT
 * (#11146, #11188), ON EVERY APP SERVER (#11198).
 *
 * A new incident's, alert's, episode's, maintenance event's, monitor's or
 * on-call policy's "Created" message is posted to Slack, Microsoft Teams
 * and Mattermost once everything a notification rule's conditions read is
 * on the record: the owners handed over with its create, the owners its
 * owner rules add, its creator and the owners the code that made it adds,
 * and the labels its label rules attach. So a rule that posts what a team
 * owns to an existing channel, or opens a channel for it, matches - and
 * that channel hears of the record from its Created message, then from its
 * updates.
 *
 * Adding those owners writes entries of their own, which are posted too:
 * "Added team Platform to the Alert as the owner". Posted as each is
 * written, they would reach the record's channels before the message that
 * announces it. So from the moment the record's create chain starts (hold)
 * until its Created message has been posted (postHeld), every other
 * message about the record is kept (keep), and posted right after the
 * Created message, in the order it was made: each once, wherever the
 * record's rules send it by then. The Created message says it announces the
 * record (announcesRecord) and is never kept.
 *
 * A message about the record can be made on any App server while its chain
 * runs on one: the Incident Commander role the Dashboard gives the declarer
 * as the incident's page opens, a note, a monitor's first probe result. So
 * the hold is kept where every server sees it - the record's line in
 * Valkey (WorkspaceCreatedMessageLine) - and each server posts its own
 * messages in their turn there. It is set before the record's create
 * returns, so before any page, API call or probe can know of the record.
 * Without Valkey the hold is this server's alone, as it was (#11176): its
 * messages wait in memory, and another server's go out at once.
 *
 * A create chain that stops short of its Created message lets its kept
 * messages go as it stops, and a hold is let go after HELD_FOR_AT_MOST_MS
 * whatever happens, on every server, so no message waits for good. A server
 * shutting down posts what still waits on it rather than losing it.
 */

// A message kept back, posted when it is let go.
export type KeptPost = () => Promise<void>;

interface Hold {
  // The record's line is in Valkey, for every server; else this server's alone.
  isShared: boolean;
  // Settles once Valkey has said whether it keeps the line (hold).
  isReady: Promise<void>;
  /*
   * The messages this server keeps itself, in the order they were made:
   * every message, when the line is not in Valkey; one Valkey could not
   * take, when it is.
   */
  kept: Array<KeptPost>;
  // The Created message is out (or will not be): the line moves.
  isReleased: boolean;
  // Set once they are being posted: a message made meanwhile joins the line.
  posting: Promise<void> | null;
  // Lets the hold go after HELD_FOR_AT_MOST_MS, should nothing else.
  timer: ReturnType<typeof setTimeout>;
}

/*
 * The fields that name a record, in the order WorkspaceRecordChannels
 * reads them: a message is about the first one it names.
 */
const RECORD_KEYS: ReadonlyArray<keyof WorkspaceRecord> = [
  "incidentId",
  "alertId",
  "incidentEpisodeId",
  "alertEpisodeId",
  "scheduledMaintenanceId",
  "monitorId",
  "onCallDutyPolicyId",
];

// The records this server holds, by keyOf.
const HOLDS: Map<string, Hold> = new Map<string, Hold>();

let isShutdownHandlerRegistered: boolean = false;

export default class WorkspaceCreatedMessageFirst {
  /*
   * How long a record's messages are held at most. Its Created message goes
   * out seconds after the record is written - once its owners are in and
   * its channels are open - so a hold this old belongs to a create chain
   * that stopped without saying so: its messages go out then, rather than
   * never.
   */
  public static readonly HELD_FOR_AT_MOST_MS: number = 5 * 60 * 1000;

  /*
   * How long a server shutting down lets its holds and lines go on by
   * themselves before it posts what still waits on it.
   */
  public static readonly SHUTDOWN_WAITS_AT_MOST_MS: number = 5 * 1000;

  /*
   * The record's create chain begins: every other message about it, on
   * every server, waits for its Created message. Settles once that is so,
   * which the chain's create waits for, so nothing can know of the record
   * before. Nothing for a message about no record, or for a record already
   * held. Never throws.
   */
  public static async hold(record: WorkspaceRecord): Promise<void> {
    const key: string | null = this.keyOf(record);

    if (!key) {
      return;
    }

    const heldAlready: Hold | undefined = HOLDS.get(key);

    if (heldAlready) {
      await heldAlready.isReady;
      return;
    }

    let markReady: () => void = (): void => {
      // replaced below
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      this.postHeld(record).catch((error: unknown) => {
        logger.error(
          `Posting the messages held for a record's Created message failed: ${error}`,
        );
      });
    }, this.HELD_FOR_AT_MOST_MS);

    // Never what keeps a process running.
    timer.unref?.();

    const hold: Hold = {
      isShared: false,
      isReady: new Promise<void>((resolve: () => void) => {
        markReady = resolve;
      }),
      kept: [],
      isReleased: false,
      posting: null,
      timer: timer,
    };

    HOLDS.set(key, hold);

    try {
      if (WorkspaceCreatedMessageLine.isAvailable()) {
        hold.isShared = await WorkspaceCreatedMessageLine.start({
          recordKey: key,
          heldForAtMostMs: this.HELD_FOR_AT_MOST_MS,
        });
      }

      if (hold.isShared) {
        this.registerShutdownHandler();
      }
    } finally {
      markReady();
    }
  }

  // Whether this server holds the record's messages now, or is posting them.
  public static isHeld(record: WorkspaceRecord): boolean {
    const key: string | null = this.keyOf(record);

    return Boolean(key && HOLDS.has(key));
  }

  /*
   * A message about `record`: kept - and true - while the record's messages
   * are held, on this server or another, to be posted with the rest; false
   * otherwise, for the caller to post it now. Kept in the order this is
   * called in, which is the order the messages were made: the first thing
   * it does is take its place in the record's line. Never throws.
   */
  public static async keep(data: {
    record: WorkspaceRecord;
    post: KeptPost;
  }): Promise<boolean> {
    const key: string | null = this.keyOf(data.record);

    if (!key) {
      return false;
    }

    const hold: Hold | undefined = HOLDS.get(key);

    if (hold) {
      await hold.isReady;

      if (!hold.isShared) {
        hold.kept.push(data.post);
        return true;
      }
    }

    // The record's line in Valkey, whichever server holds it.
    const ticket: number | null = WorkspaceCreatedMessageLine.isAvailable()
      ? await WorkspaceCreatedMessageLine.take(key)
      : null;

    if (ticket === null || (ticket === 0 && hold && !hold.isReleased)) {
      /*
       * Valkey cannot be asked, or lost the line before the Created message
       * went out: a record this server holds keeps it here, posted after the
       * line. Anything else goes out at once.
       */
      if (hold) {
        hold.kept.push(data.post);
        return true;
      }

      return false;
    }

    if (ticket === 0) {
      // Not held anywhere, or no longer.
      return false;
    }

    WorkspaceCreatedMessageLine.wait({
      recordKey: key,
      ticket: ticket,
      post: data.post,
      isHeldHere: (): boolean => {
        return this.isHoldingLineHere(key);
      },
      heldForAtMostMs: this.HELD_FOR_AT_MOST_MS,
    });

    this.registerShutdownHandler();

    return true;
  }

  /*
   * The record's Created message has been posted - or will not be: the
   * messages kept are posted one after the other, in the order they were
   * made, and one made meanwhile joins the end of the line. On every
   * server, each posts its own in its turn. Settles once this server's are
   * posted and its hold is gone; a second call waits for the first. Never
   * throws: a message that fails is logged, and the next one is posted.
   */
  public static async postHeld(record: WorkspaceRecord): Promise<void> {
    const key: string | null = this.keyOf(record);

    if (key) {
      await this.letGo(key);
    }
  }

  /*
   * This server shuts down. Its holds and lines go on by themselves for up
   * to SHUTDOWN_WAITS_AT_MOST_MS; then its holds are let go - their chains
   * stop with the server - and what still waits on it is posted now, out of
   * turn if need be, rather than lost with it.
   */
  public static async postEverythingHeldHere(): Promise<void> {
    const deadline: number = Date.now() + this.SHUTDOWN_WAITS_AT_MOST_MS;

    while (
      Date.now() < deadline &&
      (HOLDS.size > 0 || WorkspaceCreatedMessageLine.isAnyWaitingHere())
    ) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, WorkspaceCreatedMessageLine.ASKED_EVERY_MS);
      });
    }

    const holdsLetGo: Array<Promise<void>> = Array.from(HOLDS.keys()).map(
      (key: string): Promise<void> => {
        return this.letGo(key);
      },
    );

    await WorkspaceCreatedMessageLine.postEverythingNow();
    await Promise.all(holdsLetGo);
  }

  // postHeld, for the record `key` names.
  private static async letGo(key: string): Promise<void> {
    const hold: Hold | undefined = HOLDS.get(key);

    if (!hold) {
      return;
    }

    if (!hold.posting) {
      clearTimeout(hold.timer);

      hold.posting = (async (): Promise<void> => {
        await hold.isReady;

        if (hold.isShared) {
          // Every server's messages may go now, each in its turn.
          await WorkspaceCreatedMessageLine.release(key);
          hold.isReleased = true;
          WorkspaceCreatedMessageLine.wake(key);
          await WorkspaceCreatedMessageLine.drained(key);
        }

        hold.isReleased = true;

        while (hold.kept.length > 0) {
          const post: KeptPost = hold.kept.shift()!;

          try {
            await post();
          } catch (error) {
            logger.error(
              `Posting a message held for a record's Created message failed: ${error}`,
            );
          }
        }

        // Nothing left: from here on, a message about the record goes out at once.
        HOLDS.delete(key);
      })();
    }

    await hold.posting;
  }

  // Whether this server holds the record's line in Valkey, not let go yet.
  private static isHoldingLineHere(key: string): boolean {
    const hold: Hold | undefined = HOLDS.get(key);

    return Boolean(hold && hold.isShared && !hold.isReleased);
  }

  /*
   * Once this server keeps a line in Valkey: what waits on it is posted as
   * it shuts down, rather than lost with it.
   */
  private static registerShutdownHandler(): void {
    if (isShutdownHandlerRegistered) {
      return;
    }

    isShutdownHandlerRegistered = true;

    GracefulShutdown.registerHandler(
      "WorkspaceCreatedMessageFirst",
      ShutdownPriority.Buffers,
      (): Promise<void> => {
        return this.postEverythingHeldHere();
      },
    );
  }

  // The record a message is about, as one key: its kind and its id.
  private static keyOf(
    record: WorkspaceRecord | null | undefined,
  ): string | null {
    if (!record) {
      return null;
    }

    for (const field of RECORD_KEYS) {
      const id: unknown = record[field];

      if (id) {
        const text: string = String(id).trim().toLowerCase();

        if (text) {
          return `${field}:${text}`;
        }
      }
    }

    return null;
  }
}
