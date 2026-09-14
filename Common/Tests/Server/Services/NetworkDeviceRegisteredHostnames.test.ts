import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * "Which of THESE addresses already have a device in this project."
 *
 * The probe's discovery-scan result endpoint asks this of every host a sweep
 * found, and the answer decides whether the dashboard offers the host as
 * importable. A WRONG "not registered" is not a cosmetic miss: the reviewer
 * clicks import and a second device appears at an address that already had
 * one.
 *
 * The walk this replaced got that wrong at scale, and this suite exists to
 * pin the shape that cannot. It paged every device in the project with
 * `ORDER BY createdAt LIMIT 10000 OFFSET n` — and a bulk discovery import
 * stamps every device it creates with the SAME createdAt, so on a fleet of
 * 80,000 devices all 80,000 shared one sort value. LIMIT/OFFSET over a
 * single-valued sort key is not stable: Postgres may return a row twice
 * across two pages and never return another at all, and the row it never
 * returned reads as "not registered". The walk also cost eight sequential
 * full-table scans inside a request the probe synchronously waits on.
 *
 * So the tests here are mostly about STATEMENTS, not results: how many reads
 * are issued, which addresses each one asks about, and — the load-bearing
 * one — that the read count is a function of the SWEEP's size alone and never
 * of what any page returned. Those assertions used to live in the API's own
 * test (App/Tests/Telemetry/ProbeIngestDiscoveryScan.test.ts) because the API
 * did the paging; they belong here now that it does not.
 *
 * No Postgres: findBy is spied on the service singleton and the tests read
 * the query objects it was handed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * Must track HOSTNAME_LOOKUP_CHUNK_SIZE in NetworkDeviceService. Written out
 * rather than imported (it is module-private) so that changing the service
 * constant fails HERE — the number is a promise about the longest literal
 * `IN (...)` list this code will ever hand the planner, and a promise nobody
 * asserts is not a promise.
 */
const CHUNK_SIZE: number = 500;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

let findBySpy: jest.SpyInstance;

function deviceAt(hostname: string): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.hostname = hostname;
  return device;
}

// A row the query returned that carries no hostname at all.
function deviceWithNoHostname(): NetworkDevice {
  return new NetworkDevice();
}

/*
 * `count` distinct, well-formed addresses. Kept under 40 x 256 so every
 * generated address is unique — a duplicate would silently weaken the
 * chunk-arithmetic cases below, which count on the input being distinct.
 */
function addresses(count: number, secondOctet: number = 99): Array<string> {
  const list: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(`10.${secondOctet}.${Math.floor(index / 256)}.${index % 256}`);
  }

  return list;
}

function findByArgs(callIndex: number): JSONObject {
  return findBySpy.mock.calls[callIndex]![0] as JSONObject;
}

function queryOf(callIndex: number): JSONObject {
  return findByArgs(callIndex)["query"] as JSONObject;
}

/*
 * The addresses one read actually asked about. QueryHelper.any renders the
 * chunk into a TypeORM Raw operator — `(alias IN (:...rid))` with a RANDOM
 * parameter name — so the list is recovered from the operator's parameters
 * rather than from a key a test could hard-code.
 */
function askedAboutInCall(callIndex: number): Array<string> {
  const operator: FindOperator<string> = queryOf(callIndex)[
    "hostname"
  ] as unknown as FindOperator<string>;

  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters || {}) as Record<string, unknown>;

  const values: Array<unknown> =
    (Object.values(parameters)[0] as Array<unknown>) || [];

  return values.map((value: unknown): string => {
    return String(value);
  });
}

// Every address asked about, across every read, in the order they were asked.
function askedAbout(): Array<string> {
  const asked: Array<string> = [];

  for (let index: number = 0; index < findBySpy.mock.calls.length; index++) {
    asked.push(...askedAboutInCall(index));
  }

  return asked;
}

function chunkSizes(): Array<number> {
  const sizes: Array<number> = [];

  for (let index: number = 0; index < findBySpy.mock.calls.length; index++) {
    sizes.push(askedAboutInCall(index).length);
  }

  return sizes;
}

beforeEach(() => {
  findBySpy = jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkDeviceService.getDevicesByHostnames — the read it issues", () => {
  it("asks one indexed lookup for the addresses it was given", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "10.0.0.6", "10.0.0.7"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(askedAboutInCall(0)).toEqual(["10.0.0.5", "10.0.0.6", "10.0.0.7"]);
  });

  /*
   * A hostname predicate is the whole point. Without it this is a table scan
   * that happens to be filtered in Node — which is exactly the walk that was
   * removed.
   */
  it("filters by hostname in the database, with an IN list", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    const operator: FindOperator<string> = queryOf(0)[
      "hostname"
    ] as unknown as FindOperator<string>;

    expect(operator.type).toBe("raw");
    expect(operator.getSql!(`"NetworkDevice"."hostname"`)).toMatch(
      /IN \(:\.\.\./,
    );
  });

  /*
   * The addresses come off the wire — a probe reports whatever the sweep saw.
   * They travel as a bound parameter list, never spliced into the statement
   * text.
   */
  it("binds the address list as a parameter rather than writing it into the statement", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ['10.0.0.5\'; DROP TABLE "NetworkDevice"; --'],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    const operator: FindOperator<string> = queryOf(0)[
      "hostname"
    ] as unknown as FindOperator<string>;

    const sql: string = operator.getSql!(`"NetworkDevice"."hostname"`);

    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("10.0.0.5");
    // It is still asked about — as a value.
    expect(askedAboutInCall(0)).toEqual([
      '10.0.0.5\'; DROP TABLE "NetworkDevice"; --',
    ]);
  });

  it("scopes every read to the project it was asked about", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE + 1),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(2);

    for (let index: number = 0; index < 2; index++) {
      expect((queryOf(index)["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
    }
  });

  it("a different project asks a different question", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: OTHER_PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect((queryOf(0)["projectId"] as ObjectID).toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  /*
   * Project and address, and nothing else. Notably NOT `isArchived: false`,
   * which the fleet-counting queries on this service do use: an archived
   * device still occupies its address, so it must still read as registered or
   * an import would create a second device there.
   */
  it("narrows by project and address only", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(Object.keys(queryOf(0)).sort()).toEqual(["hostname", "projectId"]);
  });

  /*
   * The old walk's ORDER BY createdAt is the specific thing that made it
   * wrong — every row of a bulk import shares one createdAt, so ordering by
   * it ordered nothing, and the OFFSET pages that rode on it overlapped and
   * skipped. Nothing here may sort, and nothing here may offset.
   */
  it("never orders the read and never offsets into it", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE * 2 + 3),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(3);

    for (let index: number = 0; index < 3; index++) {
      expect(findByArgs(index)["sort"]).toEqual({});
      expect((findByArgs(index)["sort"] as JSONObject)["createdAt"]).toBe(
        undefined,
      );
      expect(findByArgs(index)["skip"]).toBe(0);
      expect(findByArgs(index)["limit"]).toBe(LIMIT_MAX);
    }
  });

  it("keeps the caller's select and always reads the hostname it keys by", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { _id: true, monitoringMethod: true },
      props: ROOT_PROPS,
    });

    expect(findByArgs(0)["select"]).toEqual({
      _id: true,
      monitoringMethod: true,
      hostname: true,
    });
  });

  it("a caller that selects nothing still gets the hostname", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: {},
      props: ROOT_PROPS,
    });

    expect(findByArgs(0)["select"]).toEqual({ hostname: true });
  });

  /*
   * The returned Map is keyed by hostname, so a caller that opted the column
   * out would get a map of nothing. The column is forced on, not trusted.
   */
  it("a caller that opts the hostname out is overruled", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      select: { hostname: false },
      props: ROOT_PROPS,
    });

    expect((findByArgs(0)["select"] as JSONObject)["hostname"]).toBe(true);
  });

  it("hands the caller's props through to every read", async () => {
    const props: DatabaseCommonInteractionProps = { isRoot: true };

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE + 1),
      select: { _id: true },
      props: props,
    });

    expect(findByArgs(0)["props"]).toBe(props);
    expect(findByArgs(1)["props"]).toBe(props);
  });
});

describe("NetworkDeviceService.getDevicesByHostnames — chunking", () => {
  /*
   * The whole list is rendered into the statement text as a literal
   * `IN (...)`, and a sweep may cover tens of thousands of addresses
   * (ScanTargetUtil.MAX_SCAN_HOSTS). One IN list that long costs more to
   * parse and plan than the lookups it saves.
   */
  it("asks the database nothing when there is nothing to ask about", async () => {
    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: [],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(found.size).toBe(0);
  });

  it("a list of only blank addresses asks the database nothing", async () => {
    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["", "", ""],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(found.size).toBe(0);
  });

  it("one address below the bound is one read", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE - 1),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE - 1]);
  });

  it("exactly the bound is still one read", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE]);
  });

  it("one over the bound splits into a full chunk and a remainder", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE + 1),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE, 1]);
  });

  it("two full chunks are two reads, not three", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE * 2),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE, CHUNK_SIZE]);
  });

  it("one over two full chunks adds a one-address read", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE * 2 + 1),
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1]);
  });

  /*
   * The scale that motivated the change: a /18 sweep. Twenty indexed reads,
   * not one statement with a 10,000-item IN list and not 10,000 statements.
   */
  it("a 10,000-address sweep costs twenty reads", async () => {
    const wanted: Array<string> = addresses(10000);

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: wanted,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(20);

    for (const size of chunkSizes()) {
      expect(size).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  /*
   * A partition, not a sample and not an overlap: every address asked about
   * exactly once, in input order. This is the property the old OFFSET paging
   * could not hold, and losing it is what created duplicate devices.
   */
  it("the chunks partition the input exactly — nothing asked twice, nothing dropped", async () => {
    const wanted: Array<string> = addresses(CHUNK_SIZE * 2 + 137);

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: wanted,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    const asked: Array<string> = askedAbout();

    expect(asked).toEqual(wanted);
    expect(new Set<string>(asked).size).toBe(wanted.length);
  });

  it("the same question chunks the same way every time", async () => {
    const wanted: Array<string> = addresses(CHUNK_SIZE + 7);

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: wanted,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    const first: Array<Array<string>> = [
      askedAboutInCall(0),
      askedAboutInCall(1),
    ];

    findBySpy.mockClear();

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: wanted,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect([askedAboutInCall(0), askedAboutInCall(1)]).toEqual(first);
  });
});

describe("NetworkDeviceService.getDevicesByHostnames — the addresses it asks about", () => {
  it("asks about a repeated address once", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "10.0.0.6", "10.0.0.5", "10.0.0.6"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(askedAboutInCall(0)).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  /*
   * Deduplication happens BEFORE chunking, so a noisy sweep that reports the
   * same handful of addresses hundreds of times still costs one read — not
   * one read per 500 repetitions.
   */
  it("600 repetitions of two addresses is one read, not two", async () => {
    const noisy: Array<string> = [];

    for (let index: number = 0; index < 300; index++) {
      noisy.push("10.0.0.5", "10.0.0.6");
    }

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: noisy,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(askedAboutInCall(0)).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  it("501 entries with only 500 distinct addresses fit in one read", async () => {
    const wanted: Array<string> = addresses(CHUNK_SIZE);

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: [...wanted, wanted[0]!],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE]);
  });

  it("keeps first-seen order when it drops duplicates", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.9", "10.0.0.5", "10.0.0.9", "10.0.0.7"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(askedAboutInCall(0)).toEqual(["10.0.0.9", "10.0.0.5", "10.0.0.7"]);
  });

  /*
   * The API's caller maps a discovered host with no ipAddress to the empty
   * string. Asking the database `hostname IN ('')` would be a wasted lookup,
   * and a device row that somehow carried an empty hostname would come back
   * and flag that host as already registered.
   */
  it("drops blank addresses before it asks", async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "", "10.0.0.6", ""],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(askedAboutInCall(0)).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  /*
   * `Boolean("0")` is true. A hostname of "0" is a strange address but a real
   * value, and dropping it would report a registered device as importable.
   */
  it('the string "0" is a real address, not a blank one', async () => {
    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: ["0", "", "10.0.0.5"],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(askedAboutInCall(0)).toEqual(["0", "10.0.0.5"]);
  });

  /*
   * Dedup runs before chunking, so what decides the number of reads is the
   * DISTINCT count crossing the bound — not the entry count.
   */
  it("1,000 entries covering 501 distinct addresses is two reads", async () => {
    const distinct: Array<string> = addresses(CHUNK_SIZE + 1);
    const noisy: Array<string> = [...distinct];

    while (noisy.length < 1000) {
      noisy.push(distinct[noisy.length % distinct.length]!);
    }

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: noisy,
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE, 1]);
  });

  it("a list that is 500 real addresses plus blanks is still one read", async () => {
    const wanted: Array<string> = addresses(CHUNK_SIZE);

    await NetworkDeviceService.getDevicesByHostnames({
      projectId: PROJECT_ID,
      hostnames: [...wanted, "", "", ""],
      select: { _id: true },
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE]);
  });
});

describe("NetworkDeviceService.getDevicesByHostnames — the map it returns", () => {
  it("keys each device it found by its address", async () => {
    const five: NetworkDevice = deviceAt("10.0.0.5");
    const six: NetworkDevice = deviceAt("10.0.0.6");
    findBySpy.mockResolvedValue([five, six]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5", "10.0.0.6"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(found.size).toBe(2);
    expect(found.get("10.0.0.5")).toBe(five);
    expect(found.get("10.0.0.6")).toBe(six);
  });

  it("an address with no device is simply absent", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.5")]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5", "10.0.0.6"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(found.has("10.0.0.5")).toBe(true);
    expect(found.has("10.0.0.6")).toBe(false);
  });

  /*
   * A row with no hostname cannot answer "is this address registered", and
   * keying it under "" would make the empty string look registered to any
   * caller that asked about a host with no address.
   */
  it("a row with no hostname is skipped, not keyed under the empty string", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.5"), deviceWithNoHostname()]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(found.size).toBe(1);
    expect(found.has("")).toBe(false);
  });

  it("merges the rows from every chunk into one map", async () => {
    findBySpy
      .mockResolvedValueOnce([deviceAt("10.99.0.0")])
      .mockResolvedValueOnce([deviceAt("10.99.1.244")]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: addresses(CHUNK_SIZE + 1),
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(findBySpy).toHaveBeenCalledTimes(2);
    expect(found.size).toBe(2);
    expect(found.has("10.99.0.0")).toBe(true);
    // Only reachable via the SECOND chunk — the case a lost page used to drop.
    expect(found.has("10.99.1.244")).toBe(true);
  });

  it("returns an empty map when the project has none of these addresses", async () => {
    findBySpy.mockResolvedValue([]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5", "10.0.0.6"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(found.size).toBe(0);
  });

  /*
   * A row keyed by the address it carries, not by the address that was asked
   * for. The two are the same for every query this issues; stated here so
   * that a change to the predicate has to face the question deliberately.
   */
  it("keys a row by the address the row itself carries", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.99")]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(Array.from(found.keys())).toEqual(["10.0.0.99"]);
  });

  /*
   * Two devices at one address is a broken inventory, not something this
   * lookup can resolve. It answers with one of them — the last seen — rather
   * than dropping the address, because "registered" is still the truth.
   */
  it("two rows sharing an address collapse to the last one seen", async () => {
    const first: NetworkDevice = deviceAt("10.0.0.5");
    const second: NetworkDevice = deviceAt("10.0.0.5");
    findBySpy.mockResolvedValue([first, second]);

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        select: { _id: true },
        props: ROOT_PROPS,
      });

    expect(found.size).toBe(1);
    expect(found.get("10.0.0.5")).toBe(second);
  });

  it("a read that fails rejects rather than answering 'none of them'", async () => {
    const boom: Error = new Error("db down");
    findBySpy.mockRejectedValue(boom);

    await expect(
      NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        select: { _id: true },
        props: ROOT_PROPS,
      }),
    ).rejects.toThrow("db down");
  });

  /*
   * A chunk that fails stops the whole lookup. Carrying on would return a
   * partial answer indistinguishable from a complete one — and every address
   * in the chunks it skipped would read as unregistered.
   */
  it("a failure on a later chunk rejects and stops asking", async () => {
    findBySpy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"));

    await expect(
      NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: addresses(CHUNK_SIZE * 3),
        select: { _id: true },
        props: ROOT_PROPS,
      }),
    ).rejects.toThrow("db down");

    // The third chunk is never asked about.
    expect(findBySpy).toHaveBeenCalledTimes(2);
  });
});

describe("NetworkDeviceService.getRegisteredHostnames", () => {
  it("answers with the addresses that already have a device", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.5")]);

    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5", "10.0.0.6"],
        props: ROOT_PROPS,
      });

    expect(registered.has("10.0.0.5")).toBe(true);
    expect(registered.has("10.0.0.6")).toBe(false);
  });

  /*
   * A Set, so the caller's per-host `has` is a hash lookup. The endpoint runs
   * this over every host a sweep found.
   */
  it("answers with a Set", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.5")]);

    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        props: ROOT_PROPS,
      });

    expect(registered).toBeInstanceOf(Set);
    expect(registered.size).toBe(1);
  });

  // Existence is the whole question, so hostname is the only column read.
  it("reads only the column it answers with", async () => {
    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: ROOT_PROPS,
    });

    expect(findByArgs(0)["select"]).toEqual({ hostname: true });
  });

  it("chunks the same way its row-returning sibling does", async () => {
    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE + 1),
      props: ROOT_PROPS,
    });

    expect(chunkSizes()).toEqual([CHUNK_SIZE, 1]);
  });

  it("scopes the question to the project it was given", async () => {
    await NetworkDeviceService.getRegisteredHostnames({
      projectId: OTHER_PROJECT_ID,
      hostnames: ["10.0.0.5"],
      props: ROOT_PROPS,
    });

    expect((queryOf(0)["projectId"] as ObjectID).toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  it("an empty sweep asks nothing and answers with an empty set", async () => {
    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: [],
        props: ROOT_PROPS,
      });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  // The two methods are one query with two shapes of answer.
  it("answers with exactly the keys of the map its sibling returns", async () => {
    findBySpy.mockResolvedValue([deviceAt("10.0.0.5"), deviceAt("10.0.0.7")]);

    const asked: Array<string> = ["10.0.0.5", "10.0.0.6", "10.0.0.7"];

    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: PROJECT_ID,
        hostnames: asked,
        select: { _id: true },
        props: ROOT_PROPS,
      });

    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: asked,
        props: ROOT_PROPS,
      });

    expect(Array.from(registered).sort()).toEqual(
      Array.from(found.keys()).sort(),
    );
  });

  it("collects the answer across every chunk", async () => {
    findBySpy
      .mockResolvedValueOnce([deviceAt("10.99.0.0")])
      .mockResolvedValueOnce([deviceAt("10.99.1.244")]);

    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: addresses(CHUNK_SIZE + 1),
        props: ROOT_PROPS,
      });

    expect(Array.from(registered).sort()).toEqual(["10.99.0.0", "10.99.1.244"]);
  });

  /*
   * Swallowing the failure and answering "none of these are registered" would
   * present every host in the sweep as importable, and the reviewer's import
   * would then duplicate the whole estate. Failing loudly is the safe answer.
   */
  it("a read that fails rejects rather than reporting every host as new", async () => {
    findBySpy.mockRejectedValue(new Error("db down"));

    await expect(
      NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: ["10.0.0.5"],
        props: ROOT_PROPS,
      }),
    ).rejects.toThrow("db down");
  });
});

/*
 * The specific failure mode the old implementation had, asserted directly.
 *
 * The walk kept paging while a page came back full — `if (existing.length <
 * LIMIT_MAX) break;` — so the number of statements it issued was a function
 * of how many devices the PROJECT had. This lookup's cost must depend only on
 * how many addresses the SWEEP found; a full page is just a full page.
 */
describe("NetworkDeviceService hostname lookups — the walk they replaced", () => {
  function fullPage(): Array<NetworkDevice> {
    const page: Array<NetworkDevice> = [];

    for (let index: number = 0; index < LIMIT_MAX; index++) {
      page.push(deviceAt(`10.42.${Math.floor(index / 256)}.${index % 256}`));
    }

    return page;
  }

  it("a full page of results never triggers a follow-up page", async () => {
    findBySpy.mockResolvedValue(fullPage());

    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: ["10.0.0.5", "10.0.0.6"],
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(1);
  });

  it("the number of reads is set by the sweep, not by the size of the fleet", async () => {
    findBySpy.mockResolvedValue(fullPage());

    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE + 1),
      props: ROOT_PROPS,
    });

    // Two chunks of addresses — two reads, regardless of what came back.
    expect(findBySpy).toHaveBeenCalledTimes(2);
  });

  it("no read is ever ordered by createdAt", async () => {
    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE * 3),
      props: ROOT_PROPS,
    });

    expect(findBySpy).toHaveBeenCalledTimes(3);

    for (let index: number = 0; index < 3; index++) {
      const sort: JSONObject = findByArgs(index)["sort"] as JSONObject;
      expect(sort["createdAt"]).toBe(undefined);
    }
  });

  it("no read ever offsets into a result set", async () => {
    await NetworkDeviceService.getRegisteredHostnames({
      projectId: PROJECT_ID,
      hostnames: addresses(CHUNK_SIZE * 3),
      props: ROOT_PROPS,
    });

    for (let index: number = 0; index < 3; index++) {
      expect(findByArgs(index)["skip"]).toBe(0);
    }
  });

  /*
   * The end-to-end shape of the bug: a project whose devices all share one
   * createdAt. Here that is simply irrelevant — the answer is decided by the
   * address predicate, so an address that exists is found on the first and
   * only read that asks about it.
   */
  it("finds an address that a same-createdAt fleet used to hide", async () => {
    const wanted: Array<string> = addresses(CHUNK_SIZE + 1);
    const lastAddress: string = wanted[wanted.length - 1]!;

    findBySpy
      .mockResolvedValueOnce(fullPage())
      .mockResolvedValueOnce([deviceAt(lastAddress)]);

    const registered: Set<string> =
      await NetworkDeviceService.getRegisteredHostnames({
        projectId: PROJECT_ID,
        hostnames: wanted,
        props: ROOT_PROPS,
      });

    expect(registered.has(lastAddress)).toBe(true);
  });
});
