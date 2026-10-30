import jwt from "jsonwebtoken";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import GoogleWorkspaceResponseClient, {
  GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE,
  GOOGLE_WORKSPACE_DIRECTORY_USERS_URL,
  GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE,
  GoogleWorkspaceContainmentOutcome,
  GoogleWorkspaceUser,
} from "../../../../../Server/Utils/SecurityEvent/Response/GoogleWorkspaceResponseClient";
import MicrosoftEntraIdResponseClient, {
  ENTRA_ID_PRIVILEGED_USER_HINT,
  EntraIdContainmentOutcome,
  EntraIdUser,
} from "../../../../../Server/Utils/SecurityEvent/Response/MicrosoftEntraIdResponseClient";
import { JSONObject } from "../../../../../Types/JSON";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_PUBLIC_KEY,
  FAKE_SERVICE_ACCOUNT_JSON,
  FAKE_TOKEN_URI,
} from "../Connectors/GoogleWorkspace/GoogleWorkspaceFakeApi";
import { describe, expect, test } from "@jest/globals";

/*
 * The identity products' containment clients, against a recording
 * transport that answers as each vendor documents: Microsoft Graph for an
 * Entra ID account (find by sign-in name or mail, accountEnabled,
 * revokeSignInSessions) and the Admin SDK Directory API for a Google
 * Workspace account (find, suspended, signOut). Each request is held to
 * its method, address, headers and body; each refusal is worded so an
 * analyst knows what to grant, and no secret is ever in it.
 */

type Responder = (request: DataSourceHttpRequest) => DataSourceHttpResponse;

interface RecordingTransport {
  requests: Array<DataSourceHttpRequest>;
  transport: (
    request: DataSourceHttpRequest,
  ) => Promise<DataSourceHttpResponse>;
}

function respond(statusCode: number, body: unknown): DataSourceHttpResponse {
  const bodyText: string = body === undefined ? "" : JSON.stringify(body);
  return { statusCode, bodyText, bodyJson: body };
}

function recording(responder: Responder): RecordingTransport {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      return responder(request);
    },
  };
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the call to throw.");
}

// ---------- Microsoft Entra ID ----------

const TENANT: string = "contoso.onmicrosoft.com";
const CLIENT_ID: string = "2f1c7a3e-0000-4000-8000-000000000001";
const CLIENT_SECRET: string = "entra-client-secret-value";
const GRAPH_TOKEN: string = "graph-access-token-value";

const ALICE: JSONObject = {
  id: "11111111-aaaa-4bbb-8ccc-000000000001",
  userPrincipalName: "alice@contoso.com",
  accountEnabled: true,
};

interface FakeGraph {
  // By sign-in name or object id.
  users?: Record<string, JSONObject> | undefined;
  // By mail address, for the $filter lookup.
  byMail?: Record<string, Array<JSONObject>> | undefined;
  failWrite?: { statusCode: number; body: unknown } | undefined;
  failLookup?: { statusCode: number; body: unknown } | undefined;
}

function graph(fake: FakeGraph): RecordingTransport {
  return recording((request: DataSourceHttpRequest): DataSourceHttpResponse => {
    const url: URL = new URL(request.url);

    if (url.pathname.endsWith("/oauth2/v2.0/token")) {
      return respond(200, { access_token: GRAPH_TOKEN, expires_in: 3599 });
    }

    if (request.method === "GET" && url.pathname === "/v1.0/users") {
      if (fake.failLookup) {
        return respond(fake.failLookup.statusCode, fake.failLookup.body);
      }

      const filter: string = url.searchParams.get("$filter") || "";
      const mail: string = filter.replace(/^mail eq '/, "").replace(/'$/, "");

      return respond(200, { value: fake.byMail?.[mail] || [] });
    }

    if (request.method === "GET") {
      if (fake.failLookup) {
        return respond(fake.failLookup.statusCode, fake.failLookup.body);
      }

      const name: string = decodeURIComponent(
        url.pathname.replace("/v1.0/users/", ""),
      );
      const user: JSONObject | undefined = fake.users?.[name];

      return user
        ? respond(200, user)
        : respond(404, {
            error: {
              code: "Request_ResourceNotFound",
              message: `Resource '${name}' does not exist.`,
            },
          });
    }

    if (fake.failWrite) {
      return respond(fake.failWrite.statusCode, fake.failWrite.body);
    }

    return request.method === "PATCH"
      ? respond(204, undefined)
      : respond(200, { value: true });
  });
}

function entraClient(
  transport: RecordingTransport,
  cloud: string = "public",
): MicrosoftEntraIdResponseClient {
  return new MicrosoftEntraIdResponseClient({
    tenantId: TENANT,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    cloud,
    transport: transport.transport,
  });
}

describe("MicrosoftEntraIdResponseClient", () => {
  test("asks for a Graph token with the client credentials, then finds the user by sign-in name", async () => {
    const api: RecordingTransport = graph({
      users: { "alice@contoso.com": ALICE },
    });

    const user: EntraIdUser | null = await entraClient(api).findUser(
      " alice@contoso.com ",
    );

    expect(user).toEqual({
      id: ALICE["id"],
      userPrincipalName: "alice@contoso.com",
      accountEnabled: true,
    });

    const token: DataSourceHttpRequest = api.requests[0]!;
    expect(token.url).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    );
    expect(token.body).toMatchObject({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      scope: "https://graph.microsoft.com/.default",
    });

    const lookup: URL = new URL(api.requests[1]!.url);
    expect(lookup.origin).toBe("https://graph.microsoft.com");
    expect(lookup.pathname).toBe("/v1.0/users/alice%40contoso.com");
    expect(lookup.searchParams.get("$select")).toBe(
      "id,userPrincipalName,accountEnabled",
    );
    expect(api.requests[1]!.headers?.["Authorization"]).toBe(
      `Bearer ${GRAPH_TOKEN}`,
    );
  });

  test("falls back to the mail address when no account signs in with it", async () => {
    const api: RecordingTransport = graph({
      byMail: { "a.smith@contoso.com": [ALICE] },
    });

    const user: EntraIdUser | null = await entraClient(api).findUser(
      "a.smith@contoso.com",
    );

    expect(user?.id).toBe(ALICE["id"]);

    const byMail: URL = new URL(api.requests[2]!.url);
    expect(byMail.pathname).toBe("/v1.0/users");
    expect(byMail.searchParams.get("$filter")).toBe(
      "mail eq 'a.smith@contoso.com'",
    );
  });

  test("quotes an apostrophe in a mail address for the OData filter", async () => {
    const api: RecordingTransport = graph({});

    await entraClient(api).findUser("o'brien@contoso.com");

    expect(new URL(api.requests[2]!.url).searchParams.get("$filter")).toBe(
      "mail eq 'o''brien@contoso.com'",
    );
  });

  test("a name Entra ID does not know, and is no mail address, is no user - without a second lookup", async () => {
    const api: RecordingTransport = graph({});

    expect(await entraClient(api).findUser("alice")).toBeNull();
    // The token and the one lookup by name.
    expect(api.requests).toHaveLength(2);
    expect(await entraClient(api).findUser("   ")).toBeNull();
  });

  test("refuses to act when two accounts share the mail address", async () => {
    const api: RecordingTransport = graph({
      byMail: {
        "team@contoso.com": [ALICE, { ...ALICE, id: "other-id" }],
      },
    });

    const error: Error = await caught(
      entraClient(api).findUser("team@contoso.com"),
    );

    expect(error.message).toContain(
      "more than one account has the mail address team@contoso.com, so none was changed",
    );
  });

  test("disables an enabled account with a PATCH of accountEnabled false", async () => {
    const api: RecordingTransport = graph({});
    const outcome: EntraIdContainmentOutcome = await entraClient(
      api,
    ).disableUser({
      id: "user-1",
      userPrincipalName: "alice@contoso.com",
      accountEnabled: true,
    });

    expect(outcome).toBe(EntraIdContainmentOutcome.Done);

    const patch: DataSourceHttpRequest = api.requests[1]!;
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe("https://graph.microsoft.com/v1.0/users/user-1");
    expect(JSON.parse(String(patch.body))).toEqual({ accountEnabled: false });
    expect(patch.headers?.["Content-Type"]).toBe("application/json");
  });

  test("leaves a disabled account alone, and an enabled one when enabling, and says so", async () => {
    const api: RecordingTransport = graph({});
    const client: MicrosoftEntraIdResponseClient = entraClient(api);

    expect(
      await client.disableUser({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: false,
      }),
    ).toBe(EntraIdContainmentOutcome.AlreadyDone);
    expect(
      await client.enableUser({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: true,
      }),
    ).toBe(EntraIdContainmentOutcome.AlreadyDone);
    // Nothing was sent, not even a token request.
    expect(api.requests).toEqual([]);
  });

  test("enables a disabled account", async () => {
    const api: RecordingTransport = graph({});

    expect(
      await entraClient(api).enableUser({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: false,
      }),
    ).toBe(EntraIdContainmentOutcome.Done);
    expect(JSON.parse(String(api.requests[1]!.body))).toEqual({
      accountEnabled: true,
    });
  });

  test("signs a user out with a POST to revokeSignInSessions", async () => {
    const api: RecordingTransport = graph({});

    expect(
      await entraClient(api).signOut({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: true,
      }),
    ).toBe(EntraIdContainmentOutcome.Done);

    expect(api.requests[1]!.method).toBe("POST");
    expect(api.requests[1]!.url).toBe(
      "https://graph.microsoft.com/v1.0/users/user-1/revokeSignInSessions",
    );
  });

  test("names the permission a refusal needs, and the role an administrator's account needs, never the secret", async () => {
    const forbidden: { statusCode: number; body: unknown } = {
      statusCode: 403,
      body: {
        error: {
          code: "Authorization_RequestDenied",
          message: `Insufficient privileges to complete the operation. ${CLIENT_SECRET}`,
        },
      },
    };

    const disable: Error = await caught(
      entraClient(graph({ failWrite: forbidden })).disableUser({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: true,
      }),
    );

    expect(disable.message).toContain(
      "Microsoft Entra ID disable failed (HTTP 403)",
    );
    expect(disable.message).toContain(
      "needs the Microsoft Graph application permission User.EnableDisableAccount.All, with admin consent.",
    );
    expect(disable.message).toContain(ENTRA_ID_PRIVILEGED_USER_HINT);
    expect(disable.message).not.toContain(CLIENT_SECRET);

    const signOut: Error = await caught(
      entraClient(graph({ failWrite: forbidden })).signOut({
        id: "user-1",
        userPrincipalName: "",
        accountEnabled: true,
      }),
    );

    expect(signOut.message).toContain("User.RevokeSessions.All");

    const lookup: Error = await caught(
      entraClient(graph({ failLookup: forbidden })).findUser(
        "alice@contoso.com",
      ),
    );

    expect(lookup.message).toContain("User.Read.All");
  });

  test("uses the US Government cloud's hosts, and refuses a cloud it does not know", async () => {
    const api: RecordingTransport = graph({
      users: { "alice@contoso.us": ALICE },
    });

    await entraClient(api, "usgov").findUser("alice@contoso.us");

    expect(new URL(api.requests[0]!.url).origin).toBe(
      "https://login.microsoftonline.us",
    );
    expect(new URL(api.requests[1]!.url).origin).toBe(
      "https://graph.microsoft.us",
    );

    expect(() => {
      return entraClient(api, "china");
    }).toThrow(
      'The connection\'s Microsoft cloud "china" is not one OneUptime knows.',
    );
  });
});

// ---------- Google Workspace ----------

const WORKSPACE_TOKEN: string = "ya29.directory-token-value";

interface FakeDirectory {
  users?: Record<string, JSONObject> | undefined;
  // Scopes the domain-wide delegation does not list: their tokens are refused.
  undelegated?: Array<string> | undefined;
  failWrite?: { statusCode: number; body: unknown } | undefined;
}

interface DirectoryTransport extends RecordingTransport {
  // The scope of every token asked for, in order.
  scopes: Array<string>;
}

function directory(fake: FakeDirectory): DirectoryTransport {
  const scopes: Array<string> = [];
  const api: RecordingTransport = recording(
    (request: DataSourceHttpRequest): DataSourceHttpResponse => {
      if (request.url === FAKE_TOKEN_URI) {
        const assertion: string = String(
          (request.body as Record<string, string>)["assertion"],
        );
        const claims: JSONObject = jwt.verify(assertion, FAKE_PUBLIC_KEY, {
          algorithms: ["RS256"],
        }) as JSONObject;
        const scope: string = String(claims["scope"]);

        scopes.push(scope);
        expect(claims["sub"]).toBe(FAKE_ADMIN_EMAIL);

        if (fake.undelegated?.includes(scope)) {
          return respond(401, {
            error: "unauthorized_client",
            error_description:
              "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.",
          });
        }

        return respond(200, {
          access_token: `${WORKSPACE_TOKEN}-${scopes.length}`,
          expires_in: 3599,
        });
      }

      const url: URL = new URL(request.url);
      const key: string = decodeURIComponent(
        url.pathname
          .replace("/admin/directory/v1/users/", "")
          .replace("/signOut", ""),
      );

      if (request.method === "GET") {
        const user: JSONObject | undefined = fake.users?.[key];

        return user
          ? respond(200, user)
          : respond(404, {
              error: { code: 404, message: "Resource Not Found: userKey" },
            });
      }

      if (fake.failWrite) {
        return respond(fake.failWrite.statusCode, fake.failWrite.body);
      }

      return request.method === "PUT"
        ? respond(200, { id: key })
        : respond(204, undefined);
    },
  );

  return { ...api, scopes };
}

function workspaceClient(
  transport: RecordingTransport,
): GoogleWorkspaceResponseClient {
  return new GoogleWorkspaceResponseClient({
    serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON,
    adminEmail: FAKE_ADMIN_EMAIL,
    transport: transport.transport,
  });
}

const BOB: JSONObject = {
  id: "104761234567890123456",
  primaryEmail: "bob@example.com",
  suspended: false,
};

describe("GoogleWorkspaceResponseClient", () => {
  test("acts as the administrator with the Directory API's user scope, and finds the user by email", async () => {
    const api: DirectoryTransport = directory({
      users: { "bob@example.com": BOB },
    });

    const user: GoogleWorkspaceUser | null =
      await workspaceClient(api).findUser(" bob@example.com ");

    expect(user).toEqual({
      id: BOB["id"],
      primaryEmail: "bob@example.com",
      suspended: false,
    });
    expect(api.scopes).toEqual([GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE]);
    expect(GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE).toBe(
      "https://www.googleapis.com/auth/admin.directory.user",
    );

    const lookup: DataSourceHttpRequest = api.requests[1]!;
    expect(lookup.url).toBe(
      `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/bob%40example.com?projection=basic`,
    );
    expect(new URL(lookup.url).origin).toBe("https://admin.googleapis.com");
    expect(lookup.headers?.["Authorization"]).toBe(
      `Bearer ${WORKSPACE_TOKEN}-1`,
    );
  });

  test("a user Workspace does not know is no user", async () => {
    expect(
      await workspaceClient(directory({})).findUser("nobody@example.com"),
    ).toBeNull();
    expect(await workspaceClient(directory({})).findUser(" ")).toBeNull();
  });

  test("suspends with a PUT of suspended true, and leaves a suspended user alone", async () => {
    const api: DirectoryTransport = directory({});
    const client: GoogleWorkspaceResponseClient = workspaceClient(api);

    expect(
      await client.suspendUser({
        id: "u-1",
        primaryEmail: "bob@example.com",
        suspended: false,
      }),
    ).toBe(GoogleWorkspaceContainmentOutcome.Done);

    const put: DataSourceHttpRequest = api.requests[1]!;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/u-1`);
    expect(JSON.parse(String(put.body))).toEqual({ suspended: true });

    expect(
      await client.suspendUser({
        id: "u-1",
        primaryEmail: "bob@example.com",
        suspended: true,
      }),
    ).toBe(GoogleWorkspaceContainmentOutcome.AlreadyDone);
    expect(api.requests).toHaveLength(2);
  });

  test("unsuspends a suspended user, and leaves one that is not suspended alone", async () => {
    const api: DirectoryTransport = directory({});
    const client: GoogleWorkspaceResponseClient = workspaceClient(api);

    expect(
      await client.unsuspendUser({
        id: "u-1",
        primaryEmail: "",
        suspended: true,
      }),
    ).toBe(GoogleWorkspaceContainmentOutcome.Done);
    expect(JSON.parse(String(api.requests[1]!.body))).toEqual({
      suspended: false,
    });
    expect(
      await client.unsuspendUser({
        id: "u-1",
        primaryEmail: "",
        suspended: false,
      }),
    ).toBe(GoogleWorkspaceContainmentOutcome.AlreadyDone);
  });

  test("signs a user out with the security scope, a token of its own", async () => {
    const api: DirectoryTransport = directory({
      users: { "bob@example.com": BOB },
    });
    const client: GoogleWorkspaceResponseClient = workspaceClient(api);
    const user: GoogleWorkspaceUser | null =
      await client.findUser("bob@example.com");

    expect(await client.signOut(user!)).toBe(
      GoogleWorkspaceContainmentOutcome.Done,
    );
    expect(api.scopes).toEqual([
      GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE,
      GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE,
    ]);

    const signOut: DataSourceHttpRequest =
      api.requests[api.requests.length - 1]!;
    expect(signOut.method).toBe("POST");
    expect(signOut.url).toBe(
      `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/${String(BOB["id"])}/signOut`,
    );
    expect(signOut.headers?.["Authorization"]).toBe(
      `Bearer ${WORKSPACE_TOKEN}-2`,
    );
  });

  test("a scope the delegation does not list is refused with the scope's name", async () => {
    const api: DirectoryTransport = directory({
      users: { "bob@example.com": BOB },
      undelegated: [GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE],
    });
    const client: GoogleWorkspaceResponseClient = workspaceClient(api);
    const user: GoogleWorkspaceUser | null =
      await client.findUser("bob@example.com");
    const error: Error = await caught(client.signOut(user!));

    expect(error.message).toContain(
      "has no domain-wide delegation for the admin.directory.user.security scope",
    );
    expect(error.message).not.toContain("BEGIN PRIVATE KEY");
  });

  test("a refusal names the administrator it acts as, and never the token", async () => {
    const api: DirectoryTransport = directory({
      failWrite: {
        statusCode: 403,
        body: {
          error: {
            code: 403,
            message: `Not Authorized to access this resource/api ${WORKSPACE_TOKEN}-1`,
          },
        },
      },
    });
    const error: Error = await caught(
      workspaceClient(api).suspendUser({
        id: "u-1",
        primaryEmail: "",
        suspended: false,
      }),
    );

    expect(error.message).toContain(
      "Google Workspace suspend failed (HTTP 403)",
    );
    expect(error.message).toContain(
      `The administrator ${FAKE_ADMIN_EMAIL} the connection acts as must be one who manages this user.`,
    );
    expect(error.message).not.toContain(`${WORKSPACE_TOKEN}-1`);
  });

  test("a key that does not read is refused as the connection refuses it", async () => {
    const client: GoogleWorkspaceResponseClient =
      new GoogleWorkspaceResponseClient({
        serviceAccountJson: "{}",
        adminEmail: FAKE_ADMIN_EMAIL,
        transport: directory({}).transport,
      });

    await expect(client.findUser("bob@example.com")).rejects.toThrow();
  });
});
