/*
 * A LongText form field: the plain multi-line box, named by its label, that
 * auto-grows when the field asks it to, and that shows a value the form sets
 * on it from outside.
 *
 * That last part is what a workflow step's "pick this value from a component
 * or a variable" does: it appends a reference through the form's
 * setFieldValue. The box ignored it, so the reference never appeared, and the
 * next keystroke wrote the old text back over it.
 */
import "@testing-library/jest-dom";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import BasicForm, {
  FormProps,
} from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";

interface TestEntity extends JSONObject {
  message?: string;
}

type RenderFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
  value?: string,
) => void;

const renderField: RenderFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
  value?: string,
): void => {
  const field: Field<TestEntity> = {
    title: "Message",
    description: "What to send.",
    name: "message",
    field: { message: true },
    fieldType: FormFieldSchemaType.LongText,
    required: true,
    ...(overrides || {}),
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="message"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ message: value ?? "" } as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
    />,
  );
};

const getMessageBox: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByRole("textbox", {
    name: /^Message/,
  }) as HTMLTextAreaElement;
};

afterEach(() => {
  cleanup();
});

describe("FormField — LongText", () => {
  test("renders a text area named by the field's label", () => {
    renderField(undefined, "Line one\nLine two");

    const box: HTMLTextAreaElement = getMessageBox();

    expect(box.tagName).toBe("TEXTAREA");
    expect(box.value).toBe("Line one\nLine two");
  });

  test("is the fixed six-line box unless the field asks to auto-grow", () => {
    renderField();

    const box: HTMLTextAreaElement = getMessageBox();

    expect(box).toHaveAttribute("rows", "6");
    expect(box).not.toHaveAttribute("data-auto-grow");
  });

  test("auto-grows from three lines when the field asks it to", () => {
    renderField({ autoGrow: true });

    const box: HTMLTextAreaElement = getMessageBox();

    expect(box).toHaveAttribute("rows", "3");
    expect(box).toHaveAttribute("data-auto-grow", "true");
  });
});

describe("BasicForm — a LongText value set from outside", () => {
  type RenderFormFunction = (initial: string) => {
    formRef: React.RefObject<FormProps<FormValues<TestEntity>>>;
    onChange: MockFunction;
  };

  const renderForm: RenderFormFunction = (
    initial: string,
  ): {
    formRef: React.RefObject<FormProps<FormValues<TestEntity>>>;
    onChange: MockFunction;
  } => {
    const formRef: React.RefObject<FormProps<FormValues<TestEntity>>> =
      React.createRef<FormProps<FormValues<TestEntity>>>();
    const onChange: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        ref={formRef}
        hideSubmitButton={true}
        initialValues={{ message: initial }}
        onChange={(values: FormValues<TestEntity>) => {
          onChange(values);
        }}
        fields={[
          {
            title: "Message",
            field: { message: true },
            fieldType: FormFieldSchemaType.LongText,
            autoGrow: true,
            required: true,
          },
        ]}
      />,
    );

    return { formRef, onChange };
  };

  test("the box shows a reference the form appends to its value", async () => {
    const { formRef } = renderForm("Incident created:");

    await waitFor(() => {
      expect(getMessageBox().value).toBe("Incident created:");
    });

    act(() => {
      formRef.current!.setFieldValue(
        "message",
        "Incident created: {{local.components.on-create-incident-1.returnValues.model.title}}",
      );
    });

    await waitFor(() => {
      expect(getMessageBox().value).toBe(
        "Incident created: {{local.components.on-create-incident-1.returnValues.model.title}}",
      );
    });
  });

  test("typing after that keeps the reference rather than writing the old text back", async () => {
    const { formRef, onChange } = renderForm("Hello");

    await waitFor(() => {
      expect(getMessageBox().value).toBe("Hello");
    });

    act(() => {
      formRef.current!.setFieldValue(
        "message",
        "Hello {{local.variables.NAME}}",
      );
    });

    await waitFor(() => {
      expect(getMessageBox().value).toBe("Hello {{local.variables.NAME}}");
    });

    fireEvent.change(getMessageBox(), {
      target: { value: "Hello {{local.variables.NAME}}!" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: "Hello {{local.variables.NAME}}!",
        }),
      );
    });
    expect(getMessageBox().value).toBe("Hello {{local.variables.NAME}}!");
  });
});
