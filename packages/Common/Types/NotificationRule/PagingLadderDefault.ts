import {
  MAX_PAGING_LADDER_WAIT_IN_MINUTES,
  PAGING_LADDER_API_PATH,
  PagingLadderStep,
  PagingMethodColumn,
  getChannelForPagingMethodColumn,
  getPagingLadderMethodKey,
  getPagingLadderStepKey,
  getPagingMethodColumnForChannel,
  isPagingMethodColumn,
  normalizePagingLadderSteps,
  readPagingId,
} from "./PagingLadder";
import PushNotificationLevel, {
  PUSH_NOTIFICATION_LEVELS,
} from "./PushNotificationLevel";
import {
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "./NotificationRepeat";
import { JSONArray, JSONObject } from "../JSON";
import Permission from "../Permission";
import {
  OnCallPageChannel,
  getOnCallPageChannelName,
} from "../OnCallDutyPolicy/OnCallPageChannel";

/*
 * THE PROJECT'S DEFAULT LADDER (#7449, #7450), AND ITS ASK FOR A PHONE.
 *
 * How to Reach Me (#6820, PagingLadder) is one person's ladder: "push and
 * SMS at once, then a call after 5 minutes", each step one of their own
 * verified methods. A project admin can say the same once for everybody,
 * by channel instead of by method: the project's default ladder
 * (Project.defaultPagingLadder). It is used in two places:
 *
 *   - As members verify a way to be reached (UserNotificationRuleService.
 *     addDefaultNotificationRulesForVerifiedMethod), and as a new member's
 *     email is verified when they join: a method of a channel the default
 *     names gets its rules at the default's waits in every card, instead
 *     of "at once"; a channel the default leaves out gets no on-call rules
 *     (the on-call and off-call shift rules stay, and the project's
 *     fallback still reaches somebody who has no rule at all). It never
 *     rewrites a rule anybody has: setting a default changes nobody.
 *
 *   - From On-Call > Readiness, an admin applies it to members they pick
 *     (PagingLadderService.applyDefaultLadder): each member's ladder becomes
 *     the default, mapped to the methods they have verified
 *     (getPagingLadderFromDefault), saved through applyLadder with its
 *     checks, its audit entries and its one email.
 *
 * Custom channels are nobody's own and are never part of a default: one
 * that pages everyone keeps paging everyone.
 *
 * "People on an on-call policy need a phone method" (Project.
 * requirePhoneMethodForOnCall) is the default's companion: nobody is locked
 * out by it. Readiness names, on each responder, whether they have no
 * verified SMS, phone call or WhatsApp method while the project asks for
 * one (isMissingRequiredPhoneMethod), Setup health lists them from that
 * answer, and the setup reminder and How to Reach Me ask them to add one.
 *
 * Pure: no models, no database, no React.
 */

// Where the Dashboard applies the default to a member (Server/API/PagingLadderAPI).
export const PAGING_LADDER_APPLY_DEFAULT_ROUTE: string = `${PAGING_LADDER_API_PATH}/apply-default`;

/*
 * Who, besides the person, may change their rules - and so who may apply the
 * project's default to members: the write list of UserNotificationRule
 * without CurrentUser, which every signed-in caller holds
 * (PagingLadderService pins the two to each other). The Dashboard offers
 * Readiness's Apply Default Ladder to them alone; the server asks again.
 */
export const PAGING_LADDER_ADMIN_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectUserNotificationRule,
];

// How many members one request may name.
export const MAX_PAGING_LADDER_DEFAULT_MEMBERS: number = 100;

// How many steps a default may hold.
export const MAX_PAGING_LADDER_DEFAULT_STEPS: number = 20;

/*
 * The channels a default may name: every way a person is reached that is
 * their own, gentlest first, as the ladder lists steps that go together.
 */
export const PAGING_LADDER_DEFAULT_CHANNELS: ReadonlyArray<OnCallPageChannel> =
  [
    OnCallPageChannel.Push,
    OnCallPageChannel.Email,
    OnCallPageChannel.SMS,
    OnCallPageChannel.Call,
    OnCallPageChannel.WhatsApp,
    OnCallPageChannel.Telegram,
    OnCallPageChannel.Slack,
    OnCallPageChannel.MicrosoftTeams,
    OnCallPageChannel.Mattermost,
    OnCallPageChannel.Webhook,
  ];

/*
 * What "a phone method" is, for the project's ask: a number that is
 * texted, rung or messaged on WhatsApp.
 */
export const PHONE_PAGING_CHANNELS: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.SMS,
  OnCallPageChannel.Call,
  OnCallPageChannel.WhatsApp,
];

/*
 * One step of the default: a channel and its wait. A push step also says
 * how it sounds and how often it repeats; left out, a rule's own defaults
 * (Critical, no repeat).
 */
export interface PagingLadderDefaultStep {
  channel: OnCallPageChannel;
  notifyAfterMinutes: number;
  pushNotificationLevel?: PushNotificationLevel | undefined;
  repeatEveryMinutes?: number | undefined;
}

export const isPagingLadderDefaultChannel: (
  value: unknown,
) => value is OnCallPageChannel = (
  value: unknown,
): value is OnCallPageChannel => {
  return PAGING_LADDER_DEFAULT_CHANNELS.includes(value as OnCallPageChannel);
};

/*
 * A default step as a step of a ladder whose "method" is the channel itself:
 * the editor draws a default with the person's editor, and the default is
 * ordered, tidied and compared with the ladder's own rules.
 */
export const toPagingLadderStepOfChannel: (
  step: PagingLadderDefaultStep,
) => PagingLadderStep = (step: PagingLadderDefaultStep): PagingLadderStep => {
  const ladderStep: PagingLadderStep = {
    methodColumn: getPagingMethodColumnForChannel(step.channel)!,
    methodId: step.channel,
    notifyAfterMinutes: step.notifyAfterMinutes,
  };

  if (step.channel === OnCallPageChannel.Push) {
    ladderStep.pushNotificationLevel = step.pushNotificationLevel;
    ladderStep.repeatEveryMinutes = step.repeatEveryMinutes;
  }

  return ladderStep;
};

// A ladder step whose method is a channel, back as a default step; null for any other.
export const toPagingLadderDefaultStep: (
  step: PagingLadderStep,
) => PagingLadderDefaultStep | null = (
  step: PagingLadderStep,
): PagingLadderDefaultStep | null => {
  if (!isPagingMethodColumn(step.methodColumn)) {
    return null;
  }

  const channel: OnCallPageChannel = getChannelForPagingMethodColumn(
    step.methodColumn,
  );

  if (!isPagingLadderDefaultChannel(channel)) {
    return null;
  }

  const defaultStep: PagingLadderDefaultStep = {
    channel: channel,
    notifyAfterMinutes: step.notifyAfterMinutes,
  };

  if (channel === OnCallPageChannel.Push) {
    defaultStep.pushNotificationLevel = step.pushNotificationLevel;
    defaultStep.repeatEveryMinutes = step.repeatEveryMinutes;
  }

  return defaultStep;
};

/*
 * Why a default sent to the server cannot be saved, as a sentence that says
 * what to do; null when it can. Nothing (null, or no steps) is a default
 * turned off, and can always be saved.
 */
export const getPagingLadderDefaultProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    return "The default ladder was not sent in a way OneUptime can read. Reload the page, then save again.";
  }

  if (value.length > MAX_PAGING_LADDER_DEFAULT_STEPS) {
    return `A default ladder has at most ${MAX_PAGING_LADDER_DEFAULT_STEPS} steps. Remove some, then save.`;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return "Each step of the default ladder needs a way to reach people and a wait. Choose both, then save.";
    }

    const step: Record<string, unknown> = entry as Record<string, unknown>;

    if (!isPagingLadderDefaultChannel(step["channel"])) {
      return "A step of the default ladder names a way to reach people that a default cannot use. Choose push, email, SMS, a phone call or another listed way, then save.";
    }

    const wait: unknown = step["notifyAfterMinutes"];

    if (
      typeof wait !== "number" ||
      !Number.isInteger(wait) ||
      wait < 0 ||
      wait > MAX_PAGING_LADDER_WAIT_IN_MINUTES
    ) {
      return "A step's wait must be a whole number of minutes from 0 to 1440 (a day). Choose another wait, then save.";
    }

    const level: unknown = step["pushNotificationLevel"];

    if (
      level !== undefined &&
      level !== null &&
      !PUSH_NOTIFICATION_LEVELS.includes(level as PushNotificationLevel)
    ) {
      return "A push step must sound as a Critical alert or a Standard notification. Choose one, then save.";
    }

    const repeat: unknown = step["repeatEveryMinutes"];

    if (
      repeat !== undefined &&
      repeat !== null &&
      repeat !== NO_NOTIFICATION_REPEAT &&
      !REPEAT_EVERY_MINUTES_OPTIONS.includes(repeat as number)
    ) {
      return "A push step repeats every 1, 2, 3, 5, 10, 15 or 30 minutes, or not at all. Choose one, then save.";
    }

    if (
      step["channel"] !== OnCallPageChannel.Push &&
      typeof repeat === "number" &&
      repeat !== NO_NOTIFICATION_REPEAT
    ) {
      return "Only a push step can repeat until acknowledged. Turn repeating off for the other steps, then save.";
    }
  }

  return null;
};

/*
 * A default as it is kept: the steps that can be read, each said once (a
 * channel at one wait), push settings made explicit on a push step and left
 * off the others, in the order they page - by wait, then gentlest first.
 * Anything that cannot be read is no step: a value stored by hand, or by a
 * build that knew a channel this one does not, never pages anybody wrongly.
 * Empty when the project has no default.
 */
export const readPagingLadderDefault: (
  value: unknown,
) => Array<PagingLadderDefaultStep> = (
  value: unknown,
): Array<PagingLadderDefaultStep> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: Array<PagingLadderStep> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const step: Record<string, unknown> = entry as Record<string, unknown>;
    const channel: unknown = step["channel"];
    const wait: unknown = step["notifyAfterMinutes"];

    if (
      !isPagingLadderDefaultChannel(channel) ||
      typeof wait !== "number" ||
      !Number.isFinite(wait) ||
      wait < 0 ||
      wait > MAX_PAGING_LADDER_WAIT_IN_MINUTES
    ) {
      continue;
    }

    steps.push(
      toPagingLadderStepOfChannel({
        channel: channel,
        notifyAfterMinutes: wait,
        pushNotificationLevel: step["pushNotificationLevel"] as
          | PushNotificationLevel
          | undefined,
        repeatEveryMinutes: step["repeatEveryMinutes"] as number | undefined,
      }),
    );
  }

  return normalizePagingLadderSteps(steps)
    .map(toPagingLadderDefaultStep)
    .filter(
      (
        step: PagingLadderDefaultStep | null,
      ): step is PagingLadderDefaultStep => {
        return step !== null;
      },
    )
    .slice(0, MAX_PAGING_LADDER_DEFAULT_STEPS);
};

/*
 * A default as it is stored on the project: its steps as JSON, or null for
 * none - which turns the default off.
 */
export const toPagingLadderDefaultJSON: (
  steps: ReadonlyArray<PagingLadderDefaultStep>,
) => JSONArray | null = (
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): JSONArray | null => {
  const normalized: Array<PagingLadderDefaultStep> =
    readPagingLadderDefault(steps);

  if (normalized.length === 0) {
    return null;
  }

  return normalized.map((step: PagingLadderDefaultStep): JSONObject => {
    const json: JSONObject = {
      channel: step.channel,
      notifyAfterMinutes: step.notifyAfterMinutes,
    };

    if (step.channel === OnCallPageChannel.Push) {
      if (step.pushNotificationLevel) {
        json["pushNotificationLevel"] = step.pushNotificationLevel;
      }

      if (step.repeatEveryMinutes !== undefined) {
        json["repeatEveryMinutes"] = step.repeatEveryMinutes;
      }
    }

    return json;
  });
};

// The default's channels, each once, in the order it names them.
export const getPagingLadderDefaultChannels: (
  steps: ReadonlyArray<PagingLadderDefaultStep>,
) => Array<OnCallPageChannel> = (
  steps: ReadonlyArray<PagingLadderDefaultStep>,
): Array<OnCallPageChannel> => {
  const channels: Array<OnCallPageChannel> = [];

  for (const step of steps) {
    if (!channels.includes(step.channel)) {
      channels.push(step.channel);
    }
  }

  return channels;
};

/*
 * The default's steps for one channel - a method of it just verified gets a
 * rule at each one's wait in every card. Empty when the default leaves the
 * channel out (or there is no default: the caller tells the two apart).
 */
export const getPagingLadderDefaultStepsForChannel: (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  channel: OnCallPageChannel | string;
}) => Array<PagingLadderDefaultStep> = (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  channel: OnCallPageChannel | string;
}): Array<PagingLadderDefaultStep> => {
  return readPagingLadderDefault(data.defaultSteps).filter(
    (step: PagingLadderDefaultStep): boolean => {
      return step.channel === data.channel;
    },
  );
};

// One of a member's verified methods, as a ladder names it.
export interface PagingLadderMethodReference {
  methodColumn: PagingMethodColumn;
  methodId: string;
}

// A member's ladder from the project's default, and what it took and left.
export interface PagingLadderFromDefault {
  /*
   * The ladder to save: the default's steps, one per verified method of
   * each step's channel, with the member's own steps it keeps. Empty when
   * the member has verified none of the default's channels: nothing is
   * saved for them.
   */
  steps: Array<PagingLadderStep>;
  // The default's steps the member follows: a channel they have verified.
  appliedSteps: Array<PagingLadderDefaultStep>;
  // The default's channels the member has no verified method of.
  leftOutChannels: Array<OnCallPageChannel>;
  /*
   * The member's own steps kept beside the default: a custom channel's,
   * always, and - when the default names a channel they have not verified
   * - the steps of channels the default leaves out, so they are not left
   * reachable by less than before while they set that channel up.
   */
  keptSteps: Array<PagingLadderStep>;
}

/*
 * A MEMBER'S LADDER FROM THE PROJECT'S DEFAULT (#7450).
 *
 * Each default step becomes a step for every method the member has
 * verified of its channel: "SMS at once" is both their numbers at once.
 * A channel they have verified no method of is left out, and named.
 *
 * Their own steps are replaced, but for two kinds:
 *
 *   - a custom channel's steps stay, always: a custom channel is nobody's
 *     own, and one that pages everyone was put in everybody's rules by the
 *     project (AddCustomChannelToEveryonesRules);
 *   - while a channel of the default is left out, they keep their own steps
 *     of the channels the default does not name. Somebody with no verified
 *     phone keeps their email at once in place of the SMS and the call they
 *     cannot have yet: applying the default never leaves them reachable by
 *     less than before.
 *
 * A member who has verified none of the default's channels gets nothing:
 * their rules stay as they are, and they are named.
 */
export const getPagingLadderFromDefault: (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  // The member's verified methods (custom channels are left out of a default).
  methods: ReadonlyArray<PagingLadderMethodReference>;
  // The member's ladder now (readPagingLadder's steps).
  currentSteps?: ReadonlyArray<PagingLadderStep> | undefined;
}) => PagingLadderFromDefault = (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  methods: ReadonlyArray<PagingLadderMethodReference>;
  currentSteps?: ReadonlyArray<PagingLadderStep> | undefined;
}): PagingLadderFromDefault => {
  const defaultSteps: Array<PagingLadderDefaultStep> = readPagingLadderDefault(
    data.defaultSteps,
  );

  // The member's methods by channel, each once, in the order given.
  const methodsByChannel: Map<
    OnCallPageChannel,
    Array<PagingLadderMethodReference>
  > = new Map<OnCallPageChannel, Array<PagingLadderMethodReference>>();
  const verifiedKeys: Set<string> = new Set<string>();

  for (const method of data.methods) {
    if (
      !isPagingMethodColumn(method.methodColumn) ||
      method.methodColumn === "customNotificationChannelId"
    ) {
      continue;
    }

    const methodId: string = readPagingId(method.methodId);
    const key: string = getPagingLadderMethodKey({
      methodColumn: method.methodColumn,
      methodId: methodId,
    });

    if (!methodId || verifiedKeys.has(key)) {
      continue;
    }

    verifiedKeys.add(key);

    const channel: OnCallPageChannel = getChannelForPagingMethodColumn(
      method.methodColumn,
    );
    const list: Array<PagingLadderMethodReference> =
      methodsByChannel.get(channel) || [];
    list.push({ methodColumn: method.methodColumn, methodId: methodId });
    methodsByChannel.set(channel, list);
  }

  const mapped: Array<PagingLadderStep> = [];
  const appliedSteps: Array<PagingLadderDefaultStep> = [];
  const leftOutChannels: Array<OnCallPageChannel> = [];

  for (const defaultStep of defaultSteps) {
    const methods: Array<PagingLadderMethodReference> =
      methodsByChannel.get(defaultStep.channel) || [];

    if (methods.length === 0) {
      if (!leftOutChannels.includes(defaultStep.channel)) {
        leftOutChannels.push(defaultStep.channel);
      }

      continue;
    }

    appliedSteps.push({ ...defaultStep });

    for (const method of methods) {
      const step: PagingLadderStep = {
        methodColumn: method.methodColumn,
        methodId: method.methodId,
        notifyAfterMinutes: defaultStep.notifyAfterMinutes,
      };

      if (method.methodColumn === "userPushId") {
        step.pushNotificationLevel = defaultStep.pushNotificationLevel;
        step.repeatEveryMinutes = defaultStep.repeatEveryMinutes;
      }

      mapped.push(step);
    }
  }

  if (appliedSteps.length === 0) {
    return {
      steps: [],
      appliedSteps: [],
      leftOutChannels: leftOutChannels,
      keptSteps: [],
    };
  }

  const defaultChannels: Array<OnCallPageChannel> =
    getPagingLadderDefaultChannels(defaultSteps);

  const keptSteps: Array<PagingLadderStep> = normalizePagingLadderSteps(
    (data.currentSteps || []).filter((step: PagingLadderStep): boolean => {
      if (step.methodColumn === "customNotificationChannelId") {
        return true;
      }

      if (leftOutChannels.length === 0) {
        return false;
      }

      return (
        !defaultChannels.includes(
          getChannelForPagingMethodColumn(step.methodColumn),
        ) && verifiedKeys.has(getPagingLadderMethodKey(step))
      );
    }),
  );

  return {
    steps: normalizePagingLadderSteps([...mapped, ...keptSteps]),
    appliedSteps: appliedSteps,
    leftOutChannels: leftOutChannels,
    keptSteps: keptSteps,
  };
};

// Whether two ladders page the same way: the same steps, push settings included.
export const isSamePagingLadder: (
  first: ReadonlyArray<PagingLadderStep>,
  second: ReadonlyArray<PagingLadderStep>,
) => boolean = (
  first: ReadonlyArray<PagingLadderStep>,
  second: ReadonlyArray<PagingLadderStep>,
): boolean => {
  const signature: (steps: ReadonlyArray<PagingLadderStep>) => string = (
    steps: ReadonlyArray<PagingLadderStep>,
  ): string => {
    return normalizePagingLadderSteps(steps)
      .map(getPagingLadderStepKey)
      .join(",");
  };

  return signature(first) === signature(second);
};

/*
 * START FROM THE PROJECT'S DEFAULT, ON HOW TO REACH ME (#9445).
 *
 * Somebody who joined before the project had a default ladder, or who has
 * changed theirs since, can put the default into their own ladder without
 * asking an admin: their steps are filled with it, mapped to their verified
 * methods as Readiness's Apply Default Ladder maps it
 * (getPagingLadderFromDefault: a channel they have not verified is left out
 * and named, and they keep their own steps in its place). Nothing is saved
 * until they press Save Changes: their own change, through the ladder's own
 * save. An admin on a member's page gets the same draft, saved for the
 * member with its audit entries and its one email.
 *
 * Offered only when it would change their steps: the project has a default,
 * they have verified a method of one of its channels, and their ladder is
 * not already what the default gives them. Null when it is not offered.
 */
export const getPagingLadderDefaultStart: (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  // Their verified methods: one still waiting for its code is no step.
  methods: ReadonlyArray<PagingLadderMethodReference>;
  // Their ladder as saved (readPagingLadder's steps).
  currentSteps: ReadonlyArray<PagingLadderStep>;
}) => PagingLadderFromDefault | null = (data: {
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  methods: ReadonlyArray<PagingLadderMethodReference>;
  currentSteps: ReadonlyArray<PagingLadderStep>;
}): PagingLadderFromDefault | null => {
  if (readPagingLadderDefault(data.defaultSteps).length === 0) {
    return null;
  }

  const fromDefault: PagingLadderFromDefault = getPagingLadderFromDefault({
    defaultSteps: data.defaultSteps,
    methods: data.methods,
    currentSteps: data.currentSteps,
  });

  if (
    fromDefault.steps.length === 0 ||
    isSamePagingLadder(fromDefault.steps, data.currentSteps)
  ) {
    return null;
  }

  return fromDefault;
};

/*
 * Whether somebody is missing the phone method their project asks people on
 * call to have: the ask is on, and none of their verified methods is a
 * number texted, rung or messaged on WhatsApp. Readiness answers it once per
 * responder; Setup health, the setup reminder and the Readiness page read
 * that answer.
 */
export const isMissingRequiredPhoneMethod: (data: {
  isRequired: boolean | null | undefined;
  // The channels of their verified methods ("SMS", "Call", "Email" ...).
  verifiedChannels: ReadonlyArray<OnCallPageChannel | string>;
}) => boolean = (data: {
  isRequired: boolean | null | undefined;
  verifiedChannels: ReadonlyArray<OnCallPageChannel | string>;
}): boolean => {
  if (data.isRequired !== true) {
    return false;
  }

  return !data.verifiedChannels.some(
    (channel: OnCallPageChannel | string): boolean => {
      return PHONE_PAGING_CHANNELS.includes(channel as OnCallPageChannel);
    },
  );
};

// What applying the default did for one member.
export enum PagingLadderDefaultOutcome {
  // Their ladder is now the default, as far as their methods go.
  Applied = "Applied",
  // Nothing was changed: they have none of the default's channels verified.
  Skipped = "Skipped",
  // Refused or failed: nothing was changed for them.
  Failed = "Failed",
}

// One member's answer from POST /paging-ladder/apply-default.
export interface PagingLadderDefaultMemberResult {
  userId: string;
  outcome: PagingLadderDefaultOutcome;
  appliedSteps: Array<PagingLadderDefaultStep>;
  leftOutChannels: Array<OnCallPageChannel>;
  // The channels of the member's own steps kept beside the default.
  keptChannels: Array<OnCallPageChannel>;
  // How many of their rule rows were created, changed or deleted.
  changedRuleCount: number;
  // In English, for the API: why it was skipped or failed, or what it did.
  message: string;
}

/*
 * A request's answer, as the Dashboard reads it: each member's result, with
 * what cannot be read left out - an outcome it does not know is no result.
 */
export const readPagingLadderDefaultMemberResults: (
  value: unknown,
) => Array<PagingLadderDefaultMemberResult> = (
  value: unknown,
): Array<PagingLadderDefaultMemberResult> => {
  const results: unknown =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)["results"]
      : undefined;

  if (!Array.isArray(results)) {
    return [];
  }

  const channelsOf: (list: unknown) => Array<OnCallPageChannel> = (
    list: unknown,
  ): Array<OnCallPageChannel> => {
    return Array.isArray(list)
      ? list.filter((channel: unknown): channel is OnCallPageChannel => {
          return Object.values(OnCallPageChannel).includes(
            channel as OnCallPageChannel,
          );
        })
      : [];
  };

  const read: Array<PagingLadderDefaultMemberResult> = [];

  for (const entry of results) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const result: Record<string, unknown> = entry as Record<string, unknown>;
    const outcome: unknown = result["outcome"];

    if (
      !Object.values(PagingLadderDefaultOutcome).includes(
        outcome as PagingLadderDefaultOutcome,
      )
    ) {
      continue;
    }

    read.push({
      userId: readPagingId(result["userId"]),
      outcome: outcome as PagingLadderDefaultOutcome,
      appliedSteps: readPagingLadderDefault(result["appliedSteps"]),
      leftOutChannels: channelsOf(result["leftOutChannels"]),
      keptChannels: channelsOf(result["keptChannels"]),
      changedRuleCount: Number(result["changedRuleCount"]) || 0,
      message:
        typeof result["message"] === "string"
          ? (result["message"] as string)
          : "",
    });
  }

  return read;
};

export const PAGING_LADDER_DEFAULT_SKIPPED_MESSAGE: string =
  "Skipped: they have verified none of the ways the default ladder uses, so their own rules stay as they are.";

// The channels of steps, each once, in the order given.
export const getChannelsOfPagingLadderSteps: (
  steps: ReadonlyArray<PagingLadderStep>,
) => Array<OnCallPageChannel> = (
  steps: ReadonlyArray<PagingLadderStep>,
): Array<OnCallPageChannel> => {
  const channels: Array<OnCallPageChannel> = [];

  for (const step of steps) {
    if (!isPagingMethodColumn(step.methodColumn)) {
      continue;
    }

    const channel: OnCallPageChannel = getChannelForPagingMethodColumn(
      step.methodColumn,
    );

    if (!channels.includes(channel)) {
      channels.push(channel);
    }
  }

  return channels;
};

/*
 * What happened to one member, in English for the API's `message`: the
 * Dashboard says it in the reader's words from the codes beside it.
 */
export const describePagingLadderDefaultResult: (data: {
  outcome: PagingLadderDefaultOutcome;
  leftOutChannels: ReadonlyArray<OnCallPageChannel>;
  keptChannels: ReadonlyArray<OnCallPageChannel>;
}) => string = (data: {
  outcome: PagingLadderDefaultOutcome;
  leftOutChannels: ReadonlyArray<OnCallPageChannel>;
  keptChannels: ReadonlyArray<OnCallPageChannel>;
}): string => {
  if (data.outcome === PagingLadderDefaultOutcome.Skipped) {
    return PAGING_LADDER_DEFAULT_SKIPPED_MESSAGE;
  }

  const sentences: Array<string> = [
    "Applied the default ladder to their rules for every severity.",
  ];

  if (data.leftOutChannels.length > 0) {
    sentences.push(
      `Left out ${describeChannels(data.leftOutChannels)}: they have not verified ${
        data.leftOutChannels.length === 1 ? "it" : "them"
      } yet.`,
    );
  }

  const keptOwn: Array<OnCallPageChannel> = data.keptChannels.filter(
    (channel: OnCallPageChannel): boolean => {
      return channel !== OnCallPageChannel.CustomChannel;
    },
  );

  if (keptOwn.length > 0) {
    sentences.push(
      `Kept their own ${describeChannels(keptOwn)} steps meanwhile.`,
    );
  }

  return sentences.join(" ");
};

// Channels in an English sentence: "SMS and phone call".
function describeChannels(channels: ReadonlyArray<OnCallPageChannel>): string {
  const names: Array<string> = channels.map(getOnCallPageChannelName);

  if (names.length <= 1) {
    return names.join("");
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
