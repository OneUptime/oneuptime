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
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

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
const NO_ONE_ON_CALL: string = "No one is on call";
const SCHEDULE_NOT_ACCESSIBLE: string =
  "Schedule not accessible (no read access or deleted)";

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
    getOrCreateTargets(data.targetsByRuleId, ruleKey).schedules.push(
      link.onCallDutyPolicySchedule?.name || "Unknown schedule",
    );
  }

  return data;
}

function formatRuleTargets(targets: EscalationRuleTargets | undefined): string {
  const parts: Array<string> = [];
  if (targets && targets.users.length > 0) {
    parts.push(`users [${targets.users.join(", ")}]`);
  }
  if (targets && targets.teams.length > 0) {
    parts.push(`teams [${targets.teams.join(", ")}]`);
  }
  if (targets && targets.schedules.length > 0) {
    parts.push(`schedules [${targets.schedules.join(", ")}]`);
  }
  return parts.join(", ") || "no targets";
}

function formatEscalationChain(
  rules: Array<OnCallDutyPolicyEscalationRule>,
  targetsByRuleId: Map<string, EscalationRuleTargets>,
): string {
  if (rules.length === 0) {
    return "No escalation rules configured";
  }

  return rules
    .map((rule: OnCallDutyPolicyEscalationRule): string => {
      const targetText: string = formatRuleTargets(
        targetsByRuleId.get(rule.id?.toString() || ""),
      );
      const escalateText: string = rule.escalateAfterInMinutes
        ? ` (escalates after ${rule.escalateAfterInMinutes}m)`
        : "";
      return `${rule.order ?? "?"}. ${rule.name || "Unnamed rule"}: ${targetText}${escalateText}`;
    })
    .join(" | ");
}

/*
 * ---------------------------------------------------------------------------
 * query_on_call_policies — discover policies and their escalation chains.
 * ---------------------------------------------------------------------------
 */
export const QueryOnCallPoliciesTool: ObservabilityTool = {
  name: "query_on_call_policies",
  description:
    "Query on-call duty policies in this project — who gets paged and in what order. List mode returns each policy (id, name, description) with its escalation rule chain: rule order plus the users, teams and schedules each rule pages. Pass onCallPolicyId to get full details of one policy. Use this to find the id to pass to page_on_call_policy, get_on_call_status or query_on_call_pages.",
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

      const policyLabels: string = (policy?.labels || [])
        .map((label: { name?: string }) => {
          return label.name || "";
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .join(", ");

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
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      const ruleFields: Array<{ label: string; value: string }> = rules.map(
        (rule: OnCallDutyPolicyEscalationRule) => {
          const targetText: string = formatRuleTargets(
            escalation.targetsByRuleId.get(rule.id?.toString() || ""),
          );
          const escalateText: string = rule.escalateAfterInMinutes
            ? ` (escalates after ${rule.escalateAfterInMinutes}m)`
            : "";
          return {
            label: `Rule ${rule.order ?? "?"}${rule.name ? ` — ${rule.name}` : ""}`,
            value: `${targetText}${escalateText}`,
          };
        },
      );

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `On-call policy '${policy?.name || onCallPolicyId.toString()}'`,
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: onCallPolicyId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: policy
          ? WidgetBuilder.resourceCard({
              title: `On-call policy: ${policy.name || ""}`.trim(),
              resourceType: "On-Call Policy",
              heading: policy.name || onCallPolicyId.toString(),
              subheading: policy.description,
              fields:
                ruleFields.length > 0
                  ? ruleFields
                  : [
                      {
                        label: "Escalation rules",
                        value: "None configured",
                      },
                    ],
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

    const totalCount: PositiveNumber = await OnCallDutyPolicyService.countBy({
      query: {},
      props: ctx.props,
    });

    const policies: Array<OnCallDutyPolicy> =
      await OnCallDutyPolicyService.findBy({
        query: {},
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
      citationLabel: hasMore
        ? `On-call policies (${rows.length} of ${total})`
        : `On-call policies (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicies,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `On-call policies (${rows.length})`,
              columns: [
                { key: "name", title: "Policy", type: "text" },
                { key: "description", title: "Description", type: "text" },
                {
                  key: "escalationChain",
                  title: "Escalation chain",
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
 * Roster fields are persisted on the schedule and refreshed every minute by
 * the RefreshHandoffTime worker (overrides included) — the same source the
 * dashboard's "On Call Now" column reads. Reading them costs one RBAC-checked
 * query instead of re-resolving schedule layers per request.
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

function scheduleStatusRow(
  schedule: OnCallDutyPolicySchedule,
  source?: string,
): JSONObject {
  const currentName: string | undefined = nameOf(schedule.currentUserOnRoster);
  return {
    scheduleId: schedule.id?.toString(),
    source: source ?? `Schedule '${schedule.name || ""}'`,
    onCallNow: currentName || NO_ONE_ON_CALL,
    onCallUserId: schedule.currentUserOnRoster?.id?.toString(),
    onCallSince: schedule.rosterStartAt,
    handsOffAt: schedule.rosterHandoffAt,
    nextUp: nameOf(schedule.nextUserOnRoster),
    nextStartsAt: schedule.rosterNextStartAt,
  };
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

function respondersLabel(count: number): string {
  return `${count} ${count === 1 ? "responder" : "responders"}`;
}

const onCallStatusColumns: Array<AIChatWidgetColumn> = [
  { key: "source", title: "Schedule / rule", type: "text" },
  { key: "onCallNow", title: "On call now", type: "text" },
  { key: "onCallSince", title: "Since", type: "date" },
  { key: "handsOffAt", title: "Hands off", type: "date" },
  { key: "nextUp", title: "Next up", type: "text" },
  { key: "nextStartsAt", title: "Next starts", type: "date" },
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

      const cardFields: Array<{ label: string; value: string }> = [];
      if (schedule?.rosterStartAt) {
        cardFields.push({
          label: "On call since",
          value: schedule.rosterStartAt.toISOString(),
        });
      }
      if (schedule?.rosterHandoffAt) {
        cardFields.push({
          label: "Hands off at",
          value: schedule.rosterHandoffAt.toISOString(),
        });
      }
      const nextUp: string | undefined = nameOf(schedule?.nextUserOnRoster);
      if (nextUp) {
        cardFields.push({ label: "Next up", value: nextUp });
      }
      if (schedule?.rosterNextStartAt) {
        cardFields.push({
          label: "Next shift starts",
          value: schedule.rosterNextStartAt.toISOString(),
        });
      }

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `On-call now: '${schedule?.name || scheduleId.toString()}'`,
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicies,
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget: schedule
          ? WidgetBuilder.resourceCard({
              title: `On-call schedule '${schedule.name || ""}'`.trim(),
              resourceType: "On-Call Schedule",
              heading: schedule.name || scheduleId.toString(),
              subheading:
                onCallNow === NO_ONE_ON_CALL
                  ? NO_ONE_ON_CALL
                  : `On call now: ${onCallNow}`,
              fields: cardFields,
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
          },
          props: ctx.props,
        });

      if (!policy) {
        return {
          dataForLlm:
            "(no rows found) — on-call policy not found or not accessible. Find valid ids with query_on_call_policies.",
          rowCount: 0,
          citationLabel: "On-call now (policy not found)",
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

      const rows: Array<JSONObject> = [];

      for (const rule of rules) {
        const ruleKey: string = rule.id?.toString() || "";
        const ruleLabel: string = `Rule ${rule.order ?? "?"}`;

        for (const link of escalation.ruleUsers) {
          if (link.onCallDutyPolicyEscalationRuleId?.toString() !== ruleKey) {
            continue;
          }
          rows.push({
            source: `${ruleLabel} — direct responder`,
            onCallNow: nameOf(link.user) || "Unknown user",
            onCallUserId: link.user?.id?.toString(),
            note: "Paged whenever this rule fires",
          });
        }

        for (const link of escalation.ruleTeams) {
          if (link.onCallDutyPolicyEscalationRuleId?.toString() !== ruleKey) {
            continue;
          }
          const teamName: string = link.team?.name || "Unknown team";
          rows.push({
            source: `${ruleLabel} — team '${teamName}'`,
            onCallNow: `All members of '${teamName}'`,
            note: "Every team member is paged when this rule fires",
          });
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
          if (schedule) {
            rows.push(
              scheduleStatusRow(
                schedule,
                `${ruleLabel} — schedule '${schedule.name || ""}'`,
              ),
            );
          } else {
            rows.push({
              source: `${ruleLabel} — schedule '${link.onCallDutyPolicySchedule?.name || linkedScheduleId}'`,
              onCallNow: SCHEDULE_NOT_ACCESSIBLE,
            });
          }
        }
      }

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `On-call now for '${policy.name || onCallPolicyId.toString()}' (${respondersLabel(countResponders(rows))})`,
        citationTarget: {
          type: AIChatCitationTargetType.OnCallPolicyView,
          params: { onCallDutyPolicyId: onCallPolicyId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.table({
                title: `On-call now: ${policy.name || ""}`.trim(),
                description: "Who each escalation rule pages, in order",
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

    const rows: Array<JSONObject> = schedules.map(
      (schedule: OnCallDutyPolicySchedule) => {
        return scheduleStatusRow(schedule);
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `On-call now (${respondersLabel(countResponders(rows))})`,
      citationTarget: {
        type: AIChatCitationTargetType.OnCallPolicies,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `On-call now (${rows.length} ${rows.length === 1 ? "schedule" : "schedules"})`,
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

function formatTrigger(log: OnCallDutyPolicyExecutionLog): string | undefined {
  if (log.triggeredByIncident) {
    const incidentNumber: string = log.triggeredByIncident.incidentNumber
      ? ` #${log.triggeredByIncident.incidentNumber}`
      : "";
    return `Incident${incidentNumber}: ${log.triggeredByIncident.title || ""}`.trim();
  }
  if (log.triggeredByAlert) {
    return `Alert: ${log.triggeredByAlert.title || ""}`.trim();
  }
  if (log.triggeredByUser) {
    return `Manually triggered by ${nameOf(log.triggeredByUser) || "a user"}`;
  }
  return undefined;
}

export const QueryOnCallPagesTool: ObservabilityTool = {
  name: "query_on_call_pages",
  description:
    "Recent on-call pages (on-call policy executions): when a policy was triggered, by which incident or alert, how far it escalated, who was notified and whether anyone acknowledged. Defaults to the last 24 hours; pass startTime/endTime (ISO 8601) for another window. Filter by onCallPolicyId (find it with query_on_call_policies), incidentId (query_incidents) or alertId (query_alerts). Use this to answer 'was anyone paged?', 'who was notified?' and 'did anyone acknowledge?'.",
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
    for (const userLog of userLogs) {
      const executionKey: string =
        userLog.onCallDutyPolicyExecutionLogId?.toString() || "";
      if (!executionKey) {
        continue;
      }
      const entries: Array<string> =
        notifiedByExecutionId.get(executionKey) || [];
      entries.push(
        `${nameOf(userLog.user) || "Unknown user"}: ${userLog.status || "Unknown"}${
          userLog.acknowledgedAt ? " (acknowledged)" : ""
        }`,
      );
      notifiedByExecutionId.set(executionKey, entries);
    }

    const rows: Array<JSONObject> = logs.map(
      (log: OnCallDutyPolicyExecutionLog) => {
        const notified: Array<string> =
          notifiedByExecutionId.get(log.id?.toString() || "") || [];
        return {
          id: log.id?.toString(),
          triggeredAt: log.createdAt,
          policy: log.onCallDutyPolicy?.name,
          policyId: log.onCallDutyPolicy?.id?.toString(),
          trigger: formatTrigger(log),
          status: log.status,
          statusMessage: log.statusMessage,
          escalatedToRuleOrder: log.lastExecutedEscalationRuleOrder,
          acknowledgedBy: nameOf(log.acknowledgedByUser),
          acknowledgedAt: log.acknowledgedAt,
          notified:
            notified.length > 0
              ? notified.join(", ")
              : "No individual notifications recorded",
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
    const windowLabel: string =
      windowHours >= 48 && windowHours % 24 === 0
        ? `${windowHours / 24}d`
        : `${windowHours}h`;

    const total: number = totalCount.toNumber();
    const hasMore: boolean = total > rows.length && rows.length > 0;
    const dataForLlm: string = hasMore
      ? `Showing rows ${skip + 1}–${skip + rows.length} of ${total} total. Pass skip to page further.\n${serialized.text}`
      : serialized.text;

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: hasMore
        ? `On-call pages, last ${windowLabel} (${rows.length} of ${total})`
        : `On-call pages, last ${windowLabel} (${serialized.rowCount} found)`,
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
              title: `On-call pages (${rows.length})`,
              description: `Policy executions in the last ${windowLabel}`,
              columns: [
                { key: "triggeredAt", title: "Triggered", type: "date" },
                { key: "policy", title: "Policy", type: "text" },
                { key: "trigger", title: "Trigger", type: "text" },
                { key: "status", title: "Status", type: "text" },
                { key: "acknowledgedBy", title: "Acked by", type: "text" },
                { key: "notified", title: "Notified", type: "text" },
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
