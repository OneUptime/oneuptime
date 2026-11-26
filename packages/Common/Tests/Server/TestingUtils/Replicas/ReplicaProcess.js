/*
 * AN APP SERVER AS A PROCESS OF ITS OWN, FOR A TEST THAT NEEDS SEVERAL
 * (#11198).
 *
 * Started by a test with child_process.fork, this loads Common's TypeScript
 * the way the Common suites do - each file on its own, transpile-only
 * (packages/Common/jest.config.json, isolatedModules) - with esbuild, which
 * reads decorators the legacy way and assigns class fields as tsc does at
 * this target. Nothing reads the design-time types tsc's
 * emitDecoratorMetadata adds, which esbuild leaves out. `@jest/globals`, which
 * the test worlds import their spies from, is jest-mock's own
 * (JestGlobalsOutsideJest.js).
 *
 * Then it runs the module named by REPLICA_MODULE (a path from
 * packages/Common), which talks to the test over the IPC channel fork opens.
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const COMMON_DIRECTORY = path.resolve(__dirname, "../../../..");

const TRANSFORM_OPTIONS = {
  format: "cjs",
  target: "es2020",
  sourcemap: "inline",
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
      jsx: "react",
    },
  },
};

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = function (module, filename) {
    const source = fs.readFileSync(filename, "utf8");
    const { code } = esbuild.transformSync(source, {
      ...TRANSFORM_OPTIONS,
      loader: extension === ".tsx" ? "tsx" : "ts",
      sourcefile: filename,
    });
    module._compile(code, filename);
  };
}

const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  if (request === "@jest/globals") {
    return path.join(__dirname, "JestGlobalsOutsideJest.js");
  }

  return resolveFilename.call(this, request, ...rest);
};

const replicaModule = process.env["REPLICA_MODULE"];

if (!replicaModule) {
  throw new Error("REPLICA_MODULE names the module this server runs.");
}

require(path.join(COMMON_DIRECTORY, replicaModule));
