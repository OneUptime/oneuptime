import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import IconProp from "Common/Types/Icon/IconProp";

export type GetSloFeedEventIconFunction = (
  eventType: string,
) => IconProp | undefined;

/*
 * Icons for the SLO feed's own events, handed to ResourceFeed as `getIcon`.
 *
 * Only what the shared suffix rules cannot express is mapped here. Created /
 * Updated / Archived / Restored and the four owner events return undefined on
 * purpose, so the SLO feed draws them exactly like every other resource feed.
 * Everything else would otherwise fall through to the anonymous dot - a
 * status change, a burn rate alert and a detached monitor all looking alike.
 *
 * Kept free of React so the mapping can be pinned exhaustively against the
 * enum in a plain test.
 */
export const getSloFeedEventIcon: GetSloFeedEventIconFunction = (
  eventType: string,
): IconProp | undefined => {
  switch (eventType) {
    case ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveEnabled:
      return IconProp.Play;
    case ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveDisabled:
      return IconProp.Pause;
    case ServiceLevelObjectiveFeedEventType.StatusChanged:
      // Same icon the monitor and incident feeds use for a state change.
      return IconProp.ArrowCircleRight;
    case ServiceLevelObjectiveFeedEventType.BurnRateAlertRaised:
      return IconProp.ExclaimationCircle;
    case ServiceLevelObjectiveFeedEventType.BurnRateIncidentDeclared:
      return IconProp.Alert;
    case ServiceLevelObjectiveFeedEventType.BurnRateAlertResolved:
    case ServiceLevelObjectiveFeedEventType.BurnRateIncidentResolved:
      return IconProp.CheckCircle;
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleAdded:
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleChanged:
    case ServiceLevelObjectiveFeedEventType.BurnRateRuleRemoved:
      // The burn rate rules page's own side menu icon.
      return IconProp.Fire;
    case ServiceLevelObjectiveFeedEventType.MonitorRuleAdded:
    case ServiceLevelObjectiveFeedEventType.MonitorRuleChanged:
    case ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved:
      // The monitor rules page's own side menu icon.
      return IconProp.Filter;
    case ServiceLevelObjectiveFeedEventType.MonitorsAttached:
      return IconProp.Link;
    case ServiceLevelObjectiveFeedEventType.MonitorsDetached:
      return IconProp.LinkSlash;
    default:
      return undefined;
  }
};

export default getSloFeedEventIcon;
