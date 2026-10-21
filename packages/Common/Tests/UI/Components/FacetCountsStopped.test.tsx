import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import TelemetryFacetSidebar from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import {
  FacetConfig,
  FacetData,
  FacetValue,
} from "../../../UI/Components/TelemetryViewer/types";
import {
  TELEMETRY_LOAD_ERROR_RETRY_TEST_ID,
  TELEMETRY_LOAD_ERROR_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryLoadErrorMessage";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../UI/Utils/Telemetry/TelemetryLoadError";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The filter counts when the server could not count them in time (issue
 * #4707).
 *
 * The facets endpoints count each facet on its own, and a count stopped at
 * the time limit used to come back looking exactly like a facet with nothing
 * in it: "No values in this time range" for Severity or Status, and every
 * service at 0 for Service. They now name those facets (`timedOutFacets`),
 * and both sidebars — the logs explorer's and the one the traces, metrics
 * and exceptions explorers share — say so:
 *
 *   - a note at the top says the counts took too long, what to try, and
 *     offers Try again;
 *   - a stopped facet says "Not counted" instead of "No values", and its
 *     values (a resource facet still lists its resources) stay pickable with
 *     no count rather than a 0 that is not true;
 *   - the facets that were counted are untouched;
 *   - facets that failed outright say why;
 *   - the note steps aside when the list already says the whole search
 *     could not finish (one message per search), while the stopped facets
 *     keep their own line;
 *   - the line is two words: why the counts are missing is said once, by
 *     the note or by the list's message, not again in every stopped facet;
 *   - a facet that may fold away while empty (a resource type, a security
 *     event facet) is never folded into "N empty filters hidden" when it was
 *     stopped: not counted is not empty.
 */

const STOPPED_LINE: string = "Not counted";
const EMPTY_LINE: string = "No values in this time range";
const STOPPED_LINE_TEST_ID: string = "facet-count-stopped";

function value(id: string, count: number, name?: string): FacetValue {
  return name
    ? { value: id, count: count, displayName: name }
    : { value: id, count: count };
}

interface SidebarOptions {
  facetData: FacetData;
  timedOutFacets?: Array<string> | undefined;
  facetError?: TelemetryLoadError | undefined;
  onRetryFacets?: (() => void) | undefined;
  showCountsNotice?: boolean | undefined;
  isLoading?: boolean | undefined;
}

type Sidebar = "logs" | "telemetry";

const TELEMETRY_CONFIGS: Array<FacetConfig> = [
  {
    key: "primaryEntityId",
    title: "Service",
    priority: 1,
    serverSearchable: true,
  },
  { key: "statusCode", title: "Status", priority: 2 },
  { key: "kind", title: "Span Kind", priority: 3 },
];

function sidebarElement(
  sidebar: Sidebar,
  options: SidebarOptions,
): ReactElement {
  if (sidebar === "logs") {
    return (
      <LogsFacetSidebar
        onRemoveFilter={() => {}}
        facetData={options.facetData}
        isLoading={options.isLoading || false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        selectedSavedViewId={null}
        onSavedViewSelect={jest.fn()}
        onClearSavedView={jest.fn()}
        timedOutFacets={options.timedOutFacets}
        facetError={options.facetError}
        onRetryFacets={options.onRetryFacets}
        showCountsNotice={options.showCountsNotice}
      />
    );
  }

  return (
    <TelemetryFacetSidebar
      onRemoveFilter={() => {}}
      facetData={options.facetData}
      facetConfigs={TELEMETRY_CONFIGS}
      isLoading={options.isLoading || false}
      onIncludeFilter={jest.fn()}
      onExcludeFilter={jest.fn()}
      timedOutFacets={options.timedOutFacets}
      facetError={options.facetError}
      onRetryFacets={options.onRetryFacets}
      showCountsNotice={options.showCountsNotice}
    />
  );
}

function sectionFor(title: string): HTMLElement {
  const header: HTMLElement = screen.getByRole("button", {
    name: new RegExp(`^${title}`),
  });
  return header.parentElement!.parentElement as HTMLElement;
}

function note(): HTMLElement | null {
  return screen.queryByTestId(TELEMETRY_LOAD_ERROR_TEST_ID);
}

// A section's own "Not counted" line, under its title.
function stoppedLine(section: HTMLElement): HTMLElement | null {
  return within(section).queryByTestId(STOPPED_LINE_TEST_ID);
}

interface StoppedCase {
  sidebar: Sidebar;
  name: string;
  facetData: FacetData;
  stopped: Array<string>;
  // The plain facet the server stopped, and the resource facet it stopped.
  plainTitle: string;
  resourceTitle: string;
  // A facet that was counted.
  countedTitle: string;
  countedValue: string;
  countedCount: string;
}

// Each explorer's facets, as its endpoint answers them when two were stopped.
const CASES: Array<StoppedCase> = [
  {
    sidebar: "logs",
    name: "the logs explorer's sidebar",
    facetData: {
      severityText: [],
      primaryEntityId: [
        value("svc-1", 0, "checkout"),
        value("svc-2", 0, "payments"),
      ],
      hostId: [value("host-1", 1234, "web-1")],
    },
    stopped: ["severityText", "primaryEntityId"],
    plainTitle: "Severity",
    resourceTitle: "Service",
    countedTitle: "Host",
    countedValue: "web-1",
    countedCount: "1,234",
  },
  {
    sidebar: "telemetry",
    name: "the traces / metrics / exceptions sidebar",
    facetData: {
      statusCode: [],
      primaryEntityId: [
        value("svc-1", 0, "checkout"),
        value("svc-2", 0, "payments"),
      ],
      kind: [value("SPAN_KIND_SERVER", 1234)],
    },
    stopped: ["statusCode", "primaryEntityId"],
    plainTitle: "Status",
    resourceTitle: "Service",
    countedTitle: "Span Kind",
    countedValue: "SPAN_KIND_SERVER",
    countedCount: "1,234",
  },
];

afterEach(() => {
  cleanup();
});

describe.each(CASES)(
  "$name: counts stopped at the time limit",
  (testCase: StoppedCase) => {
    test("a note at the top says the counts took too long and what to try", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
          onRetryFacets: () => {},
        }),
      );

      expect(note()).toHaveAttribute("role", "status");
      expect(note()).toHaveAttribute("data-kind", "timed-out");
      expect(note()).toHaveTextContent("Filter counts took too long");
      expect(note()).toHaveTextContent(
        "Try a shorter time range or more specific filters.",
      );
    });

    test("Try again in the note runs the counts again, once", () => {
      const onRetry: MockFunction = getJestMockFunction();

      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
          onRetryFacets: () => {
            onRetry();
          },
        }),
      );

      fireEvent.click(
        within(note()!).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
      );

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    test("REGRESSION: a stopped facet says 'Not counted', not 'No values'", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
        }),
      );

      const section: HTMLElement = sectionFor(testCase.plainTitle);

      expect(stoppedLine(section)?.textContent).toBe(STOPPED_LINE);
      expect(section).not.toHaveTextContent(EMPTY_LINE);
    });

    test("the line says it once: two words, the reason left to the note", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
          onRetryFacets: () => {},
        }),
      );

      // The note says why, once, for every stopped facet.
      expect(note()).toHaveTextContent("Filter counts took too long");

      for (const title of [testCase.plainTitle, testCase.resourceTitle]) {
        const line: HTMLElement | null = stoppedLine(sectionFor(title));

        expect(line?.textContent).toBe("Not counted");
        expect(line?.textContent).not.toMatch(/too long/);
      }

      expect(screen.getAllByText(/took too long/)).toHaveLength(1);
    });

    test("REGRESSION: a stopped resource facet keeps its resources, with no count rather than 0", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
        }),
      );

      const section: HTMLElement = sectionFor(testCase.resourceTitle);

      expect(stoppedLine(section)?.textContent).toBe(STOPPED_LINE);
      expect(within(section).getByText("checkout")).toBeInTheDocument();
      expect(within(section).getByText("payments")).toBeInTheDocument();

      const notCounted: Array<HTMLElement> =
        within(section).getAllByTitle("Not counted");
      expect(notCounted).toHaveLength(2);

      for (const cell of notCounted) {
        expect(cell).toHaveTextContent("—");
      }

      expect(within(section).queryByText("0")).not.toBeInTheDocument();
    });

    test("a screen reader hears 'Not counted' where the count goes, not a dash", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
        }),
      );

      const cells: Array<HTMLElement> = within(
        sectionFor(testCase.resourceTitle),
      ).getAllByTestId("facet-count-unknown");
      expect(cells).toHaveLength(2);

      for (const cell of cells) {
        // The dash is drawn for the eye only.
        expect(within(cell).getByText("—")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        // The words are read out, and kept off the screen.
        const spoken: HTMLElement = within(cell).getByText("Not counted");
        expect(spoken).toHaveClass("sr-only");
        expect(spoken).not.toHaveAttribute("aria-hidden");
      }
    });

    test("the values of a stopped facet can still be picked to narrow the search", () => {
      const onInclude: MockFunction = getJestMockFunction();

      render(
        testCase.sidebar === "logs" ? (
          <LogsFacetSidebar
            onRemoveFilter={() => {}}
            facetData={testCase.facetData}
            isLoading={false}
            serviceMap={{}}
            onIncludeFilter={(key: string, facetValue: string) => {
              onInclude(key, facetValue);
            }}
            onExcludeFilter={jest.fn()}
            selectedSavedViewId={null}
            onSavedViewSelect={jest.fn()}
            onClearSavedView={jest.fn()}
            timedOutFacets={testCase.stopped}
          />
        ) : (
          <TelemetryFacetSidebar
            onRemoveFilter={() => {}}
            facetData={testCase.facetData}
            facetConfigs={TELEMETRY_CONFIGS}
            isLoading={false}
            onIncludeFilter={(key: string, facetValue: string) => {
              onInclude(key, facetValue);
            }}
            onExcludeFilter={jest.fn()}
            timedOutFacets={testCase.stopped}
          />
        ),
      );

      fireEvent.click(
        within(sectionFor(testCase.resourceTitle)).getByText("checkout"),
      );

      expect(onInclude).toHaveBeenCalledWith("primaryEntityId", "svc-1");
    });

    test("a facet that was counted keeps its counts and says nothing", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
        }),
      );

      const section: HTMLElement = sectionFor(testCase.countedTitle);

      expect(stoppedLine(section)).toBeNull();
      expect(section).not.toHaveTextContent(STOPPED_LINE);
      expect(
        within(section).getByText(testCase.countedValue),
      ).toBeInTheDocument();
      expect(
        within(section).getByText(testCase.countedCount),
      ).toBeInTheDocument();
      expect(
        within(section).queryByTitle("Not counted"),
      ).not.toBeInTheDocument();
    });

    test("nothing stopped: no note, no 'Not counted', and an empty facet says it is empty", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: [],
        }),
      );

      expect(note()).not.toBeInTheDocument();
      expect(screen.queryByText(STOPPED_LINE)).not.toBeInTheDocument();
      expect(sectionFor(testCase.plainTitle)).toHaveTextContent(EMPTY_LINE);
    });

    test("an answer from an older server, with no timedOutFacets, reads as nothing stopped", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
        }),
      );

      expect(note()).not.toBeInTheDocument();
      expect(screen.queryByText(STOPPED_LINE)).not.toBeInTheDocument();
    });

    test("while the counts load again, the note waits for their answer", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
          isLoading: true,
        }),
      );

      expect(note()).not.toBeInTheDocument();
    });

    test("when the list already says the search could not finish, the note steps aside and the stopped facets still say so", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
          onRetryFacets: () => {},
          showCountsNotice: false,
        }),
      );

      expect(note()).not.toBeInTheDocument();
      expect(stoppedLine(sectionFor(testCase.plainTitle))?.textContent).toBe(
        STOPPED_LINE,
      );
      expect(stoppedLine(sectionFor(testCase.resourceTitle))?.textContent).toBe(
        STOPPED_LINE,
      );
    });
  },
);

/*
 * Some facets fold away while they have nothing to show and are counted in
 * the "N empty filters hidden" footer: the resource types (a project with
 * no Docker hosts), and every security event facet (a source that never
 * sends a vendor). A count the time limit stopped also comes back with
 * nothing in it, and used to be folded with them: the security events
 * explorer said "11 empty filters hidden" for eleven facets nobody had
 * counted. Not counted is not empty.
 */
describe("a facet that folds away while empty, stopped at the time limit", () => {
  const HIDEABLE_CONFIGS: Array<FacetConfig> = [
    {
      key: "severityName",
      title: "Severity",
      priority: 1,
      hideWhenEmpty: true,
    },
    { key: "vendorName", title: "Vendor", priority: 2, hideWhenEmpty: true },
    { key: "statusName", title: "Status", priority: 3, hideWhenEmpty: true },
  ];

  function footer(): HTMLElement | null {
    return screen.queryByText(/empty filters? hidden/);
  }

  test("the traces / metrics / exceptions / security events sidebar keeps it, saying 'Not counted'", () => {
    render(
      <TelemetryFacetSidebar
        onRemoveFilter={() => {}}
        facetData={{ severityName: [], vendorName: [], statusName: [] }}
        facetConfigs={HIDEABLE_CONFIGS}
        isLoading={false}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        timedOutFacets={["severityName", "statusName"]}
      />,
    );

    for (const title of ["Severity", "Status"]) {
      expect(stoppedLine(sectionFor(title))?.textContent).toBe(STOPPED_LINE);
      expect(sectionFor(title)).not.toHaveTextContent(EMPTY_LINE);
    }

    // The one that was counted and really is empty still folds away.
    expect(
      screen.queryByRole("button", { name: /^Vendor/ }),
    ).not.toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });

  test("every facet stopped: no 'empty filters hidden' at all", () => {
    render(
      <TelemetryFacetSidebar
        onRemoveFilter={() => {}}
        facetData={{ severityName: [], vendorName: [], statusName: [] }}
        facetConfigs={HIDEABLE_CONFIGS}
        isLoading={false}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        timedOutFacets={["severityName", "vendorName", "statusName"]}
        showCountsNotice={false}
      />,
    );

    expect(footer()).not.toBeInTheDocument();
    expect(screen.getAllByTestId(STOPPED_LINE_TEST_ID)).toHaveLength(3);
  });

  test("the logs sidebar keeps a stopped resource facet with nothing listed, saying 'Not counted'", () => {
    render(
      <LogsFacetSidebar
        onRemoveFilter={() => {}}
        facetData={{ severityText: [], hostId: [], dockerHostId: [] }}
        isLoading={false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        selectedSavedViewId={null}
        onSavedViewSelect={jest.fn()}
        onClearSavedView={jest.fn()}
        timedOutFacets={["hostId"]}
      />,
    );

    expect(stoppedLine(sectionFor("Host"))?.textContent).toBe(STOPPED_LINE);
    // Docker Host was counted and the project has none: it folds away.
    expect(
      screen.queryByRole("button", { name: /^Docker Host/ }),
    ).not.toBeInTheDocument();
    expect(footer()).toHaveTextContent("1 empty filter hidden");
  });
});

describe.each(CASES)(
  "$name: counts that did not load at all",
  (testCase: StoppedCase) => {
    test("a timed-out facets request says the counts took too long", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: {},
          facetError: {
            kind: TelemetryLoadErrorKind.TimedOut,
            message:
              "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.",
          },
          onRetryFacets: () => {},
        }),
      );

      expect(note()).toHaveTextContent("Filter counts took too long");
      expect(
        within(note()!).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
      ).toBeInTheDocument();
    });

    test("any other failure says the counts could not load, and why", () => {
      const onRetry: MockFunction = getJestMockFunction();

      render(
        sidebarElement(testCase.sidebar, {
          facetData: {},
          facetError: {
            kind: TelemetryLoadErrorKind.Failed,
            message: "Invalid attribute key: http.route!",
          },
          onRetryFacets: () => {
            onRetry();
          },
        }),
      );

      expect(note()).toHaveAttribute("data-kind", "failed");
      expect(note()).toHaveTextContent("Filter counts could not load");
      expect(note()).toHaveTextContent("Invalid attribute key: http.route!");

      fireEvent.click(
        within(note()!).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
      );

      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  },
);
