import { translationKey } from "../Translator";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerGlobalProbesStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../ServerSending/ServerSendingStatus";

/*
 * WHAT A NEW SELF-HOSTED SERVER NEEDS, AND WHERE EACH STANDS.
 *
 * A server that has just started is not finished: it cannot send email, SMS
 * or calls, it may be on plain HTTP, and nobody has decided who may sign up
 * (#6824). This is the one list of what it needs, in the order it matters,
 * each with what it is for, how it is checked, where it is fixed and how it
 * is tested:
 *
 *   - required:    email, HTTPS, who can sign up;
 *   - recommended: SMS and calls, a probe that reports, backups, update
 *                  checks;
 *   - optional:    browser push, an LLM provider, single sign-on.
 *
 * Whether each is done is worked out from the server's real state on every
 * read (Server/Utils/ServerSetup/ServerSetupChecklist reads the facts and
 * hands them to evaluate, below). The only things stored are what an admin
 * chose (GlobalConfig.serverSetupChoices): that a server does without
 * something ("We will use email and push only"), that it is backed up some
 * way the server cannot see, and each admin's "Hide" of the card.
 *
 * Read by the Admin Dashboard's Server setup page (/admin/setup), the card a
 * master admin sees on the Dashboard while a required check is open, and
 * `npm run doctor` (#6826), which prints the same checks in a terminal:
 * every sentence here is plain English with {{placeholders}}, filled by
 * fillTemplate there and translated in the browsers.
 *
 * Pure, with no Node or browser APIs.
 */

export enum ServerSetupCheckId {
  Email = "email",
  Https = "https",
  Signups = "signups",
  SmsAndCalls = "sms-and-calls",
  Probes = "probes",
  Backups = "backups",
  UpdateChecks = "update-checks",
  BrowserPush = "browser-push",
  AiProvider = "ai-provider",
  SingleSignOn = "single-sign-on",
}

export enum ServerSetupCheckTier {
  Required = "required",
  Recommended = "recommended",
  Optional = "optional",
}

/*
 * Where a check stands. Done, skipped and confirmed count as finished; the
 * others do not.
 *
 *   - not-set-up  nothing is set up for it yet;
 *   - untested    set up, and nothing has shown that it works yet (email,
 *                 SMS and calls: nothing has gone out since the settings
 *                 were saved);
 *   - failing     set up, and it does not work: why is in `failure`;
 *   - done        it works, as the server can see;
 *   - skipped     an admin chose to do without it;
 *   - confirmed   an admin said it is done, where the server cannot see it.
 */
export enum ServerSetupStatus {
  NotSetUp = "not-set-up",
  Untested = "untested",
  Failing = "failing",
  Done = "done",
  Skipped = "skipped",
  Confirmed = "confirmed",
}

export const FINISHED_SERVER_SETUP_STATUSES: ReadonlyArray<ServerSetupStatus> =
  [
    ServerSetupStatus.Done,
    ServerSetupStatus.Skipped,
    ServerSetupStatus.Confirmed,
  ];

// What an admin can choose for a check, when the server cannot decide it.
export enum ServerSetupChoiceKind {
  // The server does without it: SMS and calls, probes, update checks, or sign-ups kept open.
  Skipped = "skipped",
  // It is done some way the server cannot see: backups.
  Confirmed = "confirmed",
}

// One check, as the catalogue below describes it.
export interface ServerSetupCheckDefinition {
  id: ServerSetupCheckId;
  tier: ServerSetupCheckTier;
  title: string;
  /*
   * Where it is fixed: a page of the Admin Dashboard (its path), a guide in
   * the docs, or both. `npm run doctor` prints them after the server's
   * address.
   */
  adminPath?: string | undefined;
  guidePath?: string | undefined;
  // What an admin may choose instead of the server's own answer, if anything.
  choice: ServerSetupChoiceKind | null;
  // The test sends that prove it works.
  tests: ReadonlyArray<ServerSendingChannel>;
}

// The guides, for Docker Compose and the Helm chart alike.
export const SERVER_SETUP_GUIDES: {
  https: string;
  backups: string;
  updateChecks: string;
  browserPush: string;
} = {
  https: "/docs/installation/docker-compose#set-up-https",
  backups: "/docs/installation/docker-compose#back-up-and-restore",
  updateChecks: "/docs/self-hosted/update-checks",
  browserPush: "/docs/self-hosted/push-notifications#self-hosted-setup",
};

// The Admin Dashboard's pages each check is fixed on.
export const SERVER_SETUP_ADMIN_PATHS: {
  setup: string;
  email: string;
  authentication: string;
  callAndSms: string;
  probes: string;
  backups: string;
  llmProviders: string;
  singleSignOn: string;
} = {
  setup: "/admin/setup",
  email: "/admin/settings/smtp",
  authentication: "/admin/settings/authentication",
  callAndSms: "/admin/settings/call-and-sms",
  probes: "/admin/settings/probes",
  // Scheduled backups are the Enterprise Edition's (ee/AdminDashboard/Backups).
  backups: "/admin/settings/backups",
  llmProviders: "/admin/settings/llm-providers",
  singleSignOn: "/admin/settings/sso",
};

// Every check, in the order it matters.
export const SERVER_SETUP_CHECKS: ReadonlyArray<ServerSetupCheckDefinition> = [
  {
    id: ServerSetupCheckId.Email,
    tier: ServerSetupCheckTier.Required,
    title: translationKey("Email"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.email,
    choice: null,
    tests: [ServerSendingChannel.Email],
  },
  {
    id: ServerSetupCheckId.Https,
    tier: ServerSetupCheckTier.Required,
    title: translationKey("HTTPS"),
    guidePath: SERVER_SETUP_GUIDES.https,
    choice: null,
    tests: [],
  },
  {
    id: ServerSetupCheckId.Signups,
    tier: ServerSetupCheckTier.Required,
    title: translationKey("Sign-ups"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.authentication,
    choice: ServerSetupChoiceKind.Skipped,
    tests: [],
  },
  {
    id: ServerSetupCheckId.SmsAndCalls,
    tier: ServerSetupCheckTier.Recommended,
    title: translationKey("SMS and calls"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.callAndSms,
    choice: ServerSetupChoiceKind.Skipped,
    tests: [ServerSendingChannel.SMS, ServerSendingChannel.Call],
  },
  {
    id: ServerSetupCheckId.Probes,
    tier: ServerSetupCheckTier.Recommended,
    title: translationKey("Probes"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.probes,
    choice: ServerSetupChoiceKind.Skipped,
    tests: [],
  },
  {
    id: ServerSetupCheckId.Backups,
    tier: ServerSetupCheckTier.Recommended,
    title: translationKey("Backups"),
    guidePath: SERVER_SETUP_GUIDES.backups,
    choice: ServerSetupChoiceKind.Confirmed,
    tests: [],
  },
  {
    id: ServerSetupCheckId.UpdateChecks,
    tier: ServerSetupCheckTier.Recommended,
    title: translationKey("Update checks"),
    guidePath: SERVER_SETUP_GUIDES.updateChecks,
    choice: ServerSetupChoiceKind.Skipped,
    tests: [],
  },
  {
    id: ServerSetupCheckId.BrowserPush,
    tier: ServerSetupCheckTier.Optional,
    title: translationKey("Browser push notifications"),
    guidePath: SERVER_SETUP_GUIDES.browserPush,
    choice: null,
    tests: [],
  },
  {
    id: ServerSetupCheckId.AiProvider,
    tier: ServerSetupCheckTier.Optional,
    title: translationKey("LLM provider"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.llmProviders,
    choice: null,
    tests: [],
  },
  {
    id: ServerSetupCheckId.SingleSignOn,
    tier: ServerSetupCheckTier.Optional,
    title: translationKey("Single sign-on"),
    adminPath: SERVER_SETUP_ADMIN_PATHS.singleSignOn,
    choice: null,
    tests: [],
  },
];

/*
 * What each check says, per status: one line that says what it is for and
 * where it stands. A status a check never takes has no line.
 */
export const SERVER_SETUP_STATUS_WORDS: Readonly<
  Record<ServerSetupCheckId, Partial<Record<ServerSetupStatus, string>>>
> = {
  [ServerSetupCheckId.Email]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
    ),
    [ServerSetupStatus.Untested]: translationKey(
      "Set up, but not tested yet: send a test email to make sure it arrives.",
    ),
    [ServerSetupStatus.Failing]: translationKey(
      "Failing: emails have not gone out since {{time}}.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Set up: OneUptime sends invitations, password resets and alerts by email.",
    ),
  },
  [ServerSetupCheckId.Https]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up yet: passwords and sessions cross the network unencrypted, and passkeys need HTTPS.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "People reach this server over HTTPS.",
    ),
  },
  [ServerSetupCheckId.Signups]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Anyone who can open this server can create an account. Turn this off once your team has its accounts.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Only people you invite can create an account.",
    ),
    [ServerSetupStatus.Skipped]: translationKey(
      "Anyone who can open this server can create an account, as chosen.",
    ),
  },
  [ServerSetupCheckId.SmsAndCalls]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up yet: on-call alerts can only go out by email and push.",
    ),
    [ServerSetupStatus.Untested]: translationKey(
      "Set up, but not tested yet: send a test SMS or make a test call.",
    ),
    [ServerSetupStatus.Failing]: translationKey(
      "Failing: SMS or calls have not gone out since {{time}}.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Set up: OneUptime sends on-call alerts by SMS and calls.",
    ),
    [ServerSetupStatus.Skipped]: translationKey(
      "Not used: on-call alerts go out by email and push.",
    ),
  },
  [ServerSetupCheckId.Probes]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "No global probe is reporting, so monitors that run on global probes are not checked.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "A global probe is reporting, so monitors are being checked.",
    ),
    [ServerSetupStatus.Skipped]: translationKey("Marked as not needed."),
  },
  [ServerSetupCheckId.Backups]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up yet: back up the database regularly, so a lost disk does not lose your monitors, incidents and history.",
    ),
    [ServerSetupStatus.Failing]: translationKey(
      "Failing: the last backup failed on {{time}}.",
    ),
    [ServerSetupStatus.Done]: translationKey("Backed up on a schedule."),
    [ServerSetupStatus.Confirmed]: translationKey(
      "Backed up, as an admin confirmed.",
    ),
  },
  [ServerSetupCheckId.UpdateChecks]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Off: nobody is told about new releases or security fixes.",
    ),
    [ServerSetupStatus.Failing]: translationKey(
      "On, but the last check could not reach GitHub.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "On: OneUptime checks every day for new releases and security fixes.",
    ),
    [ServerSetupStatus.Skipped]: translationKey("Marked as not needed."),
  },
  [ServerSetupCheckId.BrowserPush]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up: browser notifications need VAPID keys in config.env. Mobile push works without them.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Set up: people can get alerts as browser notifications.",
    ),
  },
  [ServerSetupCheckId.AiProvider]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up: add an LLM provider so projects can use OneUptime AI.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Set up: projects can use OneUptime AI.",
    ),
  },
  [ServerSetupCheckId.SingleSignOn]: {
    [ServerSetupStatus.NotSetUp]: translationKey(
      "Not set up: let people sign in with your company's identity provider.",
    ),
    [ServerSetupStatus.Done]: translationKey(
      "Set up: people can sign in with your identity provider.",
    ),
  },
};

/*
 * What a check's "done" was checked against, or why it is not: the second,
 * smaller line under it. "smtp.example.com accepted an email on 11 Nov" says
 * more than a tick.
 */
export const SERVER_SETUP_CHECKED_WORDS: {
  emailAccepted: string;
  smsAccepted: string;
  callAccepted: string;
  providerSaid: string;
  lastBackup: string;
  lastUpdateCheck: string;
  chosenBy: string;
  chosenOn: string;
} = {
  emailAccepted: translationKey(
    "{{sentThrough}} accepted an email on {{time}}.",
  ),
  smsAccepted: translationKey("{{sentThrough}} accepted an SMS on {{time}}."),
  callAccepted: translationKey("{{sentThrough}} accepted a call on {{time}}."),
  providerSaid: translationKey("{{sentThrough}} said: {{reason}}"),
  lastBackup: translationKey("The last backup finished on {{time}}."),
  lastUpdateCheck: translationKey("Last checked on {{time}}."),
  chosenBy: translationKey("Chosen by {{name}} on {{time}}."),
  chosenOn: translationKey("Chosen on {{time}}."),
};

// An admin's choice, as stored and as answered.
export interface ServerSetupChoice {
  kind: ServerSetupChoiceKind;
  // When it was chosen, as an ISO date.
  at: string;
  byUserId: string | null;
  // Who chose it, filled in when the checklist is answered; never stored.
  byName?: string | null | undefined;
}

/*
 * An admin's "Hide" of the card: when, and which required checks were open
 * then. The card comes back when a required check opens that was not.
 */
export interface ServerSetupHidden {
  at: string;
  openRequired: Array<ServerSetupCheckId>;
}

// GlobalConfig.serverSetupChoices.
export interface ServerSetupChoices {
  choices: Partial<Record<ServerSetupCheckId, ServerSetupChoice>>;
  hiddenBy: Record<string, ServerSetupHidden>;
}

// What the server reads to answer every check.
export interface ServerSetupFacts {
  // HTTP_PROTOCOL=https: the links OneUptime sends and its cookies say HTTPS.
  isHttpsSetUp: boolean;
  areSignupsClosed: boolean;
  email: ServerChannelStatus;
  sms: ServerChannelStatus;
  call: ServerChannelStatus;
  // What takes each channel's sends: smtp.example.com, Amazon SES, Twilio.
  emailSentThrough: string | null;
  smsSentThrough: string | null;
  callSentThrough: string | null;
  globalProbes: ServerGlobalProbesStatus | null;
  updateChecks: {
    isDisabled: boolean;
    lastCheckedAt: string | null;
    // Why the last attempt failed, while it is the latest news.
    lastFailure: string | null;
  };
  // The last backup an Enterprise schedule or Back up now finished.
  lastBackup: {
    succeeded: boolean;
    finishedAt: string | null;
    error: string | null;
  } | null;
  // Whether scheduled backups can be set up here (the Enterprise Edition).
  hasScheduledBackups: boolean;
  isBrowserPushSetUp: boolean;
  hasAiProvider: boolean;
  hasSingleSignOn: boolean;
  choices: ServerSetupChoices;
}

// One check's answer.
export interface ServerSetupCheckResult {
  id: ServerSetupCheckId;
  tier: ServerSetupCheckTier;
  status: ServerSetupStatus;
  isFinished: boolean;
  // When: since when it fails, when it last worked, when it was checked.
  time: string | null;
  // What took it: smtp.example.com, Twilio.
  sentThrough: string | null;
  // Why it fails, in the provider's words, or what its settings are missing.
  reason: string | null;
  // Per channel, for SMS and calls: what went out when.
  channels: Array<ServerChannelStatus & { sentThrough: string | null }>;
  choice: ServerSetupChoice | null;
  // The choice an admin can make here now (the catalogue's, while it applies).
  canChoose: ServerSetupChoiceKind | null;
  // The test sends that apply now: the channels that are set up.
  tests: Array<ServerSendingChannel>;
  // Scheduled backups can be set up on this server (Backups only).
  hasScheduledBackups?: boolean | undefined;
}

// The body of GET /global-config/setup-checklist (master admins only).
export interface ServerSetupChecklistAnswer {
  checks: Array<ServerSetupCheckResult>;
  // The required checks that are still open, in order: what the card counts.
  openRequired: Array<ServerSetupCheckId>;
  // The reader hid the card, and nothing new has opened since.
  isHiddenForReader: boolean;
}

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readDate: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const readText: (value: unknown, limit?: number) => string | null = (
  value: unknown,
  limit: number = 500,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, limit) : null;
};

export default class ServerSetupChecklistUtil {
  public static getDefinition(
    id: ServerSetupCheckId,
  ): ServerSetupCheckDefinition {
    return SERVER_SETUP_CHECKS.find(
      (check: ServerSetupCheckDefinition): boolean => {
        return check.id === id;
      },
    )!;
  }

  public static isCheckId(value: unknown): value is ServerSetupCheckId {
    return Object.values(ServerSetupCheckId).includes(
      value as ServerSetupCheckId,
    );
  }

  public static isFinished(status: ServerSetupStatus): boolean {
    return FINISHED_SERVER_SETUP_STATUSES.includes(status);
  }

  // What was stored, read whole: anything that is not a choice or a hide is left out.
  public static readChoices(value: unknown): ServerSetupChoices {
    const choices: ServerSetupChoices = { choices: {}, hiddenBy: {} };

    if (!isObject(value)) {
      return choices;
    }

    if (isObject(value["choices"])) {
      for (const [id, stored] of Object.entries(value["choices"])) {
        if (!ServerSetupChecklistUtil.isCheckId(id) || !isObject(stored)) {
          continue;
        }

        const kind: unknown = stored["kind"];
        const at: string | null = readDate(stored["at"]);

        // Only the choice the catalogue allows for that check.
        if (
          !at ||
          kind !== ServerSetupChecklistUtil.getDefinition(id).choice ||
          !kind
        ) {
          continue;
        }

        choices.choices[id] = {
          kind: kind as ServerSetupChoiceKind,
          at: at,
          byUserId: readText(stored["byUserId"], 100),
        };
      }
    }

    if (isObject(value["hiddenBy"])) {
      for (const [userId, stored] of Object.entries(value["hiddenBy"])) {
        if (!isObject(stored)) {
          continue;
        }

        const at: string | null = readDate(stored["at"]);

        if (!at) {
          continue;
        }

        choices.hiddenBy[userId] = {
          at: at,
          openRequired: Array.isArray(stored["openRequired"])
            ? (stored["openRequired"] as Array<unknown>).filter(
                (id: unknown): id is ServerSetupCheckId => {
                  return ServerSetupChecklistUtil.isCheckId(id);
                },
              )
            : [],
        };
      }
    }

    return choices;
  }

  /*
   * The choices with one check's choice made (or undone, with null), by
   * whom and when. A choice the catalogue does not allow for that check is
   * refused.
   */
  public static withChoice(data: {
    choices: ServerSetupChoices;
    check: ServerSetupCheckId;
    kind: ServerSetupChoiceKind | null;
    byUserId: string | null;
    now: Date;
  }): ServerSetupChoices {
    const next: ServerSetupChoices = {
      choices: { ...data.choices.choices },
      hiddenBy: { ...data.choices.hiddenBy },
    };

    if (data.kind === null) {
      delete next.choices[data.check];
      return next;
    }

    if (
      ServerSetupChecklistUtil.getDefinition(data.check).choice !== data.kind
    ) {
      throw new Error(`${data.check} cannot be marked as ${data.kind}.`);
    }

    next.choices[data.check] = {
      kind: data.kind,
      at: data.now.toISOString(),
      byUserId: data.byUserId,
    };

    return next;
  }

  // The choices with the card hidden for one admin, over the checks open now.
  public static withHidden(data: {
    choices: ServerSetupChoices;
    userId: string;
    openRequired: Array<ServerSetupCheckId>;
    now: Date;
  }): ServerSetupChoices {
    return {
      choices: { ...data.choices.choices },
      hiddenBy: {
        ...data.choices.hiddenBy,
        [data.userId]: {
          at: data.now.toISOString(),
          openRequired: [...data.openRequired],
        },
      },
    };
  }

  /*
   * Whether the card stays hidden for an admin: they hid it, and every
   * required check open now was open then. One that opened since (email
   * that starts failing, say) brings it back.
   */
  public static isHiddenFor(data: {
    choices: ServerSetupChoices;
    userId: string | null;
    openRequired: Array<ServerSetupCheckId>;
  }): boolean {
    if (!data.userId) {
      return false;
    }

    const hidden: ServerSetupHidden | undefined =
      data.choices.hiddenBy[data.userId];

    if (!hidden) {
      return false;
    }

    return data.openRequired.every((id: ServerSetupCheckId): boolean => {
      return hidden.openRequired.includes(id);
    });
  }

  // A channel that sends: its status, from the channel's own state.
  private static channelStatus(status: ServerChannelStatus): ServerSetupStatus {
    switch (status.state) {
      case ServerSendingState.NotSetUp:
        return ServerSetupStatus.NotSetUp;
      case ServerSendingState.Untested:
        return ServerSetupStatus.Untested;
      case ServerSendingState.Failing:
        return ServerSetupStatus.Failing;
      default:
        return ServerSetupStatus.Done;
    }
  }

  private static result(data: {
    id: ServerSetupCheckId;
    status: ServerSetupStatus;
    facts: ServerSetupFacts;
    time?: string | null | undefined;
    sentThrough?: string | null | undefined;
    reason?: string | null | undefined;
    channels?: ServerSetupCheckResult["channels"] | undefined;
    tests?: Array<ServerSendingChannel> | undefined;
    /*
     * False when the check's choice would change nothing now: SMS and calls
     * once one of them is set up, backups once the server has made one.
     * The real state decides those, so the choice is not offered.
     */
    isChoiceApplicable?: boolean | undefined;
  }): ServerSetupCheckResult {
    const definition: ServerSetupCheckDefinition =
      ServerSetupChecklistUtil.getDefinition(data.id);
    const isFinished: boolean = ServerSetupChecklistUtil.isFinished(
      data.status,
    );
    const isChoiceApplicable: boolean = data.isChoiceApplicable !== false;

    // A choice is shown only while it is what the check stands on.
    const stored: ServerSetupChoice | undefined =
      data.facts.choices.choices[data.id];
    const choice: ServerSetupChoice | null =
      stored &&
      (data.status === ServerSetupStatus.Skipped ||
        data.status === ServerSetupStatus.Confirmed)
        ? stored
        : null;

    return {
      id: data.id,
      tier: definition.tier,
      status: data.status,
      isFinished: isFinished,
      time: data.time || null,
      sentThrough: data.sentThrough || null,
      reason: data.reason || null,
      channels: data.channels || [],
      choice: choice,
      /*
       * Offered while the check is open and the choice would count, or
       * while it stands on the choice (to undo it).
       */
      canChoose:
        choice || (!isFinished && isChoiceApplicable)
          ? definition.choice
          : null,
      tests: data.tests || [],
    };
  }

  private static evaluateEmail(
    facts: ServerSetupFacts,
  ): ServerSetupCheckResult {
    const status: ServerSetupStatus = ServerSetupChecklistUtil.channelStatus(
      facts.email,
    );

    return ServerSetupChecklistUtil.result({
      id: ServerSetupCheckId.Email,
      status: status,
      facts: facts,
      time:
        status === ServerSetupStatus.Failing
          ? facts.email.failingSince
          : facts.email.lastWorkedAt,
      sentThrough: facts.emailSentThrough,
      reason:
        status === ServerSetupStatus.Failing
          ? facts.email.lastFailure
          : status === ServerSetupStatus.NotSetUp
            ? facts.email.setUpProblem
            : null,
      tests:
        status === ServerSetupStatus.NotSetUp
          ? []
          : [ServerSendingChannel.Email],
    });
  }

  /*
   * SMS and calls, as one check: each that is set up has to have worked
   * since its settings were saved (an account used for SMS only needs no
   * calls). Failing wins, then untested. Nothing set up is open - unless an
   * admin chose to do without them, which applies only while nothing is.
   */
  private static evaluateSmsAndCalls(
    facts: ServerSetupFacts,
  ): ServerSetupCheckResult {
    const channels: ServerSetupCheckResult["channels"] = [
      { ...facts.sms, sentThrough: facts.smsSentThrough },
      { ...facts.call, sentThrough: facts.callSentThrough },
    ];

    const setUp: ServerSetupCheckResult["channels"] = channels.filter(
      (channel: ServerChannelStatus): boolean => {
        return channel.state !== ServerSendingState.NotSetUp;
      },
    );

    const tests: Array<ServerSendingChannel> = setUp.map(
      (channel: ServerChannelStatus): ServerSendingChannel => {
        return channel.channel;
      },
    );

    if (setUp.length === 0) {
      return ServerSetupChecklistUtil.result({
        id: ServerSetupCheckId.SmsAndCalls,
        status: facts.choices.choices[ServerSetupCheckId.SmsAndCalls]
          ? ServerSetupStatus.Skipped
          : ServerSetupStatus.NotSetUp,
        facts: facts,
        channels: channels,
      });
    }

    const failing: (ServerChannelStatus & { sentThrough: string | null })[] =
      setUp.filter((channel: ServerChannelStatus): boolean => {
        return channel.state === ServerSendingState.Failing;
      });

    if (failing.length > 0) {
      const first: ServerChannelStatus & { sentThrough: string | null } =
        failing[0]!;

      return ServerSetupChecklistUtil.result({
        id: ServerSetupCheckId.SmsAndCalls,
        status: ServerSetupStatus.Failing,
        facts: facts,
        time: first.failingSince,
        sentThrough: first.sentThrough,
        reason: first.lastFailure,
        channels: channels,
        tests: tests,
        isChoiceApplicable: false,
      });
    }

    const isUntested: boolean = setUp.some(
      (channel: ServerChannelStatus): boolean => {
        return channel.state === ServerSendingState.Untested;
      },
    );

    return ServerSetupChecklistUtil.result({
      id: ServerSetupCheckId.SmsAndCalls,
      status: isUntested ? ServerSetupStatus.Untested : ServerSetupStatus.Done,
      facts: facts,
      channels: channels,
      tests: tests,
      isChoiceApplicable: false,
    });
  }

  private static evaluateBackups(
    facts: ServerSetupFacts,
  ): ServerSetupCheckResult {
    const backup: ServerSetupFacts["lastBackup"] = facts.lastBackup;
    const isConfirmed: boolean = Boolean(
      facts.choices.choices[ServerSetupCheckId.Backups],
    );

    let status: ServerSetupStatus = isConfirmed
      ? ServerSetupStatus.Confirmed
      : ServerSetupStatus.NotSetUp;

    // A backup the server made itself says more than a confirmation.
    if (backup && backup.succeeded) {
      status = ServerSetupStatus.Done;
    } else if (backup && !backup.succeeded) {
      status = ServerSetupStatus.Failing;
    }

    const answer: ServerSetupCheckResult = ServerSetupChecklistUtil.result({
      id: ServerSetupCheckId.Backups,
      status: status,
      facts: facts,
      time: backup ? backup.finishedAt : null,
      reason: backup && !backup.succeeded ? backup.error : null,
      // A failed backup the server made is not undone by a confirmation.
      isChoiceApplicable: !backup,
    });

    answer.hasScheduledBackups = facts.hasScheduledBackups;

    return answer;
  }

  private static evaluateUpdateChecks(
    facts: ServerSetupFacts,
  ): ServerSetupCheckResult {
    const updates: ServerSetupFacts["updateChecks"] = facts.updateChecks;

    let status: ServerSetupStatus = ServerSetupStatus.Done;

    if (updates.isDisabled) {
      status = ServerSetupStatus.NotSetUp;
    } else if (updates.lastFailure) {
      status = ServerSetupStatus.Failing;
    }

    if (
      status !== ServerSetupStatus.Done &&
      facts.choices.choices[ServerSetupCheckId.UpdateChecks]
    ) {
      status = ServerSetupStatus.Skipped;
    }

    return ServerSetupChecklistUtil.result({
      id: ServerSetupCheckId.UpdateChecks,
      status: status,
      facts: facts,
      time: updates.isDisabled ? null : updates.lastCheckedAt,
      reason: status === ServerSetupStatus.Failing ? updates.lastFailure : null,
    });
  }

  // A check that is done or not, with the choice to do without it.
  private static evaluateYesNo(data: {
    id: ServerSetupCheckId;
    isDone: boolean;
    facts: ServerSetupFacts;
  }): ServerSetupCheckResult {
    let status: ServerSetupStatus = data.isDone
      ? ServerSetupStatus.Done
      : ServerSetupStatus.NotSetUp;

    if (
      !data.isDone &&
      ServerSetupChecklistUtil.getDefinition(data.id).choice ===
        ServerSetupChoiceKind.Skipped &&
      data.facts.choices.choices[data.id]
    ) {
      status = ServerSetupStatus.Skipped;
    }

    return ServerSetupChecklistUtil.result({
      id: data.id,
      status: status,
      facts: data.facts,
    });
  }

  // Every check, in the catalogue's order.
  public static evaluate(
    facts: ServerSetupFacts,
  ): Array<ServerSetupCheckResult> {
    return [
      ServerSetupChecklistUtil.evaluateEmail(facts),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.Https,
        isDone: facts.isHttpsSetUp,
        facts: facts,
      }),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.Signups,
        isDone: facts.areSignupsClosed,
        facts: facts,
      }),
      ServerSetupChecklistUtil.evaluateSmsAndCalls(facts),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.Probes,
        isDone: Boolean(facts.globalProbes && facts.globalProbes.reporting > 0),
        facts: facts,
      }),
      ServerSetupChecklistUtil.evaluateBackups(facts),
      ServerSetupChecklistUtil.evaluateUpdateChecks(facts),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.BrowserPush,
        isDone: facts.isBrowserPushSetUp,
        facts: facts,
      }),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.AiProvider,
        isDone: facts.hasAiProvider,
        facts: facts,
      }),
      ServerSetupChecklistUtil.evaluateYesNo({
        id: ServerSetupCheckId.SingleSignOn,
        isDone: facts.hasSingleSignOn,
        facts: facts,
      }),
    ];
  }

  public static getOpenRequired(
    checks: Array<ServerSetupCheckResult>,
  ): Array<ServerSetupCheckId> {
    return checks
      .filter((check: ServerSetupCheckResult): boolean => {
        return (
          check.tier === ServerSetupCheckTier.Required && !check.isFinished
        );
      })
      .map((check: ServerSetupCheckResult): ServerSetupCheckId => {
        return check.id;
      });
  }

  // The whole answer, for one reader.
  public static getAnswer(data: {
    facts: ServerSetupFacts;
    readerUserId: string | null;
  }): ServerSetupChecklistAnswer {
    const checks: Array<ServerSetupCheckResult> =
      ServerSetupChecklistUtil.evaluate(data.facts);
    const openRequired: Array<ServerSetupCheckId> =
      ServerSetupChecklistUtil.getOpenRequired(checks);

    return {
      checks: checks,
      openRequired: openRequired,
      isHiddenForReader: ServerSetupChecklistUtil.isHiddenFor({
        choices: data.facts.choices,
        userId: data.readerUserId,
        openRequired: openRequired,
      }),
    };
  }

  // The status line of a check, in English with its placeholders.
  public static getStatusWords(check: {
    id: ServerSetupCheckId;
    status: ServerSetupStatus;
  }): string {
    return SERVER_SETUP_STATUS_WORDS[check.id][check.status] || "";
  }

  /*
   * The answer of GET /global-config/setup-checklist, read in a browser, or
   * null when it is not one (a failed read, a proxy's page): nothing is
   * drawn then. A check row that is not one is left out.
   */
  public static parseAnswer(value: unknown): ServerSetupChecklistAnswer | null {
    if (!isObject(value) || !Array.isArray(value["checks"])) {
      return null;
    }

    const checks: Array<ServerSetupCheckResult> = [];

    for (const row of value["checks"] as Array<unknown>) {
      if (
        !isObject(row) ||
        !ServerSetupChecklistUtil.isCheckId(row["id"]) ||
        !Object.values(ServerSetupStatus).includes(
          row["status"] as ServerSetupStatus,
        )
      ) {
        continue;
      }

      const id: ServerSetupCheckId = row["id"];
      const status: ServerSetupStatus = row["status"] as ServerSetupStatus;
      const definition: ServerSetupCheckDefinition =
        ServerSetupChecklistUtil.getDefinition(id);
      const storedChoice: unknown = row["choice"];
      const canChoose: unknown = row["canChoose"];

      const channels: ServerSetupCheckResult["channels"] = [];
      const parsedChannels: Array<ServerChannelStatus> | undefined =
        ServerSendingStatusUtil.parseAnswer({
          channels: Array.isArray(row["channels"]) ? row["channels"] : [],
        })?.channels;

      for (const channel of parsedChannels || []) {
        const raw: unknown = (row["channels"] as Array<unknown>).find(
          (candidate: unknown): boolean => {
            return (
              isObject(candidate) && candidate["channel"] === channel.channel
            );
          },
        );

        channels.push({
          ...channel,
          sentThrough: isObject(raw) ? readText(raw["sentThrough"], 200) : null,
        });
      }

      checks.push({
        id: id,
        tier: definition.tier,
        status: status,
        isFinished: ServerSetupChecklistUtil.isFinished(status),
        time: readDate(row["time"]),
        sentThrough: readText(row["sentThrough"], 200),
        reason: readText(row["reason"]),
        channels: channels,
        choice:
          isObject(storedChoice) &&
          storedChoice["kind"] === definition.choice &&
          readDate(storedChoice["at"])
            ? {
                kind: definition.choice!,
                at: readDate(storedChoice["at"])!,
                byUserId: readText(storedChoice["byUserId"], 100),
                byName: readText(storedChoice["byName"], 200),
              }
            : null,
        canChoose:
          definition.choice && canChoose === definition.choice
            ? definition.choice
            : null,
        tests: (Array.isArray(row["tests"]) ? row["tests"] : []).filter(
          (test: unknown): test is ServerSendingChannel => {
            return (
              ServerSendingStatusUtil.isChannel(test) &&
              definition.tests.includes(test)
            );
          },
        ),
        ...(id === ServerSetupCheckId.Backups
          ? { hasScheduledBackups: row["hasScheduledBackups"] === true }
          : {}),
      });
    }

    const openRequired: Array<ServerSetupCheckId> =
      ServerSetupChecklistUtil.getOpenRequired(checks);

    return {
      checks: checks,
      openRequired: openRequired,
      isHiddenForReader: value["isHiddenForReader"] === true,
    };
  }

  public static getCheck(
    answer: ServerSetupChecklistAnswer,
    id: ServerSetupCheckId,
  ): ServerSetupCheckResult | null {
    return (
      answer.checks.find((check: ServerSetupCheckResult): boolean => {
        return check.id === id;
      }) || null
    );
  }
}
