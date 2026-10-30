"use strict";

/**
 * The agents' install scripts download their files from the OneUptime they
 * report to, never from GitHub's master branch.
 *
 * Every OneUptime serves each agent's install.sh, and the files it
 * downloads, from its own image at /install/<agent>
 * (packages/Common/Types/InstallScripts lists them; packages/App/
 * FeatureSet/Install serves them). The install command the Dashboard shows
 * downloads the script from the reader's own OneUptime, and the script
 * downloads its files from <ONEUPTIME_URL>/install/<agent>/<file>, so an
 * agent always matches the OneUptime it reports to. A OneUptime older than
 * that answers 404, or its own page as HTML: the files then come from the
 * agent's folder on GitHub, as the scripts downloaded them before, so a
 * command an older OneUptime shows keeps working. Any other answer stops
 * the install before it writes or starts anything.
 *
 * Each script carries the same block for this ("Where the agent's files
 * come from"). This holds every script to that block and to the list of
 * served files, runs the block with the real curl against a local server
 * that answers as each kind of OneUptime does, and runs the VMware and
 * Host AI agents' scripts to the end (the other agents' suites run theirs:
 * ProxmoxCephAgentInstallers, DatabaseAgentScripts, StorageArrayAgentScripts
 * and ContainerAgentInstallers).
 */

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  GITHUB_AGENTS_URL,
  agentFilesCurlStub,
} = require("./Utils/AgentFilesCurlStub");
const {
  REPO_ROOT,
  loadInstallScriptsCatalog,
} = require("./Utils/InstallScriptsCatalog");

const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const { INSTALL_SCRIPTS } = loadInstallScriptsCatalog();

// The served entries that are agents of agents/, with their folder's name.
const SERVED = INSTALL_SCRIPTS.filter((entry) => {
  return entry.script && entry.sourceDirectory.startsWith("agents/");
}).map((entry) => {
  return {
    ...entry,
    directory: entry.sourceDirectory.substring("agents/".length),
  };
});

/*
 * Agents with an install.sh that OneUptime does not serve, and why. Their
 * scripts download nothing: a new agent whose script downloads files must
 * be served instead (an entry in Common/Types/InstallScripts).
 */
const NOT_SERVED = {
  DockerAgent:
    "starts its container from oneuptime/docker-agent, which carries its config: it downloads nothing, and the Dashboard installs it with docker run or Compose",
  PodmanAgent:
    "starts its container from oneuptime/podman-agent, which carries its config: it downloads nothing, and the Dashboard installs it with podman run or Compose",
};

const BLOCK_START =
  "# ----------------------------------------------------------------------------\n# Where the agent's files come from\n";
const BLOCK_END_FUNCTION = "fetch_agent_file() {";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-files-"));
  scratchDirs.push(dir);
  return dir;
}

function readScript(directory) {
  return fs.readFileSync(
    path.join(AGENTS_DIR, directory, "install.sh"),
    "utf8",
  );
}

// The block, from its heading to the end of fetch_agent_file.
function extractBlock(script) {
  const start = script.indexOf(BLOCK_START);

  if (start === -1) {
    return null;
  }

  const fetch = script.indexOf(BLOCK_END_FUNCTION, start);
  const end = script.indexOf("\n}\n", fetch);

  return fetch === -1 || end === -1
    ? null
    : script.substring(start, end + "\n}\n".length);
}

function assignment(block, name) {
  const match = new RegExp(`^${name}="([^"]*)"$`, "m").exec(block);
  return match ? match[1] : null;
}

/*
 * The agent's files its script fetches, as the calls name them. A name
 * built from a variable is expanded to what the variable can be: the
 * Storage Array agent's AGENT_FILES list, the Database agent's
 * configs/<engine>.yaml.
 */
function fetchedFiles(entry) {
  const script = readScript(entry.directory);
  const files = new Set();
  const calls = script.matchAll(
    /^\s*(?:fetch_agent_file|download_agent_file)\s+"?([^"\s]+)"?\s/gm,
  );

  for (const [, name] of calls) {
    if (name === "$file") {
      /*
       * The Storage Array agent loops over AGENT_FILES; elsewhere "$file" is
       * download_agent_file handing its own argument on.
       */
      const list = /^AGENT_FILES="([^"]+)"$/m.exec(script);

      for (const file of list ? list[1].split(" ") : []) {
        files.add(file);
      }
    } else if (name.includes("$AGENT_CONFIG")) {
      for (const file of entry.files) {
        if (file.startsWith("configs/")) {
          files.add(file);
        }
      }
    } else {
      files.add(name);
    }
  }

  return [...files].sort();
}

describe("which agents' install scripts OneUptime serves", () => {
  test("every agent with an install.sh is served, or is listed as one that downloads nothing", () => {
    const withScript = fs
      .readdirSync(AGENTS_DIR)
      .filter((directory) => {
        return fs.existsSync(path.join(AGENTS_DIR, directory, "install.sh"));
      })
      .sort();
    const accounted = [
      ...SERVED.map((entry) => {
        return entry.directory;
      }),
      ...Object.keys(NOT_SERVED),
    ].sort();

    expect(withScript).toEqual(accounted);
  });

  test.each(Object.keys(NOT_SERVED))(
    "%s's install.sh downloads nothing and names no GitHub file",
    (directory) => {
      const script = readScript(directory);

      expect(script).not.toMatch(/\bcurl\b/);
      expect(script).not.toContain("raw.githubusercontent.com");
      expect(script).not.toContain(BLOCK_START);
    },
  );
});

describe.each(
  SERVED.map((entry) => {
    return [entry.directory, entry];
  }),
)("agents/%s/install.sh", (directory, entry) => {
  const script = readScript(directory);
  const block = extractBlock(script);

  test("carries the block every agent's script has, with its own two values", () => {
    expect(block).not.toBeNull();

    const reference = extractBlock(readScript(SERVED[0].directory));
    const normalise = (text, agent) => {
      return text
        .split(`"install/${agent.name}"`)
        .join('"install/<agent>"')
        .split(`"${GITHUB_AGENTS_URL}/${agent.directory}"`)
        .join('"<github folder>"');
    };

    expect(normalise(block, entry)).toBe(normalise(reference, SERVED[0]));
  });

  test("asks its OneUptime at /install/<agent>, and falls back to its own GitHub folder", () => {
    expect(assignment(block, "AGENT_FILES_PATH")).toBe(`install/${entry.name}`);
    expect(assignment(block, "AGENT_FILES_ON_GITHUB")).toBe(
      `${GITHUB_AGENTS_URL}/${directory}`,
    );
    expect(fs.existsSync(path.join(AGENTS_DIR, directory))).toBe(true);
  });

  test("names GitHub only as that fallback", () => {
    expect(script.split("raw.githubusercontent.com").length - 1).toBe(1);
    expect(script).not.toMatch(/\b(?:REPO_BASE|RAW_BASE)\b/);
  });

  test("downloads the agent's files only through the block", () => {
    const outside = script.split(block).join("");

    for (const line of outside.split("\n")) {
      // A curl the script runs (not one it prints as advice) fetches no agent file.
      if (/^\s*(?:if\s+!?\s*)?curl\b/.test(line)) {
        expect(line).not.toMatch(/AGENT_FILES|install\/|githubusercontent/);
      }
    }
  });

  test("fetches only files OneUptime serves for it", () => {
    const fetched = fetchedFiles(entry);

    expect(fetched.length).toBeGreaterThan(0);
    for (const file of fetched) {
      expect({ file, served: entry.files.includes(file) }).toEqual({
        file,
        served: true,
      });
    }
  });

  test("points the diagnostic it suggests at where its files came from", () => {
    for (const line of script.split("\n")) {
      if (line.includes("troubleshoot.sh") && line.includes("curl")) {
        expect(line).toContain("$AGENT_FILES_URL/troubleshoot.sh");
      }
    }
  });

  test("the block runs under sh as under bash: no bash-only syntax in it", () => {
    const file = path.join(scratch(), "block.sh");
    fs.writeFileSync(file, block);

    for (const shell of ["sh", "bash"]) {
      const check = spawnSync(shell, ["-n", file], { encoding: "utf8" });
      expect({ shell, status: check.status, stderr: check.stderr }).toEqual({
        shell,
        status: 0,
        stderr: "",
      });
    }

    expect(block).not.toMatch(
      /\blocal\b|\[\[|\$\{[A-Za-z_]+\/\/|<\(|\bdeclare\b/,
    );
  });
});

/* ------------------------------------------------------------ the real curl */

function curlVersion() {
  const probe = spawnSync("curl", ["--version"], { encoding: "utf8" });
  return probe.status === 0 ? probe.stdout.split("\n")[0] : null;
}

const describeWithCurl = curlVersion() ? describe : describe.skip;

function filePath(directory, file) {
  return path.join(AGENTS_DIR, directory, file);
}

/*
 * A server that answers as each kind of OneUptime does. The first path
 * segment says which, so ONEUPTIME_URL=http://127.0.0.1:<port>/<kind> is
 * also a OneUptime under a path prefix:
 *
 *   served/install/<agent>/<file>   this release: 200, text/plain
 *   plain/...                       the same with no charset
 *   redirect/...                    302 to served/... (HTTP to HTTPS, say)
 *   old404/...                      a OneUptime that has no such route
 *   oldspa/...                      one that answers its Dashboard, 200 HTML
 *   error500/...                    one that fails
 *   github/<Agent>/<file>           GitHub's raw files: 200, text/plain
 *   githubdown/...                  GitHub failing
 */
function startServer() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);

    const [, kind, ...rest] = request.url.split("?")[0].split("/");
    const send = (status, type, body) => {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    };

    if (kind === "served" || kind === "plain") {
      const [install, name, ...file] = rest;
      const entry = SERVED.find((candidate) => {
        return candidate.name === name;
      });

      if (
        install === "install" &&
        entry &&
        entry.files.includes(file.join("/"))
      ) {
        return send(
          200,
          kind === "plain" ? "text/plain" : "text/plain; charset=utf-8",
          fs.readFileSync(filePath(entry.directory, file.join("/"))),
        );
      }

      return send(404, "text/plain; charset=utf-8", "Not found\n");
    }

    if (kind === "redirect") {
      response.writeHead(302, { Location: `/served/${rest.join("/")}` });
      return response.end();
    }

    if (kind === "old404") {
      return send(
        404,
        "text/html; charset=utf-8",
        "<html>Page not found</html>",
      );
    }

    if (kind === "oldspa") {
      return send(
        200,
        "text/html; charset=utf-8",
        "<!doctype html><title>OneUptime</title><div id=root></div>",
      );
    }

    if (kind === "error500") {
      return send(500, "text/plain; charset=utf-8", "Something went wrong\n");
    }

    if (kind === "github") {
      const [directory, ...file] = rest;
      const target = filePath(directory, file.join("/"));

      if (fs.existsSync(target)) {
        return send(200, "text/plain; charset=utf-8", fs.readFileSync(target));
      }

      return send(404, "text/plain; charset=utf-8", "404: Not Found");
    }

    if (kind === "githubdown") {
      return send(503, "text/html", "<html>Unavailable</html>");
    }

    return send(400, "text/plain", "no such kind\n");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => {
          return new Promise((done) => {
            server.close(done);
          });
        },
      });
    });
  });
}

// A port nothing listens on.
function closedPort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function runShell(shell, args, env) {
  return new Promise((resolve) => {
    const child = spawn(shell, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, output });
    });
  });
}

/*
 * The block alone, sourced the way the script runs it: ONEUPTIME_URL set,
 * the fallback pointed at the local server's stand-in for GitHub, then
 * fetch_agent_file for each file into `dest`.
 */
const DRIVER = `ONEUPTIME_URL="$2"
. "$1"
AGENT_FILES_ON_GITHUB="$3"
dest="$4"
shift 4
for file in "$@"; do
    mkdir -p "$dest/$(dirname "$file")"
    fetch_agent_file "$file" "$dest/$file"
done
echo "SOURCE=$AGENT_FILES_URL"
`;

describeWithCurl("the block, run with the real curl", () => {
  let server = null;
  let noAnswerUrl = "";

  beforeAll(async () => {
    server = await startServer();
    noAnswerUrl = `http://127.0.0.1:${await closedPort()}`;
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
  });

  async function fetchWith({ entry, shell = "bash", oneuptimeUrl, github }) {
    const dir = scratch();
    const blockFile = path.join(dir, "block.sh");
    const driverFile = path.join(dir, "driver.sh");
    const dest = path.join(dir, "agent");
    const files = entry.files
      .filter((file) => {
        return file !== "install.sh";
      })
      .slice(0, 2);

    fs.writeFileSync(blockFile, extractBlock(readScript(entry.directory)));
    fs.writeFileSync(driverFile, DRIVER);
    fs.mkdirSync(dest);
    server.requests.length = 0;

    const run = await runShell(
      shell,
      [
        driverFile,
        blockFile,
        oneuptimeUrl,
        github || `${server.url}/github/${entry.directory}`,
        dest,
        ...files,
      ],
      { PATH: process.env.PATH, HOME: dir },
    );

    return {
      ...run,
      files,
      dest,
      requests: [...server.requests],
      installed: (file) => {
        const target = path.join(dest, file);
        return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
      },
    };
  }

  function expectTheRealFiles(result, entry) {
    for (const file of result.files) {
      expect({ file, content: result.installed(file) }).toEqual({
        file,
        content: fs.readFileSync(filePath(entry.directory, file), "utf8"),
      });
    }
  }

  describe.each(
    SERVED.map((entry) => {
      return [entry.name, entry];
    }),
  )("%s", (_name, entry) => {
    test("from this release's OneUptime: every file from it, none from GitHub", async () => {
      const result = await fetchWith({
        entry,
        oneuptimeUrl: `${server.url}/served`,
      });

      expect(result.status).toBe(0);
      expectTheRealFiles(result, entry);
      expect(result.output).toContain(
        `SOURCE=${server.url}/served/install/${entry.name}`,
      );
      expect(result.requests).toEqual(
        result.files.map((file) => {
          return `/served/install/${entry.name}/${file}`;
        }),
      );
      expect(result.output).not.toContain("GitHub");
    });

    test("a URL with a trailing slash, a path prefix and plain HTTP finds the same files", async () => {
      const result = await fetchWith({
        entry,
        oneuptimeUrl: `${server.url}/served/`,
      });

      expect(result.status).toBe(0);
      expectTheRealFiles(result, entry);
      for (const request of result.requests) {
        expect(request.startsWith(`/served/install/${entry.name}/`)).toBe(true);
      }
    });

    test("text/plain without a charset, and a redirect on the way, are still this OneUptime's files", async () => {
      for (const kind of ["plain", "redirect"]) {
        const result = await fetchWith({
          entry,
          oneuptimeUrl: `${server.url}/${kind}`,
        });

        expect({ kind, status: result.status }).toEqual({ kind, status: 0 });
        expectTheRealFiles(result, entry);
        expect(result.output).not.toContain("GitHub");
      }
    });

    test.each([
      ["answers 404", "old404"],
      ["answers its Dashboard as HTML, at HTTP 200", "oldspa"],
    ])(
      "an older OneUptime that %s: the files come from GitHub, and it says so",
      async (_what, kind) => {
        const result = await fetchWith({
          entry,
          oneuptimeUrl: `${server.url}/${kind}`,
        });

        expect(result.status).toBe(0);
        expectTheRealFiles(result, entry);
        expect(result.output).toContain(
          `${server.url}/${kind} does not serve the agent's files: it runs a OneUptime older`,
        );
        expect(result.output).toContain(
          `SOURCE=${server.url}/github/${entry.directory}`,
        );
        // Asked once, then never again: every file from the same place.
        expect(result.requests).toEqual([
          `/${kind}/install/${entry.name}/${result.files[0]}`,
          ...result.files.map((file) => {
            return `/github/${entry.directory}/${file}`;
          }),
        ]);
      },
    );

    test("a OneUptime that fails stops at once: no GitHub, no file left", async () => {
      const result = await fetchWith({
        entry,
        oneuptimeUrl: `${server.url}/error500`,
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Error: ${server.url}/error500/install/${entry.name}/${result.files[0]} answered 500, not the file`,
      );
      expect(result.requests).toEqual([
        `/error500/install/${entry.name}/${result.files[0]}`,
      ]);
      expect(result.installed(result.files[0])).toBeNull();
    });

    test("a OneUptime that does not answer stops at once", async () => {
      const result = await fetchWith({ entry, oneuptimeUrl: noAnswerUrl });

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Error: could not reach ${noAnswerUrl}/install/${entry.name}/${result.files[0]}`,
      );
      expect(result.requests).toEqual([]);
      expect(result.installed(result.files[0])).toBeNull();
    });

    test("GitHub failing after an older OneUptime stops too, with no page saved as a file", async () => {
      const result = await fetchWith({
        entry,
        oneuptimeUrl: `${server.url}/old404`,
        github: `${server.url}/githubdown/${entry.directory}`,
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Error: ${server.url}/githubdown/${entry.directory}/${result.files[0]} answered 503, not the file`,
      );
      expect(result.installed(result.files[0])).toBeNull();
    });
  });

  test("the Docker Swarm agent's script runs it under sh, with the same results", async () => {
    const entry = SERVED.find((candidate) => {
      return candidate.directory === "DockerSwarmAgent";
    });
    const served = await fetchWith({
      entry,
      shell: "sh",
      oneuptimeUrl: `${server.url}/served`,
    });

    expect(served.status).toBe(0);
    expectTheRealFiles(served, entry);

    const older = await fetchWith({
      entry,
      shell: "sh",
      oneuptimeUrl: `${server.url}/oldspa`,
    });

    expect(older.status).toBe(0);
    expectTheRealFiles(older, entry);
    expect(older.output).toContain("Downloading them from GitHub instead.");

    const failing = await fetchWith({
      entry,
      shell: "sh",
      oneuptimeUrl: `${server.url}/error500`,
    });

    expect(failing.status).toBe(1);
  });
});

/* ------------------------------------------- VMware and Host AI, to the end */

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

const URL = "https://oneuptime.example.com";
const KEY = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";

/*
 * `docker` answers every check and records its calls; `curl` serves the
 * agent's files as the OneUptime at URL does (Utils/AgentFilesCurlStub);
 * `id` says root and `uname` Linux, as the Host AI agent's script requires.
 */
function installStubs(dir, entry) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s | %s\\n' "$PWD" "$*" >> "$STUB_DIR/docker.log"
exit 0
`,
  );
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: entry.name,
      agentDirectory: entry.directory,
      servedDir: path.join(AGENTS_DIR, entry.directory),
    }),
  );
  writeExecutable(path.join(bin, "id"), "#!/usr/bin/env bash\necho 0\n");
  writeExecutable(path.join(bin, "uname"), "#!/usr/bin/env bash\necho Linux\n");
  return bin;
}

const FULL_RUNS = {
  VMwareAgent: {
    files: ["docker-compose.yml", "otel-collector-config.yaml"],
    env: {
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      VMWARE_VCENTER_NAME: "vcsa-prod",
      VCENTER_ENDPOINT: "https://vcsa.example.com",
      VCENTER_USERNAME: "oneuptime@vsphere.local",
      VCENTER_PASSWORD: "s3cret",
      VCENTER_INSECURE_SKIP_VERIFY: "true",
      VCENTER_COLLECTION_INTERVAL: "2m",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    },
    troubleshoot: true,
  },
  HostAIAgent: {
    files: ["docker-compose.yml", "systemd/oneuptime-host-ai-agent.service"],
    env: {
      ONEUPTIME_URL: URL,
      ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
      HOST_NAME: "web-1",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    },
    troubleshoot: false,
  },
};

describe.each(Object.keys(FULL_RUNS))(
  "agents/%s/install.sh, run to the end",
  (directory) => {
    const entry = SERVED.find((candidate) => {
      return candidate.directory === directory;
    });
    const spec = FULL_RUNS[directory];
    const served = `${URL}/install/${entry.name}`;
    const github = `${GITHUB_AGENTS_URL}/${directory}`;

    function install({ oneuptimeAnswer, env = {} } = {}) {
      const dir = scratch();
      const bin = installStubs(dir, entry);
      const installDir = path.join(dir, "agent");

      if (oneuptimeAnswer) {
        fs.writeFileSync(path.join(dir, "oneuptime.answer"), oneuptimeAnswer);
      }

      const result = spawnSync(
        "bash",
        [path.join(AGENTS_DIR, directory, "install.sh")],
        {
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            HOME: dir,
            STUB_DIR: dir,
            INSTALL_DIR: installDir,
            ...spec.env,
            ...env,
          },
          input: "",
          encoding: "utf8",
          timeout: 60000,
        },
      );
      const read = (file) => {
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      };

      return {
        status: result.status,
        output: `${result.stdout}${result.stderr}`,
        installDir,
        curlLog: read(path.join(dir, "curl.log")),
        docker: read(path.join(dir, "docker.log")),
        requested: read(path.join(dir, "curl.log"))
          .split("\n")
          .filter((line) => {
            return line.includes(" -w ");
          })
          .map((line) => {
            return line.split(" ").pop();
          }),
      };
    }

    test("installs the files of the OneUptime it reports to, and starts the agent", () => {
      const run = install();

      expect(run.status).toBe(0);
      expect(run.requested).toEqual(
        spec.files.map((file) => {
          return `${served}/${file}`;
        }),
      );
      for (const file of spec.files) {
        expect(fs.readFileSync(path.join(run.installDir, file), "utf8")).toBe(
          fs.readFileSync(path.join(AGENTS_DIR, directory, file), "utf8"),
        );
      }
      expect(run.docker).toContain("compose up -d --force-recreate");
      expect(run.curlLog).not.toContain("raw.githubusercontent.com");
      // The key goes into .env, never onto a command line.
      expect(run.curlLog).not.toContain(KEY);
      if (spec.troubleshoot) {
        expect(run.output).toContain(
          `If nothing shows up: curl -fsSL ${served}/troubleshoot.sh | bash`,
        );
      }
    });

    test("an older OneUptime (404) gets the files from GitHub, as before", () => {
      const run = install({ oneuptimeAnswer: "404 text/html" });

      expect(run.status).toBe(0);
      expect(run.output).toContain("Downloading them from GitHub instead.");
      expect(run.requested).toEqual([
        `${served}/${spec.files[0]}`,
        ...spec.files.map((file) => {
          return `${github}/${file}`;
        }),
      ]);
      expect(run.docker).toContain("compose up -d --force-recreate");
    });

    test("a OneUptime that errors stops the install: nothing written, nothing started", () => {
      const run = install({ oneuptimeAnswer: "500 text/plain; charset=utf-8" });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain(
        `Error: ${served}/${spec.files[0]} answered 500, not the file`,
      );
      expect(fs.existsSync(path.join(run.installDir, ".env"))).toBe(false);
      expect(run.docker).not.toContain("compose up");
      expect(run.curlLog).not.toContain("raw.githubusercontent.com");
    });
  },
);
