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
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import { getLockedFilterChipAriaLabel } from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import {
  getCopyLockedFiltersAriaLabel,
  getOpenExplorerAriaLabel,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterActions";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";

/*
 * The logs chip list, now that its read-only chips are LockedFilterChips: a
 * locked chip explains itself through its detail, the copy / open actions
 * follow the locked group, and everything the list already did — remove
 * buttons, "Clear all", the open-trace icon-link, the operator-value
 * backstop — is untouched.
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

function lockedClusterChip(
  overrides: Partial<ActiveFilter> = {},
): ActiveFilter {
  return {
    facetKey: "attributes.resource.k8s.cluster.name",
    value: "prod-eks-01",
    displayKey: "Cluster",
    displayValue: "production",
    readOnly: true,
    lockedDetail: {
      source: "Pinned by this page",
      summary: "Only logs from this Kubernetes cluster are shown.",
      predicates: [
        {
          label: "Attribute",
          expression: 'resource.k8s.cluster.name = "prod-eks-01"',
        },
      ],
      searchToken: "@resource.k8s.cluster.name:prod-eks-01",
    },
    ...overrides,
  };
}

function removableChip(overrides: Partial<ActiveFilter> = {}): ActiveFilter {
  return {
    facetKey: "severityText",
    value: "Error",
    displayKey: "Severity",
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

describe("ActiveFilterChips — locked chips", () => {
  test("a read-only chip renders as a locked chip: a named button, no remove control", () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    const chip: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Cluster", "production", true),
    });

    expect(chip).toHaveTextContent("Cluster:");
    expect(chip).toHaveTextContent("production");
    expect(screen.queryByTitle(/^Remove /)).not.toBeInTheDocument();
  });

  test("hovering the locked chip explains the filter", async () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    await hover(
      screen.getByRole("button", {
        name: getLockedFilterChipAriaLabel("Cluster", "production", true),
      }),
    );

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent(
      "Only logs from this Kubernetes cluster are shown.",
    );
    expect(tooltip).toHaveTextContent("@resource.k8s.cluster.name:prod-eks-01");
    // The list is the logs list: it names its explorer without being told.
    expect(tooltip).toHaveTextContent(
      "Paste into the Logs explorer search bar.",
    );
  });

  test("a read-only chip without a detail keeps the plain title", () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip({ lockedDetail: undefined })]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(
      document.querySelector("[title='Cluster: production (applied filter)']"),
    ).not.toBeNull();
  });

  test("a read-only chip with an openRoute keeps its icon-link inside the pill", () => {
    render(
      <ActiveFilterChips
        filters={[
          lockedClusterChip({
            facetKey: "traceId",
            value: "trace-1",
            displayKey: "Trace",
            displayValue: "trace-1",
            openRoute: new Route("/traces/view/trace-1"),
          }),
        ]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("locked-filter-chip");
    const control: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Trace", "trace-1", true),
    });
    const link: HTMLElement = screen.getByRole("link", {
      name: "Open trace view",
    });

    expect(pill).toContainElement(link);
    // Beside the chip's own control, never inside it.
    expect(control).not.toContainElement(link);
    expect(link).toHaveAttribute("href", "/traces/view/trace-1");
  });

  test("a read-only chip without a detail is not a tab stop and has no name of its own", () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip({ lockedDetail: undefined })]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("locked-filter-chip");

    expect(pill).not.toHaveAttribute("tabindex");
    expect(pill).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("an operator-valued read-only chip still renders as text (the backstop)", () => {
    render(
      <ActiveFilterChips
        filters={[
          lockedClusterChip({
            facetKey: "attributes.logtype",
            value: new Includes(["web"]) as unknown as string,
            displayKey: "logtype",
            displayValue: new Includes(["web"]) as unknown as string,
            lockedDetail: undefined,
          }),
        ]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(document.body.textContent).not.toContain("[object Object]");
    expect(screen.getByText("is any of web")).toBeInTheDocument();
    expect(
      document.querySelector(
        "[title='logtype: is any of web (applied filter)']",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ActiveFilterChips — locked filter actions", () => {
  test("renders the actions after the locked chips and before the removable ones", () => {
    render(
      <ActiveFilterChips
        filters={[removableChip(), lockedClusterChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        lockedFilterActions={{
          copyText: "@resource.k8s.cluster.name:prod-eks-01",
          openExplorerRoute: new Route("/dashboard/p1/logs?filters=x"),
        }}
      />,
    );

    const locked: HTMLElement = screen.getByRole("button", {
      name: getLockedFilterChipAriaLabel("Cluster", "production", true),
    });
    const actions: HTMLElement = screen.getByTestId("locked-filter-actions");
    const remove: HTMLElement = screen.getByTitle("Remove Severity: Error");

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
        name: getCopyLockedFiltersAriaLabel("Logs"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: getOpenExplorerAriaLabel("Logs") }),
    ).toHaveAttribute("href", "/dashboard/p1/logs?filters=x");
  });

  test("renders no actions when there is no locked chip, even if the host offers them", () => {
    render(
      <ActiveFilterChips
        filters={[removableChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });

  test("renders no actions when the host offers none", () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-actions"),
    ).not.toBeInTheDocument();
  });

  test("a signal other than logs names that explorer instead", () => {
    render(
      <ActiveFilterChips
        filters={[lockedClusterChip()]}
        onRemove={() => {}}
        onClearAll={() => {}}
        signal="traces"
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: getCopyLockedFiltersAriaLabel("Traces"),
      }),
    ).toBeInTheDocument();
  });
});

describe("ActiveFilterChips — unchanged behaviour", () => {
  test("removable chips still remove and Clear all still appears for two or more", () => {
    const removed: Array<[string, string]> = [];
    let cleared: number = 0;

    render(
      <ActiveFilterChips
        filters={[
          lockedClusterChip(),
          removableChip(),
          removableChip({ value: "Warning", displayValue: "Warning" }),
        ]}
        onRemove={(facetKey: string, value: string) => {
          removed.push([facetKey, value]);
        }}
        onClearAll={() => {
          cleared += 1;
        }}
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    fireEvent.click(screen.getByTitle("Remove Severity: Error"));
    expect(removed).toEqual([["severityText", "Error"]]);

    fireEvent.click(screen.getByText("Clear all"));
    expect(cleared).toBe(1);
  });

  test("renders nothing at all for an empty list", () => {
    const { container } = render(
      <ActiveFilterChips
        filters={[]}
        onRemove={() => {}}
        onClearAll={() => {}}
        lockedFilterActions={{ copyText: "@k:v" }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
