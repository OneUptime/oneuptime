import { SpyInstance } from "jest-mock";
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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import LoginUtil from "../../../UI/Utils/Login";
import UserUtil from "../../../UI/Utils/User";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import WebAuthnTestUtil, {
  authenticationOptions,
} from "../../Utils/WebAuthnTestUtil";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import { getSignInOptionClassName } from "../../../UI/Components/SignInOption/SignInOptionStyle";

// A filled button - what a primary button looks like, whatever its colour.
const FILLED_BUTTON_CLASS: RegExp = /\bbg-(indigo|red|green|yellow)-600\b/;

// The classes of a sign-in option in a state (SignInOptionStyle).
const optionClasses: (
  state: Parameters<typeof getSignInOptionClassName>[0],
) => Array<string> = (
  state: Parameters<typeof getSignInOptionClassName>[0],
): Array<string> => {
  return getSignInOptionClassName(state)
    .split(" ")
    .filter((name: string) => {
      return name.length > 0;
    });
};

// The menu the help names, as the Dashboard draws it.
const PASSKEY_MENU_PATH: string = "User Profile → Security → Passkeys";

const NOT_COMPLETED: string = english.login.passkey.notCompleted;
const CANCELLED: string = english.login.passkey.cancelled;

/*
 * These tests expect the SSO choice next to the password and passkey ones,
 * which the page offers in every edition. Pinned to the Community Edition
 * with billing off (CI's config.env sets BILLING_ENABLED=true), the
 * combination where an SSO link gated on the edition would disappear, so the
 * SSO assertions below double as a guard against that; LoginSso.test.tsx
 * covers every edition.
 */
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    BILLING_ENABLED: false,
    IS_ENTERPRISE_EDITION: false,
  };
});

jest.mock("../../../UI/Components/EditionLabel/EditionLabel", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

const USER_JSON: JSONObject = {
  _id: "33333333-3333-4333-8333-333333333333",
  email: "ada@example.com",
  name: "Ada Lovelace",
};
type PostedRequest = {
  url: string;
  data: Parameters<typeof API.post>[0]["data"];
};
let posted: Array<PostedRequest> = [];

const renderPage: () => void = (): void => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
};

const clickPasskey: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await userEvent.click(screen.getByTestId("passkey-login"));
  });
};

const cancelPrompt: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await userEvent.click(screen.getByTestId("cancel-passkey-login"));
  });
};

// Whether `later` comes after `earlier` in the document.
const comesAfter: (later: Element, earlier: Element) => boolean = (
  later: Element,
  earlier: Element,
): boolean => {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

const ssoLink: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("link", { name: english.login.signInWithSso });
};

// A pending promise and the function that settles it.
const pendingCredential: () => {
  settle: () => void;
  get: SpyInstance<typeof navigator.credentials.get>;
} = () => {
  let finish: ((value: Credential | null) => void) | undefined;
  const get: SpyInstance<typeof navigator.credentials.get> = jest
    .spyOn(navigator.credentials, "get")
    .mockImplementationOnce(() => {
      return new Promise<Credential | null>(
        (resolve: (value: Credential | null) => void) => {
          finish = resolve;
        },
      );
    });

  return {
    get,
    settle: (): void => {
      finish?.(WebAuthnTestUtil.credential());
    },
  };
};

describe("Passwordless passkey login", () => {
  beforeEach(() => {
    posted = [];
    WebAuthnTestUtil.install();
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url?.toString() || "";
          posted.push({ url: url, data: options.data });
          if (url.endsWith("/passkey-login-options")) {
            return new HTTPResponse<JSONObject>(
              200,
              { options: authenticationOptions },
              {},
            );
          }
          return new HTTPResponse<JSONObject>(
            200,
            { ...USER_JSON, _miscData: { token: "passkey-session" } },
            {},
          );
        },
      );
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  test("offers a passkey on the initial screen alongside password and SSO", async () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
    expect(await screen.findByTestId("email")).toHaveValue("");
    expect(screen.getByTestId("password")).toHaveValue("");
    expect(
      screen.getByRole("link", { name: "Sign in with SSO" }),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
  });

  describe("the page leads with the password form; the other ways in are buttons under it, the passkey last", () => {
    test("the email, the password and Login come first; then 'or', single sign-on, and the passkey, last", async () => {
      renderPage();
      const email: HTMLElement = await screen.findByTestId("email");
      const password: HTMLElement = screen.getByTestId("password");
      const signIn: HTMLElement = screen.getByTestId("Sign in");
      const divider: HTMLElement = screen.getByTestId(
        "sign-in-options-divider",
      );
      const passkey: HTMLElement = screen.getByTestId("passkey-login");

      expect(comesAfter(password, email)).toBe(true);
      expect(comesAfter(signIn, password)).toBe(true);
      expect(comesAfter(divider, signIn)).toBe(true);
      expect(divider).toHaveTextContent(/^or$/);
      expect(comesAfter(ssoLink(), divider)).toBe(true);
      expect(comesAfter(passkey, ssoLink())).toBe(true);

      // Nothing about passkeys is drawn above the form.
      const card: HTMLElement = screen.getByTestId("passkey-option")
        .parentElement as HTMLElement;
      const beforeForm: Array<Element> = Array.from(
        card.querySelectorAll("*"),
      ).filter((element: Element) => {
        return comesAfter(email, element) && !element.contains(email);
      });
      expect(
        beforeForm.some((element: Element) => {
          return (element.textContent || "").toLowerCase().includes("passkey");
        }),
      ).toBe(false);
    });

    /*
     * The page used to draw "Sign in with a passkey" and "Login" both filled,
     * then the passkey in a tinted panel over the form, then the passkey and
     * single sign-on as centred text links that read as small print. Login
     * is the page's one filled button; the passkey option is the same normal,
     * outlined, full-width button as single sign-on above it.
     */
    test("has one filled button, Login; the passkey option is the same outlined button as single sign-on", async () => {
      renderPage();
      await screen.findByTestId("email");

      const passkey: HTMLElement = screen.getByTestId("passkey-login");
      const signIn: HTMLElement = screen.getByTestId("Sign in");
      const filled: Array<HTMLElement> = screen
        .getAllByRole("button")
        .filter((button: HTMLElement) => {
          return FILLED_BUTTON_CLASS.test(button.className);
        });

      expect(signIn).toHaveClass("bg-indigo-600");
      expect(filled).toEqual([signIn]);

      expect(passkey).toHaveClass(...optionClasses("ready"));
      expect(new Set(Array.from(passkey.classList))).toEqual(
        new Set(Array.from(ssoLink().classList)),
      );
      expect(passkey).toHaveClass("w-full", "border", "bg-white");
      expect(passkey).not.toHaveClass("text-indigo-500");
      // The words under it - the prompt line, the notices - stay small.
      expect(screen.getByTestId("passkey-option")).toHaveClass("text-sm");
    });

    test("the passkey option draws a fingerprint, and a spinner while an attempt runs", async () => {
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      const passkey: HTMLElement = screen.getByTestId("passkey-login");

      expect(
        within(passkey).getByTestId("passkey-login-fingerprint"),
      ).toBeInTheDocument();
      expect(
        within(passkey).queryByTestId("passkey-login-spinner"),
      ).not.toBeInTheDocument();

      await clickPasskey();
      expect(within(passkey).getByTestId("passkey-login-spinner")).toHaveClass(
        "animate-spin",
      );
      expect(
        within(passkey).queryByTestId("passkey-login-fingerprint"),
      ).not.toBeInTheDocument();

      await act(async () => {
        prompt.settle();
      });
    });

    test("the tinted panel, its heading and description, and the divider over the form are gone", async () => {
      const { container } = render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>,
      );
      await screen.findByTestId("email");

      for (const retired of [
        "Use a saved passkey",
        "Use your fingerprint, face, or device PIN.",
        "or sign in with a password",
      ]) {
        expect(screen.queryByText(retired)).not.toBeInTheDocument();
      }
      expect(container.querySelector("#passkey-heading")).toBeNull();
      expect(container.querySelector("section")).toBeNull();
      expect(
        screen.getAllByRole("heading").map((heading: HTMLElement) => {
          return heading.textContent;
        }),
      ).toEqual(["Sign in to your account"]);
    });

    test("the subtitle leads with the password and ends with the passkey", async () => {
      renderPage();
      const subtitle: HTMLElement = await screen.findByText(
        "Use your password, your organization’s SSO, or a passkey.",
      );

      expect(subtitle.textContent!.indexOf("password")).toBeLessThan(
        subtitle.textContent!.indexOf("passkey"),
      );
      expect(subtitle).toHaveClass("text-balance");
      expect(
        screen.queryByText(
          "Use a passkey, password, or your organization’s SSO.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  test("signs in without email or password and uses normal user/token finalization", async () => {
    renderPage();
    await clickPasskey();
    expect(posted).toHaveLength(2);
    expect(posted[0]).toEqual({
      url: expect.stringContaining("/passkey-login-options"),
      data: {},
    });
    expect(posted[1]?.data).toEqual({
      credential: {
        id: "-_8A",
        rawId: "-_8A",
        type: "public-key",
        authenticatorAttachment: "platform",
        clientExtensionResults: { credProps: { rk: true } },
        response: {
          authenticatorData: "BAUG",
          clientDataJSON: "AQID",
          signature: "BwgJ",
          userHandle: "CgsM",
        },
      },
    });
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "passkey-session",
    });
    const call: JSONObject = (
      LoginUtil.login as jest.MockedFunction<typeof LoginUtil.login>
    ).mock.calls[0]![0] as unknown as JSONObject;
    expect((call["user"] as User).id?.toString()).toBe(USER_JSON["_id"]);
    expect(UiAnalytics.capture).toHaveBeenCalledWith("accounts/login");
  });

  /*
   * An account whose only way in is a passkey (no password it knows, no SSO)
   * still gets in from the quiet option: the form above it is never touched
   * and never submitted.
   */
  test("an account with only a passkey signs in from the option under the form without touching the form", async () => {
    jest.spyOn(ModelAPI, "createOrUpdate");
    renderPage();
    await clickPasskey();

    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    expect(ModelAPI.createOrUpdate).not.toHaveBeenCalled();
    expect(screen.getByTestId("email")).toHaveValue("");
    expect(screen.getByTestId("password")).toHaveValue("");
    expect(screen.queryByText("Email is required.")).not.toBeInTheDocument();
    expect(
      posted.map((request: PostedRequest) => {
        return request.url.slice(request.url.lastIndexOf("/"));
      }),
    ).toEqual(["/passkey-login-options", "/passkey-login"]);
  });

  test("keeps password fallback available after cancellation and supports a fresh retry", async () => {
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    get.mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    renderPage();
    await clickPasskey();
    expect(screen.getByText(NOT_COMPLETED)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try passkey again" }),
    ).toHaveFocus();
    expect(screen.getByTestId("password")).toBeEnabled();
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    await clickPasskey();
    expect(
      posted.filter((request: PostedRequest) => {
        return request.url.endsWith("/passkey-login-options");
      }),
    ).toHaveLength(2);
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
  });

  test("does not post a verification for a null credential", async () => {
    jest.spyOn(navigator.credentials, "get").mockResolvedValue(null);
    renderPage();
    await clickPasskey();
    expect(posted).toHaveLength(1);
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Passkey sign-in was canceled or timed out/),
    ).toBeInTheDocument();
  });

  describe("a browser that cannot use passkeys", () => {
    test("keeps the option, enabled, and says nothing about it until it is clicked", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      renderPage();
      expect(await screen.findByTestId("password")).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Sign in with a passkey" }),
      ).toBeEnabled();
      expect(
        screen.queryByText(english.login.passkey.unsupported),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(english.login.passkey.insecure),
      ).not.toBeInTheDocument();
      expect(posted).toHaveLength(0);
    });

    test("says why when the option is clicked, and asks the server for nothing", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
        navigator.credentials,
        "get",
      );
      renderPage();
      await clickPasskey();

      expect(screen.getByRole("status")).toHaveTextContent(
        english.login.passkey.unsupported,
      );
      expect(posted).toHaveLength(0);
      expect(get).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByTestId("password")).toBeEnabled();
      expect(screen.getByTestId("passkey-login")).toHaveFocus();
    });

    /*
     * Once the option has said it cannot work here, it stops looking like
     * something to click again: grey, no hover, and unavailable to a screen
     * reader. aria-disabled rather than disabled, so it keeps the focus it
     * had when it explained itself. Until then it looks like any other link.
     */
    test("is drawn as unavailable once it has explained itself, and not before", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      renderPage();
      const option: HTMLElement = screen.getByTestId("passkey-login");

      expect(option).not.toHaveAttribute("aria-disabled");
      expect(option).toHaveClass(...optionClasses("ready"));
      expect(option).not.toHaveClass("bg-gray-50");

      await clickPasskey();

      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).not.toBeDisabled();
      expect(option).toHaveFocus();
      expect(option).toHaveClass(...optionClasses("unavailable"));
      expect(option).toHaveClass(
        "bg-gray-50",
        "text-gray-500",
        "cursor-default",
      );
      expect(option).toHaveClass("focus-visible:ring-2");
      expect(option).not.toHaveClass("bg-white", "shadow-sm");
      expect(option.className).not.toContain("hover:");
      // Still the same box: as wide as Login and the option above it.
      expect(option).toHaveClass("w-full");
      expect(option).toHaveTextContent("Sign in with a passkey");
      expect(
        within(option).getByTestId("passkey-login-fingerprint"),
      ).toBeInTheDocument();

      // A second click changes nothing and asks the server for nothing.
      await clickPasskey();
      expect(screen.getAllByTestId("passkey-notice")).toHaveLength(1);
      expect(posted).toHaveLength(0);
    });

    /*
     * What an attempt said is cleared once the password form is used. What
     * the browser cannot do is not an attempt: it stays said, and the option
     * stays unavailable, however often the form is submitted. Cleared, the
     * option went back to looking like a link that works.
     */
    test("stays unavailable, with its reason, after the password form is used", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockRejectedValue(new Error("Invalid email or password."));
      renderPage();
      await clickPasskey();

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(await screen.findByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "wrong-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Invalid email or password.",
      );
      const option: HTMLElement = screen.getByTestId("passkey-login");
      expect(option).toHaveAttribute("aria-disabled", "true");
      expect(option).toHaveClass(...optionClasses("unavailable"));
      expect(option).not.toHaveClass("bg-white");
      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        english.login.passkey.unsupported,
      );
      expect(posted).toHaveLength(0);
    });

    test("a browser that can use passkeys never draws the option as unavailable", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage();
      await clickPasskey();

      const option: HTMLElement = screen.getByTestId("passkey-login");
      expect(screen.getByTestId("passkey-notice")).toBeInTheDocument();
      expect(option).not.toHaveAttribute("aria-disabled");
      expect(option).toHaveClass(...optionClasses("ready"));
      expect(option).not.toHaveClass("bg-gray-50");
      expect(option).toBeEnabled();
    });

    test("names HTTPS when the page is not served over a secure connection", async () => {
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: false,
      });
      renderPage();
      expect(
        screen.queryByText(english.login.passkey.insecure),
      ).not.toBeInTheDocument();
      await clickPasskey();

      expect(screen.getByRole("status")).toHaveTextContent(
        "Passkeys need a secure connection (HTTPS). You can still sign in with your password or SSO.",
      );
      expect(posted).toHaveLength(0);
      expect(await screen.findByTestId("password")).toBeEnabled();
    });

    test("offers neither 'Try passkey again' nor setup help there, since neither can work", async () => {
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: false,
      });
      renderPage();
      await clickPasskey();
      await clickPasskey();

      expect(
        screen.getByRole("button", { name: "Sign in with a passkey" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: "Try passkey again" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("passkey-help")).not.toBeInTheDocument();
      expect(posted).toHaveLength(0);
    });

    test("the password form still signs in", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
          const response: ModelAPIHttpResponse<User> =
            new ModelAPIHttpResponse<User>(200, USER_JSON, {});
          response.miscData = { token: "password-session" };
          return response;
        });
      renderPage();
      await clickPasskey();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(await screen.findByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "correct-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      expect(LoginUtil.login).toHaveBeenCalledWith({
        user: expect.any(User),
        token: "password-session",
      });
      expect(posted).toHaveLength(0);
    });
  });

  describe("'New to passkeys?' is help for an attempt that did not sign in", () => {
    test("is not on the page before any attempt", async () => {
      renderPage();
      await screen.findByTestId("email");

      expect(
        screen.queryByText(english.login.passkey.helpTitle),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("passkey-help")).not.toBeInTheDocument();
      expect(screen.queryByText(/User Profile/)).not.toBeInTheDocument();
    });

    test("appears folded after a prompt that was dismissed or timed out, and says what a passkey is and where to add one", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage();
      await clickPasskey();

      const help: HTMLElement = screen.getByTestId("passkey-help");
      expect(help.tagName).toBe("DETAILS");
      expect(help).not.toHaveAttribute("open");
      expect(comesAfter(help, screen.getByText(NOT_COMPLETED))).toBe(true);

      await act(async () => {
        await userEvent.click(screen.getByText("New to passkeys?"));
      });

      expect(help).toHaveAttribute("open");
      expect(help).toHaveTextContent(
        "A passkey lets you sign in with your fingerprint, face, or device PIN instead of a password.",
      );
      expect(help).toHaveTextContent(
        `To add one, sign in with your password or SSO, then open ${PASSKEY_MENU_PATH}.`,
      );
      expect(help).not.toHaveTextContent("Two Factor Auth");
      expect(screen.getByTestId("email")).toBeEnabled();
      expect(ssoLink()).toBeVisible();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("appears after the page's own Cancel", async () => {
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      await clickPasskey();
      expect(screen.queryByTestId("passkey-help")).not.toBeInTheDocument();

      await cancelPrompt();

      expect(screen.getByRole("status")).toHaveTextContent(CANCELLED);
      expect(screen.getByTestId("passkey-help")).toBeInTheDocument();
      await act(async () => {
        prompt.settle();
      });
    });

    test("appears after an error, under the error", async () => {
      jest
        .spyOn(API, "post")
        .mockResolvedValueOnce(
          new HTTPResponse<JSONObject>(
            200,
            { options: authenticationOptions },
            {},
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "This passkey is no longer registered. Please sign in with your password.",
          ),
        );
      renderPage();
      await clickPasskey();

      const alert: HTMLElement = screen.getByRole("alert");
      expect(alert).toHaveTextContent(/no longer registered/);
      expect(comesAfter(screen.getByTestId("passkey-help"), alert)).toBe(true);
    });

    test("goes away while another attempt runs, and Cancel takes its place", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage();
      await clickPasskey();
      expect(screen.getByTestId("passkey-help")).toBeInTheDocument();

      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      await clickPasskey();

      expect(screen.queryByTestId("passkey-help")).not.toBeInTheDocument();
      expect(screen.getByTestId("cancel-passkey-login")).toBeInTheDocument();
      await act(async () => {
        prompt.settle();
      });
      expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    });

    test("is cleared with the passkey messages when the password form is submitted", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockRejectedValue(new Error("Invalid email or password."));
      renderPage();
      await clickPasskey();
      expect(screen.getByText(NOT_COMPLETED)).toBeInTheDocument();

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(screen.getByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "wrong-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      expect(screen.queryByText(NOT_COMPLETED)).not.toBeInTheDocument();
      expect(screen.queryByTestId("passkey-help")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Sign in with a passkey" }),
      ).toBeEnabled();
    });
  });

  describe("what an attempt says, and how the page looks while it runs", () => {
    /*
     * A dismissed or timed-out prompt, or the page's Cancel, says what
     * happened in one sentence. The next step is drawn around it: "Try
     * passkey again" right above, the password form above that. The notices
     * used to add "Try again, or sign in with your password", repeating both.
     */
    test("a dismissed or timed-out prompt says what happened, in one sentence, under 'Try passkey again'", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage();
      await clickPasskey();

      const notice: HTMLElement = screen.getByTestId("passkey-notice");
      expect(notice.textContent).toBe(
        "Passkey sign-in was canceled or timed out.",
      );
      expect(notice).toHaveClass("text-balance");
      expect(notice.textContent!.toLowerCase()).not.toContain("password");
      expect(notice.textContent!.toLowerCase()).not.toContain("try again");
      expect(
        comesAfter(
          notice,
          screen.getByRole("button", { name: "Try passkey again" }),
        ),
      ).toBe(true);
    });

    test("the page's Cancel says only that the attempt was canceled", async () => {
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      await clickPasskey();
      await cancelPrompt();

      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        "Passkey sign-in canceled.",
      );
      expect(
        screen.getByRole("button", { name: "Try passkey again" }),
      ).toHaveFocus();
      await act(async () => {
        prompt.settle();
      });
    });

    /*
     * A passkey error is the same alert the form shows for a wrong password
     * at the top of the card: one look for "that did not work", wherever it
     * happened. It used to be a smaller red box of its own.
     */
    test("an error is the same alert the form shows for a wrong password", async () => {
      jest
        .spyOn(API, "post")
        .mockResolvedValueOnce(
          new HTTPResponse<JSONObject>(
            200,
            { options: authenticationOptions },
            {},
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "This passkey is no longer registered. Please sign in with your password.",
          ),
        );
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockRejectedValue(new Error("Invalid email or password."));
      renderPage();
      await clickPasskey();

      const passkeyAlert: HTMLElement = screen.getByTestId("passkey-error");
      expect(passkeyAlert).toHaveAttribute("role", "alert");
      expect(passkeyAlert).toHaveTextContent(
        "This passkey is no longer registered. Please sign in with your password.",
      );
      expect(passkeyAlert).toHaveClass("alert", "text-start");
      expect(
        comesAfter(passkeyAlert, screen.getByTestId("passkey-login")),
      ).toBe(true);
      // Everything but the spacing and alignment it has under the option.
      const surface: (alert: HTMLElement) => Array<string> = (
        alert: HTMLElement,
      ): Array<string> => {
        return alert.className
          .split(" ")
          .filter((name: string) => {
            return name && name !== "mt-3" && name !== "text-start";
          })
          .sort();
      };
      const passkeySurface: Array<string> = surface(passkeyAlert);

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(screen.getByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "wrong-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      // Submitting the form clears the passkey's messages.
      expect(screen.queryByTestId("passkey-error")).not.toBeInTheDocument();
      const formAlert: HTMLElement = screen.getByRole("alert");
      expect(formAlert).toHaveTextContent("Invalid email or password.");
      expect(surface(formAlert)).toEqual(passkeySurface);
      expect(passkeySurface).toEqual(
        expect.arrayContaining(["border-red-200", "bg-red-50", "text-red-800"]),
      );
    });

    /*
     * The option, its Cancel and "New to passkeys?" are link-weight controls
     * this page draws itself, not shared buttons, so the page gives them
     * their keyboard focus ring: the same one, in every state.
     */
    test("the option, Cancel and 'New to passkeys?' show the same keyboard focus ring", async () => {
      const focusRing: Array<string> = [
        "focus:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-indigo-500",
        "focus-visible:ring-offset-2",
      ];
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      const option: HTMLElement = screen.getByTestId("passkey-login");

      expect(option).toHaveClass(...focusRing);
      await clickPasskey();
      expect(option).toHaveClass(...focusRing);
      expect(screen.getByTestId("cancel-passkey-login")).toHaveClass(
        ...focusRing,
      );

      await cancelPrompt();
      const help: HTMLElement = screen.getByText("New to passkeys?");
      expect(help.tagName).toBe("SUMMARY");
      expect(help).toHaveClass(...focusRing);
      expect(option).toHaveClass(...focusRing);
      await act(async () => {
        prompt.settle();
      });
    });

    /*
     * While an attempt runs, the form is paused, and looks it: disabled,
     * faded as a whole and out of the pointer's reach. Its links pause with
     * it - leaving the page while the server finishes the sign-in would
     * throw that sign-in away - and so would a captcha. The passkey option,
     * its prompt line and its Cancel are outside the form, so they stay at
     * full strength and Cancel brings the form back.
     */
    test("the form is paused, and drawn faded, while an attempt runs", async () => {
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      const form: HTMLElement = (await screen.findByTestId("email")).closest(
        "fieldset",
      ) as HTMLElement;

      expect(form).toBeEnabled();
      expect(form).toHaveClass(
        "disabled:opacity-50",
        "disabled:pointer-events-none",
        "transition-opacity",
        "motion-reduce:transition-none",
      );
      // The fade and the pointer rule apply only while the form is disabled.
      expect(form).not.toHaveClass("opacity-50");
      expect(form).not.toHaveClass("pointer-events-none");
      expect(form.contains(screen.getByTestId("passkey-option"))).toBe(false);
      /*
       * Everything of the form pauses together: its links, the "or" divider
       * and single sign-on, which would leave the page.
       */
      expect(form.contains(screen.getByTestId("Sign in"))).toBe(true);
      expect(form.contains(ssoLink())).toBe(true);
      expect(form.contains(screen.getByTestId("sign-in-options-divider"))).toBe(
        true,
      );
      expect(
        form.contains(screen.getByText("Forgot password?").closest("a")),
      ).toBe(true);

      await clickPasskey();

      expect(form).toBeDisabled();
      expect(screen.getByTestId("email")).toBeDisabled();
      expect(screen.getByTestId("Sign in")).toBeDisabled();
      expect(screen.getByTestId("cancel-passkey-login")).toBeEnabled();
      // The option whose attempt runs stays at full strength: busy, not faded.
      const option: HTMLElement = screen.getByTestId("passkey-login");
      expect(option).toBeDisabled();
      expect(option).toHaveClass(...optionClasses("busy"));
      expect(option).not.toHaveClass("opacity-50");
      expect(option.className).not.toContain("hover:");
      expect(
        within(screen.getByRole("status")).getByText(
          "Follow the prompt from your browser or password manager.",
        ),
      ).toHaveClass("text-balance");

      await cancelPrompt();

      expect(form).toBeEnabled();
      expect(screen.getByTestId("email")).toBeEnabled();
      expect(screen.getByTestId("Sign in")).toBeEnabled();
      expect(screen.getByTestId("passkey-login")).toHaveClass(
        ...optionClasses("ready"),
      );
      await act(async () => {
        prompt.settle();
      });
    });
  });

  /*
   * The footer's language switcher changes the language without a reload.
   * A notice is kept as its translation key, so it changes with the page;
   * kept as words, it stayed in the language it was first shown in.
   */
  describe("a notice follows the language switcher", () => {
    test("after a dismissed prompt", async () => {
      jest
        .spyOn(navigator.credentials, "get")
        .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
      renderPage();
      await clickPasskey();
      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        english.login.passkey.notCompleted,
      );

      await act(async () => {
        await i18n.changeLanguage("de");
      });

      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        german.login.passkey.notCompleted,
      );
      expect(
        screen.getByRole("button", { name: german.login.passkey.tryAgain }),
      ).toBeEnabled();
    });

    test("after the page's Cancel", async () => {
      const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
      renderPage();
      await clickPasskey();
      await cancelPrompt();
      expect(screen.getByTestId("passkey-notice").textContent).toBe(CANCELLED);

      await act(async () => {
        await i18n.changeLanguage("de");
      });

      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        german.login.passkey.cancelled,
      );
      await act(async () => {
        prompt.settle();
      });
    });

    test("in a browser that cannot use passkeys", async () => {
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: false,
      });
      renderPage();
      await clickPasskey();
      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        english.login.passkey.insecure,
      );

      await act(async () => {
        await i18n.changeLanguage("de");
      });

      expect(screen.getByTestId("passkey-notice").textContent).toBe(
        german.login.passkey.insecure,
      );
      expect(german.login.passkey.insecure).not.toBe(
        english.login.passkey.insecure,
      );
    });
  });

  test("the option, its messages and its help are in the visitor's language: German", async () => {
    await i18n.changeLanguage("de");
    jest
      .spyOn(navigator.credentials, "get")
      .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    renderPage();

    expect(await screen.findByText(german.login.subtitle)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: german.login.passkey.signIn }),
    ).toBeEnabled();
    await clickPasskey();

    expect(screen.getByText(german.login.passkey.notCompleted)).toBeVisible();
    expect(
      screen.getByRole("button", { name: german.login.passkey.tryAgain }),
    ).toBeEnabled();
    await act(async () => {
      await userEvent.click(screen.getByText(german.login.passkey.helpTitle));
    });
    expect(screen.getByTestId("passkey-help")).toHaveTextContent(
      "Benutzerprofil → Sicherheit → Passkeys",
    );
    expect(german.login.passkey.signIn).not.toBe(english.login.passkey.signIn);
  });

  test("canceling the browser prompt restores focus and discards a late credential", async () => {
    let finish: ((value: Credential | null) => void) | undefined;
    const get: SpyInstance<typeof navigator.credentials.get> = jest
      .spyOn(navigator.credentials, "get")
      .mockImplementationOnce(() => {
        return new Promise<Credential | null>(
          (resolve: (value: Credential | null) => void) => {
            finish = resolve;
          },
        );
      });
    renderPage();
    await clickPasskey();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Follow the prompt from your browser or password manager.",
    );
    expect(
      screen.getByRole("button", { name: "Check your device" }),
    ).toBeDisabled();
    await cancelPrompt();
    expect(get.mock.calls[0]![0]!.signal!.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Passkey sign-in canceled.",
    );
    expect(screen.getByTestId("password")).toBeEnabled();
    expect(screen.getByTestId("passkey-login")).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await clickPasskey();
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish!(WebAuthnTestUtil.credential());
    });
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(3);
  });

  /*
   * While the browser's own prompt is open, the page says so in a line of
   * its own; while preparing and verifying, the option's label already says
   * it, so the same words are there for screen readers only.
   */
  test("shows the device prompt line, and keeps the other stages' words for screen readers", async () => {
    let finishOptions: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    jest.spyOn(API, "post").mockImplementationOnce(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          finishOptions = resolve;
        },
      );
    });
    const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
    renderPage();
    await clickPasskey();

    const preparing: HTMLElement = within(screen.getByRole("status")).getByText(
      "Getting your passkey ready…",
    );
    expect(preparing).toHaveClass("sr-only");
    expect(
      screen.getByRole("button", { name: "Getting your passkey ready…" }),
    ).toBeDisabled();

    await act(async () => {
      finishOptions!(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      );
    });

    const waiting: HTMLElement = within(screen.getByRole("status")).getByText(
      "Follow the prompt from your browser or password manager.",
    );
    expect(waiting).not.toHaveClass("sr-only");
    await act(async () => {
      prompt.settle();
    });
  });

  test("Cancel is a readable button, not the faint secondary link", async () => {
    const prompt: ReturnType<typeof pendingCredential> = pendingCredential();
    renderPage();
    await clickPasskey();

    const cancel: HTMLElement = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("data-testid", "cancel-passkey-login");
    expect(cancel).toHaveAttribute("type", "button");
    expect(cancel).toHaveClass("text-gray-500");
    expect(cancel).not.toHaveClass("text-gray-400");
    await cancelPrompt();
    await act(async () => {
      prompt.settle();
    });
  });

  test("canceling preparation aborts the request and cannot overwrite a newer attempt", async () => {
    let finish: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    jest.spyOn(API, "post").mockImplementationOnce(() => {
      return new Promise<HTTPResponse<JSONObject>>(
        (resolve: (value: HTTPResponse<JSONObject>) => void) => {
          finish = resolve;
        },
      );
    });
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    renderPage();
    await clickPasskey();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Getting your passkey ready",
    );
    await cancelPrompt();
    expect(
      jest.mocked(API.post).mock.calls[0]![0].options!.signal!.aborted,
    ).toBe(true);
    await clickPasskey();
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish!(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      );
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
  });

  test("keeps sign-in locked while the server completes verification", async () => {
    let finish: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      )
      .mockImplementationOnce(() => {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            finish = resolve;
          },
        );
      });
    renderPage();
    await clickPasskey();
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in");
    expect(
      screen.queryByTestId("cancel-passkey-login"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeDisabled();
    await act(async () => {
      finish!(
        new HTTPResponse<JSONObject>(
          200,
          { ...USER_JSON, _miscData: { token: "session" } },
          {},
        ),
      );
    });
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
  });

  test("aborts an open prompt when leaving the page and ignores its result", async () => {
    let finish: ((value: Credential | null) => void) | undefined;
    const get: SpyInstance<typeof navigator.credentials.get> = jest
      .spyOn(navigator.credentials, "get")
      .mockImplementationOnce(() => {
        return new Promise<Credential | null>(
          (resolve: (value: Credential | null) => void) => {
            finish = resolve;
          },
        );
      });
    const view: ReturnType<typeof render> = render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    await clickPasskey();
    view.unmount();
    expect(get.mock.calls[0]![0]!.signal!.aborted).toBe(true);
    await act(async () => {
      finish!(WebAuthnTestUtil.credential());
    });
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
  });

  test("shows expired/rejected credentials without creating a local login", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      )
      .mockRejectedValueOnce(
        new Error(
          "This passkey is no longer registered. Please sign in with your password.",
        ),
      );
    renderPage();
    await clickPasskey();
    expect(
      screen.getByText(/This passkey is no longer registered/),
    ).toBeInTheDocument();
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(screen.getByTestId("passkey-login")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Try passkey again" }),
    ).toBeInTheDocument();
  });

  test("handles an HTTP error response from the options endpoint", async () => {
    jest.spyOn(API, "post").mockResolvedValueOnce(
      new HTTPErrorResponse(
        429,
        {
          message: "Too many attempts. Try again later.",
        },
        {},
      ),
    );
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    renderPage();
    await clickPasskey();
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByTestId("passkey-login")).toBeEnabled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  test("permits only one ceremony and disables password submission while the authenticator is open", async () => {
    let finish: ((value: Credential | null) => void) | undefined;
    jest.spyOn(navigator.credentials, "get").mockImplementation(() => {
      return new Promise<Credential | null>(
        (resolve: (value: Credential | null) => void) => {
          finish = resolve;
        },
      );
    });
    renderPage();
    await screen.findByTestId("password");
    fireEvent.click(screen.getByTestId("passkey-login"));
    fireEvent.click(screen.getByTestId("passkey-login"));
    await waitFor(() => {
      expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("passkey-login")).toBeDisabled();
    expect(screen.getByTestId("password")).toBeDisabled();
    expect(screen.getByTestId("Sign in")).toBeDisabled();
    expect(posted).toHaveLength(1);
    await act(async () => {
      finish!(WebAuthnTestUtil.credential());
    });
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
  });

  test("a password sign-in in flight disables the passkey option until it answers", async () => {
    let answer: ((value: ModelAPIHttpResponse<User>) => void) | undefined;
    jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation(() => {
      return new Promise<ModelAPIHttpResponse<User>>(
        (resolve: (value: ModelAPIHttpResponse<User>) => void) => {
          answer = resolve;
        },
      );
    });
    renderPage();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    await user.type(await screen.findByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "correct-password");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });

    expect(screen.getByTestId("passkey-login")).toBeDisabled();
    // Faded while it waits, like the form a passkey attempt pauses.
    expect(screen.getByTestId("passkey-login")).toHaveClass(
      ...optionClasses("paused"),
    );
    expect(screen.getByTestId("passkey-login")).toHaveClass("opacity-50");
    fireEvent.click(screen.getByTestId("passkey-login"));
    expect(posted).toHaveLength(0);

    await act(async () => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, USER_JSON, {});
      response.miscData = { token: "password-session" };
      answer!(response);
    });
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "password-session",
    });
    expect(posted).toHaveLength(0);
  });

  test("keeps the password sign-in flow working after passkey cancellation", async () => {
    jest
      .spyOn(navigator.credentials, "get")
      .mockRejectedValue(new DOMException("Canceled", "NotAllowedError"));
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData = { token: "password-session" };
        return response;
      });
    renderPage();
    await clickPasskey();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    await user.type(await screen.findByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "correct-password");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "password-session",
    });
  });

  test("single sign-on stays a link to the SSO page, under Login", async () => {
    renderPage();
    await screen.findByTestId("email");

    expect(ssoLink()).toHaveAttribute("href", "/accounts/sso");
    expect(ssoLink().tagName).toBe("A");
    expect(comesAfter(ssoLink(), screen.getByTestId("Sign in"))).toBe(true);
  });

  test("preserves password plus security key MFA after introducing passkeys", async () => {
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData = {
          totpAuthList: [],
          webAuthnList: [
            {
              _id: "22222222-2222-4222-8222-222222222222",
              name: "Personal security key",
            },
          ],
          backupCodeCount: 1,
        };
        return response;
      });
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url?.toString() || "";
          posted.push({ url: url, data: options.data });
          return new HTTPResponse<JSONObject>(
            200,
            url.endsWith("/generate-authentication-options")
              ? { options: authenticationOptions }
              : { ...USER_JSON, _miscData: { token: "security-key-session" } },
            {},
          );
        },
      );
    renderPage();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    await user.type(await screen.findByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), "correct-password");
    await act(async () => {
      await user.click(screen.getByTestId("Sign in"));
    });
    expect(screen.queryByTestId("passkey-login")).not.toBeInTheDocument();
    expect(screen.queryByTestId("passkey-option")).not.toBeInTheDocument();
    await act(async () => {
      await user.click(await screen.findByText("Personal security key"));
    });
    expect(posted[0]?.url).toContain(
      "/user-webauthn/generate-authentication-options",
    );
    expect(posted[1]?.url).toContain("/identity/verify-webauthn-auth");
    expect(posted[1]?.data).toMatchObject({
      data: {
        credential: { id: "-_8A", response: { userHandle: "CgsM" } },
      },
    });
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "security-key-session",
    });
  });
});
