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
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import CriteriaNameUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaName";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * A criteria no longer asks anyone to invent a name and a description.
 *
 * Every criteria card used to open on two required, empty inputs - "Criteria
 * Name" and "Criteria Description" - above the filters, and "Add Criteria"
 * added one more pair of them. The monitor could not be saved until both had
 * been made up. Now:
 *
 *   - the name is filled in from the filters, and follows them until the
 *     user types a name of their own;
 *   - a name cleared and left empty goes back to that name;
 *   - the description is optional and sits in the criteria's folded
 *     Settings section, next to "Enable this criteria".
 *
 * Driven through the real components, with the parent's clone-on-change
 * reproduced the way MonitorCriteriaActionToggles.test.tsx does it.
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

const GENERATED_NAME: string = "Response Time (in ms) is above 3000";

function buildCriteria(
  overrides?: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [{ ...SLOW_RESPONSE }],
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: GENERATED_NAME,
    description: "",
    ...(overrides || {}),
  };
  return instance;
}

interface CriteriaHarness {
  // The criteria as the form last handed it up, i.e. what would be saved.
  latest: () => MonitorCriteriaInstance;
}

function renderCriteria(
  initial: MonitorCriteriaInstance,
  monitorType: MonitorType = MonitorType.Ping,
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

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Criteria Name") as HTMLInputElement;
}

function thresholdInput(): HTMLInputElement {
  // The value field of a Response Time filter; its placeholder is "5000".
  return screen.getByPlaceholderText("5000") as HTMLInputElement;
}

function followsFiltersHint(): HTMLElement | null {
  return screen.queryByTestId("monitor-criteria-name-follows-filters");
}

function headerOf(sectionTitle: string): HTMLElement {
  return screen.getByRole("button", { name: sectionTitle });
}

describe("the criteria name", () => {
  afterEach(() => {
    cleanup();
  });

  test("is a labelled field that shows the criteria's name", () => {
    renderCriteria(buildCriteria());

    expect(nameInput().value).toBe(GENERATED_NAME);
  });

  test("a generated name says it follows the filters", () => {
    renderCriteria(buildCriteria());

    expect(followsFiltersHint()).toHaveTextContent(
      "Named after the filters below. It follows them until you type a name of your own.",
    );
  });

  test("a generated name follows the threshold as it is edited", () => {
    const harness: CriteriaHarness = renderCriteria(buildCriteria());

    fireEvent.change(thresholdInput(), { target: { value: "5000" } });

    expect(harness.latest().data!.name).toBe(
      "Response Time (in ms) is above 5000",
    );
    expect(nameInput().value).toBe("Response Time (in ms) is above 5000");
  });

  test("a generated name follows the filter condition", () => {
    const harness: CriteriaHarness = renderCriteria(
      buildCriteria({
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          { ...SLOW_RESPONSE },
        ],
        name: "Is Online is false and Response Time (in ms) is above 3000",
      }),
    );

    fireEvent.click(
      within(screen.getByRole("radiogroup")).getByLabelText("Any"),
    );

    expect(harness.latest().data!.filterCondition).toBe(FilterCondition.Any);
    expect(harness.latest().data!.name).toBe(
      "Is Online is false or Response Time (in ms) is above 3000",
    );
  });

  test("a name the user typed stays when the filters change, and the hint goes", () => {
    const harness: CriteriaHarness = renderCriteria(buildCriteria());

    fireEvent.change(nameInput(), { target: { value: "Slow checkout" } });

    expect(harness.latest().data!.name).toBe("Slow checkout");
    expect(followsFiltersHint()).toBeNull();

    fireEvent.change(thresholdInput(), { target: { value: "5000" } });

    expect(harness.latest().data!.filters[0]!.value).toBe("5000");
    expect(harness.latest().data!.name).toBe("Slow checkout");
  });

  test("a name a monitor was seeded with is the user's, not a generated one", () => {
    const harness: CriteriaHarness = renderCriteria(
      buildCriteria({ name: "Check if Acme is slow" }),
    );

    expect(followsFiltersHint()).toBeNull();

    fireEvent.change(thresholdInput(), { target: { value: "5000" } });

    expect(harness.latest().data!.name).toBe("Check if Acme is slow");
  });

  test("clearing the name does not put it back while the user is still typing", () => {
    const harness: CriteriaHarness = renderCriteria(buildCriteria());

    fireEvent.change(nameInput(), { target: { value: "" } });

    expect(harness.latest().data!.name).toBe("");
    expect(nameInput().value).toBe("");
    // The empty field shows the name it would get.
    expect(nameInput()).toHaveAttribute("placeholder", GENERATED_NAME);

    fireEvent.change(nameInput(), { target: { value: "Checkout" } });

    expect(harness.latest().data!.name).toBe("Checkout");
  });

  test("a name cleared and left empty goes back to the one the filters give", () => {
    const harness: CriteriaHarness = renderCriteria(
      buildCriteria({ name: "Slow checkout" }),
    );

    fireEvent.change(nameInput(), { target: { value: "" } });
    fireEvent.blur(nameInput());

    expect(harness.latest().data!.name).toBe(GENERATED_NAME);
    expect(nameInput().value).toBe(GENERATED_NAME);
    expect(
      MonitorCriteriaInstance.getValidationError(
        harness.latest(),
        MonitorType.Ping,
      ),
    ).toBeNull();
  });

  test("a name of only spaces left behind is replaced too", () => {
    const harness: CriteriaHarness = renderCriteria(buildCriteria());

    fireEvent.change(nameInput(), { target: { value: "   " } });
    fireEvent.blur(nameInput());

    expect(harness.latest().data!.name).toBe(GENERATED_NAME);
  });

  test("leaving a name that is there does not touch it", () => {
    const harness: CriteriaHarness = renderCriteria(
      buildCriteria({ name: "Slow checkout" }),
    );

    fireEvent.blur(nameInput());

    expect(harness.latest().data!.name).toBe("Slow checkout");
  });

  test("never shows 'Name is required' under the field", () => {
    renderCriteria(buildCriteria());

    fireEvent.change(nameInput(), { target: { value: "" } });
    fireEvent.blur(nameInput());

    expect(screen.queryByText(/Name is required/)).toBeNull();
  });

  test("on a metric monitor the hint points at the alert rules", () => {
    renderCriteria(
      buildCriteria({
        filters: [
          {
            checkOn: CheckOn.MetricValue,
            filterType: FilterType.GreaterThan,
            value: 80,
          },
        ],
        name: "Metric Value is above 80",
      }),
      MonitorType.Metrics,
    );

    expect(followsFiltersHint()).toHaveTextContent(
      "Named after the alert rules below. It follows them until you type a name of your own.",
    );
  });
});

describe("the criteria description", () => {
  afterEach(() => {
    cleanup();
  });

  test("is not asked for above the filters any more", () => {
    renderCriteria(buildCriteria());

    expect(screen.queryByText("Criteria Description")).toBeNull();
    expect(
      screen.queryByText(
        "Any friendly description for this criteria, that will help you remember later.",
      ),
    ).toBeNull();
  });

  test("sits in the folded Settings section, next to 'Enable this criteria'", () => {
    renderCriteria(buildCriteria());

    const settings: HTMLElement = headerOf("Settings");
    expect(settings).toHaveAttribute("aria-expanded", "false");

    const body: HTMLElement = document.getElementById(
      settings.getAttribute("aria-controls")!,
    )!;

    expect(
      within(body).getByTestId("monitor-criteria-description-input"),
    ).toBeInTheDocument();
    expect(
      within(body).getByRole("switch", { name: /Enable this criteria/ }),
    ).toBeInTheDocument();
  });

  test("is labelled optional", () => {
    renderCriteria(buildCriteria());

    fireEvent.click(headerOf("Settings"));

    const label: HTMLElement = screen
      .getByText("Description")
      .closest("label")!;

    expect(label).toHaveTextContent("(Optional)");
    expect(screen.getByLabelText(/^Description/)).toBe(
      screen.getByTestId("monitor-criteria-description-input"),
    );
  });

  test("what is typed is saved, and an empty one is valid", () => {
    const harness: CriteriaHarness = renderCriteria(buildCriteria());

    fireEvent.click(headerOf("Settings"));

    const description: HTMLElement = screen.getByTestId(
      "monitor-criteria-description-input",
    );

    fireEvent.change(description, {
      target: { value: "Checkout gets slow before it fails." },
    });

    expect(harness.latest().data!.description).toBe(
      "Checkout gets slow before it fails.",
    );

    fireEvent.change(description, { target: { value: "" } });
    fireEvent.blur(description);

    expect(harness.latest().data!.description).toBe("");
    expect(
      MonitorCriteriaInstance.getValidationError(
        harness.latest(),
        MonitorType.Ping,
      ),
    ).toBeNull();
    expect(screen.queryByText(/Description is required/)).toBeNull();
  });
});

interface ListHarness {
  latest: () => MonitorCriteria;
}

function renderCriteriaList(
  initial: MonitorCriteria,
  monitorType: MonitorType,
): ListHarness {
  let latest: MonitorCriteria = initial;

  const Wrapper: FunctionComponent = (): ReactElement => {
    const [value, setValue] = React.useState<MonitorCriteria>(initial);

    return (
      <MonitorCriteriaElement
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={[]}
        value={value}
        onChange={(changed: MonitorCriteria) => {
          latest = changed;
          setValue(changed);
        }}
      />
    );
  };

  render(<Wrapper />);

  return {
    latest: (): MonitorCriteria => {
      return latest;
    },
  };
}

function criteriaListOf(
  instances: Array<MonitorCriteriaInstance>,
): MonitorCriteria {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: instances };
  return monitorCriteria;
}

describe("Add Criteria", () => {
  afterEach(() => {
    cleanup();
  });

  test.each([
    MonitorType.Website,
    MonitorType.Ping,
    MonitorType.DNS,
    MonitorType.IncomingRequest,
    MonitorType.Logs,
  ])(
    "a criteria added to a %s monitor is named after its filter",
    (monitorType: MonitorType) => {
      const harness: ListHarness = renderCriteriaList(
        criteriaListOf([buildCriteria({ name: "Check if Acme is slow" })]),
        monitorType,
      );

      fireEvent.click(screen.getByRole("button", { name: "Add Criteria" }));

      const added: MonitorCriteriaInstance =
        harness.latest().data!.monitorCriteriaInstanceArray[1]!;

      const expected: string = CriteriaNameUtil.getNameFromFilters({
        filters: [CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType)],
        filterCondition: FilterCondition.All,
      });

      expect(added.data!.name).toBe(expected);
      expect(added.data!.name).not.toBe("");
      expect(added.data!.description).toBe("");

      // The card's header shows it, not "Unnamed Criteria".
      expect(screen.queryByText("Unnamed Criteria")).toBeNull();
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0);

      // And the first criteria kept its own name.
      expect(
        harness.latest().data!.monitorCriteriaInstanceArray[0]!.data!.name,
      ).toBe("Check if Acme is slow");
    },
  );

  test("a criteria added to a Website monitor can be saved as it is", () => {
    const harness: ListHarness = renderCriteriaList(
      criteriaListOf([buildCriteria({ name: "Check if Acme is slow" })]),
      MonitorType.Website,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Criteria" }));

    expect(
      MonitorCriteria.getValidationError(harness.latest(), MonitorType.Website),
    ).toBeNull();
  });

  test("the new criteria's name follows its filters as they are edited", () => {
    const harness: ListHarness = renderCriteriaList(
      criteriaListOf([buildCriteria({ name: "Check if Acme is slow" })]),
      MonitorType.Ping,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Criteria" }));

    /*
     * One filter each: nothing to combine, so neither criteria asks All or
     * Any. A second filter on the new one brings its radio group in - the
     * only one on the page.
     */
    expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);

    const addFilterButtons: Array<HTMLElement> = screen.getAllByRole(
      "button",
      { name: "Add Filter" },
    );
    fireEvent.click(addFilterButtons[addFilterButtons.length - 1]!);

    const radioGroups: Array<HTMLElement> = screen.getAllByRole("radiogroup");
    expect(radioGroups).toHaveLength(1);
    fireEvent.click(within(radioGroups[0]!).getByLabelText("Any"));

    const added: MonitorCriteriaInstance =
      harness.latest().data!.monitorCriteriaInstanceArray[1]!;

    expect(added.data!.filters).toHaveLength(2);
    expect(added.data!.filterCondition).toBe(FilterCondition.Any);
    expect(
      CriteriaNameUtil.isNameFromFilters({
        name: added.data!.name,
        filters: added.data!.filters,
        filterCondition: added.data!.filterCondition,
      }),
    ).toBe(true);
  });

  test("a criteria with no name still reads 'Unnamed Criteria' in its header", () => {
    renderCriteriaList(
      criteriaListOf([buildCriteria({ name: "" })]),
      MonitorType.Ping,
    );

    expect(screen.getByText("Unnamed Criteria")).toBeInTheDocument();
  });
});
