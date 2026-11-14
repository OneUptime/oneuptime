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
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TEST PAGE DIALOG: A PERSON WITH NO RULE FOR THE SEVERITY, SHOWN WITH
 * WHAT THE FALLBACK SENDS THEM (#7262) - AND ITS COST, LISTING ONLY WHAT
 * THE PROJECT'S BALANCE PAYS FOR (#7263).
 *
 * A server of this release lists, for somebody with no rule for the
 * severity, the methods the project's fallback picks, and says the test
 * falls back to them - or that it sends them nothing, when there is
 * nothing the fallback may use. Its cost says what the test sends and what
 * of it the balance pays for: a text or a call the project's own Twilio
 * account sends is sent, and never listed as "paid from this project's SMS
 * and call balance". A server from before says only what it sends, all of
 * it read as paid, as the dialog always did.
 *
 * The dialog is the real SendTestPageModal with the shipped Dashboard
 * locales; only the server's answers are stood in for.
 */

configure({ asyncUtilTimeout: 15000 });

const previewMock: MockFunction = getJestMockFunction();
const sendMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        preview: (...args: Array<unknown>) => {
          return previewMock(...args);
        },
        send: (...args: Array<unknown>) => {
          return sendMock(...args);
        },
        getResult: () => {
          return new Promise(() => {});
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageSeverities",
  () => {
    return {
      __esModule: true,
      loadSeverityOptions: async () => {
        return [
          {
            value: "Incident:sev-1",
            recordKind: "Incident",
            severityId: "sev-1",
            severityName: "Critical",
          },
        ];
      },
      fromSeverityOptionValue: () => {
        return null;
      },
    };
  },
);

import SendTestPageModal, {
  describePreviewMethod,
  describeTestPageCost,
  getTestPageCostItems,
  getTestPagePaidCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal";
import {
  getPersonWarnings,
  getWarningSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageCost,
  OnCallTestPageKind,
  OnCallTestPagePreview,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
  OnCallTestPageWarningCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The languages the dialog is read in here: left to right, and from the right.
const READ_IN: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const FALLS_BACK_TO_LISTED: string =
  "No on-call rule covers this severity: like a real page, the test falls back to the methods above.";
/*
 * The same, when the fallback picks one method - most often the email every
 * member verifies on joining: "the method above". Stored as the sentence's
 * "one" form, under its key plus "_one".
 */
const FALLS_BACK_TO_THE_ONE_LISTED: string =
  "No on-call rule covers this severity: like a real page, the test falls back to the method above.";
const FALLS_BACK_TO_THE_ONE_LISTED_KEY: string = `${FALLS_BACK_TO_LISTED}_one`;
// The languages whose plurals have no "one" form: they say it one way.
const LANGUAGES_WITHOUT_ONE: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];
const NOTHING_TO_FALL_BACK_TO: string =
  "No on-call rule covers this severity, and no verified method can be used instead: the test sends nothing.";
const GOES_TO_EVERY_METHOD: string =
  "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.";

// The two sentences #7262 adds, by the code a server sends each with.
const NEW_SENTENCES: ReadonlyArray<[OnCallTestPageWarningCode, string]> = [
  [OnCallTestPageWarningCode.NoRuleFallsBackToListed, FALLS_BACK_TO_LISTED],
  [
    OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
    NOTHING_TO_FALL_BACK_TO,
  ],
];

// One phone call, as each language read here writes it in a list.
const ONE_CALL: Record<string, string> = {
  en: "1 phone call",
  de: "1 Anruf",
  fa: "۱ تماس تلفنی",
  ar: "1 مكالمة هاتفية",
};

// One text, as each language lists it: never in the list when not paid for.
const ONE_TEXT: Record<string, string> = {
  en: "1 SMS",
  de: "1 SMS",
  fa: "۱ پیامک",
  ar: "1 رسالة نصية",
};

// A letter of the Arabic script, which Arabic and Persian share.
const ARABIC_LETTER: RegExp = new RegExp(
  `[${String.fromCharCode(0x0600)}-${String.fromCharCode(0x06ff)}]`,
);

// The letters Persian writes that Arabic does not: pe, che, zhe, keheh, gaf, Farsi ye.
const PERSIAN_ONLY_LETTER: RegExp = new RegExp(
  `[${[0x067e, 0x0686, 0x0698, 0x06a9, 0x06af, 0x06cc]
    .map((code: number): string => {
      return String.fromCharCode(code);
    })
    .join("")}]`,
);

// A sentence of `language`'s locale, with its values in.
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let sentence: string | undefined = readDashboardLocale(language)[key];

  expect(sentence).toBeTruthy();

  for (const [name, value] of Object.entries(values)) {
    sentence = sentence!.replace(`{{${name}}}`, value);
  }

  return sentence!;
}

function cost(
  counts: {
    sms?: number;
    calls?: number;
    whatsApp?: number;
    telegram?: number;
  },
  paid:
    | {
        sms?: number;
        calls?: number;
        whatsApp?: number;
        telegram?: number;
      }
    | undefined,
  estimatedCostInUSDCents?: number,
): OnCallTestPageCost {
  const paidCount: number = paid
    ? (paid.sms || 0) +
      (paid.calls || 0) +
      (paid.whatsApp || 0) +
      (paid.telegram || 0)
    : (counts.sms || 0) +
      (counts.calls || 0) +
      (counts.whatsApp || 0) +
      (counts.telegram || 0);

  return {
    isPaid: paidCount > 0,
    smsCount: counts.sms || 0,
    callCount: counts.calls || 0,
    whatsAppCount: counts.whatsApp || 0,
    telegramCount: counts.telegram || 0,
    ...(paid
      ? {
          paidSmsCount: paid.sms || 0,
          paidCallCount: paid.calls || 0,
          paidWhatsAppCount: paid.whatsApp || 0,
          paidTelegramCount: paid.telegram || 0,
        }
      : {}),
    ...(estimatedCostInUSDCents === undefined
      ? {}
      : { estimatedCostInUSDCents: estimatedCostInUSDCents }),
  };
}

/*
 * Ana texts and calls on her rules; the project's own Twilio account sends
 * its texts, so the balance pays for her call only.
 */
const ANA: OnCallTestPagePreviewPerson = {
  userId: "7e5ae000-0000-4000-8000-000000000ba1",
  userName: "Ana Lopez",
  methods: [
    {
      channel: OnCallPageChannel.SMS,
      notifyAfterMinutes: 0,
      isVerified: true,
      canAcknowledge: true,
    },
    {
      channel: OnCallPageChannel.Call,
      notifyAfterMinutes: 0,
      isVerified: true,
      canAcknowledge: true,
    },
  ],
  hasNoRule: false,
  isOptedOut: false,
  warnings: [],
  warningCodes: [],
};

const FALLBACK_EMAIL: OnCallTestPagePreviewMethod = {
  channel: OnCallPageChannel.Email,
  notifyAfterMinutes: 0,
  isVerified: true,
  canAcknowledge: true,
  isFallback: true,
};

const FALLBACK_PUSH: OnCallTestPagePreviewMethod = {
  channel: OnCallPageChannel.Push,
  notifyAfterMinutes: 0,
  isVerified: true,
  canAcknowledge: false,
  isFallback: true,
};

// Sam has no rule for the severity: the fallback emails him.
function samFallingBack(): OnCallTestPagePreviewPerson {
  return {
    userId: "7e5ae000-0000-4000-8000-000000000bc1",
    userName: "Sam Rivera",
    methods: [FALLBACK_EMAIL],
    hasNoRule: true,
    isOptedOut: false,
    warnings: [FALLS_BACK_TO_THE_ONE_LISTED],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleFallsBackToListed,
        message: FALLS_BACK_TO_THE_ONE_LISTED,
      },
    ],
  };
}

// Sam with the app on his phone too: the fallback emails and pushes him.
function samFallingBackToTwo(): OnCallTestPagePreviewPerson {
  return {
    ...samFallingBack(),
    methods: [FALLBACK_EMAIL, FALLBACK_PUSH],
    warnings: [FALLS_BACK_TO_LISTED],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleFallsBackToListed,
        message: FALLS_BACK_TO_LISTED,
      },
    ],
  };
}

/*
 * The locale key a language words Sam's no-rule sentence under: the "one"
 * form for the one method the fallback picked, in a language that has one.
 */
function noRuleKeyFor(
  language: string,
  sam: OnCallTestPagePreviewPerson,
): string {
  const code: OnCallTestPageWarningCode = sam.warningCodes![0]!.code;

  if (code !== OnCallTestPageWarningCode.NoRuleFallsBackToListed) {
    return sam.warningCodes![0]!.message;
  }

  return sam.methods.length === 1 && !LANGUAGES_WITHOUT_ONE.includes(language)
    ? FALLS_BACK_TO_THE_ONE_LISTED_KEY
    : FALLS_BACK_TO_LISTED;
}

// Sam has no rule, and nothing the fallback may use.
function samWithNothing(): OnCallTestPagePreviewPerson {
  return {
    ...samFallingBack(),
    methods: [],
    warnings: [NOTHING_TO_FALL_BACK_TO],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
        message: NOTHING_TO_FALL_BACK_TO,
      },
    ],
  };
}

// What a server of this release says of a policy's test of one level.
function currentPreview(
  sam: OnCallTestPagePreviewPerson = samFallingBack(),
): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Policy,
    people: [ANA, sam],
    notPaged: [],
    notPagedCodes: [],
    levelCount: 1,
    cost: cost({ sms: 1, calls: 1 }, { sms: 0, calls: 1 }, 25),
  };
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function openPolicyDialog(): Promise<HTMLElement> {
  render(
    <SendTestPageModal
      target={{
        kind: "policy",
        policyId: "7e5ae000-0000-4000-8000-000000000bd1",
        policyName: "Payments primary",
      }}
      onClose={() => {}}
    />,
  );

  return await screen.findByTestId("test-page-preview");
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

// The row of the person named `name` in the preview.
function rowOf(name: string): HTMLElement {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("test-page-preview-person")
    .find((each: HTMLElement): boolean => {
      return textOf(each).includes(name);
    });

  expect(row).toBeDefined();

  return row!;
}

function methodsIn(row: HTMLElement): Array<string> {
  return within(row)
    .queryAllByTestId("test-page-preview-method")
    .map((method: HTMLElement): string => {
      return textOf(method);
    });
}

function warningsIn(row: HTMLElement): Array<string> {
  return within(row)
    .queryAllByTestId("test-page-preview-warning")
    .map((warning: HTMLElement): string => {
      return textOf(warning);
    });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of READ_IN) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  previewMock.mockReset();
  sendMock.mockReset();
  previewMock.mockResolvedValue(currentPreview());
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("a person with no rule for the severity, shown with what the fallback sends them (#7262)", () => {
  test("their fallback's method is listed like a rule's, and the line under it says the test falls back to it", async () => {
    await openPolicyDialog();

    const sam: HTMLElement = rowOf("Sam Rivera");

    expect(methodsIn(sam)).toEqual(["Email"]);
    // One method listed: "the method above", never "the methods above".
    expect(warningsIn(sam)).toEqual([FALLS_BACK_TO_THE_ONE_LISTED]);
    // Not the sentence of a server that listed nothing for them.
    expect(textOf(sam)).not.toContain("every verified method");
    // Somebody with rules is told nothing about the fallback.
    expect(warningsIn(rowOf("Ana Lopez"))).toEqual([]);
  });

  test("two methods the fallback picks: both are listed, and the line says the test falls back to the methods above", async () => {
    previewMock.mockResolvedValue(currentPreview(samFallingBackToTwo()));

    await openPolicyDialog();

    const sam: HTMLElement = rowOf("Sam Rivera");

    expect(methodsIn(sam)).toEqual(["Email", "Push notification"]);
    expect(warningsIn(sam)).toEqual([FALLS_BACK_TO_LISTED]);
  });

  test("the line counts only the fallback's methods: one or more, in every language the Dashboard is read in", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const translator: Translator = dashboardTranslator(language);
      const hasOne: boolean = !LANGUAGES_WITHOUT_ONE.includes(language);

      for (const [sam, key] of [
        [samFallingBack(), FALLS_BACK_TO_THE_ONE_LISTED_KEY],
        [samFallingBackToTwo(), FALLS_BACK_TO_LISTED],
      ] as Array<[OnCallTestPagePreviewPerson, string]>) {
        const expected: string =
          language === "en"
            ? sam.warningCodes![0]!.message
            : worded(language, hasOne ? key : FALLS_BACK_TO_LISTED);

        expect([
          language,
          getPersonWarnings(translator, sam).map(withoutIsolateMarks),
        ]).toEqual([language, [expected]]);
      }

      // A method a rule names is not one the fallback picked.
      expect(
        getPersonWarnings(translator, {
          ...samFallingBack(),
          methods: [
            { ...FALLBACK_PUSH, isFallback: undefined },
            FALLBACK_EMAIL,
          ],
        }).map(withoutIsolateMarks),
      ).toEqual(
        getPersonWarnings(translator, samFallingBack()).map(
          withoutIsolateMarks,
        ),
      );
    }
  });

  test("not told how many methods the fallback picked, the line says the methods above", () => {
    const english: Translator = dashboardTranslator("en");
    const warning: {
      code: OnCallTestPageWarningCode;
      message: string;
    } = {
      code: OnCallTestPageWarningCode.NoRuleFallsBackToListed,
      message: "x",
    };

    expect(getWarningSentence(english, warning)).toBe(FALLS_BACK_TO_LISTED);
    expect(
      getWarningSentence(english, warning, { fallbackMethodCount: 0 }),
    ).toBe(FALLS_BACK_TO_LISTED);
    expect(
      getWarningSentence(english, warning, { fallbackMethodCount: 1 }),
    ).toBe(FALLS_BACK_TO_THE_ONE_LISTED);
    expect(
      getWarningSentence(english, warning, { fallbackMethodCount: 3 }),
    ).toBe(FALLS_BACK_TO_LISTED);
    // A person sent with no methods says the general sentence, too.
    expect(
      getPersonWarnings(english, { ...samFallingBack(), methods: [] }),
    ).toEqual([FALLS_BACK_TO_LISTED]);
    // Other warnings never read the count.
    expect(
      getWarningSentence(
        english,
        {
          code: OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
          message: "x",
        },
        { fallbackMethodCount: 1 },
      ),
    ).toBe(NOTHING_TO_FALL_BACK_TO);
  });

  test("nothing the fallback may use: no method is listed, and the line says the test sends them nothing", async () => {
    previewMock.mockResolvedValue(currentPreview(samWithNothing()));

    await openPolicyDialog();

    const sam: HTMLElement = rowOf("Sam Rivera");

    expect(methodsIn(sam)).toEqual([]);
    expect(warningsIn(sam)).toEqual([NOTHING_TO_FALL_BACK_TO]);
  });

  test("in German, Persian and Arabic, the fallback's method and its sentence are the reader's, never the English", async () => {
    for (const language of ["de", "fa", "ar"]) {
      for (const sam of [
        samFallingBack(),
        samFallingBackToTwo(),
        samWithNothing(),
      ]) {
        previewMock.mockResolvedValue(currentPreview(sam));

        await readIn(language);
        await openPolicyDialog();

        const row: HTMLElement = rowOf("Sam Rivera");
        const sentence: string = sam.warningCodes![0]!.message;

        expect(warningsIn(row)).toEqual([
          worded(language, noRuleKeyFor(language, sam)),
        ]);
        expect(textOf(row)).not.toContain(sentence);
        expect(methodsIn(row)).toEqual(
          sam.methods.map((method: OnCallTestPagePreviewMethod): string => {
            return withoutIsolateMarks(
              describePreviewMethod(dashboardTranslator(language), method),
            );
          }),
        );

        cleanup();
      }
    }
  });

  test("each of the two codes reads its own sentence, in every language the Dashboard is read in", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const translator: Translator = dashboardTranslator(language);

      for (const [code, english] of NEW_SENTENCES) {
        expect(
          withoutIsolateMarks(
            getWarningSentence(translator, {
              code: code,
              message: "The server's English.",
            }),
          ),
        ).toBe(worded(language, english));
      }
    }

    // The two are told apart, and from the sentence a server before #7262 sends.
    const english: Translator = dashboardTranslator("en");

    expect(
      getWarningSentence(english, {
        code: OnCallTestPageWarningCode.NoRuleFallsBack,
        message: "x",
      }),
    ).toBe(GOES_TO_EVERY_METHOD);
  });

  test("a server from before #7262 lists nothing for them, and its sentence says every verified method, as before", async () => {
    const older: OnCallTestPagePreviewPerson = {
      ...samFallingBack(),
      methods: [],
      warnings: [GOES_TO_EVERY_METHOD],
      warningCodes: [
        {
          code: OnCallTestPageWarningCode.NoRuleFallsBack,
          message: GOES_TO_EVERY_METHOD,
        },
      ],
    };

    previewMock.mockResolvedValue(currentPreview(older));

    await openPolicyDialog();

    const sam: HTMLElement = rowOf("Sam Rivera");

    expect(methodsIn(sam)).toEqual([]);
    expect(warningsIn(sam)).toEqual([GOES_TO_EVERY_METHOD]);
    // Read from its codes; with none, the server's English.
    expect(
      getPersonWarnings(dashboardTranslator("de"), {
        warnings: [GOES_TO_EVERY_METHOD],
      }),
    ).toEqual([GOES_TO_EVERY_METHOD]);
  });
});

describe("what a test costs lists only what the project's balance pays for (#7263)", () => {
  test("the paid counts a server sends are read as they are - a zero is a zero, not what is sent", () => {
    expect(
      getTestPagePaidCounts(
        cost(
          { sms: 2, calls: 1, whatsApp: 1, telegram: 1 },
          { sms: 0, calls: 1, whatsApp: 1, telegram: 0 },
        ),
      ),
    ).toEqual({ sms: 0, calls: 1, whatsApp: 1, telegram: 0 });
  });

  test("a server from before #7263 says only what it sends: all of it is read as paid, as before", () => {
    expect(
      getTestPagePaidCounts(
        cost({ sms: 2, calls: 1, whatsApp: 1, telegram: 3 }, undefined),
      ),
    ).toEqual({ sms: 2, calls: 1, whatsApp: 1, telegram: 3 });
    expect(
      describeTestPageCost(
        dashboardTranslator("en"),
        cost({ sms: 1, calls: 1 }, undefined, 35),
      ),
    ).toBe(
      "This test sends 1 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.35.",
    );
  });

  test("the project's own Twilio sends the text: the sentence lists the call alone, at the call's price", () => {
    const english: Translator = dashboardTranslator("en");
    const ownTexts: OnCallTestPageCost = cost(
      { sms: 1, calls: 1 },
      { sms: 0, calls: 1 },
      25,
    );

    expect(getTestPageCostItems(english, ownTexts)).toBe("1 phone call");
    expect(describeTestPageCost(english, ownTexts)).toBe(
      "This test sends 1 phone call, paid from this project's SMS and call balance: about $0.25.",
    );
    expect(describeTestPageCost(english, ownTexts, { isWalk: true })).toBe(
      "If nobody acknowledges it, walking every level sends up to 1 phone call, paid from this project's SMS and call balance: about $0.25.",
    );
  });

  test("its own Twilio sends the texts and calls: only the WhatsApp message the balance pays for is listed", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      describeTestPageCost(
        english,
        cost(
          { sms: 3, calls: 2, whatsApp: 1 },
          { sms: 0, calls: 0, whatsApp: 1 },
          5,
        ),
        { isWalk: true },
      ),
    ).toBe(
      "If nobody acknowledges it, walking every level sends up to 1 WhatsApp message, paid from this project's SMS and call balance: about $0.05.",
    );
    expect(
      describeTestPageCost(
        english,
        cost({ sms: 2, telegram: 2 }, { sms: 0, telegram: 2 }),
      ),
    ).toBe(
      "This test sends 2 Telegram messages, paid from this project's SMS and call balance.",
    );
  });

  test("everything sent through its own accounts: no sentence - however the server says it is paid", () => {
    const english: Translator = dashboardTranslator("en");
    const nothingPaid: OnCallTestPageCost = cost(
      { sms: 2, calls: 2 },
      { sms: 0, calls: 0 },
    );

    expect(nothingPaid.isPaid).toBe(false);
    expect(describeTestPageCost(english, nothingPaid)).toBe("");
    expect(
      describeTestPageCost(english, { ...nothingPaid, isPaid: true }),
    ).toBe("");
    expect(
      describeTestPageCost(
        english,
        { ...nothingPaid, isPaid: true },
        { isWalk: true },
      ),
    ).toBe("");
  });

  test("the dialog's cost line: the paid call, never the text its own Twilio sends", async () => {
    await openPolicyDialog();

    const line: string = textOf(screen.getByTestId("test-page-cost"));

    expect(line).toBe(
      "This test sends 1 phone call, paid from this project's SMS and call balance: about $0.25.",
    );
    expect(line).not.toContain("SMS and 1");
    // Ana is still shown with both methods: the text is sent, only not paid for.
    expect(methodsIn(rowOf("Ana Lopez"))).toHaveLength(2);
  });

  test("in German, Persian and Arabic, the line lists the paid call alone, in the reader's words and digits", async () => {
    for (const language of ["de", "fa", "ar"]) {
      await readIn(language);
      await openPolicyDialog();

      const line: string = textOf(screen.getByTestId("test-page-cost"));

      expect(line).toContain(ONE_CALL[language]!);
      expect(line).not.toContain(ONE_TEXT[language]!);
      expect(line).not.toContain("paid from this project's");
      expect(
        withoutIsolateMarks(
          getTestPageCostItems(
            dashboardTranslator(language),
            cost({ sms: 1, calls: 1 }, { sms: 0, calls: 1 }),
          ),
        ),
      ).toBe(ONE_CALL[language]);
      expect(ONE_CALL[language]).toBe(
        worded(language, "{{count}} phone calls_one", {
          count: language === "fa" ? "۱" : "1",
        }),
      );
      // The text left out is the one listed when the balance pays for it.
      expect(ONE_TEXT[language]).toBe(
        worded(language, "{{count}} SMS_one", {
          count: language === "fa" ? "۱" : "1",
        }),
      );
      expect(
        withoutIsolateMarks(
          getTestPageCostItems(
            dashboardTranslator(language),
            cost({ sms: 1, calls: 1 }, { sms: 1, calls: 1 }),
          ),
        ),
      ).toContain(ONE_TEXT[language]!);

      cleanup();
    }
  });
});

describe("every language the Dashboard is read in words the new sentences (#7262)", () => {
  // A key worded in `words` its own way: there, not empty, not the English.
  function isWordedIn(words: Record<string, string>, key: string): boolean {
    const value: string | undefined = words[key];

    return Boolean(value && value.trim() && value !== key);
  }

  test("the Dashboard's languages are its locale files, English aside", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(["en", ...DASHBOARD_LANGUAGES].sort()).toEqual(files);
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  test("each sentence is in every locale - English as the key, every other language its own wording, with no placeholders lost", () => {
    // The "one" form of the fallback's sentence: English's, under its key.
    expect(readDashboardLocale("en")[FALLS_BACK_TO_THE_ONE_LISTED_KEY]).toBe(
      FALLS_BACK_TO_THE_ONE_LISTED,
    );

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect([
        language,
        isWordedInDashboardLocale(FALLS_BACK_TO_THE_ONE_LISTED_KEY, language),
      ]).toEqual([language, true]);
      expect(placeholdersOf(words[FALLS_BACK_TO_THE_ONE_LISTED_KEY]!)).toEqual(
        [],
      );

      /*
       * A language with a "one" form says one method apart from more; one
       * without says both one way, its general sentence.
       */
      expect([
        language,
        words[FALLS_BACK_TO_THE_ONE_LISTED_KEY] === words[FALLS_BACK_TO_LISTED],
      ]).toEqual([language, LANGUAGES_WITHOUT_ONE.includes(language)]);
      expect(words[FALLS_BACK_TO_THE_ONE_LISTED_KEY]).not.toBe(
        FALLS_BACK_TO_THE_ONE_LISTED,
      );
    }

    for (const [, english] of NEW_SENTENCES) {
      expect(readDashboardLocale("en")[english]).toBe(english);
      expect(placeholdersOf(english)).toEqual([]);

      for (const language of DASHBOARD_LANGUAGES) {
        const words: Record<string, string> = readDashboardLocale(language);

        expect([language, isWordedIn(words, english)]).toEqual([
          language,
          true,
        ]);
        expect([
          language,
          isWordedInDashboardLocale(english, language),
        ]).toEqual([language, true]);
        expect(placeholdersOf(words[english]!)).toEqual([]);
      }
    }
  });

  test("the check catches a sentence left out, left empty or left in English (negative control)", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(isWordedIn(german, FALLS_BACK_TO_LISTED)).toBe(true);

    const leftOut: Record<string, string> = { ...german };
    delete leftOut[FALLS_BACK_TO_LISTED];

    expect(isWordedIn(leftOut, FALLS_BACK_TO_LISTED)).toBe(false);
    expect(
      isWordedIn(
        { ...german, [FALLS_BACK_TO_LISTED]: "  " },
        FALLS_BACK_TO_LISTED,
      ),
    ).toBe(false);
    expect(
      isWordedIn(
        { ...german, [NOTHING_TO_FALL_BACK_TO]: NOTHING_TO_FALL_BACK_TO },
        NOTHING_TO_FALL_BACK_TO,
      ),
    ).toBe(false);
  });

  test("Persian joins its verbs' prefixes with a zero-width non-joiner, never a space", () => {
    const persian: Record<string, string> = readDashboardLocale("fa");
    const zeroWidthNonJoiner: string = String.fromCharCode(0x200c);

    for (const key of [
      ...NEW_SENTENCES.map(
        ([, english]: [OnCallTestPageWarningCode, string]): string => {
          return english;
        },
      ),
      FALLS_BACK_TO_THE_ONE_LISTED_KEY,
    ]) {
      expect(persian[key]).toContain(`نمی${zeroWidthNonJoiner}`);
      expect(persian[key]).not.toMatch(/نمی /);
      expect(persian[key]).not.toMatch(/برمی /);
    }
  });

  test("the Arabic sentences use Arabic's letters, not Persian's", () => {
    const arabic: Record<string, string> = readDashboardLocale("ar");

    for (const key of [
      ...NEW_SENTENCES.map(
        ([, english]: [OnCallTestPageWarningCode, string]): string => {
          return english;
        },
      ),
      FALLS_BACK_TO_THE_ONE_LISTED_KEY,
    ]) {
      expect(arabic[key]).toMatch(ARABIC_LETTER);
      expect(arabic[key]).not.toMatch(PERSIAN_ONLY_LETTER);
    }
  });

  test("read in German, Persian or Arabic, the dialog has none of the English sentences in it", async () => {
    for (const language of ["de", "fa", "ar"]) {
      await readIn(language);

      const preview: HTMLElement = await openPolicyDialog();
      const dialog: string = textOf(
        screen.getByTestId("send-test-page-dialog"),
      );

      expect(preview).toBeInTheDocument();

      for (const english of [
        FALLS_BACK_TO_LISTED,
        FALLS_BACK_TO_THE_ONE_LISTED,
        NOTHING_TO_FALL_BACK_TO,
        GOES_TO_EVERY_METHOD,
        "paid from this project's SMS and call balance",
        "1 phone call",
      ]) {
        expect([language, dialog.includes(english)]).toEqual([language, false]);
      }

      cleanup();
    }
  });
});
