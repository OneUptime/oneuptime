import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import User from "../../../../Models/DatabaseModels/User";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Why a reference's two names must be read together.
 *
 * A model declares a reference twice - the ID column (`changeMonitorStatusToId`)
 * and the relation (`changeMonitorStatusTo`) - and TypeORM folds the two into
 * one database column. When a write carries both, the statement TypeORM builds
 * binds the RELATION's id: ColumnMetadata.getEntityValue reads the relation
 * first and falls back to the ID column only when the relation holds no
 * object. A check that reads the ID column first therefore checks one value
 * while another is stored, which is what RelationIdUtil.readConsistent,
 * DatabaseService's refusal of disagreeing names (RelationNames) and stamp
 * exist to prevent.
 *
 * These pin that behaviour on the library itself (no database: the statement
 * is built and read), so an upgrade that changed it fails here first.
 */

const INCIDENT_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const STATUS_A: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const STATUS_B: string = "0193c0de-eeee-4aaa-8bbb-0000000000b2";
const USER_A: string = "0193c0de-eeee-4aaa-8bbb-0000000000c1";
const USER_B: string = "0193c0de-eeee-4aaa-8bbb-0000000000c2";

let database: DataSource;

beforeAll(async () => {
  database = new DataSource({
    type: "postgres",
    entities: Entities,
    synchronize: false,
  });

  await (
    database as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

function status(id: string): MonitorStatus {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus._id = id;
  return monitorStatus;
}

function user(id: string): User {
  const record: User = new User();
  record._id = id;
  return record;
}

// The statement repository.update() runs for this SET.
function updateStatement(
  set: Record<string, unknown>,
): [string, Array<unknown>] {
  return database
    .createQueryBuilder()
    .update(Incident)
    .set(set as unknown as QueryDeepPartialEntity<Incident>)
    .where({ _id: INCIDENT_ID })
    .getQueryAndParameters();
}

// The parameter an UPDATE binds to `column`, or "(not set)".
function boundInUpdate(
  statement: [string, Array<unknown>],
  column: string,
): unknown {
  const match: RegExpMatchArray | null = statement[0].match(
    new RegExp(`"${column}" = \\$(\\d+)`),
  );

  if (!match) {
    return "(not set)";
  }

  return statement[1][Number(match[1]) - 1];
}

// The parameter an INSERT binds to `column`.
function boundInInsert(
  values: Record<string, unknown>,
  column: string,
): unknown {
  const [sql, parameters]: [string, Array<unknown>] = database
    .createQueryBuilder()
    .insert()
    .into(Incident)
    .values(values as unknown as QueryDeepPartialEntity<Incident>)
    .getQueryAndParameters();

  const columns: Array<string> = (sql.match(/\(([^)]*)\) VALUES/) || [
    "",
    "",
  ])[1]!
    .split(",")
    .map((name: string): string => {
      return name.trim();
    });

  const valuesList: Array<string> = (sql.match(
    /VALUES \((.*?)\)( RETURNING|$)/,
  ) || ["", ""])[1]!
    .split(",")
    .map((value: string): string => {
      return value.trim();
    });

  const placeholder: string = valuesList[columns.indexOf(`"${column}"`)]!;

  if (!placeholder || !placeholder.startsWith("$")) {
    return placeholder;
  }

  return parameters[Number(placeholder.slice(1)) - 1];
}

describe("TypeORM stores the relation's id when a write carries both names", () => {
  test("the relation and its ID column are one database column", () => {
    expect(
      database
        .getMetadata(Incident)
        .findColumnsWithPropertyPath("changeMonitorStatusTo")
        .map((column: { databaseName: string }): string => {
          return column.databaseName;
        }),
    ).toEqual(["changeMonitorStatusToId"]);
  });

  test("an update with both binds the relation's id", () => {
    expect(
      boundInUpdate(
        updateStatement({
          changeMonitorStatusToId: new ObjectID(STATUS_A),
          changeMonitorStatusTo: status(STATUS_B),
        }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_B);
  });

  test("whichever name the write lists first", () => {
    expect(
      boundInUpdate(
        updateStatement({
          changeMonitorStatusTo: status(STATUS_B),
          changeMonitorStatusToId: new ObjectID(STATUS_A),
        }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_B);
  });

  test("an update with a cleared ID column beside a relation binds the relation's id", () => {
    expect(
      boundInUpdate(
        updateStatement({
          changeMonitorStatusToId: null,
          changeMonitorStatusTo: status(STATUS_B),
        }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_B);
  });

  test("a cleared relation beside an id falls back to the ID column", () => {
    expect(
      boundInUpdate(
        updateStatement({
          changeMonitorStatusTo: null,
          changeMonitorStatusToId: new ObjectID(STATUS_A),
        }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_A);
  });

  test("a relation with no id in it beside an id binds nothing: the ID column is not stored", () => {
    expect(
      boundInUpdate(
        updateStatement({
          changeMonitorStatusTo: {},
          changeMonitorStatusToId: new ObjectID(STATUS_A),
        }),
        "changeMonitorStatusToId",
      ),
    ).toBeUndefined();
  });

  test("one name alone binds its own id", () => {
    expect(
      boundInUpdate(
        updateStatement({ changeMonitorStatusToId: new ObjectID(STATUS_A) }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_A);
    expect(
      boundInUpdate(
        updateStatement({ changeMonitorStatusTo: status(STATUS_B) }),
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_B);
  });

  test("an insert with both binds the relation's id", () => {
    expect(
      boundInInsert(
        {
          changeMonitorStatusToId: new ObjectID(STATUS_A),
          changeMonitorStatusTo: status(STATUS_B),
        },
        "changeMonitorStatusToId",
      ),
    ).toBe(STATUS_B);
  });

  test("a creator stamped under createdByUserId loses to a createdByUser relation beside it", () => {
    /*
     * Which is why DatabaseService drops the relation when it stamps the
     * person making the request as the creator.
     */
    expect(
      boundInInsert(
        {
          createdByUserId: new ObjectID(USER_A),
          createdByUser: user(USER_B),
        },
        "createdByUserId",
      ),
    ).toBe(USER_B);
  });
});
