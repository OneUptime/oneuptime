import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/TelemetryException";
import ServiceType from "../../Types/Telemetry/ServiceType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import CodeTaskAccess from "../Utils/AI/CodeTask/CodeTaskAccess";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunStatus, { AIRunStatusHelper } from "../../Types/AI/AIRunStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AIRunService from "./AIRunService";
import FixRunBudget from "../Utils/AI/CodeFix/FixRunBudget";
import AIService from "./AIService";
import CodeFixReadiness from "../Utils/AI/CodeFix/CodeFixReadiness";
import ServiceService from "./ServiceService";
import CodeRepositoryService from "./CodeRepositoryService";
import { RepoResolution } from "../Utils/CodeRepository/StackTraceRepoResolver";
import { CodeRepositoryAllowance } from "../../Types/CodeRepository/CodeRepositoryAllowance";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../Types/AI/AIFixReadiness";
import TelemetryService from "../../Models/DatabaseModels/Service";
import QueryHelper from "../Types/Database/QueryHelper";
import ModelPermission from "../Types/Database/Permissions/Index";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import Includes from "../../Types/BaseDatabase/Includes";
import logger from "../Utils/Logger";
import AIAgentTaskPullRequest from "../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIAgentTaskPullRequestService from "./AIAgentTaskPullRequestService";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import { normalizeExceptionText } from "../Utils/Telemetry/ExceptionSanitizer";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Utils/Telemetry/TelemetryReadScope";
import { Raw, SelectQueryBuilder } from "typeorm";
import ReadPermission from "../Types/Database/Permissions/ReadPermission";
import AnalyticsModelPermission from "../Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import QueryUtil from "../Types/Database/QueryUtil";
import UpdateBy from "../Types/Database/UpdateBy";
import PerProjectReadScope from "../Utils/Telemetry/PerProjectReadScope";
import { combineWithPrivacyClause } from "../Utils/PrivacyFilterUtil";
import HeldPermissionsUtil from "../../Types/HeldPermissions";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import {
  applyAssignmentChange,
  applyManualResolutionChange,
} from "../../Utils/Exceptions/ExceptionIssueState";
import {
  ExceptionActivityChange,
  ExceptionActivityState,
  getExceptionActivityChanges,
  isExceptionActivityWrite,
  readId,
} from "../../Utils/Exceptions/ExceptionActivity";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityEntry,
} from "./TelemetryExceptionActivityService";

/*
 * Hard cap on the fingerprint NOT IN list handed to the ClickHouse count
 * query. ClickHouse receives query params via the request URI (default
 * http_max_uri_size 1 MiB ≈ 14k sha256 fingerprints); 5k keeps a wide
 * safety margin while covering all realistic projects.
 */
export const EXCLUDED_FINGERPRINT_LIMIT: number = 5000;

/*
 * A person who may read an exception but not change its repository asks
 * for a fix: refused in these words (createCodeFixRunForException).
 */
export const EXCEPTION_FIX_NOT_ALLOWED_MESSAGE: string =
  "You can read this exception. Fixing it with AI works in its repository, and takes permission to edit that repository - ask a project admin for it.";

export interface CreateCodeFixRunForExceptionParams {
  telemetryExceptionId: ObjectID;
  props: DatabaseCommonInteractionProps;
  // Which task recipe to run. Defaults to FixException.
  taskType?: CodeFixTaskType | undefined;
  /*
   * The finding the run is for (the Exceptions product's AI section):
   * stamped on the run as it is created, so the finding links its fix,
   * Code says what started it, and its pull request says why it opened.
   */
  triggeredByAiInsightId?: ObjectID | undefined;
  /*
   * The repositories the run may be queued on (the AI rules' that started
   * it): the exception resolves only to one of them. Left out, to any.
   */
  codeRepositoryAllowance?: CodeRepositoryAllowance | undefined;
  /*
   * The repository a person picked for it, when none was found to hold the
   * code for certain: the caller checked they may ask AI to work in it.
   */
  codeRepositoryId?: ObjectID | undefined;
  // The LLM provider the AI rules behind the run picked, if any.
  llmProviderId?: ObjectID | undefined;
}

// The repository a fix is queued on, as the readiness check names it.
interface ResolvedFixRepository {
  codeRepositoryId: string;
  organizationName: string;
  repositoryName: string;
}

export interface DashboardServiceSummary {
  /*
   * Polymorphic: a real Service, a Host/DockerHost/KubernetesCluster id, or
   * the projectId for unattributed telemetry. The client resolves the
   * display name per primaryEntityType.
   */
  primaryEntityId: string;
  primaryEntityType: ServiceType | null;
  unresolvedCount: number;
  totalOccurrences: number;
}

/*
 * A row an update that is activity is about to write, as it was before
 * (ExceptionActivityState): what onUpdateSuccess tells the update's
 * activity by.
 */
interface ExceptionRowBeforeUpdate {
  projectId: ObjectID;
  state: ExceptionActivityState;
}

export interface DashboardSummaryResult {
  unresolvedCount: number;
  resolvedCount: number;
  archivedCount: number;
  topExceptions: Array<Model>;
  recentExceptions: Array<Model>;
  serviceSummaries: Array<DashboardServiceSummary>;
}

/*
 * A merged exception's fingerprint, and the exception it was merged into
 * (TelemetryExceptionMerge): the occurrences that carry the fingerprint
 * count there.
 */
export interface MergedFingerprintSurvivor {
  // The merged exception's own fingerprint, which its occurrences keep.
  fingerprint: string;
  // The exception it was merged into.
  survivorId: ObjectID;
  survivorFingerprint: string;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * AN EXCEPTION GROUP IS READ AS THE TELEMETRY IT CAME FROM.
   *
   * primaryEntityId names the resource whose telemetry reported the
   * exception - a service, a host, a cluster ... - or the project, for
   * telemetry that names none. Reads, counts, updates and deletes reach only
   * the groups of the resources the caller's grants for that operation
   * reach, by the rule every telemetry read follows (TelemetryReadScope): a
   * grant over the whole project reaches every group, a label grant the
   * groups of the resources carrying its labels, an Owned grant those of the
   * resources the caller or one of their teams own (and the project's
   * unattributed ones), and a block with labels takes away the groups of the
   * resources carrying them. The occurrences behind a group (ExceptionInstance)
   * follow the same scope, so the list, its counts and the occurrences agree.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = await this.addExceptionScope(
      Service.hideMergedExceptions(
        await this.withMergedFingerprintAliases(findBy.query),
      ),
      findBy.props,
      DatabaseRequestType.Read,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = await this.addExceptionScope(
      Service.hideMergedExceptions(
        await this.withMergedFingerprintAliases(countBy.query),
      ),
      countBy.props,
      DatabaseRequestType.Read,
    );

    return super.countBy(countBy);
  }

  /*
   * A MERGED EXCEPTION'S FINGERPRINT FINDS THE ONE IT WAS MERGED INTO.
   *
   * The occurrences of a merged exception keep its fingerprint
   * (TelemetryExceptionMerge), so a read that looks exceptions up by the
   * fingerprints of occurrences - the list narrowed by an attribute or
   * resource filter, a link from a span or a log, the API - would match
   * only the merged row, which every read leaves out (hideMergedExceptions),
   * and the exception those occurrences count on would be missing. Such a
   * read finds the survivor too: each merged fingerprint it names brings in
   * the fingerprint of the exception it was merged into. One read of the
   * partial index on merged rows, as root - this is what the data means; who
   * may see what is applied after, as for every read - and none for a query
   * that names rows by id or by the merge column, which hideMergedExceptions
   * leaves as asked.
   */
  public async withMergedFingerprintAliases<TQuery>(
    query: TQuery,
  ): Promise<TQuery> {
    const record: Record<string, unknown> = (query || {}) as Record<
      string,
      unknown
    >;

    if (
      "_id" in record ||
      "id" in record ||
      "mergedIntoTelemetryExceptionId" in record
    ) {
      return query;
    }

    const fingerprints: Array<string> = Service.readQueriedFingerprints(
      record["fingerprint"],
    );

    if (fingerprints.length === 0) {
      return query;
    }

    const survivors: Array<MergedFingerprintSurvivor> =
      await this.getMergedFingerprintSurvivors({
        projectId: record["projectId"],
        fingerprints,
      });

    return Service.withFingerprintAliases(
      query,
      survivors.map((survivor: MergedFingerprintSurvivor): string => {
        return survivor.survivorFingerprint;
      }),
    );
  }

  /*
   * THE EXCEPTION EACH MERGED FINGERPRINT WAS MERGED INTO.
   *
   * Of these fingerprints of occurrences, each that is a merged exception's,
   * with the exception it was merged into: the one those occurrences count
   * on. What withMergedFingerprintAliases widens a lookup with, and what a
   * caller that matches the rows it looked up back to the fingerprints it
   * asked about needs, as the rows it gets back carry their own fingerprint
   * (getExceptionsByFingerprint). One read of the partial index on merged
   * rows, as root - this is what the data means; who may see the survivors
   * is up to the read they are looked up with. `projectId` is the project
   * the fingerprints are of; left out, every project's (a query that names
   * none). A fingerprint nothing was merged from is not listed. If the read
   * fails, none is: each fingerprint then finds only its own exception, as
   * before any merge.
   */
  @CaptureSpan()
  public async getMergedFingerprintSurvivors(data: {
    projectId?: unknown;
    fingerprints: Array<string>;
  }): Promise<Array<MergedFingerprintSurvivor>> {
    const fingerprints: Array<string> = Service.distinctFingerprints(
      data.fingerprints,
    );

    if (fingerprints.length === 0) {
      return [];
    }

    let merged: Array<Model> = [];

    try {
      merged = await this.findBy({
        query: {
          ...(data.projectId !== undefined
            ? { projectId: data.projectId }
            : {}),
          fingerprint: new Includes(fingerprints),
          mergedIntoTelemetryExceptionId: QueryHelper.notNull(),
        } as Query<Model>,
        select: {
          fingerprint: true,
          mergedIntoTelemetryExceptionId: true,
          mergedIntoTelemetryException: {
            fingerprint: true,
          },
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (err) {
      // The read as asked: the merged ones' survivors are missing, nothing else.
      logger.error(
        `Could not read the merged exceptions of a fingerprint lookup; it is read without them: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }

    const survivors: Array<MergedFingerprintSurvivor> = [];

    for (const row of merged) {
      const fingerprint: string = row.fingerprint || "";
      const survivorFingerprint: string =
        row.mergedIntoTelemetryException?.fingerprint || "";

      if (
        !fingerprint ||
        !survivorFingerprint ||
        !row.mergedIntoTelemetryExceptionId
      ) {
        continue;
      }

      survivors.push({
        fingerprint,
        survivorId: row.mergedIntoTelemetryExceptionId,
        survivorFingerprint,
      });
    }

    return survivors;
  }

  /*
   * THE EXCEPTIONS THE OCCURRENCES OF EACH FINGERPRINT COUNT ON.
   *
   * Among the rows a lookup by these fingerprints read - merged rows left
   * out, the survivors of merged fingerprints brought in
   * (withMergedFingerprintAliases) - for each fingerprint: the rows that
   * carry it, then, for a merged exception's, the exception it was merged
   * into. That one is found by its id, as the mapping names it: a row that
   * only shares a survivor's fingerprint, in another service, is not it. A
   * fingerprint none of the rows answers for is left out, and the rows of
   * each are in the order they were read.
   */
  public static getExceptionsByFingerprint(data: {
    fingerprints: Array<string>;
    rows: Array<Model>;
    survivors: Array<MergedFingerprintSurvivor>;
  }): Map<string, Array<Model>> {
    const rowById: Map<string, Model> = new Map();

    for (const row of data.rows) {
      const id: string = row.id?.toString().toLowerCase() || "";

      if (id && !rowById.has(id)) {
        rowById.set(id, row);
      }
    }

    const exceptionsByFingerprint: Map<string, Array<Model>> = new Map();

    for (const fingerprint of Service.distinctFingerprints(data.fingerprints)) {
      const exceptions: Array<Model> = [];

      const add: (row: Model | undefined) => void = (
        row: Model | undefined,
      ): void => {
        if (row && !exceptions.includes(row)) {
          exceptions.push(row);
        }
      };

      for (const row of data.rows) {
        if (row.fingerprint === fingerprint) {
          add(row);
        }
      }

      for (const survivor of data.survivors) {
        if (survivor.fingerprint === fingerprint) {
          add(rowById.get(survivor.survivorId.toString().toLowerCase()));
        }
      }

      if (exceptions.length > 0) {
        exceptionsByFingerprint.set(fingerprint, exceptions);
      }
    }

    return exceptionsByFingerprint;
  }

  /*
   * THE EXCEPTIONS THESE FINGERPRINTS OF OCCURRENCES COUNT ON, BY FINGERPRINT.
   *
   * The fingerprints a span, a log, a security event or a session replay
   * names an exception by are its occurrences' fingerprints, which a merged
   * exception's occurrences keep. So each is answered with the exceptions
   * it is the fingerprint of, and a merged exception's with the exception
   * it was merged into (getExceptionsByFingerprint): looked up with the
   * caller's props, so only the exceptions they may read are answered,
   * beside one read of what was merged into what
   * (getMergedFingerprintSurvivors). `limit` is the most rows read.
   */
  @CaptureSpan()
  public async findByOccurrenceFingerprints(data: {
    projectId: ObjectID;
    fingerprints: Array<string>;
    select: Select<Model>;
    limit: number;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<Model>>> {
    const fingerprints: Array<string> = Service.distinctFingerprints(
      data.fingerprints,
    );

    if (fingerprints.length === 0) {
      return new Map();
    }

    const [rows, survivors]: [Array<Model>, Array<MergedFingerprintSurvivor>] =
      await Promise.all([
        this.findBy({
          query: {
            projectId: data.projectId,
            fingerprint: new Includes(fingerprints),
          },
          select: { ...data.select, _id: true, fingerprint: true },
          limit: data.limit,
          skip: 0,
          props: data.props,
        }),
        this.getMergedFingerprintSurvivors({
          projectId: data.projectId,
          fingerprints,
        }),
      ]);

    return Service.getExceptionsByFingerprint({
      fingerprints,
      rows,
      survivors,
    });
  }

  // Each fingerprint once, as asked, without blanks.
  private static distinctFingerprints(
    fingerprints: Array<string>,
  ): Array<string> {
    return Array.from(
      new Set(
        fingerprints.filter((fingerprint: unknown): fingerprint is string => {
          return typeof fingerprint === "string" && fingerprint.length > 0;
        }),
      ),
    );
  }

  // The fingerprints a query names: one, or an Includes of them.
  public static readQueriedFingerprints(value: unknown): Array<string> {
    const values: Array<unknown> =
      typeof value === "string"
        ? [value]
        : value instanceof Includes
          ? [...(value.values as Array<unknown>)]
          : [];

    return values.filter((entry: unknown): entry is string => {
      return typeof entry === "string" && entry.length > 0;
    });
  }

  // The query, its fingerprints and the survivors' fingerprints with them.
  public static withFingerprintAliases<TQuery>(
    query: TQuery,
    aliases: Array<string>,
  ): TQuery {
    const record: Record<string, unknown> = (query || {}) as Record<
      string,
      unknown
    >;
    const fingerprints: Array<string> = Service.readQueriedFingerprints(
      record["fingerprint"],
    );
    const added: Array<string> = Array.from(
      new Set(
        aliases.filter((alias: string): boolean => {
          return alias.length > 0 && !fingerprints.includes(alias);
        }),
      ),
    );

    if (fingerprints.length === 0 || added.length === 0) {
      return query;
    }

    return {
      ...record,
      fingerprint: new Includes([...fingerprints, ...added]),
    } as TQuery;
  }

  /*
   * A MERGED EXCEPTION IS NOT LISTED.
   *
   * An exception merged into another (TelemetryExceptionMerge) is part of
   * that one: its occurrences count there, and the lists, the counts, the
   * monitors' new and regressed groups, What's new, Similar exceptions and
   * the AI's detectors should see only the one it was merged into. So every
   * read and count leaves merged rows out - for root too, since this is what
   * the data means rather than who may see it - unless the query names them:
   * by id (an exception's own page, a link to it), or by the column itself
   * (the exceptions merged into one, which its page lists).
   */
  public static hideMergedExceptions<TQuery>(query: TQuery): TQuery {
    const record: Record<string, unknown> = (query || {}) as Record<
      string,
      unknown
    >;

    if (
      "_id" in record ||
      "id" in record ||
      "mergedIntoTelemetryExceptionId" in record
    ) {
      return query;
    }

    return {
      ...record,
      mergedIntoTelemetryExceptionId: QueryHelper.isNull(),
    } as TQuery;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Resolving or reopening clears the Regressed mark, and a resolve keeps
     * a release to wait for only when it names one (Resolve in next
     * release). See applyManualResolutionChange.
     */
    applyManualResolutionChange(
      updateBy.data as unknown as Record<string, unknown>,
    );

    // One assignee: a person or a team. See applyAssignmentChange.
    applyAssignmentChange(updateBy.data as unknown as Record<string, unknown>);

    updateBy.query = await this.addExceptionScope(
      updateBy.query,
      updateBy.props,
      DatabaseRequestType.Update,
    );

    /*
     * A triage or an assignment is activity: the rows it writes, as they are
     * before it, so onUpdateSuccess can tell what it changed - from every
     * caller, the exception's page, Bulk Actions and the API alike.
     */
    if (
      !isExceptionActivityWrite(
        updateBy.data as unknown as Record<string, unknown>,
      )
    ) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        isResolved: true,
        isArchived: true,
        resolvedInReleaseAfter: true,
        assignToUserId: true,
        assignToTeamId: true,
      },
    );

    const before: Map<string, ExceptionRowBeforeUpdate> = new Map();

    for (const row of rows) {
      if (!row.id || !row.projectId) {
        continue;
      }

      before.set(row.id.toString().toLowerCase(), {
        projectId: row.projectId,
        state: {
          isResolved: Boolean(row.isResolved),
          isArchived: Boolean(row.isArchived),
          resolvedInReleaseAfter: row.resolvedInReleaseAfter?.trim() || null,
          assignToUserId: readId(row.assignToUserId) || null,
          assignToTeamId: readId(row.assignToTeamId) || null,
        },
      });
    }

    return { updateBy, carryForward: before };
  }

  /*
   * What a triage or an assignment changed, on each exception's activity
   * timeline: resolved, reopened, came back, archived, assigned and the
   * rest (getExceptionActivityChanges), crediting whoever made the change.
   * Recorded once the write landed, never failing it (record logs and
   * drops what it could not write).
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const before: Map<string, ExceptionRowBeforeUpdate> | null =
      onUpdate.carryForward instanceof Map ? onUpdate.carryForward : null;

    if (!before || before.size === 0) {
      return onUpdate;
    }

    const write: Record<string, unknown> = (onUpdate.updateBy.data ||
      {}) as unknown as Record<string, unknown>;
    const entries: Array<TelemetryExceptionActivityEntry> = [];

    for (const updatedId of updatedItemIds) {
      const row: ExceptionRowBeforeUpdate | undefined = before.get(
        updatedId.toString().toLowerCase(),
      );

      if (!row) {
        continue;
      }

      const changes: Array<ExceptionActivityChange> =
        getExceptionActivityChanges({ before: row.state, write });

      for (const change of changes) {
        entries.push({
          projectId: row.projectId,
          telemetryExceptionId: updatedId,
          activityType: change.activityType,
          assigneeUserId: change.assigneeUserId,
          assigneeTeamId: change.assigneeTeamId,
          release: change.release,
        });
      }
    }

    if (entries.length > 0) {
      await TelemetryExceptionActivityService.record({
        entries,
        actor: TelemetryExceptionActivityService.getActor(
          onUpdate.updateBy.props,
        ),
      });
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = await this.addExceptionScope(
      deleteBy.query,
      deleteBy.props,
      DatabaseRequestType.Delete,
    );

    return { deleteBy, carryForward: null };
  }

  /*
   * Narrows a query on exception groups to the caller's scope for the
   * operation (see above): on the group's resource for a read in one
   * project, and on the group's id, project by project, for a read across
   * the caller's projects (PerProjectReadScope). Left alone for root,
   * master admins and callers whose grants reach every resource with
   * nothing blocked.
   */
  public async addExceptionScope<TQuery>(
    query: TQuery,
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
  ): Promise<TQuery> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    // A copy: the caller's own query object is left as it was.
    const record: Record<string, unknown> = {
      ...((query || {}) as Record<string, unknown>),
    };

    if (PerProjectReadScope.isAcrossProjects(props)) {
      const clause: FindWhereProperty<any> | null =
        await PerProjectReadScope.getClauseAcrossProjects({
          props: props,
          tableName: new Model().tableName || "TelemetryException",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any> | null> => {
            return this.getScopeIdClause(
              await this.getExceptionScope(projectProps, operation),
            );
          },
        });

      if (!clause) {
        return query;
      }

      const idQuery: Record<string, unknown> = QueryUtil.serializeQuery(Model, {
        _id: record["_id"],
      } as never) as Record<string, unknown>;

      record["_id"] = combineWithPrivacyClause(
        this.getSupportedFilter(idQuery["_id"], "_id"),
        clause,
      );

      return record as unknown as TQuery;
    }

    const clause: FindWhereProperty<any> | null = this.getScopeKeyClause(
      await this.getExceptionScope(props, operation),
    );

    if (!clause) {
      return query;
    }

    const keyQuery: Record<string, unknown> = QueryUtil.serializeQuery(Model, {
      primaryEntityId: record["primaryEntityId"],
    } as never) as Record<string, unknown>;

    record["primaryEntityId"] = combineWithPrivacyClause(
      this.getSupportedFilter(keyQuery["primaryEntityId"], "primaryEntityId"),
      clause,
    );

    return record as unknown as TQuery;
  }

  /*
   * Whose exception groups the caller may reach in their project for an
   * operation: the grants the model's list for it gives, by the rule every
   * telemetry read follows (AnalyticsModelPermission.getReadScopeForPermissions).
   * A block with no labels refuses.
   */
  private async getExceptionScope(
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
  ): Promise<TelemetryReadScope> {
    const model: Model = new Model();

    return await AnalyticsModelPermission.getReadScopeForPermissions({
      props: props,
      permissions: TablePermission.getTablePermission(Model, operation),
      wildcard: HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: operation,
      }),
      includeProjectScope: true,
      recordName: model.pluralName || "Exceptions",
      operation: operation,
    });
  }

  /*
   * The scope as a condition on a group's resource, or null when it reaches
   * every resource. A group whose resource is not recorded belongs to none,
   * so a block with labels leaves it.
   */
  private getScopeKeyClause(
    scope: TelemetryReadScope,
  ): FindWhereProperty<any> | null {
    if (TelemetryReadScopeUtil.isProjectWide(scope)) {
      return null;
    }

    const readableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(scope);

    if (readableIds !== null) {
      return QueryHelper.any(
        readableIds.length > 0
          ? readableIds
          : [TelemetryReadScopeUtil.NO_RESOURCE_ID],
      );
    }

    return QueryHelper.notInOrNull(TelemetryReadScopeUtil.getBlockedIds(scope));
  }

  // The same condition on a group's id, for a read across projects.
  private getScopeIdClause(
    scope: TelemetryReadScope,
  ): FindWhereProperty<any> | null {
    if (TelemetryReadScopeUtil.isProjectWide(scope)) {
      return null;
    }

    const table: string = (
      new Model().tableName || "TelemetryException"
    ).replace(/"/g, '""');
    const readableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(scope);
    const idsRid: string = "exceptionScope_" + Text.generateRandomText(10);

    if (readableIds !== null) {
      return Raw(
        (alias: string): string => {
          return `${alias} IN (SELECT "${table}"."_id" FROM "${table}" WHERE "${table}"."primaryEntityId" IN (:...${idsRid}))`;
        },
        {
          [idsRid]:
            readableIds.length > 0
              ? readableIds
              : [TelemetryReadScopeUtil.NO_RESOURCE_ID],
        },
      );
    }

    return Raw(
      (alias: string): string => {
        return `${alias} NOT IN (SELECT "${table}"."_id" FROM "${table}" WHERE "${table}"."primaryEntityId" IN (:...${idsRid}))`;
      },
      { [idsRid]: TelemetryReadScopeUtil.getBlockedIds(scope) },
    );
  }

  /*
   * A caller's filter on the column the scope is added to, once serialized,
   * as the read block keeps one (ReadPermission.getSupportedFilter): a shape
   * that cannot be kept next to the scope is refused, not dropped.
   */
  private getSupportedFilter(serialized: unknown, column: string): unknown {
    return ReadPermission.getSupportedFilter(
      serialized,
      `Unsupported filter on ${column}: use one id, a list of ids, or a query operator.`,
    );
  }

  /*
   * Everything "Fix with AI Agent" needs, checked BEFORE a task is created
   * (and consumed by the dashboard to render a setup checklist instead of a
   * button that fails minutes later inside the agent container).
   */
  @CaptureSpan()
  public async getAIFixReadiness(params: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
    /*
     * Overrides the IsBillingEnabled env flag for the balance check — exists
     * so tests can exercise both modes without mocking the module.
     */
    billingEnabled?: boolean;
  }): Promise<AIFixReadiness> {
    return (await this.getAIFixReadinessAndRepository(params)).readiness;
  }

  /*
   * The readiness, and the repository the exception resolved to when one
   * did: a fix run is queued on that repository, so the Runner the
   * repository picks (its Runner setting in Code) is the one that takes it,
   * and the agent check asks whether that Runner is online.
   */
  @CaptureSpan()
  private async getAIFixReadinessAndRepository(params: {
    telemetryExceptionId: ObjectID;
    props: DatabaseCommonInteractionProps;
    billingEnabled?: boolean;
    // The repositories it may resolve to; left out, any.
    codeRepositoryAllowance?: CodeRepositoryAllowance | undefined;
    // A repository picked for it: no resolving.
    codeRepositoryId?: ObjectID | undefined;
  }): Promise<{
    readiness: AIFixReadiness;
    codeRepositoryId: ObjectID | null;
  }> {
    const telemetryException: Model | null = await this.findOneById({
      id: params.telemetryExceptionId,
      select: {
        _id: true,
        projectId: true,
        stackTrace: true,
        primaryEntityId: true,
        primaryEntityType: true,
      },
      props: params.props,
    });

    if (!telemetryException || !telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception not found");
    }

    const projectId: ObjectID = telemetryException.projectId;

    /*
     * 1. An LLM provider the agent may use — the same gate Code's request
     * box asks, so the two surfaces can never disagree about whether this
     * project has a usable provider.
     */
    const llmCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getLlmProviderCheck({
        projectId,
        billingEnabled: params.billingEnabled,
      });

    /*
     * 2. A repository must RESOLVE for this exception — computed at runtime
     * from the stack trace (path matching over connected repos), falling
     * back to service-name matching and the only-repository rule. No manual
     * mapping table, no Service Catalog prerequisite.
     */
    const service: TelemetryService | null = telemetryException.primaryEntityId
      ? await ServiceService.findOneById({
          id: telemetryException.primaryEntityId,
          select: {
            _id: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    let repoCheck: AIFixReadinessCheck;
    let resolvedRepository: CodeRepository | null = null;

    try {
      const resolution: ResolvedFixRepository | null = params.codeRepositoryId
        ? await this.getPickedFixRepository({
            projectId,
            codeRepositoryId: params.codeRepositoryId,
          })
        : await this.resolveFixRepository({
            projectId,
            stackTrace: telemetryException.stackTrace || null,
            serviceName: service?.name || null,
            allowance: params.codeRepositoryAllowance,
          });

      resolvedRepository = resolution
        ? await CodeRepositoryService.findOneBy({
            query: {
              _id: resolution.codeRepositoryId,
              projectId: projectId,
            },
            select: {
              _id: true,
              runnerId: true,
              isGlobalRunnerPicked: true,
            },
            props: {
              isRoot: true,
            },
          })
        : null;

      repoCheck = {
        id: "repositoryResolved",
        ok: Boolean(resolution),
        title: resolution
          ? `Repository resolved: ${resolution.organizationName}/${resolution.repositoryName}`
          : "Repository resolved",
        detail: resolution
          ? ""
          : "No connected repository could be matched to this exception — its stack-trace files were not found in any connected repository, no repository name matches the service, and the project has more than one repository. Connect the right repository in Code: through the GitHub App, or from GitLab, Forgejo, Gitea or any Git server.",
      };
    } catch (err) {
      repoCheck = {
        id: "repositoryResolved",
        ok: false,
        title: "Repository resolved",
        detail: `Could not check the connected repositories: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      };
    }

    /*
     * 3. A Runner must be alive to pick the task up: the one the resolved
     * repository picks, or - for one that picks none - the project's default
     * Runner, else a global Runner.
     */
    const agentCheck: AIFixReadinessCheck =
      await CodeFixReadiness.getAgentCheck({
        projectId,
        repository: resolvedRepository
          ? {
              projectId,
              runnerId: resolvedRepository.runnerId,
              isGlobalRunnerPicked: resolvedRepository.isGlobalRunnerPicked,
            }
          : undefined,
      });

    const checks: Array<AIFixReadinessCheck> = [
      llmCheck,
      repoCheck,
      agentCheck,
    ];

    return {
      readiness: {
        ready: checks.every((check: AIFixReadinessCheck) => {
          return check.ok;
        }),
        checks,
      },
      codeRepositoryId: resolvedRepository?.id || null,
    };
  }

  /*
   * The repository an exception's code is in - resolved from its stack
   * trace, else its service's name, else the only one there is - of the
   * ones the allowance names (any, when it names none).
   */
  private async resolveFixRepository(data: {
    projectId: ObjectID;
    stackTrace: string | null;
    serviceName: string | null;
    allowance?: CodeRepositoryAllowance | undefined;
  }): Promise<ResolvedFixRepository | null> {
    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: data.projectId,
        stackTrace: data.stackTrace,
        serviceName: data.serviceName,
        ...(data.allowance ? { allowance: data.allowance } : {}),
      });

    return resolution
      ? {
          codeRepositoryId: resolution.codeRepositoryId,
          organizationName: resolution.organizationName,
          repositoryName: resolution.repositoryName,
        }
      : null;
  }

  /*
   * A repository a person picked: one of the project's, read as the system
   * - the caller checked the person may ask AI to work in it. Null when it
   * is not the project's.
   */
  private async getPickedFixRepository(data: {
    projectId: ObjectID;
    codeRepositoryId: ObjectID;
  }): Promise<ResolvedFixRepository | null> {
    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: {
          _id: data.codeRepositoryId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          organizationName: true,
          repositoryName: true,
        },
        props: { isRoot: true },
      });

    if (!repository || !repository.id) {
      return null;
    }

    return {
      codeRepositoryId: repository.id.toString(),
      organizationName: repository.organizationName || "",
      repositoryName: repository.repositoryName || "",
    };
  }

  /*
   * Whether a person may ask AI to fix an exception: they may ask AI to work
   * in the repository the fix is queued on. With no repository (one that
   * went away after it resolved), they need to be allowed to edit the
   * project's repositories. Root and master admins may.
   */
  private async assertMayAskForFix(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    codeRepositoryId: ObjectID | null;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    let mayAsk: boolean = false;

    if (data.codeRepositoryId) {
      mayAsk = await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId: data.codeRepositoryId,
      });
    } else {
      try {
        ModelPermission.checkTableWritePermission(
          CodeRepository,
          data.props,
          DatabaseRequestType.Update,
        );
        mayAsk = true;
      } catch (error) {
        if (
          !(error instanceof NotAuthorizedException) &&
          !(error instanceof PaymentRequiredException)
        ) {
          throw error;
        }
      }
    }

    if (!mayAsk) {
      throw new NotAuthorizedException(EXCEPTION_FIX_NOT_ALLOWED_MESSAGE);
    }
  }

  /*
   * "Fix with AI Agent": record the durable intent as a Queued CodeFix
   * AIRun (the unified run substrate — same enqueue semantics as the
   * investigation queue: attemptCount defaults to 0 and no events are
   * written until a worker claims the run). An external agent container
   * claims it via /ai-agent-task/get-pending-task and dispatches on the
   * run's task recipe (codeFixTaskType).
   */
  @CaptureSpan()
  public async createCodeFixRunForException(
    params: CreateCodeFixRunForExceptionParams,
  ): Promise<AIRun> {
    const { telemetryExceptionId, props } = params;

    const taskType: CodeFixTaskType =
      params.taskType || CodeFixTaskType.FixException;

    /*
     * Recipes beyond FixException / WriteRegressionTest are declared in the
     * enum (so workers and the UI can already dispatch on them) but their
     * recipes have not shipped — creating a run for them would queue work no
     * agent can execute.
     */
    if (!CodeFixTaskTypeHelper.isUserTriggerable(taskType)) {
      throw new BadDataException(
        `Task type "${taskType}" is not user-triggerable yet. Supported task types: ${CodeFixTaskTypeHelper.getUserTriggerableTaskTypes().join(
          ", ",
        )}.`,
      );
    }

    // Get the telemetry exception (also the caller's access check).
    const telemetryException: Model | null = await this.findOneById({
      id: telemetryExceptionId,
      select: {
        _id: true,
        projectId: true,
        message: true,
        exceptionType: true,
        isResolved: true,
        isArchived: true,
        aiFixDeclinedAt: true,
      },
      props,
    });

    if (!telemetryException || !telemetryException.projectId) {
      throw new BadDataException("Telemetry Exception not found");
    }

    /*
     * The project's one AI switch. The Dashboard does not offer AI
     * Assistance with AI off, and the server refuses it the same way rather
     * than queueing a run whose every model call would be refused.
     */
    await AIService.assertProjectAIEnabled(telemetryException.projectId);

    /*
     * Server-side lifecycle gate (the dashboard hides the button for
     * resolved exceptions, but the API must enforce it — the automatic
     * insight lane and any direct API caller land here too).
     */
    if (telemetryException.isResolved) {
      throw new BadDataException(
        "This exception is marked as resolved. Unresolve it before starting an AI agent task for it.",
      );
    }

    if (telemetryException.isArchived) {
      throw new BadDataException(
        "This exception is archived. Unarchive it before starting an AI agent task for it.",
      );
    }

    /*
     * Human "closed without merging" feedback: when an AI FIX PR for this
     * exception was declined, the automatic lane must not keep re-opening
     * fix PRs for it. Scoped to the FixException recipe — the stamp is only
     * ever SET for closed fix PRs (SyncPullRequestStates), so a regression
     * test or error-handling task is neither blocked by it nor allowed to
     * clear it. A HUMAN clicking "Fix with AI" is the explicit override;
     * the stamp is cleared only AFTER the retry run is actually created
     * (see below), so a retry that fails a later gate leaves the human's
     * decline in force.
     */
    const isDeclinedFixOverride: boolean = Boolean(
      telemetryException.aiFixDeclinedAt &&
        taskType === CodeFixTaskType.FixException,
    );

    if (isDeclinedFixOverride && !props.userId) {
      throw new BadDataException(
        "A previous AI fix pull request for this exception was closed without merging, so automatic fix attempts are paused for it. A user can retry from the exception page.",
      );
    }

    /*
     * G11 guardrail: the per-project daily fix-run budget. Checked before
     * the (more expensive) readiness probes — an over-budget project gets
     * the budget message, not a readiness one.
     */
    await FixRunBudget.assertWithinBudget(telemetryException.projectId);

    /*
     * Fail early with everything that's missing, instead of creating a run
     * that dies minutes later inside the agent container.
     */
    const {
      readiness,
      codeRepositoryId,
    }: { readiness: AIFixReadiness; codeRepositoryId: ObjectID | null } =
      await this.getAIFixReadinessAndRepository({
        telemetryExceptionId,
        props,
        codeRepositoryAllowance: params.codeRepositoryAllowance,
        codeRepositoryId: params.codeRepositoryId,
      });

    if (!readiness.ready) {
      const missing: string = readiness.checks
        .filter((check: AIFixReadinessCheck) => {
          return !check.ok;
        })
        .map((check: AIFixReadinessCheck) => {
          return check.title;
        })
        .join(", ");

      throw new BadDataException(
        `Cannot start the AI fix — missing prerequisites: ${missing}.`,
      );
    }

    /*
     * Reading the exception is not enough. A fix run is AI working in the
     * exception's repository - it spends the project's AI and opens a pull
     * request there - so a person needs what asking AI to work in that
     * repository takes everywhere else (CodeTaskAccess.canAskInRepository):
     * permission to edit it. The automatic lanes run as root.
     */
    await this.assertMayAskForFix({
      props,
      projectId: telemetryException.projectId,
      codeRepositoryId,
    });

    /*
     * The duplicate guards below are check-then-create: without
     * serialization, two triage completions for splintered variants of the
     * same root cause can both pass the guards and both create runs. A
     * per-project Redis mutex closes the window; acquisition failure
     * (Redis down) degrades to the unserialized behavior rather than
     * blocking fix creation — the guards still run, they just race.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: telemetryException.projectId.toString(),
        namespace: "TelemetryExceptionService.createCodeFixRunForException",
        lockTimeout: 15000,
      });
    } catch (err) {
      logger.debug(
        `Could not acquire the code-fix creation mutex for project ${telemetryException.projectId.toString()} — proceeding without serialization: ${err}`,
      );
    }

    let createdRun: AIRun;

    try {
      /*
       * Duplicate guard is per (exception, taskType): an active
       * FixException run must not block queuing a WriteRegressionTest run
       * and vice versa.
       */
      await this.validateNoActiveCodeFixRunExists(
        telemetryExceptionId,
        taskType,
      );

      /*
       * Cross-group duplicate guard: interpolated dynamic values (garbage
       * UUIDs, file paths, request payloads) splinter one root cause into
       * many fingerprints, and the per-exception guard above cannot see
       * that. Compare NORMALIZED messages against exceptions that already
       * have an active run or an open AI pull request, so one root cause
       * yields one PR — not one per interpolated variant.
       */
      await this.validateNoOpenFixForSimilarException({
        projectId: telemetryException.projectId,
        telemetryExceptionId: telemetryExceptionId,
        taskType: taskType,
        message: telemetryException.message || "",
        exceptionType: telemetryException.exceptionType || "",
      });

      const run: AIRun = new AIRun();
      run.projectId = telemetryException.projectId;
      run.runType = AIRunType.CodeFix;
      run.codeFixTaskType = taskType;
      run.status = AIRunStatus.Queued;
      run.triggeredByTelemetryExceptionId = telemetryExceptionId;

      /*
       * The repository the exception resolved to: the run is queued on it,
       * so the Runner the repository picks takes it (and the task shows on
       * the repository's page in Code from the start).
       */
      if (codeRepositoryId) {
        run.codeRepositoryId = codeRepositoryId;
      }

      // Attribution: the user who clicked "Fix with AI Agent".
      if (props.userId) {
        run.userId = props.userId;
      }

      // The finding it is for, and the provider its AI rules picked.
      if (params.triggeredByAiInsightId) {
        run.triggeredByAiInsightId = params.triggeredByAiInsightId;
      }

      if (params.llmProviderId) {
        run.llmProviderId = params.llmProviderId;
      }

      /*
       * Created as root: AIRun rows are server-written only (empty create
       * ACL); the person's access was checked above - the exception read
       * and the repository they ask AI to work in (assertMayAskForFix).
       */
      createdRun = await AIRunService.create({
        data: run,
        props: {
          isRoot: true,
        },
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.debug(`Failed to release the code-fix creation mutex: ${err}`);
        }
      }
    }

    if (!createdRun.id) {
      throw new BadDataException("Failed to create the AI fix run");
    }

    /*
     * The human's retry actually went through — only now consume the
     * decline override. A retry that failed any gate above leaves the
     * suppression in force.
     */
    if (isDeclinedFixOverride) {
      await this.updateOneById({
        id: telemetryExceptionId,
        data: {
          aiFixDeclinedAt: null,
        },
        props: { isRoot: true },
      });
    }

    return createdRun;
  }

  @CaptureSpan()
  private async validateNoActiveCodeFixRunExists(
    telemetryExceptionId: ObjectID,
    taskType: CodeFixTaskType,
  ): Promise<void> {
    const existingRun: AIRun | null = await AIRunService.findOneBy({
      query: {
        runType: AIRunType.CodeFix,
        triggeredByTelemetryExceptionId: telemetryExceptionId,
        /*
         * A null codeFixTaskType means FixException (rows created before
         * task recipes existed), so the FixException guard must also match
         * legacy null rows.
         */
        codeFixTaskType:
          taskType === CodeFixTaskType.FixException
            ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
            : taskType,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingRun) {
      throw new BadDataException(
        `An AI agent task (${taskType}) is already in progress for this exception. Please wait for it to complete before creating a new one.`,
      );
    }
  }

  /*
   * Cross-group duplicate guard. Two exception groups are "the same work"
   * for the fix lane when their exceptionType and NORMALIZED message match
   * (normalizeExceptionText replaces UUIDs, IDs, emails, paths' dynamic
   * segments, timestamps...). Candidates are the exceptions behind
   * (a) non-terminal CodeFix runs of the same recipe, and (b) OPEN
   * AI-authored pull requests — a completed run whose PR is still open
   * must keep blocking, or every interpolated variant re-fixes the same
   * root cause (observed: 15 near-identical PRs for one invalid-uuid
   * throw site).
   */
  @CaptureSpan()
  private async validateNoOpenFixForSimilarException(data: {
    projectId: ObjectID;
    telemetryExceptionId: ObjectID;
    taskType: CodeFixTaskType;
    message: string;
    exceptionType: string;
  }): Promise<void> {
    // (a) Exceptions with a non-terminal run of the same recipe.
    const activeRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        /*
         * A null codeFixTaskType means FixException (rows created before
         * task recipes existed) — same legacy-null matching as
         * validateNoActiveCodeFixRunExists.
         */
        codeFixTaskType:
          data.taskType === CodeFixTaskType.FixException
            ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
            : data.taskType,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: {
        triggeredByTelemetryExceptionId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    // (b) Exceptions behind still-open AI pull requests.
    const openPullRequests: Array<AIAgentTaskPullRequest> =
      await AIAgentTaskPullRequestService.findBy({
        query: {
          projectId: data.projectId,
          pullRequestState: PullRequestState.Open,
        },
        select: {
          aiRunId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    /*
     * A guard that silently stops guarding is worse than none — surface
     * candidate-scan truncation instead of quietly missing duplicates.
     */
    if (
      activeRuns.length >= LIMIT_MAX ||
      openPullRequests.length >= LIMIT_MAX
    ) {
      logger.warn(
        `Cross-group AI fix dedupe guard: candidate scan truncated at ${LIMIT_MAX} rows for project ${data.projectId.toString()} — the duplicate-PR guard may miss matches.`,
      );
    }

    const openPrRunIds: Array<ObjectID> = openPullRequests
      .map((pullRequest: AIAgentTaskPullRequest) => {
        return pullRequest.aiRunId;
      })
      .filter((runId: ObjectID | undefined): runId is ObjectID => {
        return Boolean(runId);
      });

    const openPrRuns: Array<AIRun> =
      openPrRunIds.length > 0
        ? await AIRunService.findBy({
            query: {
              _id: new Includes(openPrRunIds),
              projectId: data.projectId,
              runType: AIRunType.CodeFix,
              codeFixTaskType:
                data.taskType === CodeFixTaskType.FixException
                  ? QueryHelper.equalToOrNull(CodeFixTaskType.FixException)
                  : data.taskType,
            },
            select: {
              triggeredByTelemetryExceptionId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: { isRoot: true },
          })
        : [];

    /*
     * The target exception is deliberately NOT excluded: its own COMPLETED
     * run with a still-open PR must keep blocking a re-fix (the
     * non-terminal guard above cannot see completed runs). Its own ACTIVE
     * runs were already rejected by validateNoActiveCodeFixRunExists.
     */
    const candidateExceptionIds: Array<ObjectID> = [];
    const seenIds: Set<string> = new Set<string>();

    for (const run of [...activeRuns, ...openPrRuns]) {
      const exceptionId: ObjectID | undefined =
        run.triggeredByTelemetryExceptionId;

      if (!exceptionId) {
        continue;
      }

      const idString: string = exceptionId.toString();

      if (seenIds.has(idString)) {
        continue;
      }

      seenIds.add(idString);
      candidateExceptionIds.push(exceptionId);
    }

    if (candidateExceptionIds.length === 0) {
      return;
    }

    const targetSignature: string = `${data.exceptionType}|${normalizeExceptionText(
      data.message,
    )}`;

    const candidates: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(candidateExceptionIds),
      },
      select: {
        _id: true,
        message: true,
        exceptionType: true,
      },
      limit: candidateExceptionIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const candidate of candidates) {
      const candidateSignature: string = `${candidate.exceptionType || ""}|${normalizeExceptionText(
        candidate.message || "",
      )}`;

      if (candidateSignature !== targetSignature) {
        continue;
      }

      if (candidate._id?.toString() === data.telemetryExceptionId.toString()) {
        throw new BadDataException(
          "This exception already has an open AI pull request for this task type. Review that pull request instead of opening another one.",
        );
      }

      throw new BadDataException(
        `A similar exception (same type and normalized message, exception ${candidate._id?.toString()}) already has an AI agent task in progress or an open AI pull request. Review that pull request instead of opening another one for the same root cause.`,
      );
    }
  }

  @CaptureSpan()
  public async getDashboardSummary(
    props: DatabaseCommonInteractionProps,
  ): Promise<DashboardSummaryResult> {
    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const projectId: ObjectID = props.tenantId;

    const exceptionSelect: any = {
      _id: true,
      message: true,
      exceptionType: true,
      fingerprint: true,
      isResolved: true,
      isArchived: true,
      occuranceCount: true,
      lastSeenAt: true,
      firstSeenAt: true,
      environment: true,
      // primaryEntityId is polymorphic; the client resolves it per primaryEntityType.
      primaryEntityId: true,
      primaryEntityType: true,
    };

    const [
      unresolvedCount,
      resolvedCount,
      archivedCount,
      topExceptions,
      recentExceptions,
      serviceSummaries,
    ] = await Promise.all([
      this.countBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        props,
      }),
      this.countBy({
        query: {
          projectId,
          isResolved: true,
          isArchived: false,
        },
        props,
      }),
      this.countBy({
        query: {
          projectId,
          isArchived: true,
        },
        props,
      }),
      this.findBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        select: exceptionSelect,
        limit: 10,
        skip: 0,
        sort: {
          occuranceCount: SortOrder.Descending,
        },
        props,
      }),
      this.findBy({
        query: {
          projectId,
          isResolved: false,
          isArchived: false,
        },
        select: exceptionSelect,
        limit: 5,
        skip: 0,
        sort: {
          lastSeenAt: SortOrder.Descending,
        },
        props,
      }),
      this.aggregateUnresolvedByService(projectId, props),
    ]);

    return {
      unresolvedCount: unresolvedCount.toNumber(),
      resolvedCount: resolvedCount.toNumber(),
      archivedCount: archivedCount.toNumber(),
      topExceptions,
      recentExceptions,
      serviceSummaries,
    };
  }

  /**
   * Fingerprints of exception groups marked resolved and/or archived —
   * used by the exception monitor to exclude occurrences of those groups
   * from the exception count. Resolution state lives on this Postgres
   * model per (projectId, primaryEntityId, fingerprint) group, while
   * occurrences live in ClickHouse; fingerprints are the join key.
   * Fingerprints hash projectId + primaryEntityId into the digest, so a
   * fingerprint never collides across services and excluding by
   * fingerprint alone is exact.
   *
   * The result is capped at EXCLUDED_FINGERPRINT_LIMIT, keeping the most
   * recently seen groups: the ClickHouse client ships query params in the
   * request URI, so an unbounded NOT IN list would blow past ClickHouse's
   * http_max_uri_size (~1 MiB, roughly 14k fingerprints) and hard-fail the
   * monitor's count query. Overflow groups simply stay counted (fail-open:
   * better a stale incident than a silently swallowed one), and the
   * lastSeenAt-descending order means what gets dropped is the groups
   * least likely to have occurrences in the monitor window.
   *
   * Deliberately NO lastSeenAt lower bound: ExceptionInstance.time is the
   * client-reported occurrence timestamp while lastSeenAt is server-side
   * ingest time, so any window-derived cutoff breaks under client clock
   * skew (and under monitor configs with no time window at all).
   */
  @CaptureSpan()
  public async getResolvedOrArchivedFingerprints(data: {
    projectId: ObjectID;
    telemetryServiceIds?: Array<ObjectID> | undefined;
    resolved: boolean;
    archived: boolean;
  }): Promise<Array<string>> {
    const statusFilters: Array<Query<Model>> = [];

    if (data.resolved) {
      statusFilters.push({ isResolved: true });
    }

    if (data.archived) {
      statusFilters.push({ isArchived: true });
    }

    if (statusFilters.length === 0) {
      return [];
    }

    // resolved-OR-archived needs two indexed lookups — findBy has no OR.
    const resultsPerStatus: Array<Array<Model>> = await Promise.all(
      statusFilters.map(
        async (statusFilter: Query<Model>): Promise<Array<Model>> => {
          const query: Query<Model> = {
            projectId: data.projectId,
            ...statusFilter,
          };

          if (data.telemetryServiceIds && data.telemetryServiceIds.length > 0) {
            query.primaryEntityId = new Includes(data.telemetryServiceIds);
          }

          /*
           * Per-status limit equals the final cap: the merged most-recent
           * EXCLUDED_FINGERPRINT_LIMIT groups are necessarily within the
           * top EXCLUDED_FINGERPRINT_LIMIT of their own status query.
           */
          return this.findBy({
            query: query,
            select: {
              _id: true,
              fingerprint: true,
              lastSeenAt: true,
            },
            sort: {
              lastSeenAt: SortOrder.Descending,
            },
            limit: EXCLUDED_FINGERPRINT_LIMIT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });
        },
      ),
    );

    // Merge the status lists most-recently-seen first, dedupe, then cap.
    const merged: Array<Model> = resultsPerStatus
      .flat()
      .sort((a: Model, b: Model): number => {
        return (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
      });

    /*
     * An exception merged into one of these is part of it: its occurrences
     * keep their own fingerprint, so its fingerprint is left out too, right
     * after the one it was merged into. (Merged rows themselves are never in
     * the lists above: their own state does not decide anything any more.)
     */
    const memberFingerprintsById: Map<
      string,
      Array<string>
    > = await this.getMergedFingerprintsBySurvivor({
      projectId: data.projectId,
      survivorIds: merged
        .map((exception: Model): string => {
          return exception.id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    });

    const fingerprints: Set<string> = new Set<string>();
    let truncated: boolean = false;

    for (const exception of merged) {
      if (!exception.fingerprint) {
        continue;
      }
      if (fingerprints.size >= EXCLUDED_FINGERPRINT_LIMIT) {
        truncated = true;
        break;
      }
      fingerprints.add(exception.fingerprint);

      for (const memberFingerprint of memberFingerprintsById.get(
        exception.id?.toString().toLowerCase() || "",
      ) || []) {
        if (fingerprints.size >= EXCLUDED_FINGERPRINT_LIMIT) {
          truncated = true;
          break;
        }
        fingerprints.add(memberFingerprint);
      }
    }

    if (truncated) {
      logger.warn(
        `TelemetryException fingerprint exclusion list for project ${data.projectId.toString()} exceeds ${EXCLUDED_FINGERPRINT_LIMIT}; least recently seen resolved/archived exception groups will still be counted by exception monitors.`,
      );
    }

    return Array.from(fingerprints);
  }

  /*
   * The fingerprints of the exceptions merged into each of `survivorIds`, by
   * the survivor's id in lower case. Read as root: callers hold the
   * survivors already, read with whatever scope they needed.
   */
  @CaptureSpan()
  public async getMergedFingerprintsBySurvivor(data: {
    projectId: ObjectID;
    survivorIds: Array<string>;
  }): Promise<Map<string, Array<string>>> {
    const bySurvivor: Map<string, Array<string>> = new Map();
    const ids: Array<string> = data.survivorIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    if (ids.length === 0) {
      return bySurvivor;
    }

    const members: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        mergedIntoTelemetryExceptionId: QueryHelper.any(ids),
      },
      select: {
        fingerprint: true,
        mergedIntoTelemetryExceptionId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    for (const member of members) {
      const survivorId: string =
        member.mergedIntoTelemetryExceptionId?.toString().toLowerCase() || "";

      if (!survivorId || !member.fingerprint) {
        continue;
      }

      bySurvivor.set(survivorId, [
        ...(bySurvivor.get(survivorId) || []),
        member.fingerprint,
      ]);
    }

    return bySurvivor;
  }

  @CaptureSpan()
  private async aggregateUnresolvedByService(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<DashboardServiceSummary>> {
    /*
     * Assert the caller has read permission on TelemetryException. We don't
     * use the returned filtered query — we run a raw GROUP BY below for
     * efficiency — but this throws if the user lacks read access.
     */
    await ModelPermission.checkReadQueryPermission(
      Model,
      {
        projectId,
        isResolved: false,
        isArchived: false,
      },
      null,
      props,
    );

    interface AggregateRow {
      primaryEntityId: string | null;
      primaryEntityType: string | null;
      unresolvedCount: string;
      totalOccurrences: string | null;
    }

    /*
     * The raw GROUP BY below reads every group of the project, so it is
     * narrowed here to the resources whose exceptions the caller may read -
     * the scope every read of exception groups follows (addExceptionScope).
     */
    const scope: TelemetryReadScope = await this.getExceptionScope(
      props,
      DatabaseRequestType.Read,
    );

    const readableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(scope);
    const blockedIds: Array<string> =
      TelemetryReadScopeUtil.getBlockedIds(scope);

    if (readableIds !== null && readableIds.length === 0) {
      return [];
    }

    const queryBuilder: SelectQueryBuilder<Model> =
      this.getQueryBuilder("TelemetryException");

    if (readableIds !== null) {
      queryBuilder.andWhere(
        `"TelemetryException"."primaryEntityId" IN (:...readableResourceIds)`,
        { readableResourceIds: readableIds },
      );
    }

    if (blockedIds.length > 0) {
      queryBuilder.andWhere(
        `"TelemetryException"."primaryEntityId" NOT IN (:...blockedResourceIds)`,
        { blockedResourceIds: blockedIds },
      );
    }

    const rows: Array<AggregateRow> = (await queryBuilder
      .select(`"TelemetryException"."primaryEntityId"`, "primaryEntityId")
      .addSelect(
        `"TelemetryException"."primaryEntityType"`,
        "primaryEntityType",
      )
      .addSelect(`COUNT(*)`, "unresolvedCount")
      .addSelect(
        `COALESCE(SUM("TelemetryException"."occuranceCount"), 0)`,
        "totalOccurrences",
      )
      .andWhere(`"TelemetryException"."projectId" = :projectId`, {
        projectId: projectId.toString(),
      })
      .andWhere(`"TelemetryException"."isResolved" = false`)
      .andWhere(`"TelemetryException"."isArchived" = false`)
      .andWhere(`"TelemetryException"."deletedAt" IS NULL`)
      // A merged exception counts in the one it was merged into.
      .andWhere(`"TelemetryException"."mergedIntoTelemetryExceptionId" IS NULL`)
      .andWhere(`"TelemetryException"."primaryEntityId" IS NOT NULL`)
      .groupBy(`"TelemetryException"."primaryEntityId"`)
      .addGroupBy(`"TelemetryException"."primaryEntityType"`)
      .orderBy(`"unresolvedCount"`, "DESC")
      .getRawMany()) as Array<AggregateRow>;

    if (rows.length === 0) {
      return [];
    }

    /*
     * primaryEntityId is polymorphic — do NOT resolve it to a Service here. The
     * old code looked each primaryEntityId up in the Service table and dropped
     * any that didn't match, which silently excluded Host / DockerHost /
     * KubernetesCluster and unattributed (Unknown) telemetry. Return the
     * raw (primaryEntityId, primaryEntityType) + counts; the client resolves the
     * display name per primaryEntityType.
     */
    const summaries: Array<DashboardServiceSummary> = [];
    for (const row of rows) {
      if (!row.primaryEntityId) {
        continue;
      }
      summaries.push({
        primaryEntityId: row.primaryEntityId,
        primaryEntityType:
          (row.primaryEntityType as ServiceType | null) ?? null,
        unresolvedCount: parseInt(row.unresolvedCount, 10) || 0,
        totalOccurrences: parseInt(row.totalOccurrences || "0", 10) || 0,
      });
    }

    return summaries;
  }
}

export default new Service();
