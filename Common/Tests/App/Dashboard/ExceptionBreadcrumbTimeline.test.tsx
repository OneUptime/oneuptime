import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import * as React from "react";
import BreadcrumbTimeline, {
  BreadcrumbEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/BreadcrumbTimeline";
import { JSONObject } from "../../../Types/JSON";

const EXCEPTION_TIME: Date = new Date(2026, 8, 14, 11, 56, 0, 0);

function event(
  name: string,
  offsetMs: number,
  attributes: JSONObject = {},
): BreadcrumbEvent {
  const time: Date = new Date(EXCEPTION_TIME.getTime() + offsetMs);
  return { name, time, timeUnixNano: time.getTime() * 1000000, attributes };
}

// Deliberately out of order: the timeline sorts by time.
const EVENTS: Array<BreadcrumbEvent> = [
  event("exception", 0, {
    "exception.type": "InventoryReservationError",
    "exception.message": "Could not reserve stock",
    "exception.stacktrace": "at reserveInventory",
  }),
  event("http.request", -880, {
    "http.method": "POST",
    "http.url": "https://shop.example.com/api/checkout",
  }),
  event("db.query", -410, {
    "db.system": "postgresql",
    "db.statement": "SELECT * FROM stock WHERE sku = $1",
  }),
  event("db.query", -380, {
    "db.system": "postgresql",
    "db.statement": "SELECT * FROM stock WHERE sku = $1",
  }),
  event("cart.loaded", -640),
  event("inventory.version_mismatch warning", -120, { level: "warning" }),
];

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId("breadcrumb-row");
}

function summaries(): Array<string> {
  return rows().map((row: HTMLElement) => {
    return within(row).getByTestId("breadcrumb-summary").textContent || "";
  });
}

function renderTimeline(
  props: Partial<React.ComponentProps<typeof BreadcrumbTimeline>> = {},
): void {
  render(
    <BreadcrumbTimeline
      events={EVENTS}
      exceptionTime={EXCEPTION_TIME}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("BreadcrumbTimeline", () => {
  test("lists events oldest to newest, folding identical neighbours", () => {
    renderTimeline();

    expect(summaries()).toEqual([
      "POST https://shop.example.com/api/checkout",
      "cart.loaded",
      "SELECT * FROM stock WHERE sku = $1",
      "inventory.version_mismatch warning",
      "Could not reserve stock",
    ]);
    expect(
      within(rows()[2]!).getByTestId("breadcrumb-count"),
    ).toHaveTextContent("×2");
    expect(rows()[4]).toHaveAttribute("data-category", "EXCEPTION");
  });

  test("describes the window before the exception", () => {
    renderTimeline();

    expect(
      screen.getByText("6 events in the 880 ms before the exception"),
    ).toBeInTheDocument();
  });

  test("shows times relative to the exception, and clock times on request", () => {
    renderTimeline();

    const times: () => Array<string> = (): Array<string> => {
      return rows().map((row: HTMLElement) => {
        return within(row).getByTestId("breadcrumb-time").textContent || "";
      });
    };

    expect(times()).toEqual([
      "-880 ms",
      "-640 ms",
      "-410 ms → -380 ms",
      "-120 ms",
      "at exception",
    ]);

    fireEvent.click(screen.getByTestId("breadcrumb-time-format-clock"));

    expect(times()[0]).toBe("11:55:59.120");
    expect(times()[4]).toBe("11:56:00.000");
  });

  test("uses clock times and no switch without an exception time", () => {
    render(<BreadcrumbTimeline events={EVENTS} />);

    expect(
      screen.queryByTestId("breadcrumb-time-format"),
    ).not.toBeInTheDocument();
    expect(within(rows()[0]!).getByTestId("breadcrumb-time")).toHaveTextContent(
      "11:55:59.120",
    );
    expect(screen.getByText("6 events")).toBeInTheDocument();
  });

  test("filters by category and clears back to everything", () => {
    renderTimeline();

    expect(screen.getByTestId("breadcrumb-filter-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("breadcrumb-filter-DB"));

    expect(summaries()).toEqual(["SELECT * FROM stock WHERE sku = $1"]);
    expect(screen.getByTestId("breadcrumb-filter-DB")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByText("2 of 6 events match the filters"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("breadcrumb-filter-EXCEPTION"));
    expect(summaries()).toHaveLength(2);

    fireEvent.click(screen.getByTestId("breadcrumb-filter-all"));
    expect(summaries()).toHaveLength(5);
  });

  test("expands a row to its attributes, hiding noisy ones", () => {
    renderTimeline();

    const exceptionRow: HTMLElement = rows()[4]!;
    const toggle: HTMLElement = within(exceptionRow).getAllByRole("button")[0]!;

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const attributes: HTMLElement = within(exceptionRow).getByTestId(
      "breadcrumb-attributes",
    );
    expect(attributes).toHaveTextContent("exception.type");
    expect(attributes).toHaveTextContent("InventoryReservationError");
    expect(attributes).not.toHaveTextContent("exception.stacktrace");

    // Clicking inside the details must not fold the row.
    fireEvent.click(attributes);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    /*
     * The details are not inside the toggle, so their copy buttons are
     * separate controls and not part of the toggle's accessible name.
     */
    expect(toggle).not.toContainElement(attributes);
    expect(within(toggle).queryAllByRole("button")).toHaveLength(0);
    expect(within(attributes).getAllByRole("button").length).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(
      within(exceptionRow).queryByTestId("breadcrumb-detail"),
    ).not.toBeInTheDocument();
  });

  test("a folded row lists each identical event's time", () => {
    renderTimeline();

    const dbRow: HTMLElement = rows()[2]!;
    fireEvent.click(within(dbRow).getAllByRole("button")[0]!);

    expect(within(dbRow).getByText("2 identical events")).toBeInTheDocument();
    expect(within(dbRow).getByTestId("breadcrumb-detail")).toHaveTextContent(
      "-410 ms",
    );
  });

  test("rows are keyboard operable", () => {
    renderTimeline();

    const toggle: HTMLElement = within(rows()[0]!).getAllByRole("button")[0]!;

    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("shows the event name once when it is also the detail", () => {
    render(
      <BreadcrumbTimeline
        events={[
          event("InventoryReservationError", 0, {
            "exception.type": "InventoryReservationError",
            "exception.message": "Could not reserve stock",
          }),
        ]}
        exceptionTime={EXCEPTION_TIME}
      />,
    );

    const row: HTMLElement = rows()[0]!;
    expect(
      within(row).getAllByText("InventoryReservationError", { exact: true }),
    ).toHaveLength(1);
    expect(within(row).getByTestId("breadcrumb-summary")).toHaveTextContent(
      "Could not reserve stock",
    );
  });

  test("an event with no attributes is not clickable", () => {
    renderTimeline();

    expect(within(rows()[1]!).queryByRole("button")).not.toBeInTheDocument();
  });

  test("keeps only the latest events and says so", () => {
    renderTimeline({ maxEvents: 3 });

    expect(summaries()).toEqual([
      "SELECT * FROM stock WHERE sku = $1",
      "inventory.version_mismatch warning",
      "Could not reserve stock",
    ]);
    expect(screen.getByText(/latest 3 of 6/)).toBeInTheDocument();
  });

  test("shows an empty state without events", () => {
    renderTimeline({ events: [] });

    expect(screen.getByTestId("breadcrumbs-empty")).toHaveTextContent(
      "No breadcrumbs",
    );
  });

  test("hides the filter when every event is the same category", () => {
    renderTimeline({ events: [EVENTS[2]!, EVENTS[3]!] });

    expect(screen.queryByTestId("breadcrumb-filters")).not.toBeInTheDocument();
  });
});
