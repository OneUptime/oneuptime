import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import TelemetryActiveFilterChips from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";
import { getLockedFilterChipAriaLabel } from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import {
  getCopyLockedFiltersAriaLabel,
  getOpenExplorerAriaLabel,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterActions";
import Route from "../../../Types/API/Route";

/*
 * The traces / metrics chip list, now that its read-only chips are
 * LockedFilterChips. Same contract as the logs list, minus the logs-only
 * open-route affordance and the operator-value backstop.
 */

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: jest.fn<(text: string) => Promise<void>>(
        async (): Promise<void> => {},
      ),
    },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function lockedHostChip(overrides: Partial<ActiveFilter> = {}): ActiveFilter {
  return {
    facetKey: "attributes.resource.host.name",
    value: "web-01",
    displayKey: "Host",
    displayValue: "web-01",
    readOnly: true,
    lockedDetail: {
      source: "Pinned by this page",
      summary: "Only traces from this host are shown.",
      predicates: [
        { label: "Attribute", expression: 'resource.host.name = "web-01"' },
      ],
      searchToken: "@resource.host.name:web-01",
    },
    ...overrides,
  };
}

function removableChip(overrides: Partial<ActiveFilter> = {}): ActiveFilter {
  return {
    facetKey: "statusCode",
    value: "Error",
    displayKey: "Status",
    displayValue: "Error",
    ...overrides,
  };
}

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

describe("TelemetryActiveFilterChips — locked chips", () => {
  test("a read-only chip renders as a locked chip: a named button, no remove control", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
      />,
    );

    const chip: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Host", "web-01", true),
    });

    expect(chip).toHaveTextContent("Host:");
    expect(chip).toHaveTextContent("web-01");
    expect(screen.queryByTitle(/^Remove /)).not.toBeInTheDocument();
  });

  test("a read-only chip without a detail is not a tab stop and has no name of its own", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip({ lockedDetail: undefined })]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
      />,
    );

    const pill: HTMLElement = screen.getByTestId("locked-filter-chip");

    expect(pill).not.toHaveAttribute("tabindex");
    expect(pill).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("hovering the locked chip explains the filter and names the explorer", async () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
      />,
    );

    await hover(
      screen.getByRole("button", {
        name: getLockedFilterChipAriaLabel("Host", "web-01", true),
      }),
    );

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Only traces from this host are shown.");
    expect(tooltip).toHaveTextContent("@resource.host.name:web-01");
    expect(tooltip).toHaveTextContent(
      "Paste into the Traces explorer search bar.",
    );
  });

  test("a read-only chip without a detail keeps the plain title", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip({ lockedDetail: undefined })]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(
      document.querySelector("[title='Host: web-01 (applied filter)']"),
    ).not.toBeNull();
  });
});

describe("TelemetryActiveFilterChips — locked filter actions", () => {
  test("renders the actions after the locked chips and before the removable ones", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[removableChip(), lockedHostChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="metrics"
        lockedFilterActions={{
          copyText: "@resource.host.name:web-01",
          openExplorerRoute: new Route("/dashboard/p1/metrics?filters=x"),
        }}
      />,
    );

    const locked: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Host", "web-01", true),
    });
    const actions: HTMLElement = screen.getByTestId("locked-filter-actions");
    const remove: HTMLElement = screen.getByTitle("Remove Status: Error");

    expect(
      locked.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      actions.compareDocumentPosition(remove) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: getCopyLockedFiltersAriaLabel("Metrics"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: getOpenExplorerAriaLabel("Metrics") }),
    ).toHaveAttribute("href", "/dashboard/p1/metrics?filters=x");
  });

  test("renders no actions without a signal — the group cannot name its explorer", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });

  test("renders no actions when there is no locked chip", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[removableChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });

  test("renders no actions when the host offers none", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[lockedHostChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });
});

describe("TelemetryActiveFilterChips — unchanged behaviour", () => {
  test("removable chips still remove and Clear all still appears for two or more", () => {
    const removed: Array<[string, string]> = [];
    let cleared: number = 0;

    render(
      <TelemetryActiveFilterChips
        filters={[
          lockedHostChip(),
          removableChip(),
          removableChip({ value: "Ok", displayValue: "Ok" }),
        ]}
        onRemove={(facetKey: string, value: string) => {
          removed.push([facetKey, value]);
        }}
        onClearAll={() => {
          cleared += 1;
        }}
        signal="traces"
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove Status: Error"));
    expect(removed).toEqual([["statusCode", "Error"]]);

    fireEvent.click(screen.getByText("Clear all"));
    expect(cleared).toBe(1);
  });

  test("a single removable chip shows no Clear all", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[removableChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });

  test("renders nothing at all for an empty list", () => {
    const { container } = render(
      <TelemetryActiveFilterChips
        filters={[]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
