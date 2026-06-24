// Announcements.
import "./Jobs/Announcement/SendNotificationToSubscribers";
// Hard Delete
import "./Jobs/HardDelete/HardDeleteItemsInDatabase";
// Incidents
import "./Jobs/Incident/SendNotificationToSubscribers";
import "./Jobs/Incident/SendPostmortemNotificationToSubscribers";
import "./Jobs/Incident/KeepCurrentStateConsistent";

// Incident Owners
import "./Jobs/IncidentOwners/SendCreatedResourceNotification";
import "./Jobs/IncidentOwners/SendNotePostedNotification";
import "./Jobs/IncidentOwners/SendOwnerAddedNotification";
import "./Jobs/IncidentOwners/SendStateChangeNotification";

// Incident Members
import "./Jobs/IncidentMembers/SendMemberAddedNotification";

// Incident SLA
import "./Jobs/IncidentSla/CheckSlaBreaches";
import "./Jobs/IncidentSla/SendNoteReminders";

// Monitor Jobs.
import "./Jobs/Monitor/KeepCurrentStateConsistent";

// Alert Owners
import "./Jobs/AlertOwners/SendCreatedResourceNotification";
import "./Jobs/AlertOwners/SendNotePostedNotification";
import "./Jobs/AlertOwners/SendOwnerAddedNotification";
import "./Jobs/AlertOwners/SendStateChangeNotification";
import "./Jobs/Alert/KeepCurrentStateConsistent";

// Alert Episodes
import "./Jobs/AlertEpisode/AutoResolve";
import "./Jobs/AlertEpisode/ResolveInactiveEpisodes";

// Alert Episode Owners
import "./Jobs/AlertEpisodeOwners/SendAlertAddedNotification";
import "./Jobs/AlertEpisodeOwners/SendCreatedResourceNotification";
import "./Jobs/AlertEpisodeOwners/SendNotePostedNotification";
import "./Jobs/AlertEpisodeOwners/SendOwnerAddedNotification";
import "./Jobs/AlertEpisodeOwners/SendStateChangeNotification";

// Incident Episodes
import "./Jobs/IncidentEpisode/AutoResolve";
import "./Jobs/IncidentEpisode/ResolveInactiveEpisodes";
import "./Jobs/IncidentEpisode/SendNotificationToSubscribers";

// Incident Episode State Timeline
import "./Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers";

// Incident Episode Public Notes
import "./Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers";

// Incident Episode Owners
import "./Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification";
import "./Jobs/IncidentEpisodeOwners/SendIncidentAddedNotification";
import "./Jobs/IncidentEpisodeOwners/SendNotePostedNotification";
import "./Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification";
import "./Jobs/IncidentEpisodeOwners/SendStateChangeNotification";

// Incident Notes
import "./Jobs/IncidentPublicNote/SendNotificationToSubscribers";
import "./Jobs/IncidentStateTimeline/SendNotificationToSubscribers";
import "./Jobs/IncomingRequestMonitor/CheckHeartbeat";
import "./Jobs/IncomingEmailMonitor/CheckOnlineStatus";
import "./Jobs/MeteredPlan/ReportTelemetryMeteredPlan";

// Monitor Owners
import "./Jobs/MonitorOwners/SendCreatedResourceNotification";
import "./Jobs/MonitorOwners/SendOwnerAddedNotification";
import "./Jobs/MonitorOwners/SendStatusChangeNotification";
// On-Call Duty Policy Executions.
import "./Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";
import "./Jobs/OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions";
// Payments.
import "./Jobs/PaymentProvider/CheckSubscriptionStatus";
import "./Jobs/PaymentProvider/PopulatePlanNameInProject";
import "./Jobs/PaymentProvider/UpdateTeamMembersIfNull";
import "./Jobs/ScheduledMaintenance/ChangeStateToEnded";

// Scheduled Event
import "./Jobs/ScheduledMaintenance/ChangeStateToOngoing";
import "./Jobs/ScheduledMaintenance/SendNotificationToSubscribers";
import "./Jobs/ScheduledMaintenance/ScheduleRecurringEvents";
import "./Jobs/ScheduledMaintenance/SendSubscriberRemindersOnEventScheduled";
import "./Jobs/ScheduledMaintenance/KeepCurrentStateConsistent";

// Scheduled Event Owners
import "./Jobs/ScheduledMaintenanceOwners/SendCreatedResourceNotification";
import "./Jobs/ScheduledMaintenanceOwners/SendNotePostedNotification";
import "./Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification";
import "./Jobs/ScheduledMaintenanceOwners/SendStateChangeNotification";

// Scheduled Event Notes
import "./Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers";
import "./Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers";

import "./Jobs/ServerMonitor/CheckOnlineStatus";

// // Certs Routers
import "./Jobs/StatusPageCerts/StatusPageCerts";
import "./Jobs/CoreSsl/ProvisionPrimaryDomain";

// Status Page Announcements
import "./Jobs/StatusPageOwners/SendAnnouncementCreatedNotification";

// Status Page Owners
import "./Jobs/StatusPageOwners/SendCreatedResourceNotification";
import "./Jobs/StatusPageOwners/SendOwnerAddedNotification";

// Status Page Reports
import "./Jobs/StatusPage/SendReportsToSubscribers";

// Workspace Notification Summaries
import "./Jobs/WorkspaceNotificationSummary/SendSummary";

// User Notifications Log
import "./Jobs/UserOnCallLog/ExecutePendingExecutions";
import "./Jobs/UserOnCallLog/TimeoutStuckExecutions";
import "./Jobs/Workflow/TimeoutJobs";

// Probes
import "./Jobs/Probe/SendOwnerAddedNotification";
import "./Jobs/Probe/UpdateConnectionStatus";

// AI Agents
import "./Jobs/AIAgent/SendOwnerAddedNotification";
import "./Jobs/AIAgent/UpdateConnectionStatus";
import "./Jobs/AIAgent/TimeoutStuckTasks";

// Telemetry Monitors.
import "./Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

// Derived / recording-rule metrics.
import "./Jobs/Metrics/ComputeRecordingRules";

// Derived metrics from spans.
import "./Jobs/Traces/ComputeTraceRecordingRules";

// Kubernetes inventory cleanup.
import "./Jobs/Kubernetes/CleanupStaleResources";

// Docker inventory cleanup + cached count refresh.
import "./Jobs/Docker/CleanupStaleResources";

// Podman inventory cleanup + cached count refresh.
import "./Jobs/Podman/CleanupStaleResources";

// Host disconnection sweeper.
import "./Jobs/Host/CleanupStaleHosts";

// Proxmox cluster disconnection sweeper + inventory cleanup.
import "./Jobs/Proxmox/CleanupStaleResources";

// Ceph cluster disconnection sweeper + inventory cleanup.
import "./Jobs/Ceph/CleanupStaleResources";

// Docker Swarm cluster disconnection sweeper + inventory cleanup.
import "./Jobs/DockerSwarm/CleanupStaleResources";

// IoT fleet disconnection sweeper + inventory cleanup.
import "./Jobs/IoT/CleanupStaleResources";

// Telemetry entity registry: TTL prune + span-derived service map edges.
import "./Jobs/TelemetryEntity/PruneStaleEntities";
import "./Jobs/TelemetryEntity/ComputeServiceDependencies";

/*
 * NOTE: there is deliberately no in-app V2 -> V3 historical telemetry
 * copy. The V3 cut is forward-only (decision 2026-06-11): V3 tables start
 * fresh, history ages in over the retention window, and operators who
 * want to carry history forward run the documented clickhouse-client
 * queries instead — see App/FeatureSet/Docs/Content/en/installation/upgrading.md ('Upgrading from OneUptime 10 → 11').
 */

/*
 * Metric retention is handled by ClickHouse TTL on Metric.retentionDate
 * (set at ingest from GlobalConfig), so no cleanup cron is needed here.
 */

import "./Jobs/OnCallDutySchedule/RefreshHandoffTime";

/*
 * DeleteMonitorLogOlderThan24Hours cron job removed — TTL via retentionDate column
 * now handles automatic MonitorLog retention in ClickHouse. Retention days are read
 * from GlobalConfig.monitorLogRetentionInDays at ingestion time in MonitorLogUtil.
 */

import "./Jobs/OnCallPolicy/DeleteOldTimeLogs";

import "./Jobs/PaymentProvider/SendDailyEmailsToOwnersIfSubscriptionIsOverdue";

// Enterprise License usage reporting (self-hosted only).
import "./Jobs/EnterpriseLicense/ReportUserCount";

import AnalyticsTableManagement from "./Utils/AnalyticsDatabase/TableManegement";
import RunDatabaseMigrations from "./Utils/DataMigration";
import JobDictionary from "./Utils/JobDictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import FeatureSet from "Common/Server/Types/FeatureSet";
import logger from "Common/Server/Utils/Logger";
import {
  DisableQueueWorkers,
  EnableQueueDashboard,
  QueueDashboardSecret,
  RunDatabaseMigrationsOnBoot,
} from "Common/Server/EnvironmentConfig";
import { WORKER_CONCURRENCY } from "./Config";
import MetricsAPI from "./API/Metrics";

import Express, { ExpressApplication } from "Common/Server/Utils/Express";

const app: ExpressApplication = Express.getExpressApp();

const WorkersFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      // attach bull board to the app, gated behind ENABLE_QUEUE_DASHBOARD
      if (EnableQueueDashboard) {
        if (!QueueDashboardSecret) {
          logger.warn(
            "ENABLE_QUEUE_DASHBOARD is true but QUEUE_DASHBOARD_SECRET is empty. Queue dashboard will not be mounted.",
          );
        } else {
          app.use(Queue.getInspectorRoute(), Queue.getQueueInspectorRouter());
        }
      }

      // expose metrics endpoint used by KEDA
      app.use(["/worker", "/"], MetricsAPI);

      // create tables in analytics database
      await AnalyticsTableManagement.createTables();

      /*
       * Ensure ClickHouse materialized views exist. Runs every boot and
       * is idempotent (CREATE ... IF NOT EXISTS + existence check), so a
       * wiped/recreated ClickHouse volume self-heals even when the
       * one-time DataMigrations that originally created the MVs are
       * already recorded as executed in Postgres. Must run after
       * createTables() so the source/target tables exist.
       */
      await AnalyticsTableManagement.createMaterializedViews();

      /*
       * Run async database migrations AFTER the awaited schema sync above:
       * on a wiped/first-boot ClickHouse, migration ALTERs against
       * model-owned tables would otherwise race table creation and throw
       * UNKNOWN_TABLE, wedging the chain until the next boot. Still
       * fire-and-forget — a long migration never blocks the listener,
       * probes, queues, or cron scheduling.
       */
      /*
       * Skipped on runtime pods when a dedicated migrate Job owns migrations
       * (RUN_DATABASE_MIGRATIONS_ON_BOOT=false) — required for PgBouncer
       * transaction-mode pooling, since the data-migration session advisory
       * lock would otherwise run on the pooled runtime connection.
       */
      if (RunDatabaseMigrationsOnBoot) {
        RunDatabaseMigrations().catch((err: Error) => {
          logger.error("Error running database migrations", {
            service: "workers",
          });
          logger.error(err, { service: "workers" });
        });
      }

      /*
       * Job process. Skipped in the "api" role (DISABLE_QUEUE_WORKERS=true) —
       * the dedicated worker deployment drains the Worker queue (cron jobs,
       * notifications, incident/alert state reconciliation, etc.). Cron
       * scheduling above still runs in both roles; it only writes idempotent
       * repeatable-job definitions to Redis and populates JobDictionary.
       */
      if (DisableQueueWorkers) {
        logger.info(
          "DISABLE_QUEUE_WORKERS=true — Worker queue consumer not registered (api role).",
          { service: "workers" },
        );
      } else {
        QueueWorker.getWorker(
          QueueName.Worker,
          async (job: QueueJob) => {
            const name: string = job.name;

            logger.debug("Running Job: " + name, { service: "workers" });

            const funcToRun: PromiseVoidFunction =
              JobDictionary.getJobFunction(name);

            const timeoutInMs: number = JobDictionary.getTimeoutInMs(name);

            if (funcToRun) {
              await QueueWorker.runJobWithTimeout(timeoutInMs, funcToRun);
            }
          },
          { concurrency: WORKER_CONCURRENCY },
        );
      }
    } catch (err) {
      logger.error("App Init Failed:", { service: "workers" });
      logger.error(err, { service: "workers" });
      throw err;
    }
  },
};

export default WorkersFeatureSet;
