import ProductKey from "../../../../../Types/Product/ProductKey";
import MicrosoftTeamsHome, {
  MicrosoftTeamsHomeActionType,
} from "../MicrosoftTeamsHome";
import MicrosoftTeamsPage from "../MicrosoftTeamsPage";
import MicrosoftTeamsAlertActions from "./Alert";
import MicrosoftTeamsAlertEpisodeActions from "./AlertEpisode";
import MicrosoftTeamsIncidentActions from "./Incident";
import MicrosoftTeamsIncidentEpisodeActions from "./IncidentEpisode";
import MicrosoftTeamsIncidentMoreActions from "./IncidentMoreActions";
import MicrosoftTeamsMonitorActions from "./Monitor";
import MicrosoftTeamsOnCallDutyActions from "./OnCallDutyPolicy";
import MicrosoftTeamsScheduledMaintenanceActions from "./ScheduledMaintenance";

/*
 * The product a Microsoft Teams button or card acts in (#7479): what the
 * bot answers with "switched off on this server" while the server has
 * switched it off (WorkspaceProductRefusal), before the press reaches the
 * product's handler. The Home's buttons act in theirs: Declare incident in
 * Incidents, Page someone and Who is on call in On-Call. Null for a press
 * of no one product: a project's choice, the Home's Refresh, a public
 * note's approval (its record's product decides, at the write) and a fix
 * OneUptime AI proposes.
 */
export const getProductOfMicrosoftTeamsAction: (
  actionType: string | undefined,
) => ProductKey | null = (
  actionType: string | undefined,
): ProductKey | null => {
  if (!actionType) {
    return null;
  }

  if (MicrosoftTeamsHome.isHomeAction(actionType)) {
    switch (actionType as MicrosoftTeamsHomeActionType) {
      case MicrosoftTeamsHomeActionType.DeclareIncident:
        return ProductKey.Incidents;
      case MicrosoftTeamsHomeActionType.PageSomeone:
      case MicrosoftTeamsHomeActionType.WhoIsOnCall:
        return ProductKey.OnCall;
      default:
        return null;
    }
  }

  if (
    MicrosoftTeamsIncidentActions.isIncidentAction({ actionType }) ||
    MicrosoftTeamsIncidentMoreActions.isAction(actionType) ||
    MicrosoftTeamsIncidentEpisodeActions.isIncidentEpisodeAction({
      actionType,
    })
  ) {
    return ProductKey.Incidents;
  }

  if (
    MicrosoftTeamsAlertActions.isAlertAction({ actionType }) ||
    MicrosoftTeamsAlertEpisodeActions.isAlertEpisodeAction({ actionType })
  ) {
    return ProductKey.Alerts;
  }

  if (
    MicrosoftTeamsPage.isPageAction(actionType) ||
    MicrosoftTeamsOnCallDutyActions.isOnCallDutyAction({ actionType })
  ) {
    return ProductKey.OnCall;
  }

  if (MicrosoftTeamsMonitorActions.isMonitorAction({ actionType })) {
    return ProductKey.Monitors;
  }

  if (
    MicrosoftTeamsScheduledMaintenanceActions.isScheduledMaintenanceAction({
      actionType,
    })
  ) {
    return ProductKey.ScheduledMaintenance;
  }

  return null;
};
