import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import MasterPasswordPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/MasterPassword";
import { getJestSpyOn } from "../../Spy";

/*
 * What a status page's password prompt says - the page a visitor of a
 * page shared as "Anyone with the password" sees first: the page's name as
 * its title, then what to do, once ("Enter the password to view this status
 * page."), then the field, named Password, and Unlock Status Page.
 *
 * It used to say "enter the password" four times over - "Enter <name>
 * Password" as the title, "Please enter the password to continue." under
 * it, "Enter the password to unlock this page." under the field, and "Enter
 * password" in the field - as a public dashboard's prompt did.
 *
 * Translations resolve against the StatusPage's real en.json; a missing key
 * renders as the key itself.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (key: string) => string = (key: string): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    return typeof node === "string" ? node : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);

const PROMPT: string = "Enter the password to view this status page.";

// "enter the password", "Enter password", in any case: the instruction.
const ENTER_PASSWORD: RegExp = /enter (the )?password/i;

// The keys the prompt no longer needs, gone from every language.
const RETIRED_KEYS: Array<string> = [
  "enterWithName",
  "enterGeneric",
  "passwordDescription",
  "passwordPlaceholder",
];

const readLocale: (file: string) => Record<string, any> = (
  file: string,
): Record<string, any> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, any>;
};

const renderPrompt: (statusPageName: string) => Promise<void> = async (
  statusPageName: string,
): Promise<void> => {
  await act(async () => {
    render(
      <MasterPasswordPage
        statusPageName={statusPageName}
        logoFileId={new ObjectID("")}
      />,
    );
  });
};

describe("a status page's password prompt", () => {
  beforeEach(() => {
    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      STATUS_PAGE_ID,
    );
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      true,
    );
    getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
      false,
    );
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(false);
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("its title is the page it opens", async () => {
    await renderPrompt("Acme Status");

    const title: HTMLElement = screen.getByTestId("master-password-title");

    expect(title).toHaveTextContent(/^Acme Status$/);
    expect(title.tagName).toBe("H2");
  });

  test("with no name to show, the title says it is a status page", async () => {
    await renderPrompt("");

    expect(screen.getByTestId("master-password-title")).toHaveTextContent(
      /^Status Page$/,
    );
  });

  test("it says what to do once, under the title", async () => {
    await renderPrompt("Acme Status");

    const prompt: HTMLElement = screen.getByTestId("master-password-prompt");

    expect(prompt).toHaveTextContent(PROMPT);
    expect(screen.getAllByText(ENTER_PASSWORD)).toEqual([prompt]);
  });

  test("the field is named Password, with no description and nothing typed in it", async () => {
    await renderPrompt("Acme Status");

    const field: HTMLElement = screen.getByLabelText("Password");

    expect(field).toHaveAttribute("type", "password");
    expect(field.getAttribute("placeholder") || "").toBe("");
    expect(
      screen.queryByText("Enter the password to unlock this page."),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Unlock Status Page" }),
    ).toBeInTheDocument();
  });

  test("no key of the prompt is shown as itself", async () => {
    await renderPrompt("Acme Status");

    expect(document.body.textContent || "").not.toContain("accounts.");
  });

  test("the sentence is translated in all 16 other languages, and the retired keys are gone from all 17", () => {
    const english: Record<string, any> = readLocale("en.json");

    expect(english["accounts"]["masterPassword"]["prompt"]).toBe(PROMPT);

    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const masterPassword: Record<string, unknown> =
        readLocale(file)["accounts"]["masterPassword"];

      for (const key of RETIRED_KEYS) {
        expect([file, key, key in masterPassword]).toEqual([file, key, false]);
      }

      const prompt: unknown = masterPassword["prompt"];

      expect([file, typeof prompt]).toEqual([file, "string"]);

      if (file !== "en.json") {
        expect([file, prompt]).not.toEqual([file, PROMPT]);
      }
    }
  });
});
