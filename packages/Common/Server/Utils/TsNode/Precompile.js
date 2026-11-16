#!/usr/bin/env node
"use strict";

/*
 * Compiles a server's TypeScript to JavaScript when its image is built, so the
 * image runs JavaScript and none of its processes loads TypeScript or
 * ts-node.
 *
 * Why: every image used to start through ts-node, which compiled each module
 * when it was first required. A process carried TypeScript itself (about
 * 35 MB of heap, kept to compile modules required later), ts-node, and the
 * work of compiling some 5,000 modules at every start.
 *
 * What it writes, beside every TypeScript file (Foo.ts or Foo.tsx):
 * - Foo.js: the JavaScript ts-node ran for it, byte for byte. ts-node ran
 *   each module through Common's transpiler (Transpiler.js), which calls
 *   TypeScript's transpileModule with the options ts-node gives it; this
 *   asks ts-node for those options, from the same tsconfig, and calls the
 *   same function with them. So decorators and their metadata (TypeORM's
 *   entities read design:type) come out exactly as before, which a full
 *   program compile (tsc) or esbuild would not do: tsc knows the types and
 *   writes other metadata, and esbuild writes none. The only difference is
 *   the last line, which names Foo.js.map instead of carrying an empty map.
 * - Foo.js.map: its source map, which names Foo.ts. The module's TypeScript
 *   stays beside it. PrecompiledSourceMaps.js hands the map to
 *   source-map-support the first time a stack trace passes through the
 *   module, so stack traces name the TypeScript files, lines and columns
 *   they named before.
 *
 * Because the JavaScript sits where its TypeScript is, everything a module
 * finds relative to __dirname (templates, views, JSON, migrations, a
 * worker's file) is where it was, require() finds Foo.js where ts-node found
 * Foo.ts, and nothing about a package's layout changes.
 *
 * What it compiles: every TypeScript file under each --root, except
 * installed packages (node_modules), tests (Tests, which no image runs) and
 * declaration files. A folder with a package.json of its own below a root is
 * another program (the frontends, which esbuild bundles for the browser), so
 * only its files the server imports are compiled: those that a compiled
 * file's imports reach, by relative path (the App's BaseAPI imports
 * FeatureSet/BrowserRecorder/Manifest). Compiling every file rather than
 * walking the imports from the entry point means a module required by a
 * name the code computes (the Probe's synthetic worker, ee/'s entry) has its
 * JavaScript too.
 *
 * It refuses to write where a .js already is (that file is somebody's), and
 * to run in a git checkout: ts-node, which runs a checkout in development,
 * would then load the stale JavaScript in place of the TypeScript being
 * edited. It is for an image's build stage, where the sources are a copy.
 *
 * Usage, in an image's build stage, after `npm run compile` has type-checked
 * the package and before its development packages (ts-node, TypeScript) are
 * pruned:
 *
 *   node /usr/src/Common/Server/Utils/TsNode/Precompile.js \
 *     --project /usr/src/app/tsconfig.json --root /usr/src/app --root /usr/src/Common
 *
 * Options:
 *   --project <tsconfig>  the tsconfig ts-node runs the server with: the one
 *                         in the folder it starts in (ee/ runs with the App's)
 *   --root <directory>    a folder whose TypeScript is compiled (repeatable)
 *   --jobs <n>            worker threads to compile with (default: up to 4)
 *
 * Tests: packages/Common/Tests/Server/Utils/TsNode/Precompile.test.ts, and
 * packages/App/Tests/PrecompiledServer.test.ts, which compiles the App and
 * Common and compares every module with what ts-node runs.
 */

const { Buffer } = require("buffer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require(
  "worker_threads",
);
const { runtimeCompilerOptions } = require("./Transpiler.js");

const TYPESCRIPT_FILE = /\.tsx?$/;
const DECLARATION_FILE = /\.d\.tsx?$/;

// Folders that are never compiled: installed packages and tests.
const SKIPPED_FOLDERS = new Set(["node_modules", "Tests"]);

/*
 * Diagnostics ts-node ignores unless told otherwise (its DEFAULTS'
 * ignoreDiagnostics): 6059 rootDir, 18002 and 18003 a tsconfig's "files" and
 * "include". transpileModule reports little else than syntax errors.
 */
const DIAGNOSTICS_TS_NODE_IGNORES = [6059, 18002, 18003];

const DEFAULT_JOBS = 4;

function parseArguments(argv) {
  const options = { project: "", roots: [], jobs: 0 };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--project" || argument === "--root") {
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} needs a value`);
      }
      if (argument === "--project") {
        options.project = path.resolve(value);
      } else {
        options.roots.push(path.resolve(value));
      }
      index++;
    } else if (argument === "--jobs") {
      const jobs = Number(value);
      if (!Number.isInteger(jobs) || jobs < 1) {
        throw new Error("--jobs needs a whole number of at least 1");
      }
      options.jobs = jobs;
      index++;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.project) {
    throw new Error("--project <tsconfig.json> is required");
  }
  if (options.roots.length === 0) {
    throw new Error("At least one --root <directory> is required");
  }
  return options;
}

// The git checkout a folder is in (a .git file or folder at or above it), or null.
function gitCheckoutOf(directory) {
  let current = directory;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/*
 * The compiler options ts-node runs the project's modules with, as it hands
 * them to Common's transpiler, which leaves out comments and the module's
 * TypeScript from its map (runtimeCompilerOptions). ts-node and the
 * TypeScript it runs on are the project's own, as when the server ran
 * through them, and the environment's TS_NODE_* settings are left out: no
 * image sets one for its server.
 */
function compilerOptionsFor(project) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("TS_NODE_")) {
      delete process.env[name];
    }
  }
  const tsNode = require(
    require.resolve("ts-node", { paths: [path.dirname(project)] }),
  );
  const service = tsNode.create({ project: project, transpileOnly: true });
  return {
    compilerPath: service.compilerPath,
    compilerOptions: runtimeCompilerOptions(service.config.options),
    ignoredDiagnostics: DIAGNOSTICS_TS_NODE_IGNORES.concat(
      (service.options.ignoreDiagnostics || []).map(Number),
    ),
  };
}

function isOwnPackage(directory) {
  return fs.existsSync(path.join(directory, "package.json"));
}

/*
 * Every TypeScript file under a root, and, apart, those inside a folder that
 * is a package of its own (see the header).
 */
function findTypeScript(root) {
  const compiled = [];
  const otherPackages = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (directory !== root && isOwnPackage(directory)) {
      otherPackages.add(directory);
      continue;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          stack.push(full);
        }
      } else if (
        entry.isFile() &&
        TYPESCRIPT_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        compiled.push(full);
      }
    }
  }
  return { compiled: compiled, otherPackages: otherPackages };
}

function isInside(file, directory) {
  const relative = path.relative(directory, file);
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function isSkippedPath(file, root) {
  return path
    .relative(root, file)
    .split(path.sep)
    .some((part) => {
      return SKIPPED_FOLDERS.has(part);
    });
}

// The TypeScript file a relative import names, as require() would find its JavaScript.
function resolveRelativeImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [`${base}.ts`, `${base}.tsx`];
  if (/\.js$/.test(base)) {
    candidates.push(base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"));
  }
  if (TYPESCRIPT_FILE.test(base)) {
    candidates.push(base);
  }
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile() && !DECLARATION_FILE.test(candidate)) {
        return candidate;
      }
    } catch {
      // Not this one.
    }
  }
  return null;
}

/*
 * The files of other packages (frontends) the compiled files import, and
 * theirs, by relative path.
 */
function importedFromOtherPackages(ts, files, otherPackages, roots) {
  const found = new Set();
  const queue = files.slice();
  while (queue.length > 0) {
    const file = queue.pop();
    const text = fs.readFileSync(file, "utf8");
    const imports = ts.preProcessFile(text, true, true).importedFiles;
    for (const imported of imports) {
      if (!imported.fileName.startsWith(".")) {
        continue;
      }
      const target = resolveRelativeImport(file, imported.fileName);
      if (!target || found.has(target)) {
        continue;
      }
      const inOtherPackage = Array.from(otherPackages).some((directory) => {
        return isInside(target, directory);
      });
      const skipped = roots.some((root) => {
        return isInside(target, root) && isSkippedPath(target, root);
      });
      if (inOtherPackage && !skipped) {
        found.add(target);
        queue.push(target);
      }
    }
  }
  return Array.from(found);
}

/*
 * Compiles files as ts-node's transpile-only mode compiled them, through
 * Common's transpiler: TypeScript's transpileModule with ts-node's options.
 * Returns what it wrote, or throws with every file it could not compile.
 */
function compileFiles(ts, files, compilerOptions, ignoredDiagnostics) {
  const failures = [];
  let javaScriptBytes = 0;
  let sourceMapBytes = 0;
  for (const file of files) {
    const javaScriptFile = file.replace(TYPESCRIPT_FILE, ".js");
    const sourceMapFile = `${javaScriptFile}.map`;
    const taken = [javaScriptFile, sourceMapFile].filter((output) => {
      return fs.existsSync(output);
    });
    if (taken.length > 0) {
      failures.push(
        `${taken.join(" and ")} ${taken.length > 1 ? "are" : "is"} already there, and not this compile's: ${file} is not compiled over it`,
      );
      continue;
    }
    const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: compilerOptions,
      reportDiagnostics: true,
    });
    const diagnostics = (result.diagnostics || []).filter((diagnostic) => {
      return !ignoredDiagnostics.includes(diagnostic.code);
    });
    if (diagnostics.length > 0) {
      failures.push(
        `${file}: ${diagnostics
          .map((diagnostic) => {
            return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
          })
          .join("; ")}`,
      );
      continue;
    }
    const map = JSON.parse(result.sourceMapText);
    const sourceMap = JSON.stringify({
      version: map.version,
      file: path.basename(javaScriptFile),
      sources: [path.basename(file)],
      names: map.names,
      mappings: map.mappings,
    });
    fs.writeFileSync(javaScriptFile, result.outputText);
    fs.writeFileSync(sourceMapFile, sourceMap);
    javaScriptBytes += Buffer.byteLength(result.outputText);
    sourceMapBytes += Buffer.byteLength(sourceMap);
  }
  return {
    failures: failures,
    javaScriptBytes: javaScriptBytes,
    sourceMapBytes: sourceMapBytes,
  };
}

// Splits the files among worker threads, and adds up what they wrote.
function compileInWorkers(files, compiler, jobs) {
  const shares = Array.from({ length: jobs }, () => {
    return [];
  });
  files.forEach((file, index) => {
    shares[index % jobs].push(file);
  });
  return Promise.all(
    shares
      .filter((share) => {
        return share.length > 0;
      })
      .map((share) => {
        return new Promise((resolve, reject) => {
          const worker = new Worker(__filename, {
            workerData: { files: share, compiler: compiler },
          });
          worker.once("message", resolve);
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`A compile worker exited with ${code}`));
            }
          });
        });
      }),
  ).then((results) => {
    return results.reduce(
      (total, result) => {
        return {
          failures: total.failures.concat(result.failures),
          javaScriptBytes: total.javaScriptBytes + result.javaScriptBytes,
          sourceMapBytes: total.sourceMapBytes + result.sourceMapBytes,
        };
      },
      { failures: [], javaScriptBytes: 0, sourceMapBytes: 0 },
    );
  });
}

/*
 * Compiles every TypeScript file of the roots (see the header). Resolves to
 * what it compiled; rejects, having written what it could, when a file could
 * not be compiled.
 */
async function precompile(options) {
  const startedAt = Date.now();
  for (const root of options.roots) {
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`${root} is not a folder`);
    }
    const checkout = gitCheckoutOf(root);
    if (checkout !== null) {
      throw new Error(
        `${root} is in a git checkout (${checkout}). Precompile.js writes JavaScript beside every TypeScript file, and ts-node, which runs a checkout, would then load that JavaScript in place of the TypeScript being edited. It is for an image's build stage; to try it, run it on a copy.`,
      );
    }
  }

  const compiler = compilerOptionsFor(options.project);
  const ts = require(compiler.compilerPath);

  const files = [];
  const otherPackages = new Set();
  for (const root of options.roots) {
    const found = findTypeScript(root);
    files.push(...found.compiled);
    for (const directory of found.otherPackages) {
      otherPackages.add(directory);
    }
  }
  const imported = importedFromOtherPackages(
    ts,
    files,
    otherPackages,
    options.roots,
  );
  const all = Array.from(new Set(files.concat(imported))).sort();

  const jobs = Math.min(
    options.jobs || Math.min(DEFAULT_JOBS, os.availableParallelism()),
    Math.max(1, Math.ceil(all.length / 200)),
  );
  const result =
    jobs > 1
      ? await compileInWorkers(all, compiler, jobs)
      : compileFiles(
          ts,
          all,
          compiler.compilerOptions,
          compiler.ignoredDiagnostics,
        );

  if (result.failures.length > 0) {
    throw new Error(
      `Could not compile ${result.failures.length} file(s):\n${result.failures.join("\n")}`,
    );
  }
  return {
    files: all,
    fromOtherPackages: imported.sort(),
    javaScriptBytes: result.javaScriptBytes,
    sourceMapBytes: result.sourceMapBytes,
    milliseconds: Date.now() - startedAt,
    jobs: jobs,
  };
}

if (!isMainThread && workerData && workerData.compiler) {
  const compiler = workerData.compiler;
  parentPort.postMessage(
    compileFiles(
      require(compiler.compilerPath),
      workerData.files,
      compiler.compilerOptions,
      compiler.ignoredDiagnostics,
    ),
  );
} else if (require.main === module) {
  let options = null;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  precompile(options).then(
    (summary) => {
      const megabytes = (bytes) => {
        return (bytes / 1024 / 1024).toFixed(1);
      };
      process.stdout.write(
        `Compiled ${summary.files.length} TypeScript files (${summary.fromOtherPackages.length} of them imported from other packages) with ${summary.jobs} thread(s) in ${(summary.milliseconds / 1000).toFixed(1)} s: ${megabytes(summary.javaScriptBytes)} MB of JavaScript, ${megabytes(summary.sourceMapBytes)} MB of source maps.\n`,
      );
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    },
  );
}

module.exports = {
  precompile: precompile,
  // For tests.
  parseArguments: parseArguments,
  compilerOptionsFor: compilerOptionsFor,
  findTypeScript: findTypeScript,
  resolveRelativeImport: resolveRelativeImport,
  importedFromOtherPackages: importedFromOtherPackages,
  compileFiles: compileFiles,
  compileInWorkers: compileInWorkers,
  gitCheckoutOf: gitCheckoutOf,
  DIAGNOSTICS_TS_NODE_IGNORES: DIAGNOSTICS_TS_NODE_IGNORES,
};
