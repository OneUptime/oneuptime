import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ProjectService from "./ProjectService";
import { IsBillingEnabled, IsEnterpriseEdition } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import AuditLog from "../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { getColumnAccessControlForAllColumns } from "../../Types/Database/AccessControl/ColumnAccessControl";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserType from "../../Types/UserType";
import UserService from "./UserService";
import OneUptimeDate from "../../Types/Date";

const PROJECT_SETTINGS_CACHE_TTL_MS: number = 60 * 1000;
const USER_CACHE_TTL_MS: number = 5 * 60 * 1000;

const SKIPPED_FIELDS: ReadonlySet<string> = new Set<string>([
  "_id",
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "slug",
]);

const NAME_CANDIDATE_FIELDS: ReadonlyArray<string> = [
  "name",
  "title",
  "displayName",
];

interface CachedProjectSettings {
  enableAuditLogs: boolean;
  retentionInDays: number;
  planName: PlanType | undefined;
  expiresAt: number;
}

interface CachedUser {
  name: string | null;
  email: string | null;
  expiresAt: number;
}

export class AuditLogService extends AnalyticsDatabaseService<AuditLog> {
  private projectSettingsCache: Map<string, CachedProjectSettings> = new Map();
  private userCache: Map<string, CachedUser> = new Map();

  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: AuditLog, database: clickhouseDatabase });
  }

  public invalidateProjectSettings(projectId: ObjectID): void {
    this.projectSettingsCache.delete(projectId.toString());
  }

  public async recordCreate<TModel extends BaseModel>(data: {
    model: TModel;
    createdItem: TModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      const projectId: ObjectID | undefined = this.resolveProjectId(
        data.model,
        data.createdItem,
        data.props,
      );

      if (!projectId) {
        return;
      }

      const settings: CachedProjectSettings | null =
        await this.getProjectSettings(projectId);

      if (!this.isEligible(settings, data.props)) {
        return;
      }

      const redactedFields: Set<string> = this.getRedactedFields(data.model);
      const changes: JSONArray = this.buildSnapshotChanges({
        model: data.createdItem,
        redactedFields,
        valueKey: "newValue",
      });

      await this.insert({
        projectId,
        resourceType: this.getResourceType(data.model),
        resourceId: data.createdItem.id ?? null,
        resourceName: this.getResourceName(data.createdItem),
        action: AuditLogAction.Create,
        changes,
        props: data.props,
        retentionInDays: settings!.retentionInDays,
      });
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
    try {
      const projectId: ObjectID | undefined = this.resolveProjectId(
        data.model,
        data.before,
        data.props,
      );

      if (!projectId) {
        return;
      }

      const settings: CachedProjectSettings | null =
        await this.getProjectSettings(projectId);

      if (!this.isEligible(settings, data.props)) {
        return;
      }

      const redactedFields: Set<string> = this.getRedactedFields(data.model);
      const changes: JSONArray = this.buildUpdateDiff({
        before: data.before,
        updatedFields: data.updatedFields,
        redactedFields,
      });

      if (changes.length === 0) {
        return;
      }

      await this.insert({
        projectId,
        resourceType: this.getResourceType(data.model),
        resourceId: data.itemId,
        resourceName: this.getResourceName(data.before),
        action: AuditLogAction.Update,
        changes,
        props: data.props,
        retentionInDays: settings!.retentionInDays,
      });
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
    try {
      const projectId: ObjectID | undefined = this.resolveProjectId(
        data.model,
        data.deletedItem,
        data.props,
      );

      if (!projectId) {
        return;
      }

      const settings: CachedProjectSettings | null =
        await this.getProjectSettings(projectId);

      if (!this.isEligible(settings, data.props)) {
        return;
      }

      const redactedFields: Set<string> = this.getRedactedFields(data.model);
      const changes: JSONArray = this.buildSnapshotChanges({
        model: data.deletedItem,
        redactedFields,
        valueKey: "oldValue",
      });

      await this.insert({
        projectId,
        resourceType: this.getResourceType(data.model),
        resourceId: data.itemId,
        resourceName: this.getResourceName(data.deletedItem),
        action: AuditLogAction.Delete,
        changes,
        props: data.props,
        retentionInDays: settings!.retentionInDays,
      });
    } catch (err) {
      logger.warn("AuditLog: failed to record delete event");
      logger.warn(err);
    }
  }

  private async insert(params: {
    projectId: ObjectID;
    resourceType: string;
    resourceId: ObjectID | null;
    resourceName: string | null;
    action: AuditLogAction;
    changes: JSONArray;
    props: DatabaseCommonInteractionProps;
    retentionInDays: number;
  }): Promise<void> {
    const auditLog: AuditLog = new AuditLog();
    auditLog.projectId = params.projectId;
    auditLog.resourceType = params.resourceType;
    if (params.resourceId) {
      auditLog.resourceId = params.resourceId;
    }
    if (params.resourceName) {
      auditLog.resourceName = params.resourceName;
    }
    auditLog.action = params.action;

    const actor: {
      userId: ObjectID | null;
      userName: string | null;
      userEmail: string | null;
      userType: string | null;
    } = await this.resolveActor(params.props);

    if (actor.userId) {
      auditLog.userId = actor.userId;
    }
    if (actor.userName) {
      auditLog.userName = actor.userName;
    }
    if (actor.userEmail) {
      auditLog.userEmail = actor.userEmail;
    }
    if (actor.userType) {
      auditLog.userType = actor.userType;
    }

    auditLog.changes = params.changes;
    auditLog.retentionDate = this.computeRetentionDate(params.retentionInDays);

    await this.create({
      data: auditLog,
      props: { isRoot: true },
    });
  }

  private computeRetentionDate(retentionInDays: number): Date {
    const days: number = Math.max(1, Math.min(retentionInDays || 7, 180));
    return OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), days);
  }

  private isEligible(
    settings: CachedProjectSettings | null,
    _props: DatabaseCommonInteractionProps,
  ): boolean {
    if (!settings) {
      return false;
    }

    if (!settings.enableAuditLogs) {
      return false;
    }

    if (IsEnterpriseEdition) {
      return true;
    }

    if (IsBillingEnabled) {
      return settings.planName === PlanType.Enterprise;
    }

    // Neither enterprise edition nor billing is enabled — audit logs are not
    // available on the free self-hosted build.
    return false;
  }

  private async getProjectSettings(
    projectId: ObjectID,
  ): Promise<CachedProjectSettings | null> {
    const key: string = projectId.toString();
    const now: number = Date.now();
    const cached: CachedProjectSettings | undefined =
      this.projectSettingsCache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        enableAuditLogs: true,
        auditLogsRetentionInDays: true,
        planName: true,
      },
      props: { isRoot: true },
    });

    if (!project) {
      return null;
    }

    const settings: CachedProjectSettings = {
      enableAuditLogs: Boolean(project.enableAuditLogs),
      retentionInDays: project.auditLogsRetentionInDays ?? 7,
      planName: project.planName,
      expiresAt: now + PROJECT_SETTINGS_CACHE_TTL_MS,
    };

    this.projectSettingsCache.set(key, settings);
    return settings;
  }

  private async resolveActor(
    props: DatabaseCommonInteractionProps,
  ): Promise<{
    userId: ObjectID | null;
    userName: string | null;
    userEmail: string | null;
    userType: string | null;
  }> {
    const userType: string | null = props.userType
      ? String(props.userType)
      : props.isRoot
        ? "System"
        : null;

    if (!props.userId) {
      return {
        userId: null,
        userName: null,
        userEmail: null,
        userType,
      };
    }

    // API-key actions don't have a user record to look up.
    if (props.userType === UserType.API) {
      return {
        userId: props.userId,
        userName: null,
        userEmail: null,
        userType,
      };
    }

    const cached: { name: string | null; email: string | null } | null =
      await this.getUserInfo(props.userId);

    return {
      userId: props.userId,
      userName: cached?.name ?? null,
      userEmail: cached?.email ?? null,
      userType,
    };
  }

  private async getUserInfo(
    userId: ObjectID,
  ): Promise<{ name: string | null; email: string | null } | null> {
    const key: string = userId.toString();
    const now: number = Date.now();
    const cached: CachedUser | undefined = this.userCache.get(key);

    if (cached && cached.expiresAt > now) {
      return { name: cached.name, email: cached.email };
    }

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: { _id: true, name: true, email: true },
      props: { isRoot: true },
    });

    const name: string | null = user?.name?.toString() ?? null;
    const email: string | null = user?.email?.toString() ?? null;

    this.userCache.set(key, {
      name,
      email,
      expiresAt: now + USER_CACHE_TTL_MS,
    });

    return { name, email };
  }

  private resolveProjectId<TModel extends BaseModel>(
    model: TModel,
    item: TModel,
    props: DatabaseCommonInteractionProps,
  ): ObjectID | undefined {
    if (props.tenantId) {
      return props.tenantId;
    }

    const tenantColumn: string | null = model.getTenantColumn();
    if (!tenantColumn) {
      return undefined;
    }

    const value: ObjectID | undefined = item.getValue<ObjectID>(tenantColumn);
    return value ?? undefined;
  }

  private getRedactedFields<TModel extends BaseModel>(
    model: TModel,
  ): Set<string> {
    const redacted: Set<string> = new Set<string>();
    const allAccessControl: { [key: string]: { read?: unknown[] } } =
      getColumnAccessControlForAllColumns(model) as {
        [key: string]: { read?: unknown[] };
      };

    for (const key of Object.keys(allAccessControl)) {
      const ac: { read?: unknown[] } | undefined = allAccessControl[key];
      if (ac && Array.isArray(ac.read) && ac.read.length === 0) {
        redacted.add(key);
      }
    }

    return redacted;
  }

  private buildSnapshotChanges<TModel extends BaseModel>(data: {
    model: TModel;
    redactedFields: Set<string>;
    valueKey: "oldValue" | "newValue";
  }): JSONArray {
    const changes: JSONArray = [];
    const columns: Array<string> = data.model.getTableColumns().columns;

    for (const column of columns) {
      if (SKIPPED_FIELDS.has(column)) {
        continue;
      }

      if (data.redactedFields.has(column)) {
        continue;
      }

      const value: unknown = (data.model as unknown as Record<string, unknown>)[
        column
      ];

      if (value === undefined) {
        continue;
      }

      changes.push({
        field: column,
        [data.valueKey]: this.serializeValue(value),
      } as JSONObject);
    }

    return changes;
  }

  private buildUpdateDiff<TModel extends BaseModel>(data: {
    before: TModel;
    updatedFields: JSONObject;
    redactedFields: Set<string>;
  }): JSONArray {
    const changes: JSONArray = [];

    for (const field of Object.keys(data.updatedFields)) {
      if (SKIPPED_FIELDS.has(field)) {
        continue;
      }

      if (data.redactedFields.has(field)) {
        continue;
      }

      const newValue: unknown = data.updatedFields[field];
      const oldValue: unknown = (
        data.before as unknown as Record<string, unknown>
      )[field];

      if (this.areValuesEqual(oldValue, newValue)) {
        continue;
      }

      changes.push({
        field,
        oldValue: this.serializeValue(oldValue),
        newValue: this.serializeValue(newValue),
      } as JSONObject);
    }

    return changes;
  }

  private areValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    if (a === null || a === undefined) {
      return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
      return false;
    }
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  private serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof ObjectID) {
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  private getResourceType<TModel extends BaseModel>(model: TModel): string {
    if (model.singularName) {
      return model.singularName;
    }
    return (model as unknown as object).constructor.name;
  }

  private getResourceName<TModel extends BaseModel>(
    item: TModel,
  ): string | null {
    for (const field of NAME_CANDIDATE_FIELDS) {
      const columns: Array<string> = item.getTableColumns().columns;
      if (!columns.includes(field)) {
        continue;
      }
      const value: unknown = (item as unknown as Record<string, unknown>)[
        field
      ];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return null;
  }
}

export default new AuditLogService();
