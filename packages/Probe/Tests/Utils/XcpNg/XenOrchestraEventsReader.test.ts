import XenOrchestraEventsReader, {
  XenOrchestraEventsReadInput,
  getXoBackupsBlocker,
  getXoEventsBlocker,
} from "../../../Utils/XcpNg/XenOrchestraEventsReader";
import {
  XcpNgHttpRequest,
  XcpNgHttpResponse,
} from "../../../Utils/XcpNg/XcpNgHttp";
import FakeXenOrchestraRest, {
  FAKE_XO_TOKEN,
  FakeXoRecord,
  FakeXoRequest,
  LAB_POOL_PRODUCTION,
  LAB_POOL_UNNAMED,
} from "Common/Tests/Helpers/XcpNg/FakeXenOrchestraRest";
import MemoryXcpNgPoolEventsStore, {
  makeXcpNgLabStore,
} from "Common/Tests/Helpers/XcpNg/MemoryXcpNgPoolEventsStore";
import XcpNgPoolEventsIngest, {
  XcpNgPoolEventsIngestPool,
  XcpNgPoolEventsPreparation,
} from "Common/Server/Utils/XcpNg/XcpNgPoolEventsIngest";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import {
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgEventLogAttribute,
  XcpNgEventsJobState,
  XcpNgEventsReport,
  XcpNgHostPatches,
  XcpNgPoolEventsJobState,
  XcpNgPoolEventsReport,
} from "Common/Types/XcpNg/XcpNgPoolEvents";
import { XcpNgEventSource } from "Common/Types/XcpNg/XcpNgPoolEventState";
import {
  XcpNgApiTokenSummary,
  XcpNgPoolMessage,
} from "Common/Types/XcpNg/XcpNgProbeCollection";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The probe's reader of Xen Orchestra's REST API (XenOrchestraEventsReader)
 * against a stand-in Xen Orchestra that serves the recorded lab the way its
 * REST API does (FakeXenOrchestraRest) - and, end to end, the reader, the
 * server's ingest and the watermark the server keeps, over the lab's
 * minutes: a crash alerting in the collection that reads it, a probe that
 * restarts, a server that dies before it commits, a message dismissed.
 */

type TokenSummary = XcpNgApiTokenSummary;

const READ_ONLY: TokenSummary = {
  isReadOnly: true,
  canReadAlarms: true,
  canReadBackupLogs: true,
  canReadMessages: true,
};

const POOLS: Array<string> = [LAB_POOL_PRODUCTION, LAB_POOL_UNNAMED];

// The lab's messages, by id (Fixtures/XcpNg/XenOrchestraRest/messages.json).
const VM_CRASHED_ID: string = "11111111-0000-4000-8000-000000000010";
const DB_ALARM_ID: string = "11111111-0000-4000-8000-000000000011";
const HA_HOST_FAILED_ID: string = "11111111-0000-4000-8000-000000000020";

let xo: FakeXenOrchestraRest;
let nowMs: number;

beforeEach(() => {
  xo = new FakeXenOrchestraRest();
  nowMs = 1795000000 * 1000;
});

function at(seconds: number): void {
  xo.setNowSeconds(seconds);
  nowMs = seconds * 1000;
}

function serve(request: XcpNgHttpRequest): Promise<XcpNgHttpResponse> {
  return xo.handle(request);
}

function input(
  state: XcpNgEventsJobState,
  overrides: Partial<XenOrchestraEventsReadInput> = {},
): XenOrchestraEventsReadInput {
  return {
    transport: serve,
    where: "xo.example.test:443",
    token: FAKE_XO_TOKEN,
    state: state,
    poolIds: POOLS,
    tokenSummary: READ_ONLY,
    now: (): Date => {
      return new Date(nowMs);
    },
    ...overrides,
  };
}

function freshState(checkPatches: boolean = false): XcpNgEventsJobState {
  return {
    pools: POOLS.map((poolId: string): XcpNgPoolEventsJobState => {
      return { poolId: poolId, openMessageIds: [] };
    }),
    checkPatches: checkPatches,
  };
}

function poolOf(
  report: XcpNgEventsReport,
  poolId: string,
): XcpNgPoolEventsReport {
  const found: XcpNgPoolEventsReport | undefined = report.pools.find(
    (pool: XcpNgPoolEventsReport): boolean => {
      return pool.poolId === poolId;
    },
  );
  expect([poolId, found]).toEqual([poolId, expect.anything()]);
  return found as XcpNgPoolEventsReport;
}

function names(messages: Array<XcpNgPoolMessage>): Array<string> {
  return messages.map((message: XcpNgPoolMessage): string => {
    return message.name;
  });
}

function runIds(report: XcpNgEventsReport): Array<string> {
  return (report.backupRuns || []).map((run: XcpNgBackupRun): string => {
    return run.runId;
  });
}

// The state the server hands the next collection, from this one's report.
function nextState(
  previous: XcpNgEventsJobState,
  report: XcpNgEventsReport,
  open: Record<string, Array<string>> = {},
): XcpNgEventsJobState {
  const state: XcpNgEventsJobState = {
    pools: previous.pools.map(
      (pool: XcpNgPoolEventsJobState): XcpNgPoolEventsJobState => {
        const read: XcpNgPoolEventsReport | undefined = report.pools.find(
          (entry: XcpNgPoolEventsReport): boolean => {
            return entry.poolId === pool.poolId;
          },
        );
        const next: XcpNgPoolEventsJobState = {
          poolId: pool.poolId,
          openMessageIds: open[pool.poolId] || [],
        };
        const watermark: XcpNgPoolEventsJobState["messageWatermark"] =
          read?.messageWatermark || pool.messageWatermark;
        if (watermark) {
          next.messageWatermark = watermark;
        }
        return next;
      },
    ),
    checkPatches: false,
  };
  const backupWatermark: XcpNgEventsJobState["backupWatermark"] =
    report.backupWatermark || previous.backupWatermark;
  if (backupWatermark) {
    state.backupWatermark = backupWatermark;
  }
  return state;
}

function pathOf(request: FakeXoRequest): string {
  return new URL(request.path, "https://xo.example.test").pathname;
}

function injected(status: number): XcpNgHttpResponse {
  return {
    status: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "injected by the test" }),
  };
}

describe("what the probe asks Xen Orchestra", () => {
  test("only GETs of /rest/v0, the token only as the authenticationToken cookie", async () => {
    await XenOrchestraEventsReader.read(input(freshState(true)));

    // Pools, each pool's first messages and alarms, backups, patches.
    expect(xo.requests.length).toBeGreaterThan(10);
    for (const request of xo.requests) {
      expect(request.method).toBe("GET");
      expect(request.path.startsWith("/rest/v0/")).toBe(true);
      expect(request.path.includes(FAKE_XO_TOKEN)).toBe(false);
      expect(request.headers["Cookie"]).toBe(
        `authenticationToken=${FAKE_XO_TOKEN}`,
      );
      expect(request.headers["Authorization"]).toBeUndefined();
      expect(request.headers["User-Agent"]).toContain("OneUptime-Probe");
      expect(request.body).toBeUndefined();
    }
  });

  test("a token Xen Orchestra refused, one that could change it, or one short of reading alarms: nothing is asked", async () => {
    const blocked: Array<TokenSummary> = [
      { errorCode: XcpNgCollectionErrorCode.TokenRejected },
      { errorCode: XcpNgCollectionErrorCode.TokenNotReadOnly },
      { ...READ_ONLY, canReadAlarms: false },
      { ...READ_ONLY, canReadMessages: false },
    ];
    for (const summary of blocked) {
      xo = new FakeXenOrchestraRest();
      const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
        input(freshState(true), { tokenSummary: summary }),
      );
      const blocker: string | null = getXoEventsBlocker(summary);
      expect(blocker).toEqual(expect.any(String));
      expect(xo.requests).toEqual([]);
      expect(report.pools).toEqual([]);
      expect(report.backupRuns).toBeUndefined();
      expect(report.hostPatches).toBeUndefined();
      expect(report.problems.messages).toBe(blocker);
      expect(report.problems.backups).toBe(blocker);
    }

    expect(getXoEventsBlocker(READ_ONLY)).toBeNull();
    // Before the first token check has run: read, and let the reads say.
    expect(getXoEventsBlocker(undefined)).toBeNull();
  });

  test("a token whose user may not read backup logs: alarms and HA are read, backups are said not to be", async () => {
    const summary: TokenSummary = { ...READ_ONLY, canReadBackupLogs: false };
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(), { tokenSummary: summary }),
    );

    expect(report.pools).toHaveLength(2);
    expect(report.backupRuns).toBeUndefined();
    expect(report.backupWatermark).toBeUndefined();
    expect(report.problems.messages).toBeUndefined();
    expect(report.problems.backups).toBe(getXoBackupsBlocker(summary));
    expect(report.problems.backups).toContain("cannot read backup logs");
    expect(
      xo.requests.some((request: FakeXoRequest): boolean => {
        return pathOf(request).startsWith("/rest/v0/backup");
      }),
    ).toBe(false);
    expect(getXoBackupsBlocker(READ_ONLY)).toBeNull();
    expect(getXoBackupsBlocker(undefined)).toBeNull();
  });

  test("a token no Xen Orchestra token looks like is never sent", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(), { token: "abc; Path=/\r\nX-Evil: 1" }),
    );
    expect(xo.requests).toEqual([]);
    expect(report.problems.messages).toContain("was not sent");
    expect(report.problems.backups).toBe(report.problems.messages);
  });
});

describe("messages", () => {
  test("the first read starts each pool at its newest message, and raises none of its history", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );

    const production: XcpNgPoolEventsReport = poolOf(
      report,
      LAB_POOL_PRODUCTION,
    );
    expect(production.messages).toEqual([]);
    expect(production.clearedMessageIds).toEqual([]);
    // Production's newest: the fs_usage ALARM of 1794995000, from /alarms.
    expect(production.messageWatermark).toEqual({
      readUntil: new Date(1794995000 * 1000).toISOString(),
      uuidsAtReadUntil: ["11111111-0000-4000-8000-000000000002"],
    });
    expect(production.poolState).toEqual({
      poolId: LAB_POOL_PRODUCTION,
      haEnabled: true,
      masterHostUuid: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
    });

    const unnamed: XcpNgPoolEventsReport = poolOf(report, LAB_POOL_UNNAMED);
    expect(unnamed.messages).toEqual([]);
    expect(unnamed.messageWatermark).toEqual({
      readUntil: new Date(1794996000 * 1000).toISOString(),
      uuidsAtReadUntil: ["11111111-0000-4000-8000-000000000003"],
    });
    expect(unnamed.poolState?.haEnabled).toBe(false);
  });

  test("a pool with no message at all starts at the epoch: what comes next is new", async () => {
    xo.messages = xo.messages.filter((message: FakeXoRecord): boolean => {
      return message["$pool"] !== LAB_POOL_UNNAMED;
    });
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    expect(poolOf(first, LAB_POOL_UNNAMED).messageWatermark).toEqual({
      readUntil: new Date(0).toISOString(),
      uuidsAtReadUntil: [],
    });

    xo.addMessage({
      id: "11111111-0000-4000-8000-0000000000e1",
      name: "VM_STARTED",
      time: 1795000020,
      $pool: LAB_POOL_UNNAMED,
      $object: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      body: "",
    });
    at(1795000060);
    const second: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first)),
    );
    expect(names(poolOf(second, LAB_POOL_UNNAMED).messages)).toEqual([
      "VM_STARTED",
    ]);
  });

  test("every pool's new messages come in one request to /messages and one to /alarms, oldest first, once", async () => {
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    xo.requests.length = 0;
    at(1795000060);

    const second: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first)),
    );
    const listReads: Array<string> = xo.requests
      .map(pathOf)
      .filter((path: string): boolean => {
        return path === "/rest/v0/messages" || path === "/rest/v0/alarms";
      });
    expect(listReads).toEqual(["/rest/v0/messages", "/rest/v0/alarms"]);

    expect(names(poolOf(second, LAB_POOL_PRODUCTION).messages)).toEqual([
      "VM_CRASHED",
      "ALARM",
      "VM_STARTED",
    ]);
    expect(names(poolOf(second, LAB_POOL_UNNAMED).messages)).toEqual([
      "VM_SNAPSHOTTED",
    ]);

    // The minute read again: nothing is delivered twice.
    const third: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), second)),
    );
    expect(poolOf(third, LAB_POOL_PRODUCTION).messages).toEqual([]);
    expect(poolOf(third, LAB_POOL_UNNAMED).messages).toEqual([]);
    expect(poolOf(third, LAB_POOL_PRODUCTION).messageWatermark).toEqual(
      poolOf(second, LAB_POOL_PRODUCTION).messageWatermark,
    );
  });

  test("two messages of one second, the read between them: neither is lost, neither repeated", async () => {
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );

    // PBD_PLUG_FAILED and SM_GC_NO_SPACE share second 1795000100.
    const gc: FakeXoRecord = xo.messages.find(
      (message: FakeXoRecord): boolean => {
        return message["name"] === "SM_GC_NO_SPACE";
      },
    ) as FakeXoRecord;
    xo.messages = xo.messages.filter((message: FakeXoRecord): boolean => {
      return message !== gc;
    });
    at(1795000100);
    const second: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first)),
    );
    expect(names(poolOf(second, LAB_POOL_PRODUCTION).messages)).toEqual([
      "VM_CRASHED",
      "ALARM",
      "VM_STARTED",
      "HA_HOST_FAILED",
      "PBD_PLUG_FAILED_ON_SERVER_START",
    ]);
    expect(poolOf(second, LAB_POOL_PRODUCTION).messageWatermark).toEqual({
      readUntil: new Date(1795000100 * 1000).toISOString(),
      uuidsAtReadUntil: ["11111111-0000-4000-8000-000000000021"],
    });

    // XAPI writes the second message of that second after the read.
    xo.addMessage(gc);
    at(1795000120);
    const third: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), second)),
    );
    expect(names(poolOf(third, LAB_POOL_PRODUCTION).messages)).toEqual([
      "SM_GC_NO_SPACE",
      "BOND_STATUS_CHANGED",
      "MULTIPATH_PERIODIC_ALERT",
      "HA_POOL_DROP_IN_PLAN_EXISTS_FOR",
      "ALARM",
    ]);
  });

  test("of the messages with an open alert, those XCP-ng no longer lists are cleared", async () => {
    at(1795000200);
    const state: XcpNgEventsJobState = {
      pools: [
        {
          poolId: LAB_POOL_PRODUCTION,
          messageWatermark: {
            readUntil: new Date(1795000200 * 1000).toISOString(),
            uuidsAtReadUntil: [],
          },
          openMessageIds: [VM_CRASHED_ID, DB_ALARM_ID, HA_HOST_FAILED_ID],
        },
      ],
      checkPatches: false,
    };
    // A message, and a threshold alarm (from /alarms), dismissed.
    xo.dismiss(VM_CRASHED_ID);
    xo.dismiss(DB_ALARM_ID);

    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(state, { poolIds: [LAB_POOL_PRODUCTION] }),
    );
    expect(poolOf(report, LAB_POOL_PRODUCTION).clearedMessageIds).toEqual([
      VM_CRASHED_ID,
      DB_ALARM_ID,
    ]);
  });

  test("an id check that failed, or a token not known to read messages, clears nothing", async () => {
    at(1795000200);
    const state: XcpNgEventsJobState = {
      pools: [
        {
          poolId: LAB_POOL_PRODUCTION,
          messageWatermark: {
            readUntil: new Date(1795000200 * 1000).toISOString(),
            uuidsAtReadUntil: [],
          },
          openMessageIds: [VM_CRASHED_ID],
        },
      ],
      checkPatches: false,
    };
    xo.dismiss(VM_CRASHED_ID);

    // An empty list may only mean the token may not read the messages.
    const unknown: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(state, {
        poolIds: [LAB_POOL_PRODUCTION],
        tokenSummary: { isReadOnly: true, canReadAlarms: true },
      }),
    );
    expect(poolOf(unknown, LAB_POOL_PRODUCTION).clearedMessageIds).toEqual([]);

    // The new messages are read; asking for the open ids by id fails.
    const failingIdCheck: XenOrchestraEventsReadInput = input(state, {
      poolIds: [LAB_POOL_PRODUCTION],
      transport: (request: XcpNgHttpRequest): Promise<XcpNgHttpResponse> => {
        const url: URL = new URL(request.path, "https://xo.example.test");
        if (
          url.pathname === "/rest/v0/alarms" &&
          url.searchParams.get("fields") === "id"
        ) {
          return Promise.resolve(injected(500));
        }
        return serve(request);
      },
    });
    const failing: XcpNgEventsReport =
      await XenOrchestraEventsReader.read(failingIdCheck);
    expect(poolOf(failing, LAB_POOL_PRODUCTION).clearedMessageIds).toEqual([]);
    expect(failing.problems.messages).toBeUndefined();
  });

  test("a token Xen Orchestra stops taking mid-read: nothing half-read is reported", async () => {
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    at(1795000120);

    // Revoked after the pools, messages and alarms were read.
    let answered: number = 0;
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(
        { ...nextState(freshState(), first), checkPatches: true },
        {
          transport: (
            request: XcpNgHttpRequest,
          ): Promise<XcpNgHttpResponse> => {
            answered++;
            if (answered === 4) {
              xo.token = "someone-revoked-it";
            }
            return serve(request);
          },
        },
      ),
    );

    expect(report.pools).toEqual([]);
    expect(report.backupRuns).toBeUndefined();
    expect(report.backupWatermark).toBeUndefined();
    expect(report.backupJobs).toBeUndefined();
    expect(report.hostPatches).toBeUndefined();
    expect(report.problems.messages).toContain("refused the API token");
    expect(report.problems.backups).toBe(report.problems.messages);
    // Once refused, it is not asked again in the same read.
    expect(answered).toBe(4);
  });

  test("a network failure is said in the transport's words, never with the token", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(true), {
        transport: (): Promise<XcpNgHttpResponse> => {
          return Promise.reject(new Error("connect ETIMEDOUT 10.0.0.5:443"));
        },
      }),
    );
    expect(report.pools).toEqual([]);
    expect(report.problems.messages).toBe(
      "Xen Orchestra at xo.example.test:443 did not answer: connect ETIMEDOUT 10.0.0.5:443",
    );
    expect(report.problems.backups).toContain("ETIMEDOUT");
    expect(report.problems.patches).toContain("ETIMEDOUT");
    expect(JSON.stringify(report).includes(FAKE_XO_TOKEN)).toBe(false);
  });

  test("an answer that is not JSON is said as such", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(), {
        transport: (): Promise<XcpNgHttpResponse> => {
          return Promise.resolve({
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<html>a proxy's login page</html>",
          });
        },
      }),
    );
    expect(report.pools).toEqual([]);
    expect(report.problems.messages).toContain("is not JSON");
  });

  test("a pool whose messages were not read still reports its HA and master, at its watermark", async () => {
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    at(1795000060);
    xo.fail({ pathPrefix: "/rest/v0/messages", status: 500 });

    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first)),
    );
    const production: XcpNgPoolEventsReport = poolOf(
      report,
      LAB_POOL_PRODUCTION,
    );
    expect(production.messages).toEqual([]);
    expect(production.messageWatermark).toEqual(
      poolOf(first, LAB_POOL_PRODUCTION).messageWatermark,
    );
    expect(production.poolState?.haEnabled).toBe(true);
    expect(report.problems.messages).toBe(
      "Xen Orchestra at xo.example.test:443 answered HTTP 500.",
    );
  });
});

describe("backups", () => {
  test("the first read: the last eight days' runs, oldest first, and every job with its schedules", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );

    // The run of 1794182400000 is older than eight days: not read.
    expect(runIds(report)).toEqual([
      "1794909600000",
      "1794996000000",
      "1794997800000",
      "1794999600000",
    ]);
    expect(report.backupWatermark?.readSince).toBe(1794999600000);
    expect(report.backupWatermark?.trackedRuns).toEqual([]);
    expect(
      (report.backupJobs || []).map((job: XcpNgBackupJobInfo): string => {
        return job.name;
      }),
    ).toEqual(["Nightly delta", "Weekly full", "Pool metadata", "Old archive"]);
    expect(report.problems.backups).toBeUndefined();
  });

  test("a run still pending is followed by its id and delivered once, when it ends", async () => {
    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    const pending: FakeXoRecord = {
      id: "1795000030000",
      jobId: "59af07fc-e82c-43b5-8137-026832f30166",
      jobName: "Nightly delta",
      message: "backup",
      start: 1795000030000,
      status: "pending",
    };
    xo.addBackupLog(pending);
    at(1795000060);
    const second: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first)),
    );
    expect(second.backupRuns).toEqual([]);
    expect(second.backupWatermark?.trackedRuns).toEqual([
      { runId: "1795000030000", start: 1795000030000 },
    ]);

    xo.replaceBackupLog({
      ...pending,
      end: 1795000090000,
      status: "success",
      tasks: [
        {
          data: {
            type: "VM",
            id: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
            name_label: "web-01",
          },
          status: "success",
          start: 1795000031000,
          end: 1795000089000,
        },
      ],
    });
    at(1795000120);
    const third: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), second)),
    );
    expect(runIds(third)).toEqual(["1795000030000"]);
    expect(third.backupWatermark?.trackedRuns).toEqual([]);

    const fourth: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), third)),
    );
    expect(fourth.backupRuns).toEqual([]);
  });

  test("a run whose full log could not be read is read the next time", async () => {
    let failRun: boolean = true;
    const flaky: (request: XcpNgHttpRequest) => Promise<XcpNgHttpResponse> = (
      request: XcpNgHttpRequest,
    ): Promise<XcpNgHttpResponse> => {
      const url: URL = new URL(request.path, "https://xo.example.test");
      if (failRun && url.pathname === "/rest/v0/backup-logs/1794996000000") {
        return Promise.resolve(injected(503));
      }
      return serve(request);
    };

    const first: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(), { transport: flaky }),
    );
    expect(runIds(first)).toEqual([
      "1794909600000",
      "1794997800000",
      "1794999600000",
    ]);
    expect(first.backupWatermark?.trackedRuns).toEqual([
      { runId: "1794996000000", start: 1794996000000 },
    ]);

    failRun = false;
    at(1795000060);
    const second: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(nextState(freshState(), first), { transport: flaky }),
    );
    expect(runIds(second)).toEqual(["1794996000000"]);
  });

  test("backup logs that cannot be read leave the watermark where it was; the messages still come", async () => {
    xo.fail({ pathPrefix: "/rest/v0/backup-logs", status: 500 });
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    expect(report.backupRuns).toBeUndefined();
    expect(report.backupWatermark).toBeUndefined();
    expect(report.problems.backups).toBe(
      "Xen Orchestra at xo.example.test:443 answered HTTP 500.",
    );
    expect(report.pools).toHaveLength(2);
    expect(report.problems.messages).toBeUndefined();
  });

  test("an older Xen Orchestra without backup logs in its REST API says which version it needs", async () => {
    xo.fail({ pathPrefix: "/rest/v0/backup-logs", status: 404 });
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    expect(report.problems.backups).toContain("6.9 or later");
  });

  test("jobs that cannot be read are not reported as no jobs", async () => {
    xo.fail({ pathPrefix: "/rest/v0/schedules", status: 500 });
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    expect(report.backupJobs).toBeUndefined();
    expect(runIds(report)).toHaveLength(4);
    expect(report.problems.backups).toBeUndefined();
  });

  test("a user without backup-log privileges reads an empty list: no runs, none invented", async () => {
    xo.privileges.delete("backup-log");
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState()),
    );
    expect(report.backupRuns).toEqual([]);
  });
});

describe("patches", () => {
  test("only when due; then each running host of the pools read", async () => {
    await XenOrchestraEventsReader.read(input(freshState()));
    expect(
      xo.requests.some((request: FakeXoRequest): boolean => {
        return request.path.includes("missing_patches");
      }),
    ).toBe(false);

    xo.requests.length = 0;
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(true)),
    );
    expect(
      (report.hostPatches || []).map((host: XcpNgHostPatches): string => {
        return `${host.hostId}:${host.patchCount}`;
      }),
    ).toEqual([
      "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7:0",
      "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d:1",
      "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d:3",
    ]);
    // xcp-prod-03 is halted: it cannot say what it misses.
    expect(
      xo.requests.some((request: FakeXoRequest): boolean => {
        return request.path.includes("f0e1d2c3-b4a5-4968-8776-655443322110");
      }),
    ).toBe(false);
  });

  test("only the hosts of the pools this connection reads", async () => {
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(true), { poolIds: [LAB_POOL_UNNAMED] }),
    );
    expect(
      (report.hostPatches || []).map((host: XcpNgHostPatches): string => {
        return host.hostId;
      }),
    ).toEqual(["6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d"]);
  });

  test("an Appliance whose plan does not list patches is said so, in those words", async () => {
    xo.patchesLicensed = false;
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(true)),
    );
    expect(report.hostPatches).toBeUndefined();
    expect(report.problems.patches).toContain("HTTP 403");
    expect(report.problems.patches).toContain("a plan that includes them");
    // The other parts are not touched by it.
    expect(report.problems.messages).toBeUndefined();
    expect(runIds(report)).toHaveLength(4);
  });
});

describe("a read that takes too long", () => {
  test("leaves the backups for next time, and says so", async () => {
    let ticks: number = 0;
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(freshState(), {
        budgetInMs: 500,
        now: (): Date => {
          // Each look at the clock is a second on.
          ticks++;
          return new Date(nowMs + ticks * 1000);
        },
      }),
    );
    expect(report.pools).toHaveLength(2);
    expect(report.backupRuns).toBeUndefined();
    expect(report.backupWatermark).toBeUndefined();
    expect(report.warnings).toEqual([
      "Backups were not read this time: reading Xen Orchestra took too long. They are read next time.",
    ]);
  });
});

describe("end to end: the probe, the ingest and the watermark the server keeps", () => {
  const PROJECT: ObjectID = new ObjectID(
    "8f3b2a10-0000-4000-8000-0000000000aa",
  );
  const PRODUCTION_ID: string = "6b3f2a10-0000-4000-8000-0000000000aa";
  const LAB_ID: string = "6b3f2a10-0000-4000-8000-0000000000bb";

  const INGEST_POOLS: Array<XcpNgPoolEventsIngestPool> = [
    {
      xcpNgPoolId: new ObjectID(PRODUCTION_ID),
      poolIdentifier: LAB_POOL_PRODUCTION,
    },
    { xcpNgPoolId: new ObjectID(LAB_ID), poolIdentifier: LAB_POOL_UNNAMED },
  ];

  function records(preparation: XcpNgPoolEventsPreparation): Array<JSONObject> {
    return preparation.resourceLogs.flatMap(
      (logs: JSONObject): Array<JSONObject> => {
        return (logs["scopeLogs"] as JSONArray).flatMap(
          (scope: unknown): Array<JSONObject> => {
            return (scope as JSONObject)["logRecords"] as Array<JSONObject>;
          },
        );
      },
    );
  }

  function attribute(record: JSONObject, key: string): string | undefined {
    for (const entry of (record["attributes"] || []) as JSONArray) {
      if ((entry as JSONObject)["key"] === key) {
        return String(
          (((entry as JSONObject)["value"] || {}) as JSONObject)["stringValue"],
        );
      }
    }
    return undefined;
  }

  function messageNames(
    preparation: XcpNgPoolEventsPreparation,
  ): Array<string> {
    return records(preparation)
      .filter((record: JSONObject): boolean => {
        return (
          attribute(record, XcpNgEventLogAttribute.MessageState) === "raised"
        );
      })
      .map((record: JSONObject): string => {
        return attribute(record, XcpNgEventLogAttribute.MessageName) as string;
      });
  }

  /*
   * One collection: the job from what the server stored, a reader made
   * anew (the probe keeps nothing between collections), the ingest.
   */
  async function collect(
    store: MemoryXcpNgPoolEventsStore,
    options: { commit?: boolean; summary?: TokenSummary } = {},
  ): Promise<XcpNgPoolEventsPreparation> {
    const job: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: INGEST_POOLS,
      now: new Date(nowMs),
      store: store,
    });
    const report: XcpNgEventsReport = await XenOrchestraEventsReader.read(
      input(job, { tokenSummary: options.summary || READ_ONLY }),
    );
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          pools: INGEST_POOLS,
          events: report,
          xenOrchestraName: "xo-paris",
          now: new Date(nowMs),
        },
        store,
      );
    if (options.commit !== false) {
      await preparation.commit();
    }
    return preparation;
  }

  test("a crash alerts in the collection that reads it; a restart neither loses nor repeats; a dismissal clears", async () => {
    const store: MemoryXcpNgPoolEventsStore = makeXcpNgLabStore({
      productionId: PRODUCTION_ID,
      labId: LAB_ID,
    });

    // Minute 0: connected. What XAPI said before is not raised.
    at(1795000000);
    const connected: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(connected)).toEqual([]);

    // Minute 1: web-01 crashed at :30, and its record is in this collection.
    at(1795000060);
    const minuteOne: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(minuteOne)).toEqual([
      "VM_CRASHED",
      "ALARM",
      "VM_STARTED",
      "VM_SNAPSHOTTED",
    ]);
    const crash: JSONObject = records(minuteOne).find(
      (record: JSONObject): boolean => {
        return (
          attribute(record, XcpNgEventLogAttribute.MessageName) === "VM_CRASHED"
        );
      },
    ) as JSONObject;
    expect(attribute(crash, XcpNgEventLogAttribute.ObjectName)).toBe("web-01");
    expect(attribute(crash, XcpNgEventLogAttribute.MessageAlert)).toBe(
      "vm_crashed",
    );
    expect(attribute(crash, XcpNgEventLogAttribute.MessageId)).toBe(
      VM_CRASHED_ID,
    );
    expect(
      store.feed.some((line: { markdown: string }): boolean => {
        return line.markdown.startsWith("**VM crashed**: web-01.");
      }),
    ).toBe(true);

    // The probe restarts: nothing of it survives but what the server stored.
    at(1795000120);
    const minuteTwo: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(minuteTwo)).toEqual([
      "HA_HOST_FAILED",
      "PBD_PLUG_FAILED_ON_SERVER_START",
      "SM_GC_NO_SPACE",
      "BOND_STATUS_CHANGED",
      "MULTIPATH_PERIODIC_ALERT",
      "HA_POOL_DROP_IN_PLAN_EXISTS_FOR",
      "ALARM",
    ]);

    // Someone dismisses the crash in Xen Orchestra.
    xo.dismiss(VM_CRASHED_ID);
    at(1795000180);
    const minuteThree: XcpNgPoolEventsPreparation = await collect(store);
    const cleared: Array<JSONObject> = records(minuteThree).filter(
      (record: JSONObject): boolean => {
        return (
          attribute(record, XcpNgEventLogAttribute.MessageState) === "cleared"
        );
      },
    );
    expect(
      cleared.map((record: JSONObject): string | undefined => {
        return attribute(record, XcpNgEventLogAttribute.MessageId);
      }),
    ).toEqual([VM_CRASHED_ID]);
    expect(messageNames(minuteThree)).toEqual([
      "POOL_MASTER_TRANSITION",
      "HA_STATEFILE_LOST",
      "HA_PROTECTED_VM_RESTART_FAILED",
      "ACME_PLUGIN_NOTICE",
    ]);

    // Over the four minutes, every message once.
    const raised: Array<string | undefined> = [
      connected,
      minuteOne,
      minuteTwo,
      minuteThree,
    ]
      .flatMap(records)
      .filter((record: JSONObject): boolean => {
        return (
          attribute(record, XcpNgEventLogAttribute.MessageState) === "raised"
        );
      })
      .map((record: JSONObject): string | undefined => {
        return attribute(record, XcpNgEventLogAttribute.MessageId);
      });
    expect(raised).toHaveLength(15);
    expect(new Set(raised).size).toBe(raised.length);

    // A minute with nothing new raises nothing and clears nothing again.
    at(1795000240);
    const quiet: XcpNgPoolEventsPreparation = await collect(store);
    expect(
      records(quiet).filter((record: JSONObject): boolean => {
        return attribute(record, XcpNgEventLogAttribute.Kind) === "message";
      }),
    ).toEqual([]);
  });

  test("a report the server could not commit is taken in again: nothing is lost", async () => {
    const store: MemoryXcpNgPoolEventsStore = makeXcpNgLabStore({
      productionId: PRODUCTION_ID,
      labId: LAB_ID,
    });
    at(1795000000);
    await collect(store);

    // The server queued minute one's records, and died before committing.
    at(1795000060);
    const lost: XcpNgPoolEventsPreparation = await collect(store, {
      commit: false,
    });
    expect(messageNames(lost)).toContain("VM_CRASHED");

    at(1795000120);
    const again: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(again)).toContain("VM_CRASHED");
    expect(messageNames(again)).toContain("HA_HOST_FAILED");
  });

  test("a pool's write that failed is read again; the other pool's is kept", async () => {
    const store: MemoryXcpNgPoolEventsStore = makeXcpNgLabStore({
      productionId: PRODUCTION_ID,
      labId: LAB_ID,
    });
    at(1795000000);
    await collect(store);

    at(1795000060);
    store.failWritesFor.add(PRODUCTION_ID);
    await collect(store);
    store.failWritesFor.clear();

    at(1795000120);
    const next: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(next)).toContain("VM_CRASHED");
    // The lab pool's snapshot was committed: not raised again.
    expect(messageNames(next)).not.toContain("VM_SNAPSHOTTED");
  });

  test("a failed backup job names its VMs on their pool, and their last backup moves", async () => {
    const store: MemoryXcpNgPoolEventsStore = makeXcpNgLabStore({
      productionId: PRODUCTION_ID,
      labId: LAB_ID,
    });
    at(1795000000);
    const first: XcpNgPoolEventsPreparation = await collect(store);

    const failed: JSONObject = records(first).find(
      (record: JSONObject): boolean => {
        return (
          attribute(record, XcpNgEventLogAttribute.BackupStatus) ===
            "failure" &&
          attribute(record, XcpNgEventLogAttribute.BackupJobName) ===
            "Nightly delta"
        );
      },
    ) as JSONObject;
    expect(attribute(failed, XcpNgEventLogAttribute.BackupFailedVms)).toBe(
      "web-01, app-02",
    );
    expect(
      store.lastBackups.get("e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c"),
    ).toMatchObject({
      lastBackupStatus: "failure",
      lastBackupJobName: "Nightly delta",
    });
    expect(
      store.feed.filter((line: { markdown: string }): boolean => {
        return line.markdown.startsWith("Backup job Nightly delta failed");
      }),
    ).toHaveLength(1);
    // The lab pool's VM backed up fine in the same run: no failure there.
    expect(
      store.feed.some(
        (line: { markdown: string; xcpNgPoolId: string }): boolean => {
          return (
            line.xcpNgPoolId === LAB_ID && line.markdown.includes("failed")
          );
        },
      ),
    ).toBe(false);

    // The same runs are not taken in twice.
    at(1795000060);
    const second: XcpNgPoolEventsPreparation = await collect(store);
    expect(
      records(second).filter((record: JSONObject): boolean => {
        return attribute(record, XcpNgEventLogAttribute.Kind) === "backup";
      }),
    ).toEqual([]);
  });

  test("a token that may not read alarms: the pool's alarms stay as they were", async () => {
    const store: MemoryXcpNgPoolEventsStore = makeXcpNgLabStore({
      productionId: PRODUCTION_ID,
      labId: LAB_ID,
    });
    at(1795000000);
    await collect(store);
    const watermarkBefore: unknown = JSON.parse(
      JSON.stringify(store.pools.get(PRODUCTION_ID)?.eventState),
    );

    at(1795000060);
    const blocked: XcpNgPoolEventsPreparation = await collect(store, {
      summary: { ...READ_ONLY, canReadAlarms: false },
    });
    expect(messageNames(blocked)).toEqual([]);
    expect(
      (
        JSON.parse(
          JSON.stringify(store.pools.get(PRODUCTION_ID)?.eventState),
        ) as JSONObject
      )["messageWatermark"],
    ).toEqual((watermarkBefore as JSONObject)["messageWatermark"]);

    // Fixed: the crash comes through, late but once.
    at(1795000120);
    const fixed: XcpNgPoolEventsPreparation = await collect(store);
    expect(messageNames(fixed)).toContain("VM_CRASHED");
  });
});
