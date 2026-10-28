#!/usr/bin/env node

/*
 * Removes from a package's node_modules every dependency that one program
 * never reaches.
 *
 * The ingress image (packages/Nginx/Dockerfile.tpl) runs one small Node.js
 * program beside nginx, the certificate sidecar (packages/Nginx/Index.ts). It
 * imports a part of Common, but Common's package.json lists every package
 * any part of OneUptime needs - the Dashboard's charts and diagrams, React,
 * Playwright, Twilio - so a plain install put 810 MB of packages in the image
 * (1.5 GB, which `docker images` lists as 2 GB), of which the sidecar loads
 * about 105 MB. Pruned, the image is 0.7 GB, and its download went from
 * 437 MB to 175 MB.
 *
 * In the image's build stage, after `npm ci` and the type-check, this script:
 *
 *   1. follows every import from the entry point with esbuild (which Common
 *      already installs), through the program's own files and on into each
 *      package, and notes every installed package the walk reaches. A
 *      package is resolved as require() resolves it, since ts-node runs the
 *      program as CommonJS. A package that is not installed is an optional
 *      one (typeorm's drivers for other databases, ws's native helpers): it
 *      stays out, as it does at run time. A require.resolve() of a name the
 *      code spells out counts as a require() of it: it finds the file
 *      require() would load, which the code may then read, run or load
 *      (TypeOrmPatchVersion reads the package.json beside
 *      require.resolve("typeorm")). esbuild never reads that file itself, so
 *      the walk follows it from there;
 *   2. reads the program's own files with TypeScript's parser and stops with
 *      an error at a require(), import() or require.resolve() of a name the
 *      code computes, a require.resolve() with options (their paths move
 *      where it looks, and esbuild does not record it), or a createRequire():
 *      what they load cannot be known from the code, so it could be a
 *      package this script would remove;
 *   3. takes every dependency the walk never reached out of the package's
 *      package.json and runs `npm prune --omit=dev --offline`. npm then
 *      removes those packages, the packages only they needed, and the
 *      development packages, and keeps every package that something which
 *      stays depends on - so a reached package's own dependencies stay even
 *      where the walk did not see them used, a computed require() inside a
 *      package included - and nothing is downloaded. Last, it checks that
 *      npm removed nothing the walk reached.
 *
 * Any failure fails the image build: an image that cannot be pruned is not
 * shipped unpruned without anybody noticing.
 *
 * Usage, in a build stage, with the program's packages installed:
 *
 *   COPY ./Scripts/Docker/PruneUnreachablePackages.js /tmp/PruneUnreachablePackages.js
 *   RUN node /tmp/PruneUnreachablePackages.js --entry /usr/src/app/Index.ts --package /usr/src/Common
 *
 * Options:
 *   --entry <file>      the program's entry point
 *   --package <dir>     the package whose dependencies are pruned; esbuild and
 *                       TypeScript are loaded from beside the entry point or
 *                       from this package's node_modules
 *   --dry-run           say what would be removed, and change nothing
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

// Files a program may import that are not code. The walk needs only to know
// they are there; esbuild has no loader for most of them.
const NOT_CODE =
  /\.(node|css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|otf|md|txt|html|wasm)$/i;

// A specifier esbuild resolves on its own: relative, absolute, or a URL-ish
// scheme such as node: or data:.
const NOT_A_PACKAGE = /^(\.|\/|[a-z][a-z0-9+.-]*:)/i;

// The marker the walk's own resolve calls carry, so its resolver does not
// answer itself.
const RESOLVING = "prune-unreachable-packages:resolving";

/**
 * @param {Array<string>} argv
 * @returns {{entry: string, packageDirectory: string, dryRun: boolean}}
 */
function parseArguments(argv) {
  const options = { entry: "", packageDirectory: "", dryRun: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--entry" || argument === "--package") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} needs a value`);
      }
      if (argument === "--entry") {
        options.entry = path.resolve(value);
      } else {
        options.packageDirectory = path.resolve(value);
      }
      index++;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.entry) {
    throw new Error("--entry is required");
  }
  if (!options.packageDirectory) {
    throw new Error("--package is required");
  }
  return options;
}

/**
 * The directory of the installed package a file belongs to, or null for a
 * file outside every node_modules (the program's own code). The innermost
 * node_modules counts, so a package nested inside another is its own.
 *
 * @param {string} file an absolute path
 * @returns {string|null}
 */
function packageDirectoryOf(file) {
  const parts = file.split(path.sep);
  const last = parts.lastIndexOf("node_modules");
  if (last === -1 || last === parts.length - 1) {
    return null;
  }
  if (parts[last + 1].startsWith("@")) {
    if (last + 2 >= parts.length) {
      return null;
    }
    return parts.slice(0, last + 3).join(path.sep);
  }
  return parts.slice(0, last + 2).join(path.sep);
}

/**
 * The esbuild plugin of the walk: a package is resolved as require()
 * resolves it, a package that does not resolve is noted as missing and left
 * out, and a file that is not code is left out once it is known to exist. A
 * require.resolve() is resolved as require() would resolve its name, and the
 * file it finds is noted for the walk to follow, since esbuild never reads it.
 *
 * @param {Array<{specifier: string, importer: string}>} missing filled in
 * @param {Array<string>} resolvedFiles filled in: the files require.resolve()
 *   calls find
 */
function walkPlugin(missing, resolvedFiles) {
  return {
    name: "prune-unreachable-packages",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData === RESOLVING) {
          return undefined;
        }
        const isPackage = !NOT_A_PACKAGE.test(args.path);
        const isNotCode = NOT_CODE.test(args.path);
        /*
         * esbuild records a require.resolve() of a string, but leaves the
         * call as it is and never reads the file it names. The call stays
         * external here too (esbuild only warns otherwise), and the walk
         * follows that file as it follows a require()d one.
         */
        if (args.kind === "require-resolve") {
          const resolved = await build.resolve(args.path, {
            kind: "require-call",
            importer: args.importer,
            resolveDir: args.resolveDir,
            pluginData: RESOLVING,
          });
          if (resolved.errors.length > 0) {
            if (isPackage) {
              missing.push({ specifier: args.path, importer: args.importer });
            }
          } else if (!resolved.external && resolved.namespace === "file") {
            resolvedFiles.push(resolved.path);
          }
          return { path: args.path, external: true };
        }
        if (!isPackage && !isNotCode) {
          return undefined;
        }
        // The program runs as CommonJS (ts-node compiles every import to a
        // require()), so a package is resolved as require() resolves it: its
        // "require" export, not the ES module an import statement would pick.
        const resolved = await build.resolve(args.path, {
          kind: isPackage ? "require-call" : args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: RESOLVING,
        });
        if (resolved.errors.length > 0) {
          if (isPackage) {
            missing.push({ specifier: args.path, importer: args.importer });
          }
          return { path: args.path, external: true };
        }
        if (isNotCode || NOT_CODE.test(resolved.path)) {
          return { path: resolved.path, external: true };
        }
        return {
          path: resolved.path,
          external: resolved.external,
          namespace: resolved.namespace,
          sideEffects: resolved.sideEffects,
          suffix: resolved.suffix,
        };
      });
    },
  };
}

/**
 * Follows every import from the entry point, and from every file a
 * require.resolve() finds, until no file found is left unread.
 *
 * @param {{entry: string, esbuild: object}} options esbuild: the esbuild module
 * @returns {Promise<{
 *   reached: Set<string>,
 *   ownFiles: Array<string>,
 *   missing: Array<{specifier: string, importer: string}>
 * }>} reached: the directory of every installed package the walk reached
 *   (real paths); ownFiles: the program's own files it read (real paths)
 */
async function walkImports(options) {
  const workingDirectory = path.dirname(options.entry);
  const reached = new Set();
  const ownFiles = new Set();
  const missing = [];
  const noted = new Set();
  // Every file read, or waiting to be (real paths): each is walked once.
  const seen = new Set();
  const pending = [options.entry];

  while (pending.length > 0) {
    const found = [];
    const resolvedFiles = [];
    const result = await options.esbuild.build({
      entryPoints: [pending.shift()],
      absWorkingDir: workingDirectory,
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      metafile: true,
      logLevel: "silent",
      plugins: [walkPlugin(found, resolvedFiles)],
    });

    // A later walk may read files an earlier one read: note each once.
    for (const item of found) {
      const key = `${item.specifier}\n${item.importer}`;
      if (!noted.has(key)) {
        noted.add(key);
        missing.push(item);
      }
    }

    for (const input of Object.keys(result.metafile.inputs)) {
      const file = path.resolve(workingDirectory, input);
      if (!fs.existsSync(file)) {
        continue;
      }
      const realFile = fs.realpathSync(file);
      seen.add(realFile);
      const directory = packageDirectoryOf(realFile);
      if (directory) {
        reached.add(directory);
      } else {
        ownFiles.add(realFile);
      }
    }

    for (const file of resolvedFiles) {
      const realFile = fs.realpathSync(file);
      if (seen.has(realFile)) {
        continue;
      }
      seen.add(realFile);
      if (NOT_CODE.test(realFile)) {
        /*
         * Nothing in it to follow (esbuild has no loader for most of these
         * files), but its package is needed.
         */
        const directory = packageDirectoryOf(realFile);
        if (directory) {
          reached.add(directory);
        }
        continue;
      }
      pending.push(realFile);
    }
  }

  return { reached, ownFiles: [...ownFiles].sort(), missing };
}

/**
 * The calls in one file that load what the walk cannot see: a require(),
 * import() or require.resolve() of a name the code computes, a
 * require.resolve() with options, whose paths move where it looks (esbuild
 * does not record one either), and a createRequire(). A string literal, or a
 * template literal without substitutions, is a name the walk reads, and
 * require.resolve() of one alone counts as a require() of it.
 *
 * @param {{file: string, source: string, typescript: object}} options
 *   typescript: the typescript module
 * @returns {Array<{line: number, text: string}>} line is 1-based
 */
function computedImportsIn(options) {
  const ts = options.typescript;
  const sourceFile = ts.createSourceFile(
    options.file,
    options.source,
    ts.ScriptTarget.Latest,
    true,
  );
  const found = [];

  const isNamed = (expression, name) => {
    return ts.isIdentifier(expression) && expression.text === name;
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const literalFirstArgument =
        node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]);
      const loadsByName =
        isNamed(callee, "require") ||
        callee.kind === ts.SyntaxKind.ImportKeyword;
      const resolvesByName =
        ts.isPropertyAccessExpression(callee) &&
        isNamed(callee.expression, "require") &&
        callee.name.text === "resolve";
      /*
       * The require.resolve() esbuild records, and the walk so follows: the
       * name alone - not require?.resolve(), which esbuild leaves unread.
       */
      const resolvesSpelledOutName =
        resolvesByName &&
        !callee.questionDotToken &&
        node.arguments.length === 1 &&
        literalFirstArgument;
      if (
        (loadsByName && !literalFirstArgument) ||
        (resolvesByName && !resolvesSpelledOutName) ||
        isNamed(callee, "createRequire")
      ) {
        const start = node.getStart(sourceFile);
        const { line } = sourceFile.getLineAndCharacterOfPosition(start);
        found.push({
          line: line + 1,
          text: node.getText(sourceFile).split("\n")[0].trim(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * computedImportsIn over the program's own files.
 *
 * @param {{files: Array<string>, typescript: object}} options
 * @returns {Array<{file: string, line: number, text: string}>}
 */
function findComputedImports(options) {
  const found = [];
  for (const file of options.files) {
    const source = fs.readFileSync(file, "utf8");
    for (const item of computedImportsIn({
      file,
      source,
      typescript: options.typescript,
    })) {
      found.push({ file, ...item });
    }
  }
  return found;
}

/**
 * The package's dependencies that the walk never reached, in package.json's
 * order. A dependency that is not installed is left alone: there is nothing
 * of it to remove.
 *
 * @param {{
 *   packageDirectory: string,
 *   dependencies: Object<string, string>,
 *   reached: Set<string>
 * }} options
 * @returns {Array<string>}
 */
function unreachedDependencies(options) {
  const unreached = [];
  for (const name of Object.keys(options.dependencies || {})) {
    const installed = path.join(options.packageDirectory, "node_modules", name);
    if (!fs.existsSync(installed)) {
      continue;
    }
    if (!options.reached.has(fs.realpathSync(installed))) {
      unreached.push(name);
    }
  }
  return unreached;
}

/**
 * package.json without the given dependencies. Every other field is kept as
 * it was.
 *
 * @param {object} manifest
 * @param {Array<string>} names
 * @returns {object}
 */
function withoutDependencies(manifest, names) {
  const dependencies = { ...(manifest.dependencies || {}) };
  for (const name of names) {
    delete dependencies[name];
  }
  return { ...manifest, dependencies };
}

/**
 * The total size of the files under a directory, symbolic links not followed.
 *
 * @param {string} directory
 * @returns {number} bytes
 */
function directorySize(directory) {
  let total = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    }
  }
  return total;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function megabytes(bytes) {
  return `${Math.round(bytes / 1e6)} MB`;
}

/**
 * Runs a command, inheriting stdio; throws if it does not exit 0.
 *
 * @param {string} command
 * @param {Array<string>} args
 * @param {object} options passed to spawnSync
 */
function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status === null ? result.signal : result.status}`,
    );
  }
}

/**
 * A module installed beside the entry point or in the package.
 *
 * @param {string} name
 * @param {Array<string>} directories
 */
function loadFrom(name, directories) {
  return require(require.resolve(name, { paths: directories }));
}

/**
 * Walks the entry point and prunes the package to what it reaches.
 *
 * @param {{
 *   entry: string,
 *   packageDirectory: string,
 *   dryRun?: boolean,
 *   esbuild?: object,
 *   typescript?: object,
 *   run?: Function,
 *   log?: Function
 * }} options esbuild, typescript, run and log: for tests (default: loaded
 *   from beside the entry point or the package, runCommand, console.log)
 * @returns {Promise<{removed: Array<string>, kept: number, before: number, after: number}>}
 */
async function pruneUnreachablePackages(options) {
  const log = options.log || console.log;
  const run = options.run || runCommand;
  const packageDirectory = options.packageDirectory;
  const lookIn = [path.dirname(options.entry), packageDirectory];

  if (!fs.existsSync(options.entry)) {
    throw new Error(`The entry point ${options.entry} does not exist`);
  }
  const esbuild = options.esbuild || loadFrom("esbuild", lookIn);
  const typescript = options.typescript || loadFrom("typescript", lookIn);
  const manifestPath = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const walk = await walkImports({ entry: options.entry, esbuild });
  if (walk.ownFiles.length === 0 || walk.reached.size === 0) {
    // A walk that read nothing would prune everything.
    throw new Error(
      `The walk from ${options.entry} read ${walk.ownFiles.length} of the program's files and reached ${walk.reached.size} packages`,
    );
  }

  const computed = findComputedImports({ files: walk.ownFiles, typescript });
  if (computed.length > 0) {
    throw new Error(
      [
        "These load what the code computes at run time, so the walk cannot tell which package they need:",
        ...computed.map((item) => {
          return `  ${item.file}:${item.line}: ${item.text}`;
        }),
        'Name the package in the code - require("name"), import("name") or require.resolve("name") without options - or stop pruning this image.',
      ].join("\n"),
    );
  }

  const removed = unreachedDependencies({
    packageDirectory,
    dependencies: manifest.dependencies,
    reached: walk.reached,
  });
  const nodeModules = path.join(packageDirectory, "node_modules");
  const before = directorySize(nodeModules);

  log(
    `PruneUnreachablePackages: ${options.entry} reaches ${walk.reached.size} installed packages through ${walk.ownFiles.length} of its own files.`,
  );
  log(
    `PruneUnreachablePackages: ${removed.length} of the ${Object.keys(manifest.dependencies || {}).length} dependencies of ${manifestPath} are never reached: ${removed.join(", ") || "none"}.`,
  );

  if (options.dryRun) {
    return { removed, kept: walk.reached.size, before, after: before };
  }

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(withoutDependencies(manifest, removed), null, 2)}\n`,
  );
  run("npm", ["prune", "--omit=dev", "--offline", "--no-audit", "--no-fund"], {
    cwd: packageDirectory,
  });

  // npm keeps what something that stays depends on; nothing the walk reached
  // may be gone.
  const gone = [...walk.reached].filter((directory) => {
    return !fs.existsSync(directory);
  });
  if (gone.length > 0) {
    throw new Error(
      `npm prune removed packages the program reaches: ${gone.join(", ")}`,
    );
  }

  const after = directorySize(nodeModules);
  log(
    `PruneUnreachablePackages: ${nodeModules} went from ${megabytes(before)} to ${megabytes(after)}.`,
  );
  return { removed, kept: walk.reached.size, before, after };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await pruneUnreachablePackages(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`PruneUnreachablePackages: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  NOT_CODE,
  computedImportsIn,
  directorySize,
  findComputedImports,
  packageDirectoryOf,
  parseArguments,
  pruneUnreachablePackages,
  runCommand,
  unreachedDependencies,
  walkImports,
  withoutDependencies,
};
