import {
  CUSTOM_DATA_TYPE_ID_PREFIX,
  customDataTypeId,
  isCustomDataTypeId,
} from "../../../Types/DataSecurity/CustomDataTypeId";
import { DATA_TYPE_CATALOG } from "../../../Types/DataSecurity/DataTypeCatalog";
import DataTypeNamer, {
  DELETED_DATA_TYPE_NAME,
  UNREAD_CUSTOM_DATA_TYPE_NAME,
} from "../../../Types/DataSecurity/DataTypeNamer";
import * as CustomDataTypeDetector from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A DATA TYPE IS CALLED, WHEREVER THE SERVER NAMES ONE (#10363).
 *
 * A project's own data type is keyed "custom:" and a row's id. The record
 * of processing an auditor reads, what OneUptime AI is told about an issue,
 * Ask AI's answers, the evidence a check writes and the rules Scrub It
 * makes named it by that id. DataTypeNamer names it by the name the project
 * gave it, says so when it is gone, and never answers an id.
 */

const EMPLOYEE_ID: string = customDataTypeId(
  "9b1c2d3e-0000-4000-8000-000000010363",
);
const POLICY_NUMBER: string = customDataTypeId(
  "9b1c2d3e-0000-4000-8000-000000010364",
);
const GONE: string = customDataTypeId("9b1c2d3e-0000-4000-8000-000000010365");

const PROJECT_NAMES: ReadonlyMap<string, string> = new Map([
  [EMPLOYEE_ID, "Employee ID"],
  [POLICY_NUMBER, "  Policy number "],
]);

describe("how a project's own data type is keyed", () => {
  test("custom: and the row's id, as the scanner has always keyed it", () => {
    expect(CUSTOM_DATA_TYPE_ID_PREFIX).toBe("custom:");
    expect(customDataTypeId("abc")).toBe("custom:abc");
    expect(isCustomDataTypeId("custom:abc")).toBe(true);
    expect(isCustomDataTypeId("credit-card-number")).toBe(false);
  });

  test("the detector keys them with the very same helpers", () => {
    expect(CustomDataTypeDetector.CUSTOM_DATA_TYPE_ID_PREFIX).toBe(
      CUSTOM_DATA_TYPE_ID_PREFIX,
    );
    expect(CustomDataTypeDetector.customDataTypeId).toBe(customDataTypeId);
    expect(CustomDataTypeDetector.isCustomDataTypeId).toBe(isCustomDataTypeId);
  });
});

describe("DataTypeNamer.nameOf", () => {
  const namer: DataTypeNamer = new DataTypeNamer(PROJECT_NAMES);

  test("a built-in type by the catalog's name, whatever the project calls an id", () => {
    expect(namer.nameOf("credit-card-number")).toBe("Card number");
    expect(
      new DataTypeNamer(new Map([["credit-card-number", "Mine"]])).nameOf(
        "credit-card-number",
      ),
    ).toBe("Card number");
  });

  test("a project's own type by the name it gave it, trimmed", () => {
    expect(namer.nameOf(EMPLOYEE_ID)).toBe("Employee ID");
    expect(namer.nameOf(POLICY_NUMBER)).toBe("Policy number");
  });

  test("the record a check is handed names them the same", () => {
    const fromRecord: DataTypeNamer = new DataTypeNamer({
      [EMPLOYEE_ID]: "Employee ID",
    });

    expect(fromRecord.nameOf(EMPLOYEE_ID)).toBe("Employee ID");
    expect(fromRecord.nameOf(GONE)).toBe(DELETED_DATA_TYPE_NAME);
  });

  test("one the project's types do not hold is one it deleted", () => {
    expect(namer.nameOf(GONE)).toBe("A deleted data type");
    expect(new DataTypeNamer(new Map()).nameOf(GONE)).toBe(
      "A deleted data type",
    );
  });

  test("one whose names were not read is a custom data type, never deleted", () => {
    expect(DataTypeNamer.withoutCustomTypes().nameOf(EMPLOYEE_ID)).toBe(
      "Custom data type",
    );
    expect(new DataTypeNamer(null).nameOf(GONE)).toBe(
      UNREAD_CUSTOM_DATA_TYPE_NAME,
    );
    expect(new DataTypeNamer(undefined).hasCustomTypes()).toBe(false);
    expect(namer.hasCustomTypes()).toBe(true);
  });

  test("one of the project's types with no name is a custom data type, not deleted", () => {
    expect(
      new DataTypeNamer(new Map([[EMPLOYEE_ID, "   "]])).nameOf(EMPLOYEE_ID),
    ).toBe("Custom data type");
    expect(new DataTypeNamer({ [EMPLOYEE_ID]: "" }).nameOf(EMPLOYEE_ID)).toBe(
      "Custom data type",
    );
  });

  test("the name a finding kept stands in only when nothing else knows the type", () => {
    // Renamed since: today's name.
    expect(namer.nameOf(EMPLOYEE_ID, "Staff number")).toBe("Employee ID");
    // Deleted since: the name it was found under.
    expect(namer.nameOf(GONE, "Badge number")).toBe("Badge number");
    // Not read for this reader: the finding's own row says it.
    expect(
      DataTypeNamer.withoutCustomTypes().nameOf(GONE, " Badge number "),
    ).toBe("Badge number");
    // A built-in type is the catalog's, whatever the finding kept.
    expect(namer.nameOf("email-address", "e-mail")).toBe("Email address");
  });

  test("a kept name that is an id is no name", () => {
    expect(namer.nameOf(GONE, GONE)).toBe(DELETED_DATA_TYPE_NAME);
    expect(namer.nameOf(GONE, EMPLOYEE_ID)).toBe(DELETED_DATA_TYPE_NAME);
    expect(namer.nameOf(GONE, "   ")).toBe(DELETED_DATA_TYPE_NAME);
    expect(DataTypeNamer.withoutCustomTypes().nameOf(GONE, GONE)).toBe(
      UNREAD_CUSTOM_DATA_TYPE_NAME,
    );
  });

  test("an id the catalog does not know, that is not a custom type's, reads as written", () => {
    expect(namer.nameOf("retired-type")).toBe("retired-type");
    expect(namer.nameOf("retired-type", "Retired type")).toBe("Retired type");
  });

  test("never answers a custom type's id, whatever it is handed", () => {
    const namers: Array<DataTypeNamer> = [
      namer,
      DataTypeNamer.withoutCustomTypes(),
      new DataTypeNamer(new Map()),
      new DataTypeNamer({ [GONE]: "" }),
    ];
    const kept: Array<string | null | undefined> = [
      undefined,
      null,
      "",
      GONE,
      EMPLOYEE_ID,
      `${CUSTOM_DATA_TYPE_ID_PREFIX}x`,
    ];

    for (const each of namers) {
      for (const id of [EMPLOYEE_ID, POLICY_NUMBER, GONE, "custom:"]) {
        for (const keptName of kept) {
          const name: string = each.nameOf(id, keptName);

          expect({
            id,
            keptName,
            name,
            isId: isCustomDataTypeId(name),
          }).toEqual({ id, keptName, name, isId: false });
        }
      }
    }
  });
});

describe("DataTypeNamer.namesOf", () => {
  const namer: DataTypeNamer = new DataTypeNamer(PROJECT_NAMES);

  test("names each type once, in the order given", () => {
    expect(
      namer.namesOf([
        "email-address",
        EMPLOYEE_ID,
        "credit-card-number",
        EMPLOYEE_ID,
      ]),
    ).toEqual(["Email address", "Employee ID", "Card number"]);
  });

  test("two types that are gone read as one deleted data type", () => {
    expect(
      namer.namesOf([GONE, customDataTypeId("other-gone"), "email-address"]),
    ).toEqual(["A deleted data type", "Email address"]);
  });

  test("none to name is none", () => {
    expect(namer.namesOf(undefined)).toEqual([]);
    expect(namer.namesOf(null)).toEqual([]);
    expect(namer.namesOf([])).toEqual([]);
  });
});

describe("DataTypeNamer.findIds", () => {
  const namer: DataTypeNamer = new DataTypeNamer(
    new Map([
      [EMPLOYEE_ID, "Employee ID"],
      [POLICY_NUMBER, "Policy number"],
      [GONE, "employee id"],
    ]),
  );

  test("a built-in type by its id, or its name in any case", () => {
    expect(namer.findIds("credit-card-number")).toEqual(["credit-card-number"]);
    expect(namer.findIds("Card number")).toEqual(["credit-card-number"]);
    expect(namer.findIds("  CARD NUMBER ")).toEqual(["credit-card-number"]);
  });

  test("a project's own type by its id", () => {
    expect(namer.findIds(` ${POLICY_NUMBER} `)).toEqual([POLICY_NUMBER]);
  });

  test("a project's own type by its name in any case: every type of that name", () => {
    expect(namer.findIds("Policy Number")).toEqual([POLICY_NUMBER]);
    expect(namer.findIds("EMPLOYEE ID")).toEqual([EMPLOYEE_ID, GONE]);
  });

  test("a project's own type is not found by name when the names were not read", () => {
    expect(DataTypeNamer.withoutCustomTypes().findIds("Employee ID")).toEqual([
      "Employee ID",
    ]);
  });

  test("text that names none comes back as it is, and no text finds nothing", () => {
    expect(namer.findIds(" Badge number ")).toEqual(["Badge number"]);
    expect(namer.findIds("   ")).toEqual([]);
  });

  test("every built-in type is found by its own name", () => {
    for (const info of DATA_TYPE_CATALOG) {
      expect({ name: info.name, ids: namer.findIds(info.name) }).toEqual({
        name: info.name,
        ids: [
          DATA_TYPE_CATALOG.find((each: { name: string }): boolean => {
            return each.name.toLowerCase() === info.name.toLowerCase();
          })!.id,
        ],
      });
    }
  });
});
