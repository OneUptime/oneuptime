/*
 * THE KINDS OF RECORD THAT CAN BE PRIVATE, AND THE RECORDS THAT ARE PARTS OF
 * THEM - shared by the server's rule (Server/Types/Database/Permissions
 * /PrivateRecordPermission) and the dashboard, which locks what the rule
 * refuses (UI/Utils/PrivateRecordScope).
 *
 * An incident, an alert and the two kinds of episode can be private: only
 * their owners and the project's owners and admins see them, and they are
 * changed only with the permissions of the teams that own them and of the
 * people named as their owners. A part of one - a record read through it
 * (@CanAccessIfCanReadOn): its notes, owners, state timeline, roles - is
 * changed only as the record is.
 */

// The tables of the kinds of record that can be private.
export const PRIVATE_RECORD_TABLES: ReadonlyArray<string> = [
  "Incident",
  "Alert",
  "IncidentEpisode",
  "AlertEpisode",
];

/*
 * THE PRIVATE RECORDS A PART NAMES BESIDE THE ONE IT IS READ THROUGH, by
 * the part's table and the keys that name them: an episode's member row is
 * read through its alert (or incident) and is as much a part of its
 * episode; an incident's link to an alert is read through the incident and
 * is as much a part of the alert. A write of such a row changes both, and is
 * held to both. PrivateRecordParts.test lists every model naming two.
 *
 * The same holds for what a person does ABOUT a private record, though it
 * is read through something else (#8913):
 *
 *   - a page of an on-call policy, about the incident, alert or episode it
 *     names (triggeredBy*): the Dashboard's Execute On-Call Policy, Page
 *     now, Slack, Microsoft Teams and OneUptime AI - and each step of it,
 *     which OneUptime writes;
 *   - a run of a runbook linked to an incident or an alert: Run runbook,
 *     OneUptime AI, and the steps advanced, skipped or cancelled;
 *   - a fix OneUptime AI proposed for an incident or an alert: approved,
 *     dry-run again or dismissed.
 *
 * On a private record, each is made only with the permissions of the teams
 * that own it, of the people named as its owners, and of Project Owners and
 * Admins - like a note on it - and read only by those who see the record.
 *
 * So is what OneUptime sent about one - the email, SMS, call, push, WhatsApp,
 * Telegram, Slack or Microsoft Teams message and webhook logs, and the
 * calls it made to an AI provider - whose text quotes the record: only
 * OneUptime writes them, and only those who see the record read them. A
 * person's own page (UserOnCallLog) is theirs: they were paged about it.
 */
export const ALSO_PART_OF: Readonly<Record<string, ReadonlyArray<string>>> = {
  AlertEpisodeMember: ["alertEpisodeId"],
  IncidentEpisodeMember: ["incidentEpisodeId"],
  IncidentAlert: ["alertId"],
  OnCallDutyPolicyExecutionLog: [
    "triggeredByIncidentId",
    "triggeredByAlertId",
    "triggeredByIncidentEpisodeId",
    "triggeredByAlertEpisodeId",
  ],
  OnCallDutyPolicyExecutionLogTimeline: [
    "triggeredByIncidentId",
    "triggeredByAlertId",
    "triggeredByIncidentEpisodeId",
    "triggeredByAlertEpisodeId",
  ],
  RunbookExecution: ["incidentId", "alertId"],
  AutoRemediationSuggestion: ["incidentId", "alertId"],
  CallLog: ["incidentId", "alertId"],
  EmailLog: ["incidentId", "alertId"],
  LlmLog: ["incidentId", "alertId"],
  PushNotificationLog: ["incidentId", "alertId"],
  SmsLog: ["incidentId", "alertId"],
  TelegramLog: ["incidentId", "alertId"],
  WebhookLog: ["incidentId", "alertId"],
  WhatsAppLog: ["incidentId", "alertId"],
  WorkspaceNotificationLog: [
    "incidentId",
    "alertId",
    "incidentEpisodeId",
    "alertEpisodeId",
  ],
};

// What the two functions below read of a model: a database model is one.
export interface PrivateRecordPartModel {
  tableName?: string | null | undefined;
  canAccessIfCanReadOn?: string | null | undefined;
  getTableColumnMetadata?: ((column: string) => unknown) | undefined;
  // A database model's: { columns }. An analytics model's is no list of them.
  getTableColumns?: (() => unknown) | undefined;
}

interface RelationMetadata {
  modelType?: { new (): { tableName?: string | null } } | undefined;
  manyToOneRelationColumn?: string | undefined;
}

export default class PrivateRecordParts {
  // Whether a table holds a kind of record that can be private.
  public static isPrivateRecordTable(
    tableName: string | null | undefined,
  ): boolean {
    return Boolean(tableName && PRIVATE_RECORD_TABLES.includes(tableName));
  }

  /*
   * The kinds of private record (their tables) a model's rows are, or are a
   * part of: its own table when it is one; the record it is read through
   * when that is one; and the others it names (ALSO_PART_OF). None for a
   * model that has nothing to do with a private record.
   */
  public static getKindsOf(model: PrivateRecordPartModel): Array<string> {
    const kinds: Array<string> = [];

    const add: (tableName: string | null | undefined) => void = (
      tableName: string | null | undefined,
    ): void => {
      if (
        tableName &&
        PrivateRecordParts.isPrivateRecordTable(tableName) &&
        !kinds.includes(tableName)
      ) {
        kinds.push(tableName);
      }
    };

    if (PrivateRecordParts.isPrivateRecordTable(model.tableName)) {
      add(model.tableName);
      return kinds;
    }

    if (model.canAccessIfCanReadOn && model.getTableColumnMetadata) {
      add(
        PrivateRecordParts.getRelatedTableName(
          model.getTableColumnMetadata(model.canAccessIfCanReadOn),
        ),
      );
    }

    const keys: ReadonlyArray<string> =
      ALSO_PART_OF[model.tableName || ""] || [];

    const columns: unknown =
      keys.length > 0 && model.getTableColumns
        ? (model.getTableColumns() as { columns?: unknown } | undefined)
            ?.columns
        : undefined;

    if (Array.isArray(columns) && model.getTableColumnMetadata) {
      for (const column of columns as Array<string>) {
        const metadata: RelationMetadata | undefined =
          model.getTableColumnMetadata(column) as RelationMetadata | undefined;

        if (
          metadata?.manyToOneRelationColumn &&
          keys.includes(metadata.manyToOneRelationColumn)
        ) {
          add(PrivateRecordParts.getRelatedTableName(metadata));
        }
      }
    }

    return kinds;
  }

  /*
   * Whether a model's rows are records of the private kind `tableName`, or
   * parts of them (getKindsOf).
   */
  public static isPartOf(
    model: PrivateRecordPartModel,
    tableName: string,
  ): boolean {
    return PrivateRecordParts.getKindsOf(model).includes(tableName);
  }

  private static getRelatedTableName(metadata: unknown): string | null {
    const modelType: RelationMetadata["modelType"] = (
      metadata as RelationMetadata | undefined
    )?.modelType;

    if (!modelType) {
      return null;
    }

    return new modelType().tableName || null;
  }
}
