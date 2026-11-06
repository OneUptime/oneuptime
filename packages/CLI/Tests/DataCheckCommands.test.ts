import { describe, expect, test } from "@jest/globals";
import { describeApplyResult } from "../Commands/DataCheckCommands";

describe("what apply says", () => {
  test("what went through only partly is said too", () => {
    expect(
      describeApplyResult({
        isDryRun: false,
        created: ["a"],
        updated: [],
        unchanged: [],
        removed: [],
        errors: [],
        warnings: ["a: saved, but its alert could not be set up: no"],
      }),
    ).toContain("its alert could not be set up");
  });

  test("what changed, in one line", () => {
    expect(
      describeApplyResult({
        isDryRun: false,
        created: ["a"],
        updated: ["b", "c"],
        unchanged: ["d"],
        removed: [],
        errors: [],
        warnings: [],
      }),
    ).toBe("Applied: 1 to create, 2 to update, 0 to remove, 1 unchanged.");
  });

  test("a dry run says it would", () => {
    expect(
      describeApplyResult({
        isDryRun: true,
        created: [],
        updated: [],
        unchanged: [],
        removed: ["a"],
        errors: [],
        warnings: [],
      }),
    ).toContain("Would apply");
  });

  test("a mistake means nothing was applied, and each is named", () => {
    const text: string = describeApplyResult({
      isDryRun: false,
      created: [],
      updated: [],
      unchanged: [],
      removed: [],
      errors: ["public.orders: Nope"],
      warnings: [],
    });

    expect(text).toContain("Nothing was applied");
    expect(text).toContain("public.orders: Nope");
  });
});
