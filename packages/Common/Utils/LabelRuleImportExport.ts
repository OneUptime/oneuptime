import AlertEpisodeLabelRule from "../Models/DatabaseModels/AlertEpisodeLabelRule";
import AlertLabelRule from "../Models/DatabaseModels/AlertLabelRule";
import CephClusterLabelRule from "../Models/DatabaseModels/CephClusterLabelRule";
import CloudResourceLabelRule from "../Models/DatabaseModels/CloudResourceLabelRule";
import DashboardLabelRule from "../Models/DatabaseModels/DashboardLabelRule";
import BaseModel, {
  DatabaseBaseModelType,
} from "../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHostLabelRule from "../Models/DatabaseModels/DockerHostLabelRule";
import DockerSwarmClusterLabelRule from "../Models/DatabaseModels/DockerSwarmClusterLabelRule";
import HostLabelRule from "../Models/DatabaseModels/HostLabelRule";
import IncidentEpisodeLabelRule from "../Models/DatabaseModels/IncidentEpisodeLabelRule";
import IncidentLabelRule from "../Models/DatabaseModels/IncidentLabelRule";
import IncomingCallPolicyLabelRule from "../Models/DatabaseModels/IncomingCallPolicyLabelRule";
import IoTFleetLabelRule from "../Models/DatabaseModels/IoTFleetLabelRule";
import KubernetesClusterLabelRule from "../Models/DatabaseModels/KubernetesClusterLabelRule";
import MonitorLabelRule from "../Models/DatabaseModels/MonitorLabelRule";
import NetworkDeviceLabelRule from "../Models/DatabaseModels/NetworkDeviceLabelRule";
import OnCallDutyPolicyLabelRule from "../Models/DatabaseModels/OnCallDutyPolicyLabelRule";
import OnCallDutyPolicyScheduleLabelRule from "../Models/DatabaseModels/OnCallDutyPolicyScheduleLabelRule";
import PodmanHostLabelRule from "../Models/DatabaseModels/PodmanHostLabelRule";
import ProxmoxClusterLabelRule from "../Models/DatabaseModels/ProxmoxClusterLabelRule";
import RumApplicationLabelRule from "../Models/DatabaseModels/RumApplicationLabelRule";
import RunbookLabelRule from "../Models/DatabaseModels/RunbookLabelRule";
import ScheduledMaintenanceLabelRule from "../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ServerlessFunctionLabelRule from "../Models/DatabaseModels/ServerlessFunctionLabelRule";
import ServiceLabelRule from "../Models/DatabaseModels/ServiceLabelRule";
import StatusPageLabelRule from "../Models/DatabaseModels/StatusPageLabelRule";
import WorkflowLabelRule from "../Models/DatabaseModels/WorkflowLabelRule";
import Select from "../Types/BaseDatabase/Select";
import { ColumnAccessControl } from "../Types/BaseDatabase/AccessControl";
import { getMaxLengthFromTableColumnType } from "../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../Types/Database/TableColumn";
import TableColumnType from "../Types/Database/TableColumnType";
import BadDataException from "../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../Types/JSON";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../Types/Rules/RuleCriteria";
import ModelImportExport from "./ModelImportExport";
import {
  getRuleCriteriaValidationError,
  isValidRuleCriteria,
} from "./Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "./Rules/RulePatternMatchUtil";

export const LABEL_RULE_EXPORT_FILE_TYPE: string = "oneuptime-label-rules";
export const LABEL_RULE_EXPORT_SCHEMA_VERSION: number = 1;

// A fixed registry prevents an uploaded resourceType from selecting arbitrary models.
export const LABEL_RULE_MODELS: Array<DatabaseBaseModelType> = [
  AlertEpisodeLabelRule,
  AlertLabelRule,
  CephClusterLabelRule,
  CloudResourceLabelRule,
  DashboardLabelRule,
  DockerHostLabelRule,
  DockerSwarmClusterLabelRule,
  HostLabelRule,
  IncidentEpisodeLabelRule,
  IncidentLabelRule,
  IncomingCallPolicyLabelRule,
  IoTFleetLabelRule,
  KubernetesClusterLabelRule,
  MonitorLabelRule,
  NetworkDeviceLabelRule,
  OnCallDutyPolicyLabelRule,
  OnCallDutyPolicyScheduleLabelRule,
  PodmanHostLabelRule,
  ProxmoxClusterLabelRule,
  RumApplicationLabelRule,
  RunbookLabelRule,
  ScheduledMaintenanceLabelRule,
  ServerlessFunctionLabelRule,
  ServiceLabelRule,
  StatusPageLabelRule,
  WorkflowLabelRule,
];

export interface ParsedLabelRuleImport {
  sourceResourceType: string;
  destinationResourceType: string;
  mappings: Array<string>;
  items: Array<{ json: JSONObject; portableJson: JSONObject }>;
}

export type LabelRuleCriteriaRelationNames = Map<
  DatabaseBaseModelType,
  Map<string, string>
>;

export default class LabelRuleImportExport {
  public static isLabelRuleModel(modelType: DatabaseBaseModelType): boolean {
    return LABEL_RULE_MODELS.includes(modelType);
  }

  public static getColumns(modelType: DatabaseBaseModelType): Array<string> {
    if (!this.isLabelRuleModel(modelType)) {
      throw new BadDataException("Please select a supported label rule type.");
    }

    const model: BaseModel = new modelType();
    const columns: Array<string> =
      ModelImportExport.getImportExportableColumnNames(modelType);
    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);
      const access: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);
      if (
        metadata?.type === TableColumnType.EntityArray &&
        metadata.modelType &&
        access?.read.length &&
        access.create.length
      ) {
        columns.push(column);
      }
    }
    return columns;
  }

  public static getExportSelect<T extends BaseModel>(modelType: {
    new (): T;
  }): Select<T> {
    const select: JSONObject = { _id: true };
    const model: BaseModel = new modelType();
    for (const column of this.getColumns(modelType)) {
      select[column] =
        model.getTableColumnMetadata(column)?.type ===
        TableColumnType.EntityArray
          ? { name: true }
          : true;
    }
    return select as Select<T>;
  }

  public static buildExportEnvelope(data: {
    modelType: DatabaseBaseModelType;
    items: Array<BaseModel>;
    exportedAt?: Date | undefined;
    criteriaRelationNames?: LabelRuleCriteriaRelationNames | undefined;
  }): JSONObject {
    const model: BaseModel = new data.modelType();
    const columns: Array<string> = this.getColumns(data.modelType);
    const items: Array<JSONObject> = data.items.map(
      (item: BaseModel, index: number): JSONObject => {
        const json: JSONObject = {};
        for (const column of columns) {
          const metadata: TableColumnMetadata =
            model.getTableColumnMetadata(column)!;
          const value: unknown = item.getValue(column);
          if (column === "criteria" && value !== undefined && value !== null) {
            json[column] = this.toPortableCriteria({
              modelType: data.modelType,
              model,
              item,
              criteria: value,
              criteriaRelationNames: data.criteriaRelationNames,
              ruleIndex: index,
            }) as unknown as JSONObject;
          } else if (metadata.type === TableColumnType.EntityArray) {
            if (!Array.isArray(value)) {
              throw new BadDataException(
                `Rule ${index + 1}: ${metadata.title || column} could not be read. Refresh and try exporting again.`,
              );
            }
            json[column] = value.map((relation: BaseModel): string => {
              const name: unknown =
                relation instanceof BaseModel
                  ? relation.getValue("name")
                  : (relation as JSONObject)?.["name"];
              if (typeof name !== "string" || !name.trim()) {
                throw new BadDataException(
                  `Rule ${index + 1}: ${metadata.title || column} contains a resource without a readable name.`,
                );
              }
              return name;
            });
          } else if (value !== undefined && value !== null) {
            json[column] = value as string | boolean;
          } else if (metadata.defaultValue !== undefined) {
            json[column] = metadata.defaultValue;
          }
        }
        return json;
      },
    );
    return this.envelope({
      resourceType: model.tableName!,
      items,
      exportedAt: data.exportedAt,
    });
  }

  public static envelope(data: {
    resourceType: string;
    items: Array<JSONObject>;
    exportedAt?: Date | undefined;
  }): JSONObject {
    return {
      fileType: LABEL_RULE_EXPORT_FILE_TYPE,
      schemaVersion: LABEL_RULE_EXPORT_SCHEMA_VERSION,
      resourceType: data.resourceType,
      exportedAt: (data.exportedAt || new Date()).toISOString(),
      items: data.items,
    };
  }

  public static parse(data: {
    modelType: DatabaseBaseModelType;
    fileText: string;
  }): ParsedLabelRuleImport {
    if (new TextEncoder().encode(data.fileText).length > 10 * 1024 * 1024) {
      throw new BadDataException(
        "The label rule file must be 10 MB or smaller.",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data.fileText);
    } catch {
      throw new BadDataException(
        "This file is not valid JSON. Select a label rule JSON export file.",
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadDataException(
        "Select a label rule JSON export file containing a versioned export envelope.",
      );
    }
    const envelope: JSONObject = payload as JSONObject;
    if (
      envelope["fileType"] !== LABEL_RULE_EXPORT_FILE_TYPE ||
      envelope["schemaVersion"] !== LABEL_RULE_EXPORT_SCHEMA_VERSION
    ) {
      throw new BadDataException(
        "This is not a supported label rule export. Expected oneuptime-label-rules schema version 1.",
      );
    }
    const sourceType: DatabaseBaseModelType | undefined =
      LABEL_RULE_MODELS.find((type: DatabaseBaseModelType): boolean => {
        return new type().tableName === envelope["resourceType"];
      });
    if (!sourceType) {
      throw new BadDataException(
        "The export has an unknown label rule resource type.",
      );
    }
    if (!Array.isArray(envelope["items"]) || !envelope["items"].length) {
      throw new BadDataException(
        "The export must contain at least one label rule in its items array.",
      );
    }
    const source: BaseModel = new sourceType();
    const destination: BaseModel = new data.modelType();
    const sourceColumns: Array<string> = this.getColumns(sourceType);
    const destinationColumns: Array<string> = this.getColumns(data.modelType);
    const mappings: Set<string> = new Set();
    const errors: Array<string> = [];
    const items: ParsedLabelRuleImport["items"] = [];

    for (const [index, row] of envelope["items"].entries()) {
      try {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          throw new BadDataException("Each rule must be an object.");
        }
        const input: JSONObject = row as JSONObject;
        const portableJson: JSONObject = {};
        const json: JSONObject = {};
        for (const column of Object.keys(input)) {
          if (!sourceColumns.includes(column)) {
            throw new BadDataException(
              `Unknown or protected field "${column}". Remove it from the file.`,
            );
          }
          const metadata: TableColumnMetadata =
            source.getTableColumnMetadata(column)!;
          if (column === "criteria") {
            if (input[column] === null || input[column] === undefined) {
              portableJson[column] = input[column];
              continue;
            }
            const mappedCriteria: RuleCriteria = this.mapPortableCriteria({
              criteria: input[column],
              sourceType,
              source,
              destination,
              destinationColumns,
              mappings,
            });
            portableJson[column] = input[column];
            json[column] = mappedCriteria as unknown as JSONObject;
            continue;
          }
          this.validateValue(
            column,
            input[column],
            metadata,
            source.tableName!,
          );
          const value: JSONValue = input[column];
          portableJson[column] = value;
          const semanticColumn: string = this.semanticColumn(source, column);
          const target: string | undefined = destinationColumns.find(
            (candidate: string): boolean => {
              return (
                this.semanticColumn(destination, candidate) === semanticColumn
              );
            },
          );
          if (!target) {
            if (this.isConfigured(value)) {
              throw new BadDataException(
                `${metadata.title || column} is configured but is not supported by ${destination.singularName}. No rules were imported.`,
              );
            }
            continue;
          }
          const targetMetadata: TableColumnMetadata =
            destination.getTableColumnMetadata(target)!;
          if (metadata.type !== targetMetadata.type) {
            throw new BadDataException(
              `${metadata.title || column} is incompatible with ${destination.singularName}.`,
            );
          }
          json[target] = value;
          if (column !== target && this.isConfigured(value)) {
            mappings.add(
              `${metadata.title || column} → ${targetMetadata.title || target}`,
            );
          }
          if (
            column.endsWith("Pattern") &&
            typeof value === "string" &&
            value.length > 0 &&
            source.tableName !== destination.tableName
          ) {
            this.validatePatternCompatibility(
              value,
              source.tableName!,
              destination.tableName!,
            );
          }
          this.validateValue(
            target,
            json[target],
            targetMetadata,
            destination.tableName!,
          );
        }
        for (const column of sourceColumns) {
          const metadata: TableColumnMetadata =
            source.getTableColumnMetadata(column)!;
          if (
            metadata.required &&
            (input[column] === null || input[column] === undefined)
          ) {
            throw new BadDataException(
              `${metadata.title || column} is required.`,
            );
          }
        }
        // Explicit defaults prevent a missing optional relation from carrying stale data.
        for (const column of destinationColumns) {
          const metadata: TableColumnMetadata =
            destination.getTableColumnMetadata(column)!;
          if (json[column] === undefined || json[column] === null) {
            if (metadata.type === TableColumnType.EntityArray) {
              json[column] = [];
            } else if (metadata.defaultValue !== undefined) {
              json[column] = metadata.defaultValue;
            } else {
              delete json[column];
            }
          }
        }
        items.push({ json, portableJson });
      } catch (error) {
        errors.push(
          `Rule ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (errors.length) {
      throw new BadDataException(
        errors.slice(0, 20).join("\n") +
          (errors.length > 20
            ? `\nAnd ${errors.length - 20} more invalid rules.`
            : ""),
      );
    }
    return {
      sourceResourceType: source.tableName!,
      destinationResourceType: destination.tableName!,
      mappings: Array.from(mappings),
      items,
    };
  }

  private static toPortableCriteria(data: {
    modelType: DatabaseBaseModelType;
    model: BaseModel;
    item: BaseModel;
    criteria: unknown;
    criteriaRelationNames?: LabelRuleCriteriaRelationNames | undefined;
    ruleIndex: number;
  }): RuleCriteria {
    const validationError: string | null = getRuleCriteriaValidationError(
      data.criteria,
    );
    if (validationError || !isValidRuleCriteria(data.criteria)) {
      throw new BadDataException(
        `Rule ${data.ruleIndex + 1}: Match Criteria is invalid. ${validationError || "Check the configured conditions."}`,
      );
    }

    const allowedFields: Array<string> = this.getColumns(data.modelType).filter(
      (column: string): boolean => {
        return column !== "criteria";
      },
    );
    const itemRelationNames: LabelRuleCriteriaRelationNames =
      this.getItemRelationNames(data.model, data.item);

    const filters: Array<RuleCriteriaFilter> = data.criteria.filters.map(
      (filter: RuleCriteriaFilter): RuleCriteriaFilter => {
        if (!allowedFields.includes(filter.field)) {
          throw new BadDataException(
            `Rule ${data.ruleIndex + 1}: Match Criteria contains unsupported field "${filter.field}".`,
          );
        }

        const metadata: TableColumnMetadata = data.model.getTableColumnMetadata(
          filter.field,
        )!;
        const relationOperator: boolean = this.isRelationCriteriaOperator(
          filter.operator,
        );

        if (metadata.type === TableColumnType.EntityArray) {
          if (!relationOperator || !metadata.modelType) {
            throw new BadDataException(
              `Rule ${data.ruleIndex + 1}: ${metadata.title || filter.field} must use a relation criteria operator.`,
            );
          }

          const externalNames: Map<string, string> | undefined =
            data.criteriaRelationNames?.get(metadata.modelType);
          const loadedNames: Map<string, string> | undefined =
            itemRelationNames.get(metadata.modelType);
          const names: Array<string> = (filter.value as Array<string>).map(
            (id: string): string => {
              const name: string | undefined =
                externalNames?.get(id) || loadedNames?.get(id);
              if (!name) {
                throw new BadDataException(
                  `Rule ${data.ruleIndex + 1}: ${metadata.title || filter.field} contains a resource that could not be read. Refresh and try exporting again.`,
                );
              }
              return name;
            },
          );
          this.validateValue(
            filter.field,
            names,
            metadata,
            data.model.tableName!,
          );
          return { ...filter, value: names };
        }

        if (relationOperator) {
          throw new BadDataException(
            `Rule ${data.ruleIndex + 1}: ${metadata.title || filter.field} does not support a relation criteria operator.`,
          );
        }

        return { ...filter };
      },
    );

    return { ...data.criteria, filters };
  }

  private static getItemRelationNames(
    model: BaseModel,
    item: BaseModel,
  ): LabelRuleCriteriaRelationNames {
    const indexes: LabelRuleCriteriaRelationNames = new Map();

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);
      if (
        metadata?.type !== TableColumnType.EntityArray ||
        !metadata.modelType
      ) {
        continue;
      }

      const relations: unknown = item.getValue(column);
      if (!Array.isArray(relations)) {
        continue;
      }

      const names: Map<string, string> =
        indexes.get(metadata.modelType) || new Map<string, string>();
      for (const relation of relations) {
        const relationObject: Record<string, unknown> = relation as Record<
          string,
          unknown
        >;
        const idValue: unknown =
          relation instanceof BaseModel
            ? relation.id
            : relationObject["_id"] || relationObject["id"];
        const nameValue: unknown =
          relation instanceof BaseModel
            ? relation.getValue("name")
            : relationObject["name"];
        const id: string = idValue?.toString() || "";
        if (id && typeof nameValue === "string" && nameValue.trim()) {
          names.set(id, nameValue);
        }
      }
      indexes.set(metadata.modelType, names);
    }

    return indexes;
  }

  private static mapPortableCriteria(data: {
    criteria: unknown;
    sourceType: DatabaseBaseModelType;
    source: BaseModel;
    destination: BaseModel;
    destinationColumns: Array<string>;
    mappings: Set<string>;
  }): RuleCriteria {
    const validationError: string | null = getRuleCriteriaValidationError(
      data.criteria,
    );
    if (validationError || !isValidRuleCriteria(data.criteria)) {
      throw new BadDataException(
        `Match Criteria is invalid. ${validationError || "Check the configured conditions."}`,
      );
    }

    const sourceColumns: Array<string> = this.getColumns(
      data.sourceType,
    ).filter((column: string): boolean => {
      return column !== "criteria";
    });
    const targetColumns: Array<string> = data.destinationColumns.filter(
      (column: string): boolean => {
        return column !== "criteria";
      },
    );

    const filters: Array<RuleCriteriaFilter> = data.criteria.filters.map(
      (filter: RuleCriteriaFilter): RuleCriteriaFilter => {
        if (!sourceColumns.includes(filter.field)) {
          throw new BadDataException(
            `Match Criteria contains unknown or protected field "${filter.field}".`,
          );
        }

        const sourceMetadata: TableColumnMetadata =
          data.source.getTableColumnMetadata(filter.field)!;
        const semanticColumn: string = this.semanticColumn(
          data.source,
          filter.field,
        );
        const target: string | undefined = targetColumns.find(
          (candidate: string): boolean => {
            return (
              this.semanticColumn(data.destination, candidate) ===
              semanticColumn
            );
          },
        );
        if (!target) {
          throw new BadDataException(
            `${sourceMetadata.title || filter.field} is configured in Match Criteria but is not supported by ${data.destination.singularName}. No rules were imported.`,
          );
        }

        const targetMetadata: TableColumnMetadata =
          data.destination.getTableColumnMetadata(target)!;
        if (sourceMetadata.type !== targetMetadata.type) {
          throw new BadDataException(
            `${sourceMetadata.title || filter.field} in Match Criteria is incompatible with ${data.destination.singularName}.`,
          );
        }

        const relationOperator: boolean = this.isRelationCriteriaOperator(
          filter.operator,
        );
        if (
          (sourceMetadata.type === TableColumnType.EntityArray) !==
          relationOperator
        ) {
          throw new BadDataException(
            `${sourceMetadata.title || filter.field} uses an incompatible Match Criteria operator.`,
          );
        }

        this.validateValue(
          target,
          filter.value,
          targetMetadata,
          data.destination.tableName!,
          filter.operator === RuleCriteriaOperator.MatchesPattern ||
            filter.operator === RuleCriteriaOperator.DoesNotMatchPattern,
        );
        if (
          typeof filter.value === "string" &&
          filter.value.length > 0 &&
          data.source.tableName !== data.destination.tableName &&
          (filter.operator === RuleCriteriaOperator.MatchesPattern ||
            filter.operator === RuleCriteriaOperator.DoesNotMatchPattern)
        ) {
          this.validatePatternCompatibility(
            filter.value,
            data.source.tableName!,
            data.destination.tableName!,
          );
        }

        if (filter.field !== target) {
          data.mappings.add(
            `${sourceMetadata.title || filter.field} → ${targetMetadata.title || target}`,
          );
        }
        return { ...filter, field: target };
      },
    );

    return { ...data.criteria, filters };
  }

  private static isRelationCriteriaOperator(
    operator: RuleCriteriaOperator,
  ): boolean {
    return [
      RuleCriteriaOperator.HasAnyOf,
      RuleCriteriaOperator.HasAllOf,
      RuleCriteriaOperator.HasNoneOf,
    ].includes(operator);
  }

  private static isConfigured(value: unknown): boolean {
    return (
      value !== undefined &&
      value !== null &&
      value !== false &&
      value !== "" &&
      (!Array.isArray(value) || value.length > 0)
    );
  }

  /*
   * Primary resource criteria have the same meaning despite their different model names.
   * Secondary monitor criteria retain their identity, so they cannot accidentally become
   * primary criteria when an incident rule is imported into monitors.
   */
  private static semanticColumn(model: BaseModel, column: string): string {
    const resource: string = model.tableName!.replace(/LabelRule$/, "");
    let prefix: string = resource[0]!.toLowerCase() + resource.slice(1);
    if (resource === "IoTFleet") {
      prefix = "iotFleet";
    }
    if (resource.endsWith("Episode")) {
      prefix = "episode";
    }
    if (
      [`${prefix}NamePattern`, `${prefix}TitlePattern`].includes(column) ||
      (["RumApplication", "CloudResource", "ServerlessFunction"].includes(
        resource,
      ) &&
        column === "nameRegexPattern") ||
      (resource === "ScheduledMaintenance" && column === "titlePattern")
    ) {
      return "$resourceNamePattern";
    }
    if (
      column === `${prefix}DescriptionPattern` ||
      (["RumApplication", "CloudResource", "ServerlessFunction"].includes(
        resource,
      ) &&
        column === "descriptionRegexPattern") ||
      (resource === "ScheduledMaintenance" && column === "descriptionPattern")
    ) {
      return "$resourceDescriptionPattern";
    }
    if (
      column === `${prefix}Labels` ||
      (["RumApplication", "CloudResource", "ServerlessFunction"].includes(
        resource,
      ) &&
        column === "matchLabels")
    ) {
      return "$resourceLabels";
    }
    if (column === "incidentSeverities" || column === "alertSeverities") {
      return "$severities";
    }
    return column;
  }

  private static validateValue(
    column: string,
    value: unknown,
    metadata: TableColumnMetadata,
    resourceType: string,
    validatePattern: boolean = true,
  ): void {
    const title: string = metadata.title || column;
    if ((value === undefined || value === null) && !metadata.required) {
      return;
    }
    if (metadata.type === TableColumnType.EntityArray) {
      if (
        !Array.isArray(value) ||
        value.some((name: unknown): boolean => {
          return typeof name !== "string" || !name.trim();
        })
      ) {
        throw new BadDataException(
          `${title} must be an array of resource names, not IDs or objects.`,
        );
      }
      if (new Set(value).size !== value.length) {
        throw new BadDataException(
          `${title} contains duplicate resource names.`,
        );
      }
      return;
    }
    if (metadata.type === TableColumnType.Boolean) {
      if (typeof value !== "boolean") {
        throw new BadDataException(`${title} must be true or false.`);
      }
      return;
    }
    if (typeof value !== "string") {
      throw new BadDataException(`${title} must be text.`);
    }
    if (metadata.required && !value.trim()) {
      throw new BadDataException(`${title} cannot be empty.`);
    }
    const maxLength: number | undefined = getMaxLengthFromTableColumnType(
      metadata.type,
    );
    if (maxLength && value.length > maxLength) {
      throw new BadDataException(
        `${title} must be at most ${maxLength} characters.`,
      );
    }
    if (validatePattern && column.endsWith("Pattern") && value) {
      const valid: boolean =
        resourceType === "NetworkDeviceLabelRule"
          ? RulePatternMatchUtil.isSupportedPattern(value)
          : RulePatternMatchUtil.isValidRegex(value);
      if (!valid) {
        throw new BadDataException(
          `${title} is not a valid ${resourceType === "NetworkDeviceLabelRule" ? "regular expression or wildcard pattern" : "regular expression"}.`,
        );
      }
    }
  }

  private static validatePatternCompatibility(
    pattern: string,
    source: string,
    destination: string,
  ): void {
    if (
      (source === "NetworkDeviceLabelRule" ||
        destination === "NetworkDeviceLabelRule") &&
      (pattern.includes("*") || pattern !== pattern.trim())
    ) {
      throw new BadDataException(
        "Network device patterns also use wildcard matching and trim surrounding whitespace. A pattern containing '*' or surrounding whitespace cannot be transferred between network devices and another rule type without changing its meaning. Edit this pattern for the destination before importing.",
      );
    }
  }
}
