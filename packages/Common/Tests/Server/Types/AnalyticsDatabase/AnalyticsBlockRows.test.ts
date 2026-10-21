import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The analytics models (logs, traces, metrics, ...) read a caller's rows by
 * the rule the database models do: an allow row grants, a block row never
 * does, a block with no labels on any permission the table accepts refuses
 * it, and an operational resource's table and its columns that admit
 * everyone the table does accept the matching *AllOperationalResources
 * wildcard - unless the wildcard is blocked.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const labelId: ObjectID = ObjectID.generate();

type RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
) => UserPermission;

const row: RowFunction = (
  permission: Permission,
  options?: { isBlock?: boolean; labelled?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: options?.labelled ? [labelId] : [],
    isBlockPermission: Boolean(options?.isBlock),
  };
};

// Fresh props per check: the props util adds Public and Current User.
function propsWith(
  rows: Array<UserPermission | Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: rows.map(
          (entry: UserPermission | Permission): UserPermission => {
            return typeof entry === "string" ? row(entry) : entry;
          },
        ),
      },
    },
  };
}

type TableCheckFunction = (
  rows: Array<UserPermission | Permission>,
  type?: DatabaseRequestType,
) => unknown;

// The table half of every analytics request: null when it lets the caller in.
const tableRefusal: TableCheckFunction = (
  rows: Array<UserPermission | Permission>,
  type?: DatabaseRequestType,
): unknown => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkModelLevelPermissions(
      Metric,
      propsWith(rows),
      type || DatabaseRequestType.Read,
    );
  } catch (err) {
    return err;
  }

  return null;
};

function mayReadValue(rows: Array<UserPermission | Permission>): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ModelPermission as any).checkSelectPermission(
      Metric,
      { name: true, value: true },
      propsWith(rows),
    );
  } catch {
    return false;
  }

  return true;
}

describe("Analytics tables read block rows as the database tables do", () => {
  test("a grant", () => {
    expect(tableRefusal([Permission.ReadTelemetryServiceMetrics])).toBeNull();
  });

  test("a grantee whose only row is a block, with labels or without, is refused", () => {
    expect(
      tableRefusal([
        row(Permission.ReadTelemetryServiceMetrics, { isBlock: true }),
      ]),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(
      tableRefusal([
        row(Permission.ReadTelemetryServiceMetrics, {
          isBlock: true,
          labelled: true,
        }),
      ]),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("another team's block with no labels takes the table away, and says which", () => {
    const refusal: unknown = tableRefusal([
      Permission.ReadTelemetryServiceMetrics,
      row(Permission.ReadTelemetryServiceMetrics, { isBlock: true }),
    ]);

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toContain(
      `because ${Permission.ReadTelemetryServiceMetrics} is in your team's permission block list`,
    );
  });

  test("a block with no labels on another permission the table accepts refuses too", () => {
    expect(
      tableRefusal([
        Permission.ReadTelemetryServiceMetrics,
        row(Permission.ProjectOwner, { isBlock: true }),
      ]),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("a block with labels leaves the table: the records carrying them are left out", () => {
    expect(
      tableRefusal([
        Permission.ReadTelemetryServiceMetrics,
        row(Permission.ReadTelemetryServiceMetrics, {
          isBlock: true,
          labelled: true,
        }),
      ]),
    ).toBeNull();
  });

  test("a block on another operation changes nothing", () => {
    expect(
      tableRefusal([
        Permission.ReadTelemetryServiceMetrics,
        row(Permission.DeleteTelemetryServiceMetrics, { isBlock: true }),
      ]),
    ).toBeNull();
  });
});

describe("Analytics columns read block rows and the wildcard as the table does", () => {
  test("a metric reader reads a chart's columns", () => {
    expect(mayReadValue([Permission.ReadTelemetryServiceMetrics])).toBe(true);
  });

  test("a block with no labels on the metric permission takes the columns away", () => {
    expect(
      mayReadValue([
        Permission.ReadTelemetryServiceMetrics,
        row(Permission.ReadTelemetryServiceMetrics, { isBlock: true }),
      ]),
    ).toBe(false);
  });

  test("Read All Operational Resources reads them, table and columns", () => {
    expect(tableRefusal([Permission.ReadAllOperationalResources])).toBeNull();
    expect(mayReadValue([Permission.ReadAllOperationalResources])).toBe(true);
  });

  test("a blocked wildcard reads nothing", () => {
    const rows: Array<UserPermission | Permission> = [
      Permission.ReadAllOperationalResources,
      row(Permission.ReadAllOperationalResources, { isBlock: true }),
    ];

    expect(tableRefusal(rows)).toBeInstanceOf(NotAuthorizedException);
    expect(mayReadValue(rows)).toBe(false);
  });
});
