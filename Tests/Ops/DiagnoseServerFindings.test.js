"use strict";

/**
 * HelmChart/Public/diagnose.sh prints what OneUptime says is wrong with
 * itself, on Kubernetes (#6826): the same findings as `npm run doctor` and
 * the Admin Dashboard's OneUptime Health overview, from a POST to
 * /api/admin/health/doctor, asked from inside the app pod with the cluster
 * key the pod holds in the clusterkey header, URI-encoded as the app compares
 * it, following no redirect.
 *
 * The script the pod runs is run here with this machine's node against a
 * real HTTP server standing in for the app, and the shell that reads its
 * lines is sourced with a fake kubectl exec. Nothing reaches a cluster.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DIAGNOSE = path.join(REPO_ROOT, "HelmChart/Public/diagnose.sh");
const SOURCE = fs.readFileSync(DIAGNOSE, "utf8");
const SECRET = "k".repeat(64);

// The node script diagnose.sh hands the app pod.
const podScript = () => {
  const match = /SERVER_FINDINGS_SCRIPT='([\s\S]*?)'\n/.exec(SOURCE);

  if (!match) {
    throw new Error("SERVER_FINDINGS_SCRIPT not found in diagnose.sh");
  }

  return match[1];
};

const ANSWER = {
  findings: [
    {
      id: "valkey",
      level: "fix",
      title: "Valkey",
      sentence:
        "Valkey does not answer, so background jobs and live updates stop.",
      fixSentence:
        "Check that Valkey is running, and read its log for the reason.",
    },
    {
      id: "setup-email",
      level: "fix",
      title: "Email",
      sentence: "Not set up yet: OneUptime cannot send | invitations.",
      fixSentence: "Finish it on the Server setup page.",
    },
    {
      id: "update-available",
      level: "warn",
      title: "Version",
      sentence: "This server runs OneUptime 14.0.100.\n14.0.108 is out.",
      fixSentence: null,
    },
  ],
  version: { current: "14.0.100" },
};

// What the script prints of ANSWER.
const ANSWER_LINES = [
  "fix|Valkey|Valkey does not answer, so background jobs and live updates stop.|Check that Valkey is running, and read its log for the reason.",
  // A bar or a line break in the words cannot break a line apart.
  "fix|Email|Not set up yet: OneUptime cannot send invitations.|Finish it on the Server setup page.",
  "warn|Version|This server runs OneUptime 14.0.100. 14.0.108 is out.|",
  "VERSION|14.0.100",
];

/*
 * Keys with characters URI-encoding changes: + / = @ & %, a Latin-1 letter,
 * which fetch would send as one byte, and letters beyond Latin-1, which it
 * would not send at all.
 */
const KEYS_TO_ENCODE = [
  ["+ / = @ & %", "Ab+c/d=e@f&g%h"],
  ["a Latin-1 letter", "clé-du-cluster"],
  ["letters beyond Latin-1", "clé-du-cluster-ä-ø-漢字-🔑"],
];

const runNode = (script, env) => {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", script], {
      env: Object.assign({ PATH: process.env.PATH }, env),
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", () => {
      resolve(stdout);
    });
  });
};

describe("the script the app pod runs", () => {
  let server;
  let port;
  // Another server, which nothing should reach.
  let elsewhere;
  let elsewherePort;
  let status = 200;
  // The ONEUPTIME_SECRET of the app pod, which the app compares the key with.
  let appKey = SECRET;
  const seen = [];
  const seenElsewhere = [];

  const recordOf = (req) => {
    return {
      method: req.method,
      url: req.url,
      clusterkey: req.headers.clusterkey,
      contentLength: req.headers["content-length"],
      transferEncoding: req.headers["transfer-encoding"],
    };
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(recordOf(req));

      // The app's GET is the Admin Dashboard's: the cluster key opens only the POST.
      if (req.method !== "POST") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message: "Unauthorized: Access token is required.",
          }),
        );
        return;
      }

      if (status >= 300 && status < 400) {
        res.writeHead(status, {
          location: `http://127.0.0.1:${elsewherePort}/api/admin/health/doctor`,
        });
        res.end();
        return;
      }

      // As the app compares a key: with its own, URI-encoded (ClusterKeyAuthorization.getClusterKey).
      if (
        status === 200 &&
        req.headers.clusterkey !== encodeURIComponent(appKey)
      ) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid cluster key provided" }));
        return;
      }

      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(status === 200 ? ANSWER : { error: "x" }));
    });
    elsewhere = http.createServer((req, res) => {
      seenElsewhere.push(recordOf(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ANSWER));
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    await new Promise((resolve) => {
      elsewhere.listen(0, "127.0.0.1", resolve);
    });
    elsewherePort = elsewhere.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await new Promise((resolve) => {
      elsewhere.close(resolve);
    });
  });

  beforeEach(() => {
    status = 200;
    appKey = SECRET;
    seen.length = 0;
    seenElsewhere.length = 0;
  });

  test("asks the doctor's route on PORT with a POST and the pod's cluster key, and prints one line a finding", async () => {
    const output = await runNode(podScript(), {
      PORT: String(port),
      ONEUPTIME_SECRET: SECRET,
    });

    expect(seen).toEqual([
      {
        method: "POST",
        url: "/api/admin/health/doctor",
        clusterkey: SECRET,
        // An empty body, said so.
        contentLength: "0",
        transferEncoding: undefined,
      },
    ]);
    expect(output.trim().split("\n")).toEqual(ANSWER_LINES);
  });

  test.each(KEYS_TO_ENCODE)(
    "a key with %s goes URI-encoded, as the app compares it, and the app's findings are printed",
    async (_characters, key) => {
      appKey = key;

      const output = await runNode(podScript(), {
        PORT: String(port),
        ONEUPTIME_SECRET: key,
      });

      expect(
        seen.map((entry) => {
          return entry.clusterkey;
        }),
      ).toEqual([encodeURIComponent(key)]);
      expect(output.trim().split("\n")).toEqual(ANSWER_LINES);
    },
  );

  test("an app that refuses says why", async () => {
    status = 400;

    const output = await runNode(podScript(), {
      PORT: String(port),
      ONEUPTIME_SECRET: "wrong",
    });

    expect(output.trim()).toBe("ERROR|the app answered HTTP 400");
  });

  test.each([301, 302, 303, 307, 308])(
    "a redirect (HTTP %i) is not followed, so the key reaches no other server",
    async (redirect) => {
      status = redirect;

      const output = await runNode(podScript(), {
        PORT: String(port),
        ONEUPTIME_SECRET: SECRET,
      });

      expect(output.trim()).toBe(`ERROR|the app answered HTTP ${redirect}`);
      expect(seen.length).toBe(1);
      expect(seenElsewhere).toEqual([]);
    },
  );

  test("an app that does not answer says so", async () => {
    const output = await runNode(podScript(), { PORT: "1" });

    expect(output.trim().startsWith("ERROR|")).toBe(true);
  });

  test("it holds no single quote, which would end the shell string it lives in", () => {
    expect(podScript()).not.toContain("'");
  });
});

/*
 * Sources diagnose.sh's functions (DIAGNOSE_SOURCE_ONLY=1), with a fake
 * first_ready_pod and kc_exec, runs check_server_findings and prints the
 * findings it added.
 */
const runCheck = (podName, execOutput) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diagnose-"));
  const outputFile = path.join(directory, "exec-output.txt");
  fs.writeFileSync(outputFile, execOutput);

  try {
    const script = [
      `DIAGNOSE_SOURCE_ONLY=1 source "${DIAGNOSE}" --no-color --output /dev/null`,
      "NAMESPACE=oneuptime",
      "RELEASE=oneuptime",
      `first_ready_pod() { printf '%s' "${podName}"; }`,
      `kc_exec() { echo "$@" > "${directory}/exec-args.txt"; cat "${outputFile}"; }`,
      "check_server_findings",
      'for f in "${FINDINGS[@]}"; do echo "FINDING $f"; done',
    ].join("\n");
    const result = spawnSync("bash", ["-c", script], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: directory },
    });
    const args = fs.existsSync(path.join(directory, "exec-args.txt"))
      ? fs.readFileSync(path.join(directory, "exec-args.txt"), "utf8")
      : "";

    return { stdout: result.stdout, status: result.status, args: args };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const findingsOf = (stdout) => {
  return stdout
    .split("\n")
    .filter((line) => {
      return line.startsWith("FINDING ");
    })
    .map((line) => {
      return line.slice("FINDING ".length);
    });
};

const hasBash = spawnSync("bash", ["--version"]).status === 0;
const describeWithBash = hasBash ? describe : describe.skip;

describeWithBash("diagnose.sh reads them", () => {
  test("a fix is critical and a warning a warning, each with its fix", () => {
    const result = runCheck(
      "oneuptime-app-abc",
      [
        "fix|Valkey|Valkey does not answer.|Check that Valkey is running.",
        "warn|Version|This server runs OneUptime 14.0.100. 14.0.108 is out.|",
        "VERSION|14.0.100",
      ].join("\n"),
    );

    expect(findingsOf(result.stdout)).toEqual([
      "CRIT|Valkey|Valkey does not answer.|Check that Valkey is running.",
      "WARN|Version|This server runs OneUptime 14.0.100. 14.0.108 is out.|See Admin > OneUptime Health.",
    ]);
    expect(result.stdout).toContain("CRIT  Valkey: Valkey does not answer.");
    expect(result.stdout).toContain("info  OneUptime 14.0.100");
    // Inside the app pod, with node.
    expect(result.args.startsWith("oneuptime-app-abc node -e ")).toBe(true);
  });

  test("nothing wrong is one passing line", () => {
    const result = runCheck("oneuptime-app-abc", "VERSION|14.0.108\n");

    expect(findingsOf(result.stdout)).toEqual([]);
    expect(result.stdout).toContain(
      "OK    PostgreSQL, ClickHouse and Valkey answer",
    );
  });

  test("an app that could not say is a warning with the command that shows its log", () => {
    const result = runCheck(
      "oneuptime-app-abc",
      "ERROR|the app answered HTTP 400\n",
    );

    expect(findingsOf(result.stdout)).toEqual([
      "WARN|app|OneUptime could not say how its databases, migrations and setup are (the app answered HTTP 400)|Read the app pod's log: kubectl -n oneuptime logs deploy/oneuptime-app --tail=200",
    ]);
  });

  test("no app pod is critical", () => {
    const result = runCheck("", "");

    expect(findingsOf(result.stdout)).toEqual([
      "CRIT|app|No app pod is running|kubectl -n oneuptime describe pod -l app=oneuptime-app, and read its events and logs.",
    ]);
  });

  test("the main run asks it right after pod health", () => {
    const main = SOURCE.slice(SOURCE.lastIndexOf("\ndiscover\n"));

    expect(main.split("\n").slice(1, 4)).toEqual([
      "discover",
      "check_pod_health",
      "check_server_findings",
    ]);
  });
});
