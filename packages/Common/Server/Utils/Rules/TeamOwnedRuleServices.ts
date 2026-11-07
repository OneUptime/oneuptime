import AlertEpisodeOnCallRuleOwningTeamService from "../../Services/AlertEpisodeOnCallRuleOwningTeamService";
import AlertOnCallRuleOwningTeamService from "../../Services/AlertOnCallRuleOwningTeamService";
import IncidentEpisodeOnCallRuleOwningTeamService from "../../Services/IncidentEpisodeOnCallRuleOwningTeamService";
import IncidentOnCallRuleOwningTeamService from "../../Services/IncidentOnCallRuleOwningTeamService";
import IncidentOwnerRuleOwningTeamService from "../../Services/IncidentOwnerRuleOwningTeamService";
import WorkspaceNotificationRuleOwningTeamService from "../../Services/WorkspaceNotificationRuleOwningTeamService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../Services/DatabaseService";

/*
 * The service that keeps each kind's owning teams, by the table it keeps
 * them in (TEAM_OWNED_RULE_KINDS' owningTeamTable). Loaded on first use by
 * RuleOwningTeams: the services extend DatabaseService, which asks
 * RuleOwningTeams about every write, so it cannot import them as it loads.
 * TeamOwnedRuleKinds.test holds every kind to an entry here.
 */
const TEAM_OWNED_RULE_SERVICES: Readonly<
  Record<string, DatabaseService<BaseModel>>
> = {
  IncidentOnCallRuleOwningTeam:
    IncidentOnCallRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
  IncidentOwnerRuleOwningTeam:
    IncidentOwnerRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
  WorkspaceNotificationRuleOwningTeam:
    WorkspaceNotificationRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
  AlertOnCallRuleOwningTeam:
    AlertOnCallRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
  IncidentEpisodeOnCallRuleOwningTeam:
    IncidentEpisodeOnCallRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
  AlertEpisodeOnCallRuleOwningTeam:
    AlertEpisodeOnCallRuleOwningTeamService as unknown as DatabaseService<BaseModel>,
};

export default TEAM_OWNED_RULE_SERVICES;
