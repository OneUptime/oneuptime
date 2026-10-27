import SecurityEventService, {
  EntityFindingSummary,
  OBSERVABLE_ACTIVITY_MAX_VALUES,
  ObservableActivity,
} from "../../../Server/Services/SecurityEventService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { TelemetryServiceFilter } from "../../../Server/Utils/Telemetry/TelemetryReadScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two entity queries the Security product reads besides the explorer:
 * one value's activity (the case page, the Look Up Entity Activity step) and
 * the values the findings name most (the overview). Every value - the
 * project, the window and every observable - is a bound parameter.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const START: Date = new Date("2026-10-13T09:00:00.000Z");
const END: Date = new Date("2026-10-14T09:00:00.000Z");

function stubExecuteQuery(rows: Array<JSONObject>): Spy {
  getJestSpyOn(
    SecurityEventService.database,
    "getDatasourceOptions",
  ).mockReturnValue({
    database: "oneuptime",
  } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue(
    result as never,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventService.findObservableActivity", () => {
  test("asks nothing for no values", async () => {
    const spy: Spy = stubExecuteQuery([]);

    expect(
      await SecurityEventService.findObservableActivity({
        projectId: PROJECT_ID,
        values: ["  ", ""],
        startTime: START,
        endTime: END,
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("binds the values, deduplicated and capped, and reads each row's figures", async () => {
    const spy: Spy = stubExecuteQuery([
      {
        value: "203.0.113.7",
        eventCount: "42",
        findingCount: "3",
        maxSeverityId: 4,
        firstSeen: "2026-10-13 10:00:00.000000000",
        lastSeen: "2026-10-14 08:59:00.000000000",
      },
    ]);

    const values: Array<string> = ["203.0.113.7", "203.0.113.7"];

    for (
      let index: number = 0;
      index < OBSERVABLE_ACTIVITY_MAX_VALUES + 10;
      index++
    ) {
      values.push(`host-${index}`);
    }

    const activity: Array<ObservableActivity> =
      await SecurityEventService.findObservableActivity({
        projectId: PROJECT_ID,
        values,
        startTime: START,
        endTime: END,
      });

    expect(activity).toEqual([
      {
        value: "203.0.113.7",
        eventCount: 42,
        findingCount: 3,
        maxSeverityId: 4,
        firstSeen: new Date("2026-10-13T10:00:00.000Z"),
        lastSeen: new Date("2026-10-14T08:59:00.000Z"),
      },
    ]);

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("ARRAY JOIN observables AS observable");
    expect(statement.query).toContain(
      "hasAny(observables, {p3:Array(String)})",
    );
    expect(statement.query).toContain(
      "countIf(classUid IN (2004, 2005)) AS findingCount",
    );

    const bound: Array<unknown> = Object.values(statement.query_params);
    const boundValues: Array<string> = bound.find((value: unknown) => {
      return Array.isArray(value);
    }) as Array<string>;

    expect(boundValues).toHaveLength(OBSERVABLE_ACTIVITY_MAX_VALUES);
    expect(
      boundValues.filter((value: string) => {
        return value === "203.0.113.7";
      }),
    ).toHaveLength(1);
    // No value is ever spliced into the SQL text.
    expect(statement.query).not.toContain("203.0.113.7");
  });
});

describe("SecurityEventService.findEntitiesByFindings", () => {
  test("reads findings only, worst first, and bounds the limit", async () => {
    const spy: Spy = stubExecuteQuery([
      {
        value: "web-01",
        findingCount: 7,
        ruleCount: 3,
        maxSeverityId: 5,
        lastSeen: "2026-10-14 08:00:00.000000000",
      },
    ]);

    const entities: Array<EntityFindingSummary> =
      await SecurityEventService.findEntitiesByFindings({
        projectId: PROJECT_ID,
        startTime: START,
        endTime: END,
        limit: 5000,
      });

    expect(entities).toEqual([
      {
        value: "web-01",
        findingCount: 7,
        ruleCount: 3,
        maxSeverityId: 5,
        lastSeen: new Date("2026-10-14T08:00:00.000Z"),
      },
    ]);

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("classUid IN (2004, 2005)");
    expect(statement.query).toContain(
      "ORDER BY maxSeverityId DESC, findingCount DESC",
    );
    expect(Object.values(statement.query_params)).toContain(100);
  });
});

/*
 * A read made for a person keeps to the sources whose events they may read
 * (TelemetryReadAccess.getServiceFilter): the sources to keep and the ones a
 * block takes away, as conditions on primaryEntityId with every id bound,
 * before the rows are grouped. OneUptime's own reads name no filter and
 * read every source.
 */
describe("the sources a reader may read", () => {
  const OWNED_SOURCE: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const BLOCKED_SOURCE: ObjectID = new ObjectID(
    "44444444-4444-4444-8444-444444444444",
  );

  function boundIds(statement: Statement): Array<string> {
    return Object.values(statement.query_params)
      .filter((value: unknown): boolean => {
        return Array.isArray(value);
      })
      .flat()
      .map((value: unknown): string => {
        return String(value);
      });
  }

  const READS: Array<
    [
      string,
      (filter?: TelemetryServiceFilter | undefined) => Promise<unknown>,
    ]
  > = [
    [
      "findObservableActivity",
      (filter?: TelemetryServiceFilter | undefined): Promise<unknown> => {
        return SecurityEventService.findObservableActivity({
          projectId: PROJECT_ID,
          values: ["203.0.113.7"],
          startTime: START,
          endTime: END,
          serviceFilter: filter,
        });
      },
    ],
    [
      "findEntitiesByFindings",
      (filter?: TelemetryServiceFilter | undefined): Promise<unknown> => {
        return SecurityEventService.findEntitiesByFindings({
          projectId: PROJECT_ID,
          startTime: START,
          endTime: END,
          limit: 25,
          serviceFilter: filter,
        });
      },
    ],
  ];

  test.each(READS)(
    "%s keeps to the sources the reader may read, and leaves out the ones a block takes away",
    async (
      _read: string,
      read: (filter?: TelemetryServiceFilter | undefined) => Promise<unknown>,
    ) => {
      const spy: Spy = stubExecuteQuery([]);

      await read({
        serviceIds: [OWNED_SOURCE, PROJECT_ID],
        excludedServiceIds: [BLOCKED_SOURCE],
      });

      const statement: Statement = spy.mock.calls[0]![0] as Statement;
      const where: string = statement.query.split(" GROUP BY ")[0]!;

      expect(where).toContain(" AND primaryEntityId IN (");
      expect(where).toContain(" AND primaryEntityId NOT IN (");
      expect(boundIds(statement)).toEqual(
        expect.arrayContaining([
          OWNED_SOURCE.toString(),
          PROJECT_ID.toString(),
          BLOCKED_SOURCE.toString(),
        ]),
      );
      // Every id is bound, never spliced into the SQL text.
      expect(statement.query).not.toContain(OWNED_SOURCE.toString());
      expect(statement.query).not.toContain(BLOCKED_SOURCE.toString());
    },
  );

  test.each(READS)(
    "%s with no filter - OneUptime's own read - reads every source",
    async (
      _read: string,
      read: (filter?: TelemetryServiceFilter | undefined) => Promise<unknown>,
    ) => {
      const spy: Spy = stubExecuteQuery([]);

      await read();

      const statement: Statement = spy.mock.calls[0]![0] as Statement;

      expect(statement.query).not.toContain("primaryEntityId");
    },
  );
});
