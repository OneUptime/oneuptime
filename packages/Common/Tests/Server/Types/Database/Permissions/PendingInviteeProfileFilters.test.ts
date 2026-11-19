import Incident from "../../../../../Models/DatabaseModels/Incident";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import { ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE } from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHAT A READ IS FILTERED AND ORDERED BY, FOR SOMEONE ONLY INVITED (#9823).
 *
 * Every case goes through ModelPermission.checkReadQueryPermission, the
 * entry point every read, count and aggregate takes before the database:
 *
 *   - a filter through a relation on a person's name, picture or two-factor
 *     flag also asks that the person is no one only invited to the
 *     reader's projects - the Users list's search box, the people pickers
 *     and Search spell a name out a letter at a time otherwise, the name
 *     the rows themselves withhold (PendingInviteeProfiles);
 *   - a person's account dates - which move with their activity - are no
 *     filter or order through a relation for anyone but OneUptime and a
 *     master admin.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function checkRead(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  sort?: unknown,
): Promise<CheckReadPermissionType<BaseModel>> {
  return await ModelPermission.checkReadQueryPermission<BaseModel>(
    modelType,
    query as Query<BaseModel>,
    { _id: true },
    props,
    sort,
  );
}

async function refusalOf(
  modelType: { new (): BaseModel },
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  sort?: unknown,
): Promise<Error | null> {
  try {
    await checkRead(modelType, query, props, sort);
    return null;
  } catch (err) {
    return err as Error;
  }
}

// The SQL the conditions on a person's id write, by type.
function describeIdCondition(value: unknown): string {
  const operator: FindOperator<unknown> = value as FindOperator<unknown>;

  const parts: Array<FindOperator<unknown>> =
    operator.type === "and"
      ? (operator.value as unknown as Array<FindOperator<unknown>>)
      : [operator];

  return parts
    .map((part: FindOperator<unknown>): string => {
      return part.type === "raw" && part.getSql
        ? part.getSql("person")
        : `[${part.type}]`;
    })
    .join(" AND ");
}

describe("a search of the project's people by name never matches someone only invited", () => {
  test.each([
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["a project admin", [Permission.ProjectAdmin]],
  ])(
    "%s's search through a membership's person by name",
    async (_case: string, permissions: Array<Permission>) => {
      const result: CheckReadPermissionType<BaseModel> = await checkRead(
        TeamMember,
        { user: { name: new Search("ada") } },
        caller(permissions),
      );

      const user: Record<string, unknown> = (
        result.query as Record<string, unknown>
      )["user"] as Record<string, unknown>;

      expect(user["name"]).toBeDefined();
      expect(describeIdCondition(user["_id"])).toContain(
        "(person NOT IN (SELECT",
      );
    },
  );

  test("a search by address is answered as before: the project typed it", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      TeamMember,
      { user: { email: new Search("ada@") } },
      caller([Permission.ProjectMember]),
    );

    expect(
      (
        (result.query as Record<string, unknown>)["user"] as Record<
          string,
          unknown
        >
      )["_id"],
    ).toBeUndefined();
  });

  test("another record's people are narrowed alike: an incident by its creator's name", async () => {
    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      Incident,
      { createdByUser: { name: new Search("ada") } },
      caller([Permission.ProjectOwner]),
    );

    const creator: Record<string, unknown> = (
      result.query as Record<string, unknown>
    )["createdByUser"] as Record<string, unknown>;

    expect(describeIdCondition(creator["_id"])).toContain(
      "(person NOT IN (SELECT",
    );
  });

  test("a master admin's search is answered as asked", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...caller([Permission.ProjectMember]),
      isMasterAdmin: true,
    };

    const result: CheckReadPermissionType<BaseModel> = await checkRead(
      TeamMember,
      { user: { name: new Search("ada") } },
      props,
    );

    expect(
      (
        (result.query as Record<string, unknown>)["user"] as Record<
          string,
          unknown
        >
      )["_id"],
    ).toBeUndefined();
  });
});

describe("a person's account dates are no filter or order through a relation", () => {
  test.each([["createdAt"], ["updatedAt"]])(
    "a filter of the project's people by their account's %s is refused",
    async (column: string) => {
      const error: Error | null = await refusalOf(
        TeamMember,
        { user: { [column]: new Date("2026-01-01T00:00:00Z") } },
        caller([Permission.ProjectOwner]),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error!.message).toBe(
        ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE,
      );
    },
  );

  test.each([["createdAt"], ["updatedAt"]])(
    "an order of the project's people by their account's %s is refused",
    async (column: string) => {
      const error: Error | null = await refusalOf(
        TeamMember,
        {},
        caller([Permission.ProjectOwner]),
        { user: { [column]: SortOrder.Descending } },
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error!.message).toBe(
        ACCOUNT_DATES_THROUGH_RELATION_REFUSED_MESSAGE,
      );
    },
  );

  test("the membership's own dates, and an order by a person's name, are answered as before", async () => {
    await expect(
      checkRead(
        TeamMember,
        { createdAt: new Date("2026-01-01T00:00:00Z") },
        caller([Permission.ProjectOwner]),
        { createdAt: SortOrder.Descending },
      ),
    ).resolves.toBeTruthy();

    await expect(
      checkRead(TeamMember, {}, caller([Permission.ProjectOwner]), {
        user: { name: SortOrder.Ascending },
      }),
    ).resolves.toBeTruthy();
  });

  test("a master admin may", async () => {
    await expect(
      checkRead(
        TeamMember,
        { user: { updatedAt: new Date("2026-01-01T00:00:00Z") } },
        {
          ...caller([Permission.ProjectOwner]),
          isMasterAdmin: true,
        },
        { user: { updatedAt: SortOrder.Descending } },
      ),
    ).resolves.toBeTruthy();
  });
});
