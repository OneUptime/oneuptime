// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import {
  getWordOfMeaningKey,
  MEANING_KEY_PATTERN,
  MEANING_KEYS,
  withMeaningKeyAsItsWord,
} from "../../Types/MeaningKeys";
import {
  createTranslator,
  translatableTerm,
  Translator,
} from "../../Types/Translator";
import {
  getGlobalTranslator,
  translateTemplate,
  translateText,
} from "../../UI/Utils/TranslateTemplate";
import useTranslateValue from "../../UI/Utils/Translation";
import useTranslator from "../../UI/Utils/UseTranslator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../Helpers/DashboardLocales";

/*
 * A KEY THAT NAMES ITS MEANING READS AS ITS WORD (#8078).
 *
 * A key is its English text, so "View" - every View button's verb - read
 * "Ver" in Spanish where a database's view was meant, and "Change" read
 * "Cambiar" over the Schema Changes list's column. Such a meaning has a key
 * of its own, "View (database object)", worded as the noun in every
 * language ("Vista"), which English reads as "View".
 *
 * Until now each page that used one wrote that English by hand (an open
 * invoice, an open data security issue, an import's Created), so a column's
 * or a filter's title - drawn by the shared table, which only looks a title
 * up - could not be one: English read "Change (schema change)". The
 * translator knows the keys now (Common/Types/MeaningKeys), and every way
 * the front ends look a text up reads such a key as its word where the
 * reader's language has no wording of it: createTranslator's translateText
 * and translateTerm, an English sentence's values, the global translator
 * and useTranslateValue's translateString (the table's header, a filter's
 * label and chip, a pill).
 */

const VIEW: string = "View (database object)";
const CHANGE: string = "Change (schema change)";

// A lookup over a few words, as a locale file answers: undefined for the rest.
function lookupOver(
  words: Record<string, string>,
): (text: string) => string | undefined {
  return (text: string): string | undefined => {
    return Object.prototype.hasOwnProperty.call(words, text)
      ? words[text]
      : undefined;
  };
}

const ENGLISH: Translator = createTranslator(
  lookupOver({
    [VIEW]: VIEW,
    [CHANGE]: CHANGE,
    View: "View",
    "Filter by {{field}}": "Filter by {{field}}",
  }),
  "en",
);

const SPANISH: Translator = createTranslator(
  lookupOver({
    [VIEW]: "Vista",
    [CHANGE]: "Cambio",
    View: "Ver",
    "Filter by {{field}}": "Filtrar por {{field}}",
  }),
  "es",
);

describe("the keys that name their meaning", () => {
  test("are each a word, then its meaning in brackets", () => {
    expect(MEANING_KEYS.length).toBeGreaterThanOrEqual(6);

    for (const key of MEANING_KEYS) {
      const match: RegExpMatchArray | null = key.match(MEANING_KEY_PATTERN);

      expect({ key, isWordAndMeaning: Boolean(match) }).toEqual({
        key,
        isWordAndMeaning: true,
      });
      expect(getWordOfMeaningKey(key)).toBe(match?.[1]);
      expect(key.startsWith(`${getWordOfMeaningKey(key)} (`)).toBe(true);
    }
  });

  test("are listed once each", () => {
    expect(new Set(MEANING_KEYS).size).toBe(MEANING_KEYS.length);
  });

  test("hold a database's view and table, the schema change's title, a dbt test, a store's test environment, a storage array, a range's two ends, the states that agree with their page's others, an explorer's Insights tab, an SLO month's missed target, Notification Settings' phone call and push columns, a store's free space, a mobile app's screen and a Pod Security control's Linux capabilities, beside the invoice's, the issue's and the import's", () => {
    expect([...MEANING_KEYS].sort()).toEqual(
      [
        "Array (storage array)",
        "Call (phone call)",
        "Capabilities (Linux capabilities)",
        "Change (schema change)",
        "Created (import result)",
        "Deleted (invoice status)",
        "Expired (rule exception)",
        "Expired (threat indicator)",
        "Free (storage space)",
        "From (range start)",
        "Insights (explorer analytics)",
        "Missed (target)",
        "Not fetched yet (OAuth token)",
        "Not fetched yet (calendar feed)",
        "Open (invoice status)",
        "Open (pull request)",
        "Open (status)",
        "Push (push notification)",
        "Screen (app screen)",
        "Table (database object)",
        "Test (dbt test)",
        "Test (environment)",
        "To (range end)",
        "Undefined (invoice status)",
        "Upcoming (rule exception)",
        "Valid (OAuth token)",
        "View (database object)",
      ].sort(),
    );
    expect(getWordOfMeaningKey(VIEW)).toBe("View");
    // #8629: the explorers' tab, apart from OneUptime AI's findings.
    expect(getWordOfMeaningKey("Insights (explorer analytics)")).toBe(
      "Insights",
    );
    expect(getWordOfMeaningKey("Insights")).toBeUndefined();
    // #9588: a mobile app's screen, apart from a device's display.
    expect(getWordOfMeaningKey("Screen (app screen)")).toBe("Screen");
    expect(getWordOfMeaningKey("Screen")).toBeUndefined();
    // #9539: a store's room left, apart from a plan's price.
    expect(getWordOfMeaningKey("Free (storage space)")).toBe("Free");
    expect(getWordOfMeaningKey("Free")).toBeUndefined();
    // #8181: an invoice's Deleted and Undefined, worded for the invoice.
    expect(getWordOfMeaningKey("Deleted (invoice status)")).toBe("Deleted");
    expect(getWordOfMeaningKey("Undefined (invoice status)")).toBe("Undefined");
    expect(getWordOfMeaningKey("Deleted")).toBeUndefined();
    expect(getWordOfMeaningKey("Table (database object)")).toBe("Table");
    expect(getWordOfMeaningKey(CHANGE)).toBe("Change");
    expect(getWordOfMeaningKey("Open (invoice status)")).toBe("Open");
    // A Code task's open pull request, beside Merged and Closed.
    expect(getWordOfMeaningKey("Open (pull request)")).toBe("Open");
    expect(getWordOfMeaningKey("Created (import result)")).toBe("Created");
    // #7535: the dbt Tests card's column of tests, the noun.
    expect(getWordOfMeaningKey("Test (dbt test)")).toBe("Test");
    // #8342: a data store's Test environment, the noun.
    expect(getWordOfMeaningKey("Test (environment)")).toBe("Test");
    // #7522: the storage widgets' column, which English reads as "Array".
    expect(getWordOfMeaningKey("Array (storage array)")).toBe("Array");
    expect(getWordOfMeaningKey("Array")).toBeUndefined();
    // #8201: a range's two ends, never a message's sender and recipient.
    expect(getWordOfMeaningKey("From (range start)")).toBe("From");
    expect(getWordOfMeaningKey("To (range end)")).toBe("To");
    // #5476: a month that missed its SLO's target, never a missed SLA deadline.
    expect(getWordOfMeaningKey("Missed (target)")).toBe("Missed");
    expect(getWordOfMeaningKey("To")).toBeUndefined();
    /*
     * #8659: a state a page words to agree with its other states, where the
     * shared word takes another gender: English reads the bare word.
     */
    expect(getWordOfMeaningKey("Expired (threat indicator)")).toBe("Expired");
    expect(getWordOfMeaningKey("Expired (rule exception)")).toBe("Expired");
    expect(getWordOfMeaningKey("Upcoming (rule exception)")).toBe("Upcoming");
    expect(getWordOfMeaningKey("Not fetched yet (OAuth token)")).toBe(
      "Not fetched yet",
    );
    expect(getWordOfMeaningKey("Valid (OAuth token)")).toBe("Valid");
    expect(getWordOfMeaningKey("Not fetched yet (calendar feed)")).toBe(
      "Not fetched yet",
    );
    expect(getWordOfMeaningKey("Expired")).toBeUndefined();
    /*
     * #9877: a Pod Security Standards control's Linux capabilities, apart
     * from what a Runner or a recording can do.
     */
    expect(getWordOfMeaningKey("Capabilities (Linux capabilities)")).toBe(
      "Capabilities",
    );
    expect(getWordOfMeaningKey("Capabilities")).toBeUndefined();
  });

  test("are no other text, not even one shaped like them: it reads as it is written", () => {
    for (const text of [
      "Description (optional)",
      "Retention (days)",
      "Memory (bytes)",
      "View",
      "Change",
      "view (database object)",
      " View (database object)",
      "View (database object) ",
      "View  (database object)",
      "",
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect({ text, word: getWordOfMeaningKey(text) }).toEqual({
        text,
        word: undefined,
      });
      expect(withMeaningKeyAsItsWord(text)).toBe(text);
    }

    expect(getWordOfMeaningKey(undefined)).toBeUndefined();
  });

  test("are keys of the Dashboard's English locale, each mapped to itself as every key is", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of MEANING_KEYS) {
      expect({ key, english: english[key] }).toEqual({ key, english: key });
    }
  });

  test("are worded in every other language of the Dashboard, never left as the English key", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of MEANING_KEYS) {
        expect({
          language,
          key,
          worded: Boolean(locale[key]) && locale[key] !== key,
        }).toEqual({ language, key, worded: true });
      }
    }
  });
});

describe("a translator", () => {
  test("reads a key that names its meaning as its word in English: translateText and translateTerm", () => {
    expect(ENGLISH.translateText(VIEW)).toBe("View");
    expect(ENGLISH.translateText(CHANGE)).toBe("Change");
    expect(ENGLISH.translateTerm(VIEW)).toBe("View");
    expect(ENGLISH.translateTerm(VIEW, { inSentence: true })).toBe("view");
    // English has no wording of its own: the word is its fallback.
    expect(ENGLISH.hasTranslation(VIEW)).toBe(false);
  });

  test("reads it in the reader's words where their language has some", () => {
    expect(SPANISH.translateText(VIEW)).toBe("Vista");
    expect(SPANISH.translateText(CHANGE)).toBe("Cambio");
    expect(SPANISH.translateTerm(VIEW)).toBe("Vista");
    expect(SPANISH.hasTranslation(VIEW)).toBe(true);
    // The bare word is still the verb.
    expect(SPANISH.translateText("View")).toBe("Ver");
  });

  test("reads it as its word where the lookup knows nothing of it, or there is no lookup at all", () => {
    const empty: Translator = createTranslator(lookupOver({}), "de");
    const none: Translator = createTranslator(undefined);

    expect(empty.translateText(VIEW)).toBe("View");
    expect(empty.translateTerm(CHANGE)).toBe("Change");
    expect(empty.hasTranslation(VIEW)).toBe(false);
    expect(none.translateText(VIEW)).toBe("View");
    expect(none.translateTerm(VIEW)).toBe("View");
  });

  test("counts a lookup that already went back to the word as no wording of the key's own", () => {
    // The front ends' translateString hands the word back for English.
    const throughWord: Translator = createTranslator(
      lookupOver({ [VIEW]: "View" }),
      "en",
    );

    expect(throughWord.translateText(VIEW)).toBe("View");
    expect(throughWord.hasTranslation(VIEW)).toBe(false);
  });

  test("puts the key into an English sentence as its word, and into a translated one as the reader's", () => {
    expect(
      ENGLISH.translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE),
      }),
    ).toBe("Filter by Change");
    expect(
      ENGLISH.translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE, { inSentence: true }),
      }),
    ).toBe("Filter by change");
    expect(
      SPANISH.translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE),
      }),
    ).toBe("Filtrar por Cambio");
    expect(
      SPANISH.translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE, { inSentence: true }),
      }),
    ).toBe("Filtrar por cambio");
    // A sentence the reader's language has no wording of is English throughout.
    expect(
      SPANISH.translateTemplate("Sort by {{field}}", {
        field: translatableTerm(CHANGE),
      }),
    ).toBe("Sort by Change");
    // A key starting the sentence takes its capital, as any word does.
    expect(
      ENGLISH.translateTemplate("{{field}} is set.", {
        field: translatableTerm(VIEW, { inSentence: true }),
      }),
    ).toBe("View is set.");
  });

  test("leaves every other text as it was: a value, a look-alike, the bare word", () => {
    expect(ENGLISH.translateText("Description (optional)")).toBe(
      "Description (optional)",
    );
    expect(ENGLISH.translateText("View")).toBe("View");
    expect(SPANISH.translateText("checkout-api")).toBe("checkout-api");
    expect(ENGLISH.translateText("")).toBe("");
    expect(ENGLISH.translateText(undefined)).toBeUndefined();
    expect(ENGLISH.translateTerm(undefined)).toBe("");
  });

  test("reads every listed key as its word through English's own locale file, and as the locale's word in every other", () => {
    const english: Translator = dashboardTranslator("en");

    for (const key of MEANING_KEYS) {
      expect(english.translateText(key)).toBe(getWordOfMeaningKey(key));
    }

    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of MEANING_KEYS) {
        expect({ language, key, drawn: translator.translateText(key) }).toEqual(
          { language, key, drawn: locale[key] },
        );
      }
    }
  });
});

/*
 * The front ends' i18next: the global translator outside React, and
 * useTranslateValue / useTranslator inside it - the hooks the shared table
 * header, a filter's label and chip and a pill draw their words through.
 */
describe("the front ends' lookups, through i18next", () => {
  const RESOURCES: Record<string, { translation: Record<string, string> }> = {
    en: {
      translation: {
        [VIEW]: VIEW,
        [CHANGE]: CHANGE,
        View: "View",
        "Filter by {{field}}": "Filter by {{field}}",
      },
    },
    es: {
      translation: {
        [VIEW]: "Vista",
        [CHANGE]: "Cambio",
        View: "Ver",
        "Filter by {{field}}": "Filtrar por {{field}}",
      },
    },
    // A language whose file still holds the English placeholder.
    hi: { translation: { [VIEW]: VIEW, [CHANGE]: CHANGE } },
  };

  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: RESOURCES,
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterEach(async () => {
    cleanup();
    await i18next.changeLanguage("en");
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  // What a component reads, through both hooks.
  const Probe: React.FunctionComponent<{ text: string }> = (props: {
    text: string;
  }): React.ReactElement => {
    const { translateString } = useTranslateValue();
    const translator: Translator = useTranslator();

    return (
      <div>
        <span data-testid="string">{translateString(props.text)}</span>
        <span data-testid="text">{translator.translateText(props.text)}</span>
        <span data-testid="term">{translator.translateTerm(props.text)}</span>
        <span data-testid="has">
          {String(translator.hasTranslation(props.text))}
        </span>
      </div>
    );
  };

  async function drawn(
    text: string,
  ): Promise<{ string: string; text: string; term: string; has: string }> {
    await act(async () => {
      render(<Probe text={text} />);
    });

    return {
      string: screen.getByTestId("string").textContent || "",
      text: screen.getByTestId("text").textContent || "",
      term: screen.getByTestId("term").textContent || "",
      has: screen.getByTestId("has").textContent || "",
    };
  }

  test("useTranslateValue and useTranslator read the key as its word in English, never its English key", async () => {
    expect(await drawn(CHANGE)).toEqual({
      string: "Change",
      text: "Change",
      term: "Change",
      has: "false",
    });
  });

  test("and as the reader's word in Spanish", async () => {
    await i18next.changeLanguage("es");

    expect(await drawn(VIEW)).toEqual({
      string: "Vista",
      text: "Vista",
      term: "Vista",
      has: "true",
    });
  });

  test("and as its word in a language whose file still holds the English key", async () => {
    await i18next.changeLanguage("hi");

    expect(await drawn(VIEW)).toEqual({
      string: "View",
      text: "View",
      term: "View",
      has: "false",
    });
  });

  test("and leave a look-alike and a value as they are written", async () => {
    expect((await drawn("Description (optional)")).string).toBe(
      "Description (optional)",
    );
    cleanup();
    expect((await drawn("web-01")).string).toBe("web-01");
  });

  test("the global translator, outside React, reads it so too", async () => {
    expect(getGlobalTranslator().translateText(VIEW)).toBe("View");
    expect(translateText(CHANGE)).toBe("Change");
    expect(
      translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE),
      }),
    ).toBe("Filter by Change");

    await i18next.changeLanguage("es");

    expect(translateText(CHANGE)).toBe("Cambio");
    expect(
      translateTemplate("Filter by {{field}}", {
        field: translatableTerm(CHANGE),
      }),
    ).toBe("Filtrar por Cambio");
  });
});
