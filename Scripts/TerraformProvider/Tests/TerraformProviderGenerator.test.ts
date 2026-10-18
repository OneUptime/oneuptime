/*
 * The provider repository (OneUptime/terraform-provider-oneuptime) is
 * regenerated on every release, so what it carries at its root has to come
 * from the generator. That includes its LICENSE: HashiCorp lists a provider as
 * Partner only when its repository carries an open source license, and the
 * provider's README links to the file.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { TerraformProviderGenerator } from "../Core/TerraformProviderGenerator";
import { TerraformProviderConfig } from "../Core/Types";

/*
 * sha256 of https://www.apache.org/licenses/LICENSE-2.0.txt, the Apache
 * License 2.0 as the Apache Software Foundation publishes it: the text,
 * opening with a blank line. Tests/Ops/RepositoryLicensing.test.js holds the
 * root LICENSE's copy to the same digest.
 */
const APACHE_LICENSE_2_0_SHA256: string =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";

let outputDir: string;
let license: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-root-files-"));
  const config: TerraformProviderConfig = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new TerraformProviderGenerator(config).generateBuildScripts();
  license = fs.readFileSync(path.join(outputDir, "LICENSE"), "utf-8");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the provider's LICENSE", () => {
  test("is the Apache License 2.0, complete and unmodified", () => {
    const digest: string = crypto
      .createHash("sha256")
      .update(`\n${license}`, "utf8")
      .digest("hex");

    expect(digest).toBe(APACHE_LICENSE_2_0_SHA256);
  });

  /*
   * GitHub, and with it the registries, name a license only from the license
   * text alone: with the root LICENSE's preamble in front, the provider's
   * would read as "Other", as the root LICENSE's does.
   */
  test("opens with the license's heading, without the root LICENSE's preamble", () => {
    expect(license.split("\n")[0]?.trim()).toBe("Apache License");
    expect(license).not.toContain("HackerBay");
    expect(license).not.toContain("ee/");
  });

  test("ends with the license's last line and one newline", () => {
    expect(license.endsWith("   limitations under the License.\n")).toBe(true);
  });
});
