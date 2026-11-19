import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { describeFailedAnswer } from "../../../../Server/Utils/DataSource/HttpFailure";
import DataSourceHttpRetry from "../../../../Server/Utils/DataSource/HttpRetry";
import GoogleServiceAccountToken, {
  GoogleSignInAnswer,
  describeGoogleSignInFailure,
  fitGoogleWords,
  getGoogleSignInAdvice,
  readGoogleSignInAnswer,
} from "../../../../Server/Utils/LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { LlmConnectorTransport } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import { JSONValue } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "./FakeProviderApi";

/*
 * #9680: a sign-in Google refuses says Google's reason - who was refused,
 * the status and Google's own code, its description and what to do - in
 * one sentence, never the raw JSON of its answer, and never a secret.
 *
 * The payloads are Google's own: the token endpoint's errors are its "JWT
 * error codes" (OAuth 2.0 for server-to-server applications), and a
 * Google API's error is {"error": {"code", "message", "status"}}.
 */

const CLIENT_EMAIL: string = "oneuptime@acme-prod.iam.gserviceaccount.com";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SERVICE_ACCOUNT: string = JSON.stringify({
  type: "service_account",
  project_id: "acme-prod",
  client_email: CLIENT_EMAIL,
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

// Google's answers, as its token endpoint and its APIs write them.
const INVALID_SIGNATURE: JSONValue = {
  error: "invalid_grant",
  error_description: "Invalid JWT Signature.",
};
const OUT_OF_TIMEFRAME: JSONValue = {
  error: "invalid_grant",
  error_description:
    "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.",
};
const ACCOUNT_NOT_FOUND: JSONValue = {
  error: "invalid_grant",
  error_description: "Invalid grant: account not found",
};
const DISABLED_CLIENT: JSONValue = {
  error: "disabled_client",
  error_description: "The OAuth client was disabled.",
};
const DELETED_CLIENT: JSONValue = {
  error: "deleted_client",
  error_description: "The OAuth client was deleted.",
};
const INVALID_SCOPE: JSONValue = {
  error: "invalid_scope",
  error_description: "Invalid OAuth scope or ID token audience provided.",
};
const PERMISSION_DENIED: JSONValue = {
  error: {
    code: 403,
    message:
      "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
    status: "PERMISSION_DENIED",
  },
};
const BAD_GATEWAY_PAGE: string =
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title><style>body{}</style></head><body><h1>Bad Gateway</h1></body></html>";

describe("what Google's sign-in answered", () => {
  test.each([
    [
      "the token endpoint's refusal of a key",
      JSON.stringify(INVALID_SIGNATURE),
      { code: "invalid_grant", description: "Invalid JWT Signature." },
    ],
    [
      "a refusal of a clock that is off",
      JSON.stringify(OUT_OF_TIMEFRAME),
      {
        code: "invalid_grant",
        description:
          "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.",
      },
    ],
    [
      "a disabled service account",
      JSON.stringify(DISABLED_CLIENT),
      {
        code: "disabled_client",
        description: "The OAuth client was disabled.",
      },
    ],
    [
      "a Google API's error",
      JSON.stringify(PERMISSION_DENIED),
      {
        code: "PERMISSION_DENIED",
        description:
          "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
      },
    ],
    [
      "an error with no description",
      '{"error":"access_denied"}',
      { code: "access_denied", description: "" },
    ],
    [
      "a proxy's page, by its title",
      BAD_GATEWAY_PAGE,
      { code: null, description: "502 Bad Gateway" },
    ],
    [
      "a line of text, its first line",
      "upstream connect error\nreset reason: overflow",
      { code: null, description: "upstream connect error" },
    ],
    ["nothing", "", { code: null, description: "" }],
    ["blanks", "  \n ", { code: null, description: "" }],
    [
      "a code that is no code is left out, its words kept",
      '{"error":"not a code <script>","error_description":"Bad Request"}',
      { code: null, description: "Bad Request" },
    ],
    [
      "a description over several lines, its first",
      '{"error":"invalid_request","error_description":"Bad Request\\nmore detail"}',
      { code: "invalid_request", description: "Bad Request" },
    ],
    [
      "JSON that is no object",
      '["invalid_grant"]',
      { code: null, description: '["invalid_grant"]' },
    ],
  ])(
    "%s",
    (_label: string, body: string, expected: GoogleSignInAnswer): void => {
      expect(readGoogleSignInAnswer(body)).toEqual(expected);
    },
  );
});

describe("Google's words, held to what an error keeps", () => {
  test("words that fit are kept whole", () => {
    expect(fitGoogleWords("Invalid JWT Signature.")).toBe(
      "Invalid JWT Signature.",
    );
  });

  test("longer ones end after their last whole sentence that fits", () => {
    expect(
      fitGoogleWords(
        "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.",
      ),
    ).toBe(
      "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe.",
    );
  });

  test("one long sentence is left to the shared cut", () => {
    const long: string = `Unexpected ${"x".repeat(200)} failure`;

    expect(fitGoogleWords(long)).toBe(long);
  });
});

describe("what to do about a refusal", () => {
  test("a key Google does not take: create a new key", () => {
    expect(
      getGoogleSignInAdvice({
        code: "invalid_grant",
        description: "Invalid JWT Signature.",
      }),
    ).toBe(
      "The key may have been deleted or disabled, or may have expired: create a new key and save it again.",
    );
    // An invalid_grant whose words say nothing more reads the same.
    expect(
      getGoogleSignInAdvice({
        code: "invalid_grant",
        description: "Invalid grant: account not found",
      }),
    ).toBe(
      "The key may have been deleted or disabled, or may have expired: create a new key and save it again.",
    );
  });

  test("a JWT out of its timeframe: the server's clock", () => {
    expect(
      getGoogleSignInAdvice({
        code: "invalid_grant",
        description:
          "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.",
      }),
    ).toBe(
      "The clock of the server OneUptime runs on may be off: check that it keeps the right time.",
    );
  });

  test("a disabled or deleted service account", () => {
    expect(
      getGoogleSignInAdvice({
        code: "disabled_client",
        description: "The OAuth client was disabled.",
      }),
    ).toBe(
      "The service account or its key is disabled: enable it under IAM & Admin > Service Accounts, or create a new key and save it again.",
    );
    expect(
      getGoogleSignInAdvice({
        code: "deleted_client",
        description: "The OAuth client was deleted.",
      }),
    ).toBe(
      "The service account was deleted: restore it within 30 days of its deletion, or create a new one and save its key.",
    );
  });

  test("nothing where Google's words are all there is to say", () => {
    for (const code of [
      "invalid_client",
      "unauthorized_client",
      "access_denied",
      "invalid_scope",
      "PERMISSION_DENIED",
    ]) {
      expect(getGoogleSignInAdvice({ code, description: "x" })).toBe(undefined);
    }

    expect(getGoogleSignInAdvice({ code: null, description: "" })).toBe(
      undefined,
    );
  });
});

describe("a refused sign-in, in one sentence", () => {
  function describe400(body: JSONValue | string, status: number = 400): string {
    return describeGoogleSignInFailure({
      providerTitle: "Google Cloud",
      clientEmail: CLIENT_EMAIL,
      statusCode: status,
      body: typeof body === "string" ? body : JSON.stringify(body),
      secrets: [],
    });
  }

  test("a key Google does not take, as the issue asked: who, the status and code, Google's words and what to do", () => {
    expect(describe400(INVALID_SIGNATURE)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (400, invalid_grant) while signing in: Invalid JWT Signature. The key may have been deleted or disabled, or may have expired: create a new key and save it again.`,
    );
  });

  test("a clock that is off, Google's words cut after their last whole sentence that fits", () => {
    expect(describe400(OUT_OF_TIMEFRAME)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (400, invalid_grant) while signing in: Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. The clock of the server OneUptime runs on may be off: check that it keeps the right time.`,
    );
  });

  test("a deleted service account, and a disabled or deleted client", () => {
    expect(describe400(ACCOUNT_NOT_FOUND)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (400, invalid_grant) while signing in: Invalid grant: account not found. The key may have been deleted or disabled, or may have expired: create a new key and save it again.`,
    );
    expect(describe400(DISABLED_CLIENT)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (400, disabled_client) while signing in: The OAuth client was disabled. The service account or its key is disabled: enable it under IAM & Admin > Service Accounts, or create a new key and save it again.`,
    );
    expect(describe400(DELETED_CLIENT, 401)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (401, deleted_client) while signing in: The OAuth client was deleted. The service account was deleted: restore it within 30 days of its deletion, or create a new one and save its key.`,
    );
  });

  test("a refusal with no words says who was refused", () => {
    expect(describe400('{"error":"access_denied"}', 403)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (403, access_denied) while signing in.`,
    );
  });

  test("a Google API's refusal, by its status", () => {
    expect(describe400(PERMISSION_DENIED, 403)).toBe(
      `Google Cloud refused the service account ${CLIENT_EMAIL} (403, PERMISSION_DENIED) while signing in: Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).`,
    );
  });

  test("what OneUptime asked for wrong is no refusal of the key", () => {
    expect(describe400(INVALID_SCOPE)).toBe(
      "Google Cloud answered 400 (invalid_scope) while signing in: Invalid OAuth scope or ID token audience provided.",
    );
  });

  test("Google down, or a proxy in the way: the status and the words there are", () => {
    expect(describe400(BAD_GATEWAY_PAGE, 502)).toBe(
      "Google Cloud answered 502 while signing in: 502 Bad Gateway.",
    );
    expect(describe400("", 503)).toBe(
      "Google Cloud answered 503 while signing in, with no error message.",
    );
    expect(
      describe400(
        {
          error: { code: 500, message: "Internal error.", status: "INTERNAL" },
        },
        500,
      ),
    ).toBe(
      "Google Cloud answered 500 (INTERNAL) while signing in: Internal error.",
    );
  });

  test("a key without its email says the service account", () => {
    expect(
      describeGoogleSignInFailure({
        providerTitle: "Google BigQuery",
        clientEmail: "  ",
        statusCode: 400,
        body: JSON.stringify(INVALID_SIGNATURE),
        secrets: [],
      }),
    ).toBe(
      "Google BigQuery refused the service account (400, invalid_grant) while signing in: Invalid JWT Signature. The key may have been deleted or disabled, or may have expired: create a new key and save it again.",
    );
  });

  test("never a token, a JSON web token or a secret Google's words repeat", () => {
    const assertion: string =
      "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJvbmV1cHRpbWUifQ.c2lnbmF0dXJlLXZhbHVl";
    const message: string = describeGoogleSignInFailure({
      providerTitle: "Google Cloud",
      clientEmail: CLIENT_EMAIL,
      statusCode: 400,
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: `Invalid JWT ${assertion} for key secret-key-value`,
      }),
      secrets: ["secret-key-value"],
    });

    expect(message).not.toContain(assertion);
    expect(message).not.toContain("secret-key-value");
    expect(message).toContain("Invalid JWT **** for key ****.");
  });

  test("a refusal of a 400 says neither tries nor a request ID, as a 401 does not", () => {
    // The shared wording, marked a refusal: what asking again cannot change.
    expect(
      describeFailedAnswer({
        provider: "Google Cloud",
        statusCode: 400,
        errorCode: "invalid_grant",
        operation: "signing in",
        message: "Invalid JWT Signature.",
        attempts: 3,
        requestId: "abc-123",
        refused: { who: "the service account" },
        isRefusal: true,
      }).message,
    ).toBe(
      "Google Cloud refused the service account (400, invalid_grant) while signing in: Invalid JWT Signature.",
    );
    // Not marked, a 400 is an answer like any other, as before.
    expect(
      describeFailedAnswer({
        provider: "Google Cloud",
        statusCode: 400,
        errorCode: "invalid_grant",
        operation: "signing in",
        message: "Invalid JWT Signature.",
        attempts: 3,
        requestId: "abc-123",
        refused: { who: "the service account" },
      }).message,
    ).toBe(
      "Google Cloud answered 400 (invalid_grant) while signing in: Invalid JWT Signature. Tried 3 times. Request ID: abc-123.",
    );
  });
});

describe("a service account signing in", () => {
  function tokenFor(
    transport: LlmConnectorTransport,
    providerTitle: string = "Google Cloud",
  ): GoogleServiceAccountToken {
    return new GoogleServiceAccountToken({
      serviceAccountJson: SERVICE_ACCOUNT,
      scope: "https://www.googleapis.com/auth/monitoring.read",
      transport,
      providerTitle,
    });
  }

  function answering(response: FakeResponse): FakeProviderApi {
    return createFakeProviderApi([
      {
        path: "/token",
        method: "POST",
        respond: (): FakeResponse => {
          return response;
        },
      },
    ]);
  }

  async function failureOf(
    token: GoogleServiceAccountToken,
  ): Promise<LlmProviderError> {
    const error: unknown = await token.getAccessToken().then(
      (): unknown => {
        return null;
      },
      (thrown: unknown): unknown => {
        return thrown;
      },
    );

    expect(error).toBeInstanceOf(LlmProviderError);

    return error as LlmProviderError;
  }

  test("a revoked key is an authentication failure, in Google's words", async () => {
    const failure: LlmProviderError = await failureOf(
      tokenFor(answering(json(INVALID_SIGNATURE, 400)).transport),
    );

    expect(failure).toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
      statusCode: 400,
      message: `Google Cloud refused the service account ${CLIENT_EMAIL} (400, invalid_grant) while signing in: Invalid JWT Signature. The key may have been deleted or disabled, or may have expired: create a new key and save it again.`,
    });
    // Google's answer is still kept for a client that reads its code.
    expect(failure.responseBody).toBe(JSON.stringify(INVALID_SIGNATURE));
    // No raw JSON in what a person reads.
    expect(failure.message).not.toContain("{");
  });

  test("a 401 is an authentication failure too; a 403 a permission one", async () => {
    expect(
      await failureOf(
        tokenFor(
          answering(
            json(
              { error: "invalid_client", error_description: "Unauthorized" },
              401,
            ),
          ).transport,
        ),
      ),
    ).toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
      statusCode: 401,
      message: `Google Cloud refused the service account ${CLIENT_EMAIL} (401, invalid_client) while signing in: Unauthorized.`,
    });
    expect(
      await failureOf(
        tokenFor(answering(json(PERMISSION_DENIED, 403)).transport),
      ),
    ).toMatchObject({
      kind: LlmConnectionFailureKind.Permission,
      statusCode: 403,
    });
  });

  test("Google down is a service that is down, and says so in a sentence", async () => {
    const failure: LlmProviderError = await failureOf(
      tokenFor(answering({ status: 503, body: BAD_GATEWAY_PAGE }).transport),
    );

    expect(failure).toMatchObject({
      kind: LlmConnectionFailureKind.Unavailable,
      statusCode: 503,
      message: "Google Cloud answered 503 while signing in: 502 Bad Gateway.",
    });
  });

  test("a sign-in that got no answer says what happened, as before", async () => {
    const failure: LlmProviderError = await failureOf(
      tokenFor(async (): Promise<DataSourceHttpResponse> => {
        throw new Error("getaddrinfo ENOTFOUND oauth2.googleapis.com");
      }),
    );

    expect(failure).toMatchObject({
      kind: LlmConnectionFailureKind.Unavailable,
      message:
        "Google Cloud sign-in did not complete: getaddrinfo ENOTFOUND oauth2.googleapis.com",
    });
  });

  test("an answer that is no access token says so, as before", async () => {
    const failure: LlmProviderError = await failureOf(
      tokenFor(answering(json({ token_type: "Bearer" })).transport),
    );

    expect(failure).toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
      message: "Google Cloud sign-in returned no access token.",
    });
  });

  test("the assertion and the private key never reach the message, even when Google repeats them", async () => {
    let assertion: string = "";
    const failure: LlmProviderError = await failureOf(
      tokenFor(
        async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          assertion = String(
            (request.body as Record<string, string>)["assertion"] || "",
          );

          throw new LlmProviderError({
            message: "refused",
            kind: LlmConnectionFailureKind.Other,
            statusCode: 400,
            responseBody: JSON.stringify({
              error: "invalid_grant",
              error_description: `Invalid JWT ${assertion} signed with ${privateKey}`,
            }),
          });
        },
      ),
    );

    expect(assertion.length).toBeGreaterThan(100);
    expect(failure.message).not.toContain(assertion);
    expect(failure.message).not.toContain("PRIVATE KEY");
    expect(failure.kind).toBe(LlmConnectionFailureKind.Authentication);
  });

  /*
   * BigQuery signs in through the shared retry client, whose transport
   * keeps the status and Google's words on a DataSourceStatusException:
   * the sentence is read from those, as from the plain transport's.
   */
  test("through the retry client's transport, as BigQuery signs in", async () => {
    const retry: DataSourceHttpRetry = new DataSourceHttpRetry({
      transport: async (): Promise<DataSourceHttpResponse> => {
        return {
          statusCode: 400,
          bodyText: JSON.stringify(INVALID_SIGNATURE),
          bodyJson: INVALID_SIGNATURE,
        };
      },
      classify: (): null => {
        return null;
      },
      provider: "Google BigQuery",
    });

    const failure: LlmProviderError = await failureOf(
      tokenFor(
        retry.asTransport({
          isSafeToRepeat: (): boolean => {
            return true;
          },
        }),
        "Google BigQuery",
      ),
    );

    expect(failure).toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
      statusCode: 400,
      message: `Google BigQuery refused the service account ${CLIENT_EMAIL} (400, invalid_grant) while signing in: Invalid JWT Signature. The key may have been deleted or disabled, or may have expired: create a new key and save it again.`,
    });
  });
});
