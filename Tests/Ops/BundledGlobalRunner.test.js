"use strict";

/**
 * The bundled global Runner (the `global-runner` service in Docker Compose,
 * the `globalRunner` deployment in the Helm chart) runs the runbook
 * JavaScript steps and the AI code fixes of every project that uses global
 * Runners, and never a repository's own commands. It is the Runner image
 * started with the fixed id of
 * packages/Common/Types/Runner/BundledGlobalRunner.ts and its own key, and
 * the server keeps its row from the same key (GLOBAL_RUNNER_KEY, the App's
 * SeedBundledGlobalRunner startup migration). It took over the AI code fixes
 * of the shared Runner (the `runner` service and deployment), which is gone.
 *
 * What this holds, reading the files as they are (js-yaml resolves the `<<`
 * anchor merges), so it needs no Docker:
 *
 *   - Compose runs it by default, from the Runner image, and
 *     GLOBAL_RUNNER_REPLICAS=0 turns it off;
 *   - it holds its own key and NOTHING else: no cluster key, none of the
 *     server's settings or secrets, and it sits on the oneuptime network
 *     rather than the host's;
 *   - it leaves code fixes to the server, which grants them to global
 *     Runners, and turns AI commands off on the host;
 *   - the id it starts with is the one the server keeps its row under, in
 *     Compose and in the Helm chart alike;
 *   - the server's containers get the same key, and how many run, so the row
 *     is removed when it is turned off;
 *   - no shared Runner is left: no `runner` service, no ONEUPTIME_RUNNER_KEY
 *     for the app, none of its settings in config.example.env;
 *   - config.example.env ships the key as a placeholder that npm start
 *     replaces (ReplacePlaceholderSecrets).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const BUNDLED_ID_PATTERN =
  /export const BUNDLED_GLOBAL_RUNNER_ID: string =\s*"([0-9a-f-]{36})";/;

// The id as packages/Common/Types/Runner/BundledGlobalRunner.ts writes it.
function bundledGlobalRunnerId() {
  const match = BUNDLED_ID_PATTERN.exec(
    read("packages/Common/Types/Runner/BundledGlobalRunner.ts"),
  );

  if (!match) {
    throw new Error("BUNDLED_GLOBAL_RUNNER_ID is not where this test reads it");
  }

  return match[1];
}

// Server secrets and settings the global Runner must never hold.
const FORBIDDEN_ENV_NAMES = [
  "ONEUPTIME_SECRET",
  "ENCRYPTION_SECRET",
  "DATABASE_PASSWORD",
  "DATABASE_HOST",
  "DATABASE_SSL_KEY",
  "CLICKHOUSE_PASSWORD",
  "VALKEY_PASSWORD",
  "REDIS_PASSWORD",
  "REGISTER_PROBE_KEY",
  "GLOBAL_RUNNER_KEY",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_WEBHOOK_SECRET",
  "BILLING_PRIVATE_KEY",
  "BILLING_WEBHOOK_SECRET",
  "SLACK_APP_CLIENT_SECRET",
  "SLACK_APP_SIGNING_SECRET",
  "MICROSOFT_TEAMS_APP_CLIENT_SECRET",
  "ZOOM_APP_CLIENT_SECRET",
  "ZOOM_APP_WEBHOOK_SECRET_TOKEN",
  "GOOGLE_MEET_APP_CLIENT_SECRET",
  "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET",
  "MICROSOFT_SIGN_IN_CLIENT_SECRET",
  "CAPTCHA_SECRET_KEY",
  "LETS_ENCRYPT_ACCOUNT_KEY",
  "AWS_MARKETPLACE_SECRET_ACCESS_KEY",
  "AWS_MARKETPLACE_EVENTS_SECRET",
  "AZURE_MARKETPLACE_CLIENT_SECRET",
  "GOOGLE_CLOUD_MARKETPLACE_SERVICE_ACCOUNT_KEY",
  "QUEUE_DASHBOARD_SECRET",
  "GLOBAL_LLM_PROVIDER_API_KEY",
];

// The shared Runner's settings, which nothing reads now that it is gone.
const SHARED_RUNNER_SETTINGS = [
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_ONEUPTIME_URL",
  "ONEUPTIME_RUNNER_PORT",
];

describe("the bundled global Runner in Docker Compose", () => {
  const base = yaml.load(read("docker-compose.base.yml"));
  const top = yaml.load(read("docker-compose.yml"));
  const service = base.services["global-runner"];

  test("is defined in docker-compose.base.yml and run by docker-compose.yml, from the Runner image", () => {
    expect(service).toBeDefined();
    expect(top.services["global-runner"]).toEqual(
      expect.objectContaining({
        image: "oneuptime/runner:${APP_TAG}",
        extends: {
          file: "./docker-compose.base.yml",
          service: "global-runner",
        },
      }),
    );
  });

  test("runs one by default, and none with GLOBAL_RUNNER_REPLICAS=0", () => {
    expect(service.deploy).toEqual({
      replicas: "${GLOBAL_RUNNER_REPLICAS:-1}",
    });
  });

  test("holds exactly what a global Runner needs, and nothing else", () => {
    expect(Object.keys(service.environment).sort()).toEqual(
      [
        "DISABLE_TELEMETRY",
        "ENABLE_PROFILING",
        "LOG_LEVEL",
        "NODE_ENV",
        "ONEUPTIME_RUNNER_CONCURRENCY",
        "ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS",
        "ONEUPTIME_RUNNER_ID",
        "ONEUPTIME_RUNNER_KEY",
        "ONEUPTIME_URL",
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
        "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
        "PORT",
      ].sort(),
    );
  });

  test("starts with the id the server keeps its row under, and the global Runner's key", () => {
    expect(service.environment.ONEUPTIME_RUNNER_ID).toBe(
      bundledGlobalRunnerId(),
    );
    expect(service.environment.ONEUPTIME_RUNNER_KEY).toBe(
      "${GLOBAL_RUNNER_KEY}",
    );
  });

  test("reaches the app over the oneuptime network, never the host's", () => {
    expect(service.environment.ONEUPTIME_URL).toBe("http://app:${APP_PORT}");
    expect(service.networks).toEqual(["oneuptime"]);
    expect(service).not.toHaveProperty("network_mode");
  });

  test("holds none of the server's secrets or settings, the cluster key included", () => {
    for (const name of FORBIDDEN_ENV_NAMES) {
      expect(service.environment).not.toHaveProperty(name);
    }
  });

  test("the app, by contrast, holds them: the trim is the global Runner's alone", () => {
    const appEnvironment = base.services.app.environment;

    expect(appEnvironment).toHaveProperty("ONEUPTIME_SECRET");
    expect(appEnvironment).toHaveProperty("ENCRYPTION_SECRET");
    expect(appEnvironment).toHaveProperty("DATABASE_PASSWORD");
    expect(appEnvironment).toHaveProperty("GITHUB_APP_PRIVATE_KEY");
  });

  /*
   * The server grants code fixes to global Runners and never AI commands. A
   * host override of "false" would refuse the code fixes the global Runner
   * now does in place of the shared Runner, so there is none; AI commands
   * stay off on the host too.
   */
  test("leaves code fixes to the server, and turns AI commands off on the host", () => {
    expect(service.environment).not.toHaveProperty(
      "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
    );
    expect(service.environment.ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS).toBe(
      "false",
    );
  });

  test("the app gets the same key, and how many global Runners run, to keep the row by", () => {
    const appEnvironment = base.services.app.environment;

    expect(appEnvironment.GLOBAL_RUNNER_KEY).toBe("${GLOBAL_RUNNER_KEY}");
    expect(appEnvironment.GLOBAL_RUNNER_REPLICAS).toBe(
      "${GLOBAL_RUNNER_REPLICAS:-1}",
    );
  });

  /*
   * The global Runner does the AI code fixes the shared Runner did, so the
   * shared Runner is gone from every stack, and so is the key the app let it
   * register with.
   */
  test("no stack runs the shared Runner, and the app gets no ONEUPTIME_RUNNER_KEY", () => {
    const dev = yaml.load(read("Scripts/Dev/docker-compose.dev.yml"));

    for (const compose of [base, top, dev]) {
      expect(compose.services).not.toHaveProperty("runner");
    }

    expect(base).not.toHaveProperty("x-common-runner-variables");
    expect(base.services.app.environment).not.toHaveProperty(
      "ONEUPTIME_RUNNER_KEY",
    );

    for (const name of Object.keys(base.services)) {
      const environment = base.services[name].environment || {};

      expect(environment).not.toHaveProperty("ONEUPTIME_RUNNER_SHARED");

      for (const value of Object.values(environment)) {
        for (const setting of SHARED_RUNNER_SETTINGS) {
          expect(String(value)).not.toContain(setting);
        }
      }
    }
  });

  test("the development stack runs it too, built from source", () => {
    const dev = yaml.load(read("Scripts/Dev/docker-compose.dev.yml"));

    expect(dev.services["global-runner"]).toEqual(
      expect.objectContaining({
        extends: {
          file: "./docker-compose.base.yml",
          service: "global-runner",
        },
        build: {
          context: ".",
          dockerfile: "./packages/Runner/Dockerfile",
        },
      }),
    );
  });

  test("the SaaS e2e stack leaves it out", () => {
    const billing = yaml.load(read("packages/E2E/docker-compose.billing.yml"));

    expect(billing.services["global-runner"]).toEqual({
      profiles: ["billing-disabled"],
    });
  });

  test("the SaaS e2e stack turns it off in the app too, so no project waits for it", () => {
    const billing = yaml.load(read("packages/E2E/docker-compose.billing.yml"));

    // The setting the app's seed reads: zero replicas removes the row.
    expect(billing.services.app).toEqual({
      environment: { GLOBAL_RUNNER_REPLICAS: "0" },
    });
  });
});

describe("the bundled global Runner's key at install", () => {
  const template = read("config.example.env");

  function settingOf(name) {
    const line = template.split("\n").find((candidate) => {
      return candidate.startsWith(`${name}=`);
    });

    return line === undefined ? undefined : line.slice(name.length + 1);
  }

  test("config.example.env ships the key as a placeholder, and one global Runner", () => {
    expect(settingOf("GLOBAL_RUNNER_KEY")).toBe(
      "please-change-this-to-random-value",
    );
    expect(settingOf("GLOBAL_RUNNER_REPLICAS")).toBe("1");
    expect(settingOf("GLOBAL_RUNNER_CONCURRENCY")).toBe("4");
  });

  test("config.example.env holds none of the shared Runner's settings", () => {
    for (const name of SHARED_RUNNER_SETTINGS) {
      expect(settingOf(name)).toBeUndefined();
    }
  });

  test("npm start gives the key a random value", () => {
    const {
      GENERATED_SECRETS,
      replacePlaceholderSecrets,
    } = require("../../Scripts/Install/ReplacePlaceholderSecrets");

    expect(GENERATED_SECRETS).toContain("GLOBAL_RUNNER_KEY");

    const result = replacePlaceholderSecrets(template, () => {
      return "a-fresh-global-runner-key";
    });

    expect(result.replaced).toContain("GLOBAL_RUNNER_KEY");
    expect(result.contents).toContain(
      "\nGLOBAL_RUNNER_KEY=a-fresh-global-runner-key\n",
    );
  });
});

describe("the bundled global Runner in the Helm chart", () => {
  const deployment = read(
    "HelmChart/Public/oneuptime/templates/global-runner.yaml",
  );

  test("starts with the same fixed id", () => {
    expect(deployment).toContain(
      `- name: ONEUPTIME_RUNNER_ID\n              value: "${bundledGlobalRunnerId()}"`,
    );
  });

  test("never includes the server's environment or the cluster key", () => {
    for (const helper of [
      "oneuptime.env.common",
      "oneuptime.env.runtime",
      "oneuptime.env.oneuptimeSecret",
      "oneuptime.env.registerProbeKey",
    ]) {
      expect(deployment).not.toContain(`include "${helper}"`);
    }
  });

  test("is on by default", () => {
    const values = yaml.load(read("HelmChart/Public/oneuptime/values.yaml"));

    expect(values.globalRunner.enabled).toBe(true);
    expect(values.globalRunner.replicaCount).toBe(1);
    expect(values.globalRunner.concurrency).toBe(4);
  });

  test("leaves code fixes to the server, and turns AI commands off on the host", () => {
    expect(deployment).not.toContain("ONEUPTIME_RUNNER_ENABLE_CODE_FIXES");
    expect(deployment).toContain(
      `- name: ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS\n              value: "false"`,
    );
  });

  /*
   * The chart's own tests (HelmChart/Public/oneuptime/tests) render this;
   * here, that the shared Runner's deployment and its values are gone.
   */
  test("the chart runs no shared Runner", () => {
    const values = yaml.load(read("HelmChart/Public/oneuptime/values.yaml"));

    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "HelmChart/Public/oneuptime/templates/runner.yaml",
        ),
      ),
    ).toBe(false);
    expect(values).not.toHaveProperty("runner");
    expect(
      read("HelmChart/Public/oneuptime/templates/_helpers.tpl"),
    ).not.toContain("ONEUPTIME_RUNNER_KEY");
  });
});
