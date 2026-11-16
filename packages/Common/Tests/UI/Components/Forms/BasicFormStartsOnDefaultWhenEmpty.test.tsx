import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AN EMPTY VALUE THAT STARTS ON ITS DEFAULT (#6875).
 *
 * An edit form starts a field on its default only when the record holds no
 * key for it. The server's one settings row holds its SMTP port as null on
 * a fresh server, so the Port box started empty, its 587 only the
 * placeholder, and Next refused it. A field marked startsOnDefaultWhenEmpty
 * starts on its default when the record holds nothing (null) too - while it
 * is shown: a hidden one is sent as it was, so an untouched form saves the
 * record as it holds it. A value the record holds is always kept, and a
 * field not so marked keeps null as before.
 *
 * Blank text is nothing too (#8183): a fresh server's SMTP From Name is "",
 * written so by UpdateGlobalConfigFromEnv, and the field starts on the
 * product's name.
 */

const TIMEOUT: number = 30000;

function fields(data: {
  startsOnDefaultWhenEmpty?: boolean;
  isShown?: boolean;
}): Fields<FormValues<any>> {
  return [
    {
      field: { host: true },
      title: "Hostname",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "smtp.server.com",
    },
    {
      field: { port: true },
      title: "Port",
      fieldType: FormFieldSchemaType.Port,
      required: true,
      placeholder: "587",
      defaultValue: 587,
      ...(data.startsOnDefaultWhenEmpty
        ? { startsOnDefaultWhenEmpty: true }
        : {}),
      ...(data.isShown === false
        ? {
            showIf: (): boolean => {
              return false;
            },
          }
        : {}),
    },
  ];
}

async function draw(data: {
  initialValues: FormValues<any>;
  startsOnDefaultWhenEmpty?: boolean;
  isShown?: boolean;
}): Promise<MockFunction> {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="port-form"
      name="Port form"
      fields={fields(data)}
      initialValues={data.initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save"
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return onSubmit;
}

async function save(): Promise<void> {
  await act(async () => {
    screen.getByText("Save").click();
  });
}

afterEach(() => {
  cleanup();
});

describe("a field marked startsOnDefaultWhenEmpty", () => {
  test(
    "starts on its default when the record holds nothing, and saves it",
    async () => {
      const onSubmit: MockFunction = await draw({
        initialValues: { host: "smtp.example.com", port: null },
        startsOnDefaultWhenEmpty: true,
      });

      expect(screen.getByPlaceholderText("587")).toHaveValue("587");

      await save();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect(
        (onSubmit.mock.calls[0]![0] as Record<string, unknown>)["port"],
      ).toBe(587);
    },
    TIMEOUT,
  );

  test(
    "keeps a value the record holds",
    async () => {
      await draw({
        initialValues: { host: "smtp.example.com", port: 465 },
        startsOnDefaultWhenEmpty: true,
      });

      expect(screen.getByPlaceholderText("587")).toHaveValue("465");
    },
    TIMEOUT,
  );

  test(
    "hidden, it is sent as it was: null",
    async () => {
      const onSubmit: MockFunction = await draw({
        initialValues: { host: "smtp.example.com", port: null },
        startsOnDefaultWhenEmpty: true,
        isShown: false,
      });

      await save();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect(
        (onSubmit.mock.calls[0]![0] as Record<string, unknown>)["port"],
      ).toBeNull();
    },
    TIMEOUT,
  );
});

describe("a field not so marked", () => {
  test(
    "keeps null as before: the default is for a key the record does not hold",
    async () => {
      await draw({
        initialValues: { host: "smtp.example.com", port: null },
      });

      expect(screen.getByPlaceholderText("587")).toHaveValue("");
    },
    TIMEOUT,
  );

  test(
    "and starts on its default when the record holds no key for it",
    async () => {
      await draw({
        initialValues: { host: "smtp.example.com" },
      });

      expect(screen.getByPlaceholderText("587")).toHaveValue("587");
    },
    TIMEOUT,
  );
});

/*
 * A text field, as the server's From Name: required, its default the
 * product's name.
 */
function nameFields(data: {
  startsOnDefaultWhenEmpty?: boolean;
}): Fields<FormValues<any>> {
  return [
    {
      field: { fromName: true },
      title: "From Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Company, Inc.",
      defaultValue: "OneUptime",
      ...(data.startsOnDefaultWhenEmpty
        ? { startsOnDefaultWhenEmpty: true }
        : {}),
    },
  ];
}

async function drawName(data: {
  initialValues: FormValues<any>;
  startsOnDefaultWhenEmpty?: boolean;
}): Promise<MockFunction> {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="name-form"
      name="Name form"
      fields={nameFields(data)}
      initialValues={data.initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save"
    />,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return onSubmit;
}

describe("blank text is nothing too (#8183)", () => {
  test.each([
    ["empty", ""],
    ["spaces", "   "],
    ["a tab and a line break", "\t\n"],
    ["null", null],
  ])(
    "a text field the record holds as %s starts on its default, and saves it",
    async (_label: string, held: string | null) => {
      const onSubmit: MockFunction = await drawName({
        initialValues: { fromName: held },
        startsOnDefaultWhenEmpty: true,
      });

      expect(screen.getByPlaceholderText("Company, Inc.")).toHaveValue(
        "OneUptime",
      );

      await save();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalled();
      });
      expect(
        (onSubmit.mock.calls[0]![0] as Record<string, unknown>)["fromName"],
      ).toBe("OneUptime");
    },
    TIMEOUT,
  );

  test(
    "a name the record holds is kept, spaces inside it and all",
    async () => {
      await drawName({
        initialValues: { fromName: " Acme Status " },
        startsOnDefaultWhenEmpty: true,
      });

      expect(screen.getByPlaceholderText("Company, Inc.")).toHaveValue(
        " Acme Status ",
      );
    },
    TIMEOUT,
  );

  test(
    "a field not so marked keeps its blank text: the form says it is required",
    async () => {
      const onSubmit: MockFunction = await drawName({
        initialValues: { fromName: "" },
      });

      expect(screen.getByPlaceholderText("Company, Inc.")).toHaveValue("");

      await save();

      expect(onSubmit).not.toHaveBeenCalled();
    },
    TIMEOUT,
  );
});
