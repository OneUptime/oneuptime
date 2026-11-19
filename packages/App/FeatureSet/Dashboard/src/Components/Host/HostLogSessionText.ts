import HostLogSession from "Common/Models/DatabaseModels/HostLogSession";
import OneUptimeDate from "Common/Types/Date";
import {
  HOST_LOG_SESSION_DURATIONS,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "Common/Types/Host/HostLogSession";
import { translationKey } from "Common/Types/Translator";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a log session (#9806) says on a host's Logs page: its status in
 * words and a tone, the line under it, how long it runs and at what level.
 * English kept as keys (translationKey), looked up where it is drawn.
 */

const STATUS_LABELS: Record<HostLogSessionStatus, string> = {
  [HostLogSessionStatus.Requested]: translationKey("Waiting for the Device"),
  [HostLogSessionStatus.AwaitingApproval]: translationKey(
    "Waiting for Approval",
  ),
  [HostLogSessionStatus.Starting]: translationKey("Starting"),
  [HostLogSessionStatus.Collecting]: translationKey("Collecting"),
  [HostLogSessionStatus.Declined]: translationKey("Declined"),
  [HostLogSessionStatus.Ended]: translationKey("Ended"),
  [HostLogSessionStatus.Cancelled]: translationKey("Cancelled"),
  [HostLogSessionStatus.Expired]: translationKey("Expired"),
  [HostLogSessionStatus.Unavailable]: translationKey("Unavailable"),
};

const STATUS_TONES: Record<HostLogSessionStatus, PillTone> = {
  [HostLogSessionStatus.Requested]: PillTone.Warning,
  [HostLogSessionStatus.AwaitingApproval]: PillTone.Warning,
  [HostLogSessionStatus.Starting]: PillTone.Info,
  [HostLogSessionStatus.Collecting]: PillTone.Success,
  [HostLogSessionStatus.Declined]: PillTone.Danger,
  [HostLogSessionStatus.Ended]: PillTone.Neutral,
  [HostLogSessionStatus.Cancelled]: PillTone.Neutral,
  [HostLogSessionStatus.Expired]: PillTone.Neutral,
  [HostLogSessionStatus.Unavailable]: PillTone.Danger,
};

const LEVEL_LABELS: Record<HostLogSessionLevel, string> = {
  [HostLogSessionLevel.Info]: translationKey("Info"),
  [HostLogSessionLevel.Debug]: translationKey("Debug"),
  [HostLogSessionLevel.Verbose]: translationKey("Verbose"),
};

const LEVEL_DESCRIPTIONS: Record<HostLogSessionLevel, string> = {
  [HostLogSessionLevel.Info]: translationKey(
    "Info, warnings and errors. Enough for most problems.",
  ),
  [HostLogSessionLevel.Debug]: translationKey(
    "Adds debug lines. Many more lines.",
  ),
  [HostLogSessionLevel.Verbose]: translationKey(
    "Every line every app writes. Use it for a short session.",
  ),
};

const WAITING_FOR_DEVICE: string = translationKey(
  "The device picks it up the next time it checks, within a minute.",
);

const WAITING_FOR_APPROVAL: string = translationKey(
  "Someone at the device can allow it until {{time}}.",
);

const STARTING: string = translationKey(
  "Allowed on the device. Waiting for Android's prompt to be answered.",
);

const COLLECTING: string = translationKey(
  "Sending every app's logs until {{time}}.",
);

const LEVEL_AND_ABOVE: string = translationKey("{{level}} and above");

/*
 * Why a session ended, as the Android agent (LogSessionReason in
 * agents/AndroidAgent logsession/LogSessionManager.kt) and OneUptime
 * (AndroidAgentLogSessions) write it: each a key, so a reader sees it in
 * their language. A sentence not listed here is drawn as it came.
 */
export const KNOWN_STATUS_MESSAGES: ReadonlyArray<string> = [
  translationKey("Declined on the device."),
  translationKey(
    "Android's prompt to allow access to all device logs was declined.",
  ),
  translationKey(
    "Nobody answered Android's prompt to allow access to all device logs.",
  ),
  translationKey("Sent every app's logs for the time asked."),
  translationKey("Stopped on the device."),
  translationKey(
    "The agent or the device restarted, and Android's permission to read all device logs ended with it.",
  ),
  translationKey("Logcat stopped reading before the time was up."),
  translationKey("Logcat is switched off on this device (logcat_enabled)."),
  translationKey("READ_LOGS has not been granted on this device."),
  translationKey("Nobody at the device allowed it in time."),
  translationKey(
    "The device did not fetch it before it expired. It may be switched off or offline.",
  ),
  translationKey("The device stopped reporting before the session ended."),
  translationKey("Cancelled in OneUptime."),
];

// A key in the reader's language, or as written while it has none.
function tx(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

export default class HostLogSessionText {
  public static getStatusLabel(
    translator: Translator,
    status: HostLogSessionStatus | undefined,
  ): string {
    return tx(
      translator,
      STATUS_LABELS[status || HostLogSessionStatus.Requested] || "",
    );
  }

  public static getStatusTone(
    status: HostLogSessionStatus | undefined,
  ): PillTone {
    return STATUS_TONES[status || HostLogSessionStatus.Requested];
  }

  // The line under the status: what happens next, or why it ended.
  public static getStatusDetail(
    translator: Translator,
    session: HostLogSession,
  ): string | undefined {
    switch (session.status) {
      case HostLogSessionStatus.Requested:
        return tx(translator, WAITING_FOR_DEVICE);
      case HostLogSessionStatus.AwaitingApproval:
        return session.expiresAt
          ? translator.translateTemplate(WAITING_FOR_APPROVAL, {
              time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                session.expiresAt,
              ),
            })
          : undefined;
      case HostLogSessionStatus.Starting:
        return tx(translator, STARTING);
      case HostLogSessionStatus.Collecting:
        return session.endsAt
          ? translator.translateTemplate(COLLECTING, {
              time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                session.endsAt,
              ),
            })
          : undefined;
      default: {
        const message: string = (session.statusMessage || "").trim();

        if (!message) {
          return undefined;
        }

        return KNOWN_STATUS_MESSAGES.includes(message)
          ? tx(translator, message)
          : message;
      }
    }
  }

  public static getDurationLabel(
    translator: Translator,
    minutes: number,
  ): string {
    if (minutes >= 60 && minutes % 60 === 0) {
      return translator.translatePlural(
        { one: "{{count}} hour", other: "{{count}} hours" },
        minutes / 60,
      );
    }

    return translator.translatePlural(
      { one: "{{count}} minute", other: "{{count}} minutes" },
      minutes,
    );
  }

  public static getLevelLabel(
    translator: Translator,
    level: HostLogSessionLevel | undefined,
  ): string {
    return translator.translateTemplate(LEVEL_AND_ABOVE, {
      level: tx(
        translator,
        LEVEL_LABELS[level || HostLogSessionLevel.Info] || "",
      ),
    });
  }

  public static getDurationOptions(
    translator: Translator,
  ): Array<DropdownOption> {
    return HOST_LOG_SESSION_DURATIONS.map((minutes: number): DropdownOption => {
      return {
        value: minutes,
        label: HostLogSessionText.getDurationLabel(translator, minutes),
        isUserContent: true,
      };
    });
  }

  public static getLevelOptions(translator: Translator): Array<DropdownOption> {
    return Object.values(HostLogSessionLevel).map(
      (level: HostLogSessionLevel): DropdownOption => {
        return {
          value: level,
          label: tx(translator, LEVEL_LABELS[level] || ""),
          description: tx(translator, LEVEL_DESCRIPTIONS[level] || ""),
          isUserContent: true,
        };
      },
    );
  }

  // Whether a session sent lines, so there is something to show.
  public static hasLines(session: HostLogSession): boolean {
    return Boolean(session.startedAt);
  }
}
