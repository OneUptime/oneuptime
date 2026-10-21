import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import Select from "../../../../../Server/Types/Database/Select";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import { ColumnAccessControl } from "../../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Columns from "../../../../../Types/Database/Columns";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * A column is read and written by the rule the table is (HeldPermissionsUtil):
 * an allow row for one of the column's permissions, no block with no labels
 * on any of them, and - on an operational resource - the table's
 * *AllOperationalResources wildcard for a column that lets in everyone its
 * table does. A column narrower than its table on purpose (a secret only
 * editors read) keeps exactly its own list. A column reached through a
 * relation select is read the same way.
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

/*
 * Fresh props per assertion: DatabaseCommonInteractionPropsUtil adds the
 * automatic Public and CurrentUser to what it is handed.
 */
function propsWith(
  rows: Array<UserPermission | Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [projectId],
    },
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

function readableMonitorColumns(
  rows: Array<UserPermission | Permission>,
): Array<string> {
  const columns: Columns = ColumnPermissions.getModelColumnsByPermissions(
    Monitor,
    ColumnPermissions.getColumnCheckRows(propsWith(rows)),
    DatabaseRequestType.Read,
  );

  return columns.columns;
}

describe("Column reads follow the table's rule", () => {
  test("a reader of monitors reads their name", () => {
    expect(readableMonitorColumns([Permission.ReadProjectMonitor])).toContain(
      "name",
    );
  });

  test("a block with no labels on the column's permission takes it away", () => {
    expect(
      readableMonitorColumns([
        Permission.ReadProjectMonitor,
        row(Permission.ReadProjectMonitor, { isBlock: true }),
      ]),
    ).not.toContain("name");
  });

  test("a block with labels does not: it restricts the labelled monitors", () => {
    expect(
      readableMonitorColumns([
        Permission.ReadProjectMonitor,
        row(Permission.ReadProjectMonitor, { isBlock: true, labelled: true }),
      ]),
    ).toContain("name");
  });

  test("a block row is never a grant", () => {
    expect(
      readableMonitorColumns([
        row(Permission.ReadProjectMonitor, { isBlock: true }),
      ]),
    ).not.toContain("name");
  });

  test("the wildcard reads exactly the columns that let in everyone the table does", () => {
    const model: Monitor = new Monitor();
    const tableRead: Array<Permission> = model.getReadPermissions();
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const readable: Array<string> = readableMonitorColumns([
      Permission.ReadAllOperationalResources,
    ]);

    let widened: number = 0;
    let narrower: number = 0;

    for (const column of Object.keys(accessControl)) {
      const columnRead: Array<Permission> = accessControl[column]?.read || [];
      const coversTable: boolean = tableRead.every(
        (permission: Permission): boolean => {
          return columnRead.includes(permission);
        },
      );
      const readByEveryone: boolean =
        columnRead.includes(Permission.Public) ||
        columnRead.includes(Permission.User);

      if (readByEveryone) {
        continue;
      }

      if (coversTable) {
        widened++;
      } else {
        narrower++;
      }

      expect([column, readable.includes(column)]).toEqual([
        column,
        coversTable,
      ]);
    }

    // The matrix means something only if both kinds of column exist.
    expect(widened).toBeGreaterThan(0);
    expect(narrower).toBeGreaterThan(0);
  });

  test("a blocked wildcard reads nothing it alone would have", () => {
    expect(
      readableMonitorColumns([
        Permission.ReadAllOperationalResources,
        row(Permission.ReadAllOperationalResources, { isBlock: true }),
      ]),
    ).not.toContain("name");
  });

  test("selecting a blocked column is refused", () => {
    const select: Select<Monitor> = { name: true };

    expect(() => {
      SelectPermission.checkSelectPermission(
        Monitor,
        select,
        propsWith([
          Permission.ReadProjectMonitor,
          row(Permission.ReadProjectMonitor, { isBlock: true }),
        ]),
      );
    }).toThrow(NotAuthorizedException);

    expect(() => {
      SelectPermission.checkSelectPermission(
        Monitor,
        select,
        propsWith([Permission.ReadProjectMonitor]),
      );
    }).not.toThrow();
  });
});

describe("A column reached through a relation select follows the same rule", () => {
  /*
   * Incident -> monitors -> createdAt: a column the related monitor carries
   * without a list of its own, so it is read with the monitor table's.
   */
  const select: Select<Incident> = {
    monitors: { createdAt: true },
  } as unknown as Select<Incident>;

  type CheckFunction = (rows: Array<UserPermission | Permission>) => void;

  const check: CheckFunction = (
    rows: Array<UserPermission | Permission>,
  ): void => {
    QueryPermission.checkRelationQueryPermission(
      Incident,
      {},
      select,
      propsWith(rows),
    );
  };

  test("a reader of monitors", () => {
    expect(() => {
      check([Permission.ReadProjectIncident, Permission.ReadProjectMonitor]);
    }).not.toThrow();
  });

  test("not a reader of monitors", () => {
    expect(() => {
      check([Permission.ReadProjectIncident]);
    }).toThrow(NotAuthorizedException);
  });

  test("Read All Operational Resources reads the related monitor", () => {
    expect(() => {
      check([
        Permission.ReadProjectIncident,
        Permission.ReadAllOperationalResources,
      ]);
    }).not.toThrow();
  });

  test("another team's block with no labels on reading monitors refuses", () => {
    expect(() => {
      check([
        Permission.ReadProjectIncident,
        Permission.ReadProjectMonitor,
        row(Permission.ReadProjectMonitor, { isBlock: true }),
      ]);
    }).toThrow(NotAuthorizedException);
  });

  test("a block with labels does not refuse the select", () => {
    expect(() => {
      check([
        Permission.ReadProjectIncident,
        Permission.ReadProjectMonitor,
        row(Permission.ReadProjectMonitor, { isBlock: true, labelled: true }),
      ]);
    }).not.toThrow();
  });
});
