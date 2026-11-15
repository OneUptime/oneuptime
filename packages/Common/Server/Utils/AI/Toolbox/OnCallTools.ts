import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { sortLabelNames } from "../../../../Utils/LabelOrder";
import { isOnCallDirectPage } from "../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import {
  AIChatCitationTargetType,
  AIChatWidgetColumn,
} from "../../../../Types/AI/AIChatTypes";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import UserOnCallLogService from "../../../Services/UserOnCallLogService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  EscalationRuleCardData,
  getOnCallPolicyCardWords,
  getOnCallScheduleCardWords,
} from "./ReadCardWords";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { translationKey } from "../../../../Types/Translator";
import {
  AI_READ_CARD_LINES,
  AIActionSentence,
  AIActionSentenceValue,
  AIActionTableCell,
  aiActionPluralSentence,
  aiActionSentence,
  describeAIActionTableCell,
  AI_READ_CARD_NAME,
  aiActionFigure,
  aiActionList,
  aiActionTerm,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  AI_READ_CITATIONS,
  AI_READ_RECORD_TABLE_CELLS,
  AI_READ_RECORD_TABLE_LINES,
  AI_READ_RECORD_TABLE_PLURAL_SENTENCES,
  AI_READ_RECORD_TABLE_TITLES,
  AI_TOOL_CITATIONS,
  AI_READ_ESCALATION_CHAIN,
  AI_READ_ESCALATION_CHAIN_TERMS,
  AI_READ_ON_CALL_PAGE_STATUSES,
  AI_READ_NOTIFICATION_STATUSES,
} from "../../../../Types/AI/AIReadTableWords";
import {
  citationSentence,
  countFigure,
  respondersValue,
} from "./ReadTableWords";

/*
 * Derived from the model ACLs so the tool gates can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedPolicyReadPermissions: Array<Permission> | null = null;
const resolvePolicyReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedPolicyReadPermissions) {
      cachedPolicyReadPermissions = new OnCallDutyPolicy().getReadPermissions();
    }
    return cachedPolicyReadPermissions;
  };

let cachedScheduleReadPermissions: Array<Permission> | null = null;
const resolveScheduleReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedScheduleReadPermissions) {
      cachedScheduleReadPermissions =
        new OnCallDutyPolicySchedule().getReadPermissions();
    }
    return cachedScheduleReadPermissions;
  };

let cachedExecutionLogReadPermissions: Array<Permission> | null = null;
const resolveExecutionLogReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedExecutionLogReadPermissions) {
      cachedExecutionLogReadPermissions =
        new OnCallDutyPolicyExecutionLog().getReadPermissions();
    }
    return cachedExecutionLogReadPermissions;
  };

/*
 * "Nobody on call" is a state worth naming, not missing data — an uncovered
 * schedule must never render as a silent blank the model glosses over.
 */
const NO_ONE_ON_CALL: string = AI_READ_CARD_LINES.noOneOnCall;

/*
 * What a rule that pages the next person in a schedule's rotation pages, for
 * the assistant: never the person on call (task oncall-escalate-next-in-
 * rotation).
 */
export const NEXT_IN_ROTATION_TARGET_NOTE: string =
  "next in rotation: the person after whoever is on call, passing over anyone away";
const SCHEDULE_NOT_ACCESSIBLE: string =
  AI_READ_RECORD_TABLE_CELLS.scheduleNotAccessible;

function nameOf(user: User | undefined | null): string | undefined {
  const displayName: string = user?.name?.toString().trim() || "";
  if (displayName.length > 0) {
    return displayName;
  }
  return user?.id ? user.id.toString() : undefined;
}

interface EscalationRuleTargets {
  users: Array<string>;
  teams: Array<string>;
  schedules: Array<string>;
  /*
   * The schedules a rule pages the next in rotation of, by their entry in
   * `schedules` ("Primary (next in rotation: ...)"): the table words them.
   */
  nextInRotation?: Set<string> | undefined;
}

interface PolicyEscalationData {
  rulesByPolicyId: Map<string, Array<OnCallDutyPolicyEscalationRule>>;
  targetsByRuleId: Map<string, EscalationRuleTargets>;
  ruleUsers: Array<OnCallDutyPolicyEscalationRuleUser>;
  ruleTeams: Array<OnCallDutyPolicyEscalationRuleTeam>;
  ruleSchedules: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

function getOrCreateTargets(
  targetsByRuleId: Map<string, EscalationRuleTargets>,
  ruleId: string,
): EscalationRuleTargets {
  let targets: EscalationRuleTargets | undefined = targetsByRuleId.get(ruleId);
  if (!targets) {
    targets = { users: [], teams: [], schedules: [] };
    targetsByRuleId.set(ruleId, targets);
  }
  return targets;
}

/*
 * Loads the escalation rules of the given policies together with what each
 * rule pages (direct users, teams, schedules). Every query runs under the
 * requesting user's props so RBAC applies — this tool never widens access.
 */
async function fetchEscalationData(
  policyIds: Array<ObjectID>,
  ctx: ToolContext,
): Promise<PolicyEscalationData> {
  const data: PolicyEscalationData = {
    rulesByPolicyId: new Map<string, Array<OnCallDutyPolicyEscalationRule>>(),
    targetsByRuleId: new Map<string, EscalationRuleTargets>(),
    ruleUsers: [],
    ruleTeams: [],
    ruleSchedules: [],
  };

  if (policyIds.length === 0) {
    return data;
  }

  /*
   * The four sources are independent (all filter on the same policy ids) —
   * fetch them in parallel; serially they were the dominant tool latency.
   */
  const [rules, ruleUsers, ruleTeams, ruleSchedules] = await Promise.all([
    OnCallDutyPolicyEscalationRuleService.findBy({
      query: {
        onCallDutyPolicyId: QueryHelper.any(policyIds),
      },
      select: {
        _id: true,
        name: true,
        order: true,
        escalateAfterInMinutes: true,
        onCallDutyPolicyId: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    OnCallDutyPolicyEscalationRuleUserService.findBy({
      query: {
        onCallDutyPolicyId: QueryHelper.any(policyIds),
      },
      select: {
        _id: true,
        onCallDutyPolicyEscalationRuleId: true,
        user: {
          _id: true,
          name: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    OnCallDutyPolicyEscalationRuleTeamService.findBy({
      query: {
        onCallDutyPolicyId: QueryHelper.any(policyIds),
      },
      select: {
        _id: true,
        onCallDutyPolicyEscalationRuleId: true,
        team: {
          _id: true,
          name: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
    OnCallDutyPolicyEscalationRuleScheduleService.findBy({
      query: {
        onCallDutyPolicyId: QueryHelper.any(policyIds),
      },
      select: {
        _id: true,
        onCallDutyPolicyEscalationRuleId: true,
        onCallDutyPolicyScheduleId: true,
        // Whoever is on call in it, or the next person in its rotation.
        pageNextInRotation: true,
        onCallDutyPolicySchedule: {
          _id: true,
          name: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: ctx.props,
    }),
  ]);

  data.ruleUsers = ruleUsers;
  data.ruleTeams = ruleTeams;
  data.ruleSchedules = ruleSchedules;

  for (const rule of rules) {
    const policyKey: string = rule.onCallDutyPolicyId?.toString() || "";
    const existing: Array<OnCallDutyPolicyEscalationRule> =
      data.rulesByPolicyId.get(policyKey) || [];
    existing.push(rule);
    data.rulesByPolicyId.set(policyKey, existing);
  }

  for (const link of data.ruleUsers) {
    const ruleKey: string =
      link.onCallDutyPolicyEscalationRuleId?.toString() || "";
    if (!ruleKey) {
      continue;
    }
    getOrCreateTargets(data.targetsByRuleId, ruleKey).users.push(
      nameOf(link.user) || "Unknown user",
    );
  }

  for (const link of data.ruleTeams) {
    const ruleKey: string =
      link.onCallDutyPolicyEscalationRuleId?.toString() || "";
    if (!ruleKey) {
      continue;
    }
    getOrCreateTargets(data.targetsByRuleId, ruleKey).teams.push(
      link.team?.name || "Unknown team",
    );
  }

  for (const link of data.ruleSchedules) {
    const ruleKey: string =
      link.onCallDutyPolicyEscalationRuleId?.toString() || "";
    if (!ruleKey) {
      continue;
    }
    const scheduleName: string =
      link.onCallDutyPolicySchedule?.name || "Unknown schedule";

    const targets: EscalationRuleTargets = getOrCreateTargets(
      data.targetsByRuleId,
      ruleKey,
    );
    const entry: string = link.pageNextInRotation
      ? `${scheduleName} (${NEXT_IN_ROTATION_TARGET_NOTE})`
      : scheduleName;

    targets.schedules.push(entry);

    if (link.pageNextInRotation) {
      targets.nextInRotation = targets.nextInRotation || new Set<string>();
      targets.nextInRotation.add(entry);
    }
  }

  return data;
}

function formatEscalationChain(
  rules: Array<OnCallDutyPolicyEscalationRule>,
  targetsByRuleId: Map<string, EscalationRuleTargets>,
): string {
  if (rules.length === 0) {
    return AI_READ_RECORD_TABLE_CELLS.noEscalationRules;
  }

  return rules
    .map((rule: OnCallDutyPolicyEscalationRule): string => {
      return describeAIActionSentence(
        getEscalationRuleWords(
          rule,
          targetsByRuleId.get(rule.id?.toString() || ""),
        ),
      );
    })
    .join(" | ");
}

/*
 * One rule of a policy's chain, as words (issue #8313): its place, its
 * name, whom it pages - "users [Ana]", the kinds in the reader's language
 * and the names as named - and when it escalates. Its English is what
 * formatEscalationChain says of it to the model.
 */
export function getEscalationRuleWords(
  rule: Pick<
    OnCallDutyPolicyEscalationRule,
    "order" | "name" | "escalateAfterInMinutes"
  >,
  targets: EscalationRuleTargets | undefined,
): AIActionSentence {
  const names: (list: Array<string>) => AIActionSentenceValue = (
    list: Array<string>,
  ): AIActionSentenceValue => {
    return aiActionList(
      list.map((name: string): AIActionSentence => {
        return aiActionSentence(AI_READ_CARD_NAME, { name });
      }),
    );
  };
  const groups: Array<AIActionSentence> = [];

  if (targets && targets.users.length > 0) {
    groups.push(
      aiActionSentence(AI_READ_ESCALATION_CHAIN.users, {
        names: names(targets.users),
      }),
    );
  }

  if (targets && targets.teams.length > 0) {
    groups.push(
      aiActionSentence(AI_READ_ESCALATION_CHAIN.teams, {
        names: names(targets.teams),
      }),
    );
  }

  if (targets && targets.schedules.length > 0) {
    const suffix: string = ` (${NEXT_IN_ROTATION_TARGET_NOTE})`;

    groups.push(
      aiActionSentence(AI_READ_ESCALATION_CHAIN.schedules, {
        names: aiActionList(
          targets.schedules.map((entry: string): AIActionSentence => {
            return targets.nextInRotation?.has(entry) && entry.endsWith(suffix)
              ? aiActionSentence(AI_READ_ESCALATION_CHAIN.nextInRotation, {
                  name: entry.slice(0, -suffix.length),
                })
              : aiActionSentence(AI_READ_CARD_NAME, { name: entry });
          }),
        ),
      }),
    );
  }

  const values: Record<string, AIActionSentenceValue> = {
    order:
      typeof rule.order === "number" && Number.isFinite(rule.order)
        ? aiActionFigure(rule.order)
        : "?",
    name: rule.name || aiActionTerm(AI_READ_ESCALATION_CHAIN_TERMS.unnamedRule),
    targets:
      groups.length > 0
        ? aiActionList(groups)
        : aiActionTerm(AI_READ_ESCALATION_CHAIN_TERMS.noTargets),
  };

  return rule.escalateAfterInMinutes
    ? aiActionSentence(AI_READ_ESCALATION_CHAIN.ruleEscalates, {
        ...values,
        minutes: aiActionFigure(rule.escalateAfterInMinutes),
      })
    : aiActionSentence(AI_READ_ESCALATION_CHAIN.rule, values);
}

/*
 * A policy's chain as the table's cell (issue #8313): each rule's words, in
 * a list the reader's language joins; no rules said so.
 */
export function getEscalationChainCell(
  rules: Array<OnCallDutyPolicyEscalationRule>,
  targetsByRuleId: Map<string, EscalationRuleTargets>,
): AIActionSentence {
  if (rules.length === 0) {
    return aiActionSentence(AI_READ_RECORD_TABLE_CELLS.noEscalationRules);
  }

  return aiActionSentence(AI_READ_CARD_NAME, {
    name: aiActionList(
      rules.map((rule: OnCallDutyPolicyEscalationRule): AIActionSentence => {
        return getEscalationRuleWords(
          rule,
          targetsByRuleId.get(rule.id?.toString() || ""),
        );
      }),
    ),
  });
}

/*
 * Who a page notified, and how it went, as words (issue #8313): "Ana:
 * Completed (acknowledged)" - the status in the reader's language when it
 * is one of OneUptime's, else as stored.
 */
export function getNotifiedPersonWords(data: {
  name: string;
  status: string;
  isAcknowledged: boolean;
}): AIActionSentence {
  const status: AIActionSentenceValue = AI_READ_NOTIFICATION_STATUSES.includes(
    data.status,
  )
    ? aiActionTerm(data.status)
    : data.status;

  return aiActionSentence(
    data.isAcknowledged
      ? AI_READ_ESCALATION_CHAIN.notifiedPersonAcknowledged
      : AI_READ_ESCALATION_CHAIN.notifiedPerson,
    { name: data.name, status },
  );
}

/*
 * An archived on-call policy pages no one. The list leaves archived policies
 * out (as the On-Call Policies page does), so the model never suggests paging
 * one; read by id, one is still returned, flagged, with this said alongside.
 */
export const ARCHIVED_ON_CALL_POLICY_NOTE: string =
  AI_READ_RECORD_TABLE_LINES.onCallPolicyArchived;

/*
 * ---------------------------------------------------------------------------
 * query_on_call_policies — discover policies and their escalation chains.
 * ---------------------------------------------------------------------------
 */
export const QueryOnCallPoliciesTool: ObservabilityTool = {
  name: "query_on_call_policies",
  description:
    "Query on-call policies in this project — who gets paged and in what order. List mode returns each policy (id, name, description) with its escalation rule chain: rule order plus the users, teams and schedules each rule pages. Pass onCallPolicyId to get full details of one policy. Archived policies page no one and are left out of the list. Use this to find the id to pass to page_on_call_policy, get_on_call_status or query_on_call_pages.",
  inputSchema: {
    type: "object",
    properties: {
      onCallPolicyId: {
        type: "string",
        description:
          "Get one on-call policy by its ID (includes description, labels and the full escalation chain).",
      },
      limit: {
        type: "number",
        description: "Maximum policies to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip, for paging through long policy lists (default 0, max 500).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolvePolicyReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const onCallPolicyId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "onCallPolicyId",
    );

    if (onCallPolicyId) {
      const policy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: onCallPolicyId,
          select: {
            _id: true,
            name: true,
            description: true,
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
            isArchived: true,
            labels: {
              name: true,
            },
          },
          props: ctx.props,
        });

      const escalation: PolicyEscalationData = policy
        ? await fetchEscalationData([onCallPolicyId], ctx)
        : {
            rulesByPolicyId: new Map<
              string,
              Array<OnCallDutyPolicyEscalationRule>
            >(),
            targetsByRuleId: new Map<string, EscalationRuleTargets>(),
            ruleUsers: [],
            ruleTeams: [],
            ruleSchedules: [],
          };

      const rules: Array<OnCallDutyPolicyEscalationRule> =
        escalation.rulesByPolicyId.get(onCallPolicyId.toString()) || [];

      // In natural order, as labels are listed everywhere (Utils/LabelOrder).
      const policyLabels: string = sortLabelNames(
        (policy?.labels || []).map((label: { name?: string }) => {
          return label.name || "";
        }),
      ).join(", ");

      const rows: Array<JSONObject> = policy
        ? [
            {
              id: policy.id?.toString(),
              name: policy.name,
              description: policy.description,
              labels: policyLabels || undefined,
              repeatsIfNoOneAcknowledges:
                policy.repeatPolicyIfNoOneAcknowledges,
              repeatCount: policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes,
              escalationRuleCount: rules.length,
              escalationChain: formatEscalationChain(
                rules,
                escalation.targetsByRuleId,
              ),
              archived: policy.isArchived === true ? true : undefined,
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      // Each rule as the card says it: whom it pages, by kind and name.
      const ruleCards: Array<EscalationRuleCardData> = rules.map(
        (rule: OnCallDutyPolicyEscalationRule): EscalationRuleCardData => {
          const targets: EscalationRuleTargets | undefined =
            escalation.targetsByRuleId.get(rule.id?.toString() || "");
          return {
            order: rule.order,
            name: rule.name,
            users: targets?.users || [],
            teams: targets?.teams || [],
            schedules: targets?.schedules || [],
            escalateAfterInMinutes: rule.escalateAfterInMinutes,
          };
        },
      );

      return {
        dataForLlm:
          policy?.isArchived === true
            ? `${ARCHIVED_ON_CALL_POLICY_NOTE}\n${serialized.text}`
            : serialized.text,
        rowCount: serialized.rowCount,
        ...citationSentence(AI_READ_CITATIONS.onCallPolicy, {
          policy: policy?.name || onCallPolicyId.toString(),
        }),
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: onCallPolicyId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: policy
          ? WidgetBuilder.resourceCard({
              title: `On-call policy: ${policy.name || ""}`.trim(),
              heading: policy.name || onCallPolicyId.toString(),
              // In the reader's language (issue #7175).
              words: getOnCallPolicyCardWords({
                description: policy.description || undefined,
                isArchived: policy.isArchived === true,
                rules: ruleCards,
              }),
              link: {
                type: AIChatCitationTargetType.OnCallPolicyView,
                params: { onCallDutyPolicyId: onCallPolicyId.toString() },
              },
            })
          : undefined,
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    /*
     * Archived policies page no one and are hidden from the On-Call Policies
     * list, so they are left out here too: the assistant should not suggest
     * paging one. A single archived policy is still readable by its id above.
     */
    const totalCount: PositiveNumber = await OnCallDutyPolicyService.countBy({
      query: { isArchived: false },
      props: ctx.props,
    });

    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: { isArchived: false },
        select: {
          _id: true,
          name: true,
          description: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: limit,
        skip: skip,
        props: ctx.props,
      });

    const policyIds: Array<ObjectID> = policies
      .map((policy: OnCallDutyPolicy) => {
        return policy.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    const escalation: PolicyEscalationData = await fetchEscalationData(
      policyIds,
      ctx,
    );

    // Each policy's chain, as words (issue #8313), row by row.
    const chainCells: Array<AIActionSentence> = policies.map(
      (policy: OnCallDutyPolicy): AIActionSentence => {
        return getEscalationChainCell(
          escalation.rulesByPolicyId.get(policy.id?.toString() || "") || [],
          escalation.targetsByRuleId,
        );
      },
    );

    const rows: Array<JSONObject> = policies.map((policy: OnCallDutyPolicy) => {
      const rules: Array<OnCallDutyPolicyEscalationRule> =
        escalation.rulesByPolicyId.get(policy.id?.toString() || "") || [];
      return {
        id: policy.id?.toString(),
        name: policy.name,
        description: policy.description,
        escalationChain: formatEscalationChain(
          rules,
          escalation.targetsByRuleId,
        ),
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const total: number = totalCount.toNumber();
    const hasMore: boolean = total > rows.length && rows.length > 0;
    const dataForLlm: string = hasMore
      ? `Showing rows ${skip + 1}–${skip + rows.length} of ${total} total. Pass skip to page further.\n${serialized.text}`
      : serialized.text;

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      // In the reader's language (issue #7980).
      ...(hasMore
        ? citationSentence(AI_READ_CITATIONS.onCallPoliciesPaged, {
            count: countFigure(rows.length),
            total: countFigure(total),
          })
        : citationSentence(AI_READ_CITATIONS.onCallPolicies, {
            count: countFigure(serialized.rowCount),
          })),
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicies,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              // In the reader's language (issue #7977).
              words: {
                title: aiActionSentence(
                  AI_READ_RECORD_TABLE_TITLES.onCallPolicies,
                  { count: countFigure(rows.length) },
                ),
                /*
                 * Each chain in the reader's language (issue #8313): its
                 * kinds of target and its escalation, the names as named.
                 */
                cells: chainCells.map(
                  (
                    escalationChain: AIActionSentence,
                  ): Record<string, AIActionTableCell> => {
                    return { escalationChain };
                  },
                ),
              },
              columns: [
                { key: "name", title: translationKey("Policy"), type: "text" },
                {
                  key: "description",
                  title: translationKey("Description"),
                  type: "text",
                },
                {
                  key: "escalationChain",
                  title: translationKey("Escalation chain"),
                  type: "text",
                },
              ],
              rows: rows,
              link: { type: AIChatCitationTargetType.OnCallPolicies },
            })
          : undefined,
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * get_on_call_status — who is on call RIGHT NOW.
 * ---------------------------------------------------------------------------
 */

/*
 * Roster fields are persisted on the schedule and refreshed by the
 * RefreshHandoffTime worker — the same source the dashboard's "On Call Now"
 * column reads. Reading them costs one RBAC-checked query instead of
 * re-resolving schedule layers per request.
 *
 * They include user overrides, with one documented limit: the roster is
 * resolved in a policy's context only when the schedule is attached to exactly
 * one on-call policy (OnCallDutyPolicyScheduleService.getSingleAttachedPolicyId).
 * A schedule shared by two or more policies gets a policy-blind roster —
 * global overrides only — because a single stored roster cannot represent
 * divergent per-policy substitutions. Alert routing always resolves live with
 * the escalating policy's id, so it is unaffected.
 */
const scheduleRosterSelect: Select<OnCallDutyPolicySchedule> = {
  _id: true,
  name: true,
  currentUserOnRoster: {
    _id: true,
    name: true,
  },
  nextUserOnRoster: {
    _id: true,
    name: true,
  },
  rosterStartAt: true,
  rosterHandoffAt: true,
  rosterNextStartAt: true,
};

/*
 * The rows of "who is on call now", and the cells of each that are
 * OneUptime's words (issue #7977): which schedule or rule a row is, and
 * "No one is on call" - said in the reader's language by the chat's
 * table, the names in them as named. Each row's text is its words in
 * English, so the model reads what the table stores.
 */
interface WordedRows {
  rows: Array<JSONObject>;
  cells: Array<Record<string, AIActionTableCell>>;
}

function pushWordedRow(
  target: WordedRows,
  row: JSONObject,
  cells: Record<string, AIActionTableCell>,
): void {
  const stored: JSONObject = { ...row };

  for (const key of Object.keys(cells)) {
    stored[key] = describeAIActionTableCell(cells[key]!);
  }

  target.rows.push(stored);
  target.cells.push(cells);
}

// A rule's place in its policy's order, as a figure; "?" when it has none.
function ruleOrderValue(
  rule: OnCallDutyPolicyEscalationRule,
): AIActionSentenceValue {
  return typeof rule.order === "number" ? countFigure(rule.order) : "?";
}

function scheduleSentence(
  schedule: OnCallDutyPolicySchedule,
): AIActionSentence {
  return aiActionSentence(AI_READ_RECORD_TABLE_CELLS.schedule, {
    name: schedule.name || "",
  });
}

function pushScheduleStatusRow(
  target: WordedRows,
  schedule: OnCallDutyPolicySchedule,
  source?: AIActionSentence,
): void {
  const currentName: string | undefined = nameOf(schedule.currentUserOnRoster);

  pushWordedRow(
    target,
    {
      scheduleId: schedule.id?.toString(),
      // Its words below, in English.
      source: "",
      onCallNow: currentName || "",
      onCallUserId: schedule.currentUserOnRoster?.id?.toString(),
      onCallSince: schedule.rosterStartAt,
      handsOffAt: schedule.rosterHandoffAt,
      nextUp: nameOf(schedule.nextUserOnRoster),
      nextStartsAt: schedule.rosterNextStartAt,
    },
    {
      source: source ?? scheduleSentence(schedule),
      ...(currentName
        ? {}
        : { onCallNow: aiActionSentence(AI_READ_CARD_LINES.noOneOnCall) }),
    },
  );
}

function scheduleStatusRow(schedule: OnCallDutyPolicySchedule): JSONObject {
  const target: WordedRows = { rows: [], cells: [] };

  pushScheduleStatusRow(target, schedule);

  return target.rows[0]!;
}

/*
 * Distinct responders across rows: schedule/direct rows dedupe on user id,
 * team rows count once per team. Sentinel rows ("no one", inaccessible) are
 * excluded so the headline count never inflates.
 */
function countResponders(rows: Array<JSONObject>): number {
  const responderKeys: Set<string> = new Set<string>();
  for (const row of rows) {
    const userId: string | undefined = row["onCallUserId"] as
      | string
      | undefined;
    const who: string | undefined = row["onCallNow"] as string | undefined;
    if (userId) {
      responderKeys.add(`user:${userId}`);
    } else if (
      who &&
      who !== NO_ONE_ON_CALL &&
      who !== SCHEDULE_NOT_ACCESSIBLE
    ) {
      responderKeys.add(`who:${who}`);
    }
  }
  return responderKeys.size;
}

const onCallStatusColumns: Array<AIChatWidgetColumn> = [
  { key: "source", title: translationKey("Schedule / rule"), type: "text" },
  { key: "onCallNow", title: translationKey("On call now"), type: "text" },
  { key: "onCallSince", title: translationKey("Since"), type: "date" },
  { key: "handsOffAt", title: translationKey("Hands off"), type: "date" },
  { key: "nextUp", title: translationKey("Next up"), type: "text" },
  { key: "nextStartsAt", title: translationKey("Next starts"), type: "date" },
];

export const GetOnCallStatusTool: ObservabilityTool = {
  name: "get_on_call_status",
  description:
    "Who is on call RIGHT NOW. With no arguments, returns every on-call schedule in the project with the user currently on the roster, since when, when they hand off, and who is up next. Pass scheduleId for one schedule, or onCallPolicyId to see who each escalation rule of that policy would page (direct users, whole teams, and the current on-roster user of each linked schedule). Find ids with query_on_call_policies. Roster data is kept fresh by the platform (refreshed about every minute, overrides included).",
  inputSchema: {
    type: "object",
    properties: {
      scheduleId: {
        type: "string",
        description: "Get the current on-call status of one schedule by ID.",
      },
      onCallPolicyId: {
        type: "string",
        description:
          "Get who would be paged by each escalation rule of this on-call policy. Find the id with query_on_call_policies.",
      },
      limit: {
        type: "number",
        description:
          "Maximum schedules to return when listing all (default 20, max 50).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveScheduleReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const scheduleId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "scheduleId",
    );
    const onCallPolicyId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "onCallPolicyId",
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 20,
      min: 1,
      max: 50,
    });

    if (scheduleId) {
      const schedule: OnCallDutyPolicySchedule | null =
        await OnCallDutyPolicyScheduleService.findOneById({
          id: scheduleId,
          select: scheduleRosterSelect,
          props: ctx.props,
        });

      const rows: Array<JSONObject> = schedule
        ? [scheduleStatusRow(schedule)]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const onCallNow: string =
        (rows[0]?.["onCallNow"] as string | undefined) || NO_ONE_ON_CALL;

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        ...citationSentence(AI_READ_CITATIONS.onCallNowForSchedule, {
          schedule: schedule?.name || scheduleId.toString(),
        }),
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicies,
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: schedule
          ? WidgetBuilder.resourceCard({
              title: `On-call schedule '${schedule.name || ""}'`.trim(),
              heading: schedule.name || scheduleId.toString(),
              /*
               * In the reader's language (issue #7175): who is on call by
               * name, and the shift's moments in the reader's time zone.
               */
              words: getOnCallScheduleCardWords({
                onCallNow: onCallNow === NO_ONE_ON_CALL ? undefined : onCallNow,
                rosterStartAt: schedule.rosterStartAt || undefined,
                rosterHandoffAt: schedule.rosterHandoffAt || undefined,
                nextUp: nameOf(schedule.nextUserOnRoster),
                rosterNextStartAt: schedule.rosterNextStartAt || undefined,
              }),
              link: { type: AIChatCitationTargetType.OnCallPolicies },
            })
          : undefined,
      };
    }

    if (onCallPolicyId) {
      const policy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: onCallPolicyId,
          select: {
            _id: true,
            name: true,
            isArchived: true,
          },
          props: ctx.props,
        });

      if (!policy) {
        return {
          dataForLlm:
            "(no rows found) — on-call policy not found or not accessible. Find valid ids with query_on_call_policies.",
          rowCount: 0,
          // In the reader's language (issue #8311).
          ...citationSentence(AI_TOOL_CITATIONS.onCallNowPolicyNotFound),
          citationTarget: {
            type: AIChatCitationTargetType.OnCallPolicies,
          },
          redactionCount: 0,
          isTruncated: false,
        };
      }

      const escalation: PolicyEscalationData = await fetchEscalationData(
        [onCallPolicyId],
        ctx,
      );

      const scheduleIds: Array<ObjectID> = escalation.ruleSchedules
        .map((link: OnCallDutyPolicyEscalationRuleSchedule) => {
          return (
            link.onCallDutyPolicyScheduleId ||
            link.onCallDutyPolicySchedule?.id ||
            null
          );
        })
        .filter((id: ObjectID | null): id is ObjectID => {
          return Boolean(id);
        });

      const schedules: Array<OnCallDutyPolicySchedule> =
        scheduleIds.length > 0
          ? await OnCallDutyPolicyScheduleService.findBy({
              query: {
                _id: QueryHelper.any(scheduleIds),
              },
              select: scheduleRosterSelect,
              sort: {
                name: SortOrder.Ascending,
              },
              /*
               * Sized to the id list, NOT the caller's row limit: this fetch
               * exists to resolve every schedule the escalation rules
               * reference — capping it short would make the fallback below
               * falsely report readable schedules as "not accessible".
               */
              limit: scheduleIds.length,
              skip: 0,
              props: ctx.props,
            })
          : [];

      const scheduleById: Map<string, OnCallDutyPolicySchedule> = new Map<
        string,
        OnCallDutyPolicySchedule
      >();
      for (const schedule of schedules) {
        scheduleById.set(schedule.id?.toString() || "", schedule);
      }

      const rules: Array<OnCallDutyPolicyEscalationRule> =
        escalation.rulesByPolicyId.get(onCallPolicyId.toString()) || [];

      // Each row with the cells of it that are OneUptime's words (#7977).
      const worded: WordedRows = { rows: [], cells: [] };
      const rows: Array<JSONObject> = worded.rows;

      for (const rule of rules) {
        const ruleKey: string = rule.id?.toString() || "";
        const order: AIActionSentenceValue = ruleOrderValue(rule);

        for (const link of escalation.ruleUsers) {
          if (link.onCallDutyPolicyEscalationRuleId?.toString() !== ruleKey) {
            continue;
          }
          pushWordedRow(
            worded,
            {
              source: "",
              onCallNow: nameOf(link.user) || "Unknown user",
              onCallUserId: link.user?.id?.toString(),
              note: "Paged whenever this rule fires",
            },
            {
              source: aiActionSentence(
                AI_READ_RECORD_TABLE_CELLS.ruleDirectResponder,
                { order },
              ),
            },
          );
        }

        for (const link of escalation.ruleTeams) {
          if (link.onCallDutyPolicyEscalationRuleId?.toString() !== ruleKey) {
            continue;
          }
          const teamName: string = link.team?.name || "Unknown team";
          pushWordedRow(
            worded,
            {
              source: "",
              onCallNow: "",
              note: "Every team member is paged when this rule fires",
            },
            {
              source: aiActionSentence(AI_READ_RECORD_TABLE_CELLS.ruleTeam, {
                order,
                team: teamName,
              }),
              onCallNow: aiActionSentence(
                AI_READ_RECORD_TABLE_CELLS.allMembersOfTeam,
                { team: teamName },
              ),
            },
          );
        }

        for (const link of escalation.ruleSchedules) {
          if (link.onCallDutyPolicyEscalationRuleId?.toString() !== ruleKey) {
            continue;
          }
          const linkedScheduleId: string =
            link.onCallDutyPolicyScheduleId?.toString() ||
            link.onCallDutyPolicySchedule?.id?.toString() ||
            "";
          const schedule: OnCallDutyPolicySchedule | undefined =
            scheduleById.get(linkedScheduleId);
          if (schedule && link.pageNextInRotation) {
            /*
             * The rule pages the backup after whoever is on call, not them:
             * said as such, so the row is never read as "pages the person
             * on call".
             */
            const onCallName: string | undefined = nameOf(
              schedule.currentUserOnRoster,
            );

            pushWordedRow(
              worded,
              {
                scheduleId: schedule.id?.toString(),
                source: "",
                onCallNow: "",
                note: `Pages the ${NEXT_IN_ROTATION_TARGET_NOTE}`,
              },
              {
                source: aiActionSentence(
                  AI_READ_RECORD_TABLE_CELLS.ruleNextInRotation,
                  { order, schedule: schedule.name || "" },
                ),
                onCallNow: onCallName
                  ? aiActionSentence(
                      AI_READ_RECORD_TABLE_CELLS.personAfterInRotation,
                      { name: onCallName },
                    )
                  : aiActionSentence(AI_READ_CARD_LINES.noOneOnCall),
              },
            );
          } else if (schedule) {
            pushScheduleStatusRow(
              worded,
              schedule,
              aiActionSentence(AI_READ_RECORD_TABLE_CELLS.ruleSchedule, {
                order,
                schedule: schedule.name || "",
              }),
            );
          } else {
            pushWordedRow(
              worded,
              { source: "", onCallNow: "" },
              {
                source: aiActionSentence(
                  AI_READ_RECORD_TABLE_CELLS.ruleSchedule,
                  {
                    order,
                    schedule:
                      link.onCallDutyPolicySchedule?.name || linkedScheduleId,
                  },
                ),
                onCallNow: aiActionSentence(
                  AI_READ_RECORD_TABLE_CELLS.scheduleNotAccessible,
                ),
              },
            );
          }
        }
      }

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      /*
       * The rules still say who they would page, but an archived policy
       * runs none of them - said first, so the rows are not read as "who
       * gets paged now".
       */
      const isArchivedPolicy: boolean = policy.isArchived === true;

      return {
        dataForLlm: isArchivedPolicy
          ? `${ARCHIVED_ON_CALL_POLICY_NOTE}\n${serialized.text}`
          : serialized.text,
        rowCount: serialized.rowCount,
        ...citationSentence(AI_READ_CITATIONS.onCallNowForPolicy, {
          policy: policy.name || onCallPolicyId.toString(),
          responders: respondersValue(countResponders(rows)),
        }),
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: onCallPolicyId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.table({
                // In the reader's language (issue #7977).
                words: {
                  title: policy.name
                    ? aiActionSentence(
                        AI_READ_RECORD_TABLE_TITLES.onCallNowForPolicy,
                        { policy: policy.name },
                      )
                    : aiActionSentence(AI_READ_RECORD_TABLE_TITLES.onCallNow),
                  description: aiActionSentence(
                    isArchivedPolicy
                      ? AI_READ_RECORD_TABLE_LINES.onCallPolicyArchived
                      : AI_READ_RECORD_TABLE_LINES.onCallPolicyRules,
                  ),
                  cells: worded.cells,
                },
                columns: onCallStatusColumns,
                rows: rows,
                link: {
                  type: AIChatCitationTargetType.OnCallPolicyView,
                  params: { onCallDutyPolicyId: onCallPolicyId.toString() },
                },
              })
            : undefined,
      };
    }

    const schedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.findBy({
        query: {},
        select: scheduleRosterSelect,
        sort: {
          name: SortOrder.Ascending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      });

    // Each schedule's row, and its cells that are OneUptime's words (#7977).
    const worded: WordedRows = { rows: [], cells: [] };

    for (const schedule of schedules) {
      pushScheduleStatusRow(worded, schedule);
    }

    const rows: Array<JSONObject> = worded.rows;

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      ...citationSentence(AI_READ_CITATIONS.onCallNow, {
        responders: respondersValue(countResponders(rows)),
      }),
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicies,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              // In the reader's language (issue #7977).
              words: {
                title: aiActionPluralSentence(
                  AI_READ_RECORD_TABLE_PLURAL_SENTENCES.onCallNowSchedules,
                  rows.length,
                ),
                cells: worded.cells,
              },
              columns: onCallStatusColumns,
              rows: rows,
              link: { type: AIChatCitationTargetType.OnCallPolicies },
            })
          : undefined,
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * query_on_call_pages — recent policy executions and who was notified.
 * ---------------------------------------------------------------------------
 */

/*
 * What a direct page's row says where another row names its policy. A
 * workflow's Page Users, Page a Team and Page Whoever Is On Call steps, and
 * `/oneuptime page` in Slack and Microsoft Teams, page people with no
 * on-call policy behind the page; the page is kept as a run, so it is
 * listed here with the runs. Without this its policy would simply be
 * missing from the row, and "which policy paged them?" would be answered
 * with a guess.
 */
export const DIRECT_PAGE_POLICY_LABEL: string =
  AI_READ_RECORD_TABLE_CELLS.directPage;

/*
 * What started a page, as a sentence the chat's table says in the
 * reader's language (issue #7977): the incident or alert by its number and
 * title, or the person who paged.
 */
function getTriggerWords(
  log: OnCallDutyPolicyExecutionLog,
): AIActionSentence | undefined {
  if (log.triggeredByIncident) {
    const title: string = (log.triggeredByIncident.title || "").trim();

    return log.triggeredByIncident.incidentNumber
      ? aiActionSentence(AI_READ_RECORD_TABLE_CELLS.triggeredByIncident, {
          number: `#${log.triggeredByIncident.incidentNumber}`,
          title,
        })
      : aiActionSentence(
          AI_READ_RECORD_TABLE_CELLS.triggeredByIncidentUnnumbered,
          { title },
        );
  }
  if (log.triggeredByAlert) {
    return aiActionSentence(AI_READ_RECORD_TABLE_CELLS.triggeredByAlert, {
      title: (log.triggeredByAlert.title || "").trim(),
    });
  }
  if (log.triggeredByUser) {
    return aiActionSentence(AI_READ_RECORD_TABLE_CELLS.triggeredByUser, {
      name: nameOf(log.triggeredByUser) || "a user",
    });
  }
  return undefined;
}

export const QueryOnCallPagesTool: ObservabilityTool = {
  name: "query_on_call_pages",
  description:
    "Recent on-call pages (on-call policy executions, and direct pages a workflow or a person in Slack or Microsoft Teams sent with no policy): when a policy was triggered, by which incident or alert, how far it escalated, who was notified and whether anyone acknowledged. A direct page has no policy and no escalation: its policy reads 'Direct page (no on-call policy)' and startedBy names the workflow or the person who paged. Defaults to the last 24 hours; pass startTime/endTime (ISO 8601) for another window. Filter by onCallPolicyId (find it with query_on_call_policies), incidentId (query_incidents) or alertId (query_alerts). Use this to answer 'was anyone paged?', 'who was notified?' and 'did anyone acknowledge?'.",
  inputSchema: {
    type: "object",
    properties: {
      onCallPolicyId: {
        type: "string",
        description: "Only pages of this on-call policy.",
      },
      incidentId: {
        type: "string",
        description: "Only pages triggered by this incident.",
      },
      alertId: {
        type: "string",
        description: "Only pages triggered by this alert.",
      },
      startTime: {
        type: "string",
        description:
          "Start of the time range as an ISO 8601 timestamp. Defaults to 24 hours before endTime.",
      },
      endTime: {
        type: "string",
        description:
          "End of the time range as an ISO 8601 timestamp. Defaults to now.",
      },
      limit: {
        type: "number",
        description: "Maximum pages to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Rows to skip, for paging through long result sets (default 0, max 500).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveExecutionLogReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const onCallPolicyId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "onCallPolicyId",
    );
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 90,
    });

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    const query: Query<OnCallDutyPolicyExecutionLog> = {
      createdAt: QueryHelper.inBetween(startTime, endTime),
      /*
       * Test pages (OnCallTestPage) are not pages about anything: they are
       * left out of what OneUptime AI counts and lists as the on-call
       * history, as they are left out of every on-call report.
       */
      userNotificationEventType: QueryHelper.notEquals(
        UserNotificationEventType.TestPage,
      ),
    };
    if (onCallPolicyId) {
      query.onCallDutyPolicyId = onCallPolicyId;
    }
    if (incidentId) {
      query.triggeredByIncidentId = incidentId;
    }
    if (alertId) {
      query.triggeredByAlertId = alertId;
    }

    const totalCount: PositiveNumber =
      await OnCallDutyPolicyExecutionLogService.countBy({
        query: query,
        props: ctx.props,
      });

    const logs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: query,
        select: {
          _id: true,
          createdAt: true,
          status: true,
          statusMessage: true,
          lastExecutedEscalationRuleOrder: true,
          acknowledgedAt: true,
          // Read with every row: a row with none is a direct page.
          onCallDutyPolicyId: true,
          triggeredByWorkflowName: true,
          onCallDutyPolicy: {
            _id: true,
            name: true,
          },
          triggeredByIncident: {
            _id: true,
            title: true,
            incidentNumber: true,
          },
          triggeredByAlert: {
            _id: true,
            title: true,
          },
          triggeredByUser: {
            _id: true,
            name: true,
          },
          acknowledgedByUser: {
            _id: true,
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: skip,
        props: ctx.props,
      });

    /*
     * Per-responder delivery/ack outcomes come from UserOnCallLog — one row
     * per user the execution notified. Fetched in one batch for all returned
     * executions, under the same requesting-user props.
     */
    const executionLogIds: Array<ObjectID> = logs
      .map((log: OnCallDutyPolicyExecutionLog) => {
        return log.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    const userLogs: Array<UserOnCallLog> =
      executionLogIds.length > 0
        ? await UserOnCallLogService.findBy({
            query: {
              onCallDutyPolicyExecutionLogId: QueryHelper.any(executionLogIds),
            },
            select: {
              _id: true,
              onCallDutyPolicyExecutionLogId: true,
              status: true,
              statusMessage: true,
              acknowledgedAt: true,
              user: {
                _id: true,
                name: true,
              },
            },
            sort: {
              createdAt: SortOrder.Ascending,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: ctx.props,
          })
        : [];

    const notifiedByExecutionId: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    // The same, as words (issue #8313): a person's status in the reader's language.
    const notifiedWordsByExecutionId: Map<
      string,
      Array<AIActionSentence>
    > = new Map<string, Array<AIActionSentence>>();
    for (const userLog of userLogs) {
      const executionKey: string =
        userLog.onCallDutyPolicyExecutionLogId?.toString() || "";
      if (!executionKey) {
        continue;
      }
      const words: AIActionSentence = getNotifiedPersonWords({
        name: nameOf(userLog.user) || "Unknown user",
        status: userLog.status || "Unknown",
        isAcknowledged: Boolean(userLog.acknowledgedAt),
      });
      const entries: Array<string> =
        notifiedByExecutionId.get(executionKey) || [];
      entries.push(describeAIActionSentence(words));
      notifiedByExecutionId.set(executionKey, entries);
      notifiedWordsByExecutionId.set(executionKey, [
        ...(notifiedWordsByExecutionId.get(executionKey) || []),
        words,
      ]);
    }

    /*
     * Each page's cells that are OneUptime's words (issue #7977): a direct
     * page's policy, what started it, and that nobody was notified one by
     * one - in the row as their English, for the model.
     */
    const cells: Array<Record<string, AIActionTableCell>> = logs.map(
      (
        log: OnCallDutyPolicyExecutionLog,
      ): Record<string, AIActionTableCell> => {
        const trigger: AIActionSentence | undefined = getTriggerWords(log);
        const notifiedWords: Array<AIActionSentence> =
          notifiedWordsByExecutionId.get(log.id?.toString() || "") || [];
        const hasNotified: boolean = notifiedWords.length > 0;
        // The page's status, as the pages list says it (issue #8313).
        const status: string | undefined =
          typeof log.status === "string" &&
          AI_READ_ON_CALL_PAGE_STATUSES.includes(log.status)
            ? log.status
            : undefined;

        return {
          ...(status ? { status: aiActionTerm(status) } : {}),
          ...(!log.onCallDutyPolicy?.name && isOnCallDirectPage(log)
            ? {
                policy: aiActionSentence(AI_READ_RECORD_TABLE_CELLS.directPage),
              }
            : {}),
          ...(trigger ? { trigger } : {}),
          ...(hasNotified
            ? {
                notified: aiActionSentence(AI_READ_CARD_NAME, {
                  name: aiActionList(notifiedWords),
                }),
              }
            : {
                notified: aiActionSentence(
                  AI_READ_RECORD_TABLE_CELLS.noNotificationsRecorded,
                ),
              }),
        };
      },
    );

    const rows: Array<JSONObject> = logs.map(
      (log: OnCallDutyPolicyExecutionLog, index: number) => {
        const notified: Array<string> =
          notifiedByExecutionId.get(log.id?.toString() || "") || [];
        const trigger: AIActionTableCell | undefined =
          cells[index]?.["trigger"];
        return {
          id: log.id?.toString(),
          triggeredAt: log.createdAt,
          policy:
            log.onCallDutyPolicy?.name ||
            (isOnCallDirectPage(log) ? DIRECT_PAGE_POLICY_LABEL : undefined),
          policyId: log.onCallDutyPolicy?.id?.toString(),
          trigger: trigger ? describeAIActionTableCell(trigger) : undefined,
          /*
           * Who started a direct page: the workflow whose step did, or the
           * person who paged from a chat.
           */
          startedBy: log.triggeredByWorkflowName
            ? `Workflow: ${log.triggeredByWorkflowName}`
            : isOnCallDirectPage(log) && log.triggeredByUser
              ? `Person: ${nameOf(log.triggeredByUser) || "a user"}`
              : undefined,
          status: log.status,
          statusMessage: log.statusMessage,
          escalatedToRuleOrder: log.lastExecutedEscalationRuleOrder,
          acknowledgedBy: nameOf(log.acknowledgedByUser),
          acknowledgedAt: log.acknowledgedAt,
          notified:
            notified.length > 0
              ? notified.join(", ")
              : AI_READ_RECORD_TABLE_CELLS.noNotificationsRecorded,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    /*
     * Window label for the citation: hours for short windows, whole days for
     * long ones, so "last 24h" and "last 7d" both read naturally.
     */
    const windowHours: number = Math.max(
      1,
      Math.round((endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000)),
    );
    const isWindowInDays: boolean = windowHours >= 48 && windowHours % 24 === 0;
    // The window's length, as a figure the reader's language writes.
    const windowValue: Record<string, AIActionSentenceValue> = isWindowInDays
      ? { days: countFigure(windowHours / 24) }
      : { hours: countFigure(windowHours) };

    const total: number = totalCount.toNumber();
    const hasMore: boolean = total > rows.length && rows.length > 0;
    const dataForLlm: string = hasMore
      ? `Showing rows ${skip + 1}–${skip + rows.length} of ${total} total. Pass skip to page further.\n${serialized.text}`
      : serialized.text;

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      // In the reader's language (issue #7980).
      ...citationSentence(
        hasMore
          ? isWindowInDays
            ? AI_READ_CITATIONS.onCallPagesInDaysPaged
            : AI_READ_CITATIONS.onCallPagesInHoursPaged
          : isWindowInDays
            ? AI_READ_CITATIONS.onCallPagesInDays
            : AI_READ_CITATIONS.onCallPagesInHours,
        {
          ...windowValue,
          count: countFigure(hasMore ? rows.length : serialized.rowCount),
          ...(hasMore ? { total: countFigure(total) } : {}),
        },
      ),
      citationTarget: onCallPolicyId
        ? {
            type: AIChatCitationTargetType.OnCallPolicyView,
            params: { onCallDutyPolicyId: onCallPolicyId.toString() },
          }
        : {
            type: AIChatCitationTargetType.OnCallPolicies,
          },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              // In the reader's language (issue #7977).
              words: {
                title: aiActionSentence(
                  AI_READ_RECORD_TABLE_TITLES.onCallPages,
                  { count: countFigure(rows.length) },
                ),
                description: aiActionSentence(
                  isWindowInDays
                    ? AI_READ_RECORD_TABLE_LINES.onCallPagesInDays
                    : AI_READ_RECORD_TABLE_LINES.onCallPagesInHours,
                  windowValue,
                ),
                cells,
              },
              columns: [
                {
                  key: "triggeredAt",
                  title: translationKey("Triggered"),
                  type: "date",
                },
                {
                  key: "policy",
                  title: translationKey("Policy"),
                  type: "text",
                },
                {
                  key: "trigger",
                  title: translationKey("Trigger"),
                  type: "text",
                },
                {
                  key: "status",
                  title: translationKey("Status"),
                  type: "text",
                },
                {
                  key: "acknowledgedBy",
                  title: translationKey("Acked by"),
                  type: "text",
                },
                {
                  key: "notified",
                  title: translationKey("Notified"),
                  type: "text",
                },
              ],
              rows: rows,
              link: onCallPolicyId
                ? {
                    type: AIChatCitationTargetType.OnCallPolicyView,
                    params: {
                      onCallDutyPolicyId: onCallPolicyId.toString(),
                    },
                  }
                : { type: AIChatCitationTargetType.OnCallPolicies },
            })
          : undefined,
    };
  },
};
