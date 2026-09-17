import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import { IsBillingEnabled, IsEnterpriseEdition } from "../EnvironmentConfig";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import logger from "../Utils/Logger";
import AuditLog from "../../Models/AnalyticsModels/AuditLog";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { AuditLogRootResource } from "../../Types/BaseDatabase/EnableAuditLogOn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { getColumnAccessControlForAllColumns } from "../../Types/Database/AccessControl/ColumnAccessControl";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserType from "../../Types/UserType";
import UserService from "./UserService";
import OneUptimeDate from "../../Types/Date";

const PROJECT_SETTINGS_CACHE_TTL_MS: number = 60 * 1000;
const USER_CACHE_TTL_MS: number = 5 * 60 * 1000;

/*
 * Upper bound on the related rows one audit entry looks up to name. An entry
 * that references more is still recorded in full; the rest keep their ids.
 */
const MAX_RELATION_NAME_LOOKUPS: number = 100;

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

type RelatedModelType = { new (): BaseModel };

interface CachedProjectSettings {
  enableAuditLogs: boolean;
  retentionInDays: number;
  storeSystemEventsInAuditLogs: boolean;
  planName: PlanType | undefined;
  expiresAt: number;
}

interface CachedUser {
  name: string | null;
  email: string | null;
  expiresAt: number;
}

interface RootResourcePointer {
  rootResourceType: string | null;
  rootResourceId: ObjectID | null;
}

/*
 * Relation references still waiting for a name, grouped by the model they
 * point at so each model is queried once per entry.
 */
interface PendingRelationNames {
  modelType: RelatedModelType;
  ids: Set<string>;
  references: Array<JSONObject>;
}

export class AuditLogService extends AnalyticsDatabaseService<AuditLog> {
  private projectSettingsCache: Map<string, CachedProjectSettings> = new Map();
  private userCache: Map<string, CachedUser> = new Map();
  private relatedModelServices: Map<
    RelatedModelType,
    DatabaseService<BaseModel>
  > = new Map();

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

      const changes: JSONArray = this.buildSnapshotChanges({
        model: data.model,
        item: data.createdItem,
        valueKey: "newValue",
      });

      await this.addRelationNames({
        model: data.model,
        changes,
        projectId,
      });

      await this.insert({
        projectId,
        model: data.model,
        item: data.createdItem,
        resourceId: data.createdItem.id ?? null,
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
      /*
       * The diff comes first because it needs no I/O: an update that changed
       * nothing the audit trail tracks - an evaluation tick that rewrote only
       * ignored columns, several times an hour per SLO - should not cost a
       * settings lookup.
       */
      const changes: JSONArray = this.buildUpdateDiff({
        model: data.model,
        before: data.before,
        updatedFields: data.updatedFields,
      });

      if (changes.length === 0) {
        return;
      }

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

      await this.addRelationNames({
        model: data.model,
        changes,
        projectId,
      });

      await this.insert({
        projectId,
        model: data.model,
        item: data.before,
        resourceId: data.itemId,
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

      const changes: JSONArray = this.buildSnapshotChanges({
        model: data.model,
        item: data.deletedItem,
        valueKey: "oldValue",
      });

      await this.addRelationNames({
        model: data.model,
        changes,
        projectId,
      });

      await this.insert({
        projectId,
        model: data.model,
        item: data.deletedItem,
        resourceId: data.itemId,
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

  private async insert<TModel extends BaseModel>(params: {
    projectId: ObjectID;
    model: TModel;
    // The row as recorded: the created row, the row before the update, or the deleted row.
    item: TModel;
    resourceId: ObjectID | null;
    action: AuditLogAction;
    changes: JSONArray;
    props: DatabaseCommonInteractionProps;
    retentionInDays: number;
  }): Promise<void> {
    const resourceType: string = this.getResourceType(params.model);

    const resourceName: string | null = await this.resolveResourceName({
      model: params.model,
      item: params.item,
      projectId: params.projectId,
    });

    const rootResource: RootResourcePointer = this.getRootResource({
      model: params.model,
      item: params.item,
      resourceType,
      resourceId: params.resourceId,
    });

    const auditLog: AuditLog = new AuditLog();
    auditLog.projectId = params.projectId;
    auditLog.resourceType = resourceType;
    if (params.resourceId) {
      auditLog.resourceId = params.resourceId;
    }
    if (resourceName) {
      auditLog.resourceName = resourceName;
    }
    if (rootResource.rootResourceType && rootResource.rootResourceId) {
      auditLog.rootResourceType = rootResource.rootResourceType;
      auditLog.rootResourceId = rootResource.rootResourceId;
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
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (!settings) {
      return false;
    }

    if (!settings.enableAuditLogs) {
      return false;
    }

    if (!settings.storeSystemEventsInAuditLogs && this.isSystemEvent(props)) {
      return false;
    }

    if (IsEnterpriseEdition) {
      return true;
    }

    if (IsBillingEnabled) {
      return settings.planName === PlanType.Enterprise;
    }

    /*
     * Neither enterprise edition nor billing is enabled — audit logs are not
     * available on the free self-hosted build.
     */
    return false;
  }

  private isSystemEvent(props: DatabaseCommonInteractionProps): boolean {
    /*
     * A system event is one not initiated by a user — no userType is set and
     * the operation is running with root privileges (e.g. background jobs,
     * internal cleanup tasks).
     */
    return !props.userType && Boolean(props.isRoot);
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
        storeSystemEventsInAuditLogs: true,
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
      storeSystemEventsInAuditLogs: Boolean(
        project.storeSystemEventsInAuditLogs,
      ),
      planName: project.planName,
      expiresAt: now + PROJECT_SETTINGS_CACHE_TTL_MS,
    };

    this.projectSettingsCache.set(key, settings);
    return settings;
  }

  private async resolveActor(props: DatabaseCommonInteractionProps): Promise<{
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

  /*
   * Where this entry rolls up to (see EnableAuditLogOn.rootResource). A
   * top-level resource points at itself; a child points at the parent id it
   * carries in its configured column.
   */
  private getRootResource<TModel extends BaseModel>(data: {
    model: TModel;
    item: TModel;
    resourceType: string;
    resourceId: ObjectID | null;
  }): RootResourcePointer {
    const rootResource: AuditLogRootResource | undefined =
      data.model.enableAuditLogOn?.rootResource;

    if (!rootResource) {
      return {
        rootResourceType: data.resourceType,
        rootResourceId: data.resourceId,
      };
    }

    const rootResourceId: string | null = RelationValueUtil.getRelationId(
      (data.item as unknown as Record<string, unknown>)[rootResource.column],
    );

    if (!rootResourceId) {
      /*
       * A child row that cannot name its parent. Filing it under itself would
       * give it a root type it is not, so it gets no pointer: the entry still
       * shows in the project-wide audit log, just not on a resource's page.
       */
      return { rootResourceType: null, rootResourceId: null };
    }

    return {
      rootResourceType: rootResource.resourceType,
      rootResourceId: new ObjectID(rootResourceId),
    };
  }

  /*
   * Everything an entry leaves out: bookkeeping fields, columns nobody may read
   * (read ACL `[]`, so recording them would leak them to audit readers), and
   * the model's ignored columns.
   */
  private getExcludedFields<TModel extends BaseModel>(
    model: TModel,
  ): Set<string> {
    const excluded: Set<string> = new Set<string>(SKIPPED_FIELDS);

    for (const field of this.getRedactedFields(model)) {
      excluded.add(field);
    }

    for (const field of model.enableAuditLogOn?.ignoreColumns || []) {
      excluded.add(field);
    }

    return excluded;
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
    item: TModel;
    valueKey: "oldValue" | "newValue";
  }): JSONArray {
    const changes: JSONArray = [];
    const excludedFields: Set<string> = this.getExcludedFields(data.model);
    const columns: Array<string> = data.model.getTableColumns().columns;
    const itemRecord: Record<string, unknown> = data.item as unknown as Record<
      string,
      unknown
    >;

    for (const column of columns) {
      if (excludedFields.has(column)) {
        continue;
      }

      const value: unknown = itemRecord[column];

      if (value === undefined) {
        continue;
      }

      changes.push({
        field: column,
        [data.valueKey]: this.serializeValue(data.model, column, value),
      } as JSONObject);
    }

    return changes;
  }

  private buildUpdateDiff<TModel extends BaseModel>(data: {
    model: TModel;
    before: TModel;
    updatedFields: JSONObject;
  }): JSONArray {
    const changes: JSONArray = [];
    const excludedFields: Set<string> = this.getExcludedFields(data.model);
    const beforeRecord: Record<string, unknown> =
      data.before as unknown as Record<string, unknown>;

    for (const field of Object.keys(data.updatedFields)) {
      if (excludedFields.has(field)) {
        continue;
      }

      const newValue: unknown = data.updatedFields[field];
      const oldValue: unknown = beforeRecord[field];

      if (
        this.areValuesEqual({
          model: data.model,
          field,
          oldValue,
          newValue,
        })
      ) {
        continue;
      }

      changes.push({
        field,
        oldValue: this.serializeValue(data.model, field, oldValue),
        newValue: this.serializeValue(data.model, field, newValue),
      } as JSONObject);
    }

    return changes;
  }

  private areValuesEqual<TModel extends BaseModel>(data: {
    model: TModel;
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }): boolean {
    const a: unknown = data.oldValue;
    const b: unknown = data.newValue;

    if (a === b) {
      return true;
    }
    if (a === null || a === undefined) {
      return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
      return false;
    }

    /*
     * A relation is the set of rows it references. Its JSON also carries
     * whatever else happened to be loaded - the before-row's names, the
     * payload's bare ids, the order the join returned - so an unchanged
     * relation would otherwise read as changed.
     */
    if (this.getRelationMetadata(data.model, data.field)) {
      const sameRelationIds: boolean | null =
        RelationValueUtil.haveSameRelationIds(a, b);

      if (sameRelationIds !== null) {
        return sameRelationIds;
      }
    }

    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  // The column's metadata when it is a relation (Entity / EntityArray), else null.
  private getRelationMetadata<TModel extends BaseModel>(
    model: TModel,
    field: string,
  ): TableColumnMetadata | null {
    if (!model.isTableColumn(field)) {
      return null;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(field);

    if (
      !metadata ||
      !metadata.modelType ||
      (metadata.type !== TableColumnType.Entity &&
        metadata.type !== TableColumnType.EntityArray)
    ) {
      return null;
    }

    return metadata;
  }

  private serializeValue<TModel extends BaseModel>(
    model: TModel,
    field: string,
    value: unknown,
  ): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    /*
     * A related row is recorded as `{ _id, name }`. Serialized as it arrives
     * it would be a model instance's JSON: a bare `{ _id }` from a payload, or
     * whatever columns the read happened to load.
     */
    if (this.getRelationMetadata(model, field)) {
      if (Array.isArray(value)) {
        return value.map((element: unknown): unknown => {
          return this.serializeRelationReference(element);
        });
      }

      return this.serializeRelationReference(value);
    }

    return this.serializePlainValue(value);
  }

  private serializeRelationReference(value: unknown): unknown {
    const id: string | null = RelationValueUtil.getRelationId(value);

    // Not a reference at all: record it as it is rather than drop it.
    if (!id) {
      return this.serializePlainValue(value);
    }

    const reference: JSONObject = { _id: id };

    if (value && typeof value === "object") {
      const name: string | null = this.toDisplayString(
        (value as Record<string, unknown>)["name"],
      );

      if (name) {
        reference["name"] = name;
      }
    }

    return reference;
  }

  private serializePlainValue(value: unknown): unknown {
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

  /*
   * Relation references are recorded with names so an entry reads
   * "Production -> Staging" rather than as two ids. An update's before-row
   * already carries the old names (DatabaseService selects them), but a
   * payload usually carries ids only - so an unnamed reference first borrows
   * the name of another reference to the same row in the same change, and
   * whatever is still unnamed is looked up. Best effort: a failed lookup leaves
   * the ids, and never costs the entry.
   */
  private async addRelationNames<TModel extends BaseModel>(data: {
    model: TModel;
    changes: JSONArray;
    projectId: ObjectID;
  }): Promise<void> {
    const pendingByModel: Map<RelatedModelType, PendingRelationNames> =
      new Map();

    for (const change of data.changes) {
      const entry: JSONObject = change as JSONObject;
      const metadata: TableColumnMetadata | null = this.getRelationMetadata(
        data.model,
        String(entry["field"]),
      );

      if (!metadata || !metadata.modelType) {
        continue;
      }

      const references: Array<JSONObject> = [
        ...this.getRelationReferences(entry["oldValue"]),
        ...this.getRelationReferences(entry["newValue"]),
      ];

      const knownNames: Map<string, string> = new Map<string, string>();

      for (const reference of references) {
        const name: unknown = reference["name"];

        if (typeof name === "string" && name.length > 0) {
          knownNames.set(String(reference["_id"]).toLowerCase(), name);
        }
      }

      for (const reference of references) {
        if (reference["name"]) {
          continue;
        }

        const id: string = String(reference["_id"]).toLowerCase();
        const knownName: string | undefined = knownNames.get(id);

        if (knownName) {
          reference["name"] = knownName;
          continue;
        }

        let pending: PendingRelationNames | undefined = pendingByModel.get(
          metadata.modelType,
        );

        if (!pending) {
          pending = {
            modelType: metadata.modelType,
            ids: new Set<string>(),
            references: [],
          };
          pendingByModel.set(metadata.modelType, pending);
        }

        pending.ids.add(id);
        pending.references.push(reference);
      }
    }

    let remainingLookups: number = MAX_RELATION_NAME_LOOKUPS;

    for (const pending of pendingByModel.values()) {
      if (remainingLookups <= 0) {
        break;
      }

      const ids: Array<string> = Array.from(pending.ids).slice(
        0,
        remainingLookups,
      );
      remainingLookups -= ids.length;

      try {
        const names: Map<string, string> = await this.findRelationNames({
          modelType: pending.modelType,
          ids,
          projectId: data.projectId,
        });

        for (const reference of pending.references) {
          const name: string | undefined = names.get(
            String(reference["_id"]).toLowerCase(),
          );

          if (name) {
            reference["name"] = name;
          }
        }
      } catch (err) {
        logger.warn(
          "AuditLog: could not resolve the names of related resources; recording their ids only",
        );
        logger.warn(err);
      }
    }
  }

  private getRelationReferences(value: unknown): Array<JSONObject> {
    const candidates: Array<unknown> = Array.isArray(value) ? value : [value];

    return candidates.filter((candidate: unknown): candidate is JSONObject => {
      return (
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        typeof (candidate as JSONObject)["_id"] === "string"
      );
    });
  }

  /*
   * Display names for related rows, keyed by lower-cased id.
   *
   * A user is named by their name, else their email, through the same cache
   * the actor lookup uses. Any other model is named by its `name` column, and
   * only rows inside the audited project are read: the ids come from the
   * caller's payload, and naming a row that belongs to another project would
   * copy that project's data into this project's audit trail. A model with no
   * tenant column or no name column resolves nothing.
   */
  private async findRelationNames(data: {
    modelType: RelatedModelType;
    ids: Array<string>;
    projectId: ObjectID;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const ids: Array<string> = Array.from(
      new Set<string>(
        data.ids.map((id: string): string => {
          return id.toLowerCase();
        }),
      ),
    );

    if (ids.length === 0) {
      return names;
    }

    const relatedModel: BaseModel = new data.modelType();

    if (relatedModel instanceof User) {
      for (const id of ids) {
        const user: { name: string | null; email: string | null } | null =
          await this.getUserInfo(new ObjectID(id));
        const name: string | null = user?.name || user?.email || null;

        if (name) {
          names.set(id, name);
        }
      }

      return names;
    }

    const tenantColumn: string | null = relatedModel.getTenantColumn();

    if (!tenantColumn || !relatedModel.isTableColumn("name")) {
      return names;
    }

    const rows: Array<BaseModel> = await this.getRelatedModelService(
      data.modelType,
    ).findBy({
      query: {
        _id: QueryHelper.any(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
        [tenantColumn]: data.projectId,
      } as Query<BaseModel>,
      select: { _id: true, name: true } as Select<BaseModel>,
      skip: 0,
      limit: ids.length,
      props: { isRoot: true, ignoreHooks: true },
    });

    for (const row of rows) {
      const name: string | null = this.toDisplayString(
        (row as unknown as Record<string, unknown>)["name"],
      );

      if (row._id && name) {
        names.set(row._id.toString().toLowerCase(), name);
      }
    }

    return names;
  }

  /*
   * A plain DatabaseService reads the related rows: the lookup needs no
   * service hooks (it runs as root with hooks off), and going through a
   * registry of concrete services would import every service into this one.
   */
  private getRelatedModelService(
    modelType: RelatedModelType,
  ): DatabaseService<BaseModel> {
    let service: DatabaseService<BaseModel> | undefined =
      this.relatedModelServices.get(modelType);

    if (!service) {
      service = new DatabaseService<BaseModel>(modelType);
      this.relatedModelServices.set(modelType, service);
    }

    return service;
  }

  private getResourceType<TModel extends BaseModel>(model: TModel): string {
    if (model.singularName) {
      return model.singularName;
    }
    return (model as unknown as { constructor: { name: string } }).constructor
      .name;
  }

  private getResourceName<TModel extends BaseModel>(
    item: TModel,
  ): string | null {
    const itemRecord: Record<string, unknown> = item as unknown as Record<
      string,
      unknown
    >;

    for (const field of NAME_CANDIDATE_FIELDS) {
      if (!item.isTableColumn(field)) {
        continue;
      }

      const name: string | null = this.toDisplayString(itemRecord[field]);

      if (name) {
        return name;
      }
    }

    return null;
  }

  /*
   * The name a row has, or failing that the name of the row its
   * resourceNameRelation points at - an SLO owner row is named after its user
   * or team. Best effort: an entry is never lost for want of a name.
   */
  private async resolveResourceName<TModel extends BaseModel>(data: {
    model: TModel;
    item: TModel;
    projectId: ObjectID;
  }): Promise<string | null> {
    const ownName: string | null = this.getResourceName(data.item);

    if (ownName) {
      return ownName;
    }

    const relation: string | undefined =
      data.model.enableAuditLogOn?.resourceNameRelation;

    if (!relation) {
      return null;
    }

    const metadata: TableColumnMetadata | null = this.getRelationMetadata(
      data.model,
      relation,
    );

    if (
      !metadata ||
      !metadata.modelType ||
      metadata.type !== TableColumnType.Entity ||
      !metadata.manyToOneRelationColumn
    ) {
      return null;
    }

    const relatedId: string | null = RelationValueUtil.getRelationId(
      (data.item as unknown as Record<string, unknown>)[
        metadata.manyToOneRelationColumn
      ],
    );

    if (!relatedId) {
      return null;
    }

    try {
      const names: Map<string, string> = await this.findRelationNames({
        modelType: metadata.modelType,
        ids: [relatedId],
        projectId: data.projectId,
      });

      return names.get(relatedId.toLowerCase()) ?? null;
    } catch (err) {
      logger.warn(
        "AuditLog: could not resolve the resource name; recording the entry without one",
      );
      logger.warn(err);
      return null;
    }
  }

  /*
   * A non-empty display string for a stored value: a string as it is, and a
   * value object (Name, Email) through its own toString. Anything else - a
   * plain object stringifying to "[object Object]" - is not a name.
   */
  private toDisplayString(value: unknown): string | null {
    if (typeof value === "string") {
      return value.trim().length > 0 ? value : null;
    }

    if (value instanceof ObjectID || value === null || value === undefined) {
      return null;
    }

    if (typeof value === "object") {
      const text: string = String(value);
      return text.trim().length > 0 && text !== "[object Object]" ? text : null;
    }

    return null;
  }
}

export default new AuditLogService();
