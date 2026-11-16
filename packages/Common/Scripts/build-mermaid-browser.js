#!/usr/bin/env node

/**
 * Writes mermaid for the docs and the blog: the build of mermaid's ES module
 * source that /oneuptime-assets/mermaid/ serves (Common/UI/esbuild-mermaid.js
 * explains why it is built from source rather than taken from mermaid's
 * dist directory).
 *
 *   node Common/Scripts/build-mermaid-browser.js [directory]
 *
 * The directory defaults to Common/build/mermaid-browser, where
 * Common/Server/Utils/VendorAssets.ts serves it from. The App and Home images
 * run this right after Common is copied in, so a build that cannot be made
 * fails the image build instead of a reader's diagram, and the servers never
 * bundle anything themselves.
 *
 * The output is written beside the directory and then moved into place, so a
 * server reading the directory never finds part of a build, and if the move
 * fails the old build is put back. It is the same, byte for byte, every time
 * it is built from the same installed packages.
 *
 * Moving the new build into place deletes what the directory held, so the
 * script builds only into a directory of its own (assertDeletable), and
 * refuses any other before it builds anything (#7568): a wrong argument, or
 * a caller passing on a path it was given, would otherwise delete that
 * directory and everything in it, as the npm package's build once deleted
 * Common's Scripts (#7547).
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const {
  MERMAID_BROWSER_BUILD_DIRECTORY,
  buildMermaidBrowserBundle,
} = require("../UI/esbuild-mermaid");

const COMMON_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(COMMON_ROOT, "..", "..");
/*
 * Where the repository's E2E suites write what they make: the diagrams
 * suite builds mermaid into a directory of its own there
 * (packages/E2E/Diagrams/Fixture/server.js).
 */
const REPOSITORY_OUTPUT = path.join(REPOSITORY_ROOT, "output");

/*
 * The file the build writes into each directory it builds into, so that a
 * later build knows the directory is its own and may replace it
 * (assertDeletable). Not a file a browser build serves: VendorAssets serves
 * only the entry and its chunks (isMermaidBrowserFile).
 */
const BUILD_MARKER_NAME = ".oneuptime-mermaid-build";
const BUILD_MARKER_TEXT =
  "A build of mermaid for the docs and the blog (packages/Common/Scripts/build-mermaid-browser.js) wrote this directory, and replaces it whole when it builds here again.\n";

/**
 * Where a path really is: the deepest part of it that exists, with every
 * symlink in it resolved, and the rest of the path below that.
 * @param {string} location - a path
 * @returns {string} the real path
 */
function realLocation(location) {
  const resolved = path.resolve(location);
  const below = [];
  let existing = resolved;

  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...below);
    } catch {
      const parent = path.dirname(existing);

      if (parent === existing) {
        return resolved;
      }

      below.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * Whether `location` is below `directory` (the directory itself is not).
 * @param {string} directory - a directory
 * @param {string} location - a path
 * @returns {boolean} whether it is
 */
function isBelow(directory, location) {
  const relative = path.relative(directory, location);

  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Whether replacing `location` deletes `other` too: it is `other`, or holds it.
 * @param {string} location - what is replaced
 * @param {string} other - a path
 * @returns {boolean} whether it does
 */
function deletesToo(location, other) {
  return (
    path.relative(location, other).length === 0 || isBelow(location, other)
  );
}

/**
 * Where a build into `directory` acts: the directory itself is moved aside
 * and deleted, a symlink there included, so only the symlinks on the way to
 * it are resolved.
 * @param {string} directory - a path
 * @returns {string} the path the build replaces
 */
function replacedLocation(directory) {
  const resolved = path.resolve(directory);

  return path.join(
    realLocation(path.dirname(resolved)),
    path.basename(resolved),
  );
}

/**
 * Why a directory is not the build's to replace, or null when it is: when
 * nothing is there yet, when it is empty, or when it holds the file a build
 * writes into each directory it builds into (BUILD_MARKER_NAME). Another
 * tool's files, or a checkout, hold no such file.
 * @param {string} location - the directory
 * @returns {string|null} why not, or null
 */
function notTheBuildsOwn(location) {
  let entries;

  try {
    if (!fs.lstatSync(location).isDirectory()) {
      return "it is not a directory a build made";
    }

    entries = fs.readdirSync(location);
  } catch (error) {
    // Nothing there yet, or a file where a directory on the way should be.
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return null;
    }

    throw error;
  }

  if (entries.length === 0 || entries.includes(BUILD_MARKER_NAME)) {
    return null;
  }

  return `it holds files a build did not write: a build leaves ${BUILD_MARKER_NAME} in each directory it builds into (delete a build made before builds left it yourself, and build again)`;
}

/**
 * Refuses to build into a directory that is not the build's own: building
 * replaces the directory, deleting what it held.
 *
 * Its own directory, Common/build/mermaid-browser, which VendorAssets
 * serves, is always the build's: an image or a developer's machine may hold
 * a build made before builds left their file in it. Any other directory is
 * never Common, the repository this script is in, or a directory that holds
 * either; inside the repository, it is under its output/ (where the
 * diagrams suite builds mermaid); and it is the build's own
 * (notTheBuildsOwn). Each is compared where it really is, symlinks
 * resolved.
 * @param {string} directory - where the build would go
 */
function assertDeletable(directory) {
  const target = replacedLocation(directory);
  const refusal = (why) => {
    return new Error(
      `Refusing to build mermaid into ${directory}: building there replaces it, deleting what it holds, ${why}`,
    );
  };

  if (target === replacedLocation(MERMAID_BROWSER_BUILD_DIRECTORY)) {
    return;
  }

  const repository = realLocation(REPOSITORY_ROOT);

  if (deletesToo(target, repository)) {
    throw refusal(
      `and that would delete the repository the build runs from, ${REPOSITORY_ROOT}`,
    );
  }

  if (deletesToo(target, realLocation(COMMON_ROOT))) {
    throw refusal(`and that would delete Common, ${COMMON_ROOT}`);
  }

  if (
    isBelow(repository, target) &&
    !isBelow(realLocation(REPOSITORY_OUTPUT), target)
  ) {
    throw refusal(
      `and it is inside the repository the build runs from, ${REPOSITORY_ROOT}, where only ${MERMAID_BROWSER_BUILD_DIRECTORY} and the directories under ${REPOSITORY_OUTPUT} may be the build's`,
    );
  }

  const notOwn = notTheBuildsOwn(target);

  if (notOwn) {
    throw refusal(`and ${notOwn}`);
  }
}

/**
 * Writes the bundle to `directory`, replacing whatever was there, with the
 * file that makes the directory the build's own. Nothing is left beside
 * it, whether it succeeds or fails. A directory that is not the build's own
 * is refused, and nothing is written (assertDeletable).
 * @param {{ files: Array<{ path: string, text: string }> }} bundle
 * @param {string} directory
 */
function writeBundle(bundle, directory) {
  assertDeletable(directory);

  const staging = `${directory}.partial-${process.pid}`;
  const previous = `${directory}.previous-${process.pid}`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });

  try {
    // First: the directory moved into place is always one a build may replace.
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, BUILD_MARKER_NAME), BUILD_MARKER_TEXT);

    for (const file of bundle.files) {
      const target = path.join(staging, file.path);

      if (path.relative(staging, target).startsWith("..")) {
        throw new Error(`Refusing to write ${file.path} outside ${directory}`);
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.text);
    }

    /*
     * Swap the new build in. Between the two renames there is no build at
     * all, which only a server reading this directory while the script runs
     * again (a developer's machine) could notice, as a moment of 404s.
     */
    const replacing = fs.existsSync(directory);

    if (replacing) {
      fs.renameSync(directory, previous);
    }

    try {
      fs.renameSync(staging, directory);
    } catch (error) {
      // Put the old build back rather than leave none.
      if (replacing && !fs.existsSync(directory)) {
        fs.renameSync(previous, directory);
      }

      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(previous, { recursive: true, force: true });
  }
}

async function main() {
  const directory = path.resolve(
    process.argv[2] || MERMAID_BROWSER_BUILD_DIRECTORY,
  );

  // Before anything is built: a directory that is not the build's own costs nothing.
  assertDeletable(directory);

  const startedAt = Date.now();
  const bundle = await buildMermaidBrowserBundle(esbuild);

  fs.mkdirSync(path.dirname(directory), { recursive: true });
  writeBundle(bundle, directory);

  process.stdout.write(
    `Built mermaid for the docs and the blog: ${bundle.files.length} files in ${directory} (${Date.now() - startedAt} ms)\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `mermaid could not be built for the docs and the blog: ${
        error && error.message ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}

// For Common/Tests/Scripts/BuildMermaidBrowser.test.ts and BuildMermaidBrowserFixture.test.ts.
module.exports = { BUILD_MARKER_NAME, assertDeletable, writeBundle };
