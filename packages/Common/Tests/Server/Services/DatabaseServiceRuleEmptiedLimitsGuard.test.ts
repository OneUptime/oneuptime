import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * GUARD: no delete leaves a rule matching every record because the records
 * it was limited to are gone (#9066).
 *
 * The database takes a deleted record out of every rule's list, and an
 * empty list puts no limit on a rule. RuleEmptiedLimits switches such a rule
 * off - but only for the deletes that go through it. DatabaseService has two
 * DELETE statements, a delete's and a retention purge's (hardDeleteBy), and
 * each goes through deleteSwitchingOffEmptiedRules, which switches the rules
 * off first and puts them back if the DELETE fails. And a write that
 * switches a rule on is held back while a list its note names is empty, and
 * clears the note once it is done.
 *
 * RuleEmptiedLimitsPostgres.test.ts holds the same on a real Postgres:
 * every list of every rule kind, through both deletes and the update.
 */

const SOURCE: string = fs.readFileSync(
  path.resolve(__dirname, "../../../Server/Services/DatabaseService.ts"),
  "utf8",
);

// A DELETE statement DatabaseService sends.
const DELETE_STATEMENT: RegExp = /this\.getRepository\(\)\.delete\(/g;

describe("DatabaseService: rules limited to deleted records", () => {
  test("has exactly the two DELETE statements this guard knows", () => {
    expect(SOURCE.match(DELETE_STATEMENT)).toHaveLength(2);
  });

  test("sends every DELETE from inside deleteSwitchingOffEmptiedRules", () => {
    for (const match of SOURCE.matchAll(DELETE_STATEMENT)) {
      const before: string = SOURCE.slice(
        Math.max(0, (match.index || 0) - 600),
        match.index,
      );

      // With who deleted them: the author of the switch-off in its audit trail.
      expect(before).toMatch(
        /this\.deleteSwitchingOffEmptiedRules\(\s*items,\s*deleteBy\.props,\s*async \(\): Promise<number> => \{/,
      );
    }
  });

  test("switches the rules off before the DELETE, puts them back if it fails, and checks again after it", () => {
    const helper: string = SOURCE.slice(
      SOURCE.indexOf("private async deleteSwitchingOffEmptiedRules("),
    );
    const body: string = helper.slice(0, helper.indexOf("\n  }\n") + 4);

    const beforeDelete: number = body.indexOf(
      "RuleEmptiedLimits.beforeDelete(",
    );
    const deleteRows: number = body.indexOf("await deleteRows()");
    const afterFailed: number = body.indexOf(
      "RuleEmptiedLimits.afterDeleteFailed(",
    );
    const afterDelete: number = body.indexOf("RuleEmptiedLimits.afterDelete(");

    expect(beforeDelete).toBeGreaterThan(-1);
    expect(deleteRows).toBeGreaterThan(beforeDelete);
    expect(afterFailed).toBeGreaterThan(deleteRows);
    expect(afterDelete).toBeGreaterThan(afterFailed);
    // A failed DELETE is thrown on, after the rules are put back.
    expect(body.slice(afterFailed)).toMatch(/throw error;/);
    // And it is the table of the rows deleted that is asked about, by whom.
    expect(body).toMatch(/recordTable: this\.model\.tableName/);
    expect(body).toMatch(/props: props/);
  });

  test("holds back a switch-on of a rule before any row is written, and clears its note after", () => {
    const updateBy: string = SOURCE.slice(
      SOURCE.indexOf("private async _updateBy("),
    );
    const body: string = updateBy.slice(
      0,
      updateBy.indexOf("\n  @CaptureSpan()"),
    );

    const caught: number = body.indexOf("const ruleSwitchOn:");
    const sanitized: number = body.indexOf("this.sanitizeCreateOrUpdate(");
    const refused: number = body.indexOf(
      "RuleEmptiedLimits.refuseSwitchOnWhileEmptied(",
    );
    const written: number = body.indexOf("for (const item of items)");
    const cleared: number = body.indexOf(
      "RuleEmptiedLimits.clearAfterSwitchOn(",
    );
    const success: number = body.indexOf("await this.onUpdateSuccess(");

    // Read as the caller wrote it, before what is stored is worked out.
    expect(caught).toBeGreaterThan(-1);
    expect(sanitized).toBeGreaterThan(caught);
    expect(body.slice(caught, sanitized)).toMatch(
      /this\.model instanceof RuleBaseModel/,
    );
    expect(body.slice(caught, sanitized)).toMatch(/\["isEnabled"\] === true/);

    expect(refused).toBeGreaterThan(sanitized);
    expect(written).toBeGreaterThan(refused);
    expect(cleared).toBeGreaterThan(written);
    expect(success).toBeGreaterThan(cleared);
  });
});
