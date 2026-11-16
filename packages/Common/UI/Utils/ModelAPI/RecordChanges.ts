/*
 * THE RECORDS THIS PAGE CREATED AND DELETED, AS IT DOES (issues #7465,
 * #8204).
 *
 * ModelAPI tells everyone listening each time the server confirms a create
 * (ModelAPI.createOrUpdate with FormType.Create) or a delete
 * (ModelAPI.deleteItem): which kind of change, which table, and in which
 * project. The Dashboard's products menu listens (ProjectProductsStore):
 *
 *   - the first monitor a person makes stops it saying "Monitors - Not set
 *     up" at once, whichever page made it - Create Monitor, a guided setup,
 *     a bulk import - rather than after the next page load;
 *   - a monitor deleted has it ask the server again in a moment: with the
 *     project's last one gone, Monitors is "Not set up" again.
 *
 * Only what a change says about itself: no record's values, nothing a
 * person typed. A listener that throws stops nothing: the change has
 * happened, and the other listeners still hear it.
 */

export enum RecordChangeKind {
  Created = "created",
  Deleted = "deleted",
}

export interface RecordChange {
  kind: RecordChangeKind;
  // The record's table (BaseModel.tableName), such as "Monitor".
  tableName: string;
  // The project it was created or deleted in, when the page knows it.
  projectId: string | null;
}

export type RecordChangeListener = (change: RecordChange) => void;

export default class RecordChanges {
  private static listeners: Set<RecordChangeListener> =
    new Set<RecordChangeListener>();

  // Hears every create and delete from now on; call what it returns to stop.
  public static subscribe(listener: RecordChangeListener): () => void {
    RecordChanges.listeners.add(listener);

    return (): void => {
      RecordChanges.listeners.delete(listener);
    };
  }

  // Tells every listener a record was created or deleted. Never throws.
  public static announce(change: RecordChange): void {
    if (!change.tableName) {
      return;
    }

    for (const listener of Array.from(RecordChanges.listeners)) {
      try {
        listener({ ...change });
      } catch {
        // The change happened; one listener's failure is no one else's.
      }
    }
  }
}
