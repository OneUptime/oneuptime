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
 * invalidateProjectSettings stay here as thin delegates to the recorder the
 * enterprise module registered, so
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

  public async recordUpdate<TModel extends BaseModel>(data: {
    model: TModel;
    before: TModel;
    updatedFields: JSONObject;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
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

    statement.append(
      SQL` ORDER BY createdAt ASC, _id ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: AUDIT_LOG_EXPORT_READ_TIME_LIMIT_IN_SECONDS,
      }),
    );

    return statement;
  }

  // Null on the Community Edition (the facade also swallows a module's errors).
  private getRecorder(): AuditLogRecorder | null {
    return EnterpriseEdition.getAuditLogRecorder();
  }
}

export default new AuditLogService();
