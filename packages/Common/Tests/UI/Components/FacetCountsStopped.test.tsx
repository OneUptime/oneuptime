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
 *     keep their own line.
 */

const STOPPED_LINE: string = "Not counted: this took too long.";
const EMPTY_LINE: string = "No values in this time range";

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

      expect(section).toHaveTextContent(STOPPED_LINE);
      expect(section).not.toHaveTextContent(EMPTY_LINE);
    });

    test("REGRESSION: a stopped resource facet keeps its resources, with no count rather than 0", () => {
      render(
        sidebarElement(testCase.sidebar, {
          facetData: testCase.facetData,
          timedOutFacets: testCase.stopped,
        }),
      );

      const section: HTMLElement = sectionFor(testCase.resourceTitle);

      expect(section).toHaveTextContent(STOPPED_LINE);
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

    test("the values of a stopped facet can still be picked to narrow the search", () => {
      const onInclude: MockFunction = getJestMockFunction();

      render(
        testCase.sidebar === "logs" ? (
          <LogsFacetSidebar
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
      expect(sectionFor(testCase.plainTitle)).toHaveTextContent(STOPPED_LINE);
      expect(sectionFor(testCase.resourceTitle)).toHaveTextContent(
        STOPPED_LINE,
      );
    });
  },
);

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
