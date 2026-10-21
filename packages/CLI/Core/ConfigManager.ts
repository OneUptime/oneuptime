import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CLIConfig, CLIContext, ResolvedCredentials } from "../Types/CLITypes";

const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");

function getDefaultConfig(): CLIConfig {
  return {
    currentContext: "",
    contexts: {},
  };
}

export function load(): CLIConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return getDefaultConfig();
    }
    const raw: string = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as CLIConfig;
  } catch {
    return getDefaultConfig();
  }
}

export function save(config: CLIConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export function getCurrentContext(): CLIContext | null {
  const config: CLIConfig = load();
  if (!config.currentContext) {
    return null;
  }
  return config.contexts[config.currentContext] || null;
}

export function setCurrentContext(name: string): void {
  const config: CLIConfig = load();
  if (!config.contexts[name]) {
    throw new Error(`Context "${name}" does not exist.`);
  }
  config.currentContext = name;
  save(config);
}

export function addContext(context: CLIContext): void {
  const config: CLIConfig = load();
  config.contexts[context.name] = context;
  if (!config.currentContext) {
    config.currentContext = context.name;
  }
  save(config);
}

export function removeContext(name: string): void {
  const config: CLIConfig = load();
  if (!config.contexts[name]) {
    throw new Error(`Context "${name}" does not exist.`);
  }
  delete config.contexts[name];
  if (config.currentContext === name) {
    const remaining: string[] = Object.keys(config.contexts);
    config.currentContext = remaining[0] || "";
  }
  save(config);
}

export function listContexts(): Array<CLIContext & { isCurrent: boolean }> {
  const config: CLIConfig = load();
  return Object.values(config.contexts).map(
    (ctx: CLIContext): CLIContext & { isCurrent: boolean } => {
      return {
        ...ctx,
        isCurrent: ctx.name === config.currentContext,
      };
    },
  );
}

export interface CLIOptions {
  apiKey?: string | undefined;
  url?: string | undefined;
  context?: string | undefined;
}

export function getResolvedCredentials(
  cliOptions: CLIOptions,
): ResolvedCredentials {
  // Priority 1: CLI flags
  if (cliOptions.apiKey && cliOptions.url) {
    return { apiKey: cliOptions.apiKey, apiUrl: cliOptions.url };
  }

  function applyCliOverrides(creds: ResolvedCredentials): ResolvedCredentials {
    return {
      apiKey: cliOptions.apiKey || creds.apiKey,
      apiUrl: cliOptions.url || creds.apiUrl,
    };
  }

  // Priority 2: Environment variables
  const envApiKey: string | undefined = process.env["ONEUPTIME_API_KEY"];
  const envUrl: string | undefined = process.env["ONEUPTIME_URL"];
  if (envApiKey && envUrl) {
    return applyCliOverrides({ apiKey: envApiKey, apiUrl: envUrl });
  }

  // Priority 3: Specific context if specified via --context flag
  if (cliOptions.context) {
    const config: CLIConfig = load();
    const ctx: CLIContext | undefined = config.contexts[cliOptions.context];
    if (ctx) {
      return applyCliOverrides({
        apiKey: envApiKey || ctx.apiKey,
        apiUrl: envUrl || ctx.apiUrl,
      });
    }
    throw new Error(`Context "${cliOptions.context}" does not exist.`);
  }

  // Priority 4: Current context in config file
  const currentCtx: CLIContext | null = getCurrentContext();
  if (currentCtx) {
    return applyCliOverrides({
      apiKey: envApiKey || currentCtx.apiKey,
      apiUrl: envUrl || currentCtx.apiUrl,
    });
  }

  // Partial env vars with no saved context to fill the other field
  if (envApiKey || envUrl) {
    return applyCliOverrides({
      apiKey: envApiKey || "",
      apiUrl: envUrl || "",
    });
  }

  throw new Error(
    "No credentials found. Run `oneuptime login` or set ONEUPTIME_API_KEY and ONEUPTIME_URL environment variables.",
  );
}

/*
 * The address of the OneUptime a command talks to when it needs no API key
 * (oneuptime deploy writes with an ingestion key): the --url flag, then
 * ONEUPTIME_URL, then the named or the current context's address.
 */
export function getResolvedInstanceUrl(cliOptions: CLIOptions): string {
  if (cliOptions.url) {
    return cliOptions.url;
  }

  const envUrl: string | undefined = process.env["ONEUPTIME_URL"];

  if (envUrl) {
    return envUrl;
  }

  if (cliOptions.context) {
    const ctx: CLIContext | undefined = load().contexts[cliOptions.context];

    if (!ctx) {
      throw new Error(`Context "${cliOptions.context}" does not exist.`);
    }

    return ctx.apiUrl;
  }

  const currentCtx: CLIContext | null = getCurrentContext();

  if (currentCtx) {
    return currentCtx.apiUrl;
  }

  throw new Error(
    "No OneUptime URL found. Pass --url, set ONEUPTIME_URL, or run `oneuptime login`.",
  );
}

/*
 * The telemetry ingestion key a command that sends telemetry writes with:
 * the --ingestion-key flag, then ONEUPTIME_TELEMETRY_INGESTION_KEY. An API
 * key is not one - telemetry is written with a project's ingestion key.
 */
export function getResolvedIngestionKey(flag: string | undefined): string {
  const key: string | undefined =
    flag || process.env["ONEUPTIME_TELEMETRY_INGESTION_KEY"];

  if (!key) {
    throw new Error(
      "No telemetry ingestion key found. Pass --ingestion-key or set ONEUPTIME_TELEMETRY_INGESTION_KEY; create one under Project Settings → Telemetry & APM → Ingestion Keys.",
    );
  }

  return key;
}
