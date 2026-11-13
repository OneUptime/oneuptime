import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
 * notified already (hold, from onBeforeCreate), and is marked not notified
 * again - released - once each of those places has added its owners, or
 * could not and will not try again: the job then tells all of them on its
 * next run. An incident that ends up with no owner at all still has the
 * project's owners told, as before.
 *
 * Each place says it adds owners before the create starts (Create,
 * Caller: willAddOwners) or as the chain starts (Chain:
 * chainAddsOwners), and says when they are in (ownersAreIn). A create is
 * known by the CreateBy its caller hands the service: the very object every
 * hook of the create is handed (DatabaseService.create). What is known of
 * it - whether it was held, who is still adding owners, how to release it -
 * is one record, kept here for as long as the create's objects live: the
 * one predicate for the hold and the release, so nothing nobody held is
 * ever released (the job may have told its owners already, and would tell
 * them again), and nothing is released twice.
 *
 * The record is this process's, as the chain is: should the process stop
 * mid-create - or onCreateSuccess stop before its chain starts - the
 * incident is left held, as the chain's own steps are left undone.
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
}

// A create: the CreateBy its caller hands the service, and every hook is handed.
type Create = CreateBy<BaseModel>;

const CREATES: WeakMap<Create, HeldCreate> = new WeakMap<Create, HeldCreate>();

export default class CreatedNotificationHold {
  private static recordOf(create: Create): HeldCreate {
    let record: HeldCreate | undefined = CREATES.get(create);

    if (!record) {
      record = {
        isHeld: false,
        addingOwners: new Set<OwnersAddedBy>(),
        release: null,
        isReleased: false,
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

  // onBeforeCreate: the create is written as notified already.
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
   * create is released when it has a release - which only a held create's
   * chain hands over (chainAddsOwners: the one predicate) - and nobody else
   * is still adding owners; its release is awaited here. Never throws: a
   * release that fails is logged, and leaves the notification unsent.
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

    if (record.isReleased || !record.release || record.addingOwners.size > 0) {
      return;
    }

    // Once: the job may take it the moment it is released.
    record.isReleased = true;

    try {
      await record.release();
    } catch (error) {
      logger.error(
        `Releasing a Created notification held for its owners failed: ${error}`,
      );
    }
  }
}
