import NetworkDeviceService, {
  Service as NetworkDeviceServiceType,
} from "../../../Server/Services/NetworkDeviceService";
import { Service as NetworkControllerConnectionServiceType } from "../../../Server/Services/NetworkControllerConnectionService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * The server's half of Meraki as a source of device details, and of
 * Refresh, on the NetworkDevice table:
 *
 *   - the one lookup a read makes for the project's devices the device list
 *     may describe - scoped to the project, never a deleted or archived
 *     device, by serial number (any case), MAC (typed or learned) and
 *     address, and every device the connection described before;
 *   - the controller's reading merged like every other discovered detail,
 *     and only a well-formed one;
 *   - a deleted connection's readings forgotten, in its project only;
 *   - refreshRequestedAt kept by the server alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const READING: JSONObject = {
  provider: "meraki",
  readBy: {
    type: "networkController",
    id: CONNECTION_ID.toString(),
    name: "Acme Retail",
  },
  readAt: "2026-10-28T10:00:00.000Z",
  values: { model: "MS225-48LP", serialNumber: "Q2HP-SWCH-0001" },
};

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

function flat(sql: string): string {
  return sql.split(/\s+/).join(" ").trim();
}

describe("the device list's lookup", () => {
  let query: Mock<QueryFunction>;
  let service: NetworkDeviceServiceType;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
      return [
        {
          _id: DEVICE_ID.toString(),
          name: "Branch 1 core",
          hostname: "10.0.0.2",
          serialNumber: null,
          macAddress: null,
          sysName: null,
          isArchived: false,
          discoveredDetails: null,
          refreshRequestedAt: null,
        },
      ];
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  test("one statement, scoped to the project's live devices, by every key the rules read", async () => {
    const rows: Awaited<
      ReturnType<NetworkDeviceServiceType["findControllerMatchCandidates"]>
    > = await service.findControllerMatchCandidates({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      lookup: {
        serials: ["Q2HP-SWCH-0001"],
        macs: ["88:15:44:aa:00:01"],
        addresses: ["10.0.0.2"],
      },
      limit: 50000,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const sql: string = flat(query.mock.calls[0]![0]);

    expect(sql).toContain('WHERE nd."projectId" = $1');
    expect(sql).toContain('AND nd."deletedAt" IS NULL');
    expect(sql).toContain('AND nd."isArchived" = false');
    expect(sql).toContain('upper(btrim(nd."serialNumber")) = ANY($2::text[])');
    expect(sql).toContain('lower(nd."macAddress") = ANY($3::text[])');
    expect(sql).toContain('nd."hostname" = ANY($4::text[])');
    expect(sql).toContain(
      `(nd."discoveredDetails" -> 'macAddress' ->> 'value') = ANY($3::text[])`,
    );
    expect(sql).toContain(
      `(nd."discoveredDetails" -> 'controller' -> 'readBy' ->> 'id') = $5`,
    );
    expect(sql).toContain("LIMIT $6");
    expect(query.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      ["Q2HP-SWCH-0001"],
      ["88:15:44:aa:00:01"],
      ["10.0.0.2"],
      CONNECTION_ID.toString(),
      50000,
    ]);

    expect(rows).toEqual([
      {
        id: DEVICE_ID.toString(),
        name: "Branch 1 core",
        hostname: "10.0.0.2",
        serialNumber: null,
        macAddress: null,
        sysName: null,
        isArchived: false,
        discoveredDetails: null,
        refreshRequestedAt: null,
      },
    ]);
  });

  test("a limit is a whole number of at least one", async () => {
    await service.findControllerMatchCandidates({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      lookup: { serials: [], macs: [], addresses: [] },
      limit: 0.5,
    });

    expect(query.mock.calls[0]![1][5]).toBe(1);
  });
});

describe("the controller's reading in the merge", () => {
  let query: Mock<QueryFunction>;
  let service: NetworkDeviceServiceType;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
      return [];
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  test("a reading is set and unset like any other entry of the column", async () => {
    await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        { deviceId: DEVICE_ID, set: { controller: READING } },
        {
          deviceId: new ObjectID("33333333-3333-4333-8333-333333333334"),
          unset: ["controller"],
        },
      ],
    });

    const rows: Array<JSONObject> = JSON.parse(
      query.mock.calls[0]![1][0] as string,
    ) as Array<JSONObject>;
    expect(rows).toEqual([
      { id: DEVICE_ID.toString(), set: { controller: READING }, unset: [] },
      {
        id: "33333333-3333-4333-8333-333333333334",
        set: {},
        unset: ["controller"],
      },
    ]);
  });

  test("a forged reading is never written", async () => {
    const sent: number = await service.mergeDiscoveredDetails({
      projectId: PROJECT_ID,
      patches: [
        {
          deviceId: DEVICE_ID,
          set: { controller: { ...READING, provider: "somewhere-else" } },
        },
      ],
    });

    expect(sent).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("a deleted connection's readings are forgotten", () => {
  let query: Mock<QueryFunction>;
  let service: NetworkDeviceServiceType;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new NetworkDeviceServiceType();
    query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
      return [[], 3];
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  test("the reading key comes off the devices that connection described, in its project", async () => {
    const touched: number = await service.forgetControllerReadings({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
    });

    expect(touched).toBe(3);
    const sql: string = flat(query.mock.calls[0]![0]);
    expect(sql).toContain(
      `SET "discoveredDetails" = nd."discoveredDetails" - 'controller'`,
    );
    expect(sql).toContain('WHERE nd."projectId" = $1');
    expect(sql).toContain(
      `AND (nd."discoveredDetails" -> 'controller' -> 'readBy' ->> 'id') = $2`,
    );
    expect(query.mock.calls[0]![1]).toEqual([
      PROJECT_ID.toString(),
      CONNECTION_ID.toString(),
    ]);
  });

  type ConnectionHooks = {
    onBeforeDelete: (
      deleteBy: DeleteBy<NetworkControllerConnection>,
    ) => Promise<OnDelete<NetworkControllerConnection>>;
    onDeleteSuccess: (
      onDelete: OnDelete<NetworkControllerConnection>,
      itemIdsBeforeDelete: Array<ObjectID>,
    ) => Promise<OnDelete<NetworkControllerConnection>>;
  };

  test("the connection service forgets each deleted connection's readings, and only theirs", async () => {
    const connectionService: NetworkControllerConnectionServiceType =
      new NetworkControllerConnectionServiceType();
    const hooks: ConnectionHooks =
      connectionService as unknown as ConnectionHooks;

    const deleted: NetworkControllerConnection =
      new NetworkControllerConnection();
    deleted.id = CONNECTION_ID;
    deleted.projectId = PROJECT_ID;
    const kept: NetworkControllerConnection = new NetworkControllerConnection();
    kept.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    kept.projectId = PROJECT_ID;

    /*
     * The connections are read as the delete reads them, and the delete
     * held to them (DeleteChecksReadHeldRows): never with a query of the
     * hook's own.
     */
    const held: SpyInstance<
      typeof connectionService.findRowsAndHoldDeleteToThem
    > = jest
      .spyOn(connectionService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([deleted, kept] as never);
    const findBy: SpyInstance<typeof connectionService.findBy> = jest.spyOn(
      connectionService,
      "findBy",
    );
    const forget: SpyInstance<
      typeof NetworkDeviceService.forgetControllerReadings
    > = jest
      .spyOn(NetworkDeviceService, "forgetControllerReadings")
      .mockResolvedValue(2);

    const deleteBy: DeleteBy<NetworkControllerConnection> = {
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    } as unknown as DeleteBy<NetworkControllerConnection>;
    const onDelete: OnDelete<NetworkControllerConnection> =
      await hooks.onBeforeDelete(deleteBy);

    expect(held).toHaveBeenCalledTimes(1);
    expect(held).toHaveBeenCalledWith(deleteBy, {
      _id: true,
      projectId: true,
    });
    expect(findBy).not.toHaveBeenCalled();

    await hooks.onDeleteSuccess(onDelete, [CONNECTION_ID]);

    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
    });
  });

  test("a failure to forget never undoes the delete", async () => {
    const connectionService: NetworkControllerConnectionServiceType =
      new NetworkControllerConnectionServiceType();
    const hooks: ConnectionHooks =
      connectionService as unknown as ConnectionHooks;

    jest
      .spyOn(NetworkDeviceService, "forgetControllerReadings")
      .mockRejectedValue(new Error("Postgres is not answering"));

    await expect(
      hooks.onDeleteSuccess(
        {
          deleteBy: {} as DeleteBy<NetworkControllerConnection>,
          carryForward: {
            connections: [{ id: CONNECTION_ID, projectId: PROJECT_ID }],
          },
        },
        [CONNECTION_ID],
      ),
    ).resolves.toBeDefined();
  });
});

describe("refreshRequestedAt", () => {
  test("is kept by the server alone: nobody creates or updates it through the API", () => {
    const column: {
      create: Array<unknown>;
      update: Array<unknown>;
      read: Array<unknown>;
    } = new NetworkDevice().getColumnAccessControlFor(
      "refreshRequestedAt",
    ) as never;

    expect(column.create).toEqual([]);
    expect(column.update).toEqual([]);
    expect(column.read.length).toBeGreaterThan(0);
  });
});
