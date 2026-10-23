import { describe, expect, test } from "@jest/globals";
import EnterpriseLicense from "../../../../Models/DatabaseModels/EnterpriseLicense";
import {
  buildLicenseDeletedAuditLine,
  buildLicenseIssuedAuditLine,
  buildLicenseUpdatedAuditLine,
  describeActorForAudit,
  describeLicenseForAudit,
  ENTERPRISE_LICENSE_AUDITED_COLUMNS,
  formatAuditedValue,
  getAuditedColumnsWritten,
  LICENSE_RECORD_COLUMNS,
  LICENSE_SERVER_BOOKKEEPING_COLUMNS,
} from "../../../../Server/Utils/EnterpriseLicense/EnterpriseLicenseAudit";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The audit trail of OneUptime Cloud's enterprise licenses: one server log
 * line for every license issued, changed or deleted by a person, naming who
 * did it, the license by its company and masked key, and what changed.
 *
 * A license belongs to no project, so the per-project audit log has no place
 * for it; the Admin Dashboard's other master admin actions (a trial
 * extended, two factor auth required) are recorded the same way.
 *
 * A line never carries a license key, only its masked form, and never the
 * contact's email address.
 */

const LICENSE_ID: string = "4d2e7f0a-5b9c-4c1d-8e3f-a1b2c3d4e5f6";
const ADMIN_ID: string = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
const KEY: string =
  "da74c0ffee0123456789abcdef0123456789abcdef0123456789abcdef7c7a";

/*
 * The license's switches besides the evaluation one, read off the model:
 * the audit records every term, and this file, like the rest of core, names
 * only the ones it has a reason to.
 */
const OTHER_SWITCHES: Array<string> = ENTERPRISE_LICENSE_AUDITED_COLUMNS.filter(
  (column: string): boolean => {
    return (
      column !== "isEvaluationLicense" &&
      new EnterpriseLicense().getTableColumnMetadata(column).type ===
        TableColumnType.Boolean
    );
  },
);

const license: (
  overrides?: Partial<Record<string, unknown>>,
) => EnterpriseLicense = (
  overrides?: Partial<Record<string, unknown>>,
): EnterpriseLicense => {
  const row: EnterpriseLicense = new EnterpriseLicense();
  row._id = LICENSE_ID;
  row.companyName = "Netlock.hu";
  row.licenseKey = KEY;
  row.expiresAt = new Date("2026-09-30T00:00:00.000Z");
  row.userLimit = 50;
  row.isEvaluationLicense = true;
  row.annualContractValue = 12000;
  row.email = new Email("komaromi.adam@netlock.hu");

  for (const column of OTHER_SWITCHES) {
    (row as unknown as Record<string, unknown>)[column] = false;
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    (row as unknown as Record<string, unknown>)[key] = value;
  }

  return row;
};

const masterAdmin: { isMasterAdmin: boolean; userId: ObjectID } = {
  isMasterAdmin: true,
  userId: new ObjectID(ADMIN_ID),
};

describe("what names a license in a line", () => {
  test("its id, its company and its masked key - never the key", () => {
    const description: string = describeLicenseForAudit(license());

    expect(description).toBe(`${LICENSE_ID} (Netlock.hu, key da74••••7c7a)`);
    expect(description).not.toContain(KEY);
  });

  test("a license with no company or key still gets a line", () => {
    expect(
      describeLicenseForAudit(license({ companyName: "  ", licenseKey: "" })),
    ).toBe(`${LICENSE_ID} (no company name, key no key)`);
  });

  test("who did it: a master admin by id, a user, or OneUptime itself", () => {
    expect(describeActorForAudit(masterAdmin)).toBe(`master admin ${ADMIN_ID}`);
    expect(describeActorForAudit({ isMasterAdmin: true })).toBe(
      "master admin unknown",
    );
    expect(describeActorForAudit({ userId: new ObjectID(ADMIN_ID) })).toBe(
      `user ${ADMIN_ID}`,
    );
    expect(describeActorForAudit({ isRoot: true })).toBe("OneUptime");
  });
});

describe("the lines", () => {
  test("a license issued", () => {
    expect(
      buildLicenseIssuedAuditLine({ license: license(), props: masterAdmin }),
    ).toBe(
      `Enterprise license ${LICENSE_ID} (Netlock.hu, key da74••••7c7a), expiring 2026-09-30, issued by master admin ${ADMIN_ID}.`,
    );
  });

  test("a license deleted, with the expiry its installations keep running to", () => {
    const line: string = buildLicenseDeletedAuditLine({
      license: license(),
      props: masterAdmin,
    });

    expect(line).toBe(
      `Enterprise license ${LICENSE_ID} (Netlock.hu, key da74••••7c7a), expiring 2026-09-30, deleted by master admin ${ADMIN_ID}.`,
    );
    expect(line).not.toContain(KEY);
  });

  test("a license's expiry changed, old to new, as the bulk Change Expiry Date writes it", () => {
    expect(
      buildLicenseUpdatedAuditLine({
        before: license(),
        written: { expiresAt: "2027-09-30" },
        props: masterAdmin,
      }),
    ).toBe(
      `Enterprise license ${LICENSE_ID} (Netlock.hu, key da74••••7c7a) changed by master admin ${ADMIN_ID}: expiresAt 2026-09-30 -> 2027-09-30.`,
    );
  });

  test("every term that changed, in the order the model declares them", () => {
    const otherSwitch: string = OTHER_SWITCHES[0] as string;
    const line: string | null = buildLicenseUpdatedAuditLine({
      before: license(),
      written: {
        userLimit: 100,
        isEvaluationLicense: false,
        companyName: "NetLock Kft.",
        [otherSwitch]: true,
      },
      props: masterAdmin,
    });

    expect(line).toBe(
      `Enterprise license ${LICENSE_ID} (Netlock.hu, key da74••••7c7a) changed by master admin ${ADMIN_ID}: companyName Netlock.hu -> NetLock Kft.; isEvaluationLicense true -> false; ${otherSwitch} false -> true; userLimit 50 -> 100.`,
    );
  });

  test("a new key is masked on both sides", () => {
    const newKey: string = `1d94${"0".repeat(56)}91eb`;
    const line: string | null = buildLicenseUpdatedAuditLine({
      before: license(),
      written: { licenseKey: newKey },
      props: masterAdmin,
    });

    expect(line).toContain("licenseKey da74••••7c7a -> 1d94••••91eb");
    expect(line).not.toContain(KEY);
    expect(line).not.toContain(newKey);
  });

  test("the contact's email address is never printed, only that it changed", () => {
    const line: string | null = buildLicenseUpdatedAuditLine({
      before: license(),
      written: { email: "procurement@netlock.hu" } as JSONObject,
      props: masterAdmin,
    });

    expect(line).toContain("email changed");
    expect(line).not.toContain("netlock.hu -> ");
    expect(line).not.toContain("procurement@netlock.hu");
    expect(line).not.toContain("komaromi.adam@netlock.hu");
  });

  test("a save that rewrote the same terms is no change, and writes no line", () => {
    expect(
      buildLicenseUpdatedAuditLine({
        before: license(),
        written: {
          expiresAt: "2026-09-30T00:00:00.000Z",
          userLimit: 50,
          companyName: "Netlock.hu",
          licenseKey: ` ${KEY} `,
        },
        props: masterAdmin,
      }),
    ).toBeNull();
  });

  test("a write of anything but the terms writes no line", () => {
    expect(
      buildLicenseUpdatedAuditLine({
        before: license(),
        written: {
          currentUserCount: 12,
          userCountUpdatedAt: new Date(),
        } as unknown as JSONObject,
        props: masterAdmin,
      }),
    ).toBeNull();
  });
});

describe("which writes are audited", () => {
  test("every term of the license: its columns but the record's own and the license server's bookkeeping", () => {
    const columns: Array<string> = new EnterpriseLicense().getTableColumns()
      .columns;

    // What is left out is really there to leave out.
    for (const column of [
      ...LICENSE_RECORD_COLUMNS,
      ...LICENSE_SERVER_BOOKKEEPING_COLUMNS,
    ]) {
      expect({ column, isColumn: columns.includes(column) }).toEqual({
        column,
        isColumn: true,
      });
    }

    expect([...ENTERPRISE_LICENSE_AUDITED_COLUMNS]).toEqual(
      columns.filter((column: string): boolean => {
        return (
          !LICENSE_RECORD_COLUMNS.includes(column) &&
          !(
            LICENSE_SERVER_BOOKKEEPING_COLUMNS as ReadonlyArray<string>
          ).includes(column)
        );
      }),
    );

    // The terms the forms and the bulk expiry change write, and one switch more.
    expect([...ENTERPRISE_LICENSE_AUDITED_COLUMNS]).toEqual([
      "companyName",
      "email",
      "licenseKey",
      "expiresAt",
      "annualContractValue",
      "isEvaluationLicense",
      ...OTHER_SWITCHES,
      "userLimit",
    ]);
    expect(OTHER_SWITCHES).toHaveLength(1);
  });

  test("an update's audited columns, and none for the license server's own usage figures", () => {
    expect(
      getAuditedColumnsWritten({ expiresAt: "2027-01-01", userLimit: 5 }),
    ).toEqual(["expiresAt", "userLimit"]);
    expect(
      getAuditedColumnsWritten({
        currentUserCount: 3,
        userCountSource: "Instance",
      }),
    ).toEqual([]);
    expect(getAuditedColumnsWritten(undefined)).toEqual([]);
    expect(getAuditedColumnsWritten(null)).toEqual([]);
  });

  test("values print as a reader checks them: days, masked keys, none", () => {
    expect(
      formatAuditedValue("expiresAt", new Date("2027-10-14T00:00:00Z")),
    ).toBe("2027-10-14");
    expect(formatAuditedValue("expiresAt", "2027-10-14")).toBe("2027-10-14");
    expect(formatAuditedValue("expiresAt", "not a date")).toBe("not a date");
    expect(formatAuditedValue("licenseKey", KEY)).toBe("da74••••7c7a");
    expect(formatAuditedValue("licenseKey", "short")).toBe("••••••••");
    expect(formatAuditedValue("userLimit", null)).toBe("none");
    expect(formatAuditedValue("userLimit", undefined)).toBe("none");
    expect(formatAuditedValue("companyName", "")).toBe("none");
    expect(formatAuditedValue("isEvaluationLicense", false)).toBe("false");
  });
});
