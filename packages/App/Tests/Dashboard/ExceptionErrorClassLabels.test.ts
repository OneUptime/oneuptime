import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ErrorClass from "Common/Types/Telemetry/ErrorClass";
import {
  ERROR_CLASS_DISPLAY_NAMES,
  getErrorClassBadgeLabel,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionErrorClassLabels";

describe("exception error class labels", () => {
  test("labels every ErrorClass value", () => {
    for (const value of Object.values(ErrorClass)) {
      expect(ERROR_CLASS_DISPLAY_NAMES[value]).toBeTruthy();
    }
  });

  test.each([
    [ErrorClass.CodeFault, "Code fault"],
    [ErrorClass.UserError, "User error"],
    [ErrorClass.ExpectedDenial, "Expected denial"],
    [ErrorClass.Infrastructure, "Infrastructure"],
  ])("the header badge for %s reads %s", (value: string, label: string) => {
    expect(getErrorClassBadgeLabel(value)).toBe(label);
  });

  test.each([
    ["unclassified", ErrorClass.Unknown],
    ["a value outside the vocabulary", "flaky"],
    ["a missing value", undefined],
    ["a non-string", 42],
  ])("shows no header badge for %s", (_name: string, value: unknown) => {
    expect(getErrorClassBadgeLabel(value)).toBeNull();
  });

  test("the exceptions list keeps using the shared labels", () => {
    // Guards against the list growing its own copy of the map again.
    const viewer: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "Exceptions",
        "ExceptionsViewer.tsx",
      ),
      "utf8",
    );

    expect(viewer).toContain(
      'import { ERROR_CLASS_DISPLAY_NAMES } from "../../Utils/ExceptionErrorClassLabels";',
    );
    expect(viewer).not.toContain("const ERROR_CLASS_DISPLAY_NAMES");
  });
});
