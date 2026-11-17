import Entities from "../../../../../Models/DatabaseModels/Index";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import CappedCount from "../../../../../Server/Infrastructure/Postgres/CappedCount";
import PagedFind from "../../../../../Server/Infrastructure/Postgres/PagedFind";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import QueryUtil from "../../../../../Server/Types/Database/QueryUtil";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  DataSource,
  FindManyOptions,
  FindOperator,
  ObjectLiteral,
  Raw,
  Repository,
  SelectQueryBuilder,
} from "typeorm";

/*
 * A LABEL-LIMITED READER'S LIST PAGES AND COUNTS AS ANYONE ELSE'S (#8113).
 *
 * A grant limited to labels used to narrow a labelled model's read through
 * its labels relation (`labels: [permitted ids]`), a to-many join in the
 * WHERE. A join that can decide which records match keeps a page on
 * TypeORM's two queries - SELECT DISTINCT over every matching record times
 * its labels times every relation the list selects - and its count on a
 * DISTINCT over the same join (PagedFind, CappedCount). Now the permitted
 * labels are a condition on the record's own id, and so is the caller's
 * own filter by labels (the dashboard's label chips).
 *
 * These run the real permission pipeline (ModelPermission
 * .checkReadQueryPermission, as DatabaseService.findBy does) and the real
 * serializer, on a data source built from every OneUptime model with no
 * database - the label join tables are named as a migrated database names
 * them - and hold the SQL the reads would send:
 *
 *   - a label-limited reader's list takes its page's ids from the table
 *     itself, with no join, and counts with no DISTINCT and no join;
 *   - its rows are read with every label each record carries: no condition
 *     on the joined labels trims them to the permitted ones;
 *   - a filter by labels (Includes, a list of ids) does the same, for a
 *     label-limited reader and for anyone; IncludesAll, IncludesNone,
 *     IsNull and NotNull were conditions on the id already;
 *   - a block with labels, and labels beside grants scoped to Owned, beside
 *     it;
 *   - a read of one record by id stays one query;
 *   - another relation of many records (an incident's monitors) keeps its
 *     filter through the relation.
 *
 * The results themselves - the very records and counts the old reads gave,
 * for many grants, blocks and filters - are held on a real Postgres in
 * LabelLimitedListsPostgres.test.ts.
 */

let dataSource: DataSource;

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const PRODUCTION: ObjectID = ObjectID.generate();
const STAGING: ObjectID = ObjectID.generate();
const EU: ObjectID = ObjectID.generate();

function propsWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      ...rows,
      {
        _type: "UserPermission",
        permission: Permission.ProjectUser,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function member(labelIds: Array<ObjectID> | null): UserPermission {
  return {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: labelIds || [],
    isBlockPermission: false,
    scope: labelIds ? PermissionScope.Labels : PermissionScope.All,
    teamId: TEAM_ID,
  };
}

const UNLIMITED: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return propsWith([member(null)]);
  };

const LIMITED: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return propsWith([member([PRODUCTION, STAGING])]);
  };

// The list as the dashboard reads it: labels, the record's state, a to-one.
const ALERTS_LIST_SELECT: Record<string, unknown> = {
  _id: true,
  title: true,
  createdAt: true,
  labels: { _id: true, name: true, color: true },
  currentAlertState: { _id: true, name: true, color: true },
  monitor: { _id: true, name: true },
};

/*
 * What DatabaseService._findBy hands PagedFind for a page: the permitted
 * query, select and relations, the order completed by the primary key.
 */
async function pageOptions<T extends BaseModel>(data: {
  modelType: { new (): T };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  skip?: number | undefined;
  take?: number | undefined;
}): Promise<FindManyOptions<T>> {
  const permitted: CheckReadPermissionType<T> =
    await ModelPermission.checkReadQueryPermission(
      data.modelType,
      data.query as Query<T>,
      data.select as never,
      data.props,
    );

  return {
    where: permitted.query as never,
    select: permitted.select as never,
    relations: permitted.relationSelect as never,
    order: { createdAt: "DESC", _id: "ASC" } as never,
    skip: data.skip ?? 0,
    take: data.take ?? 10,
  };
}

// What CountBy hands CappedCount: the permitted query alone.
async function countOptions<T extends BaseModel>(data: {
  modelType: { new (): T };
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}): Promise<FindManyOptions<T>> {
  const permitted: CheckReadPermissionType<T> =
    await ModelPermission.checkReadQueryPermission(
      data.modelType,
      data.query as Query<T>,
      null,
      data.props,
    );

  return { where: permitted.query as never };
}

function repositoryOf<T extends ObjectLiteral>(target: {
  new (): T;
}): Repository<T> {
  return dataSource.getRepository<T>(target);
}

function idPageSql<T extends ObjectLiteral>(
  target: { new (): T },
  options: FindManyOptions<T>,
): string | null {
  const builder: SelectQueryBuilder<T> | null =
    PagedFind.createIdPageQueryBuilder(repositoryOf(target), options);

  return builder ? builder.getQuery() : null;
}

// The rows of a page's ids, as PagedFind reads them (TypeORM's second query).
function rowsSql<T extends ObjectLiteral>(
  target: { new (): T },
  options: FindManyOptions<T>,
): string {
  const builder: SelectQueryBuilder<T> = PagedFind.createQueryBuilder(
    repositoryOf(target),
    options,
  );

  PagedFind.restrictToIds(builder, [ObjectID.generate().toString()]);

  return builder.getQuery();
}

function countSql<T extends ObjectLiteral>(
  target: { new (): T },
  options: FindManyOptions<T>,
): string {
  return CappedCount.createQueryBuilder(
    repositoryOf(target),
    options,
    10000,
  ).getQuery();
}

// The ids a condition on the record's id binds, wherever it binds them.
function boundIds(operator: unknown): Array<string> {
  const ids: Array<string> = [];
  const visit: (value: unknown) => void = (value: unknown): void => {
    if (value instanceof FindOperator) {
      visit(value.objectLiteralParameters);
      visit(value.value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit);
      return;
    }

    if (typeof value === "string") {
      ids.push(value);
    }
  };

  visit(operator);

  return ids.sort();
}

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

beforeEach(() => {
  // The label join tables, from the models' metadata, as on a database.
  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(dataSource);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the label join tables, as the models' metadata names them", () => {
  test("a labelled model's labels: its join table, and the Label table it links to", () => {
    expect(QueryUtil.getManyToManyRelationMetadata(Alert, "labels")).toEqual({
      joinTableName: "AlertLabel",
      ownerColumnName: "alertId",
      relationColumnName: "labelId",
    });
    expect(QueryUtil.getManyToManyRelatedTable(Alert, "labels")).toEqual({
      tableName: "Label",
      columnName: "_id",
      deleteDateColumnName: "deletedAt",
    });
    expect(QueryUtil.getManyToManyRelatedTable(Incident, "monitors")).toEqual({
      tableName: "Monitor",
      columnName: "_id",
      deleteDateColumnName: "deletedAt",
    });
  });

  test("nothing for a relation of one record, a column, or without a database", () => {
    expect(QueryUtil.getManyToManyRelatedTable(Alert, "monitor")).toBeNull();
    expect(QueryUtil.getManyToManyRelatedTable(Alert, "title")).toBeNull();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);

    expect(QueryUtil.getManyToManyRelatedTable(Alert, "labels")).toBeNull();
    expect(
      QueryUtil.getLinkedToAnyCondition(Alert, "labels", [PRODUCTION]),
    ).toBeNull();
  });

  test("a filter by labels is a condition on the id; one by another list of records is not", () => {
    expect(
      QueryUtil.getLabelsFilterCondition(Alert, "labels", [PRODUCTION]),
    ).toBeInstanceOf(FindOperator);
    expect(
      QueryUtil.getLabelsFilterCondition(Incident, "monitors", [PRODUCTION]),
    ).toBeNull();
  });
});

describe("a label-limited reader's list", () => {
  test("takes its page's ids from the table itself: no join, no DISTINCT, the permitted labels a subquery", async () => {
    const options: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: LIMITED(),
    });

    // No filter through the labels relation: a condition on the id.
    expect((options.where as Record<string, unknown>)["labels"]).toBe(
      undefined,
    );
    expect(boundIds((options.where as Record<string, unknown>)["_id"])).toEqual(
      [PRODUCTION.toString(), STAGING.toString()].sort(),
    );

    const sql: string | null = idPageSql(Alert, options);

    expect(sql).not.toBeNull();
    expect(sql).not.toContain("JOIN");
    expect(sql).not.toContain("DISTINCT");
    expect(sql).toContain(
      `"Alert"."_id" IN (SELECT "AlertLabel"."alertId" FROM "AlertLabel" WHERE "AlertLabel"."labelId" IN (SELECT "Label"."_id" FROM "Label" WHERE "Label"."_id" IN (`,
    );
    expect(sql).toContain(`AND "Label"."deletedAt" IS NULL))`);
    expect(sql).toContain("LIMIT 10");
  });

  test("reads each record of the page with every label it carries", async () => {
    const options: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: LIMITED(),
    });

    const sql: string = rowsSql(Alert, options);
    const where: string = sql.slice(sql.indexOf(" WHERE "));

    // The labels are joined to be selected, and nothing in the WHERE names them.
    expect(sql).toContain('LEFT JOIN "Label" "Alert__Alert_labels"');
    expect(where).not.toContain('"Alert__Alert_labels"');
  });

  test("counts with no DISTINCT and no join", async () => {
    const sql: string = countSql(
      Alert,
      await countOptions({
        modelType: Alert,
        query: { projectId: PROJECT_ID },
        props: LIMITED(),
      }),
    );

    expect(sql).not.toContain("DISTINCT");
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain(`"AlertLabel"."alertId"`);
    expect(sql).toContain("LIMIT 10001");
  });

  test.each([
    ["Monitors", Monitor, "MonitorLabel", "monitorId"],
    ["Incidents", Incident, "IncidentLabel", "incidentId"],
    ["Network Devices", NetworkDevice, "NetworkDeviceLabel", "networkDeviceId"],
  ] as Array<[string, { new (): BaseModel }, string, string]>)(
    "%s take their page's ids from the table too",
    async (
      _name: string,
      modelType: { new (): BaseModel },
      joinTable: string,
      ownerColumn: string,
    ) => {
      const options: FindManyOptions<BaseModel> = await pageOptions({
        modelType: modelType,
        query: { projectId: PROJECT_ID },
        select: {
          _id: true,
          createdAt: true,
          labels: { _id: true, name: true },
        },
        props: LIMITED(),
      });

      const sql: string | null = idPageSql(modelType, options);

      expect(sql).not.toBeNull();
      expect(sql).not.toContain("JOIN");
      expect(sql).toContain(`"${joinTable}"."${ownerColumn}"`);
    },
  );

  test("is the same id page an unlimited reader's is, but for the permitted labels", async () => {
    const unlimited: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: UNLIMITED(),
    });
    const limited: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: LIMITED(),
    });

    const unlimitedSql: string = idPageSql(Alert, unlimited)!;
    const limitedSql: string = idPageSql(Alert, limited)!;

    // The same table, column, order and page; the WHERE has the labels too.
    const head: (sql: string) => string = (sql: string): string => {
      return sql.slice(0, sql.indexOf(" WHERE "));
    };
    const tail: (sql: string) => string = (sql: string): string => {
      return sql.slice(sql.indexOf(" ORDER BY "));
    };

    expect(unlimitedSql).not.toContain("AlertLabel");
    expect(limitedSql).toContain("AlertLabel");
    expect(head(limitedSql)).toBe(head(unlimitedSql));
    expect(tail(limitedSql)).toBe(tail(unlimitedSql));
  });

  test("a later page too: its ids by LIMIT and OFFSET on the table", async () => {
    const sql: string | null = idPageSql(
      Alert,
      await pageOptions({
        modelType: Alert,
        query: { projectId: PROJECT_ID },
        select: ALERTS_LIST_SELECT,
        props: LIMITED(),
        skip: 490,
      }),
    );

    expect(sql).toContain("LIMIT 10 OFFSET 490");
    expect(sql).not.toContain("JOIN");
  });

  test("a block with labels beside the grant: two conditions on the id, still no join", async () => {
    const options: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: propsWith([
        member([PRODUCTION, STAGING]),
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [EU],
          isBlockPermission: true,
        },
      ]),
    });

    const sql: string | null = idPageSql(Alert, options);

    expect(sql).not.toBeNull();
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain(
      `"Alert"."_id" NOT IN (SELECT "AlertLabel"."alertId"`,
    );
    expect(sql).toContain(`"Alert"."_id" IN (SELECT "AlertLabel"."alertId"`);
  });

  test("labels beside a grant scoped to Owned: the labels' condition is the same subquery", async () => {
    // The records the caller's teams own: read from the owner tables, here stood in for.
    jest
      .spyOn(OwnedScopePermission, "getOwnedRecordsCondition")
      .mockResolvedValue({
        columnName: null,
        condition: Raw((alias: string): string => {
          return `(${alias} IN (SELECT "AlertOwnerUser"."alertId" FROM "AlertOwnerUser"))`;
        }),
      });

    const options: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { projectId: PROJECT_ID },
      select: ALERTS_LIST_SELECT,
      props: propsWith([
        member([PRODUCTION]),
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
          scope: PermissionScope.Owned,
          teamId: ObjectID.generate(),
        },
      ]),
    });

    const sql: string | null = idPageSql(Alert, options);

    expect(sql).not.toBeNull();
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain(
      `IN (SELECT "Label"."_id" FROM "Label" WHERE "Label"."_id" IN (`,
    );
    expect(sql).toContain(`"AlertOwnerUser"`);
  });

  test("a read of one record by id is still one query", async () => {
    const options: FindManyOptions<Alert> = await pageOptions({
      modelType: Alert,
      query: { _id: ObjectID.generate().toString() },
      select: ALERTS_LIST_SELECT,
      props: LIMITED(),
      take: 1,
    });

    const builder: SelectQueryBuilder<Alert> = PagedFind.createQueryBuilder(
      repositoryOf(Alert),
      options,
    );

    expect(builder.expressionMap.take).toBe(undefined);
    expect(builder.expressionMap.skip).toBe(undefined);
    expect(builder.getQuery()).not.toContain("LIMIT");
    expect(
      PagedFind.createIdPageQueryBuilder(repositoryOf(Alert), options),
    ).toBe(null);
  });
});

describe("a list filtered by its labels", () => {
  test.each([
    ["an unlimited reader, by Includes", UNLIMITED, new Includes([EU])],
    ["an unlimited reader, by a list of ids", UNLIMITED, [EU.toString()]],
    [
      "a label-limited reader, by Includes",
      LIMITED,
      new Includes([EU, PRODUCTION]),
    ],
    [
      "a label-limited reader, by { _id } objects",
      LIMITED,
      [{ _id: EU.toString() }],
    ],
  ] as Array<[string, () => DatabaseCommonInteractionProps, unknown]>)(
    "%s: its ids from the table, with no join",
    async (
      _who: string,
      props: () => DatabaseCommonInteractionProps,
      labels: unknown,
    ) => {
      const options: FindManyOptions<Alert> = await pageOptions({
        modelType: Alert,
        query: { projectId: PROJECT_ID, labels: labels },
        select: ALERTS_LIST_SELECT,
        props: props(),
      });

      expect((options.where as Record<string, unknown>)["labels"]).toBe(
        undefined,
      );
      // The filter's labels are bound, beside any grant's.
      expect(
        boundIds((options.where as Record<string, unknown>)["_id"]),
      ).toEqual(expect.arrayContaining([EU.toString()]));

      const sql: string | null = idPageSql(Alert, options);

      expect(sql).not.toBeNull();
      expect(sql).not.toContain("JOIN");

      // The rows: every label each record carries, none trimmed away.
      const rows: string = rowsSql(Alert, options);
      expect(rows.slice(rows.indexOf(" WHERE "))).not.toContain(
        '"Alert__Alert_labels"',
      );
    },
  );

  test.each([
    ["IncludesAll", new IncludesAll([EU, PRODUCTION])],
    ["IncludesNone", new IncludesNone([EU])],
    ["IsNull", new IsNull()],
    ["NotNull", new NotNull()],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "by %s: a condition on the id, beside a label-limited reader's",
    async (_operator: string, labels: unknown) => {
      const options: FindManyOptions<Alert> = await pageOptions({
        modelType: Alert,
        query: { projectId: PROJECT_ID, labels: labels },
        select: ALERTS_LIST_SELECT,
        props: LIMITED(),
      });

      expect((options.where as Record<string, unknown>)["labels"]).toBe(
        undefined,
      );

      const sql: string | null = idPageSql(Alert, options);

      expect(sql).not.toBeNull();
      expect(sql).not.toContain("JOIN");
      expect(sql).toContain(`"Alert"."_id" IN (SELECT "AlertLabel"."alertId"`);
    },
  );

  /*
   * IS NULL on the relation is no SQL TypeORM writes: a list read with
   * `labels: null` was refused with a server error. It asks for the records
   * with no labels, as IsNull does.
   */
  test("by null: the records with no labels, as IsNull asks", () => {
    const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
      Alert,
      { projectId: PROJECT_ID.toString(), labels: null } as never,
    ) as Record<string, unknown>;

    expect(serialized["labels"]).toBeUndefined();
    expect(
      (serialized["_id"] as FindOperator<unknown>).getSql!('"Alert"."_id"'),
    ).toContain(`"Alert"."_id"`);
    expect(
      (serialized["_id"] as FindOperator<unknown>).getSql!('"Alert"."_id"'),
    ).toContain(`"AlertLabel"`);
  });

  test("another relation of many records keeps its filter through the relation", async () => {
    const options: FindManyOptions<Incident> = await pageOptions({
      modelType: Incident,
      query: {
        projectId: PROJECT_ID,
        monitors: new Includes([ObjectID.generate()]),
      },
      select: { _id: true, createdAt: true, monitors: { _id: true } },
      props: UNLIMITED(),
    });

    expect(
      (options.where as Record<string, unknown>)["monitors"],
    ).toBeDefined();
    expect(idPageSql(Incident, options)).toBeNull();
  });
});

/*
 * A filter on a list relation that is a condition on the record's id
 * (IsNull, NotNull, IncludesAll, IncludesNone) used to take the id's own
 * filter's place when the id's key came later in the query and had not
 * been serialized yet: a read of some records by id read every record the
 * relation's filter matched.
 */
describe("a filter on a list relation beside the id's own, whatever the order of their keys", () => {
  const first: ObjectID = ObjectID.generate();
  const second: ObjectID = ObjectID.generate();

  test.each([
    ["IsNull", new IsNull()],
    ["NotNull", new NotNull()],
    ["IncludesAll", new IncludesAll([EU, PRODUCTION])],
    ["IncludesNone", new IncludesNone([EU])],
    ["null", null],
  ] as Array<[string, unknown]>)(
    "%s before the id's filter keeps the id's filter",
    (_operator: string, labels: unknown) => {
      for (const idFilter of [
        new Includes([first, second]),
        [first.toString(), second.toString()],
        first,
        first.toString(),
      ]) {
        const serialized: Record<string, unknown> = QueryUtil.serializeQuery(
          Alert,
          { labels: labels, _id: idFilter } as never,
        ) as Record<string, unknown>;

        const idCondition: FindOperator<unknown> = serialized[
          "_id"
        ] as FindOperator<unknown>;

        expect(idCondition).toBeInstanceOf(FindOperator);
        expect(idCondition.type).toBe("and");
        expect(boundIds(idCondition)).toEqual(
          expect.arrayContaining(
            idFilter instanceof Includes || Array.isArray(idFilter)
              ? [first.toString(), second.toString()]
              : [first.toString()],
          ),
        );
      }
    },
  );

  test("an id that is not a uuid is refused, as it is alone", () => {
    expect(() => {
      QueryUtil.serializeQuery(Alert, {
        labels: new IsNull(),
        _id: "resolved",
      } as never);
    }).toThrow('Invalid ID for "_id"');
  });
});
