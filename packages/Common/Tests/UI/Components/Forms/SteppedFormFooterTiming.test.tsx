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
 * step it is on, and whether that is the last one. Those reports reach the
 * dialog in the same pass as the change that caused them - before anything
 * is painted - so the footer never shows what the step before wanted. With
 * a plain effect it lagged a frame, and a quick second click meant as Next
 * landed on the form's action, which the last step had just brought in (the
 * SLO burn rate rule suite caught it).
 *
 * The action - the dialog's one primary button - is on the last step only
 * (Forms/Utils/SteppedFormFooter.ts), so it must never be drawn on another
 * step, not even for a frame: not while the dialog opens, and not after an
 * answer brings a step after the one on screen into view.
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

function submitButton(): HTMLElement | null {
  return within(modal()).queryByTestId("modal-footer-submit-button");
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

const THREE_STEPS: Array<FormStep<JSONObject>> = [
  { title: "Burn Window", id: "window" },
  { title: "Alert", id: "alert", showIf: declaresAlert },
  { title: "Labels", id: "labels" },
];

// The Alert step is the last one, when it shows.
const TWO_STEPS: Array<FormStep<JSONObject>> = [
  { title: "Burn Window", id: "window" },
  { title: "Alert", id: "alert", showIf: declaresAlert },
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

async function renderDialog(data: {
  steps: Array<FormStep<JSONObject>>;
  initialValues?: JSONObject;
}): Promise<HTMLInputElement> {
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
          steps: data.steps,
          initialValues: data.initialValues,
          fields: FIELDS.filter((field: Fields<JSONObject>[number]) => {
            return data.steps.some((step: FormStep<JSONObject>) => {
              return step.id === field.stepId;
            });
          }),
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

  test("opens on Next: the action is never drawn on the first step, not even for a frame", async () => {
    let actionWasDrawn: boolean = false;

    const observer: MutationObserver = new MutationObserver(() => {
      if (
        document.querySelector('[data-testid="modal-footer-submit-button"]')
      ) {
        actionWasDrawn = true;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    try {
      await renderDialog({ steps: THREE_STEPS });
      await act(async () => {});
    } finally {
      observer.disconnect();
    }

    expect(actionWasDrawn).toBe(false);
    expect(nextButton()).toHaveTextContent("Next");
    expect(submitButton()).not.toBeInTheDocument();
  });

  test("brings the action in, and takes Next away, in the same pass as Next opens the last step", async () => {
    const declares: HTMLInputElement = await renderDialog({
      steps: THREE_STEPS,
    });

    await act(async () => {
      typeNatively(declares, "nothing");
    });

    // Burn Window, then Labels: the Alert step is left out.
    expect(nextButton()).toBeInTheDocument();
    expect(submitButton()).not.toBeInTheDocument();

    // Now as a browser would, with no act() to flush scheduled work.
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    nextButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();

    expect(
      within(modal()).getByRole("textbox", { name: /^Labels/ }),
    ).toBeInTheDocument();
    expect(nextButton()).not.toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(ACTION);
  });

  test("takes the action away, and brings Next back, in the same pass as an answer brings a later step into view", async () => {
    // Declaring nothing, Burn Window is the only step: the action is there.
    const declares: HTMLInputElement = await renderDialog({
      steps: TWO_STEPS,
      initialValues: { declares: "nothing" },
    });

    await act(async () => {});
    expect(submitButton()).toHaveTextContent(ACTION);
    expect(nextButton()).not.toBeInTheDocument();

    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;

    typeNatively(declares, "an alert");
    await flushMicrotasks();

    // The Alert step is now the last: Next, and no action, on Burn Window.
    expect(declares).toHaveValue("an alert");
    expect(submitButton()).not.toBeInTheDocument();
    expect(nextButton()).toHaveTextContent("Next");

    typeNatively(declares, "nothing");
    await flushMicrotasks();

    expect(submitButton()).toHaveTextContent(ACTION);
    expect(nextButton()).not.toBeInTheDocument();
  });
});
