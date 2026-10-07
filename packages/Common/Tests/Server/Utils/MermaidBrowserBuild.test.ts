import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MermaidBrowserBuild,
  MermaidBrowserBuildFunction,
  MermaidBrowserBuildScript,
  MermaidBrowserEntry,
  createMermaidBrowserBuildCache,
  getMermaidBuildEnvironment,
  parseMermaidBrowserBuild,
  runMermaidBrowserBuild,
} from "../../../Server/Utils/MermaidBrowserBuild";

/*
 * The docs and the blog draw diagrams with a mermaid that the server builds
 * from mermaid's ES module source, in a child node process, the first time a
 * page asks for it. These pin what that build may contain, how often it runs,
 * and what the child is handed.
 */

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

function buildOutput(
  files: Array<{ path: unknown; text: unknown }>,
  entry: unknown = MermaidBrowserEntry,
): string {
  return JSON.stringify({ entry, files });
}

const ENTRY_FILE: { path: string; text: string } = {
  path: MermaidBrowserEntry,
  text: 'import "./chunks/chunk-ABCDEFGH.mjs";export{a as default};',
};

const CHUNK_FILE: { path: string; text: string } = {
  path: "chunks/chunk-ABCDEFGH.mjs",
  text: "var a=1;export{a};",
};

describe("parseMermaidBrowserBuild", () => {
  test("reads a build into the files it serves", () => {
    const build: MermaidBrowserBuild = parseMermaidBrowserBuild(
      buildOutput([ENTRY_FILE, CHUNK_FILE]),
    );

    expect(build.entry).toBe(MermaidBrowserEntry);
    expect([...build.files.keys()].sort()).toEqual(
      [MermaidBrowserEntry, CHUNK_FILE.path].sort(),
    );
    expect(build.files.get(CHUNK_FILE.path)?.toString("utf8")).toBe(
      CHUNK_FILE.text,
    );
  });

  test("keeps non-ASCII text intact", () => {
    const build: MermaidBrowserBuild = parseMermaidBrowserBuild(
      buildOutput([{ path: MermaidBrowserEntry, text: "var s='Ω≤∑';" }]),
    );

    expect(build.files.get(MermaidBrowserEntry)?.toString("utf8")).toBe(
      "var s='Ω≤∑';",
    );
  });

  test.each([
    ["not JSON", "Error: something went wrong"],
    ["JSON null", "null"],
    ["a JSON string", '"mermaid.mjs"'],
    ["a JSON number", "42"],
  ])("refuses output that is %s", (_label: string, output: string) => {
    expect(() => {
      return parseMermaidBrowserBuild(output);
    }).toThrow();
  });

  test("refuses a build whose entry is not the one the views import", () => {
    expect(() => {
      return parseMermaidBrowserBuild(
        buildOutput(
          [{ path: "mermaid.esm.min.mjs", text: "" }],
          "mermaid.esm.min.mjs",
        ),
      );
    }).toThrow(/entry/);
  });

  test("refuses a build that names its entry but does not contain it", () => {
    expect(() => {
      return parseMermaidBrowserBuild(buildOutput([CHUNK_FILE]));
    }).toThrow(/mermaid\.mjs/);
  });

  test("refuses a build without a file list", () => {
    expect(() => {
      return parseMermaidBrowserBuild(
        JSON.stringify({ entry: MermaidBrowserEntry }),
      );
    }).toThrow(/no files/);
  });

  test.each([
    ["an absolute path", "/etc/passwd.mjs"],
    ["a parent directory", "../package.mjs"],
    ["a parent directory further down", "chunks/../../escape.mjs"],
    ["a current directory segment", "./mermaid2.mjs"],
    ["an empty segment", "chunks//x.mjs"],
    ["a hidden file", ".hidden.mjs"],
    ["a backslash", "chunks\\x.mjs"],
    ["a drive letter", "C:/x.mjs"],
    ["a space", "chunks/x y.mjs"],
    ["a query string", "chunks/x.mjs?v=1"],
    ["a sourcemap", "chunks/x.mjs.map"],
    ["a classic script", "chunks/x.js"],
    ["an empty name", ""],
  ])("refuses a file with %s", (_label: string, filePath: string) => {
    expect(() => {
      return parseMermaidBrowserBuild(
        buildOutput([ENTRY_FILE, { path: filePath, text: "" }]),
      );
    }).toThrow(/cannot be served/);
  });

  test.each([
    ["a missing path", { text: "" }],
    ["a numeric path", { path: 3, text: "" }],
    ["missing text", { path: "chunks/a-ABCDEFGH.mjs" }],
    ["binary text", { path: "chunks/a-ABCDEFGH.mjs", text: { data: [1] } }],
    ["null", null],
  ])("refuses a file entry with %s", (_label: string, file: unknown) => {
    expect(() => {
      return parseMermaidBrowserBuild(
        JSON.stringify({
          entry: MermaidBrowserEntry,
          files: [ENTRY_FILE, file],
        }),
      );
    }).toThrow(/cannot be served/);
  });
});

describe("createMermaidBrowserBuildCache", () => {
  const SAMPLE_BUILD: MermaidBrowserBuild = parseMermaidBrowserBuild(
    buildOutput([ENTRY_FILE, CHUNK_FILE]),
  );

  interface Clock {
    now: () => number;
    advance: (milliseconds: number) => void;
  }

  function createClock(): Clock {
    let time: number = 1_000_000;

    return {
      now: (): number => {
        return time;
      },
      advance: (milliseconds: number): void => {
        time += milliseconds;
      },
    };
  }

  test("shares one build between requests that arrive while it runs", async () => {
    let resolveBuild: (build: MermaidBrowserBuild) => void = () => {};
    const build: Mock<MermaidBrowserBuildFunction> = jest.fn<MermaidBrowserBuildFunction>(() => {
      return new Promise<MermaidBrowserBuild>(
        (resolve: (build: MermaidBrowserBuild) => void) => {
          resolveBuild = resolve;
        },
      );
    });
    const clock: Clock = createClock();
    const get: MermaidBrowserBuildFunction = createMermaidBrowserBuildCache({
      build,
      retryAfterFailureMilliseconds: 60_000,
      now: clock.now,
    });

    const first: Promise<MermaidBrowserBuild> = get();
    const second: Promise<MermaidBrowserBuild> = get();
    const third: Promise<MermaidBrowserBuild> = get();

    resolveBuild(SAMPLE_BUILD);

    expect(await first).toBe(SAMPLE_BUILD);
    expect(await second).toBe(SAMPLE_BUILD);
    expect(await third).toBe(SAMPLE_BUILD);
    expect(build).toHaveBeenCalledTimes(1);
  });

  test("keeps a finished build for the life of the process", async () => {
    const build: Mock<MermaidBrowserBuildFunction> = jest.fn<MermaidBrowserBuildFunction>(() => {
      return Promise.resolve(SAMPLE_BUILD);
    });
    const clock: Clock = createClock();
    const get: MermaidBrowserBuildFunction = createMermaidBrowserBuildCache({
      build,
      retryAfterFailureMilliseconds: 60_000,
      now: clock.now,
    });

    await get();
    clock.advance(365 * 24 * 60 * 60 * 1000);
    await get();

    expect(build).toHaveBeenCalledTimes(1);
  });

  test("answers with the same failure until the retry window has passed, then builds again", async () => {
    let attempts: number = 0;
    const build: Mock<MermaidBrowserBuildFunction> = jest.fn<MermaidBrowserBuildFunction>(() => {
      attempts++;

      return attempts === 1
        ? Promise.reject(new Error("esbuild is missing"))
        : Promise.resolve(SAMPLE_BUILD);
    });
    const clock: Clock = createClock();
    const get: MermaidBrowserBuildFunction = createMermaidBrowserBuildCache({
      build,
      retryAfterFailureMilliseconds: 60_000,
      now: clock.now,
    });

    await expect(get()).rejects.toThrow("esbuild is missing");

    // A broken install cannot be made to start a build per request.
    for (let request: number = 0; request < 25; request++) {
      clock.advance(1_000);
      await expect(get()).rejects.toThrow("esbuild is missing");
    }

    expect(build).toHaveBeenCalledTimes(1);

    clock.advance(60_000);

    await expect(get()).resolves.toBe(SAMPLE_BUILD);
    expect(build).toHaveBeenCalledTimes(2);

    // And the good build is then kept.
    clock.advance(10 * 60_000);
    await expect(get()).resolves.toBe(SAMPLE_BUILD);
    expect(build).toHaveBeenCalledTimes(2);
  });

  test("starts the retry window when the build fails, not when it started", async () => {
    let rejectBuild: (error: Error) => void = () => {};
    const build: Mock<MermaidBrowserBuildFunction> = jest.fn<MermaidBrowserBuildFunction>(() => {
      return new Promise<MermaidBrowserBuild>(
        (_resolve: unknown, reject: (error: Error) => void) => {
          rejectBuild = reject;
        },
      );
    });
    const clock: Clock = createClock();
    const get: MermaidBrowserBuildFunction = createMermaidBrowserBuildCache({
      build,
      retryAfterFailureMilliseconds: 60_000,
      now: clock.now,
    });

    const pending: Promise<MermaidBrowserBuild> = get();

    // The build runs for two minutes, then fails.
    clock.advance(120_000);
    rejectBuild(new Error("timed out"));
    await expect(pending).rejects.toThrow("timed out");

    clock.advance(30_000);
    await expect(get()).rejects.toThrow("timed out");
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe("runMermaidBrowserBuild", () => {
  let scratch: string;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-diagrams-"));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env["ONEUPTIME_TEST_SECRET"];
  });

  function writeScript(name: string, source: string): string {
    const file: string = path.join(scratch, name);
    fs.writeFileSync(file, source);
    return file;
  }

  test("builds with Common's esbuild-mermaid.js by default", async () => {
    expect(MermaidBrowserBuildScript).toBe(
      path.resolve(__dirname, "..", "..", "..", "UI", "esbuild-mermaid.js"),
    );
    expect(fs.existsSync(MermaidBrowserBuildScript)).toBe(true);

    const build: MermaidBrowserBuild = await runMermaidBrowserBuild();

    expect(build.entry).toBe(MermaidBrowserEntry);
    expect(build.files.size).toBeGreaterThan(50);
  });

  test("reads what the script prints", async () => {
    const script: string = writeScript(
      "prints-a-build.js",
      `process.stdout.write(${JSON.stringify(buildOutput([ENTRY_FILE, CHUNK_FILE]))});`,
    );

    const build: MermaidBrowserBuild = await runMermaidBrowserBuild(script);

    expect([...build.files.keys()].sort()).toEqual(
      [MermaidBrowserEntry, CHUNK_FILE.path].sort(),
    );
  });

  test("fails with what the script reported when it fails", async () => {
    const script: string = writeScript(
      "fails.js",
      'process.stderr.write("Could not resolve \\"katex\\"\\n"); process.exitCode = 1;',
    );

    await expect(runMermaidBrowserBuild(script)).rejects.toThrow(
      /mermaid could not be built[\s\S]*Could not resolve "katex"/,
    );
  });

  test("fails on output that is not a build", async () => {
    const script: string = writeScript(
      "prints-junk.js",
      'process.stdout.write("Done in 300ms");',
    );

    await expect(runMermaidBrowserBuild(script)).rejects.toThrow();
  });

  test("fails on a build that names an unservable file", async () => {
    const script: string = writeScript(
      "prints-traversal.js",
      `process.stdout.write(${JSON.stringify(
        buildOutput([ENTRY_FILE, { path: "../../etc/passwd.mjs", text: "" }]),
      )});`,
    );

    await expect(runMermaidBrowserBuild(script)).rejects.toThrow(
      /cannot be served/,
    );
  });

  test("hands the child none of the server's environment", async () => {
    process.env["ONEUPTIME_TEST_SECRET"] = "do-not-pass-this-on";

    // The child reports the environment it was given, inside a build.
    const script: string = writeScript(
      "reports-env.js",
      [
        "const names = Object.keys(process.env).sort();",
        "process.stdout.write(JSON.stringify({",
        `  entry: ${JSON.stringify(MermaidBrowserEntry)},`,
        `  files: [{ path: ${JSON.stringify(MermaidBrowserEntry)}, text: JSON.stringify({ names: names, nodeEnv: process.env.NODE_ENV }) }],`,
        "}));",
      ].join("\n"),
    );

    const build: MermaidBrowserBuild = await runMermaidBrowserBuild(script);
    const reported: { names: Array<string>; nodeEnv: string } = JSON.parse(
      (build.files.get(MermaidBrowserEntry) as Buffer).toString("utf8"),
    ) as { names: Array<string>; nodeEnv: string };

    expect(reported.names).not.toContain("ONEUPTIME_TEST_SECRET");
    expect(reported.names).not.toContain("NODE_OPTIONS");
    expect(reported.nodeEnv).toBe("production");

    const allowed: Array<string> = [
      "NODE_ENV",
      "PATH",
      "ESBUILD_BINARY_PATH",
      "TMPDIR",
    ];

    expect(
      reported.names.filter((name: string): boolean => {
        return !allowed.includes(name);
      }),
    ).toEqual([]);
  });
});

describe("getMermaidBuildEnvironment", () => {
  const saved: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in saved)) {
        delete process.env[name];
      }
    }

    Object.assign(process.env, saved);
  });

  test("passes PATH and the esbuild binary location, and nothing else of the server's", () => {
    process.env["PATH"] = "/usr/local/bin:/usr/bin";
    process.env["ESBUILD_BINARY_PATH"] = "/opt/esbuild";
    process.env["DATABASE_PASSWORD"] = "secret";
    process.env["NODE_OPTIONS"] = "--require ts-node/register";
    process.env["ONEUPTIME_SECRET"] = "secret";

    const environment: NodeJS.ProcessEnv = getMermaidBuildEnvironment();

    expect(environment["PATH"]).toBe("/usr/local/bin:/usr/bin");
    expect(environment["ESBUILD_BINARY_PATH"]).toBe("/opt/esbuild");
    expect(environment["NODE_ENV"]).toBe("production");
    expect(environment["DATABASE_PASSWORD"]).toBeUndefined();
    expect(environment["NODE_OPTIONS"]).toBeUndefined();
    expect(environment["ONEUPTIME_SECRET"]).toBeUndefined();
  });

  test("leaves out what is not set", () => {
    delete process.env["ESBUILD_BINARY_PATH"];

    expect(
      Object.keys(getMermaidBuildEnvironment()).includes("ESBUILD_BINARY_PATH"),
    ).toBe(false);
  });
});
