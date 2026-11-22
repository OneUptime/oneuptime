import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../../Types/BaseDatabase/NotEqualOrNull";
import BadDataException from "../../../../Types/Exception/BadDataException";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { getLinkableMonitorsQuery } from "../../../../Utils/Monitor/MonitorTemplateLinkableMonitors";
import { FindOperator } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * HOW THE SERVER WRITES NOTEQUALORNULL FOR POSTGRES (#10399).
 *
 * NotEqual is `column != value`, which is not true of an empty column, so
 * "the monitors not linked to this template" written with it lost every
 * monitor linked to no template - the very monitors Link Existing Monitors
 * is opened for. NotEqualOrNull is `(column != value OR column IS NULL)`:
 * the value bound as a parameter, never spliced into the SQL, the id checked
 * as a uuid first (UUIDColumnFilter), a Date bound as the instant it is.
 *
 * What Postgres answers to it, through the real list route, is pinned in
 * Tests/Server/API/MonitorTemplateLinkableMonitorsPostgres.test.ts.
 */

const TEMPLATE_ID: string = "50000000-0000-4000-8000-000000000001";

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

  return raw.getSql(alias).split(`:${names[0]!}`).join(":p");
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

describe("QueryHelper.notEqualsOrNull", () => {
  it("is anything but the value, or empty", () => {
    expect(sqlOf(QueryHelper.notEqualsOrNull(TEMPLATE_ID), ALIAS)).toBe(
      `(${ALIAS} != :p OR ${ALIAS} IS NULL)`,
    );
  });

  it("binds the value, never writes it into the SQL", () => {
    const operator: unknown = QueryHelper.notEqualsOrNull(TEMPLATE_ID);

    expect(boundOf(operator)).toEqual([TEMPLATE_ID]);
    expect(asRaw(operator).getSql(ALIAS)).not.toContain(TEMPLATE_ID);
  });

  it("binds an ObjectID as its text", () => {
    expect(
      boundOf(QueryHelper.notEqualsOrNull(new ObjectID(TEMPLATE_ID))),
    ).toEqual([TEMPLATE_ID]);
  });

  it("names its parameter anew each time, so two can sit in one query", () => {
    const first: RawOperator = asRaw(QueryHelper.notEqualsOrNull("a"));
    const second: RawOperator = asRaw(QueryHelper.notEqualsOrNull("b"));

    expect(Object.keys(first.objectLiteralParameters)).not.toEqual(
      Object.keys(second.objectLiteralParameters),
    );
  });

  it("is notEquals with the empty column kept: notEquals alone leaves it out", () => {
    expect(sqlOf(QueryHelper.notEquals(TEMPLATE_ID), ALIAS)).toBe(
      `(${ALIAS} != :p)`,
    );
  });
});

describe("QueryUtil.serializeQuery, NotEqualOrNull", () => {
  it("on a uuid column: anything but the id, or none", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplateId: new NotEqualOrNull<string>(TEMPLATE_ID),
    });

    expect(sqlOf(query["monitorTemplateId"], ALIAS)).toBe(
      `(${ALIAS} != :p OR ${ALIAS} IS NULL)`,
    );
    expect(boundOf(query["monitorTemplateId"])).toEqual([TEMPLATE_ID]);
  });

  it("is written apart from NotEqual, which keeps no empty column", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplateId: new NotEqual<string>(TEMPLATE_ID),
    });

    expect(sqlOf(query["monitorTemplateId"], ALIAS)).toBe(`(${ALIAS} != :p)`);
  });

  it("on a relation: compares the related record's id the same way", () => {
    const query: Record<string, unknown> = serialize(Monitor, {
      monitorTemplate: new NotEqualOrNull<string>(TEMPLATE_ID),
    });

    expect(
      sqlOf(query["monitorTemplate"], '"Monitor"."monitorTemplateId"'),
    ).toContain("IS NULL");
    expect(boundOf(query["monitorTemplate"])).toEqual([TEMPLATE_ID]);
  });

  it("refuses text that is no id on a uuid column, before Postgres is asked", () => {
    for (const value of ["", "abc", "[object Object]"]) {
      expect(() => {
        serialize(Monitor, {
          monitorTemplateId: new NotEqualOrNull<string>(value),
        });
      }).toThrow(BadDataException);
    }
  });

  it("binds a Date as the instant it is", () => {
    const at: Date = new Date("2026-11-20T15:55:38.123Z");
    const query: Record<string, unknown> = serialize(Monitor, {
      createdAt: new NotEqualOrNull<Date>(at),
    });

    expect(boundOf(query["createdAt"])).toEqual(["2026-11-20T15:55:38.123Z"]);
  });

  it("refuses a Date that is not one", () => {
    expect(() => {
      serialize(Monitor, {
        createdAt: new NotEqualOrNull<Date>(new Date("not a date")),
      });
    }).toThrow(BadDataException);
  });
});

describe("the query Link Existing Monitors searches with, as the server writes it", () => {
  it("is the template's type, any template but this one or none, and not archived", () => {
    const query: Record<string, unknown> = serialize(
      Monitor,
      getLinkableMonitorsQuery({
        monitorTemplateId: new ObjectID(TEMPLATE_ID),
        monitorType: MonitorType.Ping,
      }),
    );

    expect(Object.keys(query).sort()).toEqual([
      "isArchived",
      "monitorTemplateId",
      "monitorType",
    ]);
    expect(query["monitorType"]).toBe(MonitorType.Ping);
    expect(query["isArchived"]).toBe(false);
    expect(sqlOf(query["monitorTemplateId"], ALIAS)).toBe(
      `(${ALIAS} != :p OR ${ALIAS} IS NULL)`,
    );
    expect(boundOf(query["monitorTemplateId"])).toEqual([TEMPLATE_ID]);
  });
});
