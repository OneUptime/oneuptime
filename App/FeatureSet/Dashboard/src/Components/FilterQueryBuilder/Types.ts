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

export interface FilterBuilderConfig {
  fields: Array<FilterFieldDefinition>;
  defaultCondition: FilterConditionData;
  supportCustomAttributes: boolean;
  customAttributeLabel?: string;
  customAttributeDescription?: string;
  entityNameSingular: string;
  entityNamePlural: string;
}
