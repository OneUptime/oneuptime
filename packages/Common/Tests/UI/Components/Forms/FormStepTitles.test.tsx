import Steps from "../../../../UI/Components/Forms/Steps/Steps";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import { JSONObject } from "../../../../Types/JSON";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The step list beside a stepped form is as wide as its titles. Only a step
 * not reached yet kept its title on one line (w-max), so on a form's last
 * step - every title done or current - the list shrank: "Probes & Interval"
 * and "Monitor Info" wrapped onto two lines and the form beside them moved,
 * and on a two-step form "Monitor Info" wrapped from the start. Every title
 * is one line now, whatever its state, so the list keeps one width.
 */

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Monitor Info", id: "monitor-info" },
  { title: "Criteria", id: "criteria" },
  { title: "Probes & Interval", id: "probes" },
];

afterEach(() => {
  cleanup();
});

function renderOn(currentFormStepId: string): void {
  render(
    <Steps<JSONObject>
      steps={STEPS}
      currentFormStepId={currentFormStepId}
      formValues={{}}
      onClick={() => {}}
    />,
  );
}

// The element that holds a step's title.
function titleOf(title: string): HTMLElement {
  const list: HTMLElement = screen.getByRole("navigation", {
    name: "Progress",
  });
  return within(list).getByText(title, { exact: true });
}

describe("a stepped form's step list", () => {
  test.each(["monitor-info", "criteria", "probes"])(
    "on step %s, every title stays on one line",
    (currentFormStepId: string) => {
      renderOn(currentFormStepId);

      for (const step of STEPS) {
        expect(titleOf(step.title)).toHaveClass("w-max");
      }
    },
  );

  test("the current step is marked, done steps are ticked, and the titles read as before", () => {
    renderOn("criteria");

    const current: HTMLElement = titleOf("Criteria");
    expect(current.closest("[aria-current='step']")).not.toBeNull();
    expect(current).toHaveClass("text-indigo-600");

    expect(titleOf("Monitor Info")).toHaveClass("text-gray-500");
    expect(
      titleOf("Monitor Info").closest("li")?.querySelector("svg"),
    ).not.toBeNull();

    expect(titleOf("Probes & Interval")).toHaveClass("text-gray-500");
  });
});
