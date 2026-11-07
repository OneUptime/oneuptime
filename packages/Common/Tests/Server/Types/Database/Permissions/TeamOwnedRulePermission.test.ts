import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import TeamOwnedRulePermission, {
  TeamOwnedRuleColumn,
} from "../../../../../Server/Types/Database/Permissions/TeamOwnedRulePermission";
import Query from "../../../../../Server/Types/Database/Query";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisodeOnCallRule from "../../../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../../../Models/DatabaseModels/AlertOnCallRule";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeOnCallRule from "../../../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOnCallRuleOwningTeam from "../../../../../Models/DatabaseModels/IncidentOnCallRuleOwningTeam";
import IncidentOwnerRule from "../../../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerRuleOwningTeam from "../../../../../Models/DatabaseModels/IncidentOwnerRuleOwningTeam";
import IncidentTemplate from "../../../../../Models/DatabaseModels/IncidentTemplate";
import WorkspaceNotificationRule from "../../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A RULE SOME TEAMS OWN IS CHANGED ONLY THROUGH THOSE TEAMS.
 *
 * GovTech's oversight team (Team X) and the team that runs services (Team Y)
 * each keep incident rules only they may change. Here, without a database:
 * which rows reach which rules (getReachingTeamIds), the SQL that holds an
 * update or a delete of a rule - or of its owning teams - to them, and where
 * the rule applies and where it does not. TeamOwnedRulesPostgres runs the
 * SQL through the routes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
);
const TEAM_X: ObjectID = new ObjectID("3d4e5f6a-7b8c-4d9e-8f1a-2b3c4d5e6f7a");
const TEAM_Y: ObjectID = new ObjectID("4e5f6a7b-8c9d-4e0f-9a2b-3c4d5e6f7a8b");
const RULE_ID: string = "5f6a7b8c-9d0e-4f1a-8b3c-4d5e6f7a8b9c";

function row(
  permission: Permission,
  data: {
    teamId?: ObjectID | undefined;
    isBlock?: boolean | undefined;
    labelIds?: Array<ObjectID> | undefined;
    scope?: PermissionScope | undefined;
  } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: Boolean(data.isBlock),
    scope: data.scope || PermissionScope.All,
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

// The member, acting in the project with these rows from their teams.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_X, TEAM_Y],
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

// The same rows with no person: an API key.
function apiKeyWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = memberWith(rows);

  delete props.userId;
  delete props.userType;
  delete props.userTeamIds;

  return props;
}

// Team Y may change incident on-call rules; Team X may only read them.
const platformMember: DatabaseCommonInteractionProps = memberWith([
  row(Permission.EditIncidentOnCallRule, { teamId: TEAM_Y }),
  row(Permission.DeleteIncidentOnCallRule, { teamId: TEAM_Y }),
  row(Permission.ReadIncidentOnCallRule, { teamId: TEAM_Y }),
  row(Permission.ReadIncidentOnCallRule, { teamId: TEAM_X }),
]);

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RawParts {
  sql: string;
  params: Record<string, string | Array<string>>;
}

// Pulls the SQL and bound values out of a typeorm Raw() FindOperator.
function rawParts(clause: unknown): RawParts {
  const operator: any = clause as any;

  return {
    sql: String(operator._getSql("COLUMN")),
    params: (operator._objectLiteralParameters || {}) as Record<
      string,
      string | Array<string>
    >,
  };
}

// The operators of an And() (or the one operator itself).
function operatorsOf(clause: unknown): Array<FindOperator<any>> {
  const operator: any = clause as any;

  if (operator?.type === "and") {
    return operator.value as Array<FindOperator<any>>;
  }

  return [operator as FindOperator<any>];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function teamsBound(parts: RawParts): Array<string> {
  return Object.values(parts.params)
    .flatMap((value: string | Array<string>): Array<string> => {
      return Array.isArray(value) ? value : [value];
    })
    .map((value: string): string => {
      return value.toLowerCase();
    })
    .sort();
}

describe("which rows reach the rules teams own", () => {
  test("a team's rows that grant the operation, each team once", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.EditIncidentOnCallRule, { teamId: TEAM_Y }),
      row(Permission.EditIncidentOnCallRule, { teamId: TEAM_Y }),
      row(Permission.ProjectAdmin, {
        teamId: TEAM_X,
        labelIds: [ObjectID.generate()],
        scope: PermissionScope.Labels,
      }),
      row(Permission.ReadIncidentOnCallRule, { teamId: TEAM_X }),
    ]);

    expect(
      TeamOwnedRulePermission.getReachingTeamIds(
        IncidentOnCallRule,
        props,
        DatabaseRequestType.Update,
      ).map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_Y.toString(), TEAM_X.toString()]);
  });

  test("a team that may only read lends a rule none of another team's permission", () => {
    expect(
      TeamOwnedRulePermission.getReachingTeamIds(
        IncidentOnCallRule,
        platformMember,
        DatabaseRequestType.Update,
      ).map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_Y.toString()]);
  });

  test("a block, and a row no team grants, reach nothing", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.EditIncidentOnCallRule, { teamId: TEAM_X, isBlock: true }),
      row(Permission.EditIncidentOnCallRule),
    ]);

    expect(
      TeamOwnedRulePermission.getReachingTeamIds(
        IncidentOnCallRule,
        props,
        DatabaseRequestType.Update,
      ),
    ).toEqual([]);
  });

  test("an owning team's own permissions reach its rule's owning teams", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.EditIncidentOnCallRule, { teamId: TEAM_X }),
      row(Permission.CreateIncidentOnCallRuleOwningTeam, { teamId: TEAM_Y }),
    ]);

    expect(
      TeamOwnedRulePermission.getReachingTeamIds(
        IncidentOnCallRuleOwningTeam,
        props,
        DatabaseRequestType.Create,
      ).map((teamId: ObjectID): string => {
        return teamId.toString();
      }),
    ).toEqual([TEAM_Y.toString()]);
  });
});

describe("where the rule applies", () => {
  test.each([
    IncidentOnCallRule,
    IncidentOwnerRule,
    WorkspaceNotificationRule,
    AlertOnCallRule,
    IncidentEpisodeOnCallRule,
    AlertEpisodeOnCallRule,
  ] as Array<{ new (): BaseModel }>)(
    "an update and a delete of %p and of its owning teams, by a member",
    (modelType: { new (): BaseModel }) => {
      for (const type of [
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect(
          TeamOwnedRulePermission.narrows(modelType, platformMember, type),
        ).toBe(true);
      }

      expect(
        TeamOwnedRulePermission.narrows(
          modelType,
          platformMember,
          DatabaseRequestType.Read,
        ),
      ).toBe(false);
      expect(
        TeamOwnedRulePermission.narrows(
          modelType,
          platformMember,
          DatabaseRequestType.Create,
        ),
      ).toBe(false);
    },
  );

  test("the owning teams of a rule are held to it by the rule's key", () => {
    const column: TeamOwnedRuleColumn | null =
      TeamOwnedRulePermission.getRuleColumn(IncidentOwnerRuleOwningTeam);

    expect(column?.column).toBe("incidentOwnerRuleId");
    expect(column?.isRule).toBe(false);
    expect(column?.kind.tableName).toBe("IncidentOwnerRule");

    expect(
      TeamOwnedRulePermission.getRuleColumn(IncidentOnCallRule)?.column,
    ).toBe("_id");
  });

  test("not on records of any other kind", () => {
    for (const modelType of [Incident, IncidentTemplate] as Array<{
      new (): BaseModel;
    }>) {
      expect(TeamOwnedRulePermission.getRuleColumn(modelType)).toBeNull();
      expect(
        TeamOwnedRulePermission.narrows(
          modelType,
          platformMember,
          DatabaseRequestType.Update,
        ),
      ).toBe(false);
    }
  });

  test("not for OneUptime, a server admin, or a Project Owner or Admin", () => {
    const owner: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectOwner, { teamId: TEAM_X }),
    ]);
    const admin: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectAdmin, { teamId: TEAM_X }),
    ]);
    const adminKey: DatabaseCommonInteractionProps = apiKeyWith([
      row(Permission.ProjectAdmin),
    ]);

    for (const props of [
      { isRoot: true } as DatabaseCommonInteractionProps,
      { isMasterAdmin: true } as DatabaseCommonInteractionProps,
      owner,
      admin,
      adminKey,
    ]) {
      expect(
        TeamOwnedRulePermission.narrows(
          IncidentOnCallRule,
          props,
          DatabaseRequestType.Update,
        ),
      ).toBe(false);
    }
  });

  test("an admin role limited to labels, or blocked, changes rules only as a member does", () => {
    const labelled: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectAdmin, {
        teamId: TEAM_X,
        labelIds: [ObjectID.generate()],
        scope: PermissionScope.Labels,
      }),
    ]);
    const blocked: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectAdmin, { teamId: TEAM_X }),
      row(Permission.ProjectAdmin, { teamId: TEAM_Y, isBlock: true }),
    ]);

    for (const props of [labelled, blocked]) {
      expect(
        TeamOwnedRulePermission.narrows(
          IncidentOnCallRule,
          props,
          DatabaseRequestType.Update,
        ),
      ).toBe(true);
    }
  });

  test("an API key's permission reaches no rule a team owns", () => {
    const key: DatabaseCommonInteractionProps = apiKeyWith([
      row(Permission.EditIncidentOnCallRule),
    ]);

    expect(
      TeamOwnedRulePermission.narrows(
        IncidentOnCallRule,
        key,
        DatabaseRequestType.Update,
      ),
    ).toBe(true);
    expect(
      TeamOwnedRulePermission.getReachingTeamIds(
        IncidentOnCallRule,
        key,
        DatabaseRequestType.Update,
      ),
    ).toEqual([]);
  });
});

describe("the SQL an update or a delete is held to", () => {
  test("a rule: every rule no team owns, and the ones its granting teams own", () => {
    const query: Query<IncidentOnCallRule> =
      TeamOwnedRulePermission.addTeamOwnedRuleScopeToQuery(
        IncidentOnCallRule,
        {} as Query<IncidentOnCallRule>,
        platformMember,
        DatabaseRequestType.Update,
      );

    const parts: RawParts = rawParts((query as Record<string, unknown>)["_id"]);

    expect(parts.sql).toContain(
      `COLUMN IN (SELECT r."_id" FROM "IncidentOnCallRule" r WHERE r."deletedAt" IS NULL AND (NOT EXISTS (SELECT 1 FROM "IncidentOnCallRuleOwningTeam" rot WHERE rot."incidentOnCallRuleId" = r."_id" AND rot."deletedAt" IS NULL) OR EXISTS (SELECT 1 FROM "IncidentOnCallRuleOwningTeam" rto WHERE rto."incidentOnCallRuleId" = r."_id" AND rto."deletedAt" IS NULL AND rto."teamId" IN (:...`,
    );
    expect(teamsBound(parts)).toEqual([TEAM_Y.toString().toLowerCase()]);
  });

  test("with no team granting it, only the rules no team owns", () => {
    const key: DatabaseCommonInteractionProps = apiKeyWith([
      row(Permission.DeleteIncidentOnCallRule),
    ]);

    const query: Query<IncidentOnCallRule> =
      TeamOwnedRulePermission.addTeamOwnedRuleScopeToQuery(
        IncidentOnCallRule,
        {} as Query<IncidentOnCallRule>,
        key,
        DatabaseRequestType.Delete,
      );

    const parts: RawParts = rawParts((query as Record<string, unknown>)["_id"]);

    expect(parts.sql).toContain("NOT EXISTS");
    expect(parts.sql).not.toContain(" OR EXISTS");
    expect(parts.params).toEqual({});
  });

  test("the caller's own filter on the rule stays as sent", () => {
    const query: Query<IncidentOnCallRule> =
      TeamOwnedRulePermission.addTeamOwnedRuleScopeToQuery(
        IncidentOnCallRule,
        { _id: RULE_ID } as Query<IncidentOnCallRule>,
        platformMember,
        DatabaseRequestType.Update,
      );

    const operators: Array<FindOperator<unknown>> = operatorsOf(
      (query as Record<string, unknown>)["_id"],
    );

    expect(operators).toHaveLength(2);
    expect(operators[0]!.value).toBe(RULE_ID);
    expect(rawParts(operators[1]).sql).toContain('"IncidentOnCallRule" r');
  });

  test("an owning team: held to its rule, by the rule's key", () => {
    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.DeleteIncidentOwnerRuleOwningTeam, { teamId: TEAM_X }),
    ]);

    const query: Query<IncidentOwnerRuleOwningTeam> =
      TeamOwnedRulePermission.addTeamOwnedRuleScopeToQuery(
        IncidentOwnerRuleOwningTeam,
        {} as Query<IncidentOwnerRuleOwningTeam>,
        props,
        DatabaseRequestType.Delete,
      );

    expect((query as Record<string, unknown>)["_id"]).toBeUndefined();

    const parts: RawParts = rawParts(
      (query as Record<string, unknown>)["incidentOwnerRuleId"],
    );

    expect(parts.sql).toContain('FROM "IncidentOwnerRule" r');
    expect(parts.sql).toContain('FROM "IncidentOwnerRuleOwningTeam" rto');
    expect(teamsBound(parts)).toEqual([TEAM_X.toString().toLowerCase()]);
  });

  test("a read, a create, and a caller who changes every rule are left alone", () => {
    const admin: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectAdmin, { teamId: TEAM_X }),
    ]);

    for (const [props, type] of [
      [platformMember, DatabaseRequestType.Read],
      [platformMember, DatabaseRequestType.Create],
      [admin, DatabaseRequestType.Update],
      [admin, DatabaseRequestType.Delete],
    ] as Array<[DatabaseCommonInteractionProps, DatabaseRequestType]>) {
      expect(
        TeamOwnedRulePermission.addTeamOwnedRuleScopeToQuery(
          IncidentOnCallRule,
          {} as Query<IncidentOnCallRule>,
          props,
          type,
        ),
      ).toEqual({});
    }
  });
});

describe("the rules a write may not touch", () => {
  test("owned by teams, none of them one granting the write", () => {
    const query: Query<BaseModel> | null =
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: IncidentOnCallRuleOwningTeam,
        ruleModelType: IncidentOnCallRule,
        ruleIds: [RULE_ID, "not an id"],
        props: memberWith([
          row(Permission.CreateIncidentOnCallRuleOwningTeam, {
            teamId: TEAM_Y,
          }),
        ]),
        type: DatabaseRequestType.Create,
      });

    const operators: Array<FindOperator<unknown>> = operatorsOf(
      (query as Record<string, unknown>)["_id"],
    );

    expect(operators).toHaveLength(2);

    const parts: RawParts = rawParts(operators[1]);

    expect(parts.sql).toContain(
      `COLUMN IN (SELECT r."_id" FROM "IncidentOnCallRule" r WHERE r."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "IncidentOnCallRuleOwningTeam" uot WHERE uot."incidentOnCallRuleId" = r."_id" AND uot."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "IncidentOnCallRuleOwningTeam" uto WHERE uto."incidentOnCallRuleId" = r."_id" AND uto."deletedAt" IS NULL AND uto."teamId" IN (:...`,
    );
    expect(teamsBound(parts)).toEqual([TEAM_Y.toString().toLowerCase()]);
  });

  test("nothing to find for a caller who changes every rule, a kind no team owns, or no id", () => {
    const admin: DatabaseCommonInteractionProps = memberWith([
      row(Permission.ProjectOwner, { teamId: TEAM_X }),
    ]);

    expect(
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: IncidentOnCallRule,
        ruleModelType: IncidentOnCallRule,
        ruleIds: [RULE_ID],
        props: admin,
        type: DatabaseRequestType.Update,
      }),
    ).toBeNull();
    expect(
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: Incident,
        ruleModelType: Incident,
        ruleIds: [RULE_ID],
        props: platformMember,
        type: DatabaseRequestType.Update,
      }),
    ).toBeNull();
    expect(
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: IncidentOnCallRule,
        ruleModelType: IncidentOnCallRule,
        ruleIds: ["not an id"],
        props: platformMember,
        type: DatabaseRequestType.Update,
      }),
    ).toBeNull();
  });

  test("a create under rules reads, as OneUptime, only the rules some teams own", async () => {
    const asked: Array<{ ids: Array<string>; query: Query<BaseModel> }> = [];

    const unreachable: Array<string> =
      await TeamOwnedRulePermission.getUnreachableParentIds({
        modelType: IncidentOnCallRuleOwningTeam,
        parentModelType: IncidentOnCallRule,
        parentIds: [RULE_ID],
        props: platformMember,
        type: DatabaseRequestType.Create,
        findIdsInProject: async (data: {
          ids: Array<string>;
          query: Query<BaseModel>;
        }): Promise<Array<string>> => {
          asked.push({ ids: data.ids, query: data.query });
          return data.ids;
        },
      });

    expect(unreachable).toEqual([RULE_ID]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.ids).toEqual([RULE_ID]);
  });

  test("the reasons name what to do", () => {
    expect(TeamOwnedRulePermission.TEAM_OWNED_WRITE_REASON).toContain(
      "Teams own it",
    );
    expect(
      TeamOwnedRulePermission.getOwnedParentWriteReason(
        "incident on-call rule",
      ),
    ).toContain("Teams own the incident on-call rule it belongs to");
  });
});
