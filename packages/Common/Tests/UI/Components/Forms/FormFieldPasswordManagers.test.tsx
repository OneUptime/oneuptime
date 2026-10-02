/*
 * Which form fields a password manager may treat as a sign-in.
 *
 * Every Password field in every form used to get autocomplete
 * "current-password" - the token for the password a person signs in with -
 * and EncryptedText fields rendered as bare password boxes. So a Dashboard
 * form with a password in it (an SMTP server, a private status page user, a
 * data source) read as a sign-in form: 1Password put its "Sign in" prompt
 * over the page, offered the person's OneUptime login for the field, and
 * offered to save what they typed as a new login.
 *
 * Now a Password or EncryptedText field is a stored secret unless it says it
 * is the person's own (Field.isOwnCredential with the matching autoComplete),
 * which the sign-in, sign-up and change-password pages do.
 */
import React from "react";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { PASSWORD_MANAGER_IGNORE_ATTRIBUTES } from "../../../../UI/Components/Input/Input";
import { JSONObject } from "../../../../Types/JSON";

interface TestEntity extends JSONObject {
  value?: string;
}

type RenderFieldFunction = (
  overrides: Partial<Field<TestEntity>>,
) => HTMLInputElement;

const renderField: RenderFieldFunction = (
  overrides: Partial<Field<TestEntity>>,
): HTMLInputElement => {
  const field: Field<TestEntity> = {
    title: "Value",
    name: "value",
    field: { value: true },
    required: true,
    ...overrides,
  } as Field<TestEntity>;

  const result: RenderResult = render(
    <FormField<TestEntity>
      field={field}
      fieldName="value"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ value: "" } as FormValues<TestEntity>}
      setFieldTouched={(): void => {}}
      setFieldValue={(): void => {}}
    />,
  );

  return result.container.querySelector("input") as HTMLInputElement;
};

type IsHiddenFunction = (input: HTMLInputElement) => boolean;

// Every one of the attributes, with its value - not just one of them.
const isHiddenFromPasswordManagers: IsHiddenFunction = (
  input: HTMLInputElement,
): boolean => {
  return Object.entries(PASSWORD_MANAGER_IGNORE_ATTRIBUTES).every(
    ([name, value]: [string, string]): boolean => {
      return input.getAttribute(name) === value;
    },
  );
};

const hasAnyIgnoreAttribute: IsHiddenFunction = (
  input: HTMLInputElement,
): boolean => {
  return Object.keys(PASSWORD_MANAGER_IGNORE_ATTRIBUTES).some(
    (name: string): boolean => {
      return input.hasAttribute(name);
    },
  );
};

afterEach(() => {
  cleanup();
});

describe("a Password or EncryptedText field is a stored secret by default", () => {
  test("a Password field asks for a new password and is hidden from password managers", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.Password,
    });

    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(isHiddenFromPasswordManagers(input)).toBe(true);
  });

  test("an EncryptedText field (API keys, tokens) is treated the same way", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.EncryptedText,
    });

    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(isHiddenFromPasswordManagers(input)).toBe(true);
  });

  test("no field the product stores is labelled as the password someone signs in with", () => {
    for (const fieldType of [
      FormFieldSchemaType.Password,
      FormFieldSchemaType.EncryptedText,
    ]) {
      const input: HTMLInputElement = renderField({ fieldType: fieldType });

      expect(input.getAttribute("autocomplete")).not.toBe("current-password");
      cleanup();
    }
  });

  test("an autocomplete a secret field asks for itself is kept", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.Password,
      autoComplete: "off",
    });

    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(isHiddenFromPasswordManagers(input)).toBe(true);
  });
});

describe("the person's own password is left to password managers", () => {
  test("a sign-in password keeps current-password and no ignore attribute", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.Password,
      autoComplete: "current-password",
      isOwnCredential: true,
    });

    expect(input.getAttribute("autocomplete")).toBe("current-password");
    expect(hasAnyIgnoreAttribute(input)).toBe(false);
  });

  test("a sign-up or change-password field keeps new-password and no ignore attribute", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.Password,
      autoComplete: "new-password",
      isOwnCredential: true,
    });

    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(hasAnyIgnoreAttribute(input)).toBe(false);
  });
});

describe("fields that are not passwords keep what they had", () => {
  test.each([
    [FormFieldSchemaType.Email, "email", "email"],
    [FormFieldSchemaType.Phone, "text", "tel"],
    [FormFieldSchemaType.Name, "text", "name"],
    [FormFieldSchemaType.URL, "url", "url"],
  ])(
    "%s renders a %s box with autocomplete %s and no ignore attribute",
    (
      fieldType: FormFieldSchemaType,
      inputType: string,
      autoComplete: string,
    ) => {
      const input: HTMLInputElement = renderField({ fieldType: fieldType });

      expect(input.type).toBe(inputType);
      expect(input.getAttribute("autocomplete")).toBe(autoComplete);
      expect(hasAnyIgnoreAttribute(input)).toBe(false);
    },
  );

  test("a Text field has no autocomplete and no ignore attribute", () => {
    const input: HTMLInputElement = renderField({
      fieldType: FormFieldSchemaType.Text,
    });

    expect(input.hasAttribute("autocomplete")).toBe(false);
    expect(hasAnyIgnoreAttribute(input)).toBe(false);
  });
});

describe("whole forms, the way a password manager reads them", () => {
  type RenderFormFunction = (fields: Array<Field<JSONObject>>) => HTMLElement;

  const renderForm: RenderFormFunction = (
    fields: Array<Field<JSONObject>>,
  ): HTMLElement => {
    const result: RenderResult = render(
      <BasicForm
        hideSubmitButton={true}
        initialValues={{}}
        onChange={(): void => {}}
        fields={fields}
      />,
    );

    return result.container;
  };

  type PasswordInputsFunction = (
    container: HTMLElement,
  ) => Array<HTMLInputElement>;

  const passwordInputs: PasswordInputsFunction = (
    container: HTMLElement,
  ): Array<HTMLInputElement> => {
    return Array.from(
      container.querySelectorAll<HTMLInputElement>("input[type='password']"),
    );
  };

  test("a Dashboard form with an email and a password - a private status page user - is no sign-in form", () => {
    const container: HTMLElement = renderForm([
      {
        title: "Email",
        field: { email: true },
        fieldType: FormFieldSchemaType.Email,
        required: true,
      },
      {
        title: "Password",
        field: { password: true },
        fieldType: FormFieldSchemaType.Password,
        required: true,
      },
    ]);

    const passwords: Array<HTMLInputElement> = passwordInputs(container);

    expect(passwords).toHaveLength(1);
    expect(passwords[0]!.getAttribute("autocomplete")).toBe("new-password");
    expect(isHiddenFromPasswordManagers(passwords[0]!)).toBe(true);
    expect(
      container.querySelector("[autocomplete='current-password']"),
    ).toBeNull();
  });

  test("a settings form full of secrets hides every one of them", () => {
    const container: HTMLElement = renderForm([
      {
        title: "SMTP Username",
        field: { username: true },
        fieldType: FormFieldSchemaType.Text,
        required: true,
      },
      {
        title: "SMTP Password",
        field: { password: true },
        fieldType: FormFieldSchemaType.Password,
        required: true,
      },
      {
        title: "API Token",
        field: { token: true },
        fieldType: FormFieldSchemaType.EncryptedText,
        required: true,
      },
    ]);

    const passwords: Array<HTMLInputElement> = passwordInputs(container);

    expect(passwords).toHaveLength(2);
    expect(passwords.every(isHiddenFromPasswordManagers)).toBe(true);
  });

  test("a sign-in form that says so is still a sign-in form", () => {
    const container: HTMLElement = renderForm([
      {
        title: "Email",
        field: { email: true },
        fieldType: FormFieldSchemaType.Email,
        required: true,
      },
      {
        title: "Password",
        field: { password: true },
        fieldType: FormFieldSchemaType.Password,
        autoComplete: "current-password",
        isOwnCredential: true,
        required: true,
      },
    ]);

    const passwords: Array<HTMLInputElement> = passwordInputs(container);

    expect(passwords[0]!.getAttribute("autocomplete")).toBe("current-password");
    expect(hasAnyIgnoreAttribute(passwords[0]!)).toBe(false);
    expect(
      container
        .querySelector("input[type='email']")!
        .getAttribute("autocomplete"),
    ).toBe("email");
  });
});
