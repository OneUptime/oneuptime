import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import TelemetryFacetSidebar from "../../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import LogsFacetSidebar from "../../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import TelemetryActiveFilterChips, {
  EXCLUDED_FILTER_CHIP_TEST_ID,
} from "../../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../../UI/Components/TelemetryViewer/types";
import { FacetData as LogsFacetData } from "../../../../UI/Components/LogsViewer/types";
import { buildSearchTokenValue } from "../../../../Types/Telemetry/TelemetrySearchQuery";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * What a click on a facet value does, in both sidebars - the Traces /
 * Metrics / Exceptions / Security Events one (TelemetryFacetSidebar) and the
 * Logs one (LogsFacetSidebar) - and through the TelemetryViewer shell.
 *
 * The maintainer's report: "I'm not able to uncheck when I click on this."
 * The sidebar handed every click to the explorer's include handler, and the
 * explorers that only ever add left the value checked. Now the sidebar reads
 * which chips light a row and a click on a lit row takes those very chips off
 * through onRemoveFilter - the path the chip's own x takes - so these pin the
 * routing, for every way a value can be lit.
 */

const SERVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

const CONFIGS: Array<FacetConfig> = [
  {
    key: "primaryEntityId",
    title: "Service",
    priority: 1,
    valueDisplayMap: {
      [SERVICE_ID]: "checkout-api",
      [OTHER_SERVICE_ID]: "collector",
    },
  },
  { key: "statusCode", title: "Status", priority: 2 },
  {
    key: "spanType",
    title: "Span Type",
    priority: 3,
    valueDisplayMap: { root: "Root spans" },
  },
  { key: "resource.host.name", title: "Host Name", priority: 4 },
];

const SPECIAL_HOSTS: Array<string> = [
  "/api/*",
  "a?b",
  "my host",
  'say "hi"',
  "plain-host",
];

const FACET_DATA: FacetData = {
  primaryEntityId: [
    { value: SERVICE_ID, count: 2417585 },
    { value: OTHER_SERVICE_ID, count: 0 },
  ],
  statusCode: [
    { value: "0", count: 30 },
    { value: "2", count: 4 },
  ],
  spanType: [{ value: "root", count: 12 }],
  "resource.host.name": SPECIAL_HOSTS.map((host: string, index: number) => {
    return { value: host, count: 10 - index };
  }),
};

interface Callbacks {
  onInclude: MockFunction;
  onExclude: MockFunction;
  onRemove: MockFunction;
}

function callbacks(): Callbacks {
  return {
    onInclude: getJestMockFunction(),
    onExclude: getJestMockFunction(),
    onRemove: getJestMockFunction(),
  };
}

function telemetrySidebar(
  activeFilters: Array<ActiveFilter>,
  calls: Callbacks,
  options: { withExclude?: boolean; facetData?: FacetData } = {},
): ReactElement {
  return (
    <TelemetryFacetSidebar
      facetData={options.facetData || FACET_DATA}
      facetConfigs={CONFIGS}
      isLoading={false}
      activeFilters={activeFilters}
      onIncludeFilter={calls.onInclude as any}
      onExcludeFilter={
        options.withExclude ? (calls.onExclude as any) : undefined
      }
      onRemoveFilter={calls.onRemove as any}
    />
  );
}

function chip(
  facetKey: string,
  value: string,
  extra: Partial<ActiveFilter> = {},
): ActiveFilter {
  return {
    facetKey,
    value,
    displayKey: facetKey,
    displayValue: value,
    ...extra,
  };
}

// A section by its header title.
function section(title: string): HTMLElement {
  const header: HTMLElement = screen.getByRole("button", {
    name: new RegExp(`^${title}`),
  });
  return header.parentElement!.parentElement as HTMLElement;
}

function row(title: string, name: string | RegExp): HTMLElement {
  return within(section(title)).getByRole("checkbox", { name });
}

afterEach(() => {
  cleanup();
});

describe("TelemetryFacetSidebar: a click on a value", () => {
  test("REGRESSION: on a checked value takes its chip off, and does not include it again", () => {
    const calls: Callbacks = callbacks();
    render(telemetrySidebar([chip("primaryEntityId", SERVICE_ID)], calls));

    const checked: HTMLElement = row("Service", "checkout-api");
    expect(checked).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checked);

    expect(calls.onRemove.mock.calls).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test("on an unchecked value includes it", () => {
    const calls: Callbacks = callbacks();
    render(telemetrySidebar([chip("primaryEntityId", SERVICE_ID)], calls));

    const unchecked: HTMLElement = row("Service", "collector");
    expect(unchecked).toHaveAttribute("aria-checked", "false");

    fireEvent.click(unchecked);

    expect(calls.onInclude.mock.calls).toEqual([
      ["primaryEntityId", OTHER_SERVICE_ID],
    ]);
    expect(calls.onRemove).not.toHaveBeenCalled();
  });

  test("checked and unchecked follow the chips as they come and go", () => {
    function Host(): ReactElement {
      const [filters, setFilters] = useState<Array<ActiveFilter>>([]);
      return (
        <TelemetryFacetSidebar
          facetData={FACET_DATA}
          facetConfigs={CONFIGS}
          isLoading={false}
          activeFilters={filters}
          onIncludeFilter={(facetKey: string, value: string) => {
            setFilters((previous: Array<ActiveFilter>) => {
              return [...previous, chip(facetKey, value)];
            });
          }}
          onRemoveFilter={(facetKey: string, value: string) => {
            setFilters((previous: Array<ActiveFilter>) => {
              return previous.filter((filter: ActiveFilter): boolean => {
                return !(
                  filter.facetKey === facetKey && filter.value === value
                );
              });
            });
          }}
        />
      );
    }

    render(<Host />);

    const error: () => HTMLElement = (): HTMLElement => {
      return row("Status", "2");
    };

    expect(error()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(error());
    expect(error()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(error());
    expect(error()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(error());
    expect(error()).toHaveAttribute("aria-checked", "true");
  });

  test("REGRESSION: Span Type's 'Root spans' unchecks from its row", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar(
        [
          chip("spanType", "root", {
            displayKey: "Span Type",
            displayValue: "Root spans",
          }),
        ],
        calls,
      ),
    );

    const root: HTMLElement = row("Span Type", "Root spans");
    expect(root).toHaveAttribute("aria-checked", "true");

    fireEvent.click(root);

    expect(calls.onRemove.mock.calls).toEqual([["spanType", "root"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test.each(
    SPECIAL_HOSTS.map((host: string) => {
      return [host];
    }),
  )(
    "REGRESSION: a Host Name of %j shows checked, and its click takes off the escaped chip",
    (host: string) => {
      const calls: Callbacks = callbacks();
      const token: string = buildSearchTokenValue(host);
      render(
        telemetrySidebar([chip("attributes.resource.host.name", token)], calls),
      );

      const checked: HTMLElement = row("Host Name", host);
      expect(checked).toHaveAttribute("aria-checked", "true");

      // Every other host is unchecked.
      const others: Array<HTMLElement> = within(section("Host Name"))
        .getAllByRole("checkbox")
        .filter((element: HTMLElement): boolean => {
          return element !== checked;
        });
      for (const other of others) {
        expect(other).toHaveAttribute("aria-checked", "false");
      }

      fireEvent.click(checked);

      expect(calls.onRemove.mock.calls).toEqual([
        ["attributes.resource.host.name", token],
      ]);
      expect(calls.onInclude).not.toHaveBeenCalled();
    },
  );

  test("a value the page filters on shows locked, and a click asks for nothing", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar(
        [chip("primaryEntityId", SERVICE_ID, { readOnly: true })],
        calls,
        { withExclude: true },
      ),
    );

    const locked: HTMLElement = row("Service", "checkout-api");
    expect(locked).toHaveAttribute("aria-checked", "true");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(
      within(section("Service")).queryByRole("button", {
        name: "Exclude checkout-api",
      }),
    ).toBeNull();

    fireEvent.click(locked);

    expect(calls.onRemove).not.toHaveBeenCalled();
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test("the old serviceId chip lights the Service row, and a click takes off every chip behind it", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar(
        [chip("serviceId", SERVICE_ID), chip("primaryEntityId", SERVICE_ID)],
        calls,
      ),
    );

    fireEvent.click(row("Service", "checkout-api"));

    expect(calls.onRemove.mock.calls).toEqual([
      ["serviceId", SERVICE_ID],
      ["primaryEntityId", SERVICE_ID],
    ]);
  });

  test("an excluded value reads as excluded; its row and its pressed button take the exclusion off", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar([chip("!statusCode", "2")], calls, {
        withExclude: true,
      }),
    );

    const excluded: HTMLElement = row("Status", /^2/);
    expect(excluded).toHaveAttribute("aria-checked", "mixed");

    const button: HTMLElement = within(section("Status")).getByRole("button", {
      name: "Exclude 2",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(excluded);
    fireEvent.click(button);

    expect(calls.onRemove.mock.calls).toEqual([
      ["!statusCode", "2"],
      ["!statusCode", "2"],
    ]);
    expect(calls.onExclude).not.toHaveBeenCalled();
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test("the exclude button on an unchecked or checked value asks to exclude it", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar([chip("statusCode", "2")], calls, {
        withExclude: true,
      }),
    );

    fireEvent.click(
      within(section("Status")).getByRole("button", { name: "Exclude 0" }),
    );
    fireEvent.click(
      within(section("Status")).getByRole("button", { name: "Exclude 2" }),
    );

    expect(calls.onExclude.mock.calls).toEqual([
      ["statusCode", "0"],
      ["statusCode", "2"],
    ]);
    expect(calls.onRemove).not.toHaveBeenCalled();
  });

  test("an excluded value the answer left out keeps its row, so it can be cleared", () => {
    const calls: Callbacks = callbacks();
    render(
      telemetrySidebar(
        [chip("!statusCode", "1", { displayValue: "Ok" })],
        calls,
        { withExclude: true },
      ),
    );

    const excluded: HTMLElement = row("Status", /^Ok/);
    expect(excluded).toHaveAttribute("aria-checked", "mixed");

    fireEvent.click(excluded);

    expect(calls.onRemove.mock.calls).toEqual([["!statusCode", "1"]]);
  });

  test("a checked service the answer does not list is still there, by the chip's name", () => {
    const calls: Callbacks = callbacks();
    const missing: string = "33333333-3333-4333-8333-333333333333";
    render(
      telemetrySidebar(
        [chip("primaryEntityId", missing, { displayValue: "billing-api" })],
        calls,
      ),
    );

    const checked: HTMLElement = row("Service", "billing-api");
    expect(checked).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checked);

    expect(calls.onRemove.mock.calls).toEqual([["primaryEntityId", missing]]);
  });

  test("without an exclude handler no row carries an exclude button", () => {
    render(
      telemetrySidebar([chip("statusCode", "2")], callbacks(), {
        withExclude: false,
      }),
    );

    expect(screen.queryAllByRole("button", { name: /^Exclude / })).toEqual([]);
  });

  test("the section count counts checked and excluded values", () => {
    render(
      telemetrySidebar(
        [chip("statusCode", "2"), chip("!statusCode", "0")],
        callbacks(),
        { withExclude: true },
      ),
    );

    expect(
      screen.getByRole("button", { name: /^Status\s*2$/ }),
    ).toBeInTheDocument();
  });
});

describe("LogsFacetSidebar: a click on a value", () => {
  const LOGS_FACETS: LogsFacetData = {
    severityText: [
      { value: "Error", count: 12 },
      { value: "Information", count: 40 },
    ],
    primaryEntityId: [
      { value: SERVICE_ID, count: 9, displayName: "checkout-api" },
    ],
  };

  function logsSidebar(
    activeFilters: Array<ActiveFilter>,
    calls: Callbacks,
    withExclude: boolean = false,
  ): ReactElement {
    return (
      <LogsFacetSidebar
        facetData={LOGS_FACETS}
        isLoading={false}
        serviceMap={{}}
        activeFilters={activeFilters}
        onIncludeFilter={calls.onInclude as any}
        onExcludeFilter={withExclude ? (calls.onExclude as any) : undefined}
        onRemoveFilter={calls.onRemove as any}
      />
    );
  }

  test("on a checked severity takes its chip off", () => {
    const calls: Callbacks = callbacks();
    render(logsSidebar([chip("severityText", "Error")], calls));

    const checked: HTMLElement = row("Severity", "Error");
    expect(checked).toHaveAttribute("aria-checked", "true");

    fireEvent.click(checked);

    expect(calls.onRemove.mock.calls).toEqual([["severityText", "Error"]]);
    expect(calls.onInclude).not.toHaveBeenCalled();
  });

  test("on an unchecked one includes it", () => {
    const calls: Callbacks = callbacks();
    render(logsSidebar([chip("severityText", "Error")], calls));

    fireEvent.click(row("Severity", "Information"));

    expect(calls.onInclude.mock.calls).toEqual([
      ["severityText", "Information"],
    ]);
    expect(calls.onRemove).not.toHaveBeenCalled();
  });

  test("on a checked service takes it off, by its id", () => {
    const calls: Callbacks = callbacks();
    render(logsSidebar([chip("primaryEntityId", SERVICE_ID)], calls));

    fireEvent.click(row("Service", "checkout-api"));

    expect(calls.onRemove.mock.calls).toEqual([
      ["primaryEntityId", SERVICE_ID],
    ]);
  });

  test("the logs explorer passes no exclude handler, so its rows offer no exclude", () => {
    render(logsSidebar([], callbacks()));

    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /^Exclude / })).toEqual([]);
  });

  test("with an exclude handler the rows offer one", () => {
    const calls: Callbacks = callbacks();
    render(logsSidebar([], calls, true));

    fireEvent.click(screen.getByRole("button", { name: "Exclude Error" }));

    expect(calls.onExclude.mock.calls).toEqual([["severityText", "Error"]]);
  });
});

describe("the chip row draws an exclusion in the sidebar's red", () => {
  test("an excluded chip is red, an included one indigo, and both come off with x", () => {
    const onRemove: MockFunction = getJestMockFunction();
    /*
     * Both chips name the field alike; the row says the exclusion excludes
     * ("Severity is not"), in words as well as in red.
     */
    render(
      <TelemetryActiveFilterChips
        filters={[
          chip("severityName", "Critical", { displayKey: "Severity" }),
          chip("!severityName", "Low", { displayKey: "Severity" }),
        ]}
        onRemove={onRemove as any}
        onClearAll={jest.fn()}
      />,
    );

    const excluded: HTMLElement = screen.getByTestId(
      EXCLUDED_FILTER_CHIP_TEST_ID,
    );
    expect(excluded).toHaveTextContent(/^Severity is not:Low$/);
    expect(excluded).toHaveClass("border-red-200", "bg-red-50", "text-red-700");
    expect(within(excluded).getByRole("button")).toHaveAttribute(
      "title",
      "Remove Severity is not: Low",
    );

    const included: HTMLElement = screen
      .getByText("Critical")
      .closest("span.inline-flex") as HTMLElement;
    expect(included).toHaveTextContent(/^Severity:Critical$/);
    expect(included).toHaveClass("bg-indigo-50");
    expect(included).not.toHaveAttribute("data-testid");

    fireEvent.click(within(excluded).getByRole("button"));

    expect(onRemove.mock.calls).toEqual([["!severityName", "Low"]]);
  });
});

describe("TelemetryViewer hands the sidebar's clicks to the explorer", () => {
  function viewer(
    activeFilters: Array<ActiveFilter>,
    calls: Callbacks,
    withExclude: boolean,
  ): ReactElement {
    return (
      <TelemetryViewer<string>
        items={[]}
        isLoading={false}
        renderRow={(item: string): ReactElement => {
          return <span>{item}</span>;
        }}
        getRowKey={(item: string): string => {
          return item;
        }}
        searchValue=""
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={() => {}}
        showHistogram={false}
        facetData={FACET_DATA}
        facetConfigs={CONFIGS}
        activeFilters={activeFilters}
        onFacetInclude={calls.onInclude as any}
        onFacetExclude={withExclude ? (calls.onExclude as any) : undefined}
        onRemoveFilter={calls.onRemove as any}
        page={1}
        pageSize={25}
        totalCount={0}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />
    );
  }

  test("a checked value's click reaches onRemoveFilter, an unchecked one's onFacetInclude", () => {
    const calls: Callbacks = callbacks();
    render(viewer([chip("statusCode", "2")], calls, false));

    fireEvent.click(row("Status", "2"));
    fireEvent.click(row("Status", "0"));

    expect(calls.onRemove.mock.calls).toEqual([["statusCode", "2"]]);
    expect(calls.onInclude.mock.calls).toEqual([["statusCode", "0"]]);
  });

  test("an explorer that passes no onFacetExclude gets no exclude buttons", () => {
    render(viewer([], callbacks(), false));

    expect(screen.queryAllByRole("button", { name: /^Exclude / })).toEqual([]);
  });

  test("an explorer that passes onFacetExclude gets them, wired", () => {
    const calls: Callbacks = callbacks();
    render(viewer([], calls, true));

    fireEvent.click(
      within(section("Status")).getByRole("button", { name: "Exclude 0" }),
    );

    expect(calls.onExclude.mock.calls).toEqual([["statusCode", "0"]]);
  });
});
