import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

/*
 * E2E/Tests/Dashboard/ExceptionDetailPages.spec.ts seeds an exception
 * occurrence by writing straight to ClickHouse over HTTP
 * (E2E/Tests/Dashboard/Helpers/ExceptionOccurrenceFixture.ts), because the
 * public API deliberately cannot write ExceptionInstance.retentionDate.
 *
 * That write works only while four places agree, and none of them fails on its
 * own when they drift: the suite just reports ECONNREFUSED in jobs that run
 * after merge. It shipped exactly that way - the e2e service ran with
 * network_mode: host and no ClickHouse settings, the stacks CI starts publish
 * no ClickHouse port, and every e2e job on master failed in beforeAll. So:
 *
 *  - production compose files publish no ClickHouse port at all, and neither
 *    does the SaaS CI stack's billing overlay;
 *  - the test-only overlay publishes ClickHouse HTTP on loopback only, on the
 *    host port Scripts/Dev/docker-compose.dev.yml uses and the fixture maps to;
 *  - the host-networked e2e service receives the connection settings;
 *  - every workflow job that runs the e2e service starts its stack with the
 *    overlay (the release workflow is where a partial fix would slip through,
 *    since it only runs when a release is cut).
 *
 * The overlays live in packages/E2E but their paths are relative to the repo
 * root, which holds only while each command passes them after
 * `-f docker-compose.yml`. That is guarded here too.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const WORKFLOWS_DIRECTORY: string = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
);
const OVERLAY_FILE_NAME: string =
  "packages/E2E/docker-compose.e2e-clickhouse.yml";
const BILLING_OVERLAY_FILE_NAME: string =
  "packages/E2E/docker-compose.billing.yml";
const FIXTURE_PATH: string = path.join(
  REPO_ROOT,
  "packages",
  "E2E",
  "Tests",
  "Dashboard",
  "Helpers",
  "ExceptionOccurrenceFixture.ts",
);

const PRODUCTION_COMPOSE_FILES: Array<string> = [
  "docker-compose.base.yml",
  "docker-compose.yml",
];

const CLICKHOUSE_CONNECTION_SETTINGS: Array<string> = [
  "CLICKHOUSE_USER",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_DATABASE",
  "CLICKHOUSE_HOST",
  "CLICKHOUSE_PORT",
];

const CLICKHOUSE_HTTP_CONTAINER_PORT: string = "8123";

/*
 * The step that runs the suite:
 * `docker compose --project-directory . -f Scripts/Dev/docker-compose.dev.yml up ... e2e`,
 * or `... -f packages/E2E/docker-compose.e2e.yml up ... e2e` for the release image.
 *
 * `run --rm e2e <command>` counts too: the enterprise e2e jobs run one named
 * suite per phase, which needs `run` to override the image's default CMD. Those
 * suites use the same fixtures, so they need the same published port.
 */
const RUNS_E2E_SERVICE: RegExp =
  /docker compose\s[^\n]*-f (?:Scripts\/Dev\/docker-compose\.dev|packages\/E2E\/docker-compose\.e2e)\.yml\s+(?:up|run)\b[^\n]*\se2e\b/;
const UP_SUBCOMMAND: RegExp = /\sup(?:\s|$)/;
const DOWN_SUBCOMMAND: RegExp = /\sdown(?:\s|$)/;
const ROOT_COMPOSE_FILE_FLAG: RegExp = /-f docker-compose\.yml\s/;
const E2E_OVERLAY_FLAG: string = "-f packages/E2E/docker-compose.";
const WORKFLOW_FILE: RegExp = /\.ya?ml$/;
const FIXTURE_LOCAL_PORT: RegExp =
  /LOCAL_CLICKHOUSE_HTTP_PORT: string = "(\d+)"/;

interface ComposeService {
  ports?: Array<string>;
  network_mode?: string;
  environment?: Record<string, string>;
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
  "x-common-variables"?: Record<string, string>;
}

interface WorkflowStep {
  run?: string;
}

interface WorkflowJob {
  steps?: Array<WorkflowStep>;
}

interface WorkflowFile {
  jobs?: Record<string, WorkflowJob>;
}

interface WorkflowJobRun {
  job: string;
  runText: string;
}

interface PublishedPort {
  hostIp: string;
  hostPort: string;
  containerPort: string;
}

function readYaml<T>(filePath: string): T {
  return yaml.load(fs.readFileSync(filePath, "utf8")) as T;
}

function readCompose(fileName: string): ComposeFile {
  return readYaml<ComposeFile>(path.join(REPO_ROOT, fileName));
}

// Compose short syntax: "HOST_IP:HOST_PORT:CONTAINER_PORT" or "HOST_PORT:CONTAINER_PORT".
function parsePort(entry: string): PublishedPort {
  const parts: Array<string> = entry.split(":");

  if (parts.length === 3) {
    return {
      hostIp: parts[0]!,
      hostPort: parts[1]!,
      containerPort: parts[2]!,
    };
  }

  if (parts.length === 2) {
    return { hostIp: "", hostPort: parts[0]!, containerPort: parts[1]! };
  }

  throw new Error(`Unsupported compose port syntax: ${entry}`);
}

function clickHouseHttpHostPort(compose: ComposeFile): string | undefined {
  return (compose.services?.["clickhouse"]?.ports || [])
    .map(parsePort)
    .find((port: PublishedPort) => {
      return port.containerPort === CLICKHOUSE_HTTP_CONTAINER_PORT;
    })?.hostPort;
}

// Every workflow job, with the run scripts of its steps joined.
function readWorkflowJobRuns(): Array<WorkflowJobRun> {
  const jobRuns: Array<WorkflowJobRun> = [];

  for (const fileName of fs.readdirSync(WORKFLOWS_DIRECTORY).sort()) {
    if (!WORKFLOW_FILE.test(fileName)) {
      continue;
    }

    const workflow: WorkflowFile = readYaml<WorkflowFile>(
      path.join(WORKFLOWS_DIRECTORY, fileName),
    );

    for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
      jobRuns.push({
        job: `${fileName}#${jobName}`,
        runText: (job.steps || [])
          .map((step: WorkflowStep) => {
            return step.run || "";
          })
          .join("\n"),
      });
    }
  }

  return jobRuns;
}

function startsStackWithOverlay(runText: string): boolean {
  return runText.split("\n").some((line: string) => {
    return (
      line.includes("docker compose") &&
      line.includes(`-f ${OVERLAY_FILE_NAME}`) &&
      UP_SUBCOMMAND.test(line)
    );
  });
}

describe("E2E ClickHouse fixture access", () => {
  test.each(PRODUCTION_COMPOSE_FILES)(
    "%s publishes no ClickHouse port",
    (fileName: string) => {
      const compose: ComposeFile = readCompose(fileName);

      expect(compose.services?.["clickhouse"]).toBeDefined();
      expect(compose.services?.["clickhouse"]?.ports).toBeUndefined();
    },
  );

  test("the billing overlay leaves ClickHouse to docker-compose.yml, so the SaaS stack publishes no port either", () => {
    const overlay: ComposeFile = readCompose(BILLING_OVERLAY_FILE_NAME);

    expect(overlay.services?.["home"]).toBeDefined();
    expect(overlay.services?.["clickhouse"]).toBeUndefined();
  });

  test("the overlay publishes only ClickHouse HTTP, and only on loopback", () => {
    const overlay: ComposeFile = readCompose(OVERLAY_FILE_NAME);

    expect(Object.keys(overlay.services || {})).toEqual(["clickhouse"]);
    expect(Object.keys(overlay.services!["clickhouse"]!)).toEqual(["ports"]);

    const ports: Array<PublishedPort> =
      overlay.services!["clickhouse"]!.ports!.map(parsePort);

    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port.hostIp).toBe("127.0.0.1");
      expect(port.containerPort).toBe(CLICKHOUSE_HTTP_CONTAINER_PORT);
    }
  });

  test("the overlay, the dev stack and the fixture agree on the host port", () => {
    const fixturePort: string | undefined = fs
      .readFileSync(FIXTURE_PATH, "utf8")
      .match(FIXTURE_LOCAL_PORT)?.[1];

    expect(fixturePort).toBeDefined();
    expect(clickHouseHttpHostPort(readCompose(OVERLAY_FILE_NAME))).toBe(
      fixturePort,
    );
    expect(
      clickHouseHttpHostPort(readCompose("Scripts/Dev/docker-compose.dev.yml")),
    ).toBe(fixturePort);
  });

  test("the host-networked e2e service receives the fixture's ClickHouse settings", () => {
    const base: ComposeFile = readCompose("docker-compose.base.yml");
    const e2e: ComposeService = base.services!["e2e"]!;

    expect(e2e.network_mode).toBe("host");
    for (const name of CLICKHOUSE_CONNECTION_SETTINGS) {
      expect(e2e.environment?.[name]).toBe(`\${${name}}`);
    }
    expect(e2e.environment?.["E2E_CLICKHOUSE_URL"]).toBe(
      "${E2E_CLICKHOUSE_URL:-}",
    );

    // Passed to e2e alone, never through the variables every service shares.
    expect(base["x-common-variables"]).not.toHaveProperty(
      "CLICKHOUSE_PASSWORD",
    );
  });

  test("every workflow job that runs the e2e service starts its stack with the overlay", () => {
    const e2eJobs: Array<string> = [];
    const jobsWithoutOverlay: Array<string> = [];

    for (const { job, runText } of readWorkflowJobRuns()) {
      if (!RUNS_E2E_SERVICE.test(runText)) {
        continue;
      }

      e2eJobs.push(job);
      if (!startsStackWithOverlay(runText)) {
        jobsWithoutOverlay.push(job);
      }
    }

    // The scan must see the master and release suites, or it proves nothing.
    expect(e2eJobs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^test-release\.yaml#/),
        expect.stringMatching(/^release\.yml#/),
      ]),
    );
    expect(jobsWithoutOverlay).toEqual([]);
  });

  /*
   * A later -f resolves its paths against the first file's folder, so an
   * overlay passed on its own looks for docker-compose.base.yml inside
   * packages/E2E. And `down` on an overlay pair tears down the stack it sits
   * on, volumes included, not just the overlay's service.
   */
  test("workflows pass packages/E2E compose overlays after docker-compose.yml, and never run down on them", () => {
    const overlayCommands: Array<string> = [];
    const misusedOverlayCommands: Array<string> = [];

    for (const { job, runText } of readWorkflowJobRuns()) {
      for (const line of runText.split("\n")) {
        const overlayIndex: number = line.indexOf(E2E_OVERLAY_FLAG);

        if (!line.includes("docker compose") || overlayIndex === -1) {
          continue;
        }

        const command: string = `${job}: ${line.trim()}`;
        const rootIndex: number = line.search(ROOT_COMPOSE_FILE_FLAG);

        overlayCommands.push(command);
        if (
          rootIndex === -1 ||
          rootIndex > overlayIndex ||
          DOWN_SUBCOMMAND.test(line)
        ) {
          misusedOverlayCommands.push(command);
        }
      }
    }

    expect(overlayCommands.length).toBeGreaterThan(0);
    expect(misusedOverlayCommands).toEqual([]);
  });
});
