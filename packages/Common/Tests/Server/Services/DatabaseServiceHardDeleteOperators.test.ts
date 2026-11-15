import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CLOUD_SAVINGS_SOURCE_ONEUPTIME } from "../../../Types/Cloud/CloudRightSizing";
import ObjectID from "../../../Types/ObjectID";
import {
  DateComparison,
  readDateComparison,
} from "../TestingUtils/DateComparisonPredicate";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A HARD DELETE'S OWN FILTERS, WRITTEN WITH ONEUPTIME'S OPERATORS (#8200).
 *
 * hardDeleteBy finds its rows, then deletes them by id with the query's
 * filters on the table's own columns. Those filters were handed to TypeORM
 * as the caller wrote them, and TypeORM does not know OneUptime's operators
 * (LessThan, Includes, NotEqual): it bound each object itself, and
 * Postgres refused the DELETE - "invalid input syntax for type timestamp
 * with time zone: {"_type":"LessThan",...}" - whenever the lookup found a
 * row. The cloud-savings cleanup (CloudSavingsWriter) is such a delete: a
 * recommendation the recommender stopped making failed every later read of
 * the cloud's savings. They are now written as a read writes them
 * (QueryUtil.serializeQuery); DateComparisonPostgres.test.ts runs that
 * delete on Postgres.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ACCOUNT_ID: ObjectID = ObjectID.generate();
const ROW_ID: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-11-15T10:00:00.000Z");

describe("DatabaseService.hardDeleteBy with OneUptime's operators", () => {
  let service: DatabaseService<CloudCostRecommendation>;
  let deletes: Array<Record<string, unknown>>;

  beforeEach(() => {
    service = new DatabaseService<CloudCostRecommendation>(
      CloudCostRecommendation,
    );
    deletes = [];

    const found: CloudCostRecommendation = new CloudCostRecommendation();
    found.id = ROW_ID;
    found.projectId = PROJECT_ID;

    jest.spyOn(service as never, "_findBy").mockResolvedValue([found] as never);
    jest
      .spyOn(service as never, "readRowsShowingImages")
      .mockResolvedValue([found] as never);
    jest
      .spyOn(service as never, "readRowsDeletedWith")
      .mockResolvedValue([] as never);
    jest.spyOn(service, "getRepository").mockReturnValue({
      delete: async (
        criteria: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        deletes.push(criteria);
        return { affected: 1 };
      },
    } as never);
    jest
      .spyOn(PublishedImages, "afterDelete")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function deleteWhere(
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    expect(
      await service.hardDeleteBy({
        query: query as unknown as Query<CloudCostRecommendation>,
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      }),
    ).toBe(1);

    expect(deletes).toHaveLength(1);

    return deletes[0]!;
  }

  function sqlOf(value: unknown): string {
    expect(value).toBeInstanceOf(FindOperator);

    const operator: FindOperator<unknown> = value as FindOperator<unknown>;
    const parameters: Record<string, unknown> =
      operator.objectLiteralParameters || {};

    return operator.getSql!("col").replace(
      /:(?:\.\.\.)?(\w+)/g,
      (_match: string, name: string) => {
        return JSON.stringify(parameters[name]);
      },
    );
  }

  test("the cloud-savings cleanup's DELETE binds each filter as Postgres reads it", async () => {
    const criteria: Record<string, unknown> = await deleteWhere({
      projectId: PROJECT_ID,
      cloudAccountId: new Includes([ACCOUNT_ID]),
      lastSeenAt: new LessThan<Date>(NOW),
      source: new NotEqual<string>(CLOUD_SAVINGS_SOURCE_ONEUPTIME),
    });

    const lastSeenAt: DateComparison = readDateComparison(
      criteria["lastSeenAt"],
    );

    expect(lastSeenAt.sql).toBe("(col < '2026-11-15T10:00:00.000Z')");
    expect(lastSeenAt.matches(NOW)).toBe(false);
    expect(lastSeenAt.matches(new Date(NOW.getTime() - 60_000))).toBe(true);

    expect(sqlOf(criteria["source"])).toBe(`(col != "OneUptime")`);
    expect(sqlOf(criteria["cloudAccountId"])).toContain(ACCOUNT_ID.toString());

    // Never the operator object, which TypeORM would bind as it is.
    for (const key of ["cloudAccountId", "lastSeenAt", "source"]) {
      expect(criteria[key]).not.toBeInstanceOf(LessThan);
      expect(criteria[key]).not.toBeInstanceOf(Includes);
      expect(criteria[key]).not.toBeInstanceOf(NotEqual);
    }

    // Pinned to the rows the lookup found, in the project.
    expect(sqlOf(criteria["_id"])).toContain(ROW_ID.toString());
    expect(String(criteria["projectId"])).toBe(PROJECT_ID.toString());
  });

  test("a value, an id and TypeORM's own operators are handed on as they are", async () => {
    const lessThan: unknown = QueryHelper.lessThan(NOW);
    const isNull: unknown = QueryHelper.isNull();

    const criteria: Record<string, unknown> = await deleteWhere({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      lastSeenAt: lessThan,
      region: isNull,
    });

    expect(criteria["projectId"]).toBe(PROJECT_ID);
    expect(criteria["provider"]).toBe(CloudProvider.AWS);
    expect(criteria["lastSeenAt"]).toBe(lessThan);
    expect(criteria["region"]).toBe(isNull);
  });

  test("a filter on a relation stays the lookup's, operator or not", async () => {
    const criteria: Record<string, unknown> = await deleteWhere({
      projectId: PROJECT_ID,
      cloudAccount: { name: new NotEqual<string>("prod") },
    });

    expect(criteria["cloudAccount"]).toBeUndefined();
  });
});
