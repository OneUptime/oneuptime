import {
  canReadPrivateRecordWithOwners,
  shouldBypassRecordPrivacy,
} from "../../../../Server/Utils/PrivacyFilterUtil";
import { getIncidentSelfPrivacyRaw } from "../../../../Server/Utils/Incident/IncidentPrivacyFilter";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * WHO MAY READ A PRIVATE RECORD THAT IS NOT CREATED YET (#7213).
 *
 * "When this goes down" describes the incident or alert a monitor's criteria
 * would open, and a private one only to a reader who could read it once it
 * exists. canReadPrivateRecordWithOwners is that rule for a record held in
 * memory, by its owners' ids: the rule PrivateRecordReadFilter and the
 * incident's own privacy filter read in SQL (an owner user row, or an owner
 * team row joined to an accepted TeamMember row; or a caller who sees every
 * private record). Each kind of reader the SQL rule's own suite names is
 * told the same here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72130000-0000-4000-8000-000000000001",
);
const ME: ObjectID = new ObjectID("72130000-0000-4000-8000-000000000002");
const SOMEONE_ELSE: string = "72130000-0000-4000-8000-000000000003";
const OWNER_TEAM: string = "72130000-0000-4000-8000-000000000004";
const OTHER_TEAM: string = "72130000-0000-4000-8000-000000000005";

function person(permission?: Permission): DatabaseCommonInteractionProps {
  return {
    userId: ME,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: permission
      ? ({
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: [
              {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
              } as UserPermission,
            ],
          },
        } as never)
      : undefined,
  };
}

function reads(data: {
  props: DatabaseCommonInteractionProps;
  ownerUserIds?: Array<string>;
  ownerTeamIds?: Array<string>;
  acceptedTeamIds?: Array<string>;
}): boolean {
  return canReadPrivateRecordWithOwners({
    props: data.props,
    ownerUserIds: data.ownerUserIds || [],
    ownerTeamIds: data.ownerTeamIds || [],
    callerAcceptedTeamIds: new Set<string>(
      (data.acceptedTeamIds || []).map((id: string): string => {
        return id.toLowerCase();
      }),
    ),
  });
}

describe("who may read a private record not created yet", () => {
  test("one of its owners, named as one", () => {
    expect(
      reads({ props: person(), ownerUserIds: [SOMEONE_ELSE, ME.toString()] }),
    ).toBe(true);
  });

  test("an accepted member of a team of its owners", () => {
    expect(
      reads({
        props: person(),
        ownerTeamIds: [OWNER_TEAM],
        acceptedTeamIds: [OWNER_TEAM],
      }),
    ).toBe(true);
  });

  test("not a member of another team, nor one whose invitation is not accepted (it is not among the accepted)", () => {
    expect(
      reads({
        props: person(),
        ownerTeamIds: [OWNER_TEAM],
        acceptedTeamIds: [OTHER_TEAM],
      }),
    ).toBe(false);
  });

  test("not another member of the project, whatever they may read otherwise", () => {
    expect(
      reads({
        props: person(Permission.ProjectMember),
        ownerUserIds: [SOMEONE_ELSE],
      }),
    ).toBe(false);
  });

  test("a Project Admin and a Project Owner, who see every private record", () => {
    for (const permission of [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
    ]) {
      expect(shouldBypassRecordPrivacy(person(permission))).toBe(true);
      expect(reads({ props: person(permission) })).toBe(true);
    }
  });

  test("root, as OneUptime reads", () => {
    expect(reads({ props: { isRoot: true } })).toBe(true);
  });

  test("no person: an API key with no Project Owner or Admin, and a workflow's step, read none", () => {
    const apiKey: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
    };
    const workflowStep: DatabaseCommonInteractionProps =
      WorkflowPrincipal.getPropsWithoutPlan({
        projectId: PROJECT_ID,
        workflowId: ObjectID.generate(),
      });

    expect(reads({ props: apiKey, ownerUserIds: [SOMEONE_ELSE] })).toBe(false);
    expect(
      reads({
        props: { ...workflowStep, userId: ME },
        ownerUserIds: [ME.toString()],
      }),
    ).toBe(false);
  });

  test("ids are told apart by value, whatever their case", () => {
    expect(
      reads({
        props: person(),
        ownerUserIds: [ME.toString().toUpperCase()],
      }),
    ).toBe(true);
    expect(
      reads({
        props: person(),
        ownerTeamIds: [OWNER_TEAM.toUpperCase()],
        acceptedTeamIds: [OWNER_TEAM],
      }),
    ).toBe(true);
  });

  /*
   * The SQL rule reads the same two kinds of owner row and the same
   * TeamMember flag: if it ever reads another, this rule must follow.
   */
  test("it is the rule the incident's own privacy filter reads in SQL", () => {
    const raw: FindOperator<unknown> = getIncidentSelfPrivacyRaw(
      person(),
    ) as unknown as FindOperator<unknown>;
    const sql: string = (
      raw as unknown as { getSql: (alias: string) => string }
    ).getSql('"Incident"."isPrivate"');

    expect(sql).toContain('"IncidentOwnerUser"');
    expect(sql).toContain('"IncidentOwnerTeam"');
    expect(sql).toContain('tm."hasAcceptedInvitation" = TRUE');
    expect(getIncidentSelfPrivacyRaw(person(Permission.ProjectAdmin))).toBe(
      undefined,
    );
  });
});
