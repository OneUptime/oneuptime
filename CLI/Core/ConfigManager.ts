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
    defaults: {
      output: "table",
      limit: 10,
    },
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
    (ctx: CLIContext): CLIContext & { isCurrent: boolean } => ({
      ...ctx,
      isCurrent: ctx.name === config.currentContext,
    }),
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

  // Priority 2: Environment variables
  const envApiKey: string | undefined = process.env["ONEUPTIME_API_KEY"];
  const envUrl: string | undefined = process.env["ONEUPTIME_URL"];
  if (envApiKey && envUrl) {
    return { apiKey: envApiKey, apiUrl: envUrl };
  }

  // Priority 3: Specific context if specified via --context flag
  if (cliOptions.context) {
    const config: CLIConfig = load();
    const ctx: CLIContext | undefined = config.contexts[cliOptions.context];
    if (ctx) {
      return { apiKey: ctx.apiKey, apiUrl: ctx.apiUrl };
    }
    throw new Error(`Context "${cliOptions.context}" does not exist.`);
  }

  // Priority 4: Current context in config file
  const currentCtx: CLIContext | null = getCurrentContext();
  if (currentCtx) {
    return { apiKey: currentCtx.apiKey, apiUrl: currentCtx.apiUrl };
  }

  // Partial env vars + partial context
  if (envApiKey || envUrl) {
    const ctx: CLIContext | null = getCurrentContext();
    return {
      apiKey: envApiKey || ctx?.apiKey || "",
      apiUrl: envUrl || ctx?.apiUrl || "",
    };
  }

  throw new Error(
    "No credentials found. Run `oneuptime login` or set ONEUPTIME_API_KEY and ONEUPTIME_URL environment variables.",
  );
}
