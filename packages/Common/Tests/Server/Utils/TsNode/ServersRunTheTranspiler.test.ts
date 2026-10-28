import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every OneUptime server that boots through ts-node runs its TypeScript with
 * Common's transpiler (Server/Utils/TsNode/Transpiler.js), which keeps each
 * module's source map out of the code V8 holds for the life of the process
 * (about 470 MB of an idle App's heap, 35 MB of the Probe's). A server that
 * forgot it would quietly keep the old cost, so this holds every package
 * that ships an image and starts through ts-node to naming it in its
 * tsconfig's "ts-node" section - with "transpileOnly", which ts-node needs
 * for a custom transpiler - by a path that resolves both in this repository
 * and in the image, where the package is /usr/src/app and Common
 * /usr/src/Common.
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

// Packages that ship an image and whose start script runs ts-node.
function serversOnTsNode(): Array<Server> {
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
    if ((scripts["start"] || "").includes("ts-node/register")) {
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

const SERVERS: Array<Server> = serversOnTsNode();

// A require() of a module named by a string.
const REQUIRE_CALL: RegExp = /require\(\s*"([^"]+)"\s*\)/gu;

describe("servers that boot through ts-node", () => {
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
    "%s runs transpile-only with Common's transpiler",
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

      expect(dockerfile).toContain("COPY ./packages/Common /usr/src/Common");
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
    expect(required.sort()).toEqual(["buffer", "fs", "url", "zlib"]);
  });
});
