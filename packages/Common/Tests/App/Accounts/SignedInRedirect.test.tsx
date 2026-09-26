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
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { DASHBOARD_URL } from "../../../UI/Config";
import UiAnalytics from "../../../UI/Utils/Analytics";
import API from "../../../UI/Utils/API/API";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";

/*
 * The sign-in pages send a visitor who is already signed in on to the
 * Dashboard. That check used to run on every render, and a sign-in on the
 * page itself signs the user in and navigates to the Dashboard too
 * (LoginUtil.login): the login form then re-rendered the page as it stopped
 * loading, the check saw a signed-in user and navigated again, and the
 * second navigation aborted the first. People landed on the Dashboard
 * regardless, but every e2e spec that signed in through the login page
 * failed on the aborted navigation (net::ERR_ABORTED / NS_BINDING_ABORTED).
 *
 * LoginUtil.login is the real one here, so a sign-in really stores the user
 * and really asks to navigate; only the navigation itself is recorded
 * instead of performed.
 */

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

// Page chrome that fetches the instance's global config on mount.
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
const PASSWORD: string = "lantern river meadow";

let navigations: Array<string> = [];

/*
 * What an email link would put in ?email=. Register reads it to prefill its
 * form; the login page is typed into instead, as a person signs in.
 */
let linkedEmail: string = "";

function navigationsToTheDashboard(): Array<string> {
  return navigations.filter((url: string) => {
    return url === DASHBOARD_URL.toString();
  });
}

async function renderInRouter(
  page: React.ReactElement,
): Promise<ReturnType<typeof render>> {
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<MemoryRouter>{page}</MemoryRouter>);
  });
  return result as ReturnType<typeof render>;
}

// Anything a stray second navigation would need to land.
async function letTheDustSettle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });
}

describe("Accounts pages navigate a signed-in user to the Dashboard once", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigations = [];
    linkedEmail = "";

    jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((to: { toString: () => string }) => {
        navigations.push(to.toString());
      });
    jest
      .spyOn(Navigation, "getQueryStringByName")
      .mockImplementation((key: string): string => {
        return key === "email" ? linkedEmail : "";
      });
    jest.spyOn(UserUtil, "getUtmParams").mockReturnValue({});
    jest.spyOn(UserUtil, "getAttributionClickIds").mockReturnValue(null);
    jest.spyOn(UserUtil, "getFirstTouchAttribution").mockReturnValue(null);
    jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
    jest.spyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(() => {});

    // /login and /signup both answer with the account and a session.
    jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
        const response: ModelAPIHttpResponse<User> =
          new ModelAPIHttpResponse<User>(200, USER_JSON, {});
        response.miscData = { token: "session-token" };
        return response;
      });

    // The SSO page lists the global providers on mount: there are none.
    jest.spyOn(API, "get").mockImplementation(async () => {
      return new HTTPResponse<JSONObject>(200, [] as unknown as JSONObject, {});
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    window.localStorage.clear();
  });

  test("a password sign-in on the login page navigates once", async () => {
    await renderInRouter(<LoginPage />);
    expect(navigations).toEqual([]);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    await user.type(await screen.findByTestId("email"), "ada@example.com");
    await user.type(screen.getByTestId("password"), PASSWORD);
    await act(async () => {
      await user.click(screen.getByTestId("Login"));
    });

    await waitFor(() => {
      expect(UserUtil.isLoggedIn()).toBe(true);
    });
    await letTheDustSettle();

    expect(navigationsToTheDashboard()).toHaveLength(1);
    expect(navigations).toEqual([DASHBOARD_URL.toString()]);
  });

  test("a signup that signs the account in navigates once", async () => {
    // The shared Email input loses synthetic paste events in jsdom.
    linkedEmail = "ada@example.com";
    await renderInRouter(<RegisterPage />);
    await waitFor(() => {
      expect(screen.getByTestId("email")).toHaveValue("ada@example.com");
    });

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });
    for (const [field, value] of [
      ["name", "Ada Lovelace"],
      ["password", PASSWORD],
      ["confirmPassword", PASSWORD],
    ] as const) {
      await user.clear(screen.getByTestId(field));
      await user.paste(value);
    }
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
    });

    await waitFor(() => {
      expect(UserUtil.isLoggedIn()).toBe(true);
    });
    await letTheDustSettle();

    expect(navigations).toEqual([DASHBOARD_URL.toString()]);
  });

  test.each([
    ["login", LoginPage],
    ["register", RegisterPage],
    ["single sign-on", LoginWithSSOPage],
  ] as Array<[string, () => React.ReactElement]>)(
    "a visitor already signed in is sent on from the %s page once, and not again as it re-renders",
    async (_name: string, Page: () => React.ReactElement) => {
      UserUtil.setEmail(new Email("ada@example.com"));

      const { rerender } = await renderInRouter(<Page />);
      await waitFor(() => {
        expect(navigations).toEqual([DASHBOARD_URL.toString()]);
      });

      // The page goes on rendering while the navigation is under way.
      for (let render: number = 0; render < 3; render++) {
        await act(async () => {
          rerender(
            <MemoryRouter>
              <Page />
            </MemoryRouter>,
          );
        });
      }
      await letTheDustSettle();

      expect(navigations).toEqual([DASHBOARD_URL.toString()]);
    },
  );
});
