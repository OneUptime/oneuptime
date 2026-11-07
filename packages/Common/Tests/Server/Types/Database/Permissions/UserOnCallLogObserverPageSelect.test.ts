import QueryPermission from "../../../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../../../Server/Types/Database/Permissions/SelectPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import OnCallDutyPolicyExecutionLog from "../../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../../../Models/DatabaseModels/UserOnCallLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * MY PAGES IN THE MOBILE APP SAYS "FYI (OBSERVER)".
 *
 * The app lists the signed-in person's own pages (UserOnCallLog, read
 * through the auto-granted CurrentUser permission) and tells an observer's
 * page (OnCallObserverPage) apart by its run, read through the page:
 *
 *   select: { onCallDutyPolicyExecutionLog: { _id, isObserverPage } }
 *
 * QueryPermission.checkRelationQueryPermission THROWS on an inner key the
 * related model does not mark canReadOnRelationQuery - the whole list fails,
 * not the one column - so the run's isObserverPage carries the flag: it is
 * what the page is, for the people it paged. These pin the select the app
 * sends, verbatim, for the person who owns the pages and for a project
 * member, and that the flag moved nothing else: the run's other columns that
 * do not carry it still refuse.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

/*
 * Fresh props per assertion: DatabaseCommonInteractionPropsUtil MUTATES what
 * it is handed, so a shared object carries state between tests.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

/*
 * The select copied out of MobileApp/src/api/onCallPages.ts
 * (fetchMyOnCallPages). Kept as a literal rather than imported, so that
 * changing the app without changing the model surfaces here as a failure.
 */
const MY_PAGES_SELECT: Select<UserOnCallLog> = {
  _id: true,
  createdAt: true,
  status: true,
  statusMessage: true,
  acknowledgedAt: true,
  onCallDutyPolicyId: true,
  onCallDutyPolicy: { _id: true, name: true },
  onCallDutyPolicyExecutionLog: { _id: true, isObserverPage: true },
  triggeredByIncident: { _id: true, title: true },
  triggeredByAlert: { _id: true, title: true },
  triggeredByIncidentEpisode: { _id: true, title: true },
  triggeredByAlertEpisode: { _id: true, title: true },
} as Select<UserOnCallLog>;

function checkSelect(
  select: Select<UserOnCallLog>,
  props: DatabaseCommonInteractionProps,
): void {
  SelectPermission.checkSelectPermission(UserOnCallLog, select, props);
  QueryPermission.checkRelationQueryPermission(
    UserOnCallLog,
    {} as Query<UserOnCallLog>,
    select,
    props,
  );
}

describe("the mobile app's My Pages select", () => {
  test.each([
    ["the person whose pages they are", [Permission.CurrentUser]],
    ["a project member", [Permission.CurrentUser, Permission.ProjectMember]],
    ["a project owner", [Permission.CurrentUser, Permission.ProjectOwner]],
  ] as Array<[string, Array<Permission>]>)(
    "is accepted for %s",
    (_who: string, permissions: Array<Permission>) => {
      expect(() => {
        return checkSelect(MY_PAGES_SELECT, makeProps(permissions));
      }).not.toThrow();
    },
  );

  test("whether a run pages as observers is read on a relation", () => {
    expect(
      new OnCallDutyPolicyExecutionLog().getTableColumnMetadata(
        "isObserverPage",
      ).canReadOnRelationQuery,
    ).toBe(true);
  });

  test("the run's columns that are not marked still refuse, through the same page", () => {
    for (const column of ["pageMessage", "pageAgainNumber", "statusMessage"]) {
      expect(() => {
        return checkSelect(
          {
            _id: true,
            onCallDutyPolicyExecutionLog: { _id: true, [column]: true },
          } as Select<UserOnCallLog>,
          makeProps([Permission.CurrentUser]),
        );
      }).toThrow(BadDataException);
    }
  });
});
