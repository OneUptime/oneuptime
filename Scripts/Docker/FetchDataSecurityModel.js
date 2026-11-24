#!/usr/bin/env node

/*
 * Puts Data Security's names-and-addresses model into an image, while it is
 * built.
 *
 * The App and Probe images run the model inside the scanner
 * (packages/Common/Server/Utils/DataSecurity/Model). Its weights are not in
 * the repository: NameAddressModel.json pins the revision they come from and
 * each file's URL, size and SHA-256. This script:
 *
 *   1. fetches each file into the manifest's directory (or --directory),
 *      retrying a failed download a few times, and checks its size and its
 *      SHA-256 against the manifest: any other bytes fail the image build,
 *      so a changed file upstream can never reach an image;
 *   2. with --runtime, leaves in ONNX Runtime's WebAssembly package only
 *      what the model's thread loads in Node.js - the package's Node entry,
 *      the one WebAssembly binary it runs, and that binary's loader. The
 *      package also ships builds for browsers, WebGPU and WebNN, 130 MB the
 *      image never runs.
 *
 * Nothing is fetched when the images run: a server or probe without the
 * files scans without the model, and says so in its scans' warnings. Iron
 * Bank's manifests list the same files with the same URLs and checksums
 * (IronBank/App and IronBank/Probe), and FetchDataSecurityModel.test.js
 * holds the two to each other.
 *
 * Usage, in a build stage:
 *
 *   COPY ./packages/Common/Server/Utils/DataSecurity/Model/NameAddressModel.json /tmp/NameAddressModel.json
 *   COPY ./Scripts/Docker/FetchDataSecurityModel.js /tmp/FetchDataSecurityModel.js
 *   RUN node /tmp/FetchDataSecurityModel.js --manifest /tmp/NameAddressModel.json --runtime /usr/src/Common/node_modules/onnxruntime-web
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ATTEMPTS = 4;
const RETRY_DELAY_IN_MS = 5000;

// What the model's thread loads of onnxruntime-web's builds and sources.
const RUNTIME_FILES = [
  "dist/ort.node.min.js",
  "dist/ort-wasm-simd-threaded.mjs",
  "dist/ort-wasm-simd-threaded.wasm",
];

/*
 * The folders of the package that hold builds and sources: everything in
 * them but RUNTIME_FILES goes. The package's own files (package.json, its
 * README, its types) and its node_modules stay, so npm still reads the
 * package as installed.
 */
const SLIMMED_FOLDERS = ["dist", "docs", "lib"];

function readArguments(argv) {
  const options = { manifest: null, directory: null, runtime: null };

  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const value = argv[index + 1];

    if (name === "--manifest" || name === "--directory" || name === "--runtime") {
      if (!value) {
        throw new Error(`${name} needs a value.`);
      }

      options[name.slice(2)] = value;
      index++;
      continue;
    }

    throw new Error(`Unknown option ${name}.`);
  }

  if (!options.manifest) {
    throw new Error("--manifest is required.");
  }

  return options;
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${manifestPath} lists no files.`);
  }

  for (const file of manifest.files) {
    if (
      typeof file.name !== "string" ||
      !/^[\w.-]+$/.test(file.name) ||
      typeof file.url !== "string" ||
      !file.url.startsWith("https://") ||
      !/^[0-9a-f]{64}$/.test(String(file.sha256)) ||
      !Number.isInteger(file.bytes) ||
      file.bytes <= 0
    ) {
      throw new Error(
        `${manifestPath}: every file needs a plain name, an https URL, a SHA-256 and a size.`,
      );
    }

    if (!file.url.includes(`/resolve/${manifest.revision}/`)) {
      throw new Error(
        `${file.name} is not fetched from the pinned revision ${manifest.revision}.`,
      );
    }
  }

  return manifest;
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

// A file of the manifest, fetched and checked, or the build stops.
async function fetchFile(file, directory, fetcher, retryDelayInMs) {
  const target = path.join(directory, file.name);
  const partial = `${target}.part`;
  let lastError = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await fetcher(file.url, partial);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      fs.rmSync(partial, { force: true });

      if (attempt < ATTEMPTS) {
        await sleep(retryDelayInMs * attempt);
      }
    }
  }

  if (lastError) {
    throw new Error(
      `Could not fetch ${file.name} from ${file.url}: ${lastError.message}`,
    );
  }

  const size = fs.statSync(partial).size;
  const digest = sha256(partial);

  if (size !== file.bytes || digest !== file.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(
      `${file.name} is not the pinned file: ${size} bytes with SHA-256 ${digest}, where the manifest pins ${file.bytes} bytes with SHA-256 ${file.sha256}.`,
    );
  }

  fs.renameSync(partial, target);
}

// Every file of the package's builds and sources the model's thread does not load.
function slimRuntime(runtimeDirectory) {
  const keep = new Set(
    RUNTIME_FILES.map((file) => {
      return path.join(runtimeDirectory, file);
    }),
  );

  for (const file of keep) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `${runtimeDirectory} has no ${path.relative(runtimeDirectory, file)}: the model's thread needs it.`,
      );
    }
  }

  const removed = [];

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(entryPath);

        if (fs.readdirSync(entryPath).length === 0) {
          fs.rmdirSync(entryPath);
        }

        continue;
      }

      if (!keep.has(entryPath)) {
        fs.rmSync(entryPath, { force: true });
        removed.push(path.relative(runtimeDirectory, entryPath));
      }
    }
  };

  for (const folder of SLIMMED_FOLDERS) {
    const folderPath = path.join(runtimeDirectory, folder);

    if (fs.existsSync(folderPath)) {
      walk(folderPath);

      if (fs.readdirSync(folderPath).length === 0) {
        fs.rmdirSync(folderPath);
      }
    }
  }

  return removed;
}

async function main(
  argv,
  fetcher = download,
  { retryDelayInMs = RETRY_DELAY_IN_MS } = {},
) {
  const options = readArguments(argv);
  const manifest = readManifest(options.manifest);
  const directory = options.directory || manifest.directory;

  fs.mkdirSync(directory, { recursive: true });

  for (const file of manifest.files) {
    await fetchFile(file, directory, fetcher, retryDelayInMs);
    process.stdout.write(
      `Fetched ${file.name} of ${manifest.name} at ${manifest.revision} (${file.bytes} bytes, SHA-256 ${file.sha256}).\n`,
    );
  }

  if (options.runtime) {
    const removed = slimRuntime(options.runtime);

    process.stdout.write(
      `Kept the Node.js runtime of ${options.runtime}; removed ${removed.length} files it does not load.\n`,
    );
  }
}

module.exports = {
  main,
  readManifest,
  fetchFile,
  slimRuntime,
  RUNTIME_FILES,
  SLIMMED_FOLDERS,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
