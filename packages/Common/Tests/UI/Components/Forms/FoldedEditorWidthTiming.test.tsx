import BasicFormModal from "../../../../UI/Components/FormModal/BasicFormModal";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction from "../../../MockType";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A dialog whose only Markdown editor is folded away opens at its own width
 * and grows to the wide one when the section is opened (FormModalWidth,
 * OpenFormSections). The section tells the dialog before anything is
 * painted, so the editor is never drawn for a frame in the narrow dialog -
 * its toolbar would fit itself to that width and jump.
 *
 * Driven the way a browser drives it: a native click, outside act(), then
 * only microtasks - React's synchronous work, but none of the tasks a
 * scheduled render would wait for (as SteppedFormFooterTiming.test.tsx).
 */

const flushMicrotasks: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

type ActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const FIELDS: Fields<JSONObject> = [
  {
    field: { title: true },
    title: "Title",
    fieldType: FormFieldSchemaType.Text,
    required: false,
  },
  {
    field: { note: true },
    title: "Note",
    fieldType: FormFieldSchemaType.Markdown,
    required: false,
    collapsibleSection: {
      id: "note",
      title: "Add a note",
      openWhenConfigured: false,
    },
  },
];

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function fold(): HTMLElement {
  return screen.getByRole("button", { name: "Add a note" });
}

function clickNatively(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("a folded editor's dialog", () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(async () => {
    previousActEnvironment = (globalThis as ActEnvironment)
      .IS_REACT_ACT_ENVIRONMENT;

    await act(async () => {
      render(
        <BasicFormModal<JSONObject>
          title="Acknowledge"
          submitButtonText="Acknowledge"
          onClose={getJestMockFunction()}
          onSubmit={getJestMockFunction()}
          formProps={{
            id: "folded-editor-timing-form",
            disableAutofocus: true,
            fields: FIELDS,
          }}
        />,
      );
    });
  });

  afterEach(() => {
    if (previousActEnvironment === undefined) {
      delete (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT;
    } else {
      (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT =
        previousActEnvironment;
    }
    cleanup();
  });

  test("grows wide in the same pass as the note opens", async () => {
    expect(dialog()).toHaveClass("sm:max-w-lg");

    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    clickNatively(fold());
    await flushMicrotasks();

    expect(fold()).toHaveAttribute("aria-expanded", "true");
    expect(dialog()).toHaveClass("sm:max-w-7xl");
    expect(dialog()).not.toHaveClass("sm:max-w-lg");
  });

  test("is short again in the same pass as the note folds", async () => {
    await act(async () => {
      clickNatively(fold());
    });
    expect(dialog()).toHaveClass("sm:max-w-7xl");

    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    clickNatively(fold());
    await flushMicrotasks();

    expect(fold()).toHaveAttribute("aria-expanded", "false");
    expect(dialog()).toHaveClass("sm:max-w-lg");
    expect(dialog()).not.toHaveClass("sm:max-w-7xl");
  });
});
