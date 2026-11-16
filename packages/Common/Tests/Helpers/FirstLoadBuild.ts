import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * WHAT A BUILD PUTS IN THE FIRST LOAD, FOR A TEST THAT HOLDS A PAGE TO IT.
 *
 * Builds an entry the test writes - the modules a public page draws with -
 * as the frontends build (the shared esbuild config, for production), and
 * reads esbuild's metafile: the first load is the entry's file and every
 * file it imports statically, the same reading
 * packages/Common/Scripts/first-load-budgets.js holds the real pages to in
 * CI, and the rest is what loads when it is needed (import()). A subprocess
 * supplies the native Node environment esbuild requires.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

export interface FirstLoadBuildOptions {
  // The entry's lines: what it exports, from the modules the page draws with.
  entryLines: ReadonlyArray<string>;
  // As the page's frontend passes them to createConfig.
  serviceName: string;
  publicPath: string;
  // A frontend's own sources resolve "Common/..." this way.
  additionalAlias?: Record<string, string> | undefined;
  // Where a frontend's sources find the packages they import.
  nodePaths?: ReadonlyArray<string> | undefined;
}

export interface FirstLoadBuild {
  // Inputs with bytes in the first load: the entry's file and its static imports.
  firstLoad: Array<string>;
  // Inputs with bytes only in files loaded later (import()).
  loadedLater: Array<string>;
  firstLoadFiles: number;
  laterFiles: number;
}

export const buildFirstLoad: (
  options: FirstLoadBuildOptions,
) => FirstLoadBuild = (options: FirstLoadBuildOptions): FirstLoadBuild => {
  const entryDirectory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "first-load-build-"),
  );
  const entry: string = path.join(entryDirectory, "FirstLoadEntry.ts");

  try {
    fs.writeFileSync(entry, options.entryLines.join("\n"));

    const script: string = `
      const path = require("path");
      const commonRoot = ${JSON.stringify(COMMON_ROOT)};
      const esbuild = require(require.resolve("esbuild", { paths: [commonRoot] }));
      const { createConfig } = require(path.join(commonRoot, "UI/esbuild-config.js"));
      const { firstLoadOutputs } = require(
        path.join(commonRoot, "Scripts/first-load-budgets.js"),
      );
      const config = createConfig({
        serviceName: ${JSON.stringify(options.serviceName)},
        publicPath: ${JSON.stringify(options.publicPath)},
        entryPoint: ${JSON.stringify(entry)},
        additionalAlias: ${JSON.stringify(options.additionalAlias || {})},
      });

      esbuild.build({
        ...config,
        nodePaths: ${JSON.stringify(options.nodePaths || [])},
        write: false,
        sourcemap: false,
        metafile: true,
        logLevel: "silent",
      }).then((result) => {
        const outputs = result.metafile.outputs;
        // This entry's file: every module import()ed is an entry point too.
        const entryOutput = Object.keys(outputs).find((file) => {
          return (outputs[file].entryPoint || "").endsWith(
            ${JSON.stringify(path.basename(entry))},
          );
        });

        if (!entryOutput) {
          throw new Error("No output was built from the entry.");
        }

        const first = new Set(firstLoadOutputs(result.metafile, [entryOutput]));
        const firstLoad = new Set();
        const loadedLater = new Set();

        for (const [file, output] of Object.entries(outputs)) {
          if (!file.endsWith(".js")) {
            continue;
          }

          for (const [input, contribution] of Object.entries(output.inputs)) {
            if (contribution.bytesInOutput > 0) {
              (first.has(file) ? firstLoad : loadedLater).add(input);
            }
          }
        }

        for (const input of firstLoad) {
          loadedLater.delete(input);
        }

        console.log(JSON.stringify({
          firstLoad: [...firstLoad].sort(),
          loadedLater: [...loadedLater].sort(),
          firstLoadFiles: first.size,
          laterFiles: Object.keys(outputs).filter((file) => {
            return file.endsWith(".js") && !first.has(file);
          }).length,
        }));
      }).catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;

    return JSON.parse(
      childProcess.execFileSync(process.execPath, ["-e", script], {
        cwd: COMMON_ROOT,
        env: { ...process.env, NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } finally {
    fs.rmSync(entryDirectory, { recursive: true, force: true });
  }
};

// The inputs whose path holds `part`, as the metafile names them.
export const inputsUnder: (
  inputs: ReadonlyArray<string>,
  part: string,
) => Array<string> = (
  inputs: ReadonlyArray<string>,
  part: string,
): Array<string> => {
  return inputs.filter((input: string): boolean => {
    return input.includes(part);
  });
};
