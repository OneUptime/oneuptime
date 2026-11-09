import Permission from "../Permission";

/*
 * THE KINDS OF RULE A TEAM CAN OWN - the incident and alert on-call rules
 * and their episodes', the incident owner rules and the workspace (Slack
 * and Microsoft Teams) notification rules - with the table their owning
 * teams are kept in and the key those rows name the rule by.
 *
 * A rule no team owns is the project's: everyone who may change rules of its
 * kind changes it. A rule one or more teams own is changed and deleted only
 * with the permissions of the teams that own it - a member of an owning team
 * acts on it with that team's permissions, never another team's - and by the
 * project's owners and admins (Server/Types/Database/Permissions
 * /TeamOwnedRulePermission). Everyone who may read rules of its kind still
 * reads it: an oversight team sees what the other teams' rules do.
 *
 * The owning-team rows are parts of the rule: adding or removing an owning
 * team of a rule that has one is changing the rule, so only the teams that
 * own it - and the project's owners and admins - do it. A rule no team owns
 * is given its first owning team by whoever may add one.
 *
 * Not the owners of the Owned permission scope (OwnerTableRegistry, the
 * <Resource>OwnerUser and <Resource>OwnerTeam tables): those say whose
 * records a grant scoped to Owned reaches, these who may change a rule.
 * Hence the name of the tables, <Rule>OwningTeam - IncidentOwnerRuleOwnerTeam
 * is already the list of teams an incident owner rule makes owners of the
 * incidents it matches.
 *
 * Shared with the dashboard, which locks a rule's Edit and Delete for whoever
 * would be refused (TeamOwnedRuleHeld). TeamOwnedRuleKinds.test holds each
 * entry to the models: every <Rule>OwningTeam model is listed, with its rule
 * and the key column it names the rule by.
 */
export interface TeamOwnedRuleKind {
  // The rule's table, and its model's name: "IncidentOnCallRule".
  tableName: string;
  // The table of its owning teams: "IncidentOnCallRuleOwningTeam".
  owningTeamTable: string;
  // The key the owning-team rows name the rule by: "incidentOnCallRuleId".
  ruleKey: string;
}

export const TEAM_OWNED_RULE_KINDS: ReadonlyArray<TeamOwnedRuleKind> = [
  {
    tableName: "IncidentOnCallRule",
    owningTeamTable: "IncidentOnCallRuleOwningTeam",
    ruleKey: "incidentOnCallRuleId",
  },
  {
    tableName: "IncidentOwnerRule",
    owningTeamTable: "IncidentOwnerRuleOwningTeam",
    ruleKey: "incidentOwnerRuleId",
  },
  {
    tableName: "WorkspaceNotificationRule",
    owningTeamTable: "WorkspaceNotificationRuleOwningTeam",
    ruleKey: "workspaceNotificationRuleId",
  },
  {
    tableName: "AlertOnCallRule",
    owningTeamTable: "AlertOnCallRuleOwningTeam",
    ruleKey: "alertOnCallRuleId",
  },
  {
    tableName: "IncidentEpisodeOnCallRule",
    owningTeamTable: "IncidentEpisodeOnCallRuleOwningTeam",
    ruleKey: "incidentEpisodeOnCallRuleId",
  },
  {
    tableName: "AlertEpisodeOnCallRule",
    owningTeamTable: "AlertEpisodeOnCallRuleOwningTeam",
    ruleKey: "alertEpisodeOnCallRuleId",
  },
];

/*
 * Who changes every team-owned rule of a project, whichever teams own it:
 * its owners and admins, over the whole project - the people who also see
 * every private incident (PRIVATE_RECORD_BYPASS_PERMISSIONS).
 */
export const ACTING_ON_EVERY_TEAM_OWNED_RULE: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

export default class TeamOwnedRuleKinds {
  // The kind of a rule's table: "IncidentOnCallRule". Null for any other.
  public static getKindOfRule(
    tableName: string | null | undefined,
  ): TeamOwnedRuleKind | null {
    if (!tableName) {
      return null;
    }

    return (
      TEAM_OWNED_RULE_KINDS.find((kind: TeamOwnedRuleKind): boolean => {
        return kind.tableName === tableName;
      }) || null
    );
  }

  /*
   * The kind whose owning teams a table keeps: "IncidentOnCallRuleOwningTeam"
   * is IncidentOnCallRule's. Null for any other table.
   */
  public static getKindOfOwningTeams(
    tableName: string | null | undefined,
  ): TeamOwnedRuleKind | null {
    if (!tableName) {
      return null;
    }

    return (
      TEAM_OWNED_RULE_KINDS.find((kind: TeamOwnedRuleKind): boolean => {
        return kind.owningTeamTable === tableName;
      }) || null
    );
  }
}
