"use strict";

/**
 * `npm run backup` tells the server how it went (Scripts/Install/
 * BackupScriptRun.js, #7026), so the Admin Dashboard's Server Setup measures
 * the server's backups instead of asking.
 *
 * Its rules, each tested here:
 *   - a backup is a dump pg_dump finished that is not empty; what the server
 *     is told is that, and the dump's size, nothing else;
 *   - it asks the ingress on this server (ONEUPTIME_HTTP_PORT), never HOST,
 *     with the cluster key from config.env in the clusterkey header,
 *     URI-encoded - and with no key of its own (empty, or still the
 *     placeholder) it asks nothing;
 *   - rollout: an older server (404), a key it refuses, a server that is
 *     down, each said in one line, and never a failed backup; a redirect is
 *     never followed, so the key's header goes nowhere else;
 *   - it never changes how the backup went: backup.sh ignores its exit code
 *     (BackupRestoreScripts holds that).
 *
 * The whole run once with stubs, and as backup.sh runs it - the script,
 * with node, its settings in the environment - against real HTTP servers.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const {
  BACKUP_SCRIPT_RUN_PATH,
  backupOutcomeOf,
  describeAnswer,
  run,
} = require("../../Scripts/Install/BackupScriptRun");

const REPO_ROOT = path.resolve(__dirname, "../..");
const TOOL = path.join(REPO_ROOT, "Scripts/Install/BackupScriptRun.js");
const SECRET = "Ab+c/d=e@f&g%h-" + "a".repeat(40);

describe("how the run went", () => {
  test("a backup is a dump pg_dump finished that is not empty", () => {
    expect(backupOutcomeOf("0", 4096)).toEqual({
      succeeded: true,
      sizeInBytes: 4096,
    });
    expect(backupOutcomeOf(0, 1)).toEqual({ succeeded: true, sizeInBytes: 1 });
  });

  test("pg_dump failed, wrote nothing, or wrote an empty file: a failed run, with no size", () => {
    expect(backupOutcomeOf("1", 4096)).toEqual({
      succeeded: false,
      sizeInBytes: null,
    });
    expect(backupOutcomeOf("0", 0)).toEqual({
      succeeded: false,
      sizeInBytes: null,
    });
    expect(backupOutcomeOf("0", null)).toEqual({
      succeeded: false,
      sizeInBytes: null,
    });
    expect(backupOutcomeOf(undefined, 10)).toEqual({
      succeeded: false,
      sizeInBytes: null,
    });
  });
});

describe("what it says", () => {
  const SUCCEEDED = { succeeded: true, sizeInBytes: 10 };
  const FAILED = { succeeded: false, sizeInBytes: null };

  test("told: where to see it", () => {
    expect(
      describeAnswer({ status: 200 }, SUCCEEDED, "http://localhost"),
    ).toEqual({
      told: true,
      line: "OneUptime was told about this backup: Server Setup in the Admin Dashboard shows when the last one finished.",
    });
    expect(
      describeAnswer({ status: 200 }, FAILED, "http://localhost").line,
    ).toBe(
      "OneUptime was told that this backup failed: Server Setup in the Admin Dashboard says so until a backup succeeds.",
    );
  });

  test("an older server, a key it refused, one that failed, one that is down: not told, and why", () => {
    expect(
      describeAnswer({ status: 404 }, SUCCEEDED, "http://localhost"),
    ).toEqual({
      told: false,
      line: "This OneUptime does not record backups yet, so Server Setup still asks whether the server is backed up. Update it with npm run update, and the next backup tells it.",
    });
    expect(
      describeAnswer({ status: 400 }, SUCCEEDED, "http://localhost").line,
    ).toBe(
      "OneUptime did not accept ONEUPTIME_SECRET from config.env (HTTP 400), so it was not told about this backup. Run npm run doctor to see why.",
    );
    expect(
      describeAnswer({ status: 503 }, SUCCEEDED, "http://localhost").line,
    ).toBe(
      "OneUptime could not record this backup (HTTP 503). Run npm run doctor to see why.",
    );
    expect(
      describeAnswer(
        { error: "ECONNREFUSED" },
        SUCCEEDED,
        "http://localhost:8080",
      ),
    ).toEqual({
      told: false,
      line: "OneUptime did not answer at http://localhost:8080 (ECONNREFUSED), so it was not told about this backup. Start it with npm start, and the next backup tells it.",
    });
  });

  test("never the key, in any line", () => {
    for (const answer of [
      { status: 200 },
      { status: 400 },
      { status: 404 },
      { status: 500 },
      { error: "ETIMEDOUT" },
    ]) {
      expect(
        describeAnswer(answer, SUCCEEDED, "http://localhost").line,
      ).not.toContain(SECRET);
    }
  });
});

describe("whom it asks, with what", () => {
  const stubbed = (env, size) => {
    const asked = [];
    const printed = [];

    return {
      asked,
      printed,
      given: {
        argv: ["0", "/srv/oneuptime/Backups/db-17.backup"],
        env: env,
        print: (line) => {
          printed.push(line);
        },
        sizeOf: () => {
          return size;
        },
        request: async (url, options) => {
          asked.push({ url, options });
          return { status: 200, json: { recorded: true } };
        },
      },
    };
  };

  test("the ingress on this server, with the key URI-encoded in the clusterkey header, and how it went as the body", async () => {
    const run_ = stubbed(
      {
        ONEUPTIME_SECRET: SECRET,
        ONEUPTIME_HTTP_PORT: "8080",
        HOST: "oneuptime.example.com",
      },
      7340032,
    );

    expect(await run(run_.given)).toBe(0);
    expect(run_.asked).toEqual([
      {
        url: `http://localhost:8080${BACKUP_SCRIPT_RUN_PATH}`,
        options: {
          method: "POST",
          headers: { clusterkey: encodeURIComponent(SECRET) },
          body: { succeeded: true, sizeInBytes: 7340032 },
        },
      },
    ]);
    // Never HOST, and never the key but in its header.
    expect(JSON.stringify(run_.asked)).not.toContain("oneuptime.example.com");
    expect(JSON.stringify(run_.asked[0].options.body)).not.toContain("Ab+c");
    expect(run_.asked[0].url).not.toContain("Ab");
    expect(run_.printed).toEqual([
      "OneUptime was told about this backup: Server Setup in the Admin Dashboard shows when the last one finished.",
    ]);
  });

  test("the ingress where config.env moved it, and port 80 when it says nothing", async () => {
    const moved = stubbed(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: "127.0.0.1:8443" },
      1,
    );
    await run(moved.given);
    expect(moved.asked[0].url).toBe(
      "http://localhost:8443/api/admin/health/backup-run",
    );

    const unset = stubbed({ ONEUPTIME_SECRET: SECRET }, 1);
    await run(unset.given);
    expect(unset.asked[0].url).toBe(
      "http://localhost/api/admin/health/backup-run",
    );
  });

  test("no key of its own - empty, or still the placeholder - and it asks nothing", async () => {
    for (const secret of ["", "   ", "please-change-this-to-random-value"]) {
      const run_ = stubbed({ ONEUPTIME_SECRET: secret }, 10);

      expect(await run(run_.given)).toBe(1);
      expect(run_.asked).toEqual([]);
      expect(run_.printed).toEqual([
        "config.env has no ONEUPTIME_SECRET of its own, so OneUptime was not told about this backup. npm start sets one.",
      ]);
    }
  });
});

/*
 * As backup.sh runs it - `node ./Scripts/Install/BackupScriptRun.js
 * <status> <file>`, config.env's settings in its environment - against
 * servers on this machine.
 */
describe("run as backup.sh runs it", () => {
  let directory;
  let servers = [];

  const serve = async (handler) => {
    const server = http.createServer(handler);
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);
    return server.address().port;
  };

  const runTool = (env, args) => {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [TOOL, ...args],
        {
          cwd: directory,
          encoding: "utf8",
          env: { PATH: process.env.PATH || "", ...env },
          timeout: 30000,
        },
        (error, stdout) => {
          resolve({ code: error ? error.code : 0, stdout: stdout });
        },
      );
    });
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "backup-script-run-"));
    fs.writeFileSync(path.join(directory, "db-17.backup"), "PGDMP 12345");
  });

  afterEach(async () => {
    for (const server of servers) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    servers = [];
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("a new server records it: the body, the header, and the line", async () => {
    const received = [];
    const port = await serve((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push({
          method: req.method,
          url: req.url,
          clusterkey: req.headers["clusterkey"],
          body: JSON.parse(body),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ recorded: true }));
      });
    });

    const result = await runTool(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: `127.0.0.1:${port}` },
      ["0", path.join(directory, "db-17.backup")],
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("OneUptime was told about this backup");
    expect(received).toEqual([
      {
        method: "POST",
        url: "/api/admin/health/backup-run",
        clusterkey: encodeURIComponent(SECRET),
        body: { succeeded: true, sizeInBytes: "PGDMP 12345".length },
      },
    ]);
  });

  test("a failed dump is told as failed", async () => {
    const received = [];
    const port = await serve((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });

    const result = await runTool(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: `127.0.0.1:${port}` },
      ["1", path.join(directory, "db-17.backup")],
    );

    expect(result.stdout).toContain(
      "OneUptime was told that this backup failed",
    );
    expect(received).toEqual([{ succeeded: false, sizeInBytes: null }]);
  });

  test("rollout: a server from before the route answers 404, and the script says to update it", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html>Page not found</html>");
    });

    const result = await runTool(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: `127.0.0.1:${port}` },
      ["0", path.join(directory, "db-17.backup")],
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "This OneUptime does not record backups yet",
    );
  });

  test("a server that is down: one line, and never the key", async () => {
    const port = await serve(() => {});
    await new Promise((resolve) => {
      servers.pop().close(resolve);
    });

    const result = await runTool(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: `127.0.0.1:${port}` },
      ["0", path.join(directory, "db-17.backup")],
    );

    expect(result.code).toBe(1);
    // 127.0.0.1 is the ingress on this host, asked as localhost (FollowIngressPort).
    expect(result.stdout).toContain(
      `OneUptime did not answer at http://localhost:${port} (ECONNREFUSED)`,
    );
    expect(result.stdout).not.toContain("Ab+c");
  });

  test("a redirect is never followed: the key's header goes nowhere else", async () => {
    const elsewhere = [];
    const otherPort = await serve((req, res) => {
      elsewhere.push(req.headers["clusterkey"]);
      res.writeHead(200);
      res.end("{}");
    });
    const port = await serve((_req, res) => {
      res.writeHead(307, {
        location: `http://127.0.0.1:${otherPort}/api/admin/health/backup-run`,
      });
      res.end();
    });

    const result = await runTool(
      { ONEUPTIME_SECRET: SECRET, ONEUPTIME_HTTP_PORT: `127.0.0.1:${port}` },
      ["0", path.join(directory, "db-17.backup")],
    );

    expect(elsewhere).toEqual([]);
    expect(result.stdout).toContain("(HTTP 307)");
  });
});
