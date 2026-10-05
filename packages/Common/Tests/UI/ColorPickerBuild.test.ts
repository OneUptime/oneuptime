import { describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const PICKER_SOURCE: string = path.join(
  COMMON_ROOT,
  "UI/Components/Forms/Fields/ColorPicker.tsx",
);

interface BundledInputs {
  // Paths under node_modules/react-color that put bytes in the output.
  reactColor: Array<string>;
  // The picker's own modules (Common/UI/Components/ColorPicker/*).
  pickerParts: Array<string>;
}

/*
 * FormField reaches the color field even on pages without a color field, so
 * what the field pulls in is paid for on every form. It used to pull in
 * react-color's ChromePicker (and once, through the package's barrel, every
 * picker react-color has). The field now draws its own swatches, square,
 * strip and code box, so no react-color code may reach the bundle at all.
 *
 * Built with the frontend configuration and read from esbuild's metafile, so
 * tree-shaking and type-only imports are accounted for. A subprocess
 * supplies the native Node environment esbuild requires.
 */
function bundledInputs(nodeEnv: string): BundledInputs {
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
      const reactColor = new Set();
      const pickerParts = new Set();
      for (const output of Object.values(result.metafile.outputs)) {
        for (const [input, contribution] of Object.entries(output.inputs)) {
          if (contribution.bytesInOutput <= 0) {
            continue;
          }
          if (input.includes("/react-color/")) {
            reactColor.add(input.split("/react-color/")[1]);
          }
          const marker = "UI/Components/ColorPicker/";
          if (input.includes(marker)) {
            pickerParts.add(input.split(marker)[1]);
          }
        }
      }
      console.log(JSON.stringify({
        reactColor: [...reactColor].sort(),
        pickerParts: [...pickerParts].sort(),
      }));
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
  ) as BundledInputs;
}

describe("color picker frontend bundle", () => {
  test.each(["production", "development"])(
    "carries the field's own parts and no react-color in %s",
    (nodeEnv: string) => {
      const inputs: BundledInputs = bundledInputs(nodeEnv);

      expect(inputs.reactColor).toEqual([]);
      expect(inputs.pickerParts).toEqual(
        expect.arrayContaining([
          "ColorPalette.ts",
          "ColorSwatchGroup.tsx",
          "ColorValue.ts",
          "CustomColorPanel.tsx",
        ]),
      );
    },
  );
});
