import {
  DeviceNamingOutcome,
  DeviceNamingResult,
} from "Common/Types/NetworkDevice/DeviceNaming";
import { MAX_DEVICE_NAME_LENGTH } from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { NamePlaceholder } from "Common/Utils/NetworkDevice/Naming/NamePattern";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the naming rules made of a device, in words (issue #6619): the
 * import's Choose step says it under a host's name, the Apply Naming Rules
 * dialog beside a device. One place, so both say it the same way and a test
 * holds every outcome and every placeholder to a sentence.
 */

/*
 * Why a rule could not name a device, by the value its pattern needed. Each
 * sentence says what to do about it, where something can be done.
 */
export const MISSING_VALUE_SENTENCES: Readonly<
  Record<NamePlaceholder, string>
> = {
  [NamePlaceholder.SiteCode]: translationKey(
    "Its site has no site code, or it is in no site. Add the code on the site's settings.",
  ),
  [NamePlaceholder.Site]: translationKey("It is in no site."),
  [NamePlaceholder.Lookup]: translationKey(
    "The rule's lookup table has no row for it.",
  ),
  [NamePlaceholder.MacAddress]: translationKey("Its MAC address is not known."),
  [NamePlaceholder.Vendor]: translationKey("Its vendor is not known."),
  [NamePlaceholder.DiscoveredName]: translationKey(
    "It has no discovered name.",
  ),
  [NamePlaceholder.IpAddress]: translationKey("It has no IP address."),
  [NamePlaceholder.IpOctet1]: translationKey("It has no IPv4 address."),
  [NamePlaceholder.IpOctet2]: translationKey("It has no IPv4 address."),
  [NamePlaceholder.IpOctet3]: translationKey("It has no IPv4 address."),
  [NamePlaceholder.IpOctet4]: translationKey("It has no IPv4 address."),
};

export const NAMING_SENTENCES: {
  readonly noRule: string;
  readonly missingValueFallback: string;
  readonly nameTaken: string;
  readonly nameTooLong: string;
} = {
  noRule: translationKey("No naming rule matches it."),
  missingValueFallback: translationKey(
    "A value the rule's name pattern needs is missing.",
  ),
  nameTaken: translationKey(
    'Another device is already named "{{name}}". Rename one of them, or add a number ({nn}) to the rule\'s name pattern.',
  ),
  nameTooLong: translationKey(
    "The name the rule gives it is longer than {{max}} characters.",
  ),
};

function readPlaceholder(value: string | undefined): NamePlaceholder | null {
  return Object.values(NamePlaceholder).includes(value as NamePlaceholder)
    ? (value as NamePlaceholder)
    : null;
}

/**
 * Why the rules did not name the device, in the reader's language, or null
 * when they did (or the device follows them).
 */
export function describeNamingProblem(
  result: DeviceNamingResult,
  translator: Translator,
): string | null {
  switch (result.outcome) {
    case DeviceNamingOutcome.NoMatchingRule:
      return (
        translator.translateText(NAMING_SENTENCES.noRule) ||
        NAMING_SENTENCES.noRule
      );
    case DeviceNamingOutcome.MissingValue: {
      const placeholder: NamePlaceholder | null = readPlaceholder(
        result.missing,
      );
      const sentence: string = placeholder
        ? MISSING_VALUE_SENTENCES[placeholder]
        : NAMING_SENTENCES.missingValueFallback;

      return translator.translateText(sentence) || sentence;
    }
    case DeviceNamingOutcome.NameTaken:
      return translator.translateTemplate(NAMING_SENTENCES.nameTaken, {
        name: result.takenName || result.name || "",
      });
    case DeviceNamingOutcome.NameTooLong:
      return translator.translateTemplate(NAMING_SENTENCES.nameTooLong, {
        max: translator.formatNumber(MAX_DEVICE_NAME_LENGTH),
      });
    default:
      return null;
  }
}

// True for an outcome a person should look at: a rule matched but could not name it.
export function isNamingProblem(result: DeviceNamingResult): boolean {
  return (
    result.outcome === DeviceNamingOutcome.MissingValue ||
    result.outcome === DeviceNamingOutcome.NameTaken ||
    result.outcome === DeviceNamingOutcome.NameTooLong
  );
}

/*
 * The server's reasons for leaving a device alone when renaming
 * (Types/NetworkDevice/DeviceNaming), as keys of the Dashboard's locales, so
 * the dialog's summary says them in the reader's language. A test holds the
 * list to the server's own words.
 */
export const NAMING_APPLY_TRANSLATED_REASONS: ReadonlyArray<string> = [
  translationKey("The device was deleted, or is no longer in this project."),
  translationKey(
    "The device was renamed since the preview, so it was left alone.",
  ),
  translationKey(
    "The naming rules give this device another name now. Preview again to see it.",
  ),
];
