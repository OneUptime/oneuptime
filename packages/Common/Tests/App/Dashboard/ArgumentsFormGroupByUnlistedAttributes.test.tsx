import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { Mock } from "jest-mock";
import ArgumentsForm from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardTableComponent, {
  TableGroupByAttribute,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTableComponent";
import { JSONObject } from "../../../Types/JSON";

/*
 * The table widget's "Group By Attributes" picker offers the project's
 * telemetry attribute keys, and that list only covers keys seen in the last
 * day (capped, alphabetically). A widget grouped by an attribute emitted less
 * often - a weekly batch job - has a saved key the list is missing. The picker
 * used to show no chip for it, and since the dropdown only reports the chips it
 * shows, the next add or remove saved the widget without that key or its
 * custom header, while "Column headers" still listed it.
 */

const LISTED_ATTRIBUTES: Array<string> = ["host.name", "service.name"];

const SAVED_GROUP_BY: Array<TableGroupByAttribute> = [
  { key: "batch.job.name", header: "Job" },
  { key: "service.name", header: "Service" },
];

type OnFormChangeMock = Mock<(component: DashboardBaseComponent) => void>;

function renderTableSettings(): OnFormChangeMock {
  const table: DashboardTableComponent =
    DashboardTableComponentUtil.getDefaultComponent();
  table.arguments.groupByAttributes = SAVED_GROUP_BY;

  const onFormChange: OnFormChangeMock =
    jest.fn<(component: DashboardBaseComponent) => void>();

  render(
    <ArgumentsForm
      component={table}
      metrics={{ metricTypes: [], telemetryAttributes: LISTED_ATTRIBUTES }}
      onFormChange={onFormChange}
    />,
  );

  return onFormChange;
}

function removeChipButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: `Remove ${label}` });
}

function groupByPicker(): HTMLElement {
  return within(
    screen.getByText("Group By Attributes").parentElement as HTMLElement,
  ).getByRole("combobox");
}

function lastSavedGroupBy(
  onFormChange: OnFormChangeMock,
): Array<TableGroupByAttribute> {
  const lastCall: [DashboardBaseComponent] | undefined =
    onFormChange.mock.calls[onFormChange.mock.calls.length - 1];
  expect(lastCall).toBeDefined();

  return (lastCall![0].arguments as JSONObject)[
    "groupByAttributes"
  ] as unknown as Array<TableGroupByAttribute>;
}

afterEach(() => {
  cleanup();
});

describe("Table widget group-by picker with a key missing from the attribute list", () => {
  test("shows a chip for a saved key the attribute list is missing", () => {
    renderTableSettings();

    expect(removeChipButton("batch.job.name")).toBeInTheDocument();
    expect(removeChipButton("service.name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Job")).toBeInTheDocument();
  });

  test("removing a different chip keeps the unlisted key and its header", () => {
    const onFormChange: OnFormChangeMock = renderTableSettings();

    fireEvent.click(removeChipButton("service.name"));

    expect(lastSavedGroupBy(onFormChange)).toEqual([
      { key: "batch.job.name", header: "Job" },
    ]);
    expect(removeChipButton("batch.job.name")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove service.name" }),
    ).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Job")).toBeInTheDocument();
  });

  test("adding a new key keeps the unlisted key and its header", () => {
    const onFormChange: OnFormChangeMock = renderTableSettings();

    fireEvent.keyDown(groupByPicker(), { key: "ArrowDown" });
    const option: HTMLElement = screen.getByRole("option", {
      name: "host.name",
    });
    fireEvent.mouseDown(option);
    fireEvent.click(option);

    const saved: Array<TableGroupByAttribute> = lastSavedGroupBy(onFormChange);
    expect(saved).toHaveLength(3);
    expect(saved).toEqual(
      expect.arrayContaining([
        { key: "batch.job.name", header: "Job" },
        { key: "service.name", header: "Service" },
        { key: "host.name" },
      ]),
    );
    expect(removeChipButton("batch.job.name")).toBeInTheDocument();
    expect(removeChipButton("host.name")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Job")).toBeInTheDocument();
  });
});
