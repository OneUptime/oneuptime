/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A rule OneUptime switched off because every record a list of it was
 * limited to was deleted (#9066) says so beside its status in a table of
 * rules, and above what it applies to on its form: what was deleted, from
 * which list, when, and what to do. Pinned here: the sentences, in English
 * and through the Dashboard's own German and Persian files; the pill's
 * description, which a screen reader reads; the form's alert; and which
 * column of a table the pill is drawn in.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { RuleEmptiedLimit } from "../../../../Types/Rules/RuleEmptiedLimit";
import type Column from "../../../../UI/Components/ModelTable/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  getRuleEmptiedLimitLines,
  getRuleEmptiedLimits,
  getRuleEmptiedLimitsExplanation,
  RULE_EMPTIED_LIMITS_ALERT_TEST_ID,
  RULE_EMPTIED_LIMITS_TEST_ID,
  RuleEmptiedLimitsAlert,
  RuleEmptiedLimitsPill,
  withRuleEmptiedLimitsMarker,
} from "../../../../UI/Components/RuleCriteria/RuleEmptiedLimitsNote";
import {
  createTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";
import englishLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

type Locale = Record<string, string>;

const translatorFor: (locale: Locale, language: string) => Translator = (
  locale: Locale,
  language: string,
): Translator => {
  return createTranslator((text: string) => {
    return locale[text];
  }, language);
};

const ENGLISH: Translator = translatorFor(
  englishLocale as unknown as Locale,
  "en",
);
const GERMAN: Translator = translatorFor(
  germanLocale as unknown as Locale,
  "de",
);
const PERSIAN: Translator = translatorFor(
  persianLocale as unknown as Locale,
  "fa",
);

const MONITORS_DELETED: RuleEmptiedLimit = {
  list: "monitors",
  names: ["Checkout"],
  count: 1,
  deletedAt: "2026-11-16T10:00:00.000Z",
  switchedOff: true,
};

const RULE: IncidentOnCallRule = new IncidentOnCallRule();

afterEach(() => {
  cleanup();
});

describe("the note's sentences", () => {
  test("say the list as its form names it, the record and the day it was deleted", () => {
    expect(
      getRuleEmptiedLimitLines({
        model: RULE,
        emptiedLimits: [MONITORS_DELETED],
        translator: ENGLISH,
      }),
    ).toEqual(["Monitors: Checkout, deleted Nov 16, 2026."]);
  });

  test("name the first records and count the rest", () => {
    expect(
      getRuleEmptiedLimitLines({
        model: RULE,
        emptiedLimits: [
          {
            ...MONITORS_DELETED,
            list: "monitorLabels",
            names: ["Alpha", "Beta", "Eta", "Kappa", "Mu"],
            count: 7,
          },
        ],
        translator: ENGLISH,
      }),
    ).toEqual([
      "Monitor Labels: Alpha, Beta, Eta, Kappa, Mu and 2 more, deleted Nov 16, 2026.",
    ]);
  });

  test("say one line a list, then that OneUptime switched the rule off, then what to do", () => {
    expect(
      getRuleEmptiedLimitsExplanation({
        model: RULE,
        emptiedLimits: [
          MONITORS_DELETED,
          {
            ...MONITORS_DELETED,
            list: "incidentSeverities",
            names: ["Sev 0"],
          },
        ],
        translator: ENGLISH,
      }),
    ).toBe(
      "Monitors: Checkout, deleted Nov 16, 2026. Incident Severities: Sev 0, deleted Nov 16, 2026. OneUptime switched this rule off when they were deleted. Switched on as it is, the rule would not be limited by these lists at all. Edit it to choose what it applies to, then switch it on.",
    );
  });

  test("leave out that OneUptime switched it off when the rule was off already", () => {
    const explanation: string = getRuleEmptiedLimitsExplanation({
      model: RULE,
      emptiedLimits: [{ ...MONITORS_DELETED, switchedOff: false }],
      translator: ENGLISH,
    });

    expect(explanation).not.toContain("OneUptime switched this rule off");
    expect(explanation).toContain("Edit it to choose what it applies to");
  });

  test("read in German, the list's name included", () => {
    const explanation: string = getRuleEmptiedLimitsExplanation({
      model: RULE,
      emptiedLimits: [MONITORS_DELETED],
      translator: GERMAN,
    });

    expect(explanation).toContain("Monitore: Checkout, gelöscht am");
    expect(explanation).toContain(
      "OneUptime hat diese Regel deaktiviert, als sie gelöscht wurden.",
    );
    expect(explanation).toContain("aktivieren Sie sie dann.");
    expect(explanation).not.toContain("Switched on as it is");
  });

  test("read in Persian, from the right", () => {
    const explanation: string = getRuleEmptiedLimitsExplanation({
      model: RULE,
      emptiedLimits: [MONITORS_DELETED],
      translator: PERSIAN,
    });

    expect(explanation).toContain("مانیتورها");
    expect(explanation).toContain("Checkout");
    expect(explanation).toContain("غیرفعال کرد");
    expect(explanation).not.toContain("deleted");
  });

  test("count records that had no name", () => {
    expect(
      getRuleEmptiedLimitLines({
        model: new HostLabelRule(),
        emptiedLimits: [
          { ...MONITORS_DELETED, list: "hostLabels", names: [], count: 2 },
        ],
        translator: ENGLISH,
      }),
    ).toEqual(["Host Labels: 2, deleted Nov 16, 2026."]);
  });
});

describe("a rule's note, read from the rule", () => {
  test("is its entries, and nothing for a rule with none or anything else", () => {
    expect(
      getRuleEmptiedLimits(
        Object.assign(new IncidentOnCallRule(), {
          emptiedLimits: [MONITORS_DELETED],
        }),
      ),
    ).toEqual([MONITORS_DELETED]);
    expect(getRuleEmptiedLimits(new IncidentOnCallRule())).toEqual([]);
    expect(getRuleEmptiedLimits({ emptiedLimits: "broken" })).toEqual([]);
    expect(getRuleEmptiedLimits(null)).toEqual([]);
  });
});

describe("the pill beside a rule's status", () => {
  test("says Limited to deleted records, and to a screen reader what was deleted and what to do", () => {
    render(
      <RuleEmptiedLimitsPill model={RULE} emptiedLimits={[MONITORS_DELETED]} />,
    );

    const pill: HTMLElement = screen.getByTestId(RULE_EMPTIED_LIMITS_TEST_ID);
    expect(pill).toHaveTextContent("Limited to deleted records");

    const button: HTMLElement = within(pill).getByRole("button", {
      name: "Limited to deleted records",
    });
    expect(button).toHaveAccessibleDescription(
      "Monitors: Checkout, deleted Nov 16, 2026. OneUptime switched this rule off when they were deleted. Switched on as it is, the rule would not be limited by these lists at all. Edit it to choose what it applies to, then switch it on.",
    );
  });

  test("is not drawn for a rule with no note", () => {
    render(<RuleEmptiedLimitsPill model={RULE} emptiedLimits={[]} />);

    expect(screen.queryByTestId(RULE_EMPTIED_LIMITS_TEST_ID)).toBeNull();
  });
});

describe("the alert on a rule's form", () => {
  test("says what was deleted, that OneUptime switched the rule off, and what to do", () => {
    render(
      <RuleEmptiedLimitsAlert
        model={RULE}
        emptiedLimits={[MONITORS_DELETED]}
      />,
    );

    const alert: HTMLElement = screen.getByTestId(
      RULE_EMPTIED_LIMITS_ALERT_TEST_ID,
    );
    expect(alert).toHaveTextContent("Limited to deleted records");
    expect(alert).toHaveTextContent(
      "Monitors: Checkout, deleted Nov 16, 2026.",
    );
    expect(alert).toHaveTextContent(
      "OneUptime switched this rule off when they were deleted.",
    );
    expect(alert).toHaveTextContent(
      "Edit it to choose what it applies to, then switch it on.",
    );
  });

  test("is not drawn for a rule with no note", () => {
    render(<RuleEmptiedLimitsAlert model={RULE} emptiedLimits={[]} />);

    expect(screen.queryByTestId(RULE_EMPTIED_LIMITS_ALERT_TEST_ID)).toBeNull();
  });
});

describe("a table of rules", () => {
  const status: Column<IncidentOnCallRule> = {
    field: { isEnabled: true },
    title: "Status",
    type: FieldType.Boolean,
    getElement: (item: IncidentOnCallRule): ReactElement => {
      return <span>{item.isEnabled ? "Enabled" : "Disabled"}</span>;
    },
  };
  const name: Column<IncidentOnCallRule> = {
    field: { name: true },
    title: "Name",
    type: FieldType.Text,
    getElement: (item: IncidentOnCallRule): ReactElement => {
      return <span>{item.name}</span>;
    },
  };

  test("draws the pill beside the status of a rule with a note, and leaves every other cell as it was", () => {
    const columns: Array<Column<IncidentOnCallRule>> =
      withRuleEmptiedLimitsMarker(RULE, [name, status]);

    expect(columns[0]).toBe(name);

    const rule: IncidentOnCallRule = Object.assign(new IncidentOnCallRule(), {
      name: "Page Payments for Checkout",
      isEnabled: false,
      emptiedLimits: [MONITORS_DELETED],
    });

    render(<div>{columns[1]!.getElement!(rule)}</div>);

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByTestId(RULE_EMPTIED_LIMITS_TEST_ID)).toBeInTheDocument();
  });

  test("draws a rule with no note exactly as the page drew it", () => {
    const columns: Array<Column<IncidentOnCallRule>> =
      withRuleEmptiedLimitsMarker(RULE, [status]);

    render(
      <div data-testid="cell">
        {columns[0]!.getElement!(
          Object.assign(new IncidentOnCallRule(), { isEnabled: true }),
        )}
      </div>,
    );

    expect(screen.getByTestId("cell")).toHaveTextContent("Enabled");
    expect(screen.queryByTestId(RULE_EMPTIED_LIMITS_TEST_ID)).toBeNull();
  });

  test("leaves a table of anything but rules, and a status the page draws itself, alone", () => {
    const monitorColumns: Array<Column<Monitor>> = [
      status as unknown as Column<Monitor>,
    ];
    expect(withRuleEmptiedLimitsMarker(new Monitor(), monitorColumns)).toBe(
      monitorColumns,
    );

    const plainStatus: Column<IncidentOnCallRule> = {
      field: { isEnabled: true },
      title: "Status",
      type: FieldType.Boolean,
    };
    expect(withRuleEmptiedLimitsMarker(RULE, [plainStatus])[0]).toBe(
      plainStatus,
    );
  });
});
