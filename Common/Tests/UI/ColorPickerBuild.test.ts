import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const PICKER_SOURCE: string = path.join(
  COMMON_ROOT,
  "UI/Components/Forms/Fields/ColorPicker.tsx",
);
const COLOR_CONTROL_MODULE: RegExp =
  /^(lib|es)\/(components\/(chrome|common)\/|helpers\/)/;

/*
 * FormField reaches this component even on pages without a color field. The
 * react-color barrel included every picker implementation in those pages'
 * bundles. Build the actual component with the frontend configuration and
 * inspect emitted modules, so tree-shaking and type-only imports are accounted
 * for. A subprocess supplies the native Node environment esbuild requires.
 */
function bundledColorModules(nodeEnv: string): Array<string> {
  const script: string = `
    const path = require("path");
    const commonRoot = ${JSON.stringify(COMMON_ROOT)};
    const esbuild = require(require.resolve("esbuild", { paths: [commonRoot] }));
    const { createConfig } = require(path.join(commonRoot, "UI/esbuild-config.js"));
    const config = createConfig({
      serviceName: "Dashboard",
      publicPath: "/dashboard/dist/",
      entryPoint: ${JSON.stringify(PICKER_SOURCE)},
    });

    esbuild.build({
      ...config,
      write: false,
      sourcemap: false,
      metafile: true,
      logLevel: "silent",
    }).then((result) => {
      const included = new Set();
      for (const output of Object.values(result.metafile.outputs)) {
        for (const [input, contribution] of Object.entries(output.inputs)) {
          if (contribution.bytesInOutput > 0 && input.includes("/react-color/")) {
            included.add(input.split("/react-color/")[1]);
          }
        }
      }
      console.log(JSON.stringify([...included].sort()));
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;

  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", script], {
      cwd: COMMON_ROOT,
      env: { ...process.env, NODE_ENV: nodeEnv },
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    }),
  ) as Array<string>;
}

describe("color picker frontend bundle", () => {
  test.each(["production", "development"])(
    "includes Chrome and shared controls without the other pickers in %s",
    (nodeEnv: string) => {
      const modules: Array<string> = bundledColorModules(nodeEnv);

      expect(modules).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^(lib|es)\/components\/chrome\/Chrome\.js$/),
          expect.stringMatching(
            /^(lib|es)\/components\/common\/ColorWrap\.js$/,
          ),
        ]),
      );
      expect(
        modules.filter((modulePath: string) => {
          return !COLOR_CONTROL_MODULE.test(modulePath);
        }),
      ).toEqual([]);
    },
  );
});
