import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import {
  FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE,
  ProbeFeature,
  ProbeMajorReleaseLag,
} from "../../../Types/Probe/ProbeReportedVersion";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import PushNotificationUtil from "../PushNotificationUtil";

/*
 * WHAT A CUSTOM PROBE'S OWNERS ARE TOLD WHEN IT FALLS A MAJOR RELEASE
 * BEHIND THE ONEUPTIME IT REPORTS TO (OneUptime issue #9977), on every
 * channel their notification setting uses: which probe, how far behind it
 * is, what it misses until it is updated, and how to update it.
 *
 *   - Email: the probe, its version and OneUptime's, what it misses in the
 *     probe page's own words, Update a probe as its button and the probe's
 *     page as its link, and why the reader was told.
 *   - SMS, and the Slack, Microsoft Teams, Mattermost and Telegram messages
 *     and webhooks made from the subject and the SMS: one line that stands
 *     alone, with the docs that say how to update it.
 *   - Push, and the custom channels that send what push says: the line, a
 *     tap away from the probe's page.
 *   - A call: the line, spoken.
 *   - WhatsApp: none. It delivers only templates Meta has approved, and no
 *     approved template's words are true of this, so Notification Settings
 *     offers no WhatsApp switch for it (Types/WhatsApp/WhatsAppEventTemplates).
 *
 * No sentence names the release a feature first shipped in, as no "update
 * the probe" sentence does (#10798, Types/Probe/ProbeCapability): it says
 * to update to the latest release, which has every feature a release has
 * shipped. The versions it names are the probe's and OneUptime's own.
 *
 * Pure: the job reads the probe, its owners and the links, and sends.
 */

/*
 * What a probe misses until it is updated, as its page says it
 * (Dashboard Components/Probe/ProbeUpdateCopy, held to it by a test): the
 * email's list.
 */
export const PROBE_MISSED_FEATURE_SENTENCES: Readonly<
  Record<ProbeFeature, string>
> = {
  [ProbeFeature.OneTimeCodes]:
    "Too old to make one-time codes. Monitors that use a one-time code secret fail their check on this probe until it is updated.",
  [ProbeFeature.AnyRequestBody]:
    "Too old to send a request body that is a JSON array, a single value or text. API monitors with such a body fail their check on this probe until it is updated.",
};

// The same, as the monitors that fail on it: the short line's list.
export const PROBE_MISSED_FEATURE_MONITORS: Readonly<
  Record<ProbeFeature, string>
> = {
  [ProbeFeature.OneTimeCodes]: "monitors that use a one-time code secret",
  [ProbeFeature.AnyRequestBody]:
    "API monitors whose request body is a JSON array, a single value or text",
};

export interface ProbeMajorReleaseNotificationInput {
  probeName: string;
  probeDescription?: string | null | undefined;
  projectName: string;
  lag: ProbeMajorReleaseLag;
  // What it misses until it is updated (ProbeReportedVersionUtil.getMissedFeatures).
  missedFeatures: Array<ProbeFeature>;
  // The probe's page in the Dashboard.
  viewProbeLink: string;
  // The docs' Update a probe section.
  updateProbeDocsUrl: string;
  /*
   * Whether the reader is one of the probe's owners, or one of the
   * project's owners told in their place: the email says which.
   */
  isOwner: boolean;
}

export interface ProbeMajorReleaseNotificationContent {
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
}

// Each brace, so a probe's name never makes a Handlebars expression of a subject.
const ALL_BRACES: RegExp = /[{}]/g;

export default class ProbeMajorReleaseNotification {
  public static readonly EVENT_TYPE: NotificationSettingEventType =
    NotificationSettingEventType.SEND_PROBE_MAJOR_RELEASE_BEHIND_OWNER_NOTIFICATION;

  // The push notifications of one probe replace each other: the newest is what counts.
  public static readonly PUSH_TAG: string = "probe-major-release-behind";

  // "1 major release", "2 major releases", "at least 1 major release".
  public static getMajorReleasesLabel(lag: ProbeMajorReleaseLag): string {
    const count: number = lag.majorReleasesBehind;

    return `${lag.isAtLeast ? "at least " : ""}${count} major ${
      count === 1 ? "release" : "releases"
    }`;
  }

  // The probe's version, or what is known of it when it says none.
  public static getProbeVersionLabel(lag: ProbeMajorReleaseLag): string {
    return (
      lag.probeRelease ||
      `older than ${FIRST_PROBE_VERSION_THAT_SAYS_ITS_RELEASE}`
    );
  }

  // "probe-1 is 2 major releases behind OneUptime": the title, and the subject after its tag.
  public static getTitle(data: {
    probeName: string;
    lag: ProbeMajorReleaseLag;
  }): string {
    return `${data.probeName} is ${ProbeMajorReleaseNotification.getMajorReleasesLabel(
      data.lag,
    )} behind OneUptime`;
  }

  public static getEmailSubject(data: {
    probeName: string;
    lag: ProbeMajorReleaseLag;
  }): string {
    return `[Probe Update Available] ${ProbeMajorReleaseNotification.getTitle({
      probeName: data.probeName.replace(ALL_BRACES, ""),
      lag: data.lag,
    })}`;
  }

  /*
   * "Probe probe-1 runs 16.4.0, 2 major releases behind OneUptime 18.1.0,
   * which it reports to." - the line every short channel opens with.
   */
  public static getLagSentence(data: {
    probeName: string;
    lag: ProbeMajorReleaseLag;
  }): string {
    const version: string = data.lag.probeRelease
      ? data.lag.probeRelease
      : `a version ${ProbeMajorReleaseNotification.getProbeVersionLabel(data.lag)}`;

    return `Probe ${data.probeName} runs ${version}, ${ProbeMajorReleaseNotification.getMajorReleasesLabel(
      data.lag,
    )} behind OneUptime ${data.lag.serverRelease}, which it reports to.`;
  }

  /*
   * "Until it is updated, monitors that use a one-time code secret fail
   * their check on it." - or nothing, when it misses nothing a release
   * added.
   */
  public static getMissedSentence(missedFeatures: Array<ProbeFeature>): string {
    const monitors: Array<string> = missedFeatures.map(
      (feature: ProbeFeature): string => {
        return PROBE_MISSED_FEATURE_MONITORS[feature];
      },
    );

    if (monitors.length === 0) {
      return "";
    }

    const list: string =
      monitors.length === 1
        ? monitors[0]!
        : `${monitors.slice(0, -1).join(", ")} and ${monitors[monitors.length - 1]}`;

    return `Until it is updated, ${list} fail their check on it.`;
  }

  public static buildContent(
    data: ProbeMajorReleaseNotificationInput,
  ): ProbeMajorReleaseNotificationContent {
    const title: string = ProbeMajorReleaseNotification.getTitle(data);
    const lagSentence: string =
      ProbeMajorReleaseNotification.getLagSentence(data);
    const missedSentence: string =
      ProbeMajorReleaseNotification.getMissedSentence(data.missedFeatures);
    const summary: string = [lagSentence, missedSentence]
      .filter(Boolean)
      .join(" ");

    const vars: Dictionary<string | JSONObject> = {
      title,
      lagSentence: `${lagSentence} Update it to get the latest checks and fixes.`,
      probeName: data.probeName,
      probeDescription: data.probeDescription || "",
      probeRelease: ProbeMajorReleaseNotification.getProbeVersionLabel(
        data.lag,
      ),
      serverRelease: data.lag.serverRelease,
      majorReleasesBehind: data.lag.majorReleasesBehind.toString(),
      projectName: data.projectName,
      hasMissedFeatures: data.missedFeatures.length > 0 ? "true" : "",
      missedFeatures: data.missedFeatures.map(
        (feature: ProbeFeature): string => {
          return PROBE_MISSED_FEATURE_SENTENCES[feature];
        },
      ) as unknown as JSONObject,
      viewProbeLink: data.viewProbeLink,
      updateProbeDocsUrl: data.updateProbeDocsUrl,
    };

    if (data.isOwner) {
      vars["isOwner"] = "true";
    }

    const emailEnvelope: EmailEnvelope = {
      templateType: EmailTemplateType.ProbeMajorReleaseBehind,
      vars,
      subject: ProbeMajorReleaseNotification.getEmailSubject(data),
      isSubjectLiteral: true,
    };

    const smsMessage: SMSMessage = {
      message: buildNotificationSms(
        `${summary} How to update it: ${data.updateProbeDocsUrl}`,
      ),
    };

    const callRequestMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. ${summary} Update the probe to the latest OneUptime release. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
        },
      ],
    };

    const pushNotificationMessage: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title,
        body: `${summary} Tap to see the probe.`,
        clickAction: data.viewProbeLink,
        tag: ProbeMajorReleaseNotification.PUSH_TAG,
        requireInteraction: false,
      });

    return {
      emailEnvelope,
      smsMessage,
      callRequestMessage,
      pushNotificationMessage,
    };
  }
}
