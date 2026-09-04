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
import ConvertAnalyticsTablesToCluster from "./ConvertAnalyticsTablesToCluster";
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
import AddGorillaCodecToMetricValues from "./AddGorillaCodecToMetricValues";
import AddUInt64TimestampsToTelemetryV3 from "./AddUInt64TimestampsToTelemetryV3";
import AddUInt64ToRemainingTelemetryColumns from "./AddUInt64ToRemainingTelemetryColumns";
import DropUpdatedAtFromTelemetryTables from "./DropUpdatedAtFromTelemetryTables";
import AddEntityKeysToTelemetryTables from "./AddEntityKeysToTelemetryTables";
import AddScalarEntityKeysToTelemetryTables from "./AddScalarEntityKeysToTelemetryTables";
import MaterializeEntityKeysIndexOnTelemetryTables from "./MaterializeEntityKeysIndexOnTelemetryTables";
import AddZstdCodecToTelemetryIdColumns from "./AddZstdCodecToTelemetryIdColumns";
import AddTelemetryV3ColumnCodecs from "./AddTelemetryV3ColumnCodecs";
import RebuildMetricBaselineHourlyWithBFloat16Quantiles from "./RebuildMetricBaselineHourlyWithBFloat16Quantiles";
import AddDedupWindowToTelemetryTables from "./AddDedupWindowToTelemetryTables";
import DropUnusedTelemetryTables from "./DropUnusedTelemetryTables";
import RebuildMetricAggTablesMissingPrimaryEntityId from "./RebuildMetricAggTablesMissingPrimaryEntityId";
import DropPreclusteredAnalyticsBackupTables from "./DropPreclusteredAnalyticsBackupTables";
import AddAttributeKeysToExceptionInstance from "./AddAttributeKeysToExceptionInstance";
import AddMutableMetricTable from "./AddMutableMetricTable";
import AddInstanceIdToGlobalConfig from "./AddInstanceIdToGlobalConfig";
import AddMetricEntityMinuteAggregateMaterializedViews from "./AddMetricEntityMinuteAggregateMaterializedViews";
import CloseOrphanedMonitorStatusTimelineRows from "./CloseOrphanedMonitorStatusTimelineRows";
import MigrateMetricAggregatesToStrictSchema from "./MigrateMetricAggregatesToStrictSchema";
import AddInterfaceIndexColumnsToNetworkFlow from "./AddInterfaceIndexColumnsToNetworkFlow";
import AddShipmentColumnsToKubernetesCostAllocation from "./AddShipmentColumnsToKubernetesCostAllocation";
import AddRightSizingColumnsToKubernetesCostAllocation from "./AddRightSizingColumnsToKubernetesCostAllocation";
import MoveNetworkDeviceMonitorCollectionToDevices from "./MoveNetworkDeviceMonitorCollectionToDevices";
import BackfillNetworkSiteTypes from "./BackfillNetworkSiteTypes";
import BackfillNetworkDeviceRoles from "./BackfillNetworkDeviceRoles";
import AddSessionIdToTelemetryTables from "./AddSessionIdToTelemetryTables";
import AddScheduledMaintenanceTemplateOwnerPermissions from "./AddScheduledMaintenanceTemplateOwnerPermissions";
import RepairEpisodeNotificationRuleSeverity from "./RepairEpisodeNotificationRuleSeverity";
import BackfillMonitorBackedDeviceStatus from "./BackfillMonitorBackedDeviceStatus";
import AddShiftReminderNotificationSettingsForUsers from "./AddShiftReminderNotificationSettingsForUsers";
import BackfillNetworkSiteTypeParents from "./BackfillNetworkSiteTypeParents";
import BackfillMonitorBackedDeviceReachability from "./BackfillMonitorBackedDeviceReachability";
import NormalizeNetworkDeviceMonitoringMethod from "./NormalizeNetworkDeviceMonitoringMethod";

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
   *   - AddZstdCodecToTelemetryIdColumns runs before the baseline rebuild so
   *     it never touches the table that one drops and recreates.
   *
   * There is deliberately NO V2 -> V3 historical data copy in this chain:
   * the cut is forward-only and operators carry history forward manually
   * if they want it (App/FeatureSet/Docs/Content/en/installation/upgrading.md ('Upgrading from OneUptime 10 → 11')).
   */
  new AddScalarEntityKeysToTelemetryTables(),
  new MaterializeEntityKeysIndexOnTelemetryTables(),
  new AddZstdCodecToTelemetryIdColumns(),
  new AddTelemetryV3ColumnCodecs(),
  new RebuildMetricBaselineHourlyWithBFloat16Quantiles(),
  new AddDedupWindowToTelemetryTables(),
  /*
   * Ordered after MigrateTelemetryToV3PrimaryEntityId: the pre-V3 tables
   * must already be superseded (never the live generation) when they are
   * dropped. Operators who want the optional V2 history copy rename the
   * tables to `…_backup` BEFORE upgrading (see the v11 upgrade guide).
   */
  new DropUnusedTelemetryTables(),
  /*
   * Repairs MetricItemAggMV1m / MetricBaselineHourly on installs that
   * drifted across the V3 cut and never gained `primaryEntityId` (the
   * earlier rebuild guards key off proxy signals, not the column itself).
   * Gated on the real column, so it is a clean no-op on healthy installs.
   * Ordered last: it depends only on the current models, and the targets
   * must already be the live V3 generation by the time it runs.
   */
  new RebuildMetricAggTablesMissingPrimaryEntityId(),
  /*
   * Reclaims the `<table>_preclustered` ClickHouse backups left by a single-node
   * -> cluster conversion (the boot schema-sync renames the legacy table aside
   * before swapping in the Distributed wrapper). Telemetry history is forward-only
   * across the conversion, so the abandoned backups are dropped to free their
   * disk rather than left as a standing "un-backfilled history" warning. A clean
   * no-op on installs that never converted. Ordered right before the conversion
   * migration; both run after every schema migration is already in place.
   */
  new AddAttributeKeysToExceptionInstance(),
  new DropPreclusteredAnalyticsBackupTables(),
  new AddMutableMetricTable(),
  /*
   * Backfills GlobalConfig.instanceId — the unique, auto-generated identifier
   * for this OneUptime install. New installs get one from
   * AddDefaultGlobalConfig; this covers installs created before the column
   * existed. No-op when already set.
   */
  new AddInstanceIdToGlobalConfig(),
  /*
   * Cluster conversion. Runs only when CLICKHOUSE_CLUSTER_NAME is set (a no-op
   * otherwise) and after every legacy ClickHouse migration has been baselined,
   * so the analytics tables are at their current model schema before being
   * converted in place to the sharded + replicated (Distributed over local
   * ReplicatedMergeTree) layout. Must stay after every legacy (baselined)
   * ClickHouse migration; only cluster-correct migrations that depend on the
   * converted layout (like the rollup backfill below) may follow it.
   */
  new ConvertAnalyticsTablesToCluster(),
  /*
   * Backfills the per-entity (service / k8s cluster / container) metric
   * minute rollups from MetricItemV3. Table + MV creation is owned by the
   * models + boot schema-sync (which runs before migrations), so this can
   * safely assume the raw table and the model definitions exist. Fully
   * cluster-correct (ON CLUSTER DDL, local-table TRUNCATE, cluster MV
   * recreation) and ordered AFTER the cluster conversion so the MV layer
   * has already been reconciled to the clustered layout before this drops,
   * backfills and re-attaches the per-entity rollup triggers.
   */
  new AddMetricEntityMinuteAggregateMaterializedViews(),
  /*
   * Closes the MonitorStatusTimeline rows orphaned with `endsAt = NULL` by the
   * concurrent double-INSERT race (67,498 rows across 410 monitors / 124
   * projects). These orphans are what render as months of phantom downtime on
   * status page uptime reports, because the timeline query applies no lower date
   * bound to open rows. Batched, restartable and idempotent.
   */
  new CloseOrphanedMonitorStatusTimelineRows(),
  /*
   * ClickHouse 26.7 enforces AggregatingMergeTree semantics at CREATE time.
   * Remove meaningless synthetic dimensions from metric aggregate targets,
   * turn retentionDate into a max SimpleAggregateFunction measure, and retire
   * the temporary allow_dimensions_outside_sorting_key compatibility setting.
   * Ordered last because it is cluster-aware and depends on the final
   * model-owned metric target tables/materialized views.
   */
  new MigrateMetricAggregatesToStrictSchema(),
  /*
   * Adds inputInterfaceIndex / outputInterfaceIndex to NetworkFlow so flow
   * records can be attributed to the interfaces they crossed. Existing
   * rows read back 0 ("unknown"). Idempotent: skips columns that exist.
   */
  new AddInterfaceIndexColumnsToNetworkFlow(),
  /*
   * Device-owned polling: copies collection options (interface walks,
   * endpoint collection, health OIDs) from Network Device monitor steps
   * onto the referenced devices, and deletes those monitors' MonitorProbe
   * rows so probes stop executing them. Idempotent: union/merge writes and
   * already-deleted rows are no-ops on re-run.
   */
  new MoveNetworkDeviceMonitorCollectionToDevices(),
  /*
   * Site types became a per-project lookup table (NetworkSiteType) instead of a
   * hardcoded enum. Seeds the default types into every existing project and
   * points each site's networkSiteTypeId at the type matching its legacy
   * siteType string (creating a type for any string the project has no match
   * for). This is the only code that reads the deprecated NetworkSite.siteType
   * column, which a follow-up PR drops. Idempotent: only sites still missing a
   * networkSiteTypeId are touched.
   */
  new BackfillNetworkSiteTypes(),
  /*
   * Adds shipmentId / shipmentChunk to KubernetesCostAllocation so the cost
   * ingest can tell one agent delivery of a window from another, instead of
   * dropping every request after the first on clusters whose hourly rows
   * exceed the agent's batch size. Existing rows read back "" / 0 and keep
   * the original whole-window behaviour. Idempotent: skips columns that
   * exist.
   */
  new AddShipmentColumnsToKubernetesCostAllocation(),
  /*
   * Adds cpuCoreLimitAverage / ramBytesLimitAverage / ramBytesUsageMax so
   * right-sizing has limits and a true memory peak to work from, rather than
   * only the window averages the cost engine reports. Existing rows read
   * back 0, which consumers must treat as "unknown". Idempotent: skips
   * columns that exist.
   */
  new AddRightSizingColumnsToKubernetesCostAllocation(),
  /*
   * Adds the sessionId correlation column to Log / Span / ExceptionInstance
   * so a session replay can be joined to the telemetry it produced.
   * Metadata-only, no backfill: historical rows read "" by design. Skips a
   * table whose model does not declare the column rather than throwing,
   * because a throw here halts every migration after it.
   */
  new AddSessionIdToTelemetryTables(),
  /*
   * Backfills grants onto the two ScheduledMaintenanceTemplate owner Create
   * permissions, whose enum values used to collide with their non-template
   * counterparts. Copies rather than renames, so no existing grant changes
   * meaning; block rows are copied too so a deliberate denial does not become
   * silent access.
   */
  new AddScheduledMaintenanceTemplateOwnerPermissions(),
  /*
   * Repairs the episode notification rules that were created with a NULL severity and so
   * matched nothing the on-call path ever queried — the reason users who relied on the
   * auto-created defaults received no alert-episode or incident-episode pages at all.
   * Fans each NULL row out into one row per severity in its project (preserving the
   * notification method and notifyAfterMinutes) and removes the original, which is both
   * unreachable by the severity-filtered count query and invisible on the two episode
   * rule pages. Idempotent and restartable, so a re-run is a clean no-op.
   */
  new RepairEpisodeNotificationRuleSeverity(),
  /*
   * Stamps the bound monitor's current status onto monitor-backed network
   * devices that never got one. Until the binding itself started stamping,
   * the column was only ever written by a monitor's next status CHANGE — so
   * a ping-only device bound to a monitor that was already Up sat on
   * "Pending" indefinitely (OneUptime/oneuptime#3392). Idempotent: the stamp
   * is re-derived from the binding and only written when it disagrees.
   */
  new BackfillMonitorBackedDeviceStatus(),
  /*
   * Backfills the two on-call shift-reminder notification settings ("before
   * my shift starts", "my upcoming shift is reassigned") for every existing
   * project member. sendUserNotification sends nothing without a settings
   * row and the defaults are only written on project join, so without this
   * a pre-existing user's configured reminder lead times would silently
   * never fire. Idempotent count-then-create per (user, project, event).
   */
  new AddShiftReminderNotificationSettingsForUsers(),
  /*
   * Device roles became a per-project lookup table (NetworkDeviceRole) instead
   * of a fixed union with the label, the shape and the core-layer flag
   * hardcoded in three modules. Seeds the default roles into every existing
   * project and points each device's networkDeviceRoleId at the role matching
   * its legacy deviceRole string (creating a role for any key the project has
   * no match for). This is the only code that reads the deprecated
   * NetworkDevice.deviceRole column, which a follow-up PR drops. Idempotent:
   * only devices still missing a networkDeviceRoleId are touched, and an empty
   * legacy value is skipped because it never meant a role in the first place.
   */
  new BackfillNetworkDeviceRoles(),
  /*
   * Replaces Network Site Type's ambiguous numeric hierarchy position with an
   * explicit parent. Existing site trees supply the relationship when they
   * agree; unused seeded defaults use the same hierarchy as new projects.
   * Conflicting legacy layouts are logged and left for explicit admin choice.
   */
  new BackfillNetworkSiteTypeParents(),
  /*
   * Keeps `isReachable` on monitor-backed network devices in line with the
   * bound monitor (the device list's summary tiles and Status facet count
   * and filter on that column alone, so those devices read "Pending" there
   * whatever their monitor said) and clears the poll residue a device
   * switched over from SNMP still carried. Walks every monitor-backed
   * device, bound or not, in id-ordered pages. Idempotent: the reset writes
   * NULLs and the re-stamp is re-derived from the binding.
   */
  new BackfillMonitorBackedDeviceReachability(),
  /*
   * Ping-first polling renamed the probe-polled monitoring method from "SNMP"
   * to "Probe": the assigned probe pings every device it is given and walks
   * it over SNMP only when credentials exist. Every runtime reader already
   * parses NULL, "", "SNMP" and anything unrecognised as Probe, so nothing
   * misbehaves on the old rows — this makes the column SAY what it means,
   * for the raw SQL that filters on it (claimDevicesForPolling, the device
   * facets) and for anyone reading the table. Monitor-backed devices are
   * left monitor-backed (a "monitor" spelling is normalised to "Monitor");
   * none is converted to Probe, because their probeId was never set.
   * Id-paged over the whole fleet, idempotent: canonical rows are untouched.
   */
  new NormalizeNetworkDeviceMonitoringMethod(),
];

export default DataMigrations;
