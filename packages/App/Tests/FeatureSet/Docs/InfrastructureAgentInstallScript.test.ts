import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The infrastructure agent's install script, served at
 * /docs/static/scripts/infrastructure-agent/install.sh and run as
 * `curl ... | sudo bash`. It is run here for real, against stand-ins for
 * curl, wget and the release, so nothing is downloaded and nothing is
 * installed outside a temporary folder.
 *
 * Run with sudo it used to install the agent in $HOME/bin - /root/bin - which
 * is not on sudo's path, so the next step, `sudo oneuptime-infrastructure-agent
 * configure`, was not found. Without wget it ran `apt-get install wget`, with
 * no -y, on any distribution, though it had just used curl itself.
 */

const INSTALL_SH: string = path.join(
  __dirname,
  "../../../FeatureSet/Docs/Static/scripts/infrastructure-agent/install.sh",
);

const TAG: string = "14.0.1234";
const RELEASE_URL: string = `https://github.com/oneuptime/oneuptime/releases/download/${TAG}/oneuptime-infrastructure-agent_linux_amd64.tar.gz`;

// The programs the script runs besides the stand-ins, found on the host.
const HOST_TOOLS: Array<string> = [
  "sh",
  "tr",
  "grep",
  "sed",
  "mktemp",
  "rm",
  "tar",
  "gzip",
  "cp",
  "chmod",
  "mv",
  "mkdir",
  "cat",
  "dirname",
];

let workDir: string;
let releaseArchive: string;

function hostTool(name: string): string | null {
  for (const directory of ["/usr/bin", "/bin", "/usr/local/bin"]) {
    const candidate: string = path.join(directory, name);

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function writeExecutable(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

/*
 * A folder of programs for the script's PATH: the host tools it needs, an
 * `id` that answers uid, a `uname` of a Linux x86-64 machine, curl and wget
 * stand-ins when asked for, which serve the release, and an apt-get that only
 * records that it ran.
 */
function makeBin(options: {
  uid: number;
  curl: boolean;
  wget: boolean;
  refuseToCreate?: string | undefined;
}): string {
  const bin: string = fs.mkdtempSync(path.join(workDir, "bin-"));

  for (const tool of HOST_TOOLS) {
    const found: string | null = hostTool(tool);

    if (found && !(tool === "mkdir" && options.refuseToCreate)) {
      fs.symlinkSync(found, path.join(bin, tool));
    }
  }

  if (options.refuseToCreate) {
    // Stops the script before it creates the folder, and so before it installs anything.
    writeExecutable(
      path.join(bin, "mkdir"),
      `#!/bin/sh\nfor arg in "$@"; do if [ "$arg" = "${options.refuseToCreate}" ]; then echo "refused to create $arg" >&2; exit 1; fi; done\nexec ${hostTool("mkdir")} "$@"\n`,
    );
  }

  writeExecutable(
    path.join(bin, "id"),
    `#!/bin/sh\nif [ "$1" = "-u" ]; then echo ${options.uid}; else echo agent-test; fi\n`,
  );
  writeExecutable(
    path.join(bin, "uname"),
    '#!/bin/sh\nif [ "$1" = "-m" ]; then echo x86_64; else echo Linux; fi\n',
  );
  writeExecutable(
    path.join(bin, "apt-get"),
    '#!/bin/sh\necho "apt-get $*" >> "$CALLS"\nexit 1\n',
  );

  // Answers the latest release, then serves its archive.
  const serve: string = [
    'echo "$url" >> "$CALLS"',
    'case "$url" in',
    `  *api.github.com*) printf '{\\n  "tag_name": "${TAG}",\\n  "name": "${TAG}"\\n}\\n' ;;`,
    `  ${RELEASE_URL}) if [ "$out" = "-" ]; then cat "$RELEASE"; else cat "$RELEASE" > "$out"; fi ;;`,
    "  *) exit 22 ;;",
    "esac",
  ].join("\n");

  if (options.curl) {
    writeExecutable(
      path.join(bin, "curl"),
      [
        "#!/bin/sh",
        'url=""; out="-"',
        'while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done',
        serve,
        "",
      ].join("\n"),
    );
  }

  if (options.wget) {
    writeExecutable(
      path.join(bin, "wget"),
      [
        "#!/bin/sh",
        'url=""; out="-"',
        'while [ $# -gt 0 ]; do case "$1" in -qO-) out="-"; shift ;; -O) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done',
        serve,
        "",
      ].join("\n"),
    );
  }

  return bin;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: Array<string>;
}

function runInstaller(data: {
  bin: string;
  home: string;
  args?: Array<string> | undefined;
  extraPath?: string | undefined;
}): Run {
  const calls: string = path.join(workDir, `calls-${path.basename(data.bin)}`);

  fs.writeFileSync(calls, "");

  const result: SpawnSyncReturns<string> = spawnSync(
    path.join(data.bin, "sh"),
    [INSTALL_SH, ...(data.args || [])],
    {
      encoding: "utf8",
      env: {
        HOME: data.home,
        PATH: [data.bin, data.extraPath].filter(Boolean).join(path.delimiter),
        CALLS: calls,
        RELEASE: releaseArchive,
        TMPDIR: workDir,
      },
      timeout: 20000,
    },
  );

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: fs.readFileSync(calls, "utf8").split("\n").filter(Boolean),
  };
}

beforeAll(() => {
  workDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "infrastructure-agent-install-")),
  );

  // The release's archive: the agent, with the README and LICENSE beside it.
  const release: string = path.join(workDir, "release");
  fs.mkdirSync(release);
  writeExecutable(
    path.join(release, "oneuptime-infrastructure-agent"),
    "#!/bin/sh\necho agent\n",
  );
  fs.writeFileSync(path.join(release, "README.md"), "readme");
  fs.writeFileSync(path.join(release, "LICENSE"), "license");

  releaseArchive = path.join(workDir, "release.tar.gz");
  const tar: SpawnSyncReturns<string> = spawnSync(
    "tar",
    [
      "-czf",
      releaseArchive,
      "-C",
      release,
      "oneuptime-infrastructure-agent",
      "README.md",
      "LICENSE",
    ],
    { encoding: "utf8" },
  );
  expect(tar.status).toBe(0);
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("the infrastructure agent's install script", () => {
  test("run as root, installs the agent in /usr/local/bin, which sudo finds", () => {
    const run: Run = runInstaller({
      bin: makeBin({
        uid: 0,
        curl: true,
        wget: false,
        refuseToCreate: "/usr/local/bin",
      }),
      home: path.join(workDir, "root-home"),
    });

    // Stopped by the stand-in mkdir before anything was downloaded or installed.
    expect(run.stdout).toContain("Installing to /usr/local/bin\n");
    expect(run.stderr).toContain("refused to create /usr/local/bin");
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
  });

  test("run as another user, installs only the agent in $HOME/bin, and prints the commands by its full path", () => {
    const home: string = path.join(workDir, "user-home");
    const run: Run = runInstaller({
      bin: makeBin({ uid: 1000, curl: true, wget: false }),
      home: home,
    });
    const binDir: string = path.join(home, "bin");

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Installing to ${binDir}\n`);
    expect(run.calls).toEqual([
      "https://api.github.com/repos/oneuptime/oneuptime/releases/latest",
      RELEASE_URL,
    ]);
    expect(fs.readdirSync(binDir)).toEqual(["oneuptime-infrastructure-agent"]);
    expect(
      fs.statSync(path.join(binDir, "oneuptime-infrastructure-agent")).mode &
        0o111,
    ).not.toBe(0);
    expect(run.stdout).toContain(
      `oneuptime-infrastructure-agent ${TAG} has been installed to ${binDir}`,
    );
    // $HOME/bin is not on the path, so the commands name the agent by its path.
    expect(run.stdout).toContain(
      `  sudo ${binDir}/oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com\n  sudo ${binDir}/oneuptime-infrastructure-agent start\n`,
    );
    // No shell's start-up file is written to.
    expect(fs.readdirSync(home)).toEqual(["bin"]);
  });

  test("installs where -b says, and names the agent alone when that is on the path", () => {
    const binDir: string = path.join(workDir, "on-path");
    const run: Run = runInstaller({
      bin: makeBin({ uid: 0, curl: true, wget: false }),
      home: path.join(workDir, "b-home"),
      args: ["-b", binDir],
      extraPath: binDir,
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Installing to ${binDir}\n`);
    expect(fs.readdirSync(binDir)).toEqual(["oneuptime-infrastructure-agent"]);
    expect(run.stdout).toContain(
      "  sudo oneuptime-infrastructure-agent configure --secret-key=YOUR_SECRET_KEY --oneuptime-url=https://oneuptime.com\n",
    );
  });

  test("replaces the agent an earlier run installed", () => {
    const binDir: string = path.join(workDir, "upgrade");
    fs.mkdirSync(binDir);
    writeExecutable(
      path.join(binDir, "oneuptime-infrastructure-agent"),
      "#!/bin/sh\necho old agent\n",
    );

    const run: Run = runInstaller({
      bin: makeBin({ uid: 0, curl: true, wget: false }),
      home: path.join(workDir, "upgrade-home"),
      args: ["-b", binDir],
    });

    expect(run.status).toBe(0);
    expect(
      fs.readFileSync(
        path.join(binDir, "oneuptime-infrastructure-agent"),
        "utf8",
      ),
    ).toBe("#!/bin/sh\necho agent\n");
    expect(fs.readdirSync(binDir)).toEqual(["oneuptime-infrastructure-agent"]);
  });

  test("downloads with wget where there is no curl, and installs no package", () => {
    const binDir: string = path.join(workDir, "with-wget");
    const run: Run = runInstaller({
      bin: makeBin({ uid: 0, curl: false, wget: true }),
      home: path.join(workDir, "wget-home"),
      args: ["-b", binDir],
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([
      "https://api.github.com/repos/oneuptime/oneuptime/releases/latest",
      RELEASE_URL,
    ]);
    expect(fs.readdirSync(binDir)).toEqual(["oneuptime-infrastructure-agent"]);
  });

  test("with neither curl nor wget, says so and installs nothing", () => {
    const binDir: string = path.join(workDir, "no-download");
    const run: Run = runInstaller({
      bin: makeBin({ uid: 0, curl: false, wget: false }),
      home: path.join(workDir, "none-home"),
      args: ["-b", binDir],
    });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(
      "Neither curl nor wget is installed. Install one of them, then run this script again.",
    );
    // apt-get is not run - on any distribution.
    expect(run.calls).toEqual([]);
    expect(fs.readdirSync(binDir)).toEqual([]);
  });
});
