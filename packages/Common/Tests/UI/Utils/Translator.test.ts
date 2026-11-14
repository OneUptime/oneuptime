import {
  composedValue,
  createTranslator,
  fillTemplate,
  getPluralCategory,
  isComposedValue,
  isOneFormOnlyForOne,
  isTranslatableTerm,
  PluralTemplate,
  TextLookup,
  toLabelTerm,
  toSentenceTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * The translator every shared component and utility uses to put a string on
 * the screen: fixed strings, whole sentences with {{placeholders}},
 * count-dependent sentences, and model names inside a sentence.
 *
 * These run it against plain dictionaries shaped the way the Dashboard's
 * locale files are (the English text is the key, a sentence's one form lives
 * under the key plus "_one"). The Russian one also has i18next's "_few" and
 * "_many" forms, which the translator reads when a dictionary has them. A
 * lookup answers with the key itself when it has nothing, exactly as
 * useTranslateValue().translateString does.
 */

type Dictionary = Record<string, string>;

const lookupFrom: (...dictionaries: Array<Dictionary>) => TextLookup = (
  ...dictionaries: Array<Dictionary>
): TextLookup => {
  return (text: string): string => {
    for (const dictionary of dictionaries) {
      if (dictionary[text] !== undefined) {
        return dictionary[text] as string;
      }
    }

    return text;
  };
};

const ROWS: PluralTemplate = {
  one: "{{count}} row",
  other: "{{count}} rows",
};

const SHOWING: PluralTemplate = {
  one: "Showing {{range}} of {{total}} {{itemName}}",
  other: "Showing {{range}} of {{total}} {{itemsName}}",
};

// What en.json holds for the templates above: the key maps to itself.
const ENGLISH: Dictionary = {
  [ROWS.other]: ROWS.other,
  [`${ROWS.other}_one`]: ROWS.one,
  [SHOWING.other]: SHOWING.other,
  [`${SHOWING.other}_one`]: SHOWING.one,
  "Create {{itemName}}": "Create {{itemName}}",
  "Incident Grouping Rule": "Incident Grouping Rule",
  Incidents: "Incidents",
};

const GERMAN: Dictionary = {
  [ROWS.other]: "{{count}} Zeilen",
  [`${ROWS.other}_one`]: "{{count}} Zeile",
  [SHOWING.other]: "{{range}} von {{total}} {{itemsName}}",
  [`${SHOWING.other}_one`]: "{{range}} von {{total}} {{itemName}}",
  "Create {{itemName}}": "{{itemName}} erstellen",
  "No {{itemsName}} yet.": "Noch keine {{itemsName}}.",
  "Incident Grouping Rule": "Vorfall-Gruppierungsregel",
  Incidents: "Vorfälle",
  Incident: "Vorfall",
};

const RUSSIAN: Dictionary = {
  [ROWS.other]: "{{count}} строки",
  [`${ROWS.other}_one`]: "{{count}} строка",
  [`${ROWS.other}_few`]: "{{count}} строки",
  [`${ROWS.other}_many`]: "{{count}} строк",
  Incidents: "Инциденты",
  "No {{itemsName}} yet.": "Пока нет: {{itemsName}}.",
};

const JAPANESE: Dictionary = {
  [ROWS.other]: "{{count}} 行",
  [`${ROWS.other}_one`]: "{{count}} 行",
};

// A locale file that still carries English placeholders for the sentence.
const FRENCH_UNTRANSLATED: Dictionary = {
  [ROWS.other]: ROWS.other,
  [`${ROWS.other}_one`]: ROWS.one,
  Incidents: "Incidents",
};

const english: Translator = createTranslator(lookupFrom(ENGLISH), "en");
const german: Translator = createTranslator(lookupFrom(GERMAN, ENGLISH), "de");
const russian: Translator = createTranslator(
  lookupFrom(RUSSIAN, ENGLISH),
  "ru",
);
const japanese: Translator = createTranslator(
  lookupFrom(JAPANESE, ENGLISH),
  "ja",
);
const frenchPlaceholders: Translator = createTranslator(
  lookupFrom(FRENCH_UNTRANSLATED, ENGLISH),
  "fr",
);
const nothingSetUp: Translator = createTranslator(undefined, undefined);

describe("translatableTerm and translationKey", () => {
  test("a term carries its English text and whether it sits in a sentence", () => {
    expect(translatableTerm("Incidents")).toEqual({
      translatableTerm: "Incidents",
      inSentence: false,
    });
    expect(translatableTerm("Incidents", { inSentence: true })).toEqual({
      translatableTerm: "Incidents",
      inSentence: true,
    });
  });

  test("isTranslatableTerm tells a term from plain values", () => {
    expect(isTranslatableTerm(translatableTerm("x"))).toBe(true);
    expect(isTranslatableTerm("x")).toBe(false);
    expect(isTranslatableTerm(3)).toBe(false);
    expect(isTranslatableTerm(null)).toBe(false);
    expect(isTranslatableTerm(undefined)).toBe(false);
    expect(isTranslatableTerm({ translatableTerm: 4 })).toBe(false);
  });

  test("translationKey hands its text back unchanged", () => {
    expect(translationKey("Create {{itemName}}")).toBe("Create {{itemName}}");
  });
});

describe("toSentenceTerm", () => {
  test.each([
    ["Monitors", "en", "monitors"],
    ["On-Call Duty Policies", "en", "on-call duty policies"],
    ["API Keys", "en", "API keys"],
    ["SLOs", "en", "SLOs"],
    ["GitHub Repositories", "en", "GitHub repositories"],
    ["IoT Devices", "en", "IoT devices"],
    ["Kubernetes Clusters", "en", "Kubernetes clusters"],
    ["AWS Account", "en", "AWS account"],
    ["Azure Subscription", "en", "Azure subscription"],
    ["Google Cloud Project", "en", "Google Cloud project"],
    // Only after "Google" is "Cloud" a name.
    ["Cloud Resources", "en", "cloud resources"],
    ["Cloud Google", "en", "cloud Google"],
    // Notification methods named in a sentence ("Remove this ... method?").
    ["Microsoft Teams", "en", "Microsoft Teams"],
    ["Mattermost", "en", "Mattermost"],
    ["Phone call", "en", "phone call"],
    ["Push notification", "en", "push notification"],
    // Only after "Microsoft" is "Teams" a name.
    ["Teams", "en", "teams"],
    // ... alone or as a compound's first part.
    ["Google Cloud-projekt", "da", "Google Cloud-projekt"],
    ["Google Cloud-project", "nl", "Google Cloud-project"],
    ["Projekt i Google Cloud", "sv", "projekt i Google Cloud"],
    [
      "Incident Episode State Timeline",
      "en",
      "incident episode state timeline",
    ],
    ["  Status    Pages  ", "en", "status pages"],
    ["Règles De Groupement", "fr", "règles de groupement"],
    ["Инциденты", "ru", "инциденты"],
    ["Vorfälle", "de", "Vorfälle"],
    ["Vorfall-Gruppierungsregeln", "de-AT", "Vorfall-Gruppierungsregeln"],
    ["インシデント", "ja", "インシデント"],
  ])(
    "%s in %s reads %s mid-sentence",
    (label: string, language: string, expected: string) => {
      expect(toSentenceTerm(label, language)).toBe(expected);
    },
  );

  test("an empty or blank label stays empty", () => {
    expect(toSentenceTerm("", "en")).toBe("");
    expect(toSentenceTerm("   ")).toBe("");
  });

  test("an unknown language code still lower-cases", () => {
    expect(toSentenceTerm("Status Pages", "not-a-language-code!!")).toBe(
      "status pages",
    );
  });
});

/*
 * A name the locale words for the middle of a sentence ("clúster de
 * Kubernetes"), drawn where it starts a label: a row, a chip, a line.
 */
describe("toLabelTerm", () => {
  test.each([
    // The Template sync settings card's infrastructure rows (#7607).
    ["clúster de Kubernetes", "es", "Clúster de Kubernetes"],
    ["cluster Kubernetes", "fr", "Cluster Kubernetes"],
    ["hôte Docker", "fr", "Hôte Docker"],
    ["host Docker", "it", "Host Docker"],
    ["cluster Kubernetes", "pt", "Cluster Kubernetes"],
    ["кластер Kubernetes", "ru", "Кластер Kubernetes"],
    ["облако OpenStack", "ru", "Облако OpenStack"],
    ["nube OpenStack", "es", "Nube OpenStack"],
    // Upper-cased the way the language writes a capital.
    ["istanbul", "tr", "İstanbul"],
    ["istanbul", "en", "Istanbul"],
    // Already a capital: a German noun, a compound, an English label.
    ["Kubernetes-Cluster", "de", "Kubernetes-Cluster"],
    ["Docker-хост", "ru", "Docker-хост"],
    ["Kubernetes cluster", "en", "Kubernetes cluster"],
    // A script without case reads the same.
    ["ホスト", "ja", "ホスト"],
    ["호스트", "ko", "호스트"],
    ["主机", "zh-CN", "主机"],
    ["主機", "zh-TW", "主機"],
    ["होस्ट", "hi", "होस्ट"],
    ["خوشه Kubernetes", "fa", "خوشه Kubernetes"],
    ["عنقود Kubernetes", "ar", "عنقود Kubernetes"],
    // A first word that keeps its own case.
    ["vCenter archivados", "es", "vCenter archivados"],
    ["iOS", "en", "iOS"],
    ["eBPF-Programme", "de", "eBPF-Programme"],
    // Only the first word's case is the label's to change.
    ["e-mail del proyecto", "es", "E-mail del proyecto"],
    // Anything but a letter first.
    ["3 réplicas", "es", "3 réplicas"],
    ["(sin nombre)", "es", "(sin nombre)"],
    [" clúster", "es", " clúster"],
  ])(
    "%s in %s starts a label as %s",
    (text: string, language: string, expected: string) => {
      expect(toLabelTerm(text, language)).toBe(expected);
    },
  );

  test("an empty text stays empty", () => {
    expect(toLabelTerm("", "es")).toBe("");
  });

  test("without a language, or with one that is not a code, it still capitalizes", () => {
    expect(toLabelTerm("clúster de Kubernetes")).toBe("Clúster de Kubernetes");
    expect(toLabelTerm("clúster de Kubernetes", "not-a-language-code!!")).toBe(
      "Clúster de Kubernetes",
    );
  });

  test("it undoes nothing toSentenceTerm keeps", () => {
    expect(toLabelTerm(toSentenceTerm("Kubernetes Clusters", "en"), "en")).toBe(
      "Kubernetes clusters",
    );
    expect(toLabelTerm(toSentenceTerm("Monitors", "en"), "en")).toBe(
      "Monitors",
    );
  });
});

describe("getPluralCategory", () => {
  test.each([
    ["en", 1, "one"],
    ["en", 0, "other"],
    ["en", 2, "other"],
    ["ru", 1, "one"],
    ["ru", 3, "few"],
    ["ru", 5, "many"],
    ["ru", 21, "one"],
    ["ja", 1, "other"],
    ["fr", 0, "one"],
  ])("%s %d is %s", (language: string, count: number, category: string) => {
    expect(getPluralCategory(language, count)).toBe(category);
  });

  test("falls back to the English rule for a code Intl rejects", () => {
    expect(getPluralCategory("!!", 1)).toBe("one");
    expect(getPluralCategory("!!", 4)).toBe("other");
  });
});

describe("translateText", () => {
  test("answers with the stored wording", () => {
    expect(german.translateText("Incidents")).toBe("Vorfälle");
  });

  test("answers with the text itself when nothing has it", () => {
    expect(german.translateText("Rows per page")).toBe("Rows per page");
    expect(nothingSetUp.translateText("Rows per page")).toBe("Rows per page");
  });

  test("leaves undefined and empty strings alone", () => {
    expect(german.translateText(undefined)).toBeUndefined();
    expect(german.translateText("")).toBe("");
  });

  test("an empty stored value never blanks the text", () => {
    const blank: Translator = createTranslator(lookupFrom({ Save: "" }), "de");

    expect(blank.translateText("Save")).toBe("Save");
  });

  test("a lookup that throws is treated as no translation", () => {
    const broken: Translator = createTranslator((): string => {
      throw new Error("boom");
    }, "de");

    expect(broken.translateText("Save")).toBe("Save");
    expect(
      broken.translateTemplate("Create {{itemName}}", { itemName: "X" }),
    ).toBe("Create X");
  });
});

describe("hasTranslation", () => {
  test("is true only for a wording that differs from the English", () => {
    expect(german.hasTranslation("Incidents")).toBe(true);
    expect(english.hasTranslation("Incidents")).toBe(false);
    expect(frenchPlaceholders.hasTranslation("Incidents")).toBe(false);
    expect(nothingSetUp.hasTranslation("Incidents")).toBe(false);
    expect(german.hasTranslation("")).toBe(false);
  });
});

describe("translateTerm", () => {
  test("translates a name and keeps its casing when it stands alone", () => {
    expect(german.translateTerm("Incidents")).toBe("Vorfälle");
    expect(english.translateTerm(" Incidents ")).toBe("Incidents");
  });

  test("cases a translated name for the reader's language mid-sentence", () => {
    expect(german.translateTerm("Incidents", { inSentence: true })).toBe(
      "Vorfälle",
    );
    expect(russian.translateTerm("Incidents", { inSentence: true })).toBe(
      "инциденты",
    );
  });

  /*
   * German writes "Labels" and "Monitor" as English does, so the locale holds
   * them unchanged - and they keep their capital, as German nouns do.
   */
  test("a name spelled the same in the reader's language is cased its way", () => {
    expect(german.translateTerm("Labels", { inSentence: true })).toBe("Labels");
    expect(german.translateTerm("API Keys", { inSentence: true })).toBe(
      "API Keys",
    );
    expect(
      frenchPlaceholders.translateTerm("API Keys", { inSentence: true }),
    ).toBe("API keys");
    expect(english.translateTerm("API Keys", { inSentence: true })).toBe(
      "API keys",
    );
  });

  test("a translated German sentence keeps the capital of a noun German shares with English", () => {
    expect(
      german.translateTemplate("No {{itemsName}} yet.", {
        itemsName: translatableTerm("Labels", { inSentence: true }),
      }),
    ).toBe("Noch keine Labels.");
  });

  test("an empty name is an empty string", () => {
    expect(german.translateTerm(undefined)).toBe("");
    expect(german.translateTerm("")).toBe("");
  });
});

describe("translateTemplate", () => {
  test("fills the translated sentence, with the term translated too", () => {
    expect(
      german.translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Incident Grouping Rule"),
      }),
    ).toBe("Vorfall-Gruppierungsregel erstellen");
  });

  test("English fills the English sentence with the English term", () => {
    expect(
      english.translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Incident Grouping Rule"),
      }),
    ).toBe("Create Incident Grouping Rule");
  });

  /*
   * The sentence is wholly English or wholly translated: a locale without
   * the sentence does not get English words around its own word for the
   * name.
   */
  test("a sentence the locale lacks stays wholly English, name included", () => {
    expect(
      russian.translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Incidents"),
      }),
    ).toBe("Create Incidents");
  });

  test("a translated sentence with an untranslated term keeps the English term", () => {
    expect(
      russian.translateTemplate("No {{itemsName}} yet.", {
        itemsName: translatableTerm("Status Pages", { inSentence: true }),
      }),
    ).toBe("Пока нет: status pages.");
  });

  test("plain values go in literally and are never translated", () => {
    expect(
      german.translateTemplate("Create {{itemName}}", {
        itemName: "Incidents",
      }),
    ).toBe("Incidents erstellen");
    expect(
      german.translateTemplate("Create {{itemName}}", {
        itemName: "{{itemName}} $t(x)",
      }),
    ).toBe("{{itemName}} $t(x) erstellen");
  });

  test("numbers go in as text", () => {
    expect(english.translateTemplate("Page {{page}}", { page: 3 })).toBe(
      "Page 3",
    );
  });

  test("a placeholder with no value is left showing", () => {
    expect(german.translateTemplate("Create {{itemName}}")).toBe(
      "{{itemName}} erstellen",
    );
  });

  test("without any translation set up the English sentence is filled", () => {
    expect(
      nothingSetUp.translateTemplate("Create {{itemName}}", {
        itemName: translatableTerm("Monitor"),
      }),
    ).toBe("Create Monitor");
  });
});

describe("translatePlural", () => {
  test("English picks one or other by the count", () => {
    expect(english.translatePlural(ROWS, 1)).toBe("1 row");
    expect(english.translatePlural(ROWS, 0)).toBe("0 rows");
    expect(english.translatePlural(ROWS, 2)).toBe("2 rows");
  });

  test("writes the count the reader's way", () => {
    expect(english.translatePlural(ROWS, 1234)).toBe("1,234 rows");
    expect(german.translatePlural(ROWS, 1234)).toBe("1.234 Zeilen");
  });

  test("German uses its own one and other forms", () => {
    expect(german.translatePlural(ROWS, 1)).toBe("1 Zeile");
    expect(german.translatePlural(ROWS, 7)).toBe("7 Zeilen");
  });

  test.each([
    [1, "1 строка"],
    [3, "3 строки"],
    [5, "5 строк"],
    [21, "21 строка"],
    [22, "22 строки"],
    [1.5, "1,5 строки"],
  ])(
    "Russian picks the CLDR form for %d",
    (count: number, expected: string) => {
      expect(russian.translatePlural(ROWS, count)).toBe(expected);
    },
  );

  test("a language with one form uses the key's own wording for every count", () => {
    expect(japanese.translatePlural(ROWS, 1)).toBe("1 行");
    expect(japanese.translatePlural(ROWS, 3)).toBe("3 行");
  });

  test("a missing category falls back to the language's general form", () => {
    const russianWithoutMany: Translator = createTranslator(
      lookupFrom({ [ROWS.other]: "{{count}} строки" }, ENGLISH),
      "ru",
    );

    expect(russianWithoutMany.translatePlural(ROWS, 5)).toBe("5 строки");
  });

  test("English placeholders in a locale give the English sentence", () => {
    expect(frenchPlaceholders.translatePlural(ROWS, 1)).toBe("1 row");
    expect(frenchPlaceholders.translatePlural(ROWS, 2)).toBe("2 rows");
  });

  /*
   * French counts 0 as "one", Russian counts 21 as "one": with the English
   * placeholder still in the "_one" key, the sentence is English and takes
   * English's form for the count.
   */
  test("an English one form left in a locale never puts other counts in the singular", () => {
    const russianPlaceholders: Translator = createTranslator(
      lookupFrom(FRENCH_UNTRANSLATED, ENGLISH),
      "ru",
    );

    expect(frenchPlaceholders.translatePlural(ROWS, 0)).toBe("0 rows");
    expect(russianPlaceholders.translatePlural(ROWS, 21)).toBe("21 rows");
    expect(russianPlaceholders.translatePlural(ROWS, 1)).toBe("1 row");
  });

  /*
   * A one form written for an English one that names no count ("Fired
   * once") can only say one. Russian puts 21, 31 and 101 in its "one"
   * form, French puts 0 and 1.5 there: such a count reads the language's
   * general form, which reads right for any count - never "fired once" for
   * 31 (#6149's follow-up: a security case's detection that fired 31 times).
   */
  describe("a one form that names no count", () => {
    const FIRED: PluralTemplate = {
      one: "Fired once",
      other: "Fired {{count}} times",
    };
    const russianFired: Translator = createTranslator(
      lookupFrom(
        {
          [FIRED.other]: "Срабатываний: {{count}}",
          [`${FIRED.other}_one`]: "Сработало один раз",
        },
        ENGLISH,
      ),
      "ru",
    );
    const frenchFired: Translator = createTranslator(
      lookupFrom(
        {
          [FIRED.other]: "Déclenchée {{count}} fois",
          [`${FIRED.other}_one`]: "Déclenchée une fois",
        },
        ENGLISH,
      ),
      "fr",
    );

    test("is said for one", () => {
      expect(russianFired.translatePlural(FIRED, 1)).toBe("Сработало один раз");
      expect(frenchFired.translatePlural(FIRED, 1)).toBe("Déclenchée une fois");
      expect(english.translatePlural(FIRED, 1)).toBe("Fired once");
    });

    test.each([21, 31, 101, 1001])(
      "never for %d, which Russian counts as one: its general form names the count",
      (count: number) => {
        expect(getPluralCategory("ru", count)).toBe("one");
        expect(russianFired.translatePlural(FIRED, count)).toBe(
          `Срабатываний: ${russianFired.formatNumber(count)}`,
        );
      },
    );

    test("nor for a fraction French counts as one", () => {
      expect(getPluralCategory("fr", 1.5)).toBe("one");
      expect(frenchFired.translatePlural(FIRED, 1.5)).toBe(
        "Déclenchée 1,5 fois",
      );
    });

    test("nor for zero, which French counts as one", () => {
      expect(getPluralCategory("fr", 0)).toBe("one");
      expect(frenchFired.translatePlural(FIRED, 0)).toBe("Déclenchée 0 fois");
    });

    test("the other counts read the general form, as before", () => {
      expect(russianFired.translatePlural(FIRED, 5)).toBe("Срабатываний: 5");
      expect(russianFired.translatePlural(FIRED, 22)).toBe("Срабатываний: 22");
    });

    test("a one form that names the count still holds 21 in Russian", () => {
      expect(russian.translatePlural(ROWS, 21)).toBe("21 строка");
    });

    test("English is untouched", () => {
      expect(english.translatePlural(FIRED, 21)).toBe("Fired 21 times");
      expect(english.translatePlural(FIRED, 0)).toBe("Fired 0 times");
    });
  });

  /*
   * The UI review of #6149's follow-up: a pair that names the count in
   * neither form is a word drawn beside a number shown on its own - "21"
   * over "days" on a countdown, a log total over "logs" - or a number
   * another value holds. Its one form is the language's form for that
   * number: Russian says "21 день" and "21 журнал", never "21 дней".
   */
  describe("a word beside a number shown on its own", () => {
    const DAYS: PluralTemplate = { one: "day", other: "days" };
    const EVENTS: PluralTemplate = {
      one: "{{number}} event",
      other: "{{number}} events",
    };
    const russianWords: Translator = createTranslator(
      lookupFrom({
        [DAYS.other]: "дней",
        [`${DAYS.other}_one`]: "день",
        [`${DAYS.other}_few`]: "дня",
        [EVENTS.other]: "Событий: {{number}}",
        [`${EVENTS.other}_one`]: "{{number}} событие",
      }),
      "ru",
    );
    const frenchWords: Translator = createTranslator(
      lookupFrom({
        [DAYS.other]: "jours",
        [`${DAYS.other}_one`]: "jour",
      }),
      "fr",
    );

    test("says only one when the other form names the count and the one form does not", () => {
      expect(
        isOneFormOnlyForOne({
          one: "Fired once",
          other: "Fired {{count}} times",
        }),
      ).toBe(true);
      expect(
        isOneFormOnlyForOne({
          one: "Show the host",
          other: "Show every host ({{count}})",
        }),
      ).toBe(true);
      expect(isOneFormOnlyForOne(ROWS)).toBe(false);
      expect(isOneFormOnlyForOne(DAYS)).toBe(false);
      expect(isOneFormOnlyForOne(EVENTS)).toBe(false);
    });

    test.each([1, 21, 31, 101])(
      "Russian draws %d's word in its one form",
      (count: number) => {
        expect(getPluralCategory("ru", count)).toBe("one");
        expect(russianWords.translatePlural(DAYS, count)).toBe("день");
        expect(
          russianWords.translatePlural(EVENTS, count, {
            number: String(count),
          }),
        ).toBe(`${count} событие`);
      },
    );

    test("and the other counts in their own forms", () => {
      expect(russianWords.translatePlural(DAYS, 22)).toBe("дня");
      expect(russianWords.translatePlural(DAYS, 25)).toBe("дней");
      expect(russianWords.translatePlural(EVENTS, 25, { number: "25" })).toBe(
        "Событий: 25",
      );
    });

    test("French draws zero's word in its one form", () => {
      expect(getPluralCategory("fr", 0)).toBe("one");
      expect(frenchWords.translatePlural(DAYS, 0)).toBe("jour");
      expect(frenchWords.translatePlural(DAYS, 2)).toBe("jours");
    });
  });

  test("a locale without the template gives the English sentence", () => {
    const korean: Translator = createTranslator(lookupFrom(ENGLISH), "ko");

    expect(korean.translatePlural(ROWS, 1)).toBe("1 row");
    expect(korean.translatePlural(ROWS, 4)).toBe("4 rows");
  });

  test("without any translation set up English plural rules still apply", () => {
    expect(nothingSetUp.translatePlural(ROWS, 1)).toBe("1 row");
    expect(nothingSetUp.translatePlural(ROWS, 3)).toBe("3 rows");
  });

  test("fills the other placeholders, terms translated with the sentence", () => {
    const values: Record<string, ReturnType<typeof translatableTerm> | string> =
      {
        range: "1-10",
        total: "25",
        itemName: translatableTerm("Incident", { inSentence: true }),
        itemsName: translatableTerm("Incidents", { inSentence: true }),
      };

    expect(english.translatePlural(SHOWING, 25, values)).toBe(
      "Showing 1-10 of 25 incidents",
    );
    expect(english.translatePlural(SHOWING, 1, { ...values, range: "1" })).toBe(
      "Showing 1 of 25 incident",
    );
    expect(german.translatePlural(SHOWING, 25, values)).toBe(
      "1-10 von 25 Vorfälle",
    );
    expect(german.translatePlural(SHOWING, 1, values)).toBe(
      "1-10 von 25 Vorfall",
    );
  });

  test("a caller's own count value wins over the formatted count", () => {
    expect(english.translatePlural(ROWS, 3, { count: "three" })).toBe(
      "three rows",
    );
  });
});

describe("formatNumber", () => {
  test("follows the reader's language", () => {
    expect(english.formatNumber(1234567)).toBe("1,234,567");
    expect(german.formatNumber(1234567)).toBe("1.234.567");
  });

  test("an unusable language code still formats", () => {
    const odd: Translator = createTranslator(undefined, "!!");

    expect(odd.formatNumber(12)).toBe((12).toLocaleString());
  });
});

describe("fillTemplate with terms", () => {
  test("puts a term in as its English text, cased when in a sentence", () => {
    expect(
      fillTemplate("No {{itemsName}} yet.", {
        itemsName: translatableTerm("API Keys", { inSentence: true }),
      }),
    ).toBe("No API keys yet.");
    expect(
      fillTemplate("Create {{itemName}}", {
        itemName: translatableTerm(" Monitor "),
      }),
    ).toBe("Create Monitor");
  });
});

describe("language", () => {
  test("defaults to English", () => {
    expect(nothingSetUp.language).toBe("en");
    expect(german.language).toBe("de");
  });
});

/*
 * A value put together from other translated strings - names joined with
 * "or", clauses joined into one sentence - goes into a sentence in the
 * sentence's language. A locale with wordings of the pieces but not of the
 * sentence still reads one English sentence, and a locale with the sentence
 * reads the pieces in its own words.
 */
describe("composedValue", () => {
  const NEEDS: string = "Changing this needs {{permissions}}.";
  const EITHER: string = "{{first}} or {{second}}";
  const ROWS_NEED: PluralTemplate = {
    one: "{{count}} row needs {{permissions}}.",
    other: "{{count}} rows need {{permissions}}.",
  };

  const either: ReturnType<typeof composedValue> = composedValue(
    (translator: Translator): string => {
      return translator.translateTemplate(EITHER, {
        first: "Project Owner",
        second: translatableTerm("Incidents"),
      });
    },
  );

  const withSentence: Translator = createTranslator(
    lookupFrom(
      {
        [NEEDS]: "Dafür braucht es {{permissions}}.",
        [EITHER]: "{{first}} oder {{second}}",
        [ROWS_NEED.other]: "{{count}} Zeilen brauchen {{permissions}}.",
        [`${ROWS_NEED.other}_one`]: "{{count}} Zeile braucht {{permissions}}.",
      },
      GERMAN,
      ENGLISH,
    ),
    "de",
  );

  // Has the pieces' wordings, but not the sentence's.
  const withPiecesOnly: Translator = createTranslator(
    lookupFrom({ [EITHER]: "{{first}} oder {{second}}" }, GERMAN, ENGLISH),
    "de",
  );

  test("isComposedValue tells a composed value from terms and plain values", () => {
    expect(isComposedValue(either)).toBe(true);
    expect(isComposedValue(translatableTerm("Incidents"))).toBe(false);
    expect(isComposedValue("x")).toBe(false);
    expect(isComposedValue(3)).toBe(false);
    expect(isComposedValue(null)).toBe(false);
    expect(isComposedValue({ compose: "x" })).toBe(false);
  });

  test("a translated sentence builds it in the reader's language", () => {
    expect(withSentence.translateTemplate(NEEDS, { permissions: either })).toBe(
      "Dafür braucht es Project Owner oder Vorfälle.",
    );
  });

  test("a sentence the locale lacks builds it in English, pieces and all", () => {
    expect(
      withPiecesOnly.translateTemplate(NEEDS, { permissions: either }),
    ).toBe("Changing this needs Project Owner or Incidents.");
  });

  test("English and fillTemplate build it in English", () => {
    expect(english.translateTemplate(NEEDS, { permissions: either })).toBe(
      "Changing this needs Project Owner or Incidents.",
    );
    expect(nothingSetUp.translateTemplate(NEEDS, { permissions: either })).toBe(
      "Changing this needs Project Owner or Incidents.",
    );
    expect(fillTemplate(NEEDS, { permissions: either })).toBe(
      "Changing this needs Project Owner or Incidents.",
    );
  });

  test("a count-dependent sentence builds it in the sentence's language too", () => {
    expect(
      withSentence.translatePlural(ROWS_NEED, 1, { permissions: either }),
    ).toBe("1 Zeile braucht Project Owner oder Vorfälle.");
    expect(
      withSentence.translatePlural(ROWS_NEED, 3, { permissions: either }),
    ).toBe("3 Zeilen brauchen Project Owner oder Vorfälle.");
    expect(
      withPiecesOnly.translatePlural(ROWS_NEED, 3, { permissions: either }),
    ).toBe("3 rows need Project Owner or Incidents.");
  });

  test("it is built with the very translator the sentence is filled with", () => {
    const languages: Array<string> = [];
    const value: ReturnType<typeof composedValue> = composedValue(
      (translator: Translator): string => {
        languages.push(translator.language);
        return "x";
      },
    );

    withSentence.translateTemplate(NEEDS, { permissions: value });
    withPiecesOnly.translateTemplate(NEEDS, { permissions: value });

    expect(languages).toEqual(["de", "en"]);
  });
});
