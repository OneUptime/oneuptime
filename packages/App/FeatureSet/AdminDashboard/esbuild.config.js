const path = require("path");
const { createConfig, build, watch } = require("Common/UI/esbuild-config");
const {
  resolveEnterpriseBuild,
  describeEnterpriseBuild,
} = require("Common/UI/esbuild-enterprise");
const { createRuntimeLocalesPlugin } = require("Common/UI/esbuild-locales");

/*
 * "@oneuptime/ee-admin-dashboard" is ee/AdminDashboard/Index.tsx when this
 * build includes the Enterprise Edition and the Community stub otherwise;
 * ONEUPTIME_EDITION decides (see Common/UI/esbuild-enterprise.js).
 */
const enterprise = resolveEnterpriseBuild({
  frontendDir: __dirname,
  pluginSpecifier: "@oneuptime/ee-admin-dashboard",
  eeSubdir: "AdminDashboard",
  internalSpecifier: "@oneuptime/admin-dashboard",
});

console.log(describeEnterpriseBuild("AdminDashboard", enterprise));

const config = createConfig({
  serviceName: "AdminDashboard",
  publicPath: "/admin/dist/",
  additionalAlias: enterprise.alias,
  /*
   * Utils/i18n.ts bundles every locale in src/Locales, and each ships whole,
   * as its file holds it. The build adds one thing: a mark beside each plural
   * "_one" form a language words as English does on purpose, by its
   * same-as-English list (i18n/Progress/<code>.json). Unmarked, such a form
   * reads as English left in the file, and Portuguese at 0, which it counts
   * as one, says English's "0 monitors" (Common/UI/esbuild-locales.js).
   */
  additionalPlugins: [
    createRuntimeLocalesPlugin({
      localesDirectory: path.join(__dirname, "src", "Locales"),
      fallbackLanguage: "en",
      progressDirectory: path.join(__dirname, "i18n", "Progress"),
      shipsWholeLocales: true,
    }),
  ],
});

if (process.argv.includes("--watch")) {
  watch(config, "AdminDashboard");
} else {
  build(config, "AdminDashboard");
}
