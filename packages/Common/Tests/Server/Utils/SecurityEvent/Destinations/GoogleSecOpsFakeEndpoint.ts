import { generateKeyPairSync } from "crypto";
import {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { JSONObject } from "../../../../../Types/JSON";
import { SecurityEventDestinationSettings } from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";

/*
 * A fake Google SecOps for the destination suites: Google's token endpoint
 * and the Chronicle API's events:import, answering as a test asks and
 * recording every request - so the real client, signing a real service
 * account's assertion, is exercised end to end without the network.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export const TOKEN_URI: string = "https://oauth2.googleapis.com/token";

export const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "oneuptime-sender@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: TOKEN_URI,
});

export const REGION: string = "us";
export const INSTANCE: string =
  "projects/acme-secops/locations/us/instances/0f6c1d2e-instance";
export const IMPORT_URL: string = `https://us-chronicle.googleapis.com/v1alpha/${INSTANCE}/events:import`;

export const DESTINATION_SETTINGS: SecurityEventDestinationSettings = {
  provider: SecurityEventDestinationProvider.GoogleSecOps,
  config: { region: REGION, instanceResourceName: INSTANCE },
  secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
};

export interface RecordedImport {
  url: string;
  authorization: string;
  body: JSONObject;
  // The UDM events the request carried.
  events: Array<JSONObject>;
}

export interface FakeAnswer {
  status: number;
  body?: string | undefined;
  // Answer with no response at all: a refused connection.
  throws?: boolean | undefined;
}

export interface FakeSecOps {
  fetchImplementation: FetchLike;
  imports: Array<RecordedImport>;
  tokenRequests: number;
}

/*
 * `answer` decides each events:import call from what it carries and how
 * many came before; the token endpoint always grants a token.
 */
export function fakeSecOps(
  answer: (events: Array<JSONObject>, callIndex: number) => FakeAnswer = () => {
    return { status: 200, body: "{}" };
  },
): FakeSecOps {
  const fake: FakeSecOps = {
    imports: [],
    tokenRequests: 0,
    fetchImplementation: async (
      url: string,
      init: FetchInitLike,
    ): Promise<FetchResponseLike> => {
      if (url === TOKEN_URI) {
        fake.tokenRequests++;

        return {
          ok: true,
          status: 200,
          text: async (): Promise<string> => {
            return JSON.stringify({
              access_token: `token-${fake.tokenRequests}`,
              expires_in: 3600,
            });
          },
        };
      }

      const body: JSONObject = JSON.parse(init.body || "{}") as JSONObject;
      const inline: JSONObject = (body["inlineSource"] || {}) as JSONObject;
      const events: Array<JSONObject> = (
        (inline["events"] || []) as Array<JSONObject>
      ).map((entry: JSONObject): JSONObject => {
        return entry["udm"] as JSONObject;
      });

      const callIndex: number = fake.imports.length;

      fake.imports.push({
        url,
        authorization: init.headers["Authorization"] || "",
        body,
        events,
      });

      const reply: FakeAnswer = answer(events, callIndex);

      if (reply.throws) {
        throw new Error("connect ECONNREFUSED");
      }

      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        text: async (): Promise<string> => {
          return reply.body || "";
        },
      };
    },
  };

  return fake;
}

// Google's error body for a status, with its ErrorInfo reason.
export function googleError(
  status: number,
  message: string,
  reason?: string | undefined,
): string {
  return JSON.stringify({
    error: {
      code: status,
      message,
      status: "ERROR",
      details: reason
        ? [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason,
              domain: "googleapis.com",
            },
          ]
        : [],
    },
  });
}
