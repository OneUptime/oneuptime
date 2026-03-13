enum LogPipelineProcessorType {
  GrokParser = "GrokParser",
  AttributeRemapper = "AttributeRemapper",
  SeverityRemapper = "SeverityRemapper",
  CategoryProcessor = "CategoryProcessor",
}

export interface GrokParserConfig {
  source: string; // field to parse, e.g. "body"
  pattern: string; // grok pattern
  targetPrefix?: string; // prefix for extracted attributes
}

export interface AttributeRemapperConfig {
  sourceKey: string; // source attribute key
  targetKey: string; // target attribute key
  preserveSource?: boolean; // keep original key (default false)
  overrideOnConflict?: boolean; // overwrite if target exists (default true)
}

export interface SeverityRemapperConfig {
  sourceKey: string; // attribute key containing severity info
  mappings: Array<{
    matchValue: string; // value to match (case-insensitive)
    severityText: string; // mapped severity text
    severityNumber: number; // mapped severity number
  }>;
}

export interface CategoryProcessorConfig {
  targetKey: string; // attribute key to store the category
  categories: Array<{
    name: string; // category name/value
    filterQuery: string; // condition to match
  }>;
}

export type LogPipelineProcessorConfig =
  | GrokParserConfig
  | AttributeRemapperConfig
  | SeverityRemapperConfig
  | CategoryProcessorConfig;

export default LogPipelineProcessorType;
