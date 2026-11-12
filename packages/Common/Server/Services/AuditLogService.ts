import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { AuditLogRecorder } from "../Enterprise/EnterpriseServerModule";
import CreateManyBy from "../Types/AnalyticsDatabase/CreateManyBy";
import logger from "../Utils/Logger";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AuditLog from "../../Models/AnalyticsModels/AuditLog";
import { AUDIT_LOG_EXPORT_SOURCE_COLUMNS } from "../../Types/AuditLog/Export/AuditLogExportRecord";
import { SessionAuditEvent } from "../../Types/AuditLog/AuditLogSessionEvent";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * How long one export read may run: well under the ClickHouse client's
 * request timeout, so the server answers (or refuses) first.
 */
export const AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS: number = 45;

// Why a create that is not the recorder's is refused.
export const AUDIT_LOG_CREATE_REFUSED_MESSAGE: string =
  "Audit log entries are recorded by OneUptime and cannot be created directly.";

/*
 * The audit log's ClickHouse table (reads, retention, migrations) and the four
 * entry points every audited write calls.
 *
 * RECORDING is an Enterprise Edition feature and lives in ee/
 * (ee/Server/AuditLog/AuditLogRecorder.ts): which changes are recorded, the
 * diff, redaction, relation names, the actor and the project-settings cache.
 * recordCreate / recordUpdate / recordDelete / recordDownload /
 * recordSessionEvents / invalidateProjectSettings stay here as thin
 * delegates to the recorder the enterprise module registered, so
 * DatabaseService, ProjectService and the user-notification services call
 * exactly what they always called.
 *
 * On the Community Edition there is no recorder: every call is a no-op, and no
 * entry is ever written.
 *
 * The recorder is looked up on EVERY call, never cached at import: the
 * enterprise module registers after core's modules have loaded.
 *
 * An audited write must never fail because of its audit entry, so a delegate
 * never throws - even when a recorder breaks its own promise not to.
 *
 * Entries are written ONLY by the recorder, as root. Any other create is
 * refused (see createMany), so nobody can forge the audit trail.
 */
export class AuditLogService extends AnalyticsDatabaseService<AuditLog> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: AuditLog, database: clickhouseDatabase });
  }

  /*
   * Refuses every create that is not root. The recorder writes as root
   * (EnterpriseEdition.getAuditLogRecorder()); anyone else - a project owner
   * or admin through POST /audit-log, a master admin, an API key - would be
   * forging entries. The model's create permissions are empty as well, but
   * master admins pass those, so this is the rule that holds for everyone.
   * Checked here rather than in onBeforeCreate: every create goes through
   * this method (create() delegates to it), and hooks can be skipped with
   * props.ignoreHooks.
   */
  public override async createMany(
    createBy: CreateManyBy<AuditLog>,
  ): Promise<Array<AuditLog>> {
    if (!createBy.props.isRoot) {
      throw new NotAuthorizedException(AUDIT_LOG_CREATE_REFUSED_MESSAGE);
    }

    return await super.createMany(createBy);
  }

  public invalidateProjectSettings(projectId: ObjectID): void {
    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      recorder.invalidateProjectSettings(projectId);
    } catch (err) {
      logger.warn(
        "AuditLog: failed to invalidate the cached project audit settings",
      );
      logger.warn(err);
    }
  }

  public async recordCreate<TModel extends BaseModel>(data: {
    model: TModel;
    createdItem: TModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      await recorder.recordCreate(data);
    } catch (err) {
      logger.warn("AuditLog: failed to record create event");
      logger.warn(err);
    }
  }

  /*
   * A change to one record, by the caller in `props`: DatabaseService's
   * update path calls this, and so does a write that goes round it.
   *
   * A write OneUptime makes FOR A PERSON round DatabaseService's hooks - a
   * merge of exceptions, written with raw SQL because it moves counts under
   * row locks; a webhook URL reset - calls this itself once it has
   * committed, with the person's props, and names in `includeColumns` the
   * columns that say what they did. Those are recorded even where the
   * model's audit configuration leaves them out because only OneUptime
   * writes them (AuditLogCoverage): the exception an exception was merged
   * into is OneUptime's to write, but a person asked for it. Nothing else
   * about the model changes - every other write of those columns stays out
   * - and a column nobody may read, or one holding a secret, is still only
   * recorded as changed, never with its value.
   */
  public async recordUpdate<TModel extends BaseModel>(data: {
    model: TModel;
    before: TModel;
    updatedFields: JSONObject;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
    includeColumns?: Array<string> | undefined;
  }): Promise<void> {
    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      await recorder.recordUpdate(data);
    } catch (err) {
      logger.warn("AuditLog: failed to record update event");
      logger.warn(err);
    }
  }

  public async recordDelete<TModel extends BaseModel>(data: {
    model: TModel;
    deletedItem: TModel;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      await recorder.recordDelete(data);
    } catch (err) {
      logger.warn("AuditLog: failed to record delete event");
      logger.warn(err);
    }
  }

  /*
   * A download of a record's file - a packet capture's pcap - by the caller
   * in `props`. Like the others, it never throws: the download it records
   * goes ahead whatever happens here.
   */
  public async recordDownload<TModel extends BaseModel>(data: {
    model: TModel;
    downloadedItem: TModel;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      await recorder.recordDownload(data);
    } catch (err) {
      logger.warn("AuditLog: failed to record download event");
      logger.warn(err);
    }
  }

  /*
   * People's sessions - who signed in, signed out, and whose session timed
   * out or was revoked (Types/AuditLog/AuditLogSessionEvent, issue #6762).
   * UserSessionService calls it when a session starts and when one ends.
   * Never throws: the sign-in or the sign-out it records goes ahead
   * whatever happens here.
   */
  public async recordSessionEvents(
    events: Array<SessionAuditEvent>,
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const recorder: AuditLogRecorder | null = this.getRecorder();

    if (!recorder) {
      return;
    }

    try {
      await recorder.recordSessionEvents(events);
    } catch (err) {
      logger.warn("AuditLog: failed to record session events");
      logger.warn(err);
    }
  }

  /*
   * The entries an audit log export sends next, oldest first: every entry
   * recorded from `startsAt` to `until` that comes after the export's
   * cursor - its project's only, or every project's for an instance export
   * (no projectId).
   *
   * Entries are ordered by when they were recorded and then by id, and the
   * cursor is the last entry delivered (its createdAt and _id), so entries
   * recorded in the same second are neither skipped nor sent twice, and a
   * read after a restart - on any worker - continues exactly where the
   * last delivery ended. createdAt is whole seconds, so ties are common.
   *
   * `until` stays a little behind now (the exporter's settle time), so an
   * entry still being written when a batch is read is read by the next one
   * instead of falling behind the cursor.
   *
   * Root-only reading, for the exporter: it answers raw rows (JSON), with
   * the record columns of AUDIT_LOG_EXPORT_SOURCE_COLUMNS.
   */
  @CaptureSpan()
  public async findEntriesForExport(data: {
    projectId: ObjectID | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: ObjectID } | null;
    limit: number;
  }): Promise<Array<JSONObject>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const statement: Statement = AuditLogService.toExportReadStatement({
      databaseName: this.database!.getDatasourceOptions().database!,
      tableName: this.model.tableName,
      ...data,
    });

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  // The read findEntriesForExport runs, every value a bound parameter.
  public static toExportReadStatement(data: {
    databaseName: string;
    tableName: string;
    projectId: ObjectID | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: ObjectID } | null;
    limit: number;
  }): Statement {
    const statement: Statement = SQL`SELECT `;
    statement.append(AUDIT_LOG_EXPORT_SOURCE_COLUMNS.join(", "));
    statement.append(` FROM ${data.databaseName}.${data.tableName} WHERE `);
    AuditLogService.appendExportWindow(statement, data);

    statement.append(
      SQL` ORDER BY createdAt ASC, _id ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );
    /*
     * Stopped at the limit, the read fails rather than breaking off: a
     * sorted read cut short answers some rows that are not the first ones,
     * and the cursor would move past entries never sent.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * When the first of the entries an audit log export has not sent is
   * deleted: the soonest retentionDate among the entries findEntriesForExport
   * reads next - from `startsAt` to `until`, after the export's cursor, its
   * project's only or every project's - or null when none waits.
   *
   * Each entry is deleted once the retentionDate the recorder stamped on it
   * passes (the table's TTL), and the recorder stamps it from the project's
   * retention as it is when the entry is recorded. A retention changed since
   * moves no stamp, so a failing export reads the stamps rather than reckon
   * from the retention as it is now: lengthened from 7 days to 30, the
   * entries already waiting are still deleted after 7 (#6563). The soonest
   * is not always the oldest entry's: a retention shortened later, or for
   * the instance's export another project's, can have a newer entry
   * deleted first.
   *
   * One row is answered, and retentionDate is read for it alone: it is never
   * part of what an export sends (AUDIT_LOG_EXPORT_SOURCE_COLUMNS leaves it
   * out). Root-only reading, for the exporter.
   */
  @CaptureSpan()
  public async findSoonestRetentionDateForExport(data: {
    projectId: ObjectID | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: ObjectID } | null;
  }): Promise<Date | null> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const statement: Statement =
      AuditLogService.toSoonestRetentionDateStatement({
        databaseName: this.database!.getDatasourceOptions().database!,
        tableName: this.model.tableName,
        ...data,
      });

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return AuditLogService.readSoonestRetentionDate(response.data || []);
  }

  /*
   * The read findSoonestRetentionDateForExport runs: how many entries wait
   * and the soonest stamp among them, as whole seconds since 1970 - a
   * number, whatever time zone the server writes dates in. It waits for the
   * same entries the export read pages through (appendExportWindow), sorts
   * nothing and answers one row. Held to the export read's time limit, and
   * stopped there it fails rather than answer the soonest of some of the
   * entries, which could be later than the real one; the exporter then
   * reckons as it did before.
   */
  public static toSoonestRetentionDateStatement(data: {
    databaseName: string;
    tableName: string;
    projectId: ObjectID | null;
    startsAt: Date;
    until: Date;
    after: { createdAt: Date; id: ObjectID } | null;
  }): Statement {
    const statement: Statement = SQL`SELECT count() AS waiting, toUnixTimestamp(min(retentionDate)) AS soonest`;
    statement.append(` FROM ${data.databaseName}.${data.tableName} WHERE `);
    AuditLogService.appendExportWindow(statement, data);
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * The soonest stamp from that read's answer, or null when no entry waits
   * (ClickHouse answers an empty set's min as 1970) or the answer has no
   * stamp that can be read: the caller then reckons without it.
   */
  public static readSoonestRetentionDate(rows: Array<JSONObject>): Date | null {
    const row: JSONObject | undefined = rows[0];

    if (!row) {
      return null;
    }

    // count() is a UInt64, which ClickHouse's JSON writes as text.
    const waiting: number = Number(row["waiting"]);
    const seconds: number = Number(row["soonest"]);

    if (
      !Number.isFinite(waiting) ||
      waiting <= 0 ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    ) {
      return null;
    }

    const soonest: Date = new Date(seconds * 1000);

    return Number.isNaN(soonest.getTime()) ? null : soonest;
  }

  /*
   * The entries an export has not sent yet, as both export reads ask for
   * them: recorded from `startsAt` to `until`, after the cursor (a later
   * second, or the same second with a later id), its project's only when it
   * names one. Every value a bound parameter.
   */
  private static appendExportWindow(
    statement: Statement,
    data: {
      projectId: ObjectID | null;
      startsAt: Date;
      until: Date;
      after: { createdAt: Date; id: ObjectID } | null;
    },
  ): void {
    statement.append(
      SQL`createdAt >= ${{
        type: TableColumnType.Date,
        value: data.startsAt,
      }} AND createdAt <= ${{
        type: TableColumnType.Date,
        value: data.until,
      }}`,
    );

    if (data.projectId) {
      statement.append(
        SQL` AND projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
        }}`,
      );
    }

    if (data.after) {
      statement.append(
        SQL` AND (createdAt > ${{
          type: TableColumnType.Date,
          value: data.after.createdAt,
        }} OR (createdAt = ${{
          type: TableColumnType.Date,
          value: data.after.createdAt,
        }} AND _id > ${{
          type: TableColumnType.Text,
          value: data.after.id.toString(),
        }}))`,
      );
    }
  }

  // Null on the Community Edition (the facade also swallows a module's errors).
  private getRecorder(): AuditLogRecorder | null {
    return EnterpriseEdition.getAuditLogRecorder();
  }
}

export default new AuditLogService();
