import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import BasicModelForm from "../../../../UI/Components/Forms/BasicModelForm";
import { COLOR_FIELD_DESCRIPTION } from "../../../../UI/Components/Forms/Fields/FormField";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Label from "../../../../Models/DatabaseModels/Label";
import getJestMockFunction from "../../../../Tests/MockType";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What a color field says under its title.
 *
 * The screenshot: Create Label's Label Color read "Color of this resource in
 * Hex (#32a852 for example)" - the Label.color column's description, written
 * for API readers, which BasicModelForm puts under any field that has none of
 * its own. A person picking a swatch needs no notation. The column keeps its
 * description (the API reference reads it); a form shows plain words.
 */

const COLUMN_DESCRIPTION: string =
  "Color of this resource in Hex (#32a852 for example)";

describe("a color field's help text", () => {
  afterEach(() => {
    cleanup();
  });

  test("the plain words are plain: no notation, no hex", () => {
    expect(COLOR_FIELD_DESCRIPTION).toBe(
      "Pick a color, or choose a custom one.",
    );
    expect(COLOR_FIELD_DESCRIPTION).not.toMatch(/hex|#|rgb/i);
  });

  test("REGRESSION: a model form shows the plain words, not the column's hex instructions", async () => {
    render(
      <BasicModelForm<Label>
        model={new Label()}
        id="create-label"
        error={null}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { color: true },
            title: "Label Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
          },
        ]}
      />,
    );

    expect(
      await screen.findByText(COLOR_FIELD_DESCRIPTION),
    ).toBeInTheDocument();
    expect(screen.queryByText(COLUMN_DESCRIPTION)).toBeNull();
    expect(document.body.textContent).not.toContain("#32a852");

    // Other fields still take their column's description, as before.
    expect(
      screen.getByText("Any friendly name of this object"),
    ).toBeInTheDocument();
  });

  test("a color field's own description is kept", async () => {
    render(
      <BasicModelForm<Label>
        model={new Label()}
        id="create-label"
        error={null}
        onSubmit={getJestMockFunction()}
        fields={[
          {
            field: { color: true },
            title: "Label Color",
            description:
              "Shown as a dot before the name, wherever this appears.",
            fieldType: FormFieldSchemaType.Color,
            required: true,
          },
        ]}
      />,
    );

    expect(
      await screen.findByText(
        "Shown as a dot before the name, wherever this appears.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(COLOR_FIELD_DESCRIPTION)).toBeNull();
  });

  test("a plain form's color field says the same", () => {
    const fields: Fields<FormValues<Record<string, unknown>>> = [
      {
        field: { color: true },
        title: "Bar Color",
        fieldType: FormFieldSchemaType.Color,
        required: true,
      },
    ];

    render(
      <BasicForm
        id="bar-color"
        fields={fields}
        onSubmit={getJestMockFunction()}
      />,
    );

    expect(screen.getByText(COLOR_FIELD_DESCRIPTION)).toBeInTheDocument();
  });

  test("the swatches are named by the field's title", () => {
    const fields: Fields<FormValues<Record<string, unknown>>> = [
      {
        field: { color: true },
        title: "Bar Color",
        fieldType: FormFieldSchemaType.Color,
        required: true,
      },
    ];

    render(
      <BasicForm
        id="bar-color"
        fields={fields}
        onSubmit={getJestMockFunction()}
      />,
    );

    const group: HTMLElement = screen.getByRole("radiogroup");

    expect(group).toHaveAccessibleName("Bar Color");
    // A required color: no way back to none.
    expect(within(group).queryByRole("radio", { name: "No color" })).toBeNull();
  });

  test("an optional color offers No color", () => {
    const fields: Fields<FormValues<Record<string, unknown>>> = [
      {
        field: { color: true },
        title: "Service Color",
        fieldType: FormFieldSchemaType.Color,
        required: false,
      },
    ];

    render(
      <BasicForm
        id="service-color"
        fields={fields}
        onSubmit={getJestMockFunction()}
      />,
    );

    expect(
      within(screen.getByRole("radiogroup")).getByRole("radio", {
        name: "No color",
      }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
