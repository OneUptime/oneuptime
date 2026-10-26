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
});
