import Model from "../../../Models/DatabaseModels/IoTDeviceCredential";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * IoTDeviceCredential is an MQTT password. The broker authenticates a device
 * CONNECT against it and then trusts the (fleet, device) identity it returns
 * to scope everything that device is allowed to publish. Three of the service's
 * rules are the only thing standing between that and a cross-tenant forgery,
 * and none of them can be expressed in Postgres:
 *
 *   1. THE SECRET IS ALWAYS SERVER-GENERATED. secretKey is a computed column
 *      (create ACL []), and the create-permission check SKIPS computed columns
 *      rather than stripping them - so a client-supplied secretKey would
 *      survive verbatim. A device whose password was chosen by whoever
 *      registered it is a device whose password is guessable, which defeats
 *      the entire point of the column.
 *
 *   2. THE FLEET MUST BELONG TO THE CALLER'S PROJECT. projectId is forced by
 *      the framework; the iotFleetId RELATION is not. Attaching a credential
 *      to another tenant's fleet mints an auth context for that tenant and
 *      lets the credential steer that fleet's inventory cleanup.
 *
 *   3. THE DUPLICATE GUARD IS BYTE-EXACT. device.id labels are matched
 *      byte-exact, and the DB unique index is case-sensitive, so the service
 *      check must be too - case-insensitive would reject two legitimately
 *      distinct device ids that differ only in case.
 *
 * The rest of the file pins revocation and the two hot paths, which fail
 * quietly rather than loudly:
 *
 *   - REVOCATION LAG. Disabling or deleting a credential only reaches the
 *     broker when the in-process context cache is dropped. Every write hook
 *     clears it, and update/delete clear it AGAIN on success - the
 *     before-hook clear races a concurrent read that could re-cache the
 *     pre-revocation row before the write lands.
 *
 *   - markConnected FAILS OPEN. It throttles a heartbeat write through Redis.
 *     If Redis is unreachable the write must still happen, because
 *     lastConnectedAt is the registry UI's liveness column - a Redis blip
 *     must not make every device look dead.
 *
 *   - THE EXPECTED-DEVICE SET IS ENABLED-ONLY AND VERBATIM. It feeds
 *     absent-series injection in IoT Device monitor evaluation, so a revoked
 *     device must drop out of it (its silent-death alerting pauses) and an id
 *     must never be canonicalized on the way through.
 *
 * Nothing here touches Postgres or Redis: the hooks and public methods are
 * driven directly on a fresh service instance whose reads and writes are
 * stubbed.
 */

const CREDENTIAL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const FLEET_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_FLEET_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

/*
 * Typed loosely on purpose, and in one place: jest.fn()'s Mock and
 * jest.spyOn()'s SpiedFunction each disagree with this repo's @types/jest
 * about whether mock.lastCall is optional, so the narrow generic forms do not
 * assign. Nothing below needs more than these members, and `unknown`
 * arguments keep every call site free of a cast.
 */
type MockLike = {
  mockReset: () => void;
  mockResolvedValue: (value: unknown) => unknown;
  mockRejectedValue: (value: unknown) => unknown;
  mockResolvedValueOnce: (value: unknown) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

const findOneFleetById: MockLike = jest.fn() as unknown as MockLike;

jest.mock("../../../Server/Services/IoTFleetService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: findOneFleetById,
    },
  };
});

const cacheGetString: MockLike = jest.fn() as unknown as MockLike;
const cacheSetString: MockLike = jest.fn() as unknown as MockLike;

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: cacheGetString,
      setString: cacheSetString,
    },
  };
});

/*
 * Imported after the mocks above are registered: the service captures
 * IoTFleetService and GlobalCache at module load.
 */
import {
  IoTDeviceCredentialContext,
  Service as IoTDeviceCredentialServiceType,
} from "../../../Server/Services/IoTDeviceCredentialService";

/*
 * The protected hooks and the private cache, reachable for the test. Driving
 * the real hooks is the point - the rules live in them, and an API-layer
 * permission check is not what an internal caller meets.
 */
type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
  onBeforeDelete: (deleteBy: DeleteBy<Model>) => Promise<OnDelete<Model>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<Model>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<Model>>;
  onDeleteSuccess: (
    onDelete: OnDelete<Model>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<Model>>;
  contextCache: {
    size: () => number;
    set: (
      key: string,
      value: IoTDeviceCredentialContext | null,
      ttlMs: number,
    ) => void;
  };
};

/* The spies use the same loose shape; see MockLike above. */
type Spy = MockLike;

interface Harness {
  service: IoTDeviceCredentialServiceType;
  internals: ServiceInternals;
  findOneBy: Spy;
  findBy: Spy;
  countBy: Spy;
  updateWithoutHooks: Spy;
}

function buildService(): Harness {
  const service: IoTDeviceCredentialServiceType =
    new IoTDeviceCredentialServiceType();

  const findOneBy: Spy = jest.spyOn(service, "findOneBy") as unknown as Spy;
  findOneBy.mockResolvedValue(null);

  const findBy: Spy = jest.spyOn(service, "findBy") as unknown as Spy;
  findBy.mockResolvedValue([]);

  const countBy: Spy = jest.spyOn(service, "countBy") as unknown as Spy;
  countBy.mockResolvedValue(new PositiveNumber(0));

  const updateWithoutHooks: Spy = jest.spyOn(
    service,
    "updateColumnsByIdWithoutHooks",
  ) as unknown as Spy;
  updateWithoutHooks.mockResolvedValue(undefined);

  return {
    service: service,
    internals: service as unknown as ServiceInternals,
    findOneBy: findOneBy,
    findBy: findBy,
    countBy: countBy,
    updateWithoutHooks: updateWithoutHooks,
  };
}

/*
 * A model instance, which is what the API layer hands the service: every
 * declared column is an own property on it, so this is the shape the hook's
 * guards actually meet.
 */
function createByModel(payload: Record<string, unknown>): CreateBy<Model> {
  return {
    data: Object.assign(new Model(), payload) as Model,
    props: { isRoot: true, tenantId: PROJECT_ID },
  };
}

function fleetIn(projectId: ObjectID, id: ObjectID = FLEET_ID): IoTFleet {
  const fleet: IoTFleet = new IoTFleet(id);
  fleet.projectId = projectId;
  return fleet;
}

function credentialRow(overrides: Record<string, unknown> = {}): Model {
  const row: Model = new Model(CREDENTIAL_ID);
  const fleet: IoTFleet = new IoTFleet(FLEET_ID);
  fleet.name = "roof-sensors";

  return Object.assign(
    row,
    {
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      externalId: "Device-01",
      secretKey: new ObjectID("66666666-6666-4666-8666-666666666666"),
      isEnabled: true,
      iotFleet: fleet,
    },
    overrides,
  ) as Model;
}

function writtenValues(createBy: CreateBy<Model>): Record<string, unknown> {
  return createBy.data as unknown as Record<string, unknown>;
}

function lastCall(spy: Spy): Record<string, unknown> {
  const calls: Array<Array<unknown>> = spy.mock.calls;

  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  jest.restoreAllMocks();
  findOneFleetById.mockReset();
  findOneFleetById.mockResolvedValue(fleetIn(PROJECT_ID));
  cacheGetString.mockReset();
  cacheGetString.mockResolvedValue(null);
  cacheSetString.mockReset();
  cacheSetString.mockResolvedValue(undefined);
});

describe("the device secret is always server-generated", () => {
  test("a create with no secret gets one", async () => {
    const harness: Harness = buildService();
    const createBy: CreateBy<Model> = createByModel({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      externalId: "Device-01",
    });

    await harness.internals.onBeforeCreate(createBy);

    expect(writtenValues(createBy)["secretKey"]).toBeInstanceOf(ObjectID);
  });

  test("a client-supplied secret is overwritten, not honoured", async () => {
    /*
     * The rule this whole column depends on. secretKey is computed, and the
     * create-permission check skips computed columns instead of stripping
     * them, so without this assignment the value below would be the device's
     * MQTT password - chosen by the caller, and therefore guessable.
     */
    const harness: Harness = buildService();
    const planted: string = "00000000-0000-4000-8000-00000000dead";
    const createBy: CreateBy<Model> = createByModel({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
      externalId: "Device-01",
      secretKey: new ObjectID(planted),
    });

    await harness.internals.onBeforeCreate(createBy);

    expect(String(writtenValues(createBy)["secretKey"])).not.toBe(planted);
  });

  test("two devices never share a secret", async () => {
    const harness: Harness = buildService();
    const secrets: Array<string> = [];

    for (const externalId of ["Device-01", "Device-02"]) {
      const createBy: CreateBy<Model> = createByModel({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
        externalId: externalId,
      });

      await harness.internals.onBeforeCreate(createBy);
      secrets.push(String(writtenValues(createBy)["secretKey"]));
    }

    expect(new Set(secrets).size).toBe(2);
  });
});

describe("a credential cannot be attached to another project's fleet", () => {
  test("a fleet in another project is refused", async () => {
    const harness: Harness = buildService();
    findOneFleetById.mockResolvedValue(fleetIn(OTHER_PROJECT_ID));

    await expect(
      harness.internals.onBeforeCreate(
        createByModel({
          projectId: PROJECT_ID,
          iotFleetId: FLEET_ID,
          externalId: "Device-01",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("a fleet that does not exist is refused", async () => {
    const harness: Harness = buildService();
    findOneFleetById.mockResolvedValue(null);

    await expect(
      harness.internals.onBeforeCreate(
        createByModel({
          projectId: PROJECT_ID,
          iotFleetId: FLEET_ID,
          externalId: "Device-01",
        }),
      ),
    ).rejects.toThrow("IoT Fleet not found in this project.");
  });

  test("a fleet with no project at all is refused", async () => {
    /*
     * A row read back without projectId must not compare equal to anything.
     * `undefined.toString()` would throw rather than refuse, so the guard has
     * to test the field before comparing.
     */
    const harness: Harness = buildService();
    findOneFleetById.mockResolvedValue(new IoTFleet(FLEET_ID));

    await expect(
      harness.internals.onBeforeCreate(
        createByModel({
          projectId: PROJECT_ID,
          iotFleetId: FLEET_ID,
          externalId: "Device-01",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("a fleet in the caller's project is allowed through", async () => {
    const harness: Harness = buildService();

    const result: OnCreate<Model> = await harness.internals.onBeforeCreate(
      createByModel({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
        externalId: "Device-01",
      }),
    );

    expect(result.createBy).toBeDefined();
  });

  test("the fleet is looked up by the id the caller asked for, as root", async () => {
    /*
     * Read as root deliberately: the check must see a fleet that the caller
     * cannot read, or a caller with no read permission on another tenant's
     * fleet would get "not found" turned into a successful attach.
     */
    const harness: Harness = buildService();

    await harness.internals.onBeforeCreate(
      createByModel({
        projectId: PROJECT_ID,
        iotFleetId: OTHER_FLEET_ID,
        externalId: "Device-01",
      }),
    );

    const call: Record<string, unknown> = findOneFleetById.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(String(call["id"])).toBe(OTHER_FLEET_ID.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });
});

describe("a device id is unique within its fleet, byte-exact", () => {
  test("a second registration of the same id is refused", async () => {
    const harness: Harness = buildService();
    harness.countBy.mockResolvedValue(new PositiveNumber(1));

    await expect(
      harness.internals.onBeforeCreate(
        createByModel({
          projectId: PROJECT_ID,
          iotFleetId: FLEET_ID,
          externalId: "Device-01",
        }),
      ),
    ).rejects.toThrow(
      "A device with this Device ID is already registered in this fleet.",
    );
  });

  test("the duplicate query is scoped to the project AND the fleet", async () => {
    /*
     * The same device id in a different fleet, or a different project, is a
     * different device. Dropping either column from the query would refuse a
     * legitimate registration.
     */
    const harness: Harness = buildService();

    await harness.internals.onBeforeCreate(
      createByModel({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
        externalId: "Device-01",
      }),
    );

    const query: Record<string, unknown> = lastCall(harness.countBy)[
      "query"
    ] as Record<string, unknown>;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["iotFleetId"])).toBe(FLEET_ID.toString());
  });

  test("the id is matched verbatim, so case is significant", async () => {
    /*
     * device.id labels are matched byte-exact and the DB unique index is
     * case-sensitive. A lowercased or trimmed query here would reject
     * "Device-01" as a duplicate of "device-01", which are two real devices.
     */
    const harness: Harness = buildService();

    await harness.internals.onBeforeCreate(
      createByModel({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
        externalId: "  Device-01  ",
      }),
    );

    const query: Record<string, unknown> = lastCall(harness.countBy)[
      "query"
    ] as Record<string, unknown>;

    expect(query["externalId"]).toBe("  Device-01  ");
  });

  test("no duplicate check is attempted without a device id", async () => {
    // Nothing to compare: the column's own validation refuses it later.
    const harness: Harness = buildService();

    await harness.internals.onBeforeCreate(
      createByModel({ projectId: PROJECT_ID, iotFleetId: FLEET_ID }),
    );

    expect(harness.countBy.mock.calls).toHaveLength(0);
  });
});

describe("resolving a credential to an auth context", () => {
  test("a complete, enabled credential resolves", async () => {
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(credentialRow());

    const context: IoTDeviceCredentialContext | null =
      await harness.service.getCredentialContext(CREDENTIAL_ID.toString());

    expect(context).toEqual({
      credentialId: CREDENTIAL_ID.toString(),
      projectId: PROJECT_ID.toString(),
      iotFleetId: FLEET_ID.toString(),
      fleetName: "roof-sensors",
      externalId: "Device-01",
      secretKey: "66666666-6666-4666-8666-666666666666",
    });
  });

  test("the secret is returned for the CALLER to compare, not compared here", async () => {
    /*
     * This method authenticates nothing. The broker compares the presented
     * MQTT password against context.secretKey - so a context that omitted the
     * secret would make every device unauthenticatable, and one that resolved
     * without it would be worse.
     */
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(credentialRow());

    const context: IoTDeviceCredentialContext | null =
      await harness.service.getCredentialContext(CREDENTIAL_ID.toString());

    expect(context?.secretKey).toBe("66666666-6666-4666-8666-666666666666");
  });

  test("an unknown credential resolves to null", async () => {
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(null);

    await expect(
      harness.service.getCredentialContext(CREDENTIAL_ID.toString()),
    ).resolves.toBeNull();
  });

  test("a DISABLED credential resolves to null", async () => {
    // This is revocation-by-toggle: the broker must stop accepting it.
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(credentialRow({ isEnabled: false }));

    await expect(
      harness.service.getCredentialContext(CREDENTIAL_ID.toString()),
    ).resolves.toBeNull();
  });

  test.each([
    ["no project", { projectId: undefined }],
    ["no fleet", { iotFleetId: undefined }],
    ["no device id", { externalId: undefined }],
    ["no secret", { secretKey: undefined }],
    ["no fleet name", { iotFleet: undefined }],
  ])(
    "a credential with %s resolves to null",
    async (
      _label: string,
      overrides: Record<string, unknown>,
    ): Promise<void> => {
      /*
       * A half-populated row must not produce a context: every field feeds the
       * topic scope the broker then trusts, and an undefined one would widen it.
       */
      const harness: Harness = buildService();
      harness.findOneBy.mockResolvedValue(credentialRow(overrides));

      await expect(
        harness.service.getCredentialContext(CREDENTIAL_ID.toString()),
      ).resolves.toBeNull();
    },
  );

  test("a malformed credential id never reaches the database", async () => {
    /*
     * The id arrives from an MQTT username, so it is attacker-controlled. A
     * flood of garbage usernames must not become a flood of queries.
     */
    const harness: Harness = buildService();

    await expect(
      harness.service.getCredentialContext("not-a-uuid"),
    ).resolves.toBeNull();
    expect(harness.findOneBy.mock.calls).toHaveLength(0);
  });

  test("a resolved credential is cached, so the hot path reads once", async () => {
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(credentialRow());

    await harness.service.getCredentialContext(CREDENTIAL_ID.toString());
    await harness.service.getCredentialContext(CREDENTIAL_ID.toString());

    expect(harness.findOneBy.mock.calls).toHaveLength(1);
  });

  test("a MISS is cached too, so invalid credentials cannot flood Postgres", async () => {
    const harness: Harness = buildService();
    harness.findOneBy.mockResolvedValue(null);

    await harness.service.getCredentialContext(CREDENTIAL_ID.toString());
    await harness.service.getCredentialContext(CREDENTIAL_ID.toString());

    expect(harness.findOneBy.mock.calls).toHaveLength(1);
  });
});

describe("revocation reaches the broker", () => {
  /*
   * The cache is what makes revocation lag, so every write path drops it.
   * Update and delete drop it TWICE - the before-hook clear races a concurrent
   * getCredentialContext that could re-cache the pre-revocation row before the
   * write commits, and the on-success clear is what closes that window.
   */
  function seededService(): Harness {
    const harness: Harness = buildService();
    harness.internals.contextCache.set(CREDENTIAL_ID.toString(), null, 60_000);
    expect(harness.internals.contextCache.size()).toBe(1);
    return harness;
  }

  test("onBeforeUpdate clears the cache", async () => {
    const harness: Harness = seededService();

    await harness.internals.onBeforeUpdate({
      query: {},
      data: {},
    } as unknown as UpdateBy<Model>);

    expect(harness.internals.contextCache.size()).toBe(0);
  });

  test("onUpdateSuccess clears the cache again, after the write commits", async () => {
    const harness: Harness = seededService();

    await harness.internals.onUpdateSuccess(
      {
        updateBy: { query: {}, data: {} },
        carryForward: null,
      } as unknown as OnUpdate<Model>,
      [CREDENTIAL_ID],
    );

    expect(harness.internals.contextCache.size()).toBe(0);
  });

  test("onBeforeDelete clears the cache", async () => {
    const harness: Harness = seededService();

    await harness.internals.onBeforeDelete({
      query: {},
    } as unknown as DeleteBy<Model>);

    expect(harness.internals.contextCache.size()).toBe(0);
  });

  test("onDeleteSuccess clears the cache again", async () => {
    const harness: Harness = seededService();

    await harness.internals.onDeleteSuccess(
      {
        deleteBy: { query: {} },
        carryForward: null,
      } as unknown as OnDelete<Model>,
      [CREDENTIAL_ID],
    );

    expect(harness.internals.contextCache.size()).toBe(0);
  });
});

describe("the lastConnectedAt heartbeat is throttled but never skipped", () => {
  test("a first connect stamps lastConnectedAt", async () => {
    const harness: Harness = buildService();

    await harness.service.markConnected(CREDENTIAL_ID);

    const call: Record<string, unknown> = lastCall(harness.updateWithoutHooks);
    const data: Record<string, unknown> = call["data"] as Record<
      string,
      unknown
    >;

    expect(String(call["id"])).toBe(CREDENTIAL_ID.toString());
    expect(data["lastConnectedAt"]).toBeInstanceOf(Date);
  });

  test("a reconnect inside the throttle window writes nothing", async () => {
    // Connect storms must not turn into a write per CONNECT on a hot row.
    const harness: Harness = buildService();
    cacheGetString.mockResolvedValue("1");

    await harness.service.markConnected(CREDENTIAL_ID);

    expect(harness.updateWithoutHooks.mock.calls).toHaveLength(0);
  });

  test("the throttle key is set to expire, so the stamp resumes", async () => {
    /*
     * A throttle key with no expiry would stop lastConnectedAt updating for
     * the lifetime of the Redis key - the liveness column would freeze at the
     * device's first connect.
     */
    const harness: Harness = buildService();

    await harness.service.markConnected(CREDENTIAL_ID);

    const options: Record<string, unknown> = cacheSetString.mock
      .calls[0]![3] as Record<string, unknown>;

    expect(options["expiresInSeconds"]).toBeGreaterThan(0);
  });

  test("an unreachable Redis FAILS OPEN and the stamp still happens", async () => {
    /*
     * The throttle is an optimisation; lastConnectedAt is the UI's liveness
     * column. Treating a Redis error as "already stamped" would make every
     * device look dead for as long as Redis was down.
     */
    const harness: Harness = buildService();
    cacheGetString.mockRejectedValue(new Error("redis down"));

    await harness.service.markConnected(CREDENTIAL_ID);

    expect(harness.updateWithoutHooks.mock.calls).toHaveLength(1);
  });

  test("a failed throttle WRITE does not lose the stamp either", async () => {
    const harness: Harness = buildService();
    cacheSetString.mockRejectedValue(new Error("redis down"));

    await harness.service.markConnected(CREDENTIAL_ID);

    expect(harness.updateWithoutHooks.mock.calls).toHaveLength(1);
  });

  test("the stamp is a no-hooks update, so it cannot convoy on hooks", async () => {
    /*
     * Pinned by which method is called: a heartbeat going through the normal
     * update path would run every hook and bump the row version on each
     * CONNECT, which is the lock convoy this avoids.
     */
    const harness: Harness = buildService();
    const withHooks: Spy = jest.spyOn(
      harness.service,
      "updateOneById",
    ) as unknown as Spy;
    withHooks.mockResolvedValue(undefined);

    await harness.service.markConnected(CREDENTIAL_ID);

    expect(harness.updateWithoutHooks.mock.calls).toHaveLength(1);
    expect(withHooks.mock.calls).toHaveLength(0);
  });
});

describe("the expected-device set for a fleet", () => {
  function enabledRows(ids: Array<string | undefined>): Array<Model> {
    return ids.map((externalId: string | undefined): Model => {
      const row: Model = new Model();
      /*
       * Assigned through the record rather than the property: externalId is
       * deliberately `string | undefined` here - a row that came back without
       * one is the case under test - and exactOptionalPropertyTypes refuses
       * `undefined` on an optional property.
       */
      (row as unknown as Record<string, unknown>)["externalId"] = externalId;
      return row;
    });
  }

  test("only ENABLED devices are expected", async () => {
    /*
     * A revoked device stays in the inventory as Offline (stale cleanup keeps
     * its row) but must leave this set, or its silent-death alerting would
     * keep firing against a device that was deliberately turned off.
     */
    const harness: Harness = buildService();

    await harness.service.getExpectedDeviceExternalIds({
      projectId: PROJECT_ID,
      iotFleetId: FLEET_ID,
    });

    const query: Record<string, unknown> = lastCall(harness.findBy)[
      "query"
    ] as Record<string, unknown>;

    expect(query["isEnabled"]).toBe(true);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["iotFleetId"])).toBe(FLEET_ID.toString());
  });

  test("ids come back VERBATIM, never canonicalized", async () => {
    /*
     * These are matched byte-exact against the device.id resource attribute.
     * Trimming or lowercasing here would silently stop matching the device
     * that is actually reporting.
     */
    const harness: Harness = buildService();
    harness.findBy.mockResolvedValue(
      enabledRows(["Device-01", "device-01", " padded "]),
    );

    await expect(
      harness.service.getExpectedDeviceExternalIds({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
      }),
    ).resolves.toEqual(["Device-01", "device-01", " padded "]);
  });

  test("a row with no device id is skipped rather than producing a blank", async () => {
    /*
     * A blank id in this set would inject an absent-series for a device that
     * can never report, which alerts forever.
     */
    const harness: Harness = buildService();
    harness.findBy.mockResolvedValue(
      enabledRows(["Device-01", undefined, "Device-02"]),
    );

    await expect(
      harness.service.getExpectedDeviceExternalIds({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
      }),
    ).resolves.toEqual(["Device-01", "Device-02"]);
  });

  test("a fleet with no registered devices is an empty set, not an error", async () => {
    const harness: Harness = buildService();
    harness.findBy.mockResolvedValue([]);

    await expect(
      harness.service.getExpectedDeviceExternalIds({
        projectId: PROJECT_ID,
        iotFleetId: FLEET_ID,
      }),
    ).resolves.toEqual([]);
  });
});
