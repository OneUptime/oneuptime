import HeldPermissionsUtil from "../../Types/HeldPermissions";
import { meetsErrorMessageRule } from "../../Types/Exception/ErrorMessageRule";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN OPERATION NO PERMISSION ALLOWS, AS A SENTENCE (#7276).
 *
 * A table whose permission list for an operation is empty - an alert's
 * feed is never updated, an invoice never created or deleted, through the
 * Dashboard or the API - refused with "update on Alert Feed is not
 * allowed.": the operation in lower case first, and nothing about why. It
 * says now that nobody may, and that OneUptime keeps such records itself.
 */

describe("an operation no permission allows", () => {
  test.each([
    [
      "update",
      "Alert Feed",
      "Alert Feed records cannot be updated through the Dashboard or the API: OneUptime keeps them itself.",
    ],
    [
      "create",
      "Invoice",
      "Invoice records cannot be created through the Dashboard or the API: OneUptime keeps them itself.",
    ],
    [
      "delete",
      "Invoice",
      "Invoice records cannot be deleted through the Dashboard or the API: OneUptime keeps them itself.",
    ],
    [
      "read",
      "Workspace User Auth Token",
      "Workspace User Auth Token records cannot be read through the Dashboard or the API: OneUptime keeps them itself.",
    ],
  ])("%s on %s", (operation: string, recordName: string, words: string) => {
    const refusal: string = HeldPermissionsUtil.getNobodyMayRefusal({
      recordName: recordName,
      operation: operation,
    });

    expect(refusal).toBe(words);
    expect(meetsErrorMessageRule(refusal)).toBe(true);
  });

  test("a record with no name still reads as a sentence", () => {
    expect(
      HeldPermissionsUtil.getNobodyMayRefusal({
        recordName: undefined,
        operation: "update",
      }),
    ).toBe(
      "These records cannot be updated through the Dashboard or the API: OneUptime keeps them itself.",
    );
  });

  test("the database and the analytics models refuse with it", () => {
    const packages: string = path.resolve(__dirname, "../../..");

    for (const file of [
      "Common/Server/Types/Database/Permissions/TablePermission.ts",
      "Common/Server/Types/AnalyticsDatabase/ModelPermission.ts",
    ]) {
      const source: string = fs.readFileSync(path.join(packages, file), "utf8");

      expect({ file, uses: source.includes("getNobodyMayRefusal({") }).toEqual({
        file,
        uses: true,
      });
      expect({ file, old: source.includes("is not allowed.`") }).toEqual({
        file,
        old: false,
      });
    }
  });
});
