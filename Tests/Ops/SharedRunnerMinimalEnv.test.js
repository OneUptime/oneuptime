"use strict";

/**
 * The shared Runner (the `runner` service in docker-compose.base.yml) serves
 * AI code fixes for every project that has no Runner of its own, so it must
 * hold ONLY what it needs to reach the OneUptime server and report telemetry:
 * never the server's runtime secrets.
 *
 * It reaches the server with ONEUPTIME_RUNNER_KEY alone, which the app is
 * given as well, and holds no cluster key (ONEUPTIME_SECRET, which opens every
 * route OneUptime's own services call each other on); its LLM calls are
 * mediated by the server. So its environment is x-common-runner-variables
 * plus a few service-level keys — deliberately NOT a merge of
 * x-common-runtime-variables, the app's whole environment.
 *
 * This test holds that: it fails the moment the runner service is wired to the
 * app's environment again. It reads the compose file directly (js-yaml resolves
 * the `<<` anchor merge), so it needs no Docker.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Server secrets the app runs with that the shared Runner must never hold.
const FORBIDDEN_SECRET_ENV_NAMES = [
  "ONEUPTIME_SECRET",
  "ENCRYPTION_SECRET",
  "DATABASE_PASSWORD",
  "DATABASE_SSL_KEY",
  "CLICKHOUSE_PASSWORD",
  "VALKEY_PASSWORD",
  "REDIS_PASSWORD",
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

describe("the shared Runner's Docker Compose environment is minimal", () => {
  let runnerEnv;

  beforeAll(() => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );
    runnerEnv = compose.services.runner.environment;
  });

  test("holds exactly what the Runner needs, and nothing else", () => {
    const names = Object.keys(runnerEnv).sort();

    expect(names).toEqual(
      [
        "BILLING_ENABLED",
        "DISABLE_TELEMETRY",
        "ENABLE_PROFILING",
        "LOG_LEVEL",
        "NODE_ENV",
        "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
        "ONEUPTIME_RUNNER_ENABLE_RUNBOOKS",
        "ONEUPTIME_RUNNER_KEY",
        "ONEUPTIME_RUNNER_SHARED",
        "ONEUPTIME_URL",
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
        "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
        "PORT",
      ].sort(),
    );
  });

  test("holds what it needs to reach the server", () => {
    expect(runnerEnv.ONEUPTIME_URL).toBe("${ONEUPTIME_RUNNER_ONEUPTIME_URL}");
    // Its own key, which it registers and authenticates as the shared
    // (global) agent with.
    expect(runnerEnv.ONEUPTIME_RUNNER_KEY).toBe("${ONEUPTIME_RUNNER_KEY}");
    // It is the installation's shared Runner, which registers with that key
    // and needs no id from the dashboard.
    expect(runnerEnv.ONEUPTIME_RUNNER_SHARED).toBe("true");
  });

  test("holds no cluster key, from the shared anchor or the service itself", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    expect(compose["x-common-runner-variables"]).not.toHaveProperty(
      "ONEUPTIME_SECRET",
    );
    expect(runnerEnv).not.toHaveProperty("ONEUPTIME_SECRET");
  });

  test("the app is given the same ONEUPTIME_RUNNER_KEY, which it lets the Runner register with", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    expect(compose.services.app.environment.ONEUPTIME_RUNNER_KEY).toBe(
      runnerEnv.ONEUPTIME_RUNNER_KEY,
    );
  });

  test("no other service is given the Runner's key", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    /*
     * The key's value, whatever variable carries it: the bundled global
     * Runner reads its own key from a variable of the same name.
     */
    const holders = Object.keys(compose.services)
      .filter((name) => {
        const environment = compose.services[name].environment || {};

        return Object.values(environment).some((value) => {
          return value === runnerEnv.ONEUPTIME_RUNNER_KEY;
        });
      })
      .sort();

    expect(runnerEnv.ONEUPTIME_RUNNER_KEY).toBe("${ONEUPTIME_RUNNER_KEY}");
    expect(holders).toEqual(["app", "runner"]);
  });

  test("the bundled global Runner holds a key of its own, not the shared Runner's", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    expect(
      compose.services["global-runner"].environment.ONEUPTIME_RUNNER_KEY,
    ).toBe("${GLOBAL_RUNNER_KEY}");
  });

  test("holds none of the server's runtime secrets", () => {
    for (const name of FORBIDDEN_SECRET_ENV_NAMES) {
      expect(runnerEnv).not.toHaveProperty(name);
    }
  });

  test("the app, by contrast, still holds them (the trim is the Runner's alone)", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );
    const appEnv = compose.services.app.environment;

    expect(appEnv).toHaveProperty("ENCRYPTION_SECRET");
    expect(appEnv).toHaveProperty("DATABASE_PASSWORD");
    expect(appEnv).toHaveProperty("GITHUB_APP_PRIVATE_KEY");
  });
});
