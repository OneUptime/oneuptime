"use strict";

/**
 * Scripts/MCP/BuildChatGPTPlugin.sh (`npm run build-chatgpt-plugin`) builds
 * the ZIP OneUptime uploads to the ChatGPT plugin directory, from the package
 * in packages/App/FeatureSet/MCP/ChatGPTPlugin. The portal reads plugin.json,
 * mcp.json and the files they name from the root of the archive, so this
 * holds what the ZIP contains: every file of the package but its README, at
 * the root, byte for byte, and nothing left from an earlier build. What the
 * package says is held by packages/App/FeatureSet/MCP/Tests/ChatGPTPlugin.test.ts.
 *
 * It needs zip and unzip, which the Ops workflow's runner has. Without them
 * the ZIP checks are skipped with the reason logged, except when CI is set:
 * then they fail, because a check of a ZIP must not pass by skipping.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Scripts/MCP/BuildChatGPTPlugin.sh";
const PACKAGE_DIRECTORY = "packages/App/FeatureSet/MCP/ChatGPTPlugin";

function hasCommand(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;
}

const HAS_ZIP = hasCommand("zip") && hasCommand("unzip");
const IN_CI = Boolean(process.env["CI"]);

if (!HAS_ZIP && !IN_CI) {
  console.log(
    "ChatGPT plugin ZIP checks skipped: zip or unzip is not on PATH (the Ops workflow's runner has both).",
  );
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// Every file of the package, as a path from its root, but the README.
function packageFiles() {
  const root = path.join(REPO_ROOT, PACKAGE_DIRECTORY);

  return filesUnder(root)
    .map((file) => {
      return path.relative(root, file).split(path.sep).join("/");
    })
    .filter((file) => {
      return file !== "README.md";
    })
    .sort();
}

function entriesOf(zipFile) {
  const result = spawnSync("unzip", ["-Z1", zipFile], { encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout
    .split("\n")
    .filter((line) => {
      return line.length > 0;
    })
    .sort();
}

test("npm run build-chatgpt-plugin runs it", () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ).scripts;

  expect(scripts["build-chatgpt-plugin"]).toBe(`bash ./${SCRIPT}`);
});

(HAS_ZIP || IN_CI ? describe : describe.skip)(`${SCRIPT}`, () => {
  let workDir = "";

  beforeAll(() => {
    if (!HAS_ZIP) {
      throw new Error(
        "CI is set but zip or unzip is not on PATH; these checks must not pass by skipping.",
      );
    }
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-plugin-"));
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  function build(args, cwd = REPO_ROOT) {
    const env = { ...process.env };
    // As when it is run with bash directly, not through npm.
    delete env.INIT_CWD;
    return spawnSync("bash", [path.join(REPO_ROOT, SCRIPT), ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 60000,
    });
  }

  test("puts every file of the package but its README at the root of the ZIP (the checks below are not vacuous)", () => {
    const zipFile = path.join(workDir, "plugin.zip");
    const result = build([zipFile]);

    expect(result.status).toBe(0);
    expect(packageFiles()).toEqual(
      expect.arrayContaining(["plugin.json", "mcp.json"]),
    );
    expect(entriesOf(zipFile)).toEqual(packageFiles());
  });

  test("copies each file byte for byte", () => {
    const zipFile = path.join(workDir, "bytes.zip");
    expect(build([zipFile]).status).toBe(0);

    for (const file of packageFiles()) {
      const unzipped = spawnSync("unzip", ["-p", zipFile, file]);
      const source = fs.readFileSync(
        path.join(REPO_ROOT, PACKAGE_DIRECTORY, file),
      );

      expect([file, Buffer.compare(unzipped.stdout, source)]).toEqual([
        file,
        0,
      ]);
    }
  });

  test("replaces an earlier ZIP rather than adding to it", () => {
    const zipFile = path.join(workDir, "rebuilt.zip");
    const stray = path.join(workDir, "stray.txt");
    fs.writeFileSync(stray, "left over");
    expect(
      spawnSync("zip", ["-q", "-j", zipFile, stray], { cwd: workDir }).status,
    ).toBe(0);

    expect(build([zipFile]).status).toBe(0);
    expect(entriesOf(zipFile)).toEqual(packageFiles());
  });

  test("writes a relative output path where it is run from, and npm's INIT_CWD wins", () => {
    const here = path.join(workDir, "here");
    fs.mkdirSync(here);

    expect(build(["out/plugin.zip"], here).status).toBe(0);
    expect(fs.existsSync(path.join(here, "out", "plugin.zip"))).toBe(true);

    // npm runs the script from the repository root and keeps the caller's place in INIT_CWD.
    const caller = path.join(workDir, "caller");
    fs.mkdirSync(caller);
    const throughNpm = spawnSync(
      "bash",
      [path.join(REPO_ROOT, SCRIPT), "via-npm.zip"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, INIT_CWD: caller },
        encoding: "utf8",
        timeout: 60000,
      },
    );

    expect(throughNpm.status).toBe(0);
    expect(fs.existsSync(path.join(caller, "via-npm.zip"))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "via-npm.zip"))).toBe(false);
  });
});
