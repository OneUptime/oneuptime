import {
  composedValue,
  createTranslator,
  getSentenceParts,
  getSentencePartsAndLanguage,
  PluralTemplate,
  SentencePart,
  TextLookup,
  translatableTerm,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { describe, expect, test } from "@jest/globals";

/*
 * A SENTENCE DRAWN ON A PAGE SETS ITS VALUES APART.
 *
 * In a Persian sentence a name in Latin letters is a left-to-right run, and
 * a number after it joins that run: "خوانده‌شده از داشبورد Meraki (Acme
 * Retail)، ۴ دقیقه پیش." drew the time's digit beside the name. Asked to
 * (SentenceOptions' setsValuesApart), the translator sets each value that
 * could move its neighbours apart in a Unicode isolate - and TranslatedSentence
 * and translateTemplateAround, which only ever draw their sentence, always
 * ask. Nothing else does: a sentence can become a record's name ("Page
 * Platform on-call"), and an isolate's marks are characters it would keep.
 */

type Dictionary = Record<string, string>;

const lookupFrom: (dictionary: Dictionary) => TextLookup = (
  dictionary: Dictionary,
): TextLookup => {
  return (text: string): string => {
    return dictionary[text] ?? text;
  };
};

const isolated: (value: string) => string = (value: string): string => {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
};

const READ_FROM: string =
  "Read from the Meraki dashboard ({{name}}), {{time}}.";
const PAGE: string = "Page {{policies}}";
const MATCHES: PluralTemplate = {
  one: "{{count}} more monitor matches.",
  other: "{{count}} more monitors match.",
};

const PERSIAN: Dictionary = {
  [READ_FROM]: "خوانده‌شده از داشبورد Meraki ({{name}})، {{time}}.",
  [PAGE]: "فراخواندن {{policies}}",
  [MATCHES.other]: "{{count}} مانیتور هم مطابقت دارد.",
  [`${MATCHES.other}_one`]: "{{count}} مانیتور هم مطابقت دارد.",
  Monitors: "مانیتورها",
  "{{field}} picks them": "{{field}} آنها را انتخاب می‌کند",
};

const GERMAN: Dictionary = {
  [READ_FROM]: "Aus dem Meraki-Dashboard ({{name}}) gelesen, {{time}}.",
  [PAGE]: "{{policies}} benachrichtigen",
};

const persian: Translator = createTranslator(lookupFrom(PERSIAN), "fa");
const german: Translator = createTranslator(lookupFrom(GERMAN), "de");
const english: Translator = createTranslator(undefined, "en");

describe("a sentence that may become data is filled as it always was", () => {
  test("a Persian sentence's values carry no marks unless asked", () => {
    expect(
      persian.translateTemplate(READ_FROM, {
        name: "Acme Retail",
        time: "۴ دقیقه پیش",
      }),
    ).toBe("خوانده‌شده از داشبورد Meraki (Acme Retail)، ۴ دقیقه پیش.");

    // A rule's name, as a new on-call rule is named.
    expect(
      persian.translateTemplate(PAGE, { policies: "Platform on-call" }),
    ).toBe("فراخواندن Platform on-call");
  });

  test("so does a count-dependent one", () => {
    expect(persian.translatePlural(MATCHES, 2)).toBe(
      "۲ مانیتور هم مطابقت دارد.",
    );
  });
});

describe("a sentence drawn on a page, in a language read right to left", () => {
  test("sets apart a name in Latin letters and the time after it", () => {
    const sentence: string = persian.translateTemplate(
      READ_FROM,
      { name: "Acme Retail", time: "۴ دقیقه پیش" },
      { setsValuesApart: true },
    );

    expect(sentence).toBe(
      `خوانده‌شده از داشبورد Meraki (${isolated("Acme Retail")})، ${isolated(
        "۴ دقیقه پیش",
      )}.`,
    );
  });

  test("sets apart a count", () => {
    expect(
      persian.translatePlural(MATCHES, 2, {}, { setsValuesApart: true }),
    ).toBe(`${isolated("۲")} مانیتور هم مطابقت دارد.`);
  });

  test("leaves a Persian word as it is: a translated term, a composed value", () => {
    expect(
      persian.translateTemplate(
        "{{field}} picks them",
        { field: translatableTerm("Monitors") },
        { setsValuesApart: true },
      ),
    ).toBe("مانیتورها آنها را انتخاب می‌کند");

    expect(
      persian.translateTemplate(
        "{{field}} picks them",
        {
          field: composedValue((sentence: Translator): string => {
            return sentence.translateText("Monitors") || "";
          }),
        },
        { setsValuesApart: true },
      ),
    ).toBe("مانیتورها آنها را انتخاب می‌کند");
  });

  test("an untranslated sentence is English: there a Persian name is set apart, an English one is not", () => {
    expect(
      persian.translateTemplate(
        "Assigned to {{name}}, {{time}}",
        { name: "سارا احمدی", time: "5 minutes ago" },
        { setsValuesApart: true },
      ),
    ).toBe(`Assigned to ${isolated("سارا احمدی")}, 5 minutes ago`);
  });
});

describe("a sentence drawn on a page, in a language read left to right", () => {
  test("German and English set apart only a name in a right-to-left script", () => {
    expect(
      german.translateTemplate(
        READ_FROM,
        { name: "Acme Retail", time: "vor 4 Minuten" },
        { setsValuesApart: true },
      ),
    ).toBe("Aus dem Meraki-Dashboard (Acme Retail) gelesen, vor 4 Minuten.");

    expect(
      english.translateTemplate(
        READ_FROM,
        { name: "فروشگاه تهران", time: "4 minutes ago" },
        { setsValuesApart: true },
      ),
    ).toBe(
      `Read from the Meraki dashboard (${isolated(
        "فروشگاه تهران",
      )}), 4 minutes ago.`,
    );
  });
});

describe("a sentence drawn in pieces (TranslatedSentence)", () => {
  test("sets its values apart, and its slots too when asked, in Persian", () => {
    const parts: Array<SentencePart> = getSentencePartsAndLanguage({
      translator: persian,
      template: READ_FROM,
      slots: ["name"],
      values: { time: "۴ دقیقه پیش" },
      setsSlotsApart: true,
    }).parts;

    expect(parts).toEqual([
      {
        kind: "text",
        text: `خوانده‌شده از داشبورد Meraki (${FIRST_STRONG_ISOLATE}`,
      },
      { kind: "slot", slot: "name" },
      {
        kind: "text",
        text: `${POP_DIRECTIONAL_ISOLATE})، ${isolated("۴ دقیقه پیش")}.`,
      },
    ]);
  });

  test("keeps its slots as they are when its pieces are boxes of their own", () => {
    const parts: Array<SentencePart> = getSentenceParts({
      translator: persian,
      template: READ_FROM,
      slots: ["name"],
      values: { time: "۴ دقیقه پیش" },
    });

    expect(parts).toEqual([
      { kind: "text", text: "خوانده‌شده از داشبورد Meraki (" },
      { kind: "slot", slot: "name" },
      { kind: "text", text: `)، ${isolated("۴ دقیقه پیش")}.` },
    ]);
  });

  test("never sets a slot apart in a sentence read left to right", () => {
    const parts: Array<SentencePart> = getSentencePartsAndLanguage({
      translator: german,
      template: READ_FROM,
      slots: ["name"],
      values: { time: "vor 4 Minuten" },
      setsSlotsApart: true,
    }).parts;

    expect(parts).toEqual([
      { kind: "text", text: "Aus dem Meraki-Dashboard (" },
      { kind: "slot", slot: "name" },
      { kind: "text", text: ") gelesen, vor 4 Minuten." },
    ]);
  });

  test("its English fallback sets apart a Persian value", () => {
    const parts: Array<SentencePart> = getSentenceParts({
      translator: english,
      template: "{{name}} took {{who}}",
      slots: ["name"],
      values: { who: "سارا" },
    });

    expect(parts).toEqual([
      { kind: "slot", slot: "name" },
      { kind: "text", text: ` took ${isolated("سارا")}` },
    ]);
  });
});
