import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import LogPipelineProcessor from "../../Models/DatabaseModels/LogPipelineProcessor";
import LogRecordingRule from "../../Models/DatabaseModels/LogRecordingRule";
import LogSavedView from "../../Models/DatabaseModels/LogSavedView";
import MetricPipelineRule from "../../Models/DatabaseModels/MetricPipelineRule";
import MetricRecordingRule from "../../Models/DatabaseModels/MetricRecordingRule";
import MetricSavedView from "../../Models/DatabaseModels/MetricSavedView";
import MonitorTest from "../../Models/DatabaseModels/MonitorTest";
import ProjectSmtpConfig from "../../Models/DatabaseModels/ProjectSmtpConfig";
import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventDestination from "../../Models/DatabaseModels/SecurityEventDestination";
import SecurityLogSource from "../../Models/DatabaseModels/SecurityLogSource";
import TableView from "../../Models/DatabaseModels/TableView";
import ThreatIntelFeed from "../../Models/DatabaseModels/ThreatIntelFeed";
import ToolImportRecord from "../../Models/DatabaseModels/ToolImportRecord";
import TracePipelineProcessor from "../../Models/DatabaseModels/TracePipelineProcessor";
import TraceRecordingRule from "../../Models/DatabaseModels/TraceRecordingRule";
import TraceSavedView from "../../Models/DatabaseModels/TraceSavedView";
import WorkflowVariable from "../../Models/DatabaseModels/WorkflowVariable";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRuleService from "../../Server/Services/DetectionRuleService";
import LogPipelineProcessorService from "../../Server/Services/LogPipelineProcessorService";
import LogRecordingRuleService from "../../Server/Services/LogRecordingRuleService";
import LogSavedViewService from "../../Server/Services/LogSavedViewService";
import MetricPipelineRuleService from "../../Server/Services/MetricPipelineRuleService";
import MetricRecordingRuleService from "../../Server/Services/MetricRecordingRuleService";
import MetricSavedViewService from "../../Server/Services/MetricSavedViewService";
import MonitorTestService from "../../Server/Services/MonitorTestService";
import ProjectSmtpConfigService from "../../Server/Services/ProjectSmtpConfigService";
import SecurityEventConnectionService from "../../Server/Services/SecurityEventConnectionService";
import SecurityEventDestinationService from "../../Server/Services/SecurityEventDestinationService";
import SecurityLogSourceService from "../../Server/Services/SecurityLogSourceService";
import TableViewService from "../../Server/Services/TableViewService";
import ThreatIntelFeedService from "../../Server/Services/ThreatIntelFeedService";
import ToolImportRecordService from "../../Server/Services/ToolImportRecordService";
import TracePipelineProcessorService from "../../Server/Services/TracePipelineProcessorService";
import TraceRecordingRuleService from "../../Server/Services/TraceRecordingRuleService";
import TraceSavedViewService from "../../Server/Services/TraceSavedViewService";
import WorkflowVariableService from "../../Server/Services/WorkflowVariableService";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import MailTransportType from "../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../Types/Email/SMTPAuthenticationType";
import FilterCondition from "../../Types/Filter/FilterCondition";
import SecurityEventDestinationScope from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { WorkflowVariableType } from "../../Types/Workflow/WorkflowVariableOAuth";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The 29 required columns issue #5158 was one of: each documented by the
 * API reference and the Terraform schema as optional with a default, and
 * each refused when a create left it out ("<column> is required") until it
 * was flagged isDefaultValueColumn. RequiredColumnsWithDefaultsGuard used to
 * list them as known exceptions.
 *
 * Shared by RequiredColumnDefaultsCreateContract (the required-field check,
 * no database) and RequiredColumnDefaultsPostgres (the rows a migrated
 * Postgres writes).
 */

export interface RequiredColumnDefaultsContract {
  modelType: DatabaseBaseModelType;
  service: unknown;
  // Each column a create may leave out, and the default it is then stored with.
  defaults: Array<[string, unknown]>;
}

export const REQUIRED_COLUMN_DEFAULTS: Array<RequiredColumnDefaultsContract> =
  [
    {
      modelType: DetectionRule,
      service: DetectionRuleService,
      defaults: [
        ["isEnabled", true],
        ["evaluationIntervalInMinutes", 1],
        ["shouldCreateAlert", true],
        ["shouldWriteDetectionFinding", true],
      ],
    },
    {
      modelType: LogPipelineProcessor,
      service: LogPipelineProcessorService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: LogRecordingRule,
      service: LogRecordingRuleService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: LogSavedView,
      service: LogSavedViewService,
      defaults: [
        ["pageSize", 100],
        ["isDefault", false],
      ],
    },
    {
      modelType: MetricPipelineRule,
      service: MetricPipelineRuleService,
      defaults: [
        ["filterCondition", FilterCondition.All],
        ["isEnabled", true],
      ],
    },
    {
      modelType: MetricRecordingRule,
      service: MetricRecordingRuleService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: MetricSavedView,
      service: MetricSavedViewService,
      defaults: [["isDefault", false]],
    },
    {
      modelType: MonitorTest,
      service: MonitorTestService,
      defaults: [["isInQueue", true]],
    },
    {
      modelType: ProjectSmtpConfig,
      service: ProjectSmtpConfigService,
      defaults: [
        ["transportType", MailTransportType.SMTP],
        ["authType", SMTPAuthenticationType.UsernamePassword],
      ],
    },
    {
      modelType: SecurityEventConnection,
      service: SecurityEventConnectionService,
      defaults: [
        ["isEnabled", true],
        ["pollIntervalInMinutes", 5],
        ["alertingOnly", true],
      ],
    },
    {
      modelType: SecurityEventDestination,
      service: SecurityEventDestinationService,
      defaults: [
        ["isEnabled", true],
        ["sendScope", SecurityEventDestinationScope.Detections],
      ],
    },
    {
      modelType: SecurityLogSource,
      service: SecurityLogSourceService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: TableView,
      service: TableViewService,
      defaults: [["itemsOnPage", 10]],
    },
    {
      modelType: ThreatIntelFeed,
      service: ThreatIntelFeedService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: ToolImportRecord,
      service: ToolImportRecordService,
      defaults: [["isComplete", true]],
    },
    {
      modelType: TracePipelineProcessor,
      service: TracePipelineProcessorService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: TraceRecordingRule,
      service: TraceRecordingRuleService,
      defaults: [["isEnabled", true]],
    },
    {
      modelType: TraceSavedView,
      service: TraceSavedViewService,
      defaults: [["isDefault", false]],
    },
    {
      modelType: WorkflowVariable,
      service: WorkflowVariableService,
      defaults: [
        ["isSecret", false],
        ["variableType", WorkflowVariableType.Static],
      ],
    },
  ];

export function defaultedColumnsOf(
  contract: RequiredColumnDefaultsContract,
): Array<string> {
  return contract.defaults.map((entry: [string, unknown]): string => {
    return entry[0];
  });
}

// The DEFAULT Postgres writes for a column the insert leaves out.
export function databaseDefaultOf(
  modelType: DatabaseBaseModelType,
  propertyName: string,
): unknown {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs): boolean => {
      return args.target === modelType && args.propertyName === propertyName;
    })
    .pop()?.options.default;
}

// Every required column given `value`, except the ones a create leaves out.
export function withEveryRequiredColumnBut(
  modelType: DatabaseBaseModelType,
  leftOut: Array<string>,
  value: unknown = "given",
): DatabaseBaseModel {
  const model: DatabaseBaseModel = new modelType();

  for (const column of model.getRequiredColumns().columns) {
    if (leftOut.includes(column)) {
      continue;
    }

    (model as unknown as Record<string, unknown>)[column] = value;
  }

  return model;
}

/*
 * A required column a create cannot do without - no default of any kind,
 * not a slug the create fills in - with the relation that would answer for
 * it, so both can be left out.
 */
export function columnWithoutDefault(modelType: DatabaseBaseModelType): {
  column: string;
  leftOut: Array<string>;
} {
  const model: DatabaseBaseModel = new modelType();

  const column: string | undefined = model
    .getRequiredColumns()
    .columns.find((name: string): boolean => {
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(name);

      return (
        !metadata.isDefaultValueColumn &&
        metadata.defaultValue === undefined &&
        !metadata.forceGetDefaultValueOnCreate &&
        metadata.type !== TableColumnType.Entity &&
        metadata.type !== TableColumnType.Slug
      );
    });

  if (!column) {
    throw new Error(`${modelType.name} has no required column without a default.`);
  }

  const relations: Array<string> = model
    .getTableColumns()
    .columns.filter((name: string): boolean => {
      return model.getTableColumnMetadata(name).manyToOneRelationColumn === column;
    });

  return { column, leftOut: [column, ...relations] };
}
