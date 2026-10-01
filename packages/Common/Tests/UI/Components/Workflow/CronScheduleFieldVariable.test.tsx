/*
 * The Schedule trigger can run on a schedule held in a variable. Choosing
 * the variable uses the same list as every other setting, showing variables
 * only - a schedule is set up before the workflow runs, so no step's value
 * can stand for one - and the chosen one shows as a chip.
 */

import CronScheduleField from "../../../../UI/Components/Workflow/CronScheduleField";
import {
  API_KEY,
  DEPLOY_ENV,
  SAMPLE_GROUPS,
  withPicker,
} from "./ValuePicker/ValuePickerTestUtils";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

type RenderFieldFunction = (
  initialValue: string,
  options?: { groups?: typeof SAMPLE_GROUPS },
) => { onChange: MockFunction; user: UserEvent };

const renderField: RenderFieldFunction = (
  initialValue: string,
  options: { groups?: typeof SAMPLE_GROUPS } = {},
): { onChange: MockFunction; user: UserEvent } => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    withPicker(
      <CronScheduleField initialValue={initialValue} onChange={onChange} />,
      { groups: options.groups },
    ),
  );

  return { onChange: onChange, user: userEvent.setup({ delay: null }) };
};

type ReferencesListedFunction = () => Array<string>;

const referencesListed: ReferencesListedFunction = (): Array<string> => {
  return screen.getAllByRole("option").map((option: HTMLElement) => {
    return option.getAttribute("data-reference") || "";
  });
};

afterEach(() => {
  cleanup();
});

describe("CronScheduleField — a schedule from a variable", () => {
  test("Select a variable lists the variables, and no step's values", async () => {
    const { user } = renderField("");

    await user.click(screen.getByRole("button", { name: "Variable" }));
    await user.click(screen.getByRole("button", { name: "Select a variable" }));

    expect(referencesListed()).toEqual([DEPLOY_ENV, API_KEY]);
    expect(screen.getByTestId("value-picker-search")).toHaveAttribute(
      "placeholder",
      "Search variables",
    );
  });

  test("the chosen variable is the schedule, and shows as a chip", async () => {
    const { onChange, user } = renderField("");

    await user.click(screen.getByRole("button", { name: "Variable" }));
    await user.click(screen.getByRole("button", { name: "Select a variable" }));
    fireEvent.click(
      screen.getAllByRole("option").find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === API_KEY;
      })!,
    );

    expect(onChange).toHaveBeenLastCalledWith(API_KEY);
    expect(screen.getByTestId("template-reference-chip")).toHaveTextContent(
      "Global variable›API_KEY",
    );
  });

  test("a schedule already in a variable opens on it, and can be changed", async () => {
    const { onChange, user } = renderField(DEPLOY_ENV);

    expect(screen.getByTestId("template-reference-chip")).toHaveTextContent(
      "Variable›DEPLOY_ENV",
    );

    await user.click(
      screen.getByRole("button", { name: "Change the variable" }),
    );
    fireEvent.click(
      screen.getAllByRole("option").find((option: HTMLElement) => {
        return option.getAttribute("data-reference") === API_KEY;
      })!,
    );

    expect(onChange).toHaveBeenLastCalledWith(API_KEY);
  });

  test("with no variables, it says how to make one", async () => {
    const { user } = renderField("", { groups: [SAMPLE_GROUPS[0]!] });

    await user.click(screen.getByRole("button", { name: "Variable" }));
    await user.click(screen.getByRole("button", { name: "Select a variable" }));

    expect(screen.getByTestId("value-picker-empty")).toHaveTextContent(
      "There are no variables yet.",
    );
  });
});
