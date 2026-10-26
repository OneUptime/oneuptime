import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const SCRIPT: string = path.join(
  REPO_ROOT,
  "Scripts/NPM/PublishAllPackages.sh",
);
const SOURCE: string = fs.readFileSync(SCRIPT, "utf8");

const COMMON: string = "packages/Common";
const RECORDER: string = "packages/App/FeatureSet/MobileRecorder";
const CLI: string = "packages/CLI";

/*
 * What npm publishes as @oneuptime/common: the package Common's
 * build-npm-package script writes, not packages/Common itself, whose
 * manifest is the one every package of the repository links as
 * node_modules/Common.
 */
const COMMON_PACKAGE: string = "build/npm/package";

// Every `publish_to_npm "<package>"` call, with the directory it publishes.
const PUBLISH_CALL: RegExp = /^publish_to_npm "([^"\n]+)"(?: "([^"\n]+)")?$/gm;

interface PublishCall {
  directory: string;
  publishes: string | undefined;
}

function publishToNpmCalls(): Array<PublishCall> {
  return [...SOURCE.matchAll(PUBLISH_CALL)].map(
    (match: RegExpMatchArray): PublishCall => {
      return { directory: match[1] as string, publishes: match[2] };
    },
  );
}

// The script's command lines: comments and blank lines left out.
const COMMAND_LINES: Array<string> = SOURCE.split("\n").filter(
  (line: string): boolean => {
    const trimmed: string = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  },
);

// The body of publish_to_npm, from its first line to the call after it.
const PUBLISH_FUNCTION: string = SOURCE.slice(
  SOURCE.indexOf("publish_to_npm()"),
  SOURCE.indexOf("# Publish Common first"),
);

// A shell loop, in any of its forms.
const LOOP_KEYWORD: RegExp = /^\s*(?:until|while|for)\s/;

// sleep, anywhere on a command line.
const SLEEP_COMMAND: RegExp = /\bsleep\b/u;

// sed run as a command, as in `sed -i ...` or `... && sed -i ...`.
const SED_COMMAND: RegExp = /(?:^|[\s;&|(])sed\s/;

// npm's ignore-scripts, as a flag, a config key or an environment variable.
const IGNORE_SCRIPTS: RegExp = /ignore[-_]scripts/i;

/*
 * A command that rewrites a package's Common dependency, as the two `sed -i`
 * lines #4872 removed did: they swapped the CLI's link to ../Common for
 * npm:@oneuptime/common@<version>. Other sed edits stay allowed.
 */
function rewritesCommonLink(line: string): boolean {
  return (
    line.includes("npm:@oneuptime/common") ||
    (SED_COMMAND.test(line) && line.includes("Common"))
  );
}

/*
 * The script run for real, with npm and sleep replaced by fakes on PATH that
 * write down every call - the directory it ran in (relative to the
 * repository) and its arguments - so a run publishes nothing and touches no
 * file. The fake `npm view` answers as the registry would: the version, for
 * a package@version listed in FAKE_NPM_PUBLISHED, and a 404 otherwise. Node
 * is the real one: the script reads each package's name from its
 * package.json.
 */
interface ReleaseCall {
  directory: string;
  command: string;
}

interface ReleaseRun {
  status: number | null;
  output: string;
  calls: Array<ReleaseCall>;
}

const VERSION: string = "9.9.9";

let fakeBin: string = "";

beforeAll(() => {
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "publish-all-packages-"));

  fs.writeFileSync(
    path.join(fakeBin, "npm"),
    [
      "#!/usr/bin/env bash",
      'here="${PWD#"$FAKE_REPO_ROOT"}"',
      'here="${here#/}"',
      'printf "%s\\t%s\\n" "${here:-.}" "npm $*" >>"$FAKE_CALL_LOG"',
      'if [ "$1" = "view" ]; then',
      "  for published in ${FAKE_NPM_PUBLISHED:-}; do",
      '    for argument in "$@"; do',
      '      if [ "$argument" = "$published" ]; then',
      '        echo "${published##*@}"',
      "        exit 0",
      "      fi",
      "    done",
      "  done",
      '  echo "npm error code E404" >&2',
      "  exit 1",
      "fi",
      'if [ -n "${FAKE_NPM_FAIL:-}" ] && [ "${here:-.}: npm $*" = "$FAKE_NPM_FAIL" ]; then',
      '  echo "npm error (fake) $*" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  fs.writeFileSync(
    path.join(fakeBin, "sleep"),
    [
      "#!/usr/bin/env bash",
      'printf "%s\\t%s\\n" "." "sleep $*" >>"$FAKE_CALL_LOG"',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterAll(() => {
  if (fakeBin) {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});

function runRelease(options: {
  published?: Array<string>;
  fail?: string;
  version?: string;
}): ReleaseRun {
  const log: string = path.join(fakeBin, `calls-${process.hrtime.bigint()}`);
  fs.writeFileSync(log, "");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakeBin}${path.delimiter}${process.env["PATH"] || ""}`,
    PACKAGE_VERSION: options.version === undefined ? VERSION : options.version,
    FAKE_REPO_ROOT: REPO_ROOT,
    FAKE_CALL_LOG: log,
    FAKE_NPM_PUBLISHED: (options.published || []).join(" "),
    FAKE_NPM_FAIL: options.fail || "",
  };

  const result: SpawnSyncReturns<string> = spawnSync("bash", [SCRIPT], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    // A wait loop that came back would spin on the fake sleep; stop it.
    timeout: 60000,
  });

  const calls: Array<ReleaseCall> = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .map((line: string): ReleaseCall => {
      const [directory, command] = line.split("\t") as [string, string];
      return { directory, command };
    });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls,
  };
}

// "<directory>: <command>", the way the assertions below read best.
function callLines(run: ReleaseRun): Array<string> {
  return run.calls.map((call: ReleaseCall): string => {
    return `${call.directory}: ${call.command}`;
  });
}

function publishCalls(run: ReleaseRun): Array<string> {
  return run.calls
    .filter((call: ReleaseCall): boolean => {
      return call.command.startsWith("npm publish");
    })
    .map((call: ReleaseCall): string => {
      return call.directory;
    });
}

describe("PublishAllPackages", () => {
  it("publishes Common, then the React Native recorder, then the CLI", () => {
    const commonPublish: number = SOURCE.indexOf(`publish_to_npm "${COMMON}"`);
    const recorderPublish: number = SOURCE.indexOf(
      `publish_to_npm "${RECORDER}"`,
    );
    const cliPublish: number = SOURCE.indexOf(`publish_to_npm "${CLI}"`);

    expect(commonPublish).toBeGreaterThan(-1);
    expect(recorderPublish).toBeGreaterThan(commonPublish);
    expect(cliPublish).toBeGreaterThan(recorderPublish);
  });

  /*
   * The release used to poll `npm view @oneuptime/common@<version>` every 10
   * seconds, for up to 90 minutes, between Common's publish and the next
   * one, so that packages installing @oneuptime/common found it. Since #4872
   * none does (see "publishes no package that needs Common when it runs"),
   * so the poll only kept the order, which holds without it - and it held a
   * runner, and the release's e2e jobs, for as long as npm took to make a
   * 181 MB package readable: 8.6, 13.6 and 19.7 minutes in 14.0.61, 14.0.63
   * and 14.0.65, and 55 minutes in 14.0.7.
   */
  it("does not wait for Common to appear on the registry before publishing the rest", () => {
    // No loop and no sleep anywhere in the script.
    expect(
      COMMAND_LINES.filter((line: string): boolean => {
        return LOOP_KEYWORD.test(line) || SLEEP_COMMAND.test(line);
      }),
    ).toEqual([]);
    expect(SOURCE).not.toContain("max_attempts");

    // The only registry read is publish_to_npm's own already-published check.
    const registryReads: Array<string> = COMMAND_LINES.filter(
      (line: string): boolean => {
        return line.includes("npm view");
      },
    );

    expect(registryReads).toHaveLength(1);
    expect(PUBLISH_FUNCTION).toContain(registryReads[0] as string);
  });

  /*
   * A re-run after a partial failure skips what is already published. The
   * check asks the registry itself: registry.npmjs.org serves packuments
   * with max-age=300 and npm answers from its own cache until that expires,
   * so without --prefer-online the check can read a document cached earlier
   * in the job that predates the version - the stale read that, in a poll
   * this script no longer has, failed 13.0.7's release.
   */
  it("asks the registry, not npm's cache, whether a version is already published", () => {
    const check: string | undefined = COMMAND_LINES.find(
      (line: string): boolean => {
        return line.includes("npm view");
      },
    );

    expect(check).toBeDefined();
    expect(check).toContain(
      'npm view --prefer-online "$npm_package_name@$package_version" version',
    );
    expect(check!.trim().startsWith("if ")).toBe(true);
  });

  /*
   * The dependent packages type-check packages/Common's real sources through
   * the node_modules/Common link their lockfiles pin, so that directory needs
   * its own dependencies installed. publish_to_npm does that only as a side
   * effect of publishing and returns early when the version is already on
   * npm — which is what happens on a re-run after a partial failure. The
   * 13.0.7 retry skipped Common's publish and @oneuptime/cli then failed with
   * "Cannot find module 'typeorm'" against ../Common.
   */
  it("installs Common's dependencies before the dependent packages build", () => {
    const commonInstall: number = SOURCE.indexOf(
      "(cd packages/Common && npm install)",
    );
    const mobilePublish: number = SOURCE.indexOf(
      'publish_to_npm "packages/App/FeatureSet/MobileRecorder"',
    );
    const cliPublish: number = SOURCE.indexOf('publish_to_npm "packages/CLI"');

    expect(commonInstall).toBeGreaterThan(-1);
    expect(mobilePublish).toBeGreaterThan(commonInstall);
    expect(cliPublish).toBeGreaterThan(commonInstall);
  });

  /*
   * #4872: the CLI was published depending on @oneuptime/common, which
   * cannot answer its require("Common/...") calls (TypeScript at those
   * paths, ES modules under build/dist), so every published CLI died at
   * start. A package published here carries what it runs: the CLI bundles
   * Common when npm packs it.
   */
  it("publishes no package that needs Common when it runs", () => {
    const published: Array<string> = publishToNpmCalls().map(
      (call: PublishCall): string => {
        return call.directory;
      },
    );

    expect(published).toEqual([
      "packages/Common",
      "packages/App/FeatureSet/MobileRecorder",
      "packages/CLI",
    ]);

    for (const directory of published.slice(1)) {
      const manifest: Record<string, Record<string, string> | undefined> =
        JSON.parse(
          fs.readFileSync(
            path.join(REPO_ROOT, directory, "package.json"),
            "utf8",
          ),
        ) as Record<string, Record<string, string> | undefined>;

      for (const field of [
        "dependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        const declared: Record<string, string> = manifest[field] || {};

        expect({ directory, field, Common: declared["Common"] }).toEqual({
          directory,
          field,
          Common: undefined,
        });
        expect(Object.keys(declared)).not.toContain("@oneuptime/common");
      }
    }
  });

  /*
   * The CLI's lockfile links ../Common, and its bundle is built from that
   * link: this checkout's Common with its locked dependencies, the code CI
   * tested. Rewriting the link to npm:@oneuptime/common made npm swap in a
   * registry copy with freshly resolved dependencies.
   */
  it("leaves each package's Common link as its lockfile pins it", () => {
    const commands: Array<string> = SOURCE.split("\n").filter(
      (line: string): boolean => {
        return !line.trim().startsWith("#");
      },
    );

    expect(commands.filter(rewritesCommonLink)).toEqual([]);
  });

  it("knows the rewrite this script used to make, and lets other edits be", () => {
    // The two lines #4872 removed, as they were.
    expect(
      rewritesCommonLink(
        'sed -i "s/\\"Common\\": \\"file:..\\/Common\\"/\\"Common\\": \\"npm:@oneuptime\\/common@$package_version\\"/g" package.json',
      ),
    ).toBe(true);
    expect(
      rewritesCommonLink(
        'sed -i "s/\\"Common\\": \\"npm:@oneuptime\\/common@latest\\"/\\"Common\\": \\"npm:@oneuptime\\/common@$package_version\\"/g" package.json',
      ),
    ).toBe(true);
    // Either half alone is enough.
    expect(
      rewritesCommonLink(
        "npm pkg set dependencies.Common=npm:@oneuptime/common@1.0.0",
      ),
    ).toBe(true);
    expect(rewritesCommonLink("sed -i 's/Common/x/' package.json")).toBe(true);
    // The release may still use sed for anything else.
    expect(rewritesCommonLink('sed -i "s/beta/stable/" CHANGELOG.md')).toBe(
      false,
    );
    expect(rewritesCommonLink('publish_to_npm "packages/Common"')).toBe(false);
  });

  /*
   * What npm published from packages/Common could not be loaded: its main,
   * index.js, did not exist, its paths held TypeScript, and its JavaScript
   * was ES modules Node.js cannot resolve. packages/Common/package.json
   * cannot be the npm package's manifest either - it is the one every
   * package of the repository links as node_modules/Common, and an exports
   * map there would redirect every require("Common/...") (#4877, #4900). So
   * Common publishes the package its build-npm-package script writes, and
   * only Common does.
   */
  it("publishes Common from the package its npm build writes, and every other package from its own directory", () => {
    expect(publishToNpmCalls()).toEqual([
      { directory: COMMON, publishes: COMMON_PACKAGE },
      { directory: RECORDER, publishes: undefined },
      { directory: CLI, publishes: undefined },
    ]);

    /*
     * The script that builds it (Common's Tests/Scripts/NpmPackage suites
     * hold it to writing exactly this directory).
     */
    const common: { scripts: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, COMMON, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(common.scripts["build-npm-package"]).toBe(
      "node --max-old-space-size=8192 Scripts/NpmPackage/BuildNpmPackage.js",
    );
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, COMMON, "Scripts/NpmPackage/BuildNpmPackage.js"),
      ),
    ).toBe(true);

    // The build's output is never committed.
    expect(
      fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8").split("\n"),
    ).toContain(`${COMMON}/build/npm/`);
  });

  /*
   * The CLI's prepack script builds the bundle npm publishes, and
   * --ignore-scripts would skip it: the package would ship without the file
   * its bin points at.
   */
  it("lets npm run the pack scripts that build what each package publishes", () => {
    const publishLines: Array<string> = SOURCE.split("\n").filter(
      (line: string): boolean => {
        return line.trim().startsWith("npm publish");
      },
    );

    expect(publishLines).toEqual([
      "            npm publish --access public",
      '            npm publish "./$built_package_directory" --access public',
    ]);
    // Neither the flag nor npm config (ignore-scripts, npm_config_ignore_scripts), on any command line.
    expect(
      SOURCE.split("\n").filter((line: string): boolean => {
        return !line.trim().startsWith("#") && IGNORE_SCRIPTS.test(line);
      }),
    ).toEqual([]);

    const cli: {
      scripts: Record<string, string>;
      bin: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "packages/CLI/package.json"),
        "utf8",
      ),
    ) as { scripts: Record<string, string>; bin: Record<string, string> };

    expect(cli.scripts["prepack"]).toBe("npm run build");
    expect(cli.scripts["build"]).toBe("node esbuild.config.js");
    expect(cli.bin["oneuptime"]).toBe("build/dist/Index.js");
  });

  it("isolates each nested package publish so the next path starts at the repo root", () => {
    const functionBody: string = SOURCE.slice(
      SOURCE.indexOf("publish_to_npm()"),
      SOURCE.indexOf("# Publish Common first"),
    );

    expect(functionBody).toContain('(\n        cd "$directory_name"');
    expect(functionBody).not.toMatch(/^\s*cd \.\.\s*$/mu);
  });

  it("compiles and tests the package in CI from its own dependencies alone", () => {
    const compileWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/compile.yml"),
      "utf8",
    );
    const testWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/test.mobile-recorder.yaml"),
      "utf8",
    );

    /*
     * Each workflow installs the package's own dependencies first - a step of
     * its own, through ./.github/actions/npm-install, which retries a network
     * failure - and then compiles, or tests, the package. In the Compile
     * workflow that is compile-recorders, the job for the SDKs published to
     * npm, which installs neither Common nor App: the package customers
     * install must build without either.
     */
    const install: RegExp =
      /uses: \.\/\.github\/actions\/npm-install\s+with:\s+working-directory: packages\/App\/FeatureSet\/MobileRecorder\s/;
    const compileCommand: string =
      "cd packages/App/FeatureSet/MobileRecorder && npm run compile && npm run build";
    const compileAt: number = compileWorkflow.indexOf(compileCommand);

    // The job the compile belongs to: from its key line to the next job's.
    const jobKeys: Array<RegExpMatchArray> = [
      ...compileWorkflow.matchAll(/\n {2}([A-Za-z0-9_-]+):\n/g),
    ];
    const owner: RegExpMatchArray | undefined = jobKeys
      .filter((key: RegExpMatchArray) => {
        return (key.index as number) < compileAt;
      })
      .pop();
    const next: RegExpMatchArray | undefined = jobKeys.find(
      (key: RegExpMatchArray) => {
        return (key.index as number) > compileAt;
      },
    );

    expect(compileAt).toBeGreaterThan(-1);
    expect(owner?.[1]).toBe("compile-recorders");

    const compileJob: string = compileWorkflow.slice(
      (owner?.index as number) + 1,
      next ? (next.index as number) + 1 : undefined,
    );

    expect(compileJob.search(install)).toBeGreaterThan(-1);
    expect(compileJob.indexOf(compileCommand)).toBeGreaterThan(
      compileJob.search(install),
    );
    expect(compileJob).not.toMatch(/working-directory: packages\/Common\s/);
    expect(compileJob).not.toMatch(/working-directory: packages\/App\s/);

    const test: number = testWorkflow.indexOf(
      "cd packages/App/FeatureSet/MobileRecorder && npm run test",
    );

    expect(testWorkflow).toContain("name: Mobile Recorder Test");
    expect(testWorkflow.search(install)).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(testWorkflow.search(install));
  });

  it("builds generated distribution files as part of npm packing", () => {
    const packageJson: {
      files: Array<string>;
      scripts: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/MobileRecorder/package.json",
        ),
        "utf8",
      ),
    ) as {
      files: Array<string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("android");
    expect(packageJson.files).toContain("ios");
    expect(packageJson.files).toContain("OneUptimeReactNativeReplay.podspec");
    expect(packageJson.scripts["prepack"]).toBe("npm run build");
  });
});

describe("PublishAllPackages, run with a fake npm", () => {
  // What publish_to_npm runs for a package that is not on the registry yet.
  function publishes(directory: string, name: string): Array<string> {
    return [
      `.: npm view --prefer-online ${name}@${VERSION} version`,
      `${directory}: npm version --allow-same-version ${VERSION}`,
      `${directory}: npm install`,
      `${directory}: npm run compile`,
      `${directory}: npm publish --access public`,
    ];
  }

  // What it runs for Common: it builds the npm package, and publishes that.
  function publishesCommon(): Array<string> {
    return [
      `.: npm view --prefer-online @oneuptime/common@${VERSION} version`,
      `${COMMON}: npm version --allow-same-version ${VERSION}`,
      `${COMMON}: npm install`,
      `${COMMON}: npm run build-npm-package`,
      `${COMMON}: npm publish ./${COMMON_PACKAGE} --access public`,
    ];
  }

  const COMMON_PUBLISH: string = `${COMMON}: npm publish ./${COMMON_PACKAGE} --access public`;

  // What it runs for one that is.
  function skips(name: string): Array<string> {
    return [`.: npm view --prefer-online ${name}@${VERSION} version`];
  }

  const COMMON_INSTALL: string = `${COMMON}: npm install`;

  it("publishes Common, the recorder and the CLI one straight after another, polling and sleeping for nothing", () => {
    const run: ReleaseRun = runRelease({});

    expect(run.status).toBe(0);
    expect(callLines(run)).toEqual([
      ...publishesCommon(),
      // Common's dependencies, for the dependents' builds (see below).
      COMMON_INSTALL,
      ...publishes(RECORDER, "@oneuptime/react-native-replay"),
      ...publishes(CLI, "@oneuptime/cli"),
    ]);
    // Common was asked about once: by its own already-published check.
    expect(
      callLines(run).filter((line: string): boolean => {
        return line.includes("@oneuptime/common@");
      }),
    ).toHaveLength(1);
  });

  /*
   * 13.0.7's re-run: Common was already on the registry, so its publish
   * (and the install that came with it) was skipped, and the CLI then failed
   * with "Cannot find module 'typeorm'" against ../Common.
   */
  it("on a re-run after Common was published, installs Common's dependencies anyway and publishes the rest", () => {
    const run: ReleaseRun = runRelease({
      published: [`@oneuptime/common@${VERSION}`],
    });

    expect(run.status).toBe(0);
    expect(callLines(run)).toEqual([
      ...skips("@oneuptime/common"),
      COMMON_INSTALL,
      ...publishes(RECORDER, "@oneuptime/react-native-replay"),
      ...publishes(CLI, "@oneuptime/cli"),
    ]);
    expect(run.output).toContain(
      `@oneuptime/common@${VERSION} is already published on npm. Skipping.`,
    );
  });

  it("on a re-run with only the CLI left, publishes the CLI alone", () => {
    const run: ReleaseRun = runRelease({
      published: [
        `@oneuptime/common@${VERSION}`,
        `@oneuptime/react-native-replay@${VERSION}`,
      ],
    });

    expect(run.status).toBe(0);
    expect(publishCalls(run)).toEqual([CLI]);
    expect(callLines(run)).toEqual([
      ...skips("@oneuptime/common"),
      COMMON_INSTALL,
      ...skips("@oneuptime/react-native-replay"),
      ...publishes(CLI, "@oneuptime/cli"),
    ]);
  });

  it("on a re-run with everything published, publishes nothing and succeeds", () => {
    const run: ReleaseRun = runRelease({
      published: [
        `@oneuptime/common@${VERSION}`,
        `@oneuptime/react-native-replay@${VERSION}`,
        `@oneuptime/cli@${VERSION}`,
      ],
    });

    expect(run.status).toBe(0);
    expect(publishCalls(run)).toEqual([]);
    expect(callLines(run)).toEqual([
      ...skips("@oneuptime/common"),
      COMMON_INSTALL,
      ...skips("@oneuptime/react-native-replay"),
      ...skips("@oneuptime/cli"),
    ]);
  });

  it("another version of a package on the registry does not count as published", () => {
    const run: ReleaseRun = runRelease({
      published: ["@oneuptime/common@9.9.8", "@oneuptime/cli@9.9.8"],
    });

    expect(run.status).toBe(0);
    expect(publishCalls(run)).toEqual([COMMON, RECORDER, CLI]);
  });

  it("stops at a failed publish of Common, before anything else is published", () => {
    const run: ReleaseRun = runRelease({
      fail: COMMON_PUBLISH,
    });

    expect(run.status).not.toBe(0);
    expect(callLines(run)).toEqual(publishesCommon());
  });

  /*
   * The build refuses to write a package that does not compile, or that
   * names a file or a package it lacks. Then nothing is published: not
   * Common, which has nothing right to publish, and not what comes after it.
   */
  it("stops when Common's npm package does not build, before anything is published", () => {
    const run: ReleaseRun = runRelease({
      fail: `${COMMON}: npm run build-npm-package`,
    });

    expect(run.status).not.toBe(0);
    expect(publishCalls(run)).toEqual([]);
    expect(callLines(run)).toEqual(publishesCommon().slice(0, -1));
  });

  it("builds Common's npm package in place of compiling Common, and never publishes packages/Common itself", () => {
    const run: ReleaseRun = runRelease({});
    const common: Array<string> = callLines(run).filter((line: string) => {
      return line.startsWith(`${COMMON}: `);
    });

    expect(run.status).toBe(0);
    expect(common).toContain(`${COMMON}: npm run build-npm-package`);
    expect(common).not.toContain(`${COMMON}: npm run compile`);
    expect(common).not.toContain(`${COMMON}: npm publish --access public`);
    expect(common.indexOf(`${COMMON}: npm run build-npm-package`)).toBeLessThan(
      common.indexOf(COMMON_PUBLISH),
    );
    // The recorder and the CLI still compile, and publish their own directory.
    for (const directory of [RECORDER, CLI]) {
      expect(callLines(run)).toContain(`${directory}: npm run compile`);
      expect(callLines(run)).toContain(
        `${directory}: npm publish --access public`,
      );
      expect(callLines(run)).not.toContain(
        `${directory}: npm run build-npm-package`,
      );
    }
  });

  it("stops at a failed publish of the recorder, before the CLI is published", () => {
    const run: ReleaseRun = runRelease({
      fail: `${RECORDER}: npm publish --access public`,
    });

    expect(run.status).not.toBe(0);
    expect(publishCalls(run)).toEqual([COMMON, RECORDER]);
    expect(callLines(run).pop()).toBe(
      `${RECORDER}: npm publish --access public`,
    );
  });

  it("stops when Common's dependencies do not install, before the dependents build", () => {
    const run: ReleaseRun = runRelease({
      published: [`@oneuptime/common@${VERSION}`],
      fail: COMMON_INSTALL,
    });

    expect(run.status).not.toBe(0);
    expect(callLines(run)).toEqual([
      ...skips("@oneuptime/common"),
      COMMON_INSTALL,
    ]);
  });

  it("refuses to run without a version, before asking npm anything", () => {
    const run: ReleaseRun = runRelease({ version: "" });

    expect(run.status).toBe(1);
    expect(run.output).toContain("Package version is required");
    expect(run.calls).toEqual([]);
  });
});
