import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import {
  getDrawnTableCell,
  getDrawnWidgetHeading,
  getKnownTableWords,
  WORDED_HEADING_LINE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/TableWords";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import { getMonitorsTable } from "../../../Server/Utils/AI/Toolbox/MonitorsTableWords";
import { getMonitorCardWords } from "../../../Server/Utils/AI/Toolbox/ReadCardWords";
import {
  AIActionTableWords,
  describeAIActionTableWords,
} from "../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { Translator } from "../../../Types/Translator";
import { widgetToMarkdown } from "../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE MONITORS TABLE UNDER THE CARDS, IN THE READER'S LANGUAGE (issue #7394).
 *
 * "Which monitors are down right now?" left cards that said "Deaktiviert"
 * and "Eingehende Anfrage" on a German page, and under them a table that
 * said "Monitors (4)", "Non-operational first, Disabled last", "Incoming
 * Request" and "Disabled" of the same monitors. The table carries its
 * words now, and the chat says its title, its line, each type and Disabled
 * in the reader's language - the count written the reader's way - while
 * a monitor's name and a status the project named are data, as written.
 * A table saved before it had words, and words that do not say what the
 * table stores, read as the stored English; the exports print English.
 */

const LANGUAGES: Array<string> = ["de", "fa", "ar"];
const LOCALES: Record<string, Record<string, string>> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readDashboardLocale(language);
}

const COLUMNS: number = 3;
const LATIN_DIGIT: RegExp = /[0-9]/;

// The rows query_monitors lists, as the offline Ask AI fixture seeds them.
function monitorRows(): Array<JSONObject> {
  return [
    {
      name: "Checkout API",
      type: MonitorType.Website,
      currentStatus: "Offline",
    },
    {
      name: "https://payments.example.com/api/v2/health/checkout",
      type: MonitorType.Website,
      currentStatus: "Operational",
    },
    {
      name: "legacy-payments-api",
      type: MonitorType.API,
      currentStatus: "Operational",
    },
    // Its monitoring is off: the status its last check saw.
    {
      name: "Backup Job",
      type: MonitorType.IncomingRequest,
      currentStatus: "Operational",
      monitoringOff: true,
    },
  ];
}

function monitorsTable(): AIChatWidget {
  return {
    ...getMonitorsTable({ problemsOnly: false, rows: monitorRows() }),
    id: "W3",
  };
}

// The card the same answer leaves for Backup Job, as the tool builds it.
function backupJobCard(): AIChatWidget {
  return {
    ...WidgetBuilder.resourceCard({
      title: "Monitor Backup Job",
      heading: "Backup Job",
      words: getMonitorCardWords({
        monitorType: MonitorType.IncomingRequest,
        statusName: "Operational",
        isMonitoringOff: true,
        isArchived: false,
      }),
      statusColor: "#6b7280",
      link: {
        type: AIChatCitationTargetType.MonitorView,
        params: { monitorId: "60000000-0000-4000-8000-000000000004" },
      },
    }),
    id: "W2",
  };
}

// A table saved before tables carried words: the English it stored then.
function savedBeforeWords(): AIChatWidget {
  return {
    id: "W3",
    type: AIChatWidgetType.Table,
    title: "Monitors (4)",
    description: "Non-operational first, Disabled last",
    data: {
      columns: monitorsTable().data.columns,
      rows: [
        { name: "Checkout API", type: "Website", currentStatus: "Offline" },
        {
          name: "Backup Job",
          type: "Incoming Request",
          currentStatus: "Disabled",
        },
      ],
      link: { type: AIChatCitationTargetType.Monitors },
    },
  };
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

// The table's cells on the page, row by row.
function tableRows(): Array<Array<string>> {
  const cells: Array<string> = screen
    .getAllByTestId("ai-chat-table-cell")
    .map(textOf);
  const rows: Array<Array<string>> = [];

  for (let index: number = 0; index < cells.length; index += COLUMNS) {
    rows.push(cells.slice(index, index + COLUMNS));
  }

  return rows;
}

function tableWidget(): HTMLElement {
  const table: HTMLElement | undefined = screen
    .getAllByTestId("ai-chat-widget")
    .find((element: HTMLElement): boolean => {
      return within(element).queryAllByTestId("ai-chat-table-cell").length > 0;
    });

  expect(table).toBeDefined();

  return table!;
}

function titleText(): string {
  return textOf(within(tableWidget()).getByTestId("ai-chat-widget-title"));
}

function descriptionText(): string {
  return textOf(
    within(tableWidget()).getByTestId("ai-chat-widget-description"),
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      fa: { translation: LOCALES["fa"]! },
      ar: { translation: LOCALES["ar"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the monitors table in the reader's language", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: its title, its line, each type and Disabled are the language's; names and statuses as named",
    async (language: string) => {
      const words: Record<string, string> = LOCALES[language]!;
      const translator: Translator = dashboardTranslator(language);
      const said: { title: string; description?: string | undefined } =
        describeAIActionTableWords(
          getKnownTableWords(monitorsTable())!,
          translator,
        );

      await inLanguage(language);
      render(<WidgetRenderer widgets={[monitorsTable()]} />);

      expect(titleText()).toBe(said.title);
      expect(titleText()).toContain(
        words["Monitors ({{count}})"]!.split(" ")[0],
      );
      expect(descriptionText()).toBe(
        words["Non-operational first, Disabled last"],
      );

      expect(tableRows()).toEqual([
        ["Checkout API", words["Website"], "Offline"],
        [
          "https://payments.example.com/api/v2/health/checkout",
          words["Website"],
          "Operational",
        ],
        ["legacy-payments-api", words["API"], "Operational"],
        ["Backup Job", words["Incoming Request"], words["Disabled"]],
      ]);

      const page: string = textOf(tableWidget());
      for (const english of [
        "Monitors",
        "Non-operational",
        "Disabled",
        "Incoming Request",
      ]) {
        expect({ language, english, onPage: page.includes(english) }).toEqual({
          language,
          english,
          onPage: false,
        });
      }
    },
  );

  test("German: Monitore (4), and the order line German's", async () => {
    await inLanguage("de");
    render(<WidgetRenderer widgets={[monitorsTable()]} />);

    expect(titleText()).toBe("Monitore (4)");
    expect(descriptionText()).toBe(
      "Nicht betriebsbereit zuerst, Deaktiviert zuletzt",
    );
    expect(tableRows()[3]).toEqual([
      "Backup Job",
      "Eingehende Anfrage",
      "Deaktiviert",
    ]);
  });

  test("Persian: its count in Persian digits, its title read right to left", async () => {
    await inLanguage("fa");
    render(<WidgetRenderer widgets={[monitorsTable()]} />);

    expect(titleText()).toBe("مانیتورها (۴)");
    expect(titleText()).not.toMatch(LATIN_DIGIT);

    const title: HTMLElement = within(tableWidget()).getByTestId(
      "ai-chat-widget-title",
    );
    expect(title.querySelector("bdi")).toHaveAttribute("dir", "rtl");
    expect(
      within(tableWidget())
        .getByTestId("ai-chat-widget-description")
        .querySelector("bdi"),
    ).toHaveAttribute("dir", "rtl");
  });
});

/*
 * In the reader's language the title and its line run longer than the
 * English, and a status the project named sits inside the title: cut on
 * one line, a 360 pixel phone lost the count ("Monitore mit Status
 * „Partial Outage …") and Russian's order line was cut at 390 pixels. A
 * worded title and line wrap, whole, their lines balanced so a count never
 * stands alone; a heading as its tool wrote it keeps its one line.
 */
describe("the title and its line are whole, wrapped where they must be", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: a status-filtered title and its line wrap, balanced, never cut",
    async (language: string) => {
      await inLanguage(language);
      render(
        <WidgetRenderer
          widgets={[
            {
              ...getMonitorsTable({
                problemsOnly: false,
                statusName: "Partial Outage - EU West",
                rows: monitorRows(),
              }),
              id: "W3",
            },
          ]}
        />,
      );

      const title: HTMLElement = within(tableWidget()).getByTestId(
        "ai-chat-widget-title",
      );
      const description: HTMLElement = within(tableWidget()).getByTestId(
        "ai-chat-widget-description",
      );

      expect(textOf(title)).toContain("Partial Outage - EU West");
      for (const heading of [title, description]) {
        expect(heading).toHaveClass("break-words", "text-balance");
        expect(heading).not.toHaveClass("truncate");
        // Whole on screen: no tooltip repeats it.
        expect(heading).not.toHaveAttribute("title");
      }
      expect(WORDED_HEADING_LINE_CLASS_NAME.split(" ").sort()).toEqual([
        "break-words",
        "text-balance",
      ]);
    },
  );

  test("a table saved before it had words keeps its one line, its whole line as the tooltip", async () => {
    await inLanguage("de");
    render(<WidgetRenderer widgets={[savedBeforeWords()]} />);

    const title: HTMLElement = within(tableWidget()).getByTestId(
      "ai-chat-widget-title",
    );
    const description: HTMLElement = within(tableWidget()).getByTestId(
      "ai-chat-widget-description",
    );

    expect(title).toHaveClass("truncate");
    expect(title).not.toHaveClass("text-balance");
    expect(description).toHaveClass("truncate");
    expect(description).toHaveAttribute(
      "title",
      "Non-operational first, Disabled last",
    );
  });
});

describe("the card and its row say the same words", () => {
  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: Backup Job's card and row say the same Disabled and the same type",
    async (language: string) => {
      const words: Record<string, string> = LOCALES[language]!;

      await inLanguage(language);
      render(<WidgetRenderer widgets={[backupJobCard(), monitorsTable()]} />);

      const line: string = textOf(
        screen.getByTestId("ai-chat-resource-card-line"),
      );
      const labels: Array<string> = screen
        .getAllByTestId("ai-chat-resource-card-fact-label")
        .map(textOf);
      const values: Array<string> = screen
        .getAllByTestId("ai-chat-resource-card-fact-value")
        .map(textOf);
      const cardType: string | undefined =
        values[labels.indexOf(words["Type"]!)];
      const row: Array<string> = tableRows()[3]!;

      expect(line).toBe(words["Disabled"]);
      expect(row[2]).toBe(line);
      expect(cardType).toBe(words["Incoming Request"]);
      expect(row[1]).toBe(cardType);
    },
  );
});

describe("a table whose words do not say what it stores reads as stored", () => {
  test("a table saved before it had words: its English, as it was drawn then", async () => {
    await inLanguage("de");
    render(<WidgetRenderer widgets={[savedBeforeWords()]} />);

    expect(titleText()).toBe("Monitors (4)");
    expect(descriptionText()).toBe("Non-operational first, Disabled last");
    expect(tableRows()).toEqual([
      ["Checkout API", "Website", "Offline"],
      ["Backup Job", "Incoming Request", "Disabled"],
    ]);
  });

  test("a title, a line or a cell whose words' English differs from what is stored: that part as stored, the rest worded", async () => {
    const widget: AIChatWidget = monitorsTable();
    widget.title = "Monitors (5)";
    widget.description = "Sorted by name";
    widget.data.rows![3] = {
      ...widget.data.rows![3]!,
      currentStatus: "Operational",
    };

    await inLanguage("de");
    render(<WidgetRenderer widgets={[widget]} />);

    expect(titleText()).toBe("Monitors (5)");
    expect(descriptionText()).toBe("Sorted by name");
    expect(tableRows()[3]).toEqual([
      "Backup Job",
      "Eingehende Anfrage",
      "Operational",
    ]);
  });

  test.each([
    ["a title that is no sentence of ours", { template: "Hello {{count}}" }],
    ["a title in plain text", "Monitors (4)"],
  ])(
    "words that are not ours: %s - the whole table as stored",
    async (_name: string, title: unknown) => {
      const widget: AIChatWidget = monitorsTable();
      widget.data.tableWords = {
        ...widget.data.tableWords!,
        title,
      } as unknown as AIActionTableWords;

      expect(getKnownTableWords(widget)).toBeNull();

      await inLanguage("de");
      render(<WidgetRenderer widgets={[widget]} />);

      expect(titleText()).toBe("Monitors (4)");
      expect(descriptionText()).toBe("Non-operational first, Disabled last");
      expect(tableRows()[3]).toEqual([
        "Backup Job",
        "Incoming Request",
        "Disabled",
      ]);
    },
  );

  test("words carried by a widget that is no table are never read", () => {
    const widget: AIChatWidget = {
      ...monitorsTable(),
      type: AIChatWidgetType.StatCards,
    };

    expect(getKnownTableWords(widget)).toBeNull();
    expect(getDrawnWidgetHeading(widget, dashboardTranslator("de"))).toEqual({
      title: null,
      description: null,
    });
  });

  test("a cell the words do not name is data: a name, a status the project named", () => {
    const widget: AIChatWidget = monitorsTable();
    const words: AIActionTableWords = getKnownTableWords(widget)!;

    for (const [rowIndex, row] of (widget.data.rows || []).entries()) {
      for (const columnKey of ["name"]) {
        expect(
          getDrawnTableCell({
            words,
            rowIndex,
            columnKey,
            stored: row[columnKey],
            translator: dashboardTranslator("de"),
          }),
        ).toBeNull();
      }
    }
    expect(
      getDrawnTableCell({
        words,
        rowIndex: 0,
        columnKey: "currentStatus",
        stored: "Offline",
        translator: dashboardTranslator("de"),
      }),
    ).toBeNull();
    // A key an object has by its prototype is no cell of the words.
    expect(
      getDrawnTableCell({
        words,
        rowIndex: 0,
        columnKey: "toString",
        stored: undefined,
        translator: dashboardTranslator("de"),
      }),
    ).toBeNull();
  });
});

describe("the exports print the table's English", () => {
  test("its title, line, type and Disabled in English, whatever the reader's language", async () => {
    await inLanguage("de");

    const markdown: string = widgetToMarkdown(monitorsTable());

    expect(markdown).toContain("Monitors (4)");
    expect(markdown).toContain("Non-operational first, Disabled last");
    expect(markdown).toContain("Incoming Request");
    expect(markdown).toContain("Disabled");
    for (const german of ["Monitore", "Deaktiviert", "Eingehende Anfrage"]) {
      expect(markdown).not.toContain(german);
    }
  });
});
