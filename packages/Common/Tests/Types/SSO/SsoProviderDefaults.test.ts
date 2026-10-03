import { describe, expect, test } from "@jest/globals";
import {
  SsoProviderDescriptionFields,
  fillSsoProviderDescription,
  getDefaultSsoProviderDescription,
  isBlankSsoValue,
  isDefaultSsoProviderDescription,
} from "../../../Types/SSO/SsoProviderDefaults";
import URL from "../../../Types/API/URL";

/*
 * A single sign-on provider nobody describes is described as
 * "Sign in with <name>": the text under its name on the Accounts "Sign in
 * with SSO" list and on a private status page's sign-in page. The services
 * fill it in for an API caller who leaves it out; the forms fill the same
 * text in as the name is typed and keep it following the name until
 * somebody writes their own.
 */

describe("isBlankSsoValue", () => {
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["spaces", "   "],
    ["a tab and a newline", "\t\n"],
  ])("reads %s as nothing written", (_label: string, value: unknown) => {
    expect(isBlankSsoValue(value)).toBe(true);
  });

  test.each([
    ["a word", "Okta"],
    ["a word with spaces around it", "  Okta  "],
    ["a URL object", URL.fromString("https://accounts.example.com")],
    ["false", false],
    ["zero", 0],
  ])("reads %s as something written", (_label: string, value: unknown) => {
    expect(isBlankSsoValue(value)).toBe(false);
  });
});

describe("getDefaultSsoProviderDescription", () => {
  test("says Sign in with the provider's name", () => {
    expect(getDefaultSsoProviderDescription("Okta")).toBe("Sign in with Okta");
    expect(getDefaultSsoProviderDescription("Microsoft Entra ID")).toBe(
      "Sign in with Microsoft Entra ID",
    );
  });

  test("uses the name as written, without the spaces around it", () => {
    expect(getDefaultSsoProviderDescription("  Google Workspace \n")).toBe(
      "Sign in with Google Workspace",
    );
  });

  test.each([undefined, null, "", "   "])(
    "is empty while there is no name (%p)",
    (name: string | null | undefined) => {
      expect(getDefaultSsoProviderDescription(name)).toBe("");
    },
  );
});

describe("isDefaultSsoProviderDescription", () => {
  test("a missing description is the form's own, so it follows the name", () => {
    for (const description of [undefined, null, "", "  "]) {
      expect(
        isDefaultSsoProviderDescription({ description, name: "Okta" }),
      ).toBe(true);
    }
  });

  test("the description the name gives is the form's own", () => {
    expect(
      isDefaultSsoProviderDescription({
        description: "Sign in with Okta",
        name: "Okta",
      }),
    ).toBe(true);

    // Spaces around either side do not make it somebody's own.
    expect(
      isDefaultSsoProviderDescription({
        description: " Sign in with Okta ",
        name: " Okta",
      }),
    ).toBe(true);
  });

  test("a description somebody wrote is theirs", () => {
    expect(
      isDefaultSsoProviderDescription({
        description: "Company sign-in (staff only)",
        name: "Okta",
      }),
    ).toBe(false);

    // The old placeholder, typed in as it was, is somebody's own too.
    expect(
      isDefaultSsoProviderDescription({
        description: "Sign in with Okta via OpenID Connect",
        name: "Okta",
      }),
    ).toBe(false);
  });

  test("another name's description is not this name's", () => {
    expect(
      isDefaultSsoProviderDescription({
        description: "Sign in with Okta",
        name: "Auth0",
      }),
    ).toBe(false);

    // Case matters: "sign in with okta" was typed by somebody.
    expect(
      isDefaultSsoProviderDescription({
        description: "sign in with okta",
        name: "Okta",
      }),
    ).toBe(false);
  });

  test("a description with no name to give one is somebody's own", () => {
    expect(
      isDefaultSsoProviderDescription({
        description: "Sign in with",
        name: "",
      }),
    ).toBe(false);
  });
});

describe("fillSsoProviderDescription", () => {
  test("gives a provider created without a description its name's", () => {
    const provider: SsoProviderDescriptionFields = { name: "Okta" };

    fillSsoProviderDescription(provider);

    expect(provider.description).toBe("Sign in with Okta");
  });

  test.each(["", "   "])(
    "treats a blank description (%p) as none",
    (description: string) => {
      const provider: SsoProviderDescriptionFields = {
        name: "Okta",
        description,
      };

      fillSsoProviderDescription(provider);

      expect(provider.description).toBe("Sign in with Okta");
    },
  );

  test("keeps the description the caller sent", () => {
    const provider: SsoProviderDescriptionFields = {
      name: "Okta",
      description: "Staff only",
    };

    fillSsoProviderDescription(provider);

    expect(provider).toEqual({ name: "Okta", description: "Staff only" });
  });

  test("leaves a provider with no name alone, for the required-field check to name it", () => {
    const provider: SsoProviderDescriptionFields = {};

    fillSsoProviderDescription(provider);

    expect(provider).toEqual({});

    const blankName: SsoProviderDescriptionFields = { name: "  " };

    fillSsoProviderDescription(blankName);

    expect(blankName.description).toBeUndefined();
  });
});
