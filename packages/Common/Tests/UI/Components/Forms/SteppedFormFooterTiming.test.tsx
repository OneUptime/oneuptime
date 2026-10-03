import BasicFormModal from "../../../../UI/Components/FormModal/BasicFormModal";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction from "../../../MockType";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A dialog's footer is drawn by the dialog, from what its form reports: the
 * step it is on, and whether it can be finished from there. Those reports
 * reach the dialog in the same pass as the change that caused them - before
 * anything is painted - so its main button never says what it said a moment
 * ago. Reported from a plain effect, the button read "Next" for a frame
 * after the last required answer went in, and a quick click meant as Next
 * created the record instead (the SLO burn rate rule suite caught it).
 *
 * Driven the way a browser drives it: native events, outside act(), then
 * only microtasks - React's synchronous work, but none of the tasks a
 * scheduled render would wait for.
 */

const flushMicrotasks: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

function typeNatively(input: HTMLInputElement, value: string): void {
  const setter: ((this: HTMLInputElement, value: string) => void) | undefined =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

function submitButton(): HTMLElement {
  return within(modal()).getByTestId("modal-footer-submit-button");
}

function nextButton(): HTMLElement | null {
  return within(modal()).queryByTestId("modal-footer-next-button");
}

const ACTION: string = "Create Burn Rate Rule";

// The alert's title is asked for unless the rule declares nothing.
const declaresAlert: (values: FormValues<JSONObject>) => boolean = (
  values: FormValues<JSONObject>,
): boolean => {
  return values["declares"] !== "nothing";
};

const STEPS: Array<FormStep<JSONObject>> = [
  { title: "Burn Window", id: "window" },
  { title: "Alert", id: "alert", showIf: declaresAlert },
  { title: "Labels", id: "labels" },
];

const FIELDS: Fields<JSONObject> = [
  {
    field: { declares: true },
    title: "Declares",
    stepId: "window",
    fieldType: FormFieldSchemaType.Text,
    required: false,
  },
  {
    field: { alertTitle: true },
    title: "Alert Title",
    stepId: "alert",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    showIf: declaresAlert,
  },
  {
    field: { labels: true },
    title: "Labels",
    stepId: "labels",
    fieldType: FormFieldSchemaType.Text,
    required: false,
  },
];

type ActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

async function renderDialog(): Promise<HTMLInputElement> {
  await act(async () => {
    render(
      <BasicFormModal<JSONObject>
        title={ACTION}
        submitButtonText={ACTION}
        onClose={getJestMockFunction()}
        onSubmit={getJestMockFunction()}
        formProps={{
          id: "footer-timing-form",
          disableAutofocus: true,
          steps: STEPS,
          fields: FIELDS,
        }}
      />,
    );
  });

  return (await screen.findByRole("textbox", {
    name: /^Declares/,
  })) as HTMLInputElement;
}

describe("A stepped dialog's footer", () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = (globalThis as ActEnvironment)
      .IS_REACT_ACT_ENVIRONMENT;
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

  test("offers the action in the same pass as the answer that leaves every step after optional", async () => {
    const declares: HTMLInputElement = await renderDialog();

    // The Alert step asks for a title: the main button walks.
    expect(submitButton()).toHaveTextContent("Next");
    expect(nextButton()).not.toBeInTheDocument();

    // Now as a browser would, with no act() to flush scheduled work.
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    typeNatively(declares, "nothing");
    await flushMicrotasks();

    expect(declares).toHaveValue("nothing");
    expect(submitButton()).toHaveTextContent(ACTION);
    expect(nextButton()).toHaveTextContent("Next");
  });

  test("says Next in the same pass as the answer that brings a step with a required field back", async () => {
    const declares: HTMLInputElement = await renderDialog();

    await act(async () => {
      typeNatively(declares, "nothing");
    });
    expect(submitButton()).toHaveTextContent(ACTION);

    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    typeNatively(declares, "an alert");
    await flushMicrotasks();

    expect(submitButton()).toHaveTextContent("Next");
    expect(nextButton()).not.toBeInTheDocument();
  });

  test("drops Next in the same pass as Next opens the last step", async () => {
    const declares: HTMLInputElement = await renderDialog();

    await act(async () => {
      typeNatively(declares, "nothing");
    });
    expect(nextButton()).toBeInTheDocument();

    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    nextButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    // Labels, the last step: the action alone, nothing to walk on to.
    expect(
      within(modal()).getByRole("textbox", { name: /^Labels/ }),
    ).toBeInTheDocument();
    expect(nextButton()).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(ACTION);
  });
});
