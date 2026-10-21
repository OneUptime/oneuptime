enum LogPipelineProcessorType {
  GrokParser = "GrokParser",
  KeyValueParser = "KeyValueParser",
  AttributeRemapper = "AttributeRemapper",
  SeverityRemapper = "SeverityRemapper",
  CategoryProcessor = "CategoryProcessor",
}

export interface GrokParserConfig {
  source: string; // field to parse, e.g. "body"
  pattern: string; // grok pattern
  targetPrefix?: string; // prefix for extracted attributes
}

/*
 * Splits a line of key=value pairs (Sophos XGS, Fortinet, logfmt) into
 * attributes, whatever order the fields arrive in. Parsing rules live in
 * Common/Utils/Log/KeyValueParser.ts.
 */
export interface KeyValueParserConfig {
  source: string; // field to parse, e.g. "body"
  targetPrefix?: string; // prefix for extracted attributes, e.g. "sophos"
  pairDelimiter?: string; // separates pairs (default: any whitespace)
  keyValueDelimiter?: string; // separates a key from its value (default "=")
  /*
   * Overwrite an attribute that already exists under the same key
   * (default false). Off by default because the keys come from the log
   * line itself - whoever can send a line could otherwise replace the
   * attributes ingest set, such as the device or service it came from.
   */
  overrideOnConflict?: boolean;
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
  | KeyValueParserConfig
  | AttributeRemapperConfig
  | SeverityRemapperConfig
  | CategoryProcessorConfig;

export default LogPipelineProcessorType;
