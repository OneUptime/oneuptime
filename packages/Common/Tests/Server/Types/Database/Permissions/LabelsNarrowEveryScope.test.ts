import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import CreateScopePermission, {
  CreateScope,
} from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import Query from "../../../../../Server/Types/Database/Query";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import {
  canGrantTeamPermission,
  isUnrestrictedPermission,
  PermissionRows,
} from "../../../../../UI/Utils/GrantablePermission";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * LABELS NARROW A ROW WHATEVER SCOPE IT IS STORED WITH.
 *
 * The scope column was added with the default All (10.4), so every
 * permission an older install had limited to labels was stored as All, and
 * a permission an API or Terraform caller writes with labels and no scope
 * is stored as All too. Since 10.5 every check read an All row as reaching
 * the whole project, labels or not: a team limited to one customer's
 * incidents read every incident, while the dashboard showed the row as
 * "Only resources with certain labels". And the grant ceiling read the same
 * row without a scope as limited to its labels, so an admin limited to some
 * labels could hand their team the whole project by leaving the scope out.
 *
 * Now a row's labels narrow it whatever its scope - except an Owned row,
 * which owners narrow, and an All row of a role that cannot be scoped
 * (Project Owner, Project Admin, Settings, Billing) - in every check: what a
 * caller holds, the records a read reaches, a create's scope, the server's
 * grant ceiling and the dashboard's copy of it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const CUSTOMER_A: ObjectID = new ObjectID(
  "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
);
const CUSTOMER_B: ObjectID = new ObjectID(
  "2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
);

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope | undefined;
    labelIds?: Array<ObjectID> | undefined;
    isBlock?: boolean | undefined;
  } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    ...(data.scope ? { scope: data.scope } : {}),
  };
}

function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

const sortedIds: (ids: Array<ObjectID | string>) => Array<string> = (
  ids: Array<ObjectID | string>,
): Array<string> => {
  return ids
    .map((id: ObjectID | string): string => {
      return id.toString();
    })
    .sort();
};

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whether a row's labels narrow it", () => {
  const CASES: Array<[string, UserPermission, boolean]> = [
    [
      "All with labels",
      row(Permission.ReadProjectIncident, {
        scope: PermissionScope.All,
        labelIds: [CUSTOMER_A],
      }),
      true,
    ],
    [
      "Labels with labels",
      row(Permission.ReadProjectIncident, {
        scope: PermissionScope.Labels,
        labelIds: [CUSTOMER_A],
      }),
      true,
    ],
    [
      "no scope with labels (an API key's row)",
      row(Permission.ReadProjectIncident, { labelIds: [CUSTOMER_A] }),
      true,
    ],
    [
      "Owned with labels: owners narrow it instead",
      row(Permission.ReadProjectIncident, {
        scope: PermissionScope.Owned,
        labelIds: [CUSTOMER_A],
      }),
      false,
    ],
    [
      "All with no labels",
      row(Permission.ReadProjectIncident, { scope: PermissionScope.All }),
      false,
    ],
    [
      "Labels with no labels",
      row(Permission.ReadProjectIncident, { scope: PermissionScope.Labels }),
      false,
    ],
    [
      "an All row of Project Admin, which cannot be scoped",
      row(Permission.ProjectAdmin, {
        scope: PermissionScope.All,
        labelIds: [CUSTOMER_A],
      }),
      false,
    ],
    [
      "a Labels row of Project Admin, as before",
      row(Permission.ProjectAdmin, {
        scope: PermissionScope.Labels,
        labelIds: [CUSTOMER_A],
      }),
      true,
    ],
  ];

  test.each(CASES)(
    "%s",
    (_name: string, given: UserPermission, limited: boolean) => {
      expect(PermissionHelper.isLimitedToLabels(given)).toBe(limited);

      // A row its labels narrow is no grant over the whole project.
      if (given.scope !== PermissionScope.Owned) {
        expect(HeldPermissionsUtil.isProjectWideRow(given)).toBe(!limited);
        expect(
          PermissionHelper.getNonAccessControlPermissions([given]).includes(
            given.permission,
          ),
        ).toBe(!limited);
      }

      expect(PermissionHelper.getAccessControlPermissions([given])).toEqual(
        limited ? [given] : [],
      );
    },
  );

  test("what a member holds with an All row limited to labels is not held over the whole project", () => {
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: [
        row(Permission.ReadProjectIncident, {
          scope: PermissionScope.All,
          labelIds: [CUSTOMER_A],
        }),
      ],
    });

    expect(held.allowed).toEqual([Permission.ReadProjectIncident]);
    expect(held.allowedProjectWide).toEqual([]);
    expect(
      HeldPermissionsUtil.holdsAnyOf(held, [Permission.ReadProjectIncident], {
        projectWideOnly: true,
      }),
    ).toBe(false);
  });
});

describe("the records a read reaches", () => {
  async function labelsReadIncidentsKeepTo(
    rows: Array<UserPermission>,
  ): Promise<Array<string>> {
    const query: Query<Incident> = (await BasePermission.addRecordScopeToQuery(
      Incident,
      {},
      null,
      memberWith(rows),
      DatabaseRequestType.Read,
    )) as Query<Incident>;

    return sortedIds(
      ((query as unknown as { labels?: Array<ObjectID> }).labels || []).map(
        (labelId: ObjectID): string => {
          return labelId.toString();
        },
      ),
    );
  }

  test("an All row with labels reaches only the incidents carrying them", async () => {
    expect(
      await labelsReadIncidentsKeepTo([
        row(Permission.ReadProjectIncident, {
          scope: PermissionScope.All,
          labelIds: [CUSTOMER_A],
        }),
      ]),
    ).toEqual(sortedIds([CUSTOMER_A]));
  });

  test("an All row with no labels reaches every incident", async () => {
    expect(
      await labelsReadIncidentsKeepTo([
        row(Permission.ReadProjectIncident, { scope: PermissionScope.All }),
      ]),
    ).toEqual([]);
  });

  test("a grant over the whole project beside it reaches every incident", async () => {
    expect(
      await labelsReadIncidentsKeepTo([
        row(Permission.ReadProjectIncident, {
          scope: PermissionScope.All,
          labelIds: [CUSTOMER_A],
        }),
        row(Permission.IncidentViewer, { scope: PermissionScope.All }),
      ]),
    ).toEqual([]);
  });

  test("a create on such a row is limited to its labels", () => {
    const scope: CreateScope = CreateScopePermission.getCreateScope(
      Incident,
      memberWith([
        row(Permission.CreateProjectIncident, {
          scope: PermissionScope.All,
          labelIds: [CUSTOMER_A],
        }),
      ]),
    );

    expect(scope.isProjectWide).toBe(false);
    expect(scope.grantedLabelIds).toEqual([
      CUSTOMER_A.toString().toLowerCase(),
    ]);
  });
});

describe("the grant ceiling, on the server and in the dashboard", () => {
  interface GrantCase {
    name: string;
    caller: UserPermission;
    grant: { scope?: PermissionScope | undefined; labelIds: Array<ObjectID> };
    mayGrant: boolean;
  }

  const LIMITED_TO_A_AS_ALL: UserPermission = row(
    Permission.ReadProjectMonitor,
    {
      scope: PermissionScope.All,
      labelIds: [CUSTOMER_A],
    },
  );
  const LIMITED_TO_A: UserPermission = row(Permission.ReadProjectMonitor, {
    scope: PermissionScope.Labels,
    labelIds: [CUSTOMER_A],
  });

  const CASES: Array<GrantCase> = [
    {
      name: "a row stored as All with labels does not hand on the whole project",
      caller: LIMITED_TO_A_AS_ALL,
      grant: { scope: PermissionScope.All, labelIds: [] },
      mayGrant: false,
    },
    {
      name: "it hands on its own labels",
      caller: LIMITED_TO_A_AS_ALL,
      grant: { scope: PermissionScope.Labels, labelIds: [CUSTOMER_A] },
      mayGrant: true,
    },
    {
      name: "a row with labels and no scope is limited to them: it may be handed on by a caller limited to them",
      caller: LIMITED_TO_A,
      grant: { labelIds: [CUSTOMER_A] },
      mayGrant: true,
    },
    {
      name: "a row stored as All with the caller's labels reaches what they reach",
      caller: LIMITED_TO_A,
      grant: { scope: PermissionScope.All, labelIds: [CUSTOMER_A] },
      mayGrant: true,
    },
    {
      name: "a row stored as All with other labels does not",
      caller: LIMITED_TO_A,
      grant: { scope: PermissionScope.All, labelIds: [CUSTOMER_B] },
      mayGrant: false,
    },
    {
      name: "the whole project, from a caller limited to labels, is refused",
      caller: LIMITED_TO_A,
      grant: { scope: PermissionScope.All, labelIds: [] },
      mayGrant: false,
    },
    {
      name: "a caller over the whole project hands on anything",
      caller: row(Permission.ReadProjectMonitor, {
        scope: PermissionScope.All,
      }),
      grant: { scope: PermissionScope.All, labelIds: [] },
      mayGrant: true,
    },
  ];

  test.each(CASES)("$name", (data: GrantCase) => {
    const props: DatabaseCommonInteractionProps = memberWith([data.caller]);

    let serverGrants: boolean = true;

    try {
      TeamPermissionService.assertCanGrantPermission({
        permission: Permission.ReadProjectMonitor,
        labelIds: data.grant.labelIds,
        scope: data.grant.scope,
        props: props,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(NotAuthorizedException);
      serverGrants = false;
    }

    expect(serverGrants).toBe(data.mayGrant);

    const rows: PermissionRows = { allow: [data.caller], block: [] };

    expect(
      canGrantTeamPermission({
        grant: {
          permission: Permission.ReadProjectMonitor,
          scope: data.grant.scope,
          labelIds: data.grant.labelIds.map((labelId: ObjectID): string => {
            return labelId.toString();
          }),
        },
        rows: rows,
      }),
    ).toBe(data.mayGrant);
  });

  test("the dashboard reads a row stored as All with labels as limited, as the server does", () => {
    expect(isUnrestrictedPermission(LIMITED_TO_A_AS_ALL)).toBe(false);
    expect(
      isUnrestrictedPermission(
        row(Permission.ReadProjectMonitor, { scope: PermissionScope.All }),
      ),
    ).toBe(true);
    expect(
      isUnrestrictedPermission(
        row(Permission.ReadProjectMonitor, { scope: PermissionScope.Owned }),
      ),
    ).toBe(false);
  });
});
