import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import TelemetryViewer, {
  TELEMETRY_VIEWER_GROUP_HEADING_TEST_ID,
  TELEMETRY_VIEWER_SELECT_ROW_TEST_ID,
  TelemetryViewerBulk,
} from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * A list in sections (renderGroupHeading): a cloud resource's key metrics
 * read under Traffic, Errors, Latency and the rest. A section's heading is
 * a list item of its own, before the row that starts it - presentation
 * only, so a row's selection and keys stay the row's - and a list given no
 * headings reads exactly as it always has.
 */

interface Item {
  id: string;
  section: string;
}

const ITEMS: Array<Item> = [
  { id: "requests", section: "Traffic" },
  { id: "bytes", section: "Traffic" },
  { id: "5xx", section: "Errors" },
  { id: "custom", section: "Other" },
];

function renderViewer(
  props: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>> = {},
): void {
  render(
    <TelemetryViewer<Item>
      items={ITEMS}
      isLoading={false}
      renderRow={(item: Item): React.ReactElement => {
        return <span data-testid="row">{item.id}</span>;
      }}
      getRowKey={(item: Item): string => {
        return item.id;
      }}
      searchValue=""
      onSearchChange={(): void => {}}
      onSearchSubmit={(): void => {}}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      onTimeRangeChange={(): void => {}}
      page={1}
      pageSize={50}
      totalCount={ITEMS.length}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      itemLabel="metrics"
      {...props}
    />,
  );
}

// Each section starts where the one before it ends.
function headingOf(item: Item, index: number): React.ReactElement | null {
  return index === 0 || ITEMS[index - 1]!.section !== item.section ? (
    <h3>{item.section}</h3>
  ) : null;
}

afterEach(() => {
  cleanup();
});

describe("a list in sections", () => {
  test("draws each heading before the row that starts its section, as its own list item", () => {
    renderViewer({ renderGroupHeading: headingOf });

    const headings: Array<HTMLElement> = screen.getAllByTestId(
      TELEMETRY_VIEWER_GROUP_HEADING_TEST_ID,
    );

    expect(
      headings.map((heading: HTMLElement): string => {
        return heading.textContent || "";
      }),
    ).toEqual(["Traffic", "Errors", "Other"]);

    for (const heading of headings) {
      expect(heading.tagName).toBe("LI");
      expect(heading).toHaveAttribute("role", "presentation");
    }

    // In the list's order: heading, its rows, the next heading.
    const list: HTMLElement = headings[0]!.parentElement!;
    expect(
      Array.from(list.children).map((child: Element): string => {
        return child.textContent || "";
      }),
    ).toEqual([
      "Traffic",
      "requests",
      "bytes",
      "Errors",
      "5xx",
      "Other",
      "custom",
    ]);
    expect(screen.getAllByTestId("row")).toHaveLength(ITEMS.length);
  });

  test("a heading is no row: a screen reader reads it as a heading", () => {
    renderViewer({ renderGroupHeading: headingOf });

    const first: HTMLElement = screen.getAllByTestId(
      TELEMETRY_VIEWER_GROUP_HEADING_TEST_ID,
    )[0]!;

    expect(within(first).getByRole("heading")).toHaveTextContent("Traffic");
  });

  test("without headings, the list reads as it always has", () => {
    renderViewer();

    expect(
      screen.queryAllByTestId(TELEMETRY_VIEWER_GROUP_HEADING_TEST_ID),
    ).toHaveLength(0);
    const list: HTMLElement = screen.getAllByTestId("row")[0]!.closest("ul")!;
    expect(list.children).toHaveLength(ITEMS.length);
  });

  test("a row whose heading is null starts no section", () => {
    renderViewer({
      renderGroupHeading: (): React.ReactElement | null => {
        return null;
      },
    });

    expect(
      screen.queryAllByTestId(TELEMETRY_VIEWER_GROUP_HEADING_TEST_ID),
    ).toHaveLength(0);
  });

  /*
   * A section with nothing listed in it - a cloud resource's section none
   * of whose key metrics reported (#9569) - is an item whose row draws
   * nothing: its heading alone, and no empty list item after it.
   */
  test("an item whose row draws nothing is its heading alone", () => {
    const items: Array<Item> = [
      { id: "requests", section: "Traffic" },
      { id: "latency-gap", section: "Latency" },
      { id: "custom", section: "Other" },
    ];

    renderViewer({
      items,
      totalCount: 2,
      renderRow: (item: Item): React.ReactElement | null => {
        return item.id.endsWith("-gap") ? null : (
          <span data-testid="row">{item.id}</span>
        );
      },
      renderGroupHeading: (item: Item): React.ReactElement => {
        return <h3>{item.section}</h3>;
      },
    });

    const list: HTMLElement = screen.getAllByTestId("row")[0]!.closest("ul")!;
    expect(
      Array.from(list.children).map((child: Element): string => {
        return child.textContent || "";
      }),
    ).toEqual(["Traffic", "requests", "Latency", "Other", "custom"]);
    expect(screen.getAllByTestId("row")).toHaveLength(2);
  });

  test("with Bulk Actions, an item whose row draws nothing has no box to tick", () => {
    const items: Array<Item> = [
      { id: "requests", section: "Traffic" },
      { id: "latency-gap", section: "Latency" },
    ];
    const bulk: TelemetryViewerBulk<Item> = {
      buttons: [],
      singularLabel: "Metric",
      pluralLabel: "Metrics",
      getItemId: (item: Item): string => {
        return item.id;
      },
      itemToString: (item: Item): string => {
        return item.id;
      },
    };

    renderViewer({
      items,
      totalCount: 1,
      bulk,
      renderRow: (item: Item): React.ReactElement | null => {
        return item.id.endsWith("-gap") ? null : (
          <span data-testid="row">{item.id}</span>
        );
      },
      renderGroupHeading: (item: Item): React.ReactElement => {
        return <h3>{item.section}</h3>;
      },
    });

    expect(
      screen.getAllByTestId(TELEMETRY_VIEWER_SELECT_ROW_TEST_ID),
    ).toHaveLength(1);
    const list: HTMLElement = screen.getAllByTestId("row")[0]!.closest("ul")!;
    expect(
      Array.from(list.children).map((child: Element): string => {
        return child.textContent || "";
      }),
    ).toEqual(["Traffic", "requests", "Latency"]);
  });
});
