import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import logger from "../../../../Server/Utils/Logger";
import MonitorOpenRecords, {
  MonitorOpenRecordsReading,
  MonitorRecordKind,
  NOTHING_KNOWN,
} from "../../../../Server/Utils/Monitor/MonitorOpenRecords";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a monitor is known to have open, and how every change that can open
 * a record for it makes what was known unusable (MonitorOpenRecords).
 *
 * A result skips reading the monitor's open incidents (or alerts) only when
 * this says none is open; a "none open" that outlived the truth would leave
 * a record unresolved. So the cases here are the ways it could: a change
 * between the read a result made and the "none open" it records, a change
 * to another monitor or project, a token Redis dropped, a Redis that fails.
 *
 * Redis is a map the "servers" share; it can be made to fail.
 */

jest.mock("../../../../Server/Utils/Logger");

let redis: Map<string, string>;
let readsFail: boolean;
let writesFail: boolean;

const monitorId: ObjectID = ObjectID.generate();
const otherMonitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();

function key(namespace: string, name: string): string {
  return `${namespace}-${name}`;
}

beforeEach(() => {
  redis = new Map<string, string>();
  readsFail = false;
  writesFail = false;

  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(async (namespace: string, keys: Array<string>) => {
      if (readsFail) {
        throw new Error("Redis is down");
      }

      return keys.map((name: string) => {
        return redis.get(key(namespace, name)) ?? null;
      });
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, name: string, value: string) => {
        if (writesFail) {
          throw new Error("Redis is down");
        }

        redis.set(key(namespace, name), value);
      },
    );

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, name: string, value: string) => {
        if (writesFail) {
          throw new Error("Redis is down");
        }

        if (redis.has(key(namespace, name))) {
          return false;
        }

        redis.set(key(namespace, name), value);
        return true;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(
  id: ObjectID = monitorId,
  project: ObjectID = projectId,
): Promise<MonitorOpenRecordsReading> {
  return await MonitorOpenRecords.read({ monitorId: id, projectId: project });
}

// What a result does when its read of the monitor's records finds none.
async function recordNoneOpen(
  reading: MonitorOpenRecordsReading,
  kind: MonitorRecordKind = MonitorRecordKind.Incident,
  id: ObjectID = monitorId,
): Promise<void> {
  await MonitorOpenRecords.markNoneOpen({
    monitorId: id,
    kind: kind,
    reading: reading,
  });
}

describe("MonitorOpenRecords", () => {
  test("nothing is known of a monitor no result has read the records of", async () => {
    const reading: MonitorOpenRecordsReading = await read();

    expect(reading.noneOpen).toEqual({
      [MonitorRecordKind.Incident]: false,
      [MonitorRecordKind.Alert]: false,
    });
    // Its tokens were set, so the read the result makes can be recorded.
    expect(reading.stamp).toBeTruthy();
  });

  test("a read that found none open is known on the next result", async () => {
    await recordNoneOpen(await read());

    const next: MonitorOpenRecordsReading = await read();

    expect(next.noneOpen[MonitorRecordKind.Incident]).toBe(true);
    // Incidents and alerts are known apart.
    expect(next.noneOpen[MonitorRecordKind.Alert]).toBe(false);

    await recordNoneOpen(next, MonitorRecordKind.Alert);

    expect((await read()).noneOpen).toEqual({
      [MonitorRecordKind.Incident]: true,
      [MonitorRecordKind.Alert]: true,
    });
  });

  test("a record opened for the monitor makes what was known unusable", async () => {
    await recordNoneOpen(await read());
    await recordNoneOpen(await read(), MonitorRecordKind.Alert);

    await MonitorOpenRecords.forgetMonitors([monitorId]);

    expect((await read()).noneOpen).toEqual({
      [MonitorRecordKind.Incident]: false,
      [MonitorRecordKind.Alert]: false,
    });
  });

  test("a change that lands between a result's read and what it records is never lost", async () => {
    // The result reads what is known, then reads the records: none open.
    const readingBeforeTheRead: MonitorOpenRecordsReading = await read();

    // Meanwhile a record is reopened, and its monitor forgotten.
    await MonitorOpenRecords.forgetMonitors([monitorId]);

    // The result records what its read found, stamped as of before it.
    await recordNoneOpen(readingBeforeTheRead);

    // The next result reads the records again.
    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
  });

  test("the same, for a change to the project's states", async () => {
    const readingBeforeTheRead: MonitorOpenRecordsReading = await read();

    await MonitorOpenRecords.forgetProject(projectId);
    await recordNoneOpen(readingBeforeTheRead);

    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
  });

  test("a change to another monitor or another project leaves this one known", async () => {
    await recordNoneOpen(await read());

    await MonitorOpenRecords.forgetMonitors([otherMonitorId]);
    await MonitorOpenRecords.forgetProject(otherProjectId);

    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(true);
  });

  test("a change to the monitor's project makes it unknown again", async () => {
    await recordNoneOpen(await read());

    await MonitorOpenRecords.forgetProject(projectId);

    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
  });

  test("forgetting everything makes every monitor unknown", async () => {
    await recordNoneOpen(await read());
    await recordNoneOpen(
      await read(otherMonitorId, otherProjectId),
      MonitorRecordKind.Incident,
      otherMonitorId,
    );

    await MonitorOpenRecords.forgetAll();

    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
    expect(
      (await read(otherMonitorId, otherProjectId)).noneOpen[
        MonitorRecordKind.Incident
      ],
    ).toBe(false);
  });

  test("a token Redis dropped is never matched, even by a stamp made without it", async () => {
    const first: MonitorOpenRecordsReading = await read();
    await recordNoneOpen(first);

    // Redis drops the monitor's token (evicted, expired).
    for (const name of Array.from(redis.keys())) {
      if (name.includes("token-monitor-")) {
        redis.delete(name);
      }
    }

    const afterDrop: MonitorOpenRecordsReading = await read();

    expect(afterDrop.noneOpen[MonitorRecordKind.Incident]).toBe(false);
    // A new token, unlike the one before: the old stamp can never match.
    expect(afterDrop.stamp).not.toBe(first.stamp);
  });

  test("a monitor that moved to another project is unknown in its new one", async () => {
    await recordNoneOpen(await read());

    expect(
      (await read(monitorId, otherProjectId)).noneOpen[
        MonitorRecordKind.Incident
      ],
    ).toBe(false);
  });

  test("monitor ids are matched whatever their case", async () => {
    await recordNoneOpen(await read());

    await MonitorOpenRecords.forgetMonitors([
      monitorId.toString().toUpperCase(),
    ]);

    expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
  });

  test("a Redis that cannot be read knows nothing, and never throws", async () => {
    await recordNoneOpen(await read());

    readsFail = true;

    expect(await read()).toEqual(NOTHING_KNOWN);
  });

  test("a stamp that could not be read records nothing", async () => {
    await recordNoneOpen(NOTHING_KNOWN);

    expect(
      Array.from(redis.keys()).some((name: string) => {
        return name.includes("none-open-");
      }),
    ).toBe(false);
  });

  test("a token that cannot be written is a warning, and never throws", async () => {
    writesFail = true;

    await expect(
      MonitorOpenRecords.forgetMonitors([monitorId]),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalled();
  });

  test("tokens that cannot be set leave nothing to record under", async () => {
    writesFail = true;

    expect(await read()).toEqual(NOTHING_KNOWN);
  });

  test("'none open' runs out after NONE_OPEN_TTL_SECONDS", async () => {
    await recordNoneOpen(await read());

    expect(GlobalCache.setString).toHaveBeenCalledWith(
      MonitorOpenRecords.NAMESPACE,
      expect.stringContaining("none-open-incident-"),
      expect.any(String),
      { expiresInSeconds: MonitorOpenRecords.NONE_OPEN_TTL_SECONDS },
    );
    expect(MonitorOpenRecords.NONE_OPEN_TTL_SECONDS).toBeLessThanOrEqual(
      15 * 60,
    );
  });

  describe("the monitors of incidents and alerts that changed", () => {
    let queries: Array<{ sql: string; params: Array<unknown> }>;
    let answer: Array<{ monitorId: string }> | Error;

    beforeEach(() => {
      queries = [];
      answer = [];

      jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
        query: async (sql: string, params: Array<unknown>) => {
          queries.push({ sql, params });

          if (answer instanceof Error) {
            throw answer;
          }

          return answer;
        },
      } as never);
    });

    test("an incident a criteria raised forgets its monitors", async () => {
      await recordNoneOpen(await read());

      answer = [{ monitorId: monitorId.toString() }];

      const incidentId: ObjectID = ObjectID.generate();
      await MonitorOpenRecords.forgetMonitorsOfIncidents([incidentId]);

      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).toContain('"IncidentMonitor"');
      // Only a record a criteria raised is ever resolved by a result.
      expect(queries[0]!.sql).toContain('"createdCriteriaId" IS NOT NULL');
      expect(queries[0]!.params).toEqual([
        [incidentId.toString().toLowerCase()],
      ]);
      expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
    });

    test("an alert a criteria raised forgets its monitor", async () => {
      await recordNoneOpen(await read(), MonitorRecordKind.Alert);

      answer = [{ monitorId: monitorId.toString() }];

      await MonitorOpenRecords.forgetMonitorsOfAlerts([ObjectID.generate()]);

      expect(queries[0]!.sql).toContain('FROM "Alert"');
      expect(queries[0]!.sql).toContain('"createdCriteriaId" IS NOT NULL');
      expect((await read()).noneOpen[MonitorRecordKind.Alert]).toBe(false);
    });

    test("a record no criteria raised forgets nothing", async () => {
      await recordNoneOpen(await read());

      answer = [];

      await MonitorOpenRecords.forgetMonitorsOfIncidents([ObjectID.generate()]);

      expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(true);
    });

    test("no ids, no query", async () => {
      await MonitorOpenRecords.forgetMonitorsOfIncidents([]);
      await MonitorOpenRecords.forgetMonitorsOfAlerts([]);

      expect(queries).toHaveLength(0);
    });

    test("monitors that cannot be found make every monitor unknown", async () => {
      await recordNoneOpen(await read());
      await recordNoneOpen(
        await read(otherMonitorId, otherProjectId),
        MonitorRecordKind.Incident,
        otherMonitorId,
      );

      answer = new Error("canceling statement due to statement timeout");

      await expect(
        MonitorOpenRecords.forgetMonitorsOfIncidents([ObjectID.generate()]),
      ).resolves.toBeUndefined();

      expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
      expect(
        (await read(otherMonitorId, otherProjectId)).noneOpen[
          MonitorRecordKind.Incident
        ],
      ).toBe(false);
    });

    test("a database that is not connected makes every monitor unknown", async () => {
      await recordNoneOpen(await read());

      jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);

      await MonitorOpenRecords.forgetMonitorsOfAlerts([ObjectID.generate()]);

      expect((await read()).noneOpen[MonitorRecordKind.Incident]).toBe(false);
    });
  });
});
