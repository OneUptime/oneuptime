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
  within,
} from "@testing-library/react";
import React from "react";
import LockedFilterChip, {
  DEFAULT_SCOPE_SUMMARY,
  LockedFilterTooltipContent,
  NO_SEARCH_SYNTAX_REASON,
  countLockedFilterScopeValues,
  getLockedFilterChipAriaLabel,
  getLockedFilterScopeMatches,
} from "../../../UI/Components/TelemetryViewer/components/LockedFilterChip";
import TelemetryActiveFilterChips from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import {
  LockedFilterDetail,
  LockedFilterScopeMatch,
} from "../../../Types/Telemetry/LockedFilterDetail";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";

/*
 * The locked chip that stands for a WHOLE scope — "Database: orders-db" on a
 * database's Logs, Traces and Metrics tabs, which used to be 26 separate
 * pills (the database's id, each endpoint, each pod). Its tooltip is where
 * the reader learns what the page actually filters on, so it must:
 *
 *  - open with a one-line summary, then list every kind of match with its
 *    count, its sentence and every value, in order;
 *  - leave out the "Search syntax" section when there is none to copy (the
 *    list already says what the filter does), and keep it when there is;
 *  - mark the chip so the reader can tell there is more behind it, and say
 *    in its accessible name how many values it matches;
 *  - never change a chip without a scope breakdown.
 */

const ENDPOINTS: Array<string> = [
  "db.prod.svc.cluster.local:5432",
  "db.prod.svc.cluster.local:5432@prod",
  "db-ro.prod.svc.cluster.local:5432",
];

const SCOPE_MATCHES: Array<LockedFilterScopeMatch> = [
  {
    label: "Database ID",
    description: "Sent with this database's ID.",
    values: ["aaed6619-f358-4d43-bfe3-3d2d314f5748"],
  },
  {
    label: "Endpoints",
    description: "Addressed to one of these addresses.",
    values: ENDPOINTS,
  },
  {
    label: "Instances",
    values: ["orders-db (34bf5dae)"],
  },
];

const SUMMARY: string = "Shows telemetry from this database.";
const GROUP_REASON: string = "This scope matches several resources at once.";

function scopeDetail(
  overrides: Partial<LockedFilterDetail> = {},
): LockedFilterDetail {
  return {
    searchTokenUnavailableReason: GROUP_REASON,
    scopeSummary: SUMMARY,
    scopeMatches: SCOPE_MATCHES,
    ...overrides,
  };
}

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let writeText: WriteTextMock;

beforeEach(() => {
  jest.useFakeTimers();
  writeText = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(150);
  });
}

function scopeHeadings(container: HTMLElement): Array<string> {
  return within(container)
    .getAllByTestId("locked-filter-scope-match")
    .map((match: HTMLElement): string => {
      const heading: string =
        match.querySelector("span.uppercase")?.textContent || "";
      const count: string =
        within(match).getByTestId("locked-filter-scope-match-count")
          .textContent || "";
      return `${heading} ${count}`;
    });
}

describe("getLockedFilterScopeMatches", () => {
  test("returns the breakdown as given when it is well formed", () => {
    expect(getLockedFilterScopeMatches(scopeDetail())).toEqual(SCOPE_MATCHES);
  });

  test("no detail, no breakdown, or a non-array breakdown is nothing", () => {
    expect(getLockedFilterScopeMatches(undefined)).toEqual([]);
    expect(getLockedFilterScopeMatches({})).toEqual([]);
    expect(
      getLockedFilterScopeMatches({
        scopeMatches: "Endpoints" as unknown as Array<LockedFilterScopeMatch>,
      }),
    ).toEqual([]);
  });

  test("drops headings without a label or without a value, and blank values", () => {
    const detail: LockedFilterDetail = {
      scopeMatches: [
        { label: "  ", values: ["a"] },
        { label: "Empty", values: [] },
        { label: "Blank", values: ["  ", ""] },
        { label: " Endpoints ", values: [" a:1 ", "", "b:2"] },
        null as unknown as LockedFilterScopeMatch,
        "junk" as unknown as LockedFilterScopeMatch,
        {
          label: "Mixed",
          values: [7, "ok"] as unknown as Array<string>,
        },
        {
          label: "No values array",
          values: undefined as unknown as Array<string>,
        },
      ],
    };

    expect(getLockedFilterScopeMatches(detail)).toEqual([
      { label: "Endpoints", values: ["a:1", "b:2"] },
      { label: "Mixed", values: ["ok"] },
    ]);
  });

  test("keeps a description only when it has text", () => {
    expect(
      getLockedFilterScopeMatches({
        scopeMatches: [
          { label: "A", description: "  ", values: ["1"] },
          { label: "B", description: " Why. ", values: ["2"] },
        ],
      }),
    ).toEqual([
      { label: "A", values: ["1"] },
      { label: "B", description: "Why.", values: ["2"] },
    ]);
  });
});

describe("countLockedFilterScopeValues", () => {
  test("adds up the values under every heading", () => {
    expect(countLockedFilterScopeValues(SCOPE_MATCHES)).toBe(5);
    expect(countLockedFilterScopeValues([])).toBe(0);
  });
});

describe("getLockedFilterChipAriaLabel with a scope", () => {
  test("says how many values the chip matches", () => {
    expect(
      getLockedFilterChipAriaLabel("Database", "orders-db", false, 26),
    ).toBe("Database: orders-db, locked filter matching any of 26 values");
  });

  test("says 'value' for one", () => {
    expect(
      getLockedFilterChipAriaLabel("Database", "orders-db", false, 1),
    ).toBe("Database: orders-db, locked filter matching any of 1 value");
  });

  test("keeps the Enter hint when there is syntax to copy", () => {
    expect(getLockedFilterChipAriaLabel("Pod", "checkout", true, 1)).toBe(
      "Pod: checkout, locked filter matching any of 1 value. Press Enter to copy its search syntax.",
    );
  });

  test("no count, or zero, reads exactly as before", () => {
    expect(getLockedFilterChipAriaLabel("Cluster", "prod", false, 0)).toBe(
      "Cluster: prod, locked filter",
    );
    expect(getLockedFilterChipAriaLabel("Cluster", "prod", true)).toBe(
      "Cluster: prod, locked filter. Press Enter to copy its search syntax.",
    );
  });
});

describe("LockedFilterTooltipContent with a scope", () => {
  test("opens with the summary, then every heading with its count", () => {
    render(<LockedFilterTooltipContent lockedDetail={scopeDetail()} />);

    const tooltip: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(
      within(tooltip).getByTestId("locked-filter-scope-summary"),
    ).toHaveTextContent(SUMMARY);
    expect(scopeHeadings(tooltip)).toEqual([
      "Database ID 1",
      "Endpoints 3",
      "Instances 1",
    ]);
  });

  test("lists every value, in order, under its heading", () => {
    render(<LockedFilterTooltipContent lockedDetail={scopeDetail()} />);

    const matches: Array<HTMLElement> = screen.getAllByTestId(
      "locked-filter-scope-match",
    );

    expect(
      within(matches[1]!)
        .getAllByTestId("locked-filter-scope-value")
        .map((value: HTMLElement): string => {
          return value.textContent || "";
        }),
    ).toEqual(ENDPOINTS);
    expect(screen.getAllByTestId("locked-filter-scope-value")).toHaveLength(5);
  });

  test("shows each heading's sentence, and none where there is none", () => {
    render(<LockedFilterTooltipContent lockedDetail={scopeDetail()} />);

    const matches: Array<HTMLElement> = screen.getAllByTestId(
      "locked-filter-scope-match",
    );

    expect(matches[0]).toHaveTextContent("Sent with this database's ID.");
    expect(matches[1]).toHaveTextContent(
      "Addressed to one of these addresses.",
    );
    expect(matches[2]!.querySelectorAll("p")).toHaveLength(0);
  });

  test("falls back to the default summary", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={scopeDetail({ scopeSummary: "   " })}
      />,
    );

    expect(screen.getByTestId("locked-filter-scope-summary")).toHaveTextContent(
      DEFAULT_SCOPE_SUMMARY,
    );
  });

  test("leaves out the search syntax section when there is nothing to copy", () => {
    render(<LockedFilterTooltipContent lockedDetail={scopeDetail()} />);

    const tooltip: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(tooltip).not.toHaveTextContent("Search syntax");
    expect(tooltip).not.toHaveTextContent(GROUP_REASON);
    expect(tooltip).not.toHaveTextContent(NO_SEARCH_SYNTAX_REASON);
    expect(within(tooltip).queryByRole("button")).not.toBeInTheDocument();
  });

  test("keeps the search syntax, below the list, when there is a token", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={scopeDetail({
          searchToken: "@resource.k8s.pod.name:checkout",
          searchTokenUnavailableReason: undefined,
        })}
        signal="logs"
      />,
    );

    const tooltip: HTMLElement = screen.getByTestId("locked-filter-tooltip");
    const scope: HTMLElement = within(tooltip).getByTestId(
      "locked-filter-scope",
    );
    const token: HTMLElement = within(tooltip).getByTestId(
      "locked-filter-search-token",
    );

    expect(token).toHaveTextContent("@resource.k8s.pod.name:checkout");
    expect(tooltip).toHaveTextContent("Search syntax");
    expect(tooltip).toHaveTextContent(
      "Paste into the Logs explorer search bar.",
    );
    // The list comes first: it is what the reader opened the chip for.
    expect(
      scope.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(tooltip).getByRole("button", { name: "Copy search syntax" }),
    ).toBeInTheDocument();
  });

  test("a breakdown with nothing usable renders the plain syntax tooltip", () => {
    render(
      <LockedFilterTooltipContent
        lockedDetail={{
          searchTokenUnavailableReason: GROUP_REASON,
          scopeMatches: [{ label: "Endpoints", values: [" "] }],
        }}
      />,
    );

    const tooltip: HTMLElement = screen.getByTestId("locked-filter-tooltip");

    expect(tooltip.textContent).toBe(`Search syntax${GROUP_REASON}`);
    expect(screen.queryByTestId("locked-filter-scope")).not.toBeInTheDocument();
  });

  test("scrolls a long list inside the tooltip instead of growing it", () => {
    const many: Array<string> = [];
    for (let index: number = 0; index < 60; index++) {
      many.push(`db-${index}.prod:5432`);
    }

    render(
      <LockedFilterTooltipContent
        lockedDetail={scopeDetail({
          scopeMatches: [{ label: "Endpoints", values: many }],
        })}
      />,
    );

    const list: HTMLElement = screen.getByTestId("locked-filter-scope-match")
      .parentElement as HTMLElement;

    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("max-h-64");
    expect(screen.getAllByTestId("locked-filter-scope-value")).toHaveLength(60);
  });
});

describe("LockedFilterChip with a scope", () => {
  test("is named for the scope and how much it matches, and carries the info mark", () => {
    render(
      <LockedFilterChip
        displayKey="Database"
        displayValue="orders-db"
        lockedDetail={scopeDetail()}
        signal="logs"
      />,
    );

    const control: HTMLElement = screen.getByRole("button", {
      name: "Database: orders-db, locked filter matching any of 5 values",
    });

    expect(control).toHaveTextContent("Database:");
    expect(control).toHaveTextContent("orders-db");
    expect(
      within(control).getByTestId("locked-filter-chip-scope-mark"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("hover opens the list of what it matches", async () => {
    render(
      <LockedFilterChip
        displayKey="Database"
        displayValue="orders-db"
        lockedDetail={scopeDetail()}
        signal="logs"
      />,
    );

    await hover(screen.getByRole("button"));

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(scopeHeadings(tooltip)).toEqual([
      "Database ID 1",
      "Endpoints 3",
      "Instances 1",
    ]);
    expect(tooltip).toHaveTextContent(ENDPOINTS[1]!);
  });

  test("Enter copies nothing when there is no syntax", async () => {
    render(
      <LockedFilterChip
        displayKey="Database"
        displayValue="orders-db"
        lockedDetail={scopeDetail()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(writeText).not.toHaveBeenCalled();
  });

  test("Enter still copies a scope chip's token when it has one", async () => {
    render(
      <LockedFilterChip
        displayKey="Pod"
        displayValue="checkout"
        lockedDetail={scopeDetail({
          searchToken: "@resource.k8s.pod.name:checkout",
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(writeText).toHaveBeenCalledWith("@resource.k8s.pod.name:checkout");
  });

  test("a chip without a breakdown has no info mark", () => {
    render(
      <LockedFilterChip
        displayKey="Cluster"
        displayValue="prod"
        lockedDetail={{ searchToken: "@resource.k8s.cluster.name:prod" }}
      />,
    );

    expect(
      screen.queryByTestId("locked-filter-chip-scope-mark"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Cluster: prod, locked filter. Press Enter to copy its search syntax.",
      }),
    ).toBeInTheDocument();
  });
});

describe("the chip lists render a scope chip as one pill", () => {
  const scopeChip: ActiveFilter = {
    facetKey: "entityKeys",
    value: "database:orders",
    displayKey: "Database",
    displayValue: "orders-db",
    readOnly: true,
    lockedDetail: scopeDetail(),
  };

  test("the traces / metrics chip list", () => {
    render(
      <TelemetryActiveFilterChips
        filters={[scopeChip]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
        signal="traces"
      />,
    );

    expect(screen.getAllByTestId("locked-filter-chip")).toHaveLength(1);
    expect(
      screen.getByTestId("locked-filter-chip-scope-mark"),
    ).toBeInTheDocument();
  });

  test("the logs chip list", () => {
    render(
      <ActiveFilterChips
        filters={[scopeChip]}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />,
    );

    expect(screen.getAllByTestId("locked-filter-chip")).toHaveLength(1);
    expect(screen.getByTestId("locked-filter-chip")).toHaveTextContent(
      "Database:orders-db",
    );
  });
});
