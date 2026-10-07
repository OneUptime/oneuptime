import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnDelete,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import Query from "../../../Server/Types/Database/Query";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * An episode's member rows show their incident (or alert) and their episode
 * through relation joins, which run neither one's own read rules. So every
 * read and write of the rows is narrowed to members whose record and episode
 * the caller may both see (IncidentPrivacyFilter / AlertPrivacyFilter and
 * the episode filters). EpisodeMemberPrivacyPostgres runs the same reads
 * against a migrated Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-000000000001",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000e1",
);
const USER_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000c1");

interface Kind {
  name: "Incident" | "Alert";
  service: DatabaseService<DatabaseBaseModel>;
  recordIdColumn: "incidentId" | "alertId";
  episodeIdColumn: "incidentEpisodeId" | "alertEpisodeId";
  // What the record's and the episode's privacy clauses select from.
  recordTable: string;
  episodeTable: string;
}

const KINDS: Array<Kind> = [
  {
    name: "Incident",
    service:
      IncidentEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "incidentId",
    episodeIdColumn: "incidentEpisodeId",
    recordTable: 'FROM "Incident" i',
    episodeTable: 'FROM "IncidentEpisode" ie',
  },
  {
    name: "Alert",
    service:
      AlertEpisodeMemberService as unknown as DatabaseService<DatabaseBaseModel>,
    recordIdColumn: "alertId",
    episodeIdColumn: "alertEpisodeId",
    recordTable: 'FROM "Alert" a',
    episodeTable: 'FROM "AlertEpisode" ae',
  },
];

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(
  kind: Kind,
  name: string,
  ...args: Array<unknown>
): Promise<T> {
  const hooks: Record<string, HookFunction> = kind.service as unknown as Record<
    string,
    HookFunction
  >;
  return hooks[name]!.apply(kind.service, args) as Promise<T>;
}

// Pass null for an API key, which acts for no user.
function userProps(
  permission: Permission,
  userId: ObjectID | null = USER_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: userId || undefined,
    userType: userId ? UserType.User : UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

/*
 * The SQL of every Raw clause inside a (possibly And-combined) operator, and
 * the type of every other operator in it.
 */
function operatorParts(value: unknown): Array<string> {
  if (!(value instanceof FindOperator)) {
    return [];
  }

  if (value.type === "and") {
    return (value.value as unknown as Array<unknown>).flatMap(operatorParts);
  }

  const getSql: ((alias: string) => string) | undefined = value.getSql as
    | ((alias: string) => string)
    | undefined;

  return getSql ? [getSql("COLUMN")] : [value.type];
}

function columnParts(
  query: Query<DatabaseBaseModel>,
  column: string,
): Array<string> {
  return operatorParts((query as Record<string, unknown>)[column]);
}

function expectNarrowed(kind: Kind, query: Query<DatabaseBaseModel>): void {
  expect(
    columnParts(query, kind.recordIdColumn).some((sql: string): boolean => {
      return sql.includes(kind.recordTable);
    }),
  ).toBe(true);
  expect(
    columnParts(query, kind.episodeIdColumn).some((sql: string): boolean => {
      return sql.includes(kind.episodeTable);
    }),
  ).toBe(true);
}

beforeEach(() => {
  // These tests are about the reads; the project check has its own.
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "$name episode members are narrowed to records and episodes the caller can see",
  (kind: Kind) => {
    test("find", async () => {
      const result: OnFind<DatabaseBaseModel> = await callHook<
        OnFind<DatabaseBaseModel>
      >(kind, "onBeforeFind", {
        query: {},
        props: userProps(Permission.ProjectMember),
        limit: 10,
        skip: 0,
      } as FindBy<DatabaseBaseModel>);

      expectNarrowed(kind, result.findBy.query);
    });

    test("find keeps the caller's own episode filter alongside the privacy clause", async () => {
      const result: OnFind<DatabaseBaseModel> = await callHook<
        OnFind<DatabaseBaseModel>
      >(kind, "onBeforeFind", {
        query: {
          [kind.episodeIdColumn]: EPISODE_ID,
        } as Query<DatabaseBaseModel>,
        props: userProps(Permission.ProjectMember),
        limit: 10,
        skip: 0,
      } as FindBy<DatabaseBaseModel>);

      const episodeFilter: FindOperator<unknown> = (
        result.findBy.query as Record<string, unknown>
      )[kind.episodeIdColumn] as FindOperator<unknown>;

      // Both apply: the episode asked for, and only if the caller may see it.
      expect(episodeFilter.type).toBe("and");
      expect(
        (episodeFilter.value as unknown as Array<FindOperator<unknown>>)[0]!
          .value,
      ).toBe(EPISODE_ID.toString());
      expect(columnParts(result.findBy.query, kind.episodeIdColumn)).toContain(
        "equal",
      );
      expectNarrowed(kind, result.findBy.query);
    });

    test("count", async () => {
      const baseCount: jest.SpyInstance = jest
        .spyOn(DatabaseService.prototype, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

      await kind.service.countBy({
        query: {},
        props: userProps(Permission.ProjectMember),
      });

      expect(baseCount).toHaveBeenCalledTimes(1);
      expectNarrowed(kind, baseCount.mock.calls[0]![0].query);
    });

    test("update, once the project check has run", async () => {
      const result: OnUpdate<DatabaseBaseModel> = await callHook<
        OnUpdate<DatabaseBaseModel>
      >(kind, "onBeforeUpdate", {
        query: {},
        data: {},
        props: userProps(Permission.ProjectMember),
        limit: 1,
        skip: 0,
      } as UpdateBy<DatabaseBaseModel>);

      expect(ProjectReferenceCheck.validateUpdate).toHaveBeenCalledTimes(1);
      expectNarrowed(kind, result.updateBy.query);
    });

    test("delete, including the members it carries forward", async () => {
      const findBy: jest.SpyInstance = jest
        .spyOn(kind.service, "findBy")
        .mockResolvedValue([]);

      const result: OnDelete<DatabaseBaseModel> = await callHook<
        OnDelete<DatabaseBaseModel>
      >(kind, "onBeforeDelete", {
        query: {},
        props: userProps(Permission.ProjectMember),
        limit: 1,
        skip: 0,
      } as DeleteBy<DatabaseBaseModel>);

      expectNarrowed(kind, result.deleteBy.query);

      // The carried members are read as root, but only among the visible ones.
      expect(findBy).toHaveBeenCalledTimes(1);
      expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
      expectNarrowed(kind, findBy.mock.calls[0]![0].query);
    });

    test("an API key, which owns nothing, is narrowed to what is not private", async () => {
      const result: OnFind<DatabaseBaseModel> = await callHook<
        OnFind<DatabaseBaseModel>
      >(kind, "onBeforeFind", {
        query: {},
        props: userProps(Permission.ProjectMember, null),
        limit: 10,
        skip: 0,
      } as FindBy<DatabaseBaseModel>);

      expectNarrowed(kind, result.findBy.query);

      for (const column of [kind.recordIdColumn, kind.episodeIdColumn]) {
        for (const sql of columnParts(result.findBy.query, column)) {
          expect(sql).not.toContain("Owner");
        }
      }
    });

    test("project owners and admins, root and master admins are not narrowed", async () => {
      for (const props of [
        userProps(Permission.ProjectOwner),
        userProps(Permission.ProjectAdmin),
        { isRoot: true },
        { isMasterAdmin: true, userId: USER_ID },
      ] as Array<DatabaseCommonInteractionProps>) {
        const result: OnFind<DatabaseBaseModel> = await callHook<
          OnFind<DatabaseBaseModel>
        >(kind, "onBeforeFind", {
          query: {
            [kind.episodeIdColumn]: EPISODE_ID,
          } as Query<DatabaseBaseModel>,
          props: props,
          limit: 10,
          skip: 0,
        } as FindBy<DatabaseBaseModel>);

        expect(result.findBy.query).toEqual({
          [kind.episodeIdColumn]: EPISODE_ID,
        });
      }
    });
  },
);
