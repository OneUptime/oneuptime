import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The conditions a grant limited to labels, and an Owned grant on a record
 * that may name no owner, add to a query (ReadPermission
 * .addLabelGrantToQuery, OwnedScopePermission). They are the mirrors of the
 * block's conditions: a block leaves out what is linked to a blocked label,
 * a grant keeps only what is linked to a granted one.
 *
 * Identifiers are written into the SQL, quoted; the label and record ids
 * are bound, never written. An empty list fails closed: it keeps only the
 * rows the condition cannot be about (an empty key, a record with no
 * parent), never every row.
 */

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

const asRaw: (operator: unknown) => RawOperator = (
  operator: unknown,
): RawOperator => {
  expect(operator).toBeInstanceOf(FindOperator);
  return operator as RawOperator;
};

const boundValues: (operator: RawOperator) => Array<string> = (
  operator: RawOperator,
): Array<string> => {
  return Object.values(operator.objectLiteralParameters)
    .flat()
    .map(String);
};

const labelA: string = ObjectID.generate().toString();
const labelB: string = ObjectID.generate().toString();

describe("QueryHelper.linkedToAnyInAnyManyToMany", () => {
  test("keeps a key that is empty or names a record linked to a granted label, over every join table", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.linkedToAnyInAnyManyToMany({
        values: [labelA, new ObjectID(labelB)],
        joinTables: [
          {
            joinTableName: "ServiceLabel",
            ownerColumnName: "serviceId",
            relationColumnName: "labelId",
          },
          {
            joinTableName: "HostLabel",
            ownerColumnName: "hostId",
            relationColumnName: "labelId",
          },
        ],
      }),
    );

    const sql: string = operator.getSql('"Item"."resourceId"');

    expect(sql).toMatch(
      /^\("Item"\."resourceId" IS NULL OR "Item"\."resourceId" IN \(/,
    );
    expect(sql).toContain(
      'SELECT "ServiceLabel"."serviceId" FROM "ServiceLabel" WHERE "ServiceLabel"."labelId" IN (:...',
    );
    expect(sql).toContain(" UNION ALL ");
    expect(sql).toContain(
      'SELECT "HostLabel"."hostId" FROM "HostLabel" WHERE "HostLabel"."labelId" IN (:...',
    );

    // Bound once, shared by every join table; never written into the SQL.
    expect(boundValues(operator).sort()).toEqual([labelA, labelB].sort());
    expect(sql).not.toContain(labelA);
    expect(sql).not.toContain(labelB);
  });

  test.each([
    ["no labels", [], ["ServiceLabel"]],
    ["no join tables", [labelA], []],
  ] as Array<[string, Array<string>, Array<string>]>)(
    "with %s keeps only the rows whose key is empty",
    (_label: string, values: Array<string>, tables: Array<string>) => {
      const operator: RawOperator = asRaw(
        QueryHelper.linkedToAnyInAnyManyToMany({
          values: values,
          joinTables: tables.map(
            (
              table: string,
            ): {
              joinTableName: string;
              ownerColumnName: string;
              relationColumnName: string;
            } => {
              return {
                joinTableName: table,
                ownerColumnName: "serviceId",
                relationColumnName: "labelId",
              };
            },
          ),
        }),
      );

      expect(operator.getSql("key")).toBe("(key IS NULL)");
    },
  );

  test("quotes the identifiers it writes", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.linkedToAnyInAnyManyToMany({
        values: [labelA],
        joinTables: [
          {
            joinTableName: 'Odd"Table',
            ownerColumnName: 'owner"Id',
            relationColumnName: 'label"Id',
          },
        ],
      }),
    );

    expect(operator.getSql("key")).toContain(
      'SELECT "Odd""Table"."owner""Id" FROM "Odd""Table" WHERE "Odd""Table"."label""Id" IN',
    );
  });
});

describe("QueryHelper.everyParentLinkedToAnyInManyToMany", () => {
  const parents: {
    parentJoinTableName: string;
    parentOwnerColumnName: string;
    parentRelationColumnName: string;
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  } = {
    parentJoinTableName: "AnnouncementStatusPage",
    parentOwnerColumnName: "announcementId",
    parentRelationColumnName: "statusPageId",
    joinTableName: "StatusPageLabel",
    ownerColumnName: "statusPageId",
    relationColumnName: "labelId",
  };

  test("leaves out a record that belongs to any parent without a granted label", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.everyParentLinkedToAnyInManyToMany({
        values: [labelA, labelB],
        ...parents,
      }),
    );

    expect(operator.getSql('"Announcement"."_id"')).toBe(
      `("Announcement"."_id" NOT IN (SELECT "AnnouncementStatusPage"."announcementId" FROM "AnnouncementStatusPage" WHERE "AnnouncementStatusPage"."statusPageId" NOT IN (SELECT "StatusPageLabel"."statusPageId" FROM "StatusPageLabel" WHERE "StatusPageLabel"."labelId" IN (:...${
        Object.keys(operator.objectLiteralParameters)[0]
      }))))`,
    );
    expect(boundValues(operator).sort()).toEqual([labelA, labelB].sort());
  });

  test("with no labels keeps only the records that belong to no parent", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.everyParentLinkedToAnyInManyToMany({
        values: [],
        ...parents,
      }),
    );

    expect(operator.getSql("record._id")).toBe(
      '(record._id NOT IN (SELECT "AnnouncementStatusPage"."announcementId" FROM "AnnouncementStatusPage" WHERE "AnnouncementStatusPage"."announcementId" IS NOT NULL))',
    );
    expect(boundValues(operator)).toEqual([]);
  });
});

describe("QueryHelper.inOrNull", () => {
  test("keeps a column that holds one of the ids, or nothing", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.inOrNull([labelA, new ObjectID(labelB)]),
    );

    expect(operator.getSql("insight.serviceId")).toMatch(
      /^\(insight\.serviceId IN \(:\.\.\.\w+\) OR insight\.serviceId IS NULL\)$/,
    );
    expect(boundValues(operator).sort()).toEqual([labelA, labelB].sort());
  });

  test("with no ids keeps only the rows whose column is empty", () => {
    expect(asRaw(QueryHelper.inOrNull([])).getSql("column")).toBe(
      "(column IS NULL)",
    );
  });
});
