import { generateKeyPairSync, KeyObject, verify } from "crypto";
import { gunzipSync } from "zlib";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { AuditLogExportHttpTransport } from "../../../../Server/AuditLogExport/Destinations/Types";

/*
 * A FAITHFUL FAKE OF GOOGLE CLOUD STORAGE and of Google's token endpoint,
 * for the Cloud Storage destination's suite:
 *
 *   - POST https://oauth2.googleapis.com/token takes the jwt-bearer grant
 *     only with an assertion it verifies itself (RS256, with the service
 *     account's public key) naming the account, the token URI as audience,
 *     and a Cloud Storage scope, and answers an access token;
 *   - POST https://storage.googleapis.com/upload/storage/v1/b/<bucket>/o
 *     ?uploadType=media&name=<name> takes only a token it issued, answers
 *     404 for a bucket that does not exist and 403 for an account the
 *     bucket's IAM does not let create objects, as the JSON API does, and
 *     stores the object.
 *
 * Not a test file itself.
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export const SERVICE_ACCOUNT_EMAIL: string =
  "audit-export@acme-prod.iam.gserviceaccount.com";

export const TOKEN_URI: string = "https://oauth2.googleapis.com/token";

export const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: SERVICE_ACCOUNT_EMAIL,
  private_key: privateKey,
  token_uri: TOKEN_URI,
});

// Another account's key: signed with a key the fake does not know.
export const OTHER_SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: "someone-else@acme-prod.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey,
  token_uri: TOKEN_URI,
});

export interface FakeGcsObject {
  name: string;
  body: Buffer;
  contentType: string;
}

export interface FakeGcs {
  transport: AuditLogExportHttpTransport;
  objects: Map<string, FakeGcsObject>;
  tokenRequests: number;
  uploads: Array<DataSourceHttpRequest>;
  // Every token the fake issued, so a test can revoke one.
  revokeAllTokens: () => void;
  failNextUpload: (status: number) => void;
  readObject: (bucket: string, name: string) => Array<Record<string, unknown>>;
}

function json(status: number, body: JSONObject): DataSourceHttpResponse {
  return { statusCode: status, bodyText: JSON.stringify(body), bodyJson: body };
}

function googleError(status: number, message: string): DataSourceHttpResponse {
  return json(status, {
    error: { code: status, message, errors: [{ message }] },
  });
}

function asTransportAnswer(
  response: DataSourceHttpResponse,
): DataSourceHttpResponse {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response;
  }

  throw new Error(
    `Data source responded with HTTP ${response.statusCode}: ${response.bodyText}`,
  );
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value.split("-").join("+").split("_").join("/"), "base64");
}

// The assertion's claims when its RS256 signature verifies with the key, or null.
function verifyAssertion(
  assertion: string,
  key: string | KeyObject,
): JSONObject | null {
  const parts: Array<string> = assertion.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const header: JSONObject = JSON.parse(
    base64UrlDecode(parts[0]!).toString("utf8"),
  ) as JSONObject;

  if (header["alg"] !== "RS256") {
    return null;
  }

  const isValid: boolean = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
    key,
    base64UrlDecode(parts[2]!),
  );

  if (!isValid) {
    return null;
  }

  return JSON.parse(base64UrlDecode(parts[1]!).toString("utf8")) as JSONObject;
}

export function createFakeGoogleCloudStorage(options: {
  // Buckets, and the accounts their IAM lets create objects.
  buckets: Dictionary<{ creators: Array<string> }>;
}): FakeGcs {
  const objects: Map<string, FakeGcsObject> = new Map<string, FakeGcsObject>();
  const tokens: Map<string, string> = new Map<string, string>();
  const uploads: Array<DataSourceHttpRequest> = [];
  const uploadFailures: Array<number> = [];
  const fake: { tokenRequests: number } = { tokenRequests: 0 };

  const handleToken: (
    request: DataSourceHttpRequest,
  ) => DataSourceHttpResponse = (
    request: DataSourceHttpRequest,
  ): DataSourceHttpResponse => {
    fake.tokenRequests++;

    const form: Dictionary<string> =
      request.body &&
      typeof request.body === "object" &&
      !Buffer.isBuffer(request.body)
        ? (request.body as Dictionary<string>)
        : {};

    if (
      form["grant_type"] !== "urn:ietf:params:oauth:grant-type:jwt-bearer" ||
      !request.formUrlEncoded
    ) {
      return json(400, { error: "unsupported_grant_type" });
    }

    const claims: JSONObject | null = verifyAssertion(
      form["assertion"] || "",
      publicKey,
    );

    if (!claims) {
      return json(400, {
        error: "invalid_grant",
        error_description: "Invalid JWT Signature.",
      });
    }

    if (
      claims["iss"] !== SERVICE_ACCOUNT_EMAIL ||
      claims["aud"] !== TOKEN_URI ||
      !String(claims["scope"] || "").includes(
        "https://www.googleapis.com/auth/devstorage",
      ) ||
      Number(claims["exp"]) <= Number(claims["iat"])
    ) {
      return json(400, { error: "invalid_grant" });
    }

    const token: string = `ya29.fake-${tokens.size + 1}`;
    tokens.set(token, String(claims["iss"]));

    return json(200, {
      access_token: token,
      expires_in: 3599,
      token_type: "Bearer",
    });
  };

  const handleUpload: (
    request: DataSourceHttpRequest,
  ) => DataSourceHttpResponse = (
    request: DataSourceHttpRequest,
  ): DataSourceHttpResponse => {
    uploads.push(request);

    const failure: number | undefined = uploadFailures.shift();

    if (failure) {
      return googleError(failure, "Backend Error");
    }

    const url: URL = new URL(request.url);
    const prefix: string = "/upload/storage/v1/b/";

    if (
      request.method !== "POST" ||
      !url.pathname.startsWith(prefix) ||
      !url.pathname.endsWith("/o") ||
      url.searchParams.get("uploadType") !== "media"
    ) {
      return googleError(400, "Invalid upload request.");
    }

    const authorization: string = String(
      (request.headers || {})["Authorization"] || "",
    );
    const account: string | undefined = tokens.get(
      authorization.startsWith("Bearer ") ? authorization.slice(7) : "",
    );

    if (!account) {
      return googleError(401, "Invalid Credentials");
    }

    const bucket: string = decodeURIComponent(
      url.pathname.slice(prefix.length, -"/o".length),
    );
    const name: string = url.searchParams.get("name") || "";

    if (!options.buckets[bucket]) {
      return googleError(404, "The specified bucket does not exist.");
    }

    if (!options.buckets[bucket]!.creators.includes(account)) {
      return googleError(
        403,
        `${account} does not have storage.objects.create access to the Google Cloud Storage object. Permission 'storage.objects.create' denied on resource (or it may not exist).`,
      );
    }

    const body: Buffer = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(String(request.body ?? ""), "utf8");

    objects.set(`${bucket}/${name}`, {
      name,
      body,
      contentType: String((request.headers || {})["Content-Type"] || ""),
    });

    return json(200, { kind: "storage#object", bucket, name });
  };

  return {
    objects,
    uploads,
    get tokenRequests(): number {
      return fake.tokenRequests;
    },
    revokeAllTokens: (): void => {
      tokens.clear();
    },
    failNextUpload: (status: number): void => {
      uploadFailures.push(status);
    },
    readObject: (
      bucket: string,
      name: string,
    ): Array<Record<string, unknown>> => {
      const object: FakeGcsObject | undefined = objects.get(
        `${bucket}/${name}`,
      );

      if (!object) {
        throw new Error(`No object ${name} in ${bucket}.`);
      }

      return gunzipSync(object.body)
        .toString("utf8")
        .split("\n")
        .filter((line: string): boolean => {
          return line.length > 0;
        })
        .map((line: string): Record<string, unknown> => {
          return JSON.parse(line) as Record<string, unknown>;
        });
    },
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      if (request.url === TOKEN_URI) {
        return asTransportAnswer(handleToken(request));
      }

      if (new URL(request.url).host === "storage.googleapis.com") {
        return asTransportAnswer(handleUpload(request));
      }

      throw new Error(`The fake does not answer ${request.url}.`);
    },
  } as FakeGcs;
}
