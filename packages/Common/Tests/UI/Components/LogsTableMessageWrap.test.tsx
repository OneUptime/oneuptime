import LogsTable, {
  LOGS_TABLE_MESSAGE_CLASS_NAME,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import Log from "../../../Models/AnalyticsModels/Log";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * A LOG'S MESSAGE STAYS INSIDE THE LIST.
 *
 * The list is a table, and a table's column is never narrower than the
 * widest thing its cells cannot break. RDS for PostgreSQL opens every line
 * with one long run - its time, client, user, database and process,
 * "UTC:10.0.1.23(52344):orders_app@orders:[23817]:LOG:" - so with
 * break-words (which does not count toward that width) the message column
 * grew past the list's edge, and a resource's Logs page showed a sliver of
 * each line, the rest off to the side. The message breaks such a run where
 * it must ([overflow-wrap:anywhere]) and keeps its own line breaks - and
 * never gets narrower than 8rem: breaking anywhere let a phone's list
 * squeeze the column to a letter a line, every row a screen tall.
 *
 * jsdom lays nothing out, so this pins the classes;
 * packages/E2E/CloudConnect measures the page in a browser.
 */

const RDS_LINE: string =
  "2026-11-06 09:58:12 UTC:10.0.1.23(52344):orders_app@orders:[23817]:LOG:  duration: 2384.112 ms  statement: SELECT o.id FROM orders o";

afterEach(() => {
  cleanup();
});

function renderMessage(body: string): HTMLElement {
  const log: Log = new Log();
  log.body = body;
  log.time = new Date("2026-11-06T09:58:12.000Z");

  render(
    <LogsTable
      logs={[log]}
      serviceMap={{}}
      isLoading={false}
      onRowClick={() => {}}
      selectedColumns={["time", "severity", "message"]}
    />,
  );

  /*
   * The message's paragraph: the line itself, read its own way inside. Its
   * title is the line as written, double spaces and all, so it is matched
   * as it is.
   */
  return screen.getByTitle(body, {
    normalizer: (text: string): string => {
      return text;
    },
  });
}

describe("a log's message in the list", () => {
  test("breaks a run too long for its column where it must, so the column keeps to the list", () => {
    const message: HTMLElement = renderMessage(RDS_LINE);
    const classes: Array<string> = message.className.split(" ");

    expect(message.tagName).toBe("P");
    expect(message.className).toBe(LOGS_TABLE_MESSAGE_CLASS_NAME);
    expect(classes).toContain("[overflow-wrap:anywhere]");
    // break-words lets the run set the column's least width: it is not used.
    expect(classes).not.toContain("break-words");
  });

  test("never narrower than 8rem: a narrow list cannot squeeze it to a letter a line", () => {
    const message: HTMLElement = renderMessage("Payment failed");

    expect(message.className.split(" ")).toContain("min-w-[8rem]");
  });

  test("keeps the line's own breaks and spaces, and all of it", () => {
    const multiline: string = "Payment failed\n  at charge (pay.js:12)";
    const message: HTMLElement = renderMessage(multiline);

    expect(message.className.split(" ")).toContain("whitespace-pre-wrap");
    expect(message.textContent).toBe(multiline);
  });

  test("the whole line is in its title, as written", () => {
    const message: HTMLElement = renderMessage(RDS_LINE);

    expect(message).toHaveAttribute("title", RDS_LINE);
    expect(message.textContent).toBe(RDS_LINE);
  });
});
