import CodeFixTaskContext from "./CodeFixTaskContext";
import { CodeTaskContextType } from "./CodeTask";
import ObjectID from "../ObjectID";

/*
 * THE INCIDENTS AND ALERTS A PIECE OF CODE WORK CARRIES (#9186).
 *
 * A Code task can hold an incident or an alert without being a fix of one:
 * a person added it as context to the request or to a reply, or the task was
 * asked from a postmortem action item and carries the action item's
 * incident. A pull request OneUptime AI opened from a chat carries the
 * chat's subject: the incident or alert whose AI conversation it is, or the
 * one Ask AI was asked about. What it carries is listed on the row
 * (carriedIncidentIds, carriedAlertIds on AIRun and AIAgentTaskPullRequest),
 * and the work is read only by those who may read every record it carries
 * (Server/Utils/AI/AIRunOutputReadFilter).
 *
 * Kept apart from the keys a fix names its record by (triggeredByIncidentId,
 * triggeredByAlertId), which the fix-task triggers, the daily fix-task limit
 * and the AI logs read as a fix of the record.
 *
 * Every id is kept as the lists hold it - a UUID in lower case - and
 * anything else is no id. Pure: the server writes the lists with it, and the
 * tests pin it.
 */
export interface CarriedRecordIds {
  incidentIds: Array<string>;
  alertIds: Array<string>;
}

// The keys a row lists what it carries in.
export interface CarriedRecordKeys {
  carriedIncidentIds?: Array<string> | undefined;
  carriedAlertIds?: Array<string> | undefined;
}

type IdLike = ObjectID | string | null | undefined;

export default class CarriedRecords {
  public static none(): CarriedRecordIds {
    return { incidentIds: [], alertIds: [] };
  }

  public static isNone(records: CarriedRecordIds): boolean {
    return records.incidentIds.length === 0 && records.alertIds.length === 0;
  }

  // An id as the lists keep it: a UUID in lower case, or null.
  public static readId(value: unknown): string | null {
    const text: string =
      value instanceof ObjectID
        ? value.toString()
        : typeof value === "string"
          ? value
          : "";
    const id: string = text.trim().toLowerCase();

    return ObjectID.isValidUUID(id) ? id : null;
  }

  // The records named, each once, any that is no id left out.
  public static of(data: {
    incidentIds?: ReadonlyArray<IdLike> | undefined;
    alertIds?: ReadonlyArray<IdLike> | undefined;
  }): CarriedRecordIds {
    return {
      incidentIds: CarriedRecords.readIds(data.incidentIds),
      alertIds: CarriedRecords.readIds(data.alertIds),
    };
  }

  /*
   * What a turn's request carries: every incident and alert its context
   * names (taskContext.request.context). Read from the context as stored,
   * whatever else the request holds, so a request that could not be asked
   * again still says what it carried.
   */
  public static ofTaskContext(
    taskContext: CodeFixTaskContext | null | undefined,
  ): CarriedRecordIds {
    const context: unknown =
      taskContext && typeof taskContext === "object"
        ? (taskContext.request as { context?: unknown } | undefined)?.context
        : undefined;

    if (!Array.isArray(context)) {
      return CarriedRecords.none();
    }

    const incidentIds: Array<unknown> = [];
    const alertIds: Array<unknown> = [];

    for (const item of context) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const type: unknown = (item as { type?: unknown }).type;
      const recordId: unknown = (item as { recordId?: unknown }).recordId;

      if (type === CodeTaskContextType.Incident) {
        incidentIds.push(recordId);
      } else if (type === CodeTaskContextType.Alert) {
        alertIds.push(recordId);
      }
    }

    return CarriedRecords.of({
      incidentIds: incidentIds as Array<IdLike>,
      alertIds: alertIds as Array<IdLike>,
    });
  }

  // What a row's keys list.
  public static ofRow(
    row: CarriedRecordKeys | null | undefined,
  ): CarriedRecordIds {
    return CarriedRecords.of({
      incidentIds: Array.isArray(row?.carriedIncidentIds)
        ? row!.carriedIncidentIds
        : [],
      alertIds: Array.isArray(row?.carriedAlertIds) ? row!.carriedAlertIds : [],
    });
  }

  // Every record any of them carries, each once, in the order first named.
  public static merge(
    ...records: Array<CarriedRecordIds | null | undefined>
  ): CarriedRecordIds {
    const incidentIds: Array<string> = [];
    const alertIds: Array<string> = [];

    for (const each of records) {
      if (!each) {
        continue;
      }

      incidentIds.push(...each.incidentIds);
      alertIds.push(...each.alertIds);
    }

    return CarriedRecords.of({ incidentIds, alertIds });
  }

  // Those of `records` that `already` does not carry.
  public static without(
    records: CarriedRecordIds,
    already: CarriedRecordIds,
  ): CarriedRecordIds {
    return {
      incidentIds: records.incidentIds.filter((id: string): boolean => {
        return !already.incidentIds.includes(id);
      }),
      alertIds: records.alertIds.filter((id: string): boolean => {
        return !already.alertIds.includes(id);
      }),
    };
  }

  /*
   * Writes them onto a row's keys: a key carrying none is left out, so the
   * row holds null there and costs its readers nothing.
   */
  public static writeTo(
    row: CarriedRecordKeys,
    records: CarriedRecordIds,
  ): void {
    row.carriedIncidentIds =
      records.incidentIds.length > 0 ? [...records.incidentIds] : undefined;
    row.carriedAlertIds =
      records.alertIds.length > 0 ? [...records.alertIds] : undefined;
  }

  private static readIds(
    values: ReadonlyArray<IdLike> | undefined,
  ): Array<string> {
    const ids: Array<string> = [];

    for (const value of values || []) {
      const id: string | null = CarriedRecords.readId(value);

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }
}
