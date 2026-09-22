#!/usr/bin/env node

/*
 * Updates the npm CLI inside an image to `npm@latest`, with every dependency
 * npm ships at the newest version npm's own ranges accept.
 *
 * npm publishes its dependencies inside its own tarball (bundleDependencies),
 * so the tar, undici, brace-expansion, ... under <global root>/npm/node_modules
 * are frozen at whatever versions that npm release was packed with. Container
 * scanners report them like any other package in the image, but neither
 * `npm audit` over our lockfiles nor the nightly audit-fix job ever sees them.
 * A fix can be on the registry for weeks and still be missing from every image
 * until npm cuts a release.
 *
 * That is what `npm install -g npm@latest` alone left in every Node image. On
 * 2026-09-22 `latest` was npm 12.0.2, packed on 2026-07-29 with tar 7.5.19,
 * undici 6.27.0, brace-expansion 5.0.7 and ip-address 10.2.0: nine known
 * vulnerabilities, every one fixed by a release inside the ranges npm 12.0.2
 * itself declares.
 *
 * So this script:
 *   1. moves to the release `npm@latest` names, as the images always have
 *      (and never to an older npm than the image already has). The major
 *      matters beyond features: npm 12 blocks dependency install scripts that
 *      a package's `allowScripts` does not approve, where npm 11 runs them,
 *      and packages/Probe/package.json approves msnodesqlv8's for that
 *      reason;
 *   2. unpacks that release and installs its dependencies with npm's own
 *      resolver as an ordinary install, instead of taking the bundled
 *      snapshot, so each one is the newest version npm's declared ranges
 *      accept;
 *   3. checks the new tree with the new npm itself (`--version`, and
 *      `ls --all --omit=dev`, which fails on any missing or out-of-range
 *      dependency) before it replaces anything, and again once it is in
 *      place.
 *
 * Any failure fails the image build. Quietly keeping the old npm would hide
 * exactly the problem this exists to fix.
 *
 * Usage, as root and before the image's first npm ci:
 *
 *   COPY ./Scripts/Docker/UpdateNpmCli.js /tmp/UpdateNpmCli.js
 *   RUN node /tmp/UpdateNpmCli.js && rm /tmp/UpdateNpmCli.js
 *
 * Options:
 *   --npm-dir <path>  the npm package directory to update
 *                     (default: <npm root -g>/npm)
 *   --dry-run         build and check the new tree, but do not install it
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

// With these fields npm treats the unpacked directory as its own published
// bundle (bundleDependencies) or as its monorepo root (workspaces,
// devDependencies, scripts). Without them, `npm install` there is an ordinary
// install of npm's runtime dependencies.
const FIELDS_REMOVED_FOR_INSTALL = [
  "bundleDependencies",
  "bundledDependencies",
  "devDependencies",
  "workspaces",
  "scripts",
];

/**
 * @param {string} version
 * @returns {Array<number>|null} [major, minor, patch], or null for anything
 *   but a plain release (prereleases and build metadata included).
 */
function parseVersion(version) {
  const match = PLAIN_VERSION.exec(String(version));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two plain release versions.
 * @returns {number} negative, zero or positive, like a sort comparator.
 */
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) {
    throw new Error(`Cannot compare versions ${left} and ${right}`);
  }
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

/**
 * The npm version to install: the one `npm@latest` names, unless the image
 * already has a newer one, which it keeps.
 * @param {string|Array<string>} latest - `npm view npm@latest version --json`
 *   output (a string; an array is taken to be one version per element).
 * @param {string} current - the image's npm version
 * @returns {string}
 */
function targetVersion(latest, current) {
  const candidates = (Array.isArray(latest) ? latest : [latest]).filter(
    (version) => {
      return parseVersion(version) !== null;
    },
  );
  if (candidates.length !== 1) {
    throw new Error(
      `npm@latest does not name one plain release: ${JSON.stringify(latest)}`,
    );
  }
  return compareVersions(candidates[0], current) >= 0 ? candidates[0] : current;
}

/**
 * @param {Array<string>} argv - process.argv.slice(2)
 * @returns {{npmDir: (string|null), dryRun: boolean}}
 */
function parseArguments(argv) {
  const options = { npmDir: null, dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--npm-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--npm-dir needs a path");
      }
      options.npmDir = value;
      index++;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

/**
 * npm's manifest with the fields that stop an ordinary install removed.
 * @param {object} manifest
 * @returns {object} a copy; the input is not modified
 */
function manifestForInstall(manifest) {
  const copy = { ...manifest };
  for (const field of FIELDS_REMOVED_FOR_INSTALL) {
    delete copy[field];
  }
  return copy;
}

/**
 * Every package under a directory's node_modules, at any depth.
 * @param {string} packageDirectory
 * @returns {Map<string, Set<string>>} package name -> installed versions
 */
function installedPackages(packageDirectory) {
  const found = new Map();

  const visit = (directory) => {
    const manifestPath = path.join(directory, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.name && manifest.version) {
        if (!found.has(manifest.name)) {
          found.set(manifest.name, new Set());
        }
        found.get(manifest.name).add(manifest.version);
      }
    }
    walk(path.join(directory, "node_modules"));
  };

  const walk = (nodeModules) => {
    if (!fs.existsSync(nodeModules)) {
      return;
    }
    for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      if (entry.name.startsWith("@")) {
        const scope = path.join(nodeModules, entry.name);
        for (const scoped of fs.readdirSync(scope, { withFileTypes: true })) {
          if (scoped.isDirectory()) {
            visit(path.join(scope, scoped.name));
          }
        }
      } else {
        visit(path.join(nodeModules, entry.name));
      }
    }
  };

  walk(path.join(packageDirectory, "node_modules"));
  return found;
}

// Versions in a diff are listed oldest first. Anything that is not a plain
// release sorts after the plain releases instead of breaking the comparison.
function compareLoosely(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a && b) {
    return compareVersions(left, right);
  }
  if (a || b) {
    return a ? -1 : 1;
  }
  return String(left).localeCompare(String(right));
}

/**
 * What changed between two installedPackages() results.
 * @returns {{changed: Array<{name: string, from: Array<string>, to: Array<string>}>,
 *   added: Array<{name: string, to: Array<string>}>,
 *   removed: Array<{name: string, from: Array<string>}>}}
 */
function diffPackages(before, after) {
  const sorted = (versions) => {
    return [...versions].sort(compareLoosely);
  };
  const changed = [];
  const added = [];
  const removed = [];

  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(name);
    const to = after.get(name);
    if (!from) {
      added.push({ name, to: sorted(to) });
    } else if (!to) {
      removed.push({ name, from: sorted(from) });
    } else if (sorted(from).join() !== sorted(to).join()) {
      changed.push({ name, from: sorted(from), to: sorted(to) });
    }
  }

  return { changed, added, removed };
}

/**
 * @returns {Array<string>} human-readable lines for the build log
 */
function describeDiff(diff) {
  const lines = [];
  for (const entry of diff.changed) {
    lines.push(
      `  ${entry.name} ${entry.from.join(", ")} -> ${entry.to.join(", ")}`,
    );
  }
  for (const entry of diff.added) {
    lines.push(`  ${entry.name} (new) ${entry.to.join(", ")}`);
  }
  for (const entry of diff.removed) {
    lines.push(`  ${entry.name} (no longer needed) ${entry.from.join(", ")}`);
  }
  return lines;
}

/**
 * Moves a directory, copying it when rename() cannot (EXDEV: on overlayfs a
 * directory from a lower image layer cannot always be renamed).
 */
function moveDirectory(from, to, fileSystem) {
  try {
    fileSystem.renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    fileSystem.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    fileSystem.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Puts `replacement` where `target` is. The old directory is kept aside until
 * the new one is in place, and put back if the move fails; when it cannot be
 * set aside (EXDEV) it has to be deleted first.
 */
function replaceDirectory(target, replacement, fileSystem = fs) {
  const backup = `${target}.replaced-${process.pid}`;
  let backedUp = false;

  try {
    fileSystem.renameSync(target, backup);
    backedUp = true;
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
  }

  try {
    if (!backedUp) {
      fileSystem.rmSync(target, { recursive: true, force: true });
    }
    moveDirectory(replacement, target, fileSystem);
  } catch (error) {
    if (backedUp && !fileSystem.existsSync(target)) {
      fileSystem.renameSync(backup, target);
    }
    throw error;
  }

  if (backedUp) {
    fileSystem.rmSync(backup, { recursive: true, force: true });
  }
}

/**
 * Runs a command and returns its stdout; throws, with the command's output,
 * when it exits non-zero.
 */
function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * Checks the npm in `npmDirectory` with that npm itself: the version it
 * reports, and `npm ls --all --omit=dev` over its own tree, which exits
 * non-zero when any runtime dependency, at any depth, is missing or outside
 * the range that asks for it. (Without --omit=dev the published manifest's
 * devDependencies, which are never installed, would count as missing.)
 */
function verifyNpm(npmDirectory, expectedVersion, run) {
  const cli = path.join(npmDirectory, "bin", "npm-cli.js");
  const reported = run(process.execPath, [cli, "--version"]).trim();
  if (reported !== expectedVersion) {
    throw new Error(
      `${cli} reports version ${reported}, expected ${expectedVersion}`,
    );
  }
  run(process.execPath, [
    cli,
    "ls",
    "--all",
    "--omit=dev",
    "--prefix",
    npmDirectory,
  ]);
}

/**
 * @param {object} options
 * @param {string} options.npmDir - the npm package directory to update
 * @param {boolean} [options.dryRun]
 * @param {Function} [options.run] - (command, args, {cwd}) => stdout
 * @param {Function} [options.log]
 * @returns {{previousVersion: string, version: string, diff: object, replaced: boolean}}
 */
function updateNpmCli(options) {
  const npmDir = options.npmDir;
  const run = options.run || runCommand;
  const log = options.log || console.log;

  const previousVersion = JSON.parse(
    fs.readFileSync(path.join(npmDir, "package.json"), "utf8"),
  ).version;
  if (!parseVersion(previousVersion)) {
    throw new Error(
      `${npmDir} holds npm ${previousVersion}, which is not a plain release`,
    );
  }

  // Staged next to npmDir so that putting it in place is a rename on the same
  // filesystem, with npm's download cache inside it so that none of it is
  // left in the image layer.
  const staging = fs.mkdtempSync(
    path.join(path.dirname(npmDir), ".npm-cli-update-"),
  );
  const cache = path.join(staging, "cache");

  try {
    const version = targetVersion(
      JSON.parse(
        run("npm", [
          "view",
          "npm@latest",
          "version",
          "--json",
          "--cache",
          cache,
        ]),
      ),
      previousVersion,
    );

    const packed = JSON.parse(
      run("npm", [
        "pack",
        `npm@${version}`,
        "--pack-destination",
        staging,
        "--cache",
        cache,
        "--json",
      ]),
    );
    run("tar", ["-xzf", path.join(staging, packed[0].filename), "-C", staging]);

    const stagedNpm = path.join(staging, "package");
    const stagedManifestPath = path.join(stagedNpm, "package.json");
    const publishedManifest = fs.readFileSync(stagedManifestPath, "utf8");

    fs.rmSync(path.join(stagedNpm, "node_modules"), {
      recursive: true,
      force: true,
    });
    fs.writeFileSync(
      stagedManifestPath,
      `${JSON.stringify(manifestForInstall(JSON.parse(publishedManifest)), null, 2)}\n`,
    );
    run(
      "npm",
      [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--cache",
        cache,
      ],
      { cwd: stagedNpm },
    );
    verifyNpm(stagedNpm, version, run);

    // Ship npm's manifest exactly as published; the edited copy was only the
    // instruction for the install above.
    fs.writeFileSync(stagedManifestPath, publishedManifest);

    // npm reads builtin configuration from <npm dir>/npmrc. The published
    // tarball has none, but a base image may have added one.
    const builtinConfig = path.join(npmDir, "npmrc");
    if (fs.existsSync(builtinConfig)) {
      fs.copyFileSync(builtinConfig, path.join(stagedNpm, "npmrc"));
    }

    const diff = diffPackages(
      installedPackages(npmDir),
      installedPackages(stagedNpm),
    );
    log(
      `npm ${previousVersion} -> ${version}; dependencies that differ from the image's npm:`,
    );
    const lines = describeDiff(diff);
    log(lines.length > 0 ? lines.join("\n") : "  (none)");

    if (options.dryRun) {
      return { previousVersion, version, diff, replaced: false };
    }

    replaceDirectory(npmDir, stagedNpm);
    // Again from where it now lives, with the published manifest back.
    verifyNpm(npmDir, version, run);
    log(`Installed npm ${version} in ${npmDir}`);
    return { previousVersion, version, diff, replaced: true };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const npmDir =
    options.npmDir ||
    path.join(runCommand("npm", ["root", "-g"]).trim(), "npm");
  updateNpmCli({ npmDir, dryRun: options.dryRun });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`UpdateNpmCli: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
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
};
