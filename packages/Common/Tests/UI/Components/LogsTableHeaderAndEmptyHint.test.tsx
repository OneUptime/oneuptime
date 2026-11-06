import LogsTable, {
  LOGS_TABLE_EMPTY_HINT,
  LOGS_TABLE_EMPTY_HINT_CLASS_NAME,
  LOGS_TABLE_SORT_BUTTON_CLASS_NAME,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import Log from "../../../Models/AnalyticsModels/Log";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * A LOGS LIST'S HEADER, AND THE LINE UNDER "NO LOGS FOUND".
 *
 * The header row is set in capitals (SERVICE, MESSAGE), but Time and
 * Severity, the two a person sorts by, are buttons - and Tailwind's base
 * styles give a button `text-transform: none` - so they read "Time" and
 * "Severity" beside "SERVICE" and "MESSAGE", in every logs list and every
 * language. Each sort button now says it in capitals itself, from CSS: its
 * text stays as written, for screen readers and for the translation.
 *
 * Under "No logs found" the list draws one line, often a page's instruction
 * - how a cloud resource's logs arrive, what to check once they do. It was
 * gray 400 on white, 2.5:1, under the 4.5:1 small text needs: it is gray
 * 500 now (4.8:1), and its lines are balanced, so a long sentence does not
 * leave its last word alone on a line ("Cloud > / Connect.").
 *
 * jsdom applies no Tailwind, so this pins the classes;
 * packages/E2E/CloudConnect reads the drawn header in a browser.
 */

const PAGE_SENTENCE: string =
  "Nothing arrived from this resource's log group in this time range. Choose a longer range, or check that its account streams this log group: in Cloud > Connect, open Stream metrics and logs in the account's row.";

afterEach(() => {
  cleanup();
});

function aLog(): Log {
  const log: Log = new Log();
  log.body = "checkpoint starting: time";
  log.time = new Date("2026-11-06T09:58:12.000Z");
  log.severityText = "Information";
  return log;
}

function renderList(props: {
  logs: Array<Log>;
  emptyMessage?: string | undefined;
}): void {
  render(
    <LogsTable
      logs={props.logs}
      serviceMap={{}}
      isLoading={false}
      onRowClick={() => {}}
      selectedColumns={["time", "service", "severity", "message"]}
      emptyMessage={props.emptyMessage}
      sortField="time"
      onSortChange={() => {}}
    />,
  );
}

function headerRow(): HTMLElement {
  return screen.getByRole("table").querySelector("thead tr") as HTMLElement;
}

describe("a logs list's header", () => {
  test("every header of the row is in capitals: the row's own, and the sort buttons' own", () => {
    renderList({ logs: [aLog()] });

    const row: HTMLElement = headerRow();
    expect(row.className.split(" ")).toContain("uppercase");

    const buttons: Array<HTMLElement> = within(row).getAllByRole("button");
    // Time and Severity: the columns a person sorts by.
    expect(
      buttons.map((button: HTMLElement): string => {
        return button.textContent || "";
      }),
    ).toEqual(["Time", "Severity"]);

    for (const button of buttons) {
      /*
       * A button does not take the row's text-transform (Tailwind's base
       * styles reset it): it carries its own.
       */
      expect(button.className.split(" ")).toContain("uppercase");
      expect(
        button.className.startsWith(LOGS_TABLE_SORT_BUTTON_CLASS_NAME),
      ).toBe(true);
    }
  });

  test("the capitals come from CSS: each header's text and its sort state stay as written", () => {
    renderList({ logs: [aLog()] });

    const time: HTMLElement = within(headerRow()).getByRole("button", {
      name: "Time",
    });
    expect(time).toHaveAttribute("aria-sort", "descending");

    const severity: HTMLElement = within(headerRow()).getByRole("button", {
      name: "Severity",
    });
    expect(severity).toHaveAttribute("aria-sort", "none");

    for (const title of ["Service", "Message"]) {
      expect(
        within(headerRow()).getByRole("columnheader", { name: title }),
      ).toBeInTheDocument();
    }
  });

  test("a sort button keeps the header row's look: the same weight, tracking and gray", () => {
    for (const token of [
      "font-semibold",
      "uppercase",
      "tracking-wider",
      "text-gray-500",
      "hover:text-gray-700",
    ]) {
      expect(LOGS_TABLE_SORT_BUTTON_CLASS_NAME.split(" ")).toContain(token);
    }
  });
});

describe("the line under 'No logs found'", () => {
  test("a page's sentence reads at gray 500, balanced, under the title", () => {
    renderList({ logs: [], emptyMessage: PAGE_SENTENCE });

    const empty: HTMLElement = screen.getByTestId("logs-table-empty");
    const title: HTMLElement = within(empty).getByText("No logs found");
    const line: HTMLElement = within(empty).getByText(PAGE_SENTENCE);

    expect(line.tagName).toBe("P");
    expect(line.className).toBe(LOGS_TABLE_EMPTY_HINT_CLASS_NAME);
    expect(
      title.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const classes: Array<string> = line.className.split(" ");
    expect(classes).toContain("text-gray-500");
    // Gray 400 on white is 2.5:1, under what small text needs.
    expect(classes).not.toContain("text-gray-400");
    expect(classes).toContain("text-balance");
    expect(classes).toContain("max-w-xl");
  });

  test("the list's own hint, when a page says nothing, is drawn the same way", () => {
    renderList({ logs: [] });

    const line: HTMLElement = within(
      screen.getByTestId("logs-table-empty"),
    ).getByText(LOGS_TABLE_EMPTY_HINT);

    expect(line.className).toBe(LOGS_TABLE_EMPTY_HINT_CLASS_NAME);
  });

  test("gray 500 has its dark-mode color, as every muted line does", () => {
    const theme: string = fs.readFileSync(
      path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
      "utf8",
    );

    expect(theme).toContain("html.dark :is(.text-gray-500, .text-slate-500)");
  });
});
