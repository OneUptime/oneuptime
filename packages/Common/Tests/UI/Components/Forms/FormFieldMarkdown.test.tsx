import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A Markdown field's editor uploads pasted, dropped and picked images to the
 * File API, which needs a signed-in user. A form that people without a
 * OneUptime account fill in turns that off with the field's
 * allowImageUpload option; every other form keeps it on without saying so.
 */

interface TestEntity extends JSONObject {
  description?: string;
}

afterEach(() => {
  cleanup();
});

const renderMarkdownField: (overrides?: Partial<Field<TestEntity>>) => void = (
  overrides?: Partial<Field<TestEntity>>,
): void => {
  const field: Field<TestEntity> = {
    title: "Description",
    field: { description: true },
    fieldType: FormFieldSchemaType.Markdown,
    dataTestId: "description-editor",
    ...overrides,
  };

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="description"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ description: "- a" } as FormValues<TestEntity>}
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />,
  );
};

const editorToolbar: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("description-editor");
};

describe("FormField - a Markdown field's image upload", () => {
  test("offers image upload when the field does not say", () => {
    renderMarkdownField();

    expect(within(editorToolbar()).getByTitle("Image")).toBeInTheDocument();
    expect(editorToolbar().querySelector('input[type="file"]')).not.toBeNull();
  });

  test("offers image upload when the field turns it on", () => {
    renderMarkdownField({ allowImageUpload: true });

    expect(within(editorToolbar()).getByTitle("Image")).toBeInTheDocument();
  });

  test("hands allowImageUpload: false to the editor", () => {
    renderMarkdownField({ allowImageUpload: false });

    expect(within(editorToolbar()).queryByTitle("Image")).toBeNull();
    expect(editorToolbar().querySelector('input[type="file"]')).toBeNull();
    // Only the image controls go; the rest of the editor is there.
    expect(within(editorToolbar()).getByTitle("Link")).toBeInTheDocument();
    expect(
      within(editorToolbar()).getByTitle("Indent (Tab)"),
    ).toBeInTheDocument();
    expect(editorToolbar().querySelector("li")?.textContent).toBe("a");
  });
});

describe("BasicForm - a Markdown field on a form open to anyone", () => {
  test("renders its editor without image upload", () => {
    const fields: Fields<TestEntity> = [
      {
        title: "Title",
        field: { title: true } as Field<TestEntity>["field"],
        fieldType: FormFieldSchemaType.Text,
        required: true,
      },
      {
        title: "Description",
        field: { description: true },
        fieldType: FormFieldSchemaType.Markdown,
        allowImageUpload: false,
        dataTestId: "public-description",
      },
      {
        title: "Internal notes",
        field: { notes: true } as Field<TestEntity>["field"],
        fieldType: FormFieldSchemaType.Markdown,
        dataTestId: "internal-notes",
      },
    ];

    render(
      <BasicForm
        id="public-form"
        fields={fields}
        onSubmit={() => {}}
        submitButtonText="Submit"
      />,
    );

    expect(
      within(screen.getByTestId("public-description")).queryByTitle("Image"),
    ).toBeNull();
    expect(
      within(screen.getByTestId("internal-notes")).getByTitle("Image"),
    ).toBeInTheDocument();
  });
});
