import AlertService from "../../../Server/Services/AlertService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Alert from "../../../Models/DatabaseModels/Alert";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An alert's monitor can be set, changed or cleared after the alert is
 * created (the dashboard's Affected Resources card, the API, a workflow),
 * except on an alert raised automatically that has a monitor: that monitor
 * finds its open alerts by monitor, dedupes new breaches against them and
 * resolves them when it recovers. Moved or cleared, such an alert would stay
 * open forever and the monitor would raise a duplicate.
 *
 * These tests drive the real AlertService.onBeforeUpdate against a stubbed
 * alert table (AlertService.findBy). Reference validation and custom field
 * mapping are stubbed: they are covered elsewhere and would otherwise need a
 * database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const ALERT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const SECOND_ALERT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a2";
const OLD_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const NEW_MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b2";
const USER_ID: ObjectID = new ObjectID("0193c0de-eeee-4aaa-8bbb-0000000000c1");

const LOCKED_MONITOR: RegExp =
  /raised automatically by its monitor, so its monitor cannot be changed or removed/;

type OnBeforeUpdate = (updateBy: UpdateBy<Alert>) => Promise<OnUpdate<Alert>>;

interface MonitorChangeShape {
  oldMonitorId: ObjectID | null;
  newMonitorId: ObjectID | null;
}

interface CarryForwardShape {
  monitorChanges: Record<string, MonitorChangeShape>;
}

interface StoredAlertSpec {
  id?: string | undefined;
  isCreatedAutomatically: boolean;
  monitorId: string | null;
}

function storedAlert(spec: StoredAlertSpec): Alert {
  const alert: Alert = new Alert();
  alert._id = spec.id || ALERT_ID;
  alert.projectId = PROJECT_ID;
  alert.isCreatedAutomatically = spec.isCreatedAutomatically;

  if (spec.monitorId) {
    alert.monitorId = new ObjectID(spec.monitorId);
  }

  return alert;
}

// A project member editing the alert from the dashboard, unless a test says so.
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

function runBeforeUpdate(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
  query: JSONObject = { _id: ALERT_ID },
): Promise<OnUpdate<Alert>> {
  return (
    AlertService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: query,
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<Alert>);
}

async function monitorChangesOf(
  data: JSONObject,
  props?: DatabaseCommonInteractionProps,
): Promise<Record<string, MonitorChangeShape>> {
  const onUpdate: OnUpdate<Alert> = await runBeforeUpdate(data, props);

  return (onUpdate.carryForward as CarryForwardShape).monitorChanges;
}

function idOf(value: ObjectID | null | undefined): string | null {
  return value ? value.toString() : null;
}

let stored: Array<Alert> = [];
let findBy: jest.SpyInstance;
let validateReferences: jest.SpyInstance;
let applyMappings: jest.SpyInstance;

beforeEach(() => {
  stored = [
    storedAlert({ isCreatedAutomatically: true, monitorId: OLD_MONITOR_ID }),
  ];

  findBy = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation((async (): Promise<Array<Alert>> => {
      return stored;
    }) as never);

  validateReferences = jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);

  applyMappings = jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AlertService.onBeforeUpdate: an automatic alert's monitor is locked", () => {
  test.each([
    ["the monitorId column", { monitorId: NEW_MONITOR_ID }],
    ["the relation object", { monitor: { _id: NEW_MONITOR_ID } }],
    ["an ObjectID", { monitorId: new ObjectID(NEW_MONITOR_ID) }],
    [
      "a Monitor instance",
      { monitor: new Monitor(new ObjectID(NEW_MONITOR_ID)) },
    ],
  ])(
    "refuses to move it to another monitor through %s",
    async (_label: string, data: JSONObject) => {
      await expect(runBeforeUpdate(data)).rejects.toThrow(LOCKED_MONITOR);
    },
  );

  test.each([
    ["monitorId: null", { monitorId: null }],
    ["monitor: null", { monitor: null }],
    ["an empty monitorId", { monitorId: "" }],
    [
      "both spellings cleared",
      {
        monitorId: null,
        monitor: null,
      },
    ],
  ])(
    "refuses to clear it with %s",
    async (_label: string, data: JSONObject) => {
      await expect(runBeforeUpdate(data)).rejects.toThrow(LOCKED_MONITOR);
    },
  );

  test("the refusal is a 400 with the reason, raised before anything else runs", async () => {
    let error: unknown = null;

    try {
      await runBeforeUpdate({
        title: "Renamed",
        monitor: { _id: NEW_MONITOR_ID },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "That monitor resolves the alert when it recovers",
    );
    // Nothing downstream of the guard spent a query on a refused write.
    expect(validateReferences).not.toHaveBeenCalled();
    expect(applyMappings).not.toHaveBeenCalled();
  });

  test.each([
    ["the same id string", { monitorId: OLD_MONITOR_ID }],
    ["the same id in upper case", { monitorId: OLD_MONITOR_ID.toUpperCase() }],
    ["the same ObjectID", { monitorId: new ObjectID(OLD_MONITOR_ID) }],
    ["the same relation object", { monitor: { _id: OLD_MONITOR_ID } }],
    [
      "both spellings, agreeing",
      {
        monitorId: OLD_MONITOR_ID,
        monitor: { _id: OLD_MONITOR_ID },
      },
    ],
  ])(
    "re-saving the monitor it already has, as %s, is allowed and changes nothing",
    async (_label: string, data: JSONObject) => {
      expect(await monitorChangesOf(data)).toEqual({});
    },
  );

  test("saving the rest of the card with the monitor untouched is allowed", async () => {
    // What the Affected Resources modal sends when only a host was added.
    const changes: Record<string, MonitorChangeShape> = await monitorChangesOf({
      monitor: { _id: OLD_MONITOR_ID },
      hosts: [{ _id: "0193c0de-eeee-4aaa-8bbb-0000000000d1" }],
      services: [],
    });

    expect(changes).toEqual({});
  });

  test("an automatic alert without a monitor (an SLO burn-rate alert) can be given one", async () => {
    stored = [storedAlert({ isCreatedAutomatically: true, monitorId: null })];

    const changes: Record<string, MonitorChangeShape> = await monitorChangesOf({
      monitor: { _id: NEW_MONITOR_ID },
    });

    expect(Object.keys(changes)).toEqual([ALERT_ID]);
    expect(idOf(changes[ALERT_ID]!.oldMonitorId)).toBeNull();
    expect(idOf(changes[ALERT_ID]!.newMonitorId)).toBe(NEW_MONITOR_ID);
  });

  test("an automatic alert without a monitor may be saved with none", async () => {
    stored = [storedAlert({ isCreatedAutomatically: true, monitorId: null })];

    expect(await monitorChangesOf({ monitor: null })).toEqual({});
  });

  test("a payload that spells the monitor two different ways is refused", async () => {
    stored = [storedAlert({ isCreatedAutomatically: false, monitorId: null })];

    await expect(
      runBeforeUpdate({
        monitorId: OLD_MONITOR_ID,
        monitor: { _id: NEW_MONITOR_ID },
      }),
    ).rejects.toThrow("Conflicting Monitor references were provided.");

    // One spelling set, the other cleared, is just as ambiguous.
    await expect(
      runBeforeUpdate({
        monitorId: NEW_MONITOR_ID,
        monitor: null,
      }),
    ).rejects.toThrow("Conflicting Monitor references were provided.");
  });
});

describe("AlertService.onBeforeUpdate: a manual alert's monitor is editable", () => {
  beforeEach(() => {
    stored = [
      storedAlert({ isCreatedAutomatically: false, monitorId: OLD_MONITOR_ID }),
    ];
  });

  test.each([
    ["the monitorId column", { monitorId: NEW_MONITOR_ID }],
    ["the relation object", { monitor: { _id: NEW_MONITOR_ID } }],
    ["an ObjectID", { monitorId: new ObjectID(NEW_MONITOR_ID) }],
  ])(
    "moves to another monitor through %s, and the move is carried forward",
    async (_label: string, data: JSONObject) => {
      const changes: Record<string, MonitorChangeShape> =
        await monitorChangesOf(data);

      expect(Object.keys(changes)).toEqual([ALERT_ID]);
      expect(idOf(changes[ALERT_ID]!.oldMonitorId)).toBe(OLD_MONITOR_ID);
      expect(idOf(changes[ALERT_ID]!.newMonitorId)).toBe(NEW_MONITOR_ID);
    },
  );

  test.each([
    ["monitorId: null", { monitorId: null }],
    ["monitor: null", { monitor: null }],
  ])("can be cleared with %s", async (_label: string, data: JSONObject) => {
    const changes: Record<string, MonitorChangeShape> =
      await monitorChangesOf(data);

    expect(idOf(changes[ALERT_ID]!.oldMonitorId)).toBe(OLD_MONITOR_ID);
    expect(changes[ALERT_ID]!.newMonitorId).toBeNull();
  });

  test("a manual alert without a monitor can be given one", async () => {
    stored = [storedAlert({ isCreatedAutomatically: false, monitorId: null })];

    const changes: Record<string, MonitorChangeShape> = await monitorChangesOf({
      monitorId: NEW_MONITOR_ID,
    });

    expect(changes[ALERT_ID]!.oldMonitorId).toBeNull();
    expect(idOf(changes[ALERT_ID]!.newMonitorId)).toBe(NEW_MONITOR_ID);
  });

  test("the new monitor is still checked against the alert's project", async () => {
    await runBeforeUpdate({ monitor: { _id: NEW_MONITOR_ID } });

    expect(validateReferences).toHaveBeenCalledTimes(1);

    const references: Array<{ modelName: string; id: unknown }> = (
      validateReferences.mock.calls[0]![0] as {
        references: Array<{ modelName: string; id: unknown }>;
      }
    ).references;

    expect(
      references.find((reference: { modelName: string }): boolean => {
        return reference.modelName === "Monitor";
      })?.id,
    ).toBe(NEW_MONITOR_ID);
  });
});

describe("AlertService.onBeforeUpdate: what the guard reads", () => {
  test("an update that does not write the monitor reads nothing extra", async () => {
    const onUpdate: OnUpdate<Alert> = await runBeforeUpdate({
      title: "Renamed",
      hosts: [],
    });

    expect(findBy).not.toHaveBeenCalled();
    expect((onUpdate.carryForward as CarryForwardShape).monitorChanges).toEqual(
      {},
    );
  });

  test("a monitor key holding undefined is not a write, so it neither reads nor clears", async () => {
    // A model instance has every column as an own property, set to undefined.
    const onUpdate: OnUpdate<Alert> = await runBeforeUpdate({
      title: "Renamed",
      monitor: undefined,
      monitorId: undefined,
    });

    expect(findBy).not.toHaveBeenCalled();
    expect((onUpdate.carryForward as CarryForwardShape).monitorChanges).toEqual(
      {},
    );
  });

  test("a project member's read is pinned to their project, and keeps their privacy filter", async () => {
    stored = [
      storedAlert({ isCreatedAutomatically: false, monitorId: OLD_MONITOR_ID }),
    ];

    const query: JSONObject = { _id: ALERT_ID };

    await runBeforeUpdate({ monitorId: NEW_MONITOR_ID }, MEMBER_PROPS, query);

    expect(findBy).toHaveBeenCalledTimes(1);

    const read: {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    };

    expect(read.query["_id"]).toBe(ALERT_ID);
    expect(read.query["projectId"]).toBe(PROJECT_ID);
    // The self-privacy clause the hook added for a non-admin member.
    expect(read.query["isPrivate"]).toBeDefined();
    expect(read.select).toEqual({
      _id: true,
      isCreatedAutomatically: true,
      monitorId: true,
    });
    // Root, so a role that can edit but not read these columns is not refused.
    expect(read.props).toEqual({ isRoot: true });
    // The update's own query is left for the permission layer to scope.
    expect(query["projectId"]).toBeUndefined();
  });

  test("a root caller's read uses the update's query as it is", async () => {
    await expect(
      runBeforeUpdate(
        { monitorId: NEW_MONITOR_ID },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    ).rejects.toThrow(LOCKED_MONITOR);

    const read: { query: JSONObject } = findBy.mock.calls[0]![0] as {
      query: JSONObject;
    };

    expect(read.query).toEqual({ _id: ALERT_ID });
  });
});

describe("AlertService.onBeforeUpdate: every caller is guarded", () => {
  test("root with a tenant, as the workflow Update Alert component writes, is refused", async () => {
    await expect(
      runBeforeUpdate(
        { monitor: { _id: NEW_MONITOR_ID } },
        { isRoot: true, tenantId: PROJECT_ID },
      ),
    ).rejects.toThrow(LOCKED_MONITOR);
  });

  test("root with no tenant is refused too", async () => {
    await expect(
      runBeforeUpdate({ monitorId: null }, { isRoot: true }),
    ).rejects.toThrow(LOCKED_MONITOR);
  });

  test("a master admin, who bypasses alert privacy, is refused", async () => {
    await expect(
      runBeforeUpdate(
        { monitorId: NEW_MONITOR_ID },
        { tenantId: PROJECT_ID, userId: USER_ID, isMasterAdmin: true },
      ),
    ).rejects.toThrow(LOCKED_MONITOR);
  });
});

describe("AlertService.onBeforeUpdate: an update matching several alerts", () => {
  test("is refused when any one of them is an automatic alert with a monitor", async () => {
    stored = [
      storedAlert({
        id: ALERT_ID,
        isCreatedAutomatically: false,
        monitorId: OLD_MONITOR_ID,
      }),
      storedAlert({
        id: SECOND_ALERT_ID,
        isCreatedAutomatically: true,
        monitorId: OLD_MONITOR_ID,
      }),
    ];

    await expect(
      runBeforeUpdate({ monitorId: NEW_MONITOR_ID }, MEMBER_PROPS, {
        title: "Checkout slow",
      }),
    ).rejects.toThrow(LOCKED_MONITOR);
  });

  test("records a change for each alert whose monitor moves, and none for one already there", async () => {
    stored = [
      storedAlert({
        id: ALERT_ID,
        isCreatedAutomatically: false,
        monitorId: OLD_MONITOR_ID,
      }),
      storedAlert({
        id: SECOND_ALERT_ID,
        isCreatedAutomatically: true,
        // Already on the target monitor, so nothing moves for it.
        monitorId: NEW_MONITOR_ID,
      }),
    ];

    const onUpdate: OnUpdate<Alert> = await runBeforeUpdate(
      { monitorId: NEW_MONITOR_ID },
      MEMBER_PROPS,
      { title: "Checkout slow" },
    );

    const changes: Record<string, MonitorChangeShape> = (
      onUpdate.carryForward as CarryForwardShape
    ).monitorChanges;

    expect(Object.keys(changes)).toEqual([ALERT_ID]);
    expect(idOf(changes[ALERT_ID]!.oldMonitorId)).toBe(OLD_MONITOR_ID);
    expect(idOf(changes[ALERT_ID]!.newMonitorId)).toBe(NEW_MONITOR_ID);
  });

  test("an update that matches no alert changes nothing and is not refused", async () => {
    stored = [];

    expect(await monitorChangesOf({ monitorId: NEW_MONITOR_ID })).toEqual({});
  });
});
