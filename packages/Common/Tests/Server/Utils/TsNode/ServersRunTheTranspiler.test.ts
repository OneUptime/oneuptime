import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every OneUptime server image runs the JavaScript its build compiled
 * (Server/Utils/TsNode/Precompile.js), with the compiler options of Common's
 * ts-node transpiler (Server/Utils/TsNode/Transpiler.js): its start script
 * execs node on Index.js after PrecompiledSourceMaps.js. Its TypeScript still
 * runs through ts-node outside the image - a development server, the perf
 * kit's native stack, the scripts an image's build runs - and there the
 * transpiler keeps each module's source map out of the code V8 holds for the
 * life of the process (about 470 MB of an idle App's heap, 35 MB of the
 * Probe's). So this holds every package that ships an image and starts node
 * to both: its start script runs the compiled entry, and its tsconfig's
 * "ts-node" section names the transpiler - with "transpileOnly", which
 * ts-node needs for a custom transpiler - by a path that resolves both in
 * this repository and in the image, where the package is /usr/src/app and
 * Common /usr/src/Common (Precompile.js reads the options from there).
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const TRANSPILER: string = path.resolve(
  PACKAGES,
  "Common",
  "Server",
  "Utils",
  "TsNode",
  "Transpiler.js",
);

interface Server {
  name: string;
  directory: string;
}

// Packages that ship an image and whose start script execs node.
function servers(): Array<Server> {
  const servers: Array<Server> = [];
  for (const name of fs.readdirSync(PACKAGES).sort()) {
    const directory: string = path.join(PACKAGES, name);
    const packageJson: string = path.join(directory, "package.json");
    if (
      !fs.existsSync(path.join(directory, "Dockerfile.tpl")) ||
      !fs.existsSync(packageJson)
    ) {
      continue;
    }
    const scripts: Record<string, string> =
      (
        JSON.parse(fs.readFileSync(packageJson, "utf8")) as {
          scripts?: Record<string, string>;
        }
      ).scripts || {};
    if (/&& exec node /.test(scripts["start"] || "")) {
      servers.push({ name: name, directory: directory });
    }
  }
  return servers;
}

function tsNodeOptions(server: Server): Record<string, unknown> {
  const file: string = path.join(server.directory, "tsconfig.json");
  const parsed: { config?: { "ts-node"?: Record<string, unknown> } } =
    ts.parseConfigFileTextToJson(file, fs.readFileSync(file, "utf8")) as {
      config?: { "ts-node"?: Record<string, unknown> };
    };
  return parsed.config?.["ts-node"] || {};
}

const SERVERS: Array<Server> = servers();

const START_COMPILED: RegExp =
  /&& exec node (--no-node-snapshot )?--require Common\/Server\/Utils\/TsNode\/PrecompiledSourceMaps\.js Index\.js$/u;

// A require() of a module named by a string.
const REQUIRE_CALL: RegExp = /require\(\s*"([^"]+)"\s*\)/gu;

const COPY_OF_COMMON: RegExp =
  /^COPY (?:--exclude=Tests )?\.\/packages\/Common \/usr\/src\/Common$/m;

describe("servers that ship an image", () => {
  test("are found: the App, the Probe, the Runner and the rest", () => {
    expect(
      SERVERS.map((server: Server): string => {
        return server.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "App",
        "Home",
        "Nginx",
        "Probe",
        "Runner",
        "TestServer",
      ]),
    );
  });

  test.each(
    SERVERS.map((server: Server): [string, Server] => {
      return [server.name, server];
    }),
  )(
    "%s starts the JavaScript its image compiled, after the stack-trace support",
    (_name: string, server: Server) => {
      const start: string = (
        JSON.parse(
          fs.readFileSync(path.join(server.directory, "package.json"), "utf8"),
        ) as { scripts: Record<string, string> }
      ).scripts["start"] as string;

      expect(start).toMatch(START_COMPILED);
      expect(fs.existsSync(path.join(server.directory, "Index.ts"))).toBe(
        true,
      );
    },
  );

  test.each(
    SERVERS.map((server: Server): [string, Server] => {
      return [server.name, server];
    }),
  )(
    "%s runs transpile-only with Common's transpiler wherever ts-node runs it",
    (_name: string, server: Server) => {
      const options: Record<string, unknown> = tsNodeOptions(server);

      expect(options["transpileOnly"]).toBe(true);
      expect(typeof options["transpiler"]).toBe("string");

      // In this repository: resolved from the package, as ts-node does.
      expect(
        path.resolve(server.directory, options["transpiler"] as string),
      ).toBe(TRANSPILER);

      // In the image: /usr/src/app/<path> is /usr/src/Common/...
      expect(
        path.posix.resolve("/usr/src/app", options["transpiler"] as string),
      ).toBe("/usr/src/Common/Server/Utils/TsNode/Transpiler.js");
    },
  );

  test.each(
    SERVERS.map((server: Server): [string, Server] => {
      return [server.name, server];
    }),
  )(
    "%s's image puts the package at /usr/src/app and Common at /usr/src/Common",
    (_name: string, server: Server) => {
      const dockerfile: string = fs.readFileSync(
        path.join(server.directory, "Dockerfile.tpl"),
        "utf8",
      );

      // Most images leave Common's tests behind: which is what the --exclude is.
      expect(dockerfile).toMatch(COPY_OF_COMMON);
      expect(dockerfile).toContain("WORKDIR /usr/src/app");
    },
  );

  test("the transpiler is plain JavaScript that needs nothing but Node: ts-node loads it before TypeScript", () => {
    const source: string = fs.readFileSync(TRANSPILER, "utf8");
    const required: Array<string> = [];
    for (const match of source.matchAll(REQUIRE_CALL)) {
      required.push(match[1] as string);
    }

    // TypeScript and source-map-support come through ts-node's resolver.
    expect(required.sort()).toEqual([
      "./SourceMapSupportCaches.js",
      "buffer",
      "fs",
      "url",
      "zlib",
    ]);
    // ...and the caches it shares with PrecompiledSourceMaps.js need nothing.
    expect(
      fs
        .readFileSync(
          path.join(path.dirname(TRANSPILER), "SourceMapSupportCaches.js"),
          "utf8",
        )
        .match(REQUIRE_CALL),
    ).toBeNull();
  });

  test("an image compiles with the transpiler's options: the JavaScript it runs is the JavaScript ts-node ran", () => {
    const precompile: string = fs.readFileSync(
      path.join(path.dirname(TRANSPILER), "Precompile.js"),
      "utf8",
    );

    expect(precompile).toContain(
      'const { runtimeCompilerOptions } = require("./Transpiler.js");',
    );
    expect(precompile).toContain(
      "compilerOptions: runtimeCompilerOptions(service.config.options),",
    );
    expect(fs.readFileSync(TRANSPILER, "utf8")).toContain(
      "const compilerOptions = runtimeCompilerOptions(service.config.options);",
    );
  });
});
