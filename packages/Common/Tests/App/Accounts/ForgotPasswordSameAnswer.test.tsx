import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ForgotPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ForgotPassword";

/*
 * FORGOT PASSWORD SAYS THE SAME TO EVERY ADDRESS (#9260).
 *
 * POST /identity/forgot-password answers every address with success: an
 * account with a password is emailed a reset link, one with no password yet
 * a set-password link, and an address with no account nothing. So the page,
 * once it is answered, must not claim a reset link went out - for an address
 * with no account, none did - nor say anything that tells the reader whether
 * the address has an account. It says a link went out IF an account uses
 * the address, in every language.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Accounts/src/Locales",
);

const ENGLISH_ANSWER: string =
  "If an account uses this email address, we have emailed it a link to choose a password. Please do not forget to check spam.";

let createOrUpdate: SpyInstance<typeof ModelAPI.createOrUpdate>;

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

async function askFor(email: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(document.querySelector("input[type='email']")).not.toBeNull();
  });

  fireEvent.change(document.querySelector("input[type='email']")!, {
    target: { value: email },
  });

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Send Password Reset Link" }),
    );
  });
  await settle();
}

describe("Forgot password, once answered", () => {
  beforeEach(() => {
    jest
      .spyOn(GlobalConfigUtil, "fetchVars")
      .mockImplementation(async (): Promise<GlobalConfigVars> => {
        return {
          disableUserProjectCreation: false,
          disablePushNotifications: false,
          canSendEmail: true,
          canProjectsChooseCallVoice: false,
        };
      });

    createOrUpdate = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        return new ModelAPIHttpResponse<User>(200, {}, {});
      }) as unknown as SpyInstance<typeof ModelAPI.createOrUpdate>;
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  test.each([
    ["an account with a password", "owner@example.com"],
    ["an account with no password yet", "created.by.admin@example.com"],
    ["an address with no account", "nobody@example.com"],
  ])(
    "%s: says a link went out if an account uses the address",
    async (_kind: string, email: string) => {
      await askFor(email);

      expect(createOrUpdate).toHaveBeenCalledTimes(1);
      expect(screen.getByText(ENGLISH_ANSWER)).toBeInTheDocument();
      expect(screen.queryByTestId("forgot-password-card")).toBeNull();
      // Never the address itself, nor whether it has an account.
      expect(document.body.textContent).not.toContain(email);
      expect(document.body.textContent).not.toMatch(
        /no user|not registered|sign up for a new account/i,
      );
    },
  );

  test("never says a reset link was sent, which would be untrue for an address with no account", async () => {
    await askFor("nobody@example.com");

    expect(document.body.textContent).not.toMatch(
      /emailed you the password reset link/i,
    );
  });

  test("speaks the reader's language", async () => {
    await i18n.changeLanguage("de");
    await act(async () => {
      render(
        <MemoryRouter>
          <ForgotPasswordPage />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(document.querySelector("input[type='email']")).not.toBeNull();
    });

    fireEvent.change(document.querySelector("input[type='email']")!, {
      target: { value: "jemand@example.com" },
    });

    const german: Record<string, Record<string, string>> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: german["forgotPassword"]!["submitButton"]!,
        }),
      );
    });
    await settle();

    expect(
      screen.getByText(german["forgotPassword"]!["successMessage"]!),
    ).toBeInTheDocument();
  });
});

describe("the answer, in every Accounts language", () => {
  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    });

  test("the English is the one the page draws", () => {
    const english: Record<string, Record<string, string>> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
    );

    expect(english["forgotPassword"]!["successMessage"]).toBe(ENGLISH_ANSWER);
  });

  test("there are languages to check", () => {
    expect(locales.length).toBeGreaterThanOrEqual(17);
  });

  test.each(locales)("%s says it in its own words", (file: string) => {
    const words: Record<string, Record<string, string>> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );
    const answer: string | undefined = words["forgotPassword"]?.[
      "successMessage"
    ] as string | undefined;

    expect(answer).toBeTruthy();
    expect(answer).not.toBe(ENGLISH_ANSWER);
  });
});
