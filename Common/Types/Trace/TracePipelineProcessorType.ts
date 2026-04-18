enum TracePipelineProcessorType {
  AttributeRemapper = "AttributeRemapper",
  SpanNameRemapper = "SpanNameRemapper",
  StatusRemapper = "StatusRemapper",
  SpanKindRemapper = "SpanKindRemapper",
  CategoryProcessor = "CategoryProcessor",
}

export interface AttributeRemapperConfig {
  sourceKey: string;
  targetKey: string;
  preserveSource?: boolean;
  overrideOnConflict?: boolean;
}

export interface SpanNameRemapperConfig {
  sourceKey: string;
  mappings: Array<{
    matchValue: string;
    newName: string;
  }>;
}

export interface StatusRemapperConfig {
  sourceKey: string;
  mappings: Array<{
    matchValue: string;
    statusCode: number;
    statusMessage?: string;
  }>;
}

export interface SpanKindRemapperConfig {
  sourceKey: string;
  mappings: Array<{
    matchValue: string;
    kind: string;
  }>;
}

export interface CategoryProcessorConfig {
  targetKey: string;
  categories: Array<{
    name: string;
    filterQuery: string;
  }>;
}

export type TracePipelineProcessorConfig =
  | AttributeRemapperConfig
  | SpanNameRemapperConfig
  | StatusRemapperConfig
  | SpanKindRemapperConfig
  | CategoryProcessorConfig;

export default TracePipelineProcessorType;
