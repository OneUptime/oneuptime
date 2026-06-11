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
import AddServiceTypeColumnToTelemetryTables from "./AddServiceTypeColumnToTelemetryTables";
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
import UpdateObserverRoleToAllowMultipleUsers from "./UpdateObserverRoleToAllowMultipleUsers";
import AddColumnsToExceptionInstance from "./AddColumnsToExceptionInstance";
import AddTraceIdAndSpanIdToMetricTable from "./AddTraceIdAndSpanIdToMetricTable";
import AddIsRootSpanToSpanTable from "./AddIsRootSpanToSpanTable";
import AddHistogramProjectionToSpanTable from "./AddHistogramProjectionToSpanTable";
import AddExponentialHistogramAndSummaryColumnsToMetric from "./AddExponentialHistogramAndSummaryColumnsToMetric";
import ChangeExplicitBoundsToFloat64 from "./ChangeExplicitBoundsToFloat64";
import AddMetricMinuteAggregateMaterializedView from "./AddMetricMinuteAggregateMaterializedView";
import RebuildMetricMinuteAggregateMaterializedView from "./RebuildMetricMinuteAggregateMaterializedView";
import AddAttributeKeysSkipIndexToTelemetryTables from "./AddAttributeKeysSkipIndexToTelemetryTables";
import AddMetricMinuteAggregateByHostMaterializedView from "./AddMetricMinuteAggregateByHostMaterializedView";
import AddMetricBaselineHourlyMV from "./AddMetricBaselineHourlyMV";
import AddIdAndTimestampsToMVTargetTables from "./AddIdAndTimestampsToMVTargetTables";
import ExtendMetricBaselineHourlyTTL from "./ExtendMetricBaselineHourlyTTL";
import AddTelemetryStorageCompression from "./AddTelemetryStorageCompression";
import MigrateTelemetryToV3PrimaryEntityId from "./MigrateTelemetryToV3PrimaryEntityId";
import AddTtlOnlyDropPartsToTelemetryV3 from "./AddTtlOnlyDropPartsToTelemetryV3";
import MigrateMonitorAndAuditLogToV3 from "./MigrateMonitorAndAuditLogToV3";
import AddGorillaCodecToMetricValues from "./AddGorillaCodecToMetricValues";
import AddUInt64TimestampsToTelemetryV3 from "./AddUInt64TimestampsToTelemetryV3";
import AddUInt64ToRemainingTelemetryColumns from "./AddUInt64ToRemainingTelemetryColumns";
import DropUpdatedAtFromTelemetryTables from "./DropUpdatedAtFromTelemetryTables";
import AddEntityKeysToTelemetryTables from "./AddEntityKeysToTelemetryTables";
import AddScalarEntityKeysToTelemetryTables from "./AddScalarEntityKeysToTelemetryTables";
import MaterializeEntityKeysIndexOnTelemetryTables from "./MaterializeEntityKeysIndexOnTelemetryTables";
import AddZstdCodecToTelemetryIdColumns from "./AddZstdCodecToTelemetryIdColumns";
import AddTelemetryV3ColumnCodecs from "./AddTelemetryV3ColumnCodecs";
import RekeyMetricHostRollupToEntityKey from "./RekeyMetricHostRollupToEntityKey";
import RebuildMetricBaselineHourlyWithBFloat16Quantiles from "./RebuildMetricBaselineHourlyWithBFloat16Quantiles";
import AddDedupWindowToTelemetryTables from "./AddDedupWindowToTelemetryTables";

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
  new UpdateObserverRoleToAllowMultipleUsers(),
  new AddColumnsToExceptionInstance(),
  new AddTraceIdAndSpanIdToMetricTable(),
  new AddIsRootSpanToSpanTable(),
  new AddHistogramProjectionToSpanTable(),
  new AddExponentialHistogramAndSummaryColumnsToMetric(),
  new ChangeExplicitBoundsToFloat64(),
  new AddMetricMinuteAggregateMaterializedView(),
  new RebuildMetricMinuteAggregateMaterializedView(),
  new AddAttributeKeysSkipIndexToTelemetryTables(),
  new AddMetricMinuteAggregateByHostMaterializedView(),
  new AddMetricBaselineHourlyMV(),
  new AddIdAndTimestampsToMVTargetTables(),
  new ExtendMetricBaselineHourlyTTL(),
  new AddServiceTypeColumnToTelemetryTables(),
  new AddTelemetryStorageCompression(),
  new MigrateTelemetryToV3PrimaryEntityId(),
  new AddTtlOnlyDropPartsToTelemetryV3(),
  new MigrateMonitorAndAuditLogToV3(),
  new AddGorillaCodecToMetricValues(),
  new AddUInt64TimestampsToTelemetryV3(),
  new AddUInt64ToRemainingTelemetryColumns(),
  new DropUpdatedAtFromTelemetryTables(),
  new AddEntityKeysToTelemetryTables(),
  /*
   * ClickHouse storage hardening — ordering constraints:
   *   - All of these need the V3 tables (MigrateTelemetryToV3PrimaryEntityId)
   *     and the MV-target _id columns (AddIdAndTimestampsToMVTargetTables).
   *   - MaterializeEntityKeysIndexOnTelemetryTables needs idx_entity_keys
   *     (AddEntityKeysToTelemetryTables, directly above).
   *   - RekeyMetricHostRollupToEntityKey needs the hostEntityKey scalar
   *     column (AddScalarEntityKeysToTelemetryTables) — its MV reads it.
   *   - AddZstdCodecToTelemetryIdColumns runs before the re-key/rebuild so
   *     it never touches the tables those two drop and recreate.
   */
  new AddScalarEntityKeysToTelemetryTables(),
  new MaterializeEntityKeysIndexOnTelemetryTables(),
  new AddZstdCodecToTelemetryIdColumns(),
  new AddTelemetryV3ColumnCodecs(),
  new RekeyMetricHostRollupToEntityKey(),
  new RebuildMetricBaselineHourlyWithBFloat16Quantiles(),
  new AddDedupWindowToTelemetryTables(),
];

export default DataMigrations;
