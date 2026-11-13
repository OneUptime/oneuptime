import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * A rule an update is held to, decided together with each row's UPDATE.
 *
 * Some rules are about a record and the project's other records at once: a
 * person's user overrides on one policy may not overlap. Two writes that
 * each check before the other has written both pass, and the project ends
 * up with what the rule forbids. A service hands one of these back from
 * getUpdateLimit (DatabaseService) for an update it holds to such a rule.
 * DatabaseService then writes each row in a transaction that first takes
 * the rule's lock in the row's project (ProjectLimitLock), asks `check` -
 * with that transaction's manager - whether the row may be written, and
 * only then updates it. The service holds its creates to the same lock
 * (getCreateLimit, CreateLimit), so an update and a create cannot both pass
 * either: the second is asked once the first has committed.
 */
export default interface UpdateLimit {
  /*
   * Names the lock, with the row's project: every write held to this rule
   * takes it - the service's creates through a CreateLimit of this name.
   */
  limitName: string;
  /*
   * Throws the rule's refusal when the row may not be written as the update
   * writes it. `rowId` is the row about to be written; read it, and the
   * rows it is held against, only through `manager`: this runs inside the
   * UPDATE's transaction, holding the lock.
   */
  check: (manager: EntityManager, rowId: ObjectID) => Promise<void>;
}
