import CloudConnectionService, {
  Service as CloudConnectionServiceClass,
} from "../../../Server/Services/CloudConnectionService";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Server/Services/ServiceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { CloudConnectionSettings } from "../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";

/*
 * A cloud connection that saves is one the read loop can use: the
 * catalog's fields for the method it signs in with and the cloud's own
 * checks run on create and on every update that touches settings (with the
 * stored secrets merged under the new ones - an empty secret keeps the
 * stored one), keys of another method are dropped, the cloud never changes,
 * and what OneUptime reads off a credential (a service account's email and
 * project) is written by OneUptime alone. A settings change makes the next
 * read find the resources again, from where the metrics were read up to.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SERVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ROTATED: string = "rotatedSecretKey/abcdefghijklmnopqrstuv";
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const ROLE_ARN: string = "arn:aws:iam::210987654321:role/OneUptimeReadOnly-abc";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const GCP_KEY: string = JSON.stringify({
  type: "service_account",
  project_id: "acme-prod",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<CloudConnection>,
  ) => Promise<OnCreate<CloudConnection>>;
  onCreateSuccess: (
    onCreate: OnCreate<CloudConnection>,
    created: CloudConnection,
  ) => Promise<CloudConnection>;
  onBeforeUpdate: (
    updateBy: UpdateBy<CloudConnection>,
  ) => Promise<OnUpdate<CloudConnection>>;
  onUpdatePermitted: (updateBy: UpdateBy<CloudConnection>) => Promise<void>;
};

const service: Hooks = CloudConnectionService as unknown as Hooks;

function createBy(data: JSONObject): CreateBy<CloudConnection> {
  const connection: CloudConnection = new CloudConnection();
  connection.projectId = PROJECT;
  Object.assign(connection, data);
  return {
    data: connection,
    props: { isRoot: true, tenantId: PROJECT },
  } as CreateBy<CloudConnection>;
}

function updateBy(
  data: JSONObject,
  query: JSONObject = { _id: CONNECTION.toString() },
): UpdateBy<CloudConnection> {
  return {
    query,
    data,
    props: { isRoot: true, tenantId: PROJECT },
  } as unknown as UpdateBy<CloudConnection>;
}

function stored(overrides: Partial<CloudConnection> = {}): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection._id = CONNECTION.toString();
  connection.projectId = PROJECT;
  connection.provider = CloudProvider.AWS;
  connection.config = {
    authMethod: CloudConnectionAuthMethod.AwsAccessKey,
    accessKeyId: ACCESS_KEY_ID,
  };
  connection.secrets = JSON.stringify({ secretAccessKey: SECRET });
  Object.assign(connection, overrides);
  return connection;
}

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

describe("validateSettings", () => {
  test("an AWS access key: the method is named, the defaults filled in", () => {
    const settings: CloudConnectionSettings =
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.AWS,
        projectId: PROJECT,
        config: { accessKeyId: ACCESS_KEY_ID },
        secrets: { secretAccessKey: SECRET },
        requireRequiredSecrets: true,
      });

    expect(settings).toEqual({
      provider: CloudProvider.AWS,
      projectId: PROJECT.toString(),
      config: {
        accessKeyId: ACCESS_KEY_ID,
        readIntervalInMinutes: "10",
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      },
      secrets: { secretAccessKey: SECRET },
    });
  });

  test("an API client that sends a role ARN and no method gets the role", () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";

    expect(
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.AWS,
        projectId: PROJECT,
        config: { roleArn: ROLE_ARN },
        secrets: {},
        requireRequiredSecrets: true,
      }).config["authMethod"],
    ).toBe(CloudConnectionAuthMethod.AwsRole);
  });

  test("keys of the other method are dropped, not stored", () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";

    const settings: CloudConnectionSettings =
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.AWS,
        projectId: PROJECT,
        config: {
          authMethod: CloudConnectionAuthMethod.AwsRole,
          roleArn: ROLE_ARN,
          accessKeyId: ACCESS_KEY_ID,
        },
        secrets: { secretAccessKey: SECRET },
        requireRequiredSecrets: true,
      });

    expect(settings.config["accessKeyId"]).toBeUndefined();
    expect(settings.secrets).toEqual({});
  });

  test("what OneUptime writes itself is never taken from a caller", () => {
    const settings: CloudConnectionSettings =
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.Azure,
        projectId: PROJECT,
        config: {
          tenantId: TENANT,
          clientId: CLIENT,
          clientEmail: "someone@else.com",
          keyProjectId: "not-mine",
        },
        secrets: { clientSecret: "s3cret" },
        requireRequiredSecrets: true,
      });

    expect(settings.config["clientEmail"]).toBeUndefined();
    expect(settings.config["keyProjectId"]).toBeUndefined();
    expect(settings.config["cloud"]).toBe("public");
  });

  test("a Google Cloud key's service account and project are read off it", () => {
    const settings: CloudConnectionSettings =
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.GCP,
        projectId: PROJECT,
        config: {},
        secrets: { serviceAccountJson: GCP_KEY },
        requireRequiredSecrets: true,
      });

    expect(settings.config).toEqual({
      readIntervalInMinutes: "5",
      // Nothing chosen: the key's own project, not its organization.
      readScope: "account",
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      clientEmail: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
      keyProjectId: "acme-prod",
    });
  });

  test.each([
    [{ provider: "oracle", config: {}, secrets: {} }, "Cloud must be"],
    [
      {
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID },
        secrets: {},
      },
      "Secret access key is required",
    ],
    [
      {
        provider: CloudProvider.AWS,
        config: { authMethod: "magic", accessKeyId: ACCESS_KEY_ID },
        secrets: { secretAccessKey: SECRET },
      },
      "Sign-in method must be one of",
    ],
    [
      {
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID, profile: "x" },
        secrets: { secretAccessKey: SECRET },
      },
      'unknown setting "profile"',
    ],
    [
      {
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID, readIntervalInMinutes: "7" },
        secrets: { secretAccessKey: SECRET },
      },
      "Read metrics every must be one of",
    ],
    [
      {
        provider: CloudProvider.AWS,
        config: {
          authMethod: CloudConnectionAuthMethod.AwsRole,
          roleArn: ROLE_ARN,
        },
        secrets: {},
      },
      "no AWS identity",
    ],
    [
      {
        provider: CloudProvider.Azure,
        config: { tenantId: TENANT, clientId: "app" },
        secrets: { clientSecret: "x" },
      },
      "Application (client) ID",
    ],
    [
      {
        provider: CloudProvider.GCP,
        config: {},
        secrets: { serviceAccountJson: '{"type":"service_account"}' },
      },
      "client_email",
    ],
  ])("refused: %j", (data: JSONObject, words: string) => {
    expect(() => {
      CloudConnectionServiceClass.validateSettings({
        provider: data["provider"],
        projectId: PROJECT,
        config: data["config"] as JSONObject,
        secrets: data["secrets"] as JSONObject,
        requireRequiredSecrets: true,
      });
    }).toThrow(words);
  });

  test("a refusal never repeats the secret it was given", () => {
    let message: string = "";

    try {
      CloudConnectionServiceClass.validateSettings({
        provider: CloudProvider.AWS,
        projectId: PROJECT,
        config: { accessKeyId: "AKIA-THIS-IS-NOT-ONE" },
        secrets: { secretAccessKey: "THISISASECRETVALUE" },
        requireRequiredSecrets: true,
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Access key ID");
    expect(message).not.toContain("THISISASECRETVALUE");
  });
});

describe("onBeforeCreate", () => {
  test("a connection is named after its cloud, and its account when the settings say", async () => {
    const aws: OnCreate<CloudConnection> = await service.onBeforeCreate(
      createBy({
        provider: CloudProvider.AWS,
        config: { accessKeyId: ACCESS_KEY_ID },
        secrets: { secretAccessKey: SECRET },
      }),
    );

    expect(aws.createBy.data.name).toBe("Amazon Web Services");
    expect(JSON.parse(aws.createBy.data.secrets as string)).toEqual({
      secretAccessKey: SECRET,
    });

    const gcp: OnCreate<CloudConnection> = await service.onBeforeCreate(
      createBy({
        provider: CloudProvider.GCP,
        config: {},
        secrets: JSON.stringify({ serviceAccountJson: GCP_KEY }),
      }),
    );

    expect(gcp.createBy.data.name).toBe("Google Cloud acme-prod");

    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";

    const role: OnCreate<CloudConnection> = await service.onBeforeCreate(
      createBy({
        provider: CloudProvider.AWS,
        config: { roleArn: ROLE_ARN },
        secrets: {},
      }),
    );

    expect(role.createBy.data.name).toBe("AWS 210987654321");
  });

  test("a name given is kept", async () => {
    const result: OnCreate<CloudConnection> = await service.onBeforeCreate(
      createBy({
        provider: CloudProvider.Azure,
        name: "Production tenant",
        config: { tenantId: TENANT, clientId: CLIENT },
        secrets: { clientSecret: "s3cret" },
      }),
    );

    expect(result.createBy.data.name).toBe("Production tenant");
  });

  test("Enabled must be true or false", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          provider: CloudProvider.Azure,
          config: { tenantId: TENANT, clientId: CLIENT },
          secrets: { clientSecret: "s3cret" },
          isEnabled: "yes",
        }),
      ),
    ).rejects.toThrow("Enabled must be true or false.");
  });

  test("its telemetry service is made once it exists, named after it", async () => {
    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpiedFunction<typeof ServiceService.create> = jest
      .spyOn(ServiceService, "create")
      .mockImplementation(async (data: { data: TelemetryService }) => {
        const made: TelemetryService = data.data;
        made.id = SERVICE;
        return made;
      });
    const update: jest.SpiedFunction<
      typeof CloudConnectionService.updateOneById
    > = jest
      .spyOn(CloudConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const created: CloudConnection = stored({ name: "Prod AWS" });
    await service.onCreateSuccess(
      {
        createBy: createBy({}),
        carryForward: null,
      } as OnCreate<CloudConnection>,
      created,
    );

    expect(create.mock.calls[0]![0].data.name).toBe("Prod AWS");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONNECTION,
        data: { serviceId: SERVICE },
        props: { isRoot: true, ignoreHooks: true },
      }),
    );
  });

  test("a telemetry service that cannot be made yet does not fail the create", async () => {
    jest
      .spyOn(ServiceService, "findOneBy")
      .mockRejectedValue(new Error("down"));

    await expect(
      service.onCreateSuccess(
        {
          createBy: createBy({}),
          carryForward: null,
        } as OnCreate<CloudConnection>,
        stored(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("onBeforeUpdate", () => {
  let findOneById: jest.SpiedFunction<
    typeof CloudConnectionService.findOneById
  >;

  beforeEach(() => {
    findOneById = jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockResolvedValue(stored());
  });

  test("the cloud never changes", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ provider: CloudProvider.GCP })),
    ).rejects.toThrow("The cloud of a connection cannot be changed.");
  });

  test("an update that touches no setting passes through without a read", async () => {
    const result: OnUpdate<CloudConnection> = await service.onBeforeUpdate(
      updateBy({ name: "Renamed", isEnabled: false }),
    );

    expect(result.updateBy.data).toEqual({ name: "Renamed", isEnabled: false });
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("an empty secret keeps the stored one; a new one replaces it", async () => {
    const kept: OnUpdate<CloudConnection> = await service.onBeforeUpdate(
      updateBy({ secrets: { secretAccessKey: "" } }),
    );
    expect(
      JSON.parse((kept.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({ secretAccessKey: SECRET });

    const rotated: OnUpdate<CloudConnection> = await service.onBeforeUpdate(
      updateBy({ secrets: { secretAccessKey: ROTATED } }),
    );
    expect(
      JSON.parse((rotated.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({ secretAccessKey: ROTATED });
  });

  test("new settings are checked with the stored secrets", async () => {
    const result: OnUpdate<CloudConnection> = await service.onBeforeUpdate(
      updateBy({
        config: { accessKeyId: ACCESS_KEY_ID, regions: "eu-west-1" },
      }),
    );

    expect((result.updateBy.data as JSONObject)["config"]).toEqual(
      expect.objectContaining({ regions: "eu-west-1" }),
    );

    await expect(
      service.onBeforeUpdate(
        updateBy({ config: { accessKeyId: ACCESS_KEY_ID, regions: "moon-1" } }),
      ),
    ).rejects.toThrow("is not an AWS Region");
  });

  test("removing a required secret is refused", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ secrets: { secretAccessKey: null } })),
    ).rejects.toThrow("Secret access key is required");
  });

  test("switching an AWS connection to a role drops the stored key", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] = "server-secret";

    const result: OnUpdate<CloudConnection> = await service.onBeforeUpdate(
      updateBy({
        config: {
          authMethod: CloudConnectionAuthMethod.AwsRole,
          roleArn: ROLE_ARN,
        },
      }),
    );

    expect(
      JSON.parse((result.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({});
  });

  test("settings are changed one connection at a time", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({ config: {} }, { projectId: PROJECT.toString() }),
      ),
    ).rejects.toThrow("one connection at a time");
  });

  test("a connection that is gone cannot be updated", async () => {
    findOneById.mockResolvedValue(null);

    await expect(
      service.onBeforeUpdate(updateBy({ config: {} })),
    ).rejects.toThrow(BadDataException);
  });
});

describe("onUpdatePermitted", () => {
  test("a settings change reads it again at once and finds its resources again, keeping where metrics were read to", async () => {
    jest.spyOn(CloudConnectionService, "findOneById").mockResolvedValue(
      stored({
        pullState: {
          cursors: { "300": "2026-10-21T11:55:00.000Z" },
          inventoryAt: "2026-10-21T11:00:00.000Z",
          fullSweepAt: "2026-10-21T00:00:00.000Z",
          activePairs: ["us-east-1|AWS/EC2"],
          accounts: ["123456789012"],
          azureMetricDefinitions: {},
        },
      }),
    );
    const update: UpdateBy<CloudConnection> = updateBy({
      config: { accessKeyId: ACCESS_KEY_ID },
    });

    await service.onUpdatePermitted(update);

    expect(update.data as unknown as JSONObject).toEqual(
      expect.objectContaining({
        nextPullAt: null,
        lastError: null,
        pullState: { cursors: { "300": "2026-10-21T11:55:00.000Z" } },
      }),
    );
  });

  test("turning it on reads it at once; other edits leave the schedule alone", async () => {
    const turnedOn: UpdateBy<CloudConnection> = updateBy({ isEnabled: true });
    await service.onUpdatePermitted(turnedOn);
    expect((turnedOn.data as unknown as JSONObject)["nextPullAt"]).toBeNull();

    const renamed: UpdateBy<CloudConnection> = updateBy({ name: "x" });
    await service.onUpdatePermitted(renamed);
    expect(renamed.data as unknown as JSONObject).toEqual({ name: "x" });
  });
});

describe("getConnectorSettings", () => {
  test("decrypted settings, with defaults and the method", async () => {
    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockResolvedValue(stored({ config: { accessKeyId: ACCESS_KEY_ID } }));

    const connection: CloudConnection = new CloudConnection();
    connection.id = CONNECTION;

    expect(
      await CloudConnectionService.getConnectorSettings(connection),
    ).toEqual({
      provider: CloudProvider.AWS,
      projectId: PROJECT.toString(),
      config: {
        accessKeyId: ACCESS_KEY_ID,
        readIntervalInMinutes: "10",
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      },
      secrets: { secretAccessKey: SECRET },
    });
  });
});

describe("the model", () => {
  const model: CloudConnection = new CloudConnection();
  const access: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  test("credentials are written by owners and admins, and read by nobody", () => {
    expect(access["secrets"]?.read).toEqual([]);
    expect(access["secrets"]?.create).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(access["pullState"]?.read).toEqual([]);
  });

  test("only owners and admins add, change or remove a connection; cloud readers see it", () => {
    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(model.getUpdatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(model.getDeletePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]);
    expect(model.getReadPermissions()).toEqual(
      expect.arrayContaining([Permission.ReadCloudResource, Permission.Viewer]),
    );
  });

  test("what OneUptime keeps about a read is written by no caller", () => {
    for (const column of [
      "serviceId",
      "nextPullAt",
      "lastPulledAt",
      "lastSuccessfulPullAt",
      "lastPullResult",
      "lastError",
      "pullState",
    ]) {
      expect({
        column,
        create: access[column]?.create,
        update: access[column]?.update,
      }).toEqual({
        column,
        create: [],
        update: [],
      });
    }
  });

  test("the cloud is fixed once created", () => {
    expect(access["provider"]?.update).toEqual([]);
    expect(getCloudConnectionDefinition(CloudProvider.AWS)).toBeDefined();
  });
});
