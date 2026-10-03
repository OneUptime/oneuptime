import Input, {
  InputType,
  PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
} from "../../../UI/Components/Input/Input";
import { cleanup, render, RenderResult } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Password managers read every password field as a sign-in form. Nearly every
 * password field in the product holds a secret it stores for something else
 * (an SMTP or SNMP password, an API token, a private status page user's
 * password), so they were offered the person's OneUptime login, and
 * 1Password showed its "Sign in" prompt on Dashboard pages that sign nobody
 * in. A password Input is now a stored secret unless it says it is the
 * person's own: "new-password", so browsers do not fill a saved login in, and
 * the attributes that send the password managers away.
 */

const IGNORE_ATTRIBUTE_NAMES: Array<string> = Object.keys(
  PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
);

type RenderInputFunction = (
  props: React.ComponentProps<typeof Input>,
) => HTMLInputElement;

const renderInput: RenderInputFunction = (
  props: React.ComponentProps<typeof Input>,
): HTMLInputElement => {
  const result: RenderResult = render(<Input {...props} />);
  return result.container.querySelector("input") as HTMLInputElement;
};

type IgnoreAttributesFunction = (
  input: HTMLInputElement,
) => Record<string, string | null>;

const ignoreAttributesOf: IgnoreAttributesFunction = (
  input: HTMLInputElement,
): Record<string, string | null> => {
  const attributes: Record<string, string | null> = {};

  for (const name of IGNORE_ATTRIBUTE_NAMES) {
    attributes[name] = input.getAttribute(name);
  }

  return attributes;
};

const NONE_OF_THEM: Record<string, string | null> = Object.fromEntries(
  IGNORE_ATTRIBUTE_NAMES.map((name: string): [string, null] => {
    return [name, null];
  }),
);

afterEach(() => {
  cleanup();
});

describe("the attributes that send password managers away", () => {
  test("cover 1Password (both spellings), LastPass, Bitwarden and Dashlane", () => {
    expect(PASSWORD_MANAGER_IGNORE_ATTRIBUTES).toEqual({
      "data-1p-ignore": "true",
      "data-op-ignore": "true",
      "data-lpignore": "true",
      "data-bwignore": "true",
      "data-form-type": "other",
    });
  });
});

describe("a password Input that is not the person's own is a stored secret", () => {
  test("it carries every ignore attribute and asks browsers for a new password, not a saved one", () => {
    const input: HTMLInputElement = renderInput({ type: InputType.PASSWORD });

    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(ignoreAttributesOf(input)).toEqual(
      PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
    );
  });

  test("an autocomplete the caller chose is kept, and the field is still kept from password managers", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.PASSWORD,
      autoComplete: "off",
    });

    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(ignoreAttributesOf(input)).toEqual(
      PASSWORD_MANAGER_IGNORE_ATTRIBUTES,
    );
  });

  test("isOwnCredential set to false is the same as leaving it out", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.PASSWORD,
      isOwnCredential: false,
    });

    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.getAttribute("data-1p-ignore")).toBe("true");
  });

  test("a disabled or read-only secret is a secret all the same", () => {
    expect(
      renderInput({ type: InputType.PASSWORD, disabled: true }).getAttribute(
        "data-1p-ignore",
      ),
    ).toBe("true");
    cleanup();
    expect(
      renderInput({ type: InputType.PASSWORD, readOnly: true }).getAttribute(
        "data-1p-ignore",
      ),
    ).toBe("true");
  });
});

describe("a password Input that is the person's own is left to password managers", () => {
  test("a sign-in password keeps current-password and carries no ignore attribute", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.PASSWORD,
      autoComplete: "current-password",
      isOwnCredential: true,
    });

    expect(input.getAttribute("autocomplete")).toBe("current-password");
    expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
  });

  test("a sign-up or change-password field keeps new-password and carries no ignore attribute", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.PASSWORD,
      autoComplete: "new-password",
      isOwnCredential: true,
    });

    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
  });

  test("without an autocomplete of its own it gets none: the caller says which kind it is", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.PASSWORD,
      isOwnCredential: true,
    });

    expect(input.hasAttribute("autocomplete")).toBe(false);
    expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
  });
});

describe("inputs that are not passwords are untouched", () => {
  test.each([
    InputType.TEXT,
    InputType.NUMBER,
    InputType.URL,
    InputType.DATE,
    InputType.DATETIME_LOCAL,
    InputType.TIME,
  ])(
    "%s carries no ignore attribute and no autocomplete it was not given",
    (type: InputType) => {
      const input: HTMLInputElement = renderInput({ type: type });

      expect(input.hasAttribute("autocomplete")).toBe(false);
      expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
    },
  );

  test("an Input with no type at all is a text box, untouched", () => {
    const input: HTMLInputElement = renderInput({});

    expect(input.type).toBe("text");
    expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
  });

  test("an autocomplete a text Input is given is passed through as before", () => {
    const input: HTMLInputElement = renderInput({
      type: InputType.TEXT,
      autoComplete: "one-time-code",
    });

    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(ignoreAttributesOf(input)).toEqual(NONE_OF_THEM);
  });
});
