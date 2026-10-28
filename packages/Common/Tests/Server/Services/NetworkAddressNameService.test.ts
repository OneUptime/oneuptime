import NetworkAddressNameService, {
  ADDRESS_NAME_ADDRESS_INVALID_MESSAGE,
  ADDRESS_NAME_ADDRESS_REQUIRED_MESSAGE,
  ADDRESS_NAME_NAME_REQUIRED_MESSAGE,
  Service as NetworkAddressNameServiceType,
} from "../../../Server/Services/NetworkAddressNameService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Address Names are checked and written one way when saved (issue #5340),
 * so what is stored is what a Traffic page can match: an address or a
 * subnet as NetworkAddressBlockUtil writes it, a name on one line, and one
 * name per address in a project - a second one says which name it has.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const ROW: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000001");
const OTHER_ROW: ObjectID = new ObjectID(
  "90000000-0000-4000-8000-000000000002",
);

interface Hooks {
  onBeforeCreate: (createBy: CreateBy<NetworkAddressName>) => Promise<
    OnCreate<NetworkAddressName>
  >;
  onBeforeUpdate: (updateBy: UpdateBy<NetworkAddressName>) => Promise<
    OnUpdate<NetworkAddressName>
  >;
}

const hooks: Hooks = NetworkAddressNameService as unknown as Hooks;

let findOneBy: SpyInstance<
  NetworkAddressNameServiceType["findOneBy"]
>;

function existing(address: string, name: string, id: ObjectID): NetworkAddressName {
  const row: NetworkAddressName = new NetworkAddressName();
  row._id = id.toString();
  row.address = address;
  row.name = name;
  row.projectId = PROJECT;
  return row;
}

function createBy(data: {
  name?: unknown;
  address?: unknown;
}): CreateBy<NetworkAddressName> {
  const model: NetworkAddressName = new NetworkAddressName();
  model.projectId = PROJECT;
  (model as unknown as Record<string, unknown>)["name"] = data.name;
  (model as unknown as Record<string, unknown>)["address"] = data.address;

  return {
    data: model,
    props: { tenantId: PROJECT, userId: ObjectID.generate() },
  };
}

function updateBy(
  data: Record<string, unknown>,
  id: unknown = ROW,
): UpdateBy<NetworkAddressName> {
  return {
    query: { _id: id },
    data: data,
    props: { tenantId: PROJECT, userId: ObjectID.generate() },
  } as unknown as UpdateBy<NetworkAddressName>;
}

beforeEach(() => {
  findOneBy = jest
    .spyOn(NetworkAddressNameService, "findOneBy")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkAddressNameService.readAddress", () => {
  test("an address or a subnet is kept the one way it is written", () => {
    expect(NetworkAddressNameServiceType.readAddress(" 10.0.0.5 ")).toBe(
      "10.0.0.5",
    );
    expect(NetworkAddressNameServiceType.readAddress("2001:DB8::5")).toBe(
      "2001:db8::5",
    );
    expect(NetworkAddressNameServiceType.readAddress("10.18.167.35/24")).toBe(
      "10.18.167.0/24",
    );
    expect(NetworkAddressNameServiceType.readAddress("::ffff:10.0.0.5")).toBe(
      "10.0.0.5",
    );
  });

  test("nothing typed asks for an address", () => {
    for (const value of [undefined, null, ""]) {
      expect(() => {
        NetworkAddressNameServiceType.readAddress(value);
      }).toThrow(new BadDataException(ADDRESS_NAME_ADDRESS_REQUIRED_MESSAGE));
    }
  });

  test("a host name, a range or a port is refused, saying what to write", () => {
    for (const value of [
      "fileserver-01",
      "10.0.0.1-10.0.0.9",
      "10.0.0.5:443",
      "10.0.0.0/33",
      5,
      {},
    ]) {
      expect(() => {
        NetworkAddressNameServiceType.readAddress(value);
      }).toThrow(new BadDataException(ADDRESS_NAME_ADDRESS_INVALID_MESSAGE));
    }
  });
});

describe("NetworkAddressNameService.readName", () => {
  test("a name is kept on one line, trimmed", () => {
    expect(NetworkAddressNameServiceType.readName("  Payroll\n SaaS ")).toBe(
      "Payroll SaaS",
    );
  });

  test("no name, or only white space and control characters, is refused", () => {
    for (const value of [undefined, null, "", "   ", "\t\n", 5]) {
      expect(() => {
        NetworkAddressNameServiceType.readName(value);
      }).toThrow(new BadDataException(ADDRESS_NAME_NAME_REQUIRED_MESSAGE));
    }
  });
});

describe("NetworkAddressNameService.onBeforeCreate", () => {
  test("writes the address and the name the one way they are kept", async () => {
    const result: OnCreate<NetworkAddressName> = await hooks.onBeforeCreate(
      createBy({ name: " Mumbai   office ", address: "10.18.167.35/24" }),
    );

    expect(result.createBy.data.address).toBe("10.18.167.0/24");
    expect(result.createBy.data.name).toBe("Mumbai office");
  });

  test("looks for the same address in the project, as written, as root", async () => {
    await hooks.onBeforeCreate(
      createBy({ name: "Payroll SaaS", address: "158.115.141.143" }),
    );

    expect(findOneBy).toHaveBeenCalledTimes(1);
    const args: { query: Record<string, unknown>; props: unknown } =
      findOneBy.mock.calls[0]![0] as never;

    expect(String(args.query["projectId"])).toBe(PROJECT.toString());
    expect(args.query["address"]).toBe("158.115.141.143");
    expect(args.props).toEqual({ isRoot: true });
  });

  test("an address the project named already is refused with the name it has", async () => {
    findOneBy.mockResolvedValue(
      existing("10.18.167.0/24", "Mumbai office", OTHER_ROW),
    );

    await expect(
      hooks.onBeforeCreate(
        // Another spelling of the same subnet is the same subnet.
        createBy({ name: "Mumbai", address: "10.18.167.200/24" }),
      ),
    ).rejects.toThrow(
      new BadDataException(
        "10.18.167.0/24 already has a name: Mumbai office. Change that one instead.",
      ),
    );
  });

  test("an address that is not one is refused before anything is read", async () => {
    await expect(
      hooks.onBeforeCreate(createBy({ name: "Printer", address: "printer-1" })),
    ).rejects.toThrow(
      new BadDataException(ADDRESS_NAME_ADDRESS_INVALID_MESSAGE),
    );
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("a name that is only white space is refused", async () => {
    await expect(
      hooks.onBeforeCreate(createBy({ name: "   ", address: "10.0.0.5" })),
    ).rejects.toThrow(new BadDataException(ADDRESS_NAME_NAME_REQUIRED_MESSAGE));
  });
});

describe("NetworkAddressNameService.onBeforeUpdate", () => {
  test("a new name is written the way a new row's is, without a read", async () => {
    const result: OnUpdate<NetworkAddressName> = await hooks.onBeforeUpdate(
      updateBy({ name: "  Backup\tappliance " }),
    );

    expect((result.updateBy.data as Record<string, unknown>)["name"]).toBe(
      "Backup appliance",
    );
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("an empty name is refused", async () => {
    await expect(hooks.onBeforeUpdate(updateBy({ name: "" }))).rejects.toThrow(
      new BadDataException(ADDRESS_NAME_NAME_REQUIRED_MESSAGE),
    );
  });

  test("a new address is written one way, and may be the row's own", async () => {
    findOneBy.mockResolvedValue(existing("10.0.0.5", "Printer", ROW));

    const result: OnUpdate<NetworkAddressName> = await hooks.onBeforeUpdate(
      updateBy({ address: "10.0.0.5/32" }),
    );

    expect((result.updateBy.data as Record<string, unknown>)["address"]).toBe(
      "10.0.0.5",
    );
  });

  test("the row's id in the query may be text", async () => {
    findOneBy.mockResolvedValue(existing("10.0.0.5", "Printer", ROW));

    await expect(
      hooks.onBeforeUpdate(updateBy({ address: "10.0.0.5" }, ROW.toString())),
    ).resolves.toBeTruthy();
  });

  test("moving to an address another row names is refused", async () => {
    findOneBy.mockResolvedValue(existing("10.0.0.6", "Scanner", OTHER_ROW));

    await expect(
      hooks.onBeforeUpdate(updateBy({ address: "10.0.0.6" })),
    ).rejects.toThrow(
      new BadDataException(
        "10.0.0.6 already has a name: Scanner. Change that one instead.",
      ),
    );
  });

  test("an address that is not one is refused", async () => {
    await expect(
      hooks.onBeforeUpdate(updateBy({ address: "scanner.corp" })),
    ).rejects.toThrow(
      new BadDataException(ADDRESS_NAME_ADDRESS_INVALID_MESSAGE),
    );
  });
});
