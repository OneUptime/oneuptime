import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getAutoRechargeAmountOptions,
  getAutoRechargeColumns,
  getAutoRechargeFormFields,
  getAutoRechargeSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/AutoRechargeCard";
import {
  AUTO_RECHARGE_AMOUNT_TITLE,
  AUTO_RECHARGE_AMOUNTS_IN_USD,
  AUTO_RECHARGE_OFF,
  AUTO_RECHARGE_ON_TEMPLATE,
  AUTO_RECHARGE_SWITCH_DESCRIPTION,
  AUTO_RECHARGE_THRESHOLD_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/ProjectBalanceCopy";
import Project from "../../../Models/DatabaseModels/Project";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";

/*
 * A project balance's Auto Recharge card (Dashboard/src/Components/
 * ProjectBalance/AutoRechargeCard), drawn the same way for the SMS, call,
 * WhatsApp and Telegram balance (Notification Settings) and the AI credits
 * (AI Credits):
 *
 *   - the card says in one line what Auto Recharge does - "Off", or "Adds
 *     20 USD whenever the balance falls to 10 USD." - where it showed a
 *     switch and two amounts, the amounts even while it was off (and one
 *     of the two pages called the threshold row the amount);
 *   - its Edit dialog asks whether to recharge automatically, then the two
 *     amounts only once that is on;
 *   - each amount is offered once (500 was offered twice).
 *
 * The three columns each balance keeps are unchanged.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const BALANCES: Array<ProjectBalanceType> = [
  ProjectBalanceType.SmsOrCall,
  ProjectBalanceType.AI,
];

function keyOf(field: ModelField<Project>): string {
  return Object.keys(field.field || {})[0] || "";
}

describe("the columns each balance's card reads and writes", () => {
  test.each(BALANCES)(
    "%s: its switch, how much is added, and when",
    (balance: ProjectBalanceType) => {
      const columns: ReturnType<typeof getAutoRechargeColumns> =
        getAutoRechargeColumns(balance);

      expect([columns.enable, columns.amount, columns.threshold]).toEqual([
        ...PROJECT_BALANCE_AUTO_RECHARGE_COLUMNS[balance],
      ]);
    },
  );

  test("the two balances keep columns of their own", () => {
    const sms: ReturnType<typeof getAutoRechargeColumns> =
      getAutoRechargeColumns(ProjectBalanceType.SmsOrCall);
    const ai: ReturnType<typeof getAutoRechargeColumns> =
      getAutoRechargeColumns(ProjectBalanceType.AI);

    expect(sms.enable).toBe("enableAutoRechargeSmsOrCallBalance");
    expect(ai.enable).toBe("enableAutoRechargeAiBalance");
    expect(new Set([...Object.values(sms), ...Object.values(ai)]).size).toBe(6);
  });
});

describe("what the card says", () => {
  test.each(BALANCES)(
    "%s: Off while Auto Recharge is off, whatever the amounts",
    (balance: ProjectBalanceType) => {
      const columns: ReturnType<typeof getAutoRechargeColumns> =
        getAutoRechargeColumns(balance);

      for (const enable of [false, undefined, null]) {
        expect(
          getAutoRechargeSummary({
            project: {
              [columns.enable]: enable,
              [columns.amount]: 20,
              [columns.threshold]: 10,
            },
            balance,
            translator: ENGLISH,
          }),
        ).toBe(AUTO_RECHARGE_OFF);
      }
    },
  );

  test.each(BALANCES)(
    "%s: once it is on, how much it adds and when, in one sentence",
    (balance: ProjectBalanceType) => {
      const columns: ReturnType<typeof getAutoRechargeColumns> =
        getAutoRechargeColumns(balance);

      expect(
        getAutoRechargeSummary({
          project: {
            [columns.enable]: true,
            [columns.amount]: 20,
            [columns.threshold]: 10,
          },
          balance,
          translator: ENGLISH,
        }),
      ).toBe("Adds 20 USD whenever the balance falls to 10 USD.");
    },
  );

  test("reads only its own balance's columns", () => {
    const sms: ReturnType<typeof getAutoRechargeColumns> =
      getAutoRechargeColumns(ProjectBalanceType.SmsOrCall);

    // The SMS balance is on; the AI credits are not.
    const project: Record<string, unknown> = {
      [sms.enable]: true,
      [sms.amount]: 50,
      [sms.threshold]: 25,
    };

    expect(
      getAutoRechargeSummary({
        project,
        balance: ProjectBalanceType.AI,
        translator: ENGLISH,
      }),
    ).toBe(AUTO_RECHARGE_OFF);
    expect(
      getAutoRechargeSummary({
        project,
        balance: ProjectBalanceType.SmsOrCall,
        translator: ENGLISH,
      }),
    ).toBe("Adds 50 USD whenever the balance falls to 25 USD.");
  });

  test("is one translatable sentence with both amounts in it", () => {
    expect(AUTO_RECHARGE_ON_TEMPLATE).toBe(
      "Adds {{amount}} USD whenever the balance falls to {{threshold}} USD.",
    );

    const german: Translator = createTranslator((key: string) => {
      return key === AUTO_RECHARGE_ON_TEMPLATE
        ? "Fügt {{amount}} USD hinzu, sobald das Guthaben auf {{threshold}} USD fällt."
        : undefined;
    }, "de");
    const columns: ReturnType<typeof getAutoRechargeColumns> =
      getAutoRechargeColumns(ProjectBalanceType.AI);

    expect(
      getAutoRechargeSummary({
        project: {
          [columns.enable]: true,
          [columns.amount]: 100,
          [columns.threshold]: 20,
        },
        balance: ProjectBalanceType.AI,
        translator: german,
      }),
    ).toBe("Fügt 100 USD hinzu, sobald das Guthaben auf 20 USD fällt.");
  });
});

describe("the Edit dialog", () => {
  test.each(BALANCES)(
    "%s: the switch first, then the two amounts",
    (balance: ProjectBalanceType) => {
      const columns: ReturnType<typeof getAutoRechargeColumns> =
        getAutoRechargeColumns(balance);
      const fields: Array<ModelField<Project>> =
        getAutoRechargeFormFields(balance);

      expect(fields.map(keyOf)).toEqual([
        columns.enable,
        columns.amount,
        columns.threshold,
      ]);

      const [toggle, amount, threshold] = fields as [
        ModelField<Project>,
        ModelField<Project>,
        ModelField<Project>,
      ];

      expect(toggle.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(toggle.title).toBe("Enable Auto Recharge");
      expect(toggle.description).toBe(AUTO_RECHARGE_SWITCH_DESCRIPTION);
      expect(toggle.showIf).toBeUndefined();

      expect(amount.title).toBe(AUTO_RECHARGE_AMOUNT_TITLE);
      expect(threshold.title).toBe(AUTO_RECHARGE_THRESHOLD_TITLE);

      for (const field of [amount, threshold]) {
        expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
        // Their column's own sentence was written for the API.
        expect(field.hideColumnDescription).toBe(true);
      }
    },
  );

  test.each(BALANCES)(
    "%s: asks for the amounts only once Auto Recharge is on, and then requires them",
    (balance: ProjectBalanceType) => {
      const columns: ReturnType<typeof getAutoRechargeColumns> =
        getAutoRechargeColumns(balance);
      const [, amount, threshold] = getAutoRechargeFormFields(balance) as [
        ModelField<Project>,
        ModelField<Project>,
        ModelField<Project>,
      ];

      const off: FormValues<Project> = {
        [columns.enable]: false,
      } as unknown as FormValues<Project>;
      const on: FormValues<Project> = {
        [columns.enable]: true,
      } as unknown as FormValues<Project>;
      const neverSet: FormValues<Project> = {} as FormValues<Project>;

      for (const field of [amount, threshold]) {
        expect(field.showIf!(off)).toBe(false);
        expect(field.showIf!(neverSet)).toBe(false);
        expect(field.showIf!(on)).toBe(true);

        const required: (values: FormValues<Project>) => boolean =
          field.required as (values: FormValues<Project>) => boolean;

        expect(required(off)).toBe(false);
        expect(required(on)).toBe(true);
      }
    },
  );

  test("offers each amount once, as so many USD", () => {
    const options: Array<DropdownOption> = getAutoRechargeAmountOptions();
    const values: Array<unknown> = options.map(
      (option: DropdownOption): unknown => {
        return option.value;
      },
    );

    expect(values).toEqual([...AUTO_RECHARGE_AMOUNTS_IN_USD]);
    expect(new Set(values).size).toBe(values.length);

    for (const option of options) {
      expect(option.label).toBe(`${option.value} USD`);
    }
  });
});

describe("both pages draw the one card", () => {
  const PAGES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Pages/Settings",
  );

  test.each([
    ["NotificationSettings.tsx", "ProjectBalanceType.SmsOrCall"],
    ["AICredits.tsx", "ProjectBalanceType.AI"],
  ])("%s", (file: string, balance: string) => {
    const source: string = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");

    expect(source).toContain("<AutoRechargeCard");
    expect(source).toContain(`balance={${balance}}`);
    // No second copy of the card's fields on the page itself.
    expect(source).not.toContain("Enable Auto Recharge");
    expect(source).not.toMatch(/autoRecharge\w*InUSD: true/i);
  });
});
