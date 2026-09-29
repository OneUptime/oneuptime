import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceRoleService from "Common/Server/Services/NetworkDeviceRoleService";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectService from "Common/Server/Services/ProjectService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import BackfillNetworkDeviceRoles from "../../../FeatureSet/Workers/DataMigrations/BackfillNetworkDeviceRoles";

/*
 * Device roles moved from a fixed union stored inline on
 * NetworkDevice.deviceRole to the per-project NetworkDeviceRole lookup table.
 * This migration is the only thing that carries an existing project's
 * assignments across that move, and the deprecated column it reads is dropped
 * by a follow-up PR — so it gets exactly one chance to run correctly against
 * real data, and there is nothing to re-read if it gets it wrong.
 *
 * What is pinned here is the shape of that walk: that it re-queries rather
 * than paginates (the candidate set shrinks underneath it), that it always
 * terminates, that no operator's assignment is silently discarded, and that
 * one bad project or device cannot take the rest of the fleet — or the
 * migrations queued behind it — down with it.
 */

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceRoleService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), addDefaultNetworkDeviceRoles: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const deviceService: { findBy: jest.Mock; updateOneById: jest.Mock } =
  NetworkDeviceService as unknown as {
    findBy: jest.Mock;
    updateOneById: jest.Mock;
  };

const roleService: { findBy: jest.Mock; create: jest.Mock } =
  NetworkDeviceRoleService as unknown as {
    findBy: jest.Mock;
    create: jest.Mock;
  };

const projectService: {
  findBy: jest.Mock;
  addDefaultNetworkDeviceRoles: jest.Mock;
} = ProjectService as unknown as {
  findBy: jest.Mock;
  addDefaultNetworkDeviceRoles: jest.Mock;
};

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const PROJECT_ID: ObjectID = ObjectID.generate();

function makeProject(id: ObjectID = PROJECT_ID): Project {
  const project: Project = new Project(id);
  return project;
}

function makeDevice(legacyRole: string | undefined): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  if (legacyRole !== undefined) {
    device.deviceRole = legacyRole;
  }
  return device;
}

function makeRole(data: {
  key: string;
  order?: number | undefined;
}): NetworkDeviceRole {
  const role: NetworkDeviceRole = new NetworkDeviceRole(ObjectID.generate());
  role.key = data.key;
  if (data.order !== undefined) {
    role.order = data.order;
  }
  return role;
}

/*
 * The migration re-queries the same candidate set every pass, so a plain
 * mockResolvedValue would loop forever. This answers each successive call
 * with the next batch and empties out afterwards, which is what the real
 * query does as devices are backfilled out of "networkDeviceRoleId IS NULL".
 */
function answerDeviceBatches(batches: Array<Array<NetworkDevice>>): void {
  let call: number = 0;
  deviceService.findBy.mockImplementation((): Promise<Array<NetworkDevice>> => {
    const batch: Array<NetworkDevice> = batches[call] || [];
    call++;
    return Promise.resolve(batch);
  });
}

function updatedRoleIdFor(device: NetworkDevice): string | undefined {
  const call: Array<unknown> | undefined =
    deviceService.updateOneById.mock.calls.find(
      (callArgs: Array<unknown>): boolean => {
        return (
          ((callArgs[0] as JSONObject)["id"] as ObjectID).toString() ===
          device.id!.toString()
        );
      },
    );

  if (!call) {
    return undefined;
  }

  return ((call[0] as JSONObject)["data"] as JSONObject)[
    "networkDeviceRoleId"
  ]?.toString();
}

function createdRoles(): Array<NetworkDeviceRole> {
  return roleService.create.mock.calls.map(
    (callArgs: Array<unknown>): NetworkDeviceRole => {
      return (callArgs[0] as JSONObject)["data"] as NetworkDeviceRole;
    },
  );
}

describe("BackfillNetworkDeviceRoles", () => {
  const migration: BackfillNetworkDeviceRoles =
    new BackfillNetworkDeviceRoles();

  beforeEach(() => {
    jest.clearAllMocks();
    projectService.findBy.mockResolvedValue([makeProject()] as never);
    projectService.addDefaultNetworkDeviceRoles.mockResolvedValue(
      undefined as never,
    );
    roleService.findBy.mockResolvedValue([] as never);
    roleService.create.mockImplementation(
      (args: unknown): Promise<NetworkDeviceRole> => {
        const created: NetworkDeviceRole = (args as JSONObject)[
          "data"
        ] as NetworkDeviceRole;
        created._id = ObjectID.generate().toString();
        return Promise.resolve(created);
      },
    );
    answerDeviceBatches([]);
    deviceService.updateOneById.mockResolvedValue(undefined as never);
  });

  describe("the walk itself", () => {
    test("reads every project as root, unpaginated", async () => {
      await migration.migrate();

      expect(projectService.findBy).toHaveBeenCalledTimes(1);
      const args: JSONObject = projectService.findBy.mock
        .calls[0]![0] as JSONObject;

      expect(args["limit"]).toBe(LIMIT_MAX);
      expect(args["skip"]).toBe(0);
      expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    /*
     * The seeder runs before the role index is read. Existing projects
     * predate the table and have no roles at all, so an index read first
     * would be empty and every legacy key would be recreated ad-hoc
     * alongside the defaults the seeder then adds.
     */
    test("seeds the defaults before reading the project's roles", async () => {
      const order: Array<string> = [];
      projectService.addDefaultNetworkDeviceRoles.mockImplementation(
        (): Promise<undefined> => {
          order.push("seed");
          return Promise.resolve(undefined);
        },
      );
      roleService.findBy.mockImplementation(
        (): Promise<Array<NetworkDeviceRole>> => {
          order.push("read-roles");
          return Promise.resolve([]);
        },
      );

      await migration.migrate();

      expect(order).toEqual(["seed", "read-roles"]);
    });

    /*
     * The candidate query is "networkDeviceRoleId IS NULL", which shrinks as
     * devices are backfilled. Paginating with a moving offset would step over
     * rows that moved up, leaving devices behind on a column that is about to
     * be dropped.
     */
    test("re-queries from offset 0 rather than paginating", async () => {
      const first: NetworkDevice = makeDevice("router");
      const second: NetworkDevice = makeDevice("firewall");
      answerDeviceBatches([[first], [second], []]);

      await migration.migrate();

      for (const call of deviceService.findBy.mock.calls) {
        expect((call[0] as JSONObject)["skip"]).toBe(0);
        expect((call[0] as JSONObject)["limit"]).toBe(LIMIT_MAX);
      }
      expect(deviceService.updateOneById).toHaveBeenCalledTimes(2);
    });

    test("scopes the candidate query to the project and to unassigned rows", async () => {
      await migration.migrate();

      const query: JSONObject = (
        deviceService.findBy.mock.calls[0]![0] as JSONObject
      )["query"] as JSONObject;

      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["networkDeviceRoleId"]).toBeDefined();
    });

    /*
     * The deprecated column is the whole point of the migration, so a select
     * that dropped it would read undefined off every row and silently skip
     * the entire fleet.
     */
    test("selects the deprecated column it migrates from", async () => {
      await migration.migrate();

      const select: JSONObject = (
        deviceService.findBy.mock.calls[0]![0] as JSONObject
      )["select"] as JSONObject;

      expect(select["deviceRole"]).toBe(true);
      expect(select["_id"]).toBe(true);
    });

    /*
     * Devices that cannot be backfilled stay in the "IS NULL" result set for
     * good. Without the attempted-id guard the loop would re-read the same
     * unmigratable batch forever and the migration would never return.
     */
    test("terminates on a batch it cannot make progress on", async () => {
      const stuck: NetworkDevice = makeDevice(undefined);
      deviceService.findBy.mockResolvedValue([stuck] as never);

      await migration.migrate();

      expect(deviceService.findBy).toHaveBeenCalledTimes(2);
      expect(deviceService.updateOneById).not.toHaveBeenCalled();
    });

    test("a project with no devices writes nothing", async () => {
      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });
  });

  describe("what counts as an assignment to migrate", () => {
    /*
     * An empty deviceRole is not a gap, it is the normal state: it means "no
     * override — work the role out from the device's SNMP identity". Writing
     * a role row for it would freeze a guess the classifier makes fresh on
     * every poll.
     */
    test("a device with no legacy role is left alone", async () => {
      answerDeviceBatches([[makeDevice(undefined)], []]);

      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
    });

    test("an empty or whitespace legacy role is left alone", async () => {
      answerDeviceBatches([[makeDevice(""), makeDevice("   ")], []]);

      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });

    /*
     * "unknown" was refused as an override by the old column and means the
     * same thing an empty column does. Migrating it would turn "let the
     * classifier decide" into a permanent role named Unknown.
     */
    test('the literal "unknown" is left alone, in any casing', async () => {
      answerDeviceBatches([[makeDevice("unknown"), makeDevice("UNKNOWN")], []]);

      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });

    test("a device with a legacy role is pointed at the matching role row", async () => {
      const router: NetworkDeviceRole = makeRole({ key: "router", order: 1 });
      roleService.findBy.mockResolvedValue([router] as never);

      const device: NetworkDevice = makeDevice("router");
      answerDeviceBatches([[device], []]);

      await migration.migrate();

      expect(updatedRoleIdFor(device)).toBe(router.id!.toString());
      expect(roleService.create).not.toHaveBeenCalled();
    });

    /*
     * The legacy column was free text in practice — imports and the API both
     * wrote to it — so a stored "Router" must land on the seeded "router"
     * rather than creating a second row that renders as its own legend entry.
     */
    test("the match is case- and whitespace-insensitive", async () => {
      const router: NetworkDeviceRole = makeRole({ key: "router", order: 1 });
      roleService.findBy.mockResolvedValue([router] as never);

      const shouty: NetworkDevice = makeDevice("ROUTER");
      const padded: NetworkDevice = makeDevice("  Router  ");
      answerDeviceBatches([[shouty, padded], []]);

      await migration.migrate();

      expect(updatedRoleIdFor(shouty)).toBe(router.id!.toString());
      expect(updatedRoleIdFor(padded)).toBe(router.id!.toString());
      expect(roleService.create).not.toHaveBeenCalled();
    });
  });

  describe("legacy values nothing matches", () => {
    /*
     * A value written by an import or the API rather than the picker, or a
     * seeded role the project deleted. Discarding it would lose the only
     * record of the operator's answer.
     */
    test("an unmatched legacy role gets a role created for it", async () => {
      const device: NetworkDevice = makeDevice("wirelessAccessPoint");
      answerDeviceBatches([[device], []]);

      await migration.migrate();

      expect(roleService.create).toHaveBeenCalledTimes(1);
      expect(createdRoles()[0]!.key).toBe("wirelessaccesspoint");
      expect(updatedRoleIdFor(device)).toBe(createdRoles()[0]!.id!.toString());
    });

    /*
     * isCoreLayer and isSnmpWalkable are load-bearing: the first decides
     * which tier of the topology map a device is drawn in, the second whether
     * it is walked at all. Guessing either from an unrecognised string would
     * move devices between tiers on no evidence.
     */
    test("a recovered role takes the neutral answers, not a guess", async () => {
      answerDeviceBatches([[makeDevice("mysteryBox")], []]);

      await migration.migrate();

      const created: NetworkDeviceRole = createdRoles()[0]!;
      expect(created.isCoreLayer).toBe(false);
      expect(created.isSnmpWalkable).toBe(true);
      expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    });

    /*
     * Two devices carrying the same unmatched string are one role, not two.
     * The index is updated in memory as roles are created, so the second
     * device reuses the row rather than racing the unique constraint.
     */
    test("two devices sharing an unmatched role create one row between them", async () => {
      const first: NetworkDevice = makeDevice("posTerminal");
      const second: NetworkDevice = makeDevice("POSTERMINAL");
      answerDeviceBatches([[first, second], []]);

      await migration.migrate();

      expect(roleService.create).toHaveBeenCalledTimes(1);
      const roleId: string = createdRoles()[0]!.id!.toString();
      expect(updatedRoleIdFor(first)).toBe(roleId);
      expect(updatedRoleIdFor(second)).toBe(roleId);
    });

    /*
     * Order is what the settings list sorts on. A recovered role that reused
     * an existing role's order would sort unstably against it.
     */
    test("recovered roles are ordered after the project's existing roles", async () => {
      roleService.findBy.mockResolvedValue([
        makeRole({ key: "router", order: 4 }),
        makeRole({ key: "switch", order: 9 }),
      ] as never);
      answerDeviceBatches([[makeDevice("alpha"), makeDevice("beta")], []]);

      await migration.migrate();

      const orders: Array<number | undefined> = createdRoles().map(
        (role: NetworkDeviceRole): number | undefined => {
          return role.order;
        },
      );
      expect(orders).toEqual([10, 11]);
    });

    test("a camelCase key is recovered as a sentence-case name", () => {
      expect(
        BackfillNetworkDeviceRoles.nameForLegacyKey("wirelessAccessPoint"),
      ).toBe("Wireless access point");
      expect(BackfillNetworkDeviceRoles.nameForLegacyKey("router")).toBe(
        "Router",
      );
      expect(BackfillNetworkDeviceRoles.nameForLegacyKey("load_balancer")).toBe(
        "Load balancer",
      );
      expect(BackfillNetworkDeviceRoles.nameForLegacyKey("ip-phone")).toBe(
        "Ip phone",
      );
    });

    test("a key that spaces out to nothing is kept verbatim as the name", () => {
      expect(BackfillNetworkDeviceRoles.nameForLegacyKey("-")).toBe("-");
    });
  });

  describe("one failure never takes the fleet, or the migration chain, down", () => {
    /*
     * The migration runner halts the entire chain on the first throw, so a
     * single unreadable project must not freeze every migration queued behind
     * this one.
     */
    test("a project that throws is logged, and the next project still runs", async () => {
      const goodProjectId: ObjectID = ObjectID.generate();
      projectService.findBy.mockResolvedValue([
        makeProject(),
        makeProject(goodProjectId),
      ] as never);

      projectService.addDefaultNetworkDeviceRoles.mockImplementation(
        (project: unknown): Promise<undefined> => {
          if ((project as Project).id!.toString() === PROJECT_ID.toString()) {
            return Promise.reject(new Error("seeder exploded"));
          }
          return Promise.resolve(undefined);
        },
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(mockedLogger.error).toHaveBeenCalled();
      expect(projectService.addDefaultNetworkDeviceRoles).toHaveBeenCalledTimes(
        2,
      );
    });

    test("a device whose write fails is logged, and its neighbours still migrate", async () => {
      const router: NetworkDeviceRole = makeRole({ key: "router", order: 1 });
      roleService.findBy.mockResolvedValue([router] as never);

      const doomed: NetworkDevice = makeDevice("router");
      const fine: NetworkDevice = makeDevice("router");
      answerDeviceBatches([[doomed, fine], []]);

      deviceService.updateOneById.mockImplementation(
        (args: unknown): Promise<undefined> => {
          if (
            ((args as JSONObject)["id"] as ObjectID).toString() ===
            doomed.id!.toString()
          ) {
            return Promise.reject(new Error("write failed"));
          }
          return Promise.resolve(undefined);
        },
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(mockedLogger.error).toHaveBeenCalled();
      expect(updatedRoleIdFor(fine)).toBe(router.id!.toString());
    });

    /*
     * Both the name and the key are unique per project, so project creation
     * running the same seeder — or a user adding the role by hand — can win
     * this race. The device stays unassigned and a re-run picks the row up.
     */
    test("a role create that loses a race leaves the device unassigned, not the migration dead", async () => {
      const device: NetworkDevice = makeDevice("adHocRole");
      answerDeviceBatches([[device], []]);
      roleService.create.mockRejectedValue(new Error("duplicate key") as never);

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(mockedLogger.error).toHaveBeenCalled();
      expect(deviceService.updateOneById).not.toHaveBeenCalled();
    });

    test("a created role with no id is not written onto the device", async () => {
      answerDeviceBatches([[makeDevice("adHocRole")], []]);
      roleService.create.mockImplementation(
        (args: unknown): Promise<NetworkDeviceRole> => {
          return Promise.resolve(
            (args as JSONObject)["data"] as NetworkDeviceRole,
          );
        },
      );

      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("idempotence", () => {
    /*
     * Safe to re-run after a killed pod: everything already backfilled has a
     * non-null networkDeviceRoleId and drops out of the candidate query, so a
     * second pass is a no-op rather than a second set of ad-hoc roles.
     */
    test("a second run over an already-backfilled project writes nothing", async () => {
      roleService.findBy.mockResolvedValue([
        makeRole({ key: "router", order: 1 }),
      ] as never);
      answerDeviceBatches([[]]);

      await migration.migrate();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });

    test("rollback is a no-op — the column it read is still there", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();

      expect(deviceService.updateOneById).not.toHaveBeenCalled();
      expect(roleService.create).not.toHaveBeenCalled();
    });
  });
});
