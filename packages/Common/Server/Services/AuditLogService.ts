import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { AuditLogRecorder } from "../Enterprise/EnterpriseServerModule";
import CreateManyBy from "../Types/AnalyticsDatabase/CreateManyBy";
import logger from "../Utils/Logger";
import AuditLog from "../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

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
 * recordCreate / recordUpdate / recordDelete / invalidateProjectSettings stay
 * here as thin delegates to the recorder the enterprise module registered, so
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

  // Null on the Community Edition (the facade also swallows a module's errors).
  private getRecorder(): AuditLogRecorder | null {
    return EnterpriseEdition.getAuditLogRecorder();
  }
}

export default new AuditLogService();
