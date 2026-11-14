import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ImportGroupsFromCsvModal from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/ImportGroupsFromCsvModal";
import {
  parseStatusPageGroupCsv,
  STATUS_PAGE_GROUP_CSV_COLUMNS,
  StatusPageGroupCsvParseResult,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";

/*
 * THE STATUS PAGE'S GROUP IMPORT, IN THE READER'S LANGUAGE (#6658, UI review
 * of #6680).
 *
 * A problem with the file is a sentence with the file's own words in it - a
 * column's name, the cell as it was written. In an Arabic sentence those
 * Latin words flung a quote to the far end of their run
 * ('isExpandedByDefault «maybe» ...' drawn with one guillemet turned round),
 * so each is set apart. The list of problems and the preview table are
 * laid out from the reading start: the bullets sit inside the box on an
 * Arabic page, and each column's heading stands over its own values.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

// A letter of the Arabic block (U+0600 to U+06FF).
const ARABIC_LETTER: RegExp = new RegExp(
  `[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`,
);

function setApart(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

const BAD_VALUES_CSV: string =
  "name,isExpandedByDefault,viewMode\nCore Services,maybe,List\nAPI,true,Cards\n";

const BAD_HEADER_CSV: string = "name,colour\nCore Services,red\n";

const GOOD_CSV: string =
  "name,parentName,description,viewMode\nCore Services,,The services everything else runs on,List\nAPI,Core Services,,List\n";

function messages(result: StatusPageGroupCsvParseResult): Array<string> {
  return result.errors.map((error: { message: string }): string => {
    return error.message;
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

describe("a CSV problem's words, in the reader's language", () => {
  test("English reads as it always has, with no isolate's marks", () => {
    expect(messages(parseStatusPageGroupCsv(BAD_VALUES_CSV))).toEqual([
      'isExpandedByDefault "maybe" is not a true/false value. Use true or false (yes/no and 1/0 also work).',
      'Unknown viewMode "Cards". Valid values: List, Grid.',
    ]);
    expect(messages(parseStatusPageGroupCsv(BAD_HEADER_CSV))).toEqual([
      'Unknown column "colour" in header. Expected columns: name, parentName, description, isExpandedByDefault, showCurrentStatus, showUptimePercent, uptimePercentPrecision, viewMode, rowAxisLabel, rowAxisValues, columnAxisLabel, columnAxisValues.',
    ]);
  });

  test("German words each problem, its Latin values left as they are", async () => {
    await i18next.changeLanguage("de");

    expect(messages(parseStatusPageGroupCsv(BAD_VALUES_CSV))).toEqual([
      worded(
        DE,
        '{{column}} "{{value}}" is not a true/false value. Use true or false (yes/no and 1/0 also work).',
        { column: "isExpandedByDefault", value: "maybe" },
      ),
      worded(DE, 'Unknown {{column}} "{{value}}". Valid values: {{values}}.', {
        column: "viewMode",
        value: "Cards",
        values: "List, Grid",
      }),
    ]);

    const header: Array<string> = messages(
      parseStatusPageGroupCsv(BAD_HEADER_CSV),
    );
    expect(header).toEqual([
      worded(
        DE,
        'Unknown column "{{column}}" in header. Expected columns: {{columns}}.',
        {
          column: "colour",
          columns: STATUS_PAGE_GROUP_CSV_COLUMNS.join(", "),
        },
      ),
    ]);
    expect(header[0]).not.toContain(FIRST_STRONG_ISOLATE);
  });

  test("Arabic sets each Latin value apart, so its quotes stay round it", async () => {
    await i18next.changeLanguage("ar");

    expect(messages(parseStatusPageGroupCsv(BAD_VALUES_CSV))).toEqual([
      worded(
        AR,
        '{{column}} "{{value}}" is not a true/false value. Use true or false (yes/no and 1/0 also work).',
        { column: setApart("isExpandedByDefault"), value: setApart("maybe") },
      ),
      worded(AR, 'Unknown {{column}} "{{value}}". Valid values: {{values}}.', {
        column: setApart("viewMode"),
        value: setApart("Cards"),
        /*
         * Since #7201 the values are listed as the reader's language lists
         * them (formatList): Arabic joins them with its own comma, inside
         * the one isolate.
         */
        values: setApart("List، Grid"),
      }),
    ]);

    for (const csv of [BAD_HEADER_CSV, "name,name\nA,B\n", "parentName\nA\n"]) {
      for (const message of messages(parseStatusPageGroupCsv(csv))) {
        // Each Latin value is in an isolate, and the sentence is Arabic.
        expect(message).toContain(FIRST_STRONG_ISOLATE);
        expect(message).toMatch(ARABIC_LETTER);
      }
    }
  });
});

describe("the import dialog's problems and preview, in German and Arabic", () => {
  function renderModal(): void {
    render(
      <ImportGroupsFromCsvModal
        statusPageId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f91")}
        projectId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f92")}
        onClose={() => {}}
        onImportComplete={() => {}}
      />,
    );
  }

  async function preview(
    csv: string,
    locale: Record<string, string>,
  ): Promise<void> {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: csv } });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: worded(locale, "Preview Import"),
        }),
      );
    });
  }

  test("Arabic: the problems list starts at the reading start, each line numbered in Arabic words", async () => {
    await act(async () => {
      await i18next.changeLanguage("ar");
    });

    renderModal();
    await preview(BAD_VALUES_CSV, AR);

    const list: HTMLElement = screen.getByRole("list");
    // Logical padding: the bullets keep inside the box on an Arabic page.
    expect(list).toHaveClass("ps-5");
    expect(list).not.toHaveClass("pl-5");

    const items: Array<HTMLElement> = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe(
      worded(AR, "Line {{line}}: {{message}}", {
        line: "2",
        message: worded(
          AR,
          '{{column}} "{{value}}" is not a true/false value. Use true or false (yes/no and 1/0 also work).',
          { column: setApart("isExpandedByDefault"), value: setApart("maybe") },
        ),
      }),
    );
  });

  test.each([
    ["German", "de", DE],
    ["Arabic", "ar", AR],
  ])(
    "%s: every preview heading is aligned to the reading start, not centred",
    async (_name: string, language: string, locale: Record<string, string>) => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      renderModal();
      await preview(GOOD_CSV, locale);

      const headings: Array<HTMLElement> = screen.getAllByRole("columnheader");
      expect(headings.length).toBe(6);

      /*
       * A th is centred unless it is told otherwise; a text-start on its row
       * is the initial value and does not reach it.
       */
      for (const heading of headings) {
        expect(heading).toHaveClass("text-start");
        expect(heading.parentElement).not.toHaveClass("text-left");
      }

      expect(headings[2]).toHaveTextContent(worded(locale, "Parent"));
      expect(screen.getAllByRole("row")).toHaveLength(3);
    },
  );
});
