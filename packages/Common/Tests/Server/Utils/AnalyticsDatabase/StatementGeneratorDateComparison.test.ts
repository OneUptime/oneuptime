/** @timezone Asia/Kolkata */

import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import CompareBase, {
  CompareType,
} from "../../../../Types/Database/CompareBase";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A DATE COMPARED IN CLICKHOUSE KEEPS ITS TIME (#8200).
 *
 * Postgres's comparisons were bound as the day alone (QueryUtil, fixed in
 * #8200). ClickHouse's never shared that path: StatementGenerator binds
 * the operator's own value, and a DateTime64 column's is written to the
 * nanosecond in UTC. These pin it, for the two server callers that compare
 * a ClickHouse time with a Date they built: the security setup's count of
 * recent events (`time: new GreaterThan(since)`) and Ask AI's search for a
 * service's previous deploy (`time: new LessThan(change.time)`). The
 * process runs in Asia/Kolkata, so a bound that leaned on its zone shows.
 */

const AT: Date = new Date("2026-11-15T09:40:00.123Z");
const IN_CLICKHOUSE: string = "2026-11-15 09:40:00.123000000";

function timeBounds(statement: Statement): Array<unknown> {
  // Every value bound against the time column, as ClickHouse reads it.
  return Object.entries(statement.query_params)
    .filter(([name]: [string, unknown]): boolean => {
      return (
        statement.query.includes(`{${name}:DateTime64(9)}`) ||
        statement.query.includes(`{${name}:DateTime`)
      );
    })
    .map(([, value]: [string, unknown]): unknown => {
      return value;
    });
}

describe("ClickHouse binds a Date compared with a time to the nanosecond", () => {
  test("the security setup's recent events: time > since", () => {
    const generator: StatementGenerator<SecurityEvent> =
      new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      projectId: ObjectID.generate(),
      time: new GreaterThan(AT),
    } as never);

    expect(statement.query).toContain("> {");
    expect(timeBounds(statement)).toEqual([IN_CLICKHOUSE]);
  });

  test("Ask AI's previous deploy of a service: time < the change's time", () => {
    const generator: StatementGenerator<ChangeEvent> =
      new StatementGenerator<ChangeEvent>({
        modelType: ChangeEvent,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      primaryEntityId: ObjectID.generate(),
      time: new LessThan(AT),
    } as never);

    expect(statement.query).toContain("< {");
    expect(timeBounds(statement)).toEqual([IN_CLICKHOUSE]);
  });

  test.each([
    [
      "LessThanOrEqual",
      (at: Date): CompareBase<CompareType> => {
        return new LessThanOrEqual(at);
      },
    ],
    [
      "GreaterThanOrEqual",
      (at: Date): CompareBase<CompareType> => {
        return new GreaterThanOrEqual(at);
      },
    ],
    [
      "LessThanOrNull",
      (at: Date): CompareBase<CompareType> => {
        return new LessThanOrNull(at);
      },
    ],
    [
      "GreaterThanOrNull",
      (at: Date): CompareBase<CompareType> => {
        return new GreaterThanOrNull(at);
      },
    ],
  ])(
    "%s too",
    (_name: string, create: (at: Date) => CompareBase<CompareType>) => {
      const generator: StatementGenerator<SecurityEvent> =
        new StatementGenerator<SecurityEvent>({
          modelType: SecurityEvent,
          database: ClickhouseAppInstance,
        });

      expect(
        timeBounds(generator.toWhereStatement({ time: create(AT) } as never)),
      ).toEqual([IN_CLICKHOUSE]);
    },
  );

  test("and InBetween, both ends", () => {
    const generator: StatementGenerator<SecurityEvent> =
      new StatementGenerator<SecurityEvent>({
        modelType: SecurityEvent,
        database: ClickhouseAppInstance,
      });

    expect(
      timeBounds(
        generator.toWhereStatement({
          time: new InBetween(new Date(AT.getTime() - 20 * 60_000), AT),
        } as never),
      ),
    ).toEqual(["2026-11-15 09:20:00.123000000", IN_CLICKHOUSE]);
  });
});
