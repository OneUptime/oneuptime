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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import LoginUtil from "../../../UI/Utils/Login";
import UserUtil from "../../../UI/Utils/User";
import Navigation from "../../../UI/Utils/Navigation";
import UiAnalytics from "../../../UI/Utils/Analytics";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import User from "../../../Models/DatabaseModels/User";
import {
  getSignInOptionClassName,
  SignInOptionState,
} from "../../../UI/Components/SignInOption/SignInOptionStyle";
import WebAuthnTestUtil, {
  authenticationOptions,
} from "../../Utils/WebAuthnTestUtil";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import persian from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

/*
 * The other ways to sign in, on the Accounts pages.
 *
 * Under the password form's Login - the page's one filled button - an "or"
 * divider, then the other ways in as normal buttons: full width, outlined,
 * as tall as Login, an icon before the words. "Sign in with SSO", "Sign in
 * with Microsoft" where the server offers it, and "Sign in with a passkey",
 * last. They used to be centred text links (with a bordered Microsoft button
 * between them), which read as small print rather than as choices.
 *
 * The single sign-on page offers the way back the same way ("Sign in with
 * password" under "or"), and the sign-up page puts "Sign up with Microsoft"
 * under "or".
 *
 * Billing and the edition are pinned (CI's config.env sets
 * BILLING_ENABLED=true); whether the server offers Sign in with Microsoft is
 * set per test.
 */

let microsoftClientIdForTest: string | null = null;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    BILLING_ENABLED: false,
    IS_ENTERPRISE_EDITION: false,
  };

  Object.defineProperty(mocked, "MicrosoftSignInClientId", {
    get: (): string | null => {
      return microsoftClientIdForTest;
    },
  });

  return mocked;
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

const MICROSOFT_ROUTE: string = "/identity/microsoft/sign-in";

// A filled button - what a primary button looks like, whatever its colour.
const FILLED_BUTTON_CLASS: RegExp = /\bbg-(indigo|red|green|yellow)-600\b/;

let posted: Array<string> = [];

const optionClasses: (state: SignInOptionState) => Array<string> = (
  state: SignInOptionState,
): Array<string> => {
  return getSignInOptionClassName(state)
    .split(" ")
    .filter((name: string) => {
      return name.length > 0;
    });
};

const classSet: (element: Element) => Set<string> = (
  element: Element,
): Set<string> => {
  return new Set(Array.from(element.classList));
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

const renderLogin: () => Promise<void> = async (): Promise<void> => {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  await screen.findByTestId("email");
};

const renderSso: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <LoginWithSSOPage />
      </MemoryRouter>,
    );
  });
};

const renderRegister: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
  });
};

const ssoOption: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("sso-login");
};

const passkeyOption: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("passkey-login");
};

const microsoftOption: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("microsoft-sign-in");
};

const otherWaysIn: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return [
    ssoOption(),
    ...screen.queryAllByTestId("microsoft-sign-in"),
    passkeyOption(),
  ];
};

const clickPasskey: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await userEvent.click(passkeyOption());
  });
};

// A browser prompt that stays open until the test settles it.
const pendingPrompt: () => {
  settle: () => void;
} = () => {
  let finish: ((value: Credential | null) => void) | undefined;
  jest.spyOn(navigator.credentials, "get").mockImplementationOnce(() => {
    return new Promise<Credential | null>(
      (resolve: (value: Credential | null) => void) => {
        finish = resolve;
      },
    );
  });

  return {
    settle: (): void => {
      finish?.(WebAuthnTestUtil.credential());
    },
  };
};

describe("The other ways to sign in", () => {
  beforeEach(() => {
    posted = [];
    microsoftClientIdForTest = null;
    WebAuthnTestUtil.install();
    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue("");
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest
      .spyOn(API, "get")
      .mockImplementation(
        async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          return new HTTPResponse<JSONObject>(200, [] as never, {});
        },
      );
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          const url: string = options.url?.toString() || "";
          posted.push(url);
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
    microsoftClientIdForTest = null;
    await i18n.changeLanguage("en");
  });

  describe("on the sign-in page", () => {
    test("under Login: an 'or' divider, then Sign in with SSO and Sign in with a passkey, in that order", async () => {
      await renderLogin();

      const signIn: HTMLElement = screen.getByTestId("Sign in");
      const divider: HTMLElement = screen.getByTestId(
        "sign-in-options-divider",
      );

      expect(divider).toHaveTextContent(/^or$/);
      expect(comesAfter(divider, signIn)).toBe(true);
      expect(comesAfter(ssoOption(), divider)).toBe(true);
      expect(comesAfter(passkeyOption(), ssoOption())).toBe(true);
      expect(ssoOption()).toHaveAccessibleName("Sign in with SSO");
      expect(passkeyOption()).toHaveAccessibleName("Sign in with a passkey");
      // The divider is the only thing between Login and the first option.
      expect(divider.nextElementSibling).toContainElement(ssoOption());
    });

    test("the divider is one word between two hairlines, the hairlines hidden from assistive technology", async () => {
      await renderLogin();

      const divider: HTMLElement = screen.getByTestId(
        "sign-in-options-divider",
      );
      const lines: Array<HTMLElement> = within(divider).getAllByTestId(
        "sign-in-options-divider-line",
      );

      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toHaveAttribute("aria-hidden", "true");
        expect(line).toHaveClass("border-t");
      }
      expect(within(divider).getByText("or")).toBeVisible();
      expect(divider).toHaveClass("my-5");
    });

    test("every other way in is the same full-width, outlined button; Login is the one filled one", async () => {
      await renderLogin();

      const filled: Array<HTMLElement> = [
        ...screen.getAllByRole("button"),
        ...screen.getAllByRole("link"),
      ].filter((control: HTMLElement) => {
        return FILLED_BUTTON_CLASS.test(control.className);
      });

      expect(filled).toEqual([screen.getByTestId("Sign in")]);
      for (const option of otherWaysIn()) {
        expect(option).toHaveClass(...optionClasses("ready"));
        expect(option).toHaveClass("w-full", "border", "bg-white");
        expect(option).not.toHaveClass("text-indigo-500");
      }
      expect(classSet(passkeyOption())).toEqual(classSet(ssoOption()));
    });

    test("each draws an icon before its words: a shield for single sign-on, a fingerprint for a passkey", async () => {
      await renderLogin();

      for (const option of otherWaysIn()) {
        const icon: SVGElement | null = option.querySelector("svg");
        /*
         * The words are the option's only child, with the icon at their
         * start (SignInOptionLabel): a label that wraps keeps its icon
         * beside its first words.
         */
        const words: Element = option.firstElementChild as Element;

        expect(option.children).toHaveLength(1);
        expect(words).toHaveAttribute("dir", "auto");
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute("aria-hidden", "true");
        expect(words.firstElementChild).toContainElement(icon);
        expect(comesAfter(words.lastChild as Element, icon!)).toBe(true);
        expect(words.textContent).toBe(option.textContent);
      }
      expect(
        within(passkeyOption()).getByTestId("passkey-login-fingerprint"),
      ).toBeInTheDocument();
    });

    test("single sign-on is a link to the SSO page that opens it inside the app", async () => {
      await renderLogin();

      expect(ssoOption().tagName).toBe("A");
      expect(ssoOption()).toHaveAttribute("href", "/accounts/sso");
      expect(ssoOption()).toHaveAttribute("id", "sso-login");

      fireEvent.click(ssoOption());

      expect(Navigation.navigate).toHaveBeenCalledTimes(1);
      expect(
        (
          jest.mocked(Navigation.navigate).mock.calls[0]![0] as Route
        ).toString(),
      ).toBe("/accounts/sso");
      expect(posted).toEqual([]);
    });

    test("the retired links are gone: no 'Use single sign-on (SSO) instead', no link-weight passkey", async () => {
      await renderLogin();

      expect(
        screen.queryByText("Use single sign-on (SSO) instead"),
      ).not.toBeInTheDocument();
      expect(document.querySelector(".actions")).toBeNull();
      expect(passkeyOption()).not.toHaveClass("inline-flex");
      expect(passkeyOption().className).not.toContain("hover:underline");
    });

    test("the keyboard reaches them in the order they are drawn: after Login, single sign-on, then the passkey", async () => {
      await renderLogin();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      const reached: Array<HTMLElement> = [];

      for (let step: number = 0; step < 12; step++) {
        await user.tab();
        const focused: Element | null = document.activeElement;
        if (!focused || focused === document.body) {
          break;
        }
        reached.push(focused as HTMLElement);
        if (focused === passkeyOption()) {
          break;
        }
      }

      const login: number = reached.indexOf(screen.getByTestId("Sign in"));
      const sso: number = reached.indexOf(ssoOption());
      const passkey: number = reached.indexOf(passkeyOption());

      expect(reached.indexOf(screen.getByTestId("email"))).toBeLessThan(login);
      expect(reached.indexOf(screen.getByTestId("password"))).toBeLessThan(
        login,
      );
      expect(login).toBeGreaterThanOrEqual(0);
      expect(sso).toBe(login + 1);
      expect(passkey).toBe(sso + 1);
    });

    test("without Sign in with Microsoft, the list is single sign-on and the passkey", async () => {
      await renderLogin();

      expect(screen.queryByTestId("microsoft-sign-in")).not.toBeInTheDocument();
      expect(otherWaysIn()).toHaveLength(2);
    });

    describe("where the server offers Sign in with Microsoft", () => {
      beforeEach(() => {
        microsoftClientIdForTest = "microsoft-client-id";
      });

      test("it sits between single sign-on and the passkey, drawn like them", async () => {
        await renderLogin();

        expect(comesAfter(microsoftOption(), ssoOption())).toBe(true);
        expect(comesAfter(passkeyOption(), microsoftOption())).toBe(true);
        expect(microsoftOption()).toHaveClass(...optionClasses("ready"));
        expect(classSet(microsoftOption())).toEqual(classSet(passkeyOption()));
        // No margin of its own: the list spaces its buttons.
        expect(microsoftOption()).not.toHaveClass("mt-4");
        expect(otherWaysIn()).toHaveLength(3);
      });

      test("it is a link to the server's Microsoft sign-in, with Microsoft's logo before its words", async () => {
        await renderLogin();

        expect(microsoftOption().tagName).toBe("A");
        expect(microsoftOption()).toHaveAttribute("href", MICROSOFT_ROUTE);
        expect(microsoftOption()).toHaveAccessibleName(
          english.login.signInWithMicrosoft,
        );
        expect(microsoftOption().querySelectorAll("svg rect")).toHaveLength(4);
        expect(microsoftOption().querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
      });

      test("its logo has the box every option's icon has, at the start of its words", async () => {
        await renderLogin();

        const logo: SVGElement = microsoftOption().querySelector(
          "svg",
        ) as SVGElement;
        const shield: SVGElement = ssoOption().querySelector(
          "svg",
        ) as SVGElement;
        const words: Element = microsoftOption().firstElementChild as Element;

        expect(logo).toHaveClass("h-5", "w-5");
        expect(logo).toHaveAttribute("width", "20");
        expect(logo).toHaveAttribute("height", "20");
        expect(classSet(logo)).toEqual(classSet(shield));
        expect(microsoftOption().children).toHaveLength(1);
        expect(words).toHaveAttribute("dir", "auto");
        expect(words.firstElementChild).toContainElement(logo);
        expect(classSet(words)).toEqual(
          classSet(ssoOption().firstElementChild as Element),
        );
      });

      test("the keyboard reaches it between single sign-on and the passkey", async () => {
        await renderLogin();
        const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
          delay: null,
        });

        ssoOption().focus();
        await user.tab();
        expect(microsoftOption()).toHaveFocus();
        await user.tab();
        expect(passkeyOption()).toHaveFocus();
      });
    });

    /*
     * While a passkey attempt runs, the form is paused, and with it the "or"
     * divider and the ways in that leave the page: leaving while the server
     * finishes the sign-in would throw that sign-in away. The passkey option
     * is outside the paused fieldset, at full strength, with its Cancel.
     */
    test("a passkey attempt pauses the divider, single sign-on and Microsoft with the form, not the passkey option", async () => {
      microsoftClientIdForTest = "microsoft-client-id";
      const prompt: ReturnType<typeof pendingPrompt> = pendingPrompt();
      await renderLogin();

      const form: HTMLElement = screen
        .getByTestId("email")
        .closest("fieldset") as HTMLElement;

      expect(form).toContainElement(
        screen.getByTestId("sign-in-options-divider"),
      );
      expect(form).toContainElement(ssoOption());
      expect(form).toContainElement(microsoftOption());
      expect(form).not.toContainElement(passkeyOption());

      await clickPasskey();

      expect(form).toBeDisabled();
      expect(form).toHaveClass(
        "disabled:opacity-50",
        "disabled:pointer-events-none",
      );
      expect(passkeyOption()).toHaveClass(...optionClasses("busy"));
      expect(passkeyOption()).not.toHaveClass("opacity-50");
      expect(
        within(passkeyOption()).getByTestId("passkey-login-spinner"),
      ).toHaveClass("animate-spin");
      expect(screen.getByTestId("cancel-passkey-login")).toBeEnabled();

      await act(async () => {
        await userEvent.click(screen.getByTestId("cancel-passkey-login"));
      });

      expect(form).toBeEnabled();
      expect(passkeyOption()).toHaveClass(...optionClasses("ready"));
      await act(async () => {
        prompt.settle();
      });
    });

    test("each state of the passkey option keeps the box: as wide as Login, never moved", async () => {
      const prompt: ReturnType<typeof pendingPrompt> = pendingPrompt();
      await renderLogin();

      const box: Array<string> = [
        "w-full",
        "px-3",
        "py-2",
        "border",
        "rounded-md",
      ];
      expect(passkeyOption()).toHaveClass(...box);

      await clickPasskey();
      expect(passkeyOption()).toHaveClass(...box);

      await act(async () => {
        await userEvent.click(screen.getByTestId("cancel-passkey-login"));
      });
      expect(passkeyOption()).toHaveClass(...box);
      expect(passkeyOption()).toHaveTextContent("Try passkey again");
      await act(async () => {
        prompt.settle();
      });
    });

    test("a password sign-in in flight fades the passkey option, which waits for it; single sign-on stays a link", async () => {
      let answer: ((value: ModelAPIHttpResponse<User>) => void) | undefined;
      jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation(() => {
        return new Promise<ModelAPIHttpResponse<User>>(
          (resolve: (value: ModelAPIHttpResponse<User>) => void) => {
            answer = resolve;
          },
        );
      });
      await renderLogin();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(screen.getByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "correct-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      expect(passkeyOption()).toBeDisabled();
      expect(passkeyOption()).toHaveClass(...optionClasses("paused"));
      expect(ssoOption()).toHaveClass(...optionClasses("ready"));
      expect(ssoOption()).toHaveAttribute("href", "/accounts/sso");

      await act(async () => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData = { token: "password-session" };
        answer!(response);
      });

      expect(passkeyOption()).toHaveClass(...optionClasses("ready"));
      expect(posted).toEqual([]);
    });

    test("in a browser without passkeys, the option says why and is drawn unavailable, keeping its focus and its place", async () => {
      Object.defineProperty(window, "PublicKeyCredential", {
        configurable: true,
        value: undefined,
      });
      await renderLogin();

      expect(passkeyOption()).toHaveClass(...optionClasses("ready"));
      await clickPasskey();

      expect(passkeyOption()).toHaveClass(...optionClasses("unavailable"));
      expect(passkeyOption()).toHaveAttribute("aria-disabled", "true");
      expect(passkeyOption()).not.toBeDisabled();
      expect(passkeyOption()).toHaveFocus();
      expect(comesAfter(passkeyOption(), ssoOption())).toBe(true);
      expect(screen.getByTestId("passkey-notice")).toHaveTextContent(
        english.login.passkey.unsupported,
      );
      // Single sign-on, the way it points to, is unchanged.
      expect(ssoOption()).toHaveClass(...optionClasses("ready"));
      expect(posted).toEqual([]);
    });

    test("German: 'oder', 'Mit SSO anmelden' and 'Mit einem Passkey anmelden'", async () => {
      microsoftClientIdForTest = "microsoft-client-id";
      await i18n.changeLanguage("de");
      await renderLogin();

      expect(screen.getByTestId("sign-in-options-divider")).toHaveTextContent(
        /^oder$/,
      );
      expect(ssoOption()).toHaveAccessibleName("Mit SSO anmelden");
      expect(microsoftOption()).toHaveAccessibleName("Mit Microsoft anmelden");
      expect(passkeyOption()).toHaveAccessibleName(
        "Mit einem Passkey anmelden",
      );
      expect(german.common.or).toBe("oder");
    });

    test("the footer's language switcher changes the divider and the options in place", async () => {
      await renderLogin();
      expect(ssoOption()).toHaveAccessibleName(english.login.signInWithSso);

      await act(async () => {
        await i18n.changeLanguage("de");
      });

      expect(ssoOption()).toHaveAccessibleName(german.login.signInWithSso);
      expect(passkeyOption()).toHaveAccessibleName(german.login.passkey.signIn);
      expect(screen.getByTestId("sign-in-options-divider")).toHaveTextContent(
        german.common.or,
      );
    });

    /*
     * The page is laid out left to right in every language, so a label that
     * ends in a Latin word - Persian "ورود با SSO", "ورود با Microsoft" - is
     * laid out by its own first letter, or its reader meets "SSO" first.
     */
    test("every option's words, and the divider's, are laid out by their own direction", async () => {
      microsoftClientIdForTest = "microsoft-client-id";
      await i18n.changeLanguage("fa");
      await renderLogin();

      expect(screen.getByText(persian.login.signInWithSso)).toHaveAttribute(
        "dir",
        "auto",
      );
      expect(
        screen.getByText(persian.login.signInWithMicrosoft),
      ).toHaveAttribute("dir", "auto");
      expect(screen.getByText(persian.login.passkey.signIn)).toHaveAttribute(
        "dir",
        "auto",
      );
      expect(screen.getByText(persian.common.or)).toHaveAttribute(
        "dir",
        "auto",
      );
    });

    test("a signed-in visitor's two-factor screens show none of them", async () => {
      jest
        .spyOn(ModelAPI, "createOrUpdate")
        .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
          const response: ModelAPIHttpResponse<User> =
            new ModelAPIHttpResponse<User>(200, USER_JSON, {});
          response.miscData = {
            totpAuthList: [
              {
                _id: "22222222-2222-4222-8222-222222222222",
                name: "Phone",
              },
            ],
            webAuthnList: [],
            backupCodeCount: 3,
          };
          return response;
        });
      await renderLogin();
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
        delay: null,
      });
      await user.type(screen.getByTestId("email"), "ada@example.com");
      await user.type(screen.getByTestId("password"), "correct-password");
      await act(async () => {
        await user.click(screen.getByTestId("Sign in"));
      });

      expect(await screen.findByText("Phone")).toBeInTheDocument();
      expect(
        screen.queryByTestId("sign-in-options-divider"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("sso-login")).not.toBeInTheDocument();
      expect(screen.queryByTestId("passkey-login")).not.toBeInTheDocument();
    });
  });

  describe("on the single sign-on page", () => {
    test("under 'Sign in with SSO': 'or', then Sign in with password, a link back to the password form", async () => {
      await renderSso();

      const submit: HTMLElement = screen.getByTestId("Sign in with SSO");
      const divider: HTMLElement = screen.getByTestId(
        "sign-in-options-divider",
      );
      const password: HTMLElement = screen.getByTestId("password-login");

      expect(divider).toHaveTextContent(/^or$/);
      expect(comesAfter(divider, submit)).toBe(true);
      expect(comesAfter(password, divider)).toBe(true);
      expect(password.tagName).toBe("A");
      expect(password).toHaveAttribute("href", "/accounts/login");
      expect(password).toHaveAccessibleName("Sign in with password");
      expect(password).toHaveClass(...optionClasses("ready"));
      expect(password.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(
        screen.queryByText("Use username and password instead."),
      ).not.toBeInTheDocument();
    });

    test("its button is the page's one filled button, and the way back is outlined like the sign-in page's options", async () => {
      await renderSso();

      const filled: Array<HTMLElement> = [
        ...screen.getAllByRole("button"),
        ...screen.getAllByRole("link"),
      ].filter((control: HTMLElement) => {
        return FILLED_BUTTON_CLASS.test(control.className);
      });

      expect(filled).toEqual([screen.getByTestId("Sign in with SSO")]);
      expect(screen.getByTestId("password-login")).toHaveClass(
        "w-full",
        "bg-white",
        "border",
      );
    });

    test("the instance-wide providers' 'Or continue with email' is the same divider", async () => {
      jest
        .spyOn(API, "get")
        .mockImplementation(
          async (
            options: Parameters<typeof API.get>[0],
          ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
            const url: string = options.url?.toString() || "";
            if (url.includes("/global-sso/")) {
              return new HTTPResponse<JSONObject>(
                200,
                [
                  {
                    _id: "44444444-4444-4444-8444-444444444444",
                    name: "Okta (company-wide)",
                  },
                ] as never,
                {},
              );
            }
            return new HTTPResponse<JSONObject>(200, [] as never, {});
          },
        );
      await renderSso();

      const providers: HTMLElement = await screen.findByTestId(
        "global-providers-divider",
      );

      expect(providers).toHaveTextContent(english.sso.globalProvidersDivider);
      expect(
        within(providers).getAllByTestId("global-providers-divider-line"),
      ).toHaveLength(2);
      expect(comesAfter(screen.getByTestId("email"), providers)).toBe(true);
      // The sign-in options' divider is still there, below the form.
      expect(
        comesAfter(screen.getByTestId("sign-in-options-divider"), providers),
      ).toBe(true);
      // No line drawn behind words on a white patch.
      expect(providers.querySelector(".bg-white")).toBeNull();
    });

    test("German: 'oder', then 'Mit Passwort anmelden'", async () => {
      await i18n.changeLanguage("de");
      await renderSso();

      expect(screen.getByTestId("sign-in-options-divider")).toHaveTextContent(
        /^oder$/,
      );
      expect(screen.getByTestId("password-login")).toHaveAccessibleName(
        "Mit Passwort anmelden",
      );
    });
  });

  describe("on the sign-up page", () => {
    test("without Sign in with Microsoft: no divider and no other way to sign up", async () => {
      await renderRegister();

      expect(
        screen.queryByTestId("sign-up-options-divider"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("microsoft-sign-in")).not.toBeInTheDocument();
      expect(screen.queryByText("or")).not.toBeInTheDocument();
    });

    test("with it: under Sign Up, 'or', then Sign up with Microsoft, drawn like the sign-in page's options", async () => {
      microsoftClientIdForTest = "microsoft-client-id";
      await renderRegister();

      const submit: HTMLElement = screen.getByTestId("Sign Up");
      const divider: HTMLElement = screen.getByTestId(
        "sign-up-options-divider",
      );

      expect(divider).toHaveTextContent(/^or$/);
      expect(comesAfter(divider, submit)).toBe(true);
      expect(comesAfter(microsoftOption(), divider)).toBe(true);
      expect(microsoftOption()).toHaveAccessibleName("Sign up with Microsoft");
      expect(microsoftOption()).toHaveAttribute("href", MICROSOFT_ROUTE);
      expect(microsoftOption()).toHaveClass(...optionClasses("ready"));
      // "No credit card required." stays under it.
      expect(
        comesAfter(
          screen.getByText(english.register.noCreditCard),
          microsoftOption(),
        ),
      ).toBe(true);
    });
  });

  test("the other ways in ask the server for nothing until one is used", async () => {
    microsoftClientIdForTest = "microsoft-client-id";
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    await renderLogin();

    expect(posted).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
