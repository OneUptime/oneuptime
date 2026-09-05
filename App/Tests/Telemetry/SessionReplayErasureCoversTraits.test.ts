import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import RumSessionErasureRequest, {
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import { SESSION_REPLAY_SCHEMA_VERSION } from "Common/Types/Rum/SessionReplay";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Right-to-erasure coverage for the identity traits column.
 *
 * identifiedUserTraits lives on the RumSession header row, under the same
 * narrow ACL as identifiedUserLabel. Erasing a subject has to erase them
 * with the rest of the row, and nothing may write them back afterwards.
 * Two paths could break that promise: an erasure that updated columns
 * instead of deleting rows (it deletes rows), and a finalizer that
 * re-derives a header for a session whose rows are mid-deletion (it checks
 * the tombstone first and writes nothing). These tests pin both, reading
 * the erasure job and the finalizer as they are - neither is modified here.
 */

jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
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

/* In-memory Redis: tombstone set, activity zset, seal hints. */
const sets: Map<string, Set<string>> = new Map<string, Set<string>>();
const strings: Map<string, string> = new Map<string, string>();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          sadd: (
            key: string,
            members: Array<string> | string,
          ): Promise<number> => {
            const set: Set<string> = sets.get(key) || new Set<string>();
            for (const member of Array.isArray(members) ? members : [members]) {
              set.add(member);
            }
            sets.set(key, set);
            return Promise.resolve(set.size);
          },
          smembers: (key: string): Promise<Array<string>> => {
            return Promise.resolve(Array.from(sets.get(key) || []));
          },
          sismember: (key: string, member: string): Promise<number> => {
            return Promise.resolve(sets.get(key)?.has(member) ? 1 : 0);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          get: (key: string): Promise<string | null> => {
            return Promise.resolve(strings.get(key) ?? null);
          },
          set: (key: string, value: string): Promise<"OK"> => {
            strings.set(key, value);
            return Promise.resolve("OK");
          },
        };
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

import {
  buildSessionDeleteStatement,
  resolveTargetSessionIds,
  writeErasureTombstones,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";
import {
  FinalizeSessionOutcome,
  buildFinalizedSessionRow,
  combineTabAggregates,
  finalizeSession,
  parseTabAggregateRow,
  ProvisionalSessionHeader,
} from "../../FeatureSet/Workers/Jobs/Rum/FinalizeSessions";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSessionService from "Common/Server/Services/RumSessionService";

const projectId: ObjectID = new ObjectID("6600000000000000000000a1");
const rumApplicationId: string = "6600000000000000000000b2";
const sessionId: string = "1f0c9a4b6d2e47f8a1b3c5d7e9f00112";
const databaseName: string = "oneuptime";
const startUnixMs: number = new Date("2026-07-29T10:00:00.000Z").getTime();

interface QueryableService {
  executeQuery: unknown;
  insertJsonRows: unknown;
}

const chunkService: QueryableService =
  RumSessionChunkService as unknown as QueryableService;
const sessionService: QueryableService =
  RumSessionService as unknown as QueryableService;

const realChunkExecuteQuery: unknown = chunkService.executeQuery;
const realSessionExecuteQuery: unknown = sessionService.executeQuery;
const realSessionInsertJsonRows: unknown = sessionService.insertJsonRows;

function resultSetOf(rows: Array<JSONObject>): unknown {
  return {
    json: (): Promise<{ data: Array<JSONObject> }> => {
      return Promise.resolve({ data: rows });
    },
  };
}

function traitsHeaderRow(): JSONObject {
  const header: ProvisionalSessionHeader = {
    startTimeText: "2026-07-29 10:00:00.000000000",
    startTimeUnixMs: startUnixMs,
    clientReportedStartTimeText: "2026-07-29 10:00:00.000000000",
    retentionDateText: "2026-08-05",
    rumApplicationId: rumApplicationId,
    primaryEntityId: rumApplicationId,
    primaryEntityType: "RealUserMonitor",
    sealedReason: "",
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    clockSkewMs: 0,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 0,
    entryUrl: "https://shop.example.com/",
    exitUrl: "https://shop.example.com/",
    routes: [],
    browserName: "Chrome",
    browserVersion: "141",
    osName: "macOS",
    deviceType: "desktop",
    viewportWidth: 1440,
    viewportHeight: 900,
    maskingMode: "MaskAllText",
    consentState: "NotRequired",
    recorderKind: "dom",
    recorderVersion: "1.0.0",
    rrwebVersion: "2.1.0",
    countryCode: "",
    identifiedUserKey: "k".repeat(64),
    identifiedUserLabel: "ada@example.com",
    identifiedUserTraits: { plan: "pro", email: "ada@example.com" },
    tags: {},
    traceIds: [],
    exceptionFingerprints: [],
    fidelityNotices: [],
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    wireVersion: 1,
    isLegalHold: false,
    isPinnedCopy: false,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
  };

  return header as unknown as JSONObject;
}

function chunkTabRow(): JSONObject {
  return {
    tabId: "tab-a",
    chunkCount: 1,
    maxChunkIndex: 0,
    chunkIndexes: [0],
    fullSnapshotChunkIndexes: [0],
    eventCount: 10,
    payloadBytes: 1000,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    clickCount: 0,
    customEventCount: 0,
    erroredChunkCount: 0,
    firstErrorOffsetMs: 0,
    activeMs: 0,
    firstUrl: "",
    lastUrl: "",
    firstUrlAtUnixMs: 0,
    lastUrlAtUnixMs: 0,
    urlChunkCount: 0,
    routes: [],
    hasFinalChunk: 0,
    sessionStartUnixMs: startUnixMs,
    firstChunkStartUnixMs: startUnixMs,
    lastChunkEndUnixMs: startUnixMs + 15_000,
    maxChunkEndOffsetMs: 15_000,
    schemaVersion: SESSION_REPLAY_SCHEMA_VERSION,
    recorderKind: "dom",
    rumApplicationId: rumApplicationId,
    primaryEntityId: rumApplicationId,
    primaryEntityType: "RealUserMonitor",
    retentionDate: "2026-08-05",
  };
}

beforeEach(() => {
  sets.clear();
  strings.clear();
});

afterEach(() => {
  chunkService.executeQuery = realChunkExecuteQuery;
  sessionService.executeQuery = realSessionExecuteQuery;
  sessionService.insertJsonRows = realSessionInsertJsonRows;
});

describe("erasure by identified user deletes whole header rows, traits included", () => {
  test("the ByIdentifiedUserKey lookup resolves sessions from the header table by key", async () => {
    let captured: Statement | null = null;

    sessionService.executeQuery = (statement: Statement): Promise<unknown> => {
      captured = statement;
      return Promise.resolve(resultSetOf([{ sessionId: sessionId }]));
    };

    const request: RumSessionErasureRequest = new RumSessionErasureRequest();
    request.projectId = projectId;
    request.requestType = RumSessionErasureRequestType.ByIdentifiedUserKey;
    request.targetValue = "k".repeat(64);
    request.attempts = 0;

    const targets: { sessionIds: Array<string> } =
      await resolveTargetSessionIds({
        databaseName: databaseName,
        request: request,
      });

    expect(targets.sessionIds).toEqual([sessionId]);

    const statement: Statement = captured as unknown as Statement;

    expect(statement.query).toContain("identifiedUserKey =");
    expect(Object.values(statement.query_params)).toContain(
      AnalyticsTableName.RumSession,
    );
  });

  test("the header delete is a row delete, never a column rewrite", () => {
    const statement: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSession,
      projectId: projectId,
      sessionIds: [sessionId],
    });

    const query: string = statement.query;

    expect(query).toContain("ALTER TABLE");
    expect(query).toContain("DELETE WHERE");
    /*
     * No UPDATE and no column list: the whole row goes, so the traits go
     * with the label, the key, the URLs and the country - there is no
     * column an erasure could leave behind.
     */
    expect(query).not.toContain("UPDATE");
    expect(query).not.toContain("identifiedUserTraits");
    expect(query).not.toContain("identifiedUserLabel");
    expect(query).toContain("sessionId IN");
  });

  test("the chunk delete uses the same row-delete shape", () => {
    const statement: Statement = buildSessionDeleteStatement({
      databaseName: databaseName,
      tableName: AnalyticsTableName.RumSessionChunk,
      projectId: projectId,
      sessionIds: [sessionId],
    });

    expect(statement.query).toContain("DELETE WHERE");
    expect(statement.query).not.toContain("UPDATE");
  });
});

describe("a tombstoned session is never re-headered with traits", () => {
  test("the finalizer refuses before reading a single row", async () => {
    await writeErasureTombstones({
      projectId: projectId.toString(),
      sessionIds: [sessionId],
    });

    /* Rows that WOULD carry the traits back if anything read them. */
    let chunkReads: number = 0;
    const inserted: Array<JSONObject> = [];

    chunkService.executeQuery = (): Promise<unknown> => {
      chunkReads++;
      return Promise.resolve(resultSetOf([chunkTabRow()]));
    };
    sessionService.executeQuery = (): Promise<unknown> => {
      return Promise.resolve(resultSetOf([traitsHeaderRow()]));
    };
    sessionService.insertJsonRows = (
      rows: Array<JSONObject>,
    ): Promise<void> => {
      inserted.push(...rows);
      return Promise.resolve();
    };

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("erased");
    expect(chunkReads).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  test("a session that is NOT tombstoned is finalized with its traits carried, for contrast", async () => {
    const inserted: Array<JSONObject> = [];

    chunkService.executeQuery = (statement: Statement): Promise<unknown> => {
      if (statement.query.includes("GROUP BY tabId")) {
        return Promise.resolve(resultSetOf([chunkTabRow()]));
      }
      return Promise.resolve(resultSetOf([traitsHeaderRow()]));
    };
    sessionService.insertJsonRows = (
      rows: Array<JSONObject>,
    ): Promise<void> => {
      inserted.push(...rows);
      return Promise.resolve();
    };

    const outcome: FinalizeSessionOutcome = await finalizeSession({
      projectId: projectId,
      sessionId: sessionId,
      databaseName: databaseName,
    });

    expect(outcome).toBe("written");
    expect(inserted[0]!["identifiedUserTraits"]).toEqual({
      plan: "pro",
      email: "ada@example.com",
    });
  });

  test("the finalized row never invents traits the header did not hold", () => {
    const row: JSONObject = buildFinalizedSessionRow({
      projectId: projectId,
      sessionId: sessionId,
      aggregate: combineTabAggregates([parseTabAggregateRow(chunkTabRow())]),
      header: null,
      traceIds: [],
      exceptionFingerprints: [],
      writtenAt: new Date("2026-07-29T10:20:00.000Z"),
    });

    expect(row["identifiedUserTraits"]).toEqual({});
    expect(row["identifiedUserLabel"]).toBe("");
    expect(row["identifiedUserKey"]).toBe("");
  });
});
