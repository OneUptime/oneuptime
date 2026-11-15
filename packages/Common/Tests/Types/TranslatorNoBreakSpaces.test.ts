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
 * number held to its unit (Types/NoBreakSpaces). Only the language's own
 * wording is set: never a value, never an English sentence - English is
 * byte for byte as it always was. NB is U+00A0, NNB is U+202F.
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

  test("an English sentence left in the locale stays English, and the lookup still reads it as none", () => {
    expect(
      FRENCH.translateTemplate("Every {{minutes}} min", { minutes: 5 }),
    ).toBe("Every 5 min");
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

describe("English", () => {
  test("is byte for byte as it always was", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(
      english.translateTemplate("Every {{minutes}} min", { minutes: 5 }),
    ).toBe("Every 5 min");
    expect(
      english.translateTemplate("Uptime ({{hours}}h)", { hours: 24 }),
    ).toBe("Uptime (24h)");
    expect(english.translateText("Use only - _ . / : # (no spaces).")).toBe(
      "Use only - _ . / : # (no spaces).",
    );
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

  test("English, from the server, is as it always was", () => {
    expect(
      getServerTranslator("en").translateTemplate(
        "A new alert has been created: {{identifier}} in {{project}}. Click to view details.",
        { identifier: "#12", project: "Acme" },
      ),
    ).toBe("A new alert has been created: #12 in Acme. Click to view details.");
  });
});
