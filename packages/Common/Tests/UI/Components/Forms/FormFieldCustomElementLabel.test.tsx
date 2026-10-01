/*
 * A form field drawn by its caller (CustomComponent) is handed the id of its
 * label, so the control can be named by it the way a native input is by
 * <label for>; and a code field can add buttons to its editor's toolbar.
 * The workflow builder's value picker uses both. One that draws its own
 * label, as a switch does beside it, gets none from the form.
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

    expect(
      screen.getByRole("textbox", { name: "Message" }),
    ).toBeInTheDocument();
  });

  test("keeps its label, help and the gap under them, unless it says otherwise", () => {
    renderField({
      description: "What to send.",
      fieldType: FormFieldSchemaType.CustomComponent,
      getCustomElement: (): ReactElement => {
        return <div data-testid="caller-drawn" />;
      },
    });

    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.getByText("What to send.")).toBeInTheDocument();
    expect(screen.getByTestId("caller-drawn").parentElement).toHaveClass(
      "mt-2",
    );
  });

  test("that draws its own label gets none above it, no gap, and no id of a label that is not there", () => {
    const handed: Array<CustomElementProps> = [];

    renderField({
      title: "Use Implicit TLS",
      description: "Optional. Enable for implicit TLS.",
      required: false,
      fieldType: FormFieldSchemaType.CustomComponent,
      customElementDrawsOwnLabel: true,
      getCustomElement: (
        _values: FormValues<TestEntity>,
        props: CustomElementProps,
      ): ReactElement => {
        handed.push(props);
        return <div data-testid="caller-drawn" />;
      },
    });

    // FormField's label would have drawn the title, "(Optional)" and help.
    expect(screen.queryByText("Use Implicit TLS")).toBeNull();
    expect(screen.queryByText("(Optional)")).toBeNull();
    expect(screen.queryByText("Optional. Enable for implicit TLS.")).toBeNull();

    // It starts where a label would, as a switch field's row does.
    expect(screen.getByTestId("caller-drawn").parentElement).not.toHaveClass(
      "mt-2",
    );

    expect(handed.length).toBeGreaterThan(0);
    expect(handed[handed.length - 1]!.ariaLabelledby).toBeUndefined();
  });
});

describe("FormField — a code field's toolbar", () => {
  test.each([
    [FormFieldSchemaType.JSON],
    [FormFieldSchemaType.HTML],
    [FormFieldSchemaType.JavaScript],
  ])(
    "a %s field shows the buttons it is given",
    (fieldType: FormFieldSchemaType) => {
      renderField({
        fieldType: fieldType,
        codeEditorToolbarActions: (_editor: CodeEditorActions): ReactNode => {
          return <button type="button">Insert value</button>;
        },
      });

      expect(
        screen.getByRole("button", { name: "Insert value" }),
      ).toBeInTheDocument();
    },
  );

  test("and none when it is given none", () => {
    renderField({ fieldType: FormFieldSchemaType.JSON });

    expect(screen.queryByRole("button", { name: "Insert value" })).toBeNull();
  });
});
