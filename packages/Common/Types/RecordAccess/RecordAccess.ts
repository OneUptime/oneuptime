import { JSONObject } from "../JSON";

/*
 * WHAT THE READER MAY DO ON ONE RECORD, AS THE SERVER'S OWN RULE SAYS IT
 * (#10272).
 *
 * The Dashboard's locks ask whether the reader holds a permission anywhere
 * in the project (Utils/PermissionGate). The server also weighs the record
 * itself: the labels a grant is limited to, a grant limited to the records
 * the reader or their teams own, a team's block on some labels, and a
 * private incident, alert or episode, which is changed only through the
 * teams that own it. So a reader whose Edit Incident Member reaches only
 * the incidents labelled Payments was offered Reassign on every incident,
 * and refused when they pressed it (#10191).
 *
 * A record's page now asks the server once, as it opens, what the reader
 * may do on that record and on its parts - its notes, its state changes,
 * its roles, its owners - and the server works it out with the checks a
 * write runs (Server/Utils/RecordAccess/RecordAccessBuilder): each
 * operation allowed, or refused with why. Every lock on the page reads the
 * answer (UI/Utils/RecordAccessScope), so the page never offers what the
 * server would refuse, and says why where it locks it. No button asks on
 * its own.
 *
 * Shared by the server, which answers, and the Dashboard, which locks what
 * it refuses, so the two cannot drift apart.
 */

// The kinds of record whose pages ask: each its own API's route.
export enum RecordAccessKind {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

/*
 * The tables each kind's answer is about, by table name: the record's own
 * first, then the parts its pages change (Server/Utils/RecordAccess
 * /RecordAccessKinds, which a test holds to this). A page knows them before
 * the answer lands, so their locks wait for it.
 */
export const RECORD_ACCESS_TABLES: Readonly<
  Record<RecordAccessKind, ReadonlyArray<string>>
> = {
  [RecordAccessKind.Incident]: [
    "Incident",
    "IncidentStateTimeline",
    "IncidentInternalNote",
    "IncidentPublicNote",
    "IncidentMember",
    "IncidentOwnerUser",
    "IncidentOwnerTeam",
    "IncidentPostmortemActionItem",
    "IncidentVideoCall",
  ],
  [RecordAccessKind.Alert]: [
    "Alert",
    "AlertStateTimeline",
    "AlertInternalNote",
    "AlertOwnerUser",
    "AlertOwnerTeam",
    "AlertVideoCall",
  ],
  [RecordAccessKind.IncidentEpisode]: [
    "IncidentEpisode",
    "IncidentEpisodeStateTimeline",
    "IncidentEpisodeInternalNote",
    "IncidentEpisodePublicNote",
    "IncidentEpisodeRoleMember",
    "IncidentEpisodeOwnerUser",
    "IncidentEpisodeOwnerTeam",
  ],
  [RecordAccessKind.AlertEpisode]: [
    "AlertEpisode",
    "AlertEpisodeStateTimeline",
    "AlertEpisodeInternalNote",
    "AlertEpisodeOwnerUser",
    "AlertEpisodeOwnerTeam",
  ],
  [RecordAccessKind.ScheduledMaintenance]: [
    "ScheduledMaintenance",
    "ScheduledMaintenanceStateTimeline",
    "ScheduledMaintenanceInternalNote",
    "ScheduledMaintenancePublicNote",
    "ScheduledMaintenanceOwnerUser",
    "ScheduledMaintenanceOwnerTeam",
  ],
};

// The writes the answer says something of. Reading the page is a given.
export enum RecordAccessOperation {
  Create = "create",
  Update = "update",
  Delete = "delete",
}

/*
 * Why the server refuses an operation on this record. Each is said in the
 * reader's language after the lock's first sentence ("You do not have
 * permission to change this incident's roles."), by the Dashboard.
 */
export enum RecordAccessRefusalReason {
  /*
   * The reader holds no permission for it in the project, or a team's block
   * with no labels takes it away: the same on every record, so the
   * Dashboard's own lock names what to ask for, as before.
   */
  Permission = "Permission",
  /*
   * Their permission reaches only the records carrying some labels, and
   * this one carries none of them (labelNames: the labels it reaches).
   */
  Labels = "Labels",
  // Only the records they or their teams own, and this is not one of them.
  Owned = "Owned",
  /*
   * Only the records carrying some labels and those they or their teams
   * own, and this is neither (labelNames: the labels it reaches).
   */
  LabelsOrOwned = "LabelsOrOwned",
  /*
   * A team they are on blocks it on records carrying some labels, and this
   * one carries one of them (labelNames: the labels of this record the
   * block takes away).
   */
  BlockedLabels = "BlockedLabels",
  /*
   * The record is private, and changed only with the permissions of the
   * teams that own it and of the people named as its owners, none of which
   * allows it (teamNames: the reader's teams that own it).
   */
  Private = "Private",
  // Refused on this record for another reason the rule weighs.
  Other = "Other",
}

export interface RecordAccessRefusal {
  reason: RecordAccessRefusalReason;
  // By name, as the project wrote them. Empty for most reasons.
  labelNames: Array<string>;
  // By name. Empty for every reason but Private.
  teamNames: Array<string>;
}

export interface RecordAccessVerdict {
  isAllowed: boolean;
  // Why not, when it is refused.
  refusal: RecordAccessRefusal | null;
}

/*
 * What the reader may do on one record and its parts, by table ("Incident",
 * "IncidentMember") and operation. An operation of a table left out was not
 * asked: a change or a delete of a part the record has no row of yet, which
 * no button offers until it has one.
 */
export type RecordAccessTables = Record<
  string,
  Partial<Record<RecordAccessOperation, RecordAccessVerdict>>
>;

export interface RecordAccessResult {
  kind: RecordAccessKind;
  recordId: string;
  tables: RecordAccessTables;
}

const OPERATIONS: ReadonlyArray<string> = Object.values(RecordAccessOperation);
const KINDS: ReadonlyArray<string> = Object.values(RecordAccessKind);
const REASONS: ReadonlyArray<string> = Object.values(RecordAccessRefusalReason);

const readNames: (value: unknown) => Array<string> | null = (
  value: unknown,
): Array<string> | null => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const names: Array<string> = [];

  for (const name of value) {
    if (typeof name !== "string") {
      return null;
    }

    if (name.trim()) {
      names.push(name);
    }
  }

  return names;
};

export default class RecordAccess {
  // Each record's route, under its own API: GET /incident/record-access/:id.
  public static readonly routePath: string = "/record-access";

  // What the answer says of one operation on one table: null when not asked.
  public static getVerdict(
    result: RecordAccessResult | null | undefined,
    tableName: string | null | undefined,
    operation: RecordAccessOperation,
  ): RecordAccessVerdict | null {
    if (!result || !tableName) {
      return null;
    }

    return result.tables[tableName]?.[operation] || null;
  }

  public static allowed(): RecordAccessVerdict {
    return { isAllowed: true, refusal: null };
  }

  public static refused(
    reason: RecordAccessRefusalReason,
    names?: { labelNames?: Array<string>; teamNames?: Array<string> },
  ): RecordAccessVerdict {
    return {
      isAllowed: false,
      refusal: {
        reason: reason,
        labelNames: [...(names?.labelNames || [])],
        teamNames: [...(names?.teamNames || [])],
      },
    };
  }

  public static toJSON(result: RecordAccessResult): JSONObject {
    const tables: JSONObject = {};

    for (const [tableName, operations] of Object.entries(result.tables)) {
      const verdicts: JSONObject = {};

      for (const operation of OPERATIONS) {
        const verdict: RecordAccessVerdict | undefined =
          operations[operation as RecordAccessOperation];

        if (!verdict) {
          continue;
        }

        verdicts[operation] = {
          isAllowed: verdict.isAllowed,
          refusal: verdict.refusal
            ? {
                reason: verdict.refusal.reason,
                labelNames: [...verdict.refusal.labelNames],
                teamNames: [...verdict.refusal.teamNames],
              }
            : null,
        };
      }

      tables[tableName] = verdicts;
    }

    return {
      kind: result.kind,
      recordId: result.recordId,
      tables: tables,
    };
  }

  /*
   * The server's answer as the Dashboard receives it, or null when it cannot
   * be read: a kind, an operation or a reason it does not know, a refusal
   * without its reason. Null locks nothing more than the reader's own
   * permissions do - the server still holds every write to the rule - where
   * reading a broken answer as "allowed" or "refused" would say what nobody
   * worked out.
   */
  public static fromJSON(json: unknown): RecordAccessResult | null {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }

    const record: JSONObject = json as JSONObject;
    const kind: unknown = record["kind"];
    const recordId: unknown = record["recordId"];
    const tables: unknown = record["tables"];

    if (
      typeof kind !== "string" ||
      !KINDS.includes(kind) ||
      typeof recordId !== "string" ||
      !recordId ||
      !tables ||
      typeof tables !== "object" ||
      Array.isArray(tables)
    ) {
      return null;
    }

    const result: RecordAccessResult = {
      kind: kind as RecordAccessKind,
      recordId: recordId,
      tables: {},
    };

    for (const [tableName, operations] of Object.entries(
      tables as JSONObject,
    )) {
      if (
        !operations ||
        typeof operations !== "object" ||
        Array.isArray(operations)
      ) {
        return null;
      }

      const verdicts: Partial<
        Record<RecordAccessOperation, RecordAccessVerdict>
      > = {};

      for (const [operation, verdict] of Object.entries(
        operations as JSONObject,
      )) {
        if (!OPERATIONS.includes(operation)) {
          return null;
        }

        const read: RecordAccessVerdict | null =
          RecordAccess.readVerdict(verdict);

        if (!read) {
          return null;
        }

        verdicts[operation as RecordAccessOperation] = read;
      }

      result.tables[tableName] = verdicts;
    }

    return result;
  }

  private static readVerdict(value: unknown): RecordAccessVerdict | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const verdict: JSONObject = value as JSONObject;

    if (typeof verdict["isAllowed"] !== "boolean") {
      return null;
    }

    if (verdict["isAllowed"]) {
      return RecordAccess.allowed();
    }

    const refusal: unknown = verdict["refusal"];

    if (!refusal || typeof refusal !== "object" || Array.isArray(refusal)) {
      return null;
    }

    const reason: unknown = (refusal as JSONObject)["reason"];
    const labelNames: Array<string> | null = readNames(
      (refusal as JSONObject)["labelNames"],
    );
    const teamNames: Array<string> | null = readNames(
      (refusal as JSONObject)["teamNames"],
    );

    if (
      typeof reason !== "string" ||
      !REASONS.includes(reason) ||
      !labelNames ||
      !teamNames
    ) {
      return null;
    }

    return RecordAccess.refused(reason as RecordAccessRefusalReason, {
      labelNames: labelNames,
      teamNames: teamNames,
    });
  }
}
