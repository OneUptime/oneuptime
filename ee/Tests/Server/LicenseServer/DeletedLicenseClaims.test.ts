import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import { DELETE_CONSEQUENCES } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
// Not typeorm itself: ee's type-check cannot resolve Common's dependencies.
import {
  ModelRelation,
  modelRelations,
} from "Common/Tests/Helpers/ModelRelations";

/*
 * What deleting a license does to the customer's installations, as every
 * Delete of one says it - a row's ⋯, Bulk Actions, the license's own page
 * (DeleteConsequences, EnterpriseLicense) - held to the code that makes each
 * part of the sentence true:
 *
 *   "Deleting a license also deletes its instances. Installations that
 *    use its key keep the license they already hold until it expires, but
 *    can no longer refresh or reactivate it, and their seat reports are
 *    refused."
 *
 *   - the instances go with it: EnterpriseLicenseInstance's relation to the
 *     license is ON DELETE CASCADE;
 *   - nothing is switched off: an installation holds a license that carries
 *     its own expiry (the signed token's exp is the license's expiresAt), and
 *     a refused daily report, refresh or activation stores nothing over it;
 *   - the key is refused: /validate (activation and Refresh license) and
 *     /report-user-count both answer "License key is invalid" for a key no
 *     license has.
 *
 * The behaviour itself is exercised in the suites named below; this one
 * fails the moment the code stops matching the sentence.
 */

const EE_ROOT: string = path.resolve(__dirname, "../../..");

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(EE_ROOT, relativePath), "utf8");
};

const SENTENCE: string = DELETE_CONSEQUENCES["EnterpriseLicense"]!.sentence!;

describe("what deleting a license is said to do", () => {
  it("is the sentence every Delete of a license says", () => {
    expect(SENTENCE).toBe(
      "Deleting a license also deletes its instances. Installations that use its key keep the license they already hold until it expires, but can no longer refresh or reactivate it, and their seat reports are refused.",
    );
    expect(DELETE_CONSEQUENCES["EnterpriseLicense"]!.deletedWith).toEqual([
      "EnterpriseLicenseInstance",
    ]);
  });
});

describe("what the code does when a license is deleted", () => {
  it("its instances go with it: their relation to the license is ON DELETE CASCADE", () => {
    const cascades: boolean = modelRelations().some(
      (relation: ModelRelation): boolean => {
        return (
          relation.model === EnterpriseLicenseInstance &&
          relation.relationType === "many-to-one" &&
          relation.relatedModel === EnterpriseLicense &&
          relation.onDelete === "CASCADE"
        );
      },
    );

    expect(cascades).toBe(true);
  });

  it("the key is refused: both routes answer License key is invalid for a key no license has", () => {
    const api: string = read("Server/LicenseServer/EnterpriseLicenseAPI.ts");
    const validate: string =
      api.split("/validate`,")[1]?.split("/report-user-count`,")[0] || "";
    const report: string = api.split("/report-user-count`,")[1] || "";
    const refusal: string =
      'if (!license) {\n            throw new BadDataException("License key is invalid");\n          }';

    expect(validate).toContain(refusal);
    expect(report).toContain(refusal);
  });

  it("an installation's license carries its own expiry: the signed token's exp is the license's", () => {
    expect(read("Server/LicenseServer/LicenseSigner.ts")).toContain(
      "exp: toSeconds(data.expiresAt),",
    );
  });

  it("a refused daily report stores nothing over the license the installation holds", () => {
    const job: string = read("Server/License/Jobs/ReportUserCount.ts");
    const refused: number = job.indexOf("if (!response.isSuccess()) {");
    const returned: number = job.indexOf("return;", refused);
    const stored: number = job.indexOf(
      "await GlobalConfigService.updateOneById({",
      refused,
    );

    expect(refused).toBeGreaterThan(0);
    expect(returned).toBeGreaterThan(refused);
    expect(stored).toBeGreaterThan(returned);
  });

  it("a refused Refresh license or activation throws before anything is stored", () => {
    const client: string = read("Server/License/LicenseClient.ts");
    const validate: string =
      client.split("public static async validateWithLicenseServer(")[1] || "";
    const refused: number = validate.indexOf(
      "if (!validationResponse.isSuccess()) {",
    );
    const thrown: number = validate.indexOf(
      "throw new BadDataException(errorMessage);",
      refused,
    );
    const stored: number = validate.indexOf(
      "await LicenseClient.store(",
      refused,
    );

    expect(refused).toBeGreaterThan(0);
    expect(thrown).toBeGreaterThan(refused);
    expect(stored).toBeGreaterThan(thrown);
  });

  it("the behaviour is exercised where it lives", () => {
    expect(
      read(
        "Tests/Server/LicenseServer/EnterpriseLicenseReportUserCount.test.ts",
      ),
    ).toContain('it("rejects an unknown license key"');
    expect(read("Tests/Server/License/ReportUserCount.test.ts")).toContain(
      'it("keeps the stored license state when the call home fails"',
    );
    expect(read("Tests/Server/License/LicenseClientAPI.test.ts")).toContain(
      "surfaces a failure from the licence server instead of storing anything",
    );
  });
});
