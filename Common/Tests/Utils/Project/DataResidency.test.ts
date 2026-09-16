import DataResidencyUtil from "../../../Utils/Project/DataResidency";
import Project from "../../../Models/DatabaseModels/Project";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * DataResidencyUtil is the one definition of "a project has a data
 * residency". ProjectService stores what normalize() returns, and the
 * customer's Project Settings page shows the row only when
 * shouldShowInProjectSettings() says so - so if the two drift, a project can
 * show an empty "Data Residency" row, or hide one it has.
 */

describe("DataResidencyUtil.normalize", () => {
  test("keeps a plain label exactly as typed", () => {
    expect(DataResidencyUtil.normalize("EU (Frankfurt)")).toBe(
      "EU (Frankfurt)",
    );
  });

  test("trims surrounding whitespace, including tabs and newlines", () => {
    expect(DataResidencyUtil.normalize("  US East  ")).toBe("US East");
    expect(DataResidencyUtil.normalize("\tUS East\n")).toBe("US East");
  });

  test("keeps whitespace inside the label", () => {
    expect(DataResidencyUtil.normalize(" Asia  Pacific (Sydney) ")).toBe(
      "Asia  Pacific (Sydney)",
    );
  });

  test("keeps non-ASCII labels", () => {
    expect(DataResidencyUtil.normalize("ЕС (Франкфурт)")).toBe(
      "ЕС (Франкфурт)",
    );
    expect(DataResidencyUtil.normalize("日本 (東京)")).toBe("日本 (東京)");
  });

  /*
   * A form whose text field was cleared submits "", and a stray space is easy
   * to leave behind. Both have to land as NULL, the same value every project
   * had before the column existed.
   */
  test("stores an empty string as null", () => {
    expect(DataResidencyUtil.normalize("")).toBeNull();
  });

  test("stores a whitespace-only string as null", () => {
    expect(DataResidencyUtil.normalize("   ")).toBeNull();
    expect(DataResidencyUtil.normalize("\n\t ")).toBeNull();
  });

  test("passes null and undefined through as null", () => {
    expect(DataResidencyUtil.normalize(null)).toBeNull();
    expect(DataResidencyUtil.normalize(undefined)).toBeNull();
  });

  test("refuses anything that is not text", () => {
    for (const value of [42, true, false, {}, ["EU"], { region: "EU" }]) {
      expect(() => {
        return DataResidencyUtil.normalize(value);
      }).toThrow(BadDataException);
    }
  });

  test("says what was wrong when it refuses a non-text value", () => {
    expect(() => {
      return DataResidencyUtil.normalize(42);
    }).toThrow("Data residency must be text.");
  });

  test("accepts a label exactly as long as the column", () => {
    const label: string = "a".repeat(DataResidencyUtil.MAX_LENGTH);

    expect(DataResidencyUtil.normalize(label)).toBe(label);
  });

  test("refuses a label one character longer than the column", () => {
    expect(() => {
      return DataResidencyUtil.normalize(
        "a".repeat(DataResidencyUtil.MAX_LENGTH + 1),
      );
    }).toThrow(
      `Data residency cannot be more than ${DataResidencyUtil.MAX_LENGTH} characters.`,
    );
  });

  /*
   * Length is measured after trimming, so padding the admin did not mean to
   * type cannot push a label that fits over the limit.
   */
  test("measures the length after trimming", () => {
    const label: string = "a".repeat(DataResidencyUtil.MAX_LENGTH);

    expect(DataResidencyUtil.normalize(`   ${label}   `)).toBe(label);
  });

  test("is idempotent", () => {
    for (const value of ["EU", "  EU  ", "", "   ", null]) {
      const once: string | null = DataResidencyUtil.normalize(value);

      expect(DataResidencyUtil.normalize(once)).toBe(once);
    }
  });
});

describe("DataResidencyUtil.MAX_LENGTH", () => {
  test("is the width of a ShortText column", () => {
    expect(DataResidencyUtil.MAX_LENGTH).toBe(ColumnLength.ShortText);
  });

  /*
   * The limit is mirrored from the column rather than read from it, so pin
   * the two together: a column widened without this following would refuse
   * labels the database would happily store.
   */
  test("matches the declared length of Project.dataResidency", () => {
    const project: Project = new Project();

    expect(
      getMaxLengthFromTableColumnType(
        project.getTableColumnMetadata("dataResidency").type,
      ),
    ).toBe(DataResidencyUtil.MAX_LENGTH);
  });
});

describe("DataResidencyUtil.isSet", () => {
  test("is true for a label", () => {
    expect(DataResidencyUtil.isSet("EU (Frankfurt)")).toBe(true);
    expect(DataResidencyUtil.isSet("  EU  ")).toBe(true);
  });

  test("is false for null, undefined and blank strings", () => {
    expect(DataResidencyUtil.isSet(null)).toBe(false);
    expect(DataResidencyUtil.isSet(undefined)).toBe(false);
    expect(DataResidencyUtil.isSet("")).toBe(false);
    expect(DataResidencyUtil.isSet("   ")).toBe(false);
  });

  test("is false for values that are not text", () => {
    expect(DataResidencyUtil.isSet(0)).toBe(false);
    expect(DataResidencyUtil.isSet(1)).toBe(false);
    expect(DataResidencyUtil.isSet(true)).toBe(false);
    expect(DataResidencyUtil.isSet({})).toBe(false);
  });

  test("agrees with normalize about what counts as set", () => {
    for (const value of ["EU", "  EU ", "", "  ", null, undefined]) {
      expect(DataResidencyUtil.isSet(value)).toBe(
        DataResidencyUtil.normalize(value) !== null,
      );
    }
  });
});

describe("DataResidencyUtil.shouldShowInProjectSettings", () => {
  test("shows a set residency when billing is enabled", () => {
    expect(
      DataResidencyUtil.shouldShowInProjectSettings({
        isBillingEnabled: true,
        dataResidency: "EU (Frankfurt)",
      }),
    ).toBe(true);
  });

  test("hides the row when the project has no residency", () => {
    for (const dataResidency of [null, undefined, "", "   "]) {
      expect(
        DataResidencyUtil.shouldShowInProjectSettings({
          isBillingEnabled: true,
          dataResidency: dataResidency,
        }),
      ).toBe(false);
    }
  });

  test("hides the row on a server without billing, even if a value is present", () => {
    expect(
      DataResidencyUtil.shouldShowInProjectSettings({
        isBillingEnabled: false,
        dataResidency: "EU (Frankfurt)",
      }),
    ).toBe(false);
  });

  test("hides the row when billing is off and nothing is set", () => {
    expect(
      DataResidencyUtil.shouldShowInProjectSettings({
        isBillingEnabled: false,
        dataResidency: null,
      }),
    ).toBe(false);
  });
});
