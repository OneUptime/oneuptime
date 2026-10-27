import Incident from "../../../../../Models/DatabaseModels/Incident";
import Project from "../../../../../Models/DatabaseModels/Project";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import TenantPermission from "../../../../../Server/Types/Database/Permissions/TenantPermission";
import Query from "../../../../../Server/Types/Database/Query";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EqualTo from "../../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../../Types/BaseDatabase/GreaterThan";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../../../Types/BaseDatabase/IsNull";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../../Types/BaseDatabase/Search";
import StartsWith from "../../../../../Types/BaseDatabase/StartsWith";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../../Helpers/SeededRandom";
import { describe, expect, it } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A READ ACROSS PROJECTS KEEPS TO THE PROJECTS IT ASKED FOR.
 *
 * A read that names no project, or that asks across the caller's projects
 * (is-multi-tenant-query), is answered with one query per project of the
 * caller's, each scoped to its project by the tenant column
 * (TenantPermission). That scoping replaced whatever the read itself asked
 * of the column, unless it was written as Includes. So for Project - whose
 * tenant column is its _id - "read project A", from someone outside A, was
 * answered with one of their own projects: CodeFixRunAPI asked exactly that
 * before reading A's code-fix runs as root, and let them through.
 *
 * The read's own filter on the column now chooses among the caller's
 * projects, worked out on each project's id as the database works it out
 * on the column; a filter it cannot work out is refused, never dropped.
 *
 * These checks never connect to Postgres. The app's migration registry is
 * kept out, as in MultiTenantPermissions.test.ts.
 */
jest.mock(
  "../../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return { __esModule: true, default: {} };
  },
);

const userId: ObjectID = new ObjectID("5c0a0000-0000-4000-8000-000000000001");
const firstProjectId: ObjectID = new ObjectID(
  "5c0a0000-0000-4000-8000-0000000000a1",
);
const secondProjectId: ObjectID = new ObjectID(
  "5c0a0000-0000-4000-8000-0000000000a2",
);
// A project the caller is not a member of.
const outsideProjectId: ObjectID = new ObjectID(
  "5c0a0000-0000-4000-8000-0000000000f1",
);

// A member of `projectIds`, as getUserMiddleware leaves them.
function memberOf(
  projectIds: Array<ObjectID>,
  options: { isMultiTenantRequest: boolean } = { isMultiTenantRequest: true },
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    isMultiTenantRequest: options.isMultiTenantRequest,
    userGlobalAccessPermission: {
      projectIds: projectIds,
      globalPermissions: [Permission.Public, Permission.CurrentUser],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: Object.fromEntries(
      projectIds.map((projectId: ObjectID) => {
        return [
          projectId.toString(),
          {
            projectId: projectId,
            permissions: [
              {
                permission: Permission.ProjectMember,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission" as const,
              },
            ],
            _type: "UserTenantAccessPermission" as const,
          },
        ];
      }),
    ),
  };
}

const CALLER: DatabaseCommonInteractionProps = memberOf([
  firstProjectId,
  secondProjectId,
]);

// The project each per-project query was scoped to, in order.
function getAskedProjects(
  result: CheckReadPermissionType<DatabaseBaseModel>,
  tenantColumn: string,
): Array<string> {
  const queries: Array<Record<string, unknown>> =
    result.query as unknown as Array<Record<string, unknown>>;

  expect(Array.isArray(queries)).toBe(true);

  return queries.map((query: Record<string, unknown>) => {
    const predicate: unknown = query[tenantColumn];

    expect(predicate).toBeInstanceOf(FindOperator);

    const parameters: Array<unknown> = Object.values(
      (predicate as FindOperator<unknown>).objectLiteralParameters || {},
    );

    expect(parameters).toHaveLength(1);

    return String(parameters[0]);
  });
}

async function readProjects(
  query: Query<Project>,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<Array<string>> {
  return getAskedProjects(
    (await ModelPermission.checkReadQueryPermission(
      Project,
      query,
      { _id: true, name: true },
      props,
    )) as unknown as CheckReadPermissionType<DatabaseBaseModel>,
    "_id",
  );
}

async function readIncidents(
  query: Query<Incident>,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<Array<string>> {
  return getAskedProjects(
    (await ModelPermission.checkReadQueryPermission(
      Incident,
      query,
      { _id: true, title: true },
      props,
    )) as unknown as CheckReadPermissionType<DatabaseBaseModel>,
    "projectId",
  );
}

describe("a read across projects of a project the caller is not in", () => {
  /*
   * findOneById(A) with the caller's props: what CodeFixRunAPI asked to
   * learn whether the caller may read project A.
   */
  it.each([
    ["its id as a string", outsideProjectId.toString()],
    ["its id as an ObjectID", outsideProjectId],
    ["its id in capitals", outsideProjectId.toString().toUpperCase()],
    ["EqualTo its id", new EqualTo<string>(outsideProjectId.toString())],
  ])(
    "asks no project at all, never one of the caller's own (%s)",
    async (_name: string, filter: unknown) => {
      await expect(
        readProjects({ _id: filter } as Query<Project>),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it("is refused for a read that names no project and sends no header, too", async () => {
    await expect(
      readProjects(
        { _id: outsideProjectId.toString() },
        memberOf([firstProjectId, secondProjectId], {
          isMultiTenantRequest: false,
        }),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  it("is refused for a table read by its project column (an incident of A)", async () => {
    await expect(
      readIncidents({ projectId: outsideProjectId.toString() }),
    ).rejects.toThrow(NotAuthorizedException);
  });
});

describe("a read across projects of a project the caller is in", () => {
  it("asks that project alone, by its _id", async () => {
    expect(await readProjects({ _id: secondProjectId.toString() })).toEqual([
      secondProjectId.toString(),
    ]);
  });

  it("asks that project alone, however its id is written", async () => {
    expect(
      await readProjects({
        _id: firstProjectId.toString().toUpperCase(),
      } as Query<Project>),
    ).toEqual([firstProjectId.toString()]);

    expect(await readProjects({ _id: firstProjectId })).toEqual([
      firstProjectId.toString(),
    ]);
  });

  it("keeps the read's other filters in the project's query", async () => {
    const result: CheckReadPermissionType<Incident> =
      await ModelPermission.checkReadQueryPermission(
        Incident,
        { projectId: secondProjectId, title: "Database down" },
        { _id: true, title: true },
        CALLER,
      );

    const queries: Array<Query<Incident>> = result.query as unknown as Array<
      Query<Incident>
    >;

    expect(queries).toHaveLength(1);
    expect(queries[0]!.title).toBeDefined();
    expect(
      getAskedProjects(
        result as unknown as CheckReadPermissionType<DatabaseBaseModel>,
        "projectId",
      ),
    ).toEqual([secondProjectId.toString()]);
  });

  it("without a filter on the project, asks every project of the caller's", async () => {
    expect(await readIncidents({})).toEqual([
      firstProjectId.toString(),
      secondProjectId.toString(),
    ]);
  });
});

/*
 * What the dashboard's cross-project tables (Active Incidents, Active
 * Alerts and their episodes) send for their Project filter: a list for
 * "any of", IncludesNone for "none of" or "is not", IncludesAll for "all
 * of", IsNull / NotNull for "is empty" / "is not empty".
 */
describe("the operators a read across projects may filter the project by", () => {
  it.each([
    [
      "Includes keeps the projects it lists, and no other",
      new Includes([firstProjectId.toString(), outsideProjectId.toString()]),
      [firstProjectId],
    ],
    [
      "IncludesAll, on a column of one id, keeps any of them (QueryUtil writes it as = ANY)",
      new IncludesAll([
        secondProjectId.toString(),
        outsideProjectId.toString(),
      ]),
      [secondProjectId],
    ],
    [
      "IncludesNone keeps the projects it does not list",
      new IncludesNone([firstProjectId.toString()]),
      [secondProjectId],
    ],
    [
      "IncludesNone of a project the caller is not in keeps all of theirs",
      new IncludesNone([outsideProjectId.toString()]),
      [firstProjectId, secondProjectId],
    ],
    [
      "NotEqual keeps every project but that one",
      new NotEqual<string>(secondProjectId.toString()),
      [firstProjectId],
    ],
    [
      "EqualToOrNull keeps its one project: no record's project is empty",
      new EqualToOrNull<string>(firstProjectId.toString()),
      [firstProjectId],
    ],
    [
      "NotNull keeps every project",
      new NotNull(),
      [firstProjectId, secondProjectId],
    ],
  ])("%s", async (_name: string, filter: unknown, kept: Array<ObjectID>) => {
    expect(
      await readIncidents({ projectId: filter } as Query<Incident>),
    ).toEqual(
      kept.map((projectId: ObjectID) => {
        return projectId.toString();
      }),
    );
  });

  it.each([
    ["IsNull", new IsNull()],
    ["null", null],
    ["an empty Includes", new Includes([])],
    [
      "IncludesNone of every project",
      new IncludesNone([firstProjectId.toString(), secondProjectId.toString()]),
    ],
  ])(
    "%s keeps no project, and the read is refused rather than run unscoped",
    async (_name: string, filter: unknown) => {
      await expect(
        readIncidents({ projectId: filter } as Query<Incident>),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each([
    ["a text search", new Search<string>(firstProjectId.toString())],
    ["a prefix", new StartsWith<string>("5c0a")],
    ["a range", new GreaterThan<string>(firstProjectId.toString())],
    ["a number", 7],
    ["an object", { _id: firstProjectId.toString() }],
    ["a list of ids that is not an operator", [firstProjectId.toString()]],
    ["EqualTo a number", new EqualTo<number>(7)],
    ["Includes with a number in it", new Includes([7])],
  ])(
    "refuses %s on the project column, in words that say what to do",
    async (_name: string, filter: unknown) => {
      const read: Promise<Array<string>> = readIncidents({
        projectId: filter,
      } as Query<Incident>);

      await expect(read).rejects.toThrow(BadDataException);
      await expect(read).rejects.toThrow(
        TenantPermission.getReadAcrossProjectsFilterMessage(new Incident()),
      );
    },
  );
});

describe("a read in one project is left as it was", () => {
  it("is scoped to the project the request names, as before", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...memberOf([firstProjectId], { isMultiTenantRequest: false }),
      tenantId: firstProjectId,
    };

    const result: CheckReadPermissionType<Incident> =
      await ModelPermission.checkReadQueryPermission(
        Incident,
        { title: "Database down" },
        { _id: true, title: true },
        props,
      );

    expect(Array.isArray(result.query)).toBe(false);

    const predicate: FindOperator<unknown> = result.query
      .projectId as unknown as FindOperator<unknown>;

    expect(Object.values(predicate.objectLiteralParameters || {})).toEqual([
      firstProjectId.toString(),
    ]);
  });
});

/*
 * THE FILTER, WORKED OUT ON EVERY PROJECT. A sweep of drawn filters, over
 * drawn sets of the caller's projects, each compared with what the
 * database's own predicate keeps of them - written here per row, as SQL
 * reads it, not as TenantPermission works it out.
 */
describe("getProjectsTheFilterKeeps, over drawn filters", () => {
  const POOL: Array<ObjectID> = [
    firstProjectId,
    secondProjectId,
    outsideProjectId,
    new ObjectID("5c0a0000-0000-4000-8000-0000000000a3"),
    new ObjectID("5c0a0000-0000-4000-8000-0000000000a4"),
    new ObjectID("5c0a0000-0000-4000-8000-0000000000f2"),
  ];

  type RowPredicate = (projectId: string) => boolean;

  interface DrawnFilter {
    filter: unknown;
    // The SQL predicate the filter is written as, for one row's project id.
    keeps: RowPredicate;
    description: string;
  }

  // The id as written in a request: its own case, or in capitals.
  const written: (id: ObjectID, random: SeededRandom) => string | ObjectID = (
    id: ObjectID,
    random: SeededRandom,
  ): string | ObjectID => {
    const shape: number = random(3);

    if (shape === 0) {
      return id;
    }

    return shape === 1 ? id.toString() : id.toString().toUpperCase();
  };

  const asText: (id: string | ObjectID) => string = (
    id: string | ObjectID,
  ): string => {
    return id.toString();
  };

  // uuid = uuid: the database compares the value, not the way it is written.
  const sameUuid: (a: string, b: string | ObjectID) => boolean = (
    a: string,
    b: string | ObjectID,
  ): boolean => {
    return a.toLowerCase() === b.toString().toLowerCase();
  };

  const drawFilter: (random: SeededRandom) => DrawnFilter = (
    random: SeededRandom,
  ): DrawnFilter => {
    const ids: Array<string | ObjectID> = shuffled(POOL, random)
      .slice(0, random(POOL.length + 1))
      .map((id: ObjectID) => {
        return written(id, random);
      });
    const one: string | ObjectID = written(
      POOL[random(POOL.length)] as ObjectID,
      random,
    );

    switch (random(9)) {
      case 0:
        return {
          filter: one,
          keeps: (row: string): boolean => {
            return sameUuid(row, one);
          },
          description: `= ${asText(one)}`,
        };
      case 1:
        return {
          filter: new EqualTo<string>(asText(one)),
          keeps: (row: string): boolean => {
            return sameUuid(row, one);
          },
          description: `EqualTo ${asText(one)}`,
        };
      case 2:
        return {
          filter: new EqualToOrNull<string>(asText(one)),
          keeps: (row: string): boolean => {
            return sameUuid(row, one);
          },
          description: `EqualToOrNull ${asText(one)}`,
        };
      case 3:
        return {
          filter: new NotEqual<string>(asText(one)),
          keeps: (row: string): boolean => {
            return !sameUuid(row, one);
          },
          description: `!= ${asText(one)}`,
        };
      case 4:
        return {
          filter: new Includes(ids.map(asText)),
          keeps: (row: string): boolean => {
            return ids.some((id: string | ObjectID) => {
              return sameUuid(row, id);
            });
          },
          description: `= ANY(${ids.map(asText).join(", ")})`,
        };
      case 5:
        return {
          filter: new IncludesAll(ids.map(asText)),
          keeps: (row: string): boolean => {
            return ids.some((id: string | ObjectID) => {
              return sameUuid(row, id);
            });
          },
          description: `IncludesAll ${ids.map(asText).join(", ")}`,
        };
      case 6:
        return {
          filter: new IncludesNone(ids.map(asText)),
          keeps: (row: string): boolean => {
            return !ids.some((id: string | ObjectID) => {
              return sameUuid(row, id);
            });
          },
          description: `NOT IN (${ids.map(asText).join(", ")})`,
        };
      case 7:
        return {
          filter: new IsNull(),
          keeps: (): boolean => {
            return false;
          },
          description: "IS NULL",
        };
      default:
        return {
          filter: new NotNull(),
          keeps: (): boolean => {
            return true;
          },
          description: "IS NOT NULL",
        };
    }
  };

  it("keeps exactly the caller's projects the database would, for 2,000 drawn filters", () => {
    const random: SeededRandom = seededRandom(5317);
    const failures: Array<string> = [];

    for (let draw: number = 0; draw < 2000; draw++) {
      const callerProjects: Array<ObjectID> = shuffled(POOL, random).slice(
        0,
        random(POOL.length + 1),
      );
      const drawn: DrawnFilter = drawFilter(random);

      const kept: Array<string> = TenantPermission.getProjectsTheFilterKeeps({
        filter: drawn.filter,
        projectIds: callerProjects,
        model: new Incident(),
      }).map((projectId: ObjectID) => {
        return projectId.toString();
      });

      const expected: Array<string> = callerProjects
        .filter((projectId: ObjectID) => {
          return drawn.keeps(projectId.toString());
        })
        .map((projectId: ObjectID) => {
          return projectId.toString();
        });

      if (JSON.stringify(kept) !== JSON.stringify(expected)) {
        failures.push(
          `draw ${draw}: ${drawn.description} over [${callerProjects.join(", ")}] kept [${kept.join(", ")}], expected [${expected.join(", ")}]`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("never asks a project the caller is not in, through the whole read, for 150 drawn filters", async () => {
    const random: SeededRandom = seededRandom(9041);

    for (let draw: number = 0; draw < 150; draw++) {
      const callerProjects: Array<ObjectID> = shuffled(POOL, random).slice(
        0,
        1 + random(POOL.length),
      );
      const drawn: DrawnFilter = drawFilter(random);

      const expected: Array<string> = callerProjects
        .filter((projectId: ObjectID) => {
          return drawn.keeps(projectId.toString());
        })
        .map((projectId: ObjectID) => {
          return projectId.toString();
        });

      const read: Promise<Array<string>> = readIncidents(
        { projectId: drawn.filter } as Query<Incident>,
        memberOf(callerProjects),
      );

      if (expected.length === 0) {
        await expect(read).rejects.toThrow(NotAuthorizedException);
      } else {
        expect(await read).toEqual(expected);
      }
    }
  });
});
