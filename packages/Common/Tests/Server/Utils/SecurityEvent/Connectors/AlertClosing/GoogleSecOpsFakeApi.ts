import { generateKeyPairSync } from "crypto";
import {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { SecurityConnectorSettings } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "../../../../../../Types/JSON";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * A fake Google SecOps for the closing and IOC suites: Google's token
 * endpoint and any Chronicle API call, answering as a test asks and
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
  client_email: "oneuptime-closer@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: TOKEN_URI,
});

export const REGION: string = "europe";
export const INSTANCE: string =
  "projects/acme-secops/locations/europe/instances/7a1c2d3e-instance";
export const API_BASE: string = `https://europe-chronicle.googleapis.com/v1alpha/${INSTANCE}`;
export const UPDATE_ALERT_URL: string = `${API_BASE}/legacy:legacyUpdateAlert`;

export const CONNECTION_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.GoogleSecOps,
  config: { region: REGION, instanceResourceName: INSTANCE },
  secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
  alertingOnly: true,
};

export interface RecordedCall {
  method: string;
  url: string;
  authorization: string;
  body: JSONObject;
}

export interface FakeAnswer {
  status: number;
  body?: string | undefined;
  // No response at all: a refused connection.
  throws?: boolean | undefined;
}

export interface FakeChronicle {
  fetchImplementation: FetchLike;
  calls: Array<RecordedCall>;
  tokenRequests: number;
}

// `answer` decides each API call from the call and how many came before.
export function fakeChronicle(
  answer: (call: RecordedCall, callIndex: number) => FakeAnswer = () => {
    return { status: 200, body: "{}" };
  },
): FakeChronicle {
  const fake: FakeChronicle = {
    calls: [],
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

      const call: RecordedCall = {
        method: init.method || "GET",
        url,
        authorization: init.headers["Authorization"] || "",
        body: JSON.parse(init.body || "{}") as JSONObject,
      };
      const callIndex: number = fake.calls.length;

      fake.calls.push(call);

      const reply: FakeAnswer = answer(call, callIndex);

      if (reply.throws) {
        throw new Error("connect ECONNREFUSED");
      }

      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        text: async (): Promise<string> => {
          return reply.body ?? "";
        },
      };
    },
  };

  return fake;
}

// Google's error body for a status.
export function googleError(status: number, message: string): string {
  return JSON.stringify({
    error: { code: status, message, status: "ERROR", details: [] },
  });
}
