import TableColumnType from "../Database/TableColumnType";

/*
 * A RECORD'S PARTS, AS THE LABEL RULE AND THE OWNED SCOPE WEIGH THEM
 * (#11435).
 *
 * A part of a record is a model that carries no labels of its own and is
 * read through the record (@CanAccessIfCanReadOn): a monitor's owners
 * (MonitorOwnerUser, MonitorOwnerTeam), its probes (MonitorProbe), its
 * status timeline. Its rows carry the labels of the records they name, so
 * the server weighs a part's create, change and delete against those
 * records' labels (Server/Types/Database/Permissions/ReadPermission
 * .getGrantedLabelsCondition, CreateScopePermission), and against their
 * owners where the part takes its owners from them (OwnedScopePermission
 * .getOwnedThrough). On a record's page, a part's rows are the record's:
 * they name it by the part's key, and the page's own labels and owners say
 * what they carry.
 *
 * Except where a part's rows name other labelled records too - a monitor's
 * probe names its probe, which carries labels of its own; an announcement
 * is on several status pages. A grant limited to labels may reach such a
 * row through the other record, so the record's labels decide only the
 * blocks on it (a block takes a row away through any record it names).
 * Those parts are listed here, worked out from the models by the server's
 * own reading of them (ReadPermission.getLabelledReferences) and written
 * down because the Dashboard carries no server code: RecordPartsGuard.test
 * .ts (Tests/Server/Types/Database/Permissions) fails, naming each part to
 * add or remove, whenever a model changes what its rows name. In
 * alphabetical order.
 */
export const PARTS_NAMING_OTHER_LABELLED_RECORDS: ReadonlyArray<string> = [
  "AlertEpisodeMember",
  "IncidentAlert",
  "IncidentEpisodeMember",
  "IncidentPostmortemActionItem",
  "MonitorGroupResource",
  "MonitorProbe",
  "MonitorTest",
  "OnCallDutyPolicyEscalationRuleSchedule",
  "OnCallDutyPolicyExecutionLog",
  "OnCallDutyPolicyExecutionLogTimeline",
  "StatusPageAnnouncement",
  "StatusPageAnnouncementTemplate",
  "StatusPageResource",
  "UserOnCallLog",
  "UserOnCallLogTimeline",
];

const NAMING_OTHERS: ReadonlySet<string> = new Set<string>(
  PARTS_NAMING_OTHER_LABELLED_RECORDS,
);

// What the rule reads of a model to tell whether it is a part, and of what.
export interface RecordPartModel {
  tableName?: string | null | undefined;
  canAccessIfCanReadOn?: string | null | undefined;
  getAccessControlColumn?: (() => string | null) | undefined;
  getTableColumnMetadata?:
    | ((column: string) =>
        | {
            type?: unknown;
            modelType?: unknown;
            manyToOneRelationColumn?: string | undefined;
          }
        | undefined)
    | undefined;
}

// The record a part is read through.
export interface RecordOfPart {
  // The record's table: "Monitor".
  tableName: string;
  // The part's column naming it: "monitorId". Empty for a list of records.
  key: string;
  // The part names several records of the kind, through a join table.
  isList: boolean;
}

export default class RecordParts {
  /*
   * The record `part` is read through, when it is a part at all: a model
   * that carries no labels of its own and names, by @CanAccessIfCanReadOn,
   * one record (a relation and its key) or several (a list). Null for any
   * other model.
   */
  public static getRecordOf(
    part: RecordPartModel | null | undefined,
  ): RecordOfPart | null {
    if (!part || !part.canAccessIfCanReadOn || !part.getTableColumnMetadata) {
      return null;
    }

    if (part.getAccessControlColumn?.()) {
      return null;
    }

    const column:
      | {
          type?: unknown;
          modelType?: unknown;
          manyToOneRelationColumn?: string | undefined;
        }
      | undefined = part.getTableColumnMetadata(part.canAccessIfCanReadOn);

    if (!column || typeof column.modelType !== "function") {
      return null;
    }

    let tableName: string = "";

    try {
      tableName =
        (
          new (column.modelType as { new (): { tableName?: string | null } })()
        ).tableName || "";
    } catch {
      return null;
    }

    if (!tableName) {
      return null;
    }

    if (column.type === TableColumnType.EntityArray) {
      return { tableName: tableName, key: "", isList: true };
    }

    if (
      column.type !== TableColumnType.Entity ||
      !column.manyToOneRelationColumn
    ) {
      return null;
    }

    return {
      tableName: tableName,
      key: column.manyToOneRelationColumn,
      isList: false,
    };
  }

  // Whether `part` is a part of the records of `recordTableName`.
  public static isPartOf(
    part: RecordPartModel | null | undefined,
    recordTableName: string | null | undefined,
  ): boolean {
    const record: RecordOfPart | null = RecordParts.getRecordOf(part);

    return Boolean(
      record && recordTableName && record.tableName === recordTableName,
    );
  }

  /*
   * Whether a part's rows name no labelled record but the one they are read
   * through, by its key: the record's labels are then every label they
   * carry, and decide its grants as well as its blocks.
   */
  public static namesOnlyItsRecord(
    part: RecordPartModel | null | undefined,
  ): boolean {
    const record: RecordOfPart | null = RecordParts.getRecordOf(part);

    return Boolean(
      record &&
        !record.isList &&
        part?.tableName &&
        !NAMING_OTHERS.has(part.tableName),
    );
  }
}
