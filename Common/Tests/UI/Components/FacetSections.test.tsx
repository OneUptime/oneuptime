import FacetSection, {
  FacetSectionProps,
} from "../../../UI/Components/LogsViewer/components/FacetSection";
import TelemetryFacetSection from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSection";
import { FacetValue } from "../../../UI/Components/TelemetryViewer/types";
import IconProp from "../../../Types/Icon/IconProp";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Logs sidebar's FacetSection and the Traces / Metrics / Exceptions
 * sidebar's TelemetryFacetSection are two copies of one control. Both got the
 * same polish — icon, turning chevron, a search box that clears, "Show N
 * more", honest empty states, and search text a sidebar can own — so every
 * case here runs against both.
 */

type SectionRenderer = (props: FacetSectionProps) => ReactElement;

const SECTIONS: Array<[string, SectionRenderer]> = [
  [
    "FacetSection (Logs)",
    (props: FacetSectionProps): ReactElement => {
      return <FacetSection {...props} />;
    },
  ],
  [
    "TelemetryFacetSection",
    (props: FacetSectionProps): ReactElement => {
      return <TelemetryFacetSection {...props} />;
    },
  ],
];

function makeValues(count: number, prefix: string = "host"): Array<FacetValue> {
  const values: Array<FacetValue> = [];
  for (let index: number = 1; index <= count; index++) {
    values.push({ value: `${prefix}-${index}`, count: 100 - index });
  }
  return values;
}

function baseProps(overrides: Partial<FacetSectionProps>): FacetSectionProps {
  return {
    title: "Host",
    facetKey: "hostId",
    values: makeValues(3),
    onIncludeValue: jest.fn(),
    onExcludeValue: jest.fn(),
    ...overrides,
  };
}

function rowNames(container: HTMLElement = document.body): Array<string> {
  return within(container)
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return (element.getAttribute("title") || "").startsWith("Filter to ");
    })
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function typeInto(box: HTMLElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
}

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(SECTIONS)(
  "%s",
  (_name: string, renderSection: SectionRenderer) => {
    function mount(overrides: Partial<FacetSectionProps> = {}): RenderResult {
      return render(renderSection(baseProps(overrides)));
    }

    describe("header", () => {
      test("is a button with aria-expanded that collapses and re-opens the body", () => {
        mount({ values: makeValues(8) });

        const header: HTMLElement = screen.getByRole("button", {
          name: "Host",
        });
        expect(header).toHaveAttribute("aria-expanded", "true");

        const bodyId: string | null = header.getAttribute("aria-controls");
        expect(bodyId).toBeTruthy();
        expect(document.getElementById(bodyId!)).not.toBeNull();
        expect(rowNames()).toHaveLength(5);

        fireEvent.click(header);

        expect(header).toHaveAttribute("aria-expanded", "false");
        expect(rowNames()).toHaveLength(0);
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(
          screen.queryByRole("button", { name: "Show 3 more" }),
        ).toBeNull();
        expect(document.getElementById(bodyId!)).toBeNull();

        fireEvent.click(header);

        expect(header).toHaveAttribute("aria-expanded", "true");
        expect(rowNames()).toHaveLength(5);
      });

      test("renders the facet icon before the title", () => {
        mount({ icon: IconProp.Docker, title: "Docker Host" });

        const header: HTMLElement = screen.getByRole("button", {
          name: "Docker Host",
        });
        expect(
          within(header).getByTestId("facet-section-icon"),
        ).toHaveAttribute("data-icon", IconProp.Docker);
      });

      test("renders no icon when none is given", () => {
        mount();

        expect(screen.queryByTestId("facet-section-icon")).toBeNull();
      });

      test("keeps the active count badge", () => {
        mount({ activeValues: new Set<string>(["host-1", "host-2"]) });

        const header: HTMLElement = screen.getByRole("button", {
          name: /^Host\s*2$/,
        });
        expect(within(header).getByText("2")).toBeInTheDocument();
      });

      test("uses one rotating chevron", () => {
        mount();

        const chevron: HTMLElement = screen.getByTestId(
          "facet-section-chevron",
        );
        expect(chevron).toHaveClass("rotate-90");

        fireEvent.click(screen.getByRole("button", { name: "Host" }));

        expect(screen.getByTestId("facet-section-chevron")).not.toHaveClass(
          "rotate-90",
        );
      });
    });

    describe("search box", () => {
      test("is absent for a short list without server search", () => {
        mount({ values: makeValues(5) });

        expect(screen.queryByRole("textbox")).toBeNull();
      });

      test("appears from six values, named after the facet", () => {
        mount({ values: makeValues(6) });

        const box: HTMLElement = screen.getByRole("textbox", {
          name: "Search Host",
        });
        expect(box).toHaveAttribute("placeholder", "Search host...");
      });

      test("always appears for a server-searchable facet", () => {
        mount({ values: [], onSearchChange: jest.fn() });

        expect(
          screen.getByRole("textbox", { name: "Search Host" }),
        ).toBeInTheDocument();
      });

      test("filters rows as the user types", () => {
        mount({ values: makeValues(12) });

        typeInto(screen.getByRole("textbox"), "host-1");

        expect(rowNames()).toEqual(["host-1", "host-10", "host-11", "host-12"]);
      });

      test("the clear button empties the box and restores the list", () => {
        mount({ values: makeValues(8) });

        const box: HTMLElement = screen.getByRole("textbox");
        typeInto(box, "host-7");
        expect(rowNames()).toEqual(["host-7"]);

        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

        expect(box).toHaveValue("");
        expect(rowNames()).toHaveLength(5);
        expect(
          screen.queryByRole("button", { name: "Clear search" }),
        ).toBeNull();
      });

      test("Escape clears the box", () => {
        mount({ values: makeValues(8) });

        const box: HTMLElement = screen.getByRole("textbox");
        typeInto(box, "host-7");
        fireEvent.keyDown(box, { key: "Escape" });

        expect(box).toHaveValue("");
        expect(rowNames()).toHaveLength(5);
      });

      test("an uncontrolled section keeps its own text", () => {
        mount({ values: makeValues(8) });

        const box: HTMLElement = screen.getByRole("textbox");
        typeInto(box, "host-3");

        expect(box).toHaveValue("host-3");
        expect(rowNames()).toEqual(["host-3"]);
      });

      test("a controlled section shows and filters by the given text, and reports edits", () => {
        const onSearchTextChange: MockFunction = getJestMockFunction();
        const view: RenderResult = mount({
          values: makeValues(8),
          searchText: "host-2",
          onSearchTextChange: onSearchTextChange as any,
        });

        const box: HTMLElement = screen.getByRole("textbox");
        expect(box).toHaveValue("host-2");
        expect(rowNames()).toEqual(["host-2"]);

        typeInto(box, "host-4");

        expect(onSearchTextChange).toHaveBeenLastCalledWith("host-4");
        // The owner has not updated yet, so the box still shows its value.
        expect(box).toHaveValue("host-2");

        view.rerender(
          renderSection(
            baseProps({
              values: makeValues(8),
              searchText: "host-4",
              onSearchTextChange: onSearchTextChange as any,
            }),
          ),
        );

        expect(box).toHaveValue("host-4");
        expect(rowNames()).toEqual(["host-4"]);
      });

      test("a controlled section reports the clear button and Escape as empty text", () => {
        const onSearchTextChange: MockFunction = getJestMockFunction();
        mount({
          values: makeValues(8),
          searchText: "host-2",
          onSearchTextChange: onSearchTextChange as any,
        });

        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
        expect(onSearchTextChange).toHaveBeenLastCalledWith("");

        onSearchTextChange.mockClear();
        fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
        expect(onSearchTextChange).toHaveBeenLastCalledWith("");
      });

      test("a section whose owner holds the text keeps it across a remount", () => {
        function Owner(props: { isMounted: boolean }): ReactElement {
          const [text, setText] = useState<string>("");
          return (
            <div>
              {props.isMounted &&
                renderSection(
                  baseProps({
                    values: makeValues(8),
                    searchText: text,
                    onSearchTextChange: setText,
                  }),
                )}
            </div>
          );
        }

        const view: RenderResult = render(<Owner isMounted={true} />);
        typeInto(screen.getByRole("textbox"), "host-5");

        view.rerender(<Owner isMounted={false} />);
        expect(screen.queryByRole("textbox")).toBeNull();

        view.rerender(<Owner isMounted={true} />);
        expect(screen.getByRole("textbox")).toHaveValue("host-5");
        expect(rowNames()).toEqual(["host-5"]);
      });

      test("a remounted controlled section re-sends its text, not an empty search", () => {
        jest.useFakeTimers();
        const onSearchChange: MockFunction = getJestMockFunction();

        const view: RenderResult = render(
          renderSection(
            baseProps({
              values: [],
              searchText: "prod",
              onSearchTextChange: jest.fn(),
              onSearchChange: onSearchChange as any,
            }),
          ),
        );
        view.unmount();

        render(
          renderSection(
            baseProps({
              values: [],
              searchText: "prod",
              onSearchTextChange: jest.fn(),
              onSearchChange: onSearchChange as any,
            }),
          ),
        );
        act(() => {
          jest.advanceTimersByTime(300);
        });

        expect(onSearchChange.mock.calls).toEqual([["prod"]]);
      });

      test("typing emits the trimmed text to the server once, after 300ms", () => {
        jest.useFakeTimers();
        const onSearchChange: MockFunction = getJestMockFunction();
        mount({ values: makeValues(2), onSearchChange: onSearchChange as any });

        const box: HTMLElement = screen.getByRole("textbox");
        typeInto(box, "p");
        act(() => {
          jest.advanceTimersByTime(100);
        });
        typeInto(box, " prod ");
        act(() => {
          jest.advanceTimersByTime(299);
        });

        expect(onSearchChange).not.toHaveBeenCalled();

        act(() => {
          jest.advanceTimersByTime(1);
        });

        expect(onSearchChange.mock.calls).toEqual([["prod"]]);
      });

      test("a search hidden by a shrinking list stops filtering", () => {
        const view: RenderResult = mount({ values: makeValues(8) });

        typeInto(screen.getByRole("textbox"), "host-7");
        expect(rowNames()).toEqual(["host-7"]);

        view.rerender(renderSection(baseProps({ values: makeValues(3) })));

        expect(screen.queryByRole("textbox")).toBeNull();
        expect(rowNames()).toEqual(["host-1", "host-2", "host-3"]);

        view.rerender(renderSection(baseProps({ values: makeValues(8) })));

        expect(screen.getByRole("textbox")).toHaveValue("");
      });
    });

    describe("show more", () => {
      test("reads 'Show N more' and 'Show less'", () => {
        mount({ values: makeValues(8) });

        expect(rowNames()).toHaveLength(5);
        expect(screen.queryByText(/^\+\d+ more$/)).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));

        expect(rowNames()).toHaveLength(8);

        fireEvent.click(screen.getByRole("button", { name: "Show less" }));

        expect(rowNames()).toHaveLength(5);
        expect(
          screen.getByRole("button", { name: "Show 3 more" }),
        ).toBeInTheDocument();
      });

      test("counts against initialVisibleCount", () => {
        mount({ values: makeValues(10), initialVisibleCount: 3 });

        expect(rowNames()).toHaveLength(3);
        expect(
          screen.getByRole("button", { name: "Show 7 more" }),
        ).toBeInTheDocument();
      });

      test("is absent when the list fits", () => {
        mount({ values: makeValues(5) });

        expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
      });

      test("a search result is the whole answer — no toggle beside it", () => {
        mount({ values: makeValues(20) });

        typeInto(screen.getByRole("textbox"), "host-1");

        expect(rowNames()).toEqual([
          "host-1",
          "host-10",
          "host-11",
          "host-12",
          "host-13",
          "host-14",
          "host-15",
          "host-16",
          "host-17",
          "host-18",
          "host-19",
        ]);
        expect(
          screen.queryByRole("button", { name: /^Show \d+ more$/ }),
        ).toBeNull();
        expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      });

      test("the count follows the list after a search is cleared and values change", () => {
        const view: RenderResult = mount({ values: makeValues(9) });

        expect(
          screen.getByRole("button", { name: "Show 4 more" }),
        ).toBeInTheDocument();

        view.rerender(renderSection(baseProps({ values: makeValues(7) })));

        expect(
          screen.getByRole("button", { name: "Show 2 more" }),
        ).toBeInTheDocument();
      });
    });

    describe("empty states", () => {
      test("an empty facet reads as empty for the time range by default", () => {
        mount({ values: [] });

        expect(
          screen.getByText("No values in this time range"),
        ).toBeInTheDocument();
        expect(screen.queryByText("No values found")).toBeNull();
      });

      test("the sidebar's empty-state text replaces the default", () => {
        mount({
          values: [],
          emptyStateText: "No Docker Hosts in this project",
        });

        expect(
          screen.getByText("No Docker Hosts in this project"),
        ).toBeInTheDocument();
        expect(screen.queryByText("No values in this time range")).toBeNull();
      });

      test("a search with no matches quotes the query", () => {
        mount({ values: makeValues(8) });

        typeInto(screen.getByRole("textbox"), "  zzz ");

        expect(screen.getByText("No matches for “zzz”")).toBeInTheDocument();
        expect(screen.queryByText("No matches found")).toBeNull();
      });

      test("a search wins over the sidebar's empty-state text", () => {
        mount({
          values: [],
          onSearchChange: jest.fn(),
          emptyStateText: "No Hosts in this project",
        });

        typeInto(screen.getByRole("textbox"), "web");

        expect(screen.getByText("No matches for “web”")).toBeInTheDocument();
        expect(screen.queryByText("No Hosts in this project")).toBeNull();
      });

      test("a whitespace-only search is not a search", () => {
        mount({ values: [], onSearchChange: jest.fn() });

        typeInto(screen.getByRole("textbox"), "   ");

        expect(
          screen.getByText("No values in this time range"),
        ).toBeInTheDocument();
      });
    });

    describe("rows", () => {
      test("include and exclude report the facet key and raw value", () => {
        const onIncludeValue: MockFunction = getJestMockFunction();
        const onExcludeValue: MockFunction = getJestMockFunction();
        mount({
          values: [{ value: "h-1", count: 3, displayName: "web-1" }],
          onIncludeValue: onIncludeValue as any,
          onExcludeValue: onExcludeValue as any,
        });

        fireEvent.click(screen.getByTitle("Filter to web-1"));
        fireEvent.click(screen.getByRole("button", { name: "Exclude web-1" }));

        expect(onIncludeValue).toHaveBeenCalledWith("hostId", "h-1");
        expect(onExcludeValue).toHaveBeenCalledWith("hostId", "h-1");
      });

      test("a resource with no telemetry in range is muted, not dropped", () => {
        mount({
          values: [
            { value: "busy", count: 12 },
            { value: "idle", count: 0 },
          ],
        });

        expect(screen.getByText("busy")).toHaveClass("text-gray-700");
        expect(screen.getByText("idle")).toHaveClass("text-gray-400");
        expect(screen.getByText("idle")).not.toHaveClass("text-gray-700");
      });

      test("a selected zero-count row still reads as selected", () => {
        mount({
          values: [{ value: "idle", count: 0 }],
          activeValues: new Set<string>(["idle"]),
        });

        expect(screen.getByText("idle")).toHaveClass("text-indigo-700");
      });
    });
  },
);

describe("TelemetryFacetSection only", () => {
  test("defaultExpanded=false starts collapsed", () => {
    render(
      <TelemetryFacetSection
        {...baseProps({ values: makeValues(3) })}
        defaultExpanded={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Host" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(rowNames()).toHaveLength(0);
  });

  test("alwaysShowSearch shows the box for a one-value list", () => {
    render(
      <TelemetryFacetSection
        {...baseProps({ values: makeValues(1) })}
        alwaysShowSearch={true}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Search Host" }),
    ).toBeInTheDocument();
  });
});
