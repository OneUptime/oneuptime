import EventStatBar, {
  EventStatBarColumns,
  getEventStatBarColumnClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatBar";
import EventStatTile from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatTile";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";

/*
 * The incident, alert, scheduled maintenance and episode overview pages show
 * their headline timings as one EventStatBar of EventStatTile
 * variant="segment" cells. The tile's original "card" look is still used
 * elsewhere, so it must not move, and the segment cell must never truncate:
 * a narrow bar has no hover to reveal a clipped duration.
 */

const LONG_VALUE: string =
  "Not yet acknowledged after a very long escalation chain across three teams";

afterEach(() => {
  cleanup();
});

type GetTileFunction = (label: string) => HTMLElement;

// The tile root is the parent of the label row (label span -> row -> tile).
const getTile: GetTileFunction = (label: string): HTMLElement => {
  const labelElement: HTMLElement = screen.getByText(label);
  return labelElement.parentElement!.parentElement as HTMLElement;
};

describe("EventStatTile card variant (default)", () => {
  test("renders exactly the standalone bordered tile it always has", () => {
    render(
      <EventStatTile
        id="duration-tile"
        label="Duration"
        icon={IconProp.Clock}
        value="2h 13m"
        description="Since declared"
        className="extra-class"
      />,
    );

    const tile: HTMLElement = getTile("Duration");

    expect(tile).toHaveAttribute("id", "duration-tile");
    expect(tile.className).toBe(
      "rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm extra-class",
    );

    const value: HTMLElement = screen.getByText("2h 13m");
    expect(value.className).toBe(
      "mt-1.5 truncate text-lg font-semibold text-gray-900",
    );

    const description: HTMLElement = screen.getByText("Since declared");
    expect(description.className).toBe("mt-0.5 text-xs text-gray-500");

    expect(tile.querySelector("svg")).toHaveClass(
      "h-3.5",
      "w-3.5",
      "text-gray-400",
    );
  });

  test("an explicit card variant is identical to the default", () => {
    const { container: defaultContainer } = render(
      <EventStatTile label="Duration" value="5m" icon={IconProp.Clock} />,
    );
    const defaultHtml: string = defaultContainer.innerHTML;
    cleanup();

    const { container: cardContainer } = render(
      <EventStatTile
        label="Duration"
        value="5m"
        icon={IconProp.Clock}
        variant="card"
      />,
    );

    expect(cardContainer.innerHTML).toBe(defaultHtml);
  });

  test("omits the icon and description when they are not given", () => {
    render(<EventStatTile label="Acknowledged in" value="-" />);

    const tile: HTMLElement = getTile("Acknowledged in");

    expect(tile.querySelector("svg")).toBeNull();
    expect(tile.children).toHaveLength(2);
  });
});

describe("EventStatTile segment variant", () => {
  test("drops its own border, shadow and rounding and uses the cell padding", () => {
    render(
      <EventStatTile
        id="ack-cell"
        variant="segment"
        label="Acknowledged in"
        icon={IconProp.Check}
        value="4m 10s"
      />,
    );

    const cell: HTMLElement = getTile("Acknowledged in");

    expect(cell).toHaveAttribute("id", "ack-cell");
    expect(cell).toHaveClass("bg-white", "px-5", "py-4", "min-w-0");
    expect(cell).not.toHaveClass("border");
    expect(cell).not.toHaveClass("rounded-xl");
    expect(cell).not.toHaveClass("shadow-sm");
  });

  test("uses the stat bar label, icon and value tokens", () => {
    render(
      <EventStatTile
        variant="segment"
        label="Resolved in"
        icon={IconProp.CheckCircle}
        value="1h 2m"
        description="From first report"
      />,
    );

    const cell: HTMLElement = getTile("Resolved in");
    const labelRow: HTMLElement = screen.getByText("Resolved in")
      .parentElement as HTMLElement;

    expect(labelRow).toHaveClass(
      "text-xs",
      "font-medium",
      "uppercase",
      "tracking-wide",
      "text-gray-500",
    );
    expect(cell.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");

    const value: HTMLElement = screen.getByText("1h 2m");
    expect(value).toHaveClass(
      "mt-1",
      "text-lg",
      "font-semibold",
      "text-gray-900",
    );

    expect(screen.getByText("From first report")).toHaveClass(
      "mt-0.5",
      "text-xs",
      "text-gray-500",
    );
  });

  test("wraps a long value instead of truncating it", () => {
    render(
      <EventStatTile variant="segment" label="Status" value={LONG_VALUE} />,
    );

    const value: HTMLElement = screen.getByText(LONG_VALUE);

    expect(value).toHaveClass("break-words");
    expect(value).not.toHaveClass("truncate");
    expect(value.className).not.toContain("whitespace-nowrap");
  });

  test("renders an element value such as a live duration", () => {
    render(
      <EventStatTile
        variant="segment"
        label="Duration"
        value={<span data-testid="live-duration">12m</span>}
      />,
    );

    expect(screen.getByTestId("live-duration")).toHaveTextContent("12m");
  });

  test("appends a caller class name", () => {
    render(
      <EventStatTile
        variant="segment"
        label="Duration"
        value="1m"
        className="sm:col-span-2"
      />,
    );

    expect(getTile("Duration")).toHaveClass("sm:col-span-2", "px-5");
  });

  /*
   * "Acknowledged in" counts from when the record started; for a record
   * somebody was paged about, the tile adds how long after the page it was
   * acknowledged - under the value, above the date.
   */
  test("adds a note under the value, above the description, and wraps it", () => {
    render(
      <EventStatTile
        variant="segment"
        label="Acknowledged in"
        icon={IconProp.Check}
        value="10 hours, 4 minutes"
        note="4 minutes after paging"
        description="Oct 20, 2026 09:04"
      />,
    );

    const cell: HTMLElement = getTile("Acknowledged in");
    const note: HTMLElement = screen.getByText("4 minutes after paging");

    expect(
      Array.from(cell.children).map((child: Element) => {
        return child.textContent;
      }),
    ).toEqual([
      "Acknowledged in",
      "10 hours, 4 minutes",
      "4 minutes after paging",
      "Oct 20, 2026 09:04",
    ]);
    // Quieter than the value (text-lg, semibold, gray-900), louder than the date.
    expect(note).toHaveClass("text-sm", "text-gray-600");
    expect(note).not.toHaveClass("font-medium");
    expect(note).not.toHaveClass("font-semibold");
    // Wraps in a narrow cell, into even lines rather than an orphaned word.
    expect(note).toHaveClass("break-words", "text-balance");
    expect(note).not.toHaveClass("truncate");
  });

  test("draws no note line without a note, as before", () => {
    render(
      <EventStatTile
        variant="segment"
        label="Acknowledged in"
        value="5 minutes"
        note={undefined}
        description="Oct 20, 2026 09:04"
      />,
    );

    expect(getTile("Acknowledged in").children).toHaveLength(3);
  });
});

describe("EventStatTile card variant note", () => {
  test("adds the note under the value on a card too, truncated like the value", () => {
    render(
      <EventStatTile
        label="Acknowledged in"
        value="2 hours"
        note="3 minutes after paging"
      />,
    );

    expect(screen.getByText("3 minutes after paging").className).toBe(
      "mt-0.5 truncate text-sm text-gray-600",
    );
  });
});

describe("EventStatBar", () => {
  test("renders one card with the stat bar tokens and every cell inside it", () => {
    const { container } = render(
      <EventStatBar columns={3}>
        <EventStatTile variant="segment" label="Acknowledged in" value="4m" />
        <EventStatTile variant="segment" label="Resolved in" value="1h" />
        <EventStatTile variant="segment" label="Duration" value="2h" />
      </EventStatBar>,
    );

    const bar: HTMLElement = container.firstElementChild as HTMLElement;

    expect(bar).toHaveClass(
      "grid",
      "grid-cols-1",
      "overflow-hidden",
      "rounded-xl",
      "border",
      "border-gray-200",
      "shadow-sm",
      "sm:grid-cols-3",
    );
    expect(bar.children).toHaveLength(3);
    expect(bar).toContainElement(screen.getByText("Acknowledged in"));
    expect(bar).toContainElement(screen.getByText("Resolved in"));
    expect(bar).toContainElement(screen.getByText("Duration"));
  });

  test("draws hairline dividers between cells through a 1px gap", () => {
    const { container } = render(
      <EventStatBar columns={2}>
        <EventStatTile variant="segment" label="Starts" value="Today" />
        <EventStatTile variant="segment" label="Ends" value="Tomorrow" />
      </EventStatBar>,
    );

    const bar: HTMLElement = container.firstElementChild as HTMLElement;

    expect(bar).toHaveClass("gap-px", "bg-gray-100");
    // Cells paint white over the divider colour.
    for (const cell of Array.from(bar.children)) {
      expect(cell).toHaveClass("bg-white");
    }
  });

  test("is a single column on mobile for every column count", () => {
    const columnCounts: Array<EventStatBarColumns> = [1, 2, 3, 4];

    for (const columns of columnCounts) {
      const { container } = render(
        <EventStatBar columns={columns}>
          {[1, 2, 3, 4].slice(0, columns).map((cell: number) => {
            return (
              <EventStatTile
                key={cell}
                variant="segment"
                label={`Cell ${cell}`}
                value="1"
              />
            );
          })}
        </EventStatBar>,
      );

      const bar: HTMLElement = container.firstElementChild as HTMLElement;
      const unprefixedColumnClasses: Array<string> = Array.from(
        bar.classList,
      ).filter((className: string) => {
        return className.startsWith("grid-cols-");
      });

      expect(unprefixedColumnClasses).toEqual(["grid-cols-1"]);
      cleanup();
    }
  });

  test("maps each column count to literal responsive classes", () => {
    const expectations: Array<{
      columns: EventStatBarColumns;
      className: string;
    }> = [
      { columns: 1, className: "" },
      { columns: 2, className: "sm:grid-cols-2" },
      { columns: 3, className: "sm:grid-cols-3" },
      { columns: 4, className: "sm:grid-cols-2 lg:grid-cols-4" },
    ];

    for (const expectation of expectations) {
      expect(
        getEventStatBarColumnClassName(
          expectation.columns,
          expectation.columns,
        ),
      ).toBe(expectation.className);
    }
  });

  test("goes through a 2 x 2 grid before spreading four cells into one row", () => {
    const { container } = render(
      <EventStatBar columns={4}>
        <EventStatTile variant="segment" label="Acknowledged in" value="1m" />
        <EventStatTile variant="segment" label="Resolved in" value="2m" />
        <EventStatTile variant="segment" label="Duration" value="3m" />
        <EventStatTile variant="segment" label="Incidents" value="7" />
      </EventStatBar>,
    );

    const bar: HTMLElement = container.firstElementChild as HTMLElement;

    expect(bar).toHaveClass("sm:grid-cols-2", "lg:grid-cols-4");
    expect(bar).not.toHaveClass("sm:grid-cols-4");
  });

  test("never lays out more columns than it has cells", () => {
    expect(getEventStatBarColumnClassName(4, 3)).toBe("sm:grid-cols-3");
    expect(getEventStatBarColumnClassName(3, 2)).toBe("sm:grid-cols-2");
    expect(getEventStatBarColumnClassName(3, 1)).toBe("");
    expect(getEventStatBarColumnClassName(2, 0)).toBe("");
  });

  test("skips cells a caller left out conditionally", () => {
    const showEpisodeCount: boolean = false;

    const { container } = render(
      <EventStatBar columns={3}>
        <EventStatTile variant="segment" label="Acknowledged in" value="1m" />
        <EventStatTile variant="segment" label="Duration" value="3m" />
        {showEpisodeCount && (
          <EventStatTile variant="segment" label="Alerts" value="2" />
        )}
        {null}
      </EventStatBar>,
    );

    const bar: HTMLElement = container.firstElementChild as HTMLElement;

    expect(bar.children).toHaveLength(2);
    expect(bar).toHaveClass("sm:grid-cols-2");
    expect(bar).not.toHaveClass("sm:grid-cols-3");
  });

  test("renders nothing, not an empty bordered box, without cells", () => {
    const { container } = render(
      <EventStatBar columns={3}>
        {null}
        {false}
      </EventStatBar>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("appends a caller class name", () => {
    const { container } = render(
      <EventStatBar columns={1} className="mb-5">
        <EventStatTile variant="segment" label="Duration" value="3m" />
      </EventStatBar>,
    );

    expect(container.firstElementChild).toHaveClass("mb-5", "grid");
  });

  test("is an unnamed layout wrapper by default and a named group on request", () => {
    const { container, rerender } = render(
      <EventStatBar columns={1}>
        <EventStatTile variant="segment" label="Duration" value="3m" />
      </EventStatBar>,
    );

    const bar: HTMLElement = container.firstElementChild as HTMLElement;
    expect(bar).not.toHaveAttribute("role");
    expect(bar).not.toHaveAttribute("aria-label");

    rerender(
      <EventStatBar columns={1} ariaLabel="Incident timing">
        <EventStatTile variant="segment" label="Duration" value="3m" />
      </EventStatBar>,
    );

    expect(
      screen.getByRole("group", { name: "Incident timing" }),
    ).toContainElement(screen.getByText("Duration"));
  });

  test("keeps long cell values whole inside the bar", () => {
    render(
      <EventStatBar columns={2}>
        <EventStatTile variant="segment" label="Status" value={LONG_VALUE} />
        <EventStatTile variant="segment" label="Duration" value="3m" />
      </EventStatBar>,
    );

    expect(screen.getByText(LONG_VALUE)).toHaveTextContent(LONG_VALUE);
    expect(screen.getByText(LONG_VALUE)).not.toHaveClass("truncate");
  });
});

/*
 * A tile's label is English where a page writes it - "Declared", "Duration"
 * - and the tile looks it up where it draws it, as the event header does its
 * facts' labels. It used to draw the label as given, so every overview's
 * stat bar read "Duration" in German too. A label the page already put in
 * the reader's words ("{{stateName}} in") has no entry of its own, and
 * reads as given.
 *
 * The instance reaches the tile through I18nextProvider only, so German
 * never leaks into the other suites of this worker.
 */
describe("EventStatTile in the reader's language", () => {
  const createGerman: () => Promise<i18n> = async (): Promise<i18n> => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            Declared: "Erklärt",
            Duration: "Dauer",
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    return instance;
  };

  test("looks its label up, in both variants", async () => {
    const german: i18n = await createGerman();

    render(
      <I18nextProvider i18n={german}>
        <EventStatBar columns={2}>
          <EventStatTile variant="segment" label="Declared" value="18:01" />
          <EventStatTile label="Duration" value="3m" />
        </EventStatBar>
      </I18nextProvider>,
    );

    expect(screen.getByText("Erklärt")).toBeInTheDocument();
    expect(screen.getByText("Dauer")).toBeInTheDocument();
    expect(screen.queryByText("Declared")).toBeNull();
    expect(screen.queryByText("Duration")).toBeNull();
  });

  test("a label already in the reader's words reads as given", async () => {
    const german: i18n = await createGerman();

    render(
      <I18nextProvider i18n={german}>
        <EventStatTile variant="segment" label="Bestätigt in" value="3 Min." />
      </I18nextProvider>,
    );

    expect(screen.getByText("Bestätigt in")).toBeInTheDocument();
  });

  test("an English reader sees the label as written", () => {
    render(<EventStatTile variant="segment" label="Declared" value="18:01" />);

    expect(screen.getByText("Declared")).toBeInTheDocument();
  });
});
