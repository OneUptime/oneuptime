import { describe, expect, test } from "@jest/globals";
import { getServerTranslator } from "../../Server/Utils/ServerTranslation";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../Types/NoBreakSpaces";
import {
  createTranslator,
  getSentenceLanguage,
  getSentenceParts,
  SentencePart,
  translatableTerm,
  Translator,
} from "../../Types/Translator";
import { toGsm7Message } from "../../Utils/Sms/Gsm7Text";
import writeDefaultSubscriberSms from "../../Utils/Sms/SubscriberSms";
import { dashboardTranslator } from "../Helpers/DashboardLocales";

/*
 * THE TRANSLATOR SETS A LANGUAGE'S OWN WORDS AS IT SETS A LINE (#8032,
 * #8043).
 *
 * Every sentence a component, a page or the server fills through the
 * Translator comes out with French's marks held to their words and each
 * number held to its unit (Types/NoBreakSpaces). Only OneUptime's own words
 * are set: never a value. English's templates are set too (#8302): "Every
 * 5 min" broke as "Every 5" over "min" on a narrow pill; an English text
 * that no locale words (translateText) may be a value, and is left as it
 * is. NB is U+00A0, NNB is U+202F.
 */

const NB: string = NO_BREAK_SPACE;
const NNB: string = NARROW_NO_BREAK_SPACE;

// A translator reading `words`, in `language`.
function translatorOf(
  language: string,
  words: Record<string, string>,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return Object.prototype.hasOwnProperty.call(words, text)
      ? words[text]
      : undefined;
  }, language);
}

const FRENCH: Translator = translatorOf("fr", {
  "Delete {{name}}?": "Supprimer « {{name}} » ?",
  "Archive {{count}} workflows?": "Archiver {{count}} flux de travail ?",
  "Archive {{count}} workflows?_one": "Archiver {{count}} flux de travail ?",
  "Step {{number}}: {{fields}}": "Étape {{number}} : {{fields}}",
  "Are you sure?": "Êtes-vous sûr ?",
  Status: "Statut :",
  "Uptime ({{hours}}h)": "Disponibilité ({{hours}} h)",
  "Last 24h": "Dernières 24 h",
  "Every {{minutes}} min": "Every {{minutes}} min",
});

describe("a French reader's sentences", () => {
  test("a template: its marks held to their words, its value as written", () => {
    expect(FRENCH.translateTemplate("Delete {{name}}?", { name: "API" })).toBe(
      `Supprimer «${NB}API${NB}»${NNB}?`,
    );
    expect(
      FRENCH.translateTemplate("Step {{number}}: {{fields}}", {
        number: 2,
        fields: "Cible",
      }),
    ).toBe(`Étape 2${NB}: Cible`);
  });

  test("a value is never set: a name with French's marks in it goes in as written", () => {
    expect(
      FRENCH.translateTemplate("Delete {{name}}?", { name: "Prod : EU ?" }),
    ).toBe(`Supprimer «${NB}Prod : EU ?${NB}»${NNB}?`);
  });

  test("a plural, in each of its forms", () => {
    const plural: { one: string; other: string } = {
      one: "Archive {{count}} workflow?",
      other: "Archive {{count}} workflows?",
    };

    expect(FRENCH.translatePlural(plural, 3)).toBe(
      `Archiver 3 flux de travail${NNB}?`,
    );
    expect(FRENCH.translatePlural(plural, 1)).toBe(
      `Archiver 1 flux de travail${NNB}?`,
    );
  });

  test("a fixed text, and a word", () => {
    expect(FRENCH.translateText("Are you sure?")).toBe(`Êtes-vous sûr${NNB}?`);
    expect(FRENCH.translateTerm("Status")).toBe(`Statut${NB}:`);
  });

  test("a text with no French wording is as it is: it may be a value", () => {
    expect(FRENCH.translateText("Use only - _ . / : # here")).toBe(
      "Use only - _ . / : # here",
    );
    expect(FRENCH.translateTerm("Monitor : EU")).toBe("Monitor : EU");
  });

  test("its numbers stay with their units", () => {
    expect(FRENCH.translateTemplate("Uptime ({{hours}}h)", { hours: 24 })).toBe(
      `Disponibilité (24${NB}h)`,
    );
    expect(FRENCH.translateText("Last 24h")).toBe(`Dernières 24${NB}h`);
  });

  test("an English sentence left in the locale stays English, its number held to its unit, and the lookup still reads it as none", () => {
    expect(
      FRENCH.translateTemplate("Every {{minutes}} min", { minutes: 5 }),
    ).toBe(`Every 5${NB}min`);
    expect(FRENCH.hasTranslation("Every {{minutes}} min")).toBe(false);
  });

  test("setting its words changes nothing about which language a sentence is in", () => {
    expect(FRENCH.hasTranslation("Delete {{name}}?")).toBe(true);
    expect(getSentenceLanguage(FRENCH, "Delete {{name}}?")).toBe("fr");
    expect(getSentenceLanguage(FRENCH, "Not worded {{x}} ?")).toBe("en");
  });

  test("a term in the sentence is translated and the marks around it held", () => {
    const translator: Translator = translatorOf("fr", {
      "Delete {{name}}?": "Supprimer « {{name}} » ?",
      monitor: "moniteur",
    });

    expect(
      translator.translateTemplate("Delete {{name}}?", {
        name: translatableTerm("monitor"),
      }),
    ).toBe(`Supprimer «${NB}moniteur${NB}»${NNB}?`);
  });

  test("a sentence drawn around a slot: each piece holds its marks", () => {
    const parts: Array<SentencePart> = getSentenceParts({
      translator: FRENCH,
      template: "Delete {{name}}?",
      slots: ["name"],
    });

    expect(parts).toEqual([
      { kind: "text", text: `Supprimer «${NB}` },
      { kind: "slot", slot: "name" },
      { kind: "text", text: `${NB}»${NNB}?` },
    ]);
  });
});

describe("another language's sentences", () => {
  test("a number with its unit, and the language's own punctuation as written", () => {
    const german: Translator = translatorOf("de", {
      "Uptime ({{hours}}h)": "Verfügbarkeit ({{hours}} Std.)",
      "Really?": "Wirklich ?",
    });

    expect(german.translateTemplate("Uptime ({{hours}}h)", { hours: 24 })).toBe(
      `Verfügbarkeit (24${NB}Std.)`,
    );
    // Only French sets its marks apart: anything else is as its locale wrote it.
    expect(german.translateText("Really?")).toBe("Wirklich ?");
  });

  test("Persian: its separator, and its number with its unit", () => {
    const persian: Translator = translatorOf("fa", {
      "Uptime ({{days}}d)": "زمان کارکرد ({{days}} روز)",
    });

    expect(persian.translateTemplate("Uptime ({{days}}d)", { days: 30 })).toBe(
      `زمان کارکرد (30${NB}روز)`,
    );
  });

  test("a sentence whose values are set apart, as a page draws it", () => {
    const arabic: Translator = translatorOf("ar", {
      "Uptime ({{hours}}h)": "وقت التشغيل ({{hours}} س)",
    });
    const drawn: string = arabic.translateTemplate(
      "Uptime ({{hours}}h)",
      { hours: "24" },
      { setsValuesApart: true },
    );

    expect(drawn).toContain(`${NB}س)`);
    expect(drawn).not.toMatch(/24\u2069? س/);
  });
});

describe("English (#8302)", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("a template's number keeps the unit it is written beside with a space", () => {
    expect(
      english.translateTemplate("Every {{minutes}} min", { minutes: 5 }),
    ).toBe(`Every 5${NB}min`);
    expect(english.translateTemplate("{{value}} ms", { value: "1,234" })).toBe(
      `1,234${NB}ms`,
    );
    expect(
      english.translateTemplate(
        "Latest: {{median}} ms median across {{count}} probes ({{min}}–{{max}} ms)",
        { median: 182, count: 3, min: 120, max: 240 },
      ),
    ).toBe(`Latest: 182${NB}ms median across 3 probes (120–240${NB}ms)`);
  });

  test("a number written in the template, and one written with no space, are as before", () => {
    expect(
      english.translateTemplate("Choose a JSON file smaller than 10 MB."),
    ).toBe(`Choose a JSON file smaller than 10${NB}MB.`);
    expect(
      english.translateTemplate("Uptime ({{hours}}h)", { hours: 24 }),
    ).toBe("Uptime (24h)");
    expect(english.translateTemplate("{{percent}}%", { percent: 12 })).toBe(
      "12%",
    );
  });

  test("a plural, in each of its forms", () => {
    const plural: { one: string; other: string } = {
      one: "Runs every {{count}} min",
      other: "Runs every {{count}} min",
    };

    expect(english.translatePlural(plural, 1)).toBe(`Runs every 1${NB}min`);
    expect(english.translatePlural(plural, 1500)).toBe(
      `Runs every 1,500${NB}min`,
    );
  });

  test("a word after a number, a value, and an untranslated text are left as they are", () => {
    expect(english.translateTemplate("{{count}} minutes", { count: 5 })).toBe(
      "5 minutes",
    );
    // A value goes in as written: a monitor named "Every 5 min".
    expect(
      english.translateTemplate("Monitor {{name}}", { name: "Every 5 min" }),
    ).toBe("Monitor Every 5 min");
    // translateText of a text no locale words may be a value too.
    expect(english.translateText("Every 5 min")).toBe("Every 5 min");
    expect(english.translateText("Use only - _ . / : # (no spaces).")).toBe(
      "Use only - _ . / : # (no spaces).",
    );
  });

  test("a sentence whose values are set apart, as a page draws it", () => {
    expect(
      english.translateTemplate(
        "Every {{minutes}} min",
        { minutes: 5 },
        { setsValuesApart: true },
      ),
    ).toBe(`Every 5${NB}min`);
  });

  test("the same sentence in each language, through the Dashboard's own locales", () => {
    const drawn: Record<string, string> = {};

    for (const language of ["en", "de", "fr", "ar", "fa"]) {
      drawn[language] = dashboardTranslator(language).translateTemplate(
        "{{value}} ms",
        { value: "411" },
      );
    }

    expect(drawn).toEqual({
      en: `411${NB}ms`,
      de: `411${NB}ms`,
      fr: `411${NB}ms`,
      ar: `411${NB}ملي${NB}ث`,
      fa: `411${NB}میلی\u200Cثانیه`,
    });

    for (const text of Object.values(drawn)) {
      expect(text).not.toMatch(/[ \u2000-\u2006\u2008-\u200A\u205F]/);
    }
  });
});

describe("the Dashboard's own French, through the Translator", () => {
  const french: Translator = dashboardTranslator("fr");

  test("the empty Archived Workflows page's message (#8032)", () => {
    expect(
      french.translateText(
        "No archived workflows. To archive one, select it in the Workflows list and choose Archive, or open its Settings.",
      ),
    ).toBe(
      `Aucun flux de travail archivé. Pour en archiver un, sélectionnez-le dans la liste «${NB}Flux de travail${NB}» et choisissez «${NB}Archiver${NB}», ou ouvrez sa page Paramètres.`,
    );
  });

  test("a question", () => {
    expect(french.translateText("Are you sure?")).toBe(`Êtes-vous sûr${NNB}?`);
  });
});

describe("the server's French", () => {
  const french: Translator = getServerTranslator("fr");

  test("a push notification's sentence holds its colon", () => {
    expect(
      french.translateTemplate(
        "A new alert has been created: {{identifier}} in {{project}}. Click to view details.",
        { identifier: "#12", project: "Acme" },
      ),
    ).toBe(
      `Nouvelle alerte${NB}: #12 dans Acme. Touchez pour voir les détails.`,
    );
  });

  test("an SMS still goes out in GSM-7's characters: each no-break space is a space there", () => {
    const sentence: string = french.translateText(
      "A new note has been added to the incident. Here are the details:",
    ) as string;

    expect(sentence).toContain(`détails${NB}:`);
    expect(toGsm7Message(`Quoi${NNB}? «${NB}x${NB}»`)).toBe('Quoi ? " x "');
    // é and à are GSM-7's own; a no-break space is not, and goes out as a space.
    expect(writeDefaultSubscriberSms(sentence)).toBe(
      "Une nouvelle note a été ajoutée à l'incident. Voici les détails :",
    );
  });

  test("English, from the server, is as it always was where it writes no unit", () => {
    expect(
      getServerTranslator("en").translateTemplate(
        "A new alert has been created: {{identifier}} in {{project}}. Click to view details.",
        { identifier: "#12", project: "Acme" },
      ),
    ).toBe("A new alert has been created: #12 in Acme. Click to view details.");
  });

  test("English, from the server, keeps a number with its unit, and an SMS still goes out in GSM-7", () => {
    const sentence: string = getServerTranslator("en").translateTemplate(
      "Response Time (in ms) was {{value}} ms",
      { value: 411 },
    );

    expect(sentence).toBe(`Response Time (in ms) was 411${NB}ms`);
    expect(toGsm7Message(sentence)).toBe("Response Time (in ms) was 411 ms");
  });
});
