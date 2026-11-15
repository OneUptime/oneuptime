/*
 * THE RECORDS THIS PAGE CREATED, AS THEY ARE CREATED (issue #7465).
 *
 * ModelAPI tells everyone listening each time the server confirms a create
 * (ModelAPI.createOrUpdate with FormType.Create): which table, and in which
 * project. The Dashboard's products menu listens, so the first monitor a
 * person makes stops it saying "Monitors - Not set up" at once, whichever
 * page made it - Create Monitor, a guided setup, a bulk import - rather
 * than after the next page load (ProjectProductsStore).
 *
 * Only what a create says about itself: no record's values, nothing a
 * person typed. A listener that throws stops nothing: the create has
 * happened, and the other listeners still hear it.
 */

export interface CreatedRecord {
  // The created record's table (BaseModel.tableName), such as "Monitor".
  tableName: string;
  // The project it was created in, when the page knows it.
  projectId: string | null;
}

export type CreatedRecordListener = (record: CreatedRecord) => void;

export default class CreatedRecords {
  private static listeners: Set<CreatedRecordListener> =
    new Set<CreatedRecordListener>();

  // Hears every create from now on; call what it returns to stop.
  public static subscribe(listener: CreatedRecordListener): () => void {
    CreatedRecords.listeners.add(listener);

    return (): void => {
      CreatedRecords.listeners.delete(listener);
    };
  }

  // Tells every listener a record was created. Never throws.
  public static announce(record: CreatedRecord): void {
    if (!record.tableName) {
      return;
    }

    for (const listener of Array.from(CreatedRecords.listeners)) {
      try {
        listener({ ...record });
      } catch {
        // The create happened; one listener's failure is no one else's.
      }
    }
  }
}
