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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import * as UIConfig from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI, {
  ModelAPIHttpResponse,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
import LoginUtil from "../../../UI/Utils/Login";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import UiAnalytics from "../../../UI/Utils/Analytics";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import RegisterPage from "../../../../App/FeatureSet/Accounts/src/Pages/Register";
import {
  SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS,
  fetchSignUpInvitation,
} from "../../../../App/FeatureSet/Accounts/src/Utils/SignUpInvitation";
import { SIGN_UP_INVITATION_API_URL } from "../../../../App/FeatureSet/Accounts/src/Utils/ApiPaths";
import en from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import fa from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import {
  SIGN_UP_INVITATION_PROJECT_KEY,
  SIGN_UP_INVITATION_ROUTE,
} from "../../../Types/Accounts/SignUpInvitation";

/*
 * THE SIGN-UP PAGE AN INVITATION OPENS (#7471).
 *
 * It was the plain sign-up page: "Create your OneUptime account", the
 * address filled in and nothing else - am I joining Walk Co, or making an
 * account somewhere else? - and after Sign Up, a second screen asked to
 * accept the invitation the link had carried. Now, opened from an
 * invitation (?email= and ?token=), it asks the server what the invitation
 * knows (POST /identity/sign-up-invitation) and says it: "Join Walk Co",
 * who invited them, the name the inviter typed filled in. Its button says
 * that signing up joins, and the sign-up names the project, which the
 * server accepts once the token has claimed the account. Without an
 * answer, it is the plain page it always was.
 */

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/SignInMethods", () => {
  return (
    jest.requireActual(
      "./SignInMethodsStandIn",
    ) as typeof import("./SignInMethodsStandIn")
  ).signInMethodsNotRequired();
});

jest.mock("../../../../App/FeatureSet/Accounts/src/Utils/FirstAccount", () => {
  return (
    jest.requireActual(
      "./FirstAccountStandIn",
    ) as typeof import("./FirstAccountStandIn")
  ).serverWithAccounts();
});

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

const EMAIL: string = "grace@walk.example";
const TOKEN: string = "74100000-0000-4000-8000-000000000001";
const PROJECT_ID: string = "74200000-0000-4000-8000-000000000001";
const PASSWORD: string = "lantern river meadow";

const english: typeof en = en;

type InvitationAnswer =
  | "pending"
  | "accepted"
  | "no-inviter"
  | "none"
  | "error"
  | "throws"
  | "held";

let answer: InvitationAnswer = "pending";
let asked: Array<{ url: string; data: unknown }> = [];
let link: { email: string; token: string } = { email: EMAIL, token: TOKEN };

function invitationAnswer(): JSONObject {
  if (answer === "none") {
    return { invitation: null };
  }

  return {
    invitation: {
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      inviterName: answer === "no-inviter" ? null : "Ada Walker",
      name: "Grace Member",
      isAccepted: answer === "accepted",
    },
  };
}

beforeEach(() => {
  answer = "pending";
  asked = [];
  link = { email: EMAIL, token: TOKEN };
  Object.defineProperty(UIConfig, "BILLING_ENABLED", { value: false });

  jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUtmParams").mockReturnValue({});
  jest.spyOn(UserUtil, "getAttributionClickIds").mockReturnValue(null);
  jest.spyOn(UserUtil, "getFirstTouchAttribution").mockReturnValue(null);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((key: string): string | null => {
      if (key === "email") {
        return link.email || null;
      }

      if (key === "token") {
        return link.token || null;
      }

      return null;
    });
  jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "capture").mockImplementation(() => {});
  jest.spyOn(UiAnalytics, "captureRevenueEvent").mockImplementation(() => {});
  jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
  jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<ModelAPIHttpResponse<User>> => {
      const response: ModelAPIHttpResponse<User> =
        new ModelAPIHttpResponse<User>(200, {}, {});
      response.miscData = { token: "session" };
      return response;
    });
  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: Parameters<typeof API.post>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url.toString();

        if (!url.endsWith(SIGN_UP_INVITATION_ROUTE)) {
          throw new Error(`Unexpected request to ${url}`);
        }

        asked.push({ url: url, data: options.data });

        if (answer === "throws") {
          throw new Error("network down");
        }

        if (answer === "error") {
          return new HTTPErrorResponse(404, { message: "Not found" }, {});
        }

        if (answer === "held") {
          return new Promise<HTTPResponse<JSONObject>>(() => {});
        }

        return new HTTPResponse<JSONObject>(200, invitationAnswer(), {});
      },
    );
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
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

async function setField(name: string, value: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });
  const input: HTMLElement = screen.getByTestId(name);
  await user.clear(input);
  if (value) {
    await user.paste(value);
  }
}

// What the sign-up sent, beside the account.
async function signUp(buttonName: string): Promise<JSONObject> {
  await setField("password", PASSWORD);
  await setField("confirmPassword", PASSWORD);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
  });

  await waitFor(() => {
    expect(ModelAPI.createOrUpdate).toHaveBeenCalledTimes(1);
  });

  const call: Parameters<typeof ModelAPI.createOrUpdate> = jest.mocked(
    ModelAPI.createOrUpdate,
  ).mock.calls[0]!;

  return (call[0].miscDataProps || {}) as JSONObject;
}

describe("opened from an invitation the server can read", () => {
  test("asks the server, once, with the link's address and token", async () => {
    await renderPage();

    expect(asked).toEqual([
      {
        url: SIGN_UP_INVITATION_API_URL.toString(),
        data: { email: EMAIL, token: TOKEN },
      },
    ]);
  });

  test("says which project invited them, and who", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Join Walk Co" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker invited you to join this project on OneUptime. Create your account to join.",
    );
    // The plain sign-up's title is not there.
    expect(
      screen.queryByRole("heading", { name: english.register.title }),
    ).toBeNull();
  });

  test("fills in the name the inviter typed, for them to change, beside their locked address", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("name")).toHaveValue("Grace Member");
    });
    expect(screen.getByTestId("email")).toHaveValue(EMAIL);
    // The address is the invitation's: locked.
    expect(screen.getByTestId("email")).toHaveAttribute("readonly");
    expect(screen.getByTestId("name")).not.toHaveAttribute("readonly");
    expect(screen.getByTestId("name")).not.toBeDisabled();
  });

  test("says signing up joins, and the sign-up names the project, with the token", async () => {
    await renderPage();

    const sent: JSONObject = await signUp(english.register.joinButton);

    expect(english.register.joinButton).toBe("Sign Up and Join");
    expect(sent["registrationToken"]).toBe(TOKEN);
    expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBe(PROJECT_ID);
  });

  test("a name they changed is the one signed up with", async () => {
    await renderPage();

    await setField("name", "Grace Hopper");
    await signUp(english.register.joinButton);

    const call: Parameters<typeof ModelAPI.createOrUpdate> = jest.mocked(
      ModelAPI.createOrUpdate,
    ).mock.calls[0]!;

    expect((call[0].model as User).name?.toString()).toBe("Grace Hopper");
  });

  test("an invitation that names nobody says so without a name", async () => {
    answer = "no-inviter";

    await renderPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      english.register.invited,
    );
  });

  test("someone added already is told so, signs up plainly, and names no project to accept", async () => {
    answer = "accepted";

    await renderPage();

    expect(screen.getByTestId("register-invitation")).toHaveTextContent(
      "Ada Walker added you to this project on OneUptime. Create your account to get started.",
    );

    const sent: JSONObject = await signUp(english.register.submitButton);

    expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBeUndefined();
    expect(sent["registrationToken"]).toBe(TOKEN);
  });

  test("draws nothing of its own until the server answers: never a title it then swaps", async () => {
    answer = "held";

    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByTestId("password")).toBeNull();
  });

  test("in Persian, sets the names apart so they read the right way", async () => {
    await i18n.changeLanguage("fa");
    await renderPage();

    const subtitle: HTMLElement = screen.getByTestId("register-invitation");
    const isolated: Array<string> = Array.from(
      document.querySelectorAll("bdi"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(isolated).toEqual(["Walk Co", "Ada Walker"]);
    expect(subtitle.textContent).toBe(
      fa.register.invitedBy.replace("{{inviter}}", "Ada Walker"),
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      fa.register.invitedTitle.replace("{{project}}", "Walk Co"),
    );
  });
});

describe("with nothing the server could say", () => {
  test.each([
    ["answers none", "none"],
    ["answers with an error", "error"],
    ["cannot be reached", "throws"],
  ] as Array<[string, InvitationAnswer]>)(
    "when the server %s, it is the plain sign-up page, and names no project",
    async (_case: string, given: InvitationAnswer) => {
      answer = given;

      await renderPage();

      expect(
        screen.getByRole("heading", { level: 1, name: english.register.title }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("register-invitation")).toBeNull();
      expect(screen.getByTestId("name")).toHaveValue("");

      await setField("name", "Grace Member");
      const sent: JSONObject = await signUp(english.register.submitButton);

      expect(sent[SIGN_UP_INVITATION_PROJECT_KEY]).toBeUndefined();
      // The token still claims the account.
      expect(sent["registrationToken"]).toBe(TOKEN);
    },
  );

  test("a link with no token is no invitation: the server is never asked", async () => {
    link = { email: EMAIL, token: "" };

    await renderPage();

    expect(asked).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 1, name: english.register.title }),
    ).toBeInTheDocument();
  });

  test("nor is a plain sign-up", async () => {
    link = { email: "", token: "" };

    await renderPage();

    expect(asked).toEqual([]);
  });
});

describe("the ask itself", () => {
  test("answers none when the server does not answer in time, so the page always draws", async () => {
    answer = "held";
    jest.useFakeTimers();

    const pending: Promise<unknown> = fetchSignUpInvitation({
      email: EMAIL,
      token: TOKEN,
    });

    jest.advanceTimersByTime(SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS);

    await expect(pending).resolves.toBeNull();
    expect(SIGN_UP_INVITATION_ANSWER_TIMEOUT_IN_MS).toBe(3000);
  });

  test("reads the invitation the server sent", async () => {
    await expect(
      fetchSignUpInvitation({ email: EMAIL, token: TOKEN }),
    ).resolves.toEqual({
      projectId: PROJECT_ID,
      projectName: "Walk Co",
      inviterName: "Ada Walker",
      name: "Grace Member",
      isAccepted: false,
    });
  });
});

describe("the words, in every language", () => {
  const LOCALES: Record<string, Record<string, Record<string, string>>> = {};

  beforeEach(() => {
    const fs: typeof import("fs") = jest.requireActual(
      "fs",
    ) as typeof import("fs");
    const path: typeof import("path") = jest.requireActual(
      "path",
    ) as typeof import("path");
    const dir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Accounts/src/Locales",
    );

    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".json")) {
        LOCALES[file.slice(0, -5)] = JSON.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        );
      }
    }
  });

  test("every language words them, with the one placeholder each takes", () => {
    const placeholders: Record<string, Array<string>> = {
      invitedTitle: ["{{project}}"],
      invitedBy: ["{{inviter}}"],
      invited: [],
      addedBy: ["{{inviter}}"],
      added: [],
      joinButton: [],
    };

    expect(Object.keys(LOCALES)).toHaveLength(18);

    for (const [code, locale] of Object.entries(LOCALES)) {
      for (const [key, expected] of Object.entries(placeholders)) {
        const text: string | undefined = locale["register"]?.[key];

        expect({
          code,
          key,
          worded: typeof text === "string" && text.length > 0,
        }).toEqual({
          code,
          key,
          worded: true,
        });
        expect({
          code,
          key,
          placeholders: text!.match(/\{\{\w+\}\}/g) || [],
        }).toEqual({
          code,
          key,
          placeholders: expected,
        });

        if (code !== "en") {
          expect({
            code,
            key,
            isEnglish: text === en.register[key as keyof typeof en.register],
          }).toEqual({
            code,
            key,
            isEnglish: false,
          });
        }
      }
    }
  });
});
