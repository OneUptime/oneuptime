"use strict";

/**
 * packages/Home/Scripts/Install.sh, the one-line installer behind
 * `curl -fsSL https://oneuptime.com/install.sh | bash`.
 *
 * It installs what is missing (Git, Node.js, Docker with its Compose plugin),
 * fetches the latest release, asks which address people will open OneUptime
 * at - HOST, the setting whose mismatch was the commonest way a new install
 * failed - and starts it with `npm start`, which does the rest (checks the
 * server, makes every secret, waits until OneUptime answers).
 *
 * It used to clone master rather than the release, replace the placeholders
 * with a GNU-only sed loop that npm start no longer needs, fetch Node.js for
 * RPM systems from NodeSource's Debian script, and leave a user Docker had
 * just been installed for without access to it.
 *
 * These tests run the real script under bash in a throwaway home, with every
 * command it would change the machine with replaced by a stub on PATH that
 * records how it was called: git, curl, sudo, the package managers, docker,
 * node, npm, sg, systemctl, usermod, id, uname and hostname. Only plain text
 * tools (sed, grep, cut, tr, ...) are the machine's own.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "packages",
  "Home",
  "Scripts",
  "Install.sh",
);
const TEMPLATE = path.join(REPO_ROOT, "config.example.env");
const REPOSITORY = "https://example.invalid/oneuptime.git";

// The machine's own text tools the script uses, linked into the sandbox's PATH.
const REAL_TOOLS = [
  "bash",
  "sh",
  "sed",
  "grep",
  "cut",
  "tr",
  "head",
  "tail",
  "cat",
  "mktemp",
  "rm",
  "cp",
  "mkdir",
  "chmod",
  "dirname",
  "basename",
];

function realPathOf(tool) {
  const result = spawnSync("bash", ["-c", `command -v ${tool}`], {
    encoding: "utf8",
  });

  return result.stdout.trim();
}

function writeStub(directory, name, body) {
  fs.writeFileSync(path.join(directory, name), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
}

/*
 * A sandbox: a home to run in, real text tools, and stubs that record each
 * call as "<name> <arguments>" in calls.log. `options`:
 *
 *   uid           the user's id (1000; 0 for root)
 *   system        "Linux" or "Darwin"
 *   manager       the package manager on PATH: "apt-get", "dnf", or null
 *   node          the version node prints ("v22.11.0"), or null for none
 *   docker        "ok", "permission", "compose-missing" or "missing"
 *   answers       what the person types, or null for nobody to ask
 *   existing      "clone" (an earlier install), "folder" (not a clone) or null
 */
function sandbox(options) {
  const given = Object.assign(
    {
      uid: 1000,
      system: "Linux",
      manager: "apt-get",
      node: "v22.11.0",
      docker: "ok",
      answers: null,
      existing: null,
      existingHost: "oneuptime.example.com",
    },
    options || {},
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-install-"));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  const tools = path.join(root, "tools");
  const calls = path.join(root, "calls.log");
  const record = `echo "$(basename "$0") $*" >> "${calls}"`;

  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.mkdirSync(tools);

  for (const tool of REAL_TOOLS) {
    fs.symlinkSync(realPathOf(tool), path.join(tools, tool));
  }

  writeStub(bin, "uname", `echo ${given.system}`);
  writeStub(
    bin,
    "id",
    [
      'case "$1" in',
      `  -u) echo ${given.uid} ;;`,
      `  -un) echo ${given.uid === 0 ? "root" : "tester"} ;;`,
      "esac",
    ].join("\n"),
  );
  writeStub(
    bin,
    "hostname",
    'if [ "$1" = "-I" ]; then echo "10.0.0.5 172.17.0.1 fd00::5"; fi',
  );
  // sudo runs the command, marked so docker answers as for root.
  writeStub(bin, "sudo", `${record}\nSUDO_USER=tester exec "$@"`);
  writeStub(bin, "systemctl", record);
  writeStub(bin, "usermod", record);
  // sg runs its command with the group the session lacks.
  writeStub(bin, "sg", `${record}\nIN_DOCKER_GROUP=1 exec bash -c "$3"`);

  const nodeStub = (version) => {
    writeStub(bin, "node", `echo ${version}`);
  };

  if (given.node) {
    nodeStub(given.node);
  }

  writeStub(
    bin,
    "npm",
    [
      record,
      `echo "npm-cwd $(pwd)" >> "${calls}"`,
      `echo "npm-host $(grep '^HOST=' config.env | tail -n 1)" >> "${calls}"`,
    ].join("\n"),
  );

  /*
   * The package managers: installing nodejs puts a current node on PATH,
   * installing the Compose plugin makes `docker compose` answer.
   */
  const managerBody = [
    record,
    'case "$*" in',
    `  *nodejs*) printf '#!/bin/sh\\necho v22.11.0\\n' > "${bin}/node"; chmod 755 "${bin}/node" ;;`,
    `  *compose*) : > "${root}/compose-installed" ;;`,
    "esac",
  ].join("\n");

  if (given.manager) {
    writeStub(bin, given.manager, managerBody);
  }

  const dockerBody = [
    record,
    'case "$1" in',
    "  --version) echo 'Docker version 27.3.1, build ce12230'; exit 0 ;;",
    "  compose)",
    given.docker === "compose-missing"
      ? `    if [ -e "${root}/compose-installed" ]; then echo 'Docker Compose version v2.29.7'; exit 0; fi; echo "docker: 'compose' is not a docker command." >&2; exit 1 ;;`
      : "    echo 'Docker Compose version v2.29.7'; exit 0 ;;",
    "  info)",
    given.docker === "permission"
      ? '    if [ -n "$SUDO_USER" ] || [ -n "$IN_DOCKER_GROUP" ]; then exit 0; fi; echo "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock" >&2; exit 1 ;;'
      : "    exit 0 ;;",
    "esac",
  ].join("\n");

  fs.writeFileSync(
    path.join(root, "docker.stub"),
    `#!/bin/sh\n${dockerBody}\n`,
    { mode: 0o755 },
  );

  if (given.docker !== "missing") {
    fs.copyFileSync(path.join(root, "docker.stub"), path.join(bin, "docker"));
  }

  /*
   * curl prints a script for `| sh` / `| bash`: Docker's installer puts the
   * docker stub on PATH; NodeSource's adds nothing (the package manager
   * installs nodejs next).
   */
  writeStub(
    bin,
    "curl",
    [
      record,
      'case "$*" in',
      `  *get.docker.com*) echo 'cp "${root}/docker.stub" "${bin}/docker"; chmod 755 "${bin}/docker"' ;;`,
      "  *) echo 'true' ;;",
      "esac",
    ].join("\n"),
  );

  /*
   * git clone makes the folder a release clone would: a .git, the
   * config.example.env this repository ships, a package.json.
   */
  writeStub(
    bin,
    "git",
    [
      record,
      'if [ "$1" = "clone" ]; then',
      '  for target in "$@"; do :; done',
      '  mkdir -p "$target/.git"',
      `  cp "${TEMPLATE}" "$target/config.example.env"`,
      "  echo '{}' > \"$target/package.json\"",
      "fi",
    ].join("\n"),
  );

  if (given.existing === "clone") {
    fs.mkdirSync(path.join(home, "oneuptime", ".git"), { recursive: true });
    fs.copyFileSync(
      TEMPLATE,
      path.join(home, "oneuptime", "config.example.env"),
    );
    fs.writeFileSync(
      path.join(home, "oneuptime", "config.env"),
      fs
        .readFileSync(TEMPLATE, "utf8")
        .replace("HOST=localhost", `HOST=${given.existingHost}`),
    );
  }

  if (given.existing === "folder") {
    fs.mkdirSync(path.join(home, "oneuptime"));
  }

  let input = path.join(root, "no-terminal");

  if (given.answers !== null) {
    input = path.join(root, "answers");
    fs.writeFileSync(input, given.answers);
  }

  return { root, home, bin, tools, calls, input, given };
}

function run(options, env) {
  const box = sandbox(options);

  try {
    const result = spawnSync("/bin/bash", [SCRIPT], {
      cwd: box.home,
      env: Object.assign(
        {
          PATH: `${box.bin}${path.delimiter}${box.tools}`,
          HOME: box.home,
          ONEUPTIME_REPOSITORY: REPOSITORY,
          ONEUPTIME_INSTALL_INPUT: box.input,
        },
        env || {},
      ),
      encoding: "utf8",
      timeout: 60 * 1000,
    });
    const configPath = path.join(box.home, "oneuptime", "config.env");

    return {
      status: result.status,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      calls: fs.existsSync(box.calls)
        ? fs.readFileSync(box.calls, "utf8").trim().split("\n")
        : [],
      config: fs.existsSync(configPath)
        ? fs.readFileSync(configPath, "utf8")
        : null,
      home: box.home,
    };
  } finally {
    fs.rmSync(box.root, { recursive: true, force: true });
  }
}

function hostIn(config) {
  return config
    .split("\n")
    .filter((line) => {
      return line.startsWith("HOST=");
    })
    .pop();
}

function callsOf(result, command) {
  return result.calls.filter((call) => {
    return call.startsWith(`${command} `) || call === command;
  });
}

describe("a server with everything installed", () => {
  test("it clones the release, writes the address typed as HOST, and starts OneUptime there with npm start", () => {
    const result = run({ answers: "203.0.113.5\n" });

    expect(result.status).toBe(0);
    expect(callsOf(result, "git")).toEqual([
      `git clone --depth 1 --single-branch --branch release ${REPOSITORY} oneuptime`,
    ]);
    expect(callsOf(result, "npm")).toEqual(["npm start"]);
    expect(result.calls).toContain(
      `npm-cwd ${path.join(result.home, "oneuptime")}`,
    );
    expect(result.calls).toContain("npm-host HOST=203.0.113.5");
    expect(hostIn(result.config)).toBe("HOST=203.0.113.5");
    expect(result.output).toContain("✓ HOST=203.0.113.5 in config.env");
    // Nothing installed, nothing run as root.
    for (const command of ["sudo", "curl", "apt-get", "systemctl", "sg"]) {
      expect({ command, calls: callsOf(result, command) }).toEqual({
        command,
        calls: [],
      });
    }
  });

  test("config.env is config.example.env, with HOST alone changed - npm start makes the secrets", () => {
    const result = run({ answers: "203.0.113.5\n" });
    const template = fs.readFileSync(TEMPLATE, "utf8");

    expect(result.config).toBe(
      template.replace("HOST=localhost", "HOST=203.0.113.5"),
    );
    expect(result.config).toContain("please-change-this-to-random-value");
  });

  test("it asks the question with this server's address as the answer to take", () => {
    const result = run({ answers: "\n" });

    expect(result.output).toContain(
      "Which address will people use to open OneUptime?",
    );
    expect(result.output).toContain("Address [10.0.0.5]: ");
    expect(hostIn(result.config)).toBe("HOST=10.0.0.5");
  });

  test.each([
    ["http://oneuptime.example.com/", "oneuptime.example.com"],
    [
      "https://oneuptime.example.com:8443/dashboard",
      "oneuptime.example.com:8443",
    ],
    ["  oneuptime.example.com  ", "oneuptime.example.com"],
    ["localhost", "localhost"],
    ["[2001:db8::5]", "[2001:db8::5]"],
  ])("an answer of %p is written as HOST=%s", (answer, host) => {
    const result = run({ answers: `${answer}\n` });

    expect(result.status).toBe(0);
    expect(hostIn(result.config)).toBe(`HOST=${host}`);
  });

  test("an answer no browser can open stops before anything starts", () => {
    const result = run({ answers: "my server!\n" });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      '"myserver!" is not an address people can open.',
    );
    expect(callsOf(result, "npm")).toEqual([]);
  });

  test("ONEUPTIME_HOST answers without a question", () => {
    const result = run(
      { answers: "should-not-be-read\n" },
      { ONEUPTIME_HOST: "http://oneuptime.example.com/" },
    );

    expect(result.output).not.toContain("Which address");
    expect(hostIn(result.config)).toBe("HOST=oneuptime.example.com");
  });

  test("with nobody to ask (no terminal), HOST stays localhost and OneUptime starts", () => {
    const result = run({ answers: null });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain("Which address");
    expect(hostIn(result.config)).toBe("HOST=localhost");
    expect(callsOf(result, "npm")).toEqual(["npm start"]);
  });

  test("ONEUPTIME_DIR and ONEUPTIME_BRANCH say where and what to fetch", () => {
    const result = run(
      { answers: null },
      { ONEUPTIME_DIR: "my-oneuptime", ONEUPTIME_BRANCH: "14.0.87" },
    );

    expect(callsOf(result, "git")).toEqual([
      `git clone --depth 1 --single-branch --branch 14.0.87 ${REPOSITORY} my-oneuptime`,
    ]);
    expect(result.calls).toContain(
      `npm-cwd ${path.join(result.home, "my-oneuptime")}`,
    );
  });
});

describe("run again on an earlier install", () => {
  test("it updates the clone in place and keeps config.env, asking nothing", () => {
    const result = run({ existing: "clone", answers: "203.0.113.5\n" });

    expect(result.status).toBe(0);
    expect(callsOf(result, "git")).toEqual(["git -C oneuptime pull --ff-only"]);
    expect(result.output).not.toContain("Which address");
    expect(hostIn(result.config)).toBe("HOST=oneuptime.example.com");
    expect(callsOf(result, "npm")).toEqual(["npm start"]);
  });

  test("an earlier install still on localhost is asked", () => {
    const result = run({
      existing: "clone",
      existingHost: "localhost",
      answers: "oneuptime.example.com\n",
    });

    expect(hostIn(result.config)).toBe("HOST=oneuptime.example.com");
  });

  test("a folder called oneuptime that is not a clone is never touched", () => {
    const result = run({ existing: "folder", answers: null });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "oneuptime already exists and is not a OneUptime folder.",
    );
    expect(callsOf(result, "git")).toEqual([]);
    expect(callsOf(result, "npm")).toEqual([]);
  });
});

describe("installing what is missing", () => {
  test("no Node.js on Debian or Ubuntu: NodeSource's Debian setup, then apt-get", () => {
    const result = run({ node: null, answers: null });

    expect(result.status).toBe(0);
    expect(callsOf(result, "curl")).toEqual([
      "curl -fsSL https://deb.nodesource.com/setup_lts.x",
    ]);
    expect(result.calls).toContain("sudo bash -");
    expect(result.calls).toContain("apt-get install -y nodejs");
    expect(result.output).toContain("✓ Node.js v22.11.0");
  });

  test("a Node.js older than 14 is replaced the same way", () => {
    const result = run({ node: "v12.22.9", answers: null });

    expect(callsOf(result, "curl")).toEqual([
      "curl -fsSL https://deb.nodesource.com/setup_lts.x",
    ]);
    expect(result.output).toContain("✓ Node.js v22.11.0");
  });

  test("no Node.js on a RedHat-like system: NodeSource's RPM setup, then dnf", () => {
    const result = run({ node: null, manager: "dnf", answers: null });

    expect(result.status).toBe(0);
    expect(callsOf(result, "curl")).toEqual([
      "curl -fsSL https://rpm.nodesource.com/setup_lts.x",
    ]);
    expect(result.calls).toContain("dnf install -y nodejs");
  });

  test("no Docker on Linux: Docker's own installer, run as root", () => {
    const result = run({ docker: "missing", answers: null });

    expect(result.status).toBe(0);
    expect(callsOf(result, "curl")).toEqual([
      "curl -fsSL https://get.docker.com",
    ]);
    expect(result.calls).toContain("sudo sh");
    expect(callsOf(result, "npm")).toEqual(["npm start"]);
  });

  test("Docker without the Compose plugin: the plugin's package", () => {
    const result = run({ docker: "compose-missing", answers: null });

    expect(result.status).toBe(0);
    expect(result.calls).toContain("apt-get install -y docker-compose-plugin");
  });

  test("no Docker on a Mac: Docker Desktop, which the installer cannot install", () => {
    const result = run({
      docker: "missing",
      system: "Darwin",
      manager: null,
      answers: null,
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Docker is not installed. Install Docker Desktop",
    );
    expect(callsOf(result, "curl")).toEqual([]);
  });

  test("as root, nothing goes through sudo", () => {
    const result = run({ uid: 0, node: null, answers: null });

    expect(result.status).toBe(0);
    expect(callsOf(result, "sudo")).toEqual([]);
    expect(result.calls).toContain("apt-get install -y nodejs");
  });
});

describe("a user Docker refuses", () => {
  test("is added to the docker group, and this run starts OneUptime with that group", () => {
    const result = run({ docker: "permission", answers: null });

    expect(result.status).toBe(0);
    expect(result.calls).toContain("sudo usermod -aG docker tester");
    expect(callsOf(result, "sg")).toEqual(["sg docker -c npm start"]);
    expect(callsOf(result, "npm")).toEqual(["npm start"]);
    expect(result.output).toContain(
      "Sign out and back in once OneUptime is up",
    );
  });

  test("root that Docker refuses is told so, and nothing starts", () => {
    const result = run({ uid: 0, docker: "permission", answers: null });

    expect(result.status).toBe(1);
    expect(result.output).toContain("Docker does not answer");
    expect(callsOf(result, "npm")).toEqual([]);
  });
});

describe("the script", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");

  test("is valid bash", () => {
    const result = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });

    expect(result.status).toBe(0);
  });

  test("fetches the release, never master, and leaves the secrets to npm start", () => {
    expect(source).toContain('BRANCH="${ONEUPTIME_BRANCH:-release}"');
    expect(source).toContain(
      'git clone --depth 1 --single-branch --branch "$BRANCH" "$REPOSITORY" "$INSTALL_DIR"',
    );
    // No GNU-only sed, and no secret handling of its own.
    expect(source).not.toContain("0,/");
    expect(source).not.toContain("please-change-this");
    expect(source).not.toContain("openssl rand");
  });

  test("is the file the website serves at /install.sh", () => {
    expect(
      fs.readFileSync(
        path.join(REPO_ROOT, "packages", "Home", "Utils", "Config.ts"),
        "utf8",
      ),
    ).toContain(
      'export const InstallScriptPath: string = "/usr/src/app/Scripts/Install.sh";',
    );
  });
});
