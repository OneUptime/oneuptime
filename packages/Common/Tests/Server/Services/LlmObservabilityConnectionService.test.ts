import LlmObservabilityConnectionService, {
  Service as LlmObservabilityConnectionServiceClass,
} from "../../../Server/Services/LlmObservabilityConnectionService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LlmObservabilityConnection from "../../../Models/DatabaseModels/LlmObservabilityConnection";
import TelemetryService from "../../../Models/DatabaseModels/Service";
import ServiceService from "../../../Server/Services/ServiceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { LlmConnectionSettings } from "../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmConversationPrivacy from "../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmConnectionDefinition,
  getLlmConnectionDefinition,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "../../../Types/ObjectID";

/*
 * A connection that saves is one the read loop can use: the catalog's
 * fields and the connector's own checks run on create, on every update that
 * touches settings (with the stored secrets merged under the new ones - an
 * empty secret keeps the stored one), and the provider never changes.
 * Values OneUptime keeps (the next read, the last error, the service) are
 * written after the caller's write is permitted, never before.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SERVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OPENAI_KEY: string = "sk-admin-abcdefghijklmnop";
const ROTATED_KEY: string = "sk-admin-rotated-0987654321";
const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUBSCRIPTION: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<LlmObservabilityConnection>,
  ) => Promise<OnCreate<LlmObservabilityConnection>>;
  onCreateSuccess: (
    onCreate: OnCreate<LlmObservabilityConnection>,
    created: LlmObservabilityConnection,
  ) => Promise<LlmObservabilityConnection>;
  onBeforeUpdate: (
    updateBy: UpdateBy<LlmObservabilityConnection>,
  ) => Promise<OnUpdate<LlmObservabilityConnection>>;
  onUpdatePermitted: (
    updateBy: UpdateBy<LlmObservabilityConnection>,
  ) => Promise<void>;
};

const service: Hooks = LlmObservabilityConnectionService as unknown as Hooks;

function createBy(data: JSONObject): CreateBy<LlmObservabilityConnection> {
  const connection: LlmObservabilityConnection =
    new LlmObservabilityConnection();
  Object.assign(connection, data);
  return {
    data: connection,
    props: { isRoot: true },
  } as CreateBy<LlmObservabilityConnection>;
}

function updateBy(
  data: JSONObject,
  query: JSONObject = { _id: CONNECTION.toString() },
): UpdateBy<LlmObservabilityConnection> {
  return {
    query,
    data,
    props: { isRoot: true, tenantId: PROJECT },
  } as unknown as UpdateBy<LlmObservabilityConnection>;
}

function stored(
  overrides: Partial<LlmObservabilityConnection> = {},
): LlmObservabilityConnection {
  const connection: LlmObservabilityConnection =
    new LlmObservabilityConnection();
  connection._id = CONNECTION.toString();
  connection.provider = LlmConnectionProvider.OpenAI;
  connection.config = {};
  connection.secrets = JSON.stringify({ adminKey: OPENAI_KEY });
  Object.assign(connection, overrides);
  return connection;
}

const azureConfig: JSONObject = {
  tenantId: TENANT,
  clientId: CLIENT,
  subscriptionId: SUBSCRIPTION,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmObservabilityConnectionService.onBeforeCreate", () => {
  test("a valid connection is named after its provider and keeps its secrets as text", async () => {
    const result: OnCreate<LlmObservabilityConnection> =
      await service.onBeforeCreate(
        createBy({
          provider: LlmConnectionProvider.OpenAI,
          config: {},
          secrets: { adminKey: OPENAI_KEY },
        }),
      );

    expect(result.createBy.data.name).toBe("OpenAI");
    expect(result.createBy.data.config).toEqual({});
    expect(JSON.parse(result.createBy.data.secrets as string)).toEqual({
      adminKey: OPENAI_KEY,
    });
  });

  test("a setting folded under More options gets its default", async () => {
    const result: OnCreate<LlmObservabilityConnection> =
      await service.onBeforeCreate(
        createBy({
          provider: LlmConnectionProvider.AzureOpenAI,
          name: "Foundry prod",
          config: azureConfig,
          secrets: { clientSecret: "s3cret~value" },
        }),
      );

    expect(result.createBy.data.name).toBe("Foundry prod");
    expect(result.createBy.data.config).toEqual({
      ...azureConfig,
      cloud: "public",
    });

    const bedrock: OnCreate<LlmObservabilityConnection> =
      await service.onBeforeCreate(
        createBy({
          provider: LlmConnectionProvider.AwsBedrock,
          config: JSON.stringify({ accessKeyId: "AKIAIOSFODNN7EXAMPLE" }),
          secrets: JSON.stringify({
            secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          }),
        }),
      );
    expect(bedrock.createBy.data.config).toEqual({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      regions: "us-east-1",
    });
  });

  test.each([
    [
      { provider: "openrouter", config: {}, secrets: {} },
      "Provider must be one of",
    ],
    [
      { provider: LlmConnectionProvider.OpenAI, config: {}, secrets: {} },
      "Admin key is required for OpenAI.",
    ],
    [
      {
        provider: LlmConnectionProvider.OpenAI,
        config: {},
        secrets: { adminKey: "sk-proj-abc123abc123" },
      },
      "project API key",
    ],
    [
      {
        provider: LlmConnectionProvider.OpenAI,
        config: { orgId: "x" },
        secrets: { adminKey: OPENAI_KEY },
      },
      'unknown setting "orgId"',
    ],
    [
      {
        provider: LlmConnectionProvider.AzureOpenAI,
        config: { ...azureConfig, subscriptionId: "my-subscription" },
        secrets: { clientSecret: "x" },
      },
      "Subscription ID",
    ],
    [
      {
        provider: LlmConnectionProvider.AzureOpenAI,
        config: { ...azureConfig, cloud: "china" },
        secrets: { clientSecret: "x" },
      },
      "Cloud must be one of",
    ],
    [
      {
        provider: LlmConnectionProvider.ClaudeEnterprise,
        config: {},
        secrets: { complianceAccessKey: "sk-ant-admin01-xyz" },
      },
      "admin key",
    ],
    [
      {
        provider: LlmConnectionProvider.OpenAI,
        config: {},
        secrets: { adminKey: OPENAI_KEY },
        isEnabled: "yes",
      },
      "Enabled must be true or false.",
    ],
    [
      {
        provider: LlmConnectionProvider.ClaudeEnterprise,
        config: {},
        secrets: { complianceAccessKey: "sk-ant-api01-abc" },
        conversationReaders: "members",
      },
      "Who can read conversations",
    ],
    [
      {
        provider: LlmConnectionProvider.ClaudeEnterprise,
        config: {},
        secrets: { complianceAccessKey: "sk-ant-api01-abc" },
        storeConversationText: "no",
      },
      "Keep what was written must be true or false.",
    ],
    [
      {
        provider: LlmConnectionProvider.OpenAI,
        config: "not json",
        secrets: {},
      },
      "Settings",
    ],
  ])("refused: %j", async (data: JSONObject, words: string) => {
    await expect(service.onBeforeCreate(createBy(data))).rejects.toThrow(words);
  });

  test("a refusal never repeats the secret it was given", async () => {
    const error: unknown = await service
      .onBeforeCreate(
        createBy({
          provider: LlmConnectionProvider.OpenAI,
          config: {},
          secrets: { adminKey: "sk-proj-THISISASECRETVALUE" },
        }),
      )
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).not.toContain("THISISASECRETVALUE");
  });
});

describe("LlmObservabilityConnectionService.onBeforeUpdate", () => {
  let findOneById: jest.SpiedFunction<
    typeof LlmObservabilityConnectionService.findOneById
  >;

  beforeEach(() => {
    findOneById = jest
      .spyOn(LlmObservabilityConnectionService, "findOneById")
      .mockResolvedValue(stored());
  });

  test("the provider never changes", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({ provider: LlmConnectionProvider.Anthropic }),
      ),
    ).rejects.toThrow("The provider of a connection cannot be changed.");
  });

  test("an update that touches no setting passes through without a read", async () => {
    const result: OnUpdate<LlmObservabilityConnection> =
      await service.onBeforeUpdate(
        updateBy({
          name: "Renamed",
          conversationReaders: "everyone",
          isEnabled: false,
        }),
      );

    expect(result.updateBy.data).toEqual({
      name: "Renamed",
      conversationReaders: "everyone",
      isEnabled: false,
    });
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("an empty secret keeps the stored one; a new one replaces it", async () => {
    const kept: OnUpdate<LlmObservabilityConnection> =
      await service.onBeforeUpdate(updateBy({ secrets: { adminKey: "" } }));
    expect(
      JSON.parse((kept.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({
      adminKey: OPENAI_KEY,
    });

    const rotated: OnUpdate<LlmObservabilityConnection> =
      await service.onBeforeUpdate(
        updateBy({ secrets: { adminKey: ROTATED_KEY } }),
      );
    expect(
      JSON.parse((rotated.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({
      adminKey: ROTATED_KEY,
    });
  });

  test("removing a required secret, or replacing it with a wrong one, is refused", async () => {
    await expect(
      service.onBeforeUpdate(updateBy({ secrets: { adminKey: null } })),
    ).rejects.toThrow("Admin key is required for OpenAI.");
    await expect(
      service.onBeforeUpdate(
        updateBy({ secrets: { adminKey: "sk-svcacct-abc123abc123" } }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("new settings are checked with the stored secrets", async () => {
    findOneById.mockResolvedValue(
      stored({
        provider: LlmConnectionProvider.AzureOpenAI,
        config: { ...azureConfig, cloud: "public" },
        secrets: JSON.stringify({ clientSecret: "stored~secret" }),
      }),
    );

    const result: OnUpdate<LlmObservabilityConnection> =
      await service.onBeforeUpdate(
        updateBy({ config: { ...azureConfig, cloud: "usgov" } }),
      );
    expect((result.updateBy.data as JSONObject)["config"]).toEqual({
      ...azureConfig,
      cloud: "usgov",
    });
    expect(
      JSON.parse((result.updateBy.data as JSONObject)["secrets"] as string),
    ).toEqual({
      clientSecret: "stored~secret",
    });

    await expect(
      service.onBeforeUpdate(
        updateBy({ config: { ...azureConfig, tenantId: "not a tenant" } }),
      ),
    ).rejects.toThrow("Directory (tenant) ID");
  });

  test("settings are changed one connection at a time", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy(
          { secrets: { adminKey: ROTATED_KEY } },
          { projectId: PROJECT.toString() },
        ),
      ),
    ).rejects.toThrow("one connection at a time");
  });

  test("a connection that is gone cannot be changed", async () => {
    findOneById.mockResolvedValue(null);

    await expect(
      service.onBeforeUpdate(updateBy({ config: {} })),
    ).rejects.toThrow("The connection no longer exists.");
  });
});

describe("LlmObservabilityConnectionService.onUpdatePermitted", () => {
  test.each([
    [{ config: {} }],
    [{ secrets: { adminKey: ROTATED_KEY } }],
    [{ isEnabled: true }],
  ])(
    "%j is read again at once, and the old error no longer applies",
    async (data: JSONObject) => {
      const update: UpdateBy<LlmObservabilityConnection> = updateBy(data);

      await service.onUpdatePermitted(update);

      expect(update.data).toMatchObject({ nextPullAt: null, lastError: null });
    },
  );

  test.each([
    [{ name: "Renamed" }],
    [{ isEnabled: false }],
    [{ conversationReaders: "everyone" }],
  ])("%j leaves the schedule alone", async (data: JSONObject) => {
    const update: UpdateBy<LlmObservabilityConnection> = updateBy(data);

    await service.onUpdatePermitted(update);

    expect(update.data).toEqual(data);
  });
});

describe("LlmObservabilityConnectionService telemetry service and settings", () => {
  function created(serviceId?: ObjectID): LlmObservabilityConnection {
    const connection: LlmObservabilityConnection = stored({
      name: "OpenAI production",
    });
    connection.id = CONNECTION;
    connection.projectId = PROJECT;
    if (serviceId) {
      connection.serviceId = serviceId;
    }
    return connection;
  }

  test("a connection with a service keeps it", async () => {
    const existing: TelemetryService = new TelemetryService();
    existing.id = SERVICE;
    existing.name = "OpenAI production";
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(existing);
    const create: jest.SpiedFunction<typeof ServiceService.create> = jest.spyOn(
      ServiceService,
      "create",
    );

    expect(
      await LlmObservabilityConnectionService.ensureTelemetryService(
        created(SERVICE),
      ),
    ).toEqual({
      serviceId: SERVICE,
      serviceName: "OpenAI production",
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("a new connection gets a service of its own, never one the project already has", async () => {
    const taken: TelemetryService = new TelemetryService();
    taken.id = ObjectID.generate();
    const findOneBy: jest.SpiedFunction<typeof ServiceService.findOneBy> = jest
      .spyOn(ServiceService, "findOneBy")
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(null);
    jest.spyOn(ServiceService, "create").mockImplementation((async (data: {
      data: TelemetryService;
    }) => {
      data.data.id = SERVICE;
      return data.data;
    }) as never);
    const update: jest.SpiedFunction<
      typeof LlmObservabilityConnectionService.updateOneById
    > = jest
      .spyOn(LlmObservabilityConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const invalidate: jest.SpiedFunction<
      typeof LlmConversationPrivacy.invalidate
    > = jest.spyOn(LlmConversationPrivacy, "invalidate");

    expect(
      await LlmObservabilityConnectionService.ensureTelemetryService(created()),
    ).toEqual({
      serviceId: SERVICE,
      serviceName: "OpenAI production 2",
    });
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      id: CONNECTION,
      data: { serviceId: SERVICE },
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(invalidate).toHaveBeenCalledWith(PROJECT);
  });

  test("a service that cannot be made yet never fails the save", async () => {
    jest
      .spyOn(LlmObservabilityConnectionService, "ensureTelemetryService")
      .mockRejectedValue(new Error("deadlock"));

    await expect(
      service.onCreateSuccess(
        { createBy: createBy({}), carryForward: null },
        created(),
      ),
    ).resolves.toBeDefined();
  });

  test("the read loop's settings: stored ones loaded, defaults applied, secrets parsed", async () => {
    jest
      .spyOn(LlmObservabilityConnectionService, "findOneById")
      .mockResolvedValue(
        stored({
          provider: LlmConnectionProvider.AzureOpenAI,
          config: azureConfig,
          secrets: JSON.stringify({ clientSecret: "stored~secret" }),
        }),
      );
    const connection: LlmObservabilityConnection =
      new LlmObservabilityConnection();
    connection.id = CONNECTION;

    const settings: LlmConnectionSettings =
      await LlmObservabilityConnectionService.getConnectorSettings(connection);

    expect(settings).toEqual({
      provider: LlmConnectionProvider.AzureOpenAI,
      config: { ...azureConfig, cloud: "public" },
      secrets: { clientSecret: "stored~secret" },
    });
  });

  test("statics used by the form's test", () => {
    const definition: LlmConnectionDefinition = getLlmConnectionDefinition(
      LlmConnectionProvider.OpenAI,
    )!;

    expect(
      LlmObservabilityConnectionServiceClass.mergeSecrets({
        definition,
        stored: { adminKey: OPENAI_KEY },
        provided: { adminKey: "" },
      }),
    ).toEqual({ adminKey: OPENAI_KEY });
    expect(
      LlmObservabilityConnectionServiceClass.readConversationReaders(undefined),
    ).toBeUndefined();
    expect(() => {
      return LlmObservabilityConnectionServiceClass.getDefinitionOrThrow(
        undefined,
      );
    }).toThrow(BadDataException);
  });
});
