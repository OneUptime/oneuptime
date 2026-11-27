import {
  AI_DATABASE_PASSWORD_ENV,
  AI_DATABASE_USERNAME_ENV,
  DATABASE_PASSWORD_ENV,
  DATABASE_USERNAME_ENV,
  DatabaseSettings,
  DatabaseSettingsResult,
  resolveDatabaseSettings,
  unescapeCollectorValue,
} from "../Executors/Database/DatabaseSettings";
import {
  DATABASE_AGENT_WORK_VERSION,
  DatabaseAgentDataObservabilityPosture,
  DatabaseAgentEngine,
  getDatabaseAgentEngineOfSystem,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";

/*
 * WHETHER, AND WITH WHICH LOGINS, THIS DATABASE AGENT READS ITS DATABASES
 * FOR DATA OBSERVABILITY (#11148) - all of it the agent owner's to say, in
 * the .env the agent shares with the collector:
 *
 *   ONEUPTIME_DATA_OBSERVABILITY=true      turns it on. Anything else, or
 *                                          nothing, leaves it off: an agent
 *                                          installed for engine metrics and
 *                                          AI diagnostics never starts
 *                                          reading catalogs because someone
 *                                          chose it in OneUptime.
 *   ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME / _PASSWORD
 *                                          the login the catalog is read
 *                                          with: table and column names,
 *                                          row estimates, sizes, counters.
 *                                          Without one, the collector's
 *                                          monitoring login - never the AI
 *                                          agent's, which may signal other
 *                                          sessions.
 *   ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME / _PASSWORD
 *                                          the login checks and freshness
 *                                          columns are read with: they read
 *                                          the tables' rows (one number
 *                                          each), so they may need SELECT
 *                                          the catalog login does not have.
 *                                          Without one, the catalog login.
 *   ONEUPTIME_DATA_OBSERVABILITY_CHECKS=false
 *                                          runs no check at all: the
 *                                          catalog alone.
 *   ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL=true
 *                                          runs the project's Custom SQL and
 *                                          Failing Rows checks: the one
 *                                          shape a person writes, so off
 *                                          unless its owner turns it on.
 *
 * The endpoint, TLS and engine are the collector's own (DatabaseSettings).
 * Logins are read as written, no $$ halving, as the AI agent's own are;
 * the collector's are halved, as it reads them.
 */

export const DATA_OBSERVABILITY_ENV: string = "ONEUPTIME_DATA_OBSERVABILITY";
export const DATA_OBSERVABILITY_USERNAME_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_DATABASE_USERNAME";
export const DATA_OBSERVABILITY_PASSWORD_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_DATABASE_PASSWORD";
export const DATA_OBSERVABILITY_CHECKS_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_CHECKS";
export const DATA_OBSERVABILITY_CHECKS_USERNAME_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_CHECKS_USERNAME";
export const DATA_OBSERVABILITY_CHECKS_PASSWORD_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_CHECKS_PASSWORD";
export const DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL_ENV: string =
  "ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL";

// One login, and the variables it came from (never its password).
export interface DataObservabilityLogin {
  username: string;
  // Never logged, printed or reported.
  password: string;
  source: string;
}

export interface DataObservabilitySettings {
  isOn: boolean;
  // ONEUPTIME_DATA_OBSERVABILITY as set, or null.
  setting: string | null;
  // Why it is off though it was asked to be on.
  offReason: string | null;
  engine: DatabaseAgentEngine | null;
  // The collector's endpoint and TLS; null while it is off.
  database: DatabaseSettings | null;
  catalogLogin: DataObservabilityLogin | null;
  checksLogin: DataObservabilityLogin | null;
  runsChecks: boolean;
  runsCustomSql: boolean;
}

function readRaw(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value : "";
}

const OFF: Omit<DataObservabilitySettings, "setting" | "offReason"> = {
  isOn: false,
  engine: null,
  database: null,
  catalogLogin: null,
  checksLogin: null,
  runsChecks: false,
  runsCustomSql: false,
};

// A login of these two variables, when either is set.
function readOwnLogin(
  env: NodeJS.ProcessEnv,
  usernameVariable: string,
  passwordVariable: string,
): DataObservabilityLogin | null {
  const username: string = readRaw(env, usernameVariable).trim();
  const password: string = readRaw(env, passwordVariable);

  if (!username && !password) {
    return null;
  }

  return {
    username,
    password,
    source: `${usernameVariable}/${passwordVariable}`,
  };
}

export function resolveDataObservabilitySettings(
  env: NodeJS.ProcessEnv,
): DataObservabilitySettings {
  const raw: string = readRaw(env, DATA_OBSERVABILITY_ENV).trim();
  const setting: string | null = raw || null;

  // Only the exact value: a typo never turns reading on.
  if (raw !== "true") {
    return { ...OFF, setting, offReason: null };
  }

  const off: (reason: string) => DataObservabilitySettings = (
    reason: string,
  ): DataObservabilitySettings => {
    return { ...OFF, setting, offReason: reason };
  };

  const catalogLogin: DataObservabilityLogin = readOwnLogin(
    env,
    DATA_OBSERVABILITY_USERNAME_ENV,
    DATA_OBSERVABILITY_PASSWORD_ENV,
  ) || {
    username: unescapeCollectorValue(
      readRaw(env, DATABASE_USERNAME_ENV).trim(),
    ),
    password: unescapeCollectorValue(readRaw(env, DATABASE_PASSWORD_ENV)),
    source: `${DATABASE_USERNAME_ENV}/${DATABASE_PASSWORD_ENV}`,
  };

  if (!catalogLogin.username) {
    return off(
      `Set ${DATA_OBSERVABILITY_USERNAME_ENV} and ${DATA_OBSERVABILITY_PASSWORD_ENV}, or the collector's ${DATABASE_USERNAME_ENV}, to the login Data Observability reads the catalog with.`,
    );
  }

  /*
   * The collector's endpoint, engine and TLS, read as the AI agent reads
   * them - with this login in place of the AI agent's own, which Data
   * Observability never uses.
   */
  const resolved: DatabaseSettingsResult = resolveDatabaseSettings({
    ...env,
    [AI_DATABASE_USERNAME_ENV]: catalogLogin.username,
    [AI_DATABASE_PASSWORD_ENV]: catalogLogin.password,
  });

  if (!resolved.settings) {
    return off(resolved.problem);
  }

  const engine: DatabaseAgentEngine | null = getDatabaseAgentEngineOfSystem(
    resolved.settings.system,
  );

  if (!engine) {
    return off(
      `Data Observability reads PostgreSQL, MySQL and MariaDB databases, and this agent's DATABASE_SYSTEM is ${resolved.settings.system}.`,
    );
  }

  const checksLogin: DataObservabilityLogin = readOwnLogin(
    env,
    DATA_OBSERVABILITY_CHECKS_USERNAME_ENV,
    DATA_OBSERVABILITY_CHECKS_PASSWORD_ENV,
  ) || { ...catalogLogin };

  if (!checksLogin.username) {
    return off(
      `Set ${DATA_OBSERVABILITY_CHECKS_USERNAME_ENV} to the login of ${DATA_OBSERVABILITY_CHECKS_PASSWORD_ENV}.`,
    );
  }

  const runsChecks: boolean =
    readRaw(env, DATA_OBSERVABILITY_CHECKS_ENV).trim().toLowerCase() !==
    "false";

  return {
    isOn: true,
    setting,
    offReason: null,
    engine,
    database: resolved.settings,
    catalogLogin,
    checksLogin,
    runsChecks,
    runsCustomSql:
      runsChecks &&
      readRaw(env, DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL_ENV).trim() === "true",
  };
}

// What the posture tells OneUptime: never a login, never an endpoint.
export function getDataObservabilityPosture(
  settings: DataObservabilitySettings,
): DatabaseAgentDataObservabilityPosture {
  return {
    isOn: settings.isOn,
    setting: settings.setting,
    offReason: settings.offReason,
    engine: settings.engine,
    runsChecks: settings.runsChecks,
    runsCustomSql: settings.runsCustomSql,
    workVersion: DATABASE_AGENT_WORK_VERSION,
  };
}

// Whether the two logins are one: then checks run on the catalog's connection.
export function isSameLogin(
  a: DataObservabilityLogin | null,
  b: DataObservabilityLogin | null,
): boolean {
  return Boolean(
    a && b && a.username === b.username && a.password === b.password,
  );
}
