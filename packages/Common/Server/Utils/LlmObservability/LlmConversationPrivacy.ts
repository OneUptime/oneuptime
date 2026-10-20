import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isCompanyToolProvider } from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConversationReaders from "../../../Types/LlmObservability/LlmConversationReaders";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import LlmObservabilityConnectionService from "../../Services/LlmObservabilityConnectionService";
import CallerPermission from "../Permission/CallerPermission";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Telemetry/TelemetryReadScope";

/*
 * WHO MAY READ WHAT A COMPANY'S PEOPLE WROTE TO ITS AI TOOLS.
 *
 * A company AI tool connection (Claude Enterprise, Microsoft 365 Copilot)
 * imports its people's chats as AI calls of its own telemetry service. With
 * "Who can read conversations" left at its default - project owners and
 * admins - that service is taken out of everyone else's telemetry read
 * scope: it is added to the scope's blocked resources, which every telemetry
 * read applies (the model reads, the /telemetry/* routes, the conversations
 * routes, the AI tools, exports). So a member who reads every trace of the
 * project still never sees one of those chats - not in Conversations, not
 * in Calls, not in the trace explorer, not through OneUptime's AI.
 *
 * Decided per project from the connections' rows, deleted ones included: a
 * connection that was deleted leaves its chats behind until the service's
 * retention removes them, and they stay restricted until then.
 *
 * Cached for CACHE_TTL_MS per project in each process (most projects have
 * no such connection, and every telemetry read asks); a change made here is
 * seen at once in this process and within CACHE_TTL_MS in the others. A
 * failed lookup throws rather than reading as "nothing restricted": the
 * read fails closed.
 */

const CACHE_TTL_MS: number = 30 * 1000;
const MAX_CACHED_PROJECTS: number = 10_000;

// Who may always read a company AI tool's conversations.
export const LLM_CONVERSATION_ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const restrictedServicesCache: InMemoryTTLCache<Array<string>> =
  new InMemoryTTLCache<Array<string>>(MAX_CACHED_PROJECTS);

interface ConnectionPrivacyRow {
  serviceId: string | null;
  provider: string | null;
  conversationReaders: string | null;
}

/*
 * The tables a company AI tool's chats are kept in. The tools write AI
 * calls (spans) and nothing else; a tool that ever writes another signal
 * adds its table here, or that signal would be readable by everyone.
 */
export const LLM_CONVERSATION_TABLES: Array<string> = [AnalyticsTableName.Span];

export default class LlmConversationPrivacy {
  // Whether reads of this analytics table are held to the restriction.
  public static appliesToTable(tableName: string | undefined): boolean {
    return Boolean(tableName) && LLM_CONVERSATION_TABLES.includes(tableName!);
  }

  /*
   * The services of a project whose conversations only owners and admins may
   * read, as lower-case ids.
   */
  public static async getRestrictedServiceIds(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const cacheKey: string = projectId.toString().toLowerCase();
    const cached: Array<string> | undefined =
      restrictedServicesCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    /*
     * Before the process has a database there is nothing to read from, and
     * nothing is served either: a process only answers requests once
     * Postgres is connected (StartupGate). Unit tests of the read scope run
     * here, with no database, and see no restriction.
     */
    if (!PostgresAppInstance.isConnected()) {
      return [];
    }

    /*
     * Raw SQL on purpose: the model read path leaves soft-deleted rows out,
     * and a deleted connection's chats must stay restricted. Selects three
     * plain columns, none of them secret.
     */
    const rows: Array<ConnectionPrivacyRow> =
      (await LlmObservabilityConnectionService.getRepository().manager.query(
        `SELECT "serviceId", "provider", "conversationReaders" FROM "${new LlmObservabilityConnection().tableName}" WHERE "projectId" = $1 AND "serviceId" IS NOT NULL`,
        [projectId.toString()],
      )) as Array<ConnectionPrivacyRow>;

    const restricted: Array<string> =
      LlmConversationPrivacy.getRestrictedServiceIdsOfRows(rows);

    restrictedServicesCache.set(cacheKey, restricted, CACHE_TTL_MS);

    return restricted;
  }

  /*
   * The rule on rows: a company AI tool's service is restricted unless its
   * connection lets everyone read it. Anything unreadable (a missing or
   * unknown setting) is restricted.
   */
  public static getRestrictedServiceIdsOfRows(
    rows: Array<ConnectionPrivacyRow>,
  ): Array<string> {
    const restricted: Set<string> = new Set<string>();

    for (const row of rows || []) {
      if (!row || !row.serviceId || !isCompanyToolProvider(row.provider)) {
        continue;
      }

      if (row.conversationReaders === LlmConversationReaders.Everyone) {
        continue;
      }

      restricted.add(String(row.serviceId).toLowerCase());
    }

    return Array.from(restricted).sort();
  }

  // Forget a project's answer in this process (after a connection changed).
  public static invalidate(projectId: ObjectID | undefined | null): void {
    if (!projectId) {
      return;
    }

    restrictedServicesCache.delete(projectId.toString().toLowerCase());
  }

  // Test seam.
  public static clearCache(): void {
    restrictedServicesCache.clear();
  }

  // Whether the caller may read every company AI tool's conversations in a project.
  public static mayReadRestricted(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsAnyOf(
      props,
      LLM_CONVERSATION_ADMIN_PERMISSIONS,
      { projectId },
    );
  }

  /*
   * The projects a read is about: the request's own, or - for a read across
   * the caller's projects - every project the caller belongs to.
   */
  public static getProjectsOfRead(
    props: DatabaseCommonInteractionProps,
  ): Array<ObjectID> {
    if (props.tenantId) {
      return [props.tenantId];
    }

    return Object.keys(props.userTenantAccessPermission || {})
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /*
   * The scope with every restricted service the caller may not read taken
   * away: added to the blocked resources (which every reader of a scope
   * applies) and removed from the readable ones.
   */
  public static async restrictScope(data: {
    scope: TelemetryReadScope;
    props: DatabaseCommonInteractionProps;
  }): Promise<TelemetryReadScope> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return data.scope;
    }

    const blocked: Array<string> = [];

    for (const projectId of LlmConversationPrivacy.getProjectsOfRead(
      data.props,
    )) {
      if (LlmConversationPrivacy.mayReadRestricted(data.props, projectId)) {
        continue;
      }

      blocked.push(
        ...(await LlmConversationPrivacy.getRestrictedServiceIds(projectId)),
      );
    }

    return LlmConversationPrivacy.blockServices(data.scope, blocked);
  }

  // A scope with these resources blocked as well. Pure.
  public static blockServices(
    scope: TelemetryReadScope,
    serviceIds: Array<string>,
  ): TelemetryReadScope {
    if (serviceIds.length === 0) {
      return scope;
    }

    const blockedIds: Array<string> = Array.from(
      new Set<string>([
        ...TelemetryReadScopeUtil.getBlockedIds(scope),
        ...serviceIds.map((id: string): string => {
          return TelemetryReadScopeUtil.normalizeId(id);
        }),
      ]),
    );

    return {
      readableIds:
        scope.readableIds === null
          ? null
          : TelemetryReadScopeUtil.filterReadableIds(
              { readableIds: null, blockedIds: blockedIds },
              scope.readableIds,
            ),
      blockedIds: blockedIds,
    };
  }
}
