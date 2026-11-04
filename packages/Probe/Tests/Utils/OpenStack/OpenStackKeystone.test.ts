import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OpenStackApplicationCredential,
  OpenStackPasswordCredential,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
  OpenStackTransport,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  buildKeystoneAuthBody,
  describeOpenStackCredential,
  diagnosePasswordScope,
  keystoneLogin,
  parseKeystoneToken,
  revokeKeystoneToken,
} from "../../../Utils/OpenStack/OpenStackKeystone";
import { OpenStackCollectionError } from "../../../Utils/OpenStack/OpenStackCollectionErrors";

/*
 * Logging in to Keystone, the one call that carries the secret: the two kinds of
 * credential, what each refusal means, and that a token is bought as seldom as it can be.
 */

const SECRET: string = "s3cret-not-in-any-sentence";
const AUTH_URL: string = "https://keystone.example.com:5000";

const APPLICATION_CREDENTIAL: OpenStackApplicationCredential = {
  kind: "applicationCredential",
  id: "app-cred-id",
  secret: SECRET,
};

const PASSWORD_CREDENTIAL: OpenStackPasswordCredential = {
  kind: "password",
  username: "oneuptime",
  password: SECRET,
  userDomainName: "Default",
  projectName: "monitoring",
  projectDomainName: "Corp",
};

function answering(
  response: Partial<OpenStackHttpResponse>,
  requests: Array<OpenStackHttpRequest> = [],
): OpenStackTransport {
  return async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    requests.push(request);

    return { status: 200, headers: {}, body: "", ...response };
  };
}

function tokenAnswer(): Partial<OpenStackHttpResponse> {
  return {
    status: 201,
    headers: { "X-Subject-Token": "the-token" },
    body: JSON.stringify({
      token: {
        expires_at: "2026-11-04T12:00:00.000000Z",
        project: { id: "project-1", name: "monitoring" },
        roles: [{ name: "reader" }, { name: "admin" }],
        application_credential: {
          restricted: true,
          access_rules: [{ path: "/v2.1/servers", method: "GET" }],
        },
        catalog: [
          {
            type: "compute",
            name: "nova",
            endpoints: [
              {
                url: "https://nova.example.com/v2.1",
                interface: "public",
                region_id: "RegionOne",
              },
            ],
          },
        ],
      },
    }),
  };
}

async function failureOf(
  response: Partial<OpenStackHttpResponse>,
  credential:
    | OpenStackApplicationCredential
    | OpenStackPasswordCredential = APPLICATION_CREDENTIAL,
): Promise<OpenStackCollectionError> {
  try {
    await keystoneLogin({
      authUrl: AUTH_URL,
      credential: credential,
      transport: answering(response),
      userAgent: "test",
    });
  } catch (error) {
    return error as OpenStackCollectionError;
  }

  throw new Error("The login was meant to fail.");
}

describe("what a login sends", () => {
  test("an application credential names no scope, because it was scoped when made", () => {
    expect(buildKeystoneAuthBody(APPLICATION_CREDENTIAL)).toEqual({
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: { id: "app-cred-id", secret: SECRET },
        },
      },
    });
  });

  test("a password names its project and both domains", () => {
    expect(buildKeystoneAuthBody(PASSWORD_CREDENTIAL)).toEqual({
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              name: "oneuptime",
              domain: { name: "Default" },
              password: SECRET,
            },
          },
        },
        scope: {
          project: { name: "monitoring", domain: { name: "Corp" } },
        },
      },
    });
  });

  test("an unscoped login asks for no project", () => {
    const body: JSONObject = buildKeystoneAuthBody(PASSWORD_CREDENTIAL, {
      isUnscoped: true,
    });

    expect((body["auth"] as JSONObject)["scope"]).toBe("unscoped");
  });

  test("it posts JSON to /v3/auth/tokens under the address given", async () => {
    const requests: Array<OpenStackHttpRequest> = [];

    await keystoneLogin({
      authUrl: "https://cloud.example.com/identity",
      credential: APPLICATION_CREDENTIAL,
      transport: answering(tokenAnswer(), requests),
      userAgent: "OneUptime-Probe/test",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://cloud.example.com/identity/v3/auth/tokens",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "OneUptime-Probe/test",
      },
    });
  });

  test("a credential is described by its ID, never its secret", () => {
    expect(describeOpenStackCredential(APPLICATION_CREDENTIAL)).toBe(
      "application credential app-cred-id",
    );
    expect(describeOpenStackCredential(PASSWORD_CREDENTIAL)).toBe(
      "user oneuptime in domain Default, on project monitoring",
    );
    expect(describeOpenStackCredential(PASSWORD_CREDENTIAL)).not.toContain(
      SECRET,
    );
  });
});

describe("what a token says", () => {
  test("its token, its end, its catalog, its project and its roles", async () => {
    const token: OpenStackToken = await keystoneLogin({
      authUrl: AUTH_URL,
      credential: APPLICATION_CREDENTIAL,
      transport: answering(tokenAnswer()),
      userAgent: "test",
    });

    expect(token).toEqual({
      id: "the-token",
      expiresAt: Date.parse("2026-11-04T12:00:00.000Z"),
      catalog: [
        {
          type: "compute",
          name: "nova",
          endpoints: [
            {
              url: "https://nova.example.com/v2.1",
              interfaceName: "public",
              regionName: "RegionOne",
            },
          ],
        },
      ],
      projectId: "project-1",
      projectName: "monitoring",
      roleNames: ["reader", "admin"],
      hasAccessRules: true,
      isUnrestricted: false,
    });
  });

  test("an answer with little in it reads as little, not as a crash", () => {
    expect(parseKeystoneToken({ tokenId: "t", body: { token: {} } })).toEqual({
      id: "t",
      expiresAt: null,
      catalog: [],
      projectId: null,
      projectName: null,
      roleNames: [],
      hasAccessRules: false,
      isUnrestricted: false,
    });
  });

  test("an application credential made --unrestricted says so", () => {
    expect(
      parseKeystoneToken({
        tokenId: "t",
        body: { token: { application_credential: { restricted: false } } },
      }).isUnrestricted,
    ).toBe(true);
  });
});

describe("what a refusal means", () => {
  test("401 is a refused credential, in words that name it and not its secret", async () => {
    const error: OpenStackCollectionError = await failureOf({ status: 401 });

    expect(error.code).toBe(OpenStackCollectionErrorCode.InvalidCredential);
    expect(error.message).toBe(
      "Keystone at keystone.example.com:5000 refused the application credential app-cred-id: it is wrong, it has expired or been deleted, or its account lost its role on the project.",
    );
    expect(error.message).not.toContain(SECRET);
  });

  test("403 on a password is its project scope", async () => {
    const error: OpenStackCollectionError = await failureOf(
      {
        status: 403,
        body: JSON.stringify({
          error: { message: "Project is disabled", code: 403 },
        }),
      },
      PASSWORD_CREDENTIAL,
    );

    expect(error.code).toBe(OpenStackCollectionErrorCode.WrongProjectScope);
    expect(error.message).toContain("Project is disabled");
  });

  test("403 on an application credential is the credential", async () => {
    const error: OpenStackCollectionError = await failureOf({ status: 403 });

    expect(error.code).toBe(OpenStackCollectionErrorCode.InvalidCredential);
  });

  test.each([429, 500, 502, 503, 504])(
    "%s means Keystone is failing, and says what it said",
    async (status: number) => {
      const error: OpenStackCollectionError = await failureOf({
        status: status,
        body: JSON.stringify({ error: { message: "database is gone" } }),
      });

      expect(error.code).toBe(OpenStackCollectionErrorCode.KeystoneFailing);
      expect(error.message).toBe(
        `Keystone at keystone.example.com:5000 answered the login with HTTP ${status}: database is gone`,
      );
    },
  );

  test.each([
    [
      "a 404",
      { status: 404, body: "not here" },
      "it answered a login with HTTP 404",
    ],
    [
      "a redirect",
      { status: 302, body: "" },
      "it answered a login with HTTP 302",
    ],
    [
      "a web page with a 200",
      { status: 200, body: "<html>Welcome</html>" },
      "it answered a login without a token",
    ],
    [
      "JSON without a token header",
      { status: 201, body: JSON.stringify({ token: {} }) },
      "it answered a login without a token",
    ],
    [
      "a token header with no token in the body",
      {
        status: 201,
        headers: { "x-subject-token": "t" },
        body: JSON.stringify({ hello: "world" }),
      },
      "it answered a login without a token",
    ],
  ])(
    "%s is not Keystone",
    async (
      _name: string,
      response: Partial<OpenStackHttpResponse>,
      words: string,
    ) => {
      const error: OpenStackCollectionError = await failureOf(response);

      expect(error.code).toBe(OpenStackCollectionErrorCode.NotKeystone);
      expect(error.message).toContain(words);
      expect(error.message).toContain(AUTH_URL);
    },
  );

  test("the header is read whatever its case", async () => {
    const token: OpenStackToken = await keystoneLogin({
      authUrl: AUTH_URL,
      credential: APPLICATION_CREDENTIAL,
      transport: answering({
        status: 201,
        headers: { "x-subject-token": ["from-an-array"] },
        body: JSON.stringify({ token: {} }),
      }),
      userAgent: "test",
    });

    expect(token.id).toBe("from-an-array");
  });
});

describe("telling a wrong password from a wrong project", () => {
  test("an account that logs in without a scope has the wrong project", async () => {
    const error: OpenStackCollectionError | null = await diagnosePasswordScope({
      authUrl: AUTH_URL,
      credential: PASSWORD_CREDENTIAL,
      transport: answering(tokenAnswer()),
      userAgent: "test",
    });

    expect(error?.code).toBe(OpenStackCollectionErrorCode.WrongProjectScope);
    expect(error?.message).toBe(
      "Keystone accepted user oneuptime, but not on project monitoring in domain Corp: the project does not exist there, or the user has no role on it.",
    );
  });

  test("an account refused either way has the wrong password", async () => {
    expect(
      await diagnosePasswordScope({
        authUrl: AUTH_URL,
        credential: PASSWORD_CREDENTIAL,
        transport: answering({ status: 401 }),
        userAgent: "test",
      }),
    ).toBeNull();
  });

  test("an application credential has no scope to get wrong, so nothing is asked", async () => {
    const requests: Array<OpenStackHttpRequest> = [];

    expect(
      await diagnosePasswordScope({
        authUrl: AUTH_URL,
        credential: APPLICATION_CREDENTIAL,
        transport: answering(tokenAnswer(), requests),
        userAgent: "test",
      }),
    ).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("ending a test's token", () => {
  test("it asks Keystone to revoke its own token", async () => {
    const requests: Array<OpenStackHttpRequest> = [];

    await revokeKeystoneToken({
      authUrl: AUTH_URL,
      tokenId: "t",
      transport: answering({ status: 204 }, requests),
      userAgent: "test",
    });

    expect(requests[0]).toMatchObject({
      method: "DELETE",
      url: `${AUTH_URL}/v3/auth/tokens`,
      headers: { "X-Auth-Token": "t", "X-Subject-Token": "t" },
    });
  });

  test("not being allowed to, or getting no answer, is nobody's problem", async () => {
    await expect(
      revokeKeystoneToken({
        authUrl: AUTH_URL,
        tokenId: "t",
        transport: async (): Promise<OpenStackHttpResponse> => {
          throw new Error("gone");
        },
        userAgent: "test",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("one collection's hold on a token", () => {
  const token: (id: string) => OpenStackToken = (
    id: string,
  ): OpenStackToken => {
    return parseKeystoneToken({ tokenId: id, body: { token: {} } });
  };

  test("a token bought this collection is never renewed: a 401 on it is the path", async () => {
    let logins: number = 0;

    const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
      token: token("fresh"),
      isFresh: true,
      login: async (): Promise<OpenStackToken> => {
        logins++;
        return token("new");
      },
    });

    expect(await session.renew("fresh")).toBe(false);
    expect(logins).toBe(0);
  });

  test("a kept token is renewed once, however many ask at once", async () => {
    let logins: number = 0;

    const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
      token: token("kept"),
      isFresh: false,
      login: async (): Promise<OpenStackToken> => {
        logins++;
        return token("new");
      },
    });

    expect(
      await Promise.all([
        session.renew("kept"),
        session.renew("kept"),
        session.renew("kept"),
      ]),
    ).toEqual([true, true, true]);

    expect(logins).toBe(1);
    expect(session.getToken().id).toBe("new");
  });

  test("once renewed, a 401 on the new token is the path, and one on the old is news", async () => {
    let logins: number = 0;

    const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
      token: token("kept"),
      isFresh: false,
      login: async (): Promise<OpenStackToken> => {
        logins++;
        return token("new");
      },
    });

    await session.renew("kept");

    // A request that went out with the old token, and came back after.
    expect(await session.renew("kept")).toBe(true);
    expect(await session.renew("new")).toBe(false);
    expect(logins).toBe(1);
  });

  test("a renewal that fails is told to everyone who asks, and tried once", async () => {
    let logins: number = 0;
    const failure: Error = new Error("Keystone is down");

    const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
      token: token("kept"),
      isFresh: false,
      login: async (): Promise<OpenStackToken> => {
        logins++;
        throw failure;
      },
    });

    await expect(session.renew("kept")).rejects.toBe(failure);
    await expect(session.renew("kept")).rejects.toBe(failure);
    await expect(session.renew("kept")).rejects.toBe(failure);

    expect(logins).toBe(1);
    expect(session.getRenewalFailure()).toBe(failure);
  });

  test("what access rules refuse is remembered, so it does not cost a login next time", () => {
    const session: OpenStackKeystoneSession = new OpenStackKeystoneSession({
      token: token("kept"),
      isFresh: false,
      login: async (): Promise<OpenStackToken> => {
        return token("new");
      },
    });

    expect(session.isKnownRefused("identity:users")).toBe(false);
    session.markRefused("identity:users");
    expect(session.isKnownRefused("identity:users")).toBe(true);
    expect(Array.from(session.getRefusedReads())).toEqual(["identity:users"]);
  });
});
