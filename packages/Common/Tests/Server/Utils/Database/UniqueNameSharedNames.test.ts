import DatabaseService from "../../../../Server/Services/DatabaseService";
import UniqueNameInProject from "../../../../Server/Utils/Database/UniqueNameInProject";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  NAME_WHITE_SPACE_RUN_PATTERN,
  getNameKeySql,
} from "../../../../Types/Database/UniqueName";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE RECORDS OF A PROJECT THAT SHARE A NAME (#9746,
 * UniqueNameInProject.findRecordsSharingName), for their list to mark.
 *
 *   - Found among every record of the project, as OneUptime, in one query:
 *     its rows counted by their name as Postgres reads it - the key
 *     findWithSameName compares - and the rows whose name another row has;
 *     deleted rows are no record.
 *   - Then only those the reader may read, read with the reader's own
 *     props: a group the reader sees one record of still marks it, since
 *     the other holds its name all the same.
 *   - Nothing shared: nothing more is read.
 *
 * The repository's query and the service's read are stubbed and recorded;
 * UniqueNamePostgres runs the query on a real Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TENANTS_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANTS_B: string = "aaaaaaaa-0000-4000-8000-000000000002";
const PLATFORM_A: string = "aaaaaaaa-0000-4000-8000-000000000003";
const PLATFORM_HIDDEN: string = "aaaaaaaa-0000-4000-8000-000000000004";

const READER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  tenantId: PROJECT_ID,
};

interface QueryCall {
  sql: string;
  parameters: Array<unknown>;
}

interface FindCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

function fakeService(data: {
  rows: Array<{ id: string; nameKey: string }>;
  readableIds: Array<string>;
}): {
  service: DatabaseService<BaseModel>;
  queries: Array<QueryCall>;
  finds: Array<FindCall>;
} {
  const queries: Array<QueryCall> = [];
  const finds: Array<FindCall> = [];

  const repository: {
    metadata: { tableName: string };
    query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
  } = {
    metadata: { tableName: "Team" },
    query: async (sql: string, parameters: Array<unknown>) => {
      queries.push({ sql, parameters });
      return data.rows;
    },
  };

  const service: unknown = {
    getRepository: () => {
      return repository;
    },
    findBy: async (findBy: FindCall): Promise<Array<BaseModel>> => {
      finds.push(findBy);

      return data.readableIds.map((id: string): BaseModel => {
        return new Team(new ObjectID(id));
      });
    },
  };

  return {
    service: service as DatabaseService<BaseModel>,
    queries,
    finds,
  };
}

describe("the records of a project that share a name", () => {
  test("are found in one query, counted by their name as Postgres reads it, deleted rows left out", async () => {
    const { service, queries } = fakeService({ rows: [], readableIds: [] });

    await UniqueNameInProject.findRecordsSharingName({
      service: service,
      projectId: PROJECT_ID,
      props: READER_PROPS,
    });

    expect(queries).toHaveLength(1);

    const query: QueryCall = queries[0]!;
    const nameKey: string = getNameKeySql({
      textSql: `"name"`,
      patternSql: "$2",
    });

    expect(query.sql).toContain(`FROM "Team"`);
    expect(query.sql).toContain(`${nameKey} AS "nameKey"`);
    expect(query.sql).toContain(`COUNT(*) OVER (PARTITION BY ${nameKey})`);
    expect(query.sql).toContain(`"projectId" = $1`);
    expect(query.sql).toContain(`"deletedAt" IS NULL`);
    expect(query.sql).toContain(`WHERE "count" > 1`);
    expect(query.parameters).toEqual([
      PROJECT_ID.toString(),
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);
  });

  test("none shared: nothing more is read", async () => {
    const { service, finds } = fakeService({ rows: [], readableIds: [] });

    await expect(
      UniqueNameInProject.findRecordsSharingName({
        service: service,
        projectId: PROJECT_ID,
        props: READER_PROPS,
      }),
    ).resolves.toEqual([]);
    expect(finds).toEqual([]);
  });

  test("are grouped by their name, each group the records the reader may read, read as the reader", async () => {
    const { service, finds } = fakeService({
      rows: [
        { id: PLATFORM_A, nameKey: "platform team" },
        { id: PLATFORM_HIDDEN, nameKey: "platform team" },
        { id: TENANTS_A.toUpperCase(), nameKey: "tenants" },
        { id: TENANTS_B, nameKey: "tenants" },
      ],
      readableIds: [TENANTS_A, TENANTS_B, PLATFORM_A],
    });

    const groups: Array<Array<string>> =
      await UniqueNameInProject.findRecordsSharingName({
        service: service,
        projectId: PROJECT_ID,
        props: READER_PROPS,
      });

    /*
     * Platform's twin is one the reader may not read: Platform is marked
     * all the same, as its name is taken.
     */
    expect(groups).toEqual([[PLATFORM_A], [TENANTS_A, TENANTS_B]]);

    expect(finds).toHaveLength(1);
    const find: FindCall = finds[0]!;

    expect(find.props).toBe(READER_PROPS);
    expect(find.query["projectId"]).toEqual(PROJECT_ID);
    expect(find.select).toEqual({ _id: true });

    const ids: RawOperator = find.query["_id"] as RawOperator;

    expect(
      (Object.values(ids.objectLiteralParameters)[0] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString().toLowerCase();
        },
      ),
    ).toEqual([PLATFORM_A, PLATFORM_HIDDEN, TENANTS_A, TENANTS_B]);
  });

  test("a group the reader may read none of is no group", async () => {
    const { service } = fakeService({
      rows: [
        { id: TENANTS_A, nameKey: "tenants" },
        { id: TENANTS_B, nameKey: "tenants" },
      ],
      readableIds: [],
    });

    await expect(
      UniqueNameInProject.findRecordsSharingName({
        service: service,
        projectId: PROJECT_ID,
        props: READER_PROPS,
      }),
    ).resolves.toEqual([]);
  });

  test("a reader who may not read the kind is refused, as a list of it is", async () => {
    const { service } = fakeService({
      rows: [
        { id: TENANTS_A, nameKey: "tenants" },
        { id: TENANTS_B, nameKey: "tenants" },
      ],
      readableIds: [],
    });

    jest
      .spyOn(service as unknown as { findBy: () => Promise<unknown> }, "findBy")
      .mockRejectedValue(
        new Error("You do not have permission to read teams.") as never,
      );

    await expect(
      UniqueNameInProject.findRecordsSharingName({
        service: service,
        projectId: PROJECT_ID,
        props: READER_PROPS,
      }),
    ).rejects.toThrow("You do not have permission to read teams.");
  });
});
