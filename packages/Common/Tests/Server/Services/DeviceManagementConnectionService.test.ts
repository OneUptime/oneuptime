import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import DeviceManagementConnectionService, {
  Service as DeviceManagementConnectionServiceType,
} from "../../../Server/Services/DeviceManagementConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { DeviceManagementSettings } from "../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import ManagedDeviceInventory from "../../../Server/Utils/DeviceManagement/ManagedDeviceInventory";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
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
 * DeviceManagementConnectionService checks an Esper connection when it is
 * saved, so a connection that stores is one the read loop can use: the
 * service, the tenant, the interval and the key are each refused when they
 * cannot be right - never quietly replaced. The key is write-only (an edit
 * that leaves it empty keeps the stored one), one tenant is connected once
 * per project, a connection's tenant never changes under its devices, and
 * deleting a connection lets go of its devices' hosts in Inventory first.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const API_KEY: string = "esper-key-0123456789abcdefGHIJKL";
const NEW_API_KEY: string = "esper-key-ZYXWVUTSRQ9876543210";

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DeviceManagementConnection>,
  ) => Promise<OnCreate<DeviceManagementConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DeviceManagementConnection>,
  ) => Promise<OnUpdate<DeviceManagementConnection>>;
  onUpdatePermitted: (
    updateBy: UpdateBy<DeviceManagementConnection>,
  ) => Promise<void>;
  onBeforeDelete: (
    deleteBy: DeleteBy<DeviceManagementConnection>,
  ) => Promise<unknown>;
  findRowsAndHoldDeleteToThem: (...args: Array<unknown>) => Promise<unknown>;
};

const service: HookCaller =
  DeviceManagementConnectionService as unknown as HookCaller;

let existing: Array<DeviceManagementConnection>;
let stored: DeviceManagementConnection | null;

function newConnection(
  overrides: Record<string, unknown> = {},
): DeviceManagementConnection {
  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection.projectId = PROJECT_ID;
  connection.provider = DeviceManagementProvider.Esper;
  connection.config = { tenant: "acme", readIntervalInMinutes: 15 };
  connection.secrets = JSON.stringify({ apiKey: API_KEY });
  Object.assign(connection, overrides);
  return connection;
}

function createBy(
  connection: DeviceManagementConnection,
): CreateBy<DeviceManagementConnection> {
  return {
    data: connection,
    props: { isRoot: true },
  } as unknown as CreateBy<DeviceManagementConnection>;
}

function updateBy(
  data: JSONObject,
  query: JSONObject = { _id: CONNECTION_ID.toString() },
): UpdateBy<DeviceManagementConnection> {
  return {
    query,
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<DeviceManagementConnection>;
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
    .spyOn(DeviceManagementConnectionService, "findBy")
    .mockImplementation((async () => {
      return existing;
    }) as never);
  jest
    .spyOn(DeviceManagementConnectionService, "findOneById")
    .mockImplementation((async () => {
      return stored;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a save reads", () => {
  test("the service: Esper, or none named", () => {
    expect(DeviceManagementConnectionServiceType.readProvider(undefined)).toBe(
      DeviceManagementProvider.Esper,
    );
    expect(() => {
      return DeviceManagementConnectionServiceType.readProvider("intune");
    }).toThrow(/Service must be 'esper'/);
  });

  test("the credentials: the API key and nothing else", () => {
    expect(
      DeviceManagementConnectionServiceType.readSecrets(
        { apiKey: ` ${API_KEY} ` },
        { requireApiKey: true },
      ),
    ).toEqual({ apiKey: API_KEY });
    expect(() => {
      return DeviceManagementConnectionServiceType.readSecrets(
        { apiKey: API_KEY, token: "x" },
        { requireApiKey: true },
      );
    }).toThrow('Credentials has no "token": an Esper connection takes apiKey.');
    expect(
      DeviceManagementConnectionServiceType.readSecrets(
        { apiKey: "" },
        { requireApiKey: false },
      ),
    ).toEqual({});
  });

  test("a name for a connection saved without one: the tenant's", () => {
    expect(
      DeviceManagementConnectionServiceType.getDefaultName({
        provider: DeviceManagementProvider.Esper,
        config: { tenant: "acme", readIntervalInMinutes: 15 },
      }),
    ).toBe("Esper acme");
  });
});

describe("creating a connection", () => {
  test("the settings are stored as checked, the key as JSON, the name filled in", async () => {
    const connection: DeviceManagementConnection = newConnection({
      config: {
        tenant: "https://acme.esper.cloud/devices",
        readIntervalInMinutes: 30,
      },
      secrets: { apiKey: ` ${API_KEY} ` },
    });

    await service.onBeforeCreate(createBy(connection));

    expect(connection.config).toEqual({
      tenant: "acme",
      readIntervalInMinutes: 30,
    });
    expect(JSON.parse(connection.secrets!)).toEqual({ apiKey: API_KEY });
    expect(connection.name).toBe("Esper acme");
    expect(connection.provider).toBe(DeviceManagementProvider.Esper);
  });

  test("a tenant connected already is refused, naming that connection", async () => {
    existing = [newConnection({ name: "Kiosks" })];

    expect(
      await refusal(service.onBeforeCreate(createBy(newConnection()))),
    ).toBe(
      'This Esper tenant is connected already, as "Kiosks". Edit that connection instead.',
    );
  });

  test("no tenant, a key that is not one, or an unknown setting is refused", async () => {
    expect(
      await refusal(
        service.onBeforeCreate(createBy(newConnection({ config: {} }))),
      ),
    ).toMatch(/Enter your Esper tenant/);
    expect(
      await refusal(
        service.onBeforeCreate(
          createBy(newConnection({ secrets: { apiKey: "short" } })),
        ),
      ),
    ).toMatch(/not an Esper API key/);
    expect(
      await refusal(
        service.onBeforeCreate(
          createBy(newConnection({ config: { tenant: "acme", proxy: "x" } })),
        ),
      ),
    ).toMatch(/Settings has no "proxy"/);
    expect(
      await refusal(
        service.onBeforeCreate(createBy(newConnection({ isEnabled: "yes" }))),
      ),
    ).toBe("Enabled must be true or false.");
  });
});

describe("editing a connection", () => {
  test("a key left empty keeps the stored one; a new one replaces it", async () => {
    const keep: UpdateBy<DeviceManagementConnection> = updateBy({
      secrets: { apiKey: "" },
    });
    await service.onBeforeUpdate(keep);
    expect(
      JSON.parse((keep.data as unknown as JSONObject)["secrets"] as string),
    ).toEqual({ apiKey: API_KEY });

    const replace: UpdateBy<DeviceManagementConnection> = updateBy({
      secrets: { apiKey: NEW_API_KEY },
    });
    await service.onBeforeUpdate(replace);
    expect(
      JSON.parse((replace.data as unknown as JSONObject)["secrets"] as string),
    ).toEqual({ apiKey: NEW_API_KEY });
  });

  test("the read interval can change; the tenant cannot", async () => {
    const interval: UpdateBy<DeviceManagementConnection> = updateBy({
      config: { readIntervalInMinutes: 60 },
    });
    await service.onBeforeUpdate(interval);
    expect((interval.data as unknown as JSONObject)["config"]).toEqual({
      tenant: "acme",
      readIntervalInMinutes: 60,
    });

    expect(
      await refusal(
        service.onBeforeUpdate(updateBy({ config: { tenant: "other" } })),
      ),
    ).toBe(
      "A connection reads one Esper tenant. To read another one, connect it as well.",
    );
    expect(
      await refusal(service.onBeforeUpdate(updateBy({ provider: "esper" }))),
    ).toMatch(/service of a connection cannot be changed/);
  });

  test("settings and keys are changed one connection at a time", async () => {
    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ secrets: { apiKey: NEW_API_KEY } }, { projectId: "x" }),
        ),
      ),
    ).toMatch(/one connection at a time/);
  });

  test("a name cannot be emptied", async () => {
    expect(
      await refusal(service.onBeforeUpdate(updateBy({ name: "  " }))),
    ).toBe("Enter a name for the connection.");
  });

  test("new settings, or turned back on: read again at once, the old error gone", async () => {
    const changed: UpdateBy<DeviceManagementConnection> = updateBy({
      config: { readIntervalInMinutes: 60 },
    });
    await service.onUpdatePermitted(changed);
    expect(changed.data).toMatchObject({ nextPullAt: null, lastError: null });

    const turnedOn: UpdateBy<DeviceManagementConnection> = updateBy({
      isEnabled: true,
    });
    await service.onUpdatePermitted(turnedOn);
    expect(turnedOn.data).toMatchObject({ nextPullAt: null, lastError: null });

    const renamed: UpdateBy<DeviceManagementConnection> = updateBy({
      name: "Kiosks",
    });
    await service.onUpdatePermitted(renamed);
    expect(renamed.data).toEqual({ name: "Kiosks" });
  });
});

describe("deleting a connection", () => {
  test("its devices' hosts in Inventory are let go first", async () => {
    jest
      .spyOn(
        DeviceManagementConnectionService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<unknown>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockImplementation((async () => {
        return [newConnection({ _id: CONNECTION_ID.toString() })];
      }) as never);

    const released: Array<JSONObject> = [];

    jest
      .spyOn(ManagedDeviceInventory, "releaseConnection")
      .mockImplementation((async (data: {
        projectId: ObjectID;
        connectionId: ObjectID;
      }) => {
        released.push({
          projectId: data.projectId.toString(),
          connectionId: data.connectionId.toString(),
        });
        return 3;
      }) as never);

    await service.onBeforeDelete({
      query: { _id: CONNECTION_ID.toString() },
      props: { isRoot: true },
    } as unknown as DeleteBy<DeviceManagementConnection>);

    expect(released).toEqual([
      {
        projectId: PROJECT_ID.toString(),
        connectionId: CONNECTION_ID.toString(),
      },
    ]);
  });
});

describe("the settings a read uses", () => {
  test("decrypted, from the stored connection", async () => {
    const settings: DeviceManagementSettings =
      await DeviceManagementConnectionService.getDeviceManagementSettings(
        ((): DeviceManagementConnection => {
          const connection: DeviceManagementConnection =
            new DeviceManagementConnection();
          connection.id = CONNECTION_ID;
          return connection;
        })(),
      );

    expect(settings).toEqual({
      provider: DeviceManagementProvider.Esper,
      projectId: PROJECT_ID.toString(),
      config: { tenant: "acme", readIntervalInMinutes: 15 },
      apiKey: API_KEY,
    });
  });

  test("a connection that is gone says so", async () => {
    stored = null;

    expect(
      await refusal(
        DeviceManagementConnectionService.getDeviceManagementSettings(
          ((): DeviceManagementConnection => {
            const connection: DeviceManagementConnection =
              new DeviceManagementConnection();
            connection.id = CONNECTION_ID;
            return connection;
          })(),
        ),
      ),
    ).toBe("The connection no longer exists.");
  });
});
