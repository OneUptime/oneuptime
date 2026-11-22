import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../../Types/BaseDatabase/IncludesNoneOrNull";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { FindOperator } from "typeorm";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * HOW THE SERVER WRITES INCLUDESNONEORNULL FOR POSTGRES (#10581).
 *
 * IncludesNone is `column NOT IN (...)`, which is not true of an empty
 * column, so a list's "Template is not X or Y" written with it lost every
 * monitor linked to no template. IncludesNoneOrNull is `(column NOT IN (...)
 * OR column IS NULL)`: the values bound as one list parameter, never spliced
 * into the SQL, each id checked as a uuid first (UUIDColumnFilter). On a
 * list of related records (labels) it is the same subquery IncludesNone
 * writes, which already keeps a record with none.
 *
 * What Postgres answers to it, through the real monitor list route, is
 * pinned in Tests/Server/API/ListIsNotFilterPostgres.test.ts.
 */

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";
const OTHER_TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000002";
const LABEL_ID: string = "60000000-0000-4000-8000-000000000001";

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

const asRaw: (operator: unknown) => RawOperator = (
  operator: unknown,
): RawOperator => {
  expect(operator).toBeInstanceOf(FindOperator);
  return operator as RawOperator;
};

// The SQL a Raw operator writes for a column, its one parameter as ":p".
const sqlOf: (operator: unknown, alias: string) => string = (
  operator: unknown,
  alias: string,
): string => {
  const raw: RawOperator = asRaw(operator);
  const names: Array<string> = Object.keys(raw.objectLiteralParameters);

  expect(names).toHaveLength(1);

  return raw.getSql(alias).split(`:...${names[0]!}`).join(":...p");
};

const boundOf: (operator: unknown) => Array<unknown> = (
  operator: unknown,
): Array<unknown> => {
  return Object.values(asRaw(operator).objectLiteralParameters);
};

const serialize: (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
) => Record<string, unknown> = (
  modelType: DatabaseBaseModelType,
  query: Record<string, unknown>,
): Record<string, unknown> => {
  return QueryUtil.serializeQuery(modelType, query as never) as Record<
    string,
    unknown
  >;
};

const ALIAS: string = '"Monitor"."monitorTemplateId"';

afterEach(() => {
  jest.restoreAllMocks();
});

describe("QueryHelper.notInOrNull, as IncludesNoneOrNull writes it", () => {
  it("is none of the values, or empty", () => {
    expect(sqlOf(QueryHelper.notInOrNull([TEMPLATE_ID]), ALIAS)).toBe(
      `(${ALIAS} NOT IN (:...p) or ${ALIAS} IS NULL)`,
    );
  });

  it("is notIn with the empty column kept: notIn alone leaves it out", () => {
    expect(sqlOf(QueryHelper.notIn([TEMPLATE_ID]), ALIAS)).toBe(
      `(${ALIAS} NOT IN (:...p))`,
    );
  });
});

describe("QueryUtil.serializeQuery, IncludesNoneOrNull", () => {
  it("on a uuid column: none of the ids, or none at all", () => {
    // ObjectIDs, as a chip sends them, and ids as text, as a link holds them.
    for (const ids of [
      [new ObjectID(TEMPLATE_ID), new ObjectID(OTHER_TEMPLATE_ID)],
      [TEMPLATE_ID, OTHER_TEMPLATE_ID],
    ] as Array<Array<ObjectID> | Array<string>>) {
      const query: Record<string, unknown> = serialize(Monitor, {
        monitorTemplateId: new IncludesNoneOrNull(ids),
      });

      expect(sqlOf(query["monitorTemplateId"], ALIAS)).toBe(
        `(${ALIAS} NOT IN (:...p) or ${ALIAS} IS NULL)`,
      );
      // One list parameter, each id as its text, never in the SQL.
      expect(boundOf(query["monitorTemplateId"])).toEqual([
        [TEMPLATE_ID, OTHER_TEMPLATE_ID],
      ]);
      expect(asRaw(query["monitorTemplateId"]).getSql(ALIAS)).not.toContain(
        TEMPLATE_ID,
      );
    }
  });

  it("is written apart from IncludesNone, which keeps no empty column", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplateId: new IncludesNone([TEMPLATE_ID]),
    });

    expect(sqlOf(query["monitorTemplateId"], ALIAS)).toBe(
      `(${ALIAS} NOT IN (:...p))`,
    );
  });

  it("on a relation of one record: compares its key the same way", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplate: new IncludesNoneOrNull([TEMPLATE_ID]),
    });

    expect(sqlOf(query["monitorTemplate"], ALIAS)).toBe(
      `(${ALIAS} NOT IN (:...p) or ${ALIAS} IS NULL)`,
    );
    expect(boundOf(query["monitorTemplate"])).toEqual([[TEMPLATE_ID]]);
  });

  it("of nothing constrains nothing", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplateId: new IncludesNoneOrNull([]),
    });

    expect(asRaw(query["monitorTemplateId"]).getSql(ALIAS)).toBe("TRUE = TRUE");
  });

  it("refuses text that is no id on a uuid column, before Postgres is asked", () => {
    for (const values of [["abc"], [TEMPLATE_ID, ""], ["[object Object]"]]) {
      expect(() => {
        serialize(Monitor, {
          monitorTemplateId: new IncludesNoneOrNull(values),
        });
      }).toThrow(BadDataException);
    }
  });

  /*
   * A list of related records holds none of these when it holds none at
   * all: the join-table subquery IncludesNone writes already keeps such a
   * record, so IncludesNoneOrNull asks the very same.
   */
  it("on a list of related records: the subquery IncludesNone writes", () => {
    jest.spyOn(QueryUtil, "getManyToManyRelationMetadata").mockReturnValue({
      joinTableName: "IncidentLabel",
      ownerColumnName: "incidentId",
      relationColumnName: "labelId",
    });

    const orNull: Record<string, unknown> = serialize(Incident, {
      labels: new IncludesNoneOrNull([LABEL_ID]),
    });
    const plain: Record<string, unknown> = serialize(Incident, {
      labels: new IncludesNone([LABEL_ID]),
    });

    expect(orNull["labels"]).toBeUndefined();

    const idSql: (query: Record<string, unknown>) => string = (
      query: Record<string, unknown>,
    ): string => {
      const raw: RawOperator = asRaw(query["_id"]);
      let sql: string = raw.getSql('"Incident"."_id"');

      for (const name of Object.keys(raw.objectLiteralParameters)) {
        sql = sql.split(name).join("p");
      }

      return sql;
    };

    expect(idSql(orNull)).toBe(idSql(plain));
    // The incidents in no row of the join table for these labels.
    expect(idSql(orNull)).toContain(
      '"Incident"."_id" NOT IN (SELECT "IncidentLabel"."incidentId" FROM "IncidentLabel"',
    );
    expect(boundOf(orNull["_id"])).toEqual([[LABEL_ID]]);
  });
});
