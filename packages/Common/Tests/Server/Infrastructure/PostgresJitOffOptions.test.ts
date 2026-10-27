import { describe, expect, jest, test } from "@jest/globals";
import { postgresStartupOptions } from "../../../Server/Infrastructure/Postgres/DataSourceOptions";

/*
 * Every connection turns Postgres's JIT compiler off.
 *
 * Postgres compiles a statement to machine code once its estimated cost
 * passes jit_above_cost, and the reads behind incident and alert rules pass
 * it on empty tables: 170-210 ms compiling each, against 4 ms planning and
 * running it, seven of them for every incident or alert created. Creating
 * incidents and alerts through the API took Postgres 3.7 to 4.8 cores with
 * JIT on and 0.7 to 0.8 with it off (Scripts/Perf, 2026-10-27).
 *
 * jit=off rides in the libpq `options` startup parameter beside
 * idle_session_timeout, and only while that is sent, as before: an install
 * that set DATABASE_IDLE_SESSION_TIMEOUT_MS=0 keeps the parameter off its
 * connections. PostgresJitOffPostgres.test.ts holds a real Postgres to it.
 *
 * The module reads env at import time, so each case re-imports it in isolation.
 */

interface DataSourceExtra {
  options?: string;
}

/* Runs `load` on fresh module instances, with `env` set for its duration. */
function withEnv(
  env: Record<string, string | undefined>,
  load: () => void,
): void {
  jest.isolateModules(() => {
    const previous: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(env)) {
      previous[key] = process.env[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    try {
      load();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
}

function loadExtra(env: Record<string, string | undefined>): DataSourceExtra {
  let extra: DataSourceExtra = {};

  withEnv(env, () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const options: {
      default: { extra: DataSourceExtra };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require("../../../Server/Infrastructure/Postgres/DataSourceOptions");
    /* eslint-enable @typescript-eslint/no-var-requires */

    extra = options.default.extra;
  });

  return extra;
}

// The settings a libpq `options` string sets, in order.
function settingsOf(options: string | undefined): Array<string> {
  return (options || "")
    .split(" -c ")
    .map((part: string) => {
      return part.replace(/^-c /, "").trim();
    })
    .filter((part: string) => {
      return part.length > 0;
    });
}

describe("Postgres's JIT compiler is off on every connection", () => {
  test("the default connection sends jit=off beside idle_session_timeout", () => {
    const extra: DataSourceExtra = loadExtra({
      DATABASE_IDLE_SESSION_TIMEOUT_MS: undefined,
    });

    expect(settingsOf(extra.options)).toEqual([
      "idle_session_timeout=300000",
      "jit=off",
    ]);
  });

  test("a configured idle_session_timeout is still sent as it is", () => {
    const extra: DataSourceExtra = loadExtra({
      DATABASE_IDLE_SESSION_TIMEOUT_MS: "900000",
    });

    expect(settingsOf(extra.options)).toEqual([
      "idle_session_timeout=900000",
      "jit=off",
    ]);
  });

  /*
   * Turning the timeout off kept the startup parameter off the connection,
   * which is how an install behind a pooler that refuses it connects. It
   * still does: the parameter is not sent for jit alone.
   */
  test("with idle_session_timeout off, no startup options are sent at all", () => {
    const extra: DataSourceExtra = loadExtra({
      DATABASE_IDLE_SESSION_TIMEOUT_MS: "0",
    });

    expect(extra.options).toBeUndefined();
    expect(Object.keys(extra)).not.toContain("options");
  });

  test("the options are libpq's -c form, one setting each", () => {
    expect(postgresStartupOptions(300000)).toEqual({
      options: "-c idle_session_timeout=300000 -c jit=off",
    });
    expect(postgresStartupOptions(0)).toEqual({});
    expect(postgresStartupOptions(-1)).toEqual({});
  });
});
