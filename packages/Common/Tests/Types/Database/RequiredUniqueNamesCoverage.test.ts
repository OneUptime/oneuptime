import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getProjectNameRule } from "../../../Types/Database/ProjectNameRule";
import { getUniqueColumnsBy } from "../../../Types/Database/UniqueColumnBy";
import {
  getUniqueNameWhenRequiredColumn,
  getUniqueNameWhenRequiredColumns,
} from "../../../Types/Database/UniqueNameWhenRequired";
import { getLabelOfSentenceTerm } from "../../../Types/Exception/RefusalWithValues";
import { DEFAULT_LANGUAGE, toSentenceTerm } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * WHICH KINDS A PROJECT'S "REQUIRE UNIQUE NAMES" HOLDS, AND WHY THE REST ARE
 * LEFT OUT (#10761).
 *
 * The issue asked for monitors' names to be unique in a project, and for a
 * review of what else should be, "so that such piecemeal tickets will not be
 * required". This is that review, kept true: every model of a project with a
 * name people read - its `name`, a template's `templateName`, a resource's
 * `displayName`, an event's `title` - is one of
 *
 *   - held by the setting: its name column is marked @UniqueNameWhenRequired
 *     - things people configure at the project level and find or pick by
 *     name (monitors, probes, SLOs, templates, connections...);
 *   - unique already, always: @UniqueColumnBy("projectId") on its name, or
 *     a team, label, on-call policy or schedule (UniqueNameInProject) - they
 *     keep their rule, whatever the setting says;
 *   - unique already within the record it belongs to (@UniqueColumnBy a
 *     parent: a status page's groups, a workflow's variables);
 *   - left out, for one of the reasons below.
 *
 * A new model with a name fails here until it is put in one of them, so the
 * next kind is decided once, not in another ticket. The pull request's table
 * is this list.
 */

enum LeftOut {
  /*
   * Something that happened, or a record of it: incidents, alerts,
   * episodes, maintenance events and announcements repeat their titles by
   * design (the issue names them), and so do runs, captures and records of
   * an import.
   */
  EventOrRecord = "an event or a record of one",
  /*
   * Found and named by its source - telemetry, an agent, a cloud, another
   * product's API - where names repeat by design: two pods called "web" in
   * two namespaces, two databases called "postgres".
   */
  Discovered = "discovered, and named by its source",
  /*
   * A part of another record: a schedule's layer, a policy's escalation
   * rule, a pipeline's processor, an SLO's burn rate rule. Its name tells
   * it apart within that record at most, never across the project.
   */
  PartOfAnotherRecord = "a part of another record",
  /*
   * A rule, found by what it matches and does in its ordered list and
   * picked nowhere by name; label and owner rules fill their name in from
   * what they add, so two rules adding one label to different records share
   * a name by design.
   */
  Rule = "a rule",
  /*
   * Kept by one person, or listed on one page: a saved view of a service's
   * Logs tab, a table's view, a personal webhook. A project-wide rule would
   * refuse "Errors" on two services' tabs.
   */
  PersonalOrOnePage = "kept by one person, or on one page",
  /*
   * A name given to something else on purpose: an address name names an IP
   * address or a subnet, and several subnets of one office carry one name.
   */
  NameOfSomethingElse = "a name for something else, shared on purpose",
  /*
   * Unique already within the record it belongs to, by an index of its
   * own: a data check's name is one table's (an index on the table and the
   * name), and "id is unique" is a fine name for a check of every table.
   */
  UniqueWithinItsRecord = "unique already within the record it belongs to",
}

const LEFT_OUT: Readonly<Record<string, LeftOut>> = {
  // Events and records.
  Incident: LeftOut.EventOrRecord,
  Alert: LeftOut.EventOrRecord,
  AlertEpisode: LeftOut.EventOrRecord,
  IncidentEpisode: LeftOut.EventOrRecord,
  ScheduledMaintenance: LeftOut.EventOrRecord,
  StatusPageAnnouncement: LeftOut.EventOrRecord,
  SecurityCase: LeftOut.EventOrRecord,
  SecurityDetection: LeftOut.EventOrRecord,
  DataSecurityIssue: LeftOut.EventOrRecord,
  DataSecurityIssueGroup: LeftOut.EventOrRecord,
  DataSecurityAiProposal: LeftOut.EventOrRecord,
  AIRun: LeftOut.EventOrRecord,
  AIInsight: LeftOut.EventOrRecord,
  AIAgentTaskPullRequest: LeftOut.EventOrRecord,
  PushNotificationLog: LeftOut.EventOrRecord,
  PacketCapture: LeftOut.EventOrRecord,
  ToolImportRecord: LeftOut.EventOrRecord,
  OpenStackProjectUsage: LeftOut.EventOrRecord,

  // Discovered, and named by their source.
  CephResource: LeftOut.Discovered,
  CloudAccount: LeftOut.Discovered,
  CloudApp: LeftOut.Discovered,
  DataAsset: LeftOut.Discovered,
  DataDashboard: LeftOut.Discovered,
  DataStore: LeftOut.Discovered,
  DataWarehouseJob: LeftOut.Discovered,
  DatabaseServer: LeftOut.Discovered,
  DockerResource: LeftOut.Discovered,
  DockerSwarmResource: LeftOut.Discovered,
  InventoryItem: LeftOut.Discovered,
  IoTDevice: LeftOut.Discovered,
  KubernetesContainer: LeftOut.Discovered,
  KubernetesResource: LeftOut.Discovered,
  McpOAuthGrant: LeftOut.Discovered,
  MessageQueue: LeftOut.Discovered,
  NetworkInterface: LeftOut.Discovered,
  OpenStackResource: LeftOut.Discovered,
  PodmanResource: LeftOut.Discovered,
  ProxmoxResource: LeftOut.Discovered,
  ScheduledMaintenanceExternalCalendarEvent: LeftOut.Discovered,
  SecurityBlockCloudWaf: LeftOut.Discovered,
  StorageArrayResource: LeftOut.Discovered,
  VMwareResource: LeftOut.Discovered,
  WorkspaceUserGroup: LeftOut.Discovered,

  // Parts of another record.
  AIConversation: LeftOut.PersonalOrOnePage,
  AlertVideoCall: LeftOut.PartOfAnotherRecord,
  IncidentVideoCall: LeftOut.PartOfAnotherRecord,
  IncidentPostmortemActionItem: LeftOut.PartOfAnotherRecord,
  IncomingCallPolicyEscalationRule: LeftOut.PartOfAnotherRecord,
  IoTDeviceCredential: LeftOut.PartOfAnotherRecord,
  LogPipelineProcessor: LeftOut.PartOfAnotherRecord,
  NetworkDeviceLink: LeftOut.PartOfAnotherRecord,
  NetworkSiteLink: LeftOut.PartOfAnotherRecord,
  OnCallDutyPolicyEscalationRule: LeftOut.PartOfAnotherRecord,
  OnCallDutyPolicyScheduleLayer: LeftOut.PartOfAnotherRecord,
  PublicNoteApprovalStep: LeftOut.PartOfAnotherRecord,
  SecurityCaseEvidence: LeftOut.PartOfAnotherRecord,
  SecurityCaseTask: LeftOut.PartOfAnotherRecord,
  ServiceLevelObjectiveBurnRateRule: LeftOut.PartOfAnotherRecord,
  ServiceLevelObjectiveErrorBudgetPolicyTier: LeftOut.PartOfAnotherRecord,
  ServiceLevelObjectiveMonitorRule: LeftOut.PartOfAnotherRecord,
  StatusPageFooterLink: LeftOut.PartOfAnotherRecord,
  StatusPageHeaderLink: LeftOut.PartOfAnotherRecord,
  StatusPageMonitorRule: LeftOut.PartOfAnotherRecord,
  StatusPageResource: LeftOut.PartOfAnotherRecord,
  TracePipelineProcessor: LeftOut.PartOfAnotherRecord,

  // Rules.
  AIPostmortemRule: LeftOut.Rule,
  /*
   * An off-hours schedule (#11010) picks resources by a tag and acts by its
   * hours; nothing picks a schedule by its name.
   */
  CloudOffHoursSchedule: LeftOut.Rule,
  AlertEpisodeLabelRule: LeftOut.Rule,
  AlertEpisodeOnCallRule: LeftOut.Rule,
  AlertEpisodeOwnerRule: LeftOut.Rule,
  AlertEpisodePrivacyRule: LeftOut.Rule,
  AlertGroupingRule: LeftOut.Rule,
  AlertIncidentRule: LeftOut.Rule,
  AlertLabelRule: LeftOut.Rule,
  AlertOnCallRule: LeftOut.Rule,
  AlertOwnerRule: LeftOut.Rule,
  AlertPrivacyRule: LeftOut.Rule,
  AlertReminderRule: LeftOut.Rule,
  AutoRemediationRule: LeftOut.Rule,
  CephClusterLabelRule: LeftOut.Rule,
  CephClusterOwnerRule: LeftOut.Rule,
  CloudResourceLabelRule: LeftOut.Rule,
  CloudResourceOwnerRule: LeftOut.Rule,
  DashboardLabelRule: LeftOut.Rule,
  DashboardOwnerRule: LeftOut.Rule,
  DataAssetLabelRule: LeftOut.Rule,
  DataAssetOwnerRule: LeftOut.Rule,
  DataPipelineOwnerRule: LeftOut.Rule,
  DataSecurityResidencyRule: LeftOut.Rule,
  DataStoreLabelRule: LeftOut.Rule,
  DataStoreOwnerRule: LeftOut.Rule,
  DatabaseServerLabelRule: LeftOut.Rule,
  DatabaseServerOwnerRule: LeftOut.Rule,
  DetectionRule: LeftOut.Rule,
  DockerHostLabelRule: LeftOut.Rule,
  DockerHostOwnerRule: LeftOut.Rule,
  DockerSwarmClusterLabelRule: LeftOut.Rule,
  DockerSwarmClusterOwnerRule: LeftOut.Rule,
  HostLabelRule: LeftOut.Rule,
  HostOwnerRule: LeftOut.Rule,
  IncidentEpisodeLabelRule: LeftOut.Rule,
  IncidentEpisodeOnCallRule: LeftOut.Rule,
  IncidentEpisodeOwnerRule: LeftOut.Rule,
  IncidentEpisodePrivacyRule: LeftOut.Rule,
  IncidentGroupingRule: LeftOut.Rule,
  IncidentLabelRule: LeftOut.Rule,
  IncidentOnCallRule: LeftOut.Rule,
  IncidentOwnerRule: LeftOut.Rule,
  IncidentPrivacyRule: LeftOut.Rule,
  IncidentReminderRule: LeftOut.Rule,
  IncidentSlaRule: LeftOut.Rule,
  IncomingCallPolicyLabelRule: LeftOut.Rule,
  IncomingCallPolicyOwnerRule: LeftOut.Rule,
  IoTFleetLabelRule: LeftOut.Rule,
  IoTFleetOwnerRule: LeftOut.Rule,
  KubernetesClusterLabelRule: LeftOut.Rule,
  KubernetesClusterOwnerRule: LeftOut.Rule,
  LogDropFilter: LeftOut.Rule,
  LogRecordingRule: LeftOut.Rule,
  LogScrubRule: LeftOut.Rule,
  MessageQueueLabelRule: LeftOut.Rule,
  MessageQueueOwnerRule: LeftOut.Rule,
  MetricPipelineRule: LeftOut.Rule,
  MetricRecordingRule: LeftOut.Rule,
  MonitorLabelRule: LeftOut.Rule,
  MonitorOwnerRule: LeftOut.Rule,
  NetworkDeviceAutoImportRule: LeftOut.Rule,
  NetworkDeviceLabelRule: LeftOut.Rule,
  NetworkDeviceLinkRule: LeftOut.Rule,
  NetworkDeviceNamingRule: LeftOut.Rule,
  NetworkDeviceOwnerRule: LeftOut.Rule,
  OnCallDutyPolicyLabelRule: LeftOut.Rule,
  OnCallDutyPolicyOwnerRule: LeftOut.Rule,
  OnCallDutyPolicyScheduleLabelRule: LeftOut.Rule,
  OnCallDutyPolicyScheduleOwnerRule: LeftOut.Rule,
  OpenStackCloudLabelRule: LeftOut.Rule,
  OpenStackCloudOwnerRule: LeftOut.Rule,
  PodmanHostLabelRule: LeftOut.Rule,
  PodmanHostOwnerRule: LeftOut.Rule,
  ProxmoxClusterLabelRule: LeftOut.Rule,
  ProxmoxClusterOwnerRule: LeftOut.Rule,
  RumApplicationLabelRule: LeftOut.Rule,
  RumApplicationOwnerRule: LeftOut.Rule,
  RunbookLabelRule: LeftOut.Rule,
  RunbookOwnerRule: LeftOut.Rule,
  RunbookRule: LeftOut.Rule,
  ScheduledMaintenanceLabelRule: LeftOut.Rule,
  ScheduledMaintenanceOwnerRule: LeftOut.Rule,
  ScheduledMaintenanceReminderRule: LeftOut.Rule,
  ServerlessFunctionLabelRule: LeftOut.Rule,
  ServerlessFunctionOwnerRule: LeftOut.Rule,
  ServiceLabelRule: LeftOut.Rule,
  ServiceLevelObjectiveLabelRule: LeftOut.Rule,
  ServiceLevelObjectiveOwnerRule: LeftOut.Rule,
  ServiceOwnerRule: LeftOut.Rule,
  StatusPageLabelRule: LeftOut.Rule,
  StatusPageOwnerRule: LeftOut.Rule,
  StorageArrayLabelRule: LeftOut.Rule,
  StorageArrayOwnerRule: LeftOut.Rule,
  TraceDropFilter: LeftOut.Rule,
  TraceRecordingRule: LeftOut.Rule,
  TraceScrubRule: LeftOut.Rule,
  VMwareVCenterLabelRule: LeftOut.Rule,
  VMwareVCenterOwnerRule: LeftOut.Rule,
  WorkflowLabelRule: LeftOut.Rule,
  WorkflowOwnerRule: LeftOut.Rule,
  WorkspaceNotificationRule: LeftOut.Rule,

  // Kept by one person, or on one page.
  ExceptionSavedView: LeftOut.PersonalOrOnePage,
  LogSavedView: LeftOut.PersonalOrOnePage,
  MetricSavedView: LeftOut.PersonalOrOnePage,
  RumProductAnalyticsSavedView: LeftOut.PersonalOrOnePage,
  TableView: LeftOut.PersonalOrOnePage,
  TraceSavedView: LeftOut.PersonalOrOnePage,
  UserWebhook: LeftOut.PersonalOrOnePage,

  // A name for something else.
  NetworkAddressName: LeftOut.NameOfSomethingElse,

  // Unique already within its record, by an index of its own.
  DataCheck: LeftOut.UniqueWithinItsRecord,
};

/*
 * The kinds Require Unique Names holds, by model: the review's decision, so
 * a mark added or taken off is a decision too.
 */
const HELD_BY_THE_SETTING: Readonly<Record<string, string>> = {
  Monitor: "name",
  MonitorGroup: "name",
  Probe: "name",
  ServiceLevelObjective: "name",
  IncomingCallPolicy: "name",
  WorkspaceNotificationSummary: "name",
  VideoCallConnection: "name",
  CustomRole: "name",
  ApiKey: "name",
  TelemetryIngestionKey: "name",
  LogPipeline: "name",
  TracePipeline: "name",
  CloudConnection: "name",
  CloudBudget: "name",
  OpenStackBudget: "name",
  DataBiConnection: "name",
  DataProduct: "name",
  DataReconciliation: "name",
  DataSecurityCustomDataType: "name",
  SecurityAutomaticResponsePolicy: "name",
  SecurityBlocklistFeed: "name",
  SecurityEventConnection: "name",
  SecurityEventDestination: "name",
  SecurityHunt: "name",
  SecurityPlaybook: "name",
  ThreatIntelFeed: "name",
  NetworkControllerConnection: "name",
  NetworkDeviceDiscoveryScan: "name",
  DeviceManagementConnection: "name",
  ScheduledMaintenanceExternalCalendar: "name",
  AIAgent: "name",
  ExternalMcpServer: "name",
  LlmProvider: "name",
  LlmCostBudget: "name",
  LlmObservabilityConnection: "name",
  AuditLogExport: "name",
  AlertNoteTemplate: "templateName",
  IncidentTemplate: "templateName",
  IncidentPostmortemTemplate: "templateName",
  IncidentNoteTemplate: "templateName",
  MonitorTemplate: "templateName",
  ScheduledMaintenanceNoteTemplate: "templateName",
  SecurityCaseNoteTemplate: "templateName",
  ScheduledMaintenanceTemplate: "templateName",
  StatusPageAnnouncementTemplate: "templateName",
  StatusPageSubscriberNotificationTemplate: "templateName",
};

// The columns a record is known by, in the order a model is read for one.
const NAME_COLUMNS: ReadonlyArray<string> = [
  "name",
  "templateName",
  "displayName",
  "title",
];

interface NamedModel {
  className: string;
  model: BaseModel;
  // The column it is known by: the marked one, else the first it has.
  column: string;
}

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const INDEX_MIGRATION: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809187640010-AddUniqueNameIndexes.ts",
);

// Every model of a project with a name people read.
const NAMED_MODELS: Array<NamedModel> = AllModelTypes.map(
  (modelType: { new (): BaseModel }): NamedModel | null => {
    const model: BaseModel = new modelType();

    if (model.getTenantColumn() !== "projectId") {
      return null;
    }

    const column: string | undefined =
      getUniqueNameWhenRequiredColumn(model) ||
      NAME_COLUMNS.find((name: string): boolean => {
        return model.hasColumn(name);
      });

    if (!column) {
      return null;
    }

    return { className: modelType.name, model: model, column: column };
  },
).filter((named: NamedModel | null): boolean => {
  return named !== null;
}) as Array<NamedModel>;

// Unique within the record it belongs to: @UniqueColumnBy a parent.
const isUniqueInParent: (named: NamedModel) => boolean = (
  named: NamedModel,
): boolean => {
  const scope: unknown = getUniqueColumnsBy(named.model)[named.column];

  return Boolean(scope) && !getProjectNameRule(named.model);
};

describe("every model of a project with a name people read is decided (#10761)", () => {
  test("finds the models it reads: monitors, templates, events and the rest", () => {
    const classNames: Array<string> = NAMED_MODELS.map((named: NamedModel) => {
      return named.className;
    });

    for (const className of [
      "Monitor",
      "IncidentTemplate",
      "Incident",
      "Team",
      "StatusPage",
      "KubernetesResource",
    ]) {
      expect(classNames).toContain(className);
    }

    expect(NAMED_MODELS.length).toBeGreaterThan(250);
  });

  test("each is held by the setting, unique already, or left out with a reason", () => {
    const undecided: Array<string> = NAMED_MODELS.filter(
      (named: NamedModel): boolean => {
        return (
          !getUniqueNameWhenRequiredColumn(named.model) &&
          !getProjectNameRule(named.model) &&
          !isUniqueInParent(named) &&
          !LEFT_OUT[named.className]
        );
      },
    ).map((named: NamedModel): string => {
      return `${named.className}.${named.column}`;
    });

    /*
     * A model listed here has a name nobody decided about: mark it
     * @UniqueNameWhenRequired (and add its index to a migration, as
     * 1809187640010-AddUniqueNameIndexes does), or add it to LEFT_OUT with
     * its reason.
     */
    expect(undecided).toEqual([]);
  });

  test("the setting holds exactly the kinds the review decided, each by the column it is known by", () => {
    const held: Record<string, string> = {};

    for (const named of NAMED_MODELS) {
      const column: string | null = getUniqueNameWhenRequiredColumn(
        named.model,
      );

      if (column) {
        held[named.className] = column;
      }
    }

    expect(held).toEqual(HELD_BY_THE_SETTING);
  });

  test("no model is both held by the setting and left out, or unique already", () => {
    for (const className of Object.keys(HELD_BY_THE_SETTING)) {
      expect({ className, leftOut: LEFT_OUT[className] }).toEqual({
        className,
        leftOut: undefined,
      });
    }

    for (const named of NAMED_MODELS) {
      const column: string | null = getUniqueNameWhenRequiredColumn(
        named.model,
      );

      if (!column) {
        continue;
      }

      // Unique already, always: its rule would be held twice.
      expect({
        className: named.className,
        uniqueBy: getUniqueColumnsBy(named.model)[column] || null,
      }).toEqual({ className: named.className, uniqueBy: null });
    }
  });

  test("every model left out still exists, has a name and is not unique already", () => {
    const byClassName: Map<string, NamedModel> = new Map<string, NamedModel>(
      NAMED_MODELS.map((named: NamedModel): [string, NamedModel] => {
        return [named.className, named];
      }),
    );

    for (const className of Object.keys(LEFT_OUT)) {
      const named: NamedModel | undefined = byClassName.get(className);

      expect({ className, found: Boolean(named) }).toEqual({
        className,
        found: true,
      });

      expect({
        className,
        isUniqueAlready: named
          ? Boolean(getProjectNameRule(named.model)) || isUniqueInParent(named)
          : false,
      }).toEqual({ className, isUniqueAlready: false });
    }
  });

  test("the events the issue names may repeat: incidents, alerts, episodes, maintenance events and announcements", () => {
    for (const className of [
      "Incident",
      "Alert",
      "AlertEpisode",
      "IncidentEpisode",
      "ScheduledMaintenance",
      "StatusPageAnnouncement",
    ]) {
      expect({ className, reason: LEFT_OUT[className] }).toEqual({
        className,
        reason: LeftOut.EventOrRecord,
      });
    }
  });

  test("teams, labels, on-call policies and schedules, status pages, dashboards and workflows keep their own rule: unique always", () => {
    for (const className of [
      "Team",
      "Label",
      "OnCallDutyPolicy",
      "OnCallDutyPolicySchedule",
      "StatusPage",
      "Dashboard",
      "Workflow",
      "Service",
      "IncidentSeverity",
      "MonitorStatus",
    ]) {
      const named: NamedModel | undefined = NAMED_MODELS.find(
        (candidate: NamedModel): boolean => {
          return candidate.className === className;
        },
      );

      expect({
        className,
        rule: named ? getProjectNameRule(named.model) : null,
      }).toEqual({
        className,
        rule: { column: "name", isAlwaysUnique: true },
      });
    }
  });
});

describe("a kind held by the setting", () => {
  const held: Array<NamedModel> = NAMED_MODELS.filter(
    (named: NamedModel): boolean => {
      return Boolean(getUniqueNameWhenRequiredColumn(named.model));
    },
  );

  test("marks one column, of text", () => {
    for (const named of held) {
      const columns: Array<string> = getUniqueNameWhenRequiredColumns(
        named.model,
      );

      expect({ className: named.className, columns }).toEqual({
        className: named.className,
        columns: [named.column],
      });

      expect({
        className: named.className,
        type: named.model.getTableColumnMetadata(named.column)?.type,
      }).toEqual({
        className: named.className,
        type: expect.stringMatching(
          new RegExp(
            `^(${TableColumnType.ShortText}|${TableColumnType.Name}|${TableColumnType.LongText})$`,
          ),
        ),
      });
    }
  });

  test("is one of its project's, and its rule is the setting's", () => {
    for (const named of held) {
      expect({
        className: named.className,
        rule: getProjectNameRule(named.model),
      }).toEqual({
        className: named.className,
        rule: { column: named.column, isAlwaysUnique: false },
      });
    }
  });

  test("declares the index its lookup reads, by name, left to the migration", () => {
    const indices: Array<IndexMetadataArgs> = getMetadataArgsStorage().indices;

    for (const named of held) {
      const tableName: string = named.model.tableName || "";
      const indexName: string = `IDX_${tableName.toUpperCase()}_PROJECT_NAME_KEY`;

      const declared: IndexMetadataArgs | undefined = indices.find(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === named.model.constructor && index.name === indexName
          );
        },
      );

      expect({
        className: named.className,
        indexName,
        isDeclared: Boolean(declared),
        synchronize: declared?.synchronize,
        columns: declared?.columns,
      }).toEqual({
        className: named.className,
        indexName,
        isDeclared: true,
        synchronize: false,
        columns: ["projectId", named.column],
      });

      // An index name Postgres keeps whole.
      expect(indexName.length).toBeLessThanOrEqual(63);
    }
  });

  test("has its index built by the migration, on its name column as it reads", () => {
    const migration: string = fs.readFileSync(INDEX_MIGRATION, "utf8");

    const built: Array<string> = Array.from(
      migration.matchAll(
        /CREATE INDEX "(IDX_[A-Z]+_PROJECT_NAME_KEY)" ON "([A-Za-z]+)" \("projectId", LOWER\(BTRIM\(REGEXP_REPLACE\("([A-Za-z]+)", '\$\{NAME_WHITE_SPACE_RUN\}', ' ', 'g'\)\)\)\) WHERE "deletedAt" IS NULL/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return `${match[2]}.${match[3]} ${match[1]}`;
    });

    expect(built.sort()).toEqual(
      held
        .map((named: NamedModel): string => {
          const tableName: string = named.model.tableName || "";

          return `${tableName}.${named.column} IDX_${tableName.toUpperCase()}_PROJECT_NAME_KEY`;
        })
        .sort(),
    );
  });

  test("is named in a refusal by a word the Dashboard reads back to its own", () => {
    for (const named of held) {
      const label: string = named.model.singularName || "";
      const inSentence: string = toSentenceTerm(label, DEFAULT_LANGUAGE);

      expect({
        className: named.className,
        label: getLabelOfSentenceTerm(inSentence),
      }).toEqual({ className: named.className, label });
    }
  });

  test("has a service the server registers, for the list of names held twice", () => {
    const servicesIndex: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/Common/Server/Services/Index.ts"),
      "utf8",
    );

    for (const named of held) {
      expect({
        className: named.className,
        isRegistered: new RegExp(`\\b${named.className}Service\\b`).test(
          servicesIndex,
        ),
      }).toEqual({ className: named.className, isRegistered: true });
    }
  });
});
