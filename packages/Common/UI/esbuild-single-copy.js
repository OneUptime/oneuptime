/**
 * One copy of each package in a frontend's bundle (issue #9335).
 *
 * Common and each frontend install their packages apart
 * (packages/Common/node_modules, packages/App/FeatureSet/<Frontend>/node_modules),
 * and esbuild takes a package from the install nearest the file that imports
 * it. So a package both install was bundled twice wherever Common's code and
 * the frontend's each import it: a public dashboard, which draws the
 * Dashboard's widgets beside Common's charts, carried recharts 3.8.1 twice
 * (285 KB before gzip each, and its d3 and redux with it), and the Dashboard
 * carried reactflow and react-beautiful-dnd twice as well.
 *
 * createSingleCopyPlugin() bundles Common's copy instead, for an import from
 * outside Common - a frontend's sources, the Dashboard's widgets a public
 * dashboard draws, ee/, or a package in the frontend's own install - when
 * Common installs the package too and its copy can stand in for the other
 * one (canStandIn):
 *
 *   - for OneUptime's own code, whose package.json files ask for caret
 *     ranges (recharts "^3.0.0"), a version of the same major (and the same
 *     minor, below 1.0.0) that is no older, which semver says serves code
 *     written for the other: the frontends' lockfiles drift apart by a patch
 *     or two (the Dashboard's reactflow 11.11.3, Common's 11.11.4);
 *   - for a package of the frontend's own install, whose range for it this
 *     does not read, the same version only.
 *
 * Every other import resolves as it always did. Common's jest config maps
 * recharts, reactflow, react-beautiful-dnd and use-async-effect to Common's
 * install, so the tests already ran the copy the bundles now hold.
 *
 * The React family and i18next keep their aliases in esbuild-config.js, which
 * name one copy for every import, so a specifier the build aliases is left to
 * its alias.
 *
 * packagesFromSeveralInstalls() reads a build's metafile for a package still
 * bundled from two installs - two versions no copy stands in for - which
 * Common/Scripts/first-load-budgets.js fails the Compile workflow on.
 *
 * CommonJS, like esbuild-config.js, and without esbuild itself, so tests can
 * load it under jsdom. Types for TypeScript callers are in
 * esbuild-single-copy.d.ts.
 */

const fs = require("fs");
const path = require("path");

const SINGLE_COPY_PLUGIN_NAME = "single-copy-packages";

// Marks the plugin's own lookups, which it lets resolve as they would.
const LOOKUP = "single-copy-lookup";

function realPath(folder) {
  try {
    return fs.realpathSync(folder);
  } catch (error) {
    return folder;
  }
}

// Common's folder: the install every frontend bundles a shared package from.
const COMMON_ROOT = realPath(path.resolve(__dirname, ".."));

/**
 * The package a bare specifier names: "recharts" for "recharts" and
 * "recharts/types/util", "@scope/name" for "@scope/name/sub". Null for a
 * relative or absolute path, and for a scope alone.
 * @param {string} specifier
 * @returns {string|null}
 */
function packageNameOf(specifier) {
  if (
    typeof specifier !== "string" ||
    specifier === "" ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("\\") ||
    path.isAbsolute(specifier)
  ) {
    return null;
  }

  const parts = specifier.split("/");

  if (specifier.startsWith("@")) {
    return parts.length > 1 && parts[0].length > 1 && parts[1]
      ? `${parts[0]}/${parts[1]}`
      : null;
  }

  return parts[0];
}

// "3.8.1" as [3, 8, 1]; null for anything else, a prerelease among them.
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Whether Common's copy of a package, at commonVersion, can stand in for
 * another install's, at ownVersion. With sameVersionOnly, only the same
 * version can. Otherwise semver's promise decides: a version serves code
 * written for another of the same major - the same minor too below 1.0.0,
 * and the same patch below 0.1.0, where each may break - when it is no
 * older. A version that is not plain major.minor.patch (a prerelease, a
 * build tag, a missing one) stands in for itself alone.
 * @param {string|null|undefined} commonVersion
 * @param {string|null|undefined} ownVersion
 * @param {boolean} [sameVersionOnly]
 * @returns {boolean}
 */
function canStandIn(commonVersion, ownVersion, sameVersionOnly = false) {
  if (typeof commonVersion !== "string" || typeof ownVersion !== "string") {
    return false;
  }

  const common = parseVersion(commonVersion.trim());
  const own = parseVersion(ownVersion.trim());

  if (commonVersion.trim() === ownVersion.trim() && commonVersion.trim()) {
    return true;
  }

  if (sameVersionOnly || !common || !own) {
    return false;
  }

  // The parts that must match: the major, and below 1.0.0 the minor, and below 0.1.0 the patch.
  const fixed = common[0] > 0 ? 1 : common[1] > 0 ? 2 : 3;

  for (let index = 0; index < 3; index++) {
    if (common[index] === own[index]) {
      continue;
    }

    return index >= fixed && common[index] > own[index];
  }

  return true;
}

/**
 * The folder of the installed package a resolved file belongs to: its path
 * up to the last node_modules/<name>/ in it. Null when the file is not in
 * that package (a browser field sent the import elsewhere, say).
 * @param {string} resolvedPath
 * @param {string} name
 * @returns {string|null}
 */
function installedPackageFolder(resolvedPath, name) {
  const marker = `${path.sep}node_modules${path.sep}${name.split("/").join(path.sep)}${path.sep}`;
  const index = resolvedPath.lastIndexOf(marker);

  return index === -1
    ? null
    : resolvedPath.slice(0, index + marker.length - path.sep.length);
}

function isInside(file, folder) {
  return file === folder || file.startsWith(`${folder}${path.sep}`);
}

/**
 * Bundles Common's copy of a package for an import from outside Common, when
 * Common installs it and its copy can stand in for the one the import would
 * otherwise get (see the top of this file). An import the build aliases
 * (and its subpaths, which an esbuild alias rewrites too) is left to the
 * alias, which names one copy already.
 * @param {object} [options]
 * @param {string} [options.commonRoot] - Common's folder; tests pass another.
 * @returns {{ name: string, setup: Function }}
 */
function createSingleCopyPlugin(options = {}) {
  const commonRoot = realPath(options.commonRoot || COMMON_ROOT);
  const commonModules = path.join(commonRoot, "node_modules");

  return {
    name: SINGLE_COPY_PLUGIN_NAME,
    setup(build) {
      const workingDirectory =
        build.initialOptions.absWorkingDir || process.cwd();
      const aliased = Object.keys(build.initialOptions.alias || {});

      const isAliased = (specifier) => {
        return aliased.some((key) => {
          return specifier === key || specifier.startsWith(`${key}/`);
        });
      };

      // Read once a build: in watch mode an install between rebuilds shows.
      const commonFolders = new Map();
      const versions = new Map();

      build.onStart(() => {
        commonFolders.clear();
        versions.clear();
      });

      // Common's copy of a package, or null when Common does not install it.
      const commonFolderOf = (name) => {
        if (!commonFolders.has(name)) {
          const folder = path.join(commonModules, name);

          commonFolders.set(
            name,
            fs.existsSync(path.join(folder, "package.json"))
              ? realPath(folder)
              : null,
          );
        }

        return commonFolders.get(name);
      };

      const versionOf = (folder) => {
        if (!versions.has(folder)) {
          let version = null;

          try {
            version =
              JSON.parse(
                fs.readFileSync(path.join(folder, "package.json"), "utf8"),
              ).version || null;
          } catch (error) {
            version = null;
          }

          versions.set(folder, version);
        }

        return versions.get(folder);
      };

      const lookUp = (args, resolveDir) => {
        return build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: args.namespace,
          resolveDir,
          with: args.with,
          pluginData: { [LOOKUP]: true },
        });
      };

      build.onResolve({ filter: /^[^./\\]/ }, async (args) => {
        if (
          (args.pluginData && args.pluginData[LOOKUP]) ||
          args.kind === "entry-point" ||
          args.namespace !== "file" ||
          !args.importer ||
          !args.resolveDir ||
          // Common's code and Common's install already resolve to its copies.
          isInside(args.importer, commonRoot) ||
          isAliased(args.path)
        ) {
          return undefined;
        }

        const name = packageNameOf(args.path);
        const commonFolder = name ? commonFolderOf(name) : null;

        if (!commonFolder) {
          return undefined;
        }

        const own = await lookUp(args, args.resolveDir);
        const ownFolder =
          own.errors.length === 0 && !own.external && own.path
            ? installedPackageFolder(own.path, name)
            : null;

        if (!ownFolder || realPath(ownFolder) === commonFolder) {
          return undefined;
        }

        /*
         * A package of the frontend's own install asked for a range this
         * does not read. Judged from the build's folder, so a checkout that
         * itself sits in a node_modules folder reads as OneUptime's code.
         */
        const fromAnInstall = path
          .relative(workingDirectory, args.importer)
          .split(path.sep)
          .includes("node_modules");

        if (
          !canStandIn(
            versionOf(commonFolder),
            versionOf(ownFolder),
            fromAnInstall,
          )
        ) {
          return undefined;
        }

        const common = await lookUp(args, commonRoot);
        const foundFolder =
          common.errors.length === 0 && common.path
            ? installedPackageFolder(common.path, name)
            : null;

        // Resolved from Common's folder, it must land in Common's copy.
        if (!foundFolder || realPath(foundFolder) !== commonFolder) {
          return undefined;
        }

        return {
          path: common.path,
          namespace: common.namespace,
          external: common.external,
          sideEffects: common.sideEffects,
          suffix: common.suffix,
          pluginData: common.pluginData,
        };
      });
    },
  };
}

/*
 * The package a metafile input belongs to and the install it came from, or
 * null for an input outside every node_modules (OneUptime's own code). The
 * install is the outermost node_modules the path goes through - Common's,
 * the frontend's own, the Dashboard's for the widgets a public dashboard
 * draws - and the package the innermost:
 * "../Dashboard/node_modules/recharts/node_modules/react-redux/es/index.js"
 * is react-redux from "../Dashboard/node_modules".
 */
function packageInstallOf(input) {
  const packages = Array.from(
    input.matchAll(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/g),
  );

  if (packages.length === 0) {
    return null;
  }

  const outermost = packages[0];

  return {
    name: packages[packages.length - 1][1],
    install: input.slice(
      0,
      outermost.index + outermost[0].length - outermost[1].length - 1,
    ),
  };
}

/**
 * The packages a build bundled from more than one install, read from its
 * metafile (paths relative to the build's folder, with forward slashes):
 * for each, the installs it came from (see packageInstallOf), the bytes each
 * copy put in the output, and whether OneUptime's own code - a file outside
 * every node_modules - imports that copy, rather than only other packages.
 * A second version npm nests inside one install (mermaid's own stylis) is
 * not counted: that install needs both. Neither is an input that put no
 * bytes in the output, nor a module a browser field turned off.
 * @param {{ inputs?: Object, outputs: Object }} metafile
 * @returns {Array<{ name: string, installs: Array<{ install: string, bytes: number, importedByOwnCode: boolean }> }>}
 */
function packagesFromSeveralInstalls(metafile) {
  const installsByPackage = new Map();

  for (const output of Object.values((metafile && metafile.outputs) || {})) {
    for (const [input, contribution] of Object.entries(output.inputs || {})) {
      const bytes = (contribution && contribution.bytesInOutput) || 0;
      const found = input.startsWith("(disabled):")
        ? null
        : packageInstallOf(input);

      if (bytes <= 0 || !found) {
        continue;
      }

      if (!installsByPackage.has(found.name)) {
        installsByPackage.set(found.name, new Map());
      }

      const installs = installsByPackage.get(found.name);
      installs.set(found.install, (installs.get(found.install) || 0) + bytes);
    }
  }

  // "name\ninstall" for each copy OneUptime's own code imports.
  const importedByOwnCode = new Set();

  for (const [input, details] of Object.entries(
    (metafile && metafile.inputs) || {},
  )) {
    if (packageInstallOf(input) !== null) {
      continue;
    }

    for (const imported of (details && details.imports) || []) {
      const found =
        imported.external || !imported.path
          ? null
          : packageInstallOf(imported.path);

      if (found) {
        importedByOwnCode.add(`${found.name}\n${found.install}`);
      }
    }
  }

  return Array.from(installsByPackage.entries())
    .filter(([, installs]) => {
      return installs.size > 1;
    })
    .map(([name, installs]) => {
      return {
        name,
        installs: Array.from(installs.entries())
          .map(([install, bytes]) => {
            return {
              install,
              bytes,
              importedByOwnCode: importedByOwnCode.has(`${name}\n${install}`),
            };
          })
          .sort((first, second) => {
            return first.install.localeCompare(second.install);
          }),
      };
    })
    .sort((first, second) => {
      return first.name.localeCompare(second.name);
    });
}

module.exports = {
  SINGLE_COPY_PLUGIN_NAME,
  COMMON_ROOT,
  packageNameOf,
  canStandIn,
  installedPackageFolder,
  createSingleCopyPlugin,
  packagesFromSeveralInstalls,
};
