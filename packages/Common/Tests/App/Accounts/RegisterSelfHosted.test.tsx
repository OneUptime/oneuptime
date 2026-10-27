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
import React from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import * as UIConfig from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";
import {
  FIRST_ACCOUNT_ANSWER_TIMEOUT_IN_MS,
  fetchIsAwaitingFirstAccount,
} from "../../../../App/FeatureSet/Accounts/src/Utils/FirstAccount";
import { FIRST_ACCOUNT_API_URL } from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { IDENTITY_URL } from "../../../UI/Config";
import en from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Config",
    ) as typeof import("../../../UI/Config")),
    __esModule: true,
    BILLING_ENABLED: false,
    CAPTCHA_ENABLED: false,
  };
});

/*
 * The register page on a self-hosted server (#5229's follow-ups). It read
 * like OneUptime Cloud's - "Join thousands of businesses ...", "No credit
 * card required." - on a server its own admin had just installed, and the
 * first person through never learned that their account would run it.
 *
 *   - OneUptime Cloud (billing on): as before, and it never asks the server.
 *   - A self-hosted server: no line under the title (the UI review took out
 *     "Create your account on this OneUptime server.", which only said the
 *     title again), and no card line.
 *   - A self-hosted server with no account yet (POST /identity/first-account
 *     says so): the account made here becomes its admin, and there is
 *     nobody to sign in as, so the way to sign in is not offered.
 *   - Until the server answers, the page draws nothing of its own: never a
 *     line or a "Sign in." link that the answer then takes away.
 */

type FirstAccountAnswer =
  | "yes"
  | "no"
  | "error"
  | "throws"
  | "other-shape"
  | "held";

let answer: FirstAccountAnswer = "no";
let asked: Array<string> = [];

// For "held": the first-account answer waits until a test gives it.
let giveHeldAnswer: ((awaiting: boolean) => void) | null = null;

const english: typeof en = en;

beforeEach(() => {
  answer = "no";
  asked = [];
  giveHeldAnswer = null;
  Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: false });
  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest.spyOn(Navigation, "getQueryStringByName").mockReturnValue(null);
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        asked.push(options.url?.toString() || "");

        if (answer === "throws") {
          throw new Error("network down");
        }

        if (answer === "held") {
          return new Promise<HTTPResponse<JSONObject>>(
            (resolve: (response: HTTPResponse<JSONObject>) => void) => {
              giveHeldAnswer = (awaiting: boolean): void => {
                resolve(
                  new HTTPResponse<JSONObject>(
                    200,
                    { isAwaitingFirstAccount: awaiting },
                    {},
                  ),
                );
              };
            },
          );
        }

        if (answer === "error") {
          return new HTTPErrorResponse(404, { message: "Not found" }, {});
        }

        if (answer === "other-shape") {
          return new HTTPResponse<JSONObject>(
            200,
            { isAwaitingFirstAccount: "yes" },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          { isAwaitingFirstAccount: answer === "yes" },
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

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
  await screen.findByTestId("password");
}

const firstAccountRequests: () => Array<string> = (): Array<string> => {
  return asked.filter((url: string) => {
    return url.endsWith("/first-account");
  });
};

describe("a self-hosted server's register page", () => {
  test("has no line under its title, and asks for no card", async () => {
    await renderPage();

    await waitFor(() => {
      expect(firstAccountRequests()).toHaveLength(1);
    });
    expect(
      screen.getByRole("heading", { level: 1, name: english.register.title }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("register-subtitle")).toBeNull();
    expect(screen.queryByText(english.register.subtitle)).toBeNull();
    expect(
      screen.queryByText(english.register.firstAccountSubtitle),
    ).toBeNull();
    expect(screen.queryByTestId("register-no-credit-card")).toBeNull();
    expect(screen.queryByText(english.register.noCreditCard)).toBeNull();
    // People who have an account can still go and sign in.
    expect(screen.getByTestId("register-have-account")).toHaveTextContent(
      english.register.haveAccountPrompt,
    );
  });

  test("with no account yet: the account made here becomes its admin, and there is no one to sign in as", async () => {
    answer = "yes";
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("register-subtitle")).toHaveTextContent(
        english.register.firstAccountSubtitle,
      );
    });
    expect(english.register.firstAccountSubtitle).toBe(
      "This OneUptime server has no accounts yet. The account you create now becomes its admin.",
    );
    expect(screen.queryByTestId("register-have-account")).toBeNull();
    expect(screen.queryByText(english.register.loginLink)).toBeNull();
    expect(screen.queryByTestId("register-no-credit-card")).toBeNull();
  });

  test.each(["error", "throws", "other-shape"] as Array<FirstAccountAnswer>)(
    "an answer that is not a clear yes (%s) reads as a server that has accounts",
    async (given: FirstAccountAnswer) => {
      answer = given;
      await renderPage();

      await waitFor(() => {
        expect(firstAccountRequests()).toHaveLength(1);
      });
      expect(screen.queryByTestId("register-subtitle")).toBeNull();
      expect(screen.getByTestId("register-have-account")).toBeInTheDocument();
    },
  );

  test("draws nothing of its own until the server answers: never a line or a sign-in link it then takes away", async () => {
    answer = "held";
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(firstAccountRequests()).toHaveLength(1);
    });
    // Asked, not answered: the loader, and none of the page.
    expect(screen.queryByTestId("password")).toBeNull();
    expect(screen.queryByTestId("register-subtitle")).toBeNull();
    expect(screen.queryByTestId("register-have-account")).toBeNull();
    expect(screen.queryByText(english.register.loginLink)).toBeNull();

    await act(async () => {
      giveHeldAnswer?.(true);
    });

    await screen.findByTestId("password");
    expect(screen.getByTestId("register-subtitle")).toHaveTextContent(
      english.register.firstAccountSubtitle,
    );
    expect(screen.queryByTestId("register-have-account")).toBeNull();
  });

  test("an answer of no, once it lands, draws the page with its way to sign in", async () => {
    answer = "held";
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(firstAccountRequests()).toHaveLength(1);
    });
    expect(screen.queryByTestId("register-have-account")).toBeNull();

    await act(async () => {
      giveHeldAnswer?.(false);
    });

    await screen.findByTestId("password");
    expect(screen.getByTestId("register-have-account")).toHaveTextContent(
      english.register.haveAccountPrompt,
    );
    expect(screen.queryByTestId("register-subtitle")).toBeNull();
  });

  test("in German too", async () => {
    answer = "yes";
    await i18n.changeLanguage("de");
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("register-subtitle")).toHaveTextContent(
        "Dieser OneUptime-Server hat noch keine Konten.",
      );
    });
  });
});

describe("a self-hosted server that requires single sign-on", () => {
  test("offers SSO at once: it does not wait for the first-account answer it has no use for", async () => {
    answer = "held";
    jest
      .spyOn(API, "get")
      .mockImplementation(
        async (): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          return new HTTPResponse<JSONObject>(
            200,
            {
              isSsoRequired: true,
              ssoProviders: [
                {
                  type: "GlobalSSO",
                  id: "11111111-1111-4111-8111-111111111111",
                  name: "Okta",
                  description: "",
                },
              ],
              hasProjectSsoProviders: false,
            },
            {},
          );
        },
      );

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("sso-provider")).toBeInTheDocument();
    expect(screen.queryByTestId("password")).toBeNull();
  });
});

describe("OneUptime Cloud's register page", () => {
  beforeEach(() => {
    Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: true });
  });

  afterEach(() => {
    Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: false });
  });

  test("is as it was, and never asks the server whether it has an account", async () => {
    answer = "yes";
    await renderPage();

    expect(screen.getByTestId("register-subtitle")).toHaveTextContent(
      english.register.subtitle,
    );
    expect(screen.getByTestId("register-no-credit-card")).toHaveTextContent(
      english.register.noCreditCard,
    );
    expect(screen.getByTestId("register-have-account")).toBeInTheDocument();
    expect(firstAccountRequests()).toEqual([]);
  });
});

describe("fetchIsAwaitingFirstAccount", () => {
  test("posts to /identity/first-account and reads a clear yes", async () => {
    answer = "yes";

    await expect(fetchIsAwaitingFirstAccount()).resolves.toBe(true);
    expect(firstAccountRequests()).toHaveLength(1);
    // The identity API's route, beside /identity/signup and /identity/login.
    expect(firstAccountRequests()[0]).toBe(FIRST_ACCOUNT_API_URL.toString());
    expect(FIRST_ACCOUNT_API_URL.toString()).toBe(
      URL.fromURL(IDENTITY_URL)
        .addRoute(new Route("/first-account"))
        .toString(),
    );
  });

  test.each([
    "no",
    "error",
    "throws",
    "other-shape",
  ] as Array<FirstAccountAnswer>)(
    "anything else (%s) is no",
    async (given: FirstAccountAnswer) => {
      answer = given;

      await expect(fetchIsAwaitingFirstAccount()).resolves.toBe(false);
    },
  );

  test("a server that does not answer in time is no, so the page always draws", async () => {
    answer = "held";
    const started: number = Date.now();

    await expect(fetchIsAwaitingFirstAccount(50)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(
      FIRST_ACCOUNT_ANSWER_TIMEOUT_IN_MS,
    );
    // The register page waits a few seconds at most.
    expect(FIRST_ACCOUNT_ANSWER_TIMEOUT_IN_MS).toBeLessThanOrEqual(5000);
  });

  test("an answer within the time still counts", async () => {
    answer = "held";
    const asking: Promise<boolean> = fetchIsAwaitingFirstAccount(5000);

    await waitFor(() => {
      expect(giveHeldAnswer).not.toBeNull();
    });
    giveHeldAnswer?.(true);

    await expect(asking).resolves.toBe(true);
  });
});
