import "../TestingUtils/Init";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import CountBy from "../../../Server/Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../../../Server/Types/AnalyticsDatabase/ExistsBy";
import FindBy from "../../../Server/Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../../../Server/Types/AnalyticsDatabase/Hooks";
import SecurityWatchlistQueryBinder, {
  SecurityWatchlistCondition,
} from "../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistQueryBinder";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OnWatchlist from "../../../Types/BaseDatabase/OnWatchlist";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY READ OF SECURITY EVENTS READS THE WATCHLISTS ITS QUERY NAMES
 * (#5391): a list, one event, a count, a chart or a facet's counts, a
 * monitor's rule preview and an exists check each put the lists in place
 * before the read - as the caller - so they all match the same values.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type Hooks = {
  onBeforeFind: (
    findBy: FindBy<SecurityEvent>,
  ) => Promise<OnFind<SecurityEvent>>;
  onBeforeCount: (
    countBy: CountBy<SecurityEvent>,
  ) => Promise<CountBy<SecurityEvent>>;
};

const hooks: Hooks = SecurityEventService as unknown as Hooks;

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("56565656-5656-4656-8656-565656565656"),
};

const CONDITION: SecurityWatchlistCondition = new SecurityWatchlistCondition(
  {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    exactValues: ["alice"],
    patterns: [],
    ranges: [],
  },
  false,
);

function query(): Query<SecurityEvent> {
  return {
    projectId: PROJECT_ID,
    principalUser: new OnWatchlist("vip_users"),
  } as Query<SecurityEvent>;
}

let bind: Spy;

beforeEach(() => {
  // What binding does: each name in its list's place, on a new query.
  bind = getJestSpyOn(SecurityWatchlistQueryBinder, "bind").mockImplementation(
    (async (data: { query: Record<string, unknown> }) => {
      return { ...data.query, principalUser: CONDITION };
    }) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectBound(
  written: { query: Query<SecurityEvent> },
  props: DatabaseCommonInteractionProps,
): void {
  expect((written.query as Record<string, unknown>)["principalUser"]).toBe(
    CONDITION,
  );
  expect(bind).toHaveBeenCalledWith({
    query: expect.objectContaining({ projectId: PROJECT_ID }),
    props,
  });
}

describe("a read of security events that names a watchlist", () => {
  test("a list of events, or one event, is read with the list in place", async () => {
    const onFind: OnFind<SecurityEvent> = await hooks.onBeforeFind({
      query: query(),
      select: { _id: true },
      limit: 10,
      skip: 0,
      props: PROPS,
    } as FindBy<SecurityEvent>);

    expectBound(onFind.findBy, PROPS);
  });

  test("a count is read with the list in place, as the list it is shown beside", async () => {
    const counted: CountBy<SecurityEvent> = await hooks.onBeforeCount({
      query: query(),
      props: PROPS,
    } as CountBy<SecurityEvent>);

    expectBound(counted, PROPS);
  });

  test("a chart or a facet's counts", async () => {
    const aggregate: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "aggregateBy",
    ).mockResolvedValue({ data: [] } as never);

    await SecurityEventService.aggregateBy({
      query: query(),
      aggregationType: AggregationType.Count,
      aggregateColumnName: "_id",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date("2026-11-03T11:00:00.000Z"),
      endTimestamp: new Date("2026-11-03T12:00:00.000Z"),
      limit: 10,
      skip: 0,
      props: PROPS,
    } as unknown as AggregateBy<SecurityEvent>);

    expectBound(
      aggregate.mock.calls[0]![0] as { query: Query<SecurityEvent> },
      PROPS,
    );
  });

  test("a monitor's rule preview: its count in each window", async () => {
    const windows: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "countPerWindow",
    ).mockResolvedValue([] as never);

    await SecurityEventService.countPerWindow({
      query: query(),
      timeColumnName: "time",
      windowInSeconds: 60,
      props: { isRoot: true },
    });

    expectBound(windows.mock.calls[0]![0] as { query: Query<SecurityEvent> }, {
      isRoot: true,
    });
  });

  test("whether any event matches", async () => {
    const exists: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "existsBy",
    ).mockResolvedValue(true as never);

    await expect(
      SecurityEventService.existsBy({
        query: query(),
        props: PROPS,
      } as ExistsBy<SecurityEvent>),
    ).resolves.toBe(true);

    expectBound(
      exists.mock.calls[0]![0] as { query: Query<SecurityEvent> },
      PROPS,
    );
  });

  test("a refusal - a list the project lacks, a caller who may not read lists - stops the read", async () => {
    bind.mockRejectedValue(
      new Error("There is no watchlist named x.") as never,
    );
    const exists: Spy = getJestSpyOn(
      AnalyticsDatabaseService.prototype,
      "existsBy",
    ).mockResolvedValue(true as never);

    await expect(
      SecurityEventService.existsBy({
        query: query(),
        props: PROPS,
      } as ExistsBy<SecurityEvent>),
    ).rejects.toThrow("There is no watchlist named x.");
    expect(exists).not.toHaveBeenCalled();
  });
});
