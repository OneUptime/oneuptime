"use strict";

/**
 * One process applies the schema migrations of a Docker Compose install.
 *
 * Two of the stack's processes connect to Postgres: the App and the
 * ingress's Node sidecar (packages/Nginx). PostgresAppInstance.connect()
 * applies the pending schema migrations unless RUN_DATABASE_MIGRATIONS_ON_BOOT
 * is "false", and Compose set it for neither, so on a first boot the two
 * migrated the same database at once: "deadlock detected", "relation ...
 * already exists" and "index ... does not exist" failures that only the
 * runner's retries got past (#8417). The ingress now leaves the migrations
 * to the App and waits until they are applied (SchemaMigrationWait), as the
 * Helm chart's runtime pods wait for its migrate Job.
 *
 * These tests hold the list of the services that connect to Postgres, and,
 * with docker's compose plugin on PATH (no daemon needed), render each stack
 * OneUptime starts and expect the App to apply the migrations and the
 * ingress to wait for them. Ops Config Test sets
 * RUN_COMPOSE_DATABASE_RUNTIME_TESTS, so there the rendering fails rather
 * than skips when docker is missing.
 */

const fs = require("fs");
const path = require("path");
const {
  REPO_ROOT,
  hasDockerCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

// The call that applies the schema migrations, unless they are off.
const CONNECTS_TO_POSTGRES = "PostgresAppInstance.connect(";

// The package each Compose service that connects to Postgres runs.
const SERVICES_THAT_CONNECT = { App: "app", Nginx: "ingress" };

// The one service that applies the migrations.
const MIGRATING_SERVICE = "app";

// The stacks OneUptime starts, as `npm start`, `npm run dev` and CI's e2e jobs name them.
const STACKS = [
  { name: "npm start", files: ["docker-compose.yml"] },
  { name: "npm run dev", files: ["Scripts/Dev/docker-compose.dev.yml"] },
  {
    name: "the e2e stack",
    files: [
      "docker-compose.yml",
      "packages/E2E/docker-compose.billing.yml",
      "packages/E2E/docker-compose.e2e-clickhouse.yml",
    ],
  },
];

describe("the services that connect to Postgres", () => {
  test("are the App and the ingress: every package whose entry connects is listed", () => {
    const connecting = fs
      .readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((name) => {
        const entry = path.join(REPO_ROOT, "packages", name, "Index.ts");

        return (
          fs.existsSync(entry) &&
          fs.readFileSync(entry, "utf8").includes(CONNECTS_TO_POSTGRES)
        );
      })
      .sort();

    expect(connecting).toEqual(Object.keys(SERVICES_THAT_CONNECT).sort());
  });
});

const REQUIRE_DOCKER = process.env.RUN_COMPOSE_DATABASE_RUNTIME_TESTS === "1";
const describeWithCompose =
  REQUIRE_DOCKER || hasDockerCompose() ? describe : describe.skip;

describeWithCompose("as Compose renders the stacks", () => {
  // A service's RUN_DATABASE_MIGRATIONS_ON_BOOT and wait, as the stack gives them.
  function migrationSettingsOf(stack, service) {
    const environment =
      renderCompose(stack.files).services[service].environment || {};

    return {
      runsMigrations: environment.RUN_DATABASE_MIGRATIONS_ON_BOOT !== "false",
      waitTimeoutMs: environment.DATABASE_MIGRATION_WAIT_TIMEOUT_MS,
    };
  }

  test.each(STACKS)(
    "$name: the App applies the migrations, and the ingress waits for them",
    (stack) => {
      for (const service of Object.values(SERVICES_THAT_CONNECT)) {
        const settings = migrationSettingsOf(stack, service);

        expect({ service, runsMigrations: settings.runsMigrations }).toEqual({
          service,
          runsMigrations: service === MIGRATING_SERVICE,
        });

        // A process that does not migrate waits for them: "0" would not.
        if (service !== MIGRATING_SERVICE) {
          expect(settings.waitTimeoutMs).not.toBe("0");
        }
      }
    },
  );
});
