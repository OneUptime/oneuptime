import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import MonitorCriteriaInstanceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * One criteria's own form. Two short text fields used to be stacked full
 * width at the top of it, which put the filters - the reason anyone opens
 * a criteria - a screen further down, on a form users open repeatedly.
 *
 * The rest of this file is a regression net around that move: the fields
 * still validate, the three sections are still there, and deleting a
 * criteria now happens in exactly one place (the list row) rather than
 * two.
 */

const MONITOR_STATUS_ID: string = "11111111-1111-4111-8111-111111111111";

const MONITOR_STATUS_OPTIONS: Array<DropdownOption> = [
  { value: MONITOR_STATUS_ID, label: "Operational" },
];

function buildCriteria(
  overrides?: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: new ObjectID(MONITOR_STATUS_ID),
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ],
    incidents: [],
    alerts: [],
    name: "Online Criteria",
    description: "Checks the monitor is online.",
    changeMonitorStatus: true,
    createAlerts: false,
    createIncidents: false,
    isEnabled: true,
    ...overrides,
  };

  return instance;
}

function renderCriteria(
  criteria: MonitorCriteriaInstance,
  monitorType?: MonitorType,
): { onChange: MockFunction; container: HTMLElement } {
  const onChange: MockFunction = getJestMockFunction();

  const rendered: { container: HTMLElement } = render(
    <MonitorCriteriaInstanceElement
      monitorType={monitorType || MonitorType.Website}
      monitorStep={new MonitorStep()}
      monitorStatusDropdownOptions={MONITOR_STATUS_OPTIONS}
      incidentSeverityDropdownOptions={[]}
      alertSeverityDropdownOptions={[]}
      onCallPolicyDropdownOptions={[]}
      labelDropdownOptions={[]}
      teamDropdownOptions={[]}
      userDropdownOptions={[]}
      value={criteria}
      onChange={onChange as unknown as (value: MonitorCriteriaInstance) => void}
    />,
  );

  return { onChange: onChange, container: rendered.container };
}

describe("Monitor criteria instance form", () => {
  afterEach(() => {
    cleanup();
  });

  describe("the header fields", () => {
    test("name and description sit side by side rather than stacked", () => {
      const rendered: { container: HTMLElement } =
        renderCriteria(buildCriteria());

      const nameCell: Element | null = screen
        .getByText("Criteria Name")
        .closest("div");
      const descriptionCell: Element | null = screen
        .getByText("Criteria Description")
        .closest("div");

      expect(nameCell).not.toBeNull();
      expect(descriptionCell).not.toBeNull();

      // Same parent, and that parent is a two-column grid.
      const row: Element | null | undefined = nameCell?.parentElement;

      expect(descriptionCell?.parentElement).toBe(row);
      expect(row?.className).toContain("grid");
      expect(row?.className).toContain("md:grid-cols-2");
      expect(rendered.container).toBeTruthy();
    });

    test("the name is still required", () => {
      renderCriteria(buildCriteria());

      const nameInput: HTMLElement =
        screen.getByDisplayValue("Online Criteria");

      fireEvent.change(nameInput, { target: { value: "" } });
      fireEvent.blur(nameInput);

      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });

    test("the description is still required", () => {
      renderCriteria(buildCriteria());

      const descriptionInput: HTMLElement = screen.getByDisplayValue(
        "Checks the monitor is online.",
      );

      fireEvent.change(descriptionInput, { target: { value: "" } });
      fireEvent.blur(descriptionInput);

      expect(screen.getByText("Description is required")).toBeInTheDocument();
    });

    test("editing the name reports the new value upwards", () => {
      const harness: { onChange: MockFunction } =
        renderCriteria(buildCriteria());

      fireEvent.change(screen.getByDisplayValue("Online Criteria"), {
        target: { value: "Renamed" },
      });

      const reported: MonitorCriteriaInstance = harness.onChange.mock
        .calls[0]?.[0] as MonitorCriteriaInstance;

      expect(reported.data?.name).toBe("Renamed");
    });
  });

  describe("the sections of a criteria", () => {
    test("filters, actions and settings are each their own section", () => {
      renderCriteria(buildCriteria());

      expect(screen.getByText("Filters")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    test("a metric monitor calls its filters alert rules", () => {
      renderCriteria(buildCriteria(), MonitorType.Metrics);

      expect(screen.getByText("Alert Rules")).toBeInTheDocument();
      expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    });

    test("the filters section says how many filters it holds", () => {
      renderCriteria(
        buildCriteria({
          filters: [
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            {
              checkOn: CheckOn.ResponseTime,
              filterType: FilterType.LessThan,
              value: "1000",
            },
          ],
        }),
      );

      // The badge is what a closed section shows in place of its fields.
      fireEvent.click(screen.getByText("Filters"));

      expect(screen.getByText("2 filters, ALL match")).toBeInTheDocument();
    });

    test("the actions section says what the criteria does", () => {
      renderCriteria(buildCriteria());

      fireEvent.click(screen.getByText("Actions"));

      expect(screen.getByText("Status: Operational")).toBeInTheDocument();
    });
  });

  describe("where a criteria is deleted", () => {
    test("the criteria body carries no delete button of its own", () => {
      /*
       * Deleting lives on the list row, next to Duplicate, where it is
       * reachable without expanding the criteria first. A second button
       * at the bottom of the body would be a second thing to find and a
       * second thing to keep in step with the last-criteria guard.
       */
      renderCriteria(buildCriteria());

      expect(screen.queryByText("Delete Criteria")).not.toBeInTheDocument();
    });
  });
});
