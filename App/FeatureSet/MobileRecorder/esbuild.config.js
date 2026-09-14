const esbuild = require("esbuild");
const packageJson = require("./package.json");

const shared = {
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: [
    "@react-native-async-storage/async-storage",
    "react",
    "react/jsx-runtime",
    "react-native",
  ],
  logLevel: "info",
  minify: process.env.NODE_ENV === "production",
  platform: "neutral",
  sourcemap: true,
  target: ["es2020"],
  define: {
    __ONEUPTIME_MOBILE_RECORDER_VERSION__: JSON.stringify(packageJson.version),
  },
};

Promise.all([
  esbuild.build({
    ...shared,
    format: "esm",
    outfile: "dist/index.js",
  }),
  esbuild.build({
    ...shared,
    format: "cjs",
    outfile: "dist/index.cjs",
  }),
]).catch(() => process.exit(1));
