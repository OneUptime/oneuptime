import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import Incident from "../../../../Models/DatabaseModels/Incident";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import RuleOwningTeams, {
  OWNING_TEAMS_MISC_DATA_KEY,
} from "../../../../Server/Utils/Rules/RuleOwningTeams";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A RULE'S OWNING TEAMS, PICKED ON ITS FORM (RuleOwningTeams): what a form
 * sends, and who may send it, asked before the rule is saved.
 * TeamOwnedRulesPostgres saves them through the routes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);
const TEAM_X: string = "3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a";
const TEAM_Y: string = "4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b";

function memberWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: new ObjectID("2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f"),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
            teamId: new ObjectID(TEAM_Y),
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

describe("the owning teams a form sends", () => {
  test("none sent: the rule's owning teams stay as they are", () => {
    expect(RuleOwningTeams.getPickedTeamIds(undefined)).toBeNull();
    expect(RuleOwningTeams.getPickedTeamIds({})).toBeNull();
    expect(
      RuleOwningTeams.getPickedTeamIds({ [OWNING_TEAMS_MISC_DATA_KEY]: null }),
    ).toBeNull();
  });

  test("an empty list: the rule is the project's again", () => {
    expect(
      RuleOwningTeams.getPickedTeamIds({ [OWNING_TEAMS_MISC_DATA_KEY]: [] }),
    ).toEqual([]);
  });

  test("each team once, however it is written", () => {
    expect(
      RuleOwningTeams.getPickedTeamIds({
        [OWNING_TEAMS_MISC_DATA_KEY]: [
          TEAM_X,
          TEAM_X.toUpperCase(),
          { _id: TEAM_Y },
        ],
      })!.map((teamId: ObjectID): string => {
        return teamId.toString().toLowerCase();
      }),
    ).toEqual([TEAM_X, TEAM_Y]);

    expect(
      RuleOwningTeams.getPickedTeamIds({
        [OWNING_TEAMS_MISC_DATA_KEY]: TEAM_X,
      })!.map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_X]);
  });

  test("something that is not a team's id is refused", () => {
    expect(() => {
      RuleOwningTeams.getPickedTeamIds({
        [OWNING_TEAMS_MISC_DATA_KEY]: ["Platform"],
      });
    }).toThrow(BadDataException);

    expect(() => {
      RuleOwningTeams.getPickedTeamIds({
        [OWNING_TEAMS_MISC_DATA_KEY]: [42],
      });
    }).toThrow(BadDataException);
  });

  test("only the rule kinds teams can own take them", () => {
    expect(RuleOwningTeams.getKind(IncidentOnCallRule)?.owningTeamTable).toBe(
      "IncidentOnCallRuleOwningTeam",
    );
    expect(
      RuleOwningTeams.getKind(WorkspaceNotificationRule)?.owningTeamTable,
    ).toBe("WorkspaceNotificationRuleOwningTeam");
    expect(RuleOwningTeams.getKind(Incident)).toBeNull();
  });
});

describe("a rule created with owning teams", () => {
  test("is refused before it is saved to someone who may not add owning teams", () => {
    expect(() => {
      RuleOwningTeams.checkBeforeCreate({
        modelType: IncidentOnCallRule,
        miscDataProps: { [OWNING_TEAMS_MISC_DATA_KEY]: [TEAM_Y] },
        props: memberWith([Permission.CreateIncidentOnCallRule]),
      });
    }).toThrow(NotAuthorizedException);
  });

  test("is let through for someone who may", () => {
    expect(() => {
      RuleOwningTeams.checkBeforeCreate({
        modelType: IncidentOnCallRule,
        miscDataProps: { [OWNING_TEAMS_MISC_DATA_KEY]: [TEAM_Y] },
        props: memberWith([
          Permission.CreateIncidentOnCallRule,
          Permission.CreateIncidentOnCallRuleOwningTeam,
        ]),
      });
    }).not.toThrow();
  });

  test("asks nothing of a rule created with none, or of another kind", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      Permission.CreateIncidentOnCallRule,
    ]);

    for (const miscDataProps of [
      undefined,
      {},
      { [OWNING_TEAMS_MISC_DATA_KEY]: [] },
    ]) {
      expect(() => {
        RuleOwningTeams.checkBeforeCreate({
          modelType: IncidentOnCallRule,
          miscDataProps: miscDataProps,
          props: props,
        });
      }).not.toThrow();
    }

    expect(() => {
      RuleOwningTeams.checkBeforeCreate({
        modelType: Incident,
        miscDataProps: { [OWNING_TEAMS_MISC_DATA_KEY]: [TEAM_Y] },
        props: props,
      });
    }).not.toThrow();
  });
});
