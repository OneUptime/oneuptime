import i18next from "i18next";

/*
 * Translating a sentence that has a value in it.
 *
 * Translation looks a string up by its English text, which works for fixed
 * copy and fails for "Are you sure you want to delete Notify on-call?": no
 * locale file can hold an entry for every name. Building the sentence from
 * translated pieces instead ("delete" + name + "?") reads the words out of
 * context and fixes English word order on every language.
 *
 * So the key is the whole English sentence with a {{placeholder}} for the
 * value - "Are you sure you want to delete {{name}}?" - and a locale maps it
 * to a whole sentence of its own that puts {{name}} where its grammar wants
 * it. Scripts/I18n/ValidateLocales.js checks that every translation keeps
 * every placeholder.
 *
 * Where i18next is not set up (a front end without locales, a unit test) the
 * English template is filled in directly, so a placeholder is never shown.
 */

export type TemplateValues = Record<string, string | number>;

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

/*
 * Fills {{key}} placeholders from values. A placeholder with no value is left
 * as it is, which a test notices and a reader at least recognises as a slot.
 */
export const fillTemplate: (
  template: string,
  values?: TemplateValues,
) => string = (template: string, values: TemplateValues = {}): string => {
  return template.replace(PLACEHOLDER, (match: string, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match;
  });
};

/*
 * The sentence in the reader's language, with its values filled in.
 */
export const translateTemplate: (
  template: string,
  values?: TemplateValues,
) => string = (template: string, values: TemplateValues = {}): string => {
  const english: string = fillTemplate(template, values);

  try {
    if (!i18next.isInitialized) {
      return english;
    }

    const translated: unknown = i18next.t(template, {
      defaultValue: template,
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
      ...values,
    });

    return typeof translated === "string" && translated.length > 0
      ? translated
      : english;
  } catch {
    return english;
  }
};

export interface TemplateAround {
  before: string;
  after: string;
}

/*
 * A marker no name contains, put where the slot goes so the translated
 * sentence can be cut around it.
 */
const SLOT_MARKER: string = "\u0000";

/*
 * The translated sentence cut in two around one {{slot}}, for a caller that
 * draws the slot's value itself - in bold, say - between the two halves.
 *
 * The value never goes through the translation: whatever a name contains
 * (braces, "$t(", markup), it is drawn as text by the caller.
 */
export const translateTemplateAround: (
  template: string,
  slot: string,
  values?: TemplateValues,
) => TemplateAround = (
  template: string,
  slot: string,
  values: TemplateValues = {},
): TemplateAround => {
  const withMarker: TemplateValues = { ...values, [slot]: SLOT_MARKER };

  const split: (sentence: string) => TemplateAround | null = (
    sentence: string,
  ): TemplateAround | null => {
    const parts: Array<string> = sentence.split(SLOT_MARKER);

    if (parts.length !== 2) {
      return null;
    }

    return { before: parts[0]!, after: parts[1]! };
  };

  /*
   * A translation that lost its slot, or repeated it, cannot be drawn with the
   * name in it - fall back to English rather than drop the name.
   */
  return (
    split(translateTemplate(template, withMarker)) ||
    split(fillTemplate(template, withMarker)) || {
      before: fillTemplate(template, values),
      after: "",
    }
  );
};
