/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import DataTableWidget from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/DataTableWidget";
import {
  formatTableCell,
  getChatTableCellText,
} from "../../../UI/Utils/AIChatExport/ChatWidgetData";
import { AIChatWidget, AIChatWidgetType } from "../../../Types/AI/AIChatTypes";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";

/*
 * ONEUPTIME AI'S TABLES: A DATE AS EVERY TABLE WRITES ONE, AND COLUMN
 * NAMES IN THE READER'S LANGUAGE.
 *
 * A tool's table wrote each date whole - "Oct 14 2026, 11:57 GMT · 3
 * minutes ago" - which took a third of the 768 px chat panel, its year and
 * zone the same on every row; and its column names read in English in
 * every language. A date is short in its cell now, as Table/TableDate
 * writes one, and whole under the pointer with how long ago it was; and a
 * column's name is looked up by its English, which the tools mark as keys
 * (ChatTableColumnTitles holds every tool and locale to that).
 *
 * The exports (markdown, PDF) write the whole date, without "ago": a
 * document is read later and elsewhere.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// 7 October 2026, 13:05 UTC: 14:05 in London (BST).
const THIS_YEAR_ISO: string = "2026-10-07T13:05:00.000Z";
const LAST_YEAR_ISO: string = "2025-12-30T22:10:00.000Z";
const NOW: Date = new Date("2026-10-22T06:25:00.000Z");

// What OneUptime AI's Security Events tool hands the chat (SecurityEventTools).
function securityEventsTable(): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Security Events (2)",
    data: {
      columns: [
        { key: "time", title: "Time", type: "date" },
        { key: "severity", title: "Severity", type: "text" },
        { key: "eventShown", title: "Event", type: "text" },
        { key: "principalHost", title: "Host", type: "text" },
        { key: "count", title: "Count", type: "number" },
        // A name a tool builds from what it read: drawn as written.
        { key: "service.name", title: "service.name", type: "text" },
      ],
      rows: [
        {
          time: THIS_YEAR_ISO,
          severity: "High",
          eventShown: "Brute force from one address",
          principalHost: "web-01",
          count: 1234,
          "service.name": "checkout",
        },
        {
          time: LAST_YEAR_ISO,
          severity: "Low",
          eventShown: "Sign-in",
          principalHost: "web-02",
          count: 2,
          "service.name": "checkout",
        },
      ],
    },
  };
}

function headerTexts(): Array<string> {
  return screen
    .getAllByRole("columnheader")
    .map((cell: HTMLElement): string => {
      return (cell.textContent || "").trim();
    });
}

beforeAll(async () => {
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  jest.spyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(true);
  // "This year" is 2026 here, and "ago" is counted from NOW.
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
      ja: { translation: readLocale("ja") },
    },
    interpolation: { escapeValue: false },
  });
  // As the Dashboard does: dates follow the reader's language.
  followLanguageForDates(i18next);
});

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("a date in OneUptime AI's table", () => {
  test("this year's: short in its cell, whole under the pointer with how long ago it was", () => {
    // The zone this suite asked for is the one it runs in.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");

    render(<DataTableWidget widget={securityEventsTable()} />);

    const cell: HTMLElement = screen.getAllByTestId("ai-chat-table-cell")[0]!;
    const time: HTMLElement = within(cell).getByText("Oct 7, 2:05 PM");

    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", THIS_YEAR_ISO);
    expect(cell).toHaveAttribute(
      "title",
      "Oct 07 2026, 02:05 PM BST · 15 days ago",
    );
    // One line, never cut: no clamp, no zone and no year in the cell.
    expect(cell).toHaveClass("whitespace-nowrap");
    expect(cell).not.toHaveTextContent("2026");
    expect(cell).not.toHaveTextContent("BST");
    expect(cell).not.toHaveTextContent("ago");
  });

  test("another year's: its day with its year, the time under the pointer", () => {
    render(<DataTableWidget widget={securityEventsTable()} />);

    const cell: HTMLElement = screen.getAllByTestId("ai-chat-table-cell")[6]!;

    expect(cell).toHaveTextContent("Dec 30, 2025");
    expect(cell.getAttribute("title")).toMatch(/^Dec 30 2025, 10:10 PM GMT · /);
  });

  test("a value that is not a date is shown as it came, and an empty one as a dash", () => {
    expect(
      getChatTableCellText("not a date", {
        key: "time",
        title: "Time",
        type: "date",
      }),
    ).toEqual({ text: "not a date", fullText: "not a date" });
    expect(
      getChatTableCellText(42, { key: "time", title: "Time", type: "date" }),
    ).toEqual({ text: "42", fullText: "42" });
    expect(
      getChatTableCellText("", { key: "time", title: "Time", type: "date" }),
    ).toEqual({ text: "—", fullText: "—" });
    expect(
      getChatTableCellText(null, { key: "time", title: "Time", type: "date" }),
    ).toEqual({ text: "—", fullText: "—" });
  });

  test("numbers and text keep what they showed: a grouped number, text as written", () => {
    expect(
      getChatTableCellText(1234, { key: "n", title: "Count", type: "number" }),
    ).toEqual({
      text: (1234).toLocaleString(),
      fullText: (1234).toLocaleString(),
    });
    expect(getChatTableCellText("web-01", { key: "h", title: "Host" })).toEqual(
      { text: "web-01", fullText: "web-01" },
    );
  });

  test("the exports write the whole date - year and zone - and no 'ago', which a document read later would get wrong", () => {
    expect(
      formatTableCell(THIS_YEAR_ISO, {
        key: "time",
        title: "Time",
        type: "date",
      }),
    ).toBe("Oct 07 2026, 02:05 PM BST");
    expect(
      formatTableCell("not a date", {
        key: "time",
        title: "Time",
        type: "date",
      }),
    ).toBe("not a date");
  });

  test("in German, the short date is German too", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(<DataTableWidget widget={securityEventsTable()} />);

    const cell: HTMLElement = screen.getAllByTestId("ai-chat-table-cell")[0]!;
    const text: string = cell.querySelector("time")?.textContent || "";

    // German's month, as every German table writes it, still without a year.
    expect(text).toContain("Okt.");
    expect(text).not.toContain("2026");
    expect(text).toBe(OneUptimeDate.getDateAsCompactLocalString(THIS_YEAR_ISO));
    // And how long ago it was, under the pointer, in German.
    expect(cell.getAttribute("title")).toContain("vor 15 Tagen");
  });
});

describe("the column names of OneUptime AI's table", () => {
  test("in English, as the tool named them", () => {
    render(<DataTableWidget widget={securityEventsTable()} />);

    expect(headerTexts()).toEqual([
      "Time",
      "Severity",
      "Event",
      "Host",
      "Count",
      "service.name",
    ]);
  });

  test.each([
    ["de", ["Zeit", "Schweregrad", "Ereignis", "Host", "Anzahl"]],
    ["fa", ["زمان", "شدت", "رویداد", "میزبان", "تعداد"]],
  ] as Array<[string, Array<string>]>)(
    "in %s, in the reader's language - a name the tool built from what it read stays as written",
    async (language: string, names: Array<string>) => {
      await act(async (): Promise<void> => {
        await i18next.changeLanguage(language);
      });

      render(<DataTableWidget widget={securityEventsTable()} />);

      const locale: Record<string, unknown> = readLocale(language);

      // Each name is the locale's own word for it, as the Dashboard draws it.
      expect(headerTexts().slice(0, 5)).toEqual(
        ["Time", "Severity", "Event", "Host", "Count"].map(
          (title: string): string => {
            return String(locale[title]);
          },
        ),
      );
      expect(headerTexts().slice(0, 5)).toEqual(names);
      expect(headerTexts()[5]).toBe("service.name");
    },
  );

  test("a column's resize edge is named as its header reads", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("ja");
    });

    render(<DataTableWidget widget={securityEventsTable()} />);

    const locale: Record<string, unknown> = readLocale("ja");
    const severity: string = String(locale["Severity"]);
    const header: HTMLElement = screen.getAllByRole("columnheader")[1]!;

    expect(header).toHaveTextContent(severity);
    // The edge is named after the header as drawn, in the reader's words.
    const edge: HTMLElement = within(header).getByRole("separator");
    expect(edge.getAttribute("aria-label")).toContain(severity);
    expect(edge.getAttribute("aria-label")).not.toContain("Severity");
  });
});
