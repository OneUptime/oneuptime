export interface CLIContext {
  name: string;
  apiUrl: string;
  apiKey: string;
}

export interface CLIConfig {
  currentContext: string;
  contexts: Record<string, CLIContext>;
  defaults: {
    output: string;
    limit: number;
  };
}

export enum OutputFormat {
  JSON = "json",
  Table = "table",
  Wide = "wide",
}

export interface ResourceInfo {
  name: string;
  singularName: string;
  pluralName: string;
  apiPath: string;
  tableName: string;
  modelType: "database" | "analytics";
}

export interface ResolvedCredentials {
  apiUrl: string;
  apiKey: string;
}
