import Monitor from "../../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import {
  AI_ACTION_LINES,
  AI_ACTION_NAME,
  AIActionSentence,
  aiActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
  isPayAsYouGoPriceQuoted,
} from "../../../../Types/Billing/PayAsYouGoPricing";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import {
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../Types/AI/AISetupActions";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  MONITORS_CHECKING_ADDRESS_READ_LIMIT,
  WebsiteAddress,
  isMonitorCheckingAddress,
  parseWebsiteAddress,
} from "../../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import { IsBillingEnabled } from "../../../EnvironmentConfig";
import MonitorService from "../../../Services/MonitorService";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../Services/PayAsYouGoBillingService";
import ProjectService from "../../../Services/ProjectService";
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

/*
 * What a setup action's result tells the model the person can do next, by
 * where it is read (ToolContext.isOutsideChat, #7241).
 *
 * Under Ask AI's answer, a run leaves its offers - a test page to send to
 * yourself, or to the policy it made (AskAiTestPageOffer) - and the
 * approval card said what is missing before anyone approved it. A client
 * of the setup actions outside the chat, the MCP server's tools, draws
 * neither: there the words name the page in OneUptime where the same is
 * done, by its menus, so the agent can send the person to it.
 */
export enum SetupTestPageTarget {
  // A test page to the person themselves: a monitor they own, their ladder.
  Self = "self",
  // A test page to the policy just made or changed: its people.
  Policy = "policy",
}

export const ASK_AI_TEST_PAGE_OFFERS: Readonly<
  Record<SetupTestPageTarget, string>
> = {
  [SetupTestPageTarget.Self]:
    "Under your answer the person can send themselves a test page; offer it in one sentence and never say one was sent.",
  [SetupTestPageTarget.Policy]:
    "Under your answer the person can test the policy with a test page; offer it in one sentence and never say one was sent.",
};

export const OUTSIDE_CHAT_TEST_PAGE_OFFERS: Readonly<
  Record<SetupTestPageTarget, string>
> = {
  [SetupTestPageTarget.Self]:
    "To check that a page reaches them, the person can send themselves one: Send me a test page, under User Settings > Notification Methods in OneUptime. No test page was sent.",
  [SetupTestPageTarget.Policy]:
    "To check that the policy reaches its people, On-Call > Readiness in OneUptime sends each of them a test page. No test page was sent.",
};

export function getTestPageOfferForModel(
  ctx: Pick<ToolContext, "isOutsideChat">,
  target: SetupTestPageTarget,
): string {
  return ctx.isOutsideChat
    ? OUTSIDE_CHAT_TEST_PAGE_OFFERS[target]
    : ASK_AI_TEST_PAGE_OFFERS[target];
}

/*
 * What the model is told of a way to reach the person that is missing - a
 * phone number, the app - which the person adds and verifies themselves:
 * the approval card said so under Ask AI; outside the chat, the result's
 * own details do (SetupActionRunner).
 */
export const ASK_AI_MISSING_METHOD_ADVICE: string =
  'If the approval card said a phone number or the app is missing, tell the person to add and verify it in Notification Methods, and end with that page\'s citation (find_dashboard_page "Notification Methods").';

export const OUTSIDE_CHAT_MISSING_METHOD_ADVICE: string =
  "If the details say a phone number or the app is missing, tell the person to add and verify it under User Settings > Notification Methods in OneUptime.";

export function getMissingMethodAdviceForModel(
  ctx: Pick<ToolContext, "isOutsideChat">,
): string {
  return ctx.isOutsideChat
    ? OUTSIDE_CHAT_MISSING_METHOD_ADVICE
    : ASK_AI_MISSING_METHOD_ADVICE;
}

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
 * The project's newest Website and API monitors the person may read, with
 * what isMonitorCheckingAddress reads of each: as many as the website
 * guided setup reads to find one for an address (#7254, #7292).
 */
export async function readWebsiteMonitors(
  ctx: ToolContext,
): Promise<Array<Monitor>> {
  return await MonitorService.findBy({
    query: {
      projectId: ctx.projectId,
      monitorType: QueryHelper.any([MonitorType.Website, MonitorType.API]),
    },
    select: {
      _id: true,
      name: true,
      monitorSteps: true,
      isArchived: true,
      disableActiveMonitoring: true,
      createdByUserId: true,
    },
    sort: { createdAt: SortOrder.Descending },
    limit: MONITORS_CHECKING_ADDRESS_READ_LIMIT,
    skip: 0,
    props: ctx.props,
  });
}

/*
 * How many monitors the same plan sets up: one for each address its website
 * monitoring calls name - once, however many calls name it, and none for an
 * address isChecked says a monitor checks already, which gets no second one
 * (#7292) - one for each of a service's recommended monitors it names
 * (#7243), and at least the one being checked.
 */
export function countMonitorsSetUpInPlan(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
  isChecked?: ((address: WebsiteAddress) => boolean) | undefined,
): number {
  const monitors: Set<string> = new Set<string>();

  for (const call of plannedCalls || []) {
    const args: JSONObject = call.arguments || {};

    if (call.name === SET_UP_WEBSITE_MONITORING_TOOL_NAME) {
      const address: WebsiteAddress | null = parseWebsiteAddress(
        ToolArgs.getString(args, "address") || "",
      );

      if (address && !isChecked?.(address)) {
        monitors.add(`website ${address.url}`);
      }
    }

    if (call.name === SET_UP_SERVICE_MONITOR_TOOL_NAME) {
      const service: string = ToolArgs.getString(args, "service") || "";
      const monitor: string = ToolArgs.getString(args, "monitor") || "";

      if (service && monitor) {
        monitors.add(`service ${service.toLowerCase()} ${monitor}`);
      }
    }
  }

  return Math.max(1, monitors.size);
}

function hasWebsiteMonitoringCall(
  plannedCalls: ReadonlyArray<PlannedToolCall> | undefined,
): boolean {
  return (plannedCalls || []).some((call: PlannedToolCall): boolean => {
    return call.name === SET_UP_WEBSITE_MONITORING_TOOL_NAME;
  });
}

/*
 * What a monitor the plan sets up adds to the bill, said on its line of the
 * card before anyone approves it (#9995): on OneUptime Cloud's Free plan,
 * where every monitor that runs checks is billed as it is used, the price
 * the website guided setup quotes there (ACTIVE_MONITOR_PRICE_IN_USD_PER_
 * MONTH), by the same rule (isPayAsYouGoPriceQuoted). A plan of five
 * monitors says it on each of the five lines. Null on a plan that includes
 * monitors, on an install without billing, and when the plan cannot be
 * read: a price is never guessed. Without pay as you go set up, no card is
 * shown at all (readMonitorPlanRefusal).
 */
export async function describeMonitorPriceForPerson(
  ctx: Pick<ToolContext, "projectId">,
): Promise<AIActionSentence | null> {
  if (!IsBillingEnabled) {
    return null;
  }

  let plan: PlanType | null = null;

  try {
    plan = (await ProjectService.getCurrentPlan(ctx.projectId)).plan;
  } catch {
    return null;
  }

  if (!isPayAsYouGoPriceQuoted({ isBillingEnabled: IsBillingEnabled, plan })) {
    return null;
  }

  return aiActionSentence(AI_ACTION_LINES.monitorBilledOnFreePlan, {
    price: formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH),
  });
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

  const refusal: string | null = await ActiveMonitorLimit.getRefusal({
    projectId: ctx.projectId,
    adding: countMonitorsSetUpInPlan(ctx.plannedCalls),
  });

  if (!refusal || !hasWebsiteMonitoringCall(ctx.plannedCalls)) {
    return refusal;
  }

  /*
   * No room for them all: counted again without the addresses a monitor
   * checks already, as those get no second monitor (#7292) - read as the
   * person, as the website monitoring call reads them.
   */
  const websiteMonitors: Array<Monitor> = await readWebsiteMonitors(ctx);

  return await ActiveMonitorLimit.getRefusal({
    projectId: ctx.projectId,
    adding: countMonitorsSetUpInPlan(
      ctx.plannedCalls,
      (address: WebsiteAddress): boolean => {
        return websiteMonitors.some((monitor: Monitor): boolean => {
          return isMonitorCheckingAddress({
            monitor: monitor,
            address: address,
          });
        });
      },
    ),
  });
}
