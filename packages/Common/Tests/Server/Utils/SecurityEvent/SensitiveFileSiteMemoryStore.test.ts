import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../../Server/Infrastructure/Redis";
import logger from "../../../../Server/Utils/Logger";
import SensitiveFileSiteMemoryStore, {
  SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE,
  SENSITIVE_FILE_MEMORY_EXPIRES_IN_SECONDS,
  SensitiveFileMemoryScan,
  getSensitiveFileMemoryKey,
} from "../../../../Server/Utils/SecurityEvent/SensitiveFileSiteMemoryStore";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE } from "../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  MAX_SENSITIVE_FILE_MEMORY_BYTES,
  SENSITIVE_FILE_MEMORY_IN_HOURS,
  SENSITIVE_FILE_MEMORY_VERSION,
  getSensitiveFileRequestPath,
} from "../../../../Utils/SecurityEvent/SensitiveFileAnswers";
import { SensitiveFileAnswer } from "../../../../Utils/SecurityEvent/SensitiveFileProbe";
import { logLine } from "../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * WHAT EACH SITE ANSWERED, KEPT FROM SCAN TO SCAN (#11036), AND WHAT IT COSTS.
 *
 * The scan's memory reads the cache once a scan - when a page first holds an
 * answer nothing recorded the type of - and writes it at most once, at the
 * scan's end, when a page taught it something. Pinned over a cache that
 * counts what it is asked:
 *
 *   - THE COST BOUND: one read and one write for a scan of fifty pages and a
 *     hundred sites, and the value it writes within its byte budget; none
 *     for a scan with nothing to judge or keep;
 *   - a lone /.env caught by what the scan before kept, and what was kept
 *     never lost by a scan that had nothing to ask it;
 *   - with no cache, or a cache that fails, every request judged by its page
 *     and the scan's own pages, never a scan that fails.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000c1036",
);
const NOW: Date = new Date("2026-11-27T12:00:00.000Z");

function siteOf(index: number): string {
  return `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

let lineNumber: number = 0;

function request(data: {
  site: string;
  target: string;
  status: number;
  size: number;
  at?: Date;
}): NormalizedSecurityEvent {
  lineNumber++;

  const [event] = SecurityLogParser.parse({
    ...logLine(
      `198.51.100.23 - - [27/Nov/2026:11:00:00 +0000] "GET ${data.target} HTTP/1.1" ${data.status} ${data.size} "-" "Mozilla/5.0 zgrab/0.x"`,
      {},
      `0192f1a0-0000-7000-8000-${String(lineNumber).padStart(12, "0")}`,
    ),
    time: data.at || new Date(NOW.getTime() - 10 * 60 * 1000),
    resourceId: data.site,
    resourceType: "Service",
  });

  return event!;
}

function answers(
  events: Array<NormalizedSecurityEvent>,
): Record<string, string> {
  const byPath: Record<string, string> = {};

  for (const event of events) {
    byPath[getSensitiveFileRequestPath(event)] = String(
      event.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE],
    );
  }

  return byPath;
}

// The cache, as a map, and what it was asked.
interface FakeCache {
  values: Map<string, JSONObject>;
  reads: Array<string>;
  writes: Array<{ key: string; value: JSONObject; expiresInSeconds: number }>;
}

let cache: FakeCache;

function installCache(options: { connected?: boolean } = {}): void {
  cache = { values: new Map(), reads: [], writes: [] };

  jest
    .spyOn(Redis, "isConnected")
    .mockReturnValue(
      options.connected === undefined ? true : options.connected,
    );

  jest
    .spyOn(GlobalCache, "getJSONObject")
    .mockImplementation(
      async (namespace: string, key: string): Promise<JSONObject | null> => {
        cache.reads.push(`${namespace}-${key}`);
        const value: JSONObject | undefined = cache.values.get(
          `${namespace}-${key}`,
        );
        // What the cache hands back is a copy, as JSON read from it is.
        return value ? (JSON.parse(JSON.stringify(value)) as JSONObject) : null;
      },
    );

  jest
    .spyOn(GlobalCache, "setJSON")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: JSONObject,
        options?: { expiresInSeconds: number },
      ): Promise<void> => {
        cache.writes.push({
          key: `${namespace}-${key}`,
          value,
          expiresInSeconds: options?.expiresInSeconds || 0,
        });
        cache.values.set(
          `${namespace}-${key}`,
          JSON.parse(JSON.stringify(value)) as JSONObject,
        );
      },
    );
}

function forScan(
  scan: SensitiveFileMemoryScan = SensitiveFileMemoryScan.Logs,
): SensitiveFileSiteMemoryStore {
  return SensitiveFileSiteMemoryStore.forScan({
    projectId: PROJECT_ID,
    scan,
    now: NOW,
  });
}

const KEY: string = `${SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE}-${PROJECT_ID.toString()}-${SensitiveFileMemoryScan.Logs}`;

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a lone /.env, caught by what the scan before kept", () => {
  test("one scan learns the site answers 404; the next catches the lone /.env it served", async () => {
    installCache();

    const first: SensitiveFileSiteMemoryStore = forScan();

    await first.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await first.save();

    const second: SensitiveFileSiteMemoryStore = forScan();
    const stored: Array<NormalizedSecurityEvent> = await second.judge([
      request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
    ]);

    expect(answers(stored)).toEqual({ "/.env": SensitiveFileAnswer.File });
    expect(stored[0]!.message).toBe("Sensitive file served: GET /.env → 200");
  });

  test("and leaves it out when what was kept says it is the site's own page", async () => {
    installCache();

    const first: SensitiveFileSiteMemoryStore = forScan();

    await first.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
      request({
        site: siteOf(1),
        target: "/.aws/credentials",
        status: 200,
        size: 1789,
      }),
      request({ site: siteOf(1), target: "/.npmrc", status: 200, size: 1789 }),
    ]);
    await first.save();

    const second: SensitiveFileSiteMemoryStore = forScan();

    expect(
      answers(
        await second.judge([
          request({
            site: siteOf(1),
            target: "/.env",
            status: 200,
            size: 1789,
          }),
        ]),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.OwnPage });
  });

  test("the log scan's memory and the trace scan's are each their own", async () => {
    installCache();

    const logs: SensitiveFileSiteMemoryStore = forScan(
      SensitiveFileMemoryScan.Logs,
    );

    await logs.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await logs.save();
    // It read what was kept before writing over it.
    expect(cache.reads).toEqual([KEY]);
    cache.reads = [];

    const traces: SensitiveFileSiteMemoryStore = forScan(
      SensitiveFileMemoryScan.Traces,
    );

    expect(
      await traces.judge([
        request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
      ]),
    ).toEqual([]);
    expect(cache.reads).toEqual([
      `${SENSITIVE_FILE_MEMORY_CACHE_NAMESPACE}-${PROJECT_ID.toString()}-traces`,
    ]);
  });
});

describe("THE COST BOUND: one read and at most one write a scan", () => {
  test("a scan of fifty pages and a hundred sites reads once and writes once, and what it writes is within its budget", async () => {
    installCache();

    const store: SensitiveFileSiteMemoryStore = forScan();
    let stored: number = 0;

    for (let pageIndex: number = 0; pageIndex < 50; pageIndex++) {
      const events: Array<NormalizedSecurityEvent> = [];

      for (let site: number = 0; site < 100; site++) {
        // Each site's own lone request, a different path each page, the same size.
        events.push(
          request({
            site: siteOf(site),
            target: `/.env.${pageIndex}`,
            status: 200,
            size: 1789,
          }),
        );
      }

      stored += (await store.judge(events)).length;
    }

    await store.save();

    expect(cache.reads).toEqual([KEY]);
    expect(store.reads).toBe(1);
    expect(cache.writes).toHaveLength(1);
    expect(store.writes).toBe(1);
    // The first page's lone requests are no event; from the second on, each site's page is known.
    expect(stored).toBe(49 * 100);

    const bytes: number = Buffer.byteLength(
      JSON.stringify(cache.writes[0]!.value),
      "utf8",
    );

    expect(bytes).toBeLessThanOrEqual(MAX_SENSITIVE_FILE_MEMORY_BYTES);
  });

  test("a read only once a page needs it: refusals and attacks ask the cache nothing", async () => {
    installCache();

    const store: SensitiveFileSiteMemoryStore = forScan();

    await store.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await store.judge([
      request({ site: siteOf(2), target: "/.env", status: 403, size: 162 }),
    ]);

    expect(cache.reads).toEqual([]);

    // Its first answer nothing recorded: one read, then never again.
    await store.judge([
      request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
    ]);
    await store.judge([
      request({ site: siteOf(3), target: "/.env", status: 200, size: 412 }),
    ]);

    expect(cache.reads).toEqual([KEY]);
  });

  test("nothing learnt, nothing written - and no read for it either", async () => {
    installCache();

    const store: SensitiveFileSiteMemoryStore = forScan();

    await store.judge([]);
    // A refusal that says nothing of the site, an empty answer.
    await store.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 403,
        size: 162,
      }),
    ]);
    await store.save();

    expect(cache.reads).toEqual([]);
    expect(cache.writes).toEqual([]);
  });

  test("a scan that learnt only what was kept already writes nothing again", async () => {
    installCache();

    const first: SensitiveFileSiteMemoryStore = forScan();

    await first.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await first.save();

    const second: SensitiveFileSiteMemoryStore = forScan();

    await second.judge([
      request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
    ]);
    // The same 404 again, minutes later: held already.
    await second.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
        at: new Date(NOW.getTime() - 5 * 60 * 1000),
      }),
    ]);

    const writesBefore: number = cache.writes.length;

    // Only the served file is new: one write for it.
    await second.save();
    expect(cache.writes.length - writesBefore).toBe(1);

    const third: SensitiveFileSiteMemoryStore = forScan();

    await third.judge([
      request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
    ]);
    await third.save();

    // The same file, again, learns nothing new.
    expect(cache.writes.length - writesBefore).toBe(1);
  });

  test("kept for a day, under the project and the scan", async () => {
    installCache();

    const store: SensitiveFileSiteMemoryStore = forScan();

    await store.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await store.save();

    expect(cache.writes).toHaveLength(1);
    expect(cache.writes[0]!.key).toBe(KEY);
    expect(cache.writes[0]!.expiresInSeconds).toBe(
      SENSITIVE_FILE_MEMORY_EXPIRES_IN_SECONDS,
    );
    expect(SENSITIVE_FILE_MEMORY_EXPIRES_IN_SECONDS).toBe(
      SENSITIVE_FILE_MEMORY_IN_HOURS * 60 * 60,
    );
    expect(
      getSensitiveFileMemoryKey({
        projectId: PROJECT_ID,
        scan: SensitiveFileMemoryScan.Traces,
      }),
    ).toBe(`${PROJECT_ID.toString()}-traces`);
    expect(cache.writes[0]!.value["version"]).toBe(
      SENSITIVE_FILE_MEMORY_VERSION,
    );
  });
});

describe("what was kept is never lost", () => {
  test("a scan that never needed the memory reads it before it writes, so what the scans before kept stays", async () => {
    installCache();

    const first: SensitiveFileSiteMemoryStore = forScan();

    await first.judge([
      request({
        site: siteOf(1),
        target: "/.aws/credentials",
        status: 200,
        size: 1789,
      }),
      request({ site: siteOf(1), target: "/.npmrc", status: 200, size: 1789 }),
    ]);
    await first.save();
    cache.reads = [];

    // Another site's 404: nothing to judge, something to keep.
    const second: SensitiveFileSiteMemoryStore = forScan();

    await second.judge([
      request({
        site: siteOf(2),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);

    expect(cache.reads).toEqual([]);

    await second.save();

    // One read, at the save, before its one write.
    expect(cache.reads).toEqual([KEY]);
    expect(second.reads).toBe(1);
    expect(second.writes).toBe(1);

    const kept: JSONObject = cache.values.get(KEY)!;

    expect(Object.keys(kept["sites"] as JSONObject).sort()).toEqual(
      [`${siteOf(1)}|`, `${siteOf(2)}|`].sort(),
    );
  });

  test("a value of another shape in the cache reads as a memory that says nothing", async () => {
    installCache();
    cache.values.set(KEY, { version: 99, sites: { [`${siteOf(1)}|`]: {} } });

    const store: SensitiveFileSiteMemoryStore = forScan();

    expect(
      await store.judge([
        request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
      ]),
    ).toEqual([]);
  });
});

describe("no cache, or a cache that fails: never a reason to fail a scan, or to call an answer the file", () => {
  test("no cache: nothing read or written, and the scan's own pages still teach each other", async () => {
    installCache({ connected: false });

    const store: SensitiveFileSiteMemoryStore = forScan();

    await store.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);

    expect(
      answers(
        await store.judge([
          request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
        ]),
      ),
    ).toEqual({ "/.env": SensitiveFileAnswer.File });

    await store.save();

    expect(cache.reads).toEqual([]);
    expect(cache.writes).toEqual([]);
    expect(store.reads).toBe(0);
    expect(store.writes).toBe(0);
  });

  test("a read that fails: the request is judged by its page, and the scan goes on", async () => {
    installCache();
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockRejectedValue(new Error("ECONNRESET"));

    const store: SensitiveFileSiteMemoryStore = forScan();

    expect(
      await store.judge([
        request({ site: siteOf(1), target: "/.env", status: 200, size: 412 }),
      ]),
    ).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(logger.warn).mock.calls[0]![0])).toContain(
      "could not read",
    );
  });

  test("a write that fails is logged, and kept for the next save", async () => {
    installCache();
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockRejectedValueOnce(new Error("OOM command not allowed"));

    const store: SensitiveFileSiteMemoryStore = forScan();

    await store.judge([
      request({
        site: siteOf(1),
        target: "/.git/config",
        status: 404,
        size: 153,
      }),
    ]);
    await expect(store.save()).resolves.toBeUndefined();
    expect(String(jest.mocked(logger.warn).mock.calls[0]![0])).toContain(
      "could not keep",
    );
    expect(store.getMemory().isChanged).toBe(true);
  });
});
