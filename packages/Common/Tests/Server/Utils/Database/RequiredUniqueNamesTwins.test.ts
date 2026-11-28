import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentTemplateService from "../../../../Server/Services/IncidentTemplateService";
import MonitorGroupService from "../../../../Server/Services/MonitorGroupService";
import MonitorService from "../../../../Server/Services/MonitorService";
import RequiredUniqueNames from "../../../../Server/Utils/Database/RequiredUniqueNames";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../../../Models/DatabaseModels/MonitorGroup";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { SharedNamesAnswer } from "../../../../Types/Database/SharedNames";
import { NAME_WHITE_SPACE_RUN_PATTERN } from "../../../../Types/Database/UniqueName";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE RECORDS OF A KIND REQUIRE UNIQUE NAMES HOLDS THAT SHARE A NAME, FOR
 * ITS LIST TO MARK (#11021, RequiredUniqueNames.findTwinsOfKind).
 *
 *   - Found among every record of the kind in the project, as OneUptime, in
 *     one query on the kind's own name column, as the rule compares names
 *     (a template's templateName, a monitor's name); deleted rows are none.
 *   - A kind with an archive counts its records in service and its
 *     archived ones apart: each list shows one or the other.
 *   - Then only the records the reader may read, with the reader's own
 *     props, never as root; a group is answered only while two of it or
 *     more are left, so a mark never says a record they may not read has
 *     the name.
 *   - When each record was made comes with it, to tell twins apart.
 *   - A reader who may not read the kind is refused, as a list is.
 *
 * The repository's query and the service's read are stubbed and recorded;
 * RequiredUniqueNamesPostgres runs the lookup on a real Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111011021",
);

const READER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222011021"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
};

interface Row {
  id: string;
  nameKey: string;
  isArchived: boolean | string | null;
}

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedFind {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  props: DatabaseCommonInteractionProps;
}

type StubbedService =
  | typeof MonitorService
  | typeof MonitorGroupService
  | typeof IncidentTemplateService;

function stubRows(
  service: StubbedService,
  tableName: string,
  rows: Array<Row>,
): Array<{ sql: string; values: unknown }> {
  const queries: Array<{ sql: string; values: unknown }> = [];

  getJestSpyOn(service, "getRepository").mockReturnValue({
    metadata: { tableName: tableName },
    query: async (sql: string, values: unknown): Promise<Array<Row>> => {
      queries.push({ sql, values });
      return rows;
    },
  } as never);

  return queries;
}

function stubReadable<T>(
  service: StubbedService,
  records: Array<T>,
): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  getJestSpyOn(service, "findBy").mockImplementation((async (
    findBy: RecordedFind,
  ): Promise<Array<T>> => {
    finds.push(findBy);
    return records;
  }) as never);

  return finds;
}

function monitor(n: number, createdAt?: string): Monitor {
  const model: Monitor = new Monitor(new ObjectID(id(n)));
  if (createdAt) {
    model.createdAt = new Date(createdAt);
  }
  return model;
}

function askedIds(find: RecordedFind): Array<string> {
  const ids: unknown = Object.values(
    (find.query["_id"] as RawOperator).objectLiteralParameters,
  )[0];

  return (Array.isArray(ids) ? ids : []).map((value: unknown): string => {
    return String(value).toLowerCase();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the twins of a kind", () => {
  test("groups the records whose names read alike, read with the reader's own props", async () => {
    const queries: Array<{ sql: string; values: unknown }> = stubRows(
      MonitorService,
      "Monitor",
      [
        { id: id(1), nameKey: "api health check", isArchived: false },
        { id: id(2), nameKey: "api health check", isArchived: false },
        { id: id(3), nameKey: "web", isArchived: false },
        { id: id(4), nameKey: "web", isArchived: false },
        { id: id(5), nameKey: "web", isArchived: false },
      ],
    );
    const finds: Array<RecordedFind> = stubReadable(MonitorService, [
      monitor(1, "2026-11-05T05:14:00.000Z"),
      monitor(2, "2026-11-07T09:30:00.000Z"),
      monitor(3, "2026-10-01T00:00:00.000Z"),
      monitor(4, "2026-10-02T00:00:00.000Z"),
      monitor(5, "2026-10-03T00:00:00.000Z"),
    ]);

    const answer: SharedNamesAnswer = await RequiredUniqueNames.findTwinsOfKind(
      { service: MonitorService, projectId: PROJECT_ID, props: READER },
    );

    expect(answer).toEqual({
      groups: [
        [id(1), id(2)],
        [id(3), id(4), id(5)],
      ],
      createdAt: {
        [id(1)]: "2026-11-05T05:14:00.000Z",
        [id(2)]: "2026-11-07T09:30:00.000Z",
        [id(3)]: "2026-10-01T00:00:00.000Z",
        [id(4)]: "2026-10-02T00:00:00.000Z",
        [id(5)]: "2026-10-03T00:00:00.000Z",
      },
    });

    // One query: the project's records, by their name as the rule reads it.
    expect(queries).toHaveLength(1);
    const sql: string = queries[0]!.sql;
    expect(sql).toContain(`LOWER(BTRIM(REGEXP_REPLACE("name", $2`);
    expect(sql).toContain(`FROM "Monitor"`);
    expect(sql).toContain(`"projectId" = $1`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`"name" IS NOT NULL`);
    expect(sql).toContain(`"count" > 1`);
    expect(sql).toContain(`"nameKey" <> ''`);
    expect(sql).toContain(`LIMIT ${LIMIT_PER_PROJECT}`);
    expect(queries[0]!.values).toEqual([
      PROJECT_ID.toString(),
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);

    // Then the reader's own read of those records: never as root.
    expect(finds).toHaveLength(1);
    expect(finds[0]!.props).toBe(READER);
    expect(finds[0]!.props.isRoot).toBeFalsy();
    expect(finds[0]!.query["projectId"]).toEqual(PROJECT_ID);
    expect(finds[0]!.select).toEqual({ _id: true, createdAt: true });
    expect(finds[0]!.limit).toBe(LIMIT_PER_PROJECT);
    expect(askedIds(finds[0]!)).toEqual([id(1), id(2), id(3), id(4), id(5)]);
  });

  test("a monitor's records in service and its archived ones are counted apart", async () => {
    const queries: Array<{ sql: string; values: unknown }> = stubRows(
      MonitorService,
      "Monitor",
      [
        // Two in service, and an archived one of the same name.
        { id: id(1), nameKey: "api", isArchived: false },
        { id: id(2), nameKey: "api", isArchived: false },
        { id: id(3), nameKey: "api", isArchived: true },
        { id: id(4), nameKey: "api", isArchived: "true" },
      ],
    );
    stubReadable(MonitorService, [
      monitor(1),
      monitor(2),
      monitor(3),
      monitor(4),
    ]);

    const answer: SharedNamesAnswer = await RequiredUniqueNames.findTwinsOfKind(
      { service: MonitorService, projectId: PROJECT_ID, props: READER },
    );

    expect(answer.groups).toEqual([
      [id(1), id(2)],
      [id(3), id(4)],
    ]);

    // The window counts each name in service and archived apart.
    expect(queries[0]!.sql).toContain(`COALESCE("isArchived", false)`);
    expect(queries[0]!.sql).toMatch(
      /PARTITION BY .+, COALESCE\("isArchived", false\)\)/,
    );
  });

  test("a kind with no archive counts every record of a name together", async () => {
    const queries: Array<{ sql: string; values: unknown }> = stubRows(
      MonitorGroupService,
      "MonitorGroup",
      [
        { id: id(1), nameKey: "edge", isArchived: false },
        { id: id(2), nameKey: "edge", isArchived: false },
      ],
    );
    stubReadable(MonitorGroupService, [
      new MonitorGroup(new ObjectID(id(1))),
      new MonitorGroup(new ObjectID(id(2))),
    ]);

    const answer: SharedNamesAnswer = await RequiredUniqueNames.findTwinsOfKind(
      { service: MonitorGroupService, projectId: PROJECT_ID, props: READER },
    );

    expect(answer.groups).toEqual([[id(1), id(2)]]);
    // No archive column is read: every record of a name is one group.
    expect(queries[0]!.sql).not.toContain(`COALESCE("isArchived"`);
    expect(queries[0]!.sql).toContain(`false AS "isArchived"`);
    expect(queries[0]!.sql).toContain(`FROM "MonitorGroup"`);
  });

  test("a template is known by its templateName", async () => {
    const queries: Array<{ sql: string; values: unknown }> = stubRows(
      IncidentTemplateService,
      "IncidentTemplate",
      [
        { id: id(1), nameKey: "db down", isArchived: false },
        { id: id(2), nameKey: "db down", isArchived: false },
      ],
    );
    stubReadable(IncidentTemplateService, [
      new IncidentTemplate(new ObjectID(id(1))),
      new IncidentTemplate(new ObjectID(id(2))),
    ]);

    const answer: SharedNamesAnswer = await RequiredUniqueNames.findTwinsOfKind(
      {
        service: IncidentTemplateService,
        projectId: PROJECT_ID,
        props: READER,
      },
    );

    expect(answer.groups).toEqual([[id(1), id(2)]]);
    expect(queries[0]!.sql).toContain(
      `LOWER(BTRIM(REGEXP_REPLACE("templateName", $2`,
    );
    expect(queries[0]!.sql).toContain(`"templateName" IS NOT NULL`);
    expect(queries[0]!.sql).not.toContain(`REGEXP_REPLACE("name"`);
  });
});

describe("what the reader may not read", () => {
  test("a group the reader may read one record of is no group: the other may be hidden from them", async () => {
    stubRows(MonitorService, "Monitor", [
      { id: id(1), nameKey: "billing", isArchived: false },
      { id: id(2), nameKey: "billing", isArchived: false },
      { id: id(3), nameKey: "web", isArchived: false },
      { id: id(4), nameKey: "web", isArchived: false },
      { id: id(5), nameKey: "web", isArchived: false },
    ]);
    // Billing's twin (2) and one of web's (5) are hidden from the reader.
    stubReadable(MonitorService, [
      monitor(1, "2026-11-01T00:00:00.000Z"),
      monitor(3, "2026-11-02T00:00:00.000Z"),
      monitor(4, "2026-11-03T00:00:00.000Z"),
    ]);

    const answer: SharedNamesAnswer = await RequiredUniqueNames.findTwinsOfKind(
      { service: MonitorService, projectId: PROJECT_ID, props: READER },
    );

    expect(answer.groups).toEqual([[id(3), id(4)]]);

    // Nothing of a record the reader may not read, or of its lone twin.
    expect(Object.keys(answer.createdAt || {}).sort()).toEqual([id(3), id(4)]);
    for (const hidden of [id(1), id(2), id(5)]) {
      expect(JSON.stringify(answer)).not.toContain(hidden);
    }
  });

  test("a reader who reads none of them has no twins", async () => {
    stubRows(MonitorService, "Monitor", [
      { id: id(1), nameKey: "x", isArchived: false },
      { id: id(2), nameKey: "x", isArchived: false },
    ]);
    stubReadable(MonitorService, []);

    expect(
      await RequiredUniqueNames.findTwinsOfKind({
        service: MonitorService,
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual({ groups: [], createdAt: {} });
  });

  test("a reader who may not read the kind is refused, as a list of it is", async () => {
    stubRows(MonitorService, "Monitor", [
      { id: id(1), nameKey: "x", isArchived: false },
      { id: id(2), nameKey: "x", isArchived: false },
    ]);
    getJestSpyOn(MonitorService, "findBy").mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read monitors.",
      ),
    );

    await expect(
      RequiredUniqueNames.findTwinsOfKind({
        service: MonitorService,
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});

describe("when there is nothing to mark", () => {
  test("no name repeats: nothing more is read", async () => {
    stubRows(MonitorService, "Monitor", []);
    const finds: Array<RecordedFind> = stubReadable(MonitorService, []);

    expect(
      await RequiredUniqueNames.findTwinsOfKind({
        service: MonitorService,
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual({ groups: [], createdAt: {} });
    expect(finds).toHaveLength(0);
  });

  test("a kind the setting does not hold has none, and nothing is read", async () => {
    const query: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
    getJestSpyOn(IncidentService, "getRepository").mockReturnValue({
      metadata: { tableName: "Incident" },
      query: query,
    } as never);

    expect(
      await RequiredUniqueNames.findTwinsOfKind({
        service: IncidentService as never,
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual({ groups: [], createdAt: {} });
    expect(query).not.toHaveBeenCalled();
  });

  test("a record with no date is a twin all the same, with none said", async () => {
    stubRows(MonitorService, "Monitor", [
      { id: id(1), nameKey: "x", isArchived: false },
      { id: id(2), nameKey: "x", isArchived: false },
    ]);
    stubReadable(MonitorService, [monitor(1), monitor(2)]);

    expect(
      await RequiredUniqueNames.findTwinsOfKind({
        service: MonitorService,
        projectId: PROJECT_ID,
        props: READER,
      }),
    ).toEqual({ groups: [[id(1), id(2)]], createdAt: {} });
  });
});
