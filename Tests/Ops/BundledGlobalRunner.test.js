"use strict";

/**
 * The bundled global Runner (the `global-runner` service in Docker Compose,
 * the `globalRunner` deployment in the Helm chart) runs the runbook
 * JavaScript steps of every project that uses global Runners. It is the
 * Runner image started with the fixed id of
 * packages/Common/Types/Runner/BundledGlobalRunner.ts and its own key, and
 * the server keeps its row from the same key (GLOBAL_RUNNER_KEY, the App's
 * SeedBundledGlobalRunner startup migration).
 *
 * What this holds, reading the files as they are (js-yaml resolves the `<<`
 * anchor merges), so it needs no Docker:
 *
 *   - Compose runs it by default, from the Runner image, and
 *     GLOBAL_RUNNER_REPLICAS=0 turns it off;
 *   - it holds its own key and NOTHING else: no cluster key, none of the
 *     server's settings or secrets, and it sits on the oneuptime network
 *     rather than the host's;
 *   - the id it starts with is the one the server keeps its row under, in
 *     Compose and in the Helm chart alike;
 *   - the server's containers get the same key, and how many run, so the row
 *     is removed when it is turned off;
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
  "CLICKHOUSE_PASSWORD",
  "VALKEY_PASSWORD",
  "REDIS_PASSWORD",
  "REGISTER_PROBE_KEY",
  "GLOBAL_RUNNER_KEY",
  "GITHUB_APP_PRIVATE_KEY",
  "BILLING_PRIVATE_KEY",
  "SLACK_APP_CLIENT_SECRET",
  "GLOBAL_LLM_PROVIDER_API_KEY",
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
        "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
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

  test("turns code fixes and AI commands off on the host, whatever the server says", () => {
    expect(service.environment.ONEUPTIME_RUNNER_ENABLE_CODE_FIXES).toBe(
      "false",
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

  test("the shared code-fix Runner never gets the global Runner's key", () => {
    expect(base.services.runner.environment).not.toHaveProperty(
      "GLOBAL_RUNNER_KEY",
    );
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

  test("the SaaS e2e stack leaves it out, with the runner", () => {
    const billing = yaml.load(read("packages/E2E/docker-compose.billing.yml"));

    expect(billing.services["global-runner"]).toEqual({
      profiles: ["billing-disabled"],
    });
    expect(billing.services.runner).toEqual({
      profiles: ["billing-disabled"],
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
});
