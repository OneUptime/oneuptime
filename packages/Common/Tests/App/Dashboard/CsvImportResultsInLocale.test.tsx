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
import * as React from "react";
import ImportGroupsFromCsvModal from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/ImportGroupsFromCsvModal";
import ImportSitesFromCsvModal from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/ImportSitesFromCsvModal";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { Translator, formatList } from "../../../Types/Translator";

/*
 * #7097: WHAT AN IMPORT DID TO A ROW, AND WHAT IS WRONG WITH A FILE, IN
 * THE READER'S LANGUAGE.
 *
 * The site and group CSV imports mark a row they created "Created". That
 * was the date column's key: an Arabic reader saw تاريخ الإنشاء ("creation
 * date") on a row that had just been made, a Japanese reader 作成 (the
 * column's "Created"). The results draw the outcome's own key now: تم
 * الإنشاء, 作成済み. And the problems the preview lists are whole
 * sentences of the reader's language, after the line in the reader's
 * digits, where they were English.
 *
 * Rendered through the real dialogs and the real locale files.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ja", "ar", "fa"];

function word(language: string, key: string): string {
  const text: string | undefined = readDashboardLocale(language)[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return text as string;
}

/*
 * The outcome's word: English reads "Created" (the key's English names its
 * meaning for a translator), every other language its own wording.
 */
function outcomeIn(language: string): string {
  return language === "en"
    ? "Created"
    : word(language, "Created (import result)");
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

async function importRows(language: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });

  expect(
    await screen.findByText(word(language, "Import results")),
  ).toBeInTheDocument();
}

// The pill each result row carries, in row order.
function resultPills(): Array<string> {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row: HTMLElement): string => {
      return row.querySelector("span.rounded-full")?.textContent || "";
    });
}

function siteType(id: string, name: string): NetworkSiteType {
  const type: NetworkSiteType = new NetworkSiteType();

  type._id = id;
  type.name = name;
  type.isUnitLevel = false;

  return type;
}

const SITES_CSV: string =
  "name,siteType\nHeadquarters,Region\nWarehouse,Region\n";

const GROUPS_CSV: string = "name\nCore Services\nPayments\n";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    // Hindi too, for the dialog's one word for an import.
    resources: Object.fromEntries(
      [...LANGUAGES, "hi"].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the CSV imports' results say Created as an outcome", () => {
  test.each(LANGUAGES)(
    "%s: the site import marks a created row with the outcome's own word",
    async (language: string) => {
      jest.spyOn(ModelAPI, "getList").mockResolvedValue({
        data: [siteType("5f8b7c1e2d3a4b5c6d7e8f02", "Region")],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);

      const created: NetworkSite = new NetworkSite();

      created._id = "5f8b7c1e2d3a4b5c6d7e8f31";
      jest
        .spyOn(ModelAPI, "create")
        .mockResolvedValue(new HTTPResponse(200, created as never, {}));

      await readIn(language);
      render(
        <ImportSitesFromCsvModal
          onClose={() => {}}
          onImportComplete={() => {}}
        />,
      );
      await preview(language, SITES_CSV);
      await importRows(language);

      const outcome: string = outcomeIn(language);

      expect(resultPills()).toEqual([outcome, outcome]);

      if (language !== "en") {
        // Never the date column's word, where a language words them apart.
        if (word(language, "Created") !== outcome) {
          expect(resultPills()).not.toContain(word(language, "Created"));
        }
      } else {
        expect(outcome).toBe("Created");
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: the group import marks a created row with the outcome's own word",
    async (language: string) => {
      jest.spyOn(ModelAPI, "getList").mockResolvedValue({
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
      } as never);

      const created: StatusPageGroup = new StatusPageGroup();

      created._id = "5f8b7c1e2d3a4b5c6d7e8f41";
      jest
        .spyOn(ModelAPI, "create")
        .mockResolvedValue(new HTTPResponse(200, created as never, {}));

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
      await importRows(language);

      const outcome: string = outcomeIn(language);

      expect(resultPills()).toEqual([outcome, outcome]);
    },
  );

  test("Arabic reads تم الإنشاء (was created), not تاريخ الإنشاء (creation date)", async () => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [siteType("5f8b7c1e2d3a4b5c6d7e8f02", "Region")],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    const created: NetworkSite = new NetworkSite();

    created._id = "5f8b7c1e2d3a4b5c6d7e8f31";
    jest
      .spyOn(ModelAPI, "create")
      .mockResolvedValue(new HTTPResponse(200, created as never, {}));

    await readIn("ar");
    render(
      <ImportSitesFromCsvModal
        onClose={() => {}}
        onImportComplete={() => {}}
      />,
    );
    await preview("ar", SITES_CSV);
    await importRows("ar");

    expect(resultPills()).toEqual(["تم الإنشاء", "تم الإنشاء"]);
    expect(screen.queryByText("تاريخ الإنشاء")).not.toBeInTheDocument();
  });
});

describe("the preview's problems, in the reader's language", () => {
  const BAD_SITES_CSV: string =
    "name,siteType\nUnit 1042,Planet\n,Region\nTwin,Region\nTwin,Region\n";

  test.each(LANGUAGES)(
    "%s: the site import lists each problem after its line, as one sentence",
    async (language: string) => {
      jest.spyOn(ModelAPI, "getList").mockResolvedValue({
        data: [siteType("5f8b7c1e2d3a4b5c6d7e8f02", "Region")],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);

      await readIn(language);
      render(
        <ImportSitesFromCsvModal
          onClose={() => {}}
          onImportComplete={() => {}}
        />,
      );
      await preview(language, BAD_SITES_CSV);

      const translator: Translator = dashboardTranslator(language);
      const line: (line: number, message: string) => string = (
        lineNumber: number,
        message: string,
      ): string => {
        return withoutIsolateMarks(
          translator.translateTemplate("Line {{line}}: {{message}}", {
            line: translator.formatNumber(lineNumber),
            message,
          }),
        );
      };
      const problem: (
        template: string,
        values?: Record<string, string>,
      ) => string = (
        template: string,
        values: Record<string, string> = {},
      ): string => {
        return translator.translateTemplate(template, values, {
          setsValuesApart: true,
        });
      };

      const items: Array<string> = Array.from(
        screen
          .getByText(word(language, "Fix these problems before importing:"))
          .parentElement!.querySelectorAll("li"),
      ).map((item: Element): string => {
        return withoutIsolateMarks(item.textContent || "");
      });

      expect(items).toEqual([
        line(
          2,
          problem('Unknown siteType "{{value}}". Valid values: {{values}}.', {
            value: "Planet",
            values: formatList(["Region"], translator),
          }),
        ),
        line(3, problem("name is required.")),
        line(
          5,
          problem(
            'Duplicate site name "{{name}}" (first used on line {{line}}).',
            { name: "Twin", line: translator.formatNumber(4) },
          ),
        ),
      ]);

      if (language === "de") {
        expect(items[1]).toBe("Zeile 3: name ist erforderlich.");
      }

      if (language === "fa") {
        // The lines in Persian digits: ۲, ۳, ۵.
        expect(items.join("\n")).toContain("۲");
        expect(items.join("\n")).toContain("۵");
      }
    },
  );
});

/*
 * UI review of #7097: the help above the box lists the project's site
 * types the way the reader's language lists names, as a problem's "Valid
 * values" beside it does - an Arabic page read "(Account Type, Region)"
 * over "Account Type، Region" - and a Hindi dialog says import one way.
 */
describe("the site import's help and words, read as one dialog", () => {
  function mockSiteTypes(): void {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [
        siteType("5f8b7c1e2d3a4b5c6d7e8f02", "Region"),
        siteType("5f8b7c1e2d3a4b5c6d7e8f03", "Market"),
      ],
      count: 2,
      skip: 0,
      limit: 2,
    } as never);
  }

  // The help paragraph: the one line above the box that names the types.
  async function helpText(): Promise<string> {
    const box: HTMLElement = await screen.findByRole("textbox");
    const help: Element | null =
      box.closest("div.space-y-4")?.querySelector("p") || null;

    return withoutIsolateMarks(help?.textContent || "");
  }

  test.each(["en", "de", "ar", "fa"])(
    "%s: the help lists the site types as a problem's valid values list them",
    async (language: string) => {
      mockSiteTypes();
      await readIn(language);
      render(
        <ImportSitesFromCsvModal
          onClose={() => {}}
          onImportComplete={() => {}}
        />,
      );

      const translator: Translator = dashboardTranslator(language);
      const list: string = formatList(["Region", "Market"], translator);

      expect(await helpText()).toContain(`(${list})`);

      if (language === "en" || language === "de") {
        expect(list).toBe("Region, Market");
      } else {
        // Arabic and Persian set names apart with their own comma.
        expect(list).toBe("Region، Market");
        expect(await helpText()).not.toContain("Region, Market");
      }
    },
  );

  test("hi: the title, the count line and the button say आयात, never इम्पोर्ट", async () => {
    mockSiteTypes();
    await readIn("hi");
    render(
      <ImportSitesFromCsvModal
        onClose={() => {}}
        onImportComplete={() => {}}
      />,
    );
    await preview("hi", SITES_CSV);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "CSV से साइटें आयात करें",
    );
    expect(
      screen.getByText("2 साइटें आयात के लिए तैयार हैं।"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "2 साइटें आयात करें",
    );
    expect(screen.getByTestId("modal").textContent || "").not.toMatch(
      /इम्पोर्ट|इंपोर्ट/u,
    );
  });
});
