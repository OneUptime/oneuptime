import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import AIRunType from "../../../Types/AI/AIRunType";
import Text from "../../../Types/Text";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";
import AIRunOutputReadFilter from "./AIRunOutputReadFilter";
import { Raw } from "typeorm";

/*
 * AIRun mixes two kinds of row under one table:
 *
 *  - Chat and investigation runs are PERSONAL. They hang off a conversation
 *    and carry the user's own prompt trail, so only their author may read
 *    them. This is what AIChatPrivacyFilter's flat pin protects, and that pin
 *    stays exactly as it is for AIConversation, AIConversationMessage and
 *    AIRunEvent.
 *  - CodeFix runs are a SHARED TEAM ARTIFACT: they are triggered off an
 *    exception or an incident, they produce a pull request, and their child
 *    AIAgentTaskPullRequest rows are already project-readable through the
 *    standard CRUD. `userId` on a CodeFix run is attribution only (who
 *    clicked "Fix with AI Agent") and is null for automatic triggers — it
 *    carries no conversational content.
 *
 * So AIRun cannot use that flat pin. It needs `runType = CodeFix OR userId =
 * <caller>`, a CROSS-COLUMN disjunction, which a query object cannot express
 * (query objects are conjunctions).
 *
 * The clause below is built ENTIRELY from server state and AND-ed onto the
 * caller's query. It never READS query.runType to decide anything — that
 * would be unsound, because onBeforeFind runs BEFORE QueryUtil.serializeQuery,
 * so query.runType here is still a raw, client-controlled operator object
 * whose .value/.toString() are identical across the safe and hostile cases:
 * LessThan("CodeFix") stringifies to exactly "CodeFix" but compiles to
 * `runType < 'CodeFix'`, which matches "Chat". Because the clause is forced, a
 * caller-supplied runType filter can only ever NARROW it, and
 * combineWithPrivacyClause fails closed on operator shapes it does not
 * recognize.
 *
 * Modelled on Utils/Incident/IncidentPrivacyFilter, which solves the same
 * "unrestricted rows for everyone, restricted rows only for their owner"
 * shape.
 */
export function getAIRunPrivacyRaw(
  props: DatabaseCommonInteractionProps,
): FindWhereProperty<any> | undefined {
  if (props.isRoot || props.isMasterAdmin) {
    return undefined;
  }

  /*
   * The same hard gate the flat pin has, and it must stay. A caller with no
   * user — a project API key, which gets userTenantAccessPermission but never
   * userAuthorization (see ProjectAuthorization), so props.userId is
   * undefined — has no personal scope. Today such a caller cannot read AIRun
   * at all. Letting CodeFix rows through here would hand every API key holding
   * ProjectMember the project's whole fix history: access that neither
   * /ai-run nor /code-fix-run grants today. That is a separate product
   * decision and must not ride in as a side effect of this filter.
   */
  /*
   * No credentials at all is an expired session, not someone else's data:
   * 401 so the client refreshes. The countBy overrides reach this before the
   * permission layer's own login check does.
   */
  DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(props);

  if (!props.userId) {
    throw new NotAuthorizedException(
      "AI runs are personal and can only be accessed by the user who created them.",
    );
  }

  const userIdRid: string = "aiRunUid_" + Text.generateRandomText(10);
  const runTypeRid: string = "aiRunType_" + Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      return `(${alias} = :${runTypeRid} OR "AIRun"."userId" = :${userIdRid})`;
    },
    {
      [runTypeRid]: AIRunType.CodeFix,
      [userIdRid]: props.userId.toString(),
    },
  );
}

/*
 * Applies the clause above on AIRun.runType. Project isolation is unaffected:
 * @TenantColumn("projectId") independently forces projectId = <tenant>, so
 * "CodeFix runs are readable" always means "in YOUR project".
 *
 * And, as everything done about a private incident or alert is, a run about
 * one is read only by those who see that record (#9165): a CodeFix run
 * OneUptime AI opened a fix pull request with from a private incident's
 * investigation is the project's to read only where the incident is - its
 * owners, Project Owners and Project Admins - and a run about a record that
 * is gone, only Project Owners and Project Admins. So is a Code task asked
 * from a private record's fix, and every turn of such a task
 * (AIRunOutputReadFilter.applyToRunRow, the rule its Runner jobs and pull
 * request follow). It holds for every kind of run: a person's own chat or
 * investigation about a private record they no longer see is not theirs
 * to read either.
 */
export function applyAIRunPrivacyFilter<TQuery>(
  query: TQuery,
  props: DatabaseCommonInteractionProps,
): TQuery {
  const rawClause: FindWhereProperty<any> | undefined =
    getAIRunPrivacyRaw(props);

  if (!rawClause) {
    return query;
  }

  const filtered: TQuery = (query || {}) as TQuery;

  (filtered as any).runType = combineWithPrivacyClause(
    (filtered as any).runType,
    rawClause,
  );

  return AIRunOutputReadFilter.applyToRunRow(filtered, props);
}
