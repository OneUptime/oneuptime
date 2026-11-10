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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import QRCode from "qrcode";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import LoginUtil from "../../../UI/Utils/Login";
import { Logger } from "../../../UI/Utils/Logger";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";

/*
 * OneUptime issue #6638 - "Two factor auth crashes".
 *
 * An administrator required two-factor authentication. Someone removed
 * their authenticator, so their next sign-in sent them through setting one
 * up again - by design: deleting the last factor is meant to cost a QR code,
 * not the account (UserTotpAuthService). But the QR code read "L.toDataURL is
 * not a function": the qrcode library reached the page without its exports
 * (QRCodeImage.ts says why), and the screen had nothing else to offer. They
 * could not set up two-factor authentication, so they could not sign in.
 *
 * This file renders the real sign-in page with the Accounts app's own
 * translations, signs in with a password the way a person does, and holds the
 * setup screen to: a QR code that is drawn, the setup key under it for anyone
 * who cannot scan, the key in place of a code that cannot be drawn, and a way
 * to finish signing in either way.
 *
 * QRCodeImage is the real one, except where a test makes it fail as it did.
 */

const mockQRCodeImage: { shouldFail: boolean } = { shouldFail: false };

jest.mock("../../../UI/Components/QR/QRCodeImage", () => {
  const actual: { default: (text: string) => Promise<string> } =
    jest.requireActual("../../../UI/Components/QR/QRCodeImage") as {
      default: (text: string) => Promise<string>;
    };

  return {
    __esModule: true,
    default: (text: string): Promise<string> => {
      if (mockQRCodeImage.shouldFail) {
        return Promise.reject(new TypeError("L.toDataURL is not a function"));
      }

      return actual.default(text);
    },
  };
});

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

type LocaleWords = Record<string, string>;

const ENGLISH: LocaleWords = english as unknown as LocaleWords;
const GERMAN: LocaleWords = german as unknown as LocaleWords;

const USER_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL: string = "ada@analytical-engine.example.com";
const TOTP_ID: string = "11111111-1111-4111-8111-111111111111";
const PASSWORD: string = "correct-horse-battery";

// What /login answers for an account required to set up two-factor auth.
const OTP_URL: string =
  "otpauth://totp/OneUptime:ada%40analytical-engine.example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";
const KEY: string = "MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ";

const IMAGE_PREFIX: string = "data:image/svg+xml;charset=utf-8,";

// Straight out of en.json, so a key that is not there fails here.
const CANT_SCAN: string = ENGLISH["Can't scan the QR code?"] as string;
const ENTER_KEY: string = ENGLISH[
  "Enter this setup key in your authenticator app instead."
] as string;
const TIME_BASED: string = ENGLISH[
  "If your app asks, choose a time-based key."
] as string;
const QR_FAILED: string = ENGLISH["The QR code could not be shown."] as string;
const QR_CODE: string = ENGLISH["QR code"] as string;

type PostedRequest = { url: string; data: JSONObject };

let posted: Array<PostedRequest> = [];
let loginCalls: Array<JSONObject> = [];

const setupUser: () => UserEvent = (): UserEvent => {
  return userEvent.setup({ delay: null });
};

const renderPage: () => void = (): void => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
};

// Signs in with a password, and stops on the screen that answers it.
const startSetup: () => Promise<void> = async (): Promise<void> => {
  renderPage();

  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("email"), USER_EMAIL);
  await user.type(screen.getByTestId("password"), PASSWORD);

  await act(async () => {
    await user.click(screen.getByTestId("Sign in"));
  });

  await screen.findByText(english.login.twoFactorEnrolment.title);
};

// The same sign-in, read in German: the page's words come from de.json.
const startSetupInGerman: () => Promise<void> = async (): Promise<void> => {
  renderPage();

  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("email"), USER_EMAIL);
  await user.type(screen.getByTestId("password"), PASSWORD);

  await act(async () => {
    await user.click(screen.getByTestId(german.login.submitButton));
  });

  await screen.findByText(german.login.twoFactorEnrolment.title);
};

// The QR code, once it is drawn or has failed.
const settleCode: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(
      screen.queryByTestId("qr-code") || screen.queryByTestId("qr-code-failed"),
    ).toBeInTheDocument();
  });
};

const shownKey: () => string = (): string => {
  return screen.getByTestId("authenticator-setup-key").textContent || "";
};

const submitCode: () => Promise<void> = async (): Promise<void> => {
  const user: UserEvent = setupUser();

  await user.type(await screen.findByTestId("enrolment-code"), "123456");

  await act(async () => {
    await user.click(
      screen.getByTestId(english.login.twoFactorEnrolment.submitButton),
    );
  });
};

const originalClipboard: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(async () => {
  mockQRCodeImage.shouldFail = false;
  posted = [];
  loginCalls = [];

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

  // /login: the password is right, and two-factor auth must be set up first.
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(
          200,
          { _id: USER_ID, email: USER_EMAIL, name: "Ada Lovelace" },
          {},
        );

      response.miscData = {
        twoFactorEnrolmentRequired: true,
        twoFactorAuthId: TOTP_ID,
        twoFactorOtpUrl: OTP_URL,
      };

      return response;
    });

  // /verify-totp-enrolment: the code verifies; the account has backup codes.
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (options: {
        url?: { toString: () => string } | undefined;
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject>> => {
        posted.push({
          url: options.url?.toString() || "",
          data: (options.data as JSONObject) || {},
        });

        return new HTTPResponse<JSONObject>(
          200,
          {
            _id: USER_ID,
            email: USER_EMAIL,
            name: "Ada Lovelace",
            _miscData: { token: "session-token", hasBackupCodes: true },
          },
          {},
        );
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();

  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  }

  await i18n.changeLanguage("en");
});

describe("setting up two-factor authentication to sign in", () => {
  test("draws the QR code of the enrolment the server sent", async () => {
    await startSetup();
    await settleCode();

    const image: HTMLElement = screen.getByRole("img", { name: QR_CODE });
    const src: string = image.getAttribute("src") || "";

    expect(src.startsWith(IMAGE_PREFIX)).toBe(true);
    expect(decodeURIComponent(src.slice(IMAGE_PREFIX.length))).toBe(
      await QRCode.toString(OTP_URL, { type: "svg" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("offers the setup key under the code, for anyone who cannot scan it", async () => {
    await startSetup();
    await settleCode();

    const toggle: HTMLElement = screen.getByRole("button", {
      name: CANT_SCAN,
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("authenticator-setup-key-panel"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    const panel: HTMLElement = screen.getByTestId(
      "authenticator-setup-key-panel",
    );

    expect(within(panel).getByText(ENTER_KEY)).toBeInTheDocument();
    expect(within(panel).getByText(TIME_BASED)).toBeInTheDocument();
    expect(shownKey()).toBe(KEY);
  });

  test("copies the key whole, to paste into the authenticator app", async () => {
    await startSetup();
    await settleCode();
    fireEvent.click(screen.getByRole("button", { name: CANT_SCAN }));

    /*
     * Installed after the sign-in was typed in: user-event puts a clipboard
     * of its own on the navigator when it is set up.
     */
    const writeText: ReturnType<
      typeof jest.fn<(text: string) => Promise<void>>
    > = jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: ENGLISH["Copy"] as string }),
      );
    });

    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(
      screen.getByRole("button", { name: ENGLISH["Copy"] as string }),
    ).toHaveTextContent(ENGLISH["Copied!"] as string);
  });

  test("shows the key in place of a QR code that cannot be drawn, and never the script's error", async () => {
    mockQRCodeImage.shouldFail = true;

    await startSetup();
    await settleCode();

    expect(screen.getByRole("alert")).toHaveTextContent(QR_FAILED);
    expect(screen.queryByText(/toDataURL/)).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("authenticator-setup-key-panel")).getByText(
        ENTER_KEY,
      ),
    ).toBeInTheDocument();
    expect(shownKey()).toBe(KEY);
  });

  test("finishes signing in with the key when the QR code could not be drawn: the reporter's way out", async () => {
    mockQRCodeImage.shouldFail = true;

    await startSetup();
    await settleCode();
    await submitCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toContain("/verify-totp-enrolment");
    expect(
      (posted[0]!.data["data"] as JSONObject | undefined) || {},
    ).toMatchObject({
      code: "123456",
      twoFactorAuthId: TOTP_ID,
      // No session yet: the credentials go again, as /login took them.
      email: USER_EMAIL,
      password: { value: PASSWORD },
    });
  });

  test("finishes signing in after scanning, as before", async () => {
    await startSetup();
    await settleCode();
    await submitCode();

    await waitFor(() => {
      expect(loginCalls).toHaveLength(1);
    });

    expect(posted[0]!.url).toContain("/verify-totp-enrolment");
  });

  test("keeps the way back to signing in as somebody else", async () => {
    await startSetup();
    await settleCode();

    fireEvent.click(
      screen.getByText(english.login.twoFactorEnrolment.backToSignIn),
    );

    expect(await screen.findByTestId("email")).toBeInTheDocument();
    expect(
      screen.queryByTestId("authenticator-setup-key-toggle"),
    ).not.toBeInTheDocument();
  });

  test("speaks the reader's language: the key's words are German on a German page", async () => {
    await act(async () => {
      await i18n.changeLanguage("de");
    });

    await startSetupInGerman();
    await settleCode();

    fireEvent.click(
      screen.getByRole("button", {
        name: GERMAN["Can't scan the QR code?"] as string,
      }),
    );

    const panel: HTMLElement = screen.getByTestId(
      "authenticator-setup-key-panel",
    );

    expect(
      within(panel).getByText(
        GERMAN[
          "Enter this setup key in your authenticator app instead."
        ] as string,
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        GERMAN["If your app asks, choose a time-based key."] as string,
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: GERMAN["Copy"] as string }),
    ).toBeInTheDocument();
    expect(GERMAN["Can't scan the QR code?"]).not.toBe(CANT_SCAN);
  });
});
