/** @timezone Asia/Kolkata */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudCostRecommendation from "../../../../Models/DatabaseModels/CloudCostRecommendation";
import NetworkDeviceDiscoveryImport from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import SecurityEventConnectionRun from "../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import ToolImportRun from "../../../../Models/DatabaseModels/ToolImportRun";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import CloudCostRecommendationService from "../../../../Server/Services/CloudCostRecommendationService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import NetworkDeviceDiscoveryImportService from "../../../../Server/Services/NetworkDeviceDiscoveryImportService";
import SecurityEventConnectionRunService from "../../../../Server/Services/SecurityEventConnectionRunService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import ToolImportRunService from "../../../../Server/Services/ToolImportRunService";
import Query from "../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import CloudSavingsWriter from "../../../../Server/Utils/CloudConnection/CloudSavingsWriter";
import DiscoveryImportRunner, {
  DISCOVERY_IMPORT_STALE_QUEUED_MS,
} from "../../../../Server/Utils/NetworkDiscovery/DiscoveryImportRunner";
import SecurityEventConnectionRunExecutor from "../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import ToolImportRunExecutor, {
  TOOL_IMPORT_STALE_RUN_MS,
} from "../../../../Server/Utils/ToolImport/ToolImportRunExecutor";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../../Types/ObjectID";
import { TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS } from "../../../../Types/ToolImport/ToolImportLimits";
import {
  DateComparison,
  readDateComparison,
} from "../../TestingUtils/DateComparisonPredicate";

/*
 * THE SERVER'S OWN DATE COMPARISONS, AS POSTGRES GETS THEM (#8200).
 *
 * Every caller on the server that compares a Postgres date column with a
 * Date it built (`new LessThan(date)`): the query it hands its service,
 * serialized as the service serializes it (QueryUtil.serializeQuery), with
 * the instant it binds and which rows it holds. Each meant its threshold
 * to the minute; under the day cut each was off by up to a day:
 *
 *   - security-event runs idle over 20 minutes are failed (worker job
 *     SecurityEvents:PollSecurityEventConnections);
 *   - tool imports Reading or Importing idle over 90 minutes are failed,
 *     and previews nobody started within a day expire (SweepStaleToolImports);
 *   - a discovery import whose job never ran is queued again after 2
 *     minutes (SweepDiscoveryImports);
 *   - a cloud's recommendations this read did not see are removed
 *     (CloudSavingsWriter, every cloud read).
 *
 * The services are stubbed: DateComparisonPostgres.test.ts runs the
 * stale-run check's queries on Postgres. The process runs in Asia/Kolkata,
 * east of UTC, as a server outside UTC would.
 */

const NOW: Date = new Date("2026-11-15T10:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function boundOf<TBaseModel extends BaseModel>(
  modelType: { new (): TBaseModel },
  query: unknown,
  key: string,
): DateComparison {
  const where: Record<string, unknown> = QueryUtil.serializeQuery(
    modelType,
    query as Query<TBaseModel>,
  ) as unknown as Record<string, unknown>;

  return readDateComparison(where[key]);
}

type StubbedService = { mock: { calls: Array<Array<unknown>> } };

// The query a stubbed service was called with.
function queryOf(spy: StubbedService, call: number): unknown {
  return (spy.mock.calls[call]![0] as { query: unknown }).query;
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("security-event runs idle over 20 minutes", () => {
  test("the scheduler looks for runs updated before 09:40:00.000, not before the day", async () => {
    const findRuns: StubbedService = jest
      .spyOn(SecurityEventConnectionRunService, "findAllBy")
      .mockResolvedValue([]);
    jest
      .spyOn(SecurityEventConnectionService, "findAllBy")
      .mockResolvedValue([]);

    await SecurityEventConnectionRunExecutor.enqueueDueConnections();

    const stale: DateComparison = boundOf(
      SecurityEventConnectionRun,
      queryOf(findRuns, 0),
      "updatedAt",
    );

    expect(stale.sql).toBe("(col < '2026-11-15T09:40:00.000Z')");
    expect(stale.matches(minutesAgo(25))).toBe(true);
    expect(stale.matches(minutesAgo(20))).toBe(false);
    expect(stale.matches(minutesAgo(5))).toBe(false);
  });

  test("a run idle 25 minutes is failed only while it is still idle over 20", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
    const update: StubbedService = jest
      .spyOn(SecurityEventConnectionRunService, "updateOneBy")
      .mockResolvedValue(1);

    const run: SecurityEventConnectionRun = new SecurityEventConnectionRun();
    run.id = ObjectID.generate();
    run.updatedAt = minutesAgo(25);

    expect(await SecurityEventConnectionRunExecutor.expireStaleRun(run)).toBe(
      true,
    );

    const stillStale: DateComparison = boundOf(
      SecurityEventConnectionRun,
      queryOf(update, 0),
      "updatedAt",
    );

    expect(stillStale.sql).toBe("(col < '2026-11-15T09:40:00.000Z')");
    // Refreshed by its worker since it was read: left alone.
    expect(stillStale.matches(minutesAgo(1))).toBe(false);
    expect(stillStale.matches(minutesAgo(25))).toBe(true);
  });
});

describe("tool imports", () => {
  test("a run idle over 90 minutes is stuck, and a preview older than a day expires", async () => {
    const find: StubbedService = jest
      .spyOn(ToolImportRunService, "findBy")
      .mockResolvedValue([]);

    await ToolImportRunExecutor.sweepStaleRuns(NOW);

    expect(find).toHaveBeenCalledTimes(2);

    const stuck: DateComparison = boundOf(
      ToolImportRun,
      queryOf(find, 0),
      "updatedAt",
    );
    const expired: DateComparison = boundOf(
      ToolImportRun,
      queryOf(find, 1),
      "updatedAt",
    );

    expect(stuck.values).toEqual([
      new Date(NOW.getTime() - TOOL_IMPORT_STALE_RUN_MS).toISOString(),
    ]);
    expect(stuck.sql).toBe("(col < '2026-11-15T08:30:00.000Z')");
    expect(stuck.matches(minutesAgo(91))).toBe(true);
    expect(stuck.matches(minutesAgo(89))).toBe(false);

    expect(expired.values).toEqual([
      new Date(
        NOW.getTime() - TOOL_IMPORT_REVIEW_EXPIRES_AFTER_MS,
      ).toISOString(),
    ]);
    expect(expired.sql).toBe("(col < '2026-11-14T10:00:00.000Z')");
    expect(expired.matches(minutesAgo(25 * 60))).toBe(true);
    // Under the day cut, a preview from early yesterday lived another day.
    expect(expired.matches(new Date("2026-11-14T01:00:00.000Z"))).toBe(true);
    expect(expired.matches(minutesAgo(23 * 60))).toBe(false);
  });
});

describe("discovery imports", () => {
  test("an import whose job never ran is picked up after 2 minutes", async () => {
    const find: StubbedService = jest
      .spyOn(NetworkDeviceDiscoveryImportService, "findBy")
      .mockResolvedValue([]);

    await DiscoveryImportRunner.sweep(NOW);

    const stale: DateComparison = boundOf(
      NetworkDeviceDiscoveryImport,
      queryOf(find, 0),
      "updatedAt",
    );

    expect(stale.values).toEqual([
      new Date(NOW.getTime() - DISCOVERY_IMPORT_STALE_QUEUED_MS).toISOString(),
    ]);
    expect(stale.sql).toBe("(col < '2026-11-15T09:58:00.000Z')");
    expect(stale.matches(minutesAgo(3))).toBe(true);
    expect(stale.matches(minutesAgo(1))).toBe(false);
  });
});

describe("a cloud's recommendations", () => {
  test("those this read did not see are removed; those it wrote are kept", async () => {
    jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([]);
    jest.spyOn(CloudCostRecommendationService, "findBy").mockResolvedValue([]);
    const remove: StubbedService = jest
      .spyOn(CloudCostRecommendationService, "hardDeleteBy")
      .mockResolvedValue(0);

    await CloudSavingsWriter.write({
      projectId: ObjectID.generate(),
      provider: CloudProvider.AWS,
      accountRows: new Map([["123456789012", ObjectID.generate()]]),
      accountsRead: new Set(["123456789012"]),
      recommendations: [],
      now: NOW,
    });

    const unseen: DateComparison = boundOf(
      CloudCostRecommendation,
      queryOf(remove, 0),
      "lastSeenAt",
    );

    expect(unseen.sql).toBe("(col < '2026-11-15T10:00:00.000Z')");
    // Written by this read with lastSeenAt = now.
    expect(unseen.matches(NOW)).toBe(false);
    // Seen by the read a minute ago, gone from this one.
    expect(unseen.matches(minutesAgo(1))).toBe(true);
    expect(unseen.matches(minutesAgo(26 * 60))).toBe(true);
  });
});
