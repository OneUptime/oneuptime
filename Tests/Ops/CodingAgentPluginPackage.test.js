"use strict";

/**
 * Scripts/MCP/BuildCodingAgentPlugin.js (`npm run build-coding-agent-plugin`)
 * builds the folder OneUptime publishes as its plugin for coding agents, from
 * packages/App/FeatureSet/MCP/CodingAgentPlugin and the ChatGPT package's
 * listing. A maintainer builds it into a clone of the plugin's repository and
 * pushes, so this holds what the build does to a folder: every file the
 * package publishes in its place, byte for byte; nothing left from an earlier
 * build, while the clone's .git stays; and no folder emptied that the build
 * did not write. What the plugin says is held by
 * packages/App/FeatureSet/MCP/Tests/CodingAgentPlugin.test.ts.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Scripts/MCP/BuildCodingAgentPlugin.js";
const PACKAGE_DIRECTORY = "packages/App/FeatureSet/MCP/CodingAgentPlugin";
const CHATGPT_DIRECTORY = "packages/App/FeatureSet/MCP/ChatGPTPlugin";

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function relativeFiles(directory) {
  return filesUnder(directory)
    .map((file) => {
      return path.relative(directory, file).split(path.sep).join("/");
    })
    .sort();
}

// The skills, as the package holds them.
function skillFiles() {
  return relativeFiles(path.join(REPO_ROOT, PACKAGE_DIRECTORY, "skills")).map(
    (file) => {
      return `skills/${file}`;
    },
  );
}

function build(args, options = {}) {
  const env = { ...process.env, ...options.env };

  if (!options.env || !("INIT_CWD" in options.env)) {
    // As when it is run with node directly, not through npm.
    delete env.INIT_CWD;
  }

  return spawnSync(process.execPath, [path.join(REPO_ROOT, SCRIPT), ...args], {
    cwd: options.cwd || REPO_ROOT,
    env,
    encoding: "utf8",
    timeout: 60000,
  });
}

let workDir = "";

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "coding-agent-plugin-"));
});

afterAll(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test("npm run build-coding-agent-plugin runs it", () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ).scripts;

  expect(scripts["build-coding-agent-plugin"]).toBe(`node ./${SCRIPT}`);
});

test("writes the manifests, the README, the licence, the icon and every skill, and nothing else", () => {
  const output = path.join(workDir, "all");
  const result = build([output]);

  expect(result.status).toBe(0);
  expect(skillFiles().length).toBeGreaterThanOrEqual(3);
  expect(relativeFiles(output)).toEqual(
    [
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
      ".mcp.json",
      "LICENSE",
      "NOTICE",
      "README.md",
      "assets/logo.png",
      "mcp.json",
      "plugin.json",
      ...skillFiles(),
    ].sort(),
  );
});

test("copies the skills, the licence and the ChatGPT listing's icon byte for byte", () => {
  const output = path.join(workDir, "bytes");
  expect(build([output]).status).toBe(0);

  const copies = [
    ...skillFiles().map((file) => {
      return [file, path.join(PACKAGE_DIRECTORY, file)];
    }),
    ["LICENSE", "LICENSE"],
    ["NOTICE", "NOTICE"],
    ["assets/logo.png", path.join(CHATGPT_DIRECTORY, "assets/logo.png")],
  ];

  for (const [built, source] of copies) {
    expect([
      built,
      Buffer.compare(
        fs.readFileSync(path.join(output, built)),
        fs.readFileSync(path.join(REPO_ROOT, source)),
      ),
    ]).toEqual([built, 0]);
  }
});

test("replaces an earlier build, and keeps the .git of a clone", () => {
  const output = path.join(workDir, "clone");
  expect(build([output]).status).toBe(0);

  fs.writeFileSync(path.join(output, "stray.txt"), "left over");
  fs.mkdirSync(path.join(output, ".git"));
  fs.writeFileSync(path.join(output, ".git", "HEAD"), "ref: refs/heads/main\n");

  expect(build([output]).status).toBe(0);
  expect(fs.existsSync(path.join(output, "stray.txt"))).toBe(false);
  expect(fs.readFileSync(path.join(output, ".git", "HEAD"), "utf8")).toBe(
    "ref: refs/heads/main\n",
  );
});

test("refuses a folder that holds something else, and leaves it as it was", () => {
  const output = path.join(workDir, "someone-elses");
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, "notes.txt"), "keep me");

  const result = build([output]);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("is not an earlier build of this plugin");
  expect(fs.readdirSync(output)).toEqual(["notes.txt"]);
});

test("writes a relative output path where it is run from, and npm's INIT_CWD wins", () => {
  const here = path.join(workDir, "here");
  fs.mkdirSync(here);

  expect(build(["out/oneuptime"], { cwd: here }).status).toBe(0);
  expect(
    fs.existsSync(path.join(here, "out", "oneuptime", ".claude-plugin")),
  ).toBe(true);

  // npm runs the script from the repository root and keeps the caller's place in INIT_CWD.
  const caller = path.join(workDir, "caller");
  fs.mkdirSync(caller);

  expect(
    build(["via-npm"], { cwd: REPO_ROOT, env: { INIT_CWD: caller } }).status,
  ).toBe(0);
  expect(fs.existsSync(path.join(caller, "via-npm", "plugin.json"))).toBe(true);
  expect(fs.existsSync(path.join(REPO_ROOT, "via-npm"))).toBe(false);
});
