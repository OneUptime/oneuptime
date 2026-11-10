import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
  HIDDEN_FROM_LIST_REASON,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import NetworkTopologySuppression from "../../../../Models/DatabaseModels/NetworkTopologySuppression";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import {
  DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  DiscoveredDeviceMatch,
  DiscoveredDeviceShow,
} from "../../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Discovered Devices list and its bulk map actions (issue #5775), with
 * the statements' runner standing in for Postgres (DiscoveredDeviceList-
 * Postgres runs them for real). What is pinned here is who may do what,
 * what reaches the database, and what the person is told back: names of
 * devices and sites come only from the person's own reads, a monitored
 * device is never hidden, and nothing but a map preference is written.
 *
 * The map writes go round DatabaseService's hooks, so each suppression they
 * write or remove reaches the audit log from here: a Create or a Delete by
 * the person who hid or showed it, as the map's own Hide and Show are
 * recorded. What the recorder makes of an entry is pinned in ee's suites.
 */

jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("../../../../Server/Services/NetworkSiteService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("../../../../Server/Services/NetworkEndpointService", () => {
  return {
    __esModule: true,
    default: {
      getRepository: () => {
        throw new Error("The runner is replaced in these tests.");
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const ROW_A: string = "10000000-0000-4000-8000-00000000000a";
const ROW_B: string = "10000000-0000-4000-8000-00000000000b";
const ROW_C: string = "10000000-0000-4000-8000-00000000000c";
const DEVICE_ID: string = "20000000-0000-4000-8000-000000000001";
const SWITCH_ID: string = "20000000-0000-4000-8000-000000000002";
const SITE_ID: string = "30000000-0000-4000-8000-000000000001";
const SUPPRESSION_A: string = "40000000-0000-4000-8000-00000000000a";
const SUPPRESSION_B: string = "40000000-0000-4000-8000-00000000000b";
const ANOTHER_PERSON_ID: string = "bb000000-0000-4000-8000-000000000002";
const KEY_ID: ObjectID = new ObjectID("cc000000-0000-4000-8000-000000000001");

// What a map write's RETURNING answers, and so what its audit entry records.
const SUPPRESSION_COLUMNS: string = `"_id", "nodeKey", "nodeName", "reason", "createdByUserId"`;

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: PERSON_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

const READER: DatabaseCommonInteractionProps = propsWith([
  Permission.ReadNetworkEndpoint,
  Permission.ReadNetworkDevice,
  Permission.ReadNetworkSite,
]);
const MAP_EDITOR: DatabaseCommonInteractionProps = propsWith([
  Permission.ReadNetworkEndpoint,
  Permission.CreateNetworkTopologySuppression,
  Permission.DeleteNetworkTopologySuppression,
]);

// One of the project's API keys with the same rights: no person behind it.
const MAP_EDITING_KEY: DatabaseCommonInteractionProps = {
  ...MAP_EDITOR,
  userId: undefined,
  userType: UserType.API,
  apiKeyId: KEY_ID,
  apiKeyName: "Inventory sync",
};

interface Ran {
  sql: string;
  params: Array<unknown>;
}

let ran: Array<Ran>;
let answers: Array<(sql: string) => Array<Record<string, unknown>> | null>;
let recordCreate: jest.SpyInstance;
let recordDelete: jest.SpyInstance;

// The statement that wrote or removed suppressions: the only one of its kind.
function writeOf(verb: "INSERT INTO" | "DELETE FROM"): Ran {
  const writes: Array<Ran> = ran.filter((statement: Ran): boolean => {
    return statement.sql.includes(verb);
  });

  expect(writes).toHaveLength(1);

  return writes[0]!;
}

// Every "$n" a statement uses must be exactly its parameters.
function expectParametersLineUp(statement: Ran): void {
  const used: Set<number> = new Set<number>();

  for (const match of statement.sql.matchAll(/\$(\d+)/g)) {
    used.add(Number(match[1]));
  }

  expect(used.size).toBe(statement.params.length);

  for (let index: number = 1; index <= statement.params.length; index++) {
    expect(used.has(index)).toBe(true);
  }
}

// A suppression row as Postgres answers a map write's RETURNING.
function suppressionRow(fields: {
  id: string;
  endpointId: string;
  nodeName?: string | null;
  reason?: string | null;
  createdByUserId?: string | null;
}): Record<string, unknown> {
  return {
    _id: fields.id,
    nodeKey: `endpoint:${fields.endpointId}`,
    nodeName: fields.nodeName === undefined ? null : fields.nodeName,
    reason: fields.reason === undefined ? null : fields.reason,
    createdByUserId:
      fields.createdByUserId === undefined ? null : fields.createdByUserId,
  };
}

// What each audit entry was handed: the record, its id, and whose it is.
interface Recorded {
  isSuppression: boolean;
  id: string | undefined;
  projectId: string | undefined;
  nodeKey: string | undefined;
  nodeName: string | undefined;
  reason: string | undefined;
  createdByUserId: string | undefined;
  itemId?: string | undefined;
  props: DatabaseCommonInteractionProps;
}

function recordedBy(spy: jest.SpyInstance, item: string): Array<Recorded> {
  return spy.mock.calls.map((call: Array<unknown>): Recorded => {
    const data: {
      model: unknown;
      itemId?: ObjectID;
      props: DatabaseCommonInteractionProps;
    } & Record<string, unknown> = call[0] as {
      model: unknown;
      itemId?: ObjectID;
      props: DatabaseCommonInteractionProps;
    } & Record<string, unknown>;
    const suppression: NetworkTopologySuppression = data[
      item
    ] as NetworkTopologySuppression;

    return {
      isSuppression:
        data.model instanceof NetworkTopologySuppression &&
        suppression instanceof NetworkTopologySuppression,
      id: suppression.id?.toString(),
      projectId: suppression.projectId?.toString(),
      nodeKey: suppression.nodeKey,
      nodeName: suppression.nodeName,
      reason: suppression.reason,
      createdByUserId: suppression.createdByUserId?.toString(),
      ...(data.itemId ? { itemId: data.itemId.toString() } : {}),
      props: data.props,
    };
  });
}

function rawRow(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: ROW_A,
    macAddress: "00:11:22:33:44:55",
    ipAddress: null,
    hostname: null,
    vendor: null,
    classification: null,
    attachedNetworkDeviceId: null,
    attachedPortName: null,
    vlanId: null,
    siteId: null,
    firstSeenAt: null,
    lastSeenAt: null,
    isFromController: false,
    isSeenRecently: true,
    isHidden: false,
    monitoredDeviceId: null,
    monitoredBy: null,
    ...fields,
  };
}

// Answer statements by what they are, the way Postgres would.
function answerWith(data: {
  counts?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  // What a write's RETURNING answers.
  inserted?: Array<Record<string, unknown>>;
  deleted?: Array<Record<string, unknown>>;
}): void {
  answers = [
    (sql: string) => {
      return sql.includes(`COUNT(*)::int AS "all"`)
        ? [data.counts || {}]
        : null;
    },
    (sql: string) => {
      return sql.includes("INSERT INTO") ? data.inserted || [] : null;
    },
    (sql: string) => {
      return sql.includes("DELETE FROM") ? data.deleted || [] : null;
    },
    () => {
      return data.rows || [];
    },
  ];
}

beforeEach(() => {
  ran = [];
  answerWith({});
  DiscoveredDevices.runQuery = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    ran.push({ sql: sql, params: params });

    for (const answer of answers) {
      const rows: Array<Record<string, unknown>> | null = answer(sql);

      if (rows) {
        return rows;
      }
    }

    return [];
  };
  DiscoveredDevices.now = (): Date => {
    return new Date("2026-11-08T12:00:00.000Z");
  };
  (NetworkDeviceService.findBy as jest.Mock).mockResolvedValue([]);
  (NetworkSiteService.findBy as jest.Mock).mockResolvedValue([]);
  recordCreate = jest
    .spyOn(AuditLogService, "recordCreate")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });
  recordDelete = jest
    .spyOn(AuditLogService, "recordDelete")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });
});

afterEach(() => {
  recordCreate.mockRestore();
  recordDelete.mockRestore();
  jest.clearAllMocks();
});

describe("reading the list", () => {
  test("needs the right to read endpoints, and reads nothing without it", async () => {
    await expect(
      DiscoveredDevices.list({
        projectId: PROJECT_ID,
        props: propsWith([Permission.ReadNetworkDevice]),
        request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You may not see this project's discovered devices.",
      ),
    );
    expect(ran).toHaveLength(0);
  });

  test("answers one page with the count for the choice shown and every count", async () => {
    answerWith({
      counts: { all: 12, notMonitored: 9, monitored: 3, hidden: 2 },
      rows: [
        rawRow({
          id: ROW_A,
          ipAddress: "10.0.0.5",
          vendor: "Zebra",
          lastSeenAt: new Date("2026-11-08T11:59:00.000Z"),
          firstSeenAt: "2026-10-01T00:00:00.000Z",
          vlanId: 0,
          attachedPortName: "Gi1/0/7",
        }),
      ],
    });

    const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: READER,
      request: {
        ...DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
        show: DiscoveredDeviceShow.Hidden,
      },
    });

    expect(list.count).toBe(2);
    expect(list.counts).toEqual({
      all: 12,
      notMonitored: 9,
      monitored: 3,
      hidden: 2,
    });
    expect(list.rows).toEqual([
      {
        id: ROW_A,
        // Named by its address, never by its maker.
        name: "10.0.0.5",
        macAddress: "00:11:22:33:44:55",
        ipAddress: "10.0.0.5",
        vendor: "Zebra",
        portName: "Gi1/0/7",
        vlanId: 0,
        firstSeenAt: "2026-10-01T00:00:00.000Z",
        lastSeenAt: "2026-11-08T11:59:00.000Z",
        isSeenRecently: true,
        isFromController: false,
        isHidden: false,
      },
    ]);
  });

  test("a sighting is current for the map's window, and longer for a controller's", async () => {
    await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: READER,
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    const [project, walkSince, controllerSince]: Array<unknown> =
      ran[0]!.params;

    expect(project).toBe(PROJECT_ID.toString());
    expect((walkSince as Date).getTime()).toBeLessThan(
      new Date("2026-11-08T12:00:00.000Z").getTime(),
    );
    expect((controllerSince as Date).getTime()).toBe(
      new Date("2026-11-08T06:00:00.000Z").getTime(),
    );
    expect((controllerSince as Date).getTime()).toBeLessThan(
      (walkSince as Date).getTime(),
    );
  });

  test("names come from the person's own reads of devices and sites", async () => {
    answerWith({
      rows: [
        rawRow({
          id: ROW_A,
          monitoredDeviceId: DEVICE_ID,
          monitoredBy: "ipAddress",
          attachedNetworkDeviceId: SWITCH_ID,
          siteId: SITE_ID,
          isHidden: true,
        }),
      ],
    });

    const monitored: NetworkDevice = new NetworkDevice();
    monitored.id = new ObjectID(DEVICE_ID);
    monitored.name = "Front register";
    const site: NetworkSite = new NetworkSite();
    site.id = new ObjectID(SITE_ID);
    site.name = "Store 12";

    (NetworkDeviceService.findBy as jest.Mock).mockResolvedValue([monitored]);
    (NetworkSiteService.findBy as jest.Mock).mockResolvedValue([site]);

    const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: READER,
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    expect(NetworkDeviceService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ props: READER, limit: 2 }),
    );
    expect(NetworkSiteService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ props: READER, limit: 1 }),
    );
    expect(list.rows[0]).toMatchObject({
      monitoredDevice: { id: DEVICE_ID, name: "Front register" },
      monitoredBy: DiscoveredDeviceMatch.IpAddress,
      // The switch the person may not read keeps its id, without a name.
      seenOn: { id: SWITCH_ID },
      site: { id: SITE_ID, name: "Store 12" },
      // A monitored device is drawn as itself: never hidden.
      isHidden: false,
    });
    expect(list.rows[0]).not.toHaveProperty("seenOnDeviceId");
    expect(list.rows[0]).not.toHaveProperty("siteId");
  });

  test("a person who may not read devices still gets the list, without their names", async () => {
    answerWith({
      rows: [
        rawRow({ monitoredDeviceId: DEVICE_ID, monitoredBy: "macAddress" }),
      ],
    });
    (NetworkDeviceService.findBy as jest.Mock).mockRejectedValue(
      new NotAuthorizedException("no"),
    );

    const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: propsWith([Permission.ReadNetworkEndpoint]),
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    expect(list.rows[0]!.monitoredDevice).toEqual({ id: DEVICE_ID });
  });

  test("a failure that is not a refusal is not swallowed", async () => {
    answerWith({ rows: [rawRow({ monitoredDeviceId: DEVICE_ID })] });
    (NetworkDeviceService.findBy as jest.Mock).mockRejectedValue(
      new Error("connection lost"),
    );

    await expect(
      DiscoveredDevices.list({
        projectId: PROJECT_ID,
        props: READER,
        request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
      }),
    ).rejects.toThrow("connection lost");
  });

  test("select-all answers every matching id, capped, with the count", async () => {
    answerWith({
      counts: { all: 3, notMonitored: 3 },
      rows: [
        rawRow({ id: ROW_A, ipAddress: "10.0.0.5" }),
        rawRow({
          id: ROW_B,
          classification: "Shelf scanner",
          monitoredDeviceId: DEVICE_ID,
        }),
        rawRow({ id: ROW_A }),
      ],
    });

    expect(
      await DiscoveredDevices.listIds({
        projectId: PROJECT_ID,
        props: READER,
        request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
      }),
    ).toEqual({
      devices: [
        { id: ROW_A, name: "10.0.0.5", ipAddress: "10.0.0.5" },
        { id: ROW_B, name: "Shelf scanner", isMonitored: true },
      ],
      count: 3,
    });
    expect(ran[1]!.params[ran[1]!.params.length - 1]).toBe(5000);
  });
});

describe("the list says how long a device nothing sees stays (issue #6389)", () => {
  function answerRetention(rows: Array<Record<string, unknown>>): void {
    answers.unshift((sql: string) => {
      return sql.includes(`FROM "Project" p`) ? rows : null;
    });
  }

  function retentionStatements(): Array<Ran> {
    return ran.filter((statement: Ran): boolean => {
      return statement.sql.includes(`FROM "Project" p`);
    });
  }

  test("answers the project's days with the page, read for this project only", async () => {
    answerWith({ counts: { all: 4, notMonitored: 4 } });
    answerRetention([{ retentionInDays: 90 }]);

    const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: READER,
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    expect(list.retentionInDays).toBe(90);
    expect(retentionStatements()).toHaveLength(1);
    expect(retentionStatements()[0]!.params).toEqual([PROJECT_ID.toString()]);
  });

  test("says Never as 0", async () => {
    answerRetention([{ retentionInDays: 0 }]);

    const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
      projectId: PROJECT_ID,
      props: READER,
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    expect(list.retentionInDays).toBe(0);
  });

  test.each([[[]], [[{ retentionInDays: null }]], [[{ retentionInDays: 45 }]]])(
    "says nothing of it when the project answers %p",
    async (rows: Array<Record<string, unknown>>) => {
      answerRetention(rows);

      const list: DiscoveredDeviceListResponse = await DiscoveredDevices.list({
        projectId: PROJECT_ID,
        props: READER,
        request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
      });

      expect(
        Object.prototype.hasOwnProperty.call(list, "retentionInDays"),
      ).toBe(false);
    },
  );

  test("select-all does not read it: only the list's page says it", async () => {
    answerRetention([{ retentionInDays: 30 }]);

    await DiscoveredDevices.listIds({
      projectId: PROJECT_ID,
      props: READER,
      request: DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
    });

    expect(retentionStatements()).toHaveLength(0);
  });
});

describe("hiding devices from the map", () => {
  test("needs the right to hide nodes, and writes nothing without it", async () => {
    await expect(
      DiscoveredDevices.hideFromMap({
        projectId: PROJECT_ID,
        props: READER,
        endpointIds: [ROW_A],
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You may not hide devices from this project's topology map.",
      ),
    );
    expect(ran).toHaveLength(0);
    expect(recordCreate).not.toHaveBeenCalled();
  });

  test("writes what the model's create writes, version included, never twice for one node", async () => {
    answerWith({
      rows: [rawRow({ id: ROW_A, classification: "Front register" })],
    });

    await DiscoveredDevices.hideFromMap({
      projectId: PROJECT_ID,
      props: MAP_EDITOR,
      endpointIds: [ROW_A],
    });

    const insert: Ran = writeOf("INSERT INTO");

    expectParametersLineUp(insert);
    expect(insert.sql).toContain(
      `("_id", "createdAt", "updatedAt", "version", "projectId", "nodeKey", "nodeName", "reason", "createdByUserId")`,
    );
    expect(insert.sql).toContain("now(), now(), 1,");
    expect(insert.sql).toContain("WHERE NOT EXISTS");
    // Each row written comes back with what its audit log entry records.
    expect(insert.sql).toContain(`RETURNING ${SUPPRESSION_COLUMNS}\n)`);
    // Answered by a SELECT, so the driver hands back the rows themselves.
    expect(insert.sql.startsWith("WITH added AS (\nINSERT INTO")).toBe(true);
    expect(
      insert.sql.endsWith(`SELECT ${SUPPRESSION_COLUMNS} FROM added`),
    ).toBe(true);
    expect(insert.params).toEqual([
      PROJECT_ID.toString(),
      PERSON_ID.toString(),
      HIDDEN_FROM_LIST_REASON,
      [expect.any(String)],
      [`endpoint:${ROW_A}`],
      ["Front register"],
    ]);
    expect(
      ObjectID.isValidUUID((insert.params[3] as Array<string>)[0] || ""),
    ).toBe(true);
  });

  test("each suppression it writes is in the audit log: a Create by the person who hid it", async () => {
    answerWith({
      rows: [
        rawRow({ id: ROW_A, ipAddress: "10.0.0.5" }),
        rawRow({ id: ROW_B, ipAddress: "10.0.0.6" }),
        rawRow({ id: ROW_C, monitoredDeviceId: DEVICE_ID }),
      ],
      // Someone hid B in the meantime, so the statement wrote A alone.
      inserted: [
        suppressionRow({
          id: SUPPRESSION_A,
          endpointId: ROW_A,
          nodeName: "10.0.0.5",
          reason: HIDDEN_FROM_LIST_REASON,
          createdByUserId: PERSON_ID.toString(),
        }),
      ],
    });

    const change: DiscoveredDeviceMapChange =
      await DiscoveredDevices.hideFromMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
        endpointIds: [ROW_A, ROW_B, ROW_C],
      });

    expect(change.changedIds).toEqual([ROW_A]);
    expect(recordedBy(recordCreate, "createdItem")).toEqual([
      {
        isSuppression: true,
        id: SUPPRESSION_A,
        projectId: PROJECT_ID.toString(),
        nodeKey: `endpoint:${ROW_A}`,
        nodeName: "10.0.0.5",
        reason: HIDDEN_FROM_LIST_REASON,
        createdByUserId: PERSON_ID.toString(),
        props: MAP_EDITOR,
      },
    ]);
    expect(recordDelete).not.toHaveBeenCalled();
  });

  test("by an API key, writes no author, and the entry is the key's", async () => {
    answerWith({
      rows: [rawRow({ id: ROW_A })],
      inserted: [
        suppressionRow({
          id: SUPPRESSION_A,
          endpointId: ROW_A,
          nodeName: "00:11:22:33:44:55",
          reason: HIDDEN_FROM_LIST_REASON,
        }),
      ],
    });

    await DiscoveredDevices.hideFromMap({
      projectId: PROJECT_ID,
      props: MAP_EDITING_KEY,
      endpointIds: [ROW_A],
    });

    expect(writeOf("INSERT INTO").params[1]).toBeNull();

    const recorded: Array<Recorded> = recordedBy(recordCreate, "createdItem");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.createdByUserId).toBeUndefined();
    expect(recorded[0]!.props).toBe(MAP_EDITING_KEY);
  });

  test("hides the ones not monitored, skips the monitored, and says what it did", async () => {
    answerWith({
      rows: [
        rawRow({ id: ROW_A, ipAddress: "10.0.0.5" }),
        rawRow({ id: ROW_B, isHidden: true }),
        rawRow({ id: ROW_C, monitoredDeviceId: DEVICE_ID }),
      ],
      inserted: [{ nodeKey: `endpoint:${ROW_A}` }],
    });

    const change: DiscoveredDeviceMapChange =
      await DiscoveredDevices.hideFromMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
        endpointIds: [
          ROW_A,
          ROW_B,
          ROW_C,
          "10000000-0000-4000-8000-0000000000ff",
        ],
      });

    expect(change).toEqual({
      changedIds: [ROW_A],
      unchangedIds: [ROW_B],
      monitoredIds: [ROW_C],
      notFoundIds: ["10000000-0000-4000-8000-0000000000ff"],
    });

    const insert: Ran = ran.find((statement: Ran): boolean => {
      return statement.sql.includes("INSERT INTO");
    })!;

    // Only the one not monitored and not hidden already.
    expect(insert.params[0]).toBe(PROJECT_ID.toString());
    expect(insert.params[1]).toBe(PERSON_ID.toString());
    expect(insert.params[2]).toBe(HIDDEN_FROM_LIST_REASON);
    expect(insert.params[4]).toEqual([`endpoint:${ROW_A}`]);
    expect(insert.params[5]).toEqual(["10.0.0.5"]);
  });

  test("nothing to hide writes nothing", async () => {
    answerWith({ rows: [rawRow({ id: ROW_A, monitoredDeviceId: DEVICE_ID })] });

    const change: DiscoveredDeviceMapChange =
      await DiscoveredDevices.hideFromMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
        endpointIds: [ROW_A],
      });

    expect(change.monitoredIds).toEqual([ROW_A]);
    expect(
      ran.some((statement: Ran): boolean => {
        return statement.sql.includes("INSERT INTO");
      }),
    ).toBe(false);
    expect(recordCreate).not.toHaveBeenCalled();
  });

  test("a node name longer than the column holds is cut to fit", async () => {
    answerWith({
      rows: [rawRow({ id: ROW_A, classification: "x".repeat(140) })],
      inserted: [{ nodeKey: `endpoint:${ROW_A}` }],
    });

    await DiscoveredDevices.hideFromMap({
      projectId: PROJECT_ID,
      props: MAP_EDITOR,
      endpointIds: [ROW_A],
    });

    const insert: Ran = ran.find((statement: Ran): boolean => {
      return statement.sql.includes("INSERT INTO");
    })!;

    expect((insert.params[5] as Array<string>)[0]).toHaveLength(100);
  });
});

describe("showing devices on the map again", () => {
  test("needs the right to show nodes", async () => {
    await expect(
      DiscoveredDevices.showOnMap({
        projectId: PROJECT_ID,
        props: READER,
        endpointIds: [ROW_A],
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You may not show hidden devices on this project's topology map again.",
      ),
    );
    expect(ran).toHaveLength(0);
    expect(recordDelete).not.toHaveBeenCalled();
  });

  test("removes these nodes' suppressions, or every one of the project's", async () => {
    answerWith({ rows: [rawRow({ id: ROW_A })] });

    await DiscoveredDevices.showOnMap({
      projectId: PROJECT_ID,
      props: MAP_EDITOR,
      endpointIds: [ROW_A],
    });

    const some: Ran = writeOf("DELETE FROM");

    ran = [];

    await DiscoveredDevices.showEverythingOnMap({
      projectId: PROJECT_ID,
      props: MAP_EDITOR,
    });

    const every: Ran = writeOf("DELETE FROM");

    expectParametersLineUp(some);
    expectParametersLineUp(every);
    /*
     * A bare DELETE comes back from TypeORM's Postgres driver as
     * [rows, rowCount]; through a SELECT it comes back as the rows - each
     * with what its audit log entry records.
     */
    expect(some.sql).toBe(`WITH removed AS (
DELETE FROM "NetworkTopologySuppression"
WHERE "projectId" = $1::uuid AND "nodeKey" = ANY($2::text[])
RETURNING "_id", "nodeKey", "nodeName", "reason", "createdByUserId"
)
SELECT "_id", "nodeKey", "nodeName", "reason", "createdByUserId" FROM removed`);
    expect(every.sql).toBe(`WITH removed AS (
DELETE FROM "NetworkTopologySuppression"
WHERE "projectId" = $1::uuid
RETURNING "_id", "nodeKey", "nodeName", "reason", "createdByUserId"
)
SELECT "_id", "nodeKey", "nodeName", "reason", "createdByUserId" FROM removed`);
    expect(some.params).toEqual([PROJECT_ID.toString(), [`endpoint:${ROW_A}`]]);
    expect(every.params).toEqual([PROJECT_ID.toString()]);
  });

  test("each suppression it removes is in the audit log: a Delete by the person who showed it", async () => {
    answerWith({
      rows: [rawRow({ id: ROW_A }), rawRow({ id: ROW_B })],
      // Only B was hidden: by someone else, from the map itself.
      deleted: [
        suppressionRow({
          id: SUPPRESSION_B,
          endpointId: ROW_B,
          nodeName: "Back office printer",
          createdByUserId: ANOTHER_PERSON_ID,
        }),
      ],
    });

    const change: DiscoveredDeviceMapChange = await DiscoveredDevices.showOnMap(
      {
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
        endpointIds: [ROW_A, ROW_B],
      },
    );

    expect(change.changedIds).toEqual([ROW_B]);
    expect(recordedBy(recordDelete, "deletedItem")).toEqual([
      {
        isSuppression: true,
        id: SUPPRESSION_B,
        itemId: SUPPRESSION_B,
        projectId: PROJECT_ID.toString(),
        nodeKey: `endpoint:${ROW_B}`,
        nodeName: "Back office printer",
        reason: undefined,
        createdByUserId: ANOTHER_PERSON_ID,
        props: MAP_EDITOR,
      },
    ]);
    expect(recordCreate).not.toHaveBeenCalled();
  });

  test("the map's Show them records every node it shows again, however many", async () => {
    const removed: Array<Record<string, unknown>> = Array.from(
      { length: 23 },
      (_value: unknown, index: number): Record<string, unknown> => {
        return {
          _id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          nodeKey: `device:${index}`,
          nodeName: `switch ${index}`,
          reason: null,
          createdByUserId: null,
        };
      },
    );

    answerWith({ deleted: removed });

    expect(
      await DiscoveredDevices.showEverythingOnMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
      }),
    ).toEqual({ changed: 23 });

    const recorded: Array<Recorded> = recordedBy(recordDelete, "deletedItem");

    expect(
      recorded
        .map((entry: Recorded): string => {
          return entry.itemId || "";
        })
        .sort(),
    ).toEqual(
      removed
        .map((row: Record<string, unknown>): string => {
          return String(row["_id"]);
        })
        .sort(),
    );

    for (const entry of recorded) {
      expect(entry.isSuppression).toBe(true);
      expect(entry.id).toBe(entry.itemId);
      expect(entry.props).toBe(MAP_EDITOR);
    }
  });

  test("removes the selected rows' suppressions and says how many there were", async () => {
    answerWith({
      rows: [rawRow({ id: ROW_A }), rawRow({ id: ROW_B })],
      deleted: [{ nodeKey: `endpoint:${ROW_B}` }],
    });

    expect(
      await DiscoveredDevices.showOnMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
        endpointIds: [ROW_A, ROW_B],
      }),
    ).toEqual({
      changedIds: [ROW_B],
      unchangedIds: [ROW_A],
      monitoredIds: [],
      notFoundIds: [],
    });

    const deletion: Ran = ran.find((statement: Ran): boolean => {
      return statement.sql.includes("DELETE FROM");
    })!;

    expect(deletion.params).toEqual([
      PROJECT_ID.toString(),
      [`endpoint:${ROW_A}`, `endpoint:${ROW_B}`],
    ]);
  });

  test("the map's Show them shows every hidden node in one statement", async () => {
    answerWith({
      deleted: Array.from({ length: 7 }, (_value: unknown, index: number) => {
        return { nodeKey: `device:${index}` };
      }),
    });

    expect(
      await DiscoveredDevices.showEverythingOnMap({
        projectId: PROJECT_ID,
        props: MAP_EDITOR,
      }),
    ).toEqual({ changed: 7 });
    expect(ran).toHaveLength(1);
    expect(ran[0]!.params).toEqual([PROJECT_ID.toString()]);

    await expect(
      DiscoveredDevices.showEverythingOnMap({
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });
});

describe("a row as the database returns it", () => {
  test("is named by a person's classification, then its hostname, address and MAC", () => {
    const named: ClassifiedDiscoveredDevice = DiscoveredDevices.toRow(
      rawRow({
        classification: "  ",
        hostname: "reg-front-01",
        ipAddress: "10.0.0.5",
        vendor: "Verifone",
      }),
    );

    expect(named.name).toBe("reg-front-01");
    expect(DiscoveredDevices.toRow(rawRow({ vendor: "Verifone" })).name).toBe(
      "00:11:22:33:44:55",
    );
  });

  test("keeps the ids an import needs beside the public row", () => {
    const row: ClassifiedDiscoveredDevice = DiscoveredDevices.toRow(
      rawRow({ attachedNetworkDeviceId: SWITCH_ID, siteId: SITE_ID }),
    );

    expect(row.seenOnDeviceId).toBe(SWITCH_ID);
    expect(row.siteId).toBe(SITE_ID);
  });
});
