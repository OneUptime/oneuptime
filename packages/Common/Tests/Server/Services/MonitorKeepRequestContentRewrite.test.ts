import * as fs from "fs";
import * as path from "path";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
} from "../../../Server/Utils/Monitor/LatestIncomingRequest";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import URL from "../../../Types/API/URL";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  RowsCallerMayWriteRead,
  stubRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CHANGING KEEP REQUEST CONTENT COVERS THE LATEST REQUEST NOW, NOT FROM THE
 * NEXT REQUEST ON (issue #6402).
 *
 * An Incoming Request monitor keeps its latest request twice: as it came,
 * which no role reads, and the copy people read, cut as its logs are by its
 * Keep request content switch. When an update writes the switch,
 * MonitorService writes the copy people read again from the request as it
 * came (rewriteLatestIncomingRequestForReaders): turning it off takes the
 * headers and body out of the overview at once, and turning it back on
 * brings them back, masked as the logs mask them. One statement, written
 * only while the monitor still holds what was read: a request that came in
 * meanwhile wrote both copies itself.
 *
 * The real onBeforeUpdate and onUpdateSuccess run; the database is stubbed,
 * and the compare-and-set write is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-6402-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-6402-4aaa-8bbb-000000000002");
const DEPLOY_HOOK: string = "0193c0de-6402-4aaa-8bbb-0000000000a1";
const NIGHTLY_BACKUP: string = "0193c0de-6402-4aaa-8bbb-0000000000a2";
const NEVER_CALLED: string = "0193c0de-6402-4aaa-8bbb-0000000000a3";
const NOT_SPLIT_YET: string = "0193c0de-6402-4aaa-8bbb-0000000000a4";

const LIVE_TOKEN: string = "example-live-token-7f3a9c2b";

interface StoredMonitor {
  id: string;
  name: string;
  keepResponseContent: boolean;
  incomingMonitorRequest: IncomingMonitorRequest | null;
  incomingMonitorRequestAsReceived: IncomingMonitorRequest | null;
}

interface CompareAndSet {
  id: ObjectID;
  data: Dictionary<unknown>;
  expectedData: Dictionary<unknown>;
  skipUpdateDateColumn?: boolean;
}

let storedMonitors: Array<StoredMonitor> = [];

let reads: MockFunction;
let readsById: MockFunction;
let compareAndSet: MockFunction;
let errors: MockFunction;

type OnBeforeUpdate = (
  updateBy: UpdateBy<Monitor>,
) => Promise<OnUpdate<Monitor>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Monitor>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Monitor>>;

const hooks: {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
} = MonitorService as unknown as {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
};

// A deploy hook, as its sender sent it.
function deployHook(monitorId: string, at: string): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: new ObjectID(monitorId),
    requestMethod: HTTPMethod.POST,
    requestHeaders: {
      "content-type": "application/json",
      authorization: `Bearer ${LIVE_TOKEN}`,
    },
    requestBody: {
      status: "deployed",
      deployedBy: "jane@acme.example",
      apiKey: "ak_live_88c1",
    },
    incomingRequestReceivedAt: new Date(at),
    checkedAt: new Date(at),
    onlyCheckForIncomingRequestReceivedAt: false,
  } as IncomingMonitorRequest;
}

// Both copies of a request, as the ingest writes them.
function written(
  request: IncomingMonitorRequest,
  keepResponseContent: boolean,
): LatestIncomingRequestColumns {
  return LatestIncomingRequest.toColumns({
    request: request,
    keepResponseContent: keepResponseContent,
  });
}

function stored(
  id: string,
  name: string,
  keepResponseContent: boolean,
  request: IncomingMonitorRequest | null,
): StoredMonitor {
  const columns: LatestIncomingRequestColumns | null = request
    ? written(request, keepResponseContent)
    : null;

  return {
    id: id,
    name: name,
    keepResponseContent: keepResponseContent,
    incomingMonitorRequest: columns?.incomingMonitorRequest || null,
    incomingMonitorRequestAsReceived:
      columns?.incomingMonitorRequestAsReceived || null,
  };
}

function storedMonitor(id: string): StoredMonitor {
  return storedMonitors.find((monitor: StoredMonitor): boolean => {
    return monitor.id === id;
  })!;
}

// The stored monitors a read matches: by its _id (one, or an IN), or all.
function matching(query: Dictionary<unknown>): Array<StoredMonitor> {
  const id: unknown = query["_id"];

  if (typeof id === "string" || id instanceof ObjectID) {
    return storedMonitors.filter((monitor: StoredMonitor): boolean => {
      return monitor.id === id.toString().toLowerCase();
    });
  }

  const asked: { objectLiteralParameters?: Dictionary<unknown> } | undefined =
    id as { objectLiteralParameters?: Dictionary<unknown> } | undefined;

  if (asked?.objectLiteralParameters) {
    const ids: Array<string> = (
      Object.values(asked.objectLiteralParameters) as Array<Array<unknown>>
    )
      .flat()
      .map((value: unknown): string => {
        return String(value).toLowerCase();
      });

    return storedMonitors.filter((monitor: StoredMonitor): boolean => {
      return ids.includes(monitor.id);
    });
  }

  return storedMonitors;
}

// A row as the database gives it: only what was selected.
function rowOf(record: StoredMonitor, select: Dictionary<unknown>): Monitor {
  const row: Monitor = new Monitor();
  row._id = record.id;
  row.projectId = PROJECT_ID;
  row.monitorType = MonitorType.IncomingRequest;

  if (select["name"]) {
    row.name = record.name;
  }

  if (select["keepResponseContent"]) {
    row.keepResponseContent = record.keepResponseContent;
  }

  if (select["incomingMonitorRequest"] && record.incomingMonitorRequest) {
    row.incomingMonitorRequest = JSON.parse(
      JSON.stringify(record.incomingMonitorRequest),
    );
  }

  if (
    select["incomingMonitorRequestAsReceived"] &&
    record.incomingMonitorRequestAsReceived
  ) {
    row.incomingMonitorRequestAsReceived = JSON.parse(
      JSON.stringify(record.incomingMonitorRequestAsReceived),
    );
  }

  return row;
}

function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

// What the compare-and-set wrote, in the order it wrote it.
function writes(): Array<CompareAndSet> {
  return compareAndSet.mock.calls.map((call: Array<unknown>): CompareAndSet => {
    return call[0] as CompareAndSet;
  });
}

function writtenMonitorIds(): Array<string> {
  return writes().map((write: CompareAndSet): string => {
    return write.id.toString();
  });
}

// The rewrite's own reads: the switch and both copies, by id.
function rewriteReads(): Array<{
  id: ObjectID;
  select: Dictionary<unknown>;
  props: DatabaseCommonInteractionProps;
}> {
  return readsById.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        id: ObjectID;
        select: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      };
    })
    .filter((read: { select: Dictionary<unknown> }): boolean => {
      return Boolean(read.select["incomingMonitorRequestAsReceived"]);
    });
}

beforeEach(() => {
  storedMonitors = [
    stored(
      DEPLOY_HOOK,
      "Deploy hook",
      true,
      deployHook(DEPLOY_HOOK, "2026-11-09T08:00:00.000Z"),
    ),
    stored(
      NIGHTLY_BACKUP,
      "Nightly backup",
      false,
      deployHook(NIGHTLY_BACKUP, "2026-11-09T02:00:00.000Z"),
    ),
    stored(NEVER_CALLED, "Never called", true, null),
    {
      // Kept once, as it came, by a server from before the split.
      id: NOT_SPLIT_YET,
      name: "Not split yet",
      keepResponseContent: true,
      incomingMonitorRequest: JSON.parse(
        JSON.stringify(deployHook(NOT_SPLIT_YET, "2026-11-08T22:00:00.000Z")),
      ),
      incomingMonitorRequestAsReceived: null,
    },
  ];

  stubProjectDirectory({});

  reads = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Monitor>> => {
      return matching(findBy.query).map((record: StoredMonitor): Monitor => {
        return rowOf(record, findBy.select);
      });
    },
  );
  jest.spyOn(MonitorService, "findBy").mockImplementation(reads as never);

  stubRowsCallerMayWrite(MonitorService, (read: RowsCallerMayWriteRead) => {
    return matching(read.query as Dictionary<unknown>).map(
      (record: StoredMonitor) => {
        return { _id: record.id };
      },
    );
  });

  readsById = getJestMockFunction();
  readsById.mockImplementation((async (data: {
    id: ObjectID;
    select: Dictionary<unknown>;
  }): Promise<Monitor | null> => {
    const record: StoredMonitor | undefined = storedMonitors.find(
      (monitor: StoredMonitor): boolean => {
        return monitor.id === data.id.toString();
      },
    );

    return record ? rowOf(record, { ...data.select, name: true }) : null;
  }) as never);
  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation(readsById as never);

  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );

  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);

  /*
   * With billing on, as CI's Common Test runs, turning monitoring on asks
   * the project's pay-as-you-go setup first. Not what this suite is about:
   * the project may.
   */
  jest
    .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
    .mockResolvedValue(undefined as never);

  compareAndSet = getJestMockFunction();
  compareAndSet.mockResolvedValue(true as never);
  jest
    .spyOn(MonitorService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(compareAndSet as never);

  errors = getJestMockFunction();
  jest.spyOn(logger, "error").mockImplementation(errors as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The whole update as DatabaseService runs it, around the write.
async function runUpdate(
  data: Dictionary<unknown>,
  options: {
    ids?: Array<string>;
    props?: DatabaseCommonInteractionProps;
    updatedIds?: Array<string>;
  } = {},
): Promise<OnUpdate<Monitor>> {
  const ids: Array<string> = options.ids || [DEPLOY_HOOK];
  const updatedIds: Array<string> = options.updatedIds || ids;

  const onUpdate: OnUpdate<Monitor> = await hooks.onBeforeUpdate({
    query: (ids.length === 1
      ? { _id: ids[0] }
      : {}) as UpdateBy<Monitor>["query"],
    data: data as UpdateBy<Monitor>["data"],
    props: options.props || editor(),
    limit: ids.length === 1 ? 1 : 100,
    skip: 0,
  });

  // The write itself.
  if (typeof data["keepResponseContent"] === "boolean") {
    for (const id of updatedIds) {
      storedMonitor(id).keepResponseContent = data[
        "keepResponseContent"
      ] as boolean;
    }
  }

  return await hooks.onUpdateSuccess(
    onUpdate,
    updatedIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

describe("turning Keep request content off", () => {
  test("writes the copy people read again: no headers, no body, and it says they were left out", async () => {
    await runUpdate({ keepResponseContent: false });

    expect(writtenMonitorIds()).toEqual([DEPLOY_HOOK]);

    const readersCopy: IncomingMonitorRequest = writes()[0]!.data[
      "incomingMonitorRequest"
    ] as IncomingMonitorRequest;

    expect(readersCopy.requestHeaders).toBeUndefined();
    expect(readersCopy.requestBody).toBeUndefined();
    expect(readersCopy.isResponseContentOmitted).toBe(true);
    expect(readersCopy.requestMethod).toBe(HTTPMethod.POST);
    expect(readersCopy.incomingRequestReceivedAt).toBe(
      "2026-11-09T08:00:00.000Z",
    );
  });

  test("keeps the request as it came beside it, for the heartbeat", async () => {
    const asItCame: IncomingMonitorRequest =
      storedMonitor(DEPLOY_HOOK).incomingMonitorRequestAsReceived!;

    await runUpdate({ keepResponseContent: false });

    expect(writes()[0]!.data["incomingMonitorRequestAsReceived"]).toEqual(
      asItCame,
    );
  });
});

describe("turning Keep request content back on", () => {
  test("brings the headers and body back, masked as the logs mask them", async () => {
    await runUpdate({ keepResponseContent: true }, { ids: [NIGHTLY_BACKUP] });

    expect(writtenMonitorIds()).toEqual([NIGHTLY_BACKUP]);

    const readersCopy: IncomingMonitorRequest = writes()[0]!.data[
      "incomingMonitorRequest"
    ] as IncomingMonitorRequest;

    expect(readersCopy.isResponseContentOmitted).toBeUndefined();
    expect(readersCopy.requestHeaders).toEqual({
      "content-type": "application/json",
      authorization: "[REDACTED]",
    });
    expect(readersCopy.requestBody).toEqual({
      status: "deployed",
      deployedBy: "[REDACTED]",
      apiKey: "[REDACTED]",
    });
    expect(JSON.stringify(readersCopy)).not.toContain(LIVE_TOKEN);
  });

  test("the copy is built by the one cut the logs use, from the request as it came", async () => {
    const asItCame: IncomingMonitorRequest =
      storedMonitor(NIGHTLY_BACKUP).incomingMonitorRequestAsReceived!;

    await runUpdate({ keepResponseContent: true }, { ids: [NIGHTLY_BACKUP] });

    expect(writes()[0]!.data).toEqual(
      LatestIncomingRequest.toColumns({
        request: asItCame,
        keepResponseContent: true,
      }),
    );
  });
});

describe("the write", () => {
  test("is a compare-and-set on what was read: the switch as saved and both copies", async () => {
    const before: StoredMonitor = JSON.parse(
      JSON.stringify(storedMonitor(DEPLOY_HOOK)),
    );

    await runUpdate({ keepResponseContent: false });

    expect(writes()[0]!.expectedData).toEqual({
      keepResponseContent: false,
      incomingMonitorRequest: before.incomingMonitorRequest,
      incomingMonitorRequestAsReceived: before.incomingMonitorRequestAsReceived,
    });
  });

  test("touches only the two copies, and leaves updatedAt as the save set it", async () => {
    await runUpdate({ keepResponseContent: false });

    expect(Object.keys(writes()[0]!.data).sort()).toEqual([
      "incomingMonitorRequest",
      "incomingMonitorRequestAsReceived",
    ]);
    expect(writes()[0]!.skipUpdateDateColumn).toBe(true);
  });

  test("reads as the server: the request as it came is a column no role reads", async () => {
    await runUpdate({ keepResponseContent: false });

    expect(rewriteReads()).toHaveLength(1);
    expect(rewriteReads()[0]!.props).toEqual({ isRoot: true });
    expect(rewriteReads()[0]!.select).toEqual({
      keepResponseContent: true,
      incomingMonitorRequest: true,
      incomingMonitorRequestAsReceived: true,
    });
  });

  test("a request that came in meanwhile wins: the row changed, nothing is written, nothing is logged", async () => {
    compareAndSet.mockResolvedValue(false as never);

    await expect(
      MonitorService.rewriteLatestIncomingRequestForReaders(
        new ObjectID(DEPLOY_HOOK),
      ),
    ).resolves.toBe(false);

    await runUpdate({ keepResponseContent: false });

    expect(errors).not.toHaveBeenCalled();
  });
});

describe("what writes nothing", () => {
  test.each([
    ["a rename", { name: "Deploy hook (prod)" }],
    [
      "an edit to the monitor's other switches",
      { disableActiveMonitoring: false },
    ],
  ])(
    "%s leaves the copy people read alone",
    async (_name: string, data: Dictionary<unknown>) => {
      await runUpdate(data);

      expect(rewriteReads()).toHaveLength(0);
      expect(compareAndSet).not.toHaveBeenCalled();
    },
  );

  test("a monitor no request has reached has nothing to write", async () => {
    await runUpdate({ keepResponseContent: false }, { ids: [NEVER_CALLED] });

    expect(rewriteReads()).toHaveLength(1);
    expect(compareAndSet).not.toHaveBeenCalled();
  });

  test("a monitor that is gone has nothing to write", async () => {
    await expect(
      MonitorService.rewriteLatestIncomingRequestForReaders(
        new ObjectID("0193c0de-6402-4aaa-8bbb-0000000000ff"),
      ),
    ).resolves.toBe(false);

    expect(compareAndSet).not.toHaveBeenCalled();
  });
});

describe("a bulk change", () => {
  test("writes each monitor it wrote", async () => {
    await runUpdate(
      { keepResponseContent: false },
      { ids: [DEPLOY_HOOK, NIGHTLY_BACKUP, NEVER_CALLED] },
    );

    expect(writtenMonitorIds().sort()).toEqual(
      [DEPLOY_HOOK, NIGHTLY_BACKUP].sort(),
    );

    for (const write of writes()) {
      expect(
        (write.data["incomingMonitorRequest"] as IncomingMonitorRequest)
          .isResponseContentOmitted,
      ).toBe(true);
    }
  });

  test("not one it read but did not write", async () => {
    await runUpdate(
      { keepResponseContent: false },
      { ids: [DEPLOY_HOOK, NIGHTLY_BACKUP], updatedIds: [NIGHTLY_BACKUP] },
    );

    expect(writtenMonitorIds()).toEqual([NIGHTLY_BACKUP]);
  });

  test("a failure is logged and does not fail the save; the next monitor is still written", async () => {
    compareAndSet.mockImplementation((async (input: CompareAndSet) => {
      if (input.id.toString() === DEPLOY_HOOK) {
        throw new Error("database is down");
      }
      return true;
    }) as never);

    await expect(
      runUpdate(
        { keepResponseContent: false },
        { ids: [DEPLOY_HOOK, NIGHTLY_BACKUP] },
      ),
    ).resolves.toBeDefined();

    expect(writtenMonitorIds().sort()).toEqual(
      [DEPLOY_HOOK, NIGHTLY_BACKUP].sort(),
    );
    expect(errors).toHaveBeenCalled();
  });
});

describe("a request kept once, before the two copies were split", () => {
  test("is split: the request as it came moves beside a cut copy", async () => {
    const asItCame: IncomingMonitorRequest =
      storedMonitor(NOT_SPLIT_YET).incomingMonitorRequest!;

    await expect(
      MonitorService.rewriteLatestIncomingRequestForReaders(
        new ObjectID(NOT_SPLIT_YET),
      ),
    ).resolves.toBe(true);

    const write: CompareAndSet = writes()[0]!;

    expect(write.data["incomingMonitorRequestAsReceived"]).toEqual(asItCame);
    expect(
      (write.data["incomingMonitorRequest"] as IncomingMonitorRequest)
        .requestHeaders!["authorization"],
    ).toBe("[REDACTED]");
    expect(write.expectedData).toEqual({
      keepResponseContent: true,
      incomingMonitorRequest: asItCame,
      incomingMonitorRequestAsReceived: null,
    });
  });
});

/*
 * The switch is written through MonitorService on every path that writes
 * it - the Dashboard's switch, the API, Terraform, a workflow - so they all
 * reach the hook above.
 */
describe("the hook is the one place", () => {
  test("onUpdateSuccess writes the copy again whenever the switch is in the update", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/MonitorService.ts"),
      "utf8",
    );

    expect(source).toContain(
      "if (onUpdate.updateBy.data.keepResponseContent !== undefined) {",
    );
    expect(source).toContain(
      "await this.rewriteLatestIncomingRequestForReaders(monitorId);",
    );
  });
});
