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
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const {
  MERMAID_BROWSER_BUILD_DIRECTORY,
  buildMermaidBrowserBundle,
} = require("../UI/esbuild-mermaid");

/**
 * Writes the bundle to `directory`, replacing whatever was there. Nothing is
 * left beside it, whether it succeeds or fails.
 * @param {{ files: Array<{ path: string, text: string }> }} bundle
 * @param {string} directory
 */
function writeBundle(bundle, directory) {
  const staging = `${directory}.partial-${process.pid}`;
  const previous = `${directory}.previous-${process.pid}`;

  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(previous, { recursive: true, force: true });

  try {
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

// For Common/Tests/Scripts/BuildMermaidBrowser.test.ts.
module.exports = { writeBundle };
