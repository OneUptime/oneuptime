import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import {
  AI_ACTION_NAME,
  AIActionSentence,
  aiActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import {
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../Types/AI/AISetupActions";
import { JSONObject } from "../../../../Types/JSON";
import { parseWebsiteAddress } from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../Services/PayAsYouGoBillingService";
import TeamMemberService from "../../../Services/TeamMemberService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ActiveMonitorLimit from "../../Billing/ActiveMonitorLimit";
import { PlannedToolCall, ToolArgs, ToolContext } from "./ToolTypes";

/*
 * WHAT EVERY PART OF AN ASK AI SETUP PLAN SHARES (#6829): where each runs
 * in an approved plan, how the names a call hands a list are read, how a
 * name is said on a card, and what the project's plan says to the monitors
 * the plan sets up. SetupTools and the setup actions of their own files
 * (SetupLadderTools, SetupInviteTools, SetupServiceMonitorTools) read it
 * here, so none of them imports another.
 */

/*
 * The order a plan's parts run in once approved: the people it invites
 * first, so the policy can page them (#7242); who is paged next, so the
 * monitor's first incident already has someone to page - a new policy,
 * people added to one (#7244), and how pages reach the person (#7454);
 * then the monitors - a website's, a service's (#7243); then the status
 * page that shows them.
 */
export const SETUP_PLAN_ORDER: {
  invitation: number;
  paging: number;
  onCallPolicyPeople: number;
  howToReachMe: number;
  websiteMonitoring: number;
  serviceMonitor: number;
  statusPage: number;
  statusPageMonitors: number;
} = {
  invitation: 5,
  paging: 10,
  onCallPolicyPeople: 12,
  howToReachMe: 15,
  websiteMonitoring: 20,
  serviceMonitor: 25,
  statusPage: 30,
  statusPageMonitors: 40,
};

// The most names a call may hand a list: more is not a setup, it is an import.
export const MAX_SETUP_NAMES: number = 25;

// The names a call hands a list: trimmed, each once (without case), at most MAX_SETUP_NAMES.
export function readNames(args: JSONObject, key: string): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const name of ToolArgs.getStringArray(args, key) || []) {
    const trimmed: string = name.trim();
    const lower: string = trimmed.toLowerCase();

    if (!trimmed || seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    names.push(trimmed);

    if (names.length >= MAX_SETUP_NAMES) {
      break;
    }
  }

  return names;
}

// A name in a card's list, as written, in quotes - a monitor's, a rule's.
export function quotedName(name: string): AIActionSentence {
  return aiActionSentence(AI_ACTION_NAME, { name: JSON.stringify(name) });
}

// A name in a card's list, as written - a person's.
export function plainName(name: string): AIActionSentence {
  return aiActionSentence(AI_ACTION_NAME, { name: name });
}

/*
 * The name and email of each member the person's own read found, read as
 * OneUptime. A member's user is read by fewer people than the membership
 * (Current User reaches a person's own memberships, not who they belong to),
 * so the person's read selects only what every reader of a membership may
 * read, and this adds who each one is - for those memberships alone, in the
 * person's project. Who is paged (set_up_paging, add_to_on_call_policy)
 * and who is invited already (invite_people) are read with it.
 */
export async function addMemberUsers(
  ctx: ToolContext,
  members: Array<TeamMember>,
): Promise<void> {
  const ids: Array<string> = members
    .map((member: TeamMember): string => {
      return member.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });

  if (ids.length === 0) {
    return;
  }

  const withUsers: Array<TeamMember> = await TeamMemberService.findBy({
    query: {
      _id: QueryHelper.any(ids),
      projectId: ctx.projectId,
    } as never,
    select: {
      _id: true,
      user: { _id: true, name: true, email: true },
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: { isRoot: true },
  });

  const userOf: Map<string, User> = new Map();

  for (const withUser of withUsers) {
    if (withUser.user) {
      userOf.set(withUser.id?.toString() || "", withUser.user);
    }
  }

  for (const member of members) {
    const user: User | undefined = userOf.get(member.id?.toString() || "");

    if (user) {
      member.user = user;
    }
  }
}

/*
 * How many monitors the same plan sets up: one for each website monitoring
 * call whose address is one, one for each of a service's recommended
 * monitors it names (#7243), and at least the one being checked.
 */
export function countMonitorsSetUpInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): number {
  const count: number = (plannedCalls || []).filter(
    (call: PlannedToolCall): boolean => {
      const args: JSONObject = call.arguments || {};

      if (call.name === SET_UP_WEBSITE_MONITORING_TOOL_NAME) {
        return Boolean(
          parseWebsiteAddress(ToolArgs.getString(args, "address") || ""),
        );
      }

      if (call.name === SET_UP_SERVICE_MONITOR_TOOL_NAME) {
        return (
          Boolean(ToolArgs.getString(args, "service")) &&
          Boolean(ToolArgs.getString(args, "monitor"))
        );
      }

      return false;
    },
  ).length;

  return Math.max(1, count);
}

/*
 * What the project's plan says to the monitors a plan sets up, asked before
 * its card so a project that may not add them is told now, not after an
 * approval: the two answers MonitorService.create gives when it runs - and
 * gives again then. OneUptime Cloud's pay as you go, which a monitor that
 * runs checks needs on every plan, and room under the plan's active monitor
 * limit for every monitor of the plan (ActiveMonitorLimit.getRefusal, an
 * answer for now). Null on an install without billing, and when there is
 * room.
 */
export async function readMonitorPlanRefusal(
  ctx: ToolContext,
): Promise<string | null> {
  if (!(await PayAsYouGoBillingService.canUsePayAsYouGo(ctx.projectId))) {
    return PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE;
  }

  return await ActiveMonitorLimit.getRefusal({
    projectId: ctx.projectId,
    adding: countMonitorsSetUpInPlan(ctx.plannedCalls),
  });
}
