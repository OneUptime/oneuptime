import Incident from "../../../../../Models/DatabaseModels/Incident";
import MonitorOwnerUser from "../../../../../Models/DatabaseModels/MonitorOwnerUser";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import Query from "../../../../../Server/Types/Database/Query";
import PendingInviteeProfiles from "../../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../../../Types/BaseDatabase/Search";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../../../Types/HeldPermissions";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { customDomainCaller } from "../../../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A LIST OF PEOPLE IS FILTERED AND ORDERED ONLY BY WHAT ITS READER MAY SEE
 * OF THEM (found while fixing #9895).
 *
 * Permission.CurrentUser lets a person read their own account's columns -
 * their language, time zone, company, phone, whether their address is
 * verified - and every signed-in person holds it, because a read of the
 * User table itself is held to the reader's own row. A filter or an order
 * through a relation to someone's account was held to the same column
 * permissions, and so let every project member filter and order their
 * project's people by any of those columns of anybody's account:
 *
 *   - `{ user: { isEmailVerified: true } }` on the Users list said whether
 *     an address the project had invited had an account before (an
 *     account an invitation makes is not verified) - the very thing #9823
 *     and #9825 closed everywhere else;
 *   - a filter by `user.companyPhoneNumber` or `user.timezone` spelt them
 *     out one Search at a time, and an order put them in order, of members
 *     and invitees alike, none of which any select may return.
 *
 * Through a relation the account is whoever the relation names, so
 * CurrentUser lets in nobody there (QueryPermission
 * .canFilterOrOrderByRelatedColumn): a filter or an order through a
 * relation names of a person what any reader of the relation may read -
 * their name, address, picture and two-factor flag - and their id. A select
 * through the relation is unchanged, and so is OneUptime's own read and a
 * master admin's.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

function caller(
  permissions: Array<Permission>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

const ROLES: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
];

// The relations a list reads a person through, on lists people use most.
const RELATIONS: Array<[string, { new (): BaseModel }, string]> = [
  ["the Users list's person", TeamMember, "user"],
  ["an owner row's person", MonitorOwnerUser, "user"],
  ["the person who declared an incident", Incident, "createdByUser"],
];

const user: User = new User();

/*
 * The columns of a person's account only they read: CurrentUser among their
 * readers, not readable by any reader of a relation, and not an id or a
 * time every select may name.
 */
const OWN_COLUMNS: Array<string> = Object.keys(
  user
    .getTableColumns()
    .columns.reduce((found: Record<string, true>, column: string) => {
      const metadata: TableColumnMetadata | undefined =
        user.getTableColumnMetadata(column);
      const readers: Array<Permission> =
        user.getColumnAccessControlFor(column)?.read || [];

      if (
        metadata &&
        !metadata.canReadOnRelationQuery &&
        !ColumnPermissions.getExcludedColumnNames().includes(column) &&
        readers.includes(Permission.CurrentUser)
      ) {
        found[column] = true;
      }

      return found;
    }, {}),
);

// What any reader of a relation reads of a person.
const READ_THROUGH_A_RELATION: Array<string> = [
  "name",
  "email",
  "profilePictureId",
  "twoFactorAuthEnabled",
];

async function outcome(data: {
  modelType: { new (): BaseModel };
  query?: Record<string, unknown>;
  select?: Record<string, unknown>;
  sort?: unknown;
  props: DatabaseCommonInteractionProps;
}): Promise<Error | null> {
  try {
    await ModelPermission.checkReadQueryPermission<BaseModel>(
      data.modelType,
      (data.query || {}) as Query<BaseModel>,
      (data.select || { _id: true }) as never,
      data.props,
      data.sort,
    );
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe("the columns only a person reads of their own account", () => {
  test("are the account's private settings: never what a relation reads", () => {
    for (const column of [
      "isEmailVerified",
      "timezone",
      "language",
      "companyName",
      "companyPhoneNumber",
      "jobRole",
    ]) {
      expect(OWN_COLUMNS).toContain(column);
    }

    for (const column of READ_THROUGH_A_RELATION) {
      expect(OWN_COLUMNS).not.toContain(column);
    }
  });

  test("CurrentUser is the one permission a relation to a person does not count, and only there", () => {
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new User(),
      ),
    ).toEqual([Permission.CurrentUser]);
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new TeamMember(),
      ),
    ).toEqual([]);
    expect(
      PendingInviteeProfiles.getPermissionsNotCountedThroughRelation(
        new Incident(),
      ),
    ).toEqual([]);
  });
});

describe.each(RELATIONS)(
  "%s",
  (
    _relationName: string,
    modelType: { new (): BaseModel },
    relation: string,
  ) => {
    describe.each(ROLES)(
      "for %s",
      (_role: string, permissions: Array<Permission>) => {
        test("no filter by a column only the person reads", async () => {
          for (const column of OWN_COLUMNS) {
            const refusal: Error | null = await outcome({
              modelType,
              query: { [relation]: { [column]: new Search("a") } },
              props: caller(permissions),
            });

            expect({ column, refused: refusal?.message || null }).toEqual({
              column,
              refused: expect.stringContaining(
                `You do not have permissions to query on - ${column} of User through ${relation}. No permission allows it`,
              ),
            });
          }
        });

        test("no order by a column only the person reads", async () => {
          for (const column of OWN_COLUMNS) {
            const refusal: Error | null = await outcome({
              modelType,
              sort: { [relation]: { [column]: "ASC" } },
              props: caller(permissions),
            });

            expect({ column, refused: refusal?.message || null }).toEqual({
              column,
              refused: expect.stringContaining(
                `You do not have permissions to sort on - ${column} of User through ${relation}. No permission allows it`,
              ),
            });
          }
        });

        test("a filter and an order by what the relation reads of them, and by their id, as before", async () => {
          for (const column of READ_THROUGH_A_RELATION) {
            expect(
              await outcome({
                modelType,
                query: { [relation]: { [column]: new Search("a") } },
                props: caller(permissions),
              }),
            ).toBeNull();
            expect(
              await outcome({
                modelType,
                sort: { [relation]: { [column]: "ASC" } },
                props: caller(permissions),
              }),
            ).toBeNull();
          }

          expect(
            await outcome({
              modelType,
              query: { [relation]: { _id: ObjectID.generate().toString() } },
              props: caller(permissions),
            }),
          ).toBeNull();
        });

        test("a select through the relation reads what it always read", async () => {
          expect(
            await outcome({
              modelType,
              select: {
                _id: true,
                [relation]: {
                  _id: true,
                  name: true,
                  email: true,
                  profilePictureId: true,
                },
              },
              props: caller(permissions),
            }),
          ).toBeNull();
        });
      },
    );

    test("OneUptime's own reads and a master admin's filter and order as before", async () => {
      for (const props of [
        { isRoot: true },
        caller([], { isMasterAdmin: true }),
      ] as Array<DatabaseCommonInteractionProps>) {
        for (const column of ["isEmailVerified", "timezone", "language"]) {
          expect(
            await outcome({
              modelType,
              query: { [relation]: { [column]: new Search("a") } },
              props,
            }),
          ).toBeNull();
          expect(
            await outcome({
              modelType,
              sort: { [relation]: { [column]: "ASC" } },
              props,
            }),
          ).toBeNull();
        }
      }
    });
  },
);

describe("whether an invited address had an account", () => {
  test("the Users list cannot be asked which invitees had a verified address", async () => {
    const refusal: Error | null = await outcome({
      modelType: TeamMember,
      query: {
        hasAcceptedInvitation: false,
        user: { isEmailVerified: true },
      },
      props: caller([Permission.ProjectMember]),
    });

    expect(refusal?.message).toContain("isEmailVerified of User through user");
  });

  test("nor ordered by it, for a project admin either", async () => {
    const refusal: Error | null = await outcome({
      modelType: TeamMember,
      sort: { user: { isEmailVerified: "DESC" } },
      props: caller([Permission.ProjectAdmin]),
    });

    expect(refusal?.message).toContain("isEmailVerified of User through user");
  });
});

describe("the check, alone", () => {
  test("a filter or an order through a relation does not count CurrentUser on a person's account; a select still does, for ids", () => {
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: ColumnPermissions.getColumnCheckRows(
        caller([Permission.ProjectOwner]),
      ),
    });

    expect(
      QueryPermission.canFilterOrOrderByRelatedColumn({
        relatedModel: new User(),
        column: "timezone",
        held: held,
      }),
    ).toBe(false);

    // A select of a related person's id is the relation's (QueryPermission's select check).
    expect(
      QueryPermission.canReadRelatedColumn({
        relatedModel: new User(),
        column: "_id",
        held: held,
      }),
    ).toBe(true);

    expect(
      QueryPermission.getRelatedFilterPermissions(new User(), "timezone"),
    ).toEqual([]);
  });
});
