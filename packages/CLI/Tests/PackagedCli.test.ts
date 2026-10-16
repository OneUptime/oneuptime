import { Command } from "commander";
import { buildProgram } from "../Program";
import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import * as fs from "fs";
import { isBuiltin } from "module";
import * as os from "os";
import * as path from "path";

/*
 * The CLI as npm publishes it, installed as a customer installs it, held to
 * the sources every other suite here tests.
 *
 * #4872: `npm install -g @oneuptime/cli`, then `oneuptime --version`, died
 * with "Cannot find module 'Common/Models/DatabaseModels/Index'" - in every
 * CLI published since 10.0.5 - and no test noticed, because every test ran
 * the TypeScript sources inside the monorepo, where "Common/..." resolves.
 *
 * So this suite packs the package (`npm pack`, whose prepack builds the
 * bundle with esbuild.config.js), installs the tarball globally into an empty
 * prefix with an empty npm cache and --offline, outside the monorepo, and
 * runs the installed `oneuptime`. Each command it runs is also run through
 * the sources, in this process, against the same stand-in OneUptime API: the
 * two must send the same requests and print the same answers, for every
 * resource. The bundle is compiled without the decorator metadata tsc emits,
 * from Common's sources; this is what shows nothing the CLI reads from the
 * models was lost on the way.
 *
 * Scripts/SmokeTestPackage.js does the packing, the install and the checks
 * any Node.js line must pass; CI runs that on each line the CLI supports.
 */

interface PackedFile {
  path: string;
  size: number;
  mode: number;
}

interface Packed {
  tarball: string;
  name: string;
  version: string;
  files: Array<PackedFile>;
}

interface Installation {
  root: string;
  prefix: string;
  home: string;
  work: string;
  binary: string;
  packageDirectory: string;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
}

interface FakeApi {
  url: string;
  requests: Array<RecordedRequest>;
  close: () => Promise<void>;
}

interface Answer {
  status?: number;
  body: unknown;
}

interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface SmokeModule {
  cleanEnvironment: (
    overrides?: Record<string, string>,
  ) => Record<string, string | undefined>;
  readPackJson: (stdout: string) => Array<{ filename: string }>;
  packCli: (destination: string) => Promise<Packed>;
  installTarball: (tarball: string, root: string) => Promise<Installation>;
  runCli: (
    installation: Installation,
    args: Array<string>,
  ) => Promise<RunResult>;
  startFakeApi: (
    respond: (request: RecordedRequest) => Answer,
  ) => Promise<FakeApi>;
  smokeTest: (
    installation: Installation,
    version: string,
  ) => Promise<Array<SmokeResult>>;
  main: (argv: Array<string>) => Promise<number>;
}

interface BundledPackage {
  name: string;
  version: string;
  license: string;
}

interface BuildConfigModule {
  TYPEORM_DATABASE_DRIVERS: Array<string>;
  BUNDLE_FILE_NAME: string;
  LICENSES_FILE_NAME: string;
  build: (settings?: {
    outputDirectory?: string;
  }) => Promise<{ bundleFile: string; packages: Array<BundledPackage> }>;
}

interface Manifest {
  name: string;
  version: string;
  bin: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: Array<string>;
}

interface SourceRun {
  printed: Array<string>;
  errors: Array<string>;
  exitCode: number | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const Smoke: SmokeModule = require("../Scripts/SmokeTestPackage");

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const BuildConfig: BuildConfigModule = require("../esbuild.config");

const CLI_ROOT: string = path.resolve(__dirname, "..");

const SOURCE_MANIFEST: Manifest = JSON.parse(
  fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf-8"),
) as Manifest;

// A require("name") the bundle makes at run time: not a method such as remote.require().
const BARE_REQUIRE: RegExp = /(?<![\w$.])require\("([^"\n]+)"\)/g;

// The first line of a license section in THIRD-PARTY-LICENSES.txt.
const LICENSE_SECTION: RegExp = /^={72}\n(\S+) (\S+)\nLicense: ([^\n]+)\n/gm;

/*
 * The licenses the bundle may hold: permissive ones, which ask for nothing
 * but their notice (THIRD-PARTY-LICENSES.txt carries it). A package under
 * any other license - a copyleft one above all - must not be bundled into an
 * Apache-2.0 CLI without someone deciding so first.
 */
const LICENSES_THE_BUNDLE_MAY_HOLD: Array<string> = [
  "(MIT AND BSD-3-Clause)",
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
];

const RECORD_ID: string = "6b5a3b8e-3d4b-4a8a-9f4b-1c2d3e4f5a6b";

class ExitCalled extends Error {}

let work: string;
let packed: Packed;
let installation: Installation;
let installedManifest: Manifest;
let bundleText: string;
let api: FakeApi;
let runNumber: number = 0;

/*
 * Answers like OneUptime for a request of any resource, keyed by the API key
 * each run sends, so runs of the packed CLI can go at once.
 */
function respond(request: RecordedRequest): Answer {
  const key: string = request.headers["apikey"] || "";

  if (key.startsWith("sk-refused")) {
    return { status: 401, body: { message: "Invalid API Key" } };
  }

  if (key.startsWith("sk-missing")) {
    return { status: 404, body: { message: "Incident not found" } };
  }

  if (key.startsWith("sk-broken")) {
    return { status: 500, body: { message: "Something went wrong" } };
  }

  if (request.path.endsWith("/count")) {
    return { body: { count: 3 } };
  }

  if (request.path.endsWith("/get-list")) {
    return {
      body: {
        data: [{ _id: RECORD_ID, name: `A row of ${request.path}` }],
        count: 1,
      },
    };
  }

  return { body: { _id: RECORD_ID, name: `The answer to ${request.path}` } };
}

function nextKey(prefix: string): string {
  runNumber += 1;
  return `${prefix}-${runNumber}-0123456789`;
}

function requestsWithKey(key: string): Array<RecordedRequest> {
  return api.requests.filter((request: RecordedRequest): boolean => {
    return request.headers["apikey"] === key;
  });
}

// What a request asked, without the headers a run differs in.
function asked(requests: Array<RecordedRequest>): Array<unknown> {
  return requests.map((request: RecordedRequest): unknown => {
    return {
      method: request.method,
      path: request.path,
      body: request.body,
      contentType: request.headers["content-type"],
    };
  });
}

/*
 * Runs a command through the sources, in this process: the program
 * buildProgram() builds, with its real API client, against the stand-in API.
 */
async function runSources(args: Array<string>): Promise<SourceRun> {
  const run: SourceRun = { printed: [], errors: [], exitCode: undefined };
  const noColor: string | undefined = process.env["NO_COLOR"];

  process.env["NO_COLOR"] = "1";

  const log: jest.SpyInstance = jest
    .spyOn(console, "log")
    .mockImplementation((...parts: Array<unknown>): void => {
      run.printed.push(parts.map(String).join(" "));
    });
  const error: jest.SpyInstance = jest
    .spyOn(console, "error")
    .mockImplementation((...parts: Array<unknown>): void => {
      run.errors.push(parts.map(String).join(" "));
    });
  const exit: jest.SpyInstance = jest
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null): never => {
      run.exitCode = Number(code);
      throw new ExitCalled();
    });

  try {
    const program: Command = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "oneuptime", ...args]);
  } catch (caught) {
    if (!(caught instanceof ExitCalled)) {
      throw caught;
    }
  } finally {
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();

    if (noColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = noColor;
    }
  }

  return run;
}

async function eachAtOnce<T, R>(
  items: Array<T>,
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<Array<R>> {
  const results: Array<R> = [];
  let next: number = 0;

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < items.length) {
      const index: number = next;
      next += 1;
      results[index] = await work(items[index] as T);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}

const PARALLEL_RUNS: number = Math.max(2, Math.min(6, os.cpus().length));

beforeAll(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-packaged-"));
  packed = await Smoke.packCli(path.join(work, "pack"));
  installation = await Smoke.installTarball(
    packed.tarball,
    path.join(work, "install"),
  );
  installedManifest = JSON.parse(
    fs.readFileSync(
      path.join(installation.packageDirectory, "package.json"),
      "utf-8",
    ),
  ) as Manifest;
  bundleText = fs.readFileSync(
    path.join(installation.packageDirectory, "build", "dist", "Index.js"),
    "utf-8",
  );
  api = await Smoke.startFakeApi(respond);
}, 600000);

afterAll(async () => {
  if (api) {
    await api.close();
  }

  if (work) {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

describe("the tarball npm publishes", () => {
  it("holds the bundle, its licenses, the README and package.json, and nothing else", () => {
    expect(packed.name).toBe("@oneuptime/cli");
    expect(packed.version).toBe(SOURCE_MANIFEST.version);
    expect(
      packed.files
        .map((file: PackedFile): string => {
          return file.path;
        })
        .sort(),
    ).toEqual([
      "README.md",
      `build/dist/${BuildConfig.BUNDLE_FILE_NAME}`,
      `build/dist/${BuildConfig.LICENSES_FILE_NAME}`,
      "package.json",
    ]);
  });

  it("holds an executable bundle that starts with a node shebang", () => {
    const bundle: PackedFile | undefined = packed.files.find(
      (file: PackedFile): boolean => {
        return file.path === "build/dist/Index.js";
      },
    );

    expect(bundle).toBeDefined();
    expect((bundle as PackedFile).mode & 0o111).not.toBe(0);
    expect(bundleText.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("is a few megabytes, not the 287 MB of @oneuptime/common", () => {
    expect(fs.statSync(packed.tarball).size).toBeLessThan(8 * 1024 * 1024);
  });

  it("asks npm to install nothing with it", () => {
    expect(installedManifest.dependencies || {}).toEqual({});
    expect(installedManifest.peerDependencies || {}).toEqual({});
    expect(installedManifest.optionalDependencies || {}).toEqual({});
    expect(installedManifest.bundleDependencies || []).toEqual([]);

    for (const hook of ["preinstall", "install", "postinstall"]) {
      expect((installedManifest.scripts || {})[hook]).toBeUndefined();
    }
  });
});

describe("the CLI installed from it", () => {
  it("installed from the tarball alone: an empty npm cache, --offline, nothing beside it", () => {
    expect(fs.existsSync(installation.binary)).toBe(true);
    expect(
      fs.existsSync(path.join(installation.packageDirectory, "node_modules")),
    ).toBe(false);
    expect(
      fs.readdirSync(path.join(installation.prefix, "lib", "node_modules")),
    ).toEqual(["@oneuptime"]);
    expect(installedManifest.version).toBe(SOURCE_MANIFEST.version);
  });

  it("requires nothing but Node.js's own modules, never a Common/ path", () => {
    const required: Set<string> = new Set<string>(
      [...bundleText.matchAll(BARE_REQUIRE)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect(required.size).toBeGreaterThan(10);
    expect(bundleText).not.toContain('require("Common/');

    // The only others: the database drivers typeorm requires on connecting.
    const notNode: Array<string> = [...required]
      .filter((name: string): boolean => {
        return !isBuiltin(name);
      })
      .sort();

    expect(notNode).toEqual([...BuildConfig.TYPEORM_DATABASE_DRIVERS].sort());
  });

  it("passes every check of Scripts/SmokeTestPackage.js", async () => {
    const results: Array<SmokeResult> = await Smoke.smokeTest(
      installation,
      SOURCE_MANIFEST.version,
    );

    expect(
      results.filter((result: SmokeResult): boolean => {
        return !result.ok;
      }),
    ).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(9);
  }, 120000);

  it("prints the version in package.json for --version and version", async () => {
    for (const args of [["--version"], ["-V"], ["version"]]) {
      const result: RunResult = await Smoke.runCli(installation, args);

      expect(result).toEqual({
        status: 0,
        stdout: `${SOURCE_MANIFEST.version}\n`,
        stderr: "",
      });
    }
  });

  it("prints the same help as the sources, every resource command included", async () => {
    const source: Command = buildProgram();
    // A pipe has no width: commander lays the help out for 80 columns then.
    source.configureHelp({ helpWidth: 80 });

    const result: RunResult = await Smoke.runCli(installation, ["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(source.helpInformation());
    expect(result.stdout).toContain("incident");
  });

  it("prints the same help for a resource as the sources", async () => {
    const source: Command = buildProgram();
    const incident: Command = source.commands.find(
      (command: Command): boolean => {
        return command.name() === "incident";
      },
    ) as Command;
    incident.configureHelp({ helpWidth: 80 });

    const result: RunResult = await Smoke.runCli(installation, [
      "incident",
      "--help",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(incident.helpInformation());
  });

  it("lists exactly the resources the sources discover", async () => {
    const result: RunResult = await Smoke.runCli(installation, [
      "resources",
      "--output",
      "json",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(
      discoverResources().map((resource: ResourceInfo): unknown => {
        return {
          name: resource.name,
          singularName: resource.singularName,
          pluralName: resource.pluralName,
          modelType: resource.modelType,
          apiPath: resource.apiPath,
        };
      }),
    );
  });

  /*
   * The select of a list names the columns a model's decorators allow, read
   * from the model as the bundle compiled it: the request is where a lost
   * decorator would show.
   */
  it("sends the request the sources send, and prints what they print, for a list and a count of every resource", async () => {
    const resources: Array<ResourceInfo> = discoverResources();
    const commands: Array<Array<string>> = resources.flatMap(
      (resource: ResourceInfo): Array<Array<string>> => {
        return [
          [resource.name, "list", "--limit", "5", "--output", "json"],
          [resource.name, "count", "--output", "json"],
        ];
      },
    );

    expect(resources.length).toBeGreaterThan(20);

    const packedRuns: Array<{ key: string; result: RunResult }> =
      await eachAtOnce(
        commands,
        PARALLEL_RUNS,
        async (
          command: Array<string>,
        ): Promise<{ key: string; result: RunResult }> => {
          const key: string = nextKey("sk-packed");
          const result: RunResult = await Smoke.runCli(installation, [
            ...command,
            "--url",
            api.url,
            "--api-key",
            key,
          ]);
          return { key, result };
        },
      );

    for (const [index, command] of commands.entries()) {
      const packedRun: { key: string; result: RunResult } = packedRuns[
        index
      ] as { key: string; result: RunResult };
      const sourceKey: string = nextKey("sk-source");
      const source: SourceRun = await runSources([
        ...command,
        "--url",
        api.url,
        "--api-key",
        sourceKey,
      ]);
      const label: string = command.slice(0, 2).join(" ");

      expect({ label, status: packedRun.result.status }).toEqual({
        label,
        status: 0,
      });
      expect(source.exitCode).toBeUndefined();
      expect({ label, asked: asked(requestsWithKey(packedRun.key)) }).toEqual({
        label,
        asked: asked(requestsWithKey(sourceKey)),
      });
      expect(requestsWithKey(packedRun.key)).toHaveLength(1);
      expect({ label, printed: packedRun.result.stdout }).toEqual({
        label,
        printed: `${source.printed.join("\n")}\n`,
      });
    }
  }, 600000);

  it("sends what the sources send to read, create, change and delete a record, and to create telemetry", async () => {
    const recordFile: string = path.join(installation.work, "monitor.json");
    fs.writeFileSync(
      recordFile,
      JSON.stringify({ name: "API Health", description: "From a file" }),
    );

    const commands: Array<Array<string>> = [
      ["incident", "get", RECORD_ID, "--output", "json"],
      [
        "incident",
        "create",
        "--data",
        '{"title":"Checkout is slow","projectId":"6b5a3b8e-0000-4000-8000-000000000001"}',
        "--output",
        "json",
      ],
      ["monitor", "create", "--file", recordFile, "--output", "json"],
      [
        "incident",
        "update",
        RECORD_ID,
        "--data",
        '{"title":"Checkout is fast again"}',
        "--output",
        "json",
      ],
      ["incident", "delete", RECORD_ID, "--force"],
      [
        "incident",
        "list",
        "--query",
        '{"title":"Checkout is slow"}',
        "--sort",
        '{"createdAt":-1}',
        "--skip",
        "10",
        "--output",
        "json",
      ],
      [
        "log",
        "create",
        "--data",
        '{"body":"A log line","severityText":"Info"}',
        "--output",
        "json",
      ],
    ];

    for (const command of commands) {
      const packedKey: string = nextKey("sk-packed");
      const sourceKey: string = nextKey("sk-source");
      const packedResult: RunResult = await Smoke.runCli(installation, [
        ...command,
        "--url",
        api.url,
        "--api-key",
        packedKey,
      ]);
      const source: SourceRun = await runSources([
        ...command,
        "--url",
        api.url,
        "--api-key",
        sourceKey,
      ]);
      const label: string = command.slice(0, 2).join(" ");

      expect({ label, status: packedResult.status }).toEqual({
        label,
        status: 0,
      });
      expect(requestsWithKey(packedKey)).toHaveLength(1);
      expect({ label, asked: asked(requestsWithKey(packedKey)) }).toEqual({
        label,
        asked: asked(requestsWithKey(sourceKey)),
      });
      expect({ label, printed: packedResult.stdout }).toEqual({
        label,
        printed: `${source.printed.join("\n")}\n`,
      });
    }
  }, 300000);

  it("exits as the sources do, with the API's reason, when the API refuses", async () => {
    for (const [prefix, exitCode] of [
      ["sk-refused", 2],
      ["sk-missing", 3],
      ["sk-broken", 1],
    ] as Array<[string, number]>) {
      const packedResult: RunResult = await Smoke.runCli(installation, [
        "incident",
        "list",
        "--url",
        api.url,
        "--api-key",
        nextKey(prefix),
      ]);
      const source: SourceRun = await runSources([
        "incident",
        "list",
        "--url",
        api.url,
        "--api-key",
        nextKey(prefix),
      ]);

      expect({ prefix, status: packedResult.status }).toEqual({
        prefix,
        status: exitCode,
      });
      expect(source.exitCode).toBe(exitCode);
      expect(packedResult.stdout).toBe("");
      expect(packedResult.stderr).toBe(`${source.errors.join("\n")}\n`);
    }
  }, 120000);

  it("keeps its contexts in the HOME it runs with, readable by its owner only", async () => {
    const login: RunResult = await Smoke.runCli(installation, [
      "login",
      "sk-context-key-0123456789",
      "https://staging.oneuptime.example.com",
      "--context-name",
      "staging",
    ]);

    expect(login.status).toBe(0);

    const config: string = path.join(
      installation.home,
      ".oneuptime",
      "config.json",
    );
    const saved: {
      currentContext: string;
      contexts: Record<string, { apiUrl: string; apiKey: string }>;
    } = JSON.parse(fs.readFileSync(config, "utf-8")) as {
      currentContext: string;
      contexts: Record<string, { apiUrl: string; apiKey: string }>;
    };

    expect(saved.contexts["staging"]).toEqual({
      name: "staging",
      apiUrl: "https://staging.oneuptime.example.com",
      apiKey: "sk-context-key-0123456789",
    });
    expect(fs.statSync(config).mode & 0o077).toBe(0);

    const list: RunResult = await Smoke.runCli(installation, [
      "context",
      "list",
      "--output",
      "json",
    ]);

    expect(list.status).toBe(0);
    expect(list.stdout).toContain("staging");
  });
});

describe("Scripts/SmokeTestPackage.js", () => {
  it("passes on the packed tarball from its command line", async () => {
    const written: Array<string> = [];
    const write: jest.SpyInstance = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });

    let code: number;

    try {
      code = await Smoke.main(["--tarball", packed.tarball]);
    } finally {
      write.mockRestore();
    }

    expect(code).toBe(0);
    expect(written.join("")).toContain("checks passed.");
    expect(written.join("")).not.toContain("FAIL");
  }, 300000);

  it("cleans what npm run passes down out of the environment it runs npm and the CLI with", () => {
    const saved: NodeJS.ProcessEnv = { ...process.env };

    try {
      process.env["npm_config_dry_run"] = "true";
      process.env["NPM_CONFIG_PREFIX"] = "/somewhere/else";
      process.env["NODE_PATH"] = "/monorepo/node_modules";
      process.env["NODE_OPTIONS"] = "--require /monorepo/hook.js";
      process.env["ONEUPTIME_API_KEY"] = "sk-from-the-environment";
      process.env["ONEUPTIME_URL"] = "https://elsewhere.example.com";

      const environment: Record<string, string | undefined> =
        Smoke.cleanEnvironment({ HOME: "/tmp/home" });

      for (const name of [
        "npm_config_dry_run",
        "NPM_CONFIG_PREFIX",
        "NODE_PATH",
        "NODE_OPTIONS",
        "ONEUPTIME_API_KEY",
        "ONEUPTIME_URL",
      ]) {
        expect(environment[name]).toBeUndefined();
      }

      expect(environment["HOME"]).toBe("/tmp/home");
      expect(environment["PATH"]).toBe(process.env["PATH"]);
    } finally {
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) {
          delete process.env[name];
        }
      }

      Object.assign(process.env, saved);
    }
  });

  it("reads npm pack's JSON past anything a script printed first", () => {
    const json: string = JSON.stringify([{ filename: "a.tgz" }], null, 2);

    expect(Smoke.readPackJson(json)).toEqual([{ filename: "a.tgz" }]);
    expect(
      Smoke.readPackJson(`> prepack\n[built] in 2 [steps]\n${json}\n`),
    ).toEqual([{ filename: "a.tgz" }]);
    expect(() => {
      return Smoke.readPackJson("npm notice nothing to see");
    }).toThrow("npm pack printed no JSON");
  });
});

describe("THIRD-PARTY-LICENSES.txt", () => {
  let licenses: string;
  let built: Array<BundledPackage>;
  let outputDirectory: string;

  beforeAll(async () => {
    licenses = fs.readFileSync(
      path.join(
        installation.packageDirectory,
        "build",
        "dist",
        BuildConfig.LICENSES_FILE_NAME,
      ),
      "utf-8",
    );
    outputDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-cli-build-"),
    );
    built = (await BuildConfig.build({ outputDirectory })).packages;
  }, 300000);

  afterAll(() => {
    if (outputDirectory) {
      fs.rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("names every third-party package the bundle holds, at its version", () => {
    const listed: Array<string> = [...licenses.matchAll(LICENSE_SECTION)].map(
      (match: RegExpMatchArray): string => {
        return `${match[1]}@${match[2]}`;
      },
    );

    expect(listed.length).toBeGreaterThan(30);
    expect(listed).toEqual(
      built.map((entry: BundledPackage): string => {
        return `${entry.name}@${entry.version}`;
      }),
    );
    // Once each, though the CLI's node_modules and Common's share releases.
    expect(new Set(listed).size).toBe(listed.length);

    for (const name of ["typeorm", "axios", "commander", "chalk"]) {
      expect(
        listed.some((entry: string): boolean => {
          return entry.startsWith(`${name}@`);
        }),
      ).toBe(true);
    }
  });

  it("holds only packages under licenses that allow it, each with its notice", () => {
    const licensesUsed: Array<string> = [
      ...licenses.matchAll(LICENSE_SECTION),
    ].map((match: RegExpMatchArray): string => {
      return match[3] as string;
    });

    expect(licensesUsed.length).toBe(built.length);

    for (const license of licensesUsed) {
      expect(LICENSES_THE_BUNDLE_MAY_HOLD).toContain(license);
    }

    expect(licenses).toContain("Copyright");
  });
});
