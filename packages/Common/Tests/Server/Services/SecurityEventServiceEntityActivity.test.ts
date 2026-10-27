import SecurityEventService, {
  OBSERVABLE_ACTIVITY_MAX_VALUES,
  ObservableActivity,
} from "../../../Server/Services/SecurityEventService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The entity query the Security product reads besides the explorer: one
 * value's activity (a case's Entities, an entity's page, Look Up an Entity,
 * the Look Up Entity Activity step). Every value - the project, the window
 * and every observable - is a bound parameter. The riskiest entities are
 * Entity Risk's scores (SecurityRiskiestEntities), not a count of findings.
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
