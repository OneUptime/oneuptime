const path = require("path");
const { createConfig, build, watch } = require("Common/UI/esbuild-config");
const {
  resolveEnterpriseBuild,
  describeEnterpriseBuild,
} = require("Common/UI/esbuild-enterprise");
const { createRuntimeLocalesPlugin } = require("Common/UI/esbuild-locales");

/*
 * "@oneuptime/ee-dashboard" is ee/Dashboard/Index.tsx when this build includes
 * the Enterprise Edition and the Community stub otherwise; ONEUPTIME_EDITION
 * decides (see Common/UI/esbuild-enterprise.js).
 */
const enterprise = resolveEnterpriseBuild({
  frontendDir: __dirname,
  pluginSpecifier: "@oneuptime/ee-dashboard",
  eeSubdir: "Dashboard",
  internalSpecifier: "@oneuptime/dashboard",
});

console.log(describeEnterpriseBuild("Dashboard", enterprise));

const config = createConfig({
  serviceName: "Dashboard",
  publicPath: "/dashboard/dist/",
  additionalAlias: enterprise.alias,
  /*
   * src/Locales holds every key, most of them English. The bundle gets only
   * what a reader can tell apart: en.json (in the entry chunk) without the
   * keys that map to themselves, and each lazily loaded locale without the
   * strings the English fallback shows anyway. See src/Locales/README.md.
   */
  additionalPlugins: [
    createRuntimeLocalesPlugin({
      localesDirectory: path.join(__dirname, "src", "Locales"),
      fallbackLanguage: "en",
    }),
  ],
});

if (process.argv.includes("--watch")) {
  watch(config, "Dashboard");
} else {
  build(config, "Dashboard");
}
