import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import Query from "../../../../../Server/Types/Database/Query";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageDomain from "../../../../../Models/DatabaseModels/StatusPageDomain";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
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
import { FindOperator } from "typeorm";

/*
 * AN UPDATE KEEPS TO THE PARENTS ITS CALLER MAY UPDATE, BLOCKS INCLUDED.
 *
 * A record read through another one - a status page's custom domain - is
 * updated only under a parent its caller may update: a permission to update
 * the parent limited to labels narrows it (BasePermission
 * .addParentAccessToQuery), and so now does a block with labels on updating
 * the parent. A block on editing the Production status pages left their
 * domains open to change, through permissions that name the domain and not
 * the page. A read keeps to the parent's read blocks alone, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "ee000000-0000-4000-8000-000000000001",
);
const PRODUCTION: ObjectID = new ObjectID(
  "ee000000-0000-4000-8000-000000000002",
);

function row(
  permission: Permission,
  data: { labelIds?: Array<ObjectID>; isBlock?: boolean } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    scope: PermissionScope.All,
  };
}

function memberWith(rows: Array<UserPermission>): DatabaseCommonInteractionProps {
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

// Every value the query's conditions bind, through every AND.
function boundValues(value: unknown): Array<string> {
  if (!(value instanceof FindOperator)) {
    return [];
  }

  const operator: FindOperator<unknown> = value as FindOperator<unknown>;

  if (operator.type === "and" || operator.type === "or") {
    return (operator.value as unknown as Array<unknown>).flatMap(boundValues);
  }

  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters?: Record<string, unknown>;
      }
    ).objectLiteralParameters || {},
  )
    .flat()
    .map(String);
}

async function valuesBoundBy(
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
): Promise<Array<string>> {
  const query: Query<BaseModel> = await BasePermission.addRecordScopeToQuery(
    StatusPageDomain,
    {},
    null,
    props,
    type,
  );

  return Object.values(query as Record<string, unknown>).flatMap(boundValues);
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a status page's custom domain, under a block on editing Production status pages", () => {
  const props: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return memberWith([
        row(Permission.StatusPageAdmin),
        row(Permission.EditProjectStatusPage, {
          labelIds: [PRODUCTION],
          isBlock: true,
        }),
      ]);
    };

  test("an update leaves out the domains of the Production status pages", async () => {
    expect(
      await valuesBoundBy(props(), DatabaseRequestType.Update),
    ).toContain(PRODUCTION.toString());
  });

  test("a read is not narrowed by a block on editing", async () => {
    expect(
      await valuesBoundBy(props(), DatabaseRequestType.Read),
    ).not.toContain(PRODUCTION.toString());
  });

  test("a block on reading the pages narrows a read as before", async () => {
    expect(
      await valuesBoundBy(
        memberWith([
          row(Permission.StatusPageAdmin),
          row(Permission.ReadProjectStatusPage, {
            labelIds: [PRODUCTION],
            isBlock: true,
          }),
        ]),
        DatabaseRequestType.Read,
      ),
    ).toContain(PRODUCTION.toString());
  });
});
