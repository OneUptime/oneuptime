import EnterpriseLicenseService from "../../../Server/Services/EnterpriseLicenseService";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { MarketingEvent } from "../../../Types/Marketing/MarketingEvent";
import { resolveEmittedMarketingEvent } from "../Utils/Marketing/EmittedMarketingEvent";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Regression suite for "I'm not able to create enterprise licenses in master
 * admin dashboard. It says server error."
 *
 * The admin form's expiresAt comes from an `<input type="date">`, so it
 * reached the API as the string "2027-01-01" and stayed a string on the model.
 * TypeORM's save() hands back the entity it was given rather than a re-read
 * row, so onCreateSuccess — which runs AFTER the INSERT has committed — called
 * `.toISOString()` on a string:
 *
 *   TypeError: createdItem.expiresAt.toISOString is not a function
 *
 * A TypeError is not one of the driver errors PostgresErrorTranslator knows
 * how to turn into a 400, so it fell through to the generic handler as a bare
 * 500 "Server Error". Every attempt wrote a licence row and then reported
 * failure, so an admin retrying piled up duplicates.
 *
 * Two things are pinned here, because either one alone closes the hole and
 * both together mean it cannot reopen from a new direction:
 *   - the model built from the posted body holds a real Date, and
 *   - the hook survives a licence whose date column is a string anyway.
 */

const LICENSE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CREATED_AT: Date = new Date("2026-08-28T09:00:00.000Z");

type CreatedLicenseFunction = (
  overrides?: Record<string, unknown>,
) => EnterpriseLicense;

/*
 * The row as it comes back out of `repository.save()`: the model the API
 * built, with an id and createdAt stamped on it.
 */
const createdLicense: CreatedLicenseFunction = (
  overrides?: Record<string, unknown>,
): EnterpriseLicense => {
  const license: EnterpriseLicense = new EnterpriseLicense();
  license._id = LICENSE_ID.toString();
  license.companyName = "Acme, Inc.";
  license.licenseKey = "b6f4c1a2-1111-2222-3333-444455556666";
  license.createdAt = CREATED_AT;
  license.expiresAt = new Date("2027-01-01T00:00:00.000Z");
  license.isEvaluationLicense = false;

  Object.assign(license, overrides || {});

  return license;
};

type RunCreateHookFunction = (
  createdItem: EnterpriseLicense,
) => Promise<EnterpriseLicense>;

/*
 * onCreateSuccess is the hook the create path runs once the row exists; it is
 * protected, so it is reached the way the framework reaches it.
 */
const runCreateHook: RunCreateHookFunction = async (
  createdItem: EnterpriseLicense,
): Promise<EnterpriseLicense> => {
  return await (
    EnterpriseLicenseService as unknown as {
      onCreateSuccess: (
        onCreate: unknown,
        createdItem: EnterpriseLicense,
      ) => Promise<EnterpriseLicense>;
    }
  ).onCreateSuccess({}, createdItem);
};

describe("EnterpriseLicenseService create", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the payload the admin dashboard posts", () => {
    /*
     * Straight from App/FeatureSet/AdminDashboard Pages/EnterpriseLicenses:
     * Company Name is Text, Expires At is Date, User Limit and Annual
     * Contract Value are PositiveNumber. Every one of those is a DOM input,
     * so every one of those posts a string.
     */
    const postedBody: JSONObject = {
      companyName: "Acme, Inc.",
      email: "buyer@acme.com",
      licenseKey: "b6f4c1a2-1111-2222-3333-444455556666",
      expiresAt: "2027-01-01",
      isEvaluationLicense: false,
      userLimit: "50",
      annualContractValue: "12000",
    };

    it("builds a licence whose expiry is a real Date", () => {
      const license: EnterpriseLicense = BaseModel.fromJSON(
        postedBody,
        EnterpriseLicense,
      ) as EnterpriseLicense;

      expect(license.expiresAt).toBeInstanceOf(Date);
      expect(license.expiresAt!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });

    it("creates without a server error", async () => {
      jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      const license: EnterpriseLicense = BaseModel.fromJSON(
        postedBody,
        EnterpriseLicense,
      ) as EnterpriseLicense;

      license._id = LICENSE_ID.toString();
      license.createdAt = CREATED_AT;

      await expect(runCreateHook(license)).resolves.toBe(license);
    });
  });

  describe("the enterprise_license_issued conversion", () => {
    it("reports the expiry as an ISO instant", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      await runCreateHook(createdLicense());

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.eventType).toBe("enterprise_license_issued");
      expect(event.eventId).toBe(
        `enterprise_license_issued:${LICENSE_ID.toString()}`,
      );
      expect(event.data["expiresAt"]).toBe("2027-01-01T00:00:00.000Z");
      expect(event.data["companyName"]).toBe("Acme, Inc.");
    });

    /*
     * The exact shape that used to throw. A licence created by anything that
     * does not go through BaseModel.fromJSON — a script, a fixture, a service
     * assigning the column by hand — still has a string here, and the hook
     * runs after the row is committed, so it must report the expiry rather
     * than take the create down with it.
     */
    it("survives an expiry that is still a string", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      const license: EnterpriseLicense = createdLicense({
        expiresAt: "2027-01-01",
      });

      await expect(runCreateHook(license)).resolves.toBe(license);

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.data["expiresAt"]).toBe("2027-01-01T00:00:00.000Z");
    });

    it("reports a missing expiry as null rather than failing", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      const license: EnterpriseLicense = createdLicense({
        expiresAt: undefined,
      });

      await expect(runCreateHook(license)).resolves.toBe(license);

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.data["expiresAt"]).toBeNull();
    });

    it("reports an unusable expiry as null rather than failing", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      const license: EnterpriseLicense = createdLicense({
        expiresAt: "not-a-date",
      });

      await expect(runCreateHook(license)).resolves.toBe(license);

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.data["expiresAt"]).toBeNull();
    });

    /*
     * The two nulls are reported honestly rather than defaulted to zero,
     * which would quietly drag reported contract value down.
     */
    it("reports an absent contract value and seat limit as null", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      await runCreateHook(createdLicense());

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.data["annualContractValueInUSD"]).toBeNull();
      expect(event.data["userLimit"]).toBeNull();
      expect(event.data["currency"]).toBe("USD");
    });

    it("carries the licence's contact email so the conversion can be joined", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      await runCreateHook(
        createdLicense({
          email: new Email("buyer@acme.com"),
          annualContractValue: 12000,
          userLimit: 50,
          isEvaluationLicense: true,
        }),
      );

      const event: MarketingEvent = resolveEmittedMarketingEvent(
        emitInBackground.mock.calls[0]![0],
      );

      expect(event.email).toBe("buyer@acme.com");
      expect(event.data["annualContractValueInUSD"]).toBe(12000);
      expect(event.data["userLimit"]).toBe(50);
      expect(event.data["isEvaluationLicense"]).toBe(true);
    });

    /*
     * Deferred, not built at the call site. This is what makes
     * emitInBackground's "never turns a completed action into a failed one"
     * guarantee real: an argument expression is evaluated by the caller,
     * outside the wrapper's try, so building the event there is exactly how
     * the original TypeError escaped.
     */
    it("hands emitInBackground a builder rather than a built event", async () => {
      const emitInBackground: jest.SpyInstance = jest
        .spyOn(MarketingEventUtil, "emitInBackground")
        .mockReturnValue(undefined);

      await runCreateHook(createdLicense());

      expect(typeof emitInBackground.mock.calls[0]![0]).toBe("function");
    });

    /*
     * The consequence of the line above, end to end: with the real
     * emitInBackground in place, an event that cannot be assembled at all is
     * logged and dropped. The licence row exists, so the admin must be told
     * the licence was created.
     */
    it("does not fail the create when the event cannot be built", async () => {
      jest.spyOn(MarketingEventUtil, "buildEvent").mockImplementation(() => {
        throw new Error("marketing is having a bad day");
      });

      const license: EnterpriseLicense = createdLicense();

      await expect(runCreateHook(license)).resolves.toBe(license);
    });
  });
});
