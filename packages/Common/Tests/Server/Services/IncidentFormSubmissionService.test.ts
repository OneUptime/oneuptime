import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentFormSubmissionService from "../../../Server/Services/IncidentFormSubmissionService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnDelete,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import Query from "../../../Server/Types/Database/Query";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A submission names the incident it declared, and incidents can be private.
 * IncidentFormSubmissionService narrows every read, count, update and delete
 * to submissions whose incident the caller may see - the null-tolerant way,
 * because a submission keeps its row (with no incident) when the incident is
 * deleted, and such a row has nothing to hide. Project owners and admins,
 * root and master admins see everything.
 *
 * The clause is asserted as SQL text, as IncidentAlertService's is: what
 * matters is which table it reads and that a NULL incident passes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f101",
);
const USER_ID: ObjectID = new ObjectID("0194d4ba-0000-4000-8000-00000000f102");
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000f103",
);

type HookFunction = (...args: Array<unknown>) => Promise<unknown>;

function callHook<T>(name: string, ...args: Array<unknown>): Promise<T> {
  const hooks: Record<string, HookFunction> =
    IncidentFormSubmissionService as unknown as Record<string, HookFunction>;
  return hooks[name]!.apply(IncidentFormSubmissionService, args) as Promise<T>;
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

// The SQL a (possibly combined) privacy operator renders for one column.
function operatorSql(value: unknown): Array<string> {
  if (!(value instanceof FindOperator)) {
    return [];
  }

  if (value.type === "and") {
    return (value.value as unknown as Array<unknown>).flatMap(operatorSql);
  }

  const getSql: ((alias: string) => string) | undefined = value.getSql as
    | ((alias: string) => string)
    | undefined;

  return getSql ? [getSql("COLUMN")] : [value.type];
}

function expectNarrowed(query: Query<IncidentFormSubmission>): void {
  const sql: Array<string> = operatorSql(query.incidentId);
  const privacy: Array<string> = sql.filter((clause: string): boolean => {
    return clause.includes('FROM "Incident" i');
  });

  expect(privacy).toHaveLength(1);

  // A submission whose incident was deleted is still listed.
  expect(privacy[0]!.startsWith("(COLUMN IS NULL OR COLUMN IN (")).toBe(true);
  // Private incidents only for those who may see them.
  expect(privacy[0]).toContain(
    'i."isPrivate" IS NULL OR i."isPrivate" = FALSE',
  );
  expect(privacy[0]).toContain('i."deletedAt" IS NULL');
}

async function find(
  props: DatabaseCommonInteractionProps,
  query: Query<IncidentFormSubmission> = {},
): Promise<Query<IncidentFormSubmission>> {
  const result: OnFind<IncidentFormSubmission> = await callHook<
    OnFind<IncidentFormSubmission>
  >("onBeforeFind", {
    query: query,
    props: props,
    limit: 10,
    skip: 0,
  } as FindBy<IncidentFormSubmission>);

  return result.findBy.query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentFormSubmissionService: submissions of private incidents stay hidden", () => {
  test.each([
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadIncidentFormSubmission,
  ])("find, for %s", async (permission: Permission) => {
    expectNarrowed(await find(userProps(permission)));
  });

  test("find keeps the caller's own incident filter next to the privacy clause", async () => {
    const query: Query<IncidentFormSubmission> = await find(
      userProps(Permission.IncidentViewer),
      { incidentId: INCIDENT_ID },
    );

    expect((query.incidentId as unknown as FindOperator<unknown>).type).toBe(
      "and",
    );
    expectNarrowed(query);
  });

  test("find keeps the caller's other filters untouched", async () => {
    const formId: ObjectID = ObjectID.generate();

    const query: Query<IncidentFormSubmission> = await find(
      userProps(Permission.IncidentViewer),
      { incidentFormId: formId },
    );

    expect(query.incidentFormId).toBe(formId);
    expectNarrowed(query);
  });

  test("the owner subqueries are bound to the caller", async () => {
    const [clause] = operatorSql(
      (await find(userProps(Permission.IncidentViewer))).incidentId,
    );

    expect(clause).toContain('FROM "IncidentOwnerUser" iou');
    expect(clause).toContain('FROM "IncidentOwnerTeam" iot');

    const operator: FindOperator<unknown> = (
      await find(userProps(Permission.IncidentViewer))
    ).incidentId as unknown as FindOperator<unknown>;

    expect(Object.values(operator.objectLiteralParameters || {})).toEqual([
      USER_ID.toString(),
    ]);
  });

  test("an API key, which acts for no user, only sees submissions of incidents that are not private", async () => {
    const [clause] = operatorSql(
      (await find(userProps(Permission.IncidentViewer, null))).incidentId,
    );

    expect(clause).toBe(
      '(COLUMN IS NULL OR COLUMN IN (SELECT i."_id" FROM "Incident" i WHERE i."deletedAt" IS NULL AND (i."isPrivate" IS NULL OR i."isPrivate" = FALSE)))',
    );
  });

  test("count is narrowed the same way", async () => {
    const baseCount: MockFunction = getJestMockFunction();
    baseCount.mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(DatabaseService.prototype, "countBy")
      .mockImplementation(baseCount as never);

    await IncidentFormSubmissionService.countBy({
      query: {},
      props: userProps(Permission.IncidentViewer),
    });

    expect(baseCount).toHaveBeenCalledTimes(1);
    expectNarrowed(
      (baseCount.mock.calls[0]![0] as { query: Query<IncidentFormSubmission> })
        .query,
    );
  });

  test("update is narrowed, should update ever be granted", async () => {
    const result: OnUpdate<IncidentFormSubmission> = await callHook<
      OnUpdate<IncidentFormSubmission>
    >("onBeforeUpdate", {
      query: {},
      data: {},
      props: userProps(Permission.IncidentAdmin),
      limit: 1,
      skip: 0,
    } as UpdateBy<IncidentFormSubmission>);

    expectNarrowed(result.updateBy.query);
  });

  test("delete is narrowed: an incident admin cannot delete what they cannot see", async () => {
    const result: OnDelete<IncidentFormSubmission> = await callHook<
      OnDelete<IncidentFormSubmission>
    >("onBeforeDelete", {
      query: { _id: ObjectID.generate().toString() },
      props: userProps(Permission.IncidentAdmin),
      limit: 1,
      skip: 0,
    } as DeleteBy<IncidentFormSubmission>);

    expectNarrowed(result.deleteBy.query);
  });

  test.each([
    ["a project owner", userProps(Permission.ProjectOwner)],
    ["a project admin", userProps(Permission.ProjectAdmin)],
    ["root", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true, userId: USER_ID }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "%s is not narrowed",
    async (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(await find(props)).toEqual({});

      const baseCount: MockFunction = getJestMockFunction();
      baseCount.mockResolvedValue(new PositiveNumber(0));
      jest
        .spyOn(DatabaseService.prototype, "countBy")
        .mockImplementation(baseCount as never);

      await IncidentFormSubmissionService.countBy({ query: {}, props: props });

      expect(
        (
          baseCount.mock.calls[0]![0] as {
            query: Query<IncidentFormSubmission>;
          }
        ).query,
      ).toEqual({});
    },
  );
});
