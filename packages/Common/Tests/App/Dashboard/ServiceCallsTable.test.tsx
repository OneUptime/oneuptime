import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The services table of a queue's Producers and Consumers and a database's
 * Calling services (ServiceCallsTable).
 *
 * "A message queue's Consumers table header 'P95 PROCESSING' runs past its
 * card when the two cards share a row at 1280." It was twelve equal tracks,
 * two for each figure: 58px for "P95 PROCESSING" in a 425px card. These pin
 * what the table is now - one grid whose columns are as wide as their words
 * and values, the service's name in what they leave, every row a subgrid of
 * those columns, laid out by the table's own width - and what it says to a
 * screen reader. The browser half (every name and figure inside its card at
 * 390 to 1440px, in English and German, light and dark) is in
 * E2E/ResourceOverviews.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import ServiceCallsTable, {
  SERVICE_CALLS_ERRORS_HEADER,
  SERVICE_CALLS_NAME_HEADER,
  ServiceCallsTableRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceCalls/ServiceCallsTable";
import {
  SERVICE_CALLS_FIGURE_CELL_CLASS_NAME,
  SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME,
  SERVICE_CALLS_FOOTER_CLASS_NAME,
  SERVICE_CALLS_GRID_CLASS_NAME,
  SERVICE_CALLS_HEADER_CLASS_NAME,
  SERVICE_CALLS_NAMES_ON_ONE_LINE_FROM_IN_REM,
  SERVICE_CALLS_NAME_CELL_CLASS_NAME,
  SERVICE_CALLS_NAME_HEADER_CLASS_NAME,
  SERVICE_CALLS_ONE_LINE_FROM_IN_REM,
  SERVICE_CALLS_ROW_CLASS_NAME,
  SERVICE_CALLS_TABLE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ServiceCalls/ServiceCallsTableLayout";
import Route from "../../../Types/API/Route";
import { resolveSpacing } from "../../ResponsiveSpacing";
import { CARD_PADDING_CLASS_NAME } from "../../../UI/Components/Card/Card";

afterEach(() => {
  cleanup();
});

const CHECKOUT: string = "3c0e7b2a-1111-4111-8111-000000000001";
const DELETED: string = "3c0e7b2a-1111-4111-8111-000000000002";
const LONG: string = "3c0e7b2a-1111-4111-8111-000000000003";
const LONG_NAME: string =
  "order-fulfillment-orchestrator-eu-west-2-canary-green";

const ROWS: Array<ServiceCallsTableRow> = [
  {
    serviceId: CHECKOUT,
    name: "checkout-api",
    route: new Route(`/dashboard/p/service/${CHECKOUT}`),
    calls: "1.2k",
    errorRate: "1.0%",
    duration: "3.3 ms",
  },
  {
    serviceId: DELETED,
    name: null,
    calls: "312",
    errorRate: "0.0%",
    duration: "1.84 s",
  },
  {
    serviceId: LONG,
    name: LONG_NAME,
    route: new Route(`/dashboard/p/service/${LONG}`),
    calls: "2.3M",
    errorRate: "5.3%",
    duration: "12.48 s",
  },
];

function renderTable(
  props: Partial<React.ComponentProps<typeof ServiceCallsTable>> = {},
): void {
  render(
    <MemoryRouter>
      <ServiceCallsTable
        rows={ROWS}
        countHeader="Consumed"
        durationHeader="p95 processing"
        dataTestId="message-queue-consumers"
        rowTestId="message-queue-consumers-row"
        footerTestId="message-queue-consumers-footer"
        {...props}
      />
    </MemoryRouter>,
  );
}

function tokens(className: string): Array<string> {
  return className.split(" ").filter(Boolean);
}

describe("what the table says", () => {
  test("one header row names the columns once: the service, the side's count, errors and its duration", () => {
    renderTable();

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      });

    expect(headers).toEqual([
      SERVICE_CALLS_NAME_HEADER,
      "Consumed",
      SERVICE_CALLS_ERRORS_HEADER,
      "p95 processing",
    ]);
    expect([SERVICE_CALLS_NAME_HEADER, SERVICE_CALLS_ERRORS_HEADER]).toEqual([
      "Service",
      "Errors",
    ]);
    // Said once each, on a phone too: no column name is repeated per row.
    for (const header of ["Consumed", "Errors", "p95 processing"]) {
      expect(screen.getAllByText(header)).toHaveLength(1);
    }
  });

  test("each service is a row of a table: its name as the row's header, then its three figures", () => {
    renderTable();

    expect(screen.getByRole("table")).toBeInTheDocument();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-consumers-row",
    );

    expect(rows).toHaveLength(3);
    expect(
      rows.map((row: HTMLElement): Array<string> => {
        return [
          row.getAttribute("data-service-id") || "",
          within(row).getByRole("rowheader").textContent || "",
          ...within(row)
            .getAllByRole("cell")
            .map((cell: HTMLElement): string => {
              return cell.textContent || "";
            }),
        ];
      }),
    ).toEqual([
      [CHECKOUT, "checkout-api", "1.2k", "1.0%", "3.3 ms"],
      [DELETED, DELETED, "312", "0.0%", "1.84 s"],
      [LONG, LONG_NAME, "2.3M", "5.3%", "12.48 s"],
    ]);
    for (const row of rows) {
      expect(row).toHaveAttribute("role", "row");
    }
  });

  test("a named service links to its page, read the way its name is written; a service nothing names shows its id, not a link", () => {
    renderTable();

    const [checkout, deleted] = screen.getAllByTestId(
      "message-queue-consumers-row",
    ) as [HTMLElement, HTMLElement];
    const link: HTMLElement = within(checkout).getByRole("link");

    expect(link).toHaveAttribute("href", `/dashboard/p/service/${CHECKOUT}`);
    expect(link).toHaveTextContent("checkout-api");
    // A name somebody gave it, isolated as every written value is.
    expect(link.querySelector("bdi")).toHaveTextContent("checkout-api");
    expect(within(deleted).queryByRole("link")).toBeNull();
    expect(within(deleted).getByText(DELETED)).toHaveClass("font-mono");
  });

  test("every figure reads the way it is written: a duration's unit stays after its number on a page read right to left", () => {
    renderTable();

    const [checkout, deleted] = screen.getAllByTestId(
      "message-queue-consumers-row",
    ) as [HTMLElement, HTMLElement];

    // Each figure is isolated, as a written value is, and never split up.
    const figures: Array<[string, string | null]> = within(checkout)
      .getAllByRole("cell")
      .map((cell: HTMLElement): [string, string | null] => {
        const isolate: HTMLElement | null = cell.querySelector("bdi");

        expect(isolate).not.toBeNull();
        expect(isolate!.textContent).toBe(cell.textContent);

        return [isolate!.textContent || "", isolate!.getAttribute("dir")];
      });

    /*
     * One with a unit or a suffix reads left to right in a Persian page
     * ("3.3 ms", not "ms 3.3"); a bare number or percentage takes its
     * isolate's own direction, which keeps it whole.
     */
    expect(figures).toEqual([
      ["1.2k", "ltr"],
      ["1.0%", null],
      ["3.3 ms", "ltr"],
    ]);
    expect(
      within(deleted)
        .getAllByRole("cell")
        .map((cell: HTMLElement): string | null => {
          return cell.querySelector("bdi")?.getAttribute("dir") ?? null;
        }),
    ).toEqual([null, null, "ltr"]);
  });

  test("a name cut short to its column says itself whole under the pointer", () => {
    renderTable();

    for (const row of ROWS) {
      const cell: HTMLElement = within(
        screen
          .getAllByTestId("message-queue-consumers-row")
          .find((element: HTMLElement): boolean => {
            return element.getAttribute("data-service-id") === row.serviceId;
          })!,
      ).getByRole("rowheader");

      expect(cell).toHaveAttribute("title", row.name || row.serviceId);
      expect(cell).toHaveClass("truncate", "min-w-0");
    }
  });

  test("the footer says how many services the table leaves out, under it - and nothing when it leaves none", () => {
    renderTable({
      footer: "Showing the 10 busiest of 12 consuming services.",
    });

    const footer: HTMLElement = screen.getByTestId(
      "message-queue-consumers-footer",
    );

    expect(footer).toHaveTextContent(
      "Showing the 10 busiest of 12 consuming services.",
    );
    expect(footer.getAttribute("class")).toBe(SERVICE_CALLS_FOOTER_CLASS_NAME);
    // After the table, not a row of it.
    expect(screen.getByRole("table").contains(footer)).toBe(false);

    cleanup();
    renderTable({ footer: "" });
    expect(screen.queryByTestId("message-queue-consumers-footer")).toBeNull();
  });
});

describe("how the table is laid out", () => {
  test("the class names, exactly", () => {
    expect(SERVICE_CALLS_TABLE_CLASS_NAME).toBe(
      "-mx-5 -mb-6 -mt-2 border-t border-gray-200 md:-mx-6 [container-type:inline-size]",
    );
    expect(SERVICE_CALLS_GRID_CLASS_NAME).toBe(
      "grid grid-cols-[repeat(3,minmax(min-content,1fr))] gap-x-4 divide-y divide-gray-100 [@container(min-width:26rem)]:grid-cols-[minmax(0,1fr)_repeat(3,fit-content(6rem))] [@container(min-width:34rem)]:grid-cols-[minmax(0,1fr)_repeat(3,minmax(6rem,auto))]",
    );
    expect(SERVICE_CALLS_HEADER_CLASS_NAME).toBe(
      "col-span-full grid grid-cols-subgrid px-4 bg-gray-50 py-2 text-xs font-medium uppercase tracking-wider text-gray-500",
    );
    expect(SERVICE_CALLS_ROW_CLASS_NAME).toBe(
      "col-span-full grid grid-cols-subgrid px-4 gap-y-1 py-3 text-sm",
    );
    expect(SERVICE_CALLS_NAME_HEADER_CLASS_NAME).toBe(
      "sr-only self-end [@container(min-width:26rem)]:not-sr-only",
    );
    expect(SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME).toBe(
      "self-end text-right [overflow-wrap:normal] [word-break:keep-all]",
    );
    expect(SERVICE_CALLS_NAME_CELL_CLASS_NAME).toBe(
      "col-span-3 min-w-0 truncate [contain:inline-size] [@container(min-width:26rem)]:col-span-1",
    );
    expect(SERVICE_CALLS_FIGURE_CELL_CLASS_NAME).toBe(
      "whitespace-nowrap text-right tabular-nums text-gray-700",
    );
  });

  test("it draws with them: a size container, one grid, a subgrid row for the names and one per service", () => {
    renderTable();

    const box: HTMLElement = screen.getByTestId("message-queue-consumers");
    const grid: HTMLElement = screen.getByRole("table");
    const [header, ...rows] = Array.from(grid.children) as Array<HTMLElement>;

    expect(box.getAttribute("class")).toBe(SERVICE_CALLS_TABLE_CLASS_NAME);
    expect(grid.parentElement).toBe(box);
    expect(grid.getAttribute("class")).toBe(SERVICE_CALLS_GRID_CLASS_NAME);
    expect(header!.getAttribute("class")).toBe(SERVICE_CALLS_HEADER_CLASS_NAME);
    expect(rows).toHaveLength(ROWS.length);
    for (const row of rows) {
      expect(row.getAttribute("class")).toBe(SERVICE_CALLS_ROW_CLASS_NAME);
      expect(within(row).getByRole("rowheader").getAttribute("class")).toBe(
        SERVICE_CALLS_NAME_CELL_CLASS_NAME,
      );
      for (const cell of within(row).getAllByRole("cell")) {
        expect(cell.getAttribute("class")).toBe(
          SERVICE_CALLS_FIGURE_CELL_CLASS_NAME,
        );
      }
    }
    const [nameHeader, ...figureHeaders] = within(header!).getAllByRole(
      "columnheader",
    );
    expect(nameHeader!.getAttribute("class")).toBe(
      SERVICE_CALLS_NAME_HEADER_CLASS_NAME,
    );
    for (const figureHeader of figureHeaders) {
      expect(figureHeader.getAttribute("class")).toBe(
        SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME,
      );
    }
  });

  test("no figure's column is a fixed share of the table any more: each is as wide as its words and values", () => {
    for (const className of [
      SERVICE_CALLS_GRID_CLASS_NAME,
      SERVICE_CALLS_HEADER_CLASS_NAME,
      SERVICE_CALLS_ROW_CLASS_NAME,
      SERVICE_CALLS_NAME_CELL_CLASS_NAME,
      SERVICE_CALLS_FIGURE_CELL_CLASS_NAME,
    ]) {
      expect(className).not.toMatch(TWELVE_TRACKS);
    }
    // Rows share the grid's columns, so a figure lines up from row to row.
    expect(tokens(SERVICE_CALLS_ROW_CLASS_NAME)).toEqual(
      expect.arrayContaining(["col-span-full", "grid", "grid-cols-subgrid"]),
    );
    expect(tokens(SERVICE_CALLS_HEADER_CLASS_NAME)).toEqual(
      expect.arrayContaining(["col-span-full", "grid", "grid-cols-subgrid"]),
    );
    // The column gap is the grid's: no subgrid sets its own.
    expect(tokens(SERVICE_CALLS_GRID_CLASS_NAME)).toContain("gap-x-4");
    for (const className of [
      SERVICE_CALLS_HEADER_CLASS_NAME,
      SERVICE_CALLS_ROW_CLASS_NAME,
    ]) {
      expect(className).not.toMatch(OWN_GAP);
    }
    // A figure stays whole; a column's name breaks between words only.
    expect(tokens(SERVICE_CALLS_FIGURE_CELL_CLASS_NAME)).toContain(
      "whitespace-nowrap",
    );
    expect(SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME).toContain(
      "[overflow-wrap:normal]",
    );
    expect(SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME).not.toMatch(BREAKS_WORDS);
  });

  test("its steps follow its own width, whole two-digit rems that sort as text in the order of their widths", () => {
    const steps: Array<number> = [];

    for (const token of tokens(SERVICE_CALLS_GRID_CLASS_NAME)) {
      const match: RegExpExecArray | null = CONTAINER_STEP.exec(token);

      if (match) {
        steps.push(Number(match[1]));
      }
    }

    expect(steps).toEqual([
      SERVICE_CALLS_ONE_LINE_FROM_IN_REM,
      SERVICE_CALLS_NAMES_ON_ONE_LINE_FROM_IN_REM,
    ]);
    expect(steps).toEqual([26, 34]);

    const asWritten: Array<string> = steps.map((step: number): string => {
      return "[@container(min-width:" + step + "rem)]";
    });

    expect([...asWritten].sort()).toEqual(asWritten);
    for (const step of steps) {
      expect([
        step,
        Number.isInteger(step) && step >= 10 && step < 100,
      ]).toEqual([step, true]);
    }
    // Never the window's breakpoints: a card beside another is a tablet's width at 1280.
    expect(SERVICE_CALLS_GRID_CLASS_NAME).not.toMatch(WINDOW_COLUMNS);
    expect(SERVICE_CALLS_NAME_CELL_CLASS_NAME).not.toMatch(WINDOW_COLUMNS);
  });

  test("a service is two lines on a phone - its name across the table, its figures under the column names - and one line from 26rem", () => {
    /*
     * Three columns on a phone, shared evenly but never narrower than a
     * column's longest word or value: the name spans them, the figures
     * fill them, and the name's own width never widens them.
     */
    expect(tokens(SERVICE_CALLS_GRID_CLASS_NAME)).toContain(
      "grid-cols-[repeat(3,minmax(min-content,1fr))]",
    );
    expect(tokens(SERVICE_CALLS_NAME_CELL_CLASS_NAME)).toContain(
      "[contain:inline-size]",
    );
    expect(tokens(SERVICE_CALLS_NAME_CELL_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "col-span-3",
        "[@container(min-width:26rem)]:col-span-1",
      ]),
    );
    // The names' column header is for a screen reader until there is a column.
    expect(tokens(SERVICE_CALLS_NAME_HEADER_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "sr-only",
        "[@container(min-width:26rem)]:not-sr-only",
      ]),
    );
  });

  test("it reaches the card's edges, as the card's padding is: 20px across on a phone, 24px from md up, and 24px under it", () => {
    for (const width of [390, 767, 768, 1024, 1280]) {
      const table: ReturnType<typeof resolveSpacing> = resolveSpacing(
        SERVICE_CALLS_TABLE_CLASS_NAME,
        width,
        "margin",
      );
      const card: ReturnType<typeof resolveSpacing> = resolveSpacing(
        CARD_PADDING_CLASS_NAME,
        width,
        "padding",
      );

      expect({
        width,
        left: -table.left,
        right: -table.right,
        bottom: -table.bottom,
      }).toEqual({
        width,
        left: card.left,
        right: card.right,
        bottom: card.bottom,
      });
    }
  });
});

describe("the cards draw the shared table", () => {
  const DASHBOARD: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );

  test.each([
    "Components/MessageQueue/MessageQueueServicesCard.tsx",
    "Components/DatabaseServer/DatabaseCallingServicesCard.tsx",
  ])(
    "%s draws its services with ServiceCallsTable, not a grid of its own",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD, file),
        "utf8",
      );

      expect(source).toContain("<ServiceCallsTable");
      expect(source).not.toMatch(TWELVE_TRACKS);
      expect(source).not.toMatch(SHARE_OF_TWELVE);
    },
  );
});

// A grid of twelve equal tracks, as the table was.
const TWELVE_TRACKS: RegExp = /grid-cols-12/;

// A column given a share of those tracks.
const SHARE_OF_TWELVE: RegExp = /col-span-(2|3|5|6)\b/;

// A gap a row of the grid would set for itself.
const OWN_GAP: RegExp = /(^| )gap-(x-)?\d/;

// A rule that breaks a word anywhere.
const BREAKS_WORDS: RegExp = /break-all|break-words|overflow-wrap:anywhere/;

// One of the grid's container steps.
const CONTAINER_STEP: RegExp =
  /^\[@container\(min-width:(\d+)rem\)\]:grid-cols-/;

// Columns set by the window's breakpoints.
const WINDOW_COLUMNS: RegExp = /(^| )(sm|md|lg|xl):(grid-cols|col-span)-/;
