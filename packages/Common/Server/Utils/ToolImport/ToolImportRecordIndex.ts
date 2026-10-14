import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import {
  getGroupSourceIdKey,
  isGroupSourceIdOf,
} from "../../../Types/ToolImport/ToolImportScheduleRules";

/*
 * WHAT IMPORTS REMEMBERED, FOUND BY KIND AND THE TOOL'S ID.
 *
 * Every item of an import asks for the records earlier imports (or this
 * one, before a restart) remembered for it, and a project can hold tens of
 * thousands of them: a status page's subscribers come over five thousand
 * at a time. Kept by kind and by the key of the tool's id, an item's
 * records are found in one step rather than by a pass over all of them.
 * The key is what every source id of a schedule's groups shares
 * (getGroupSourceIdKey), so a schedule finds each schedule it became the
 * same way.
 */

// What a record is found by: its kind and the tool's id.
export interface ToolImportIndexedRecord {
  kind?: ToolImportResourceKind | undefined;
  sourceId?: string | undefined;
}

export default class ToolImportRecordIndex<T extends ToolImportIndexedRecord> {
  // By kind, then by the key of the tool's id, in the order they were added.
  private recordsByKind: Map<ToolImportResourceKind, Map<string, Array<T>>> =
    new Map<ToolImportResourceKind, Map<string, Array<T>>>();

  public constructor(records: Array<T> = []) {
    for (const record of records) {
      this.add(record);
    }
  }

  // A record with no kind or no id of the tool is never asked for, and not kept.
  public add(record: T): void {
    if (!record.kind || !record.sourceId) {
      return;
    }

    const byKey: Map<string, Array<T>> = this.recordsByKind.get(record.kind) ||
    new Map<string, Array<T>>();
    const key: string = getGroupSourceIdKey(record.sourceId);
    const records: Array<T> = byKey.get(key) || [];

    records.push(record);
    byKey.set(key, records);
    this.recordsByKind.set(record.kind, byKey);
  }

  public remove(records: Array<T>): void {
    for (const record of records) {
      if (!record.kind || !record.sourceId) {
        continue;
      }

      const byKey: Map<string, Array<T>> | undefined = this.recordsByKind.get(
        record.kind,
      );
      const key: string = getGroupSourceIdKey(record.sourceId);
      const kept: Array<T> = (byKey?.get(key) || []).filter(
        (candidate: T): boolean => {
          return candidate !== record;
        },
      );

      if (kept.length > 0) {
        byKey?.set(key, kept);
      } else {
        byKey?.delete(key);
      }
    }
  }

  // The records remembered by the tool's id, in the order they were added.
  public find(kind: ToolImportResourceKind, sourceId: string): Array<T> {
    return this.findSharingKey(kind, sourceId).filter((record: T): boolean => {
      return record.sourceId === sourceId;
    });
  }

  /*
   * The records remembered by the tool's id or by the id of one of the
   * groups a schedule of that id became (isGroupSourceIdOf), in the order
   * they were added.
   */
  public findWithGroups(
    kind: ToolImportResourceKind,
    sourceId: string,
  ): Array<T> {
    return this.findSharingKey(kind, sourceId).filter((record: T): boolean => {
      return isGroupSourceIdOf(record.sourceId!, sourceId);
    });
  }

  private findSharingKey(
    kind: ToolImportResourceKind,
    sourceId: string,
  ): Array<T> {
    return (
      this.recordsByKind.get(kind)?.get(getGroupSourceIdKey(sourceId)) || []
    );
  }
}
