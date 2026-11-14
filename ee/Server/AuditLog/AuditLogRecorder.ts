import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { AuditLogRecorder as AuditLogRecorderContract } from "Common/Server/Enterprise/EnterpriseServerModule";
/*
 * IsBillingEnabled is read inside function bodies only: the compiled CommonJS
 * reads the live module binding at call time, which is what lets a test pin
 * billing by mocking EnvironmentConfig.
 */
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import {
  AuditLogColumnSummarizer,
  AuditLogValueSummary,
  getAuditLogColumnSummarizer,
} from "Common/Server/Utils/AuditLog/AuditLogColumnSummaries";
import { getAuditLogResourceName } from "Common/Server/Utils/AuditLog/AuditLogResourceNames";
import ColumnValueChange from "Common/Server/Utils/Database/ColumnValueChange";
import RelationValueUtil from "Common/Server/Utils/Database/RelationValueUtil";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SESSION_RESOURCE_TYPE,
  AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE,
  isSessionAuditLogAction,
  SessionAuditEvent,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import {
  AUDIT_LOG_SECRET_COLUMNS,
  looksLikeSecretColumn,
} from "Common/Types/AuditLog/AuditLogCoverage";
import {
  getAuditLogRedactedColumns,
  redactAuditLogValue,
} from "Common/Types/AuditLog/AuditLogRedaction";
import {
  getAuditLogRetentionDate,
  readAuditLogRetentionInDays,
} from "Common/Types/AuditLog/AuditLogRetention";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { AuditLogRootResource } from "Common/Types/BaseDatabase/EnableAuditLogOn";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { getColumnAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnAccessControl";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import OneUptimeDate from "Common/Types/Date";
import {
  describeLargeJson,
  getJsonChangeLines,
  getJsonLength,
  isJsonStructure,
  isLargeJson,
  limitChangedText,
  limitText,
  redactSecretsInJson,
} from "Common/Utils/AuditLog/AuditLogValues";
import {
  getAuditLogHeldValue,
  readAuditLogValue,
} from "Common/Utils/AuditLog/AuditLogTypedValues";
import {
  getSessionEntryChanges,
  getSessionEntryResourceName,
} from "./AuditLogSessionEntries";

/*
 * The recording half of the audit log (OneUptime Enterprise).
 *
 * Core's AuditLogService keeps recordCreate / recordUpdate / recordDelete /
 * invalidateProjectSettings as thin delegates to the recorder the enterprise
 * module hands the EnterpriseEdition facade, so DatabaseService, ProjectService
 * and the user-notification services call exactly what they always called. On
 * the Community Edition there is no recorder and nothing is recorded.
 *
 * Everything below decides whether a change is recorded and what the entry
 * says. Every failure mode is silent - a record* call swallows its errors, and
 * an empty audit page looks exactly like "nobody changed anything" - so each
 * rule is pinned by ee/Tests/Server/AuditLog/AuditLogRecorder.test.ts against
 * the entry that actually reaches the insert.
 *
 * ELIGIBILITY (see isEditionEligible):
 *   - OneUptime Cloud (billing on): the project's plan must be Enterprise.
 *     Checked on its own and before anything about the edition: the Cloud runs
 *     the Enterprise image, so "the Enterprise Edition is loaded" is always true
 *     there and would otherwise record for every plan.
 *   - Self-hosted: audit logging must be ACTIVE
 *     (EnterpriseEdition.isFeatureActive(AuditLogs)): the Enterprise Edition
 *     is loaded and the license covers audit logs (valid, in grace, or inside
 *     the 14-day trial). While the license is lapsed nothing is recorded, as
 *     on the Community Edition; recording resumes, without a restart, as soon
 *     as a license is activated. An unknown license state counts as active,
 *     so a license read error never drops entries.
 *   - Then, everywhere, the project's own settings: audit logging switched on,
 *     and system events only when the project stores them. The change that
 *     switches audit logging on or off is itself always recorded
 *     (withAuditSwitchRecorded): who turned the audit log off is the one
 *     entry an audit log must never lose.
 *
 * WHAT AN ENTRY SAYS OF A VALUE (shapeSnapshotValue / shapeUpdateChange):
 *   - a typed value - a phone number, an email address, a URL, a port - is
 *     what people read, "+14155550100", as an id and a time are, never the
 *     { _type, value } JSON it is written as; a hash is "[REDACTED]"
 *     (Common/Utils/AuditLog/AuditLogTypedValues);
 *   - a column described rather than copied - a workflow's graph - is the
 *     lines of what changed, with the values before and after in a few words
 *     (Common/Server/Utils/AuditLog/AuditLogColumnSummaries); a save that
 *     changes nothing a workflow does (a card moved) is no change at all;
 *   - JSON has every value under a secret-looking key redacted, comes with
 *     the paths that changed, and is recorded by its size when it is large;
 *   - long text keeps the part around the first difference
 *     (Common/Utils/AuditLog/AuditLogValues).
 *
 * PEOPLE'S SESSIONS (recordSessionEvents, issue #6762): a sign-in, a
 * sign-out, a session timed out or revoked - filed in every project the
 * person is a member of that records audit logs, as theirs, whether or not
 * the project stores system events (AuditLogSessionEntries says what each
 * entry holds).
 *
 * WHAT A WRITE ROUND THE HOOKS RECORDS (recordUpdate's includeColumns): a
 * write OneUptime makes for a person outside DatabaseService - a merge of
 * exceptions, a webhook URL reset - records the change itself, and names
 * the columns that say what the person did. They are recorded although the
 * model's configuration leaves them out as OneUptime's own bookkeeping, on
 * that entry only; one nobody may read, or a secret, as changed and never
 * with its value. The row's id and timestamps are never recorded.
 */

/*
 * Where an entry is written: core's AuditLog analytics service by default.
 * Session events write in batches through createMany when the store has it.
 */
export type AuditLogStore = Pick<AnalyticsDatabaseService<AuditLog>, "create"> &
  Partial<Pick<AnalyticsDatabaseService<AuditLog>, "createMany">>;

export interface AuditLogRecorderOptions {
  // Defaults to core's AuditLogService instance, read when an entry is written.
  store?: AuditLogStore | undefined;
}

const PROJECT_SETTINGS_CACHE_TTL_MS: number = 60 * 1000;
const USER_CACHE_TTL_MS: number = 5 * 60 * 1000;

/*
 * Upper bound on the related rows one audit entry looks up to name. An entry
 * that references more is still recorded in full; the rest keep their ids.
 */
const MAX_RELATION_NAME_LOOKUPS: number = 100;

/*
 * How many people's project memberships one query reads, and how many pages
 * of them at most: a sweep ends sessions of up to 500 people at a time.
 */
const MEMBERSHIP_LOOKUP_USERS_PER_QUERY: number = 50;
const MAX_MEMBERSHIP_LOOKUP_PAGES: number = 20;

// How many session entries one insert writes.
const MAX_ENTRIES_PER_INSERT: number = 1000;

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

export default class AuditLogRecorder implements AuditLogRecorderContract {
  private projectSettingsCache: Map<string, CachedProjectSettings> = new Map();
  private userCache: Map<string, CachedUser> = new Map();
  private relatedModelServices: Map<
    RelatedModelType,
    DatabaseService<BaseModel>
  > = new Map();
  private store: AuditLogStore | undefined;

  public constructor(options?: AuditLogRecorderOptions | undefined) {
    this.store = options?.store;
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
    includeColumns?: Array<string> | undefined;
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
        includeColumns: data.includeColumns,
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

      if (
        !this.isEligible(
          this.withAuditSwitchRecorded({
            settings,
            model: data.model,
            changes,
          }),
          data.props,
        )
      ) {
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

  /*
   * A download of a record's file. Nothing changed, so there is no diff: the
   * entry's fields are the columns the route read to say what was
   * downloaded (a capture's interface, filter, probe, packets and size), and
   * its actor is whoever downloaded it - eligible exactly as a change of the
   * same record would be.
   */
  public async recordDownload<TModel extends BaseModel>(data: {
    model: TModel;
    downloadedItem: TModel;
    itemId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      const projectId: ObjectID | undefined = this.resolveProjectId(
        data.model,
        data.downloadedItem,
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
        item: data.downloadedItem,
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
        item: data.downloadedItem,
        resourceId: data.itemId,
        action: AuditLogAction.Download,
        changes,
        props: data.props,
        retentionInDays: settings!.retentionInDays,
      });
    } catch (err) {
      logger.warn("AuditLog: failed to record download event");
      logger.warn(err);
    }
  }

  /*
   * PEOPLE'S SESSIONS (issue #6762): who signed in, how and from where, and
   * how each session ended (Common/Types/AuditLog/AuditLogSessionEvent).
   *
   * A sign-in is to OneUptime, so each event is filed in every project its
   * person is a member of - they accepted an invitation to one of its teams
   * - and that records audit logs: eligible as any entry is (the plan or the
   * license, and the project's switch), and recorded whether or not the
   * project stores system events. A session is its person's, whoever or
   * whatever ended it, so its entries are theirs: the actor is the person,
   * and filtering by their email finds every one.
   *
   * The entry is about the session: a User Session, by its id - which its
   * sign-in and its end share - named by the device it signed in from, and
   * rolling up to its person (User, by their id). What else it says is
   * AuditLogSessionEntries'.
   *
   * Events come several at once from a revocation or a sweep that ends many
   * sessions: their people's projects are read together, each project's
   * settings once (the same cache every entry reads), and the entries
   * written in batches.
   */
  public async recordSessionEvents(
    events: Array<SessionAuditEvent>,
  ): Promise<void> {
    try {
      const recordable: Array<SessionAuditEvent> = (events || []).filter(
        (event: SessionAuditEvent): boolean => {
          return Boolean(
            event &&
              event.userId &&
              event.sessionId &&
              isSessionAuditLogAction(event.action),
          );
        },
      );

      if (recordable.length === 0) {
        return;
      }

      const projectIdsByUser: Map<
        string,
        Array<ObjectID>
      > = await this.getMemberProjectIds(
        recordable.map((event: SessionAuditEvent): ObjectID => {
          return event.userId;
        }),
      );

      const entries: Array<AuditLog> = [];

      for (const event of recordable) {
        const projectIds: Array<ObjectID> =
          projectIdsByUser.get(event.userId.toString().toLowerCase()) || [];

        if (projectIds.length === 0) {
          continue;
        }

        let person: { name: string | null; email: string | null } | null = null;

        for (const projectId of projectIds) {
          const settings: CachedProjectSettings | null =
            await this.getProjectSettings(projectId);

          if (!this.isSessionEventEligible(settings)) {
            continue;
          }

          if (!person) {
            person = await this.getUserInfo(event.userId);
          }

          entries.push(
            this.buildSessionEntry({
              event,
              projectId,
              person,
              retentionInDays: settings!.retentionInDays,
            }),
          );
        }
      }

      await this.insertMany(entries);
    } catch (err) {
      logger.warn("AuditLog: failed to record session events");
      logger.warn(err);
    }
  }

  /*
   * Whether a project records session events: eligible as for any entry
   * (the plan or the license, and its switch), with no question of system
   * events - a session is always its person's.
   */
  private isSessionEventEligible(
    settings: CachedProjectSettings | null,
  ): boolean {
    if (!settings) {
      return false;
    }

    if (!this.isEditionEligible(settings)) {
      return false;
    }

    return settings.enableAuditLogs;
  }

  /*
   * The projects each person is a member of - an accepted invitation to one
   * of its teams - by user id, lowercased. Read in groups of people, a page
   * at a time, so a sweep that ends sessions of hundreds of people reads
   * them in a few queries.
   */
  private async getMemberProjectIds(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, Array<ObjectID>>> {
    const projectIdsByUser: Map<string, Map<string, ObjectID>> = new Map();

    const uniqueUserIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const userId of userIds) {
      const key: string = userId.toString().toLowerCase();

      if (!seen.has(key)) {
        seen.add(key);
        uniqueUserIds.push(userId);
      }
    }

    for (
      let start: number = 0;
      start < uniqueUserIds.length;
      start += MEMBERSHIP_LOOKUP_USERS_PER_QUERY
    ) {
      const chunk: Array<ObjectID> = uniqueUserIds.slice(
        start,
        start + MEMBERSHIP_LOOKUP_USERS_PER_QUERY,
      );

      for (let page: number = 0; page < MAX_MEMBERSHIP_LOOKUP_PAGES; page++) {
        const members: Array<TeamMember> = await TeamMemberService.findBy({
          query: {
            userId: QueryHelper.any(chunk),
            hasAcceptedInvitation: true,
          } as Query<TeamMember>,
          select: {
            _id: true,
            userId: true,
            projectId: true,
          },
          limit: LIMIT_MAX,
          skip: page * LIMIT_MAX,
          props: { isRoot: true },
        });

        for (const member of members) {
          if (!member.userId || !member.projectId) {
            continue;
          }

          const userKey: string = member.userId.toString().toLowerCase();
          let projects: Map<string, ObjectID> | undefined =
            projectIdsByUser.get(userKey);

          if (!projects) {
            projects = new Map<string, ObjectID>();
            projectIdsByUser.set(userKey, projects);
          }

          projects.set(
            member.projectId.toString().toLowerCase(),
            member.projectId,
          );
        }

        if (members.length < LIMIT_MAX) {
          break;
        }
      }
    }

    const result: Map<string, Array<ObjectID>> = new Map();

    for (const [userKey, projects] of projectIdsByUser) {
      result.set(userKey, Array.from(projects.values()));
    }

    return result;
  }

  // One project's entry about a session event.
  private buildSessionEntry(data: {
    event: SessionAuditEvent;
    projectId: ObjectID;
    person: { name: string | null; email: string | null } | null;
    retentionInDays: number;
  }): AuditLog {
    const auditLog: AuditLog = new AuditLog();

    auditLog.projectId = data.projectId;
    auditLog.resourceType = AUDIT_LOG_SESSION_RESOURCE_TYPE;
    auditLog.resourceId = data.event.sessionId;
    auditLog.resourceName = getSessionEntryResourceName(data.event);
    auditLog.rootResourceType = AUDIT_LOG_SESSION_ROOT_RESOURCE_TYPE;
    auditLog.rootResourceId = data.event.userId;
    auditLog.action = data.event.action;

    // The person whose session it is.
    auditLog.userId = data.event.userId;
    auditLog.userType = UserType.User;

    if (data.person?.name) {
      auditLog.userName = data.person.name;
    }

    if (data.person?.email) {
      auditLog.userEmail = data.person.email;
    }

    auditLog.changes = getSessionEntryChanges({
      event: data.event,
      projectId: data.projectId,
    });
    auditLog.retentionDate = this.computeRetentionDate(data.retentionInDays);

    return auditLog;
  }

  /*
   * Writes entries, as root, in batches: through the store's createMany when
   * it has one (core's AuditLogService does), one by one otherwise.
   */
  private async insertMany(entries: Array<AuditLog>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const store: AuditLogStore = this.getStore();

    for (
      let start: number = 0;
      start < entries.length;
      start += MAX_ENTRIES_PER_INSERT
    ) {
      const batch: Array<AuditLog> = entries.slice(
        start,
        start + MAX_ENTRIES_PER_INSERT,
      );

      if (store.createMany) {
        await store.createMany({ items: batch, props: { isRoot: true } });
        continue;
      }

      for (const entry of batch) {
        await store.create({ data: entry, props: { isRoot: true } });
      }
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

    /*
     * WHICH credential made the change. The columns have been on the model
     * from the start, and the audit table has always shown `apiKeyName` -
     * but nothing put a key's identity on the request, so every key's changes
     * read alike ("API Key"), and a project with several keys could not tell
     * whose change it was looking at. The middleware now carries the id and
     * name through (ProjectMiddleware), and so does the MCP server for a
     * client that signed in with OAuth (McpDelegationAuthorization): that
     * entry names the member as its actor, and the client it came through.
     */
    if (params.props.apiKeyId) {
      auditLog.apiKeyId = params.props.apiKeyId;
    }
    if (params.props.apiKeyName) {
      auditLog.apiKeyName = params.props.apiKeyName;
    }
    if (params.props.mcpOAuthGrantId) {
      auditLog.mcpOAuthGrantId = params.props.mcpOAuthGrantId;
    }
    if (params.props.mcpClientName) {
      auditLog.mcpClientName = params.props.mcpClientName;
    }

    /*
     * WHICH workflow made the change. A workflow step acts as no person
     * (WorkflowPrincipal): the entry's actor is "Workflow", and these name
     * which one it was.
     */
    if (params.props.workflowId) {
      auditLog.workflowId = params.props.workflowId;
    }
    if (params.props.workflowName) {
      auditLog.workflowName = params.props.workflowName;
    }

    auditLog.changes = params.changes;
    auditLog.retentionDate = this.computeRetentionDate(params.retentionInDays);

    await this.getStore().create({
      data: auditLog,
      props: { isRoot: true },
    });
  }

  private getStore(): AuditLogStore {
    return this.store || CoreAuditLogService;
  }

  /*
   * When the entry recorded now is deleted: the project's retention in
   * calendar days, read by the one rule
   * (Common/Types/AuditLog/AuditLogRetention). A failing export reads this
   * stamp back - the soonest among the entries it has not sent - so its
   * "will start losing entries" email goes a day before this moment,
   * whatever the stored value and whatever the retention is changed to
   * later (#6563); only when it cannot read the stamps does it reckon the
   * moment by the same rule.
   */
  private computeRetentionDate(retentionInDays: number): Date {
    return getAuditLogRetentionDate({
      recordedAt: OneUptimeDate.getCurrentDate(),
      retentionInDays,
    });
  }

  private isEligible(
    settings: CachedProjectSettings | null,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (!settings) {
      return false;
    }

    if (!this.isEditionEligible(settings)) {
      return false;
    }

    if (!settings.enableAuditLogs) {
      return false;
    }

    if (!settings.storeSystemEventsInAuditLogs && this.isSystemEvent(props)) {
      return false;
    }

    return true;
  }

  /*
   * Whether this deployment records audit logs for this project at all.
   *
   * Billing is checked FIRST, and on its own. The Cloud runs the Enterprise
   * image, so asking about the edition first (as the pre-split code asked
   * about IS_ENTERPRISE_EDITION) recorded for every plan there, Growth and
   * Scale included.
   *
   * Self-hosted, audit logging must be active right now: the Enterprise
   * Edition loaded (which it always is when this recorder is reached through
   * core's AuditLogService; the check also keeps a recorder that was never
   * registered from writing anything) and a license that covers audit logs.
   * Asked per entry, so a lapse stops recording and a renewal resumes it at
   * once (see the file header).
   */
  private isEditionEligible(settings: CachedProjectSettings): boolean {
    if (IsBillingEnabled) {
      return settings.planName === PlanType.Enterprise;
    }

    return EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
  }

  /*
   * The project's settings as the entry for this change reads them. The
   * change that turns audit logging on or off is recorded either way: on its
   * way off it is the last entry the project gets, and on its way on the
   * first - and the settings read here may already say either, depending on
   * whether they were cached before the write. Everything else about
   * eligibility (the plan, the license, system events) still applies.
   */
  private withAuditSwitchRecorded<TModel extends BaseModel>(data: {
    settings: CachedProjectSettings | null;
    model: TModel;
    changes: JSONArray;
  }): CachedProjectSettings | null {
    if (!data.settings || data.model.tableName !== "Project") {
      return data.settings;
    }

    const turnsTheSwitch: boolean = data.changes.some(
      (change: unknown): boolean => {
        return (change as JSONObject)["field"] === "enableAuditLogs";
      },
    );

    return turnsTheSwitch
      ? { ...data.settings, enableAuditLogs: true }
      : data.settings;
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
      retentionInDays: readAuditLogRetentionInDays(
        project.auditLogsRetentionInDays,
      ),
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
   * the model's ignored columns - but for the columns a write round the hooks
   * names as what a person did (`included`, see getIncludedColumns).
   */
  private getExcludedFields<TModel extends BaseModel>(
    model: TModel,
    included: ReadonlySet<string> = new Set<string>(),
  ): Set<string> {
    const excluded: Set<string> = new Set<string>(SKIPPED_FIELDS);

    for (const field of this.getRedactedFields(model)) {
      if (!included.has(field)) {
        excluded.add(field);
      }
    }

    for (const field of model.enableAuditLogOn?.ignoreColumns || []) {
      if (!included.has(field)) {
        excluded.add(field);
      }
    }

    return excluded;
  }

  /*
   * The included columns whose values an entry never carries: one nobody
   * may read (a runbook's webhook key), and one holding a secret by the
   * rules the defaults redact by - its type or its name says so, or
   * AUDIT_LOG_SECRET_COLUMNS lists it. The defaults leave a secret only
   * OneUptime writes out of entries (a data product's badge token), so they
   * never list it to redact; included, it is redacted here. Each is recorded
   * as changed - who reset it, and when - never with its value.
   */
  private getIncludedSecrets<TModel extends BaseModel>(
    model: TModel,
    included: ReadonlySet<string>,
  ): Set<string> {
    const secrets: Set<string> = new Set<string>();

    if (included.size === 0) {
      return secrets;
    }

    const unreadable: Set<string> = this.getRedactedFields(model);
    const listed: ReadonlyArray<string> =
      (model.tableName &&
      Object.prototype.hasOwnProperty.call(
        AUDIT_LOG_SECRET_COLUMNS,
        model.tableName,
      )
        ? AUDIT_LOG_SECRET_COLUMNS[model.tableName]
        : undefined) || [];

    for (const column of included) {
      if (
        unreadable.has(column) ||
        listed.includes(column) ||
        looksLikeSecretColumn(
          column,
          model.getTableColumnMetadata(column)?.type,
        )
      ) {
        secrets.add(column);
      }
    }

    return secrets;
  }

  /*
   * The columns of `includeColumns` that are the model's own. Its id,
   * timestamps and version stay out of every entry whoever names them
   * (SKIPPED_FIELDS, which getExcludedFields always leaves out).
   */
  private getIncludedColumns<TModel extends BaseModel>(
    model: TModel,
    includeColumns: Array<string> | undefined,
  ): Set<string> {
    const included: Set<string> = new Set<string>();

    for (const column of includeColumns || []) {
      if (typeof column === "string" && model.isTableColumn(column)) {
        included.add(column);
      }
    }

    return included;
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
    const redactedFields: Set<string> = getAuditLogRedactedColumns(data.model);
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

      // A secret is recorded as set, never with its value (AuditLogRedaction).
      if (redactedFields.has(column)) {
        changes.push({
          field: column,
          [data.valueKey]: redactAuditLogValue(value),
        } as JSONObject);
        continue;
      }

      const summarizer: AuditLogColumnSummarizer | null =
        getAuditLogColumnSummarizer(data.model.tableName, column);

      if (summarizer) {
        const described: { value: JSONValue; summary: Array<string> } =
          summarizer.summarizeSnapshot(value);

        changes.push({
          field: column,
          [data.valueKey]: described.value,
          summary: described.summary,
        } as JSONObject);
        continue;
      }

      const serialized: unknown = this.serializeValue(
        data.model,
        column,
        value,
      );

      changes.push({
        field: column,
        [data.valueKey]: this.getRelationMetadata(data.model, column)
          ? serialized
          : this.shapeSnapshotValue(serialized),
      } as JSONObject);
    }

    return changes;
  }

  /*
   * A value of a created or deleted record as its entry keeps it: JSON with
   * its secrets redacted, or by its size when it is too large to read; text
   * up to the limit.
   */
  private shapeSnapshotValue(value: unknown): unknown {
    if (typeof value === "string") {
      return limitText(value);
    }

    if (!isJsonStructure(value)) {
      return value;
    }

    if (isLargeJson(value)) {
      return describeLargeJson(getJsonLength(value));
    }

    return redactSecretsInJson(value);
  }

  /*
   * One changed field as its entry keeps it. JSON comes with the paths that
   * changed (keys named, values never quoted), its secrets redacted, and is
   * recorded by its size when either side is too large to read; two texts
   * keep the part around where they first differ.
   */
  private shapeUpdateChange(data: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }): JSONObject {
    const { field, oldValue, newValue } = data;

    if (isJsonStructure(oldValue) || isJsonStructure(newValue)) {
      const summary: Array<string> = getJsonChangeLines({
        before: oldValue,
        after: newValue,
      });
      const isLarge: boolean = isLargeJson(oldValue) || isLargeJson(newValue);

      const shapeSide: (value: unknown) => unknown = (
        value: unknown,
      ): unknown => {
        if (value === null || value === undefined) {
          return null;
        }

        if (!isJsonStructure(value)) {
          return typeof value === "string" ? limitText(value) : value;
        }

        return isLarge
          ? describeLargeJson(getJsonLength(value))
          : redactSecretsInJson(value);
      };

      const change: JSONObject = {
        field,
        oldValue: shapeSide(oldValue) as JSONValue,
        newValue: shapeSide(newValue) as JSONValue,
      };

      if (summary.length > 0) {
        change["summary"] = summary;
      }

      return change;
    }

    if (typeof oldValue === "string" || typeof newValue === "string") {
      const limited: { before: string; after: string } = limitChangedText({
        before: typeof oldValue === "string" ? oldValue : "",
        after: typeof newValue === "string" ? newValue : "",
      });

      return {
        field,
        oldValue:
          typeof oldValue === "string"
            ? limited.before
            : (oldValue as JSONValue),
        newValue:
          typeof newValue === "string"
            ? limited.after
            : (newValue as JSONValue),
      };
    }

    return {
      field,
      oldValue: oldValue as JSONValue,
      newValue: newValue as JSONValue,
    };
  }

  private buildUpdateDiff<TModel extends BaseModel>(data: {
    model: TModel;
    before: TModel;
    updatedFields: JSONObject;
    includeColumns?: Array<string> | undefined;
  }): JSONArray {
    const changes: JSONArray = [];
    const included: Set<string> = this.getIncludedColumns(
      data.model,
      data.includeColumns,
    );
    const excludedFields: Set<string> = this.getExcludedFields(
      data.model,
      included,
    );
    const redactedFields: Set<string> = getAuditLogRedactedColumns(data.model);

    for (const field of this.getIncludedSecrets(data.model, included)) {
      redactedFields.add(field);
    }
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

      /*
       * A secret that changed is recorded as changed - by whom, when -
       * without either value (AuditLogRedaction).
       */
      if (redactedFields.has(field)) {
        changes.push({
          field,
          oldValue: redactAuditLogValue(oldValue),
          newValue: redactAuditLogValue(newValue),
        } as JSONObject);
        continue;
      }

      const summarizer: AuditLogColumnSummarizer | null =
        getAuditLogColumnSummarizer(data.model.tableName, field);

      if (summarizer) {
        const described: AuditLogValueSummary | null =
          summarizer.summarizeUpdate(oldValue, newValue);

        // The two do the same thing (a workflow's cards moved): no change.
        if (!described) {
          continue;
        }

        changes.push({
          field,
          oldValue: described.oldValue ?? null,
          newValue: described.newValue ?? null,
          summary: described.summary,
        } as JSONObject);
        continue;
      }

      const serializedOld: unknown = this.serializeValue(
        data.model,
        field,
        oldValue,
      );
      const serializedNew: unknown = this.serializeValue(
        data.model,
        field,
        newValue,
      );

      if (this.getRelationMetadata(data.model, field)) {
        changes.push({
          field,
          oldValue: serializedOld,
          newValue: serializedNew,
        } as JSONObject);
        continue;
      }

      changes.push(
        this.shapeUpdateChange({
          field,
          oldValue: serializedOld,
          newValue: serializedNew,
        }),
      );
    }

    return changes;
  }

  /*
   * Whether a field holds after the write what it held before, by the one
   * rule DatabaseService decides whether a write changed a row at all
   * (ColumnValueChange), so an entry names only the fields that really
   * changed: a switch written back as it stood - false over false, or the
   * text "false" over false - a time written as the same instant in another
   * format, a number written as its text, JSON with its keys in another
   * order, and a relation naming the same rows (whatever else the
   * before-row's join or the payload carried with them) are all the same
   * value. A field the write sends as undefined writes nothing.
   *
   * A typed value is compared as what it holds (getAuditLogHeldValue): a
   * Phone written back as its { _type, value } JSON or its text is the same
   * number, as an entry would read it, and two different numbers in the
   * same shape are two numbers. A hash is compared by its hash, so a
   * changed secret is still a change. A relation is compared as it is.
   */
  private areValuesEqual<TModel extends BaseModel>(data: {
    model: TModel;
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }): boolean {
    // A field that is not a column has none: compared as of no known type.
    const metadata: TableColumnMetadata | undefined =
      data.model.getTableColumnMetadata(data.field);
    const isRelation: boolean =
      metadata?.type === TableColumnType.Entity ||
      metadata?.type === TableColumnType.EntityArray;

    return !ColumnValueChange.isChanged({
      columnType: metadata?.type,
      storedValue: isRelation
        ? data.oldValue
        : getAuditLogHeldValue(data.oldValue),
      writtenValue: isRelation
        ? data.newValue
        : getAuditLogHeldValue(data.newValue),
    });
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

    let json: unknown;

    try {
      json = JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }

    /*
     * A typed value - a Phone, an Email, a URL - is written as
     * { _type, value }: it is recorded as what it holds, "+14155550100", as
     * an id and a time are above (AuditLogTypedValues).
     */
    return readAuditLogValue(json);
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

  /*
   * The type an entry is stored under: the model's name as the API keeps it
   * (apiSingularName, Common/Utils/ModelApiName), so a model renamed on
   * screen keeps one type across its old entries and its new ones.
   */
  private getResourceType<TModel extends BaseModel>(model: TModel): string {
    const storedName: string | null =
      model.apiSingularName || model.singularName;

    if (storedName) {
      return storedName;
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
    /*
     * A name nobody may read does not name the entry either: the entry is
     * read by people who may not read the row, and its name would be the
     * one field of it they could.
     */
    const unreadable: Set<string> = this.getRedactedFields(item);

    for (const field of NAME_CANDIDATE_FIELDS) {
      if (!item.isTableColumn(field) || unreadable.has(field)) {
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

    const columnsName: string | null =
      await this.getResourceNameFromColumns(data);

    if (columnsName) {
      return columnsName;
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
   * The name of a row with no name of its own, from the columns that name it
   * (EnableAuditLogOn.resourceNameColumns): an exception by its type and the
   * start of its message, a run by its runbook (AuditLogResourceNames). A
   * column nobody may read names nothing, as everywhere else. A write round
   * the hooks hands the recorder a row with only its id and project - an
   * exception merged - so a column the row does not carry is read, inside
   * the row's project. Best effort: an entry is never lost for want of a
   * name.
   */
  private async getResourceNameFromColumns<TModel extends BaseModel>(data: {
    model: TModel;
    item: TModel;
    projectId: ObjectID;
  }): Promise<string | null> {
    const unreadable: Set<string> = this.getRedactedFields(data.model);
    const columns: Array<string> = (
      data.model.enableAuditLogOn?.resourceNameColumns || []
    ).filter((column: string): boolean => {
      return data.model.isTableColumn(column) && !unreadable.has(column);
    });

    if (columns.length === 0) {
      return null;
    }

    const values: Record<string, unknown> = {};
    const itemRecord: Record<string, unknown> = data.item as unknown as Record<
      string,
      unknown
    >;

    for (const column of columns) {
      values[column] = itemRecord[column];
    }

    const tenantColumn: string | null = data.model.getTenantColumn();

    if (
      data.item.id &&
      tenantColumn &&
      columns.some((column: string): boolean => {
        return values[column] === undefined;
      })
    ) {
      try {
        const select: Record<string, boolean> = { _id: true };

        for (const column of columns) {
          select[column] = true;
        }

        const row: BaseModel | null = await this.getRelatedModelService(
          (data.model as unknown as { constructor: RelatedModelType })
            .constructor,
        ).findOneBy({
          query: {
            _id: data.item.id,
            [tenantColumn]: data.projectId,
          } as Query<BaseModel>,
          select: select as Select<BaseModel>,
          props: { isRoot: true, ignoreHooks: true },
        });

        for (const column of columns) {
          if (values[column] === undefined && row) {
            values[column] = (row as unknown as Record<string, unknown>)[
              column
            ];
          }
        }
      } catch (err) {
        logger.warn(
          "AuditLog: could not read what names the resource; recording the entry without a name",
        );
        logger.warn(err);
      }
    }

    return getAuditLogResourceName({
      tableName: data.model.tableName,
      columns,
      values,
    });
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
