import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import MonitorCriteriaInstanceView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaInstance";
import EvaluationLogList from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * A monitor criteria asks how its filters combine - All or Any - only once
 * it has two filters, everywhere it shows them.
 *
 * The criteria editor drew its Filter Condition radio above the filters of
 * every criteria, with one filter or none; most criteria have one, where the
 * two answers mean the same. It is a Radio drawn by hand, not a form field,
 * so the guard for form fields did not see it (it reads controls too now).
 * The radio - titled Match Condition, as the metric criteria's already was,
 * so it no longer shares its name with each filter's own Filter Condition -
 * now appears under the filters from the second one on, starts on what the
 * criteria holds, and goes when the criteria is back to one filter, keeping
 * the value. The criteria's read-only view and its evaluation log name All
 * or Any only from two filters too.
 */

const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: OPERATIONAL_STATUS_ID.toString(), label: "Operational" },
];

const SLOW_RESPONSE: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 3000,
};

const OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

function buildCriteria(
  filters: Array<CriteriaFilter>,
  filterCondition: FilterCondition,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: filterCondition,
    filters: filters.map((filter: CriteriaFilter): CriteriaFilter => {
      return { ...filter };
    }),
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Slow or offline",
    description: "",
  };
  return instance;
}

interface CriteriaHarness {
  latest: () => MonitorCriteriaInstance;
}

function renderEditor(
  initial: MonitorCriteriaInstance,
  monitorType: MonitorType = MonitorType.Website,
): CriteriaHarness {
  let latest: MonitorCriteriaInstance = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteriaInstance>(initial);

    return (
      <MonitorCriteriaInstanceElement
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteriaInstance) => {
          // What MonitorCriteria.tsx does with every change.
          const rebuilt: MonitorCriteria = MonitorCriteria.fromJSON({
            _type: "MonitorCriteria",
            value: {
              monitorCriteriaInstanceArray: [changed],
            },
          } as never);

          latest = rebuilt.data!.monitorCriteriaInstanceArray[0]!;
          setValue(latest);
        }}
      />
    );
  };

  render(<Wrapper />);

  return {
    latest: (): MonitorCriteriaInstance => {
      return latest;
    },
  };
}

function matchCondition(): HTMLElement | null {
  return screen.queryByRole("radiogroup", { name: /^Match Condition/ });
}

afterEach(() => {
  cleanup();
});

describe("the criteria editor", () => {
  test("asks no All or Any for a criteria with one filter", () => {
    renderEditor(buildCriteria([SLOW_RESPONSE], FilterCondition.All));

    expect(matchCondition()).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.queryByTestId("monitor-criteria-filter-condition"),
    ).not.toBeInTheDocument();
  });

  test("asks Match Condition once a second filter is added, on All, under the filters", () => {
    const harness: CriteriaHarness = renderEditor(
      buildCriteria([SLOW_RESPONSE], FilterCondition.All),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Filter" }));

    const group: HTMLElement = matchCondition() as HTMLElement;

    expect(group).toBeInTheDocument();
    expect(within(group).getByLabelText("All")).toBeChecked();
    expect(within(group).getByLabelText("Any")).not.toBeChecked();
    expect(
      screen.getByText("Should all filters match, or just any one of them?"),
    ).toBeInTheDocument();
    expect(harness.latest().data!.filters).toHaveLength(2);

    // Below the filters and their Add Filter button.
    expect(
      screen
        .getByRole("button", { name: "Add Filter" })
        .compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("offers All, then Any", () => {
    renderEditor(buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.All));

    expect(
      within(matchCondition() as HTMLElement)
        .getAllByRole("radio")
        .map((radio: HTMLElement): string => {
          return radio.parentElement?.textContent || "";
        }),
    ).toEqual(["All", "Any"]);
  });

  test("hands Any up when it is picked", () => {
    const harness: CriteriaHarness = renderEditor(
      buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.All),
    );

    fireEvent.click(
      within(matchCondition() as HTMLElement).getByLabelText("Any"),
    );

    expect(harness.latest().data!.filterCondition).toBe(FilterCondition.Any);
  });

  test("stops asking when the criteria is back to one filter, and keeps Any", () => {
    const harness: CriteriaHarness = renderEditor(
      buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.Any),
    );

    expect(
      within(matchCondition() as HTMLElement).getByLabelText("Any"),
    ).toBeChecked();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Delete Filter" })[1]!,
    );

    expect(matchCondition()).not.toBeInTheDocument();
    expect(harness.latest().data!.filters).toHaveLength(1);
    expect(harness.latest().data!.filterCondition).toBe(FilterCondition.Any);
  });

  test("calls it Match Condition for metric criteria too, asking about rules", () => {
    renderEditor(
      buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.All),
      MonitorType.Metrics,
    );

    expect(matchCondition()).toBeInTheDocument();
    expect(
      screen.getByText("Should all rules match, or just any one of them?"),
    ).toBeInTheDocument();
  });

  test("no longer names the radio after each filter's own Filter Condition", () => {
    renderEditor(buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.All));

    expect(
      screen.queryByRole("radiogroup", { name: /^Filter Condition/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Select All if you want all the criteria to be met. Select any if you like any criteria to be met.",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("a folded criteria's header and Filters section", () => {
  function renderList(instances: Array<MonitorCriteriaInstance>): void {
    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = { monitorCriteriaInstanceArray: instances };

    const Wrapper: FunctionComponent = (): ReactElement => {
      const [value, setValue] =
        React.useState<MonitorCriteria>(monitorCriteria);

      return (
        <MonitorCriteriaElement
          monitorType={MonitorType.Website}
          monitorStep={new MonitorStep()}
          monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
          incidentSeverityDropdownOptions={[]}
          alertSeverityDropdownOptions={[]}
          onCallPolicyDropdownOptions={[]}
          labelDropdownOptions={[]}
          userDropdownOptions={[]}
          value={value}
          onChange={setValue}
          foldDefaultCriteria={true}
        />
      );
    };

    render(<Wrapper />);
  }

  test("say one filter as one filter, and ALL or ANY only from two", () => {
    renderList([
      buildCriteria([SLOW_RESPONSE], FilterCondition.Any),
      buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.Any),
      buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.All),
    ]);

    const headers: Array<string> = screen
      .getAllByTestId("monitor-criteria-header")
      .map((header: HTMLElement): string => {
        return header.textContent || "";
      });

    expect(headers[0]).toContain("1 filter");
    expect(headers[0]).not.toContain("ANY");
    expect(headers[1]).toContain("2 filters (ANY)");
    expect(headers[2]).toContain("2 filters (ALL)");
  });
});

describe("the criteria's read-only view", () => {
  function renderView(instance: MonitorCriteriaInstance): void {
    render(
      <MonitorCriteriaInstanceView
        monitorStatusOptions={[]}
        incidentSeverityOptions={[]}
        alertSeverityOptions={[]}
        isLastCriteria={true}
        monitorCriteriaInstance={instance}
        onCallPolicyOptions={[]}
        labelOptions={[]}
        teamOptions={[]}
        userOptions={[]}
        incidentRoleOptions={[]}
      />,
    );
  }

  function heading(): string {
    return screen.getByTestId("monitor-criteria-filters-heading")
      .textContent as string;
  }

  test.each([FilterCondition.All, FilterCondition.Any])(
    "over one filter says nothing of All or Any (%s)",
    (filterCondition: FilterCondition) => {
      renderView(buildCriteria([SLOW_RESPONSE], filterCondition));

      expect(heading()).toBe(
        "Filters This criteria is met when this filter matches:",
      );
    },
  );

  test("over two filters says how they combine", () => {
    renderView(buildCriteria([SLOW_RESPONSE, OFFLINE], FilterCondition.Any));

    expect(heading()).toBe(
      "Filters (Any) Any of these can match for this criteria to be met:",
    );
  });
});

describe("a monitor's evaluation log", () => {
  const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

  test("says a criteria's condition only when it combined two filters or more", () => {
    const summary: MonitorEvaluationSummary = {
      evaluatedAt: NOW,
      criteriaResults: [
        {
          criteriaName: "One filter",
          filterCondition: FilterCondition.Any,
          met: true,
          message: "",
          filters: [
            {
              checkOn: CheckOn.IsOnline,
              message: "Monitor is online",
              met: true,
            },
          ],
        },
        {
          criteriaName: "Two filters",
          filterCondition: FilterCondition.All,
          met: false,
          message: "",
          filters: [
            {
              checkOn: CheckOn.IsOnline,
              message: "Monitor is online",
              met: true,
            },
            {
              checkOn: CheckOn.ResponseTime,
              message: "Response time 120 ms is not above 3000 ms",
              met: false,
            },
          ],
        },
        {
          criteriaName: "Skipped",
          filterCondition: FilterCondition.Any,
          met: false,
          message: "",
          filters: [],
          skipped: true,
          skipCause: "earlier-criterion-matched",
        },
      ],
      events: [],
    };

    render(<EvaluationLogList evaluationSummary={summary} />);

    expect(
      within(
        screen.getByRole("group", { name: "One filter: Met" }),
      ).queryByText(/^Condition:/),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("group", { name: "Two filters: Not Met" }),
      ).getByText("Condition: All"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: /^Skipped: / })).queryByText(
        /^Condition:/,
      ),
    ).not.toBeInTheDocument();
  });
});
