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
 * server reading it never sees half a build. It is the same, byte for byte,
 * every time it is built from the same installed packages.
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const {
  MERMAID_BROWSER_BUILD_DIRECTORY,
  buildMermaidBrowserBundle,
} = require("../UI/esbuild-mermaid");

/**
 * Writes the bundle to `directory`, replacing whatever was there.
 * @param {{ files: Array<{ path: string, text: string }> }} bundle
 * @param {string} directory
 */
function writeBundle(bundle, directory) {
  const staging = `${directory}.partial-${process.pid}`;
  const previous = `${directory}.previous-${process.pid}`;

  fs.rmSync(staging, { recursive: true, force: true });

  for (const file of bundle.files) {
    const target = path.join(staging, file.path);

    if (path.relative(staging, target).startsWith("..")) {
      throw new Error(`Refusing to write ${file.path} outside ${directory}`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text);
  }

  // Swap the new build in, then drop the old one.
  if (fs.existsSync(directory)) {
    fs.rmSync(previous, { recursive: true, force: true });
    fs.renameSync(directory, previous);
  }

  fs.renameSync(staging, directory);
  fs.rmSync(previous, { recursive: true, force: true });
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

main().catch((error) => {
  process.stderr.write(
    `mermaid could not be built for the docs and the blog: ${
      error && error.message ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
