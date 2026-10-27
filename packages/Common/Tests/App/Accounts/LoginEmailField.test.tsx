import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";

/*
 * The sign-in form's Email field stays editable.
 *
 * It used to turn read-only whenever the page's `initialValues` held an
 * email. That state was meant for an address a link carried (?email=), but
 * every sign-in attempt also stores what it submitted there, for the
 * two-factor steps that send it again. So the first refused attempt locked
 * the address in place: somebody who had mistyped it could retype the
 * password as often as they liked, and only reloading the page let them fix
 * the address. A link's address, meanwhile, never reached the field at all:
 * it was locked, and empty.
 *
 * The page is rendered for real, with the real Accounts translations, and
 * the form is typed into as a person types; ModelAPI.createOrUpdate stands in
 * for /identity/login.
 */

/*
 * The server does not require single sign-on here, and says so at once: the
 * sign-in pages ask before they draw (SignInMethodsStandIn).
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

const MISTYPED_EMAIL: string = "ada@exmaple.com";
const EMAIL: string = "ada@example.com";
const PASSWORD: string = "correct-horse-battery";
const TOTP_ID: string = "11111111-1111-4111-8111-111111111111";

const USER_JSON: JSONObject = {
  _id: "33333333-3333-4333-8333-333333333333",
  email: EMAIL,
  name: "Ada Lovelace",
};

// What /identity/login answers, attempt by attempt.
type LoginAnswer = "refused" | "signedIn" | "needsCode";

let loginAnswers: Array<LoginAnswer> = [];
let linkedEmail: string | null = null;
let posted: Array<{ url: string; data: JSONObject }> = [];

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

const submit: (user: UserEvent) => Promise<void> = async (
  user: UserEvent,
): Promise<void> => {
  await act(async () => {
    await user.click(screen.getByTestId("Sign in"));
  });
};

// The address each /identity/login request carried, in order.
const submittedEmails: () => Array<string> = (): Array<string> => {
  return jest
    .mocked(ModelAPI.createOrUpdate)
    .mock.calls.map((call: Parameters<typeof ModelAPI.createOrUpdate>) => {
      return (call[0].model as User).email?.toString() || "";
    });
};

describe("The sign-in form's Email field stays editable", () => {
  beforeEach(() => {
    loginAnswers = [];
    linkedEmail = null;
    posted = [];

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((name: string): string | null => {
        return name === "email" ? linkedEmail : null;
      });
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});

    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const answer: LoginAnswer = loginAnswers.shift() || "signedIn";

        if (answer === "refused") {
          throw new Error("Invalid email or password.");
        }

        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData =
          answer === "needsCode"
            ? {
                totpAuthList: [{ _id: TOTP_ID, name: "Ada's phone" }],
                webAuthnList: [],
                backupCodeCount: 10,
              }
            : { token: "password-session" };
        return response;
      });

    // The two-factor step posts to /identity/verify-totp-auth directly.
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          posted.push({
            url: options.url?.toString() || "",
            data: ((options.data as JSONObject)["data"] as JSONObject) || {},
          });
          return new HTTPResponse<JSONObject>(
            200,
            { ...USER_JSON, _miscData: { token: "two-factor-session" } },
            {},
          );
        },
      );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("starts empty and editable", async () => {
    renderPage();

    const email: HTMLElement = await screen.findByTestId("email");
    expect(email).toHaveValue("");
    expect(email).toBeEnabled();
  });

  test("a refused sign-in leaves the address editable, and the corrected address is the one sent", async () => {
    loginAnswers = ["refused", "signedIn"];
    renderPage();
    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("email"), MISTYPED_EMAIL);
    await user.type(screen.getByTestId("password"), PASSWORD);
    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    const email: HTMLElement = screen.getByTestId("email");
    expect(email).toBeEnabled();
    expect(email).toHaveValue(MISTYPED_EMAIL);
    expect(LoginUtil.login).not.toHaveBeenCalled();

    await user.clear(email);
    await user.type(email, EMAIL);
    expect(email).toHaveValue(EMAIL);
    await submit(user);

    expect(submittedEmails()).toEqual([MISTYPED_EMAIL, EMAIL]);
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "password-session",
    });
  });

  test("stays editable after several refusals in a row", async () => {
    loginAnswers = ["refused", "refused", "refused"];
    renderPage();
    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("email"), MISTYPED_EMAIL);
    await user.type(screen.getByTestId("password"), PASSWORD);

    for (let attempt: number = 1; attempt <= 3; attempt++) {
      await submit(user);
      await waitFor(() => {
        expect(submittedEmails()).toHaveLength(attempt);
      });
      expect(screen.getByTestId("email")).toBeEnabled();
    }

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });

  /*
   * The two-factor step sends the email and password again, from what the
   * form last submitted - the corrected address, not the refused one.
   */
  test("after a correction, the two-factor step sends the corrected address", async () => {
    loginAnswers = ["refused", "needsCode"];
    renderPage();
    const user: UserEvent = setupUser();

    await user.type(await screen.findByTestId("email"), MISTYPED_EMAIL);
    await user.type(screen.getByTestId("password"), PASSWORD);
    await submit(user);
    await screen.findByRole("alert");

    await user.clear(screen.getByTestId("email"));
    await user.type(screen.getByTestId("email"), EMAIL);
    await submit(user);

    await screen.findByText("Two Factor Authentication");
    await user.click(screen.getByText("Authenticator App"));
    await user.type(await screen.findByTestId("code"), "123456");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    const verify: { url: string; data: JSONObject } | undefined = posted.find(
      (request: { url: string; data: JSONObject }) => {
        return request.url.endsWith("/verify-totp-auth");
      },
    );
    expect(verify?.data).toMatchObject({
      email: EMAIL,
      password: { _type: "HashedString", value: PASSWORD },
      code: "123456",
      twoFactorAuthId: TOTP_ID,
    });
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "two-factor-session",
    });
  });

  describe("an address a link carries (?email=)", () => {
    test("fills the field, which stays editable", async () => {
      linkedEmail = EMAIL;
      renderPage();

      const email: HTMLElement = await screen.findByTestId("email");
      await waitFor(() => {
        expect(email).toHaveValue(EMAIL);
      });
      expect(email).toBeEnabled();

      const user: UserEvent = setupUser();
      await user.clear(email);
      await user.type(email, "grace@example.com");
      expect(email).toHaveValue("grace@example.com");
    });

    test("is the address a sign-in sends when it is left as it is", async () => {
      linkedEmail = EMAIL;
      loginAnswers = ["signedIn"];
      renderPage();
      const user: UserEvent = setupUser();

      await waitFor(() => {
        expect(screen.getByTestId("email")).toHaveValue(EMAIL);
      });
      await user.type(screen.getByTestId("password"), PASSWORD);
      await submit(user);

      expect(submittedEmails()).toEqual([EMAIL]);
      expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    });
  });
});
