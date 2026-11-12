import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ImportGroupsFromCsvModal from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/ImportGroupsFromCsvModal";
import ImportSitesFromCsvModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/ImportSitesFromCsvModal";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * THE CSV IMPORTS' "LINE" COLUMN IS A LINE OF THE FILE, IN EVERY LANGUAGE
 * (#6689).
 *
 * The status page group import and the site import headed their first
 * column, a row's line number in the pasted CSV, with "Line" - the key the
 * metric chart's type picker offers as a line chart. A language wording
 * the key for one meaning worded it wrong for the other: Japanese 折れ線
 * and Chinese 折线 ("line chart") over a column of row numbers, German
 * "Zeile" (a row of text) in the chart picker. The column has a key of its
 * own, "CSV line", and "Line" is the chart type alone (OneMeaningPerKey in
 * App's tests holds both to that).
 *
 * The site import's headings start at the reading start too, as the group
 * import's do: a th is centred unless told otherwise, and the row's
 * text-left put an Arabic page's headings at the far end of their columns.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ja", "zh-CN", "ar"];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

function word(language: string, key: string): string {
  const text: string | undefined = LOCALES[language]?.[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return text as string;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function preview(language: string, csv: string): Promise<void> {
  fireEvent.change(await screen.findByRole("textbox"), {
    target: { value: csv },
  });

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", {
        name: word(language, "Preview Import"),
      }),
    );
  });
}

function headings(): Array<HTMLElement> {
  return screen.getAllByRole("columnheader");
}

const GROUPS_CSV: string =
  "name,parentName,description,viewMode\nCore Services,,The services everything else runs on,List\nAPI,Core Services,,List\n";

const SITES_CSV: string =
  "name,siteType,parentName\nAcme Account,Account Type,\nEast Region,Region,Acme Account\n";

function siteType(
  id: string,
  name: string,
  parentId?: string,
): NetworkSiteType {
  const type: NetworkSiteType = new NetworkSiteType();

  type._id = id;
  type.name = name;
  type.isUnitLevel = false;

  if (parentId) {
    type.parentNetworkSiteTypeId = new ObjectID(parentId);
  }

  return type;
}

const ACCOUNT_TYPE_ID: string = "5f8b7c1e2d3a4b5c6d7e8f01";
const REGION_TYPE_ID: string = "5f8b7c1e2d3a4b5c6d7e8f02";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [
          language,
          { translation: LOCALES[language] as Record<string, string> },
        ];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await readIn("en");

  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [
      siteType(ACCOUNT_TYPE_ID, "Account Type"),
      siteType(REGION_TYPE_ID, "Region", ACCOUNT_TYPE_ID),
    ],
    count: 2,
    skip: 0,
    limit: 2,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the CSV line column, in the reader's language", () => {
  test("the locales word it as a line of a file, not as the chart type", () => {
    expect(LOCALES["en"]?.["CSV line"]).toBe("CSV line");

    for (const language of LANGUAGES.filter((code: string): boolean => {
      return code !== "en";
    })) {
      expect({
        language,
        differs: word(language, "CSV line") !== word(language, "Line"),
      }).toEqual({
        language,
        differs: true,
      });
    }

    // The chart type, as each picker offers it.
    expect(word("de", "Line")).toBe("Linie");
    expect(word("ja", "Line")).toBe("折れ線");
    expect(word("ja", "CSV line")).toBe("CSV の行");
    expect(word("zh-CN", "CSV line")).toBe("CSV 行");
    expect(word("de", "CSV line")).toBe("CSV-Zeile");
  });

  test.each([
    ["English", "en"],
    ["German", "de"],
    ["Japanese", "ja"],
    ["Chinese", "zh-CN"],
    ["Arabic", "ar"],
  ])(
    "%s: the status page group import heads its first column with it",
    async (_name: string, language: string) => {
      await readIn(language);

      render(
        <ImportGroupsFromCsvModal
          statusPageId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f91")}
          projectId={new ObjectID("5f8b7c1e2d3a4b5c6d7e8f92")}
          onClose={() => {}}
          onImportComplete={() => {}}
        />,
      );
      await preview(language, GROUPS_CSV);

      expect(headings()[0]).toHaveTextContent(word(language, "CSV line"));
      expect(headings()[0]?.textContent).not.toBe(word(language, "Line"));
    },
  );

  test.each([
    ["English", "en"],
    ["German", "de"],
    ["Japanese", "ja"],
    ["Chinese", "zh-CN"],
    ["Arabic", "ar"],
  ])(
    "%s: the site import heads its first column with it, every heading from the reading start",
    async (_name: string, language: string) => {
      await readIn(language);

      render(
        <ImportSitesFromCsvModal
          onClose={() => {}}
          onImportComplete={() => {}}
        />,
      );
      await preview(language, SITES_CSV);

      const columns: Array<HTMLElement> = headings();

      expect(columns).toHaveLength(6);
      expect(columns[0]).toHaveTextContent(word(language, "CSV line"));
      expect(columns[0]?.textContent).not.toBe(word(language, "Line"));
      expect(columns[2]).toHaveTextContent(word(language, "Site Type"));

      for (const heading of columns) {
        expect(heading).toHaveClass("text-start");
        expect(heading.parentElement).not.toHaveClass("text-left");
      }

      // Both rows previewed, under their line numbers in the file.
      expect(screen.getAllByRole("row")).toHaveLength(3);
    },
  );
});
