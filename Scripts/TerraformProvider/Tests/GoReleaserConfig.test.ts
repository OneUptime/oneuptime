/*
 * The provider's .goreleaser.yml builds the same zips every time it builds
 * the same commit (#11016).
 *
 * The Terraform and OpenTofu registries keep the SHA-256 of each zip they
 * read when a version is published, and `terraform init` holds what GitHub
 * serves to it. A second release run of 14.3.0, 16.0.0, 17.0.0, 17.1.0 and
 * 17.2.0 built each one's tagged commit again, with the same Go and
 * GoReleaser, and uploaded the build over the published one. The files in
 * the zips were the same (OpenTofu's registry kept their h1: hashes, which
 * the zips GitHub serves now still have); the zips were not, because
 * GoReleaser stamped each file in them with when it was built or checked
 * out. So init failed with "checksum list has unexpected SHA-256 hash".
 *
 * With the commit's time on every file instead, a rebuild is the same bytes.
 * The build below needs goreleaser, go and git, as the Terraform Provider
 * Generation workflow installs them (GoReleaser as release.yml does); without
 * them it is skipped, saying so, except in CI, where it fails.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync, SpawnSyncReturns } from "child_process";
import { TerraformProviderGenerator } from "../Core/TerraformProviderGenerator";
import { TerraformProviderConfig } from "../Core/Types";

const TAG: string = "v1.2.3";

let outputDir: string;
let config: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-goreleaser-"));
  const providerConfig: TerraformProviderConfig = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "1.2.3",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new TerraformProviderGenerator(providerConfig).generateBuildScripts();
  config = fs.readFileSync(path.join(outputDir, ".goreleaser.yml"), "utf-8");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

/*
 * A top-level section of the config, `builds:` to the next one: what each
 * check below reads, so a setting in the wrong section does not pass.
 */
function section(name: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `^${name}:\\n((?:[ \\t]+.*\\n|\\n)*)`,
    "m",
  ).exec(`${config}\n`);
  if (!match) {
    throw new Error(`.goreleaser.yml has no ${name}: section`);
  }
  return match[1] || "";
}

describe("the provider's .goreleaser.yml", () => {
  test("stamps the binary with the commit's time, not the build's", () => {
    expect(section("builds")).toContain(
      'mod_timestamp: "{{ .CommitTimestamp }}"',
    );
  });

  test("lists the files beside the binary, each with the commit's time and a fixed mode", () => {
    const archives: string = section("archives");
    const files: Array<string> = [
      ...archives.matchAll(/- src: (\S+)\n\s+info:\n((?:\s+\w+: .*\n)+)/g),
    ].map((match: RegExpMatchArray) => {
      expect(match[2]).toContain('mtime: "{{ .CommitDate }}"');
      expect(match[2]).toContain("mode: 0644");
      return match[1] || "";
    });

    // Nothing else goes in a zip: without `files`, GoReleaser adds every
    // README*, LICENSE* and CHANGELOG* it finds, stamped as they are on disk.
    expect(files).toEqual(["LICENSE", "README.md"]);
    expect(archives.match(/- src:/g)).toHaveLength(2);
  });

  test("puts no build time into the binary, and no checkout path", () => {
    expect(config).not.toMatch(/\{\{\s*\.(Date|Now|Timestamp)\b/);
    expect(section("builds")).toContain("- -trimpath");
  });

  test("still makes the zips, SHA256SUMS, manifest and signature the registries read", () => {
    expect(section("archives")).toContain(
      'name_template: "terraform-provider-oneuptime_{{ .Version }}_{{ .Os }}_{{ .Arch }}"',
    );
    expect(section("checksum")).toContain(
      'name_template: "terraform-provider-oneuptime_{{ .Version }}_SHA256SUMS"',
    );
    expect(section("checksum")).toContain(
      'name_template: "terraform-provider-oneuptime_{{ .Version }}_manifest.json"',
    );
    expect(section("signs")).toContain("artifacts: checksum");
  });
});

function run(
  command: string,
  args: Array<string>,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      ...env,
    },
  });
}

function runOrThrow(
  command: string,
  args: Array<string>,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): string {
  const result: SpawnSyncReturns<string> = run(command, args, cwd, env);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function missingTools(): Array<string> {
  return ["goreleaser", "go", "git"].filter((tool: string) => {
    return run(tool, tool === "go" ? ["version"] : ["--version"], os.tmpdir())
      .error;
  });
}

/*
 * The config for one target, linux_amd64: what makes a zip the same twice
 * does not depend on the target, and one builds in seconds.
 */
function forOneTarget(goreleaserConfig: string): string {
  const oneTarget: string = goreleaserConfig.replace(
    /^ {4}goos:\n(?: {6}- .*\n)+ {4}goarch:\n(?: {6}- .*\n)+ {4}ignore:\n(?: {6}- .*\n| {8}.*\n)+/m,
    "    goos:\n      - linux\n    goarch:\n      - amd64\n",
  );
  if (oneTarget === goreleaserConfig) {
    throw new Error("Could not narrow .goreleaser.yml to one target");
  }
  return oneTarget;
}

/*
 * The config as it was before #11016: no mod_timestamp, no files list.
 */
function asBefore(goreleaserConfig: string): string {
  const before: string = goreleaserConfig
    .replace(/^ {4}# The binary's time.*\n(?: {4}#.*\n)*/m, "")
    .replace(/^ {4}mod_timestamp: .*\n/m, "")
    .replace(/^ {4}# Beside the binary.*\n(?: {4}#.*\n)*/m, "")
    .replace(/^ {4}files:\n(?: {6}.*\n)+/m, "");
  if (before.includes("mod_timestamp") || before.includes("- src:")) {
    throw new Error("Could not take the settings out of .goreleaser.yml");
  }
  return before;
}

/*
 * Builds TAG of a provider repository with this config twice, each from a
 * clone of its own made a few seconds after the other, as a second release
 * run on a fresh runner does. Returns each build's zip and SHA256SUMS, name
 * to SHA-256.
 */
function buildTwice(goreleaserConfig: string): Array<Map<string, string>> {
  const work: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "tfgen-reproducible-"),
  );
  try {
    const origin: string = path.join(work, "origin");
    fs.mkdirSync(origin);
    fs.writeFileSync(
      path.join(origin, "main.go"),
      'package main\n\nimport "fmt"\n\nvar version string = "dev"\n\nfunc main() {\n\tfmt.Println("terraform-provider-oneuptime", version)\n}\n',
    );
    fs.writeFileSync(
      path.join(origin, "go.mod"),
      "module github.com/oneuptime/terraform-provider-oneuptime\n\ngo 1.25.0\n",
    );
    for (const file of ["LICENSE", "terraform-registry-manifest.json"]) {
      fs.copyFileSync(path.join(outputDir, file), path.join(origin, file));
    }
    fs.writeFileSync(
      path.join(origin, "README.md"),
      "# OneUptime Terraform Provider\n",
    );
    fs.writeFileSync(path.join(origin, ".goreleaser.yml"), goreleaserConfig);
    fs.writeFileSync(path.join(origin, ".gitignore"), "dist/\n");
    runOrThrow("git", ["init", "-q", "-b", "master"], origin);
    runOrThrow("git", ["add", "-A"], origin);
    runOrThrow("git", ["commit", "-q", "-m", "provider"], origin);
    runOrThrow("git", ["tag", "-a", TAG, "-m", `Release ${TAG}`], origin);

    return ["a", "b"].map((name: string, index: number) => {
      if (index > 0) {
        // A later checkout: its files' times on disk are later too.
        spawnSync("sleep", ["2"]);
      }
      const clone: string = path.join(work, name);
      runOrThrow("git", ["clone", "-q", origin, clone], work);
      runOrThrow("git", ["checkout", "-q", TAG], clone);
      runOrThrow(
        "goreleaser",
        [
          "release",
          "--clean",
          "--skip=publish,sign",
          "--parallelism",
          "1",
          "--config",
          ".goreleaser.yml",
        ],
        clone,
        { GORELEASER_CURRENT_TAG: TAG },
      );
      const dist: string = path.join(clone, "dist");
      return new Map(
        fs
          .readdirSync(dist)
          .filter((file: string) => {
            return file.endsWith(".zip") || file.endsWith("_SHA256SUMS");
          })
          .sort()
          .map((file: string) => {
            return [
              file,
              crypto
                .createHash("sha256")
                .update(fs.readFileSync(path.join(dist, file)))
                .digest("hex"),
            ];
          }),
      );
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

describe("a provider built twice from the same commit", () => {
  const missing: Array<string> = missingTools();
  const canBuild: boolean = missing.length === 0;
  const buildTest: jest.It = canBuild || process.env["CI"] ? test : test.skip;

  if (!canBuild) {
    // eslint-disable-next-line no-console
    console.warn(
      `GoReleaserConfig: ${missing.join(", ")} not on PATH, so the provider is not built twice here${
        process.env["CI"] ? " (and in CI that fails)" : ""
      }.`,
    );
  }

  buildTest(
    "is the same zips, and the same SHA256SUMS",
    () => {
      expect(missing).toEqual([]);
      const [first, second] = buildTwice(forOneTarget(config));

      expect([...(first?.keys() || [])]).toEqual([
        "terraform-provider-oneuptime_1.2.3_SHA256SUMS",
        "terraform-provider-oneuptime_1.2.3_linux_amd64.zip",
      ]);
      expect(second).toEqual(first);
    },
    240000,
  );

  buildTest(
    "was other zips, and another SHA256SUMS, with the config as it was before #11016",
    () => {
      expect(missing).toEqual([]);
      const [first, second] = buildTwice(asBefore(forOneTarget(config)));

      const zip: string = "terraform-provider-oneuptime_1.2.3_linux_amd64.zip";
      expect(first?.get(zip)).toMatch(/^[0-9a-f]{64}$/);
      expect(second?.get(zip)).not.toBe(first?.get(zip));
      expect(
        second?.get("terraform-provider-oneuptime_1.2.3_SHA256SUMS"),
      ).not.toBe(first?.get("terraform-provider-oneuptime_1.2.3_SHA256SUMS"));
    },
    240000,
  );
});
