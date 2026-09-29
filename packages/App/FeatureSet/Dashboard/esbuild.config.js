const { createConfig, build, watch } = require("Common/UI/esbuild-config");
const {
  resolveEnterpriseBuild,
  describeEnterpriseBuild,
} = require("Common/UI/esbuild-enterprise");

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
});

if (process.argv.includes("--watch")) {
  watch(config, "Dashboard");
} else {
  build(config, "Dashboard");
}
