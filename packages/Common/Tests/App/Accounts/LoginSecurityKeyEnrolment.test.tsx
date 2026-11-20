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
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import LoginUtil from "../../../UI/Utils/Login";
import { Logger } from "../../../UI/Utils/Logger";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import WebAuthn from "../../../UI/Utils/WebAuthn";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import {
  getSecondStepEnrolmentChoices,
  SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE,
  SecondStepEnrolmentChoice,
  VERIFY_SECURITY_KEY_ENROLMENT_ROUTE,
} from "../../../Types/Accounts/SecondStepEnrolment";

/*
 * A SECURITY KEY AT SIGN-IN (issue #9764).
 *
 * An account required to use two-factor authentication with nothing set up
 * is walked through setting up a second step when it signs in. The page now
 * offers the choice the profile offers - an authenticator app or a security
 * key - wherever the browser can register a key, and goes straight to the
 * app where it cannot, as before.
 *
 * This renders the real sign-in page with the Accounts app's translations,
 * signs in with a password, and holds the security key's way to: the options
 * asked for with the password again (there is no session yet), the browser's
 * prompt answered with them, the key's answer sent with the password again,
 * the backup codes shown once, and only then a session. A prompt the person
 * closed, a key already registered, or a refusal from the server says so and
 * signs nobody in. "Choose another way" goes back to the choice.
 */

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return (
    jest.requireActual(
      "./SignInMethodsStandIn",
    ) as typeof import("./SignInMethodsStandIn")
  ).signInMethodsNotRequired();
});

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";

const USER_ID: string = "97640000-0000-4000-8000-000000000001";
const USER_EMAIL: string = "grace@example.com";
const TOTP_ID: string = "97640000-0000-4000-8000-000000000002";
const PASSWORD: string = "correct-horse-battery";

/*
 * The password as the sign-in form sends it, and every second step sends it
 * again: the form's value, unhashed, in its JSON shape.
 */
const SUBMITTED_PASSWORD: JSONObject = {
  _type: "HashedString",
  value: PASSWORD,
};

const OTP_URL: string =
  "otpauth://totp/OneUptime:grace%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";

const ENROLMENT: typeof english.login.twoFactorEnrolment =
  english.login.twoFactorEnrolment;

// What the server sends for the browser's prompt.
const REGISTRATION_OPTIONS: JSONObject = {
  challenge: "Y2hhbGxlbmdl",
  rp: { name: "OneUptime", id: "localhost" },
  user: { id: "dXNlcg", name: USER_EMAIL, displayName: "Grace Hopper" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [],
};

// What the browser's prompt answers with.
const CREDENTIAL: JSONObject = {
  id: "credential-id",
  rawId: "credential-id",
  type: "public-key",
  response: { attestationObject: "attestation", clientDataJSON: "client" },
};

type PostedRequest = { url: string; data: JSONObject };

let posted: Array<PostedRequest> = [];
let loginCalls: Array<JSONObject> = [];
let verifyAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let optionsAnswer: HTTPResponse<JSONObject> | HTTPErrorResponse;
let registerSpy: SpyInstance<typeof WebAuthn.register>;

const setupUser: () => UserEvent = (): UserEvent => {
  return userEvent.setup({ delay: null });
};

// Signs in with a password, and stops on the screen that answers it.
const signIn: (submitText?: string) => Promise<void> = async (
  submitText: string = english.login.submitButton,
): Promise<void> => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("email"), USER_EMAIL);
  await user.type(screen.getByTestId("password"), PASSWORD);

  await act(async () => {
    await user.click(screen.getByTestId(submitText));
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

const choose: (title: string) => Promise<void> = async (
  title: string,
): Promise<void> => {
  fireEvent.click(screen.getByRole("radio", { name: new RegExp(title) }));
  await flush();
  fireEvent.click(screen.getByTestId("enrolment-choice-continue"));
  await flush();
};

const registerKey: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("enrolment-security-key"));
  });
  await flush();
};

const postsTo: (route: string) => Array<PostedRequest> = (
  route: string,
): Array<PostedRequest> => {
  return posted.filter((request: PostedRequest): boolean => {
    return request.url.endsWith(route);
  });
};

beforeEach(async () => {
  posted = [];
  loginCalls = [];

  optionsAnswer = new HTTPResponse<JSONObject>(
    200,
    { options: REGISTRATION_OPTIONS },
    {},
  );
  verifyAnswer = new HTTPResponse<JSONObject>(
    200,
    {
      _id: USER_ID,
      email: USER_EMAIL,
      name: "Grace Hopper",
      _miscData: {
        token: "session-token",
        backupCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"],
      },
    },
    {},
  );

  await i18n.changeLanguage("en");

  jest.spyOn(Logger, "error").mockImplementation(() => {});
  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation((value: JSONObject) => {
    loginCalls.push(value);
  });

  // This browser can register a key: a secure page with WebAuthn.
  jest.spyOn(WebAuthn, "isSupported").mockReturnValue(true);
  registerSpy = jest
    .spyOn(WebAuthn, "register")
    .mockResolvedValue(CREDENTIAL as never);

  // /login: the password is right, and two-factor auth must be set up first.
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(
          200,
          { _id: USER_ID, email: USER_EMAIL, name: "Grace Hopper" },
          {},
        );

      response.miscData = {
        twoFactorEnrolmentRequired: true,
        twoFactorAuthId: TOTP_ID,
        twoFactorOtpUrl: OTP_URL,
      };

      return response;
    });

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url?: { toString: () => string } | undefined;
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";

        posted.push({ url: url, data: (options.data as JSONObject) || {} });

        if (url.endsWith(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE)) {
          return optionsAnswer;
        }

        if (url.endsWith(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE)) {
          return verifyAnswer;
        }

        return new HTTPErrorResponse(500, { message: "Not here." }, {});
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("what the page offers", () => {
  test("only the authenticator app where the browser cannot register a key", () => {
    expect(getSecondStepEnrolmentChoices(false)).toEqual([
      SecondStepEnrolmentChoice.AuthenticatorApp,
    ]);
    expect(getSecondStepEnrolmentChoices(true)).toEqual([
      SecondStepEnrolmentChoice.AuthenticatorApp,
      SecondStepEnrolmentChoice.SecurityKey,
    ]);
  });

  test("a choice of an authenticator app or a security key, the app picked first", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);

    expect(screen.getByText(ENROLMENT.title)).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: new RegExp(ENROLMENT.authenticatorApp),
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: new RegExp(ENROLMENT.securityKey) }),
    ).not.toBeChecked();
    expect(screen.getByText(ENROLMENT.securityKeyDescription)).toBeVisible();

    // Nothing about either is shown, and nothing is asked, until one is chosen.
    expect(screen.queryByTestId("enrolment-code")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("enrolment-security-key"),
    ).not.toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  test("straight to the authenticator app where the browser cannot register a key, as before", async () => {
    jest.spyOn(WebAuthn, "isSupported").mockReturnValue(false);

    await signIn();
    await screen.findByText(ENROLMENT.scanInstruction);

    expect(screen.queryByText(ENROLMENT.chooseInstruction)).toBeNull();
    expect(screen.queryByTestId("enrolment-choose-another-way")).toBeNull();
    expect(await screen.findByTestId("enrolment-code")).toBeInTheDocument();
  });

  test("the authenticator app is the QR code and its code, with a way back to the choice", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);

    await choose(ENROLMENT.authenticatorApp);

    expect(screen.getByText(ENROLMENT.scanInstruction)).toBeInTheDocument();
    expect(await screen.findByTestId("enrolment-code")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("enrolment-choose-another-way"));
    await flush();

    expect(screen.getByText(ENROLMENT.chooseInstruction)).toBeInTheDocument();
  });
});

describe("setting up a security key", () => {
  test("asks for the options with the password again, then shows the browser's prompt", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);

    await choose(ENROLMENT.securityKey);

    expect(
      screen.getByText(ENROLMENT.securityKeyInstruction),
    ).toBeInTheDocument();
    expect(screen.getByTestId("enrolment-security-key")).toHaveTextContent(
      ENROLMENT.securityKeyButton,
    );

    // Choosing asks nothing yet.
    expect(postsTo(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE)).toEqual([]);

    await registerKey();

    expect(postsTo(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE)).toHaveLength(1);
    // The email and password the sign-in form sent /login, again.
    expect(postsTo(SECURITY_KEY_ENROLMENT_OPTIONS_ROUTE)[0]!.data).toEqual({
      data: { email: USER_EMAIL, password: SUBMITTED_PASSWORD },
    });
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0]![0]).toEqual(REGISTRATION_OPTIONS);
  });

  test("sends the key's answer with the password again, shows the backup codes once, and only then signs in", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);
    await registerKey();

    await waitFor(() => {
      expect(postsTo(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE)).toHaveLength(1);
    });

    expect(postsTo(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE)[0]!.data).toEqual({
      data: {
        email: USER_EMAIL,
        password: SUBMITTED_PASSWORD,
        credential: CREDENTIAL,
      },
    });

    // The codes the server minted behind the key, shown before anything else.
    expect(await screen.findByTestId("backup-codes-list")).toHaveTextContent(
      "AAAAA-BBBBB",
    );
    expect(loginCalls).toEqual([]);

    fireEvent.click(screen.getByTestId("backup-codes-saved-checkbox"));
    fireEvent.click(screen.getByTestId("backup-codes-continue"));
    await flush();

    expect(loginCalls).toHaveLength(1);
  });

  test("an account that already had backup codes is signed in at once", async () => {
    verifyAnswer = new HTTPResponse<JSONObject>(
      200,
      {
        _id: USER_ID,
        email: USER_EMAIL,
        name: "Grace Hopper",
        _miscData: { token: "session-token", hasBackupCodes: true },
      },
      {},
    );

    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);
    await registerKey();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });
    expect(screen.queryByTestId("backup-codes-list")).toBeNull();
  });

  test.each([
    [
      "the person closed the prompt",
      "NotAllowedError",
      "securityKeyNotCompleted",
    ],
    ["the prompt timed out", "AbortError", "securityKeyNotCompleted"],
    [
      "the key is already registered",
      "InvalidStateError",
      "securityKeyAlreadyRegistered",
    ],
  ])(
    "when %s, it says so, sends nothing more and signs nobody in",
    async (_label: string, errorName: string, messageKey: string) => {
      registerSpy.mockRejectedValue(new DOMException("No.", errorName));

      await signIn();
      await screen.findByText(ENROLMENT.chooseInstruction);
      await choose(ENROLMENT.securityKey);
      await registerKey();

      expect(
        await screen.findByText(
          ENROLMENT[messageKey as keyof typeof ENROLMENT] as string,
        ),
      ).toBeInTheDocument();
      expect(postsTo(VERIFY_SECURITY_KEY_ENROLMENT_ROUTE)).toEqual([]);
      expect(loginCalls).toEqual([]);

      // And it can be tried again.
      expect(screen.getByTestId("enrolment-security-key")).toBeEnabled();
    },
  );

  test("the server's refusal is said, and signs nobody in", async () => {
    verifyAnswer = new HTTPErrorResponse(
      400,
      { message: "Registration verification failed" },
      {},
    );

    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);
    await registerKey();

    expect(
      await screen.findByText(/Registration verification failed/),
    ).toBeInTheDocument();
    expect(loginCalls).toEqual([]);
  });

  test("a refusal of the options is said, and the prompt never opens", async () => {
    optionsAnswer = new HTTPErrorResponse(
      400,
      {
        message:
          "Two factor authentication is already set up for this account.",
      },
      {},
    );

    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);
    await registerKey();

    expect(
      await screen.findByText(/already set up for this account/),
    ).toBeInTheDocument();
    expect(registerSpy).not.toHaveBeenCalled();
    expect(loginCalls).toEqual([]);
  });

  test("Choose another way goes back to the choice, and the app still works from there", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);

    fireEvent.click(screen.getByTestId("enrolment-choose-another-way"));
    await flush();

    expect(screen.getByText(ENROLMENT.chooseInstruction)).toBeInTheDocument();
    expect(screen.queryByTestId("enrolment-security-key")).toBeNull();

    await choose(ENROLMENT.authenticatorApp);

    expect(await screen.findByTestId("enrolment-code")).toBeInTheDocument();
  });

  test("Sign in as a different user leaves the setup and forgets the password", async () => {
    await signIn();
    await screen.findByText(ENROLMENT.chooseInstruction);
    await choose(ENROLMENT.securityKey);

    fireEvent.click(screen.getByText(ENROLMENT.backToSignIn));
    await flush();

    expect(screen.queryByText(ENROLMENT.chooseInstruction)).toBeNull();
    expect(screen.queryByTestId("enrolment-security-key")).toBeNull();
    expect(await screen.findByTestId("email")).toBeInTheDocument();
  });
});

describe("in the reader's language", () => {
  test("German reads the choice and the security key's words from de.json", async () => {
    await i18n.changeLanguage("de");

    await signIn(german.login.submitButton);
    await screen.findByText(german.login.twoFactorEnrolment.chooseInstruction);

    expect(
      screen.getByText(german.login.twoFactorEnrolment.securityKeyDescription),
    ).toBeVisible();

    await choose(german.login.twoFactorEnrolment.securityKey);

    expect(
      screen.getByText(german.login.twoFactorEnrolment.securityKeyInstruction),
    ).toBeInTheDocument();
    expect(screen.getByTestId("enrolment-security-key")).toHaveTextContent(
      german.login.twoFactorEnrolment.securityKeyButton,
    );
    // The instruction names the button as the button reads.
    expect(german.login.twoFactorEnrolment.securityKeyInstruction).toContain(
      german.login.twoFactorEnrolment.securityKeyButton,
    );
  });

  test("every Accounts language has every new word, and the instruction names its button", () => {
    const localesDir: string = path.join(
      __dirname,
      "../../../../App/FeatureSet/Accounts/src/Locales",
    );

    for (const file of fs.readdirSync(localesDir)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const words: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      ).login.twoFactorEnrolment;

      for (const key of Object.keys(ENROLMENT)) {
        expect([file, key, typeof words[key]]).toEqual([file, key, "string"]);
      }

      expect([file, words["securityKeyInstruction"]]).toEqual([
        file,
        expect.stringContaining(words["securityKeyButton"]!),
      ]);
    }
  });
});
