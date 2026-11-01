import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { CloudConnectionSettings } from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSecurityResponseResult,
  GCS_BUCKET_ADMIN_SCOPE,
  blockGcsBucketPublicAccess,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityResponse";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../../LlmObservability/FakeProviderApi";

/*
 * Enforcing a bucket's public access prevention, against a fake Google
 * OAuth and Cloud Storage: a bucket that enforces it already is read and
 * left alone; one that does not gets exactly one PATCH of that one
 * setting, with a token of devstorage.full_control; a refusal says which
 * permission is missing and how the connection gets it; a name that is
 * not a bucket's is refused before any request.
 */

const PROJECT_ID: string = "acme-prod";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});
const BUCKET_PATH: string = "/storage/v1/b/acme-public";

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: { authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey },
    secrets: { serviceAccountJson: KEY },
  };
}

function bucket(iamConfiguration: JSONObject | undefined): JSONObject {
  return iamConfiguration
    ? { name: "acme-public", iamConfiguration }
    : { name: "acme-public" };
}

interface FakeGcs extends FakeProviderApi {
  scopes: Array<string>;
}

function createFakeGcs(
  options: {
    bucket?: JSONObject;
    readError?: FakeResponse;
    writeError?: FakeResponse;
    tokenError?: FakeResponse;
  } = {},
): FakeGcs {
  const scopes: Array<string> = [];
  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const claims: { scope?: string } | null = jwt.decode(
          String((request.body as Dictionary<string>)["assertion"] || ""),
        ) as { scope?: string } | null;

        scopes.push(claims?.scope || "");

        return (
          options.tokenError ||
          json({ access_token: "ya29.token", expires_in: 3599 })
        );
      },
    },
    {
      host: "storage.googleapis.com",
      path: BUCKET_PATH,
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        if (request.method === "PATCH") {
          return (
            options.writeError ||
            json(
              bucket({
                publicAccessPrevention: "enforced",
                uniformBucketLevelAccess: { enabled: true },
              }),
            )
          );
        }

        return (
          options.readError ||
          json(
            options.bucket ||
              bucket({
                publicAccessPrevention: "inherited",
                uniformBucketLevelAccess: { enabled: true },
              }),
          )
        );
      },
    },
  ]);

  return { ...api, scopes };
}

function patchesOf(api: FakeProviderApi): Array<DataSourceHttpRequest> {
  return api.requests.filter((request: DataSourceHttpRequest): boolean => {
    return request.method === "PATCH";
  });
}

async function block(
  api: FakeProviderApi,
  name: string = "acme-public",
): Promise<DataSecurityResponseResult> {
  return await blockGcsBucketPublicAccess(settings(), {
    connectionId: "22222222-2222-4222-8222-222222222222",
    bucket: name,
    transport: api.transport,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    (): unknown => {
      return undefined;
    },
    (error: unknown): unknown => {
      return error;
    },
  );
}

const REFUSED: FakeResponse = {
  status: 403,
  body: {
    error: {
      code: 403,
      message:
        "oneuptime-read-only@acme-prod.iam.gserviceaccount.com does not have storage.buckets.update access to the Google Cloud Storage bucket.",
    },
  },
};

describe("enforcing a bucket's public access prevention", () => {
  test("a bucket that enforces it already is read and left alone", async () => {
    const api: FakeGcs = createFakeGcs({
      bucket: bucket({ publicAccessPrevention: "enforced" }),
    });
    const result: DataSecurityResponseResult = await block(api);

    expect(result).toEqual({
      changed: false,
      summary:
        "Public access prevention is already on for bucket acme-public; nothing changed.",
    });
    expect(patchesOf(api)).toHaveLength(0);

    const read: DataSourceHttpRequest = api.requestsTo(BUCKET_PATH)[0]!;
    expect(read.method).toBe("GET");
    // Its name and IAM configuration only: never its ACLs or labels.
    expect(new URL(read.url).searchParams.get("fields")).toBe(
      "name,iamConfiguration",
    );
  });

  test("a bucket that does not gets exactly one PATCH of that one setting, with the narrowest scope that allows it", async () => {
    const api: FakeGcs = createFakeGcs();
    const result: DataSecurityResponseResult = await block(api);
    const patches: Array<DataSourceHttpRequest> = patchesOf(api);

    expect(result).toEqual({
      changed: true,
      summary:
        "Turned on public access prevention for bucket acme-public: nothing in it can be read publicly now, whatever its IAM policy or ACLs say.",
    });
    expect(patches).toHaveLength(1);
    expect(new URL(patches[0]!.url).host).toBe("storage.googleapis.com");
    expect(new URL(patches[0]!.url).pathname).toBe(BUCKET_PATH);
    expect(bodyOf(patches[0]!)).toEqual({
      iamConfiguration: { publicAccessPrevention: "enforced" },
    });
    expect(patches[0]!.headers?.["Content-Type"]).toBe("application/json");
    expect(patches[0]!.headers?.["Authorization"]).toBe("Bearer ya29.token");
    expect(api.scopes).toEqual([GCS_BUCKET_ADMIN_SCOPE]);
    expect(GCS_BUCKET_ADMIN_SCOPE).toBe(
      "https://www.googleapis.com/auth/devstorage.full_control",
    );
  });

  test("a bucket that says nothing of it is changed", async () => {
    const api: FakeGcs = createFakeGcs({ bucket: bucket(undefined) });

    expect((await block(api)).changed).toBe(true);
    expect(patchesOf(api)).toHaveLength(1);
  });

  test("a refused change says which permission is missing and how the connection gets it", async () => {
    const failure: unknown = await failureOf(
      block(createFakeGcs({ writeError: REFUSED })),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as LlmProviderError).message).toBe(
      'The service account may not change bucket acme-public: it needs storage.buckets.update. Turn on the connection\'s "Data security response" setting and run its updated setup command.',
    );
  });

  test("a refused read says so too, and nothing is written", async () => {
    const api: FakeGcs = createFakeGcs({ readError: REFUSED });
    const failure: unknown = await failureOf(block(api));

    expect((failure as LlmProviderError).message).toContain(
      "it needs storage.buckets.get",
    );
    expect(patchesOf(api)).toHaveLength(0);
  });

  test("a Cloud Storage API turned off says the command that turns it on; a bucket that is gone says so", async () => {
    const disabled: unknown = await failureOf(
      block(
        createFakeGcs({
          readError: {
            status: 403,
            body: {
              error: {
                code: 403,
                message:
                  "Cloud Storage JSON API has not been used in project 123456789012 before or it is disabled.",
              },
            },
          },
        }),
      ),
    );
    const gone: unknown = await failureOf(
      block(
        createFakeGcs({
          readError: {
            status: 404,
            body: { error: { code: 404, message: "Not Found" } },
          },
        }),
      ),
    );

    expect((disabled as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Settings,
    );
    expect((disabled as LlmProviderError).message).toContain(
      "gcloud services enable storage.googleapis.com",
    );
    expect((gone as LlmProviderError).message).toBe(
      "Bucket acme-public was not found: it may have been deleted.",
    );
  });

  test("a refused key is thrown as what it is", async () => {
    const failure: unknown = await failureOf(
      block(
        createFakeGcs({
          tokenError: {
            status: 400,
            body: { error: "invalid_grant", error_description: "Invalid JWT" },
          },
        }),
      ),
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("a name that is not a bucket's is refused before any request", async () => {
    const api: FakeGcs = createFakeGcs();

    for (const name of [
      "evil.example.com/x",
      "Acme-Public",
      "ab",
      "acme public",
      "acme-public?fields=acl",
      "../acme-public",
    ]) {
      await expect(block(api, name)).rejects.toThrow(BadDataException);
    }

    expect(api.requests).toHaveLength(0);
  });
});
