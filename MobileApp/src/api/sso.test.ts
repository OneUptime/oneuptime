import axios from "axios";
import { getServerUrl } from "../storage/serverUrl";
import { buildSsoLoginUrl } from "../sso/providerUrl";
import {
  GlobalSSOProvider,
  SSOProvider,
  SsoDiscoveryResult,
  fetchAllGlobalProviders,
  fetchGlobalOIDCProviders,
  fetchGlobalSSOProviders,
  fetchProjectOIDCProviders,
  fetchProjectProvidersForEmail,
  fetchSSOProviders,
  fetchSSOProvidersForProject,
} from "./sso";
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("axios", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
});

/*
 * The server address is whatever the responder typed on the first screen -
 * a self-hosted instance more often than not - so every discovery URL below
 * has to be built from storage rather than from a compiled-in host.
 */
const SERVER_URL: string = "https://test.oneuptime.com";

jest.mock("../storage/serverUrl", () => {
  return {
    __esModule: true,
    getServerUrl: jest.fn(async () => {
      return "https://test.oneuptime.com";
    }),
  };
});

function getSpy(): jest.SpyInstance {
  return axios.get as unknown as jest.SpyInstance;
}

function postSpy(): jest.SpyInstance {
  return axios.post as unknown as jest.SpyInstance;
}

function serverUrlSpy(): jest.SpyInstance {
  return getServerUrl as unknown as jest.SpyInstance;
}

function firstGetUrl(): string {
  return getSpy().mock.calls[0]![0] as string;
}

function firstGetConfig(): Record<string, unknown> {
  return getSpy().mock.calls[0]![1] as Record<string, unknown>;
}

/** Resolve every axios.get with this body, whichever URL is asked for. */
function respondWith(data: unknown): void {
  getSpy().mockResolvedValue({ data } as never);
}

type Outcome = { data: unknown } | Error;

/*
 * Route the two global discovery calls independently. fetchAllGlobalProviders
 * fires them in parallel, so the only way to describe "SAML answered, OIDC
 * did not" is to key off the URL.
 */
function stubGlobalEndpoints(saml: Outcome, oidc: Outcome): void {
  getSpy().mockImplementation((url: string): Promise<unknown> => {
    const outcome: Outcome = url.includes("/global-sso/") ? saml : oidc;

    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }

    return Promise.resolve(outcome);
  });
}

/** A discovery payload in the shape the server actually sends. */
function wrapped(items: Array<unknown>): { data: Array<unknown> } {
  return { data: items };
}

beforeEach(() => {
  getSpy().mockReset();
  postSpy().mockReset();
  serverUrlSpy().mockReset();
  serverUrlSpy().mockResolvedValue(SERVER_URL as never);
});

describe("The global discovery endpoints are the ones the server registers", () => {
  /*
   * These two literals are a contract with
   * App/FeatureSet/Identity/API/GlobalSSO.ts ("/global-sso/service-provider-login")
   * and GlobalOIDC.ts ("/global-oidc/service-provider-login"). A typo here does
   * not fail to compile and does not throw: the request 404s, discovery is
   * caught as "endpoint down", and the login screen simply offers no global
   * providers at all - which looks exactly like an instance that has none.
   */
  test("global SAML discovery GETs /identity/global-sso/service-provider-login", async () => {
    respondWith(wrapped([]));

    await fetchGlobalSSOProviders();

    expect(firstGetUrl()).toBe(
      `${SERVER_URL}/identity/global-sso/service-provider-login`,
    );
  });

  test("global OIDC discovery GETs /identity/global-oidc/service-provider-login", async () => {
    respondWith(wrapped([]));

    await fetchGlobalOIDCProviders();

    expect(firstGetUrl()).toBe(
      `${SERVER_URL}/identity/global-oidc/service-provider-login`,
    );
  });

  test("the base URL comes from the stored server, not a hard-coded host", async () => {
    serverUrlSpy().mockResolvedValue("https://status.acme.internal" as never);
    respondWith(wrapped([]));

    await fetchGlobalSSOProviders();

    expect(firstGetUrl()).toBe(
      "https://status.acme.internal/identity/global-sso/service-provider-login",
    );
  });

  test("discovery carries a timeout so an unreachable host cannot wedge the screen", async () => {
    /*
     * Global discovery runs unprompted while the login screen is drawing. With
     * no timeout an IdP host that accepts the connection and never answers
     * leaves the buttons in a spinner forever rather than falling through to
     * the password form.
     */
    respondWith(wrapped([]));

    await fetchGlobalSSOProviders();

    expect(firstGetConfig()["timeout"]).toBe(15000);
  });

  test("global discovery sends no email - the providers are instance-wide", async () => {
    /*
     * Project SSO is discovered per email address; global SSO is not scoped to
     * one, and sending an email here would imply a filter the server does not
     * apply.
     */
    respondWith(wrapped([]));

    await fetchGlobalSSOProviders();

    expect(firstGetConfig()["params"]).toBeUndefined();
  });
});

describe("Discovery tolerates both payload shapes the server can produce", () => {
  /*
   * The route answers through sendEntityArrayResponse, which wraps the list in
   * `{ data: [...] }` - but middleware in front of it has shipped a bare array
   * before. Handling only one of the two turns a working instance into one
   * with "no SSO providers", with nothing logged.
   */
  test("accepts the wrapped { data: [...] } payload", async () => {
    respondWith(wrapped([{ _id: "a", name: "Okta" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("Okta");
  });

  test("accepts a bare array payload", async () => {
    respondWith([{ _id: "a", name: "Okta" }]);

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("Okta");
  });

  test("an empty wrapped list is an empty list, not an error", async () => {
    respondWith(wrapped([]));

    await expect(fetchGlobalSSOProviders()).resolves.toEqual([]);
  });

  test("an empty bare array is an empty list", async () => {
    respondWith([]);

    await expect(fetchGlobalOIDCProviders()).resolves.toEqual([]);
  });

  test("a null body yields an empty list instead of throwing", async () => {
    /*
     * A 204, or a proxy that returns an empty body, arrives as null. Throwing
     * here would be reported as an outage; it is not one.
     */
    respondWith(null);

    await expect(fetchGlobalSSOProviders()).resolves.toEqual([]);
  });

  test("an undefined body yields an empty list instead of throwing", async () => {
    respondWith(undefined);

    await expect(fetchGlobalOIDCProviders()).resolves.toEqual([]);
  });

  test("a body whose data is not an array yields an empty list", async () => {
    // e.g. an error envelope, `{ message: "..." }`, served with a 200.
    respondWith({ data: { message: "unauthorized" } });

    await expect(fetchGlobalSSOProviders()).resolves.toEqual([]);
  });
});

describe("ObjectID fields are de-serialised to plain strings", () => {
  /*
   * OneUptime serialises every id as { _type: "ObjectID", value: "<uuid>" }.
   * The id is pasted straight into the IdP login URL
   * (/identity/global-sso/:id), so an object that survives parsing becomes the
   * literal "[object Object]" in the URL and the login 404s at the IdP.
   */
  test("an _id sent as an ObjectID envelope becomes the bare uuid", async () => {
    respondWith(
      wrapped([
        {
          _id: {
            _type: "ObjectID",
            value: "0f7a4f4a-1c2b-4d3e-9a8b-7c6d5e4f3a2b",
          },
          name: "Okta",
        },
      ]),
    );

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!._id).toBe("0f7a4f4a-1c2b-4d3e-9a8b-7c6d5e4f3a2b");
  });

  test("an _id that is already a plain string is left alone", async () => {
    respondWith(wrapped([{ _id: "plain-string-id", name: "Okta" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!._id).toBe("plain-string-id");
  });

  test("a missing _id becomes an empty string rather than undefined", async () => {
    respondWith(wrapped([{ name: "Okta" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!._id).toBe("");
  });
});

describe("The type discriminator is stamped by the endpoint, not the payload", () => {
  /*
   * The discovery payload carries only id/name/description - no type. The
   * `type` is what picks the login route later (/identity/global-sso/:id vs
   * /identity/global-oidc/:id), so getting it from the endpoint that answered
   * is the only thing keeping a SAML provider from being sent through the OIDC
   * flow.
   */
  test("every provider from the SAML endpoint is typed global-sso", async () => {
    respondWith(wrapped([{ _id: "a", name: "Okta" }, { _id: "b" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(
      providers.map((provider: GlobalSSOProvider) => {
        return provider.type;
      }),
    ).toEqual(["global-sso", "global-sso"]);
  });

  test("every provider from the OIDC endpoint is typed global-oidc", async () => {
    respondWith(wrapped([{ _id: "a", name: "Entra" }, { _id: "b" }]));

    const providers: Array<GlobalSSOProvider> =
      await fetchGlobalOIDCProviders();

    expect(
      providers.map((provider: GlobalSSOProvider) => {
        return provider.type;
      }),
    ).toEqual(["global-oidc", "global-oidc"]);
  });

  test("a type field in the payload never overrides the endpoint that answered", async () => {
    /*
     * Nothing on the server sends this field today. If something ever starts -
     * or a stale cached body carries one - the endpoint still has to win, or a
     * SAML provider would be started through the OIDC route.
     */
    respondWith(wrapped([{ _id: "a", name: "Okta", type: "global-oidc" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!.type).toBe("global-sso");
  });
});

describe("Provider labels survive a sparse payload", () => {
  test("a missing name becomes an empty string, never undefined", async () => {
    /*
     * The name is rendered as the button label. undefined renders as nothing
     * on iOS and crashes some list rows; "" at least renders an empty,
     * tappable button.
     */
    respondWith(wrapped([{ _id: "a" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!.name).toBe("");
  });

  test("a null name becomes an empty string too", async () => {
    respondWith(wrapped([{ _id: "a", name: null }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!.name).toBe("");
  });

  test("the description is passed through untouched", async () => {
    respondWith(
      wrapped([{ _id: "a", name: "Okta", description: "Corp directory" }]),
    );

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!.description).toBe("Corp directory");
  });

  test("a missing description stays undefined so the row can omit it", async () => {
    respondWith(wrapped([{ _id: "a", name: "Okta" }]));

    const providers: Array<GlobalSSOProvider> = await fetchGlobalSSOProviders();

    expect(providers[0]!.description).toBeUndefined();
  });
});

describe("fetchAllGlobalProviders keeps a half-broken instance usable", () => {
  const samlPayload: { data: Array<unknown> } = wrapped([
    { _id: "saml-1", name: "Okta" },
  ]);
  const oidcPayload: { data: Array<unknown> } = wrapped([
    { _id: "oidc-1", name: "Entra" },
  ]);

  test("both endpoints answering: SAML first, then OIDC, and failed is false", async () => {
    /*
     * Order is stable on purpose - the select screen lists them in this order,
     * and Promise.all preserves it regardless of which request returns first.
     */
    stubGlobalEndpoints({ data: samlPayload }, { data: oidcPayload });

    const result: SsoDiscoveryResult<GlobalSSOProvider> =
      await fetchAllGlobalProviders();

    expect(result.failed).toBe(false);
    expect(
      result.providers.map((provider: GlobalSSOProvider) => {
        return [provider.name, provider.type];
      }),
    ).toEqual([
      ["Okta", "global-sso"],
      ["Entra", "global-oidc"],
    ]);
  });

  test("only SAML failing still returns the OIDC providers, and failed is false", async () => {
    /*
     * One endpoint down is not an outage the user can do anything about, and
     * the other half of the screen still logs them in. Reporting failure here
     * would hide a working login behind a retry prompt.
     */
    stubGlobalEndpoints(new Error("saml 500"), { data: oidcPayload });

    const result: SsoDiscoveryResult<GlobalSSOProvider> =
      await fetchAllGlobalProviders();

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.type).toBe("global-oidc");
  });

  test("only OIDC failing still returns the SAML providers, and failed is false", async () => {
    stubGlobalEndpoints({ data: samlPayload }, new Error("oidc timeout"));

    const result: SsoDiscoveryResult<GlobalSSOProvider> =
      await fetchAllGlobalProviders();

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.type).toBe("global-sso");
  });

  test("both endpoints failing is the only case reported as failed", async () => {
    stubGlobalEndpoints(new Error("offline"), new Error("offline"));

    const result: SsoDiscoveryResult<GlobalSSOProvider> =
      await fetchAllGlobalProviders();

    expect(result.failed).toBe(true);
    expect(result.providers).toEqual([]);
  });

  test("an instance with no global SSO at all is empty but NOT failed", async () => {
    /*
     * The distinction the whole SsoDiscoveryResult type exists for: "your
     * instance has no SSO" and "we could not reach your server" are the same
     * empty list, and only the second is worth a retry button.
     */
    stubGlobalEndpoints({ data: wrapped([]) }, { data: wrapped([]) });

    const result: SsoDiscoveryResult<GlobalSSOProvider> =
      await fetchAllGlobalProviders();

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test("both endpoints are asked, not just the first one that answers", async () => {
    stubGlobalEndpoints({ data: samlPayload }, { data: oidcPayload });

    await fetchAllGlobalProviders();

    const urls: Array<string> = getSpy().mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as string;
      },
    );

    expect(urls).toHaveLength(2);
    expect(urls).toContain(
      `${SERVER_URL}/identity/global-sso/service-provider-login`,
    );
    expect(urls).toContain(
      `${SERVER_URL}/identity/global-oidc/service-provider-login`,
    );
  });
});

describe("fetchProjectProvidersForEmail separates 'none' from 'unreachable'", () => {
  test("sends the email as a query param to the project discovery route", async () => {
    respondWith({ data: [] });

    await fetchProjectProvidersForEmail("responder@acme.com");

    expect(firstGetUrl()).toBe(`${SERVER_URL}/identity/service-provider-login`);
    expect(firstGetConfig()["params"]).toEqual({
      email: "responder@acme.com",
    });
  });

  test("a network error is reported as failed rather than thrown", async () => {
    /*
     * This runs while the user is typing their email on the login screen. An
     * exception escaping here is an unhandled rejection in a keystroke
     * handler; the caller needs a value it can render.
     */
    getSpy().mockRejectedValue(new Error("Network Error") as never);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(true);
    expect(result.providers).toEqual([]);
  });

  /*
   * The server does not answer "no SSO for this email" with an empty 200. It
   * answers with HTTP 400 BadRequestException("No SSO config found for this
   * user") - see App/FeatureSet/Identity/API/SSO.ts, which does this for an
   * unknown user, a user with no id, and a user in no project alike. axios
   * rejects on 4xx, so a blanket catch would turn the single most common
   * outcome of this call into "we could not reach your server", telling a user
   * whose network is fine to go and check their network.
   *
   * The rule: a response arrived at all (< 500) means the server was reached
   * and had its say. Only a transport error or a 5xx is an outage.
   */
  test("the server's 400 'No SSO config found for this user' is a real answer, NOT an outage", async () => {
    getSpy().mockRejectedValue({
      response: {
        status: 400,
        data: { message: "No SSO config found for this user" },
      },
    } as never);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("nobody@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test.each([400, 401, 403, 404, 422, 499])(
    "a %s response is the server answering, not an outage",
    async (status: number) => {
      getSpy().mockRejectedValue({ response: { status } } as never);

      const result: SsoDiscoveryResult<SSOProvider> =
        await fetchProjectProvidersForEmail("responder@acme.com");

      expect(result.failed).toBe(false);
    },
  );

  test.each([500, 502, 503, 504])(
    "a %s response IS an outage worth retrying",
    async (status: number) => {
      getSpy().mockRejectedValue({ response: { status } } as never);

      const result: SsoDiscoveryResult<SSOProvider> =
        await fetchProjectProvidersForEmail("responder@acme.com");

      expect(result.failed).toBe(true);
    },
  );

  test("a rejection carrying a response with no status is treated as an outage", async () => {
    // Defensive: a shape we do not recognise must fail towards "try again".
    getSpy().mockRejectedValue({ response: {} } as never);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(true);
  });

  test("an email with genuinely no SSO is empty and NOT failed", async () => {
    /*
     * The regression this guards: an earlier version flattened an unreachable
     * server into "no SSO providers for this email", which told a user on a
     * broken VPN that their company had never configured SSO.
     */
    respondWith({ data: [] });

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test("parses the project id and project name off a real payload", async () => {
    respondWith({
      data: [
        {
          _id: { _type: "ObjectID", value: "sso-1" },
          name: "Acme Okta",
          description: "Acme staff",
          projectId: { _type: "ObjectID", value: "project-1" },
          project: { name: "Acme" },
        },
      ],
    });

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers[0]).toEqual({
      _id: "sso-1",
      name: "Acme Okta",
      description: "Acme staff",
      projectId: "project-1",
      project: { name: "Acme" },
      /*
       * Stamped by the endpoint that answered, not by the payload. The
       * discovery response carries no type field, so this is the only thing
       * telling the app to start the login at /identity/sso rather than
       * /identity/oidc.
       */
      kind: "project",
    });
  });

  test("a provider with no project name carries no project object", async () => {
    /*
     * The select screen prints "<provider> - <project>" only when there is a
     * project to print; an empty-string project name would render a dangling
     * separator.
     */
    respondWith({
      data: [{ _id: "sso-1", name: "Okta", project: { name: "" } }],
    });

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.providers[0]!.project).toBeUndefined();
  });
});

describe("fetchSSOProvidersForProject", () => {
  test("POSTs to /api/project-sso/:projectId/sso-list", async () => {
    postSpy().mockResolvedValue({ data: { data: [] } } as never);

    await fetchSSOProvidersForProject("project-1");

    expect(postSpy().mock.calls[0]![0]).toBe(
      `${SERVER_URL}/api/project-sso/project-1/sso-list`,
    );
    expect(postSpy().mock.calls[0]![1]).toEqual({});
    expect(
      (postSpy().mock.calls[0]![2] as Record<string, unknown>)["timeout"],
    ).toBe(15000);
  });

  test("stamps the requested projectId onto every provider", async () => {
    /*
     * This endpoint is already scoped to one project and its rows do not carry
     * a projectId back. Without the stamp the provider reaches the login flow
     * with projectId "" and the resulting SSO token is filed under no project
     * at all - so the API client never attaches it.
     */
    postSpy().mockResolvedValue({
      data: { data: [{ _id: "sso-1", name: "Okta" }, { _id: "sso-2" }] },
    } as never);

    const providers: Array<SSOProvider> =
      await fetchSSOProvidersForProject("project-1");

    expect(
      providers.map((provider: SSOProvider) => {
        return provider.projectId;
      }),
    ).toEqual(["project-1", "project-1"]);
  });

  test("the requested projectId wins over one the payload carries", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [
          {
            _id: "sso-1",
            name: "Okta",
            projectId: { _type: "ObjectID", value: "some-other-project" },
          },
        ],
      },
    } as never);

    const providers: Array<SSOProvider> =
      await fetchSSOProvidersForProject("project-1");

    expect(providers[0]!.projectId).toBe("project-1");
  });

  test("still de-serialises the provider's own ObjectID _id", async () => {
    postSpy().mockResolvedValue({
      data: {
        data: [{ _id: { _type: "ObjectID", value: "sso-uuid" }, name: "Okta" }],
      },
    } as never);

    const providers: Array<SSOProvider> =
      await fetchSSOProvidersForProject("project-1");

    expect(providers[0]!._id).toBe("sso-uuid");
  });

  test("an empty body yields an empty list rather than throwing", async () => {
    postSpy().mockResolvedValue({ data: null } as never);

    await expect(fetchSSOProvidersForProject("project-1")).resolves.toEqual([]);
  });

  test("a network error is surfaced to the caller, not swallowed", async () => {
    /*
     * Unlike the discovery helpers, this one is called from a screen the user
     * opened deliberately, so an empty list would read as "this project has no
     * SSO" - the caller has to be able to tell the two apart.
     */
    postSpy().mockRejectedValue(new Error("Network Error") as never);

    await expect(fetchSSOProvidersForProject("project-1")).rejects.toThrow(
      "Network Error",
    );
  });
});

/*
 * The two project-scoped discovery routes, as registered by the server:
 * App/FeatureSet/Identity/API/SSO.ts  -> router.get("/service-provider-login")
 * App/FeatureSet/Identity/API/OIDC.ts -> router.get("/service-provider-login-oidc")
 *
 * Note the first is a strict PREFIX of the second. Any routing done with
 * `includes()` sends both requests down the same branch.
 */
const PROJECT_SAML_URL: string = `${SERVER_URL}/identity/service-provider-login`;
const PROJECT_OIDC_URL: string = `${SERVER_URL}/identity/service-provider-login-oidc`;

/**
 * An axios-shaped rejection carrying an HTTP status, the way axios rejects on
 * a 4xx/5xx response.
 */
function httpStatus(status: number): Error {
  const error: Error & { response?: { status: number } } = new Error(
    `Request failed with status code ${status}`,
  );
  error.response = { status };
  return error;
}

/*
 * Route the two PROJECT discovery calls independently, as stubGlobalEndpoints
 * does for the instance-wide pair. fetchProjectProvidersForEmail fires both in
 * parallel, so "SAML answered, OIDC did not" is only expressible by keying off
 * the URL.
 *
 * The match is exact and longest-first on purpose: "/service-provider-login"
 * is a prefix of "/service-provider-login-oidc", so a naive
 * `url.includes("/service-provider-login")` would hand BOTH requests the SAML
 * outcome and every assertion below would pass for the wrong reason. Any URL
 * that is neither route is rejected as a transport error, so a route the
 * module gets wrong shows up as an outage rather than as a silent pass.
 */
function stubProjectEndpoints(saml: Outcome, oidc: Outcome): void {
  getSpy().mockImplementation((url: string): Promise<unknown> => {
    let outcome: Outcome;

    if (url === PROJECT_OIDC_URL) {
      outcome = oidc;
    } else if (url === PROJECT_SAML_URL) {
      outcome = saml;
    } else {
      outcome = new Error(`unexpected discovery URL: ${url}`);
    }

    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }

    return Promise.resolve(outcome);
  });
}

/** A project discovery response body: `{ data: { data: [...] } }`. */
function projectResponse(items: Array<unknown>): { data: unknown } {
  return { data: wrapped(items) };
}

/** Every URL axios.get was asked for, in call order. */
function getUrls(): Array<string> {
  return getSpy().mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

/** The config object passed alongside `url`. */
function configForUrl(url: string): Record<string, unknown> {
  const call: Array<unknown> | undefined = getSpy().mock.calls.find(
    (candidate: Array<unknown>) => {
      return candidate[0] === url;
    },
  );

  return (call?.[1] as Record<string, unknown>) || {};
}

describe("fetchProjectOIDCProviders asks the route the server actually registers", () => {
  /*
   * This endpoint existed on the server the whole time and the app never
   * called it: discovery offered project SAML and both global kinds, so a
   * project whose only identity provider was OIDC did not appear on the SSO
   * login screen at all. The literal below is the contract with
   * App/FeatureSet/Identity/API/OIDC.ts, `router.get("/service-provider-login-oidc")`.
   * A typo does not fail to compile and does not throw - the request 404s,
   * which discovery reads as "the server answered", and the screen quietly
   * goes back to offering nothing.
   */
  test("GETs /identity/service-provider-login-oidc with the email as a query param", async () => {
    respondWith({ data: [] });

    await fetchProjectOIDCProviders("responder@acme.com");

    expect(firstGetUrl()).toBe(PROJECT_OIDC_URL);
    expect(firstGetConfig()["params"]).toEqual({ email: "responder@acme.com" });
  });

  test("is a different URL from the SAML route, not a suffix-less near miss", async () => {
    /*
     * Guards the prefix trap from the other side: if this ever became the SAML
     * URL, fetchProjectProvidersForEmail would ask the same endpoint twice and
     * list every SAML provider twice, half of them mis-stamped as OIDC.
     */
    respondWith({ data: [] });

    await fetchProjectOIDCProviders("responder@acme.com");

    expect(firstGetUrl()).not.toBe(PROJECT_SAML_URL);
    expect(firstGetUrl().endsWith("-oidc")).toBe(true);
  });

  test("carries the same 15s timeout as the rest of discovery", async () => {
    respondWith({ data: [] });

    await fetchProjectOIDCProviders("responder@acme.com");

    expect(firstGetConfig()["timeout"]).toBe(15000);
  });

  test("builds the URL from the stored server, not a hard-coded host", async () => {
    serverUrlSpy().mockResolvedValue("https://status.acme.internal" as never);
    respondWith({ data: [] });

    await fetchProjectOIDCProviders("responder@acme.com");

    expect(firstGetUrl()).toBe(
      "https://status.acme.internal/identity/service-provider-login-oidc",
    );
  });

  test("a rejection is surfaced to the caller - the raw fetcher does not settle", async () => {
    /*
     * Only fetchProjectProvidersForEmail is allowed to swallow a failure into
     * `failed`. If this one started resolving to [] on its own, an outage
     * would become "this email has no OIDC" one level too early.
     */
    getSpy().mockRejectedValue(httpStatus(503) as never);

    await expect(
      fetchProjectOIDCProviders("responder@acme.com"),
    ).rejects.toThrow("Request failed with status code 503");
  });
});

describe("The project kind is stamped by the endpoint that answered", () => {
  /*
   * The whole point of the `kind` field. Neither project discovery payload
   * carries a type, so the endpoint asked is the only thing that can say
   * whether a provider's login starts at /identity/sso/:projectId/:id or
   * /identity/oidc/:projectId/:id. Sending one to the other 400s from a router
   * that has never heard of that id.
   */
  test("every provider from the OIDC endpoint is stamped project-oidc", async () => {
    respondWith(wrapped([{ _id: "a", name: "Entra" }, { _id: "b" }]));

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(
      providers.map((provider: SSOProvider) => {
        return provider.kind;
      }),
    ).toEqual(["project-oidc", "project-oidc"]);
  });

  test("every provider from the SAML endpoint is stamped project", async () => {
    respondWith(wrapped([{ _id: "a", name: "Okta" }, { _id: "b" }]));

    const providers: Array<SSOProvider> =
      await fetchSSOProviders("responder@acme.com");

    expect(
      providers.map((provider: SSOProvider) => {
        return provider.kind;
      }),
    ).toEqual(["project", "project"]);
  });

  test("a kind field in the payload never overrides the endpoint", async () => {
    /*
     * Nothing on the server sends this today. If something ever starts - or a
     * stale cached body carries one - the endpoint still has to win.
     */
    respondWith(wrapped([{ _id: "a", name: "Entra", kind: "project" }]));

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!.kind).toBe("project-oidc");
  });

  test("the stamped kind routes the login to the OIDC router, not the SAML one", async () => {
    /*
     * Ties the stamp to the thing it exists for: the discovered provider fed
     * to buildSsoLoginUrl has to come out on /identity/oidc/:projectId/:id,
     * which is what App/FeatureSet/Identity/API/OIDC.ts registers.
     */
    respondWith(
      wrapped([
        {
          _id: { _type: "ObjectID", value: "oidc-1" },
          name: "Entra",
          projectId: { _type: "ObjectID", value: "project-1" },
        },
      ]),
    );

    const provider: SSOProvider = (
      await fetchProjectOIDCProviders("responder@acme.com")
    )[0]!;

    expect(
      buildSsoLoginUrl(SERVER_URL, {
        kind: provider.kind,
        providerId: provider._id,
        projectId: provider.projectId,
      }),
    ).toBe(`${SERVER_URL}/identity/oidc/project-1/oidc-1?mobile=true`);
  });
});

describe("fetchProjectOIDCProviders de-serialises the payload like the SAML one", () => {
  test("unwraps the ObjectID envelopes and the project relation", async () => {
    respondWith({
      data: [
        {
          _id: { _type: "ObjectID", value: "oidc-1" },
          name: "Acme Entra",
          description: "Acme staff",
          projectId: { _type: "ObjectID", value: "project-1" },
          project: { name: "Acme" },
        },
      ],
    });

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]).toEqual({
      _id: "oidc-1",
      name: "Acme Entra",
      description: "Acme staff",
      projectId: "project-1",
      project: { name: "Acme" },
      kind: "project-oidc",
    });
  });

  test("ids that are already plain strings are left alone", async () => {
    respondWith(
      wrapped([{ _id: "oidc-1", name: "Entra", projectId: "project-1" }]),
    );

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!._id).toBe("oidc-1");
    expect(providers[0]!.projectId).toBe("project-1");
  });

  test("a missing projectId becomes an empty string, never undefined", async () => {
    /*
     * The projectId is a path segment of the login URL. undefined would be
     * pasted in literally as "/identity/oidc/undefined/<id>"; the empty string
     * is what buildSsoLoginUrl checks for before it throws.
     */
    respondWith(wrapped([{ _id: "oidc-1", name: "Entra" }]));

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!.projectId).toBe("");
    expect(providers[0]!._id).toBe("oidc-1");
  });

  test("a missing name becomes an empty string so the row still renders", async () => {
    respondWith(wrapped([{ _id: "oidc-1" }]));

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!.name).toBe("");
  });

  test("an empty project name carries no project object", async () => {
    /*
     * The select screen prints "<provider> - <project>" only when there is a
     * project to print; an empty name would render a dangling separator.
     */
    respondWith(
      wrapped([{ _id: "oidc-1", name: "Entra", project: { name: "" } }]),
    );

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!.project).toBeUndefined();
  });

  test("a missing project relation leaves project undefined", async () => {
    respondWith(wrapped([{ _id: "oidc-1", name: "Entra" }]));

    const providers: Array<SSOProvider> =
      await fetchProjectOIDCProviders("responder@acme.com");

    expect(providers[0]!.project).toBeUndefined();
  });

  test("a null body yields an empty list instead of throwing", async () => {
    respondWith(null);

    await expect(
      fetchProjectOIDCProviders("responder@acme.com"),
    ).resolves.toEqual([]);
  });

  test("a body with no data key yields an empty list", async () => {
    respondWith({});

    await expect(
      fetchProjectOIDCProviders("responder@acme.com"),
    ).resolves.toEqual([]);
  });
});

describe("fetchProjectProvidersForEmail asks BOTH project endpoints", () => {
  test("fires two GETs, one per route, each carrying the email", async () => {
    stubProjectEndpoints(projectResponse([]), projectResponse([]));

    await fetchProjectProvidersForEmail("responder@acme.com");

    const urls: Array<string> = getUrls();

    expect(urls).toHaveLength(2);
    expect(urls).toContain(PROJECT_SAML_URL);
    expect(urls).toContain(PROJECT_OIDC_URL);
    expect(configForUrl(PROJECT_SAML_URL)["params"]).toEqual({
      email: "responder@acme.com",
    });
    expect(configForUrl(PROJECT_OIDC_URL)["params"]).toEqual({
      email: "responder@acme.com",
    });
  });

  test("concatenates SAML first, then OIDC, with the right kind on each half", async () => {
    stubProjectEndpoints(
      projectResponse([
        {
          _id: "saml-1",
          name: "Acme Okta",
          projectId: { _type: "ObjectID", value: "project-1" },
          project: { name: "Acme" },
        },
      ]),
      projectResponse([
        {
          _id: "oidc-1",
          name: "Acme Entra",
          projectId: { _type: "ObjectID", value: "project-2" },
          project: { name: "Beta" },
        },
      ]),
    );

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(
      result.providers.map((provider: SSOProvider) => {
        return [provider._id, provider.projectId, provider.kind];
      }),
    ).toEqual([
      ["saml-1", "project-1", "project"],
      ["oidc-1", "project-2", "project-oidc"],
    ]);
  });

  test("the order is the request order, not the order the endpoints answer in", async () => {
    /*
     * Promise.all preserves the input order, so a slow SAML endpoint must not
     * push its providers below the OIDC ones - the select screen lists them in
     * this order and an unstable list would reshuffle under the user's finger.
     */
    getSpy().mockImplementation((url: string): Promise<unknown> => {
      if (url === PROJECT_OIDC_URL) {
        return Promise.resolve(projectResponse([{ _id: "oidc-1" }]));
      }

      return new Promise((resolve: (value: unknown) => void): void => {
        setTimeout(() => {
          resolve(projectResponse([{ _id: "saml-1" }]));
        }, 20);
      });
    });

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(
      result.providers.map((provider: SSOProvider) => {
        return provider._id;
      }),
    ).toEqual(["saml-1", "oidc-1"]);
  });

  test("two identically named providers keep the kind of the endpoint they came from", async () => {
    /*
     * A tenant that runs both SAML and OIDC against the same IdP names them
     * the same thing. Nothing in the merged list distinguishes them except
     * `kind`, and that is what picks the router.
     */
    stubProjectEndpoints(
      projectResponse([{ _id: "same-name-1", name: "Corp IdP" }]),
      projectResponse([{ _id: "same-name-2", name: "Corp IdP" }]),
    );

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(
      result.providers.map((provider: SSOProvider) => {
        return [provider.name, provider.kind];
      }),
    ).toEqual([
      ["Corp IdP", "project"],
      ["Corp IdP", "project-oidc"],
    ]);
  });
});

describe("fetchProjectProvidersForEmail reports failure only when BOTH routes are down", () => {
  const samlOnly: { data: unknown } = projectResponse([
    { _id: "saml-1", name: "Okta" },
  ]);
  const oidcOnly: { data: unknown } = projectResponse([
    { _id: "oidc-1", name: "Entra" },
  ]);

  test("both endpoints answering is not failed", async () => {
    stubProjectEndpoints(samlOnly, oidcOnly);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(2);
  });

  test("only SAML failing still returns a usable OIDC list, and is not failed", async () => {
    /*
     * This is the regression the whole change exists for, in its harshest
     * form: the project's SAML endpoint is down and its ONLY identity provider
     * is OIDC. Reporting failure here would hide a login that works perfectly
     * behind a retry prompt.
     */
    stubProjectEndpoints(httpStatus(503), oidcOnly);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!._id).toBe("oidc-1");
    expect(result.providers[0]!.kind).toBe("project-oidc");
  });

  test("only OIDC failing still returns the SAML list, and is not failed", async () => {
    stubProjectEndpoints(samlOnly, new Error("Network Error"));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!._id).toBe("saml-1");
    expect(result.providers[0]!.kind).toBe("project");
  });

  test("both endpoints unreachable is the only case reported as failed", async () => {
    stubProjectEndpoints(
      new Error("Network Error"),
      new Error("Network Error"),
    );

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(true);
    expect(result.providers).toEqual([]);
  });

  test("both endpoints answering 5xx is failed too", async () => {
    stubProjectEndpoints(httpStatus(502), httpStatus(500));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(true);
    expect(result.providers).toEqual([]);
  });

  /*
   * The 4xx distinction, applied to the pair. Both routes answer the ordinary
   * "nothing configured for this address" case with HTTP 400 - SSO.ts says
   * "No SSO config found for this user", OIDC.ts says "No OIDC config found
   * for this user" - and axios rejects on 4xx. A 400 from one endpoint while
   * the other hands back providers is the single most common real-world
   * outcome, and calling it an outage would tell a user whose network is fine
   * to go and check their network.
   */
  test("a 400 from OIDC alongside SAML providers is not an outage", async () => {
    stubProjectEndpoints(samlOnly, httpStatus(400));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.kind).toBe("project");
  });

  test("a 400 from SAML alongside OIDC providers is not an outage", async () => {
    stubProjectEndpoints(httpStatus(400), oidcOnly);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.kind).toBe("project-oidc");
  });

  test("both endpoints answering 400 is empty and NOT failed", async () => {
    stubProjectEndpoints(httpStatus(400), httpStatus(400));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test("both endpoints answering an empty list is empty and NOT failed", async () => {
    /*
     * "No project on this instance federates that address" and "we could not
     * reach your server" are the same empty list; only the second is worth a
     * retry button.
     */
    stubProjectEndpoints(projectResponse([]), projectResponse([]));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test("one endpoint empty and the other populated is not failed", async () => {
    stubProjectEndpoints(projectResponse([]), oidcOnly);

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.kind).toBe("project-oidc");
  });

  test("a 400 from one route and a 5xx from the other is still not reported as failed", async () => {
    /*
     * The documented rule taken to its edge: `failed` means BOTH endpoints
     * were unreachable, and a 400 counts as reached. So SAML answering "no
     * config for this user" while OIDC is genuinely down produces an empty
     * list with failed=false - the user is told they have no project SSO
     * without a retry button, even though the OIDC half was never heard from.
     */
    stubProjectEndpoints(httpStatus(400), httpStatus(503));

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toEqual([]);
  });

  test("a malformed 200 from one route does not throw out of the merge", async () => {
    /*
     * `response.data.data` being an object rather than an array makes .map
     * throw inside the fetcher. That happens while the user is typing their
     * email, so it must land in `failed` rather than escape as an unhandled
     * rejection - and the other route's providers must survive it.
     */
    stubProjectEndpoints(
      { data: { data: { message: "unauthorized" } } },
      oidcOnly,
    );

    const result: SsoDiscoveryResult<SSOProvider> =
      await fetchProjectProvidersForEmail("responder@acme.com");

    expect(result.failed).toBe(false);
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]!.kind).toBe("project-oidc");
  });
});
