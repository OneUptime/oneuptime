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
    entry: ServerSendingHealthEntry;
  }): ServerChannelStatus {
    const isSetUp: boolean = !data.setUpProblem;

    return {
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
   * Whether a master admin should be told, in the product, that this
   * channel does not work: not set up, or failing.
   */
  public static needsAttention(status: { state: ServerSendingState }): boolean {
    return (
      status.state === ServerSendingState.NotSetUp ||
      status.state === ServerSendingState.Failing
    );
  }

  // The entry after a send went out.
  public static withSucceeded(
    entry: ServerSendingHealthEntry,
    now: Date,
  ): ServerSendingHealthEntry {
    return {
      ...entry,
      lastSucceededAt: now.toISOString(),
      failingSince: null,
    };
  }

  // The entry after a send failed, and why.
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
    };
  }

  /*
   * Whether a send that went out is news worth a write: the first ever, the
   * first after failures, or the same news an hour later.
   */
  public static shouldWriteSucceeded(
    entry: ServerSendingHealthEntry,
    now: Date,
  ): boolean {
    if (!entry.lastSucceededAt || entry.failingSince) {
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

      channels.push({
        channel: row["channel"],
        state: row["state"],
        hasWorked: row["hasWorked"] === true,
        lastWorkedAt: readDate(row["lastWorkedAt"]),
        failingSince: readDate(row["failingSince"]),
        lastFailure: readText(row["lastFailure"]),
        setUpProblem: readText(row["setUpProblem"]),
      });
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
