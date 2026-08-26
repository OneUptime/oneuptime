import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaFiltersElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilters";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #3412 as the user met it: the "Filter Condition" dropdown on the
 * "External Status Page Active Incidents" filter showed an empty "Select...",
 * while the sibling filter's condition read "True" and this filter's own
 * value box already showed 0.
 *
 * The option-list tests in ExternalStatusPageCriteriaFilter.test.ts and
 * CriteriaFilterDefaults.test.ts pin the data the dropdown is built from.
 * This file drives the real component instead, because "Select..." is
 * something react-select decides to render when it cannot find an option
 * matching the value it was handed — a rule about lists cannot say whether
 * that happens on screen, only the rendered row can.
 *
 * Assertions stay on plain DOM text: jest-dom's matchers do not typecheck
 * repo-wide.
 */

// react-select's placeholder, i.e. what "unset" looks like to the user.
const UNSET: string = "Select...";

function monitorStep(): MonitorStep {
  return new MonitorStep();
}

function seededExternalStatusPageFilters(): Array<CriteriaFilter> {
  return MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
    monitorType: MonitorType.ExternalStatusPage,
    monitorStatusId: new ObjectID("aaaaaaaaaaaaaaaaaaaaaaaa"),
    monitorName: "Acme Status",
  })!.data!.filters;
}

function renderFilter(
  criteriaFilter: CriteriaFilter,
  monitorType: MonitorType,
): {
  onChange: MockFunction;
} {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <CriteriaFilterElement
      monitorType={monitorType}
      monitorStep={monitorStep()}
      value={criteriaFilter}
      onChange={onChange as unknown as (value: CriteriaFilter) => void}
    />,
  );

  return { onChange: onChange };
}

/*
 * The last filter each onChange handed back. The component replaces the whole
 * filter object on every edit, so the newest call is the current state.
 */
function lastFilterFrom(onChange: MockFunction): CriteriaFilter {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as CriteriaFilter;
}

// The filter list the last onChange handed back, after "Add Filter" ran.
function lastFilterListFrom(onChange: MockFunction): Array<CriteriaFilter> {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as Array<CriteriaFilter>;
}

async function pickFromDropdown(input: {
  labelledBy: string;
  optionLabel: string;
}): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  /*
   * react-select renders its own text input per dropdown. Ordering follows
   * the form: "Filter Type" first, then "Filter Condition".
   */
  const comboboxes: Array<HTMLElement> = screen.getAllByRole("combobox");
  const index: number = input.labelledBy === "Filter Type" ? 0 : 1;

  await user.click(comboboxes[index]!);
  await user.click(await screen.findByText(input.optionLabel));
}

describe("The criteria Filter Condition dropdown", () => {
  describe("the row reported in #3412", () => {
    test("the seeded active-incidents filter shows its condition, not an empty Select...", () => {
      const criteriaFilter: CriteriaFilter =
        seededExternalStatusPageFilters()[1]!;

      expect(criteriaFilter.checkOn).toBe(
        CheckOn.ExternalStatusPageActiveIncidents,
      );

      renderFilter(criteriaFilter, MonitorType.ExternalStatusPage);

      // The Filter Type dropdown, which was never the problem.
      expect(
        screen.getAllByText(CheckOn.ExternalStatusPageActiveIncidents).length,
      ).toBeGreaterThan(0);

      // The Filter Condition dropdown. This is what showed "Select...".
      expect(screen.getAllByText(FilterType.EqualTo).length).toBeGreaterThan(0);
      expect(screen.queryByText(UNSET)).toBeNull();
    });

    test("the sibling is-online filter still shows True", () => {
      const criteriaFilter: CriteriaFilter =
        seededExternalStatusPageFilters()[0]!;

      expect(criteriaFilter.checkOn).toBe(CheckOn.ExternalStatusPageIsOnline);

      renderFilter(criteriaFilter, MonitorType.ExternalStatusPage);

      expect(screen.getAllByText(FilterType.True).length).toBeGreaterThan(0);
      expect(screen.queryByText(UNSET)).toBeNull();
    });

    test("both seeded filters render with nothing left unset", () => {
      for (const criteriaFilter of seededExternalStatusPageFilters()) {
        const { unmount }: { unmount: () => void } = render(
          <CriteriaFilterElement
            monitorType={MonitorType.ExternalStatusPage}
            monitorStep={monitorStep()}
            value={criteriaFilter}
            onChange={() => {}}
          />,
        );

        expect(screen.queryByText(UNSET)).toBeNull();
        unmount();
      }
    });
  });

  describe("changing the Filter Type", () => {
    test("moves the condition to the new check's default instead of clearing it", async () => {
      const { onChange }: { onChange: MockFunction } = renderFilter(
        seededExternalStatusPageFilters()[0]!,
        MonitorType.ExternalStatusPage,
      );

      await pickFromDropdown({
        labelledBy: "Filter Type",
        optionLabel: CheckOn.ExternalStatusPageActiveIncidents,
      });

      const emitted: CriteriaFilter = lastFilterFrom(onChange);

      expect(emitted.checkOn).toBe(CheckOn.ExternalStatusPageActiveIncidents);
      // Was undefined, which is what left the next dropdown blank.
      expect(emitted.filterType).toBe(FilterType.EqualTo);
    });

    test("a check with exactly one condition no longer asks the user to re-pick it", async () => {
      const { onChange }: { onChange: MockFunction } = renderFilter(
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "ok",
        },
        MonitorType.API,
      );

      await pickFromDropdown({
        labelledBy: "Filter Type",
        optionLabel: CheckOn.JavaScriptExpression,
      });

      const emitted: CriteriaFilter = lastFilterFrom(onChange);

      expect(emitted.checkOn).toBe(CheckOn.JavaScriptExpression);
      expect(emitted.filterType).toBe(FilterType.EvaluatesToTrue);
    });
  });

  describe("adding a filter", () => {
    test("an External Status Page monitor gets a filter it can actually render", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <CriteriaFiltersElement
          monitorType={MonitorType.ExternalStatusPage}
          monitorStep={monitorStep()}
          value={[seededExternalStatusPageFilters()[0]!]}
          onChange={
            onChange as unknown as (value: Array<CriteriaFilter>) => void
          }
        />,
      );

      screen.getByText("Add Filter").click();

      const added: CriteriaFilter = lastFilterListFrom(onChange)[1]!;

      /*
       * Was { checkOn: IsOnline, filterType: EqualTo } — a check this monitor
       * type does not offer, paired with a condition that check has never
       * accepted, so both dropdowns opened blank.
       */
      expect(added.checkOn).toBe(CheckOn.ExternalStatusPageIsOnline);
      expect(added.filterType).toBe(FilterType.True);
    });

    test("a website monitor keeps its up/down check and gains a condition", () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <CriteriaFiltersElement
          monitorType={MonitorType.Website}
          monitorStep={monitorStep()}
          value={[
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
          ]}
          onChange={
            onChange as unknown as (value: Array<CriteriaFilter>) => void
          }
        />,
      );

      screen.getByText("Add Filter").click();

      const added: CriteriaFilter = lastFilterListFrom(onChange)[1]!;

      expect(added.checkOn).toBe(CheckOn.IsOnline);
      expect(added.filterType).toBe(FilterType.True);
    });
  });
});
