import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/*
 * ONE ZOD, AND IT IS ZOD 4: GHSA-mrhx-c7xc-m3w5.
 *
 * Every zod below 4.6.6 is affected by GHSA-mrhx-c7xc-m3w5, and no 3.x is
 * fixed. The one package here that uses zod is Expo's developer tooling,
 * @expo/cli, and every @expo/cli asks for zod ^3.25.76 - 57.0.32, which SDK
 * 57 installs, and 58.1.17, the newest, on 2026-10-28. So package.json
 * overrides @expo/cli's zod with ^4.6.7, and the audit exception that zod 3
 * needed is gone.
 *
 * The app's builds (EAS, Xcode, Gradle) do not run in CI, so this holds the
 * override where it can be held: in the tree npm resolves, and in @expo/cli
 * itself. Its zod lives in two modules, the dev tools plugin schemas and the
 * MCP tool schema it builds from a plugin's commands. Both are loaded here
 * in a plain Node, as `expo start` loads them, on the zod the override gives
 * them, and every zod call they make is run. The web export CI runs on every
 * pull request (MobileApp Test's expo-web-export) runs @expo/cli on it too.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const FIXED_IN: string = "4.6.6";

interface LockedPackage {
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const manifest: { overrides?: Record<string, unknown> } = JSON.parse(
  fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"),
) as { overrides?: Record<string, unknown> };
const lock: { packages: Record<string, LockedPackage> } = JSON.parse(
  fs.readFileSync(path.join(APP_ROOT, "package-lock.json"), "utf8"),
) as { packages: Record<string, LockedPackage> };

// a < b: negative; a = b: 0; a > b: positive. Release versions only (x.y.z).
function compareVersions(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (let index: number = 0; index < 3; index++) {
    const difference: number = (left[index] || 0) - (right[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

// Every copy of a package the lock holds: its path there, and its version.
function lockedCopies(name: string): Array<[string, string]> {
  return Object.entries(lock.packages)
    .filter(([location]: [string, LockedPackage]): boolean => {
      return (
        location === `node_modules/${name}` ||
        location.endsWith(`/node_modules/${name}`)
      );
    })
    .map(([location, locked]: [string, LockedPackage]): [string, string] => {
      return [location, locked.version || ""];
    });
}

// The copy of `name` the package at `location` loads: node's lookup, from its own node_modules up.
function resolvedCopy(location: string, name: string): string | null {
  let at: string = location;

  for (;;) {
    const candidate: string = at
      ? `${at}/node_modules/${name}`
      : `node_modules/${name}`;

    if (lock.packages[candidate]) {
      return candidate;
    }

    const parent: number = at.lastIndexOf("/node_modules/");

    if (at === "") {
      return null;
    }

    at = parent === -1 ? "" : at.slice(0, parent);
  }
}

// Every package in the lock that asks for `name`, by its path there.
function dependentsOf(name: string): Array<string> {
  return Object.entries(lock.packages)
    .filter(([location, locked]: [string, LockedPackage]): boolean => {
      return (
        location !== "" &&
        Boolean(
          locked.dependencies?.[name] ||
            locked.optionalDependencies?.[name] ||
            locked.peerDependencies?.[name],
        )
      );
    })
    .map(([location]: [string, LockedPackage]): string => {
      return location;
    })
    .sort();
}

interface ExpoZodReport {
  zodVersion: string;
  zodForCli: string;
  plugin: { valid: boolean; invalid: Array<string> };
  output: { valid: boolean; invalid: Array<string> };
  mcp: {
    command: boolean;
    unknownCommand: boolean;
    extraKey: boolean;
    wrongType: boolean;
    commandDescription: string;
    parameterDescription: string;
  };
  devToolsPlugin: { refused: string; accepted: string };
  results: {
    valid: Array<Record<string, string>>;
    invalid: Array<Record<string, string>>;
    text: Array<Record<string, string>>;
  };
}

/*
 * Loads @expo/cli's zod modules in a Node of their own, as `expo start`
 * does, and runs every zod call they make: the plugin and output schemas,
 * the MCP tool schema of a plugin's commands, the plugin class that checks
 * its configuration, and the reader of a command's output.
 */
function runExpoZodModules(): ExpoZodReport {
  const script: string = `
    const path = require("path");
    const appRoot = ${JSON.stringify(APP_ROOT)};
    const cliRoot = path.dirname(require.resolve("@expo/cli/package.json", { paths: [appRoot] }));
    const server = path.join(cliRoot, "build", "src", "start", "server");
    const schemas = require(path.join(server, "DevToolsPlugin.schema.js"));
    const { createMCPDevToolsExtensionSchema } = require(path.join(server, "createMCPDevToolsExtensionSchema.js"));
    const { DevToolsPlugin } = require(path.join(server, "DevToolsPlugin.js"));
    const { DevToolsPluginCliExtensionResults } = require(path.join(server, "DevToolsPluginCliExtensionResults.js"));

    const issues = (result) => result.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message);
    const plugin = {
      packageName: "devtools-plugin",
      packageRoot: "/project/node_modules/devtools-plugin",
      bannerTitle: true,
      cliExtensions: {
        description: "A dev tools plugin",
        entryPoint: "cli.js",
        commands: [
          { name: "ping", title: "Ping", environments: ["cli", "mcp"], parameters: [{ name: "host", type: "text", description: "Where to" }] },
          { name: "count", title: "Count", environments: ["mcp"], parameters: [{ name: "times", type: "number" }] },
        ],
      },
    };
    const mcp = createMCPDevToolsExtensionSchema(plugin);
    let refused = "";
    try {
      new DevToolsPlugin({ packageName: "", packageRoot: "/project" }, "/project");
    } catch (error) {
      refused = String(error.message).split("\\n")[0];
    }
    const results = new DevToolsPluginCliExtensionResults();

    console.log(JSON.stringify({
      zodVersion: require(require.resolve("zod/package.json", { paths: [appRoot] })).version,
      zodForCli: require(require.resolve("zod/package.json", { paths: [cliRoot] })).version,
      plugin: {
        valid: schemas.PluginSchema.safeParse(plugin).success,
        invalid: issues(schemas.PluginSchema.safeParse({ packageRoot: "/x", bannerTitle: "" })),
      },
      output: {
        valid: schemas.DevToolsPluginOutputSchema.safeParse([
          { type: "text", text: "pong", level: "info" },
          { type: "image", url: "https://example.com/a.png" },
          { type: "audio", url: "https://example.com/a.mp3", text: "a sound" },
        ]).success,
        invalid: issues(schemas.DevToolsPluginOutputSchema.safeParse([
          { type: "image", url: "not an address" },
          { type: "text", text: "x", level: "loud" },
        ])),
      },
      mcp: {
        command: mcp.safeParse({ command: "ping", host: "example.com" }).success,
        unknownCommand: mcp.safeParse({ command: "nope" }).success,
        extraKey: mcp.safeParse({ command: "ping", extra: 1 }).success,
        wrongType: mcp.safeParse({ command: "count", times: "three" }).success,
        commandDescription: mcp.shape.command.description,
        parameterDescription: mcp.shape.host.description,
      },
      devToolsPlugin: {
        refused,
        accepted: new DevToolsPlugin({ packageName: "devtools-plugin", packageRoot: "/project/node_modules/devtools-plugin" }, "/project").packageName,
      },
      results: {
        valid: results.parseOutputText(JSON.stringify([{ type: "text", text: "ok", level: "info" }])),
        invalid: results.parseOutputText(JSON.stringify([{ type: "image", url: "nope" }])),
        text: results.parseOutputText("first line\\nsecond line"),
      },
    }));
  `;
  const output: string = execFileSync(process.execPath, ["-e", script], {
    cwd: APP_ROOT,
    encoding: "utf8",
    timeout: 60000,
  });

  return JSON.parse(output.trim().split("\n").pop() as string) as ExpoZodReport;
}

describe("zod in the app's dependencies", () => {
  test("package.json overrides @expo/cli's zod with zod 4, and nothing else's", () => {
    expect(manifest.overrides?.["@expo/cli"]).toEqual({ zod: "^4.6.7" });
    // Scoped: a package that brings zod 3 later fails the audit and is decided on, not silently moved.
    expect(manifest.overrides?.["zod"]).toBeUndefined();
  });

  test(`the lock holds one zod, ${FIXED_IN} or later, and every package that asks for zod loads it`, () => {
    const copies: Array<[string, string]> = lockedCopies("zod");

    expect(copies).toHaveLength(1);
    expect(copies[0]?.[0]).toBe("node_modules/zod");
    expect(
      compareVersions(copies[0]?.[1] as string, FIXED_IN),
    ).toBeGreaterThanOrEqual(0);

    const dependents: Array<string> = dependentsOf("zod");

    // @expo/cli is the one; were it none, the override would have nothing to do.
    expect(dependents).toContain("node_modules/@expo/cli");

    for (const dependent of dependents) {
      expect({ dependent, loads: resolvedCopy(dependent, "zod") }).toEqual({
        dependent,
        loads: "node_modules/zod",
      });
    }
  });

  test("@expo/cli still asks for zod 3 itself: when it asks for zod 4, drop the override and this test", () => {
    const expoCli: LockedPackage = lock.packages[
      "node_modules/@expo/cli"
    ] as LockedPackage;

    expect(expoCli.dependencies?.["zod"]).toBe("^3.25.76");
  });

  test("the zod installed is the lock's", () => {
    const installed: { version: string } = JSON.parse(
      fs.readFileSync(
        require.resolve("zod/package.json", { paths: [APP_ROOT] }),
        "utf8",
      ),
    ) as { version: string };

    expect(installed.version).toBe(lockedCopies("zod")[0]?.[1]);
  });

  test("reads the lock as node does: a nested copy wins over the top one, and a missing one is missing", () => {
    expect(resolvedCopy("node_modules/@expo/cli", "zod")).toBe(
      "node_modules/zod",
    );
    expect(resolvedCopy("node_modules/@expo/cli", "ws")).toBe(
      "node_modules/@expo/cli/node_modules/ws",
    );
    expect(resolvedCopy("node_modules/@expo/cli", "no-such-package")).toBe(
      null,
    );
    expect(compareVersions("4.6.7", FIXED_IN)).toBeGreaterThan(0);
    expect(compareVersions("3.25.76", FIXED_IN)).toBeLessThan(0);
  });
});

describe("@expo/cli on zod 4, as `expo start` loads it", () => {
  const report: ExpoZodReport = runExpoZodModules();

  test("its zod is the one zod 4 of the app", () => {
    expect(report.zodForCli).toBe(report.zodVersion);
    expect(compareVersions(report.zodVersion, FIXED_IN)).toBeGreaterThanOrEqual(
      0,
    );
  });

  test("a dev tools plugin's configuration is checked: a right one passes, a wrong one fails with what is wrong", () => {
    expect(report.plugin.valid).toBe(true);
    expect(report.plugin.invalid).toEqual([
      "packageName: Invalid input: expected string, received undefined",
      "bannerTitle: Too small: expected string to have >=1 characters",
    ]);
    expect(report.devToolsPlugin.accepted).toBe("devtools-plugin");
    expect(report.devToolsPlugin.refused).toBe(
      "Invalid plugin configuration: [",
    );
  });

  test("a plugin command's output is read: text, images and sounds pass, a bad address or level is reported", () => {
    expect(report.output.valid).toBe(true);
    // A line that fits none of the three kinds is reported as one, as zod 4 reports a union.
    expect(report.output.invalid).toEqual([
      "0.url: Invalid URL",
      "1: Invalid input",
    ]);
    expect(report.results.valid).toEqual([
      { type: "text", text: "ok", level: "info" },
    ]);
    expect(report.results.invalid).toEqual([
      { type: "text", text: "Invalid JSON: Invalid URL", level: "error" },
    ]);
    expect(report.results.text).toEqual([
      { type: "text", text: "first line", level: "info" },
      { type: "text", text: "second line", level: "info" },
    ]);
  });

  test("a plugin's commands become one MCP tool schema: one of its commands, its parameters typed and described, nothing else", () => {
    expect(report.mcp.command).toBe(true);
    expect(report.mcp.unknownCommand).toBe(false);
    expect(report.mcp.extraKey).toBe(false);
    expect(report.mcp.wrongType).toBe(false);
    expect(report.mcp.commandDescription).toContain(
      '"ping": Ping (params: host). "count": Count (params: times).',
    );
    expect(report.mcp.parameterDescription).toBe('Where to (Used by: "ping")');
  });
});
