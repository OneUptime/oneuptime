import AddAggregationTemporalityToMetric from "./AddAggregationTemporalityToMetric";
import AddAttributeColumnToSpanAndLog from "./AddAttributesColumnToSpanAndLog";
import AddDefaultGlobalConfig from "./AddDefaultGlobalConfig";
import AddDowntimeMonitorStatusToStatusPage from "./AddDowntimeMonitorStatusToStatusPage";
import AddDurationColumnToSpanTable from "./AddDurationColumnToSpanTable";
import AddEndDateToIncidentStateTimeline from "./AddEndDateToIncidentStateTimeline";
import AddEndDateToMonitorStatusTimeline from "./AddEndDateToMonitorStatusTimeline";
import AddEndDateToMonitorStatusTimelineWhereEndDateIsMissing from "./AddEndDateToMonitorStatusTimelineWhereEndDateIsMissing";
import AddEndDateToScheduledEventsStateTimeline from "./AddEndDateToScheduledEventsStateTimeline";
import AddEndedState from "./AddEndedState";
import AddIsMonotonicToMetric from "./AddIsMonotonicToMetric";
import AddMonitoringDatesToMonitor from "./AddMonitoringDatesToMonitors";
import AddOwnerInfoToProjects from "./AddOwnerInfoToProject";
import AddPointTypeToMetric from "./AddPointTypeToMetric";
import AddPostedAtToPublicNotes from "./AddPostedAtToPublicNotes";
import AddSecretKeyToIncomingRequestMonitor from "./AddSecretKeyToIncomingRequestMonitor";
import AddStartDateToIncidentStateTimeline from "./AddStartDateToIncidentStateTimeline";
import AddStartDateToMonitorStatusTimeline from "./AddStartDateToMonitorStatusTimeline";
import AddStartDateToScheduledEventsStateTimeline from "./AddStartDateToScheduledEventsStateTimeline";
import AddTelemetryServiceColor from "./AddTelemetryServiceColor";
import AddUnitColumnToMetricsTable from "./AddUnitColumnToMetricsTable";
import ChangeLogSeverityColumnTypeFromTextToNumber from "./ChangeLogSeverityColumnTypeFromTextToNumber";
import ChangeMetricColumnTypeToDecimal from "./ChangeMetricColumnTypesToDecimal";
import DataMigrationBase from "./DataMigrationBase";
import GenerateNewCertsForStatusPage from "./GenerateNewCertsForStatusPage";
import MigrateDefaultUserNotificationRule from "./MigrateDefaultUserNotificationRule";
import MigrateDefaultUserNotificationSetting from "./MigrateDefaultUserSettingNotification";
import MigrateToMeteredSubscription from "./MigrateToMeteredSubscription";
import MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage from "./MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage";
import MoveGreenlockCertsToAcmeCerts from "./MoveGreenlockCertsToAcmeCerts";
import RemoveCanFromPermissions from "./RemoveCanFromPermissions";
import UpdateActiveMonitorCountToBillingProvider from "./UpdateActiveMonitorCountToBillingProvider";
import UpdateGlobalConfigFromEnv from "./UpdateGlobalCongfigFromEnv";
import MigrateServiceLanguageToTechStack from "./MigrateServiceLanguageToTechStack";
import DeleteOldTelemetryTable from "./DeleteOldTelelmetryTable";
import MoveTelemetryServiceTokenToTelemetryIngestionKey from "./MoveTelemetryServiceTokenToTelemetryIngestionKey";
import AddDefaultAlertSeverityAndStateToExistingProjects from "./AddDefaultAlertSeverityAndStateToExistingProjects";
import RefreshDefaultUserNotificationSetting from "./RefreshUserNotificationSetting";
import AddServiceTypeColumnToMetricsTable from "./AddServiceTypeColumnToMetricTable";
import AddIsSubscriptionConfirmedToSubscribers from "./AddIsSubscriptionConfirmedToSubscribers";
import AddIncidentNumber from "./AddIncidentNumber";
import RenameRuleTypeInUserNotificationRule from "./RenameRuleTypeInUserNotificationRule";
import AddSubscriberFooterTextToStatusPage from "./AddSubscriberFooterTextToStatusPage";
import AddAlertNumber from "./AddAlertNumber";
import AddScheduledMaintenanceNumber from "./AddScheduledMaintenanceNumber";

import UpdateRemiderDateInScheduledEvents from "./UpdateRemiderDateInScheduledEvents";
import AddAttributesColumnToTelemetryAttribute from "./AddAttributesColumnToTelemetryAttribute";
import DeleteAllTelemetryAttributes from "./DeleteAllTelemetryAttributes";
import DropDescriptionAndUnitColumnFromMetrics from "./DropDescriptionAndUnitColumnFromMetrics";
import RefreshOnCallSchedulesToAddCurrentUserOnRoster from "./RefreshOnCallSchedulesToAddCurrentUserOnRoster";
import AddOnCallNotificationForUsers from "./AddOnCallNotificationForUsers";
import StartOnCallUserTimeLog from "./StartOnCallUserTimeLog";
import LowercaseDomains from "./LowercaseDomains";
import AddAttributeKeysColumnToTelemetryTables from "./AddAttributeKeysColumnToTelemetryTables";
import AddDefaultIncidentRolesToExistingProjects from "./AddDefaultIncidentRolesToExistingProjects";
import AddDefaultIconsToIncidentRoles from "./AddDefaultIconsToIncidentRoles";

// This is the order in which the migrations will be run. Add new migrations to the end of the array.

const DataMigrations: Array<DataMigrationBase> = [
  new MigrateDefaultUserNotificationRule(),
  new AddOwnerInfoToProjects(),
  new MigrateDefaultUserNotificationSetting(),
  new MigrateToMeteredSubscription(),
  new UpdateActiveMonitorCountToBillingProvider(),
  new AddMonitoringDatesToMonitor(),
  new AddEndedState(),
  new AddDefaultGlobalConfig(),
  new UpdateGlobalConfigFromEnv(),
  new AddPostedAtToPublicNotes(),
  new MoveEnableSubscribersToEnableEmailSubscribersOnStatusPage(),
  new AddDowntimeMonitorStatusToStatusPage(),
  new AddEndDateToMonitorStatusTimeline(),
  new AddEndDateToScheduledEventsStateTimeline(),
  new AddEndDateToIncidentStateTimeline(),
  new AddStartDateToIncidentStateTimeline(),
  new AddStartDateToMonitorStatusTimeline(),
  new AddStartDateToScheduledEventsStateTimeline(),
  new AddDurationColumnToSpanTable(),
  new ChangeLogSeverityColumnTypeFromTextToNumber(),
  new AddAttributeColumnToSpanAndLog(),
  new AddSecretKeyToIncomingRequestMonitor(),
  new AddTelemetryServiceColor(),
  new MoveGreenlockCertsToAcmeCerts(),
  new GenerateNewCertsForStatusPage(),
  new AddEndDateToMonitorStatusTimelineWhereEndDateIsMissing(),
  new RemoveCanFromPermissions(),
  new AddUnitColumnToMetricsTable(),
  new ChangeMetricColumnTypeToDecimal(),
  new AddAggregationTemporalityToMetric(),
  new AddPointTypeToMetric(),
  new AddIsMonotonicToMetric(),
  new MigrateServiceLanguageToTechStack(),
  new DeleteOldTelemetryTable(),
  new MoveTelemetryServiceTokenToTelemetryIngestionKey(),
  new AddDefaultAlertSeverityAndStateToExistingProjects(),
  new RefreshDefaultUserNotificationSetting(),
  new AddServiceTypeColumnToMetricsTable(),
  new AddIsSubscriptionConfirmedToSubscribers(),
  new AddIncidentNumber(),
  new RenameRuleTypeInUserNotificationRule(),
  new AddSubscriberFooterTextToStatusPage(),
  new AddAlertNumber(),
  new AddScheduledMaintenanceNumber(),
  new UpdateRemiderDateInScheduledEvents(),
  new AddAttributesColumnToTelemetryAttribute(),
  new DeleteAllTelemetryAttributes(),
  new DropDescriptionAndUnitColumnFromMetrics(),
  new RefreshOnCallSchedulesToAddCurrentUserOnRoster(),
  new AddOnCallNotificationForUsers(),
  new StartOnCallUserTimeLog(),
  new LowercaseDomains(),
  new AddAttributeKeysColumnToTelemetryTables(),
  new AddDefaultIncidentRolesToExistingProjects(),
  new AddDefaultIconsToIncidentRoles(),
];

export default DataMigrations;
