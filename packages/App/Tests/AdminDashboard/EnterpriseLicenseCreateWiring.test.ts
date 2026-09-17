import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import { JSONObject } from "Common/Types/JSON";

/*
 * "I'm not able to create enterprise licenses in master admin dashboard. It
 * says server error."
 *
 * Every create the admin form made answered HTTP 500 and wrote a licence row
 * anyway. Expires At is a `FormFieldSchemaType.Date` field, a DOM input whose
 * value is the string "YYYY-MM-DD"; that string travelled all the way onto the
 * saved model, because TypeORM's save() returns the entity it was handed. The
 * post-create hook then called `.toISOString()` on it, threw a TypeError after
 * the INSERT had committed, and a TypeError is not something
 * PostgresErrorTranslator turns into a readable 400 — so it reached the admin
 * as a bare "Server Error" while duplicate licences piled up behind it.
 *
 * The admin dashboard has no React render harness (App's jest environment is
 * "node" and the package carries no react/testing-library), so the page's
 * wiring is asserted against the source text the way the other AdminDashboard
 * suites do. The runtime half — that the values those declared fields produce
 * survive the trip onto a model — is exercised against the real model below,
 * so a field added to this form later cannot quietly reintroduce the same
 * mismatch.
 */

const ADMIN_DASHBOARD_SRC: string = nodePath.join(
  __dirname,
  "../../FeatureSet/AdminDashboard/src",
);

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const pageSource: string = stripComments(
  fs.readFileSync(
    nodePath.join(ADMIN_DASHBOARD_SRC, "Pages/EnterpriseLicenses/Index.tsx"),
    "utf8",
  ),
);

describe("Admin Dashboard > Enterprise Licenses > create", () => {
  describe("the create form's wiring", () => {
    test("offers creation from the licences table", () => {
      expect(pageSource).toContain("isCreateable={true}");
    });

    /*
     * The field type that produces the string at the centre of this bug. It is
     * the correct choice for an expiry — it is pinned so the runtime
     * assertions below stay tied to what the form actually renders, not to a
     * type it used to have.
     */
    test("collects the expiry through a date field", () => {
      // Scoped to the create form: expiresAt is also selected and filtered on.
      const formFields: string = (
        pageSource.split("formFields={[")[1] || ""
      ).split("selectMoreFields=")[0] as string;

      const expiresAtField: string =
        formFields.split("expiresAt: true")[1] || "";

      expect(expiresAtField).toContain("FormFieldSchemaType.Date");
    });

    test("auto-generates a licence key when the admin leaves it blank", () => {
      expect(pageSource).toContain("onBeforeCreate");
      expect(pageSource).toContain("item.licenseKey = UUID.generate()");
    });
  });

  /*
   * The form's values, as the browser produces them: every scalar that came
   * from a DOM input is a string. This is the payload BaseAPI rebuilds a model
   * from, so what the model holds afterwards is what every server-side hook
   * sees.
   */
  describe("what the posted form becomes on the server", () => {
    const postedForm: JSONObject = {
      companyName: "Acme, Inc.",
      email: "buyer@acme.com",
      licenseKey: "b6f4c1a2-1111-2222-3333-444455556666",
      expiresAt: "2027-01-01",
      isEvaluationLicense: false,
      userLimit: "50",
      annualContractValue: "12000",
    };

    type BuildLicenseFunction = () => EnterpriseLicense;

    const buildLicense: BuildLicenseFunction = (): EnterpriseLicense => {
      return BaseModel.fromJSON(
        postedForm,
        EnterpriseLicense,
      ) as EnterpriseLicense;
    };

    test("holds the expiry as a Date, not the string the input gave", () => {
      const license: EnterpriseLicense = buildLicense();

      expect(license.expiresAt).toBeInstanceOf(Date);
      expect(license.expiresAt!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });

    /*
     * The exact call that threw. A hook running after the row is committed
     * must be able to make this call on the licence it is handed.
     */
    test("is safe for a post-create hook to read the expiry off", () => {
      const license: EnterpriseLicense = buildLicense();

      expect(() => {
        return license.expiresAt!.toISOString();
      }).not.toThrow();
    });

    test("holds the numeric fields as numbers", () => {
      const license: EnterpriseLicense = buildLicense();

      expect(license.userLimit).toBe(50);
      expect(license.annualContractValue).toBe(12000);
    });

    test("keeps the text fields as typed", () => {
      const license: EnterpriseLicense = buildLicense();

      expect(license.companyName).toBe("Acme, Inc.");
      expect(license.licenseKey).toBe("b6f4c1a2-1111-2222-3333-444455556666");
      expect(license.isEvaluationLicense).toBe(false);
    });

    /*
     * The minimum the form can submit: company name and expiry, with the key
     * left blank for onBeforeCreate to fill in. This is the shape the reported
     * failure was reproduced with.
     */
    test("works with only the required fields filled in", () => {
      const license: EnterpriseLicense = BaseModel.fromJSON(
        { companyName: "Acme, Inc.", expiresAt: "2027-01-01" },
        EnterpriseLicense,
      ) as EnterpriseLicense;

      expect(license.expiresAt).toBeInstanceOf(Date);
      expect(license.companyName).toBe("Acme, Inc.");
    });
  });
});
