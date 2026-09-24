import User from "../../../Models/DatabaseModels/User";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import PushNotificationUtil from "../PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../WhatsAppTemplateUtil";

/*
 * One notification per probe transition, instead of one per monitor.
 *
 * When a probe stops reporting, every monitor whose only connected probe it
 * was stops being checked. Those monitors used to be announced one message at
 * a time: a self-hosted install with twenty monitors on its bundled probe got
 * twenty "disconnected" emails when the probe restarted, and twenty
 * "connected" ones a few minutes later (issue #2486). The event is the
 * probe's, so the message is too: each recipient gets one message that names
 * the probe and lists the monitors of theirs it affected.
 *
 * This file is the pure half: who hears about which monitors, and what the
 * message says on every channel. MonitorService does the reads and the sends.
 */

export interface ProbeAffectedMonitor {
  monitorId: ObjectID;
  // Plain text, exactly as the user typed it. Escaped wherever it is rendered.
  monitorName: string;
  monitorViewLink: string;
}

/*
 * Why a recipient hears about a monitor: they own it (directly or through a
 * team), or it has no owners at all and they own the project. Every other
 * owner notification makes the same distinction (see the OwnerInfo partial).
 */
export enum ProbeMonitorsRecipientOwnership {
  MonitorOwner = "MonitorOwner",
  ProjectOwner = "ProjectOwner",
  Mixed = "Mixed",
}

export interface ProbeMonitorsRecipient {
  user: User;
  // Sorted by name, so every channel and every recipient sees the same order.
  monitors: Array<ProbeAffectedMonitor>;
  ownership: ProbeMonitorsRecipientOwnership;
}

export interface ProbeMonitorsNotificationContent {
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
  whatsAppMessage: WhatsAppMessagePayload;
}

const ALL_BRACES: RegExp = /[{}]/g;

export default class ProbeMonitorsNotification {
  // How many monitors the email lists before it summarises the rest.
  public static readonly MAX_MONITORS_IN_EMAIL: number = 25;

  /*
   * The event type is the per-monitor one on purpose: the grouped message
   * replaces exactly the messages that event used to send, so the channels a
   * user already chose for it (and whether they turned it off) carry over
   * with no new setting and no data migration.
   */
  public static readonly EVENT_TYPE: NotificationSettingEventType =
    NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES;

  /*
   * Inverts "monitor -> who to tell" into "person -> which monitors".
   *
   * A monitor with owners goes to its owners only. A monitor with no owners
   * goes to the project owners — the same fallback the per-monitor message
   * used. A person reached both ways for different monitors gets them all in
   * one message; the ownership field records which reason applies.
   */
  public static groupMonitorsByRecipient(data: {
    monitors: Array<ProbeAffectedMonitor>;
    // Keyed by monitorId.toString(). A missing or empty entry means no owners.
    ownersByMonitorId: Dictionary<Array<User>>;
    projectOwners: Array<User>;
  }): Array<ProbeMonitorsRecipient> {
    interface Accumulator {
      user: User;
      monitors: Array<ProbeAffectedMonitor>;
      monitorIds: Set<string>;
      viaMonitorOwnership: number;
      viaProjectOwnership: number;
    }

    // Insertion-ordered, so recipients come out in first-seen order.
    const byUserId: Map<string, Accumulator> = new Map();

    const addMonitorForUser: (
      user: User,
      monitor: ProbeAffectedMonitor,
      isMonitorOwner: boolean,
    ) => void = (
      user: User,
      monitor: ProbeAffectedMonitor,
      isMonitorOwner: boolean,
    ): void => {
      const userId: string | undefined = user.id?.toString();

      if (!userId) {
        return;
      }

      let entry: Accumulator | undefined = byUserId.get(userId);

      if (!entry) {
        entry = {
          user: user,
          monitors: [],
          monitorIds: new Set(),
          viaMonitorOwnership: 0,
          viaProjectOwnership: 0,
        };
        byUserId.set(userId, entry);
      }

      const monitorId: string = monitor.monitorId.toString();

      // A user listed twice for the same monitor (e.g. user AND team owner).
      if (entry.monitorIds.has(monitorId)) {
        return;
      }

      entry.monitorIds.add(monitorId);
      entry.monitors.push(monitor);

      if (isMonitorOwner) {
        entry.viaMonitorOwnership++;
      } else {
        entry.viaProjectOwnership++;
      }
    };

    for (const monitor of data.monitors) {
      const owners: Array<User> =
        data.ownersByMonitorId[monitor.monitorId.toString()] || [];

      if (owners.length > 0) {
        for (const owner of owners) {
          addMonitorForUser(owner, monitor, true);
        }
        continue;
      }

      for (const projectOwner of data.projectOwners) {
        addMonitorForUser(projectOwner, monitor, false);
      }
    }

    return Array.from(byUserId.values()).map(
      (entry: Accumulator): ProbeMonitorsRecipient => {
        let ownership: ProbeMonitorsRecipientOwnership =
          ProbeMonitorsRecipientOwnership.Mixed;

        if (entry.viaProjectOwnership === 0) {
          ownership = ProbeMonitorsRecipientOwnership.MonitorOwner;
        } else if (entry.viaMonitorOwnership === 0) {
          ownership = ProbeMonitorsRecipientOwnership.ProjectOwner;
        }

        return {
          user: entry.user,
          monitors: ProbeMonitorsNotification.sortMonitors(entry.monitors),
          ownership: ownership,
        };
      },
    );
  }

  public static sortMonitors(
    monitors: Array<ProbeAffectedMonitor>,
  ): Array<ProbeAffectedMonitor> {
    return [...monitors].sort(
      (a: ProbeAffectedMonitor, b: ProbeAffectedMonitor): number => {
        const byName: number = a.monitorName.localeCompare(b.monitorName);

        if (byName !== 0) {
          return byName;
        }

        // Same name: fall back to the id so the order is still stable.
        return a.monitorId.toString().localeCompare(b.monitorId.toString());
      },
    );
  }

  // "1 monitor", "20 monitors".
  public static getMonitorCountLabel(count: number): string {
    return count === 1 ? "1 monitor" : `${count} monitors`;
  }

  /*
   * One sentence for SMS, voice, push and chat, where a list of monitor
   * names does not fit. Names the probe, the count and the project.
   */
  public static getSummary(data: {
    probeName: string;
    projectName: string;
    isProbeDisconnected: boolean;
    monitorCount: number;
  }): string {
    const countLabel: string = ProbeMonitorsNotification.getMonitorCountLabel(
      data.monitorCount,
    );
    const verb: string = data.monitorCount === 1 ? "is" : "are";

    if (data.isProbeDisconnected) {
      return `Probe ${data.probeName} is disconnected. ${countLabel} in project ${data.projectName} ${verb} not being monitored.`;
    }

    return `Probe ${data.probeName} is connected again. ${countLabel} in project ${data.projectName} ${verb} being monitored again.`;
  }

  /*
   * MailService compiles the subject as a Handlebars template, so a probe
   * name containing "{{" would be read as an expression, or fail to parse and
   * stop the email. Every brace goes, not just "{{" and "}}": removing the
   * "}}" from "a{}}{b" would join the two single braces into a new "{{".
   */
  public static stripHandlebarsBraces(value: string): string {
    return value.replace(ALL_BRACES, "");
  }

  public static getEmailSubject(data: {
    probeName: string;
    isProbeDisconnected: boolean;
    monitorCount: number;
  }): string {
    const probeName: string = ProbeMonitorsNotification.stripHandlebarsBraces(
      data.probeName,
    );
    const countLabel: string = ProbeMonitorsNotification.getMonitorCountLabel(
      data.monitorCount,
    );

    if (data.isProbeDisconnected) {
      return `[Probe Disconnected] ${probeName}: ${countLabel} not being monitored`;
    }

    return `[Probe Connected] ${probeName}: ${countLabel} being monitored again`;
  }

  /*
   * WhatsApp can only send templates Meta has approved, with exactly their
   * variables. This reuses the approved per-monitor template ("Probes for
   * monitor {{monitor_name}} are {{probe_status}}. Review probe details using
   * {{monitor_link}} ...") and fills monitor_name with a phrase that stays
   * grammatical: "Checkout API and 19 other monitors".
   */
  public static getWhatsAppMonitorName(
    monitors: Array<ProbeAffectedMonitor>,
  ): string {
    const first: ProbeAffectedMonitor | undefined = monitors[0];

    if (!first) {
      return "";
    }

    const others: number = monitors.length - 1;

    if (others === 0) {
      return first.monitorName;
    }

    return `${first.monitorName} and ${others} other ${
      others === 1 ? "monitor" : "monitors"
    }`;
  }

  public static buildContent(data: {
    probeName: string;
    projectName: string;
    isProbeDisconnected: boolean;
    recipient: ProbeMonitorsRecipient;
    /*
     * Where "see them all" points: the monitors-with-disconnected-probes list
     * for a disconnect, the monitors list for a reconnect.
     */
    viewMonitorsLink: string;
  }): ProbeMonitorsNotificationContent {
    const monitors: Array<ProbeAffectedMonitor> = data.recipient.monitors;
    const monitorCount: number = monitors.length;
    const connectionStatus: string = data.isProbeDisconnected
      ? "Disconnected"
      : "Connected";
    const countLabel: string =
      ProbeMonitorsNotification.getMonitorCountLabel(monitorCount);

    /*
     * With a single monitor, "see them all" is that monitor. The chat
     * channels and push have room for one link, so give them the precise one.
     */
    const onlyMonitor: ProbeAffectedMonitor | undefined =
      monitorCount === 1 ? monitors[0] : undefined;
    const primaryLink: string = onlyMonitor
      ? onlyMonitor.monitorViewLink
      : data.viewMonitorsLink;

    const monitorsShown: Array<ProbeAffectedMonitor> = monitors.slice(
      0,
      ProbeMonitorsNotification.MAX_MONITORS_IN_EMAIL,
    );
    const remainingCount: number = monitorCount - monitorsShown.length;

    const vars: Dictionary<string | JSONObject> = {
      title: data.isProbeDisconnected
        ? `${countLabel} not being monitored`
        : `${countLabel} being monitored again`,
      probeName: data.probeName,
      projectName: data.projectName,
      probeStatus: connectionStatus,
      isProbeDisconnected: data.isProbeDisconnected ? "true" : "false",
      monitorCount: monitorCount.toString(),
      monitors: monitorsShown.map(
        (monitor: ProbeAffectedMonitor): JSONObject => {
          return {
            monitorName: monitor.monitorName,
            monitorViewLink: monitor.monitorViewLink,
          };
        },
      ) as unknown as JSONObject,
      hasMore: remainingCount > 0 ? "true" : "false",
      remainingCount: remainingCount.toString(),
      viewMonitorsLink: data.viewMonitorsLink,
      ownership: data.recipient.ownership,
    };

    // Kept for parity with every other owner email (and the rollup digest).
    if (
      data.recipient.ownership === ProbeMonitorsRecipientOwnership.MonitorOwner
    ) {
      vars["isOwner"] = "true";
    }

    const emailEnvelope: EmailEnvelope = {
      templateType: EmailTemplateType.MonitorsAffectedByProbeStatus,
      vars: vars,
      subject: ProbeMonitorsNotification.getEmailSubject({
        probeName: data.probeName,
        isProbeDisconnected: data.isProbeDisconnected,
        monitorCount: monitorCount,
      }),
    };

    const summary: string = ProbeMonitorsNotification.getSummary({
      probeName: data.probeName,
      projectName: data.projectName,
      isProbeDisconnected: data.isProbeDisconnected,
      monitorCount: monitorCount,
    });

    const smsMessage: SMSMessage = {
      message: `This is a message from OneUptime. ${summary} To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
    };

    const callRequestMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. ${summary} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
        },
      ],
    };

    const pushNotificationMessage: PushNotificationMessage =
      PushNotificationUtil.createProbeMonitorsStatusNotification({
        probeName: data.probeName,
        projectName: data.projectName,
        connectionStatus: connectionStatus,
        monitorCount: monitorCount,
        summary: summary,
        clickAction: primaryLink,
      });

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType: ProbeMonitorsNotification.EVENT_TYPE,
        templateVariables: {
          monitor_name:
            ProbeMonitorsNotification.getWhatsAppMonitorName(monitors),
          probe_status: connectionStatus,
          monitor_link: primaryLink,
        },
      });

    return {
      emailEnvelope,
      smsMessage,
      callRequestMessage,
      pushNotificationMessage,
      whatsAppMessage,
    };
  }
}
