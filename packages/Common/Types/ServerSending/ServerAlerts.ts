import { InstallationHealthProbeBehind } from "../InstallationHealth/InstallationHealth";
import { JSONObject } from "../JSON";
import { ProbeBehindWork } from "../Probe/ProbeBehind";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "./ServerSendingStatus";

/*
 * TELLING MASTER ADMINS, THROUGH ANOTHER CHANNEL, WHEN THE SERVER'S EMAIL OR
 * ITS GLOBAL PROBES STOP WORKING (#6879).
 *
 * The banner says "Email is failing" or "No global probe is reporting" to a
 * master admin who opens the product. Nobody was told while nobody looked:
 * the server's notices to its admins go by email, so they stop exactly when
 * email does. So a worker job (Workers/Jobs/ServerAlerts) reads where the
 * server stands (ServerSendingStatus) every few minutes, and tells the
 * master admins when one of three things changes:
 *
 *   - email:          working -> failing, and failing -> working again;
 *   - global probes:  some reporting -> none, and none -> some again;
 *   - global probes behind (#9500): all keeping up -> one behind, its
 *     monitors checked or its network devices polled later than their
 *     interval (Types/Probe/ProbeBehind, read by GlobalProbesBehind), and
 *     one behind -> all keeping up again. Said of the reporting probes
 *     only: while none reports, the line above says more.
 *
 * Through what, as master admins chose on Settings > Emails: a push to the
 * master admins' own devices, an SMS to the number they gave, and - for the
 * probes only, both their lines - the Admin Notification Email. Never through the channel it
 * is about (email is never told by email), never through one the server
 * cannot send through right now, and never to anyone but the master admins:
 * no project member is ever paged.
 *
 * Only a change is told, and at most one message about a thing an hour
 * (SERVER_ALERT_MIN_INTERVAL_MS): a change while that hour runs waits for
 * it, and is said then only if it still holds, so email that flaps says
 * what it last settled on, once. The first look at a thing - a new server,
 * or the first run after an upgrade - only notes where it stands. A change
 * no channel can carry is not told, nothing is thrown, and it goes out once
 * a channel can carry it. What was last told is kept on the server
 * (GlobalConfig.serverAlertState), written only when it changes.
 *
 * Pure: the job, its tests and the Admin Dashboard read the same rules.
 */

export enum ServerAlertSubject {
  Email = "email",
  GlobalProbes = "globalProbes",
  GlobalProbesBehind = "globalProbesBehind",
}

export enum ServerAlertCondition {
  Working = "working",
  Failing = "failing",
}

export enum ServerAlertChannel {
  Push = "push",
  SMS = "sms",
  Email = "email",
}

// At most one message about a thing in this long.
export const SERVER_ALERT_MIN_INTERVAL_MS: number = 60 * 60 * 1000;

/*
 * Where a probe behind is explained, and its fix: the finding OneUptime
 * Health lists for it. Short, so the message fits in one SMS.
 */
const BEHIND_SEE_WHY: string = "See OneUptime Health in the Admin Dashboard.";

// What the job keeps of one thing: what it last told, when, and its last try.
export interface ServerAlertSubjectState {
  told: ServerAlertCondition;
  // When it was last told, through any channel.
  toldAt: string | null;
  // When it was last tried, told or not.
  triedAt: string | null;
}

export type ServerAlertState = {
  [subject in ServerAlertSubject]?: ServerAlertSubjectState | undefined;
};

// Where master admins chose the alerts go (Settings > Emails).
export interface ServerAlertSettings {
  smsNumber: string | null;
  isPushOn: boolean;
  adminNotificationEmail: string | null;
}

/*
 * Whether master admins get the alerts as push notifications while nobody
 * chose: yes on a self-hosted server, no on OneUptime Cloud.
 */
export const isServerAlertPushOnByDefault: (
  isBillingEnabled: boolean,
) => boolean = (isBillingEnabled: boolean): boolean => {
  return !isBillingEnabled;
};

/*
 * Where the alerts go, from what master admins chose (null: nobody chose).
 * On OneUptime Cloud nothing goes anywhere until its operator turns push on
 * or gives a number: the Admin Notification Email alone does not opt in.
 */
export const getServerAlertSettings: (data: {
  smsNumber: string | null;
  isPushOn: boolean | null;
  adminNotificationEmail: string | null;
  isBillingEnabled: boolean;
}) => ServerAlertSettings = (data: {
  smsNumber: string | null;
  isPushOn: boolean | null;
  adminNotificationEmail: string | null;
  isBillingEnabled: boolean;
}): ServerAlertSettings => {
  if (data.isBillingEnabled && data.isPushOn !== true && !data.smsNumber) {
    return { smsNumber: null, isPushOn: false, adminNotificationEmail: null };
  }

  return {
    smsNumber: data.smsNumber || null,
    isPushOn:
      data.isPushOn === null
        ? isServerAlertPushOnByDefault(data.isBillingEnabled)
        : data.isPushOn,
    adminNotificationEmail: data.adminNotificationEmail || null,
  };
};

// A message to send: what changed, and the channels that may carry it.
export interface ServerAlertMessage {
  subject: ServerAlertSubject;
  condition: ServerAlertCondition;
  channels: Array<ServerAlertChannel>;
}

export interface ServerAlertPlan {
  messages: Array<ServerAlertMessage>;
  // The state with any first look noted; written only when it changed.
  state: ServerAlertState;
  hasStateChanged: boolean;
}

const SUBJECTS: ReadonlyArray<ServerAlertSubject> = [
  ServerAlertSubject.Email,
  ServerAlertSubject.GlobalProbes,
  ServerAlertSubject.GlobalProbesBehind,
];

// The server's own channel each alert channel goes out through.
const SENDING_CHANNEL_OF: {
  [channel in ServerAlertChannel]: ServerSendingChannel;
} = {
  [ServerAlertChannel.Push]: ServerSendingChannel.Push,
  [ServerAlertChannel.SMS]: ServerSendingChannel.SMS,
  [ServerAlertChannel.Email]: ServerSendingChannel.Email,
};

const readTime: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
};

const readSubjectState: (value: unknown) => ServerAlertSubjectState | null = (
  value: unknown,
): ServerAlertSubjectState | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (
    !Object.values(ServerAlertCondition).includes(
      json["told"] as ServerAlertCondition,
    )
  ) {
    return null;
  }

  return {
    told: json["told"] as ServerAlertCondition,
    toldAt: readTime(json["toldAt"]),
    triedAt: readTime(json["triedAt"]),
  };
};

export default class ServerAlertsUtil {
  /*
   * What is kept on the server, read strictly: anything it cannot read is
   * as if nothing had been told, and is noted again at the next look.
   */
  public static readState(value: unknown): ServerAlertState {
    const state: ServerAlertState = {};

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return state;
    }

    for (const subject of SUBJECTS) {
      const subjectState: ServerAlertSubjectState | null = readSubjectState(
        (value as JSONObject)[subject],
      );

      if (subjectState) {
        state[subject] = subjectState;
      }
    }

    return state;
  }

  public static toJSON(state: ServerAlertState): JSONObject {
    return JSON.parse(JSON.stringify(state)) as JSONObject;
  }

  /*
   * Where a thing stands now, or null when there is nothing to say of it:
   * email not set up, or not tried since its settings changed; a server
   * with no global probes; global probes behind that could not be read, or
   * while none of them reports.
   *
   * globalProbesBehind: the reporting global probes that are behind
   * (GlobalProbesBehind), each kind of work an entry; null or left out
   * when they were not read.
   */
  public static getCondition(
    subject: ServerAlertSubject,
    answer: ServerSendingStatusAnswer,
    globalProbesBehind?: Array<InstallationHealthProbeBehind> | null,
  ): ServerAlertCondition | null {
    if (subject === ServerAlertSubject.GlobalProbesBehind) {
      const probes: ServerSendingStatusAnswer["globalProbes"] =
        answer.globalProbes;

      // No global probe, or none reporting: there is nothing behind to say.
      if (!probes || probes.total <= 0 || probes.reporting <= 0) {
        return null;
      }

      if (!globalProbesBehind) {
        return null;
      }

      return globalProbesBehind.length > 0
        ? ServerAlertCondition.Failing
        : ServerAlertCondition.Working;
    }

    if (subject === ServerAlertSubject.GlobalProbes) {
      const probes: ServerSendingStatusAnswer["globalProbes"] =
        answer.globalProbes;

      if (!probes || probes.total <= 0) {
        return null;
      }

      return probes.reporting > 0
        ? ServerAlertCondition.Working
        : ServerAlertCondition.Failing;
    }

    const email: ServerChannelStatus | null =
      ServerSendingStatusUtil.getChannel(answer, ServerSendingChannel.Email);

    if (email?.state === ServerSendingState.Working) {
      return ServerAlertCondition.Working;
    }

    if (email?.state === ServerSendingState.Failing) {
      return ServerAlertCondition.Failing;
    }

    return null;
  }

  /*
   * The channels a message about the thing may go through: those master
   * admins chose, that the server can send through now - never email for
   * email, and email only to the Admin Notification Email.
   */
  public static getChannels(
    subject: ServerAlertSubject,
    answer: ServerSendingStatusAnswer,
    settings: ServerAlertSettings,
  ): Array<ServerAlertChannel> {
    const chosen: Array<ServerAlertChannel> = [];

    if (settings.isPushOn) {
      chosen.push(ServerAlertChannel.Push);
    }

    if (settings.smsNumber) {
      chosen.push(ServerAlertChannel.SMS);
    }

    if (settings.adminNotificationEmail) {
      chosen.push(ServerAlertChannel.Email);
    }

    return chosen.filter((channel: ServerAlertChannel): boolean => {
      // Never the channel the message is about.
      if (
        subject === ServerAlertSubject.Email &&
        channel === ServerAlertChannel.Email
      ) {
        return false;
      }

      const status: ServerChannelStatus | null =
        ServerSendingStatusUtil.getChannel(answer, SENDING_CHANNEL_OF[channel]);

      return Boolean(status && ServerSendingStatusUtil.canSendNow(status));
    });
  }

  /*
   * What to tell now (see the top of this file), and the state with any
   * first look noted.
   */
  public static plan(data: {
    answer: ServerSendingStatusAnswer;
    state: ServerAlertState;
    settings: ServerAlertSettings;
    now: Date;
    // The global probes behind (GlobalProbesBehind); left out: not read.
    globalProbesBehind?: Array<InstallationHealthProbeBehind> | null;
  }): ServerAlertPlan {
    const state: ServerAlertState = { ...data.state };
    const messages: Array<ServerAlertMessage> = [];
    let hasStateChanged: boolean = false;

    for (const subject of SUBJECTS) {
      const condition: ServerAlertCondition | null =
        ServerAlertsUtil.getCondition(
          subject,
          data.answer,
          data.globalProbesBehind,
        );

      if (!condition) {
        continue;
      }

      const told: ServerAlertSubjectState | undefined = state[subject];

      // The first look only notes where it stands.
      if (!told) {
        state[subject] = { told: condition, toldAt: null, triedAt: null };
        hasStateChanged = true;
        continue;
      }

      if (told.told === condition) {
        continue;
      }

      if (!ServerAlertsUtil.isDue(told, data.now)) {
        continue;
      }

      const channels: Array<ServerAlertChannel> = ServerAlertsUtil.getChannels(
        subject,
        data.answer,
        data.settings,
      );

      // No channel can carry it: nothing is sent, and it waits for one.
      if (channels.length === 0) {
        continue;
      }

      messages.push({ subject, condition, channels });
    }

    return { messages, state, hasStateChanged };
  }

  // Whether an hour has gone by since the thing was last told or tried.
  public static isDue(told: ServerAlertSubjectState, now: Date): boolean {
    const last: number = Math.max(
      told.toldAt ? Date.parse(told.toldAt) : 0,
      told.triedAt ? Date.parse(told.triedAt) : 0,
    );

    return now.getTime() - last >= SERVER_ALERT_MIN_INTERVAL_MS;
  }

  /*
   * The state once a message was tried: told, when any channel carried it;
   * else only tried, so it is tried again an hour later at the soonest.
   */
  public static afterSending(data: {
    state: ServerAlertState;
    message: ServerAlertMessage;
    sentThrough: Array<ServerAlertChannel>;
    now: Date;
  }): ServerAlertState {
    const now: string = data.now.toISOString();
    const previous: ServerAlertSubjectState | undefined =
      data.state[data.message.subject];

    return {
      ...data.state,
      [data.message.subject]:
        data.sentThrough.length > 0
          ? { told: data.message.condition, toldAt: now, triedAt: now }
          : {
              told: previous?.told || data.message.condition,
              toldAt: previous?.toldAt || null,
              triedAt: now,
            },
    };
  }

  /*
   * The message's words: a title and one sentence, short enough for an
   * SMS. Never the mail server's answer, which can name a recipient: the
   * Admin Dashboard says why, to whoever opens it.
   */
  public static getText(data: {
    message: ServerAlertMessage;
    serverName: string;
    probes: ServerSendingStatusAnswer["globalProbes"];
    // The global probes behind, for that subject's words.
    globalProbesBehind?: Array<InstallationHealthProbeBehind> | null;
  }): { title: string; body: string } {
    const server: string = data.serverName;

    if (data.message.subject === ServerAlertSubject.GlobalProbesBehind) {
      return ServerAlertsUtil.getBehindText({
        condition: data.message.condition,
        server: server,
        probes: data.probes,
        behind: data.globalProbesBehind || [],
      });
    }

    if (data.message.subject === ServerAlertSubject.Email) {
      return data.message.condition === ServerAlertCondition.Failing
        ? {
            title: `Email from ${server} stopped working`,
            body: `Email from ${server} stopped working: nobody gets email from it until it is fixed. See why in the Admin Dashboard, under Settings > Emails.`,
          }
        : {
            title: `Email from ${server} works again`,
            body: `Email from ${server} works again.`,
          };
    }

    const total: number = data.probes?.total || 0;
    const reporting: number = data.probes?.reporting || 0;

    return data.message.condition === ServerAlertCondition.Failing
      ? {
          title: `No global probe of ${server} is reporting`,
          body: `No global probe of ${server} is reporting, so the monitors they check are not checked. See them in the Admin Dashboard, under Settings > Global Probes.`,
        }
      : {
          title: `Global probes of ${server} report again`,
          body: `Global probes of ${server} report again: ${reporting} of ${total}.`,
        };
  }

  /*
   * A global probe behind, by name, and on what; or that they keep up
   * again - with, while some do not report, how many, since a probe that
   * stopped reporting is not one that caught up.
   */
  private static getBehindText(data: {
    condition: ServerAlertCondition;
    server: string;
    probes: ServerSendingStatusAnswer["globalProbes"];
    behind: Array<InstallationHealthProbeBehind>;
  }): { title: string; body: string } {
    const server: string = data.server;

    if (data.condition !== ServerAlertCondition.Failing) {
      const total: number = data.probes?.total || 0;
      const silent: number = Math.max(0, total - (data.probes?.reporting || 0));

      return {
        title: `Global probes of ${server} keep up again`,
        body:
          silent > 0
            ? `Global probes of ${server} keep up again: none that reports is behind. ${silent} of ${total} ${silent === 1 ? "does" : "do"} not report.`
            : `Global probes of ${server} keep up again: none is behind.`,
      };
    }

    // Each probe once, with what it is behind on, in the order read.
    const byProbe: Map<string, { name: string; work: Set<ProbeBehindWork> }> =
      new Map<string, { name: string; work: Set<ProbeBehindWork> }>();

    for (const entry of data.behind) {
      const probe: { name: string; work: Set<ProbeBehindWork> } = byProbe.get(
        entry.id,
      ) || { name: entry.name.trim() || "A global probe", work: new Set() };

      probe.work.add(entry.work || ProbeBehindWork.MonitorChecks);
      byProbe.set(entry.id, probe);
    }

    const probes: Array<{ name: string; work: Set<ProbeBehindWork> }> =
      Array.from(byProbe.values());

    if (probes.length !== 1) {
      const names: string = probes
        .map((probe: { name: string }): string => {
          return probe.name;
        })
        .join(", ");

      return {
        title: `${probes.length} global probes of ${server} are behind`,
        body: `${probes.length} global probes of ${server} are behind: ${names}. What they check is checked less often than set. ${BEHIND_SEE_WHY}`,
      };
    }

    const probe: { name: string; work: Set<ProbeBehindWork> } = probes[0]!;
    const isBehindOnMonitors: boolean = probe.work.has(
      ProbeBehindWork.MonitorChecks,
    );
    const isBehindOnDevices: boolean = probe.work.has(
      ProbeBehindWork.DevicePolls,
    );

    const what: string =
      isBehindOnMonitors && isBehindOnDevices
        ? "its monitors and devices are checked less often than set"
        : isBehindOnDevices
          ? "its network devices are polled less often than set"
          : "its monitors are checked less often than set";

    return {
      title: `Global probe ${probe.name} of ${server} is behind`,
      body: `Global probe ${probe.name} of ${server} is behind: ${what}. ${BEHIND_SEE_WHY}`,
    };
  }
}
