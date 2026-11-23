import Project from "../../../Models/DatabaseModels/Project";
import ProjectService from "../../../Server/Services/ProjectService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_CASE_AI_STAMPS_COLUMN,
  SecurityCaseAiMode,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO LET ONEUPTIME AI CONTAIN ON ITS OWN (#10352). Setting Block
 * addresses, Contain accounts or Contain hosts to On its own takes a
 * Security Admin's authority - which Project Owners and Admins hold too -
 * and is stamped with who did it and when, as a playbook step saved with
 * Needs Approval off is. Setting it back takes the stamp away; sending it
 * again as it is stored keeps it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ADMIN_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

let stored: Record<string, unknown>;

function updateBy(
  data: Record<string, unknown>,
  permissions: Array<Permission> = [Permission.SecurityAdmin],
): UpdateBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    data: { ...data } as never,
    props: {
      userId: ADMIN_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: permissions.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            };
          }),
          _type: "UserTenantAccessPermission",
        },
      },
    } as never,
    skip: 0,
    limit: 1,
  } as unknown as UpdateBy<Project>;
}

async function stamp(by: UpdateBy<Project>): Promise<Record<string, unknown>> {
  await (
    ProjectService as unknown as {
      stampSecurityCaseAiOnItsOwn: (
        updateBy: UpdateBy<Project>,
      ) => Promise<void>;
    }
  ).stampSecurityCaseAiOnItsOwn(by);

  return by.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  stored = {
    _id: PROJECT_ID.toString(),
    securityCaseAiEdgeMode: SecurityCaseAiMode.Ask,
    securityCaseAiAccountsMode: SecurityCaseAiMode.Ask,
    securityCaseAiHostsMode: SecurityCaseAiMode.Ask,
    [SECURITY_CASE_AI_STAMPS_COLUMN]: {},
  };

  jest
    .spyOn(
      ProjectService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<Array<Project>>;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockImplementation((async () => {
      return [stored as unknown as Project];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("setting a containment kind to On its own", () => {
  test("a Security Admin's is stamped with who and when", async () => {
    const data: Record<string, unknown> = await stamp(
      updateBy({ securityCaseAiEdgeMode: SecurityCaseAiMode.OnItsOwn }),
    );

    expect(data[SECURITY_CASE_AI_STAMPS_COLUMN]).toEqual({
      Edge: { byUserId: ADMIN_ID.toString(), at: expect.any(String) },
    });
  });

  test("a Project Owner or Admin holds the same authority", async () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      const data: Record<string, unknown> = await stamp(
        updateBy({ securityCaseAiHostsMode: SecurityCaseAiMode.OnItsOwn }, [
          permission,
        ]),
      );

      expect(
        (data[SECURITY_CASE_AI_STAMPS_COLUMN] as Record<string, unknown>)[
          "Hosts"
        ],
      ).toBeDefined();
    }
  });

  test("anyone else is refused, in words that say who may", async () => {
    await expect(
      stamp(
        updateBy({ securityCaseAiAccountsMode: SecurityCaseAiMode.OnItsOwn }, [
          Permission.SecurityMember,
        ]),
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("setting it back takes the stamp away", async () => {
    stored["securityCaseAiEdgeMode"] = SecurityCaseAiMode.OnItsOwn;
    stored[SECURITY_CASE_AI_STAMPS_COLUMN] = {
      Edge: { byUserId: ADMIN_ID.toString(), at: "2026-11-20T10:00:00.000Z" },
    };

    const data: Record<string, unknown> = await stamp(
      updateBy({ securityCaseAiEdgeMode: SecurityCaseAiMode.Ask }, [
        Permission.SecurityMember,
      ]),
    );

    expect(data[SECURITY_CASE_AI_STAMPS_COLUMN]).toEqual({});
  });

  test("sent again as it is stored, the stamp stays as it was: Terraform sends every value", async () => {
    stored["securityCaseAiEdgeMode"] = SecurityCaseAiMode.OnItsOwn;
    stored[SECURITY_CASE_AI_STAMPS_COLUMN] = {
      Edge: { byUserId: "someone-else", at: "2026-11-20T10:00:00.000Z" },
    };

    const data: Record<string, unknown> = await stamp(
      updateBy({ securityCaseAiEdgeMode: SecurityCaseAiMode.OnItsOwn }, [
        Permission.SecurityMember,
      ]),
    );

    expect(data[SECURITY_CASE_AI_STAMPS_COLUMN]).toBeUndefined();
  });

  test("On its own with nobody's confirmation yet: confirming it now stamps it", async () => {
    stored["securityCaseAiEdgeMode"] = SecurityCaseAiMode.OnItsOwn;

    const data: Record<string, unknown> = await stamp(
      updateBy({ securityCaseAiEdgeMode: SecurityCaseAiMode.OnItsOwn }),
    );

    expect(data[SECURITY_CASE_AI_STAMPS_COLUMN]).toEqual({
      Edge: { byUserId: ADMIN_ID.toString(), at: expect.any(String) },
    });
  });

  test("the other rows need no stamp, and an update that sets none reads nothing", async () => {
    const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ProjectService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<Array<Project>>;
      },
      "findRowsAndHoldUpdateToThem",
    );
    const data: Record<string, unknown> = await stamp(
      updateBy(
        {
          securityCaseAiCaseMode: SecurityCaseAiMode.OnItsOwn,
          securityCaseAiCloseMode: SecurityCaseAiMode.OnItsOwn,
        },
        [Permission.ProjectAdmin],
      ),
    );

    expect(data[SECURITY_CASE_AI_STAMPS_COLUMN]).toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });
});
