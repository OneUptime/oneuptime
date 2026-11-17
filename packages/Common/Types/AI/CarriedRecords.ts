import {
  AIChatCitation,
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "./AIChatTypes";
import CodeFixTaskContext from "./CodeFixTaskContext";
import { CodeTaskContextType } from "./CodeTask";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * THE INCIDENTS AND ALERTS A PIECE OF CODE WORK CARRIES (#9186).
 *
 * A Code task can hold an incident or an alert without being a fix of one:
 * a person added it as context to the request or to a reply, or the task was
 * asked from a postmortem action item and carries the action item's
 * incident. A pull request OneUptime AI opened from a chat carries the
 * chat's subject: the incident or alert whose AI conversation it is, or the
 * one Ask AI was asked about - and what the chat read of others (#9242):
 * every one it opened one by one (openedByCitations), and every one a list
 * showed it whose title the pull request quotes (quotedFromLists). What it
 * carries is listed on the row (carriedIncidentIds, carriedAlertIds on
 * AIRun and AIAgentTaskPullRequest), and the work is read only by those who
 * may read every record it carries (Server/Utils/AI/AIRunOutputReadFilter).
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

/*
 * The shortest title, in characters, a pull request is held to quote
 * (CarriedRecords.quotedFromLists): a shorter one ("Outage") is a word or
 * two a pull request writes for reasons of its own.
 */
export const MIN_QUOTED_TITLE_LENGTH: number = 8;

// The list widgets of a chat, and the kind of record each one's rows are.
const LIST_WIDGET_KINDS: ReadonlyArray<{
  type: AIChatWidgetType;
  kind: "incident" | "alert";
}> = [
  { type: AIChatWidgetType.IncidentList, kind: "incident" },
  { type: AIChatWidgetType.AlertList, kind: "alert" },
];

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

  /*
   * What a chat opened one by one (#9242): every incident and alert a
   * citation names on its own - a tool that read that one record (its
   * details, its timeline) or acted on it (a note, a new state), cited by
   * the record's page (IncidentView, AlertView) with its id - from a result
   * that found it. A list's citation names no one record, and a result
   * that found nothing (no rows: no such record, or not one the person may
   * read) read nothing of one.
   */
  public static openedByCitations(
    citations:
      | ReadonlyArray<AIChatCitation | null | undefined>
      | null
      | undefined,
  ): CarriedRecordIds {
    const incidentIds: Array<IdLike> = [];
    const alertIds: Array<IdLike> = [];

    for (const citation of Array.isArray(citations) ? citations : []) {
      if (
        !citation ||
        typeof citation !== "object" ||
        !(Number(citation.rowCount) > 0)
      ) {
        continue;
      }

      const params: Record<string, unknown> =
        citation.target?.params && typeof citation.target.params === "object"
          ? (citation.target.params as Record<string, unknown>)
          : {};

      if (citation.target?.type === AIChatCitationTargetType.IncidentView) {
        incidentIds.push(params["incidentId"] as IdLike);
      } else if (citation.target?.type === AIChatCitationTargetType.AlertView) {
        alertIds.push(params["alertId"] as IdLike);
      }
    }

    return CarriedRecords.of({ incidentIds, alertIds });
  }

  /*
   * What a pull request quotes of the records a list showed a chat (#9242):
   * every incident and alert a list of the chat held (an IncidentList or
   * AlertList widget: a list of incidents or alerts, a search of them) whose
   * title `text` - the pull request's title and description - contains,
   * whatever its case and its runs of white space, a title at least
   * MIN_QUOTED_TITLE_LENGTH characters long. The other rows a list showed
   * are not carried: they were in front of the model, not in the pull
   * request, and a list of fifty would tie the pull request to all fifty.
   */
  public static quotedFromLists(data: {
    widgets: ReadonlyArray<AIChatWidget | null | undefined> | null | undefined;
    text: string | null | undefined;
  }): CarriedRecordIds {
    const text: string = CarriedRecords.normalizeForQuote(data.text);
    const incidentIds: Array<IdLike> = [];
    const alertIds: Array<IdLike> = [];

    if (!text) {
      return CarriedRecords.none();
    }

    for (const widget of Array.isArray(data.widgets) ? data.widgets : []) {
      const kind: "incident" | "alert" | undefined = LIST_WIDGET_KINDS.find(
        (each: { type: AIChatWidgetType; kind: "incident" | "alert" }) => {
          return Boolean(widget) && widget!.type === each.type;
        },
      )?.kind;
      const items: unknown = widget?.data?.items;

      if (!kind || !Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }

        const title: string = CarriedRecords.normalizeForQuote(
          (item as JSONObject)["title"],
        );

        if (
          Array.from(title).length < MIN_QUOTED_TITLE_LENGTH ||
          !text.includes(title)
        ) {
          continue;
        }

        (kind === "incident" ? incidentIds : alertIds).push(
          (item as JSONObject)["id"] as IdLike,
        );
      }
    }

    return CarriedRecords.of({ incidentIds, alertIds });
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

  // Text as a quote is looked for in it: lower case, each run of white space one space.
  private static normalizeForQuote(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
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
