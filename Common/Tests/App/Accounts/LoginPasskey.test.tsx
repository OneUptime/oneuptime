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
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import LoginPage from "../../../../App/FeatureSet/Accounts/src/Pages/Login";

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

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("offers a passkey on the initial screen alongside password and SSO", async () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    ).toBeEnabled();
    expect(await screen.findByTestId("email")).toHaveValue("");
    expect(screen.getByTestId("password")).toHaveValue("");
    expect(
      screen.getByText("Use single sign-on (SSO) instead"),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
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

  test("keeps password fallback available after cancellation and supports a fresh retry", async () => {
    const get: SpyInstance<typeof navigator.credentials.get> = jest.spyOn(
      navigator.credentials,
      "get",
    );
    get.mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    renderPage();
    await clickPasskey();
    expect(
      screen.getByText(
        "Passkey sign-in was canceled or timed out. Try again, or sign in with your password.",
      ),
    ).toBeInTheDocument();
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

  test("reports an unsupported browser without making a challenge request", async () => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
    renderPage();
    await clickPasskey();
    expect(
      screen.getByText(/This browser does not support passkeys/),
    ).toBeInTheDocument();
    expect(posted).toHaveLength(0);
    expect(screen.getByTestId("password")).toBeEnabled();
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
    expect(posted).toHaveLength(1);
    await act(async () => {
      finish!(WebAuthnTestUtil.credential());
    });
    expect(LoginUtil.login).toHaveBeenCalledTimes(1);
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
      await user.click(screen.getByTestId("Login"));
    });
    expect(LoginUtil.login).toHaveBeenCalledWith({
      user: expect.any(User),
      token: "password-session",
    });
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
      await user.click(screen.getByTestId("Login"));
    });
    expect(screen.queryByTestId("passkey-login")).not.toBeInTheDocument();
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
