/*
 * CAN THIS SERVER SEND EMAIL, SMS, CALLS AND PUSH NOTIFICATIONS?
 *
 * A fresh self-hosted OneUptime cannot send email: there is no bundled mail
 * server, and nothing is set up until its admin does it (Admin Dashboard >
 * Settings > Emails). The product used to carry on as if it could:
 * "forgot password" and invitations said the email was sent, a monitor's card
 * said the project's owners would be emailed, and the person waited for
 * something that never came (#6825, and the customers' #1600 and #405).
 *
 * One answer, per channel, says where the server stands:
 *
 *   - not-set-up  the settings it sends with are missing or incomplete, so
 *                 nothing can go out - known for certain from the settings;
 *   - untested    set up, and nothing has gone out since the settings were
 *                 last saved;
 *   - working     the last send went out;
 *   - failing     sends fail, since `failingSince`, and why (`lastFailure`).
 *
 * The server works it out (Server/Utils/ServerSending/ServerSendingStatus)
 * from its settings - the same rules the Notification service sends by - and
 * from what the server remembers of its own last sends (GlobalConfig.
 * serverSendingHealth, written by the senders). Saving a channel's settings
 * starts it again at untested, and so do the settings of SMS, calls or
 * email changing without a save, when the GLOBAL_TWILIO_ or GLOBAL_EMAIL_
 * environment variables set them: what was learned with the settings
 * before is not read as these ones' (settingsFingerprint).
 *
 * Who reads what:
 *
 *   - anybody, signed in or not (GET /global-config/vars): only whether the
 *     server is known not to be able to send email - `canSendEmail` - so the
 *     sign-in pages say so before anyone types an address. That is a fact
 *     about the server, never about an account, and it is said only while
 *     email has never worked: once it has, a later failure is told to the
 *     server's admins only (canSendPublicly);
 *   - master admins (GET /global-config/sending-status): every channel's
 *     state, since when, why, and what its settings are missing - the banner
 *     in the Dashboard and the Admin Dashboard, and the server's setup
 *     checklist (#6824).
 *
 * Pure, with no Node or browser APIs: the server, the Dashboard, the Admin
 * Dashboard, the Accounts pages and their tests all read it.
 */

import ServerSetUpProblem, {
  ServerSetUpProblemWords,
} from "./ServerSetUpProblem";

export enum ServerSendingChannel {
  Email = "email",
  SMS = "sms",
  Call = "call",
  Push = "push",
}

export enum ServerSendingState {
  NotSetUp = "not-set-up",
  Untested = "untested",
  Working = "working",
  Failing = "failing",
}

/*
 * Whose problem a failed send is (#9217): the server's - its settings, the
 * way to the provider, its account - which every admin is told of; one
 * recipient's or one message's, which is said on that email's log row and
 * the record that sent it, never in the banner; or the provider asking to
 * slow down, which is the server's only once it has lasted
 * (SERVER_SENDING_THROTTLE_SUSTAINED_MS). Email works it out from what the
 * mail service said (Types/Email/EmailSendFailure); SMS and calls say
 * nothing, and every failure of theirs is the server's, as it always was.
 */
export enum ServerSendingFailureScope {
  Server = "server",
  Recipient = "recipient",
  Throttled = "throttled",
}

/*
 * A recipient the server's own mail service refused while every other
 * email went out: who, why, and when it last did. Kept for the server's
 * admins (Settings > Emails), since an email with no project - an
 * invitation, a password reset - has no log row a project's owners read.
 */
export interface ServerSendingRecipientRefusal {
  recipient: string;
  reason: string;
  at: string;
}

export const SERVER_SENDING_CHANNELS: ReadonlyArray<ServerSendingChannel> = [
  ServerSendingChannel.Email,
  ServerSendingChannel.SMS,
  ServerSendingChannel.Call,
  ServerSendingChannel.Push,
];

/*
 * What the server remembers of one channel's own sends, as ISO dates: when
 * one last went out, when one last failed, since when they have been failing
 * (cleared by the next one that goes out) and why the last one failed.
 */
export interface ServerSendingHealthEntry {
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  failingSince: string | null;
  lastFailure: string | null;
  /*
   * Whose problem the failure since `failingSince` is: the server's, or a
   * slow-down that has lasted. Left out by entries written before failures
   * were told apart (#9217).
   */
  failureScope?: ServerSendingFailureScope | undefined;
  /*
   * Since when the provider has asked to slow down, with no send going out
   * since: failing once it has lasted SERVER_SENDING_THROTTLE_SUSTAINED_MS.
   */
  throttledSince?: string | undefined;
  /*
   * The recipients refused lately, newest first, at most
   * MAX_SERVER_SENDING_RECIPIENT_REFUSALS: a send to one that goes out
   * takes it off.
   */
  recipientRefusals?: Array<ServerSendingRecipientRefusal> | undefined;
  /*
   * Which settings the entry was learned with, for a channel whose settings
   * can change without anyone saving them: SMS and calls, whose Twilio
   * account the GLOBAL_TWILIO_ environment variables can set (#7515, #7736),
   * and email, whose settings the GLOBAL_EMAIL_ ones can (#7738, #7803). A
   * keyed hash the server makes (Server/Utils/ServerSending/
   * ServerSendingSettings), never a setting itself. Left out by entries
   * written before there was one, and by push.
   */
  settingsFingerprint?: string | undefined;
}

export type ServerSendingHealth = Partial<
  Record<ServerSendingChannel, ServerSendingHealthEntry>
>;

/*
 * The settings a channel sends with now, as fingerprints: `current` for the
 * ones it sends with, and `unmarked` for the ones an entry without a
 * fingerprint was learned with - the settings saved in the Admin Dashboard,
 * the only ones there were before entries carried one.
 */
export interface ServerSendingSettingsFingerprints {
  current: string;
  unmarked: string;
}

// Where one channel stands, as a master admin reads it.
export interface ServerChannelStatus {
  channel: ServerSendingChannel;
  state: ServerSendingState;
  /*
   * Whether a send has gone out since the channel's settings were last
   * saved: what keeps a later failure off the public pages.
   */
  hasWorked: boolean;
  lastWorkedAt: string | null;
  failingSince: string | null;
  // Why the last send failed, in the sender's words.
  lastFailure: string | null;
  // What the settings are missing, while the channel is not set up.
  setUpProblem: string | null;
  /*
   * The same, in words every language has (ServerSetUpProblem, #9437):
   * left out for what is drawn as it came - what is wrong with the
   * environment variables - and by an older server.
   */
  setUpProblemWords?: ServerSetUpProblemWords | undefined;
  /*
   * Recipients refused lately while other sends went out (#9217): never a
   * reason for the banner. Left out when there are none.
   */
  recipientRefusals?: Array<ServerSendingRecipientRefusal> | undefined;
}

/*
 * Whether the server's global probes check monitors: how many there are,
 * and how many of them are reporting. Null when the server has none.
 */
export interface ServerGlobalProbesStatus {
  total: number;
  reporting: number;
}

// The body of GET /global-config/sending-status (master admins only).
export interface ServerSendingStatusAnswer {
  channels: Array<ServerChannelStatus>;
  globalProbes: ServerGlobalProbesStatus | null;
}

/*
 * How often a channel that keeps working, or keeps failing for the same
 * reason, writes that down again: the senders write a change at once (the
 * first send that goes out, the first that fails, a new reason) and the same
 * news at most once in this long, so a busy server is not one write per
 * email.
 */
export const SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS: number = 60 * 60 * 1000;

// The longest failure reason kept: a mail server's answer can be long.
export const MAX_SERVER_SENDING_FAILURE_LENGTH: number = 500;

/*
 * How long a provider may ask to slow down, with nothing going out, before
 * the server's sends are said to fail: a burst is the provider pacing a
 * busy hour, and the email is sent again; a quarter of an hour of it is the
 * account's limit, and email is late.
 */
export const SERVER_SENDING_THROTTLE_SUSTAINED_MS: number = 15 * 60 * 1000;

// The most recipient refusals kept, newest first.
export const MAX_SERVER_SENDING_RECIPIENT_REFUSALS: number = 5;

// The longest recipient address kept.
const MAX_RECIPIENT_LENGTH: number = 320;

const EMPTY_ENTRY: ServerSendingHealthEntry = {
  lastSucceededAt: null,
  lastFailedAt: null,
  failingSince: null,
  lastFailure: null,
};

type ReadDateFunction = (value: unknown) => string | null;

const readDate: ReadDateFunction = (value: unknown): string | null => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

type ReadTextFunction = (value: unknown) => string | null;

const readText: ReadTextFunction = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, MAX_SERVER_SENDING_FAILURE_LENGTH) : null;
};

// The longest fingerprint kept: the server writes 64 hex characters.
const MAX_SETTINGS_FINGERPRINT_LENGTH: number = 128;

type ReadFingerprintFunction = (value: unknown) => string | undefined;

const readFingerprint: ReadFingerprintFunction = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const fingerprint: string = value.trim();

  return fingerprint && fingerprint.length <= MAX_SETTINGS_FINGERPRINT_LENGTH
    ? fingerprint
    : undefined;
};

type ReadNumberFunction = (value: unknown) => number;

const readCount: ReadNumberFunction = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
};

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readRecipient: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const recipient: string = value.trim();

  return recipient && recipient.length <= MAX_RECIPIENT_LENGTH
    ? recipient
    : null;
};

const isSameRecipient: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

// The recipient refusals kept, read whole: a row that is not one is left out.
const readRecipientRefusals: (
  value: unknown,
) => Array<ServerSendingRecipientRefusal> = (
  value: unknown,
): Array<ServerSendingRecipientRefusal> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const refusals: Array<ServerSendingRecipientRefusal> = [];

  for (const row of value as Array<unknown>) {
    if (!isObject(row)) {
      continue;
    }

    const recipient: string | null = readRecipient(row["recipient"]);
    const reason: string | null = readText(row["reason"]);
    const at: string | null = readDate(row["at"]);

    if (!recipient || !reason || !at) {
      continue;
    }

    refusals.push({ recipient: recipient, reason: reason, at: at });

    if (refusals.length >= MAX_SERVER_SENDING_RECIPIENT_REFUSALS) {
      break;
    }
  }

  return refusals;
};

export default class ServerSendingStatusUtil {
  // One channel's entry, read whole from whatever was stored.
  public static readEntry(value: unknown): ServerSendingHealthEntry {
    if (!isObject(value)) {
      return { ...EMPTY_ENTRY };
    }

    const entry: ServerSendingHealthEntry = {
      lastSucceededAt: readDate(value["lastSucceededAt"]),
      lastFailedAt: readDate(value["lastFailedAt"]),
      failingSince: readDate(value["failingSince"]),
      lastFailure: readText(value["lastFailure"]),
    };

    const settingsFingerprint: string | undefined = readFingerprint(
      value["settingsFingerprint"],
    );

    if (settingsFingerprint) {
      entry.settingsFingerprint = settingsFingerprint;
    }

    if (ServerSendingStatusUtil.isFailureScope(value["failureScope"])) {
      entry.failureScope = value["failureScope"];
    }

    const throttledSince: string | null = readDate(value["throttledSince"]);

    if (throttledSince) {
      entry.throttledSince = throttledSince;
    }

    const refusals: Array<ServerSendingRecipientRefusal> =
      readRecipientRefusals(value["recipientRefusals"]);

    if (refusals.length > 0) {
      entry.recipientRefusals = refusals;
    }

    return entry;
  }

  /*
   * What the server remembers of every channel, read from the stored
   * column: anything that is not an entry of a known channel is left out.
   */
  public static readHealth(value: unknown): ServerSendingHealth {
    const health: ServerSendingHealth = {};

    if (!isObject(value)) {
      return health;
    }

    for (const channel of SERVER_SENDING_CHANNELS) {
      if (isObject(value[channel])) {
        health[channel] = ServerSendingStatusUtil.readEntry(value[channel]);
      }
    }

    return health;
  }

  public static getEntry(
    health: ServerSendingHealth,
    channel: ServerSendingChannel,
  ): ServerSendingHealthEntry {
    return health[channel] ? { ...health[channel]! } : { ...EMPTY_ENTRY };
  }

  /*
   * A channel's entry as it describes the settings the channel sends with
   * now: one learned with other settings says nothing about these, and is
   * read as nothing remembered (untested). An entry without a fingerprint
   * counts as learned with `unmarked`. With no fingerprints - a channel
   * whose settings change only when they are saved, which forgets the
   * entry - every entry is current.
   */
  public static getCurrentEntry(
    health: ServerSendingHealth,
    channel: ServerSendingChannel,
    fingerprints: ServerSendingSettingsFingerprints | null,
  ): ServerSendingHealthEntry {
    const entry: ServerSendingHealthEntry = ServerSendingStatusUtil.getEntry(
      health,
      channel,
    );

    if (!fingerprints) {
      return entry;
    }

    const learnedWith: string =
      entry.settingsFingerprint || fingerprints.unmarked;

    return learnedWith === fingerprints.current ? entry : { ...EMPTY_ENTRY };
  }

  /*
   * The entry, marked with the settings it is learned with now: left
   * unmarked for a channel with no fingerprints.
   */
  public static withSettingsFingerprint(
    entry: ServerSendingHealthEntry,
    fingerprints: ServerSendingSettingsFingerprints | null,
  ): ServerSendingHealthEntry {
    const marked: ServerSendingHealthEntry = { ...entry };

    delete marked.settingsFingerprint;

    if (fingerprints) {
      marked.settingsFingerprint = fingerprints.current;
    }

    return marked;
  }

  /*
   * Where a channel stands: not set up whatever it remembers, then failing
   * while its sends fail, working once one went out, and untested before.
   */
  public static getState(data: {
    isSetUp: boolean;
    entry: ServerSendingHealthEntry;
  }): ServerSendingState {
    if (!data.isSetUp) {
      return ServerSendingState.NotSetUp;
    }

    if (data.entry.failingSince) {
      return ServerSendingState.Failing;
    }

    if (data.entry.lastSucceededAt) {
      return ServerSendingState.Working;
    }

    return ServerSendingState.Untested;
  }

  public static getStatus(data: {
    channel: ServerSendingChannel;
    setUpProblem: string | null;
    setUpProblemWords?: ServerSetUpProblemWords | null | undefined;
    entry: ServerSendingHealthEntry;
  }): ServerChannelStatus {
    const isSetUp: boolean = !data.setUpProblem;

    const status: ServerChannelStatus = {
      channel: data.channel,
      state: ServerSendingStatusUtil.getState({
        isSetUp: isSetUp,
        entry: data.entry,
      }),
      hasWorked: Boolean(data.entry.lastSucceededAt),
      lastWorkedAt: data.entry.lastSucceededAt,
      failingSince: data.entry.failingSince,
      lastFailure: data.entry.lastFailure,
      setUpProblem: data.setUpProblem,
    };

    if (!isSetUp && data.setUpProblemWords) {
      status.setUpProblemWords = data.setUpProblemWords;
    }

    if (isSetUp && data.entry.recipientRefusals?.length) {
      status.recipientRefusals = data.entry.recipientRefusals.map(
        (
          refusal: ServerSendingRecipientRefusal,
        ): ServerSendingRecipientRefusal => {
          return { ...refusal };
        },
      );
    }

    return status;
  }

  /*
   * What a page anybody can open may say: the server is known not to be
   * able to send - it is not set up, or it is and has never managed to.
   * Untested says nothing (it may well work), and a channel that has
   * worked is never said to fail here: that is for the server's admins.
   */
  public static canSendPublicly(status: {
    state: ServerSendingState;
    hasWorked: boolean;
  }): boolean {
    if (status.state === ServerSendingState.NotSetUp) {
      return false;
    }

    if (status.state === ServerSendingState.Failing && !status.hasWorked) {
      return false;
    }

    return true;
  }

  /*
   * Whether a send would go out now, as the people of a project are told it
   * (#7151, #6880): not while the channel is not set up, nor while it fails.
   * Said to signed-in members only, as a yes or no (ProjectCanSend): never
   * why, which is the server's admins'.
   */
  public static canSendNow(status: { state: ServerSendingState }): boolean {
    return !ServerSendingStatusUtil.needsAttention(status);
  }

  /*
   * Whether a master admin should be told, in the product, that this
   * channel does not work: not set up, or failing.
   */
  public static needsAttention(status: { state: ServerSendingState }): boolean {
    return (
      status.state === ServerSendingState.NotSetUp ||
      status.state === ServerSendingState.Failing
    );
  }

  /*
   * The entry after a send went out through the settings the entry is
   * learned with - the same settings, sender and way to the provider every
   * failure of the server's was about: the server's sends go out again, and
   * the provider no longer asks to slow down. A recipient refused before is
   * taken off only by a send to that recipient, never by a test to another.
   */
  public static withSucceeded(
    entry: ServerSendingHealthEntry,
    now: Date,
    recipient?: string | undefined,
  ): ServerSendingHealthEntry {
    const next: ServerSendingHealthEntry = {
      ...entry,
      lastSucceededAt: now.toISOString(),
      failingSince: null,
    };

    delete next.failureScope;
    delete next.throttledSince;

    const refusals: Array<ServerSendingRecipientRefusal> = (
      entry.recipientRefusals || []
    ).filter((refusal: ServerSendingRecipientRefusal): boolean => {
      return !recipient || !isSameRecipient(refusal.recipient, recipient);
    });

    if (refusals.length > 0) {
      next.recipientRefusals = refusals;
    } else {
      delete next.recipientRefusals;
    }

    return next;
  }

  // The entry after a send failed for a reason of the server's, and why.
  public static withFailed(
    entry: ServerSendingHealthEntry,
    reason: string,
    now: Date,
  ): ServerSendingHealthEntry {
    return {
      ...entry,
      lastFailedAt: now.toISOString(),
      failingSince: entry.failingSince || now.toISOString(),
      lastFailure: readText(reason) || "Unknown error.",
      failureScope: ServerSendingFailureScope.Server,
    };
  }

  /*
   * The entry after the provider asked to slow down: failing, since it
   * first did, once it has lasted SERVER_SENDING_THROTTLE_SUSTAINED_MS with
   * nothing going out.
   */
  public static withThrottled(
    entry: ServerSendingHealthEntry,
    reason: string,
    now: Date,
  ): ServerSendingHealthEntry {
    const throttledSince: string = entry.throttledSince || now.toISOString();

    const next: ServerSendingHealthEntry = {
      ...entry,
      throttledSince: throttledSince,
    };

    if (
      !entry.failingSince &&
      now.getTime() - new Date(throttledSince).getTime() <
        SERVER_SENDING_THROTTLE_SUSTAINED_MS
    ) {
      return next;
    }

    return {
      ...next,
      lastFailedAt: now.toISOString(),
      failingSince: entry.failingSince || throttledSince,
      lastFailure: readText(reason) || "Unknown error.",
      failureScope: entry.failingSince
        ? entry.failureScope || ServerSendingFailureScope.Server
        : ServerSendingFailureScope.Throttled,
    };
  }

  /*
   * The entry after one recipient was refused: kept among the recipient
   * refusals, newest first. Whether the server's sends fail is left as it
   * was - every other email still goes out.
   */
  public static withRecipientRefused(
    entry: ServerSendingHealthEntry,
    recipient: string,
    reason: string,
    now: Date,
  ): ServerSendingHealthEntry {
    const address: string | null = readRecipient(recipient);

    if (!address) {
      return { ...entry };
    }

    const refusals: Array<ServerSendingRecipientRefusal> = [
      {
        recipient: address,
        reason: readText(reason) || "Unknown error.",
        at: now.toISOString(),
      },
      ...(entry.recipientRefusals || []).filter(
        (refusal: ServerSendingRecipientRefusal): boolean => {
          return !isSameRecipient(refusal.recipient, address);
        },
      ),
    ].slice(0, MAX_SERVER_SENDING_RECIPIENT_REFUSALS);

    return { ...entry, recipientRefusals: refusals };
  }

  /*
   * Whether a send that went out is news worth a write: the first ever, the
   * first after failures, or the same news an hour later.
   */
  public static shouldWriteSucceeded(
    entry: ServerSendingHealthEntry,
    now: Date,
    recipient?: string | undefined,
  ): boolean {
    if (!entry.lastSucceededAt || entry.failingSince || entry.throttledSince) {
      return true;
    }

    // A recipient refused before, that a send has now gone out to.
    if (
      recipient &&
      (entry.recipientRefusals || []).some(
        (refusal: ServerSendingRecipientRefusal): boolean => {
          return isSameRecipient(refusal.recipient, recipient);
        },
      )
    ) {
      return true;
    }

    return (
      now.getTime() - new Date(entry.lastSucceededAt).getTime() >=
      SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS
    );
  }

  /*
   * Whether a failed send is news worth a write: the first failure, a new
   * reason, or the same failure an hour later.
   */
  public static shouldWriteFailed(
    entry: ServerSendingHealthEntry,
    reason: string,
    now: Date,
  ): boolean {
    if (!entry.failingSince || !entry.lastFailedAt) {
      return true;
    }

    if ((readText(reason) || "Unknown error.") !== entry.lastFailure) {
      return true;
    }

    return (
      now.getTime() - new Date(entry.lastFailedAt).getTime() >=
      SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS
    );
  }

  /*
   * Whether a slow-down is news worth a write: the first, the one that
   * makes it last long enough to be failing, or the same an hour later.
   */
  public static shouldWriteThrottled(
    entry: ServerSendingHealthEntry,
    now: Date,
  ): boolean {
    if (!entry.throttledSince) {
      return true;
    }

    if (!entry.failingSince) {
      return (
        now.getTime() - new Date(entry.throttledSince).getTime() >=
        SERVER_SENDING_THROTTLE_SUSTAINED_MS
      );
    }

    return (
      !entry.lastFailedAt ||
      now.getTime() - new Date(entry.lastFailedAt).getTime() >=
        SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS
    );
  }

  /*
   * Whether a recipient's refusal is news worth a write: one not kept, a
   * new reason, or the same an hour later.
   */
  public static shouldWriteRecipientRefused(
    entry: ServerSendingHealthEntry,
    recipient: string,
    reason: string,
    now: Date,
  ): boolean {
    if (!readRecipient(recipient)) {
      return false;
    }

    const kept: ServerSendingRecipientRefusal | undefined = (
      entry.recipientRefusals || []
    ).find((refusal: ServerSendingRecipientRefusal): boolean => {
      return isSameRecipient(refusal.recipient, recipient);
    });

    if (!kept) {
      return true;
    }

    if ((readText(reason) || "Unknown error.") !== kept.reason) {
      return true;
    }

    return (
      now.getTime() - new Date(kept.at).getTime() >=
      SERVER_SENDING_HEALTH_REWRITE_INTERVAL_MS
    );
  }

  public static isFailureScope(
    value: unknown,
  ): value is ServerSendingFailureScope {
    return Object.values(ServerSendingFailureScope).includes(
      value as ServerSendingFailureScope,
    );
  }

  public static isChannel(value: unknown): value is ServerSendingChannel {
    return SERVER_SENDING_CHANNELS.includes(value as ServerSendingChannel);
  }

  public static isState(value: unknown): value is ServerSendingState {
    return Object.values(ServerSendingState).includes(
      value as ServerSendingState,
    );
  }

  /*
   * The answer of GET /global-config/sending-status, read in a browser, or
   * null when it is not one (a failed read, a proxy's page): the banner then
   * draws nothing. A channel row that is not one is left out.
   */
  public static parseAnswer(value: unknown): ServerSendingStatusAnswer | null {
    if (!isObject(value) || !Array.isArray(value["channels"])) {
      return null;
    }

    const channels: Array<ServerChannelStatus> = [];

    for (const row of value["channels"] as Array<unknown>) {
      if (
        !isObject(row) ||
        !ServerSendingStatusUtil.isChannel(row["channel"]) ||
        !ServerSendingStatusUtil.isState(row["state"])
      ) {
        continue;
      }

      const status: ServerChannelStatus = {
        channel: row["channel"],
        state: row["state"],
        hasWorked: row["hasWorked"] === true,
        lastWorkedAt: readDate(row["lastWorkedAt"]),
        failingSince: readDate(row["failingSince"]),
        lastFailure: readText(row["lastFailure"]),
        setUpProblem: readText(row["setUpProblem"]),
      };

      // Words only beside the sentence they say, and only ones this page knows.
      const setUpProblemWords: ServerSetUpProblemWords | null =
        status.setUpProblem
          ? ServerSetUpProblem.parse(row["setUpProblemWords"])
          : null;

      if (setUpProblemWords) {
        status.setUpProblemWords = setUpProblemWords;
      }

      const refusals: Array<ServerSendingRecipientRefusal> =
        readRecipientRefusals(row["recipientRefusals"]);

      if (refusals.length > 0) {
        status.recipientRefusals = refusals;
      }

      channels.push(status);
    }

    const probes: unknown = value["globalProbes"];

    return {
      channels: channels,
      globalProbes: isObject(probes)
        ? {
            total: readCount(probes["total"]),
            reporting: Math.min(
              readCount(probes["reporting"]),
              readCount(probes["total"]),
            ),
          }
        : null,
    };
  }

  public static getChannel(
    answer: ServerSendingStatusAnswer,
    channel: ServerSendingChannel,
  ): ServerChannelStatus | null {
    return (
      answer.channels.find((status: ServerChannelStatus): boolean => {
        return status.channel === channel;
      }) || null
    );
  }

  /*
   * Whether the server has global probes and none of them is reporting:
   * monitors that run on them are not checked.
   */
  public static areGlobalProbesSilent(
    probes: ServerGlobalProbesStatus | null,
  ): boolean {
    return Boolean(probes && probes.total > 0 && probes.reporting === 0);
  }
}
