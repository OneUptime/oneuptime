import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const BASE_COMPOSE_PATH: string = path.join(
  REPO_ROOT,
  "docker-compose.base.yml",
);
const E2E_ACCESS_COMPOSE_PATH: string = path.join(
  REPO_ROOT,
  "docker-compose.e2e-access.yml",
);
const DEV_COMPOSE_PATH: string = path.join(REPO_ROOT, "docker-compose.dev.yml");
const TEST_RELEASE_WORKFLOW_PATH: string = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "test-release.yaml",
);

const CLICKHOUSE_ENVIRONMENT_NAMES: ReadonlyArray<string> = [
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_PORT",
];

const CLICKHOUSE_OPTIONAL_ENVIRONMENT: ReadonlyArray<
  readonly [string, string]
> = [
  ["CLICKHOUSE_IS_HOST_HTTPS", "${CLICKHOUSE_IS_HOST_HTTPS:-false}"],
  ["E2E_CLICKHOUSE_URL", "${E2E_CLICKHOUSE_URL:-}"],
  ["E2E_CLICKHOUSE_DATABASE", "${E2E_CLICKHOUSE_DATABASE:-}"],
  ["E2E_CLICKHOUSE_HOST", "${E2E_CLICKHOUSE_HOST:-}"],
  ["E2E_CLICKHOUSE_PORT", "${E2E_CLICKHOUSE_PORT:-}"],
];

interface ComposeService {
  environment?: Record<string, string>;
  network_mode?: string;
  ports?: Array<string>;
}

interface ComposeFile {
  services: Record<string, ComposeService>;
  "x-common-variables": Record<string, string>;
}

describe("E2E ClickHouse deployment configuration", () => {
  const compose: ComposeFile = yaml.load(
    fs.readFileSync(BASE_COMPOSE_PATH, "utf8"),
  ) as ComposeFile;
  const e2eEnvironment: Record<string, string> =
    compose.services["e2e"]!.environment!;

  test.each(CLICKHOUSE_ENVIRONMENT_NAMES)(
    "passes %s directly to the E2E fixture process",
    (environmentName: string) => {
      expect(e2eEnvironment[environmentName]).toBe(`\${${environmentName}}`);
    },
  );

  test.each(CLICKHOUSE_OPTIONAL_ENVIRONMENT)(
    "forwards the optional %s fixture override",
    (environmentName: string, composeExpression: string) => {
      expect(e2eEnvironment[environmentName]).toBe(composeExpression);
    },
  );

  test("does not expose ClickHouse credentials through the frontend-safe common variables", () => {
    for (const environmentName of CLICKHOUSE_ENVIRONMENT_NAMES) {
      expect(compose["x-common-variables"][environmentName]).toBeUndefined();
    }
  });

  test("publishes ClickHouse only on loopback in the E2E access overlay", () => {
    const accessCompose: ComposeFile = yaml.load(
      fs.readFileSync(E2E_ACCESS_COMPOSE_PATH, "utf8"),
    ) as ComposeFile;

    expect(accessCompose.services["clickhouse"]?.ports).toEqual([
      "127.0.0.1:8189:8123",
    ]);
  });

  test("keeps the host-networked E2E fixture aligned with the dev ClickHouse port", () => {
    const devCompose: ComposeFile = yaml.load(
      fs.readFileSync(DEV_COMPOSE_PATH, "utf8"),
    ) as ComposeFile;

    expect(compose.services["e2e"]?.network_mode).toBe("host");
    expect(devCompose.services["clickhouse"]?.ports).toContain("8189:8123");
  });

  test("starts both release-test stacks with the E2E access overlay", () => {
    const workflow: string = fs.readFileSync(
      TEST_RELEASE_WORKFLOW_PATH,
      "utf8",
    );

    expect(workflow).toContain(
      "docker compose -f docker-compose.billing.yml -f docker-compose.e2e-access.yml up --remove-orphans -d",
    );
    expect(workflow).toContain(
      "docker compose -f docker-compose.yml -f docker-compose.e2e-access.yml up --remove-orphans -d",
    );
  });
});
