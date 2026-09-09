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
import React from "react";
import { SpyInstance } from "jest-mock";
import { JSONObject } from "../../../Types/JSON";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../../../UI/Utils/API/API";
import LoginUtil from "../../../UI/Utils/Login";
import WebAuthnTestUtil, {
  authenticationOptions,
} from "../../Utils/WebAuthnTestUtil";
import MobilePasskey, {
  MobilePasskeyRequest,
} from "../../../../App/FeatureSet/Accounts/src/Utils/MobilePasskey";
import MobilePasskeyPage from "../../../../App/FeatureSet/Accounts/src/Pages/MobilePasskey";
import "../../../../App/FeatureSet/Accounts/src/Utils/i18n";

const state: string = "a".repeat(64);
const code: string = "c".repeat(43);
const origin: string = "https://dev.oneuptime.com";
const request: MobilePasskeyRequest = {
  state,
  codeChallenge: "b".repeat(43),
  codeChallengeMethod: "S256",
};
const query: string = new URLSearchParams({ ...request }).toString();
const callback: string =
  "oneuptime://passkey?" +
  new URLSearchParams({ code, state, serverOrigin: origin }).toString();
const originalLocation: Location = window.location;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise: Promise<T> = new Promise<T>(
    (
      onResolve: (value: T | PromiseLike<T>) => void,
      onReject: (error: Error) => void,
    ): void => {
      resolve = onResolve;
      reject = onReject;
    },
  );
  return { promise, resolve, reject };
}

const optionsResponse: () => HTTPResponse<JSONObject> = () => {
  return new HTTPResponse<JSONObject>(
    200,
    { options: authenticationOptions },
    {},
  );
};

const callbackResponse: () => HTTPResponse<JSONObject> = () => {
  return new HTTPResponse<JSONObject>(
    200,
    { mobileAuth: { callbackUrl: callback } },
    {},
  );
};

const configureLocation: (search?: string, server?: string) => void = (
  search: string = query,
  server: string = origin,
): void => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new globalThis.URL(`${server}/accounts/mobile-passkey?${search}`),
  });
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("Mobile passkey browser request boundary", () => {
  test("accepts an app-generated S256 request", () => {
    expect(MobilePasskey.getRequest(query)).toEqual(request);
  });

  test.each([
    "",
    "state=short",
    query.replace("S256", "plain"),
    query + "&state=" + state,
    query + "&codeChallenge=" + request.codeChallenge,
    query + "&codeChallengeMethod=S256",
    query + "&redirectUri=https://evil.example",
    query.replace(request.codeChallenge, "x".repeat(44)),
    query.replace(state, "x".repeat(129)),
    query.replace(state, state + "%0A"),
    query.replace(request.codeChallenge, request.codeChallenge + "%0A"),
  ])("rejects invalid or ambiguous handoff parameters %s", (search: string) => {
    expect(MobilePasskey.getRequest(search)).toBeNull();
  });

  test("accepts only the callback for this attempt and server", () => {
    expect(MobilePasskey.validateCallback(callback, request, origin)).toBe(
      callback,
    );
    expect(
      MobilePasskey.validateCallback(
        callback,
        request,
        "https://other.example",
      ),
    ).toBeNull();
    expect(
      MobilePasskey.validateCallback(
        callback,
        { ...request, state: "z".repeat(64) },
        origin,
      ),
    ).toBeNull();
  });

  test.each([
    undefined,
    null,
    {},
    "javascript:alert(1)",
    callback.replace("oneuptime:", "https:"),
    callback.replace("//passkey", "//sso-callback"),
    callback.replace("//passkey", "//user@passkey"),
    callback.replace("//passkey", "//passkey:443"),
    callback.replace("passkey?", "passkey/extra?"),
    callback + "#fragment",
    callback + "&code=" + code,
    callback + "&state=" + state,
    callback + "&serverOrigin=" + encodeURIComponent(origin),
    callback + "&accessToken=secret",
    callback.replace(code, "short"),
    callback.replace(code, "c".repeat(44)),
    callback.replace(code, "c".repeat(128)),
    callback.replace(code, code + "%0A"),
    callback + "\n",
  ])("rejects unsafe or ambiguous callback %s", (value: unknown) => {
    expect(MobilePasskey.validateCallback(value, request, origin)).toBeNull();
  });

  test("cancellation returns only fixed destination, original state and server", () => {
    const url: URL = new URL(MobilePasskey.cancelCallback(request, origin));
    expect(url.protocol).toBe("oneuptime:");
    expect(url.host).toBe("passkey");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: "access_denied",
      state,
      serverOrigin: origin,
    });
  });
});

describe("Mobile passkey browser page", () => {
  beforeEach(() => {
    configureLocation();
    WebAuthnTestUtil.install();
    jest.spyOn(MobilePasskey, "returnToApp").mockImplementation(() => {});
    jest.spyOn(LoginUtil, "login").mockImplementation(() => {});
    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject>> => {
          return new HTTPResponse<JSONObject>(
            200,
            options.url?.toString().endsWith("/passkey-login-options")
              ? { options: authenticationOptions }
              : { mobileAuth: { callbackUrl: callback } },
            {},
          );
        },
      );
  });

  test("requires an explicit passkey action and explains the app handoff", () => {
    render(<MobilePasskeyPage />);
    expect(
      screen.getByRole("heading", { name: "Sign in to OneUptime On-Call" }),
    ).toBeVisible();
    expect(screen.getByText("dev.oneuptime.com")).toBeVisible();
    expect(screen.getByText(/return to the mobile app/)).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("binds the browser challenge to PKCE and returns a code without local login", async () => {
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(callback);
    });
    expect(jest.mocked(API.post).mock.calls[0]?.[0].data).toEqual({
      mobileAuth: request,
    });
    expect(jest.mocked(API.post).mock.calls[1]?.[0].data).toEqual({
      credential: expect.objectContaining({ type: "public-key", id: "-_8A" }),
    });
    expect(LoginUtil.login).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Return to app" })).toHaveAttribute(
      "href",
      callback,
    );
    expect(API.post).toHaveBeenCalledTimes(2);
  });

  test("does not start authentication from an invalid link", () => {
    configureLocation(query + "&state=duplicate");
    render(<MobilePasskeyPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Start sign-in from the OneUptime mobile app/,
    );
    expect(
      screen.queryByTestId("mobile-passkey-sign-in"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Cancel and return/ }),
    ).not.toBeInTheDocument();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("rejects HTTP even when browser WebAuthn is available", () => {
    configureLocation(query, "http://localhost");
    render(<MobilePasskeyPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Passkeys require HTTPS/,
    );
    expect(API.post).not.toHaveBeenCalled();
  });

  test("explains unsupported browsers without starting an API request", () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });
    render(<MobilePasskeyPage />);
    expect(screen.getByTestId("mobile-passkey-sign-in")).toBeDisabled();
    expect(
      screen.getByText(/Passkeys aren’t available in this browser/),
    ).toBeVisible();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("lets a dismissed device prompt retry with a fresh challenge", async () => {
    jest
      .spyOn(navigator.credentials, "get")
      .mockRejectedValueOnce(new DOMException("Canceled", "NotAllowedError"));
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(
        screen.getByText(/Passkey sign-in was canceled or timed out/),
      ).toBeVisible();
    });
    expect(screen.getByTestId("mobile-passkey-sign-in")).toHaveFocus();
    expect(API.post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(callback);
    });
    expect(API.post).toHaveBeenCalledTimes(3);
  });

  test("cancel aborts a pending device prompt and ignores its late credential", async () => {
    let release: (credential: PublicKeyCredential) => void = () => {};
    jest.spyOn(navigator.credentials, "get").mockImplementation(() => {
      return new Promise<PublicKeyCredential>(
        (resolve: (credential: PublicKeyCredential) => void) => {
          release = resolve;
        },
      );
    });
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and return to app" }),
    );
    expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(
      MobilePasskey.cancelCallback(request, origin),
    );
    await act(async () => {
      release(WebAuthnTestUtil.credential());
    });
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(1);
  });

  test("duplicate clicks do not create competing challenges", async () => {
    jest.spyOn(navigator.credentials, "get").mockImplementation(() => {
      return new Promise<PublicKeyCredential>(() => {});
    });
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
    });
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  test("unmount ignores a late code and never redirects", async () => {
    let release: (response: HTTPResponse<JSONObject>) => void = () => {};
    const pending: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (response: HTTPResponse<JSONObject>) => void) => {
        release = resolve;
      },
    );
    jest
      .mocked(API.post)
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      )
      .mockReturnValueOnce(pending);
    const view: ReturnType<typeof render> = render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(API.post).toHaveBeenCalledTimes(2);
    });
    view.unmount();
    await act(async () => {
      release(
        new HTTPResponse<JSONObject>(
          200,
          { mobileAuth: { callbackUrl: callback } },
          {},
        ),
      );
    });
    expect(MobilePasskey.returnToApp).not.toHaveBeenCalled();
  });

  test("rejects a server response aimed at a different app or session", async () => {
    jest
      .mocked(API.post)
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { options: authenticationOptions },
          {},
        ),
      )
      .mockResolvedValueOnce(
        new HTTPResponse<JSONObject>(
          200,
          { mobileAuth: { callbackUrl: "https://evil.example?code=" + code } },
          {},
        ),
      );
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      return expect(screen.getByRole("alert")).toHaveTextContent(
        /Sign-in could not be completed/,
      );
    });
    expect(MobilePasskey.returnToApp).not.toHaveBeenCalled();
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });

  test.each([
    { phase: "options", failure: "HTTP refusal" },
    { phase: "options", failure: "network rejection" },
    { phase: "verification", failure: "HTTP refusal" },
    { phase: "verification", failure: "network rejection" },
  ])(
    "recovers from $failure during $phase with a fresh ceremony",
    async ({ phase, failure }: { phase: string; failure: string }) => {
      const credential: SpyInstance<typeof navigator.credentials.get> =
        jest.spyOn(navigator.credentials, "get");
      if (phase === "verification") {
        jest.mocked(API.post).mockResolvedValueOnce(optionsResponse());
      }
      const message: string = "Passkey service temporarily unavailable";
      if (failure === "HTTP refusal") {
        jest
          .mocked(API.post)
          .mockResolvedValueOnce(new HTTPErrorResponse(503, { message }, {}));
      } else {
        jest.mocked(API.post).mockRejectedValueOnce(new Error(message));
      }
      render(<MobilePasskeyPage />);
      fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(message);
      });
      expect(screen.getByTestId("mobile-passkey-sign-in")).toBeEnabled();
      await waitFor(() => {
        expect(screen.getByTestId("mobile-passkey-sign-in")).toHaveFocus();
      });
      expect(credential).toHaveBeenCalledTimes(phase === "options" ? 0 : 1);
      expect(MobilePasskey.returnToApp).not.toHaveBeenCalled();
      expect(LoginUtil.login).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
      await waitFor(() => {
        expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(callback);
      });
      expect(API.post).toHaveBeenCalledTimes(phase === "options" ? 3 : 4);
      expect(credential).toHaveBeenCalledTimes(phase === "options" ? 1 : 2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(LoginUtil.login).not.toHaveBeenCalled();
    },
  );

  test.each<JSONObject>([{}, { mobileAuth: null }, { mobileAuth: {} }])(
    "an incomplete verification response cannot return to the app: %j",
    async (data: JSONObject) => {
      jest
        .mocked(API.post)
        .mockResolvedValueOnce(optionsResponse())
        .mockResolvedValueOnce(new HTTPResponse<JSONObject>(200, data, {}));
      render(<MobilePasskeyPage />);
      fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Sign-in could not be completed/,
        );
      });
      expect(screen.getByTestId("mobile-passkey-sign-in")).toBeEnabled();
      expect(
        screen.queryByRole("link", { name: "Return to app" }),
      ).not.toBeInTheDocument();
      expect(MobilePasskey.returnToApp).not.toHaveBeenCalled();
      expect(LoginUtil.login).not.toHaveBeenCalled();
    },
  );

  test("canceling preparation aborts the request and never opens a late device prompt", async () => {
    const pending: Deferred<HTTPResponse<JSONObject>> = deferred();
    const credential: SpyInstance<typeof navigator.credentials.get> =
      jest.spyOn(navigator.credentials, "get");
    jest.mocked(API.post).mockReturnValueOnce(pending.promise);
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    expect(screen.getByTestId("mobile-passkey-sign-in")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and return to app" }),
    );
    expect(
      jest.mocked(API.post).mock.calls[0]?.[0].options?.signal?.aborted,
    ).toBe(true);
    await act(async () => {
      pending.resolve(optionsResponse());
    });
    expect(credential).not.toHaveBeenCalled();
    expect(API.post).toHaveBeenCalledTimes(1);
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(1);
    expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(
      MobilePasskey.cancelCallback(request, origin),
    );
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });

  test("canceling verification discards its late code and leaves browser sign-in untouched", async () => {
    const pending: Deferred<HTTPResponse<JSONObject>> = deferred();
    jest
      .mocked(API.post)
      .mockResolvedValueOnce(optionsResponse())
      .mockReturnValueOnce(pending.promise);
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      expect(API.post).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and return to app" }),
    );
    expect(
      jest.mocked(API.post).mock.calls[1]?.[0].options?.signal?.aborted,
    ).toBe(true);
    await act(async () => {
      pending.resolve(callbackResponse());
    });
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(1);
    expect(MobilePasskey.returnToApp).toHaveBeenCalledWith(
      MobilePasskey.cancelCallback(request, origin),
    );
    expect(
      screen.queryByRole("link", { name: "Return to app" }),
    ).not.toBeInTheDocument();
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });

  test("a canceled options request cannot unlock or complete a newer pending attempt", async () => {
    const oldOptions: Deferred<HTTPResponse<JSONObject>> = deferred();
    const newOptions: Deferred<HTTPResponse<JSONObject>> = deferred();
    const credential: SpyInstance<typeof navigator.credentials.get> =
      jest.spyOn(navigator.credentials, "get");
    jest
      .mocked(API.post)
      .mockReturnValueOnce(oldOptions.promise)
      .mockReturnValueOnce(newOptions.promise);
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and return to app" }),
    );
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await act(async () => {
      oldOptions.resolve(optionsResponse());
    });
    expect(screen.getByTestId("mobile-passkey-sign-in")).toBeDisabled();
    expect(credential).not.toHaveBeenCalled();
    expect(API.post).toHaveBeenCalledTimes(2);
    await act(async () => {
      newOptions.resolve(optionsResponse());
    });
    await waitFor(() => {
      expect(MobilePasskey.returnToApp).toHaveBeenLastCalledWith(callback);
    });
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(2);
    expect(credential).toHaveBeenCalledTimes(1);
    expect(API.post).toHaveBeenCalledTimes(3);
  });

  test("a canceled request rejecting late does not replace the cancellation message with an error", async () => {
    const pending: Deferred<HTTPResponse<JSONObject>> = deferred();
    jest.mocked(API.post).mockReturnValueOnce(pending.promise);
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel and return to app" }),
    );
    await act(async () => {
      pending.reject(new Error("Aborted connection"));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Passkey sign-in canceled/)).toBeVisible();
    expect(screen.getByTestId("mobile-passkey-sign-in")).toBeEnabled();
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(1);
  });

  test("unmounting during preparation aborts network work without opening a device prompt", async () => {
    const pending: Deferred<HTTPResponse<JSONObject>> = deferred();
    const credential: SpyInstance<typeof navigator.credentials.get> =
      jest.spyOn(navigator.credentials, "get");
    jest.mocked(API.post).mockReturnValueOnce(pending.promise);
    const view: ReturnType<typeof render> = render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    view.unmount();
    expect(
      jest.mocked(API.post).mock.calls[0]?.[0].options?.signal?.aborted,
    ).toBe(true);
    await act(async () => {
      pending.resolve(optionsResponse());
    });
    expect(credential).not.toHaveBeenCalled();
    expect(MobilePasskey.returnToApp).not.toHaveBeenCalled();
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });

  test("a blocked automatic app return preserves a safe manual return without repeating authentication", async () => {
    jest.mocked(MobilePasskey.returnToApp).mockImplementationOnce(() => {
      throw new Error("The browser blocked the app launch");
    });
    render(<MobilePasskeyPage />);
    fireEvent.click(screen.getByTestId("mobile-passkey-sign-in"));
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Return to app" }),
      ).toHaveAttribute("href", callback);
    });
    expect(screen.getByRole("link", { name: "Return to app" })).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
    expect(
      screen.queryByTestId("mobile-passkey-sign-in"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel and return to app" }),
    ).not.toBeInTheDocument();
    expect(API.post).toHaveBeenCalledTimes(2);
    expect(MobilePasskey.returnToApp).toHaveBeenCalledTimes(1);
    expect(LoginUtil.login).not.toHaveBeenCalled();
  });
});
