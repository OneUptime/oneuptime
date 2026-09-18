/**
 * Enterprise Edition resolution for the frontend builds (Dashboard and
 * AdminDashboard).
 *
 * Each of those frontends imports its Enterprise UI through one bare
 * specifier, from one file (src/Enterprise/Plugins.ts):
 *
 *   Dashboard       "@oneuptime/ee-dashboard"        -> ee/Dashboard/Index.tsx
 *   AdminDashboard  "@oneuptime/ee-admin-dashboard"  -> ee/AdminDashboard/Index.tsx
 *
 * This module decides what that specifier means for one build and returns the
 * esbuild aliases that make it so. The frontends pass the result to
 * createConfig({ additionalAlias }) - nothing else about the build changes.
 *
 * ONEUPTIME_EDITION picks the edition:
 *
 *   auto (default)  Enterprise when the ee plugin file is on disk, Community
 *                   otherwise. A plain checkout builds whatever it contains.
 *   community       Always the Community stub, even with ee/ present.
 *   enterprise      The ee plugin, and a hard error when it is missing. The
 *                   Enterprise image sets this, so a broken COPY of ee/ fails
 *                   the build instead of quietly shipping the Community UI
 *                   under an Enterprise tag.
 *
 * Where ee/ is looked for, relative to the frontend directory:
 *
 *   <frontend>/../../../../ee   the repository: packages/App/FeatureSet/<F>
 *   <frontend>/../../../ee      the image: /usr/src/app/FeatureSet/<F> -> /usr/src/ee
 *
 * ONEUPTIME_EE_DIR replaces both with one directory (fixtures, tests, odd
 * layouts) - the same variable the server-side loader honours.
 *
 * "Found" means the plugin's Index.tsx FILE exists. The alias points at that
 * file rather than its directory: esbuild resolves a directory alias to a
 * lowercase index.* and would miss Index.tsx on a case-sensitive filesystem.
 *
 * Two more aliases are always returned, so ee code can reach core without
 * relative paths and without an install of its own:
 *
 *   "@oneuptime/dashboard/..." (or "@oneuptime/admin-dashboard/...")
 *                -> <frontend>/src/...
 *   "Common/..." -> <frontend>/node_modules/Common/...
 *
 * Bundling therefore never depends on ee/node_modules. Both are applied in
 * the Community build too, so core resolves identically in both editions.
 *
 * CommonJS, like esbuild-config.js: the frontends' esbuild.config.js files
 * are plain node scripts.
 */

const fs = require("fs");
const path = require("path");

const EDITION_ENV_VAR = "ONEUPTIME_EDITION";
const EE_DIR_ENV_VAR = "ONEUPTIME_EE_DIR";

const EDITION_AUTO = "auto";
const EDITION_COMMUNITY = "community";
const EDITION_ENTERPRISE = "enterprise";

const VALID_EDITIONS = [EDITION_AUTO, EDITION_COMMUNITY, EDITION_ENTERPRISE];

const PLUGIN_ENTRY_FILENAME = "Index.tsx";

/*
 * The Community stub, relative to the frontend directory. Every tsconfig and
 * jest config maps the plugin specifier to this same file.
 */
const COMMUNITY_STUB_PATH = path.join("src", "Enterprise", "CommunityPlugins.ts");

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * The edition the environment asks for: "auto", "community" or "enterprise".
 * Unset or blank means "auto". Anything else is a typo, and a typo must not
 * silently build the wrong edition, so it throws.
 * @param {Object} [env] - Environment to read (defaults to process.env)
 * @returns {string}
 */
function readRequestedEdition(env) {
  const source = env || process.env;
  const raw = source[EDITION_ENV_VAR];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return EDITION_AUTO;
  }

  const value = String(raw).trim().toLowerCase();

  if (!VALID_EDITIONS.includes(value)) {
    throw new Error(
      `${EDITION_ENV_VAR} must be one of ${VALID_EDITIONS.join(", ")} (got "${raw}").`,
    );
  }

  return value;
}

/**
 * Every path the plugin entry may live at, in the order they are tried.
 * @param {string} frontendDir - Absolute path of the frontend package
 * @param {string} eeSubdir - "Dashboard" or "AdminDashboard"
 * @param {Object} [env] - Environment to read (defaults to process.env)
 * @returns {Array<string>}
 */
function getEnterpriseCandidates(frontendDir, eeSubdir, env) {
  const source = env || process.env;
  const override = source[EE_DIR_ENV_VAR];

  if (override !== undefined && override !== null && String(override).trim()) {
    return [
      path.resolve(String(override).trim(), eeSubdir, PLUGIN_ENTRY_FILENAME),
    ];
  }

  return [
    // Repository: packages/App/FeatureSet/<Frontend> -> <repo>/ee
    path.resolve(
      frontendDir,
      "..",
      "..",
      "..",
      "..",
      "ee",
      eeSubdir,
      PLUGIN_ENTRY_FILENAME,
    ),
    // Image: /usr/src/app/FeatureSet/<Frontend> -> /usr/src/ee
    path.resolve(
      frontendDir,
      "..",
      "..",
      "..",
      "ee",
      eeSubdir,
      PLUGIN_ENTRY_FILENAME,
    ),
  ];
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`resolveEnterpriseBuild: "${name}" is required.`);
  }
}

/**
 * Decide the edition for one frontend build.
 * @param {Object} options
 * @param {string} options.frontendDir - Absolute path of the frontend package (its esbuild.config.js __dirname)
 * @param {string} options.pluginSpecifier - e.g. "@oneuptime/ee-dashboard"
 * @param {string} options.eeSubdir - Directory under ee/, e.g. "Dashboard"
 * @param {string} options.internalSpecifier - e.g. "@oneuptime/dashboard"; ee code imports <frontend>/src through it
 * @param {Object} [options.env] - Environment to read (defaults to process.env)
 * @returns {{ edition: string, requestedEdition: string, pluginEntry: (string|null), communityStub: string, candidates: Array<string>, alias: Object }}
 */
function resolveEnterpriseBuild(options) {
  const {
    frontendDir,
    pluginSpecifier,
    eeSubdir,
    internalSpecifier,
    env = process.env,
  } = options || {};

  assertNonEmptyString(frontendDir, "frontendDir");
  assertNonEmptyString(pluginSpecifier, "pluginSpecifier");
  assertNonEmptyString(eeSubdir, "eeSubdir");
  assertNonEmptyString(internalSpecifier, "internalSpecifier");

  if (!path.isAbsolute(frontendDir)) {
    throw new Error(
      `resolveEnterpriseBuild: "frontendDir" must be absolute (got "${frontendDir}").`,
    );
  }

  const communityStub = path.join(frontendDir, COMMUNITY_STUB_PATH);

  if (!isFile(communityStub)) {
    throw new Error(
      `The Community plugin stub is missing: ${communityStub}. Every frontend that imports ${pluginSpecifier} needs one.`,
    );
  }

  const requestedEdition = readRequestedEdition(env);
  const candidates = getEnterpriseCandidates(frontendDir, eeSubdir, env);

  const pluginEntry =
    requestedEdition === EDITION_COMMUNITY
      ? null
      : candidates.find(isFile) || null;

  if (requestedEdition === EDITION_ENTERPRISE && !pluginEntry) {
    throw new Error(
      `${EDITION_ENV_VAR}=${EDITION_ENTERPRISE}, but the Enterprise UI plugin for ${eeSubdir} was not found. Looked for: ${candidates.join(
        ", ",
      )}. Copy the ee/ directory into the build, or unset ${EDITION_ENV_VAR} to build the Community Edition.`,
    );
  }

  return {
    edition: pluginEntry ? EDITION_ENTERPRISE : EDITION_COMMUNITY,
    requestedEdition,
    pluginEntry,
    communityStub,
    candidates,
    alias: {
      [pluginSpecifier]: pluginEntry || communityStub,
      [internalSpecifier]: path.join(frontendDir, "src"),
      Common: path.join(frontendDir, "node_modules", "Common"),
    },
  };
}

/**
 * The esbuild aliases for one frontend build - what esbuild.config.js passes
 * to createConfig({ additionalAlias }). Same options as resolveEnterpriseBuild.
 * @param {Object} options
 * @returns {Object}
 */
function resolveEnterpriseAliases(options) {
  return resolveEnterpriseBuild(options).alias;
}

/**
 * One line for the build log, so a CI log shows which edition was bundled.
 * @param {string} serviceName
 * @param {Object} build - A resolveEnterpriseBuild() result
 * @returns {string}
 */
function describeEnterpriseBuild(serviceName, build) {
  if (build.edition === EDITION_ENTERPRISE) {
    return `${serviceName}: building the Enterprise Edition UI from ${build.pluginEntry}`;
  }

  return `${serviceName}: building the Community Edition UI (${EDITION_ENV_VAR}=${build.requestedEdition})`;
}

module.exports = {
  EDITION_ENV_VAR,
  EE_DIR_ENV_VAR,
  EDITION_AUTO,
  EDITION_COMMUNITY,
  EDITION_ENTERPRISE,
  VALID_EDITIONS,
  PLUGIN_ENTRY_FILENAME,
  COMMUNITY_STUB_PATH,
  readRequestedEdition,
  getEnterpriseCandidates,
  resolveEnterpriseBuild,
  resolveEnterpriseAliases,
  describeEnterpriseBuild,
};
