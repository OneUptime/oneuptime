import UserNotificationRule from "../../../../Models/DatabaseModels/UserNotificationRule";
import {
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AI_ACTION_PLURAL_LINES,
  AI_ACTION_TITLES,
  AIActionSentence,
  aiActionChannel,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "../../../../Types/AI/AIChatTypes";
import { AI_TOOL_CITATIONS } from "../../../../Types/AI/AIReadTableWords";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_PAGING_LADDER_WAIT_IN_MINUTES,
  PagingLadderCell,
  PagingLadderRule,
  PagingLadderStep,
  readPagingLadder,
} from "../../../../Types/NotificationRule/PagingLadder";
import {
  MAX_PAGING_LADDER_DEFAULT_STEPS,
  PagingLadderDefaultStep,
  PagingLadderFromDefault,
  PagingLadderMethodReference,
  getPagingLadderFromDefault,
  isSamePagingLadder,
  readPagingLadderDefault,
} from "../../../../Types/NotificationRule/PagingLadderDefault";
import ObjectID from "../../../../Types/ObjectID";
import {
  OnCallPageChannel,
  getOnCallPageChannelName,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission from "../../../../Types/Permission";
import PagingLadderService, {
  PagingLadderSaveResult,
} from "../../../Services/PagingLadderService";
import { citationSentence } from "./ReadTableWords";
import {
  SETUP_PLAN_ORDER,
  SetupTestPageTarget,
  getTestPageOfferForModel,
} from "./SetupPlan";
import {
  ObservabilityTool,
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";

/*
 * "TEXT ME, THEN CALL ME AFTER FIVE MINUTES" (#7454): how pages reach the
 * person asking, saved as their How to Reach Me ladder (#6820).
 *
 * The sentence How to Reach Me was built around. set_up_paging makes a
 * policy and says what the person's methods are missing; this sets how the
 * person is reached, with the code the ladder's own page saves through:
 *
 *   - each step names a way to be reached and a wait, and is mapped to the
 *     person's own verified methods of it, as the project's default ladder
 *     is mapped for a member (getPagingLadderFromDefault): "SMS at once" is
 *     every verified number at once; a way they have verified no method of
 *     is left out, and the card says where to add one - Ask AI never adds
 *     a phone number or the app;
 *   - their custom channels' steps are kept, as a default keeps them;
 *   - it is saved through PagingLadderService.applyLadder, as the person,
 *     with every check the page's save makes (who may, R1, R3), as the
 *     rules of every live card - every incident and alert, at every
 *     severity - which the card says before it is approved.
 *
 * Only the person's own ladder: changing a member's is an admin's, on the
 * member's own How to Reach Me. It is of no one product, as the ladder's
 * route is: incidents, alerts and on-call all page through it.
 */

// The How to Reach Me page, as the Dashboard's page catalog writes its address.
export const HOW_TO_REACH_ME_DASHBOARD_PATH: string =
  "/dashboard/:projectId/user-settings/on-call-rules";

export const HOW_TO_REACH_ME_TITLE: string = "How to Reach Me";

// The ways a call names, as the person says them, and the channel of each.
export const LADDER_CHANNELS_BY_WORD: Readonly<
  Record<string, OnCallPageChannel>
> = {
  sms: OnCallPageChannel.SMS,
  call: OnCallPageChannel.Call,
  push: OnCallPageChannel.Push,
  email: OnCallPageChannel.Email,
  whatsapp: OnCallPageChannel.WhatsApp,
  telegram: OnCallPageChannel.Telegram,
  slack: OnCallPageChannel.Slack,
  microsoft_teams: OnCallPageChannel.MicrosoftTeams,
  mattermost: OnCallPageChannel.Mattermost,
  webhook: OnCallPageChannel.Webhook,
};

/*
 * The steps a call asks for, as a default ladder's steps (a channel and a
 * wait): each way it names, at a whole number of minutes from 0 to a day,
 * at most as many as a default holds, ordered and each said once
 * (readPagingLadderDefault). What cannot be read is no step.
 */
export function readLadderSteps(
  args: JSONObject,
): Array<PagingLadderDefaultStep> {
  const sent: unknown = args["steps"];

  if (!Array.isArray(sent)) {
    return [];
  }

  const steps: Array<PagingLadderDefaultStep> = [];

  for (const entry of sent.slice(0, MAX_PAGING_LADDER_DEFAULT_STEPS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const step: Record<string, unknown> = entry as Record<string, unknown>;
    const word: string =
      typeof step["by"] === "string" ? step["by"].trim().toLowerCase() : "";
    const channel: OnCallPageChannel | undefined =
      LADDER_CHANNELS_BY_WORD[word];

    if (!channel) {
      continue;
    }

    const asked: number = Number(step["afterMinutes"] ?? 0);
    const minutes: number = Number.isFinite(asked)
      ? Math.min(
          Math.max(Math.round(asked), 0),
          MAX_PAGING_LADDER_WAIT_IN_MINUTES,
        )
      : 0;

    steps.push({ channel: channel, notifyAfterMinutes: minutes });
  }

  return readPagingLadderDefault(steps);
}

/*
 * The steps written out as the call runs with them: each way, by the word
 * the call takes, and its wait - so the person approves what runs.
 */
function toArgumentSteps(
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): Array<JSONObject> {
  return steps.map((step: PagingLadderDefaultStep): JSONObject => {
    const word: string =
      Object.keys(LADDER_CHANNELS_BY_WORD).find((key: string): boolean => {
        return LADDER_CHANNELS_BY_WORD[key] === step.channel;
      }) || "";

    return { by: word, afterMinutes: step.notifyAfterMinutes };
  });
}

// What the person's ladder would become, from what they have.
export interface LadderPlan {
  asked: Array<PagingLadderDefaultStep>;
  fromDefault: PagingLadderFromDefault;
  current: Array<PagingLadderStep>;
}

/*
 * The person's verified methods and their ladder now, read as the ladder's
 * page reads them for its save (PagingLadderService), and the ladder the
 * asked steps make of them.
 */
async function planLadder(
  ctx: ToolContext,
  asked: Array<PagingLadderDefaultStep>,
): Promise<LadderPlan> {
  const userId: ObjectID = new ObjectID(ctx.props.userId!.toString());

  const [methods, cells, rules]: [
    Array<PagingLadderMethodReference>,
    Array<PagingLadderCell>,
    Array<UserNotificationRule>,
  ] = await Promise.all([
    PagingLadderService.getUsableMethods({
      projectId: ctx.projectId,
      userId: userId,
    }),
    PagingLadderService.getCells(ctx.projectId),
    PagingLadderService.getRules({
      projectId: ctx.projectId,
      userId: userId,
    }),
  ]);

  const current: Array<PagingLadderStep> = readPagingLadder({
    cells: cells,
    rules: rules as unknown as Array<PagingLadderRule>,
  }).steps;

  return {
    asked: asked,
    current: current,
    fromDefault: getPagingLadderFromDefault({
      defaultSteps: asked,
      methods: methods,
      currentSteps: current,
    }),
  };
}

// The ways of one wait, in a list a sentence says: "SMS and phone call".
function channelList(
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): ReturnType<typeof aiActionList> {
  const channels: Array<OnCallPageChannel> = [];

  for (const step of steps) {
    if (!channels.includes(step.channel)) {
      channels.push(step.channel);
    }
  }

  return aiActionList(channels.map(aiActionChannel));
}

// The steps a ladder takes, by wait, soonest first.
function groupByWait(
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): Array<{ minutes: number; steps: Array<PagingLadderDefaultStep> }> {
  const groups: Array<{
    minutes: number;
    steps: Array<PagingLadderDefaultStep>;
  }> = [];

  for (const step of [...steps].sort(
    (a: PagingLadderDefaultStep, b: PagingLadderDefaultStep): number => {
      return a.notifyAfterMinutes - b.notifyAfterMinutes;
    },
  )) {
    const last:
      | { minutes: number; steps: Array<PagingLadderDefaultStep> }
      | undefined = groups[groups.length - 1];

    if (last && last.minutes === step.notifyAfterMinutes) {
      last.steps.push(step);
    } else {
      groups.push({ minutes: step.notifyAfterMinutes, steps: [step] });
    }
  }

  return groups;
}

/*
 * What the approval card says: the ladder a step a line - at once, then
 * after each wait - the ways left out until a method of them is verified,
 * and that it replaces how pages reach the person now, everywhere.
 */
export function describeLadderForPerson(
  plan: Pick<PagingLadderFromDefault, "appliedSteps" | "leftOutChannels">,
): Array<AIActionSentence> {
  const sentences: Array<AIActionSentence> = groupByWait(plan.appliedSteps).map(
    (group: {
      minutes: number;
      steps: Array<PagingLadderDefaultStep>;
    }): AIActionSentence => {
      return group.minutes === 0
        ? aiActionSentence(AI_ACTION_LINES.reachAtOnce, {
            methods: channelList(group.steps),
          })
        : aiActionPluralSentence(
            AI_ACTION_PLURAL_LINES.reachAfter,
            group.minutes,
            { methods: channelList(group.steps) },
          );
    },
  );

  if (plan.leftOutChannels.length > 0) {
    sentences.push(
      aiActionSentence(AI_ACTION_LINES.reachLeftOut, {
        methods: aiActionList(plan.leftOutChannels.map(aiActionChannel)),
      }),
    );
  }

  if (plan.appliedSteps.length > 0) {
    sentences.push(aiActionSentence(AI_ACTION_LINES.reachReplaces));
  }

  return sentences;
}

// The ladder as the card it leaves says it: a step a line, no full stops.
function describeLadderOnCard(
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): Array<AIActionSentence> {
  return groupByWait(steps).map(
    (group: {
      minutes: number;
      steps: Array<PagingLadderDefaultStep>;
    }): AIActionSentence => {
      return group.minutes === 0
        ? aiActionSentence(AI_ACTION_CARD_LINES.reachAtOnce, {
            methods: channelList(group.steps),
          })
        : aiActionPluralSentence(
            AI_ACTION_PLURAL_LINES.reachAfterOnCard,
            group.minutes,
            { methods: channelList(group.steps) },
          );
    },
  );
}

// The ladder in English, for the model: "SMS at once, then phone call after 5 minutes".
export function describeLadderInEnglish(
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): string {
  return groupByWait(steps)
    .map(
      (group: {
        minutes: number;
        steps: Array<PagingLadderDefaultStep>;
      }): string => {
        const ways: string = group.steps
          .map((step: PagingLadderDefaultStep): string => {
            return getOnCallPageChannelName(step.channel);
          })
          .join(" and ");

        return group.minutes === 0
          ? `${ways} at once`
          : `${ways} after ${group.minutes} minute${group.minutes === 1 ? "" : "s"}`;
      },
    )
    .join(", then ");
}

const NOTHING_ASKED: string =
  "Nothing proposed: say how to reach the person, a step at a time - by sms, call, push, email, whatsapp, telegram, slack, microsoft_teams, mattermost or webhook, each with afterMinutes (0 for at once) - and propose it again.";

const NOTHING_VERIFIED: (
  channels: ReadonlyArray<OnCallPageChannel>,
) => string = (channels: ReadonlyArray<OnCallPageChannel>): string => {
  return `Nothing proposed: the person has verified no method of any way they asked to be reached (${channels
    .map((channel: OnCallPageChannel): string => {
      return getOnCallPageChannelName(channel);
    })
    .join(
      ", ",
    )}), so no step would reach them. Ask AI never adds a phone number or the app: tell them to add and verify one in Notification Methods, end with that page's citation (find_dashboard_page "Notification Methods"), and offer to set this up again once it is verified.`;
};

const ALREADY_THE_LADDER: string =
  "Nothing proposed: pages already reach the person exactly this way. Say so in one sentence.";

// The page a ladder is changed on, as the card and the citation open it.
const HOW_TO_REACH_ME_PAGE: AIChatCitationTarget = {
  type: AIChatCitationTargetType.DashboardPage,
  params: {
    path: HOW_TO_REACH_ME_DASHBOARD_PATH,
    title: HOW_TO_REACH_ME_TITLE,
  },
};

export const SetHowToReachMeTool: ObservabilityTool = {
  name: "set_how_to_reach_me",
  description:
    "Set how pages reach the person asking - 'text me, then call me after five minutes' - as their How to Reach Me ladder: each step a way to be reached and a wait, for every incident and alert at every severity. Each way is mapped to the person's own verified methods of it; a way they have not verified is left out, and the card says where to add it: never ask for or add a phone number or the app. Only the person's own ladder. Propose it beside set_up_paging when the person says how they want to be reached. It always shows the person an approval card, in every mode.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        description:
          "The ladder, in order: [{ by: 'sms', afterMinutes: 0 }, { by: 'call', afterMinutes: 5 }] for 'text me, then call me after five minutes'. Ways that go together share a wait.",
        items: {
          type: "object",
          properties: {
            by: {
              type: "string",
              enum: Object.keys(LADDER_CHANNELS_BY_WORD),
              description:
                "How: sms ('text me'), call ('phone me'), push ('notify my phone'), email, whatsapp, telegram, slack, microsoft_teams, mattermost, webhook.",
            },
            afterMinutes: {
              type: "number",
              description:
                "Minutes after the page starts, 0 to 1440. 0 (the default) is at once.",
            },
          },
          required: ["by"],
        },
      },
    },
    required: ["steps"],
  },
  // Every signed-in member may change their own ladder.
  requiredPermissions: [Permission.CurrentUser],
  isMutation: true,
  setupAction: { planOrder: SETUP_PLAN_ORDER.howToReachMe },
  buildActionTitle: (): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.setHowToReachMe);
  },
  /*
   * The steps written out as they run, and what the card says: the ladder
   * the person's verified methods make of them, what is left out, and
   * that it replaces how pages reach them now.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const asked: Array<PagingLadderDefaultStep> = readLadderSteps(args);
    const prepared: JSONObject = {
      ...args,
      steps: toArgumentSteps(asked),
    };

    if (asked.length === 0 || !ctx.props.userId) {
      return { arguments: prepared };
    }

    try {
      const plan: LadderPlan = await planLadder(ctx, asked);

      return {
        arguments: prepared,
        description: describeLadderForPerson(plan.fromDefault),
        describedArguments: ["steps"],
      };
    } catch {
      // Unreadable now: running it says why.
      return { arguments: prepared };
    }
  },
  checkBeforeApproval: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<SetupActionRefusal | null> => {
    const asked: Array<PagingLadderDefaultStep> = readLadderSteps(args);

    if (asked.length === 0) {
      return { toldModel: NOTHING_ASKED };
    }

    if (!ctx.props.userId) {
      return null;
    }

    try {
      const plan: LadderPlan = await planLadder(ctx, asked);

      if (plan.fromDefault.steps.length === 0) {
        return {
          toldModel: NOTHING_VERIFIED(plan.fromDefault.leftOutChannels),
        };
      }

      if (isSamePagingLadder(plan.fromDefault.steps, plan.current)) {
        return { toldModel: ALREADY_THE_LADDER };
      }
    } catch {
      // Unreadable now: running it says why.
    }

    return null;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const asked: Array<PagingLadderDefaultStep> = readLadderSteps(args);

    if (asked.length === 0) {
      throw new BadDataException(NOTHING_ASKED);
    }

    if (!ctx.props.userId) {
      throw new BadDataException(
        "Only a signed-in person sets how pages reach them.",
      );
    }

    // Read again now: a method may have been verified since the card was shown.
    const plan: LadderPlan = await planLadder(ctx, asked);

    if (plan.fromDefault.steps.length === 0) {
      throw new BadDataException(
        NOTHING_VERIFIED(plan.fromDefault.leftOutChannels),
      );
    }

    // As the person: the ladder page's own save, with its every check.
    const saved: PagingLadderSaveResult = await PagingLadderService.applyLadder(
      {
        projectId: ctx.projectId,
        targetUserId: new ObjectID(ctx.props.userId.toString()),
        steps: plan.fromDefault.steps,
        props: ctx.props,
      },
    );

    const applied: Array<PagingLadderDefaultStep> =
      plan.fromDefault.appliedSteps;
    const leftOut: Array<OnCallPageChannel> = plan.fromDefault.leftOutChannels;
    const keptCustom: boolean = plan.fromDefault.keptSteps.some(
      (step: PagingLadderStep): boolean => {
        return step.methodColumn === "customNotificationChannelId";
      },
    );

    return {
      dataForLlm: `Saved how pages reach the person, as their How to Reach Me ladder: ${describeLadderInEnglish(applied)}, for every incident and alert at every severity (${saved.createdCount} rules added, ${saved.updatedCount} changed, ${saved.deletedCount} removed).${
        leftOut.length > 0
          ? ` Left out, because the person has no verified method of it yet: ${leftOut
              .map((channel: OnCallPageChannel): string => {
                return getOnCallPageChannelName(channel);
              })
              .join(
                ", ",
              )}. Tell them to add and verify one in Notification Methods, and end with that page's citation (find_dashboard_page "Notification Methods").`
          : ""
      }${keptCustom ? " Their custom channels' steps were kept." : ""} ${getTestPageOfferForModel(ctx, SetupTestPageTarget.Self)}`,
      rowCount: 1,
      ...citationSentence(AI_TOOL_CITATIONS.savedHowToReachMe),
      citationTarget: HOW_TO_REACH_ME_PAGE,
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "How to Reach Me saved",
        heading: HOW_TO_REACH_ME_TITLE,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.howToReachMe),
          line: describeLadderOnCard(applied),
        },
        link: HOW_TO_REACH_ME_PAGE,
        testPage: { kind: "self" },
      }),
    };
  },
};
