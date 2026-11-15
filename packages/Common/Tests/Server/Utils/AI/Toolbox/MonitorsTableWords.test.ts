import { describe, expect, test } from "@jest/globals";
import {
  getMonitorsTable,
  getMonitorsTableWords,
  MONITOR_TABLE_ORDER_TEXT,
  MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT,
  MONITOR_TABLE_PROBLEMS_ONLY_TEXT,
  MONITORING_OFF_STATUS_TEXT,
  MonitorsTableData,
} from "../../../../../Server/Utils/AI/Toolbox/MonitorsTableWords";
import { getMonitorCardWords } from "../../../../../Server/Utils/AI/Toolbox/ReadCardWords";
import {
  AI_READ_CARD_LINES,
  AI_READ_CARD_VALUES,
  AI_READ_TABLE_LINES,
  AI_READ_TABLE_TITLES,
  AIActionCardWords,
  AIActionTableCell,
  AIActionTableWords,
  aiActionFigure,
  aiActionSentence,
  aiActionTerm,
  describeAIActionCardWords,
  describeAIActionTableCell,
  describeAIActionTableWords,
  isKnownAIActionTableWords,
} from "../../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { Translator } from "../../../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../../../Helpers/DashboardLocales";

/*
 * THE MONITORS TABLE UNDER THE CARDS, AS WORDS (issue #7394).
 *
 * "Which monitors are down right now?" leaves a card for each monitor the
 * model looked up and, under them, the table of the monitors
 * query_monitors listed. Since #7175 the cards said "Deaktiviert" and
 * "Eingehende Anfrage" on a German page; the row under them said
 * "Disabled" and "Incoming Request" of the same monitor, under "Monitors
 * (4)" and "Non-operational first, Disabled last". Toolbox's
 * MonitorsTableWords builds the table with words now: its title (the
 * count a figure) and its line sentences, each monitor's type the type
 * picker's word for it and Disabled the card's word - in the reader's
 * language on the Dashboard, and the same words in English in what the
 * table stores, for the exports and the model. A monitor's name and a
 * status the project named are data.
 */

// A row as query_monitors lists it.
function row(data: {
  name: string;
  type?: string | undefined;
  status: string;
  monitoringOff?: boolean;
}): JSONObject {
  return {
    id: `id-${data.name}`,
    name: data.name,
    ...(data.type !== undefined ? { type: data.type } : {}),
    currentStatus: data.status,
    statusColor: "#fd625e",
    isOperational: data.status === "Operational",
    ...(data.monitoringOff ? { monitoringOff: true } : {}),
  };
}

// The four monitors of the offline fixture's answer (?thread=monitors).
function fourMonitors(): Array<JSONObject> {
  return [
    row({ name: "Checkout API", type: MonitorType.Website, status: "Offline" }),
    row({
      name: "https://payments.example.com/api/v2/health/checkout",
      type: MonitorType.Website,
      status: "Operational",
    }),
    row({
      name: "legacy-payments-api",
      type: MonitorType.API,
      status: "Operational",
    }),
    row({
      name: "Backup Job",
      type: MonitorType.IncomingRequest,
      status: "Operational",
      monitoringOff: true,
    }),
  ];
}

function table(data: Partial<MonitorsTableData> = {}): AIChatWidget {
  return getMonitorsTable({
    problemsOnly: false,
    rows: fourMonitors(),
    ...data,
  });
}

function rowsOf(widget: AIChatWidget): Array<JSONObject> {
  return widget.data.rows || [];
}

function columnOf(widget: AIChatWidget, key: string): Array<unknown> {
  return rowsOf(widget).map((stored: JSONObject): unknown => {
    return stored[key];
  });
}

// What a cell's words say in a language.
function cellsIn(
  words: AIActionTableWords,
  key: string,
  translator?: Translator,
): Array<string | null> {
  return (words.cells || []).map(
    (cells: Record<string, AIActionTableCell>): string | null => {
      const cell: AIActionTableCell | undefined = cells[key];
      return cell ? describeAIActionTableCell(cell, translator) : null;
    },
  );
}

const PERSIAN_FOUR: string = "۴";
const LATIN_DIGIT: RegExp = /[0-9]/;

describe("the table's title: what it lists, and how many, the count a figure", () => {
  test("every monitor: Monitors, and the count", () => {
    const widget: AIChatWidget = table();

    expect(widget.title).toBe("Monitors (4)");
    expect(widget.data.tableWords?.title).toEqual(
      aiActionSentence(AI_READ_TABLE_TITLES.monitors, {
        count: aiActionFigure(4),
      }),
    );
  });

  test("problemsOnly: Monitors with problems", () => {
    const widget: AIChatWidget = table({
      problemsOnly: true,
      rows: fourMonitors().slice(0, 1),
    });

    expect(widget.title).toBe("Monitors with problems (1)");
    expect(widget.data.tableWords?.title.template).toBe(
      AI_READ_TABLE_TITLES.monitorsWithProblems,
    );
  });

  test("one status: the status as the project named it, data in the sentence", () => {
    const widget: AIChatWidget = table({
      statusName: "Offline",
      rows: fourMonitors().slice(0, 1),
    });

    expect(widget.title).toBe('Monitors in status "Offline" (1)');
    expect(widget.data.tableWords?.title).toEqual(
      aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
        status: "Offline",
        count: aiActionFigure(1),
      }),
    );
  });

  test("a status and problemsOnly together: the title names the status", () => {
    expect(
      table({
        statusName: "Degraded",
        problemsOnly: true,
        rows: fourMonitors().slice(0, 2),
      }).title,
    ).toBe('Monitors in status "Degraded" (2)');
  });

  test("the count is the rows the table holds, written the reader's way", () => {
    const many: Array<JSONObject> = [];
    for (let index: number = 0; index < 50; index++) {
      many.push(row({ name: `m${index}`, type: "Website", status: "Offline" }));
    }

    const widget: AIChatWidget = table({ rows: many });
    expect(widget.title).toBe("Monitors (50)");

    const persian: { title: string } = describeAIActionTableWords(
      widget.data.tableWords!,
      dashboardTranslator("fa"),
    );
    expect(persian.title).toContain("۵۰");
    expect(persian.title).not.toMatch(LATIN_DIGIT);
  });
});

describe("the line under the title: what the table holds, or its order", () => {
  test("with a monitor whose monitoring is off: Disabled ones last", () => {
    const widget: AIChatWidget = table();

    expect(widget.description).toBe("Non-operational first, Disabled last");
    expect(widget.description).toBe(
      MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT,
    );
    expect(widget.data.tableWords?.description).toEqual(
      aiActionSentence(AI_READ_TABLE_LINES.notOperationalFirstDisabledLast),
    );
  });

  test("with none: Disabled is not named", () => {
    const widget: AIChatWidget = table({ rows: fourMonitors().slice(0, 3) });

    expect(widget.description).toBe("Non-operational monitors first");
    expect(widget.description).toBe(MONITOR_TABLE_ORDER_TEXT);
  });

  test("problemsOnly: only non-operational monitors, whatever the rows", () => {
    expect(table({ problemsOnly: true }).description).toBe(
      "Non-operational monitors only",
    );
    expect(MONITOR_TABLE_PROBLEMS_ONLY_TEXT).toBe(
      "Non-operational monitors only",
    );
  });

  test("each line is short enough to read whole beside Open on a phone", () => {
    for (const line of Object.values(AI_READ_TABLE_LINES)) {
      expect({ line, fits: line.length <= 40 }).toEqual({ line, fits: true });
    }
  });

  test("the order line says Disabled in the words its Status column uses", () => {
    expect(MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT).toContain(
      MONITORING_OFF_STATUS_TEXT,
    );
  });
});

describe("the cells that are OneUptime's words", () => {
  test("each monitor's type by the type picker's name for it, as the card's Type fact", () => {
    const widget: AIChatWidget = table();
    const words: AIActionTableWords = widget.data.tableWords!;

    expect(cellsIn(words, "type")).toEqual([
      "Website",
      "Website",
      "API",
      "Incoming Request",
    ]);
    expect(words.cells![3]!["type"]).toEqual(aiActionTerm("Incoming Request"));
    expect(columnOf(widget, "type")).toEqual([
      "Website",
      "Website",
      "API",
      "Incoming Request",
    ]);
  });

  test("a type whose name differs from its stored value is stored by its name: Docker Container, as the card says it", () => {
    const widget: AIChatWidget = table({
      rows: [
        row({ name: "web", type: MonitorType.Docker, status: "Offline" }),
        row({ name: "vm", type: MonitorType.Server, status: "Offline" }),
      ],
    });

    expect(columnOf(widget, "type")).toEqual([
      "Docker Container",
      "Server / VM",
    ]);

    const card: AIActionCardWords = getMonitorCardWords({
      monitorType: MonitorType.Docker,
      statusName: "Offline",
      isMonitoringOff: false,
      isArchived: false,
    });
    expect(widget.data.tableWords!.cells![0]!["type"]).toEqual(
      card.facts![0]!.value,
    );
  });

  test("a type the picker does not list is data, as stored, with no words", () => {
    const widget: AIChatWidget = table({
      rows: [row({ name: "odd", type: "Carrier Pigeon", status: "Offline" })],
    });

    expect(columnOf(widget, "type")).toEqual(["Carrier Pigeon"]);
    expect(widget.data.tableWords!.cells).toEqual([{}]);
  });

  test("a row with no type has no type words, and no type is made up", () => {
    const widget: AIChatWidget = table({
      rows: [row({ name: "untyped", status: "Offline" })],
    });

    expect(rowsOf(widget)[0]).not.toHaveProperty("type");
    expect(widget.data.tableWords!.cells).toEqual([{}]);
  });

  test("a monitor whose monitoring is off says Disabled - the card's word - not the status it was frozen at", () => {
    const widget: AIChatWidget = table();

    expect(columnOf(widget, "currentStatus")).toEqual([
      "Offline",
      "Operational",
      "Operational",
      "Disabled",
    ]);
    expect(widget.data.tableWords!.cells![3]!["currentStatus"]).toEqual(
      aiActionTerm(AI_READ_CARD_VALUES.disabled),
    );
    // The card's line under its name is the same key.
    expect(AI_READ_CARD_VALUES.disabled).toBe(AI_READ_CARD_LINES.disabled);
  });

  test("a status the project named is data: no words for it, ever", () => {
    const widget: AIChatWidget = table({
      rows: [
        row({ name: "a", type: "Website", status: "Offline" }),
        // A project may name a status as one of OneUptime's words.
        row({ name: "b", type: "Website", status: "Disabled" }),
        row({ name: "c", type: "Website", status: "Operational" }),
      ],
    });

    expect(cellsIn(widget.data.tableWords!, "currentStatus")).toEqual([
      null,
      null,
      null,
    ]);
    expect(columnOf(widget, "currentStatus")).toEqual([
      "Offline",
      "Disabled",
      "Operational",
    ]);
  });

  test("a monitor's name is never a word", () => {
    const words: AIActionTableWords = getMonitorsTableWords({
      problemsOnly: false,
      rows: [row({ name: "Website", type: "Website", status: "Offline" })],
    });

    expect(Object.keys(words.cells![0]!)).toEqual(["type"]);
  });

  test("the cells line up with the rows, one entry a row", () => {
    const widget: AIChatWidget = table();

    expect(widget.data.tableWords!.cells).toHaveLength(rowsOf(widget).length);
  });
});

describe("what the table stores: the words in English, and the data as given", () => {
  test("its words are the module's, and its English is those words in English", () => {
    for (const widget of [
      table(),
      table({ problemsOnly: true }),
      table({ statusName: "Offline", rows: fourMonitors().slice(0, 1) }),
    ]) {
      const words: AIActionTableWords = widget.data.tableWords!;

      expect(isKnownAIActionTableWords(words)).toBe(true);
      expect(describeAIActionTableWords(words)).toEqual({
        title: widget.title,
        description: widget.description,
      });

      rowsOf(widget).forEach((stored: JSONObject, index: number): void => {
        for (const [key, cell] of Object.entries(words.cells![index]!)) {
          expect(stored[key]).toBe(describeAIActionTableCell(cell));
        }
      });
    }
  });

  test("a Table, its three columns named as keys, with an Open to the Monitors list", () => {
    const widget: AIChatWidget = table();

    expect(widget.type).toBe(AIChatWidgetType.Table);
    expect(widget.id).toBe("");
    expect(widget.data.columns).toEqual([
      { key: "name", title: "Monitor", type: "text" },
      { key: "type", title: "Type", type: "text" },
      { key: "currentStatus", title: "Status", type: "text" },
    ]);
    expect(widget.data.link).toEqual({
      type: AIChatCitationTargetType.Monitors,
    });
  });

  test("the rest of a row is kept as given: its id, name, colour and flags", () => {
    const given: Array<JSONObject> = fourMonitors();
    const widget: AIChatWidget = table({ rows: given });

    rowsOf(widget).forEach((stored: JSONObject, index: number): void => {
      const original: JSONObject = given[index]!;

      for (const key of [
        "id",
        "name",
        "statusColor",
        "isOperational",
        "monitoringOff",
      ]) {
        expect(stored[key]).toEqual(original[key]);
      }
    });
  });

  test("the rows it was given are not changed: the model reads them as they were", () => {
    const given: Array<JSONObject> = fourMonitors();
    const before: string = JSON.stringify(given);

    table({ rows: given });

    expect(JSON.stringify(given)).toBe(before);
    expect(given[3]!["currentStatus"]).toBe("Operational");
    expect(given[3]!["type"]).toBe(MonitorType.IncomingRequest);
  });
});

describe("in the reader's language", () => {
  function inLanguage(
    widget: AIChatWidget,
    language: string,
  ): {
    title: string;
    description?: string | undefined;
    types: Array<string | null>;
    statuses: Array<string | null>;
  } {
    const translator: Translator = dashboardTranslator(language);
    const words: AIActionTableWords = widget.data.tableWords!;

    return {
      ...describeAIActionTableWords(words, translator),
      types: cellsIn(words, "type", translator),
      statuses: cellsIn(words, "currentStatus", translator),
    };
  }

  test("German: Monitore, the order line, the types and Deaktiviert - as the card says them", () => {
    const de: Record<string, string> = readDashboardLocale("de");

    expect(inLanguage(table(), "de")).toEqual({
      title: "Monitore (4)",
      description: de["Non-operational first, Disabled last"],
      types: [de["Website"], de["Website"], de["API"], "Eingehende Anfrage"],
      statuses: [null, null, null, "Deaktiviert"],
    });

    const card: { line?: string | undefined } = describeAIActionCardWords(
      getMonitorCardWords({
        monitorType: MonitorType.IncomingRequest,
        statusName: "Operational",
        isMonitoringOff: true,
        isArchived: false,
      }),
      dashboardTranslator("de"),
    );
    expect(card.line).toBe("Deaktiviert");
  });

  test("Persian: the count in Persian digits, the words Persian, the status the project named as named", () => {
    const fa: Record<string, string> = readDashboardLocale("fa");
    const persian: ReturnType<typeof inLanguage> = inLanguage(
      table({ statusName: "Offline", rows: fourMonitors().slice(0, 4) }),
      "fa",
    );

    expect(persian.title).toBe(
      fa['Monitors in status "{{status}}" ({{count}})']!.split("{{status}}")
        .join("Offline")
        .split("{{count}}")
        .join(PERSIAN_FOUR),
    );
    expect(persian.statuses).toEqual([null, null, null, fa["Disabled"]]);
    expect(persian.types[3]).toBe(fa["Incoming Request"]);
  });

  test("a status the project named stays as named in German too, even when it is one of OneUptime's words", () => {
    expect(
      inLanguage(
        table({
          statusName: "Operational",
          rows: [row({ name: "a", type: "Website", status: "Operational" })],
        }),
        "de",
      ).title,
    ).toBe("Monitore mit Status „Operational“ (1)");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every title, line and Disabled, with their placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        ...Object.values(AI_READ_TABLE_TITLES),
        ...Object.values(AI_READ_TABLE_LINES),
        AI_READ_CARD_VALUES.disabled,
      ]) {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
        expect(placeholdersOf(words[key]!)).toEqual(placeholdersOf(key));
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s says Disabled in its order line by the word its Status column says",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const disabled: string = words[AI_READ_CARD_VALUES.disabled]!;

      expect(
        words[AI_READ_TABLE_LINES.notOperationalFirstDisabledLast],
      ).toContain(disabled);
    },
  );

  test("a negative control: a key left in English is caught as not worded", () => {
    expect(isWordedInDashboardLocale("Monitors ({{count}})", "de")).toBe(true);
    expect(
      isWordedInDashboardLocale("This sentence is in no locale file.", "de"),
    ).toBe(false);
  });
});
