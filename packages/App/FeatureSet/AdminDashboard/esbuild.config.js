const { createConfig, build, watch } = require("Common/UI/esbuild-config");
const {
  resolveEnterpriseBuild,
  describeEnterpriseBuild,
} = require("Common/UI/esbuild-enterprise");

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
});

if (process.argv.includes("--watch")) {
  watch(config, "AdminDashboard");
} else {
  build(config, "AdminDashboard");
}
