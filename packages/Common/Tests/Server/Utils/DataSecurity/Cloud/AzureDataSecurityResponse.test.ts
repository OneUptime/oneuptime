import { describe, expect, test } from "@jest/globals";
import AzureArm from "../../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import { CloudConnectionSettings } from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSecurityResponseResult,
  blockAzureStoragePublicAccess,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityResponse";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
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
 * Turning a storage account's anonymous blob access off, against a fake
 * Resource Manager: an account that is already safe is read and left
 * alone; one that is not gets exactly one PATCH of the one setting; a
 * refusal says which permission is missing and how the connection gets
 * it; an id that is not a storage account of the connection's is refused
 * before any request.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SECRET: string = "client-secret~value";
const SUB_A: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SUB_OTHER: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const ACCOUNT_ID: string = `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/acmepublic`;
const ARM_TOKEN: string = "arm-access-token";

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
      subscriptionIds: SUB_A,
      ...config,
    },
    secrets: { clientSecret: SECRET },
  };
}

function account(properties: JSONObject): JSONObject {
  return {
    id: ACCOUNT_ID,
    name: "acmepublic",
    type: "Microsoft.Storage/storageAccounts",
    location: "westeurope",
    properties: {
      networkAcls: { defaultAction: "Deny", ipRules: [] },
      minimumTlsVersion: "TLS1_2",
      ...properties,
    },
  };
}

function createFakeAzure(
  options: {
    account?: JSONObject;
    readError?: FakeResponse;
    writeError?: FakeResponse;
    tokenError?: FakeResponse;
  } = {},
): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return (
          options.tokenError ||
          json({ access_token: ARM_TOKEN, expires_in: 3599 })
        );
      },
    },
    {
      host: "management.azure.com",
      path: ACCOUNT_ID,
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        if (request.method === "PATCH") {
          return (
            options.writeError ||
            json(account({ allowBlobPublicAccess: false }))
          );
        }

        return (
          options.readError ||
          json(options.account || account({ allowBlobPublicAccess: true }))
        );
      },
    },
  ]);
}

function patchesOf(api: FakeProviderApi): Array<DataSourceHttpRequest> {
  return api.requests.filter((request: DataSourceHttpRequest): boolean => {
    return request.method === "PATCH";
  });
}

async function block(
  api: FakeProviderApi,
  data: { resourceId?: string; settings?: CloudConnectionSettings } = {},
): Promise<DataSecurityResponseResult> {
  return await blockAzureStoragePublicAccess(data.settings || settings(), {
    connectionId: "22222222-2222-4222-8222-222222222222",
    resourceId: data.resourceId || ACCOUNT_ID,
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
      code: "AuthorizationFailed",
      message:
        "The client does not have authorization to perform action 'Microsoft.Storage/storageAccounts/write' over scope.",
    },
  },
};

describe("turning off a storage account's anonymous blob access", () => {
  test("an account that has it off already is read and left alone", async () => {
    const api: FakeProviderApi = createFakeAzure({
      account: account({ allowBlobPublicAccess: false }),
    });
    const result: DataSecurityResponseResult = await block(api);

    expect(result).toEqual({
      changed: false,
      summary:
        "Anonymous blob access is already off on storage account acmepublic; nothing changed.",
    });
    expect(patchesOf(api)).toHaveLength(0);

    const read: DataSourceHttpRequest = api.requestsTo(ACCOUNT_ID)[0]!;
    expect(read.method).toBe("GET");
    expect(new URL(read.url).searchParams.get("api-version")).toBe(
      "2023-05-01",
    );
  });

  test("an account that allows it gets exactly one PATCH of that one setting", async () => {
    const api: FakeProviderApi = createFakeAzure();
    const result: DataSecurityResponseResult = await block(api);
    const patches: Array<DataSourceHttpRequest> = patchesOf(api);

    expect(result).toEqual({
      changed: true,
      summary:
        "Turned off anonymous blob access on storage account acmepublic: no container in it can be read anonymously now.",
    });
    expect(patches).toHaveLength(1);
    expect(new URL(patches[0]!.url).host).toBe("management.azure.com");
    expect(new URL(patches[0]!.url).pathname).toBe(ACCOUNT_ID);
    expect(new URL(patches[0]!.url).searchParams.get("api-version")).toBe(
      "2023-05-01",
    );
    // The one setting, and nothing else - not the firewall a PUT would reset.
    expect(bodyOf(patches[0]!)).toEqual({
      properties: { allowBlobPublicAccess: false },
    });
    expect(patches[0]!.headers?.["Authorization"]).toBe(`Bearer ${ARM_TOKEN}`);
    expect(patches[0]!.headers?.["Content-Type"]).toBe("application/json");
  });

  test("an account that never set it allows it, as Azure reads it, and is changed", async () => {
    const api: FakeProviderApi = createFakeAzure({ account: account({}) });

    expect((await block(api)).changed).toBe(true);
    expect(patchesOf(api)).toHaveLength(1);
  });

  test("a refused change says which permission is missing and how the connection gets it", async () => {
    const failure: unknown = await failureOf(
      block(createFakeAzure({ writeError: REFUSED })),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as LlmProviderError).message).toBe(
      'The app may not change storage account acmepublic: it needs Microsoft.Storage/storageAccounts/write. Turn on the connection\'s "Data security response" setting and run its updated setup command.',
    );
  });

  test("a refused read says so too, and nothing is written", async () => {
    const api: FakeProviderApi = createFakeAzure({ readError: REFUSED });
    const failure: unknown = await failureOf(block(api));

    expect((failure as LlmProviderError).message).toContain(
      "it needs Microsoft.Storage/storageAccounts/read",
    );
    expect(patchesOf(api)).toHaveLength(0);
  });

  test("an account that is gone, or locked, is said as what it is", async () => {
    const gone: unknown = await failureOf(
      block(
        createFakeAzure({
          readError: {
            status: 404,
            body: {
              error: { code: "ResourceNotFound", message: "Not found." },
            },
          },
        }),
      ),
    );
    const locked: unknown = await failureOf(
      block(
        createFakeAzure({
          writeError: {
            status: 409,
            body: {
              error: {
                code: "ScopeLocked",
                message:
                  "The scope cannot perform write operation because it is locked.",
              },
            },
          },
        }),
      ),
    );

    expect((gone as LlmProviderError).message).toBe(
      "Storage account acmepublic was not found: it may have been deleted or moved.",
    );
    expect((gone as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Settings,
    );
    expect((locked as LlmProviderError).message).toContain("a lock on it");
    // Azure's own reason follows.
    expect((locked as LlmProviderError).message).toContain(
      "because it is locked",
    );
  });

  test("a refused sign-in is thrown as what it is", async () => {
    const failure: unknown = await failureOf(
      block(
        createFakeAzure({
          tokenError: {
            status: 401,
            body: {
              error: "invalid_client",
              error_description:
                "AADSTS7000215: Invalid client secret provided.",
            },
          },
        }),
      ),
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("an id that is not one of the connection's storage accounts is refused before any request", async () => {
    const api: FakeProviderApi = createFakeAzure();

    for (const resourceId of [
      `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Compute/virtualMachines/vm-1`,
      `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/acmepublic/blobServices/default`,
      `/subscriptions/${SUB_A}/resourceGroups/../providers/Microsoft.Storage/storageAccounts/acmepublic`,
      `https://evil.example.com/subscriptions/${SUB_A}/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/acme`,
      `/subscriptions/${SUB_A}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/acme?api-version=1`,
      // A subscription the connection does not read.
      `/subscriptions/${SUB_OTHER}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/acmepublic`,
    ]) {
      await expect(block(api, { resourceId })).rejects.toThrow(
        BadDataException,
      );
    }

    expect(api.requests).toHaveLength(0);
  });

  test("a connection that names no subscription may change an account in any it reads", async () => {
    const api: FakeProviderApi = createFakeAzure();

    expect(
      (await block(api, { settings: settings({ subscriptionIds: "" }) }))
        .changed,
    ).toBe(true);
  });

  test("the PATCH helper sends the management token to the management host only", async () => {
    const api: FakeProviderApi = createFakeAzure();
    const arm: AzureArm = new AzureArm({
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: SECRET,
      cloud: "public",
      transport: api.transport,
    });

    await expect(
      arm.patch("https://evil.example.com/x", {}, "test update"),
    ).rejects.toThrow(BadDataException);
    await expect(
      arm.patch(
        "https://acmepublic.blob.core.windows.net/x",
        {},
        "test update",
      ),
    ).rejects.toThrow(BadDataException);
    expect(api.requests).toHaveLength(0);
  });
});
