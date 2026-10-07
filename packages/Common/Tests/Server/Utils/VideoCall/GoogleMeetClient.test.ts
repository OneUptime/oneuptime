import { generateKeyPairSync } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
import GoogleMeetClient, {
  GOOGLE_DEFAULT_TOKEN_URI,
  GOOGLE_MEET_SPACES_URL,
} from "../../../../Server/Utils/VideoCall/Providers/GoogleMeetClient";
import VideoCallHttpClient from "../../../../Server/Utils/VideoCall/VideoCallHttpClient";
import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import VideoCallMeeting from "../../../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import { GOOGLE_MEET_SCOPE } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import {
  ScriptedFetch,
  readFormBody,
  readJsonBody,
  scriptedFetch,
} from "./VideoCallTestFetch";
import { describe, expect, test } from "@jest/globals";

/*
 * The Google Meet half of incident calls: the domain-wide delegation
 * assertion, the space it creates, and what a person reads when Google
 * refuses.
 *
 * The assertion's claims are read out of jwt.verify against the public half
 * of the key, so a test passes only for an assertion actually signed with
 * the key the service account carries - never for an unsigned one that
 * merely decodes.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const CLIENT_EMAIL: string = "oneuptime-meet@acme.iam.gserviceaccount.com";
const CLIENT_ID: string = "102345678901234567890";
const USER_EMAIL: string = "incidents@acme.com";

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: CLIENT_EMAIL,
  client_id: CLIENT_ID,
  private_key: privateKey,
  token_uri: GOOGLE_DEFAULT_TOKEN_URI,
});

const TOKEN_RESPONSE: JSONObject = {
  access_token: "google-access-token",
  expires_in: 3599,
  token_type: "Bearer",
};

const SPACE_RESPONSE: JSONObject = {
  name: "spaces/jQCFfuBOdN5z",
  meetingUri: "https://meet.google.com/abc-mnop-xyz",
  meetingCode: "abc-mnop-xyz",
  config: { accessType: "TRUSTED", entryPointAccess: "ALL" },
};

function newClient(
  fetcher: ScriptedFetch,
  overrides?: Partial<{ accessType: string; serviceAccountJson: string }>,
): GoogleMeetClient {
  return new GoogleMeetClient(
    {
      serviceAccountJson: overrides?.serviceAccountJson || SERVICE_ACCOUNT_JSON,
      impersonatedUserEmail: USER_EMAIL,
      accessType: overrides?.accessType || "TRUSTED",
    },
    new VideoCallHttpClient({ fetchImplementation: fetcher.fetch }),
  );
}

describe("GoogleMeetClient", () => {
  test("signs a delegation assertion that acts as the Workspace user, for the Meet scope only", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 200, body: SPACE_RESPONSE },
    ]);

    await newClient(fetcher).createMeeting({ title: "INC-42" });

    const tokenRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[0]!;
    expect(tokenRequest.url).toBe(GOOGLE_DEFAULT_TOKEN_URI);

    const form: URLSearchParams = readFormBody(tokenRequest);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );

    const claims: JwtPayload = jwt.verify(form.get("assertion")!, publicKey, {
      algorithms: ["RS256"],
    }) as JwtPayload;

    expect(claims["iss"]).toBe(CLIENT_EMAIL);
    expect(claims["sub"]).toBe(USER_EMAIL);
    expect(claims["scope"]).toBe(GOOGLE_MEET_SCOPE);
    expect(claims["aud"]).toBe(GOOGLE_DEFAULT_TOKEN_URI);
    // Google's maximum lifetime, and iat never in the future.
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(3600);
    expect(claims["iat"] as number).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000),
    );
  });

  test("creates a space with the chosen access type and returns its link", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 200, body: SPACE_RESPONSE },
    ]);

    const meeting: VideoCallMeeting = await newClient(fetcher, {
      accessType: "OPEN",
    }).createMeeting({ title: "INC-42" });

    const spaceRequest: (typeof fetcher.requests)[number] =
      fetcher.requests[1]!;
    expect(spaceRequest.url).toBe(GOOGLE_MEET_SPACES_URL);
    expect(spaceRequest.init.method).toBe("POST");
    expect(spaceRequest.init.headers["Authorization"]).toBe(
      "Bearer google-access-token",
    );
    expect(readJsonBody(spaceRequest)).toEqual({
      config: { accessType: "OPEN", entryPointAccess: "ALL" },
    });

    expect(meeting).toEqual({
      provider: VideoCallProvider.GoogleMeet,
      joinUrl: "https://meet.google.com/abc-mnop-xyz",
      externalMeetingId: "spaces/jQCFfuBOdN5z",
    });
  });

  test("falls back to TRUSTED for an access type Google does not take", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      { status: 200, body: SPACE_RESPONSE },
    ]);

    await newClient(fetcher, { accessType: "RESTRICTED" }).createMeeting({
      title: "x",
    });

    expect(readJsonBody(fetcher.requests[1]!)["config"]).toEqual({
      accessType: "TRUSTED",
      entryPointAccess: "ALL",
    });
  });

  test("explains missing domain-wide delegation with the client id and scope to authorize", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      {
        status: 401,
        body: {
          error: "unauthorized_client",
          error_description:
            "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.",
        },
      },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(BadDataException);
    const message: string = (error as Error).message;
    expect(message).toContain(`act as ${USER_EMAIL}`);
    expect(message).toContain(`client ID ${CLIENT_ID}`);
    expect(message).toContain(GOOGLE_MEET_SCOPE);
    expect(message).toContain("Domain Wide Delegation");
  });

  test("tells a deleted key apart from an unknown user", async () => {
    const deletedKey: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        },
      },
    ]);

    await expect(
      newClient(deletedKey).createMeeting({ title: "x" }),
    ).rejects.toThrow(/it may have been deleted or disabled/);

    const unknownUser: ScriptedFetch = scriptedFetch([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Invalid email or User ID",
        },
      },
    ]);

    await expect(
      newClient(unknownUser).createMeeting({ title: "x" }),
    ).rejects.toThrow(/is an active user of your Google Workspace/);
  });

  test("explains a disabled Meet API", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message:
              "Google Meet REST API has not been used in project 123 before or it is disabled.",
            status: "PERMISSION_DENIED",
            details: [{ reason: "SERVICE_DISABLED" }],
          },
        },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/Google Meet REST API is not enabled/);
  });

  test("explains any other permission refusal", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
          },
        },
      },
    ]);

    const error: unknown = await newClient(fetcher)
      .createMeeting({ title: "x" })
      .catch((e: unknown) => {
        return e;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      `did not allow ${USER_EMAIL} to create a meeting space`,
    );
  });

  test("reports a Google outage as a provider failure", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 500,
        body: { error: { code: 500, message: "Internal error" } },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toBeInstanceOf(APIException);
  });

  test("refuses a space without a meet.google.com link", async () => {
    const fetcher: ScriptedFetch = scriptedFetch([
      { status: 200, body: TOKEN_RESPONSE },
      {
        status: 200,
        body: { ...SPACE_RESPONSE, meetingUri: "https://evil.example.com/x" },
      },
    ]);

    await expect(
      newClient(fetcher).createMeeting({ title: "x" }),
    ).rejects.toThrow(/no join link/);
  });

  describe("parseServiceAccountJson", () => {
    test("reads a real key file", () => {
      expect(
        GoogleMeetClient.parseServiceAccountJson(SERVICE_ACCOUNT_JSON),
      ).toEqual({
        clientEmail: CLIENT_EMAIL,
        clientId: CLIENT_ID,
        privateKey: privateKey,
        tokenUri: GOOGLE_DEFAULT_TOKEN_URI,
      });
    });

    test("defaults the token endpoint when the key file has none", () => {
      expect(
        GoogleMeetClient.parseServiceAccountJson(
          JSON.stringify({
            client_email: CLIENT_EMAIL,
            private_key: privateKey,
          }),
        ).tokenUri,
      ).toBe(GOOGLE_DEFAULT_TOKEN_URI);
    });

    test.each([
      ["text that is not JSON", "not json", "not valid JSON"],
      ["an array", "[]", "must be a JSON object"],
      ["null", "null", "must be a JSON object"],
      [
        "a key without private_key",
        JSON.stringify({ client_email: CLIENT_EMAIL }),
        "client_email and private_key",
      ],
      [
        "a client_email that is not text",
        JSON.stringify({ client_email: {}, private_key: privateKey }),
        "client_email and private_key",
      ],
      [
        "a private_key that is not a PEM key",
        JSON.stringify({
          client_email: CLIENT_EMAIL,
          private_key: "not a key",
        }),
        "not a readable PEM private key",
      ],
      [
        "a token_uri on another host",
        JSON.stringify({
          client_email: CLIENT_EMAIL,
          private_key: privateKey,
          token_uri: "https://attacker.example.com/token",
        }),
        "not on a Google host",
      ],
      [
        "a token_uri over http",
        JSON.stringify({
          client_email: CLIENT_EMAIL,
          private_key: privateKey,
          token_uri: "http://oauth2.googleapis.com/token",
        }),
        "not on a Google host",
      ],
    ])("refuses %s", (_label: string, json: string, expected: string) => {
      expect(() => {
        return GoogleMeetClient.parseServiceAccountJson(json);
      }).toThrow(expected);
    });
  });

  test("recognises Meet links only on meet.google.com over https", () => {
    expect(
      GoogleMeetClient.isMeetUrl("https://meet.google.com/abc-defg-hij"),
    ).toBe(true);
    expect(GoogleMeetClient.isMeetUrl("http://meet.google.com/abc")).toBe(
      false,
    );
    expect(
      GoogleMeetClient.isMeetUrl("https://meet.google.com.evil.io/a"),
    ).toBe(false);
  });
});
