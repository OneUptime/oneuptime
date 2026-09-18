import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL as NodeURL } from "node:url";
import axios, {
  AxiosAdapter,
  AxiosError,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import apiClient from "../api/client";
import { login, LoginResponse } from "../api/auth";
import { signInWithPasskey, PasskeyProgress } from "./signIn";
import {
  clearTokens,
  getCachedAccessToken,
  getTokens,
  storeTokens,
  StoredTokens,
} from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import {
  clearAllSsoTokens,
  getCachedGlobalSsoToken,
  storeGlobalSsoToken,
  storeSsoToken,
} from "../storage/ssoTokens";
import { completeSsoLoginFromUrl } from "../sso/session";
import serializedPasskeyUser from "../../../Common/Tests/Fixtures/MobilePasskeyUser.json";

/*
 * All passkey modules, Axios serialization/cancellation, and session persistence
 * run together. Only device APIs, the network transport and asynchronous device
 * storage are substituted. The response shape matches the real User serializer:
 * user fields are at the root alongside _miscData, never inside a data wrapper.
 */
jest.mock("expo-crypto", () => {
  const crypto: typeof import("node:crypto") =
    jest.requireActual("node:crypto");
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
    getRandomBytesAsync: jest.fn(
      async (length: number): Promise<Uint8Array> => {
        await Promise.resolve();
        return new Uint8Array(crypto.randomBytes(length));
      },
    ),
    digestStringAsync: jest.fn(
      async (
        algorithm: string,
        value: string,
        options: { encoding: "base64" | "hex" },
      ): Promise<string> => {
        await Promise.resolve();
        return crypto
          .createHash(algorithm.replace(/-/g, "").toLowerCase())
          .update(value, "utf8")
          .digest(options.encoding);
      },
    ),
  };
});

jest.mock("expo-web-browser", () => {
  return {
    openAuthSessionAsync: jest.fn(),
    dismissAuthSession: jest.fn(),
    WebBrowserResultType: { DISMISS: "dismiss", CANCEL: "cancel" },
  };
});
jest.mock("expo-linking", () => {
  return { addEventListener: jest.fn() };
});

interface StorageHooks {
  beforeWrite?: (key: string, value: string) => Promise<void>;
  afterWrite?: (key: string, value: string) => Promise<void>;
  beforeRemove?: (key: string) => Promise<void>;
}
interface StorageHarness {
  values: Map<string, string>;
  hooks: StorageHooks;
}

jest.mock("@react-native-async-storage/async-storage", () => {
  const state: StorageHarness = {
    values: new Map<string, string>(),
    hooks: {},
  };
  return {
    __esModule: true,
    default: {
      __harness: state,
      getItem: jest.fn(async (key: string): Promise<string | null> => {
        await Promise.resolve();
        return state.values.get(key) ?? null;
      }),
      setItem: jest.fn(async (key: string, value: string): Promise<void> => {
        await Promise.resolve();
        await state.hooks.beforeWrite?.(key, value);
        state.values.set(key, value);
        await state.hooks.afterWrite?.(key, value);
      }),
      removeItem: jest.fn(async (key: string): Promise<void> => {
        await Promise.resolve();
        await state.hooks.beforeRemove?.(key);
        state.values.delete(key);
      }),
      clear: jest.fn(async (): Promise<void> => {
        state.values.clear();
      }),
    },
  };
});

const storage: StorageHarness = (
  AsyncStorage as unknown as { __harness: StorageHarness }
).__harness;
const CLOUD_ORIGIN: string = "https://oneuptime.com";
const USER_ID: string = "11111111-1111-4111-8111-111111111111";
const TOKEN_KEY: string = "com.oneuptime.oncall.tokens";
const EXCHANGE_PATH: string = "/identity/mobile-passkey-exchange";
const EXPIRY: string = "2099-01-01T00:00:00.000Z";
const originalAdapter: typeof axios.defaults.adapter = axios.defaults.adapter;
const originalApiAdapter: typeof apiClient.defaults.adapter =
  apiClient.defaults.adapter;

type UrlListener = (event: { url: string }) => void;
interface Grant {
  browserUrl: string;
  origin: string;
  state: string;
  challenge: string;
  code: string;
  callback: string;
  consumed: boolean;
}
interface Gate {
  promise: Promise<void>;
  release: () => void;
}

let listeners: Set<UrlListener> = new Set<UrlListener>();
let grants: Array<Grant> = [];
let requests: Array<InternalAxiosRequestConfig> = [];
let controllers: Array<AbortController> = [];
let releases: Array<() => void> = [];
let operations: Array<Promise<unknown>> = [];
let browser: (grant: Grant) => Promise<WebBrowser.WebBrowserAuthSessionResult>;
let beforeExchange:
  | ((config: InternalAxiosRequestConfig) => Promise<void>)
  | undefined;
let responseBody: ((grant: Grant) => Record<string, unknown>) | undefined;

function jwt(marker: string): string {
  return `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: marker, exp: 4070908800 })).toString("base64url")}.fixture-signature`;
}
function tokens(marker: string): StoredTokens {
  return {
    accessToken: jwt(marker),
    refreshToken: `${marker}-refresh`,
    refreshTokenExpiresAt: EXPIRY,
  };
}

function serializedUser(session: StoredTokens): Record<string, unknown> {
  return {
    ...serializedPasskeyUser,
    _miscData: session,
  };
}

function gate(): Gate {
  const callbacks: { release?: () => void } = {};
  const promise: Promise<void> = new Promise((resolve: () => void): void => {
    callbacks.release = resolve;
  });
  const release: () => void = (): void => {
    callbacks.release?.();
  };
  releases.push(release);
  return { promise, release };
}
function controller(): AbortController {
  const value: AbortController = new AbortController();
  controllers.push(value);
  return value;
}
function start(
  signal: AbortSignal,
  onProgress: (value: PasskeyProgress) => void = jest.fn(),
): Promise<LoginResponse | null> {
  const operation: Promise<LoginResponse | null> = signInWithPasskey({
    signal,
    onProgress,
  });
  operations.push(
    operation.catch((): undefined => {
      return undefined;
    }),
  );
  return operation;
}
function emit(url: string): void {
  for (const listener of listeners) {
    listener({ url });
  }
}
function issueGrant(url: string): Grant {
  const page: NodeURL = new NodeURL(url);
  if (
    page.pathname !== "/accounts/mobile-passkey" ||
    page.searchParams.get("codeChallengeMethod") !== "S256"
  ) {
    throw new Error("Wrong browser handoff contract");
  }
  const state: string = page.searchParams.get("state") || "";
  const challenge: string = page.searchParams.get("codeChallenge") || "";
  const code: string = randomBytes(32).toString("base64url");
  const callback: NodeURL = new NodeURL("oneuptime://passkey");
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  callback.searchParams.set("serverOrigin", page.origin);
  return {
    browserUrl: url,
    origin: page.origin,
    state,
    challenge,
    code,
    callback: callback.toString(),
    consumed: false,
  };
}
function httpResponse(
  config: InternalAxiosRequestConfig,
  data: Record<string, unknown>,
  status: number = 200,
): AxiosResponse {
  return {
    data: JSON.stringify(data),
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    headers: { "content-type": "application/json" },
    config,
  };
}

const transport: AxiosAdapter = async (
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> => {
  requests.push(config);
  if (config.url?.endsWith("/identity/login")) {
    return httpResponse(config, serializedUser(tokens("new-password")));
  }
  if (!config.url?.endsWith(EXCHANGE_PATH)) {
    throw new Error("Unexpected network request");
  }
  await beforeExchange?.(config);
  const data: Record<string, unknown> = JSON.parse(
    config.data as string,
  ) as Record<string, unknown>;
  const grant: Grant | undefined = grants.find((value: Grant): boolean => {
    return value.code === data["code"];
  });
  const verifier: string =
    typeof data["codeVerifier"] === "string" ? data["codeVerifier"] : "";
  const challenge: string = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  if (
    !grant ||
    grant.consumed ||
    config.url !== `${grant.origin}${EXCHANGE_PATH}` ||
    data["state"] !== grant.state ||
    challenge !== grant.challenge
  ) {
    throw new AxiosError(
      "Invalid authorization code or PKCE proof",
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      httpResponse(config, { message: "Invalid authorization code" }, 400),
    );
  }
  grant.consumed = true;
  return httpResponse(
    config,
    responseBody ? responseBody(grant) : serializedUser(tokens("passkey")),
  );
};

beforeEach(async () => {
  listeners = new Set<UrlListener>();
  grants = [];
  requests = [];
  controllers = [];
  releases = [];
  operations = [];
  beforeExchange = undefined;
  responseBody = undefined;
  storage.hooks = {};
  await clearTokens();
  await clearAllSsoTokens();
  await AsyncStorage.clear();
  await setServerUrl(CLOUD_ORIGIN);
  axios.defaults.adapter = transport;
  apiClient.defaults.adapter = transport;
  browser = async (
    grant: Grant,
  ): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    return { type: "success", url: grant.callback };
  };
  jest
    .mocked(Linking.addEventListener)
    .mockImplementation(
      (
        _event: "url",
        listener: UrlListener,
      ): ReturnType<typeof Linking.addEventListener> => {
        listeners.add(listener);
        return {
          remove: (): void => {
            listeners.delete(listener);
          },
        } as unknown as ReturnType<typeof Linking.addEventListener>;
      },
    );
  jest
    .mocked(WebBrowser.openAuthSessionAsync)
    .mockImplementation(
      async (url: string): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
        const grant: Grant = issueGrant(url);
        grants.push(grant);
        return await browser(grant);
      },
    );
});

afterEach(async () => {
  for (const value of controllers) {
    value.abort();
  }
  for (const release of releases) {
    release();
  }
  storage.hooks = {};
  await Promise.allSettled(operations);
  await clearTokens();
  await clearAllSsoTokens();
  axios.defaults.adapter = originalAdapter;
  apiClient.defaults.adapter = originalApiAdapter;
  expect(listeners.size).toBe(0);
});

test.each([CLOUD_ORIGIN, "https://Alerts.Acme.Internal:8443/"])(
  "completes the real native flow against %s with independently verified PKCE",
  async (server: string) => {
    await setServerUrl(server);
    await storeTokens(tokens("previous-user"));
    await storeGlobalSsoToken(jwt("previous-global-sso"));
    await storeSsoToken("previous-project", jwt("previous-project-sso"));
    const progress: jest.Mock = jest.fn();

    const result: LoginResponse | null = await start(
      controller().signal,
      progress,
    );

    expect(result?.user).toEqual({
      _id: USER_ID,
      email: "passkey@example.com",
      name: "Passkey Tester",
      isMasterAdmin: false,
    });
    expect(await getTokens()).toEqual(tokens("passkey"));
    expect(getCachedAccessToken()).toBe(tokens("passkey").accessToken);
    expect(progress.mock.calls).toEqual([
      ["preparing"],
      ["browser"],
      ["verifying"],
    ]);
    expect(requests).toHaveLength(1);
    const request: InternalAxiosRequestConfig = requests[0]!;
    const data: Record<string, string> = JSON.parse(
      request.data as string,
    ) as Record<string, string>;
    const grant: Grant = grants[0]!;
    expect(Object.keys(data).sort()).toEqual(["code", "codeVerifier", "state"]);
    expect(request.url).toBe(`${new NodeURL(server).origin}${EXCHANGE_PATH}`);
    expect(
      createHash("sha256").update(data["codeVerifier"]!).digest("base64url"),
    ).toBe(grant.challenge);
    expect(data["codeVerifier"]).toHaveLength(64);
    expect(data["state"]).not.toBe(data["codeVerifier"]);
    expect(request.headers.get("Authorization")).toBeUndefined();
    expect(request.headers.get("x-sso-tokens")).toBeUndefined();
    expect(request.headers.get("x-global-sso-token")).toBeUndefined();
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      grant.browserUrl,
      "oneuptime://passkey",
    );
    expect(
      [...new NodeURL(grant.browserUrl).searchParams.keys()].sort(),
    ).toEqual(["codeChallenge", "codeChallengeMethod", "state"]);
    expect([...new NodeURL(grant.callback).searchParams.keys()].sort()).toEqual(
      ["code", "serverOrigin", "state"],
    );
    for (const url of [grant.browserUrl, grant.callback]) {
      expect(url).not.toContain(data["codeVerifier"]!);
      expect(url).not.toContain(tokens("passkey").accessToken);
      expect(url).not.toContain(tokens("passkey").refreshToken);
    }
    for (const value of storage.values.values()) {
      expect(value).not.toContain(data["codeVerifier"]!);
      expect(value).not.toContain(grant.state);
    }
  },
);

test("a canceled browser's late callback cannot complete a newer attempt", async () => {
  const firstOpened: Gate = gate();
  const firstReturn: Gate = gate();
  const secondOpened: Gate = gate();
  const secondReturn: Gate = gate();
  browser = async (
    grant: Grant,
  ): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    if (grants.length === 1) {
      firstOpened.release();
      await firstReturn.promise;
    } else {
      secondOpened.release();
      await secondReturn.promise;
    }
    return { type: "success", url: grant.callback };
  };
  const firstController: AbortController = controller();
  const first: Promise<LoginResponse | null> = start(firstController.signal);
  await firstOpened.promise;
  firstController.abort();
  await expect(first).resolves.toBeNull();
  expect(requests).toHaveLength(0);
  expect(await getTokens()).toBeNull();
  const second: Promise<LoginResponse | null> = start(controller().signal);
  await secondOpened.promise;
  expect(grants[1]!.state).not.toBe(grants[0]!.state);
  emit(grants[0]!.callback);
  firstReturn.release();
  secondReturn.release();
  await expect(second).resolves.toMatchObject({
    accessToken: tokens("passkey").accessToken,
  });
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0]!.data as string)).toMatchObject({
    code: grants[1]!.code,
    state: grants[1]!.state,
  });
});

test("an Android dismiss followed by a deep link still exchanges exactly once", async () => {
  const browserReturned: Gate = gate();
  browser = async (): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    browserReturned.release();
    return { type: WebBrowser.WebBrowserResultType.DISMISS };
  };
  const operation: Promise<LoginResponse | null> = start(controller().signal);
  await browserReturned.promise;
  // Deliver the URL in a later native event turn, after dismiss was processed.
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
  expect(requests).toHaveLength(0);
  emit(grants[0]!.callback);
  emit(grants[0]!.callback);
  await expect(operation).resolves.toMatchObject({
    accessToken: tokens("passkey").accessToken,
  });
  expect(requests).toHaveLength(1);
  expect(await getTokens()).toEqual(tokens("passkey"));
});

test("canceling on the browser account page returns without exchanging a code or changing the session", async () => {
  await storeTokens(tokens("previous-user"));
  browser = async (
    grant: Grant,
  ): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    const callback: NodeURL = new NodeURL(grant.callback);
    callback.searchParams.delete("code");
    callback.searchParams.set("error", "access_denied");
    return { type: "success", url: callback.toString() };
  };
  await expect(start(controller().signal)).resolves.toBeNull();
  expect(requests).toHaveLength(0);
  expect(await getTokens()).toEqual(tokens("previous-user"));
  expect(getCachedAccessToken()).toBe(tokens("previous-user").accessToken);
});

test("a callback for a different server cannot choose where the app sends its verifier", async () => {
  browser = async (
    grant: Grant,
  ): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    const callback: NodeURL = new NodeURL(grant.callback);
    callback.searchParams.set("serverOrigin", "https://attacker.example");
    return { type: "success", url: callback.toString() };
  };
  await expect(start(controller().signal)).rejects.toThrow(
    /Could not open or complete/,
  );
  expect(requests).toHaveLength(0);
  expect(await getTokens()).toBeNull();
});

test("changing server while the browser is open abandons the old server's code", async () => {
  browser = async (
    grant: Grant,
  ): Promise<WebBrowser.WebBrowserAuthSessionResult> => {
    await setServerUrl("https://another.example.com");
    return { type: "success", url: grant.callback };
  };
  await expect(start(controller().signal)).rejects.toThrow(/server changed/);
  expect(requests).toHaveLength(0);
  expect(await getTokens()).toBeNull();
});

test("real Axios cancellation discards a late successful exchange response", async () => {
  const arrived: Gate = gate();
  const answer: Gate = gate();
  beforeExchange = async (): Promise<void> => {
    arrived.release();
    await answer.promise;
  };
  const abort: AbortController = controller();
  const operation: Promise<LoginResponse | null> = start(abort.signal);
  await arrived.promise;
  abort.abort();
  answer.release();
  await expect(operation).rejects.toMatchObject({ code: "ERR_CANCELED" });
  expect(await getTokens()).toBeNull();
  expect(getCachedAccessToken()).toBeNull();
});

test("a server change during exchange prevents the completed session from being stored", async () => {
  beforeExchange = async (): Promise<void> => {
    await setServerUrl("https://another.example.com");
  };
  await expect(start(controller().signal)).rejects.toThrow(/server changed/);
  expect(requests).toHaveLength(1);
  expect(await getTokens()).toBeNull();
  expect(getCachedAccessToken()).toBeNull();
});

test("missing session metadata rejects the complete flow before any token is persisted", async () => {
  responseBody = (): Record<string, unknown> => {
    return {
      ...serializedUser(tokens("passkey")),
      _miscData: { accessToken: tokens("passkey").accessToken },
    };
  };
  await expect(start(controller().signal)).rejects.toThrow(/did not complete/);
  expect(await getTokens()).toBeNull();
  expect(getCachedAccessToken()).toBeNull();
});

test("a device storage failure removes the partially installed cached session", async () => {
  storage.hooks.beforeWrite = async (key: string): Promise<void> => {
    if (key === TOKEN_KEY) {
      throw new Error("Device storage unavailable");
    }
  };
  await expect(start(controller().signal)).rejects.toThrow(
    "Device storage unavailable",
  );
  expect(await getTokens()).toBeNull();
  expect(getCachedAccessToken()).toBeNull();
});

test("canceling a pending passkey write cannot overwrite a newer real password login", async () => {
  const writeStarted: Gate = gate();
  const finishWrite: Gate = gate();
  storage.hooks.beforeWrite = async (
    key: string,
    value: string,
  ): Promise<void> => {
    if (
      key === TOKEN_KEY &&
      (JSON.parse(value) as StoredTokens).accessToken ===
        tokens("passkey").accessToken
    ) {
      writeStarted.release();
      await finishWrite.promise;
    }
  };
  const abort: AbortController = controller();
  const passkey: Promise<LoginResponse | null> = start(abort.signal);
  await writeStarted.promise;
  abort.abort();
  const password: Promise<LoginResponse> = login(
    "new@example.com",
    "new-password",
  );
  operations.push(
    password.catch((): undefined => {
      return undefined;
    }),
  );
  // The password response reaches the shared store while the old write is held.
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
  expect(getCachedAccessToken()).toBe(tokens("new-password").accessToken);
  finishWrite.release();
  await expect(passkey).resolves.toBeNull();
  await expect(password).resolves.toMatchObject({
    accessToken: tokens("new-password").accessToken,
  });
  expect(await getTokens()).toEqual(tokens("new-password"));
  expect(getCachedAccessToken()).toBe(tokens("new-password").accessToken);
});

test("an already queued passkey cleanup cannot erase a subsequent real SSO login", async () => {
  const cleanupStarted: Gate = gate();
  const finishCleanup: Gate = gate();
  const abort: AbortController = controller();
  storage.hooks.afterWrite = async (
    key: string,
    value: string,
  ): Promise<void> => {
    if (
      key === TOKEN_KEY &&
      (JSON.parse(value) as StoredTokens).accessToken ===
        tokens("passkey").accessToken
    ) {
      abort.abort();
    }
  };
  storage.hooks.beforeRemove = async (key: string): Promise<void> => {
    if (key === TOKEN_KEY) {
      cleanupStarted.release();
      await finishCleanup.promise;
    }
  };
  const passkey: Promise<LoginResponse | null> = start(abort.signal);
  await cleanupStarted.promise;
  const session: StoredTokens = tokens("new-sso");
  const ssoUrl: NodeURL = new NodeURL("oneuptime://sso-callback");
  for (const [key, value] of Object.entries(session)) {
    ssoUrl.searchParams.set(key, value);
  }
  ssoUrl.searchParams.set("globalSsoToken", jwt("new-global-sso"));
  const sso: ReturnType<typeof completeSsoLoginFromUrl> =
    completeSsoLoginFromUrl(ssoUrl.toString());
  operations.push(sso);
  expect(getCachedAccessToken()).toBe(session.accessToken);
  finishCleanup.release();
  await expect(passkey).resolves.toBeNull();
  await expect(sso).resolves.toMatchObject({
    status: "success",
    isGlobal: true,
  });
  expect(await getTokens()).toEqual(session);
  expect(getCachedAccessToken()).toBe(session.accessToken);
  expect(getCachedGlobalSsoToken()).toBe(jwt("new-global-sso"));
});
