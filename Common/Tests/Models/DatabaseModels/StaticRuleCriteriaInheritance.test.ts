import AllModelTypes from "../../../Models/DatabaseModels/Index";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import RelationOnlyRuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RelationOnlyRuleBaseModel";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { CheckMetadataArgs } from "typeorm/metadata-args/CheckMetadataArgs";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

type ModelType = new () => DatabaseBaseModel;

const STATIC_MATCH_CRITERIA_RULE_MODEL_NAMES: Array<string> = [
  "AlertEpisodeLabelRule",
  "AlertEpisodeOwnerRule",
  "AlertLabelRule",
  "AlertOwnerRule",
  "CephClusterLabelRule",
  "CephClusterOwnerRule",
  "CloudResourceLabelRule",
  "CloudResourceOwnerRule",
  "DashboardLabelRule",
  "DashboardOwnerRule",
  "DockerHostLabelRule",
  "DockerHostOwnerRule",
  "DockerSwarmClusterLabelRule",
  "DockerSwarmClusterOwnerRule",
  "HostLabelRule",
  "HostOwnerRule",
  "IncidentEpisodeLabelRule",
  "IncidentEpisodeOwnerRule",
  "IncidentLabelRule",
  "IncidentOwnerRule",
  "IncomingCallPolicyLabelRule",
  "IncomingCallPolicyOwnerRule",
  "IoTFleetLabelRule",
  "IoTFleetOwnerRule",
  "KubernetesClusterLabelRule",
  "KubernetesClusterOwnerRule",
  "MonitorLabelRule",
  "MonitorOwnerRule",
  "NetworkDeviceLabelRule",
  "NetworkDeviceOwnerRule",
  "OnCallDutyPolicyLabelRule",
  "OnCallDutyPolicyOwnerRule",
  "OnCallDutyPolicyScheduleLabelRule",
  "OnCallDutyPolicyScheduleOwnerRule",
  "PodmanHostLabelRule",
  "PodmanHostOwnerRule",
  "ProxmoxClusterLabelRule",
  "ProxmoxClusterOwnerRule",
  "RumApplicationLabelRule",
  "RumApplicationOwnerRule",
  "RunbookLabelRule",
  "RunbookOwnerRule",
  "ScheduledMaintenanceLabelRule",
  "ScheduledMaintenanceOwnerRule",
  "ServerlessFunctionLabelRule",
  "ServerlessFunctionOwnerRule",
  "ServiceLabelRule",
  "ServiceOwnerRule",
  "StatusPageLabelRule",
  "StatusPageOwnerRule",
  "VMwareVCenterLabelRule",
  "VMwareVCenterOwnerRule",
  "WorkflowLabelRule",
  "WorkflowOwnerRule",
  "AlertEpisodeOnCallRule",
  "AlertEpisodePrivacyRule",
  "AlertOnCallRule",
  "AlertPrivacyRule",
  "IncidentEpisodeOnCallRule",
  "IncidentEpisodePrivacyRule",
  "IncidentOnCallRule",
  "IncidentPrivacyRule",
  "AlertGroupingRule",
  "IncidentGroupingRule",
  "AlertReminderRule",
  "IncidentReminderRule",
  "ScheduledMaintenanceReminderRule",
  "IncidentSlaRule",
  "AutoRemediationRule",
  "RunbookRule",
  "StatusPageMonitorRule",
  "NetworkDeviceAutoImportRule",
  "NetworkSiteAssignmentRule",
];

const RELATION_ONLY_RULE_MODEL_NAMES: Array<string> = [
  "AlertReminderRule",
  "IncidentReminderRule",
  "ScheduledMaintenanceReminderRule",
];

function getRegisteredModelType(modelName: string): ModelType {
  const modelType: ModelType | undefined = (
    AllModelTypes as Array<ModelType>
  ).find((candidate: ModelType): boolean => {
    return candidate.name === modelName;
  });

  expect(modelType).toBeDefined();

  return modelType!;
}

describe("static match-criteria rule model inheritance", () => {
  it("keeps the explicit model inventory complete and duplicate-free", () => {
    expect(STATIC_MATCH_CRITERIA_RULE_MODEL_NAMES).toHaveLength(73);
    expect(new Set(STATIC_MATCH_CRITERIA_RULE_MODEL_NAMES).size).toBe(73);
  });

  it.each(STATIC_MATCH_CRITERIA_RULE_MODEL_NAMES)(
    "%s inherits the shared criteria JSON column and its API access control",
    (modelName: string) => {
      const Model: ModelType = getRegisteredModelType(modelName);
      const model: DatabaseBaseModel = new Model();

      expect(model).toBeInstanceOf(RuleBaseModel);
      expect(model.getTableColumns().columns).toContain("criteria");
      expect(model.getTableColumnMetadata("criteria").type).toBe(
        TableColumnType.JSON,
      );
      expect(model.getColumnAccessControlFor("criteria")).toEqual({
        create: model.getCreatePermissions(),
        read: model.getReadPermissions(),
        update: model.getUpdatePermissions(),
      });
    },
  );

  it.each(RELATION_ONLY_RULE_MODEL_NAMES)(
    "%s uses the nullable fail-closed enabled-state encoding",
    (modelName: string) => {
      const Model: ModelType = getRegisteredModelType(modelName);
      const model: DatabaseBaseModel = new Model();
      const enabledColumn: ColumnMetadataArgs | undefined =
        getMetadataArgsStorage().columns.find(
          (column: ColumnMetadataArgs): boolean => {
            return (
              column.target === Model && column.propertyName === "isEnabled"
            );
          },
        );
      const compatibilityCheck: CheckMetadataArgs | undefined =
        getMetadataArgsStorage().checks.find(
          (check: CheckMetadataArgs): boolean => {
            return (
              check.target === Model &&
              String(check.expression).includes(
                '"criteria" IS NULL OR "isEnabled" IS DISTINCT FROM true',
              )
            );
          },
        );

      expect(model).toBeInstanceOf(RelationOnlyRuleBaseModel);
      expect(enabledColumn?.options.nullable).toBe(true);
      expect(compatibilityCheck).toBeDefined();
    },
  );

  it("leaves MetricPipelineRule on DatabaseBaseModel with its existing filter schema", () => {
    const model: MetricPipelineRule = new MetricPipelineRule();

    expect(Object.getPrototypeOf(MetricPipelineRule.prototype)).toBe(
      DatabaseBaseModel.prototype,
    );
    expect(model).not.toBeInstanceOf(RuleBaseModel);
    expect(model.getTableColumns().columns).not.toContain("criteria");
    expect(model.getTableColumns().columns).toContain("filterCondition");
    expect(model.getTableColumns().columns).toContain("filters");
    expect(model.getTableColumnMetadata("filterCondition").type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata("filters").type).toBe(
      TableColumnType.JSON,
    );
  });
});
