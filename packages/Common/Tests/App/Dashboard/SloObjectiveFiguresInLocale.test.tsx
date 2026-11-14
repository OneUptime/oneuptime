/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import SloSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/Settings";
import {
  SLO_ADVANCED_DEFAULTS_SUMMARY,
  SLO_CREATE_INITIAL_VALUES,
  SLO_FORM_ERRORS,
  SLO_TARGET_HELP_TEMPLATE,
  getSloAdvancedSummary,
  getSloFormFields,
  getSloTargetHelpText,
  pickSloFormFields,
  validateAtRiskThreshold,
  validateTargetPercentage,
  validateWindowDays,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import {
  SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE,
  describeSloErrorBudget,
  describeSloWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  createTranslator,
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";
import { formatSloPercent } from "../../../Utils/Slo/SloWidgetFormat";
import { drawLine, isDrawnAsWritten } from "../../Helpers/BidiLayout";
import { isolated } from "../../Helpers/IsolateMarks";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * AN SLO'S OBJECTIVE IN THE READER'S LANGUAGE (#6925), from the Dashboard's
 * shipped locale files:
 *
 *   - the create form's help under Target (%): "Over 30 days, 99.9% allows
 *     43 minutes of downtime and 99.99% about 4." - the same help on the
 *     Settings page's Edit Objective - and the folded Advanced section's
 *     summary of its defaults;
 *   - what the form's checks say of a target, an at-risk threshold or a
 *     window out of bounds, with the bounds in them;
 *   - the Settings page's Error Budget line, "43m 12s of downtime per
 *     30-day window" or "0.1% of each month: 43m 12s of downtime in a
 *     30-day month", and its Window line.
 *
 * The help was no key of the locales and read in English with English
 * figures on every page; the checks' sentences were English; and the
 * Settings lines wrote the budget "43m 12s" and the share "0.1 %" with an
 * English decimal point between German words. Every one is now worded by
 * the reader's language, its figures written the reader's way - and an
 * English reader reads each word for word as before.
 *
 * The help's and the summary's figures are set apart from their words: a
 * Persian sentence drew a share's sign on the figure's left, "٪۹۹٫۹", a
 * few lines under the Overview's "99.9%".
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

// German sets its percent sign apart with a no-break space: "99,9 %".
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

function germanPercent(figure: string): string {
  return `${figure}${NO_BREAK_SPACE}%`;
}

// A Latin digit: none is left on a Persian page.
const LATIN_DIGIT: RegExp = /[0-9]/;

// A figure with an English decimal point: "99.9", "0.1".
const DECIMAL_POINT: RegExp = /[0-9]\.[0-9]/;

/*
 * Whether `piece` of a sentence on a right-to-left page is drawn as it is
 * written (Tests/Helpers/BidiLayout): a share's figure, then its sign on
 * its right, as the Overview and the Settings page draw "99.9%".
 */
function isDrawnAsWrittenIn(sentence: string, piece: string): boolean {
  const from: number = sentence.indexOf(piece);

  expect({ piece, found: from >= 0 }).toEqual({ piece, found: true });

  return isDrawnAsWritten(drawLine(sentence, "rtl"), from, from + piece.length);
}

const ROLLING_ERROR_BUDGET_KEY: string =
  "{{budget}} of downtime per {{count}}-day window";
const ROLLING_WINDOW_KEY: string = "Rolling {{count}}-day window";

// 43m 12s: what 99.9% leaves of 30 days.
const THIRTY_DAY_BUDGET_SECONDS: number = 2592;

function form(
  values: Record<string, unknown>,
): FormValues<ServiceLevelObjective> {
  return values as FormValues<ServiceLevelObjective>;
}

function targetField(
  fields: Array<ModelField<ServiceLevelObjective>>,
): ModelField<ServiceLevelObjective> {
  return fields.find((field: ModelField<ServiceLevelObjective>): boolean => {
    return Object.keys(field.field || {})[0] === "targetPercentage";
  }) as ModelField<ServiceLevelObjective>;
}

// A language's translator, as a page in that language is handed it.
function translatorFor(
  language: string,
  locale: Record<string, string>,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the create form's help under Target (%) (#6925)", () => {
  test("English: word for word as before", () => {
    const help: string =
      "The share of time its monitors must be up. Over 30 days, 99.9% allows 43 minutes of downtime and 99.99% about 4.";

    expect(getSloTargetHelpText()).toBe(help);
    expect(targetField(getSloFormFields()).description).toBe(help);
  });

  test("German: worded in German, with a decimal comma and the German percent", async () => {
    await i18next.changeLanguage("de");

    const help: string = worded(DE, SLO_TARGET_HELP_TEMPLATE, {
      days: "30",
      target: germanPercent("99,9"),
      minutes: "43",
      stricterTarget: germanPercent("99,99"),
      stricterMinutes: "4",
    });

    expect(getSloTargetHelpText()).toBe(help);
    // The form is built in the language of the moment.
    expect(targetField(getSloFormFields()).description).toBe(help);
    // And Edit Objective on the Settings page holds the same help.
    expect(
      targetField(pickSloFormFields(["targetPercentage"])).description,
    ).toBe(help);
    expect(help).not.toMatch(DECIMAL_POINT);
  });

  test("Persian: Persian digits and percent, not one Latin digit", async () => {
    await i18next.changeLanguage("fa");

    const help: string = targetField(getSloFormFields()).description as string;

    expect(help).toBe(
      worded(FA, SLO_TARGET_HELP_TEMPLATE, {
        days: isolated("۳۰"),
        target: isolated("۹۹٫۹٪"),
        minutes: isolated("۴۳"),
        stricterTarget: isolated("۹۹٫۹۹٪"),
        stricterMinutes: isolated("۴"),
      }),
    );
    expect(help).not.toMatch(LATIN_DIGIT);
  });

  test("Persian and Arabic: each share drawn with its sign on its right, as the Overview draws one", async () => {
    for (const language of ["fa", "ar"]) {
      await i18next.changeLanguage(language);

      const help: string = getSloTargetHelpText();

      for (const target of [99.9, 99.99]) {
        const written: string = formatSloPercent(
          target,
          3,
          getGlobalTranslator(),
        ) as string;

        expect({
          language,
          written,
          drawnAsWritten: isDrawnAsWrittenIn(help, written),
        }).toEqual({ language, written, drawnAsWritten: true });
      }
    }

    // The help as it was filled before, its shares in the words: drawn "٪۹۹٫۹".
    const before: string = worded(FA, SLO_TARGET_HELP_TEMPLATE, {
      days: "۳۰",
      target: "۹۹٫۹٪",
      minutes: "۴۳",
      stricterTarget: "۹۹٫۹۹٪",
      stricterMinutes: "۴",
    });

    expect(isDrawnAsWrittenIn(before, "۹۹٫۹٪")).toBe(false);
  });

  test("a translator handed in wins over the language of the moment", () => {
    expect(getSloTargetHelpText(translatorFor("de", DE))).toContain(
      germanPercent("99,9"),
    );
    expect(getSloTargetHelpText()).toContain("99.9%");
  });

  test("the field's label reads the help as given: no key of the locales rewrites it", async () => {
    for (const language of ["en", "de", "fa", "ar"]) {
      await i18next.changeLanguage(language);

      const help: string = getSloTargetHelpText();

      expect({
        language,
        read: getGlobalTranslator().translateText(help),
      }).toEqual({ language, read: help });
    }
  });
});

describe("the create form's Advanced summary and field help (#6925)", () => {
  test("English: the summary word for word as before", () => {
    expect(getSloAdvancedSummary(SLO_CREATE_INITIAL_VALUES)).toEqual([
      "Measured over a rolling 30-day window, and At Risk when less than 20% of the error budget is left.",
    ]);
  });

  test("Persian: the summary's 30 and 20% in Persian digits, the share drawn with its sign on its right", async () => {
    await i18next.changeLanguage("fa");

    const summary: Array<string> = getSloAdvancedSummary(
      SLO_CREATE_INITIAL_VALUES,
    ) as Array<string>;

    expect(summary).toEqual([
      worded(FA, SLO_ADVANCED_DEFAULTS_SUMMARY, {
        days: isolated("۳۰"),
        threshold: isolated("۲۰٪"),
      }),
    ]);
    expect(summary[0]).not.toMatch(LATIN_DIGIT);
    expect(isDrawnAsWrittenIn(summary[0] as string, "۲۰٪")).toBe(true);
  });

  test("German and Arabic: the summary's share written the reader's way", async () => {
    await i18next.changeLanguage("de");

    expect(getSloAdvancedSummary(SLO_CREATE_INITIAL_VALUES)).toEqual([
      worded(DE, SLO_ADVANCED_DEFAULTS_SUMMARY, {
        days: "30",
        threshold: germanPercent("20"),
      }),
    ]);

    await i18next.changeLanguage("ar");

    const summary: string = (
      getSloAdvancedSummary(SLO_CREATE_INITIAL_VALUES) as Array<string>
    )[0] as string;
    const threshold: string = formatSloPercent(
      20,
      0,
      getGlobalTranslator(),
    ) as string;

    expect(summary).toContain(isolated(threshold));
    expect(isDrawnAsWrittenIn(summary, threshold)).toBe(true);
  });

  test("Persian: the Advanced fields' help and the description's example write Persian digits", () => {
    for (const key of [
      "The SLO turns At Risk when less than this share of its error budget is left. 20 by default.",
      "How many days the rolling window looks back, from 1 to 366. 28 or 30 is typical: a shorter window forgets downtime sooner, but also allows less of it.",
      "99.9% availability for the public API",
    ]) {
      const text: string = worded(FA, key);

      expect({ key, latinDigit: LATIN_DIGIT.test(text) }).toEqual({
        key,
        latinDigit: false,
      });
    }

    // And the form still asks for each of them by its English key.
    const keys: Array<unknown> = getSloFormFields().flatMap(
      (field: ModelField<ServiceLevelObjective>): Array<unknown> => {
        return [field.description, field.placeholder];
      },
    );

    expect(keys).toEqual(
      expect.arrayContaining([
        "The SLO turns At Risk when less than this share of its error budget is left. 20 by default.",
        "How many days the rolling window looks back, from 1 to 366. 28 or 30 is typical: a shorter window forgets downtime sooner, but also allows less of it.",
        "99.9% availability for the public API",
      ]),
    );
  });
});

describe("what the form's checks say (#6925)", () => {
  test("English: every sentence word for word as before", () => {
    expect(validateTargetPercentage(form({ targetPercentage: 0 }))).toBe(
      "Target must be greater than 0 and at most 99.999.",
    );
    expect(validateTargetPercentage(form({ targetPercentage: 100 }))).toBe(
      "Target must be greater than 0 and at most 99.999.",
    );
    expect(
      validateAtRiskThreshold(form({ atRiskThresholdPercentage: 150 })),
    ).toBe("At-risk threshold must be a percentage between 0 and 100.");
    expect(
      validateAtRiskThreshold(form({ atRiskThresholdPercentage: 20.5 })),
    ).toBe("At-risk threshold must be a whole number.");
    expect(validateWindowDays(form({ windowDays: 400 }))).toBe(
      "Window must be between 1 and 366 days.",
    );
    expect(validateWindowDays(form({ windowDays: 30.5 }))).toBe(
      "Window must be a whole number of days.",
    );
  });

  test("German: worded in German, the target's bound with a decimal comma", async () => {
    await i18next.changeLanguage("de");

    expect(validateTargetPercentage(form({ targetPercentage: -1 }))).toBe(
      worded(DE, SLO_FORM_ERRORS.target, { min: "0", max: "99,999" }),
    );
    expect(
      validateAtRiskThreshold(form({ atRiskThresholdPercentage: 101 })),
    ).toBe(
      worded(DE, SLO_FORM_ERRORS.atRiskThresholdRange, {
        min: "0",
        max: "100",
      }),
    );
    expect(
      validateAtRiskThreshold(form({ atRiskThresholdPercentage: 2.5 })),
    ).toBe(worded(DE, SLO_FORM_ERRORS.atRiskThresholdWhole));
    expect(validateWindowDays(form({ windowDays: 0 }))).toBe(
      worded(DE, SLO_FORM_ERRORS.windowDaysRange, { min: "1", max: "366" }),
    );
    expect(validateWindowDays(form({ windowDays: 7.5 }))).toBe(
      worded(DE, SLO_FORM_ERRORS.windowDaysWhole),
    );
  });

  test("Persian: the bounds in Persian digits, its decimal separator too", async () => {
    await i18next.changeLanguage("fa");

    const messages: Array<string | null> = [
      validateTargetPercentage(form({ targetPercentage: 0 })),
      validateAtRiskThreshold(form({ atRiskThresholdPercentage: 150 })),
      validateWindowDays(form({ windowDays: 400 })),
    ];

    expect(messages).toEqual([
      worded(FA, SLO_FORM_ERRORS.target, { min: "۰", max: "۹۹٫۹۹۹" }),
      worded(FA, SLO_FORM_ERRORS.atRiskThresholdRange, {
        min: "۰",
        max: "۱۰۰",
      }),
      worded(FA, SLO_FORM_ERRORS.windowDaysRange, { min: "۱", max: "۳۶۶" }),
    ]);

    for (const message of messages) {
      expect(message).not.toMatch(LATIN_DIGIT);
    }
  });

  test("a value in bounds is no error, in any language", async () => {
    for (const language of ["en", "de", "fa"]) {
      await i18next.changeLanguage(language);

      expect([
        validateTargetPercentage(form({ targetPercentage: 99.999 })),
        validateAtRiskThreshold(form({ atRiskThresholdPercentage: 0 })),
        validateWindowDays(form({ windowDays: 366 })),
      ]).toEqual([null, null, null]);
    }
  });

  test("the field shows each sentence as given: no key of the locales rewrites it", async () => {
    for (const language of ["de", "fa", "ar"]) {
      await i18next.changeLanguage(language);

      const message: string = validateWindowDays(
        form({ windowDays: 400 }),
      ) as string;

      expect(getGlobalTranslator().translateText(message)).toBe(message);
    }
  });
});

describe("the Settings lines, worked out (#6925)", () => {
  const ROLLING: { targetPercentage: number; windowDays: number } = {
    targetPercentage: 99.9,
    windowDays: 30,
  };
  const CALENDAR_MONTH: {
    targetPercentage: number;
    windowType: SloWindowType;
  } = {
    targetPercentage: 99.9,
    windowType: SloWindowType.CalendarMonth,
  };

  test("English: word for word as before", () => {
    expect(describeSloErrorBudget(ROLLING)).toBe(
      "43m 12s of downtime per 30-day window",
    );
    expect(describeSloErrorBudget(CALENDAR_MONTH)).toBe(
      "0.1% of each month: 43m 12s of downtime in a 30-day month",
    );
    expect(
      describeSloErrorBudget({ targetPercentage: 99.95, windowDays: 7 }),
    ).toBe("5m 2s of downtime per 7-day window");
    // The share to as many places as a target is typed with.
    expect(
      describeSloErrorBudget({ ...CALENDAR_MONTH, targetPercentage: 99.9125 }),
    ).toBe("0.0875% of each month: 37m 48s of downtime in a 30-day month");
    expect(describeSloWindow({ windowDays: 30 })).toBe("Rolling 30-day window");
  });

  test("German: the budget's units and the share's decimal comma, never 43m 12s or 0.1", async () => {
    await i18next.changeLanguage("de");

    const germanBudget: string = formatDurationCompactInLanguage(
      THIRTY_DAY_BUDGET_SECONDS,
      "de",
    );

    expect(describeSloErrorBudget(ROLLING)).toBe(
      worded(DE, ROLLING_ERROR_BUDGET_KEY, {
        budget: germanBudget,
        count: "30",
      }),
    );
    expect(describeSloErrorBudget(CALENDAR_MONTH)).toBe(
      worded(DE, SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE, {
        percentage: germanPercent("0,1"),
        budget: germanBudget,
        days: "30",
      }),
    );
    expect(
      describeSloErrorBudget({ ...CALENDAR_MONTH, targetPercentage: 99.9125 }),
    ).toContain(germanPercent("0,0875"));

    for (const line of [
      describeSloErrorBudget(ROLLING),
      describeSloErrorBudget(CALENDAR_MONTH),
    ]) {
      expect(line).not.toContain("43m 12s");
      expect(line).not.toMatch(DECIMAL_POINT);
    }
  });

  test("Persian: the budget, the share and the days in Persian digits", async () => {
    await i18next.changeLanguage("fa");

    const persianBudget: string = formatDurationCompactInLanguage(
      THIRTY_DAY_BUDGET_SECONDS,
      "fa",
    );
    const lines: Array<string | null> = [
      describeSloErrorBudget(ROLLING),
      describeSloErrorBudget(CALENDAR_MONTH),
      describeSloWindow({ windowDays: 30 }),
    ];

    expect(lines).toEqual([
      worded(FA, ROLLING_ERROR_BUDGET_KEY, {
        budget: persianBudget,
        count: "۳۰",
      }),
      worded(FA, SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE, {
        percentage: "۰٫۱٪",
        budget: persianBudget,
        days: "۳۰",
      }),
      worded(FA, ROLLING_WINDOW_KEY, { count: "۳۰" }),
    ]);

    for (const line of lines) {
      expect(line).not.toMatch(LATIN_DIGIT);
    }
  });

  test("a translator handed in wins over the language of the moment", () => {
    expect(describeSloErrorBudget(ROLLING, translatorFor("fa", FA))).toBe(
      worded(FA, ROLLING_ERROR_BUDGET_KEY, {
        budget: formatDurationCompactInLanguage(
          THIRTY_DAY_BUDGET_SECONDS,
          "fa",
        ),
        count: "۳۰",
      }),
    );
    expect(describeSloWindow({ windowDays: 7 }, translatorFor("de", DE))).toBe(
      worded(DE, ROLLING_WINDOW_KEY, { count: "7" }),
    );
  });

  test("no budget for a target that leaves none, in any language", async () => {
    for (const language of ["en", "de", "fa"]) {
      await i18next.changeLanguage(language);

      expect([
        describeSloErrorBudget({ targetPercentage: 100, windowDays: 30 }),
        describeSloErrorBudget({ targetPercentage: 0, windowDays: 30 }),
        describeSloErrorBudget({ targetPercentage: undefined }),
      ]).toEqual([null, null, null]);
    }
  });
});

describe("the Settings page (#6925)", () => {
  const MODEL_ID: ObjectID = new ObjectID(
    "33333333-0000-4000-8000-000000000002",
  );
  const SETTINGS_PATH: string = `/dashboard/${PROJECT_ID}/slos/${MODEL_ID.toString()}/settings`;

  const OWNER_PERMISSIONS: Array<Permission> = [
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.ProjectOwner,
  ];

  function serveSlo(fields: Record<string, unknown>): void {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<ServiceLevelObjective> => {
        const slo: ServiceLevelObjective = new ServiceLevelObjective();

        Object.assign(slo, {
          _id: MODEL_ID.toString(),
          name: "API Availability",
          isArchived: false,
          isEnabled: true,
          sloStatus: SloStatus.Healthy,
          sliType: SliType.MonitorUptime,
          targetPercentage: 99.9,
          atRiskThresholdPercentage: 20,
          windowType: SloWindowType.Rolling,
          windowDays: 30,
          timezone: null,
          multiMonitorMode: SloMultiMonitorMode.AnyDown,
          downtimeMonitorStatuses: [],
          lastEvaluatedAt: new Date(),
          monitors: [],
          ...fields,
        });

        return slo;
      });
  }

  function openSettings(): void {
    goTo(SETTINGS_PATH);

    render(
      <MemoryRouter initialEntries={[SETTINGS_PATH]}>
        <Routes>
          <PageRoute
            path={String(RouteMap[PageMap.SLO_VIEW_SETTINGS])}
            element={
              <SloSettings
                pageRoute={RouteMap[PageMap.SLO_VIEW_SETTINGS] as Route}
                currentProject={null}
                hasPaymentMethod={true}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  // The values the cards show, each as written.
  async function shownValues(expected: Array<string>): Promise<Array<string>> {
    let values: Array<string> = [];

    await waitFor(
      () => {
        values = Array.from(
          document.querySelectorAll("p.font-medium.text-gray-900"),
        ).map((element: Element): string => {
          return element.textContent || "";
        });

        expect(values).toEqual(expect.arrayContaining(expected));
      },
      { timeout: 20000 },
    );

    return values;
  }

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(OWNER_PERMISSIONS);
    jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
      projectId: new ObjectID(PROJECT_ID),
      userId: ObjectID.generate(),
      permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      _type: "UserTenantAccessPermission",
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
    serveSlo({});
  });

  test("English: the Error Budget and Window lines word for word as before", async () => {
    openSettings();

    await shownValues([
      "43m 12s of downtime per 30-day window",
      "Rolling 30-day window",
    ]);
  });

  test("German: the Error Budget line in German units, the Window line worded in German", async () => {
    await i18next.changeLanguage("de");
    openSettings();

    const values: Array<string> = await shownValues([
      worded(DE, ROLLING_ERROR_BUDGET_KEY, {
        budget: formatDurationCompactInLanguage(
          THIRTY_DAY_BUDGET_SECONDS,
          "de",
        ),
        count: "30",
      }),
      worded(DE, ROLLING_WINDOW_KEY, { count: "30" }),
    ]);

    expect(values.join("\n")).not.toContain("43m 12s");
  });

  test("German: a calendar month's share with a decimal comma", async () => {
    await i18next.changeLanguage("de");
    serveSlo({
      windowType: SloWindowType.CalendarMonth,
      timezone: "Europe/Berlin",
    });
    openSettings();

    await shownValues([
      worded(DE, SLO_CALENDAR_MONTH_ERROR_BUDGET_TEMPLATE, {
        percentage: germanPercent("0,1"),
        budget: formatDurationCompactInLanguage(
          THIRTY_DAY_BUDGET_SECONDS,
          "de",
        ),
        days: "30",
      }),
    ]);
  });

  test("Persian: both lines in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    openSettings();

    const expected: Array<string> = [
      worded(FA, ROLLING_ERROR_BUDGET_KEY, {
        budget: formatDurationCompactInLanguage(
          THIRTY_DAY_BUDGET_SECONDS,
          "fa",
        ),
        count: "۳۰",
      }),
      worded(FA, ROLLING_WINDOW_KEY, { count: "۳۰" }),
    ];

    await shownValues(expected);

    for (const line of expected) {
      expect(line).not.toMatch(LATIN_DIGIT);
    }
  });

  /*
   * Target (%)'s help is filled in with its figures when the fields are
   * built, so the page builds Edit Objective's fields again when the reader
   * switches language: built once per mount, the form kept the language the
   * page opened in ("Over 30 days, 99.9% allows..." on a German page).
   */
  test("switching language while the page is open: Edit Objective's help follows", async () => {
    openSettings();

    await shownValues(["43m 12s of downtime per 30-day window"]);

    await act(async () => {
      await i18next.changeLanguage("de");
    });

    await shownValues([worded(DE, ROLLING_WINDOW_KEY, { count: "30" })]);

    fireEvent.click(
      await screen.findByRole("button", {
        name: worded(DE, "Edit Objective"),
      }),
    );

    const germanHelp: string = getSloTargetHelpText(translatorFor("de", DE));
    const englishHelp: string = getSloTargetHelpText(translatorFor("en", EN));

    await waitFor(
      () => {
        expect(screen.getByRole("dialog").textContent).toContain(germanHelp);
      },
      { timeout: 20000 },
    );

    expect(screen.getByRole("dialog").textContent).not.toContain(englishHelp);
  });
});
