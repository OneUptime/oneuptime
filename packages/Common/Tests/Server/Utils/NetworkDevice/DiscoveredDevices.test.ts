import DiscoveredDevices, {
  ClassifiedDiscoveredDevice,
  HIDDEN_FROM_LIST_REASON,
} from "../../../../Server/Utils/NetworkDevice/DiscoveredDevices";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
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
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Discovered Devices list and its bulk map actions (issue #5775), with
 * the statements' runner standing in for Postgres (DiscoveredDeviceList-
 * Postgres runs them for real). What is pinned here is who may do what,
 * what reaches the database, and what the person is told back: names of
 * devices and sites come only from the person's own reads, a monitored
 * device is never hidden, and nothing but a map preference is written.
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

interface Ran {
  sql: string;
  params: Array<unknown>;
}

let ran: Array<Ran>;
let answers: Array<(sql: string) => Array<Record<string, unknown>> | null>;

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
});

afterEach(() => {
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
