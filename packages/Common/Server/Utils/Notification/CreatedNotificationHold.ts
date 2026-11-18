import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../../Types/Date";
import CreateBy from "../../Types/Database/CreateBy";
import logger from "../Logger";

/*
 * AN INCIDENT'S OR ALERT'S "CREATED" NOTIFICATION WAITS FOR ITS OWNERS
 * (#7210).
 *
 * Its owners hear that an incident (an alert) was created from a job that
 * runs every minute (IncidentOwner:SendCreatedResourceEmail,
 * AlertOwner:SendCreatedResourceEmail): it takes every one not marked as
 * notified, marks it, and tells its owners - or, when it has none, the
 * project's owners. A new incident gets its owners after it is written,
 * from up to three places:
 *
 *   - the create itself, as it returns: its creator, made its owner
 *     (DatabaseService.autoOwnerOnCreate) - Create;
 *   - the create's onCreateSuccess chain, which the create does not wait
 *     for: the owners handed over with it (an incident form's template's),
 *     and the project's owner rules - Chain;
 *   - the code that made it, once the create has returned: the owners a
 *     monitor's criteria names and those of the network device it watches
 *     (MonitorIncident, MonitorAlert), an SLO rule's (EvaluateSlos) -
 *     Caller.
 *
 * A run of the job in between found no owners and told the project's
 * owners, and the incident's owners - the people it is for - never heard
 * that it was created. So every create its hooks run for is written as
 * notified already - held, from onBeforeCreate - and is marked not notified
 * again - let go - once each of those places has added its owners, or
 * could not and will not try again: the job then tells all of them. An
 * incident that ends up with no owner at all still has the project's
 * owners told, as before.
 *
 * Each place says it adds owners before the create starts (Create,
 * Caller: willAddOwners) or as the chain starts (Chain:
 * chainAddsOwners), and says when they are in (ownersAreIn). A create is
 * known by the CreateBy its caller hands the service: the very object every
 * hook of the create is handed (DatabaseService.create). What is known of
 * it - whether it was held, who is still adding owners, how to let it go -
 * is one record, kept here for as long as the create's objects live: the
 * one predicate for the hold and the release, so nothing nobody held is
 * ever let go (the job may have told its owners already, and would tell
 * them again), and nothing is let go twice.
 *
 * THE HOLD IS WRITTEN ON THE RECORD TOO (#7571), so that no stop of the
 * process that holds it can lose the notification or send it twice:
 *
 *   - onBeforeCreate writes when the hold began (createdNotificationHeldAt)
 *     with the flag, in the record's own insert;
 *   - letting it go is one write that matches only while the record still
 *     holds the hold that began then: it marks the record not notified and
 *     clears the time;
 *   - the job takes a record that was let go, and a record whose hold began
 *     HELD_FOR_AT_MOST_MINUTES ago or earlier - one nobody will let go: the
 *     process that held it stopped, or letting it go failed (getDue). It
 *     takes each in one write that matches only while the record is still
 *     as the job read it, which marks it notified and clears the time.
 *
 * So whichever comes first - the release or the job - is the one that acts,
 * and the other finds nothing to do: the notification goes out once,
 * whenever the process stops. A hold begun before the process stopped
 * delays it by a few minutes, never more.
 *
 * And it waits a little more (#7573): the job takes a record let go only
 * once it was created SENT_AFTER_CREATED_IN_MINUTES ago or earlier, so the
 * owners a separate request adds right after the create - an API script's
 * second call, a workflow's next step, the MCP server's - are in by then,
 * and told too. That is up to one more run of the job; nobody is paged any
 * later.
 *
 * WHO IS STILL ADDING OWNERS IS ASKED BY AN ALERT'S ON-CALL RULES TOO
 * (#9407). A rule with an Alert Owner condition ("Alert Owner is any of
 * Payments") is matched on the alert's owners, and its chain cannot tell
 * whether the create and its caller have added theirs yet: they wait for
 * them a moment (isAddingOwners, whenOwnersAreIn,
 * AlertOnCallRulesOnOwnerChange.waitForOwnersOfCreate).
 */

export enum OwnersAddedBy {
  // The create, as it returns: its creator (autoOwnerOnCreate).
  Create = "Create",
  // The create's onCreateSuccess chain: owners handed over, owner rules.
  Chain = "Chain",
  // The code that made it, once the create has returned.
  Caller = "Caller",
}

interface HeldCreate {
  // Written as notified already, by onBeforeCreate.
  isHeld: boolean;
  // Who said they add owners and has not said they are in.
  addingOwners: Set<OwnersAddedBy>;
  // Marks the record not notified, once it exists (chainAddsOwners).
  release: (() => Promise<void>) | null;
  isReleased: boolean;
  // Told each time somebody's owners are in (whenOwnersAreIn).
  waiting: Set<() => void>;
}

// A create: the CreateBy its caller hands the service, and every hook is handed.
type Create = CreateBy<BaseModel>;

// When the Created job, run at a given moment, takes a record.
export interface CreatedNotificationsDue {
  // A record let go - marked not notified - created at or before this.
  createdBefore: Date;
  // A record still held, whose hold began at or before this.
  heldBefore: Date;
}

const CREATES: WeakMap<Create, HeldCreate> = new WeakMap<Create, HeldCreate>();

export default class CreatedNotificationHold {
  /*
   * How long after its create a record let go is first taken by the job:
   * the owners a separate request adds in that time are told too (#7573).
   */
  public static readonly SENT_AFTER_CREATED_IN_MINUTES: number = 1;

  /*
   * How long a hold lasts at most. A create's owners are in seconds after
   * it is written; one still held this long is never let go - the process
   * that held it stopped, or letting it go failed - so the job takes it,
   * and tells whoever owns the record by then (#7571).
   */
  public static readonly HELD_FOR_AT_MOST_MINUTES: number = 5;

  // The records the job, run at `now`, takes (see the top of this file).
  public static getDue(now: Date): CreatedNotificationsDue {
    return {
      createdBefore: OneUptimeDate.addRemoveMinutes(
        now,
        -this.SENT_AFTER_CREATED_IN_MINUTES,
      ),
      heldBefore: OneUptimeDate.addRemoveMinutes(
        now,
        -this.HELD_FOR_AT_MOST_MINUTES,
      ),
    };
  }

  /*
   * The records the job read, each once and in the order first read: it
   * reads those let go and those held too long apart, and a record the
   * hold let go between the two reads may be in both.
   */
  public static oncePerRecord<TModel extends BaseModel>(
    records: Array<TModel>,
  ): Array<TModel> {
    const seen: Set<string> = new Set<string>();

    return records.filter((record: TModel): boolean => {
      const id: string = record.id?.toString() || "";

      if (!id || seen.has(id)) {
        return false;
      }

      seen.add(id);
      return true;
    });
  }

  private static recordOf(create: Create): HeldCreate {
    let record: HeldCreate | undefined = CREATES.get(create);

    if (!record) {
      record = {
        isHeld: false,
        addingOwners: new Set<OwnersAddedBy>(),
        release: null,
        isReleased: false,
        waiting: new Set<() => void>(),
      };
      CREATES.set(create, record);
    }

    return record;
  }

  /*
   * Before the create starts: `by` (Create, Caller) adds owners to what it
   * makes, and will say when they are in (ownersAreIn) - also when the
   * create fails.
   */
  public static willAddOwners(create: Create, by: OwnersAddedBy): void {
    this.recordOf(create).addingOwners.add(by);
  }

  // onBeforeCreate: the create is written as notified already, and held.
  public static hold(create: Create): void {
    this.recordOf(create).isHeld = true;
  }

  /*
   * onCreateSuccess, as its chain starts: the chain adds owners, and will
   * say when they are in (ownersAreIn, Chain); `release` marks the record
   * not notified once everybody's are. Nothing for a create nobody held.
   */
  public static chainAddsOwners(
    create: Create,
    release: () => Promise<void>,
  ): void {
    const record: HeldCreate | undefined = CREATES.get(create);

    if (!record?.isHeld) {
      return;
    }

    record.addingOwners.add(OwnersAddedBy.Chain);
    record.release = release;
  }

  /*
   * `by` has added its owners - or could not, and will not try again. The
   * create is let go when it has a release - which only a held create's
   * chain hands over (chainAddsOwners: the one predicate) - and nobody else
   * is still adding owners; its release is awaited here. Never throws: a
   * release that fails is logged, and the job takes the record once its
   * hold has lasted HELD_FOR_AT_MOST_MINUTES.
   */
  public static async ownersAreIn(
    create: Create,
    by: OwnersAddedBy,
  ): Promise<void> {
    const record: HeldCreate | undefined = CREATES.get(create);

    if (!record) {
      return;
    }

    record.addingOwners.delete(by);

    // Whoever waits for them hears it first: letting the hold go may take a while.
    for (const tell of Array.from(record.waiting)) {
      tell();
    }

    if (record.isReleased || !record.release || record.addingOwners.size > 0) {
      return;
    }

    // Once: the job may take it the moment it is let go.
    record.isReleased = true;

    try {
      await record.release();
    } catch (error) {
      logger.error(
        `Releasing a Created notification held for its owners failed: ${error}. The owners are told once the hold has lasted ${this.HELD_FOR_AT_MOST_MINUTES} minutes.`,
      );
    }
  }

  /*
   * Whether any of `by` said it adds owners to what the create makes
   * (willAddOwners, chainAddsOwners) and has not said they are in.
   */
  public static isAddingOwners(
    create: Create,
    by: ReadonlyArray<OwnersAddedBy>,
  ): boolean {
    const record: HeldCreate | undefined = CREATES.get(create);

    if (!record) {
      return false;
    }

    return by.some((item: OwnersAddedBy): boolean => {
      return record.addingOwners.has(item);
    });
  }

  /*
   * Settles once none of `by` is still adding owners - at once when none
   * is - or once `atMostMs` has passed: whether their owners are in. Never
   * throws, and waits for nobody else: an owner that could not be added is
   * in as far as this goes, as for the hold (ownersAreIn).
   */
  public static whenOwnersAreIn(
    create: Create,
    by: ReadonlyArray<OwnersAddedBy>,
    atMostMs: number,
  ): Promise<boolean> {
    const record: HeldCreate | undefined = CREATES.get(create);

    if (!record || !this.isAddingOwners(create, by)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve: (areIn: boolean) => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        record.waiting.delete(tell);
        resolve(false);
      }, atMostMs);

      const tell: () => void = (): void => {
        if (this.isAddingOwners(create, by)) {
          return;
        }

        record.waiting.delete(tell);
        clearTimeout(timer);
        resolve(true);
      };

      record.waiting.add(tell);
    });
  }
}
