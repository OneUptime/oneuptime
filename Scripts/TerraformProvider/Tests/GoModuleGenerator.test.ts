/*
 * go.mod's versions are floors for `go get -u`, but they are also what the
 * provider is built from when that upgrade fails - and GenerateProvider.ts
 * carries on when it does. On 2026-10-09 the checksum database had not yet
 * caught up with a golang.org/x/net release, the upgrade failed, and the
 * provider built from terraform-plugin-framework v1.13.0 planned to destroy
 * and re-create monitors, probes and alerts on every update.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { GoModuleGenerator } from "../Core/GoModuleGenerator";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { TerraformProviderConfig } from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

let outputDir: string;
let goMod: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-gomod-"));
  const config: TerraformProviderConfig = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "11.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new GoModuleGenerator(config).generateModule();
  await new ResourceGenerator(config, buildFixtureSpec()).generateResources();
  goMod = fs.readFileSync(path.join(outputDir, "go.mod"), "utf-8");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

// Hoisted: wrap-regex and prettier disagree about `/.../.exec(`.
const VERSION: RegExp = /v(\d+)\.(\d+)\.(\d+)/;

// The version go.mod requires of a module, as [major, minor, patch].
function requiredVersion(module: string): Array<number> {
  const line: string | undefined = goMod.split("\n").find((text: string) => {
    return text.trim().startsWith(`${module} `);
  });
  const version: RegExpExecArray | null = VERSION.exec(line || "");
  if (!version) {
    throw new Error(`go.mod does not require ${module}:\n${goMod}`);
  }
  return [Number(version[1]), Number(version[2]), Number(version[3])];
}

function isAtLeast(version: Array<number>, minimum: Array<number>): boolean {
  for (let part: number = 0; part < minimum.length; part++) {
    if (version[part] !== minimum[part]) {
      return (version[part] as number) > (minimum[part] as number);
    }
  }
  return true;
}

describe("go.mod", () => {
  test("requires a terraform-plugin-framework whose UseStateForUnknown keeps a null prior value (v1.15.1+)", () => {
    /*
     * The generated schemas give create-only fields the server returns
     * UseStateForUnknown then RequiresReplace. Before v1.15.1 an unset one
     * plans as unknown on every update, and RequiresReplace replaces the
     * resource for it.
     */
    expect(
      isAtLeast(
        requiredVersion("github.com/hashicorp/terraform-plugin-framework"),
        [1, 15, 1],
      ),
    ).toBe(true);
  });
});

describe("the update plan test", () => {
  test("is copied into the generated provider", () => {
    /*
     * It is the test that fails on a provider built from floors too old for
     * the schemas. Without the copy, `go test` passes on a tree that no
     * longer checks it.
     */
    const copied: string = path.join(
      outputDir,
      "internal/provider",
      "provider_update_plan_test.go",
    );
    expect(fs.existsSync(copied)).toBe(true);
    expect(fs.readFileSync(copied, "utf-8")).toContain(
      "func TestUpdatePlansReplaceOnlyWhatChanged(",
    );
  });
});
