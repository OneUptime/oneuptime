import { exchangePasskeyCode, LoginResponse } from "../api/auth";
import { clearTokensIfCurrent, storeTokens } from "../storage/keychain";
import { getServerUrl } from "../storage/serverUrl";
import { openPasskeyAuthSession } from "./authSession";
import { createPasskeyRequest, PasskeyRequest } from "./request";
import { signInWithPasskey } from "./signIn";

jest.mock("../api/auth", () => {
  return { exchangePasskeyCode: jest.fn() };
});
jest.mock("../storage/keychain", () => {
  return {
    storeTokens: jest.fn(),
    clearTokensIfCurrent: jest.fn(),
  };
});
jest.mock("../storage/serverUrl", () => {
  return { getServerUrl: jest.fn() };
});
jest.mock("./authSession", () => {
  return { openPasskeyAuthSession: jest.fn() };
});
jest.mock("./request", () => {
  return {
    ...jest.requireActual<typeof import("./request")>("./request"),
    createPasskeyRequest: jest.fn(),
  };
});

const request: PasskeyRequest = {
  state: "a".repeat(64),
  codeVerifier: "b".repeat(64),
  serverOrigin: "https://selfhosted.example.com:8443",
  url: "https://selfhosted.example.com:8443/accounts/mobile-passkey",
};
const code: string = "c".repeat(43);
const callback: string = `oneuptime://passkey?code=${code}&state=${request.state}&serverOrigin=${encodeURIComponent(request.serverOrigin)}`;
const session: LoginResponse = {
  accessToken: "access",
  refreshToken: "refresh",
  refreshTokenExpiresAt: "2027-01-01T00:00:00.000Z",
  user: {
    _id: "user-1",
    name: "Responder",
    email: "responder@example.com",
    isMasterAdmin: false,
  },
};
const progress: jest.Mock = jest.fn();
let controller: AbortController;

beforeEach(() => {
  controller = new AbortController();
  jest.mocked(getServerUrl).mockResolvedValue(request.serverOrigin);
  jest.mocked(createPasskeyRequest).mockResolvedValue(request);
  jest
    .mocked(openPasskeyAuthSession)
    .mockResolvedValue({ status: "callback", url: callback });
  jest.mocked(exchangePasskeyCode).mockResolvedValue(session);
  jest.mocked(storeTokens).mockResolvedValue(undefined);
});

test("signs into the captured self-hosted server with PKCE and stores the completed session", async () => {
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toEqual(session);
  expect(progress.mock.calls).toEqual([
    ["preparing"],
    ["browser"],
    ["verifying"],
  ]);
  expect(exchangePasskeyCode).toHaveBeenCalledWith({
    serverOrigin: request.serverOrigin,
    code,
    codeVerifier: request.codeVerifier,
    state: request.state,
    signal: controller.signal,
  });
  expect(storeTokens).toHaveBeenCalledTimes(1);
  expect(storeTokens).toHaveBeenCalledWith({
    accessToken: "access",
    refreshToken: "refresh",
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  });
});

test("browser cancellation never exchanges or stores credentials", async () => {
  jest
    .mocked(openPasskeyAuthSession)
    .mockResolvedValue({ status: "cancelled" });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(exchangePasskeyCode).not.toHaveBeenCalled();
  expect(storeTokens).not.toHaveBeenCalled();
});

test("a bound cancellation from the website also leaves the app signed out", async () => {
  jest.mocked(openPasskeyAuthSession).mockResolvedValue({
    status: "callback",
    url: callback.replace(`code=${code}`, "error=access_denied"),
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(exchangePasskeyCode).not.toHaveBeenCalled();
});

test("a callback cannot choose the server that receives the verifier", async () => {
  jest.mocked(openPasskeyAuthSession).mockResolvedValue({
    status: "callback",
    url: callback.replace(
      encodeURIComponent(request.serverOrigin),
      "https%3A%2F%2Fevil.example",
    ),
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).rejects.toThrow(/could not be verified/);
  expect(exchangePasskeyCode).not.toHaveBeenCalled();
  expect(storeTokens).not.toHaveBeenCalled();
});

test("a server change while the browser is open invalidates the callback", async () => {
  jest.mocked(openPasskeyAuthSession).mockImplementation(async () => {
    jest.mocked(getServerUrl).mockResolvedValue("https://another.example.com");
    return { status: "callback", url: callback };
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).rejects.toThrow(/server changed/);
  expect(exchangePasskeyCode).not.toHaveBeenCalled();
});

test("canceling preparation prevents a browser from opening", async () => {
  jest.mocked(createPasskeyRequest).mockImplementation(async () => {
    controller.abort();
    return request;
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(openPasskeyAuthSession).not.toHaveBeenCalled();
});

test("leaving the app screen before exchange resolves cannot store a late session", async () => {
  jest.mocked(exchangePasskeyCode).mockImplementation(async () => {
    controller.abort();
    return session;
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(storeTokens).not.toHaveBeenCalled();
});

test("changing server during exchange cannot install the previous server's session", async () => {
  jest.mocked(exchangePasskeyCode).mockImplementation(async () => {
    jest.mocked(getServerUrl).mockResolvedValue("https://another.example.com");
    return session;
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).rejects.toThrow(/server changed/);
  expect(storeTokens).not.toHaveBeenCalled();
});

test("a server refusal or expired code remains retryable and writes no tokens", async () => {
  jest
    .mocked(exchangePasskeyCode)
    .mockRejectedValue(new Error("Sign-in expired"));
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).rejects.toThrow("Sign-in expired");
  expect(storeTokens).not.toHaveBeenCalled();
});

test("if the screen leaves during storage, its own session is discarded", async () => {
  jest.mocked(storeTokens).mockImplementation(async () => {
    controller.abort();
  });
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(clearTokensIfCurrent).toHaveBeenCalledWith(session.accessToken);
});

test("an already canceled attempt does no work", async () => {
  controller.abort();
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).resolves.toBeNull();
  expect(createPasskeyRequest).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
});

test("a storage failure does not authenticate or leave its own partially saved session behind", async () => {
  jest.mocked(storeTokens).mockRejectedValue(new Error("Storage unavailable"));
  await expect(
    signInWithPasskey({ signal: controller.signal, onProgress: progress }),
  ).rejects.toThrow("Storage unavailable");
  expect(clearTokensIfCurrent).toHaveBeenCalledWith(session.accessToken);
});
