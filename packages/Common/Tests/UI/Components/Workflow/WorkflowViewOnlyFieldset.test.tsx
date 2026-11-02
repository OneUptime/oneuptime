/*
 * WorkflowViewOnlyFieldset: what changes a step's setting, held still on a
 * view (WorkflowViewOnly), and drawn as it is everywhere else.
 *
 * A step's settings used to sit in one disabled fieldset, whole, which
 * disabled every button in it: on a view a code box's own Copy and the More
 * fields fold were dead with everything else. The settings are held still one
 * by one now, each with this around what changes it - so it must disable
 * every control it holds, and nothing it does not.
 */

import WorkflowViewOnlyFieldset, {
  WORKFLOW_VIEW_ONLY_FIELDSET_CLASS,
  WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR,
} from "../../../../UI/Components/Workflow/WorkflowViewOnlyFieldset";
import { WorkflowViewOnlyContext } from "../../../../UI/Components/Workflow/WorkflowViewOnly";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

afterEach(() => {
  cleanup();
});

// A setting's controls: a text box, a list, a button and a radio.
const Controls: () => ReactElement = (): ReactElement => {
  return (
    <>
      <input aria-label="Name" defaultValue="Deploy" />
      <select aria-label="Kind" defaultValue="a">
        <option value="a">A</option>
      </select>
      <button type="button">Add</button>
      <input type="radio" aria-label="Text" />
      <textarea aria-label="Body" defaultValue="{}" />
    </>
  );
};

type RenderInFunction = (
  isViewOnly: boolean | null,
  element: ReactElement,
) => HTMLElement;

// Rendered in a view, outside one (false), or with no Builder around (null).
const renderIn: RenderInFunction = (
  isViewOnly: boolean | null,
  element: ReactElement,
): HTMLElement => {
  const { container } = render(
    isViewOnly === null ? (
      <div data-testid="parent">{element}</div>
    ) : (
      <WorkflowViewOnlyContext.Provider value={isViewOnly}>
        <div data-testid="parent">{element}</div>
      </WorkflowViewOnlyContext.Provider>
    ),
  );

  return container;
};

describe("in a view", () => {
  test("holds every control it draws in a disabled fieldset the pointer goes through", () => {
    renderIn(
      true,
      <WorkflowViewOnlyFieldset>
        <Controls />
      </WorkflowViewOnlyFieldset>,
    );

    const fieldset: HTMLElement = screen.getByTestId(
      "workflow-view-only-fieldset",
    );

    expect(fieldset.tagName).toBe("FIELDSET");
    expect(fieldset).toBeDisabled();
    expect(fieldset).toHaveClass("pointer-events-none");
    expect(fieldset.matches(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR)).toBe(true);

    for (const name of ["Name", "Kind", "Add", "Text", "Body"]) {
      const control: HTMLElement =
        name === "Add"
          ? screen.getByRole("button", { name: name })
          : screen.getByLabelText(name);

      expect([name, control.matches(":disabled")]).toEqual([name, true]);
    }

    // A screen reader still reads each one, with its value.
    expect(screen.getByLabelText("Name")).toHaveValue("Deploy");
  });

  test("has no frame, margin or indent of its own: a view reads as the editor's form", () => {
    renderIn(
      true,
      <WorkflowViewOnlyFieldset>
        <Controls />
      </WorkflowViewOnlyFieldset>,
    );

    expect(screen.getByTestId("workflow-view-only-fieldset")).toHaveClass(
      "m-0",
      "min-w-0",
      "border-0",
      "p-0",
    );
    expect(WORKFLOW_VIEW_ONLY_FIELDSET_CLASS).toBe(
      "pointer-events-none m-0 min-w-0 border-0 p-0",
    );
  });

  test("keeps the spacing its parent gave the controls, when it is given it", () => {
    renderIn(
      true,
      <WorkflowViewOnlyFieldset className="space-y-1">
        <Controls />
      </WorkflowViewOnlyFieldset>,
    );

    expect(screen.getByTestId("workflow-view-only-fieldset")).toHaveClass(
      "space-y-1",
      "pointer-events-none",
    );
  });

  test("takes a test id of its own", () => {
    renderIn(
      true,
      <WorkflowViewOnlyFieldset dataTestId="workflow-component-id-fieldset">
        <Controls />
      </WorkflowViewOnlyFieldset>,
    );

    expect(screen.getByTestId("workflow-component-id-fieldset").tagName).toBe(
      "FIELDSET",
    );
  });

  test("holds still only what it is drawn around: a Copy beside it still works", () => {
    renderIn(
      true,
      <>
        <WorkflowViewOnlyFieldset>
          <Controls />
        </WorkflowViewOnlyFieldset>
        <button type="button">Copy</button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});

describe("outside a view", () => {
  test.each([
    ["on a Builder the reader may change", false],
    ["with no Builder around it at all", null],
  ])(
    "%s, draws its children as they are, and nothing more",
    (_name: string, isViewOnly: boolean | null) => {
      renderIn(
        isViewOnly,
        <WorkflowViewOnlyFieldset className="space-y-1">
          <Controls />
        </WorkflowViewOnlyFieldset>,
      );

      expect(
        screen.queryByTestId("workflow-view-only-fieldset"),
      ).not.toBeInTheDocument();
      expect(document.querySelector("fieldset")).toBeNull();

      // The controls are the parent's own children, every one usable.
      const parent: HTMLElement = screen.getByTestId("parent");

      expect(parent.firstElementChild).toBe(screen.getByLabelText("Name"));
      expect(screen.getByLabelText("Name")).toBeEnabled();
      expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
      expect(screen.getByLabelText("Body")).toBeEnabled();
    },
  );
});
