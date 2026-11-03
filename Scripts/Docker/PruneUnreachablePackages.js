#!/usr/bin/env node

/*
 * Removes from a package's node_modules every dependency that one program
 * never reaches.
 *
 * Used by the images whose programs import part of Common: the ingress's
 * certificate sidecar (packages/Nginx), the Runner (packages/Runner) and the
 * App (packages/App, both editions).
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
 *      package this script would remove. The same goes for code the program
 *      starts beside itself - a worker thread (new Worker() of
 *      worker_threads), a forked process (child_process's fork()), a node
 *      started from process.execPath: esbuild never reads the file such a
 *      call runs, so the packages that file loads would go (ical.js, which
 *      only the App's external calendar worker requires). A program that
 *      does either knowingly says so: the file it loads or starts is one more
 *      --entry, walked like the first, and the file of its own that loads or
 *      starts it is an --entry-loader, whose computed loads and starts the
 *      check then lets through (the App's Enterprise loader, which requires
 *      ee/Server/Index.ts, the Enterprise image's other entry);
 *   3. takes every dependency the walk never reached out of the package's
 *      package.json and runs `npm prune --omit=dev --offline`. npm then
 *      removes those packages, the packages only they needed, and the
 *      development packages, and keeps every package that something which
 *      stays depends on - so a reached package's own dependencies stay even
 *      where the walk did not see them used, a computed require() inside a
 *      package included - and nothing is downloaded. A package the walk
 *      reached that nothing staying depends on would go too: a package can
 *      require one it does not depend on, in a try (debug colours its output
 *      with supports-color if it is there) or because the install put it
 *      where require() looks, and it is installed only while something else
 *      depends on it (supports-color stayed while chalk, through
 *      @elastic/elasticsearch's apache-arrow, or jake did). So before npm
 *      runs, package.json names each such package at the version installed,
 *      and npm keeps it with what it needs. Last, it checks that npm removed
 *      nothing the walk reached.
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
 *   --entry <file>         the program's entry point; given again, every
 *                          other file the program runs that its imports do
 *                          not reach (a worker thread's file, a module it
 *                          loads by a computed name). The first is the one
 *                          esbuild and TypeScript are found beside
 *   --entry-loader <file>  a file of the program's own whose computed loads
 *                          and starts are of other entries (repeatable)
 *   --package <dir>        the package whose dependencies are pruned; esbuild
 *                          and TypeScript are loaded from beside the entry
 *                          point or from this package's node_modules
 *   --dry-run              say what would be removed, and change nothing
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
 * @returns {{
 *   entry: string,
 *   entries: Array<string>,
 *   entryLoaders: Array<string>,
 *   packageDirectory: string,
 *   dryRun: boolean
 * }} entry: the first entry
 */
function parseArguments(argv) {
  const options = {
    entry: "",
    entries: [],
    entryLoaders: [],
    packageDirectory: "",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (
      argument === "--entry" ||
      argument === "--entry-loader" ||
      argument === "--package"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} needs a value`);
      }
      const resolved = path.resolve(value);
      if (argument === "--entry") {
        if (!options.entries.includes(resolved)) {
          options.entries.push(resolved);
        }
      } else if (argument === "--entry-loader") {
        if (!options.entryLoaders.includes(resolved)) {
          options.entryLoaders.push(resolved);
        }
      } else {
        options.packageDirectory = resolved;
      }
      index++;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.entries.length === 0) {
    throw new Error("--entry is required");
  }
  if (!options.packageDirectory) {
    throw new Error("--package is required");
  }
  options.entry = options.entries[0];
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
 * Follows every import from the entry points, and from every file a
 * require.resolve() finds, until no file found is left unread.
 *
 * @param {{entry?: string, entries?: Array<string>, esbuild: object}} options
 *   entries: every entry point (entry: the one, when there is one);
 *   esbuild: the esbuild module
 * @returns {Promise<{
 *   reached: Set<string>,
 *   ownFiles: Array<string>,
 *   missing: Array<{specifier: string, importer: string}>
 * }>} reached: the directory of every installed package the walk reached
 *   (real paths); ownFiles: the program's own files it read (real paths)
 */
async function walkImports(options) {
  const entries =
    options.entries && options.entries.length > 0
      ? options.entries
      : [options.entry];
  const workingDirectory = path.dirname(entries[0]);
  const reached = new Set();
  const ownFiles = new Set();
  const missing = [];
  const noted = new Set();
  // Every file read, or waiting to be (real paths): each is walked once.
  const seen = new Set();
  const pending = [...entries];

  /*
   * Each entry is walked, and each file a require.resolve() finds once
   * (pending holds it only the first time it is seen). An entry an earlier
   * walk already read is walked again, which finds nothing new.
   */
  while (pending.length > 0) {
    const next = pending.shift();
    const found = [];
    const resolvedFiles = [];
    const result = await options.esbuild.build({
      entryPoints: [next],
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

// The modules whose calls start code beside the program.
const WORKER_THREADS_MODULES = ["worker_threads", "node:worker_threads"];
const CHILD_PROCESS_MODULES = ["child_process", "node:child_process"];
// child_process's calls that run a program: given process.execPath, node.
const PROCESS_STARTS = [
  "spawn",
  "spawnSync",
  "execFile",
  "execFileSync",
  "fork",
];

/**
 * The names a file binds to two modules' exports - worker_threads' Worker
 * and child_process's fork, as the file imports them (`import { Worker }
 * from "worker_threads"`, `const { fork } = require("child_process")`) -
 * and the names it binds each module to whole (`import * as childProcess`,
 * `import childProcess from`, `const childProcess = require(...)`).
 *
 * @param {object} sourceFile a TypeScript SourceFile
 * @param {object} ts the typescript module
 * @returns {{
 *   workerClasses: Set<string>,
 *   forkFunctions: Set<string>,
 *   processStartNames: Map<string, string>,
 *   workerModules: Set<string>,
 *   childProcessModules: Set<string>
 * }} processStartNames: each local name of one of child_process's
 *   PROCESS_STARTS, to that export's name
 */
function startBindingsIn(sourceFile, ts) {
  const bindings = {
    workerClasses: new Set(),
    forkFunctions: new Set(),
    processStartNames: new Map(),
    workerModules: new Set(),
    childProcessModules: new Set(),
  };

  const note = (moduleName, whole, named) => {
    const isWorkerThreads = WORKER_THREADS_MODULES.includes(moduleName);
    const isChildProcess = CHILD_PROCESS_MODULES.includes(moduleName);
    if (!isWorkerThreads && !isChildProcess) {
      return;
    }
    if (whole) {
      (isWorkerThreads
        ? bindings.workerModules
        : bindings.childProcessModules
      ).add(whole);
    }
    for (const [exported, local] of named) {
      if (isWorkerThreads && exported === "Worker") {
        bindings.workerClasses.add(local);
      }
      if (isChildProcess && exported === "fork") {
        bindings.forkFunctions.add(local);
      }
      if (isChildProcess && PROCESS_STARTS.includes(exported)) {
        bindings.processStartNames.set(local, exported);
      }
    }
  };

  // `require("child_process")`'s module name, or null.
  const requiredModule = (expression) => {
    if (
      expression &&
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      expression.arguments.length === 1 &&
      ts.isStringLiteralLike(expression.arguments[0])
    ) {
      return expression.arguments[0].text;
    }
    return null;
  };

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause
    ) {
      const clause = node.importClause;
      const named = [];
      let whole = clause.name ? clause.name.text : null;
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          whole = clause.namedBindings.name.text;
        } else {
          for (const element of clause.namedBindings.elements) {
            named.push([
              (element.propertyName || element.name).text,
              element.name.text,
            ]);
          }
        }
      }
      note(node.moduleSpecifier.text, whole, named);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (
        ts.isExternalModuleReference(reference) &&
        ts.isStringLiteral(reference.expression)
      ) {
        note(reference.expression.text, node.name.text, []);
      }
    } else if (ts.isVariableDeclaration(node)) {
      const moduleName = requiredModule(node.initializer);
      if (moduleName) {
        if (ts.isIdentifier(node.name)) {
          note(moduleName, node.name.text, []);
        } else if (ts.isObjectBindingPattern(node.name)) {
          const named = [];
          for (const element of node.name.elements) {
            if (ts.isIdentifier(element.name)) {
              const exported =
                element.propertyName && ts.isIdentifier(element.propertyName)
                  ? element.propertyName.text
                  : element.name.text;
              named.push([exported, element.name.text]);
            }
          }
          note(moduleName, null, named);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/**
 * The calls in one file that load what the walk cannot see: a require(),
 * import() or require.resolve() of a name the code computes, a
 * require.resolve() with options, whose paths move where it looks (esbuild
 * does not record one either), and a createRequire(). A string literal, or a
 * template literal without substitutions, is a name the walk reads, and
 * require.resolve() of one alone counts as a require() of it.
 *
 * And the calls that start code beside the program, whose file esbuild never
 * reads: a new Worker() of worker_threads' Worker, a fork() of
 * child_process's, and any of child_process's ways to run a program given
 * process.execPath. Whatever their arguments: even a file named in full is
 * one the walk does not follow. A class or function of the same name from
 * anywhere else (BullMQ's Worker) is not one.
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
  const starts = startBindingsIn(sourceFile, ts);

  const isNamed = (expression, name) => {
    return ts.isIdentifier(expression) && expression.text === name;
  };

  // `<module>.<name>` for a name bound to the whole module, or `require("<module>").<name>`.
  const isMemberOf = (expression, modules, moduleNames, name) => {
    if (!ts.isPropertyAccessExpression(expression)) {
      return false;
    }
    if (expression.name.text !== name) {
      return false;
    }
    const target = expression.expression;
    if (ts.isIdentifier(target) && modules.has(target.text)) {
      return true;
    }
    return (
      ts.isCallExpression(target) &&
      isNamed(target.expression, "require") &&
      target.arguments.length === 1 &&
      ts.isStringLiteralLike(target.arguments[0]) &&
      moduleNames.includes(target.arguments[0].text)
    );
  };

  const isProcessExecPath = (expression) => {
    return (
      expression !== undefined &&
      ts.isPropertyAccessExpression(expression) &&
      isNamed(expression.expression, "process") &&
      expression.name.text === "execPath"
    );
  };

  // An expression without the parentheses around it.
  const unwrapped = (expression) => {
    let inner = expression;
    while (inner && ts.isParenthesizedExpression(inner)) {
      inner = inner.expression;
    }
    return inner;
  };

  // A call or `new` that starts code beside the program.
  const startsCode = (node) => {
    if (ts.isNewExpression(node)) {
      const callee = unwrapped(node.expression);
      return (
        (ts.isIdentifier(callee) && starts.workerClasses.has(callee.text)) ||
        isMemberOf(
          callee,
          starts.workerModules,
          WORKER_THREADS_MODULES,
          "Worker",
        )
      );
    }
    if (!ts.isCallExpression(node)) {
      return false;
    }
    const callee = unwrapped(node.expression);
    if (
      (ts.isIdentifier(callee) && starts.forkFunctions.has(callee.text)) ||
      isMemberOf(
        callee,
        starts.childProcessModules,
        CHILD_PROCESS_MODULES,
        "fork",
      )
    ) {
      return true;
    }
    // A name child_process's export goes by here, or the name called.
    const calleeName = ts.isIdentifier(callee)
      ? starts.processStartNames.get(callee.text) || callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    return (
      calleeName !== null &&
      PROCESS_STARTS.includes(calleeName) &&
      isProcessExecPath(node.arguments[0])
    );
  };

  const visit = (node) => {
    if (startsCode(node)) {
      const start = node.getStart(sourceFile);
      const { line } = sourceFile.getLineAndCharacterOfPosition(start);
      found.push({
        line: line + 1,
        text: node.getText(sourceFile).split("\n")[0].trim(),
      });
      ts.forEachChild(node, visit);
      return;
    }
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
 * package.json with the given packages added to its dependencies, each at
 * the version installed. Every other field is kept as it was.
 *
 * @param {object} manifest
 * @param {Array<{name: string, version: string}>} packages
 * @returns {object}
 */
function withDependencies(manifest, packages) {
  const dependencies = { ...(manifest.dependencies || {}) };
  for (const item of packages) {
    dependencies[item.name] = item.version;
  }
  return { ...manifest, dependencies };
}

/**
 * Where require() finds a package from a directory: in that directory's
 * node_modules, then in each node_modules above it, up to the package's own
 * directory.
 *
 * @param {string} name
 * @param {string} fromDirectory a real path
 * @param {string} root the package's directory (a real path): the search
 *   stops there
 * @returns {string | null} the package's directory (a real path)
 */
function findInstalled(name, fromDirectory, root) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = path.join(directory, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return fs.realpathSync(candidate);
    }
    const parent = path.dirname(directory);
    if (directory === root || parent === directory) {
      return null;
    }
    directory = parent;
  }
}

/**
 * The installed packages npm keeps along with the given ones: they and,
 * through the dependencies, optional dependencies and peer dependencies
 * their package.json files name, everything they need. An optional peer is
 * no dependency (npm does not install one for it), and development
 * dependencies are not followed, as `npm prune --omit=dev` removes them.
 *
 * @param {Array<string>} directories package directories (real paths)
 * @param {string} root the package's directory (a real path)
 * @returns {Set<string>} package directories (real paths)
 */
function keptAlongWith(directories, root) {
  const kept = new Set();
  const pending = [...directories];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (kept.has(directory)) {
      continue;
    }
    kept.add(directory);
    let manifest = null;
    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    const optionalPeers = manifest.peerDependenciesMeta || {};
    const names = [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}).filter((name) => {
        return !(optionalPeers[name] && optionalPeers[name].optional);
      }),
    ];
    for (const name of names) {
      const found = findInstalled(name, directory, root);
      if (found && !kept.has(found)) {
        pending.push(found);
      }
    }
  }
  return kept;
}

/**
 * The packages the walk reached that npm would remove: those in the
 * package's own node_modules that nothing staying depends on. Each is
 * installed only because something the program does not reach depends on
 * it, or because the install put it where require() looks, and the program
 * requires it all the same - in a try, as debug requires supports-color.
 * Naming them in package.json keeps them. Where one of them needs others,
 * only that one is named, and npm keeps the rest with it.
 *
 * @param {{
 *   packageDirectory: string,
 *   dependencies: Array<string>,
 *   reached: Set<string>
 * }} options dependencies: the names package.json keeps
 * @returns {Array<{name: string, version: string}>} by name
 */
function reachedPackagesNothingKeeps(options) {
  const root = fs.realpathSync(options.packageDirectory);
  const nodeModules = path.join(root, "node_modules");
  const kept = keptAlongWith(
    options.dependencies
      .map((name) => {
        return findInstalled(name, root, root);
      })
      .filter(Boolean),
    root,
  );

  const candidates = [];
  for (const directory of options.reached) {
    const relative = path.relative(nodeModules, directory);
    const parts = relative.split(path.sep);
    // Only the package's own top-level packages can be named; a nested one
    // stays with the package it is nested in.
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      parts.includes("node_modules") ||
      kept.has(directory)
    ) {
      continue;
    }
    candidates.push({ name: parts.join("/"), directory });
  }
  candidates.sort((first, second) => {
    return first.name < second.name ? -1 : first.name > second.name ? 1 : 0;
  });

  const needs = new Map(
    candidates.map((candidate) => {
      return [candidate.directory, keptAlongWith([candidate.directory], root)];
    }),
  );
  const named = [];
  const name = (candidate) => {
    named.push(candidate);
    for (const directory of needs.get(candidate.directory)) {
      kept.add(directory);
    }
  };
  // First those no other one needs; then, of a group that only needs itself
  // (two that need each other), the first.
  for (const candidate of candidates) {
    const neededByAnother = candidates.some((other) => {
      return (
        other !== candidate &&
        needs.get(other.directory).has(candidate.directory)
      );
    });
    if (!neededByAnother) {
      name(candidate);
    }
  }
  for (const candidate of candidates) {
    if (!kept.has(candidate.directory)) {
      name(candidate);
    }
  }

  return named
    .sort((first, second) => {
      return first.name < second.name ? -1 : first.name > second.name ? 1 : 0;
    })
    .map((candidate) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(candidate.directory, "package.json"), "utf8"),
      );
      return { name: candidate.name, version: manifest.version || "*" };
    });
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
 * Walks the entry points and prunes the package to what they reach.
 *
 * @param {{
 *   entry?: string,
 *   entries?: Array<string>,
 *   entryLoaders?: Array<string>,
 *   packageDirectory: string,
 *   dryRun?: boolean,
 *   esbuild?: object,
 *   typescript?: object,
 *   run?: Function,
 *   log?: Function
 * }} options esbuild, typescript, run and log: for tests (default: loaded
 *   from beside the entry point or the package, runCommand, console.log)
 * @returns {Promise<{
 *   removed: Array<string>,
 *   added: Array<{name: string, version: string}>,
 *   kept: number,
 *   before: number,
 *   after: number
 * }>} removed: the dependencies taken out of package.json; added: the
 *   packages named in it so npm keeps them
 */
async function pruneUnreachablePackages(options) {
  const log = options.log || console.log;
  const run = options.run || runCommand;
  const packageDirectory = options.packageDirectory;
  const entries =
    options.entries && options.entries.length > 0
      ? options.entries
      : [options.entry];
  const entryLoaders = options.entryLoaders || [];
  const lookIn = [path.dirname(entries[0]), packageDirectory];

  for (const entry of entries) {
    if (!fs.existsSync(entry)) {
      throw new Error(`The entry point ${entry} does not exist`);
    }
  }
  const esbuild = options.esbuild || loadFrom("esbuild", lookIn);
  const typescript = options.typescript || loadFrom("typescript", lookIn);
  const manifestPath = path.join(packageDirectory, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const walk = await walkImports({ entries, esbuild });
  if (walk.ownFiles.length === 0 || walk.reached.size === 0) {
    // A walk that read nothing would prune everything.
    throw new Error(
      `The walk from ${entries.join(", ")} read ${walk.ownFiles.length} of the program's files and reached ${walk.reached.size} packages`,
    );
  }

  /*
   * An entry loader names a file of the program's own whose computed loads
   * and starts are of the other entries. It has to be one the walk read,
   * and still load or start something by a computed name: a name left in
   * the list after its code went would let the next one through unseen.
   */
  const realEntryLoaders = entryLoaders.map((file) => {
    if (!fs.existsSync(file)) {
      throw new Error(`The entry loader ${file} does not exist`);
    }
    return fs.realpathSync(file);
  });
  const allComputed = findComputedImports({
    files: walk.ownFiles,
    typescript,
  });
  for (const loader of realEntryLoaders) {
    if (!walk.ownFiles.includes(loader)) {
      throw new Error(
        `The entry loader ${loader} is not a file the walk read: the program never imports it.`,
      );
    }
    if (
      !allComputed.some((item) => {
        return item.file === loader;
      })
    ) {
      throw new Error(
        `The entry loader ${loader} loads and starts nothing by a computed name any more: take it out of the --entry-loader list.`,
      );
    }
  }

  const computed = allComputed.filter((item) => {
    return !realEntryLoaders.includes(item.file);
  });
  if (computed.length > 0) {
    throw new Error(
      [
        "These load what the code computes at run time, or start code beside the program, so the walk cannot tell which package they need:",
        ...computed.map((item) => {
          return `  ${item.file}:${item.line}: ${item.text}`;
        }),
        'Name the package in the code - require("name"), import("name") or require.resolve("name") without options. Code started in a worker thread or a process of its own, or loaded by a name the code computes, has to be walked too: give its file as another --entry, and the file that starts or loads it as an --entry-loader. Or stop pruning this image.',
      ].join("\n"),
    );
  }

  const removed = unreachedDependencies({
    packageDirectory,
    dependencies: manifest.dependencies,
    reached: walk.reached,
  });
  const pruned = withoutDependencies(manifest, removed);
  const added = reachedPackagesNothingKeeps({
    packageDirectory,
    dependencies: Object.keys(pruned.dependencies || {}),
    reached: walk.reached,
  });
  const nodeModules = path.join(packageDirectory, "node_modules");
  const before = directorySize(nodeModules);

  log(
    `PruneUnreachablePackages: ${entries.join(", ")} reach${entries.length === 1 ? "es" : ""} ${walk.reached.size} installed packages through ${walk.ownFiles.length} of the program's own files.`,
  );
  if (realEntryLoaders.length > 0) {
    log(
      `PruneUnreachablePackages: what ${realEntryLoaders.join(", ")} load${realEntryLoaders.length === 1 ? "s" : ""} or start${realEntryLoaders.length === 1 ? "s" : ""} by a computed name is among the entries.`,
    );
  }
  log(
    `PruneUnreachablePackages: ${removed.length} of the ${Object.keys(manifest.dependencies || {}).length} dependencies of ${manifestPath} are never reached: ${removed.join(", ") || "none"}.`,
  );
  log(
    `PruneUnreachablePackages: ${manifestPath} now names, at the version installed, each package it reaches that nothing staying depends on, so npm keeps it: ${
      added
        .map((item) => {
          return `${item.name}@${item.version}`;
        })
        .join(", ") || "none"
    }.`,
  );

  if (options.dryRun) {
    return { removed, added, kept: walk.reached.size, before, after: before };
  }

  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(withDependencies(pruned, added), null, 2)}\n`,
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
  return { removed, added, kept: walk.reached.size, before, after };
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
  PROCESS_STARTS,
  computedImportsIn,
  directorySize,
  findComputedImports,
  findInstalled,
  keptAlongWith,
  packageDirectoryOf,
  parseArguments,
  pruneUnreachablePackages,
  reachedPackagesNothingKeeps,
  runCommand,
  unreachedDependencies,
  walkImports,
  withDependencies,
  withoutDependencies,
};
