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
    const output = await runNode(podScript(), {
      PORT: "1",
      ONEUPTIME_SECRET: SECRET,
    });

    expect(output.trim().startsWith("ERROR|")).toBe(true);
  });

  /*
   * #7588: a key the app refuses from every caller - unset, blank, "secret"
   * or a placeholder config.example.env ships - is never presented: the app
   * would answer HTTP 401, which said nothing of why. The script says why
   * itself, naming the Helm value, and asks nothing.
   */
  const SHIPPED_KEYS = [
    ["no key at all", undefined],
    ["an empty key", ""],
    ["a blank key", "   "],
    ["the old fallback", "secret"],
    ["the old fallback, with a newline", "secret\n"],
    ["config.example.env's placeholder", "please-change-this-to-random-value"],
    [
      "a placeholder with something appended",
      "please-change-this-to-random-value-2",
    ],
    ["a probe's placeholder", "probe-1-please-change-this-to-random-value"],
  ];

  test.each(SHIPPED_KEYS)(
    "%s is never presented: the script says why, with the fix, and asks nothing",
    async (_label, key) => {
      const env = { PORT: String(port) };

      if (key !== undefined) {
        env.ONEUPTIME_SECRET = key;
      }

      const output = await runNode(podScript(), env);
      const lines = output.trim().split("\n");

      expect(seen).toEqual([]);
      expect(lines.length).toBe(1);

      const [kind, sentence, fix] = lines[0].split("|");

      expect(kind).toBe("SKIP");
      expect(sentence).toContain("oneuptimeSecret");
      expect(sentence).toContain("still a value OneUptime ships");
      expect(sentence).not.toContain("401");
      expect(fix).toContain("Set oneuptimeSecret in your Helm values");
      expect(fix).toContain("helm upgrade");
    },
  );

  test.each([
    ["an operator's key", SECRET],
    ["a key that only starts like the old fallback", "secretive-and-long"],
    ["a key that differs in case", "Secret"],
  ])("%s is presented", async (_label, key) => {
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
  });

  test("the address proof the app answers is passed on, for the address check, and nothing that is not one", async () => {
    const proof = `${"a".repeat(32)}.${"b".repeat(64)}`;
    const original = ANSWER.addressProof;

    try {
      ANSWER.addressProof = proof;

      expect(
        (
          await runNode(podScript(), {
            PORT: String(port),
            ONEUPTIME_SECRET: SECRET,
          })
        )
          .trim()
          .split("\n"),
      ).toEqual([...ANSWER_LINES, `PROOF|${proof}`]);

      ANSWER.addressProof = "../not-a-proof|fix|x|y";

      expect(
        (
          await runNode(podScript(), {
            PORT: String(port),
            ONEUPTIME_SECRET: SECRET,
          })
        )
          .trim()
          .split("\n"),
      ).toEqual(ANSWER_LINES);
    } finally {
      ANSWER.addressProof = original;
    }
  });

  test("it holds no single quote, which would end the shell string it lives in", () => {
    expect(podScript()).not.toContain("'");
  });
});

/*
 * Sources diagnose.sh's functions (DIAGNOSE_SOURCE_ONLY=1), with a fake
 * first_ready_pod and kc_exec, runs check_server_findings and prints the
 * findings it added, then runs any further lines given.
 */
const runCheck = (podName, execOutput, extraLines) => {
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
      ...(extraLines || []),
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

  test("a key the app refuses is one warning in the script's own words, naming the Helm value and the fix, never an HTTP 401 and the log", () => {
    const result = runCheck(
      "oneuptime-app-abc",
      "SKIP|Could not ask OneUptime how it is: oneuptimeSecret (ONEUPTIME_SECRET in the app pod) is empty or still a value OneUptime ships, and OneUptime refuses that value from every caller.|Set oneuptimeSecret in your Helm values to a long random value, then run helm upgrade.\n",
    );

    expect(findingsOf(result.stdout)).toEqual([
      "WARN|app|Could not ask OneUptime how it is: oneuptimeSecret (ONEUPTIME_SECRET in the app pod) is empty or still a value OneUptime ships, and OneUptime refuses that value from every caller.|Set oneuptimeSecret in your Helm values to a long random value, then run helm upgrade.",
    ]);
    expect(result.stdout).toContain(
      "WARN  Could not ask OneUptime how it is: oneuptimeSecret",
    );
    // Nothing passes for checked, and nobody is sent to a log that says nothing.
    expect(result.stdout).not.toContain("OK    PostgreSQL");
    expect(result.stdout).not.toContain("logs deploy/");
    expect(result.stdout).not.toContain("HTTP 401");
  });

  test("the address proof is kept for the address check, and is no finding", () => {
    const proof = `${"a".repeat(32)}.${"b".repeat(64)}`;
    const result = runCheck(
      "oneuptime-app-abc",
      `VERSION|14.0.108\nPROOF|${proof}\n`,
      ['echo "PROOF $SERVER_ADDRESS_PROOF"'],
    );

    expect(findingsOf(result.stdout)).toEqual([]);
    expect(result.stdout).toContain(`PROOF ${proof}`);
    expect(result.stdout).toContain(
      "OK    PostgreSQL, ClickHouse and Valkey answer",
    );
  });

  test("the script diagnose.sh hands the pod never names the key's value, and the shell around it never names the key", () => {
    // The pod script reads it from the pod's own environment, once.
    expect(podScript().match(/process\.env\.ONEUPTIME_SECRET/g).length).toBe(1);
    expect(podScript()).toContain(
      'const secret = process.env.ONEUPTIME_SECRET || "";',
    );

    const shell = SOURCE.replace(podScript(), "")
      .split("\n")
      .filter((line) => {
        return !line.trim().startsWith("#");
      })
      .join("\n");

    expect(shell).not.toMatch(/oneuptime[-_]?secret/i);
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
