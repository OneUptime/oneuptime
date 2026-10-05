export interface FilterConditionData {
  field: string;
  operator: string;
  value: string;
}

export type LogicalConnector = "AND" | "OR";

export interface FilterFieldValueOption {
  value: string;
  label: string;
  description?: string;
}

export type FilterFieldValueType = "text" | "number" | "dropdown" | "boolean";

export interface FilterFieldDefinition {
  key: string;
  label: string;
  description?: string;
  valueType: FilterFieldValueType;
  valueOptions?: Array<FilterFieldValueOption>;
  valuePlaceholder?: string;
  getValuePillClass?: (value: string) => string;
}

/*
 * The labels, descriptions, placeholders and entity names are English keys
 * (wrap them in translationKey() where they are not a label or description),
 * looked up where the builder shows them. The entity names go into its
 * sentences as terms: "Build filter rules to target specific logs."
 */
export interface FilterBuilderConfig {
  fields: Array<FilterFieldDefinition>;
  defaultCondition: FilterConditionData;
  supportCustomAttributes: boolean;
  customAttributeLabel?: string;
  customAttributeDescription?: string;
  entityNameSingular: string;
  entityNamePlural: string;
}
