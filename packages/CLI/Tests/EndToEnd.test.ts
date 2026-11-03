import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * THE CLI AGAINST A REAL ONEUPTIME
 *
 * Creates, lists, reads, changes and deletes several kinds of record
 * through the CLI as npm publishes it (the bundle, build/dist/Index.js),
 * with --json, the way a script or an AI agent drives it: labels, a
 * monitor, an incident with one of the project's severities - acknowledged,
 * noted and resolved by its own commands - a team and its member named by
 * email address.
 *
 * It needs a OneUptime and a project API key of it with Project Admin:
 *
 *   ONEUPTIME_E2E_URL=http://localhost:3000 \
 *   ONEUPTIME_E2E_API_KEY=<key> \
 *   ONEUPTIME_E2E_USER_EMAIL=<a member's address> \
 *   npx jest Tests/EndToEnd
 *
 * Without them it is skipped: CLI Test has no OneUptime to run against.
 * Every record it makes is named after the run and deleted at the end.
 */

const URL_VARIABLE: string = "ONEUPTIME_E2E_URL";
const KEY_VARIABLE: string = "ONEUPTIME_E2E_API_KEY";
const EMAIL_VARIABLE: string = "ONEUPTIME_E2E_USER_EMAIL";

const SERVER_URL: string = process.env[URL_VARIABLE] || "";
const API_KEY: string = process.env[KEY_VARIABLE] || "";
const MEMBER_EMAIL: string = process.env[EMAIL_VARIABLE] || "";

const describeAgainstServer: jest.Describe =
  SERVER_URL && API_KEY ? describe : describe.skip;

const CLI_ROOT: string = path.resolve(__dirname, "..");
const BUNDLE: string = path.join(CLI_ROOT, "build", "dist", "Index.js");

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  json: unknown;
}

let home: string;

// Runs the bundled CLI with the key and the address in the environment.
function cli(args: Array<string>): Run {
  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [BUNDLE, ...args],
    {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "",
        HOME: home,
        NO_COLOR: "1",
        ONEUPTIME_URL: SERVER_URL,
        ONEUPTIME_API_KEY: API_KEY,
      },
      timeout: 60000,
    },
  );
  let json: unknown = undefined;

  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    json,
  };
}

// Runs a command that must work, and its JSON answer.
function ok<T>(args: Array<string>): T {
  const run: Run = cli(args);

  if (run.status !== 0) {
    throw new Error(
      `oneuptime ${args.join(" ")} exited ${run.status}:\n${run.stderr}${run.stdout}`,
    );
  }

  return run.json as T;
}

// An ID as the API answers it: "x" or {"_type": "ObjectID", "value": "x"}.
function idOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const wrapped: { value?: unknown; _id?: unknown } = (value || {}) as {
    value?: unknown;
    _id?: unknown;
  };

  return String(wrapped.value || wrapped._id || "");
}

interface Row {
  _id: unknown;
  [key: string]: unknown;
}

describeAgainstServer("the CLI against a real OneUptime", () => {
  const run: string = `cli-e2e-${Date.now()}`;
  const created: Array<[string, string]> = [];

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-e2e-"));

    if (!fs.existsSync(BUNDLE)) {
      const build: SpawnSyncReturns<string> = spawnSync(
        "npm",
        ["run", "build"],
        {
          cwd: CLI_ROOT,
          encoding: "utf8",
        },
      );

      expect(build.status).toBe(0);
    }
  }, 300000);

  afterAll(() => {
    // Newest first: a member before its team, an incident before its monitor.
    for (const [resource, id] of [...created].reverse()) {
      cli([resource, "delete", id, "--json"]);
    }
  }, 300000);

  it("checks the key with OneUptime, and finds the key's project", () => {
    const whoami: {
      authenticated: boolean;
      project: { _id: string; name: string } | null;
      versionsMatch: boolean | null;
    } = ok(["whoami", "--check", "--json"]);

    expect(whoami.authenticated).toBe(true);
    expect(whoami.project?._id).toBeTruthy();
    expect(whoami.versionsMatch).not.toBe(false);
  });

  it("creates, finds, changes, reads and deletes labels", () => {
    const label: Row = ok([
      "label",
      "create",
      "--name",
      `${run} label`,
      "--color",
      "#32a852",
      "--json",
    ]);
    const labelId: string = idOf(label._id);

    created.push(["label", labelId]);
    expect(labelId).toBeTruthy();

    const found: Array<Row> = ok([
      "label",
      "list",
      "--query",
      JSON.stringify({ name: `${run} label` }),
      "--fields",
      "name,color",
      "--json",
    ]);

    expect(
      found.map((row: Row) => {
        return idOf(row._id);
      }),
    ).toEqual([labelId]);

    ok([
      "label",
      "update",
      labelId,
      "--description",
      "Changed by the CLI",
      "--json",
    ]);

    const read: Row = ok([
      "label",
      "get",
      labelId,
      "--fields",
      "name,description",
      "--json",
    ]);

    expect(read["description"]).toBe("Changed by the CLI");

    const all: Array<Row> = ok(["label", "list", "--all", "--json"]);

    expect(
      all.map((row: Row) => {
        return idOf(row._id);
      }),
    ).toContain(labelId);
    expect(
      ok<number>([
        "label",
        "count",
        "--query",
        JSON.stringify({ _id: labelId }),
        "--json",
      ]),
    ).toBe(1);
  });

  it("creates a monitor with a label, by flags", () => {
    const labelId: string = (created.find(
      ([resource]: [string, string]): boolean => {
        return resource === "label";
      },
    ) || ["", ""])[1];
    const monitor: Row = ok([
      "monitor",
      "create",
      "--name",
      `${run} monitor`,
      "--monitor-type",
      "Manual",
      "--labels",
      labelId,
      "--json",
    ]);
    const monitorId: string = idOf(monitor._id);

    created.push(["monitor", monitorId]);

    const read: Row = ok([
      "monitor",
      "get",
      monitorId,
      "--fields",
      "name,labels",
      "--json",
    ]);

    expect(read["name"]).toBe(`${run} monitor`);
    expect(JSON.stringify(read["labels"])).toContain(labelId);
  });

  it("declares an incident with one of the project's severities, then acknowledges, notes and resolves it", () => {
    const severities: Array<Row> = ok([
      "incident-severity",
      "list",
      "--sort",
      '{"order":"ASC"}',
      "--limit",
      "1",
      "--json",
    ]);
    const monitorId: string = (created.find(
      ([resource]: [string, string]): boolean => {
        return resource === "monitor";
      },
    ) || ["", ""])[1];
    const incident: Row = ok([
      "incident",
      "create",
      "--title",
      `${run} incident`,
      "--incident-severity-id",
      idOf(severities[0]?._id),
      "--monitors",
      monitorId,
      "--json",
    ]);
    const incidentId: string = idOf(incident._id);

    created.push(["incident", incidentId]);

    const acknowledged: { changed: boolean; state: { name: string } } = ok([
      "incident",
      "acknowledge",
      incidentId,
      "--json",
    ]);

    expect(acknowledged.changed).toBe(true);
    // Twice is once: nothing changes the second time.
    expect(
      ok<{ changed: boolean }>([
        "incident",
        "acknowledge",
        incidentId,
        "--json",
      ]).changed,
    ).toBe(false);

    const note: { _id: string; visibility: string } = ok([
      "incident",
      "add-note",
      incidentId,
      "--note",
      "Noted by the CLI's end-to-end run.",
      "--json",
    ]);

    expect(note.visibility).toBe("internal");
    expect(
      idOf(ok<Row>(["incident-internal-note", "get", note._id, "--json"])._id),
    ).toBe(note._id);

    expect(
      ok<{ changed: boolean }>(["incident", "resolve", incidentId, "--json"])
        .changed,
    ).toBe(true);

    const state: Row = ok([
      "incident",
      "get",
      incidentId,
      "--fields",
      "currentIncidentState.isResolvedState",
      "--json",
    ]);

    expect(JSON.stringify(state["currentIncidentState"])).toContain("true");
  });

  it("makes a team, and adds a member to it by email address", () => {
    const team: Row = ok(["team", "create", "--name", `${run} team`, "--json"]);
    const teamId: string = idOf(team._id);

    created.push(["team", teamId]);

    if (!MEMBER_EMAIL) {
      return;
    }

    const member: Row = ok([
      "team-member",
      "create",
      "--team-id",
      teamId,
      "--user-email",
      MEMBER_EMAIL.toUpperCase(),
      "--json",
    ]);

    created.push(["team-member", idOf(member._id)]);

    const members: Array<Row> = ok([
      "team-member",
      "list",
      "--query",
      JSON.stringify({ teamId }),
      "--fields",
      "userId",
      "--json",
    ]);

    expect(members).toHaveLength(1);
  });

  it("answers a record that is not there with exit code 3, and a JSON error", () => {
    const missing: Run = cli([
      "incident",
      "get",
      "0f0e0d0c-0b0a-4908-8706-050403020100",
      "--json",
    ]);

    expect(missing.status).toBe(3);
    expect(JSON.parse(missing.stderr.trim()).error.exitCode).toBe(3);
  });

  it("deletes what it made, answering JSON", () => {
    const [resource, id] = created.pop() as [string, string];

    expect(
      ok<{ deleted: boolean }>([resource, "delete", id, "--json"]),
    ).toEqual({
      _id: id,
      deleted: true,
    });
  });
});
