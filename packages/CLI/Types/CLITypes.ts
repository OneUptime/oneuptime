import {
  CliAction,
  CliOperation,
} from "Common/Utils/DeveloperDocs/CliCommands";

export interface CLIContext {
  name: string;
  apiUrl: string;
  apiKey: string;
}

export interface CLIConfig {
  currentContext: string;
  contexts: Record<string, CLIContext>;
}

export enum OutputFormat {
  JSON = "json",
  Table = "table",
  Wide = "wide",
}

/*
 * A resource command: one per resource of the OneUptime API, with a
 * subcommand for each request the API takes for it (operations) and for
 * each button the dashboard has on it (actions). Worked out from the models
 * by Common/Utils/DeveloperDocs/CliResources.
 */
export interface ResourceInfo {
  name: string;
  singularName: string;
  pluralName: string;
  apiPath: string;
  tableName: string;
  modelType: "database" | "analytics";
  operations: Array<CliOperation>;
  actions: Array<CliAction>;
}

export interface ResolvedCredentials {
  apiUrl: string;
  apiKey: string;
}
