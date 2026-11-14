import { describe, expect, test } from "@jest/globals";
import { DataAssetColumn } from "../../../Types/DataObservability/DataAssetColumn";
import {
  DATA_CHECK_SUGGESTION_SENTENCES,
  DataCheckSuggestion,
  DataCheckSuggestionWords,
  suggestDataChecks,
  SuggestionTable,
} from "../../../Types/DataObservability/DataCheckSuggestions";
import { DataColumnSensitivity } from "../../../Types/DataObservability/DataColumnSensitivity";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import {
  ComposedValue,
  createTranslator,
  fillTemplate,
  isComposedValue,
  TemplateValue,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A SUGGESTED CHECK'S NAME AND WHY, IN THE READER'S WORDS (#7221).
 *
 * Suggested Checks offered "customer_id is filled in as usual" and "A
 * deploy that stops setting customer_id shows as more empty values than
 * usual." in English on every page, and Add saved them so. Each name and
 * reason is now one whole sentence of the Dashboard's, with the column,
 * table, segment and data type it names as values: the Dashboard words it
 * in the reader's language, and `name` and `reason` are its English,
 * exactly as they always read.
 */

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const SENTENCES: Array<string> = Object.values(DATA_CHECK_SUGGESTION_SENTENCES);

function column(
  name: string,
  dataType: string,
  isNullable: boolean = true,
): DataAssetColumn {
  return { name, dataType, isNullable, position: 1 };
}

// A table that is offered every kind of suggestion there is.
const ORDERS: Array<DataAssetColumn> = [
  column("id", "bigint", false),
  column("customer_id", "bigint"),
  column("tenant_id", "text", false),
  column("contact_email", "varchar"),
  column("total", "numeric", false),
  column("status", "text", false),
  column("contact", "varchar"),
];

const CUSTOMERS: SuggestionTable = {
  tableKey: "public.customers",
  name: "customers",
  columns: [column("id", "bigint", false)],
};

function sensitive(
  columnName: string,
  dataTypeId: string,
  dataTypeName: string,
): DataColumnSensitivity {
  return {
    column: columnName,
    dataTypeId,
    dataTypeName,
    sensitivity: DataSensitivity.Confidential,
    isFromName: false,
  };
}

function suggest(): Array<DataCheckSuggestion> {
  return suggestDataChecks({
    tableName: "orders",
    columns: ORDERS,
    otherTables: [CUSTOMERS],
    existing: [],
    dismissedIds: [],
    sensitiveColumns: [sensitive("contact", "email-address", "Email address")],
  });
}

// Each suggestion's name and reason as it read before #7221, by its id.
const ENGLISH_AS_BEFORE: Array<[string, string, string]> = [
  [
    "unique:id",
    "id is unique",
    "An id that repeats breaks every join and lookup on it.",
  ],
  [
    "orphans:customer_id:public.customers",
    "Every customer_id has a customers row",
    "Rows whose customer_id has no match in public.customers are orphans: a delete that did not cascade, or a load out of order.",
  ],
  [
    "nulls:customer_id",
    "customer_id is filled in as usual",
    "A deploy that stops setting customer_id shows as more empty values than usual.",
  ],
  [
    "volume-by:customer_id",
    "Rows per customer",
    "One customer that stops sending data is lost in the table's total: counted per customer_id, it alerts on its own.",
  ],
  [
    "volume-by:tenant_id",
    "Rows per tenant",
    "One tenant that stops sending data is lost in the table's total: counted per tenant_id, it alerts on its own.",
  ],
  [
    "email-format:contact_email",
    "contact_email looks like an email address",
    "Values that are not email addresses are bad input, or a column filled from the wrong field.",
  ],
  [
    "not-negative:total",
    "total is not negative",
    "A negative total is usually a sign or unit error.",
  ],
  [
    "values:status",
    "status takes its usual values",
    "A status that suddenly has more different values than usual is a new, unexpected value being written.",
  ],
  [
    "sensitive-format:contact",
    "contact looks like Email address",
    "Data Security says this column holds Email address. Values that do not look like it are bad input, or a column filled from the wrong field.",
  ],
];

// What a language's file leaves wrong about a sentence: what a reader would see.
function wordingProblems(sentence: string, language: string): Array<string> {
  const value: string | undefined = readDashboardLocale(language)[sentence];
  const problems: Array<string> = [];

  if (!isWordedInDashboardLocale(sentence, language)) {
    problems.push(value === undefined ? "missing" : "English");
  }

  if (
    value !== undefined &&
    placeholdersOf(value).join() !== placeholdersOf(sentence).join()
  ) {
    problems.push(`names ${placeholdersOf(value).join()}`);
  }

  return problems;
}

// A value's text in a sentence filled by `translator`.
function valueText(value: TemplateValue, translator: Translator): string {
  return isComposedValue(value)
    ? (value as ComposedValue).compose(translator)
    : String(value);
}

// A suggestion's words as `translator` draws them, the marks set apart.
function drawn(
  words: DataCheckSuggestionWords,
  translator: Translator,
): string {
  return withoutIsolateMarks(
    translator.translateTemplate(words.template, words.values, {
      setsValuesApart: true,
    }),
  );
}

describe("the sentences a suggestion is worded with", () => {
  test("are each a key of the Dashboard's English file, the English its own", () => {
    expect(SENTENCES).toHaveLength(16);

    for (const sentence of SENTENCES) {
      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test("are worded in every language the Dashboard is read in, each name they give kept", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const sentence of SENTENCES) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          sentence,
          language,
          problems: wordingProblems(sentence, language),
        }).toEqual({ sentence, language, problems: [] });
      }
    }
  });

  test("the check above catches a sentence a language left out, left English, or that lost a name", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const sentence: string = DATA_CHECK_SUGGESTION_SENTENCES.orphansName;
    const worded: string = german[sentence]!;

    try {
      delete german[sentence];
      expect(wordingProblems(sentence, "de")).toEqual(["missing"]);

      german[sentence] = sentence;
      expect(wordingProblems(sentence, "de")).toEqual(["English"]);

      // Worded, but the table it names is gone from it.
      german[sentence] = "Zu jedem {{column}} gibt es eine Zeile";
      expect(wordingProblems(sentence, "de")).toEqual(["names {{column}}"]);
    } finally {
      german[sentence] = worded;
    }

    expect(wordingProblems(sentence, "de")).toEqual([]);
  });
});

describe("each suggestion", () => {
  test("in English: its name and reason read exactly as before", () => {
    expect(
      suggest().map((suggestion: DataCheckSuggestion) => {
        return [suggestion.id, suggestion.name, suggestion.reason];
      }),
    ).toEqual(ENGLISH_AS_BEFORE);
  });

  test("is worded with one of the sentences, its English that sentence with the names it gives", () => {
    for (const suggestion of suggest()) {
      expect(SENTENCES).toContain(suggestion.nameWords.template);
      expect(SENTENCES).toContain(suggestion.reasonWords.template);
      expect(
        fillTemplate(
          suggestion.nameWords.template,
          suggestion.nameWords.values,
        ),
      ).toBe(suggestion.name);
      expect(
        fillTemplate(
          suggestion.reasonWords.template,
          suggestion.reasonWords.values,
        ),
      ).toBe(suggestion.reason);
    }
  });

  test("in English, drawn as it always read, with no marks around its names", () => {
    const translator: Translator = dashboardTranslator("en");

    for (const suggestion of suggest()) {
      expect(
        translator.translateTemplate(
          suggestion.nameWords.template,
          suggestion.nameWords.values,
          { setsValuesApart: true },
        ),
      ).toBe(suggestion.name);
      expect(
        translator.translateTemplate(
          suggestion.reasonWords.template,
          suggestion.reasonWords.values,
          { setsValuesApart: true },
        ),
      ).toBe(suggestion.reason);
    }
  });

  test("in every language, reads in the language's words, with each name it gives as it is", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);

      for (const suggestion of suggest()) {
        for (const [words, english] of [
          [suggestion.nameWords, suggestion.name],
          [suggestion.reasonWords, suggestion.reason],
        ] as Array<[DataCheckSuggestionWords, string]>) {
          const text: string = drawn(words, translator);
          const names: Array<string> = Object.keys(words.values)
            .filter((key: string): boolean => {
              return placeholdersOf(words.template).includes(`{{${key}}}`);
            })
            .map((key: string): string => {
              return valueText(words.values[key]!, translator);
            });

          expect({
            language,
            id: suggestion.id,
            english: text === english,
            missing: names.filter((name: string): boolean => {
              return !text.includes(name);
            }),
          }).toEqual({
            language,
            id: suggestion.id,
            english: false,
            missing: [],
          });
        }
      }
    }
  });
});

describe("a data type in a suggestion", () => {
  function dataTypeOf(
    suggestion: DataCheckSuggestion | undefined,
  ): ComposedValue {
    const value: TemplateValue | undefined =
      suggestion?.nameWords.values["dataType"];

    expect(isComposedValue(value)).toBe(true);

    return value as ComposedValue;
  }

  const contact: DataCheckSuggestion | undefined = suggest().find(
    (suggestion: DataCheckSuggestion): boolean => {
      return suggestion.id === "sensitive-format:contact";
    },
  );

  test("one of Data Security's own is named in the reader's words, the way a sentence takes it", () => {
    expect(dataTypeOf(contact).compose(dashboardTranslator("de"))).toBe(
      "E-Mail-Adresse",
    );
    expect(dataTypeOf(contact).compose(dashboardTranslator("fr"))).toBe(
      "adresse e-mail",
    );
    expect(dataTypeOf(contact).compose(dashboardTranslator("ar"))).toBe(
      readDashboardLocale("ar")["Email address"],
    );
    expect(drawn(contact!.nameWords, dashboardTranslator("de"))).toBe(
      "contact sieht nach E-Mail-Adresse aus",
    );
  });

  test("in a language with no words for it, it is named as Data Security named it", () => {
    const noWords: Translator = createTranslator((): undefined => {
      return undefined;
    }, "de");

    expect(dataTypeOf(contact).compose(noWords)).toBe("Email address");
  });

  test("the reason names it the same way as the name", () => {
    expect(contact!.reasonWords.values["dataType"]).toBe(
      contact!.nameWords.values["dataType"],
    );
  });
});
