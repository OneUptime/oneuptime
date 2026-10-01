/*
 * A form field drawn by its caller (CustomComponent) is handed the id of its
 * label, so the control can be named by it the way a native input is by
 * <label for>; and a code field can add buttons to its editor's toolbar.
 * The workflow builder's value picker uses both.
 */

import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { CodeEditorActions } from "../../../../UI/Components/CodeEditor/CodeEditor";
import { JSONObject } from "../../../../Types/JSON";
import React, { ReactElement, ReactNode } from "react";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

interface TestEntity extends JSONObject {
  message?: string;
}

type RenderFieldFunction = (field: Partial<Field<TestEntity>>) => void;

const renderField: RenderFieldFunction = (
  field: Partial<Field<TestEntity>>,
): void => {
  render(
    <FormField<TestEntity>
      field={
        {
          title: "Message",
          name: "message",
          field: { message: true },
          required: true,
          ...field,
        } as Field<TestEntity>
      }
      fieldName="message"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ message: "" } as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
    />,
  );
};

afterEach(() => {
  cleanup();
});

describe("FormField — a field its caller draws", () => {
  test("is named by the field's label", () => {
    renderField({
      fieldType: FormFieldSchemaType.CustomComponent,
      getCustomElement: (
        _values: FormValues<TestEntity>,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <div
            role="textbox"
            tabIndex={0}
            aria-labelledby={props.ariaLabelledby}
          />
        );
      },
    });

    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument();
  });
});

describe("FormField — a code field's toolbar", () => {
  test.each([
    [FormFieldSchemaType.JSON],
    [FormFieldSchemaType.HTML],
    [FormFieldSchemaType.JavaScript],
  ])("a %s field shows the buttons it is given", (fieldType: FormFieldSchemaType) => {
    renderField({
      fieldType: fieldType,
      codeEditorToolbarActions: (_editor: CodeEditorActions): ReactNode => {
        return <button type="button">Insert value</button>;
      },
    });

    expect(
      screen.getByRole("button", { name: "Insert value" }),
    ).toBeInTheDocument();
  });

  test("and none when it is given none", () => {
    renderField({ fieldType: FormFieldSchemaType.JSON });

    expect(screen.queryByRole("button", { name: "Insert value" })).toBeNull();
  });
});
