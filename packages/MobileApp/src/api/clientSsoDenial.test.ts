import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens } from "../storage/keychain";
import { setServerUrl } from "../storage/serverUrl";
import { clearAllSsoTokens } from "../storage/ssoTokens";
import {
  completeSsoLoginFromUrl,
  type CompleteSsoLoginOutcome,
} from "../sso/session";
import {
  clearAllSsoDenials,
  getSsoDeniedProjectIds,
  isProjectSsoDenied,
  subscribeToSsoDenials,
} from "../sso/ssoDenials";
import apiClient from "./client";
import {
  AxiosError,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The 406 half of the API client's response interceptor.
 *
 * 406 is ExceptionCode.SsoAuthorizationException
 * (Common/Types/Exception/ExceptionCode.ts): the server saying "this project
 * requires an SSO login you have not completed". Before this handling existed
 * the app had no idea which projects were refused - it inferred SSO status
 * from what was in storage ("a global token exists, therefore every project is
 * fine"), which is wrong the moment the token lapses, the provider is
 * disabled, or an admin restricts the provider to its attached projects. Every
 * screen then rendered its own dead-end error string.
 *
 * So this file drives the REAL interceptor in src/api/client.ts, the same way
 * clientSsoHeaders.test.ts does - by handing axios a custom `config.adapter`,
 * which receives the fully assembled request after every request interceptor
 * has run, and gets to decide what the "server" answers. Nothing is
 * re-implemented and no socket is opened.
 *
 * Two contracts are pinned here rather than imported, because both are shared
 * with code that ships separately:
 *
 *   406        - the numeric status the server uses for SSO refusal.
 *   `tenantid` - the request header every project-scoped call in src/api/*.ts
 *                sets, and the ONLY thing that tells the interceptor which
 *                project was refused.
 *
 * Every negative assertion below ("nothing was recorded") is paired, in the
 * same test, with the positive control that differs by exactly the one thing
 * under test - otherwise an interceptor that recorded nothing at all would
 * satisfy the whole file.
 */

const SSO_AUTHORIZATION_STATUS: number = 406;
const TENANT_HEADER: string = "tenantid";

const PROJECT_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** ASCII -> base64url (JWT flavour: no padding, `-`/`_` for `+`/`/`). */
function toBase64Url(value: string): string {
  let output: string = "";
  let buffer: number = 0;
  let bitsInBuffer: number = 0;

  for (let index: number = 0; index < value.length; index++) {
    buffer = (buffer << 8) | (value.charCodeAt(index) & 0xff);
    bitsInBuffer += 8;

    while (bitsInBuffer >= 6) {
      bitsInBuffer -= 6;
      output += BASE64_ALPHABET[(buffer >> bitsInBuffer) & 0x3f];
    }
  }

  if (bitsInBuffer > 0) {
    output += BASE64_ALPHABET[(buffer << (6 - bitsInBuffer)) & 0x3f];
  }

  return output.replace(/\+/g, "-").replace(/\//g, "_");
}

/*
 * A real three-segment JWT, valid for 30 days - the lifetime the server signs
 * SSO tokens for. The storage layer evicts anything `isJwtExpired` rejects,
 * which includes anything that is not a well-formed JWT, so a fixture string
 * like "token-1" would vanish for reasons unrelated to what is being tested.
 */
function freshJwt(subject: string): string {
  const header: string = toBase64Url(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  );
  const payload: string = toBase64Url(
    JSON.stringify({
      sub: subject,
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }),
  );

  return `${header}.${payload}.not-verified-by-the-app`;
}

function buildCallbackUrl(params: Record<string, string>): string {
  const query: string = Object.keys(params)
    .map((key: string): string => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(params[key]!)}`;
    })
    .join("&");

  return `oneuptime://sso-callback?${query}`;
}

/** The auth tokens every SSO callback carries, whatever its flavour. */
function authParams(): Record<string, string> {
  return {
    accessToken: freshJwt("access"),
    refreshToken: freshJwt("refresh"),
    refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

let sentConfigs: Array<InternalAxiosRequestConfig> = [];

/*
 * The exact error object the fake server rejected with. Held so a test can
 * assert the caller received THAT object rather than merely "some rejection" -
 * an interceptor that caught the error, recorded the denial and then threw
 * something of its own would still reject, and would still be a bug.
 */
let lastAdapterError: AxiosError | null = null;

function adapterFor(
  status: number,
): (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> {
  return (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    sentConfigs.push(config);

    const response: AxiosResponse = {
      data: { message: `server said ${status}` },
      status,
      statusText: String(status),
      headers: {},
      config,
    } as AxiosResponse;

    if (status >= 200 && status < 300) {
      return Promise.resolve(response);
    }

    const error: AxiosError = new AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config,
      undefined,
      response,
    );

    lastAdapterError = error;

    return Promise.reject(error);
  };
}

type Settled =
  | { outcome: "resolved"; response: AxiosResponse }
  | { outcome: "rejected"; error: unknown };

interface CallOptions {
  status: number;
  /*
   * Omitted entirely = the request carries no tenantid at all (an
   * instance-level call such as /api/project or the SSO status endpoints).
   * Passing "" = the header is present but empty.
   */
  tenantId?: string;
  /*
   * Header name to send the project id under. Defaults to the lowercase
   * `tenantid` every src/api module uses today; overridden by the casing
   * tests below.
   */
  tenantHeaderName?: string;
  /*
   * Marks the request as one the 401 refresh path has already retried, which
   * is how the interceptor short-circuits without going near the network.
   */
  alreadyRetried?: boolean;
  url?: string;
}

/**
 * Issues one request through the real client and reports how it settled.
 *
 * Deliberately does not rethrow: several tests need to assert both "the caller
 * saw the rejection" and "the denial was recorded", and swallowing the error
 * here would make the first of those untestable.
 */
async function call(options: CallOptions): Promise<Settled> {
  const config: AxiosRequestConfig & { _retry?: boolean } = {
    adapter: adapterFor(options.status),
  };

  if (options.tenantId !== undefined) {
    config.headers = {
      [options.tenantHeaderName || TENANT_HEADER]: options.tenantId,
    };
  }

  if (options.alreadyRetried) {
    config._retry = true;
  }

  try {
    const response: AxiosResponse = await apiClient.get(
      options.url || "/api/monitor",
      config,
    );

    return { outcome: "resolved", response };
  } catch (error) {
    return { outcome: "rejected", error };
  }
}

function lastRequest(): InternalAxiosRequestConfig {
  return sentConfigs[sentConfigs.length - 1]!;
}

/**
 * Reads a header off a captured request the way an HTTP server does -
 * case-insensitively - so a test can tell "absent" from "present and empty".
 */
function headerOf(config: InternalAxiosRequestConfig, name: string): unknown {
  const headers: Record<string, unknown> = config.headers as unknown as Record<
    string,
    unknown
  >;

  const key: string | undefined = Object.keys(headers).find(
    (candidate: string): boolean => {
      return candidate.toLowerCase() === name.toLowerCase();
    },
  );

  return key === undefined ? undefined : headers[key];
}

function deniedIds(): Array<string> {
  return [...getSsoDeniedProjectIds()].sort();
}

/*
 * The denial set, the AsyncStorage fake and both storage caches are all
 * module-level and survive between tests. All of them are reset, or a test
 * inherits the previous one's denials and passes for the wrong reason.
 *
 * Clearing the keychain matters for a second reason: a 401 that has NOT
 * already been retried drives the real refresh path, and that path only stays
 * offline because getTokens() finds no refresh token and fails immediately.
 */
beforeEach(async () => {
  sentConfigs = [];
  lastAdapterError = null;
  clearAllSsoDenials();
  await AsyncStorage.clear();
  await clearAllSsoTokens();
  await clearTokens();
  await setServerUrl("https://test.oneuptime.local");
});

afterEach(() => {
  clearAllSsoDenials();
});

describe("a 406 marks the project it names", () => {
  test("records the project from the tenantid header", async () => {
    const settled: Settled = await call({
      status: SSO_AUTHORIZATION_STATUS,
      tenantId: PROJECT_A,
    });

    expect(settled.outcome).toBe("rejected");
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(deniedIds()).toEqual([PROJECT_A]);

    // The refusal is about one project, not the whole session.
    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
  });

  test("reads the same header name the API modules actually send", async () => {
    /*
     * client.ts indexes `originalRequest.headers["tenantid"]` directly. Every
     * project-scoped call in src/api/*.ts sends exactly that spelling. If
     * either side drifted, the interceptor would quietly record nothing and
     * the user would be back to an unexplained error on every screen.
     */
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(headerOf(lastRequest(), TENANT_HEADER)).toBe(PROJECT_A);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
  });

  test("still rejects with the server's own error", async () => {
    /*
     * Recording a denial must not swallow the failure. A caller that got a
     * resolved promise here would render an empty list as if the project had
     * no incidents, instead of showing the SSO prompt.
     */
    const settled: Settled = await call({
      status: SSO_AUTHORIZATION_STATUS,
      tenantId: PROJECT_A,
    });

    expect(settled.outcome).toBe("rejected");

    const error: unknown = (settled as { error: unknown }).error;

    expect(error).toBe(lastAdapterError);
    expect((error as AxiosError).response?.status).toBe(
      SSO_AUTHORIZATION_STATUS,
    );
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
  });

  test("marks the project before the caller is told", async () => {
    /*
     * The screens read isProjectSsoDenied() in the same catch block that
     * receives this rejection. If the recording were deferred (a floating
     * promise, a setTimeout), the first render after the failure would still
     * show the old state and the prompt would appear only on the next one.
     */
    let deniedWhenCallerSawIt: boolean = false;

    await apiClient
      .get("/api/monitor", {
        adapter: adapterFor(SSO_AUTHORIZATION_STATUS),
        headers: { [TENANT_HEADER]: PROJECT_A },
      })
      .catch((): void => {
        deniedWhenCallerSawIt = isProjectSsoDenied(PROJECT_A);
      });

    expect(deniedWhenCallerSawIt).toBe(true);
  });
});

describe("a 406 with no project to blame records nothing", () => {
  test("a request with no tenantid header records nothing and does not throw", async () => {
    /*
     * Instance-level endpoints (project list, SSO status) carry no tenantid.
     * A 406 from one of those names no project, and inventing one - or
     * blowing up reading an absent header - would be worse than recording
     * nothing.
     */
    const settled: Settled = await call({ status: SSO_AUTHORIZATION_STATUS });

    expect(headerOf(lastRequest(), TENANT_HEADER)).toBeUndefined();
    expect(deniedIds()).toEqual([]);

    // The 406 itself is still surfaced - it is the server's error, not ours.
    expect(settled.outcome).toBe("rejected");
    expect((settled as { error: unknown }).error).toBe(lastAdapterError);

    // Positive control: the identical call WITH a tenantid does record.
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });

  test("an empty-string tenantid records nothing", async () => {
    /*
     * An empty tenantid is what a screen sends when its selected project has
     * not loaded yet. Recording "" would put a project id of "" in the denial
     * set, which no screen can ever clear because no screen has that id.
     */
    const settled: Settled = await call({
      status: SSO_AUTHORIZATION_STATUS,
      tenantId: "",
    });

    /*
     * Asserted, not assumed: axios keeps an empty header rather than dropping
     * it, so the interceptor really does see `""` and really does have to
     * reject it on its own. If a future axios stopped sending it, this test
     * would silently become a duplicate of the no-header one.
     */
    expect(headerOf(lastRequest(), TENANT_HEADER)).toBe("");

    expect(deniedIds()).toEqual([]);
    expect(isProjectSsoDenied("")).toBe(false);
    expect(settled.outcome).toBe("rejected");

    // Positive control: same request, same status, a real tenant id.
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });
});

describe("only 406 records a denial", () => {
  test("a successful response records nothing", async () => {
    const settled: Settled = await call({ status: 200, tenantId: PROJECT_A });

    expect(settled.outcome).toBe("resolved");
    expect(deniedIds()).toEqual([]);

    // Positive control: the same project, the same request, status 406.
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });

  test("400, 403 and 500 record nothing", async () => {
    /*
     * A denial is a durable claim about the project: the UI stops offering the
     * data and starts offering an SSO button. A validation error, an ordinary
     * permission failure or a server crash must not produce that - the user
     * would be sent off to re-authenticate against a provider that was never
     * the problem, and the denial would survive the login that could not fix
     * it.
     */
    for (const status of [400, 403, 500]) {
      const settled: Settled = await call({ status, tenantId: PROJECT_A });

      expect(settled.outcome).toBe("rejected");
      expect(deniedIds()).toEqual([]);
    }

    // Positive control: the one status that does mean "SSO required".
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });

  test("a 401 that has already been retried records nothing", async () => {
    /*
     * `_retry` is the flag the refresh path sets before replaying a request,
     * so this is the shape a 401 has after the refresh already happened. It
     * short-circuits before the refresh block, which keeps this test off the
     * network entirely.
     */
    const settled: Settled = await call({
      status: 401,
      tenantId: PROJECT_A,
      alreadyRetried: true,
    });

    expect(settled.outcome).toBe("rejected");
    expect(deniedIds()).toEqual([]);

    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });

  test("a 401 that drives the refresh path records nothing", async () => {
    /*
     * The un-retried 401 is the interesting one: it runs the real refresh
     * block. There is no refresh token stored (beforeEach clears the
     * keychain), so getTokens() returns null, the block throws before it can
     * reach out to /identity/refresh-token, and the original 401 is rejected.
     * No socket, no hang - and still no denial, because 401 means "your
     * session lapsed", not "this project needs SSO".
     */
    const settled: Settled = await call({ status: 401, tenantId: PROJECT_A });

    expect(settled.outcome).toBe("rejected");
    expect((settled as { error: unknown }).error).toBe(lastAdapterError);
    expect(deniedIds()).toEqual([]);

    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(deniedIds()).toEqual([PROJECT_A]);
  });
});

describe("denials accumulate per project", () => {
  test("two projects both refused are both recorded", async () => {
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

    expect(deniedIds()).toEqual([PROJECT_A, PROJECT_B]);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(true);
  });

  test("the same project refused repeatedly is recorded once and announced once", async () => {
    /*
     * A screen with three panels produces three 406s for one project. Each
     * one re-entering the denial set would be harmless, but each one
     * re-notifying subscribers would re-render every subscribed screen for no
     * change - which is exactly the kind of thing that turns an error state
     * into a render loop.
     */
    let notifications: number = 0;

    const unsubscribe: () => void = subscribeToSsoDenials((): void => {
      notifications++;
    });

    try {
      await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
      await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
      await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

      expect(deniedIds()).toEqual([PROJECT_A]);
      expect(notifications).toBe(1);

      /*
       * Positive control for the notification count: the de-duplication is
       * per project, not a subscriber that stopped listening after one event.
       */
      await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

      expect(deniedIds()).toEqual([PROJECT_A, PROJECT_B]);
      expect(notifications).toBe(2);
    } finally {
      unsubscribe();
    }
  });
});

describe("an SSO login turns a denial back into a working project", () => {
  test("a global token callback clears every denial", async () => {
    /*
     * A Global SSO/OIDC token is not bound to a project and the app cannot
     * tell from the token which projects it satisfies - so the only correct
     * move is to drop every denial and let the server answer again. Clearing
     * just one would leave the other projects showing an SSO prompt the user
     * has already satisfied.
     */
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

    expect(deniedIds()).toEqual([PROJECT_A, PROJECT_B]);

    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
      }),
    );

    expect(outcome.status).toBe("success");
    expect(outcome).toMatchObject({ isGlobal: true, projectId: null });
    expect(deniedIds()).toEqual([]);
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
  });

  test("a project token callback clears only that project", async () => {
    /*
     * The mirror image: a project-scoped login proves nothing about any other
     * project. Clearing all of them here would hide a genuine denial until the
     * next request re-earned it, and the user would see a project flip from
     * "ready" to "SSO required" for no visible reason.
     */
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

    const outcome: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        projectId: PROJECT_A,
        ssoToken: freshJwt("project-sso"),
      }),
    );

    expect(outcome).toMatchObject({
      status: "success",
      isGlobal: false,
      projectId: PROJECT_A,
    });
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(true);
    expect(deniedIds()).toEqual([PROJECT_B]);
  });

  test("a callback the server rejected clears nothing", async () => {
    /*
     * A failed login has fixed nothing. Clearing on the way out would make the
     * app forget the refusal and go straight back to showing the project as
     * usable - until the next request 406'd again.
     */
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

    const failed: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      buildCallbackUrl({
        error: "sso_failed",
        errorDescription: "IdP refused the assertion",
      }),
    );

    expect(failed.status).toBe("error");
    expect(deniedIds()).toEqual([PROJECT_A, PROJECT_B]);

    /*
     * Positive control: the denials were clearable the whole time - it is the
     * failure, not the state, that stopped them being cleared.
     */
    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
      }),
    );

    expect(deniedIds()).toEqual([]);
  });

  test("a callback with nothing usable in it clears nothing", async () => {
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    const missingTokens: CompleteSsoLoginOutcome =
      await completeSsoLoginFromUrl(
        buildCallbackUrl({ globalSsoToken: freshJwt("global-sso") }),
      );

    expect(missingTokens.status).toBe("error");
    expect(deniedIds()).toEqual([PROJECT_A]);

    const notACallback: CompleteSsoLoginOutcome = await completeSsoLoginFromUrl(
      "https://example.com/not-a-callback",
    );

    expect(notACallback.status).toBe("error");
    expect(deniedIds()).toEqual([PROJECT_A]);

    // Positive control: a well-formed global callback does clear it.
    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
      }),
    );

    expect(deniedIds()).toEqual([]);
  });

  test("a project refused again after a login is recorded again", async () => {
    /*
     * The whole loop, in one test: refused -> logged in -> cleared -> refused
     * again. Clearing on login is optimistic ("this login may have fixed it"),
     * so the server has to be able to say no a second time. A one-shot denial
     * set would leave the app permanently believing the project was fine.
     */
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);

    await completeSsoLoginFromUrl(
      buildCallbackUrl({
        ...authParams(),
        globalSsoToken: freshJwt("global-sso"),
      }),
    );

    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);

    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
  });
});

/*
 * Axios keeps a header under exactly the casing the caller wrote it in, so a
 * raw `headers["tenantid"]` index only ever finds the lowercase spelling. Every
 * src/api module happens to use lowercase today, which is precisely what makes
 * this a trap: the next one written as `tenantId` - the natural spelling in a
 * TypeScript codebase - would 406 and record nothing, leaving the user back at
 * the dead end this whole feature exists to remove.
 */
describe("the project id is found whatever casing the caller used", () => {
  test.each([
    ["tenantid"],
    ["tenantId"],
    ["TenantId"],
    ["TENANTID"],
    ["Tenantid"],
  ])(
    "a 406 on a request sending %s records the denial",
    async (headerName: string) => {
      const settled: Settled = await call({
        status: SSO_AUTHORIZATION_STATUS,
        tenantId: PROJECT_A,
        tenantHeaderName: headerName,
      });

      expect(settled.outcome).toBe("rejected");
      expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
    },
  );

  test("a header whose name merely contains 'tenantid' is not treated as one", async () => {
    // Guards the fallback scan against matching `x-tenantid-hint` and friends.
    const settled: Settled = await call({
      status: SSO_AUTHORIZATION_STATUS,
      tenantId: PROJECT_A,
      tenantHeaderName: "x-tenantid-hint",
    });

    expect(settled.outcome).toBe("rejected");
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
  });
});

/*
 * A denial is the server's word, but so is a success. If an admin re-enables a
 * provider (or drops restrictToAttachedProjects) while the user's 30-day token
 * is still valid, requests start succeeding - and without this the project
 * would keep showing "Authenticate with SSO" until the app was relaunched.
 */
describe("a successful response retires an earlier denial", () => {
  test("a 2xx for a denied project clears it", async () => {
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);

    const settled: Settled = await call({ status: 200, tenantId: PROJECT_A });

    expect(settled.outcome).toBe("resolved");
    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
  });

  test("it clears only the project it names", async () => {
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_B });

    await call({ status: 200, tenantId: PROJECT_A });

    expect(isProjectSsoDenied(PROJECT_A)).toBe(false);
    expect(isProjectSsoDenied(PROJECT_B)).toBe(true);
  });

  test("a 2xx with no tenantid leaves every denial alone", async () => {
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    await call({ status: 200 });

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
  });

  test("a 2xx for a project that was never denied is a no-op", async () => {
    const settled: Settled = await call({ status: 200, tenantId: PROJECT_B });

    expect(settled.outcome).toBe("resolved");
    expect(isProjectSsoDenied(PROJECT_B)).toBe(false);
  });

  test("a denial recorded after a success is still recorded", async () => {
    // The two directions must not fight: last word wins, in order.
    await call({ status: 200, tenantId: PROJECT_A });
    await call({ status: SSO_AUTHORIZATION_STATUS, tenantId: PROJECT_A });

    expect(isProjectSsoDenied(PROJECT_A)).toBe(true);
  });
});
