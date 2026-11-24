import { getErrorInSentenceText } from "../../../UI/Utils/ErrorInSentence";
import { readRefusalValues } from "../../../Types/Exception/RefusalWithValues";
import {
  getPlanRequiredMessage,
  PLAN_REQUIRED_REFUSAL,
} from "../../../Types/Billing/PlanRequiredRefusal";
import {
  getUniqueValueTakenMessage,
  UNIQUE_VALUE_TAKEN_REFUSAL,
} from "../../../Types/Database/UniqueValueTaken";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A PLAN THE PROJECT DOES NOT HAVE, AND A VALUE ANOTHER RECORD HOLDS, IN
 * THE READER'S LANGUAGE (#7276).
 *
 * "Please upgrade your plan to Growth to access this feature" had no full
 * stop and did not say where a plan is changed; "Slug abc already exists.
 * Please choose a different Slug" ran the value into the sentence. Each is
 * a refusal with values now: the server answers in English, with the plan
 * or the column's title and the value in it, and the Dashboard reads them
 * back out and says the sentence in the reader's language around them.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");

describe("a feature the plan does not include", () => {
  const message: string = getPlanRequiredMessage("Growth");

  test("says which plan, and where to upgrade, as a sentence", () => {
    expect(message).toBe(
      "This feature needs the Growth plan or above. Upgrade the project's plan in Project Settings > Billing and Invoices > Billing, then try again.",
    );
    expect(meetsErrorMessageRule(message)).toBe(true);
  });

  test("its plan is read back out of the English", () => {
    expect(readRefusalValues(PLAN_REQUIRED_REFUSAL, message)).toEqual({
      plan: "Growth",
    });
    expect(
      readRefusalValues(PLAN_REQUIRED_REFUSAL, "Another sentence."),
    ).toBeNull();
  });

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "is said in %s with the plan as written",
    (language: string) => {
      const words: string = getErrorInSentenceText({
        message: getPlanRequiredMessage("Scale"),
        translator: dashboardTranslator(language),
      });

      expect(words).toContain("Scale");
      expect(words).not.toContain("This feature needs");
      expect(words).not.toContain("{{plan}}");
      expect(
        readDashboardLocale(language)[PLAN_REQUIRED_REFUSAL.template],
      ).not.toBe(PLAN_REQUIRED_REFUSAL.template);
    },
  );

  test("every plan check refuses with it, never the old words", () => {
    for (const file of [
      "Common/Server/Types/Database/Permissions/BillingPermission.ts",
      "Common/Server/Types/Database/Permissions/ColumnPermission.ts",
      "Common/Server/Types/AnalyticsDatabase/ModelPermission.ts",
      "Common/Server/API/TestSendAccess.ts",
    ]) {
      const source: string = fs.readFileSync(path.join(PACKAGES, file), "utf8");

      expect({
        file,
        uses: source.includes("getPlanRequiredMessage("),
      }).toEqual({ file, uses: true });
      expect({ file, old: source.includes("to access this feature") }).toEqual({
        file,
        old: false,
      });
    }
  });
});

describe("a value another record holds", () => {
  const message: string = getUniqueValueTakenMessage({
    field: "Slug",
    value: "payments-status",
  });

  test("says which value, quoted, and what to do, as a sentence", () => {
    expect(message).toBe(
      'Slug "payments-status" already exists. Choose another Slug, then try again.',
    );
    expect(meetsErrorMessageRule(message)).toBe(true);
  });

  test("its column and its value are read back out of the English", () => {
    expect(
      readRefusalValues(UNIQUE_VALUE_TAKEN_REFUSAL, message),
    ).toMatchObject({ value: "payments-status" });
  });

  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "is said in %s with the value as written",
    (language: string) => {
      const words: string = getErrorInSentenceText({
        message: message,
        translator: dashboardTranslator(language),
      });

      expect(words).toContain("payments-status");
      expect(words).not.toContain("already exists. Choose another");
      expect(
        readDashboardLocale(language)[UNIQUE_VALUE_TAKEN_REFUSAL.template],
      ).not.toBe(UNIQUE_VALUE_TAKEN_REFUSAL.template);
    },
  );

  test("the database's unique check refuses with it", () => {
    const source: string = fs.readFileSync(
      path.join(PACKAGES, "Common/Server/Services/DatabaseService.ts"),
      "utf8",
    );

    expect(source).toContain("getUniqueValueTakenMessage({");
    expect(source).not.toContain("Please choose a different");
  });
});
