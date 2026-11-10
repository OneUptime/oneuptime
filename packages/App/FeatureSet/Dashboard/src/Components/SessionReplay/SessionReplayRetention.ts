import {
  DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
  SESSION_REPLAY_ALLOWED_RETENTION_DAYS,
} from "Common/Types/Rum/SessionReplay";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  Translator,
} from "Common/Types/Translator";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * Without a translator the words below read in English, word for word, as
 * they always have; the Replay Policy page hands its reader's translator in.
 */
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A retention, as the read view and the Limits step's choices say it: "30 days".
const RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

/*
 * The Limits step's choices, in the reader's language: "7 days (default)",
 * "30 days". Each label is a whole phrase for its count, so a language says
 * "1 day" and "30 days" each its own way.
 */
export function getSessionReplayRetentionOptions(
  translator: Translator = ENGLISH,
): Array<DropdownOption> {
  return SESSION_REPLAY_ALLOWED_RETENTION_DAYS.map(
    (days: number): DropdownOption => {
      return {
        label:
          days === DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS
            ? translator.translatePlural(
                {
                  one: "{{count}} day (default)",
                  other: "{{count}} days (default)",
                },
                days,
              )
            : translator.translatePlural(RETENTION_DAYS, days),
        value: days,
      };
    },
  );
}

/*
 * How many days recordings are actually kept. The column is NOT NULL with a
 * default, so an unset value only shows up on a row read before it was
 * written; the server keeps such recordings for the default.
 */
export function getEffectiveSessionReplayRetentionDays(
  days: number | null | undefined,
): number {
  return typeof days === "number" && days > 0
    ? days
    : DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS;
}

// The read view's line: "30 days", or what an unset value falls back to.
export function formatSessionReplayRetention(
  days: number | undefined,
  translator: Translator = ENGLISH,
): string {
  if (!days) {
    return translator.translatePlural(
      {
        one: "not set (defaults to {{count}} day)",
        other: "not set (defaults to {{count}} days)",
      },
      DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS,
    );
  }

  return translator.translatePlural(RETENTION_DAYS, days);
}
