import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * A limit a create is held to, decided together with its INSERT.
 *
 * A service whose records a project may only have so many of hands one
 * back from getCreateLimit (DatabaseService) for each create it limits.
 * DatabaseService then writes the record in a transaction that first takes
 * the limit's lock in the project (ProjectLimitLock), asks `check` - with
 * that transaction's manager - whether the project has room, and only then
 * inserts it. Two creates at the limit cannot both pass: the second one is
 * asked once the first one's INSERT has committed.
 */
export default interface CreateLimit {
  // Names the lock, with the project: every write held to this limit takes it.
  limitName: string;
  projectId: ObjectID;
  /*
   * Throws the limit's refusal when the project has no room for the record.
   * Reads only through `manager`: it runs inside the INSERT's transaction,
   * holding the lock.
   */
  check: (manager: EntityManager) => Promise<void>;
}
