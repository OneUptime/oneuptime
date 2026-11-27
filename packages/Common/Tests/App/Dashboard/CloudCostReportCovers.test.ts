import { describe, expect, test } from "@jest/globals";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import {
  SCOPE_WITH_NAME,
  getCoversText,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Reports";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostReport from "../../../Models/DatabaseModels/CloudCostReport";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import {
  CLOUD_COST_REPORT_SCOPE_LABELS,
  CloudCostReportPeriod,
  CloudCostReportScope,
} from "../../../Types/Cloud/CloudCostReport";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * What a cost report covers, in the Reports table's line (#11009): its
 * scope, the account, cost view or cost group it names, and its period.
 * The scope and the name are one sentence of each language's own
 * ("A cost view: {{name}}"), never a translated label with a name joined on
 * after a colon, so a language can put the name where its grammar wants it.
 */

type Locale = Record<string, string>;

const ENGLISH: Translator = createTranslator((text: string) => {
  return (englishLocale as unknown as Locale)[text];
}, "en");

// A language that words the scope after the name, as some do.
const NAME_FIRST: Translator = createTranslator((text: string) => {
  return (
    {
      "A cost view: {{name}}": "{{name}} (vue des coûts)",
      "One account: {{name}}": "{{name}} (un compte)",
      "Every account": "Tous les comptes",
      "Last week": "La semaine dernière",
    } as Locale
  )[text];
}, "fr");

function report(data: {
  scope: CloudCostReportScope;
  period?: CloudCostReportPeriod;
  accountName?: string;
  viewName?: string;
  groupName?: string;
}): CloudCostReport {
  const row: CloudCostReport = new CloudCostReport();
  row.scope = data.scope;
  row.period = data.period || CloudCostReportPeriod.LastWeek;

  if (data.accountName !== undefined) {
    const account: CloudAccount = new CloudAccount();
    account.name = data.accountName;
    row.cloudAccount = account;
  }

  if (data.viewName !== undefined) {
    const view: CloudCostView = new CloudCostView();
    view.name = data.viewName;
    row.cloudCostView = view;
  }

  if (data.groupName !== undefined) {
    const group: CloudCostGroup = new CloudCostGroup();
    group.name = data.groupName;
    row.cloudCostGroup = group;
  }

  return row;
}

describe("what a cost report covers, in a line", () => {
  test.each([
    [
      "a cost view",
      report({ scope: CloudCostReportScope.CostView, viewName: "By team" }),
      "A cost view: By team · Last week",
    ],
    [
      "a cost group",
      report({
        scope: CloudCostReportScope.CostGroup,
        groupName: "Platform",
        period: CloudCostReportPeriod.LastMonth,
      }),
      "A cost group: Platform · Last month",
    ],
    [
      "one account",
      report({
        scope: CloudCostReportScope.Account,
        accountName: "Production",
      }),
      "One account: Production · Last week",
    ],
    [
      "every account",
      report({ scope: CloudCostReportScope.AllAccounts }),
      "Every account · Last week",
    ],
  ])(
    "names %s in English as before",
    (_name: string, row: CloudCostReport, line: string) => {
      expect(getCoversText(row, ENGLISH)).toBe(line);
    },
  );

  test("a scope whose record is gone, or not read, says the scope alone", () => {
    expect(
      getCoversText(report({ scope: CloudCostReportScope.CostView }), ENGLISH),
    ).toBe("A cost view · Last week");
    expect(
      getCoversText(
        report({ scope: CloudCostReportScope.Account, accountName: "" }),
        ENGLISH,
      ),
    ).toBe("One account · Last week");
  });

  test("a language puts the name where its own sentence does", () => {
    expect(
      getCoversText(
        report({ scope: CloudCostReportScope.CostView, viewName: "By team" }),
        NAME_FIRST,
      ),
    ).toBe("By team (vue des coûts) · La semaine dernière");
    expect(
      getCoversText(
        report({ scope: CloudCostReportScope.AllAccounts }),
        NAME_FIRST,
      ),
    ).toBe("Tous les comptes · La semaine dernière");
  });

  test("the name is a value of the sentence, never read as a key", () => {
    expect(
      getCoversText(
        report({
          scope: CloudCostReportScope.CostGroup,
          groupName: "Every account",
        }),
        NAME_FIRST,
      ),
    ).toBe("A cost group: Every account · La semaine dernière");
  });

  test("every scope that names a record has a sentence of its own, and its label is the English the sentence starts with", () => {
    for (const scope of Object.values(CloudCostReportScope)) {
      const sentence: string | undefined = SCOPE_WITH_NAME[scope];

      if (scope === CloudCostReportScope.AllAccounts) {
        expect(sentence).toBeUndefined();
        continue;
      }

      expect(sentence).toBe(
        `${CLOUD_COST_REPORT_SCOPE_LABELS[scope]}: {{name}}`,
      );
      expect((englishLocale as unknown as Locale)[sentence!]).toBe(sentence);
    }
  });
});
