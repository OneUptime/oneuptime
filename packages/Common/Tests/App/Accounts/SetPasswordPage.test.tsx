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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import fs from "fs";
import path from "path";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { SET_PASSWORD_LINK_EXPIRY_DAYS } from "../../../Types/Accounts/SetPasswordLink";
import { RESET_LINK_MESSAGES } from "../../../Types/Accounts/SignInMessages";
import { PASSWORD_RULE_MESSAGES } from "../../../Types/Password";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import ResetPasswordPage from "../../../../App/FeatureSet/Accounts/src/Pages/ResetPassword";

/*
 * The Set Password page (#9139): where the "Set your password" email lands,
 * /accounts/set-password/<token>, for an account a master admin created in
 * the Admin Dashboard (Common/Types/Accounts/SetPasswordLink). It is the
 * reset page - the same rule and checklist, the same request with the same
 * token - in words for a first password. A dead link is replaced by whoever
 * created the account, never from Forgot password, which refuses an account
 * that has no password.
 */

const TOKEN: string = "5c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e";
const STRONG_PASSWORD: string = "violet river lantern";

type Answer = () => Promise<ModelAPIHttpResponse<User>>;

let answer: Answer;
let createOrUpdate: SpyInstance<typeof ModelAPI.createOrUpdate>;

const succeed: Answer = async (): Promise<ModelAPIHttpResponse<User>> => {
  return new ModelAPIHttpResponse<User>(200, {}, {});
};

const refuseWith: (message: string) => Answer = (message: string): Answer => {
  return async (): Promise<ModelAPIHttpResponse<User>> => {
    throw new HTTPErrorResponse(400, { message: message }, {});
  };
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }
  });
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <ResetPasswordPage isSettingFirstPassword={true} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(document.querySelectorAll("input[type='password']")).toHaveLength(2);
  });
};

const typePasswords: (password: string) => void = (password: string): void => {
  const [passwordInput, confirmationInput] = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type='password']"),
  );

  fireEvent.change(passwordInput!, { target: { value: password } });
  fireEvent.change(confirmationInput!, { target: { value: password } });
};

const submit: (buttonName?: string) => Promise<void> = async (
  buttonName: string = "Set Password",
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });
  await settle();
};

describe("Set Password", () => {
  beforeEach(() => {
    answer = succeed;

    jest.spyOn(SensitiveUrlToken, "read").mockImplementation((): string => {
      return TOKEN;
    });
    jest.spyOn(SensitiveUrlToken, "clear").mockImplementation(() => {});

    createOrUpdate = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        return await answer();
      }) as unknown as SpyInstance<typeof ModelAPI.createOrUpdate>;
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();

    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  test("asks for a first password, in words for one", async () => {
    await renderPage();

    expect(screen.getByText("Set your password")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a password to finish setting up your account."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set Password" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reset your password")).not.toBeInTheDocument();
  });

  test("holds the password to the one rule before anything is sent", async () => {
    await renderPage();

    typePasswords("abc123");
    await submit();

    expect(createOrUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId("password-requirements")).toHaveTextContent(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
  });

  test("sends the link's token with the password, as a reset does, and ends in Sign In", async () => {
    await renderPage();

    typePasswords(STRONG_PASSWORD);
    await submit();

    expect(createOrUpdate).toHaveBeenCalledTimes(1);

    const sent: unknown = (createOrUpdate.mock.calls[0]![0] as any).model;

    expect((sent as User).resetPasswordToken).toBe(TOKEN);
    expect(SensitiveUrlToken.clear).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your password is set",
    );
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href",
      "/accounts/login",
    );
  });

  test("an expired link says who sends a new one, and offers no Forgot password", async () => {
    answer = refuseWith(RESET_LINK_MESSAGES.expired);

    await renderPage();
    typePasswords(STRONG_PASSWORD);
    await submit();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "This link has expired",
    );
    expect(
      screen.getByText(
        `Links to set a password work for ${SET_PASSWORD_LINK_EXPIRY_DAYS} days. Ask the administrator who created your account to send you a new one.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Request a New Link" }),
    ).not.toBeInTheDocument();
    expect(SensitiveUrlToken.clear).not.toHaveBeenCalled();
  });

  test("a used link leads to signing in, since it most likely set the password", async () => {
    answer = refuseWith(RESET_LINK_MESSAGES.invalid);

    await renderPage();
    typePasswords(STRONG_PASSWORD);
    await submit();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "This link no longer works",
    );
    expect(screen.getByTestId("set-password-sign-in")).toHaveAttribute(
      "href",
      "/accounts/login",
    );
    expect(
      screen.queryByRole("link", { name: "Request a New Link" }),
    ).not.toBeInTheDocument();
  });

  test("speaks the reader's language", async () => {
    await i18n.changeLanguage("de");
    await renderPage();

    expect(
      screen.getByRole("button", { name: "Passwort festlegen" }),
    ).toBeInTheDocument();
  });
});

describe("the set-password page's words, in every Accounts language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Accounts/src/Locales",
  );
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
  )["setPassword"];

  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    });

  test("there are languages to check", () => {
    expect(locales.length).toBeGreaterThanOrEqual(17);
  });

  test.each(locales)("%s words every one, in its own words", (file: string) => {
    const words: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    )["setPassword"];

    expect(Object.keys(words).sort()).toEqual(Object.keys(english).sort());

    for (const key of Object.keys(english)) {
      expect(words[key]).toBeTruthy();
      expect(words[key]).not.toBe(english[key]);
    }

    expect(words["linkExpiredDescription"]).toContain("{{days}}");
  });
});

describe("the route", () => {
  test("Accounts serves the page at /accounts/set-password, with and without the token", () => {
    const app: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Accounts/src/App.tsx",
      ),
      "utf8",
    );

    expect(app).toContain('path="/accounts/set-password"');
    expect(app).toContain('path="/accounts/set-password/:token"');
    expect(app).toContain(
      "<ResetPasswordPage isSettingFirstPassword={true} />",
    );
  });

  test("its token leaves the address bar like a reset link's", () => {
    expect(
      SensitiveUrlToken.readFromPath(`/accounts/set-password/${TOKEN}`),
    ).toBe(TOKEN);
    expect(SensitiveUrlToken.readFromPath("/accounts/set-password")).toBe("");
  });
});
