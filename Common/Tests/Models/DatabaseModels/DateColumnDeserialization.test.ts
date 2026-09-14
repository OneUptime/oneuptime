import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what a date column holds after a JSON round trip.
 *
 * `BaseModel.fromJSON` is the single door every model comes through, and it
 * runs on BOTH sides of the wire: ModelForm builds the model it is about to
 * POST with it, and BaseAPI rebuilds that model from the request body with
 * it. That makes it the one place that can fix the following, once.
 *
 * HTML has no Date input event — `<input type="date">` gives you
 * `e.target.value`, the string "YYYY-MM-DD" — so the dashboard posted a plain
 * string for every date field in the product. Postgres parses that string on
 * the way in, so it was invisible everywhere except where something reads the
 * column back off the saved model: TypeORM's `save()` returns the entity it
 * was handed, never a re-read row.
 *
 * EnterpriseLicenseService.onCreateSuccess does exactly that, and creating an
 * enterprise licence in the admin dashboard answered:
 *
 *   HTTP 500 — Server Error
 *
 * for every attempt, having written a licence row for every attempt, because
 * `createdItem.expiresAt.toISOString()` was called on a string after the
 * INSERT had committed.
 */

describe("BaseModel.fromJSON on date columns", () => {
  /*
   * The reported payload, exactly as the admin dashboard's Enterprise
   * Licenses form sends it: expiresAt comes from an <input type="date">, so
   * it is the string "YYYY-MM-DD".
   */
  it("turns the admin licence form's payload into a real Date", () => {
    const posted: JSONObject = {
      companyName: "Acme, Inc.",
      licenseKey: "b6f4c1a2-1111-2222-3333-444455556666",
      expiresAt: "2027-01-01",
      isEvaluationLicense: false,
    };

    const model: EnterpriseLicense = BaseModel.fromJSON(
      posted,
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt).toBeInstanceOf(Date);
    expect(model.expiresAt!.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  /*
   * The regression in one line: this is the call that threw, and it has to be
   * safe on a model built the way the API builds one.
   */
  it("leaves the created model safe to call toISOString on", () => {
    const model: EnterpriseLicense = BaseModel.fromJSON(
      { companyName: "Acme, Inc.", expiresAt: "2027-01-01" },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(() => {
      return model.expiresAt!.toISOString();
    }).not.toThrow();
  });

  it("does the same for a datetime-local field on another model", () => {
    const model: ScheduledMaintenance = BaseModel.fromJSON(
      {
        title: "Database upgrade",
        startsAt: "2027-01-01T10:30",
        endsAt: "2027-01-01T12:00",
      },
      ScheduledMaintenance,
    ) as ScheduledMaintenance;

    expect(model.startsAt).toBeInstanceOf(Date);
    expect(model.startsAt!.toISOString()).toBe("2027-01-01T10:30:00.000Z");
    expect(model.endsAt).toBeInstanceOf(Date);
    expect(model.endsAt!.toISOString()).toBe("2027-01-01T12:00:00.000Z");
  });

  /*
   * The path that always worked — a Date serialized by JSONFunctions into
   * { _type: "DateTime", value } — must keep working. Coercion sits after
   * deserialization, so by the time it runs this is already a Date and it has
   * nothing to do.
   */
  it("still handles the serialized DateTime wrapper", () => {
    const expiresAt: Date = new Date("2027-03-04T05:06:07.000Z");

    const model: EnterpriseLicense = BaseModel.fromJSON(
      JSONFunctions.serialize({
        companyName: "Acme, Inc.",
        expiresAt: expiresAt,
      }),
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt).toBeInstanceOf(Date);
    expect(model.expiresAt!.getTime()).toBe(expiresAt.getTime());
  });

  it("passes a Date straight through", () => {
    const expiresAt: Date = new Date("2027-03-04T05:06:07.000Z");

    const model: EnterpriseLicense = BaseModel.fromJSON(
      { companyName: "Acme, Inc.", expiresAt: expiresAt } as JSONObject,
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt).toBeInstanceOf(Date);
    expect(model.expiresAt!.getTime()).toBe(expiresAt.getTime());
  });

  /*
   * The instant that reaches Postgres must not move. An offset-less literal
   * in a timestamptz column is parsed in the session timezone — UTC in every
   * OneUptime deployment — so the coerced Date has to be the same instant the
   * raw string used to become.
   */
  it("produces the instant Postgres produced from the same string", () => {
    const model: EnterpriseLicense = BaseModel.fromJSON(
      { expiresAt: "2027-01-01" },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt!.toISOString()).toBe(
      OneUptimeDate.fromString("2027-01-01T00:00:00Z").toISOString(),
    );
  });

  it("does not touch the other columns on the way past", () => {
    const model: EnterpriseLicense = BaseModel.fromJSON(
      {
        companyName: "Acme, Inc.",
        email: "buyer@acme.com",
        licenseKey: "key-1",
        expiresAt: "2027-01-01",
        userLimit: "50",
        annualContractValue: "12000",
        isEvaluationLicense: true,
      },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.companyName).toBe("Acme, Inc.");
    expect(model.licenseKey).toBe("key-1");
    expect(model.userLimit).toBe(50);
    expect(model.annualContractValue).toBe(12000);
    expect(model.isEvaluationLicense).toBe(true);
    expect(model.expiresAt).toBeInstanceOf(Date);
  });

  it("leaves a cleared date field alone rather than inventing an epoch", () => {
    const model: EnterpriseLicense = BaseModel.fromJSON(
      { companyName: "Acme, Inc.", expiresAt: "" },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt).toBe("");
  });

  /*
   * An unparseable date is left as the string it was, so the required-field
   * and database layers report the field. Inventing a date here would store a
   * silently wrong expiry on a licence.
   */
  it("leaves an unparseable date alone so validation reports it", () => {
    const model: EnterpriseLicense = BaseModel.fromJSON(
      { companyName: "Acme, Inc.", expiresAt: "not-a-date" },
      EnterpriseLicense,
    ) as EnterpriseLicense;

    expect(model.expiresAt).toBe("not-a-date");
  });
});
