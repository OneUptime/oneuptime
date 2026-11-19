import ProductKey from "../../../../../Types/Product/ProductKey";
import SlackActionType from "./ActionTypes";
import SlackAlertActions from "./Alert";
import SlackAlertEpisodeActions from "./AlertEpisode";
import SlackIncidentActions from "./Incident";
import SlackIncidentEpisodeActions from "./IncidentEpisode";
import SlackMonitorActions from "./Monitor";
import SlackOnCallDutyActions from "./OnCallDutyPolicy";
import SlackPageActions from "./Page";
import SlackScheduledMaintenanceActions from "./ScheduledMaintenance";

/*
 * The product a Slack button, form or command acts in (#7479): what the
 * app answers with "switched off on this server" while the server has
 * switched it off (WorkspaceProductRefusal), before the press reaches the
 * product's handler. Null for a press of no one product: a project's
 * choice, the Home's menu, a link button, a public note's approval (its
 * record's product decides, at the write) and a fix OneUptime AI proposes.
 */
export const getProductOfSlackAction: (
  actionType: SlackActionType | undefined,
) => ProductKey | null = (
  actionType: SlackActionType | undefined,
): ProductKey | null => {
  if (!actionType) {
    return null;
  }

  if (
    SlackIncidentActions.isIncidentAction({ actionType }) ||
    SlackIncidentEpisodeActions.isIncidentEpisodeAction({ actionType })
  ) {
    return ProductKey.Incidents;
  }

  if (
    SlackAlertActions.isAlertAction({ actionType }) ||
    SlackAlertEpisodeActions.isAlertEpisodeAction({ actionType })
  ) {
    return ProductKey.Alerts;
  }

  if (
    actionType === SlackActionType.ShowOnCall ||
    SlackPageActions.isPageAction({ actionType }) ||
    SlackOnCallDutyActions.isOnCallDutyAction({ actionType })
  ) {
    return ProductKey.OnCall;
  }

  if (SlackMonitorActions.isMonitorAction({ actionType })) {
    return ProductKey.Monitors;
  }

  if (
    SlackScheduledMaintenanceActions.isScheduledMaintenanceAction({
      actionType,
    })
  ) {
    return ProductKey.ScheduledMaintenance;
  }

  return null;
};
