import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityEventConnectionService, {
  parseSecurityEventConfiguration,
  parseSecurityEventCredentialJson,
  SecurityEventPollingCheckpointUpdate,
  validateSecurityEventConnection,
} from "../../../Server/Services/SecurityEventConnectionService";
import Encryption from "../../../Server/Utils/Encryption";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityEventConnectorType from "../../../Types/SecurityEvent/SecurityEventConnectorType";
import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface ConnectionHooks {
  onBeforeCreate: (data: unknown) => Promise<unknown>;
  onBeforeUpdate: (data: unknown) => Promise<unknown>;
  onBeforeUpdateItems: (
    data: unknown,
    items: Array<SecurityEventConnection>,
  ) => Promise<void>;
  onCreateSuccess: (
    data: unknown,
    item: SecurityEventConnection,
  ) => Promise<SecurityEventConnection>;
  getInternalUpdateData: (
    data: unknown,
    item: SecurityEventConnection,
  ) => Promise<Record<string, unknown>>;
  getAdditionalUpdateSelect: (data: unknown) => Record<string, unknown>;
  findBy: (data: unknown) => Promise<Array<SecurityEventConnection>>;
}

const hooks: ConnectionHooks =
  SecurityEventConnectionService as unknown as ConnectionHooks;

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

const READ_PERMISSIONS: Array<Permission> = [
  ...ADMIN_PERMISSIONS,
  Permission.SecurityMember,
  Permission.SecurityViewer,
];

function credentials(value: Record<string, string>): string {
  return JSON.stringify(value);
}

function awsConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = "22222222-2222-4222-8222-222222222222";
  connection.provider = SecurityEventConnectorType.AwsSecurityHub;
  connection.configuration = { region: "us-east-1" };
  connection.credentialJson = credentials({
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
  });
  connection.pollIntervalInMinutes = 5;
  return connection;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventConnection provider validation", () => {
  test.each([
    [
      "AWS Security Hub",
      SecurityEventConnectorType.AwsSecurityHub,
      { region: "us-gov-west-1" },
      { accessKeyId: "access-key", secretAccessKey: "secret-key" },
    ],
    [
      "Microsoft Defender",
      SecurityEventConnectorType.MicrosoftDefender,
      { tenantId: "a03f104f-91f1-4e90-9ba3-3b2d3f7b1aa7" },
      { clientId: "client-id", clientSecret: "client-secret" },
    ],
    [
      "Cloudflare",
      SecurityEventConnectorType.Cloudflare,
      { zoneId: "zone-id" },
      { apiToken: "api-token" },
    ],
    [
      "CrowdStrike Falcon",
      SecurityEventConnectorType.CrowdStrikeFalcon,
      { cloud: "eu-1" },
      { clientId: "client-id", clientSecret: "client-secret" },
    ],
    [
      "Google Security Command Center",
      SecurityEventConnectorType.GoogleSecurityCommandCenter,
      { parent: "organizations/123456/sources/-" },
      {
        client_email: "service@example.iam.gserviceaccount.com",
        private_key: privateKey,
      },
    ],
    [
      "Okta",
      SecurityEventConnectorType.Okta,
      { baseUrl: "https://example.okta.com/api/v1" },
      { apiToken: "api-token" },
    ],
    [
      "Splunk Enterprise Security with token credentials",
      SecurityEventConnectorType.SplunkEnterpriseSecurity,
      { baseUrl: "https://splunk.example.com", search: "search index=main" },
      { apiToken: "api-token", tokenScheme: "Splunk" },
    ],
    [
      "Splunk Enterprise Security with username and password",
      SecurityEventConnectorType.SplunkEnterpriseSecurity,
      { baseUrl: "https://splunk.example.com" },
      { username: "reader", password: "password" },
    ],
  ])(
    "accepts complete %s configuration and credentials",
    (
      _name: string,
      provider: SecurityEventConnectorType,
      configuration: Record<string, string>,
      credentialValues: Record<string, string>,
    ) => {
      expect(() => {
        validateSecurityEventConnection({
          provider,
          configuration,
          credentialJson: credentials(credentialValues),
          pollIntervalInMinutes: 5,
        });
      }).not.toThrow();
    },
  );

  test("accepts CrowdStrike's default cloud and Google's default token URI", () => {
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.CrowdStrikeFalcon,
        configuration: {},
        credentialJson: credentials({
          clientId: "client-id",
          clientSecret: "secret",
        }),
      });
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.GoogleSecurityCommandCenter,
        configuration: { parent: "projects/project-id/sources/source-id" },
        credentialJson: credentials({
          client_email: "service@example.iam.gserviceaccount.com",
          private_key: privateKey,
        }),
      });
    }).not.toThrow();
  });

  test.each([
    [
      SecurityEventConnectorType.AwsSecurityHub,
      { region: "invalid-region" },
      { accessKeyId: "id", secretAccessKey: "secret" },
      "AWS region",
    ],
    [
      SecurityEventConnectorType.MicrosoftDefender,
      { tenantId: "tenant/id" },
      { clientId: "id", clientSecret: "secret" },
      "tenantId",
    ],
    [
      SecurityEventConnectorType.Cloudflare,
      { accountId: "account" },
      { apiToken: "token" },
      "zoneId",
    ],
    [
      SecurityEventConnectorType.CrowdStrikeFalcon,
      { cloud: "moon-1" },
      { clientId: "id", clientSecret: "secret" },
      "cloud",
    ],
    [
      SecurityEventConnectorType.GoogleSecurityCommandCenter,
      { parent: "organizations/id" },
      { client_email: "service@example.com", private_key: privateKey },
      "parent",
    ],
    [
      SecurityEventConnectorType.Okta,
      { baseUrl: "http://example.okta.com" },
      { apiToken: "token" },
      "HTTPS",
    ],
    [
      SecurityEventConnectorType.SplunkEnterpriseSecurity,
      { baseUrl: "https://splunk.example.com" },
      { username: "reader" },
      "apiToken or username and password",
    ],
  ])(
    "rejects invalid %s connection settings",
    (
      provider: SecurityEventConnectorType,
      configuration: Record<string, string>,
      credentialValues: Record<string, string>,
      error: string,
    ) => {
      expect(() => {
        validateSecurityEventConnection({
          provider,
          configuration,
          credentialJson: credentials(credentialValues),
        });
      }).toThrow(error);
    },
  );

  test.each([
    "http://example.okta.com",
    "https://token@example.okta.com",
    "https://example.okta.com?destination=https://169.254.169.254",
    "https://example.okta.com#https://169.254.169.254",
  ])("rejects SSRF-relevant Okta URL %s", (baseUrl: string) => {
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.Okta,
        configuration: { baseUrl },
        credentialJson: credentials({ apiToken: "api-token" }),
      });
    }).toThrow("HTTPS");
  });

  test.each([
    "http://splunk.example.com",
    "https://token@splunk.example.com",
    "https://splunk.example.com?redirect=https://127.0.0.1",
    "https://splunk.example.com#https://127.0.0.1",
  ])("rejects SSRF-relevant Splunk URL %s", (baseUrl: string) => {
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.SplunkEnterpriseSecurity,
        configuration: { baseUrl },
        credentialJson: credentials({ apiToken: "api-token" }),
      });
    }).toThrow("HTTPS");
  });

  test("rejects an unsupported Splunk token authorization scheme", () => {
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.SplunkEnterpriseSecurity,
        configuration: { baseUrl: "https://splunk.example.com" },
        credentialJson: credentials({
          apiToken: "api-token",
          tokenScheme: "Basic",
        }),
      });
    }).toThrow("Bearer or Splunk");
  });

  test.each([
    "https://oauth2.googleapis.com/other",
    "https://oauth2.googleapis.com:8443/token",
    "https://oauth2.googleapis.com@169.254.169.254/token",
    "https://metadata.google.internal/token",
  ])(
    "rejects Google token URI outside the exact OAuth endpoint: %s",
    (tokenUri: string) => {
      expect(() => {
        validateSecurityEventConnection({
          provider: SecurityEventConnectorType.GoogleSecurityCommandCenter,
          configuration: { parent: "folders/123/sources/-" },
          credentialJson: credentials({
            client_email: "service@example.iam.gserviceaccount.com",
            private_key: privateKey,
            token_uri: tokenUri,
          }),
        });
      }).toThrow();
    },
  );

  test("rejects malformed Google private keys before a connection is stored", () => {
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.GoogleSecurityCommandCenter,
        configuration: { parent: "organizations/123/sources/-" },
        credentialJson: credentials({
          client_email: "service@example.iam.gserviceaccount.com",
          private_key: "definitely not a PEM key",
        }),
      });
    }).toThrow("private_key");
  });
});

describe("SecurityEventConnection common validation", () => {
  test.each([1, 5, 1440])(
    "accepts poll interval %i minutes",
    (pollIntervalInMinutes: number) => {
      expect(() => {
        validateSecurityEventConnection({ pollIntervalInMinutes });
      }).not.toThrow();
    },
  );

  test.each([0, -1, 1.5, 1441, Number.NaN])(
    "rejects invalid poll interval %p",
    (pollIntervalInMinutes: number) => {
      expect(() => {
        validateSecurityEventConnection({ pollIntervalInMinutes });
      }).toThrow("whole number of minutes between 1 and 1440");
    },
  );

  test.each(["", "not json", "[]", "null"])(
    "rejects credential JSON %p",
    (credentialJson: string) => {
      expect(() => {
        return parseSecurityEventCredentialJson(credentialJson);
      }).toThrow();
    },
  );

  test("parses object-shaped configuration JSON from form submissions", () => {
    expect(parseSecurityEventConfiguration('{"region":"us-east-1"}')).toEqual({
      region: "us-east-1",
    });
    expect(() => {
      return parseSecurityEventConfiguration("[]");
    }).toThrow("Configuration must be a JSON object");
    expect(() => {
      return parseSecurityEventConfiguration("not json");
    }).toThrow("Configuration is not valid JSON");
  });

  test("normalizes configuration JSON before creating a connection", async () => {
    const connection: SecurityEventConnection = awsConnection();
    connection.configuration = JSON.stringify({
      region: "us-west-2",
    }) as unknown as JSONObject;

    const beforeCreate: unknown = await hooks.onBeforeCreate({
      data: connection,
    });

    expect(beforeCreate).toMatchObject({
      createBy: {
        data: {
          configuration: { region: "us-west-2" },
          sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
  });

  test("rejects unsupported providers and missing credentials", () => {
    expect(() => {
      validateSecurityEventConnection({
        provider: "unknown" as SecurityEventConnectorType,
        configuration: {},
        credentialJson: "{}",
      });
    }).toThrow("supported security event provider");
    expect(() => {
      validateSecurityEventConnection({
        provider: SecurityEventConnectorType.Cloudflare,
        configuration: { accountId: "account", zoneId: "zone" },
      });
    }).toThrow("Credentials JSON is required");
  });
});

describe("SecurityEventConnection update validation", () => {
  test("writes a polling checkpoint with the row version in the same SQL statement", async () => {
    const builder: Record<string, ReturnType<typeof jest.fn>> = {};
    for (const method of ["update", "set", "where", "andWhere"]) {
      builder[method] = jest.fn(() => {
        return builder;
      });
    }
    builder["execute"] = jest.fn(async () => {
      return { affected: 1 };
    });
    jest
      .spyOn(SecurityEventConnectionService, "getRepository")
      .mockReturnValue({
        createQueryBuilder: jest.fn(() => {
          return builder;
        }),
      } as never);
    const id: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
    const checkpoint: SecurityEventPollingCheckpointUpdate = {
      lastPolledAt: new Date("2026-09-11T12:00:00.000Z"),
      lastPollResult: { complete: true },
      lastError: null,
      cursor: "2026-09-11T12:00:00.000Z",
    };

    await expect(
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id,
        expectedVersion: 7,
        checkpoint,
      }),
    ).resolves.toBe(1);

    const storedCheckpoint: typeof checkpoint = builder["set"]!.mock
      .calls[0]![0] as typeof checkpoint;
    expect(storedCheckpoint).toMatchObject({
      lastPolledAt: checkpoint.lastPolledAt,
      lastPollResult: checkpoint.lastPollResult,
      lastError: null,
    });
    const storedCursor: string | null | undefined = storedCheckpoint.cursor;
    if (typeof storedCursor !== "string") {
      throw new Error("The encrypted checkpoint cursor was not stored.");
    }
    expect(storedCursor).not.toBe(checkpoint.cursor);
    expect(await Encryption.decrypt(storedCursor)).toBe(checkpoint.cursor);
    expect(checkpoint.cursor).toBe("2026-09-11T12:00:00.000Z");
    expect(builder["where"]).toHaveBeenCalledWith('"_id" = :id', {
      id: id.toString(),
    });
    expect(builder["andWhere"]).toHaveBeenCalledWith(
      '"version" = :expectedVersion',
      { expectedVersion: 7 },
    );
    expect(builder["andWhere"]).toHaveBeenCalledWith('"deletedAt" IS NULL');
  });

  test("reports a lost checkpoint race when the row version changed", async () => {
    const builder: Record<string, ReturnType<typeof jest.fn>> = {};
    for (const method of ["update", "set", "where", "andWhere"]) {
      builder[method] = jest.fn(() => {
        return builder;
      });
    }
    builder["execute"] = jest.fn(async () => {
      return { affected: 0 };
    });
    jest
      .spyOn(SecurityEventConnectionService, "getRepository")
      .mockReturnValue({
        createQueryBuilder: jest.fn(() => {
          return builder;
        }),
      } as never);

    await expect(
      SecurityEventConnectionService.updatePollingCheckpointIfUnchanged({
        id: ObjectID.generate(),
        expectedVersion: 7,
        checkpoint: {
          lastPolledAt: new Date(),
          lastPollResult: { complete: true },
          lastError: null,
          cursor: null,
        },
      }),
    ).resolves.toBe(0);
  });

  test("defers provider validation until after permission-scoped rows are loaded", async () => {
    const connection: SecurityEventConnection = awsConnection();
    const findBy: jest.Mock = jest.spyOn(
      hooks,
      "findBy",
    ) as unknown as jest.Mock;

    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: { configuration: { region: "us-west-2" } },
      query: { _id: "connection-id" },
      skip: 0,
      limit: 1,
    });

    expect(onUpdate).toMatchObject({
      carryForward: {
        configurationSupplied: true,
        credentialsSupplied: false,
        configuration: { region: "us-west-2" },
      },
    });
    expect(findBy).not.toHaveBeenCalled();
    expect(hooks.getAdditionalUpdateSelect(onUpdate)).toEqual({
      provider: true,
      configuration: true,
      credentialJson: true,
      pollIntervalInMinutes: true,
    });
    await expect(
      hooks.onBeforeUpdateItems(onUpdate, [connection]),
    ).resolves.toBeUndefined();
  });

  test("does not reveal provider-specific validation for rows denied by the scoped query", async () => {
    const findBy: jest.Mock = jest.spyOn(
      hooks,
      "findBy",
    ) as unknown as jest.Mock;
    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: { credentialJson: "{}" },
      query: { _id: "cross-tenant-connection-id" },
      skip: 0,
      limit: 1,
    });

    expect(findBy).not.toHaveBeenCalled();
    await expect(
      hooks.onBeforeUpdateItems(onUpdate, []),
    ).resolves.toBeUndefined();

    await expect(
      hooks.onBeforeUpdateItems(onUpdate, [awsConnection()]),
    ).rejects.toThrow("AWS requires accessKeyId");
  });

  test("validates every authorized row before writes begin", async () => {
    const invalid: SecurityEventConnection = awsConnection();
    invalid.configuration = { region: "invalid-region" };
    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: {
        credentialJson: credentials({
          accessKeyId: "rotated-access-key",
          secretAccessKey: "rotated-secret-key",
        }),
      },
      query: {},
      skip: 0,
      limit: 2,
    });

    await expect(
      hooks.onBeforeUpdateItems(onUpdate, [awsConnection(), invalid]),
    ).rejects.toThrow("AWS region is not valid");
  });

  test("normalizes source settings before carrying them to scoped validation", async () => {
    await expect(
      hooks.onBeforeUpdate({
        data: { configuration: '{"region":"us-west-2"}' },
        query: { _id: "connection-id" },
        skip: 0,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      carryForward: {
        configurationSupplied: true,
        credentialsSupplied: false,
        configuration: { region: "us-west-2" },
      },
    });
  });

  test("rejects provider changes so source fingerprint updates cannot race", async () => {
    await expect(
      hooks.onBeforeUpdate({
        data: { provider: SecurityEventConnectorType.Cloudflare },
        query: { _id: "connection-id" },
        skip: 0,
        limit: 1,
      }),
    ).rejects.toThrow("provider cannot be changed");
  });

  test("validates the poll interval when updating connection settings", async () => {
    await expect(
      hooks.onBeforeUpdate({
        data: { isEnabled: false, pollIntervalInMinutes: 0 },
        query: { _id: "connection-id" },
        skip: 0,
        limit: 1,
      }),
    ).rejects.toThrow("whole number of minutes between 1 and 1440");
  });

  test("resets polling state without changing identity after credential rotation", async () => {
    const connection: SecurityEventConnection = awsConnection();
    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: {
        credentialJson: credentials({
          accessKeyId: "rotated-access-key",
          secretAccessKey: "rotated-secret-key",
        }),
      },
      query: { _id: connection._id },
      skip: 0,
      limit: 1,
    });

    await hooks.onBeforeUpdateItems(onUpdate, [connection]);

    expect(await hooks.getInternalUpdateData(onUpdate, connection)).toEqual({
      cursor: null,
      lastPolledAt: null,
      lastSuccessfulPollAt: null,
      lastEventIngestedAt: null,
      lastPollResult: null,
      lastError: null,
    });
  });

  test("increments source identity and resets polling state after repointing", async () => {
    const connection: SecurityEventConnection = awsConnection();
    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: { configuration: { region: "eu-west-2" } },
      query: { _id: connection._id },
      skip: 0,
      limit: 1,
    });

    await hooks.onBeforeUpdateItems(onUpdate, [connection]);

    const internalData: Record<string, unknown> =
      await hooks.getInternalUpdateData(onUpdate, connection);
    expect(internalData).toEqual({
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceGeneration: expect.any(Function),
      cursor: expect.any(Function),
      lastPolledAt: expect.any(Function),
      lastSuccessfulPollAt: expect.any(Function),
      lastEventIngestedAt: expect.any(Function),
      lastPollResult: expect.any(Function),
      lastError: expect.any(Function),
    });
    expect((internalData["sourceGeneration"] as () => string)()).toContain(
      '"sourceFingerprint" IS DISTINCT FROM',
    );
    expect((internalData["cursor"] as () => string)()).toContain(
      'THEN NULL ELSE "cursor" END',
    );
    expect(hooks.getAdditionalUpdateSelect(onUpdate)).toEqual({
      provider: true,
      configuration: true,
      credentialJson: true,
      pollIntervalInMinutes: true,
    });
  });

  test("keeps polling state when only the interval changes", async () => {
    const beforeUpdate: unknown = await hooks.onBeforeUpdate({
      data: { pollIntervalInMinutes: 10 },
      query: { _id: "connection-id" },
    });
    expect(
      await hooks.getInternalUpdateData(beforeUpdate, awsConnection()),
    ).toEqual({});
  });

  test("keeps polling identity when an edit resubmits unchanged configuration", async () => {
    const connection: SecurityEventConnection = awsConnection();
    const onUpdate: unknown = await hooks.onBeforeUpdate({
      data: {
        name: "Renamed connection",
        configuration: { region: "us-east-1" },
      },
      query: { _id: connection._id },
      skip: 0,
      limit: 1,
    });

    await hooks.onBeforeUpdateItems(onUpdate, [connection]);

    const internalData: Record<string, unknown> =
      await hooks.getInternalUpdateData(onUpdate, connection);
    expect(internalData["sourceFingerprint"]).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof internalData["sourceGeneration"]).toBe("function");
    expect(typeof internalData["cursor"]).toBe("function");
  });
});

describe("SecurityEventConnection credential and permissions contract", () => {
  const model: SecurityEventConnection = new SecurityEventConnection();
  const accessControl: Record<string, ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  test("encrypts credentials and makes them write-only through CRUD", () => {
    expect(model.getEncryptedColumns().columns).toEqual(
      expect.arrayContaining(["credentialJson", "cursor"]),
    );
    expect(model.getTableColumnMetadata("credentialJson").encrypted).toBe(true);
    expect(accessControl["credentialJson"]?.read).toEqual([]);
    expect(accessControl["credentialJson"]?.create).toEqual(ADMIN_PERMISSIONS);
    expect(accessControl["credentialJson"]?.update).toEqual(ADMIN_PERMISSIONS);
    expect(accessControl["cursor"]?.read).toEqual([]);
    expect(accessControl["sourceFingerprint"]?.read).toEqual([]);
    expect(accessControl["sourceFingerprint"]?.update).toEqual([]);
    expect(accessControl["sourceGeneration"]?.read).toEqual([]);
  });

  test("uses database defaults for internal generation and scheduling fields", () => {
    expect(model.isDefaultValueColumn("sourceGeneration")).toBe(true);
    expect(model.isDefaultValueColumn("isEnabled")).toBe(true);
    expect(model.isDefaultValueColumn("pollIntervalInMinutes")).toBe(true);
  });

  test("removes write-only state before a created connection is serialized", async () => {
    const created: SecurityEventConnection = awsConnection();
    created.sourceFingerprint = "source-fingerprint";
    created.sourceGeneration = 4;
    created.cursor = "encrypted-cursor";

    const returned: SecurityEventConnection = await hooks.onCreateSuccess(
      {},
      created,
    );
    const response: JSONObject = BaseModel.toJSONObject(
      returned,
      SecurityEventConnection,
    );

    expect(response).toEqual(
      expect.objectContaining({
        _id: created._id,
        provider: SecurityEventConnectorType.AwsSecurityHub,
      }),
    );
    expect(response).not.toHaveProperty("credentialJson");
    expect(response).not.toHaveProperty("cursor");
    expect(response).not.toHaveProperty("sourceFingerprint");
    expect(response).not.toHaveProperty("sourceGeneration");
  });

  test("limits connection changes to connector administrators while allowing security readers to view non-secret details", () => {
    expect(model.getCreatePermissions()).toEqual(ADMIN_PERMISSIONS);
    expect(model.getUpdatePermissions()).toEqual(ADMIN_PERMISSIONS);
    expect(model.getDeletePermissions()).toEqual(ADMIN_PERMISSIONS);
    expect(model.getReadPermissions()).toEqual(READ_PERMISSIONS);
    expect(accessControl["configuration"]?.read).toEqual(READ_PERMISSIONS);
    expect(accessControl["pollIntervalInMinutes"]?.read).toEqual(
      READ_PERMISSIONS,
    );
    expect(accessControl["lastError"]?.create).toEqual([]);
    expect(accessControl["lastError"]?.update).toEqual([]);
  });
});
