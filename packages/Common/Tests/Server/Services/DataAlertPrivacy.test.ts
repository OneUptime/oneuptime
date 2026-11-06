import DataAlertService from "../../../Server/Services/DataAlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnFind } from "../../../Server/Types/Database/Hooks";
import Query from "../../../Server/Types/Database/Query";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * A DATA ALERT IS READ ONLY BY SOMEONE WHO MAY SEE BOTH OF ITS ALERTS.
 *
 * A data alert row says what a data monitor's alert is about, and names the
 * alert it is a consequence of. An alert's Data card reads its own row with
 * `alert: { title }` and `causeAlert: { title }`, and its Downstream Impact
 * the rows caused by it - and a relation join runs neither alert's read
 * rules. Anyone who may read data assets may read the table, so without the
 * alerts' privacy filters a private alert's number and title reached people
 * it is hidden from. DataAlertService narrows every read and count to rows
 * whose alert the caller may see, and whose cause - when there is one - too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194a1e7-0000-4000-8000-0000000000d1",
);
const ALERT_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000a1");
const USER_ID: ObjectID = new ObjectID("0194a1e7-0000-4000-8000-0000000000c1");

// Where both privacy clauses read who may see an alert from.
const ALERT_TABLE: string = 'FROM "Alert" a';

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

function columnParts(query: Query<DataAlert>, column: string): Array<string> {
  return operatorParts((query as Record<string, unknown>)[column]);
}

// The one privacy clause on `column`, which reads who may see an alert.
function privacyClause(query: Query<DataAlert>, column: string): string {
  const clauses: Array<string> = columnParts(query, column).filter(
    (sql: string): boolean => {
      return sql.includes(ALERT_TABLE);
    },
  );

  expect(clauses).toHaveLength(1);

  return clauses[0]!;
}

async function findQueryOf(
  query: Query<DataAlert>,
  props: DatabaseCommonInteractionProps,
): Promise<Query<DataAlert>> {
  const result: OnFind<DataAlert> = await (
    DataAlertService as unknown as {
      onBeforeFind: (findBy: FindBy<DataAlert>) => Promise<OnFind<DataAlert>>;
    }
  ).onBeforeFind({
    query: query,
    props: props,
    limit: 10,
    skip: 0,
  } as FindBy<DataAlert>);

  return result.findBy.query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a data alert is read only by someone who may see its alerts", () => {
  test("a read is narrowed to rows whose alert the caller may see, and whose cause, when it has one", async () => {
    const query: Query<DataAlert> = await findQueryOf(
      {},
      userProps(Permission.ProjectMember),
    );

    // The alert: always one, so a row of a hidden alert is never read.
    const alertClause: string = privacyClause(query, "alertId");
    expect(alertClause.startsWith("(COLUMN IN (SELECT")).toBe(true);
    expect(alertClause).toContain('"AlertOwnerUser"');
    expect(alertClause).toContain('"AlertOwnerTeam"');

    // The cause: none lets the row through, a hidden one keeps it out.
    const causeClause: string = privacyClause(query, "causeAlertId");
    expect(causeClause.startsWith("(COLUMN IS NULL OR COLUMN IN (SELECT")).toBe(
      true,
    );
    expect(causeClause).toContain('"AlertOwnerUser"');
    expect(causeClause).toContain('"AlertOwnerTeam"');
  });

  test("the caller's own filters stay beside the privacy clauses: an alert's own row, and the rows it caused", async () => {
    for (const column of ["alertId", "causeAlertId"]) {
      const query: Query<DataAlert> = await findQueryOf(
        { [column]: ALERT_ID } as Query<DataAlert>,
        userProps(Permission.ReadDataAsset),
      );

      const filter: FindOperator<unknown> = (query as Record<string, unknown>)[
        column
      ] as FindOperator<unknown>;

      // Both apply: the alert asked for, and only if the caller may see it.
      expect(filter.type).toBe("and");
      expect(
        (filter.value as unknown as Array<FindOperator<unknown>>)[0]!.value,
      ).toBe(ALERT_ID.toString());
      expect(columnParts(query, column)).toContain("equal");
      privacyClause(query, column);
    }
  });

  test("a count is narrowed the same way: the Downstream Impact's total counts only what may be seen", async () => {
    const baseCount: SpyInstance<typeof DatabaseService.prototype.countBy> =
      jest
        .spyOn(DatabaseService.prototype, "countBy")
        .mockResolvedValue(new PositiveNumber(0));

    await DataAlertService.countBy({
      query: { causeAlertId: ALERT_ID },
      props: userProps(Permission.TelemetryViewer),
    });

    expect(baseCount).toHaveBeenCalledTimes(1);

    const counted: Query<DataAlert> = (
      baseCount.mock.calls[0]![0] as { query: Query<DataAlert> }
    ).query;

    privacyClause(counted, "alertId");
    privacyClause(counted, "causeAlertId");
  });

  test("an API key, which owns nothing, reads only rows whose alerts are not private", async () => {
    const query: Query<DataAlert> = await findQueryOf(
      {},
      userProps(Permission.ProjectMember, null),
    );

    for (const column of ["alertId", "causeAlertId"]) {
      const clause: string = privacyClause(query, column);

      expect(clause).toContain('a."isPrivate" = FALSE');
      expect(clause).not.toContain("Owner");
    }
  });

  test("project owners and admins, OneUptime and master admins see every row", async () => {
    for (const props of [
      userProps(Permission.ProjectOwner),
      userProps(Permission.ProjectAdmin),
      { isRoot: true },
      { isMasterAdmin: true, userId: USER_ID },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(await findQueryOf({ causeAlertId: ALERT_ID }, props)).toEqual({
        causeAlertId: ALERT_ID,
      });
    }
  });

  test("a row is OneUptime's to write: nobody else may create, change or delete one", () => {
    const model: DataAlert = new DataAlert();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });
});
