import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The conditions a grant limited to labels, and an Owned grant on a record
 * that may name no owner, add to a query (ReadPermission
 * .addLabelGrantToQuery, OwnedScopePermission). A record with no labels of
 * its own carries those of every record it names: a grant keeps it when
 * one of them is linked to a granted label, as a block leaves it out when
 * one of them is linked to a blocked one.
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
  return Object.values(operator.objectLiteralParameters).flat().map(String);
};

const labelA: string = ObjectID.generate().toString();
const labelB: string = ObjectID.generate().toString();

describe("QueryHelper.namesNothingOrOneLinkedToAny", () => {
  const serviceLabels: {
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  } = {
    joinTableName: "ServiceLabel",
    ownerColumnName: "serviceId",
    relationColumnName: "labelId",
  };

  const hostLabels: {
    joinTableName: string;
    ownerColumnName: string;
    relationColumnName: string;
  } = {
    joinTableName: "HostLabel",
    ownerColumnName: "hostId",
    relationColumnName: "labelId",
  };

  test("keeps a record whose key is empty, or names a record linked to a granted label, over every join table", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.namesNothingOrOneLinkedToAny({
        values: [labelA, new ObjectID(labelB)],
        keys: [
          { columnName: "resourceId", joinTables: [serviceLabels, hostLabels] },
        ],
        parents: [],
      }),
    );

    // TypeORM hands a condition the unescaped `Alias.property`.
    const sql: string = operator.getSql("Item._id");

    expect(sql).toMatch(
      /^\(\("Item"\."resourceId" IS NULL\) OR "Item"\."resourceId" IN \(/,
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

  test("a record naming several records is kept through any one of them, and while it names none", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.namesNothingOrOneLinkedToAny({
        values: [labelA],
        keys: [
          {
            columnName: "incidentId",
            joinTables: [
              {
                joinTableName: "IncidentLabel",
                ownerColumnName: "incidentId",
                relationColumnName: "labelId",
              },
            ],
          },
          {
            columnName: "alertId",
            joinTables: [
              {
                joinTableName: "AlertLabel",
                ownerColumnName: "alertId",
                relationColumnName: "labelId",
              },
            ],
          },
        ],
        parents: [],
      }),
    );

    const sql: string = operator.getSql("Decision._id");

    expect(
      sql.startsWith(
        '(("Decision"."incidentId" IS NULL AND "Decision"."alertId" IS NULL) OR ',
      ),
    ).toBe(true);
    expect(sql).toContain(
      ' OR "Decision"."incidentId" IN (SELECT "IncidentLabel"."incidentId"',
    );
    expect(sql).toContain(
      ' OR "Decision"."alertId" IN (SELECT "AlertLabel"."alertId"',
    );
    expect(boundValues(operator)).toEqual([labelA]);
  });

  test("a record on parents through a join table is kept while one of them carries a granted label, or while it is on none", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.namesNothingOrOneLinkedToAny({
        values: [labelA, labelB],
        keys: [],
        parents: [
          {
            parentJoinTableName: "AnnouncementStatusPage",
            parentOwnerColumnName: "announcementId",
            parentRelationColumnName: "statusPageId",
            joinTableName: "StatusPageLabel",
            ownerColumnName: "statusPageId",
            relationColumnName: "labelId",
          },
        ],
      }),
    );

    const rid: string = Object.keys(operator.objectLiteralParameters)[0]!;

    expect(operator.getSql("Announcement._id")).toBe(
      `((NOT EXISTS (SELECT 1 FROM "AnnouncementStatusPage" WHERE "AnnouncementStatusPage"."announcementId" = Announcement._id)) OR EXISTS (SELECT 1 FROM "AnnouncementStatusPage" WHERE "AnnouncementStatusPage"."announcementId" = Announcement._id AND "AnnouncementStatusPage"."statusPageId" IN (SELECT "StatusPageLabel"."statusPageId" FROM "StatusPageLabel" WHERE "StatusPageLabel"."labelId" IN (:...${rid}))))`,
    );
    expect(boundValues(operator).sort()).toEqual([labelA, labelB].sort());
  });

  test("with no labels keeps only the records that name nothing", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.namesNothingOrOneLinkedToAny({
        values: [],
        keys: [{ columnName: "resourceId", joinTables: [serviceLabels] }],
        parents: [],
      }),
    );

    expect(operator.getSql("Item._id")).toBe('(("Item"."resourceId" IS NULL))');
    expect(boundValues(operator)).toEqual([]);
  });

  test.each([
    ["an unescaped alias", "Item._id", '"Item"."resourceId"'],
    ["an escaped alias", '"Item"."_id"', '"Item"."resourceId"'],
    ["a bare column, as an update names it", "_id", '"resourceId"'],
  ])(
    "writes the key beside the id under %s",
    (_label: string, alias: string, key: string) => {
      const operator: RawOperator = asRaw(
        QueryHelper.namesNothingOrOneLinkedToAny({
          values: [labelA],
          keys: [{ columnName: "resourceId", joinTables: [serviceLabels] }],
          parents: [],
        }),
      );

      expect(
        operator.getSql(alias).startsWith(`((${key} IS NULL) OR ${key} IN (`),
      ).toBe(true);
    },
  );

  test("quotes the identifiers it writes", () => {
    const operator: RawOperator = asRaw(
      QueryHelper.namesNothingOrOneLinkedToAny({
        values: [labelA],
        keys: [
          {
            columnName: 'resource"Id',
            joinTables: [
              {
                joinTableName: 'Odd"Table',
                ownerColumnName: 'owner"Id',
                relationColumnName: 'label"Id',
              },
            ],
          },
        ],
        parents: [],
      }),
    );

    const sql: string = operator.getSql("Item._id");

    expect(sql).toContain('"Item"."resource""Id" IS NULL');
    expect(sql).toContain(
      'SELECT "Odd""Table"."owner""Id" FROM "Odd""Table" WHERE "Odd""Table"."label""Id" IN',
    );
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
