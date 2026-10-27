import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The sign-in page when the server makes a code wait.
 *
 * Wrong second-step codes are counted for the account (the server's
 * TwoFactorWrongCodes): after five in a row, each next code waits before it
 * is checked, and the code route answers 429 with what to do - how long to
 * wait, the backup code, and a password reset if the codes were not theirs.
 * The page decides none of that; what it must do is put the server's words
 * in front of the person, keep the way back in (the lost-access link) in
 * reach, and take the next code once they try again.
 *
 * The real page, the real Accounts translations, and the login form filled
 * in as a person fills it in, as LoginTwoFactorRecovery.test.tsx does; the
 * network is API.post and ModelAPI.createOrUpdate.
 */

import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";

/*
 * The server does not require single sign-on here, and says so at once: the
 * sign-in pages ask before they draw (SignInMethodsStandIn).
 */
jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return jest
    .requireActual<typeof import("./SignInMethodsStandIn")>(
      "./SignInMethodsStandIn",
    )
    .signInMethodsNotRequired();
});

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

// Registers the Accounts locale resources on the shared i18next instance.
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";

const USER_ID: string = "44444444-4444-4444-8444-444444444444";
const USER_EMAIL: string = "grace@example.com";
const TOTP_ID: string = "55555555-5555-4555-8555-555555555555";
const PASSWORD: string = "correct-horse-battery";

const LOST_ACCESS: string = "Lost access to your authenticator?";

// As the server words them (TwoFactorWrongCodes.getWaitingMessage).
const CODE_WAIT_MESSAGE: string =
  "Too many wrong codes have been entered for this account. Please wait 4 minutes before you try another code, or use a backup code. If you did not enter these codes, reset your password.";
const BACKUP_CODE_WAIT_MESSAGE: string =
  "Too many wrong backup codes have been entered for this account. Please wait 1 minute before you try another one. If you did not enter these codes, reset your password.";

type SecondStepAnswer = "waiting" | "signed-in";

let loginCalls: Array<JSONObject> = [];
let postedUrls: Array<string> = [];
let secondStepAnswer: SecondStepAnswer = "waiting";

function userJson(): JSONObject {
  return { _id: USER_ID, email: USER_EMAIL, name: "Grace Hopper" };
}

function setupUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

function installMocks(): void {
  try {
    window.localStorage.clear();
  } catch {
    // Nothing to clear is not a failure.
  }

  loginCalls = [];
  postedUrls = [];
  secondStepAnswer = "waiting";

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});

  jest.spyOn(LoginUtil, "login").mockImplementation((value: JSONObject) => {
    loginCalls.push(value);
  });

  // The password step: an account with an authenticator app and backup codes.
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, userJson(), {});

      response.miscData = {
        totpAuthList: [{ _id: TOTP_ID, name: "Grace's phone" }],
        webAuthnList: [],
        backupCodeCount: 8,
      };

      return response;
    });

  // The second steps: waiting, as the server answers it, or signed in.
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url?: { toString: () => string } | undefined;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";

        postedUrls.push(url);

        if (secondStepAnswer === "waiting") {
          const isBackupCode: boolean = url.endsWith("/verify-backup-code");

          return new HTTPErrorResponse(
            429,
            {
              message: isBackupCode
                ? BACKUP_CODE_WAIT_MESSAGE
                : CODE_WAIT_MESSAGE,
            },
            { "retry-after": isBackupCode ? "60" : "240" },
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          { ...userJson(), _miscData: { token: "session-token" } },
          {},
        );
      },
    );
}

async function signInWithPassword(): Promise<void> {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("email"), USER_EMAIL);
  await user.type(screen.getByTestId("password"), PASSWORD);

  await act(async () => {
    await user.click(screen.getByTestId("Login"));
  });

  await screen.findByText("Two Factor Authentication");
}

async function enterAuthenticatorCode(code: string): Promise<void> {
  const user: UserEvent = setupUser();

  if (!screen.queryByTestId("code")) {
    await user.click(screen.getByText("Authenticator App"));
  }

  const input: HTMLElement = await screen.findByTestId("code");

  await user.clear(input);
  await user.type(input, code);

  await act(async () => {
    await user.click(screen.getByTestId("Login"));
  });
}

describe("a code the server makes wait", () => {
  beforeEach(() => {
    installMocks();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the page shows the server's words: how long to wait, the backup code, and the password reset", async () => {
    await signInWithPassword();
    await enterAuthenticatorCode("123456");

    expect(await screen.findByText(CODE_WAIT_MESSAGE)).toBeInTheDocument();
    expect(loginCalls).toHaveLength(0);
  });

  test("the way back in stays on screen beside the wait", async () => {
    await signInWithPassword();
    await enterAuthenticatorCode("123456");

    await screen.findByText(CODE_WAIT_MESSAGE);

    expect(screen.getByText(LOST_ACCESS)).toBeInTheDocument();
  });

  test("the page takes the next code once the wait is over: the server, not the page, decides", async () => {
    await signInWithPassword();
    await enterAuthenticatorCode("123456");
    await screen.findByText(CODE_WAIT_MESSAGE);

    secondStepAnswer = "signed-in";
    await enterAuthenticatorCode("654321");

    expect(loginCalls).toHaveLength(1);
    expect(
      postedUrls.filter((url: string): boolean => {
        return url.endsWith("/verify-totp-auth");
      }),
    ).toHaveLength(2);
  });

  test("a backup code that waits says so in its own words", async () => {
    await signInWithPassword();

    const user: UserEvent = setupUser();

    await user.click(screen.getByText(LOST_ACCESS));
    await user.type(await screen.findByTestId("backup-code"), "abcde-fghij");

    await act(async () => {
      await user.click(screen.getByTestId("Login"));
    });

    expect(
      await screen.findByText(BACKUP_CODE_WAIT_MESSAGE),
    ).toBeInTheDocument();
    expect(loginCalls).toHaveLength(0);
    expect(
      postedUrls[postedUrls.length - 1]!.endsWith("/verify-backup-code"),
    ).toBe(true);
  });
});
