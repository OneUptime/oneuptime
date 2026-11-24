import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import DeviceManagementConnectionService, {
  Service as DeviceManagementConnectionServiceType,
} from "../../../Server/Services/DeviceManagementConnectionService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { DeviceManagementSettings } from "../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
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
 * A Workspace ONE UEM (#10086) or SOTI MobiControl (#10087) connection, as
 * DeviceManagementConnectionService checks it when it is saved: its server
 * (the one thing typed that becomes where OneUptime connects), how it signs
 * in and the secrets of that way in - several, each write-only and kept
 * when an edit leaves it empty, unless the connection signs in another way
 * now - one connection per server and project, and the server fixed once
 * the connection is made.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const WS1_CLIENT_ID: string = "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6";
const WS1_SECRET: string = "9F2C4A7E1B3D5F60A8C2E4B6D8F0A1C3";
const WS1_NEW_SECRET: string = "0A1B2C3D4E5F60718293A4B5C6D7E8F9";
const WS1_API_KEY: string = "1EhZqw0lA6Uq2aUW8IDHm2RkAgpQZJbH9jE2/nYwG+w=";
const SOTI_CLIENT_ID: string = "a9326fd5872f4a66b6bab3e2c8065e63";
const SOTI_SECRET: string = "19DzUX7K7ObjwPRFbxZanwVQFsUcqMak";
const SOTI_PASSWORD: string = " Reader pass 2026! ";

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DeviceManagementConnection>,
  ) => Promise<OnCreate<DeviceManagementConnection>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DeviceManagementConnection>,
  ) => Promise<OnUpdate<DeviceManagementConnection>>;
};

const service: HookCaller =
  DeviceManagementConnectionService as unknown as HookCaller;

let existing: Array<DeviceManagementConnection>;
let stored: DeviceManagementConnection | null;

function workspaceOne(
  overrides: Record<string, unknown> = {},
): DeviceManagementConnection {
  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection.projectId = PROJECT_ID;
  connection.provider = DeviceManagementProvider.WorkspaceOne;
  connection.config = {
    tenant: "as1234.awmdm.com",
    authMethod: "oauth",
    region: "emea",
    clientId: WS1_CLIENT_ID,
    readIntervalInMinutes: 15,
  };
  connection.secrets = JSON.stringify({ clientSecret: WS1_SECRET });
  Object.assign(connection, overrides);
  return connection;
}

function soti(
  overrides: Record<string, unknown> = {},
): DeviceManagementConnection {
  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection.projectId = PROJECT_ID;
  connection.provider = DeviceManagementProvider.Soti;
  connection.config = {
    tenant: "acme.mobicontrolcloud.com",
    clientId: SOTI_CLIENT_ID,
    username: "oneuptime-reader",
    readIntervalInMinutes: 15,
  };
  connection.secrets = JSON.stringify({
    clientSecret: SOTI_SECRET,
    password: SOTI_PASSWORD,
  });
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

function updateBy(data: JSONObject): UpdateBy<DeviceManagementConnection> {
  return {
    query: { _id: CONNECTION_ID.toString() },
    data,
    props: { isRoot: true },
  } as unknown as UpdateBy<DeviceManagementConnection>;
}

function updated(update: UpdateBy<DeviceManagementConnection>): JSONObject {
  return update.data as unknown as JSONObject;
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

async function settingsOf(): Promise<DeviceManagementSettings> {
  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection.id = CONNECTION_ID;

  return DeviceManagementConnectionService.getDeviceManagementSettings(
    connection,
  );
}

beforeEach(() => {
  existing = [];
  stored = null;

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

describe("a Workspace ONE connection (#10086)", () => {
  test("its server is stored as its host, its sign-in as checked, its secret as JSON, its name its server's", async () => {
    const connection: DeviceManagementConnection = workspaceOne({
      config: {
        tenant: " https://AS1234.awmdm.com/API/ ",
        clientId: ` ${WS1_CLIENT_ID} `,
        region: "emea",
        readIntervalInMinutes: 30,
      },
      secrets: { clientSecret: ` ${WS1_SECRET} ` },
    });

    await service.onBeforeCreate(createBy(connection));

    expect(connection.config).toEqual({
      tenant: "as1234.awmdm.com",
      authMethod: "oauth",
      region: "emea",
      clientId: WS1_CLIENT_ID,
      readIntervalInMinutes: 30,
    });
    expect(JSON.parse(connection.secrets!)).toEqual({
      clientSecret: WS1_SECRET,
    });
    expect(connection.name).toBe("Workspace ONE as1234.awmdm.com");
  });

  test("an administrator's account takes its username, its password and the REST API key", async () => {
    const connection: DeviceManagementConnection = workspaceOne({
      config: {
        tenant: "mdm.acme.com:8443",
        authMethod: "basic",
        username: "ACME\\oneuptime",
        readIntervalInMinutes: 15,
      },
      secrets: { password: " pass with spaces ", apiKey: WS1_API_KEY },
    });

    await service.onBeforeCreate(createBy(connection));

    expect(connection.config).toEqual({
      tenant: "mdm.acme.com:8443",
      authMethod: "basic",
      username: "ACME\\oneuptime",
      readIntervalInMinutes: 15,
    });
    // A password is kept exactly as typed.
    expect(JSON.parse(connection.secrets!)).toEqual({
      password: " pass with spaces ",
      apiKey: WS1_API_KEY,
    });
  });

  test("a server that is not one, a sign-in it does not take, or the other way's secret: each refused", async () => {
    const refused: (overrides: Record<string, unknown>) => Promise<string> = (
      overrides: Record<string, unknown>,
    ): Promise<string> => {
      return refusal(service.onBeforeCreate(createBy(workspaceOne(overrides))));
    };

    expect(
      await refused({
        config: { tenant: "http://as1234.awmdm.com", clientId: WS1_CLIENT_ID },
      }),
    ).toBe(
      "OneUptime connects to the server over HTTPS only. Enter its address starting with https://.",
    );
    for (const tenant of [
      "",
      "https://user:pw@as1234.awmdm.com",
      "as1234.awmdm.com:0",
      "as_1234.awmdm.com",
      "-as1234.awmdm.com",
    ]) {
      expect(
        await refused({ config: { tenant, clientId: WS1_CLIENT_ID } }),
      ).toMatch(/Enter your Workspace ONE REST API URL/);
    }
    expect(
      await refused({
        config: {
          tenant: "as1234.awmdm.com",
          authMethod: "certificate",
          clientId: WS1_CLIENT_ID,
        },
      }),
    ).toBe("Sign in with must be one of oauth, basic.");
    expect(
      await refused({
        config: {
          tenant: "as1234.awmdm.com",
          region: "mars",
          clientId: WS1_CLIENT_ID,
        },
      }),
    ).toBe("Region must be one of na, emea, apac, uat.");
    expect(await refused({ config: { tenant: "as1234.awmdm.com" } })).toMatch(
      /Enter the OAuth client's Client ID/,
    );
    expect(
      await refused({
        config: { tenant: "as1234.awmdm.com", clientId: WS1_CLIENT_ID },
        secrets: { password: "x", apiKey: WS1_API_KEY },
      }),
    ).toBe(
      'Credentials has no "password": a Workspace ONE connection that signs in with an OAuth client takes clientSecret.',
    );
    expect(
      await refused({
        config: {
          tenant: "as1234.awmdm.com",
          authMethod: "basic",
          username: "reader",
        },
        secrets: { password: "pw" },
      }),
    ).toMatch(/Enter the REST API key/);
    expect(
      await refused({
        config: {
          tenant: "as1234.awmdm.com",
          clientId: WS1_CLIENT_ID,
          cloud: "public",
        },
      }),
    ).toMatch(/a Workspace ONE connection takes tenant, authMethod, region/);
  });

  test("one connection per server and project: the console's address names the same server", async () => {
    existing = [workspaceOne({ name: "Stores" })];

    expect(
      await refusal(
        service.onBeforeCreate(
          createBy(
            workspaceOne({
              config: {
                tenant: "https://cn1234.awmdm.com/AirWatch/",
                clientId: WS1_CLIENT_ID,
              },
            }),
          ),
        ),
      ),
    ).toBe(
      'This Workspace ONE server is connected already, as "Stores". Edit that connection instead.',
    );

    // Another server is another connection.
    await service.onBeforeCreate(
      createBy(
        workspaceOne({
          config: { tenant: "as5678.awmdm.com", clientId: WS1_CLIENT_ID },
        }),
      ),
    );
  });

  test("an edit keeps a secret left empty, takes a new one, and never another server", async () => {
    stored = workspaceOne({ _id: CONNECTION_ID.toString() });

    const keep: UpdateBy<DeviceManagementConnection> = updateBy({
      config: { region: "apac" },
      secrets: { clientSecret: "" },
    });
    await service.onBeforeUpdate(keep);
    expect(JSON.parse(updated(keep)["secrets"] as string)).toEqual({
      clientSecret: WS1_SECRET,
    });
    expect(updated(keep)["config"]).toMatchObject({
      tenant: "as1234.awmdm.com",
      region: "apac",
    });

    const replace: UpdateBy<DeviceManagementConnection> = updateBy({
      secrets: { clientSecret: WS1_NEW_SECRET },
    });
    await service.onBeforeUpdate(replace);
    expect(JSON.parse(updated(replace)["secrets"] as string)).toEqual({
      clientSecret: WS1_NEW_SECRET,
    });

    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ config: { tenant: "as9999.awmdm.com" } }),
        ),
      ),
    ).toBe(
      "A connection reads one Workspace ONE server. To read another one, connect it as well.",
    );
  });

  test("signing in another way takes that way's secrets, none of the stored ones", async () => {
    stored = workspaceOne({ _id: CONNECTION_ID.toString() });

    // No password or REST API key given: the OAuth client's secret is no stand-in.
    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ config: { authMethod: "basic", username: "reader" } }),
        ),
      ),
    ).toMatch(/Enter the password of the administrator/);

    const moved: UpdateBy<DeviceManagementConnection> = updateBy({
      config: { authMethod: "basic", username: "reader" },
      secrets: { password: "pw", apiKey: WS1_API_KEY },
    });
    await service.onBeforeUpdate(moved);
    expect(updated(moved)["config"]).toEqual({
      tenant: "as1234.awmdm.com",
      authMethod: "basic",
      username: "reader",
      readIntervalInMinutes: 15,
    });
    expect(JSON.parse(updated(moved)["secrets"] as string)).toEqual({
      password: "pw",
      apiKey: WS1_API_KEY,
    });
  });

  test("the settings a read uses: its sign-in's secrets, decrypted", async () => {
    stored = workspaceOne({ _id: CONNECTION_ID.toString() });
    expect(await settingsOf()).toEqual({
      provider: DeviceManagementProvider.WorkspaceOne,
      projectId: PROJECT_ID.toString(),
      config: {
        tenant: "as1234.awmdm.com",
        authMethod: "oauth",
        region: "emea",
        clientId: WS1_CLIENT_ID,
        readIntervalInMinutes: 15,
      },
      apiKey: "",
      clientSecret: WS1_SECRET,
    });

    stored = workspaceOne({
      _id: CONNECTION_ID.toString(),
      config: {
        tenant: "as1234.awmdm.com",
        authMethod: "basic",
        username: "reader",
        readIntervalInMinutes: 15,
      },
      secrets: JSON.stringify({ password: "pw", apiKey: WS1_API_KEY }),
    });
    expect(await settingsOf()).toMatchObject({
      apiKey: WS1_API_KEY,
      password: "pw",
    });
    expect((await settingsOf()).clientSecret).toBeUndefined();
  });
});

describe("a SOTI connection (#10087)", () => {
  test("its server is stored as its host, its API client and user as checked, both secrets as JSON", async () => {
    const connection: DeviceManagementConnection = soti({
      config: {
        tenant: "https://Acme.MobiControlCloud.com/MobiControl/WebConsole/home",
        clientId: SOTI_CLIENT_ID,
        username: " oneuptime-reader ",
        readIntervalInMinutes: 5,
      },
      secrets: { clientSecret: SOTI_SECRET, password: SOTI_PASSWORD },
    });

    await service.onBeforeCreate(createBy(connection));

    expect(connection.config).toEqual({
      tenant: "acme.mobicontrolcloud.com",
      clientId: SOTI_CLIENT_ID,
      username: "oneuptime-reader",
      readIntervalInMinutes: 5,
    });
    expect(JSON.parse(connection.secrets!)).toEqual({
      clientSecret: SOTI_SECRET,
      password: SOTI_PASSWORD,
    });
    expect(connection.name).toBe("SOTI acme.mobicontrolcloud.com");
  });

  test("a server that is not one, a missing API client, user or secret, or a key it does not take: each refused", async () => {
    const refused: (overrides: Record<string, unknown>) => Promise<string> = (
      overrides: Record<string, unknown>,
    ): Promise<string> => {
      return refusal(service.onBeforeCreate(createBy(soti(overrides))));
    };

    expect(
      await refused({
        config: {
          tenant: "ftp://acme.mobicontrolcloud.com",
          clientId: SOTI_CLIENT_ID,
          username: "reader",
        },
      }),
    ).toMatch(/over HTTPS only/);
    expect(
      await refused({
        config: { tenant: "", clientId: SOTI_CLIENT_ID, username: "reader" },
      }),
    ).toMatch(/Enter your MobiControl server's address/);
    expect(
      await refused({
        config: { tenant: "acme.mobicontrolcloud.com", username: "reader" },
      }),
    ).toMatch(/Enter the API client's Client ID/);
    expect(
      await refused({
        config: {
          tenant: "acme.mobicontrolcloud.com",
          clientId: SOTI_CLIENT_ID,
        },
      }),
    ).toMatch(/Enter the username of the MobiControl user/);
    expect(await refused({ secrets: { clientSecret: SOTI_SECRET } })).toMatch(
      /Enter the password of the MobiControl user/,
    );
    expect(
      await refused({
        secrets: {
          clientSecret: SOTI_SECRET,
          password: SOTI_PASSWORD,
          apiKey: "x",
        },
      }),
    ).toBe(
      'Credentials has no "apiKey": a SOTI connection takes clientSecret and password.',
    );
  });

  test("an edit keeps each secret left empty and takes each new one; the server is fixed", async () => {
    stored = soti({ _id: CONNECTION_ID.toString() });

    const newPassword: UpdateBy<DeviceManagementConnection> = updateBy({
      secrets: { clientSecret: "", password: "new password" },
    });
    await service.onBeforeUpdate(newPassword);
    expect(JSON.parse(updated(newPassword)["secrets"] as string)).toEqual({
      clientSecret: SOTI_SECRET,
      password: "new password",
    });

    const newUser: UpdateBy<DeviceManagementConnection> = updateBy({
      config: { username: "another-reader" },
    });
    await service.onBeforeUpdate(newUser);
    expect(updated(newUser)["config"]).toMatchObject({
      username: "another-reader",
    });
    expect(updated(newUser)["secrets"]).toBeUndefined();

    expect(
      await refusal(
        service.onBeforeUpdate(
          updateBy({ config: { tenant: "mdm.acme.com" } }),
        ),
      ),
    ).toBe(
      "A connection reads one MobiControl server. To read another one, connect it as well.",
    );
  });

  test("one connection per server and project", async () => {
    existing = [soti({ name: "Warehouses" })];

    expect(await refusal(service.onBeforeCreate(createBy(soti())))).toBe(
      'This MobiControl server is connected already, as "Warehouses". Edit that connection instead.',
    );
  });

  test("the settings a read uses: the API client's secret and the user's password, decrypted", async () => {
    stored = soti({ _id: CONNECTION_ID.toString() });

    expect(await settingsOf()).toEqual({
      provider: DeviceManagementProvider.Soti,
      projectId: PROJECT_ID.toString(),
      config: {
        tenant: "acme.mobicontrolcloud.com",
        clientId: SOTI_CLIENT_ID,
        username: "oneuptime-reader",
        readIntervalInMinutes: 15,
      },
      apiKey: "",
      clientSecret: SOTI_SECRET,
      password: SOTI_PASSWORD,
    });
  });
});

describe("what a request's credentials say", () => {
  test("each service's secrets, by how it signs in; an empty one, on an edit, is left out", () => {
    expect(
      DeviceManagementConnectionServiceType.readSecrets(
        { clientSecret: SOTI_SECRET, password: "" },
        { required: false, provider: DeviceManagementProvider.Soti },
      ),
    ).toEqual({ clientSecret: SOTI_SECRET });
    expect(
      DeviceManagementConnectionServiceType.readSecrets(
        { password: "pw", apiKey: WS1_API_KEY },
        {
          required: true,
          provider: DeviceManagementProvider.WorkspaceOne,
          config: {
            tenant: "as1234.awmdm.com",
            authMethod: "basic",
            readIntervalInMinutes: 15,
          },
        },
      ),
    ).toEqual({ password: "pw", apiKey: WS1_API_KEY });
    expect(
      DeviceManagementConnectionServiceType.toSecretsJson(
        DeviceManagementProvider.Soti,
        { clientSecret: SOTI_SECRET, password: "pw", apiKey: "stray" },
      ),
    ).toBe(JSON.stringify({ clientSecret: SOTI_SECRET, password: "pw" }));
  });
});
