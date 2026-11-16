import {
  DATA_CHECK_FORMATS,
  DataCheckFormat,
} from "Common/Types/DataObservability/DataCheckFormats";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE FORMATS A FORMAT MISMATCH CHECK OFFERS, IN THE READER'S WORDS (#7532).
 *
 * A format is stored as its English name ("Country Code"), and the Format
 * dropdown was built from those values, which it looks up as they are:
 * "ISO Date" was no key at all, so it read English in every language, and
 * "Country Code" was left English in eleven. Each format has its name here
 * now, a key every language words; UUID and URL are written as they are in
 * every language (i18n/SameAsEnglish.json). What is saved, and what a checks
 * file writes (`format: ISO Date`), stay the English value.
 *
 * React-free, beside DataCheckTypeWords: App's tests read it without React.
 */
export const DATA_CHECK_FORMAT_LABELS: Readonly<
  Record<DataCheckFormat, string>
> = {
  [DataCheckFormat.Email]: translationKey("Email"),
  [DataCheckFormat.Uuid]: translationKey("UUID"),
  [DataCheckFormat.CountryCode]: translationKey("Country Code"),
  [DataCheckFormat.Url]: translationKey("URL"),
  [DataCheckFormat.IpAddress]: translationKey("IP Address"),
  [DataCheckFormat.IsoDate]: translationKey("ISO Date"),
  [DataCheckFormat.PhoneNumber]: translationKey("Phone Number"),
  [DataCheckFormat.Custom]: translationKey("Custom"),
};

/*
 * A format as the reader reads it: "ISO-Datum" for ISO Date on a German
 * page. A value that is no format a check has is drawn as it is.
 */
export function getDataCheckFormatLabel(data: {
  translator: Translator;
  format: string | null | undefined;
}): string {
  const value: string = data.format || "";
  const label: string | undefined = Object.prototype.hasOwnProperty.call(
    DATA_CHECK_FORMAT_LABELS,
    value,
  )
    ? DATA_CHECK_FORMAT_LABELS[value as DataCheckFormat]
    : undefined;

  if (!label) {
    return value;
  }

  return data.translator.translateText(label) || label;
}

/*
 * The Format dropdown: every format, each by its name, its value what is
 * saved. The dropdown looks each label up in the reader's language.
 */
export const DATA_CHECK_FORMAT_OPTIONS: Array<DropdownOption> =
  DATA_CHECK_FORMATS.map((format: DataCheckFormat): DropdownOption => {
    return { value: format, label: DATA_CHECK_FORMAT_LABELS[format] };
  });
