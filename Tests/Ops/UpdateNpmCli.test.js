"use strict";

/**
 * Scripts/Docker/UpdateNpmCli.js - how every Node image updates the npm CLI it
 * ships.
 *
 * npm bundles its whole dependency tree, so the tar, undici, brace-expansion
 * and ip-address under <global root>/npm/node_modules are whatever the npm
 * release was packed with. Container scanners reported nine vulnerabilities in
 * exactly those four packages in every Node image: `npm install -g npm@latest`
 * installed npm 12.0.2 with the tar 7.5.19, undici 6.27.0, brace-expansion
 * 5.0.7 and ip-address 10.2.0 it was packed with in July.
 *
 * What has to hold, and what each part of this suite pins:
 *
 *  - The version choice: the release `npm@latest` names (npm 12 blocks
 *    unapproved dependency install scripts, npm 11 runs them, so the major
 *    is not incidental), never a prerelease, never older than the image's.
 *  - The install: npm's own resolver over npm's runtime dependencies, from a
 *    manifest without bundleDependencies/workspaces/devDependencies/scripts;
 *    the published manifest is what ships.
 *  - The checks: the new npm must report the version and pass `npm ls --all
 *    --omit=dev` before anything is replaced, and again after.
 *  - Failure: nothing is replaced unless every step succeeded, the old npm
 *    survives any failure, and no staging directory is left in the image.
 *
 * The pure parts run everywhere. The real thing - a vulnerable npm fixture
 * from the registry, updated in place and then used for a real install, and
 * the same script run inside node:26-alpine3.24 through the repository's real
 * .dockerignore - needs the network (and docker), so it runs with
 *
 *   RUN_NPM_CLI_UPDATE_TESTS=1 npm test
 *
 * which the "Ops Config Test" workflow sets.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  FIELDS_REMOVED_FOR_INSTALL,
  compareVersions,
  describeDiff,
  diffPackages,
  installedPackages,
  manifestForInstall,
  targetVersion,
  parseArguments,
  parseVersion,
  replaceDirectory,
  runCommand,
  updateNpmCli,
  verifyNpm,
} = require("../../Scripts/Docker/UpdateNpmCli.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "Scripts", "Docker", "UpdateNpmCli.js");
const RUNTIME = process.env["RUN_NPM_CLI_UPDATE_TESTS"] === "1";

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Lays out an npm package directory: its manifest, a bin/npm-cli.js, and the
 * given node_modules tree ({ "tar": "7.5.19", "a/node_modules/b": "1.0.0" }).
 */
function writeNpmPackage(directory, manifest, modules) {
  writeJson(path.join(directory, "package.json"), manifest);
  fs.mkdirSync(path.join(directory, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "bin", "npm-cli.js"),
    "#!/usr/bin/env node\n",
  );
  for (const [location, version] of Object.entries(modules)) {
    const name = location.split("/node_modules/").pop();
    writeJson(path.join(directory, "node_modules", location, "package.json"), {
      name,
      version,
    });
  }
}

function publishedManifest(version) {
  return {
    name: "npm",
    version,
    workspaces: ["docs", "workspaces/*"],
    bin: { npm: "bin/npm-cli.js", npx: "bin/npx-cli.js" },
    dependencies: { tar: "^7.5.1", undici: "^6.25.0" },
    bundleDependencies: ["tar", "undici"],
    devDependencies: { "@npmcli/docs": "^1.0.0" },
    scripts: { prepare: "node scripts/prepare.js" },
  };
}

/**
 * A stand-in for the commands updateNpmCli runs. It answers like npm, tar and
 * the new npm's own CLI would, records every call, and can be told to fail
 * at one step.
 */
function fakeCommands(options) {
  const calls = [];
  const seen = {};
  let packedVersion = null;

  const run = (command, args, runOptions = {}) => {
    calls.push({ command, args, cwd: runOptions.cwd });

    if (command === "npm" && args[0] === "view") {
      return JSON.stringify(options.latest);
    }

    if (command === "npm" && args[0] === "pack") {
      packedVersion = args[1].replace(/^npm@/, "");
      const destination = args[args.indexOf("--pack-destination") + 1];
      fs.writeFileSync(
        path.join(destination, `npm-${packedVersion}.tgz`),
        "tarball",
      );
      return JSON.stringify([{ filename: `npm-${packedVersion}.tgz` }]);
    }

    if (command === "tar") {
      const destination = args[args.indexOf("-C") + 1];
      writeNpmPackage(
        path.join(destination, "package"),
        publishedManifest(packedVersion),
        { tar: "7.5.19", undici: "6.27.0" },
      );
      return "";
    }

    if (command === "npm" && args[0] === "install") {
      seen.installManifest = readJson(
        path.join(runOptions.cwd, "package.json"),
      );
      seen.bundledTreeAtInstall = fs.existsSync(
        path.join(runOptions.cwd, "node_modules"),
      );
      seen.installArgs = args;
      if (options.failInstall) {
        throw new Error("npm install exited with 1");
      }
      for (const [name, version] of Object.entries(
        options.installs || { tar: "7.5.22", undici: "6.28.1" },
      )) {
        writeJson(
          path.join(runOptions.cwd, "node_modules", name, "package.json"),
          { name, version },
        );
      }
      return "";
    }

    if (command === process.execPath) {
      const npmDirectory = path.dirname(path.dirname(args[0]));
      if (args[1] === "--version") {
        if (options.reportVersion) {
          return `${options.reportVersion}\n`;
        }
        return `${readJson(path.join(npmDirectory, "package.json")).version}\n`;
      }
      if (args[1] === "ls") {
        if (options.failLs && options.failLs(npmDirectory)) {
          throw new Error("npm ls exited with 1: missing: tar@^7.5.1");
        }
        return "";
      }
    }

    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };

  return { run, calls, seen };
}

/** A global prefix holding npm at `version`, with an optional builtin npmrc. */
function imageNpm(version, extra = {}) {
  const prefix = temporaryDirectory("npm-cli-update-");
  const npmDir = path.join(prefix, "lib", "node_modules", "npm");
  writeNpmPackage(npmDir, publishedManifest(version), {
    tar: "7.5.19",
    undici: "6.27.0",
    "brace-expansion": "5.0.7",
  });
  if (extra.npmrc) {
    fs.writeFileSync(path.join(npmDir, "npmrc"), extra.npmrc);
  }
  return npmDir;
}

function snapshot(directory) {
  const files = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files[path.relative(directory, full)] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(directory);
  return files;
}

function leftovers(npmDir) {
  return fs.readdirSync(path.dirname(npmDir)).filter((entry) => {
    return entry !== "npm";
  });
}

describe("parseVersion / compareVersions", () => {
  test("reads plain releases only", () => {
    expect(parseVersion("11.19.1")).toEqual([11, 19, 1]);
    expect(parseVersion("0.0.0")).toEqual([0, 0, 0]);
    expect(parseVersion("12.0.0-pre.3")).toBeNull();
    expect(parseVersion("11.19.1+build.5")).toBeNull();
    expect(parseVersion("v11.19.1")).toBeNull();
    expect(parseVersion("11.19")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  test("orders numerically, not as strings", () => {
    expect(compareVersions("11.19.1", "11.9.10")).toBeGreaterThan(0);
    expect(compareVersions("11.9.10", "11.19.1")).toBeLessThan(0);
    expect(compareVersions("10.0.0", "9.99.99")).toBeGreaterThan(0);
    expect(compareVersions("11.19.1", "11.19.1")).toBe(0);
  });

  test("refuses to order anything but plain releases", () => {
    expect(() => {
      return compareVersions("11.19.1", "12.0.0-pre.3");
    }).toThrow("Cannot compare versions");
  });
});

describe("targetVersion", () => {
  test("takes the release npm@latest names, across majors", () => {
    // node:26 ships npm 11.19.1; on 2026-09-22 `latest` was 12.0.2.
    expect(targetVersion("12.0.2", "11.19.1")).toBe("12.0.2");
    expect(targetVersion("11.19.1", "11.18.0")).toBe("11.19.1");
  });

  test("keeps the image's npm when it is already that release", () => {
    expect(targetVersion("12.0.2", "12.0.2")).toBe("12.0.2");
  });

  test("never moves backwards", () => {
    expect(targetVersion("12.0.2", "12.1.0")).toBe("12.1.0");
    expect(targetVersion("12.0.2", "13.0.0")).toBe("13.0.0");
  });

  test("orders numerically, not as strings", () => {
    expect(targetVersion("12.10.0", "12.9.0")).toBe("12.10.0");
  });

  test("accepts a one-element array as npm view can answer", () => {
    expect(targetVersion(["12.0.2"], "11.19.1")).toBe("12.0.2");
  });

  test("refuses anything but exactly one plain release", () => {
    for (const answer of ["13.0.0-pre.1", [], ["12.0.1", "12.0.2"], "", null]) {
      expect(() => {
        return targetVersion(answer, "11.19.1");
      }).toThrow("npm@latest does not name one plain release");
    }
  });
});

describe("parseArguments", () => {
  test("defaults to the global npm and a real update", () => {
    expect(parseArguments([])).toEqual({ npmDir: null, dryRun: false });
  });

  test("reads --npm-dir and --dry-run in any order", () => {
    expect(parseArguments(["--dry-run", "--npm-dir", "/x/npm"])).toEqual({
      npmDir: "/x/npm",
      dryRun: true,
    });
    expect(parseArguments(["--npm-dir", "/x/npm"])).toEqual({
      npmDir: "/x/npm",
      dryRun: false,
    });
  });

  test("refuses --npm-dir without a path, and unknown arguments", () => {
    expect(() => {
      return parseArguments(["--npm-dir"]);
    }).toThrow("--npm-dir needs a path");
    expect(() => {
      return parseArguments(["--npm-dir", "--dry-run"]);
    }).toThrow("--npm-dir needs a path");
    expect(() => {
      return parseArguments(["--latest"]);
    }).toThrow("Unknown argument: --latest");
  });

  test("the CLI exits non-zero with the reason on a bad argument", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--bogus"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UpdateNpmCli: Unknown argument: --bogus");
  });
});

describe("manifestForInstall", () => {
  test("drops exactly the fields that stop an ordinary install", () => {
    expect(FIELDS_REMOVED_FOR_INSTALL).toEqual([
      "bundleDependencies",
      "bundledDependencies",
      "devDependencies",
      "workspaces",
      "scripts",
    ]);
    const manifest = publishedManifest("11.19.1");
    const prepared = manifestForInstall(manifest);
    for (const field of FIELDS_REMOVED_FOR_INSTALL) {
      expect(prepared).not.toHaveProperty(field);
    }
    expect(prepared).toEqual({
      name: "npm",
      version: "11.19.1",
      bin: manifest.bin,
      dependencies: manifest.dependencies,
    });
  });

  test("also drops the legacy bundledDependencies spelling", () => {
    expect(
      manifestForInstall({ name: "npm", bundledDependencies: ["tar"] }),
    ).toEqual({ name: "npm" });
  });

  test("leaves the published manifest untouched", () => {
    const manifest = publishedManifest("11.19.1");
    const before = JSON.stringify(manifest);
    manifestForInstall(manifest);
    expect(JSON.stringify(manifest)).toBe(before);
  });
});

describe("installedPackages / diffPackages / describeDiff", () => {
  test("finds every package at any depth, scoped ones included", () => {
    const directory = temporaryDirectory("npm-tree-");
    writeNpmPackage(
      directory,
      { name: "npm", version: "11.19.1" },
      {
        tar: "7.5.22",
        "@npmcli/arborist": "9.9.1",
        "@npmcli/arborist/node_modules/lru-cache": "10.4.3",
        "minipass-flush/node_modules/minipass": "3.3.6",
        minipass: "7.1.3",
      },
    );
    // Not packages: dot entries (.bin, .package-lock.json) and loose files.
    fs.mkdirSync(path.join(directory, "node_modules", ".bin"));
    writeJson(path.join(directory, "node_modules", ".cache", "package.json"), {
      name: "cache",
      version: "1.0.0",
    });
    fs.writeFileSync(path.join(directory, "node_modules", "README"), "x");

    const found = installedPackages(directory);
    expect([...found.keys()].sort()).toEqual([
      "@npmcli/arborist",
      "lru-cache",
      "minipass",
      "tar",
    ]);
    expect([...found.get("minipass")].sort()).toEqual(["3.3.6", "7.1.3"]);
  });

  test("answers an empty map for a directory without node_modules", () => {
    expect(installedPackages(temporaryDirectory("npm-empty-")).size).toBe(0);
  });

  test("reports changed, added and removed packages, each sorted", () => {
    const before = new Map([
      ["tar", new Set(["7.5.19"])],
      ["undici", new Set(["6.27.0"])],
      ["minipass", new Set(["7.1.3", "3.3.6"])],
      ["gone", new Set(["1.0.0"])],
      ["same", new Set(["2.0.0"])],
    ]);
    const after = new Map([
      ["tar", new Set(["7.5.22"])],
      ["undici", new Set(["6.28.1"])],
      ["minipass", new Set(["3.3.6", "7.1.3"])],
      ["content-type", new Set(["2.1.0"])],
      ["same", new Set(["2.0.0"])],
    ]);
    const diff = diffPackages(before, after);
    expect(diff).toEqual({
      changed: [
        { name: "tar", from: ["7.5.19"], to: ["7.5.22"] },
        { name: "undici", from: ["6.27.0"], to: ["6.28.1"] },
      ],
      added: [{ name: "content-type", to: ["2.1.0"] }],
      removed: [{ name: "gone", from: ["1.0.0"] }],
    });
    expect(describeDiff(diff)).toEqual([
      "  tar 7.5.19 -> 7.5.22",
      "  undici 6.27.0 -> 6.28.1",
      "  content-type (new) 2.1.0",
      "  gone (no longer needed) 1.0.0",
    ]);
  });

  test("lists several versions oldest first, and odd versions last", () => {
    const diff = diffPackages(
      new Map([["lru-cache", new Set(["11.5.1", "10.4.3"])]]),
      new Map([["lru-cache", new Set(["weird", "11.5.3", "10.4.3"])]]),
    );
    expect(diff.changed).toEqual([
      {
        name: "lru-cache",
        from: ["10.4.3", "11.5.1"],
        to: ["10.4.3", "11.5.3", "weird"],
      },
    ]);
  });
});

describe("replaceDirectory", () => {
  function directories() {
    const root = temporaryDirectory("npm-replace-");
    const target = path.join(root, "npm");
    const replacement = path.join(root, ".staged", "package");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "version"), "old");
    fs.mkdirSync(replacement, { recursive: true });
    fs.writeFileSync(path.join(replacement, "version"), "new");
    fs.mkdirSync(path.join(replacement, "node_modules", ".bin"), {
      recursive: true,
    });
    fs.symlinkSync(
      "../tar/index.js",
      path.join(replacement, "node_modules", ".bin", "tar"),
    );
    return { root, target, replacement };
  }

  // The real fs, except that the listed renames fail the way overlayfs fails
  // for a directory from a lower image layer.
  function fsWithExdev(failing) {
    return {
      ...fs,
      renameSync: (from, to) => {
        if (failing(from, to)) {
          const error = new Error(`EXDEV: cross-device link, rename '${from}'`);
          error.code = "EXDEV";
          throw error;
        }
        return fs.renameSync(from, to);
      },
    };
  }

  test("swaps the directory and leaves no backup behind", () => {
    const { root, target, replacement } = directories();
    replaceDirectory(target, replacement);
    expect(fs.readFileSync(path.join(target, "version"), "utf8")).toBe("new");
    expect(fs.existsSync(replacement)).toBe(false);
    expect(fs.readdirSync(root).sort()).toEqual([".staged", "npm"]);
  });

  test("deletes the old directory first when it cannot be set aside (EXDEV)", () => {
    const { root, target, replacement } = directories();
    replaceDirectory(
      target,
      replacement,
      fsWithExdev((from) => {
        return from === target;
      }),
    );
    expect(fs.readFileSync(path.join(target, "version"), "utf8")).toBe("new");
    expect(fs.readdirSync(root).sort()).toEqual([".staged", "npm"]);
  });

  test("copies the new directory, symlinks intact, when it cannot be renamed (EXDEV)", () => {
    const { target, replacement } = directories();
    replaceDirectory(
      target,
      replacement,
      fsWithExdev((from) => {
        return from === replacement;
      }),
    );
    expect(fs.readFileSync(path.join(target, "version"), "utf8")).toBe("new");
    expect(
      fs.readlinkSync(path.join(target, "node_modules", ".bin", "tar")),
    ).toBe("../tar/index.js");
    expect(fs.existsSync(replacement)).toBe(false);
  });

  test("puts the old directory back when the new one cannot be moved in", () => {
    const { root, target, replacement } = directories();
    const failing = {
      ...fs,
      renameSync: (from, to) => {
        if (from === replacement) {
          const error = new Error("EACCES: permission denied");
          error.code = "EACCES";
          throw error;
        }
        return fs.renameSync(from, to);
      },
    };
    expect(() => {
      return replaceDirectory(target, replacement, failing);
    }).toThrow("EACCES");
    expect(fs.readFileSync(path.join(target, "version"), "utf8")).toBe("old");
    expect(fs.readdirSync(root).sort()).toEqual([".staged", "npm"]);
  });

  test("touches nothing when the old directory cannot be set aside for another reason", () => {
    const { target, replacement } = directories();
    const failing = {
      ...fs,
      renameSync: () => {
        const error = new Error("EBUSY: resource busy");
        error.code = "EBUSY";
        throw error;
      },
    };
    expect(() => {
      return replaceDirectory(target, replacement, failing);
    }).toThrow("EBUSY");
    expect(fs.readFileSync(path.join(target, "version"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(replacement, "version"), "utf8")).toBe(
      "new",
    );
  });
});

describe("runCommand / verifyNpm", () => {
  test("returns stdout, and throws with the output on a non-zero exit", () => {
    expect(
      runCommand(process.execPath, ["-e", "process.stdout.write('ok')"]),
    ).toBe("ok");
    expect(() => {
      return runCommand(process.execPath, [
        "-e",
        "console.error('missing: tar@^7.5.1'); process.exit(3)",
      ]);
    }).toThrow(/exited with 3[\s\S]*missing: tar@\^7\.5\.1/);
    expect(() => {
      return runCommand("definitely-not-a-command-oneuptime", []);
    }).toThrow("definitely-not-a-command-oneuptime");
  });

  test("checks the reported version and the whole runtime tree", () => {
    const calls = [];
    verifyNpm("/image/npm", "11.19.1", (command, args) => {
      calls.push([command, ...args]);
      return args[1] === "--version" ? "11.19.1\n" : "";
    });
    expect(calls).toEqual([
      [process.execPath, "/image/npm/bin/npm-cli.js", "--version"],
      [
        process.execPath,
        "/image/npm/bin/npm-cli.js",
        "ls",
        "--all",
        "--omit=dev",
        "--prefix",
        "/image/npm",
      ],
    ]);
  });

  test("fails when the new npm reports another version", () => {
    expect(() => {
      return verifyNpm("/image/npm", "11.19.1", () => {
        return "11.18.0\n";
      });
    }).toThrow("reports version 11.18.0, expected 11.19.1");
  });

  test("fails when npm ls finds a broken tree", () => {
    expect(() => {
      return verifyNpm("/image/npm", "11.19.1", (command, args) => {
        if (args[1] === "ls") {
          throw new Error("npm ls exited with 1: missing: tar@^7.5.1");
        }
        return "11.19.1\n";
      });
    }).toThrow("missing: tar@^7.5.1");
  });
});

describe("updateNpmCli", () => {
  const LATEST = "12.0.2";

  test("moves to npm@latest, with the dependencies reinstalled", () => {
    const npmDir = imageNpm("11.19.1", { npmrc: "prefix=/usr/local\n" });
    const commands = fakeCommands({ latest: LATEST });
    const logged = [];

    const result = updateNpmCli({
      npmDir,
      run: commands.run,
      log: (line) => {
        logged.push(line);
      },
    });

    expect(result.previousVersion).toBe("11.19.1");
    expect(result.version).toBe("12.0.2");
    expect(result.replaced).toBe(true);

    // The published manifest ships, byte for byte, with the new tree.
    expect(readJson(path.join(npmDir, "package.json"))).toEqual(
      publishedManifest("12.0.2"),
    );
    expect(
      readJson(path.join(npmDir, "node_modules/tar/package.json")),
    ).toEqual({ name: "tar", version: "7.5.22" });
    expect(
      fs.existsSync(path.join(npmDir, "node_modules", "brace-expansion")),
    ).toBe(false);
    // The base image's builtin config survives the swap.
    expect(fs.readFileSync(path.join(npmDir, "npmrc"), "utf8")).toBe(
      "prefix=/usr/local\n",
    );
    // Nothing is left next to it: no staging, no backup, no cache.
    expect(leftovers(npmDir)).toEqual([]);

    expect(logged.join("\n")).toContain("npm 11.19.1 -> 12.0.2");
    expect(logged.join("\n")).toContain("  tar 7.5.19 -> 7.5.22");
    expect(logged.join("\n")).toContain("  undici 6.27.0 -> 6.28.1");
    expect(logged.join("\n")).toContain(
      "  brace-expansion (no longer needed) 5.0.7",
    );
  });

  test("installs from a manifest npm treats as an ordinary package, over no bundled tree", () => {
    const npmDir = imageNpm("11.19.1");
    const commands = fakeCommands({ latest: LATEST });
    updateNpmCli({ npmDir, run: commands.run, log: () => {} });

    expect(commands.seen.bundledTreeAtInstall).toBe(false);
    expect(commands.seen.installManifest).toEqual(
      manifestForInstall(publishedManifest("12.0.2")),
    );
    expect(commands.seen.installArgs).toEqual(
      expect.arrayContaining([
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
      ]),
    );
  });

  test("runs the steps in order, checking the new npm before and after the swap", () => {
    const npmDir = imageNpm("11.19.1");
    const commands = fakeCommands({ latest: LATEST });
    updateNpmCli({ npmDir, run: commands.run, log: () => {} });

    const steps = commands.calls.map((call) => {
      if (call.command === process.execPath) {
        const where = call.args[0].startsWith(npmDir) ? "final" : "staged";
        return `${where} ${call.args[1]}`;
      }
      return `${call.command} ${call.args[0]}`;
    });
    expect(steps).toEqual([
      "npm view",
      "npm pack",
      "tar -xzf",
      "npm install",
      "staged --version",
      "staged ls",
      "final --version",
      "final ls",
    ]);

    // The registry is asked what `latest` names, that exact release is
    // packed, and every download goes to a cache inside the staging directory.
    const view = commands.calls[0].args;
    expect(view.slice(0, 4)).toEqual([
      "view",
      "npm@latest",
      "version",
      "--json",
    ]);
    const pack = commands.calls[1].args;
    expect(pack[1]).toBe("npm@12.0.2");
    for (const call of [
      commands.calls[0],
      commands.calls[1],
      commands.calls[3],
    ]) {
      const cache = call.args[call.args.indexOf("--cache") + 1];
      expect(path.dirname(path.dirname(cache))).toBe(path.dirname(npmDir));
      expect(path.basename(path.dirname(cache))).toMatch(/^\.npm-cli-update-/);
    }
  });

  test("never moves backwards: an image npm newer than latest keeps its version", () => {
    const npmDir = imageNpm("12.1.0");
    const commands = fakeCommands({ latest: LATEST });
    const result = updateNpmCli({ npmDir, run: commands.run, log: () => {} });
    expect(result.version).toBe("12.1.0");
    // Still refreshed: the same release, repacked with current dependencies.
    expect(commands.calls[1].args[1]).toBe("npm@12.1.0");
    expect(
      readJson(path.join(npmDir, "node_modules/tar/package.json")),
    ).toEqual({ name: "tar", version: "7.5.22" });
  });

  test("a dry run checks the new tree but leaves the image's npm alone", () => {
    const npmDir = imageNpm("11.19.1");
    const before = snapshot(npmDir);
    const commands = fakeCommands({ latest: LATEST });
    const result = updateNpmCli({
      npmDir,
      dryRun: true,
      run: commands.run,
      log: () => {},
    });
    expect(result.replaced).toBe(false);
    expect(result.version).toBe("12.0.2");
    expect(snapshot(npmDir)).toEqual(before);
    expect(leftovers(npmDir)).toEqual([]);
  });

  describe("keeps the image's npm untouched when a step fails", () => {
    const failures = [
      {
        name: "npm install fails",
        options: { failInstall: true },
        error: "npm install exited with 1",
      },
      {
        name: "the new tree fails npm ls",
        options: {
          failLs: (npmDirectory) => {
            return path.basename(npmDirectory) === "package";
          },
        },
        error: "missing: tar@^7.5.1",
      },
      {
        name: "the new npm reports another version",
        options: { reportVersion: "11.19.1" },
        error: "reports version 11.19.1, expected 12.0.2",
      },
      {
        name: "npm@latest names a prerelease",
        options: { latest: "13.0.0-pre.1" },
        error: "npm@latest does not name one plain release",
      },
    ];

    for (const failure of failures) {
      test(failure.name, () => {
        const npmDir = imageNpm("11.19.1");
        const before = snapshot(npmDir);
        const commands = fakeCommands({ latest: LATEST, ...failure.options });
        expect(() => {
          return updateNpmCli({ npmDir, run: commands.run, log: () => {} });
        }).toThrow(failure.error);
        expect(snapshot(npmDir)).toEqual(before);
        expect(leftovers(npmDir)).toEqual([]);
      });
    }
  });

  test("refuses an npm that is not a plain release, before touching anything", () => {
    const npmDir = imageNpm("12.0.0-pre.3");
    const commands = fakeCommands({ latest: LATEST });
    expect(() => {
      return updateNpmCli({ npmDir, run: commands.run, log: () => {} });
    }).toThrow("holds npm 12.0.0-pre.3, which is not a plain release");
    expect(commands.calls).toEqual([]);
    expect(leftovers(npmDir)).toEqual([]);
  });
});

/*
 * The real thing. npm 12.0.2 - what `npm install -g npm@latest` put in every
 * image - bundles tar 7.5.19, undici 6.27.0, brace-expansion 5.0.7 and
 * ip-address 10.2.0, the four packages scanners flagged, so it is a real
 * vulnerable npm to update.
 */
const VULNERABLE_NPM = "12.0.2";
const FIXED_VERSIONS = {
  // GHSA-r292-9mhp-454m
  tar: "7.5.21",
  // GHSA-v3r7-h72x-cjcm, GHSA-m8rv-5g2x-5cg5, GHSA-8xcm-r25x-g524
  undici: "6.28.0",
  // GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895
  "brace-expansion": "5.0.9",
  // GHSA-mwp4-54f8-5fhr, GHSA-4xrf-jv44-h6hh, GHSA-22jq-vg5j-6vgg
  "ip-address": "10.3.1",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${
        result.error ? result.error.message : `${result.stdout}${result.stderr}`
      }`,
    );
  }
  return result.stdout;
}

function packageVersion(npmDir, name) {
  return readJson(path.join(npmDir, "node_modules", name, "package.json"))
    .version;
}

describe("against the registry and a real npm (RUN_NPM_CLI_UPDATE_TESTS=1)", () => {
  test("is enabled with RUN_NPM_CLI_UPDATE_TESTS=1 (reports why it is idle otherwise)", () => {
    if (!RUNTIME) {
      console.log(
        "UpdateNpmCli runtime checks skipped: set RUN_NPM_CLI_UPDATE_TESTS=1 (needs the npm registry, and docker for the image check).",
      );
    }
    expect(true).toBe(true);
  });

  (RUNTIME ? test : test.skip)(
    "updates a vulnerable npm in place, and the result installs packages",
    () => {
      const prefix = temporaryDirectory("npm-cli-update-real-");
      run("npm", [
        "install",
        "--global",
        "--prefix",
        prefix,
        `npm@${VULNERABLE_NPM}`,
        "--no-audit",
        "--no-fund",
      ]);
      const npmDir = path.join(prefix, "lib", "node_modules", "npm");

      // The fixture really is vulnerable, or this proves nothing.
      for (const [name, fixed] of Object.entries(FIXED_VERSIONS)) {
        expect({
          name,
          older: compareVersions(packageVersion(npmDir, name), fixed) < 0,
        }).toEqual({ name, older: true });
      }
      const publishedManifestText = fs.readFileSync(
        path.join(npmDir, "package.json"),
        "utf8",
      );

      const output = run(process.execPath, [SCRIPT, "--npm-dir", npmDir]);

      const newest = JSON.parse(
        run("npm", ["view", "npm@latest", "version", "--json"]),
      );
      expect(output).toContain(`npm ${VULNERABLE_NPM} -> ${newest}`);
      expect(readJson(path.join(npmDir, "package.json")).version).toBe(newest);
      expect(
        run(process.execPath, [
          path.join(npmDir, "bin", "npm-cli.js"),
          "-v",
        ]).trim(),
      ).toBe(newest);
      for (const [name, fixed] of Object.entries(FIXED_VERSIONS)) {
        expect({
          name,
          fixed: compareVersions(packageVersion(npmDir, name), fixed) >= 0,
        }).toEqual({ name, fixed: true });
      }

      // The manifest that ships is the registry's, not the install copy:
      // every field removed for the install is back.
      const shipped = readJson(path.join(npmDir, "package.json"));
      for (const field of [
        "bundleDependencies",
        "devDependencies",
        "workspaces",
      ]) {
        expect({ field, present: field in shipped }).toEqual({
          field,
          present: true,
        });
      }
      expect(shipped.bundleDependencies).toContain("tar");
      expect(Object.keys(shipped.dependencies).sort()).toEqual(
        Object.keys(JSON.parse(publishedManifestText).dependencies).sort(),
      );
      expect(leftovers(npmDir)).toEqual([]);

      // Every runtime dependency at every depth resolves in range.
      run(process.execPath, [
        path.join(npmDir, "bin", "npm-cli.js"),
        "ls",
        "--all",
        "--omit=dev",
        "--prefix",
        npmDir,
      ]);

      // And the updated npm does its job: resolve, fetch, verify and unpack
      // a package with the new tar, pacote and arborist.
      const project = temporaryDirectory("npm-cli-update-project-");
      writeJson(path.join(project, "package.json"), {
        name: "update-npm-cli-smoke",
        version: "1.0.0",
        private: true,
      });
      run(
        process.execPath,
        [
          path.join(npmDir, "bin", "npm-cli.js"),
          "install",
          "is-number@7.0.0",
          "--no-audit",
          "--no-fund",
        ],
        { cwd: project },
      );
      expect(
        readJson(
          path.join(project, "node_modules", "is-number", "package.json"),
        ).version,
      ).toBe("7.0.0");
    },
    300000,
  );

  (RUNTIME ? test : test.skip)(
    "runs inside node:26-alpine3.24 through the repository's real .dockerignore",
    () => {
      const docker = spawnSync("docker", ["version"], { encoding: "utf8" });
      if (docker.error || docker.status !== 0) {
        throw new Error(
          `RUN_NPM_CLI_UPDATE_TESTS=1, but docker is not usable: ${
            docker.error ? docker.error.message : docker.stderr.trim()
          }`,
        );
      }

      // A context laid out like the repository: the real .dockerignore, the
      // script where the Dockerfiles COPY it from, and something else under
      // Scripts/ that must stay out of the build context.
      const context = temporaryDirectory("npm-cli-update-context-");
      fs.copyFileSync(
        path.join(REPO_ROOT, ".dockerignore"),
        path.join(context, ".dockerignore"),
      );
      fs.mkdirSync(path.join(context, "Scripts", "Docker"), {
        recursive: true,
      });
      fs.copyFileSync(
        SCRIPT,
        path.join(context, "Scripts", "Docker", "UpdateNpmCli.js"),
      );
      fs.writeFileSync(
        path.join(context, "Scripts", "Docker", "NotShipped.js"),
        "x\n",
      );
      fs.mkdirSync(path.join(context, "Scripts", "Security"));
      fs.writeFileSync(
        path.join(context, "Scripts", "Security", "NotShipped.js"),
        "x\n",
      );
      fs.writeFileSync(
        path.join(context, "Dockerfile"),
        [
          "FROM public.ecr.aws/docker/library/node:26-alpine3.24",
          // The step exactly as the image templates write it.
          "COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js",
          "RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js",
          "COPY ./Scripts /context-scripts",
          [
            "RUN {",
            'for f in $(find /context-scripts -type f | sort); do echo "context=$f"; done;',
            'for e in $(ls -A /usr/local/lib/node_modules); do echo "global=$e"; done;',
            'for e in $(ls -A /tmp); do echo "tmp=$e"; done;',
            'echo "npm=$(npm --version)";',
            "for p in tar undici brace-expansion ip-address; do",
            'echo "$p=$(node -p "require(\'/usr/local/lib/node_modules/npm/node_modules/\'+process.argv[1]+\'/package.json\').version" "$p")";',
            "done; } > /report.txt",
          ].join(" "),
          'CMD ["cat", "/report.txt"]',
          "",
        ].join("\n"),
      );

      const tag = `oneuptime-update-npm-cli-test:${process.pid}`;
      const build = spawnSync(
        "docker",
        ["build", "--no-cache", "-q", "-t", tag, context],
        { encoding: "utf8" },
      );
      expect({ status: build.status, stderr: build.stderr }).toEqual({
        status: 0,
        stderr: expect.any(String),
      });
      const report = spawnSync("docker", ["run", "--rm", tag], {
        encoding: "utf8",
      });
      spawnSync("docker", ["image", "rm", tag], { encoding: "utf8" });

      const entries = report.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        });
      const valuesOf = (key) => {
        return entries
          .filter(([name]) => {
            return name === key;
          })
          .map(([, value]) => {
            return value;
          });
      };

      // .dockerignore lets the script through, and nothing else in Scripts/.
      expect(valuesOf("context")).toEqual([
        "/context-scripts/Docker/UpdateNpmCli.js",
      ]);
      // No staging directory, backup or copy of the script is left behind.
      // (Node itself keeps its compile cache in /tmp.)
      expect(valuesOf("global")).toEqual(["npm"]);
      expect(
        valuesOf("tmp").filter((entry) => {
          return entry !== "node-compile-cache";
        }),
      ).toEqual([]);
      expect(parseVersion(valuesOf("npm")[0])).not.toBeNull();
      for (const [name, fixed] of Object.entries(FIXED_VERSIONS)) {
        const [installed] = valuesOf(name);
        expect({
          name,
          installed,
          fixed:
            parseVersion(installed) !== null &&
            compareVersions(installed, fixed) >= 0,
        }).toEqual({ name, installed, fixed: true });
      }
    },
    600000,
  );
});
