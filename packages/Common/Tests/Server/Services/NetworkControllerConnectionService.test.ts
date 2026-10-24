import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkControllerConnectionService, {
  Service as NetworkControllerConnectionServiceType,
} from "../../../Server/Services/NetworkControllerConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { NetworkControllerSettings } from "../../../Server/Utils/NetworkController/NetworkControllerTypes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import { MerakiRegion } from "../../../Types/NetworkController/MerakiRegion";
import NetworkControllerProvider from "../../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NetworkControllerConnectionService checks a Meraki connection when it is
 * saved, so a connection that stores is one the read loop can use: the
 * controller, the region, the organization, the interval and the key are
 * each refused when they cannot be right - never quietly replaced. The key
 * is write-only (an edit that leaves it empty keeps the stored one), one
 * organization is connected once per project, and a connection's
 * organization and region never change under its cursors.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const API_KEY: string = "0123456789abcdef0123456789abcdef01234567";
const NEW_API_KEY: string = "fedcba9876543210fedcba9876543210fedcba98";

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkControllerConnection>,
  ) => Promise<OnCreate<NetworkControllerConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<NetworkControllerConnection>,
  ) => Promise<OnUpdate<NetworkControllerConnection>>;
  onUpdatePermitted: (
    updateBy: UpdateBy<NetworkControllerConnection>,
  ) => Promise<void>;
};

const service: HookCaller =
  NetworkControllerConnectionService as unknown as HookCaller;

let existing: Array<NetworkControllerConnection>;
let stored: NetworkControllerConnection | null;

// The stored connection's read, as the hooks call it (a jest spy).
function findOneById(): unknown {
  return NetworkControllerConnectionService.findOneById;
}

function newConnection(
  overrides: Partial<NetworkControllerConnection> = {},
): NetworkControllerConnection {
  const connection: NetworkControllerConnection =
    new NetworkControllerConnection();
  connection.projectId = PROJECT_ID;
  connection.provider = NetworkControllerProvider.Meraki;
  connection.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Retail",
    readIntervalInMinutes: 5,
  };
  connection.secrets = JSON.stringify({ apiKey: API_KEY });
  Object.assign(connection, overrides);
  return connection;
}

function createBy(
  connection: NetworkControllerConnection,
  props: JSONObject = { isRoot: true },
): CreateBy<NetworkControllerConnection> {
  return {
    data: connection,
    props,
  } as unknown as CreateBy<NetworkControllerConnection>;
}

function updateBy(
  data: JSONObject,
  query: JSONObject = { _id: CONNECTION_ID.toString() },
): UpdateBy<NetworkControllerConnection> {
  return {
    query,
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<NetworkControllerConnection>;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("expected a refusal");
}

beforeEach(() => {
  existing = [];
  stored = newConnection({ _id: CONNECTION_ID.toString() });

  jest
    .spyOn(NetworkControllerConnectionService, "findBy")
    .mockImplementation((async () => {
      return existing;
    }) as never);
  jest
    .spyOn(NetworkControllerConnectionService, "findOneById")
    .mockImplementation((async () => {
      return stored;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a save reads", () => {
  test("the controller: Meraki, or none named", () => {
    expect(NetworkControllerConnectionServiceType.readProvider(undefined)).toBe(
      NetworkControllerProvider.Meraki,
    );
    expect(NetworkControllerConnectionServiceType.readProvider("meraki")).toBe(
      NetworkControllerProvider.Meraki,
    );
    expect(() => {
      return NetworkControllerConnectionServiceType.readProvider("unifi");
    }).toThrow(
      "Controller must be 'meraki': the network controllers OneUptime can read.",
    );
  });

  test("the credentials: the API key and nothing else", () => {
    expect(
      NetworkControllerConnectionServiceType.readSecrets(
        { apiKey: ` ${API_KEY} ` },
        { requireApiKey: true },
      ),
    ).toEqual({ apiKey: API_KEY });
    expect(
      NetworkControllerConnectionServiceType.readSecrets(
        JSON.stringify({ apiKey: API_KEY }),
        { requireApiKey: true },
      ),
    ).toEqual({ apiKey: API_KEY });
    expect(() => {
      return NetworkControllerConnectionServiceType.readSecrets(
        { apiKey: API_KEY, password: "x" },
        { requireApiKey: true },
      );
    }).toThrow(
      'Credentials has no "password": a Meraki connection takes apiKey.',
    );
  });

  test("a key is needed to create, and left empty on an edit keeps the stored one", () => {
    expect(() => {
      return NetworkControllerConnectionServiceType.readSecrets(
        {},
        { requireApiKey: true },
      );
    }).toThrow(BadDataException);
    expect(
      NetworkControllerConnectionServiceType.readSecrets(
        { apiKey: "" },
        { requireApiKey: false },
      ),
    ).toEqual({});
  });

  test.each([
    ["a short one", "short"],
    ["one with spaces", "has a space in it 0123456789abcdef"],
    ["one of 300 characters", "x".repeat(300)],
  ])("%s is not a key", (_label: string, value: string) => {
    expect(() => {
      return NetworkControllerConnectionServiceType.readSecrets(
        { apiKey: value },
        { requireApiKey: true },
      );
    }).toThrow(BadDataException);
  });

  test("a name for a connection saved without one: the organization's, held to fifty characters", () => {
    expect(
      NetworkControllerConnectionServiceType.getDefaultName({
        provider: NetworkControllerProvider.Meraki,
        config: {
          region: MerakiRegion.Global,
          organizationId: "1",
          organizationName: "A".repeat(80),
          readIntervalInMinutes: 5,
        },
      }),
    ).toBe("A".repeat(50));
    expect(
      NetworkControllerConnectionServiceType.getDefaultName({
        provider: NetworkControllerProvider.Meraki,
        config: {
          region: MerakiRegion.Global,
          organizationId: "1",
          organizationName: "",
          readIntervalInMinutes: 5,
        },
      }),
    ).toBe("Cisco Meraki");
  });
});

describe("creating a connection", () => {
  test("stores the settings as checked, the key alone in the secrets, and a name", async () => {
    const connection: NetworkControllerConnection = newConnection({
      provider: undefined,
      config: {
        organizationId: " 549236 ",
        organizationName: "Acme\tRetail",
        readIntervalInMinutes: "15",
      } as never,
      secrets: { apiKey: ` ${API_KEY}\n` } as never,
    });

    const result: OnCreate<NetworkControllerConnection> =
      await service.onBeforeCreate(createBy(connection));

    expect(result.createBy.data.provider).toBe(
      NetworkControllerProvider.Meraki,
    );
    expect(result.createBy.data.config).toEqual({
      region: "global",
      organizationId: "549236",
      organizationName: "Acme Retail",
      readIntervalInMinutes: 15,
    });
    expect(JSON.parse(result.createBy.data.secrets as string)).toEqual({
      apiKey: API_KEY,
    });
    expect(result.createBy.data.name).toBe("Acme Retail");
  });

  test("a name given is kept", async () => {
    const result: OnCreate<NetworkControllerConnection> =
      await service.onBeforeCreate(
        createBy(newConnection({ name: "Stores (EMEA)" })),
      );

    expect(result.createBy.data.name).toBe("Stores (EMEA)");
  });

  test.each([
    [
      "no organization",
      { config: { region: "global" } },
      "Pick the Meraki organization to read. Test the API key to see the organizations it can read.",
    ],
    [
      "a region that is not Meraki's",
      { config: { organizationId: "549236", region: "mars" } },
      "Region must be one of Meraki's dashboards: global, canada, china, india or us-fedramp.",
    ],
    [
      "an interval that is not a choice",
      { config: { organizationId: "549236", readIntervalInMinutes: 2 } },
      "Read every must be one of 5, 10, 15, 30, 60 minutes.",
    ],
    [
      "an address to call",
      { config: { organizationId: "549236", url: "https://evil.example" } },
      'Settings has no "url": a Meraki connection takes region, organizationId, organizationName and readIntervalInMinutes.',
    ],
    [
      "an organization ID that is a path",
      { config: { organizationId: "../../admin" } },
      "The Meraki organization ID is not one Meraki gives: it is letters and digits, like 123456.",
    ],
    [
      "no key",
      { secrets: JSON.stringify({}) },
      "Enter the Meraki dashboard API key. Make one in the Meraki dashboard under Organization > API & Webhooks.",
    ],
    [
      "another controller",
      { provider: "unifi" },
      "Controller must be 'meraki': the network controllers OneUptime can read.",
    ],
    [
      "a switch that is not true or false",
      { isEnabled: "yes" },
      "Enabled must be true or false.",
    ],
  ])(
    "%s is refused",
    async (_label: string, overrides: JSONObject, message: string) => {
      expect(
        await refusal(
          service.onBeforeCreate(createBy(newConnection(overrides as never))),
        ),
      ).toBe(message);
    },
  );

  test("an organization connected already in the project is refused, naming that connection", async () => {
    const other: NetworkControllerConnection = newConnection({
      name: "Acme stores",
    });
    existing = [other];

    expect(
      await refusal(service.onBeforeCreate(createBy(newConnection()))),
    ).toBe(
      'This Meraki organization is connected already, as "Acme stores". Edit that connection instead.',
    );
  });

  test("another organization of the project is not in the way", async () => {
    existing = [
      newConnection({
        config: { region: "global", organizationId: "777001" },
      }),
    ];

    await expect(
      service.onBeforeCreate(createBy(newConnection())),
    ).resolves.toBeDefined();
  });

  test("the project comes from the request's tenant when the data names none", async () => {
    const connection: NetworkControllerConnection = newConnection({
      projectId: undefined,
    });

    await service.onBeforeCreate(
      createBy(connection, {
        tenantId: PROJECT_ID,
        userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
      }),
    );

    expect(NetworkControllerConnectionService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          provider: NetworkControllerProvider.Meraki,
        },
      }),
    );
  });
});

describe("editing a connection", () => {
  test("its name or switch alone: nothing else is read", async () => {
    await service.onBeforeUpdate(updateBy({ name: "Renamed" }));
    await service.onBeforeUpdate(updateBy({ isEnabled: false }));

    expect(findOneById()).not.toHaveBeenCalled();
  });

  test("the controller cannot be changed", async () => {
    expect(
      await refusal(service.onBeforeUpdate(updateBy({ provider: "meraki" }))),
    ).toBe(
      "The controller of a connection cannot be changed. Connect it anew instead.",
    );
  });

  test("its interval: merged over what is stored, and checked", async () => {
    const update: UpdateBy<NetworkControllerConnection> = updateBy({
      config: { readIntervalInMinutes: 30 },
    });

    await service.onBeforeUpdate(update);

    expect((update.data as unknown as JSONObject)["config"]).toEqual({
      region: "global",
      organizationId: "549236",
      organizationName: "Acme Retail",
      readIntervalInMinutes: 30,
    });
  });

  test("its organization cannot be changed", async () => {
    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ config: { organizationId: "777001" } }),
        ),
      ),
    ).toBe(
      "A connection reads one Meraki organization. To read another one, connect it as well.",
    );
  });

  test("nor its region", async () => {
    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ config: { region: "canada" } })),
      ),
    ).toBe(
      "A connection's dashboard region cannot be changed. Connect the organization again from its own region.",
    );
  });

  test("a key left empty keeps the stored one; a new one replaces it", async () => {
    const keep: UpdateBy<NetworkControllerConnection> = updateBy({
      secrets: { apiKey: "" },
    });
    await service.onBeforeUpdate(keep);
    expect(
      JSON.parse((keep.data as unknown as JSONObject)["secrets"] as string),
    ).toEqual({ apiKey: API_KEY });

    const replace: UpdateBy<NetworkControllerConnection> = updateBy({
      secrets: JSON.stringify({ apiKey: NEW_API_KEY }),
    });
    await service.onBeforeUpdate(replace);
    expect(
      JSON.parse((replace.data as unknown as JSONObject)["secrets"] as string),
    ).toEqual({ apiKey: NEW_API_KEY });
  });

  test("settings change one connection at a time, and only one that exists", async () => {
    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy(
            { config: { readIntervalInMinutes: 10 } },
            { projectId: PROJECT_ID.toString() },
          ),
        ),
      ),
    ).toBe(
      "Settings and credentials can only be updated one connection at a time.",
    );

    stored = null;
    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ secrets: { apiKey: NEW_API_KEY } })),
      ),
    ).toBe("The connection no longer exists.");
  });

  test("new settings, a new key or turning it back on: read again at once, the old error gone", async () => {
    for (const data of [
      { config: { readIntervalInMinutes: 10 } },
      { secrets: { apiKey: NEW_API_KEY } },
      { isEnabled: true },
    ]) {
      const update: UpdateBy<NetworkControllerConnection> = updateBy({
        ...data,
      });
      await service.onUpdatePermitted(update);

      expect(update.data).toMatchObject({ nextPullAt: null, lastError: null });
    }
  });

  test("a new name, or turning it off, leaves its schedule alone", async () => {
    for (const data of [{ name: "Renamed" }, { isEnabled: false }]) {
      const update: UpdateBy<NetworkControllerConnection> = updateBy({
        ...data,
      });
      await service.onUpdatePermitted(update);

      expect(update.data).toEqual(data);
    }
  });
});

describe("the settings a read uses", () => {
  test("read from the connection given, the key decrypted", async () => {
    const settings: NetworkControllerSettings =
      await NetworkControllerConnectionService.getControllerSettings(
        newConnection(),
      );

    expect(settings).toEqual({
      provider: NetworkControllerProvider.Meraki,
      projectId: PROJECT_ID.toString(),
      config: {
        region: MerakiRegion.Global,
        organizationId: "549236",
        organizationName: "Acme Retail",
        readIntervalInMinutes: 5,
      },
      apiKey: API_KEY,
    });
    expect(findOneById()).not.toHaveBeenCalled();
  });

  test("loaded first when the connection given has only its ID", async () => {
    const connection: NetworkControllerConnection =
      new NetworkControllerConnection();
    connection.id = CONNECTION_ID;

    const settings: NetworkControllerSettings =
      await NetworkControllerConnectionService.getControllerSettings(
        connection,
      );

    expect(findOneById()).toHaveBeenCalledTimes(1);
    expect(settings.apiKey).toBe(API_KEY);
  });

  test("a stored key that is not one fails the read rather than calling Meraki", async () => {
    await expect(
      NetworkControllerConnectionService.getControllerSettings(
        newConnection({ secrets: JSON.stringify({ apiKey: "" }) }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});
