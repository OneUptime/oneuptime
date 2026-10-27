import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AFTER A PRESS THAT FOUND SOMETHING WRONG, THE FIRST FIELD IN ERROR IS IN
 * SIGHT.
 *
 * A long dialog can have its first failing field above or below what is in
 * view, and one folded under More fields was opened for it out of sight.
 * After the form's action finds a field in error, the first one showing an
 * error - in the order the form draws them - is brought into view by as
 * little as it takes (Utils/BringIntoView: block "nearest"). A folded
 * section opens in the same render that draws the error, so the field is
 * measured open (CollapsibleFormSection), not still folded away.
 */

interface ScrollCall {
  element: Element;
  options: ScrollIntoViewOptions | undefined;
  // Whether the element was inside a hidden or folded box when it was called.
  wasHidden: boolean;
}

let calls: Array<ScrollCall> = [];
const originalScrollIntoView: unknown = Element.prototype.scrollIntoView;

beforeEach(() => {
  calls = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ): void {
    calls.push({
      element: this,
      options: typeof options === "object" ? options : undefined,
      wasHidden: Boolean(
        this.closest("[hidden]") ||
          this.closest(
            "[data-collapsed='true'] [data-testid='folded-section-body']",
          ),
      ),
    });
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView =
    originalScrollIntoView as typeof Element.prototype.scrollIntoView;
  cleanup();
});

const FIELDS: Fields<FormValues<any>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "name",
  },
  {
    field: { city: true },
    title: "City",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "city",
  },
  {
    field: { code: true },
    title: "Code",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "code",
    collapsibleSection: getAdvancedFormSection<FormValues<any>>(),
  },
];

function renderForm(
  initialValues: FormValues<any>,
  fields: Fields<FormValues<any>> = FIELDS,
): MockFunction {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="reveals-first-error"
      fields={fields}
      initialValues={initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save"
    />,
  );

  return onSubmit;
}

async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

describe("the first field in error is brought into view", () => {
  test("the first one in the order the form draws them", async () => {
    renderForm({});
    await screen.findByTestId("name");

    await pressSave();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.element.contains(screen.getByTestId("name"))).toBe(true);
    expect(calls[0]!.element.contains(screen.getByTestId("city"))).toBe(false);
    expect(calls[0]!.options).toMatchObject({ block: "nearest" });
  });

  test("a later one when the earlier ones are fine", async () => {
    renderForm({ name: "Acme" });
    await screen.findByTestId("name");

    await pressSave();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.element.contains(screen.getByTestId("city"))).toBe(true);
  });

  test("one folded under More fields, opened before it is measured", async () => {
    renderForm({ name: "Acme", city: "Berlin" });
    await screen.findByTestId("name");
    expect(screen.getByTestId("code")).not.toBeVisible();

    await pressSave();

    expect(screen.getByTestId("code")).toBeVisible();
    const call: ScrollCall | undefined = calls.find((entry: ScrollCall) => {
      return entry.element.contains(screen.getByTestId("code"));
    });
    expect(call).toBeDefined();
    expect(call!.wasHidden).toBe(false);
  });

  test("nothing moves when every field is fine and the form is sent", async () => {
    const onSubmit: MockFunction = renderForm({
      name: "Acme",
      city: "Berlin",
      code: "B1",
    });
    await screen.findByTestId("name");

    await pressSave();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  test("leaving a field, changed or not, moves nothing", async () => {
    renderForm({});
    await screen.findByTestId("name");

    await act(async () => {
      fireEvent.change(screen.getByTestId("name"), { target: { value: "A" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("name"), { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("name"));
    });

    expect(screen.getByText("Name is required.")).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("with a little room from the edge it scrolls in (scroll-my-4)", async () => {
    renderForm({});
    await screen.findByTestId("name");

    await pressSave();

    expect(calls[0]!.element).toHaveClass("scroll-my-4");
  });
});

/*
 * AND THE FOCUS GOES TO IT.
 *
 * The keyboard's reader presses Save, or Enter in the last field, and was
 * left on the button at the bottom while the field to fix was brought into
 * view above. The focus now goes to the first field in error's control (its
 * aria-invalid one, Utils/BringIntoView focusInvalidControl): the fix is
 * typed straight away, and a screen reader reads the field with its error.
 */
describe("the focus goes to the first field in error", () => {
  test("the first one in the order the form draws them", async () => {
    renderForm({});
    await screen.findByTestId("name");
    screen.getByRole("button", { name: "Save" }).focus();

    await pressSave();

    expect(screen.getByTestId("name")).toHaveFocus();
  });

  test("a later one when the earlier ones are fine", async () => {
    renderForm({ name: "Acme" });
    await screen.findByTestId("name");

    await pressSave();

    expect(screen.getByTestId("city")).toHaveFocus();
  });

  test("one folded under More fields, opened for it", async () => {
    renderForm({ name: "Acme", city: "Berlin" });
    await screen.findByTestId("name");

    await pressSave();

    expect(screen.getByTestId("code")).toBeVisible();
    expect(screen.getByTestId("code")).toHaveFocus();
  });

  test("Enter in a later field takes the reader back to the one to fix", async () => {
    renderForm({});
    await screen.findByTestId("city");
    screen.getByTestId("city").focus();

    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("city"), {
        key: "Enter",
        code: "Enter",
      });
    });

    expect(screen.getByText("Name is required.")).toBeVisible();
    expect(screen.getByTestId("name")).toHaveFocus();
  });

  test("a choice in error: its first option takes the focus", async () => {
    renderForm({ name: "Acme", city: "Berlin", code: "B1" }, [
      ...FIELDS,
      {
        field: { plan: true },
        title: "Plan",
        fieldType: FormFieldSchemaType.RadioButton,
        required: true,
        radioButtonOptions: [
          { value: "free", title: "Free" },
          { value: "growth", title: "Growth" },
        ],
      },
    ]);
    await screen.findByTestId("name");

    await pressSave();

    expect(screen.getByText("Plan is required.")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Free" })).toHaveFocus();
  });

  test("a press that sends the form leaves the focus where it was", async () => {
    const onSubmit: MockFunction = renderForm({
      name: "Acme",
      city: "Berlin",
      code: "B1",
    });
    await screen.findByTestId("name");
    const save: HTMLElement = screen.getByRole("button", { name: "Save" });
    save.focus();

    await pressSave();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(save).toHaveFocus();
  });

  test("leaving a field in error does not pull the focus back to it", async () => {
    renderForm({});
    await screen.findByTestId("name");

    await act(async () => {
      fireEvent.change(screen.getByTestId("name"), { target: { value: "A" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("name"), { target: { value: "" } });
    });
    screen.getByTestId("city").focus();
    await act(async () => {
      fireEvent.blur(screen.getByTestId("name"));
    });

    expect(screen.getByText("Name is required.")).toBeVisible();
    expect(screen.getByTestId("city")).toHaveFocus();
  });
});

/*
 * A FIELD TALLER THAN ITS VIEW BRINGS ITS MESSAGE INTO VIEW.
 *
 * Brought into view whole, a field taller than the view comes in at its
 * start. A custom field of many controls draws its message at its end -
 * Monitor Steps says "Pick at least one browser to run the script in."
 * under all of its steps - so after Next the reader saw the steps' first
 * screen and no message, as if Next did nothing (14.0.93's gate, the
 * Synthetic monitor's browsers). Its message comes into view instead. jsdom
 * lays nothing out, so each test says how tall the field and its view are.
 */
describe("a field taller than its view brings its message into view", () => {
  const MESSAGE: string = "Pick at least one browser to run the script in.";
  // Custom validation reads a field that holds a value, as Monitor Steps always does.
  const STEPS_VALUES: FormValues<any> = { name: "Acme", steps: "No browser" };
  const originalGetBoundingClientRect: unknown =
    Element.prototype.getBoundingClientRect;
  const originalInnerHeight: number = window.innerHeight;

  // The custom field's height, as the form measures its box.
  function layOut(fieldHeight: number): void {
    Element.prototype.getBoundingClientRect = function (
      this: Element,
    ): DOMRect {
      const isStepsField: boolean =
        this.querySelector("[data-testid='steps-controls']") !== null;
      const height: number = isStepsField ? fieldHeight : 40;

      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: height,
        width: 800,
        height: height,
        toJSON: (): string => {
          return "";
        },
      } as DOMRect;
    };
  }

  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 900,
    });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect =
      originalGetBoundingClientRect as typeof Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  function stepsField(
    drawsMessage: boolean = true,
  ): Fields<FormValues<any>>[number] {
    return {
      field: { steps: true },
      title: "Monitor Steps",
      fieldType: FormFieldSchemaType.CustomComponent,
      customValidation: (): string => {
        return MESSAGE;
      },
      getCustomElement: (
        _values: FormValues<any>,
        props: { error?: string | undefined },
      ): React.ReactElement => {
        return (
          <div>
            <div role="alert" data-testid="steps-tip">
              One check a minute from each probe.
            </div>
            <div data-testid="steps-controls">Browsers and screen sizes</div>
            {drawsMessage && props.error ? (
              <div role="alert" data-testid="error-message">
                {props.error}
              </div>
            ) : null}
          </div>
        );
      },
    };
  }

  test("a field taller than the window: its message, not its start", async () => {
    layOut(2600);
    renderForm(STEPS_VALUES, [FIELDS[0]!, stepsField()]);
    await screen.findByTestId("steps-controls");

    await pressSave();

    expect(screen.getByTestId("error-message")).toHaveTextContent(MESSAGE);
    expect(calls).toHaveLength(1);
    // The message it draws at its end - not the tip it draws as an alert above it.
    expect(calls[0]!.element).toBe(screen.getByTestId("error-message"));
    expect(calls[0]!.options).toMatchObject({ block: "nearest" });
  });

  test("a field that fits comes in whole, its message with it", async () => {
    layOut(600);
    renderForm(STEPS_VALUES, [FIELDS[0]!, stepsField()]);
    await screen.findByTestId("steps-controls");

    await pressSave();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.element).not.toBe(screen.getByTestId("error-message"));
    expect(
      calls[0]!.element.contains(screen.getByTestId("steps-controls")),
    ).toBe(true);
    expect(
      calls[0]!.element.contains(screen.getByTestId("error-message")),
    ).toBe(true);
  });

  test("a field taller than the dialog body it scrolls in, though shorter than the window", async () => {
    layOut(600);
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <div data-testid="dialog-body" style={{ overflowY: "auto" }}>
        <BasicForm
          id="reveals-in-a-dialog"
          fields={[FIELDS[0]!, stepsField()]}
          initialValues={STEPS_VALUES}
          onSubmit={onSubmit}
          submitButtonText="Save"
        />
      </div>,
    );
    const body: HTMLElement = screen.getByTestId("dialog-body");
    Object.defineProperty(body, "clientHeight", {
      configurable: true,
      value: 420,
    });
    Object.defineProperty(body, "scrollHeight", {
      configurable: true,
      value: 1400,
    });
    await screen.findByTestId("steps-controls");

    await pressSave();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.element).toBe(screen.getByTestId("error-message"));
  });

  test("a tall field that draws no message comes in at its start", async () => {
    layOut(2600);
    renderForm(STEPS_VALUES, [FIELDS[0]!, stepsField(false)]);
    await screen.findByTestId("steps-controls");

    await pressSave();

    expect(screen.queryByTestId("error-message")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(
      calls[0]!.element.contains(screen.getByTestId("steps-controls")),
    ).toBe(true);
    expect(calls[0]!.element).not.toBe(screen.getByTestId("steps-tip"));
  });
});
