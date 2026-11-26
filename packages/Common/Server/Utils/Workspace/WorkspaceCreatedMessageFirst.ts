import logger from "../Logger";
import { WorkspaceRecord } from "./WorkspaceRecordPeople";

/*
 * A RECORD'S CREATED MESSAGE IS THE FIRST THING ITS CHANNELS HEAR OF IT
 * (#11146).
 *
 * An incident's or alert's "Created" message is posted to Slack, Microsoft
 * Teams and Mattermost once everything a notification rule's conditions
 * read is on the record: the owners handed over with its create, the
 * owners its owner rules add, its creator and the owners the code that
 * made it adds (a monitor's criteria's), and the labels its label rules
 * attach. So a rule that posts what a team owns to an existing channel, or
 * opens a channel for it, matches - and that channel hears of the record
 * from its Created message, then from its updates.
 *
 * Adding those owners writes entries of their own, which are posted too:
 * "Added team Platform to the Alert as the owner". Posted as each is
 * written, they would reach the record's channels before the message that
 * announces the record - and a channel whose rule matches on the owners
 * would hear of an owner before it heard of the record. So from the moment
 * the record's create chain starts (hold) until its Created message has
 * been posted (postHeld), every other message about the record that this
 * process posts is kept (keep), and posted right after the Created
 * message, in the order it was made: each once, wherever the record's
 * rules send it by then. The Created message says it announces the record
 * (announcesRecord) and is never kept.
 *
 * A create chain that stops short of its Created message lets its kept
 * messages go as it stops, and a hold is let go after HELD_FOR_AT_MOST_MS
 * whatever happens, so no message waits for good. The hold is kept in
 * memory, in the process that creates the record: its chain, its creator's
 * owner row and the code that made it run there. A message another server
 * posts about the record meanwhile is posted as before.
 */

// A message kept back, posted when it is let go.
export type KeptPost = () => Promise<void>;

interface Hold {
  // The messages kept, in the order they were made.
  kept: Array<KeptPost>;
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

// The records whose messages are held, by keyOf.
const HOLDS: Map<string, Hold> = new Map<string, Hold>();

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
   * The record's create chain begins: every other message about it waits
   * for its Created message. Nothing for a message about no record, or for
   * a record already held.
   */
  public static hold(record: WorkspaceRecord): void {
    const key: string | null = this.keyOf(record);

    if (!key || HOLDS.has(key)) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      this.postHeld(record).catch((error: unknown) => {
        logger.error(
          `Posting the messages held for a record's Created message failed: ${error}`,
        );
      });
    }, this.HELD_FOR_AT_MOST_MS);

    // Never what keeps a process running.
    timer.unref?.();

    HOLDS.set(key, { kept: [], posting: null, timer: timer });
  }

  // Whether the record's messages are held now, or being posted.
  public static isHeld(record: WorkspaceRecord): boolean {
    const key: string | null = this.keyOf(record);

    return Boolean(key && HOLDS.has(key));
  }

  /*
   * A message about `record`: kept - and true - while the record's messages
   * are held, to be posted with the rest; false otherwise, for the caller
   * to post it now. Kept in the order this is called in, which is the
   * order the messages were made.
   */
  public static keep(data: {
    record: WorkspaceRecord;
    post: KeptPost;
  }): boolean {
    const key: string | null = this.keyOf(data.record);
    const hold: Hold | undefined = key ? HOLDS.get(key) : undefined;

    if (!hold) {
      return false;
    }

    hold.kept.push(data.post);
    return true;
  }

  /*
   * The record's Created message has been posted - or will not be: the
   * messages kept are posted one after the other, in the order they were
   * made, and one made meanwhile joins the end of the line. Settles once
   * the line is empty and the hold is gone; a second call waits for the
   * first. Never throws: a message that fails is logged, and the next one
   * is posted.
   */
  public static async postHeld(record: WorkspaceRecord): Promise<void> {
    const key: string | null = this.keyOf(record);
    const hold: Hold | undefined = key ? HOLDS.get(key) : undefined;

    if (!key || !hold) {
      return;
    }

    if (!hold.posting) {
      clearTimeout(hold.timer);

      hold.posting = (async (): Promise<void> => {
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
