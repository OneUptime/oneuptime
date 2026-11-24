import AndroidSecurityPatch, {
  ANDROID_SECURITY_PATCH_ATTRIBUTE,
  ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
  AndroidSecurityPatchStatus,
} from "../../../Types/Host/AndroidSecurityPatch";
import { ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE } from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import { ANDROID_SECURITY_PATCH_MAX_AGE_DAYS as TEMPLATE_MAX_AGE } from "../../../Types/Monitor/HostAlertTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * When an Android device is behind on its security patches (#9965): its
 * patch level more than 90 days old, by UTC days - the rule Inventory's
 * Security Patch Level filter (in SQL, InventorySecurityPatchPostgres
 * holds it to this), its column and the alert template all read.
 */

const NOW: Date = new Date("2026-11-19T08:27:37.467Z");

describe("the baseline", () => {
  test("is 90 days, for the filter and the alert template alike, on the attribute the agent and Esper write", () => {
    expect(ANDROID_SECURITY_PATCH_MAX_AGE_DAYS).toBe(90);
    expect(TEMPLATE_MAX_AGE).toBe(ANDROID_SECURITY_PATCH_MAX_AGE_DAYS);
    expect(ANDROID_SECURITY_PATCH_ATTRIBUTE).toBe(
      ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE,
    );
  });

  test("the oldest level still up to date is the UTC day 90 days before today", () => {
    expect(AndroidSecurityPatch.getOldestUpToDate(NOW)).toBe("2026-08-21");
    // Late on the 18th in New York is the 19th in UTC: UTC decides.
    expect(
      AndroidSecurityPatch.getOldestUpToDate(
        new Date("2026-11-19T03:00:00.000Z"),
      ),
    ).toBe("2026-08-21");
    // Across a year's end and a leap day.
    expect(
      AndroidSecurityPatch.getOldestUpToDate(
        new Date("2024-03-01T12:00:00.000Z"),
      ),
    ).toBe("2023-12-02");
  });
});

describe("a device's status", () => {
  test("is up to date at 90 days, out of date at 91", () => {
    expect(AndroidSecurityPatch.getStatus("2026-08-21", NOW)).toBe(
      AndroidSecurityPatchStatus.UpToDate,
    );
    expect(AndroidSecurityPatch.getStatus("2026-08-20", NOW)).toBe(
      AndroidSecurityPatchStatus.OutOfDate,
    );
    expect(AndroidSecurityPatch.getStatus("2024-06-05", NOW)).toBe(
      AndroidSecurityPatchStatus.OutOfDate,
    );
    expect(AndroidSecurityPatch.getStatus("2026-11-05", NOW)).toBe(
      AndroidSecurityPatchStatus.UpToDate,
    );
  });

  test("a level dated after today is up to date: the device's clock is behind, not its patches", () => {
    expect(AndroidSecurityPatch.getStatus("2026-12-05", NOW)).toBe(
      AndroidSecurityPatchStatus.UpToDate,
    );
  });

  test("is none for what is no patch level", () => {
    for (const value of [
      undefined,
      null,
      "",
      "unknown",
      "2024-6-5",
      "2024-13-01",
      "2024-06-32",
      "06/05/2024",
      20240605,
      {},
    ]) {
      expect(AndroidSecurityPatch.getStatus(value, NOW)).toBeUndefined();
    }
    // As written, with spaces around: read.
    expect(AndroidSecurityPatch.getStatus(" 2024-06-05 ", NOW)).toBe(
      AndroidSecurityPatchStatus.OutOfDate,
    );
  });
});

describe("a level's age", () => {
  test("is the whole UTC days since its date, as the agent counts it", () => {
    expect(AndroidSecurityPatch.getAgeInDays("2026-11-19", NOW)).toBe(0);
    expect(AndroidSecurityPatch.getAgeInDays("2026-08-21", NOW)).toBe(90);
    expect(AndroidSecurityPatch.getAgeInDays("2026-08-20", NOW)).toBe(91);
    // The agent's golden kiosk, at the golden's time: 897, as its metric says.
    expect(AndroidSecurityPatch.getAgeInDays("2024-06-05", NOW)).toBe(897);
    expect(AndroidSecurityPatch.getAgeInDays("2026-12-05", NOW)).toBe(0);
  });

  test("is none for a level that is no day of the calendar", () => {
    expect(
      AndroidSecurityPatch.getAgeInDays("2023-02-29", NOW),
    ).toBeUndefined();
    expect(
      AndroidSecurityPatch.getAgeInDays("2024-04-31", NOW),
    ).toBeUndefined();
    expect(AndroidSecurityPatch.getAgeInDays("unknown", NOW)).toBeUndefined();
  });
});

describe("its SQL", () => {
  test("reads the patch level off the item's attributes and compares it with the UTC day 90 days back", () => {
    const sql: string = AndroidSecurityPatch.getStatusSql('"InventoryItem"');

    expect(sql).toContain(
      `("InventoryItem"."descriptiveAttributes" ->> 'android.os.security_patch')`,
    );
    expect(sql).toContain("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 90");
    expect(sql).toContain(`'${AndroidSecurityPatchStatus.OutOfDate}'`);
    expect(sql).toContain(`'${AndroidSecurityPatchStatus.UpToDate}'`);
    expect(sql).toContain("ELSE NULL");
  });
});
