import BasicForm, {
  BasicFormHandle,
} from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { FormStep } from "../../../../UI/Components/Forms/Types/FormStep";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * WHEN A FIELD SAYS WHAT IS WRONG WITH IT.
 *
 * The maintainer's follow-ups: "Required-field errors show on blur
 * everywhere: picking a plan before typing a name says 'Project Name is
 * required.', opening More fields first says 'Name is required.'". A field
 * counted as touched the moment it lost the focus, and a form puts the focus
 * in its first field as it opens - so the first click anywhere else called
 * out a field nobody had reached yet.
 *
 * Now (BasicForm changedFieldNames): a field says what is wrong once it has
 * been changed and left - a required field typed into and emptied included -
 * or once the form's action (or Next) is pressed, which checks every field
 * on the step. Moving through a form says nothing. A form whose host has no
 * press that checks it asks for the old way (showErrorsWhenLeftUnchanged).
 */

const SAVE: string = "Save";

const FIELDS: Fields<FormValues<any>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    validation: { minLength: 2 },
    dataTestId: "name",
  },
  {
    field: { email: true },
    title: "Email",
    fieldType: FormFieldSchemaType.Email,
    required: false,
    dataTestId: "email",
  },
  {
    field: { notes: true },
    title: "Notes",
    fieldType: FormFieldSchemaType.LongText,
    required: true,
    dataTestId: "notes",
  },
  {
    field: { port: true },
    title: "Port",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    dataTestId: "port",
  },
];

interface Rendered {
  onSubmit: MockFunction;
  formRef: React.MutableRefObject<BasicFormHandle | null>;
}

function renderForm(
  options: { showErrorsWhenLeftUnchanged?: boolean; fields?: Fields<any> } = {},
): Rendered {
  const onSubmit: MockFunction = getJestMockFunction();
  const formRef: React.MutableRefObject<BasicFormHandle | null> = {
    current: null,
  };

  render(
    <BasicForm
      id="errors-after-change"
      ref={formRef}
      fields={options.fields || FIELDS}
      initialValues={{}}
      onSubmit={onSubmit}
      submitButtonText={SAVE}
      showErrorsWhenLeftUnchanged={options.showErrorsWhenLeftUnchanged}
    />,
  );

  return { onSubmit, formRef };
}

function input(testId: string): HTMLElement {
  return screen.getByTestId(testId);
}

function errorTexts(): Array<string> {
  return screen
    .queryAllByTestId("error-message")
    .map((element: HTMLElement): string => {
      return (element.textContent || "").trim();
    });
}

async function leave(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(input(testId));
  });
  await act(async () => {
    fireEvent.blur(input(testId));
  });
}

async function type(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input(testId), { target: { value } });
  });
}

async function pressSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: SAVE }));
  });
}

afterEach(() => {
  cleanup();
});

describe("a form says nothing about a field the reader has not changed", () => {
  test("tabbing through every field, untouched, says nothing", async () => {
    renderForm();
    await screen.findByTestId("name");

    for (const testId of ["name", "email", "notes", "port"]) {
      await leave(testId);
    }

    expect(errorTexts()).toEqual([]);

    for (const testId of ["name", "email", "notes", "port"]) {
      expect(input(testId)).not.toHaveAttribute("aria-invalid");
    }
  });

  test("the first field, focused as the form opens and left for another, says nothing", async () => {
    renderForm();
    await screen.findByTestId("name");

    // Name has the focus as the form opens (BasicForm's autofocus).
    expect(input("name")).toHaveFocus();

    await act(async () => {
      fireEvent.blur(input("name"));
      fireEvent.focus(input("notes"));
    });

    expect(screen.queryByText("Name is required.")).toBeNull();
  });
});

describe("a field changed and left says what is wrong", () => {
  test("too short, once left - not while it is being typed", async () => {
    renderForm();
    await screen.findByTestId("name");

    await type("name", "A");
    expect(errorTexts()).toEqual([]);

    await act(async () => {
      fireEvent.blur(input("name"));
    });

    expect(errorTexts()).toEqual(["Name cannot be less than 2 characters."]);
    expect(input("name")).toHaveAttribute("aria-invalid", "true");
  });

  test("typed into and emptied, a required field says it is required", async () => {
    renderForm();
    await screen.findByTestId("name");

    await type("name", "Acme");
    await type("name", "");
    await act(async () => {
      fireEvent.blur(input("name"));
    });

    expect(errorTexts()).toEqual(["Name is required."]);
  });

  test("once shown, the message follows what is typed", async () => {
    renderForm();
    await screen.findByTestId("name");

    await type("name", "A");
    await act(async () => {
      fireEvent.blur(input("name"));
    });
    expect(errorTexts()).toEqual(["Name cannot be less than 2 characters."]);

    await type("name", "Acme");
    expect(errorTexts()).toEqual([]);

    await type("name", "");
    expect(errorTexts()).toEqual(["Name is required."]);
  });

  test("a long text and a number box work the same way", async () => {
    renderForm();
    await screen.findByTestId("notes");

    await leave("notes");
    await leave("port");
    expect(errorTexts()).toEqual([]);

    await type("notes", "Paged at 2am");
    await type("notes", "");
    await act(async () => {
      fireEvent.blur(input("notes"));
    });
    await type("port", "443");
    await type("port", "");
    await act(async () => {
      fireEvent.blur(input("port"));
    });

    expect(errorTexts()).toEqual(["Notes is required.", "Port is required."]);
  });

  test("leaving one field changed calls out that field only", async () => {
    renderForm();
    await screen.findByTestId("email");

    await type("email", "not-an-address");
    await act(async () => {
      fireEvent.blur(input("email"));
    });
    await leave("name");

    expect(errorTexts()).toEqual(["Email is not valid."]);
    expect(input("name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("pressing the form's action checks every field", () => {
  test("Save says what is missing, changed or not, and sends nothing", async () => {
    const { onSubmit } = renderForm();
    await screen.findByTestId("name");

    await pressSave();

    expect(errorTexts()).toEqual([
      "Name is required.",
      "Notes is required.",
      "Port is required.",
    ]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("after Save, a field the reader fixes stops saying it at once", async () => {
    renderForm();
    await screen.findByTestId("name");

    await pressSave();
    await type("name", "Acme");

    expect(errorTexts()).toEqual(["Notes is required.", "Port is required."]);
  });

  test("Next walks the same way: the step's untouched fields say what is missing", async () => {
    const steps: Array<FormStep<FormValues<any>>> = [
      { title: "Basics", id: "basics" },
      { title: "Details", id: "details" },
    ];
    const stepped: Fields<FormValues<any>> = [
      { ...FIELDS[0]!, stepId: "basics" },
      { ...FIELDS[2]!, stepId: "details" },
    ];

    render(
      <BasicForm
        id="stepped-errors"
        fields={stepped}
        steps={steps}
        initialValues={{}}
        onSubmit={getJestMockFunction()}
        submitButtonText={SAVE}
      />,
    );
    await screen.findByTestId("name");

    await leave("name");
    expect(errorTexts()).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });

    expect(errorTexts()).toEqual(["Name is required."]);
  });
});

describe("a form whose host has no press that checks it", () => {
  test("says what is wrong as soon as an untouched field is left (showErrorsWhenLeftUnchanged)", async () => {
    renderForm({ showErrorsWhenLeftUnchanged: true });
    await screen.findByTestId("name");

    await leave("name");

    expect(errorTexts()).toEqual(["Name is required."]);
    expect(input("name")).toHaveAttribute("aria-invalid", "true");
  });

  test("the form's handle still marks a field touched when the host asks", async () => {
    const { formRef } = renderForm();
    await screen.findByTestId("name");

    await act(async () => {
      formRef.current!.setFieldTouched("name", true);
    });

    expect(errorTexts()).toEqual(["Name is required."]);
  });
});

describe("pickers that store a pick and leave in one go", () => {
  test("a color picked is a change: a required color field never says it is missing after a pick", async () => {
    const fields: Fields<FormValues<any>> = [
      {
        field: { color: true },
        title: "Color",
        fieldType: FormFieldSchemaType.Color,
        required: true,
      },
    ];

    renderForm({ fields });
    const group: HTMLElement = await screen.findByRole("radiogroup");

    await act(async () => {
      fireEvent.click(within(group).getAllByRole("radio")[0]!);
    });

    expect(errorTexts()).toEqual([]);
  });
});
