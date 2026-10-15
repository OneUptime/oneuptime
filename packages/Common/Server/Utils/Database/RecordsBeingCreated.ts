import ObjectID from "../../../Types/ObjectID";

/*
 * THE RECORDS WHOSE CREATE IS STILL GOING ON IN THIS PROCESS: from the moment
 * the row is written until OneUptime has announced it, by sending the
 * record's On Create workflow event (DatabaseService._create).
 *
 * A create can change its own record before it is announced. Its hooks fill
 * in what only exists once the row does: an on-call policy run sets its
 * status twice before its create returns (OnCallDutyPolicyExecutionLog).
 * Each of those writes is an update, and sends an On Update event, before
 * the On Create event that follows.
 *
 * The On Update trigger hears them, as it always has. The On Create or Update
 * trigger must not: for it they are part of the create, which starts it once,
 * as "created", and its run reads the record as the create left it
 * (Types/Workflow/CreateOrUpdateTrigger). So the update events sent while a
 * record is here say so (isPartOfCreate), and that trigger passes them by.
 *
 * Per process, keyed by the table and the record's ID. A create and the
 * updates its own hooks make run in one process, one after the other; an
 * update from anywhere else cannot name a record whose create has not
 * returned yet, since nothing outside it knows its ID.
 */

// How many creates of each record are going on: one, almost always.
const creating: Map<string, number> = new Map<string, number>();

type KeyOfFunction = (data: {
  tableName: string;
  id: ObjectID | string;
}) => string;

const keyOf: KeyOfFunction = (data: {
  tableName: string;
  id: ObjectID | string;
}): string => {
  return `${data.tableName}:${data.id.toString().toLowerCase()}`;
};

export default class RecordsBeingCreated {
  /**
   * Marks a record as being created, and hands back what marks it done -
   * which a create calls however it ends (finally), once its On Create
   * event is sent. Calling it more than once does nothing more.
   */
  public static start(data: {
    tableName: string;
    id: ObjectID | string;
  }): () => void {
    const key: string = keyOf(data);
    let isDone: boolean = false;

    creating.set(key, (creating.get(key) || 0) + 1);

    return (): void => {
      if (isDone) {
        return;
      }

      isDone = true;

      const count: number = (creating.get(key) || 0) - 1;

      if (count > 0) {
        creating.set(key, count);
      } else {
        creating.delete(key);
      }
    };
  }

  // Whether the record's create is still going on in this process.
  public static isBeingCreated(data: {
    tableName: string | null | undefined;
    id: ObjectID | string | null | undefined;
  }): boolean {
    if (!data.tableName || !data.id) {
      return false;
    }

    return creating.has(keyOf({ tableName: data.tableName, id: data.id }));
  }

  // How many records are being created right now, for tests.
  public static count(): number {
    return creating.size;
  }
}
