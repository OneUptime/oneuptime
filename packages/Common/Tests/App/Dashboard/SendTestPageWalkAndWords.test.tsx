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
  fireEvent,
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
 * THE TEST PAGE DIALOG'S PREVIEW, IN THE READER'S WORDS (#7015), AND A
 * POLICY'S TEST THAT WALKS EVERY LEVEL (#7016).
 *
 * The server sends each warning, each target that reaches nobody and each
 * "why them" as a code with its values, and the Dashboard words each one in
 * the reader's language - or shows the server's English, for a code it does
 * not know or a server that sent none. A policy's test that walks every
 * level shows each level it reaches before it ends, when, with its people,
 * how many it never reaches, and what the whole walk costs at most.
 *
 * The walk is drawn as a timeline: a numbered marker for each level, in
 * the reader's digits, a line down to the next one, and an end marker for
 * the levels it never reaches. A policy of one level is not offered it.
 * What the test costs lists its texts and calls as the reader's language
 * lists them and writes its amount as the reader writes money, with no
 * direction marks of Intl's in it.
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
  doesTestPageAnybody,
  formatTestPageAmount,
  getTestPageDialogDescription,
  isWalkOffered,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal";
import {
  getNotPagedLines,
  getNotPagedSentence,
  getPersonWarnings,
  getReachedThroughWords,
  getWalkLevelHeading,
  getWarningSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import OneUptimeDate from "../../../Types/Date";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageCost,
  OnCallTestPageKind,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreview,
  OnCallTestPagePreviewLevel,
  OnCallTestPagePreviewPerson,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageWarningCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator, createTranslator } from "../../../Types/Translator";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
  de: readLocale("de"),
  ru: readLocale("ru"),
  fa: readLocale("fa"),
  ar: readLocale("ar"),
  ja: readLocale("ja"),
};

// A translator over the Dashboard's own words in `language`.
function translatorIn(language: string): Translator {
  const locale: Record<string, string> = LOCALES[language]!;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

// A sentence of `language`'s locale, with its values in.
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let sentence: string = LOCALES[language]![key]!;

  expect(sentence).toBeTruthy();

  for (const [name, value] of Object.entries(values)) {
    sentence = sentence.replace(`{{${name}}}`, value);
  }

  return sentence;
}

const EMAIL_NOT_VERIFIED: string =
  "This Email method is not verified, so the test can't use it.";
const AWAY_ENGLISH: string =
  "Lee Park is away until Nov 14 2026, 09:00 UTC, with nobody covering.";
const LEVEL_3_EMPTY: string =
  "Escalation rule 3 pages nobody yet. Add people, a team or a schedule to it.";

// The marks Intl writes into an amount in Persian and Arabic: never drawn here.
const DIRECTION_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x200e, 0x200f, 0x061c)}]`,
);

// Between a German amount and its sign, as Intl writes it.
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

function cost(
  smsCount: number,
  callCount: number,
  estimatedCostInUSDCents?: number,
  whatsAppCount: number = 0,
): OnCallTestPageCost {
  return {
    isPaid: smsCount + callCount + whatsAppCount > 0,
    smsCount: smsCount,
    callCount: callCount,
    whatsAppCount: whatsAppCount,
    telegramCount: 0,
    ...(estimatedCostInUSDCents === undefined
      ? {}
      : { estimatedCostInUSDCents: estimatedCostInUSDCents }),
  };
}

const ANA: OnCallTestPagePreviewPerson = {
  userId: "7e5ae000-0000-4000-8000-0000000009a1",
  userName: "Ana Lopez",
  reachedThrough: "Schedule Primary",
  reachedThroughCode: {
    code: OnCallTestPageReachedThroughCode.Schedule,
    name: "Primary",
  },
  methods: [
    {
      channel: OnCallPageChannel.SMS,
      notifyAfterMinutes: 0,
      isVerified: true,
      canAcknowledge: true,
    },
    {
      channel: OnCallPageChannel.Email,
      notifyAfterMinutes: 0,
      isVerified: false,
      canAcknowledge: true,
    },
  ],
  hasNoRule: false,
  isOptedOut: false,
  warnings: [EMAIL_NOT_VERIFIED],
  warningCodes: [
    {
      code: OnCallTestPageWarningCode.MethodNotVerified,
      channel: OnCallPageChannel.Email,
      message: EMAIL_NOT_VERIFIED,
    },
  ],
};

const BOB: OnCallTestPagePreviewPerson = {
  userId: "7e5ae000-0000-4000-8000-0000000009b1",
  userName: "Bob Stone",
  reachedThrough: "Team Platform",
  reachedThroughCode: {
    code: OnCallTestPageReachedThroughCode.Team,
    name: "Platform",
  },
  methods: [
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

// What a server of this release says of a policy's test.
function currentPreview(): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Policy,
    people: [ANA],
    notPaged: [AWAY_ENGLISH],
    notPagedCodes: [
      {
        code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
        userName: "Lee Park",
        awayUntil: "2026-11-14T09:00:00.000Z",
        message: AWAY_ENGLISH,
      },
    ],
    levelCount: 3,
    cost: cost(1, 0, 10),
    walkLevels: [
      {
        order: 2,
        startsAfterMinutes: 2,
        people: [BOB],
        notPaged: [],
        notPagedCodes: [],
      },
      {
        order: 3,
        startsAfterMinutes: 4,
        people: [],
        notPaged: [LEVEL_3_EMPTY],
        notPagedCodes: [
          {
            code: OnCallTestPageNotPagedCode.LevelNamesNobody,
            levelOrder: 3,
            message: LEVEL_3_EMPTY,
          },
        ],
      },
    ],
    walkUnreachedLevelCount: 0,
    walkCost: cost(1, 1, 35),
  };
}

// What a server from before the codes and the walk says of it.
function olderServersPreview(): OnCallTestPagePreview {
  const preview: OnCallTestPagePreview = currentPreview();

  return {
    kind: preview.kind,
    people: preview.people.map(
      (person: OnCallTestPagePreviewPerson): OnCallTestPagePreviewPerson => {
        const older: OnCallTestPagePreviewPerson = { ...person };
        delete older.reachedThroughCode;
        delete older.warningCodes;
        return older;
      },
    ),
    notPaged: preview.notPaged,
    levelCount: preview.levelCount,
    cost: preview.cost,
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
        policyId: "7e5ae000-0000-4000-8000-0000000009c1",
        policyName: "Payments primary",
      }}
      onClose={() => {}}
    />,
  );

  return await screen.findByTestId("test-page-preview");
}

function walkEveryLevel(): void {
  fireEvent.click(screen.getByTestId("test-page-walks-escalation"));
}

// Each level's heading, as the walk draws them, in order.
function headingsOf(walk: HTMLElement): Array<string> {
  return within(walk)
    .getAllByTestId("test-page-walk-level")
    .map((level: HTMLElement): string => {
      return textOf(within(level).getByTestId("test-page-walk-level-heading"));
    });
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

function sendButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of Object.keys(LOCALES)) {
    resources[language] = { translation: LOCALES[language]! };
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

describe("the preview, in the reader's words (#7015)", () => {
  test("in German: why each person is paged, what will not go out and who can't be reached", async () => {
    await readIn("de");
    await openPolicyDialog();

    expect(
      textOf(screen.getByTestId("test-page-preview-reached-through")),
    ).toContain(worded("de", "Schedule {{name}}", { name: "Primary" }));
    expect(textOf(screen.getByTestId("test-page-preview-warning"))).toBe(
      worded(
        "de",
        "This email method is not verified, so the test can't use it.",
      ),
    );

    const away: string = textOf(
      screen.getByTestId("test-page-preview-not-paged"),
    );

    expect(away).toMatch(/^Lee Park ist bis .+, ohne Vertretung\.$/);
    expect(away).not.toContain("away until");
  });

  /*
   * Japanese, written in another script: a word in Latin letters left on
   * the preview is English that never went through the Dashboard's words -
   * unless it is a name the server sent, the date (written by the page's
   * dates) or Japanese's own wording ("SMS"). The card on a monitor's
   * Overview words the same codes with the same words (#7261).
   */
  test("in Japanese, no English is left on the preview but the names, the date and Japanese's own wording", async () => {
    await readIn("ja");
    const preview: HTMLElement = await openPolicyDialog();

    const awayTime: string = OneUptimeDate.getDateAsUserFriendlyFormattedString(
      OneUptimeDate.fromString("2026-11-14T09:00:00.000Z"),
    );

    expect(
      textOf(screen.getByTestId("test-page-preview-reached-through")),
    ).toContain(worded("ja", "Schedule {{name}}", { name: "Primary" }));
    expect(textOf(screen.getByTestId("test-page-preview-warning"))).toBe(
      worded(
        "ja",
        "This email method is not verified, so the test can't use it.",
      ),
    );
    expect(textOf(screen.getByTestId("test-page-preview-not-paged"))).toBe(
      worded("ja", "{{name}} is away until {{time}}, with nobody covering.", {
        name: "Lee Park",
        time: awayTime,
      }),
    );

    let rest: string = textOf(preview);

    for (const given of ["Ana Lopez", "Lee Park", "Primary", awayTime]) {
      rest = rest.split(given).join(" ");
    }

    // Every word in Latin letters Japanese's own words have (a plural is an object of them).
    const japanesesOwn: Set<string> = new Set<string>(
      JSON.stringify(Object.values(LOCALES["ja"]!)).match(/[A-Za-z]+/g) || [],
    );

    expect(
      (rest.match(/[A-Za-z]+/g) || []).filter((word: string): boolean => {
        return !japanesesOwn.has(word);
      }),
    ).toEqual([]);

    for (const english of [
      "is away until",
      "with nobody covering",
      "is not verified",
      "Schedule Primary",
    ]) {
      expect(rest).not.toContain(english);
    }
  });

  test("in Persian and Arabic, read from the right, with the names as they are", async () => {
    for (const language of ["fa", "ar"]) {
      await readIn(language);
      await openPolicyDialog();

      expect(
        textOf(screen.getByTestId("test-page-preview-reached-through")),
      ).toContain(worded(language, "Schedule {{name}}", { name: "Primary" }));
      expect(textOf(screen.getByTestId("test-page-preview-warning"))).toBe(
        worded(
          language,
          "This email method is not verified, so the test can't use it.",
        ),
      );
      expect(
        textOf(screen.getByTestId("test-page-preview-not-paged")),
      ).toContain("Lee Park");

      cleanup();
    }
  });

  test("a preview from a server that sends no codes shows the server's English, as before", async () => {
    previewMock.mockResolvedValue(olderServersPreview());

    await readIn("de");
    await openPolicyDialog();

    expect(
      textOf(screen.getByTestId("test-page-preview-reached-through")),
    ).toContain("Schedule Primary");
    expect(textOf(screen.getByTestId("test-page-preview-warning"))).toBe(
      EMAIL_NOT_VERIFIED,
    );
    expect(textOf(screen.getByTestId("test-page-preview-not-paged"))).toBe(
      AWAY_ENGLISH,
    );
  });

  test("each warning code has its own sentence; one this Dashboard does not know reads the server's English", () => {
    const german: Translator = translatorIn("de");

    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.OptedOut,
        message: "x",
      }),
    ).toBe(
      worded(
        "de",
        "Opted out of pages of this severity, so the test sends nothing.",
      ),
    );
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.NoRuleNoFallback,
        message: "x",
      }),
    ).toBe(
      worded(
        "de",
        "No on-call rule covers this severity, and this project does not fall back to verified methods: the test sends nothing.",
      ),
    );
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.NoRuleFallsBack,
        message: "x",
      }),
    ).toBe(
      worded(
        "de",
        "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.",
      ),
    );
    // A channel off in the project: what Notification Methods says of it.
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.ChannelOff,
        channel: OnCallPageChannel.SMS,
        message: "SMS is off.",
      }),
    ).not.toBe("SMS is off.");
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.MethodNotVerified,
        channel: OnCallPageChannel.CustomChannel,
        message: "x",
      }),
    ).toBe(
      worded(
        "de",
        "This custom channel is turned off, so the test can't use it.",
      ),
    );

    // Codes a later server may send, and values it may leave out.
    expect(
      getWarningSentence(german, {
        code: "SomethingNew" as OnCallTestPageWarningCode,
        message: "A later server's English.",
      }),
    ).toBe("A later server's English.");
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.ChannelOff,
        channel: OnCallPageChannel.Email,
        message: "Email is off.",
      }),
    ).toBe("Email is off.");
    expect(
      getWarningSentence(german, {
        code: OnCallTestPageWarningCode.MethodNotVerified,
        message: "No channel named.",
      }),
    ).toBe("No channel named.");
  });

  test("a person's warnings: from their codes, or the server's English when it sent none", () => {
    const german: Translator = translatorIn("de");

    expect(getPersonWarnings(german, ANA)).toEqual([
      worded(
        "de",
        "This email method is not verified, so the test can't use it.",
      ),
    ]);
    expect(
      getPersonWarnings(german, { warnings: [EMAIL_NOT_VERIFIED] }),
    ).toEqual([EMAIL_NOT_VERIFIED]);
    // An empty list of codes is no warnings, not the English ones.
    expect(
      getPersonWarnings(german, {
        warnings: [EMAIL_NOT_VERIFIED],
        warningCodes: [],
      }),
    ).toEqual([]);
  });

  test("why a target reaches nobody, each code in German - the first level and a later one apart", () => {
    const german: Translator = translatorIn("de");
    const say: (
      notPaged: Omit<Parameters<typeof getNotPagedSentence>[1], "message">,
    ) => string = (
      notPaged: Omit<Parameters<typeof getNotPagedSentence>[1], "message">,
    ): string => {
      return withoutIsolateMarks(
        getNotPagedSentence(german, { ...notPaged, message: "English" }),
      );
    };

    expect(say({ code: OnCallTestPageNotPagedCode.PolicyHasNoLevels })).toBe(
      worded(
        "de",
        "This policy has no escalation rules yet, so a test pages nobody.",
      ),
    );
    expect(
      say({ code: OnCallTestPageNotPagedCode.LevelNamesNobody, levelOrder: 1 }),
    ).toBe(
      worded(
        "de",
        "The first escalation rule pages nobody yet. Add people, a team or a schedule to it.",
      ),
    );
    expect(
      say({ code: OnCallTestPageNotPagedCode.LevelNamesNobody, levelOrder: 3 }),
    ).toBe(
      worded("de", LEVEL_3_EMPTY.replace("3", "{{order}}"), { order: "3" }),
    );
    expect(
      say({
        code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
        teamName: "Ops",
      }),
    ).toBe(worded("de", "Team {{name}} has no members.", { name: "Ops" }));
    expect(
      say({
        code: OnCallTestPageNotPagedCode.NobodyNextInRotation,
        scheduleName: "Nights",
      }),
    ).toBe(
      worded("de", "Nobody is next in the rotation of schedule {{name}}.", {
        name: "Nights",
      }),
    );
    expect(
      say({
        code: OnCallTestPageNotPagedCode.NobodyOnCall,
        scheduleName: "Days",
      }),
    ).toBe(
      worded("de", "Nobody is on call in schedule {{name}} now.", {
        name: "Days",
      }),
    );
    expect(
      say({
        code: OnCallTestPageNotPagedCode.NotProjectMember,
        userName: "Dan Wu",
      }),
    ).toBe(
      worded("de", "{{name}} is not a member of this project.", {
        name: "Dan Wu",
      }),
    );
    // Away with no date to say: the server's English.
    expect(
      say({
        code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
        userName: "Lee Park",
      }),
    ).toBe("English");
    expect(
      getNotPagedLines(german, {
        notPaged: ["English"],
        notPagedCodes: undefined,
      }),
    ).toEqual(["English"]);
  });

  test("why a person is paged: each code worded, and the server's English for one it does not know", () => {
    const german: Translator = translatorIn("de");

    expect(
      withoutIsolateMarks(
        getReachedThroughWords(german, {
          reachedThroughCode: {
            code: OnCallTestPageReachedThroughCode.ScheduleNextInRotation,
            name: "Primary",
          },
        }),
      ),
    ).toBe(
      worded("de", "Schedule {{name}} (next in rotation)", {
        name: "Primary",
      }),
    );
    expect(
      withoutIsolateMarks(
        getReachedThroughWords(german, {
          reachedThroughCode: {
            code: OnCallTestPageReachedThroughCode.CoveringFor,
            name: "Ana Lopez",
          },
        }),
      ),
    ).toBe(worded("de", "Covering for {{name}}", { name: "Ana Lopez" }));
    expect(
      getReachedThroughWords(german, {
        reachedThrough: "Rota Primary",
        reachedThroughCode: {
          code: "SomethingNew" as OnCallTestPageReachedThroughCode,
          name: "Primary",
        },
      }),
    ).toBe("Rota Primary");
    expect(getReachedThroughWords(german, {})).toBe("");
  });
});

describe("the dialog's words, in every reader's digits and direction", () => {
  test("a policy's line under the title says how it pages, not which levels: that is the walk's choice", () => {
    const english: string = getTestPageDialogDescription(translatorIn("en"), {
      kind: "policy",
      policyId: "7e5ae000-0000-4000-8000-0000000009c1",
    });

    expect(english).not.toContain("first escalation level");
    expect(
      getTestPageDialogDescription(translatorIn("de"), {
        kind: "policy",
        policyId: "7e5ae000-0000-4000-8000-0000000009c1",
      }),
    ).toBe(worded("de", english));
  });

  test("an address keeps its own direction beside Persian words, on a line punctuated as Persian punctuates it", () => {
    const call: Parameters<typeof describePreviewMethod>[1] = {
      channel: OnCallPageChannel.Call,
      address: "+1 415 555 0100",
      notifyAfterMinutes: 0,
      isVerified: true,
      canAcknowledge: true,
    };

    expect(describePreviewMethod(translatorIn("en"), call)).toBe(
      "Phone call · +1 415 555 0100",
    );

    const persian: string = describePreviewMethod(translatorIn("fa"), call);

    expect(persian).toBe(
      `${worded("fa", "Phone call")} • ${isolated("+1 415 555 0100")}`,
    );
    expect(
      describePreviewMethod(translatorIn("fa"), {
        ...call,
        notifyAfterMinutes: 5,
      }),
    ).toBe(
      worded("fa", "{{name}} (after {{count}} minutes on a real page)", {
        name: persian,
        count: "۵",
      }),
    );
  });

  test("sent, the line under the title says when the test ends, in the reader's digits", async () => {
    sendMock.mockResolvedValue("7e5ae000-0000-4000-8000-0000000009e1");

    await readIn("fa");
    await openPolicyDialog();
    fireEvent.click(sendButton());
    await screen.findByTestId("test-page-result");

    expect(textOf(screen.getByTestId("modal-description"))).toBe(
      worded(
        "fa",
        "Sent. Each message is below as it goes out. The test ends when someone acknowledges it, or after {{minutes}} minutes.",
        { minutes: "۱۵" },
      ),
    );
  });
});

describe("a policy's test that walks every level (#7016)", () => {
  test("off, the dialog shows the first level and its cost; on, each level it reaches, when, and the walk's cost at most", async () => {
    await openPolicyDialog();

    expect(screen.queryByTestId("test-page-walk")).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toBe(
      "This test sends 1 SMS, paid from this project's SMS and call balance: about $0.10.",
    );

    walkEveryLevel();

    const walk: HTMLElement = await screen.findByTestId("test-page-walk");
    const levels: Array<HTMLElement> = within(walk).getAllByTestId(
      "test-page-walk-level",
    );

    expect(headingsOf(walk)).toEqual([
      "Level 1, right away",
      "Level 2, after 2 minutes",
      "Level 3, after 4 minutes",
    ]);
    /*
     * A timeline: each level's number on its marker, a line down to the next
     * level, and none under the last when the walk reaches every level.
     */
    expect(
      within(walk)
        .getAllByTestId("test-page-walk-marker")
        .map((marker: HTMLElement): string => {
          return textOf(marker);
        }),
    ).toEqual(["1", "2", "3"]);
    expect(
      levels.map((level: HTMLElement): boolean => {
        return within(level).queryByTestId("test-page-walk-line") !== null;
      }),
    ).toEqual([true, true, false]);
    // A heading the dialog's outline reads, under the dialog's own (h3).
    expect(
      within(levels[0]!).getByTestId("test-page-walk-level-heading").tagName,
    ).toBe("H4");
    expect(textOf(levels[0]!)).toContain("Ana Lopez");
    expect(textOf(levels[1]!)).toContain("Bob Stone");
    expect(textOf(levels[1]!)).toContain("Team Platform");
    expect(textOf(levels[2]!)).toContain(LEVEL_3_EMPTY);
    // The first level is still the one the preview names.
    expect(
      within(levels[0]!).getByTestId("test-page-preview"),
    ).toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toBe(
      "If nobody acknowledges it, walking every level sends up to 1 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.35.",
    );
    expect(
      screen.queryByTestId("test-page-walk-unreached"),
    ).not.toBeInTheDocument();

    // Off again: the first level, and its own cost.
    walkEveryLevel();

    expect(screen.queryByTestId("test-page-walk")).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toContain("$0.10");
  });

  test("the levels it ends before are counted where the test ends, and the line runs on to it", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      levelCount: 5,
      walkUnreachedLevelCount: 2,
    });

    await openPolicyDialog();
    walkEveryLevel();

    expect(textOf(await screen.findByTestId("test-page-walk-unreached"))).toBe(
      "The test ends after 15 minutes, before it reaches 2 more levels.",
    );

    const levels: Array<HTMLElement> = screen.getAllByTestId(
      "test-page-walk-level",
    );

    expect(
      within(levels[levels.length - 1]!).getByTestId("test-page-walk-line"),
    ).toBeInTheDocument();

    cleanup();
    previewMock.mockResolvedValue({
      ...currentPreview(),
      levelCount: 4,
      walkUnreachedLevelCount: 1,
    });

    await openPolicyDialog();
    walkEveryLevel();

    expect(textOf(await screen.findByTestId("test-page-walk-unreached"))).toBe(
      "The test ends after 15 minutes, before it reaches 1 more level.",
    );
  });

  test("a first level that pages nobody can still be sent when walking reaches somebody", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      people: [],
      cost: cost(0, 0),
    });

    await openPolicyDialog();

    expect(sendButton()).toBeDisabled();

    walkEveryLevel();
    await screen.findByTestId("test-page-walk");

    expect(sendButton()).toBeEnabled();
  });

  test("a walk that reaches nobody at all cannot be sent", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      people: [],
      cost: cost(0, 0),
      walkLevels: [],
      walkCost: cost(0, 0),
    });

    await openPolicyDialog();
    walkEveryLevel();
    await screen.findByTestId("test-page-walk");

    expect(sendButton()).toBeDisabled();
    expect(screen.queryByTestId("test-page-cost")).not.toBeInTheDocument();
  });

  test("a server that does not say what the walk reaches: the first level, and its cost, as before", async () => {
    previewMock.mockResolvedValue(olderServersPreview());

    await openPolicyDialog();
    walkEveryLevel();

    expect(screen.queryByTestId("test-page-walk")).not.toBeInTheDocument();
    expect(screen.getByTestId("test-page-preview")).toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toBe(
      "This test sends 1 SMS, paid from this project's SMS and call balance: about $0.10.",
    );
  });

  test("in German, each level's heading and the walk's cost are worded in German", async () => {
    await readIn("de");
    await openPolicyDialog();
    walkEveryLevel();

    const walk: HTMLElement = await screen.findByTestId("test-page-walk");
    const headings: Array<string> = headingsOf(walk);

    expect(headings).toEqual([
      worded("de", "Level {{order}}, right away", { order: "1" }),
      worded("de", "Level {{order}}, after {{count}} minutes", {
        order: "2",
        count: "2",
      }),
      worded("de", "Level {{order}}, after {{count}} minutes", {
        order: "3",
        count: "4",
      }),
    ]);
    expect(headings[1]).toBe("Stufe 2, nach 2 Minuten");

    const costLine: string = textOf(screen.getByTestId("test-page-cost"));

    expect(costLine).toBe(
      worded(
        "de",
        "If nobody acknowledges it, walking every level sends up to {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
        {
          items: worded("de", "{{items}} and {{last}}", {
            items: worded("de", "{{count}} SMS_one", { count: "1" }),
            last: worded("de", "{{count}} phone calls_one", { count: "1" }),
          }),
          // As German writes money.
          amount: `0,35${NO_BREAK_SPACE}$`,
        },
      ),
    );
    expect(costLine).not.toContain("$0.35");
  });

  test("in Persian, the walk's markers, its minutes and its cost are in Persian digits, with no direction marks", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      levelCount: 5,
      walkUnreachedLevelCount: 2,
    });

    await readIn("fa");
    await openPolicyDialog();

    // "up to 2 minutes apart", in Persian digits.
    const walkChoice: string = textOf(
      screen.getByText(
        worded(
          "fa",
          "Pages each level in turn, up to {{minutes}} minutes apart, until someone acknowledges. Off, it pages the first level only.",
          { minutes: "۲" },
        ),
      ),
    );

    expect(walkChoice).not.toMatch(/[0-9]/);

    walkEveryLevel();

    const walk: HTMLElement = await screen.findByTestId("test-page-walk");

    expect(
      within(walk)
        .getAllByTestId("test-page-walk-marker")
        .map((marker: HTMLElement): string => {
          return textOf(marker);
        }),
    ).toEqual(["۱", "۲", "۳"]);
    expect(textOf(screen.getByTestId("test-page-walk-unreached"))).toBe(
      worded(
        "fa",
        "The test ends after {{minutes}} minutes, before it reaches {{count}} more levels.",
        { minutes: "۱۵", count: "۲" },
      ),
    );

    const costLine: string = screen.getByTestId("test-page-cost").textContent!;

    expect(withoutIsolateMarks(costLine)).toContain("$۰٫۳۵");
    expect(costLine).not.toMatch(DIRECTION_MARKS);
    expect(withoutIsolateMarks(costLine)).not.toMatch(/[0-9]/);
  });

  test("a heading is worded for its count: one minute, and Russian's forms", () => {
    const english: Translator = translatorIn("en");
    const german: Translator = translatorIn("de");
    const russian: Translator = translatorIn("ru");

    expect(
      getWalkLevelHeading(english, { order: 2, startsAfterMinutes: 1 }),
    ).toBe("Level 2, after 1 minute");
    expect(
      getWalkLevelHeading(german, { order: 2, startsAfterMinutes: 1 }),
    ).toBe("Stufe 2, nach 1 Minute");
    expect(
      getWalkLevelHeading(russian, { order: 4, startsAfterMinutes: 21 }),
    ).toBe(
      worded("ru", "Level {{order}}, after {{count}} minutes_one", {
        order: "4",
        count: "21",
      }),
    );
    expect(
      getWalkLevelHeading(english, { order: 3, startsAfterMinutes: 0 }),
    ).toBe("Level 3, right away");
  });

  test("Persian writes the level's number in its own digits, as it writes the minutes", () => {
    const persian: Translator = translatorIn("fa");
    const heading: string = getWalkLevelHeading(persian, {
      order: 2,
      startsAfterMinutes: 2,
    });

    expect(heading).not.toMatch(/[0-9]/);
    expect(heading).toContain("۲");
  });

  test("what a test costs: the first level's sentence, or the walk's", () => {
    const english: Translator = translatorIn("en");

    expect(describeTestPageCost(english, cost(2, 1, 45))).toBe(
      "This test sends 2 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.45.",
    );
    expect(
      describeTestPageCost(english, cost(2, 1, 45), { isWalk: true }),
    ).toBe(
      "If nobody acknowledges it, walking every level sends up to 2 SMS and 1 phone call, paid from this project's SMS and call balance: about $0.45.",
    );
    expect(
      describeTestPageCost(english, cost(3, 3, 110, 1), { isWalk: true }),
    ).toBe(
      "If nobody acknowledges it, walking every level sends up to 3 SMS, 3 phone calls and 1 WhatsApp message, paid from this project's SMS and call balance: about $1.10.",
    );
    expect(describeTestPageCost(english, cost(0, 2), { isWalk: true })).toBe(
      "If nobody acknowledges it, walking every level sends up to 2 phone calls, paid from this project's SMS and call balance.",
    );
    expect(describeTestPageCost(english, cost(0, 0), { isWalk: true })).toBe(
      "",
    );
    // Paid, with nothing to list: no sentence with an empty list in it.
    expect(describeTestPageCost(english, { ...cost(0, 0), isPaid: true })).toBe(
      "",
    );
  });

  test("an amount is written as the reader writes money, with no direction marks", () => {
    expect(formatTestPageAmount(translatorIn("en"), 35)).toBe("$0.35");
    expect(formatTestPageAmount(translatorIn("de"), 110)).toBe(
      `1,10${NO_BREAK_SPACE}$`,
    );

    const persian: string = formatTestPageAmount(translatorIn("fa"), 110);
    const arabic: string = formatTestPageAmount(translatorIn("ar"), 110);

    expect(persian).toBe("$۱٫۱۰");
    // Arabic writes Latin digits in OneUptime (getNumberLocale).
    expect(arabic).toContain("1.10");
    expect(persian).not.toMatch(DIRECTION_MARKS);
    expect(arabic).not.toMatch(DIRECTION_MARKS);

    // In a Persian sentence, the list and the amount are Persian's.
    const persianLine: string = withoutIsolateMarks(
      describeTestPageCost(translatorIn("fa"), cost(3, 3, 110, 1), {
        isWalk: true,
      }),
    );

    expect(persianLine).toContain("$۱٫۱۰");
    expect(persianLine).toContain(
      worded("fa", "{{items}} and {{last}}", {
        items: [
          worded("fa", "{{count}} SMS", { count: "۳" }),
          worded("fa", "{{count}} phone calls", { count: "۳" }),
        ].join("، "),
        last: worded("fa", "{{count}} WhatsApp messages_one", { count: "۱" }),
      }),
    );
  });

  test("a policy of one escalation level is not offered the walk, nor sends one", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      levelCount: 1,
      walkLevels: [],
      walkCost: cost(1, 0, 10),
    });
    sendMock.mockResolvedValue("7e5ae000-0000-4000-8000-0000000009e1");

    await openPolicyDialog();

    expect(
      screen.queryByTestId("test-page-walks-escalation"),
    ).not.toBeInTheDocument();

    fireEvent.click(sendButton());

    expect(await screen.findByTestId("test-page-result")).toBeInTheDocument();
    expect(
      (sendMock.mock.calls[0]![0] as { walksEscalation: boolean })
        .walksEscalation,
    ).toBe(false);
  });

  test("where the walk is offered: a policy with a level after its first, or one whose server does not say", () => {
    const policy: { kind: "policy"; policyId: string } = {
      kind: "policy",
      policyId: "7e5ae000-0000-4000-8000-0000000009c1",
    };
    const withLevels: (
      levelCount: number | undefined,
    ) => OnCallTestPagePreview = (
      levelCount: number | undefined,
    ): OnCallTestPagePreview => {
      const preview: OnCallTestPagePreview = currentPreview();

      if (levelCount === undefined) {
        delete preview.levelCount;
      } else {
        preview.levelCount = levelCount;
      }

      return preview;
    };

    expect(isWalkOffered(policy, withLevels(3))).toBe(true);
    expect(isWalkOffered(policy, withLevels(2))).toBe(true);
    expect(isWalkOffered(policy, withLevels(undefined))).toBe(true);
    expect(isWalkOffered(policy, withLevels(1))).toBe(false);
    expect(isWalkOffered(policy, withLevels(0))).toBe(false);
    // Before the preview is read, and for a test of people: never.
    expect(isWalkOffered(policy, null)).toBe(false);
    expect(isWalkOffered({ kind: "self" }, withLevels(3))).toBe(false);
  });

  test("whether a test pages anybody: its first level, or - walking - any level it reaches", () => {
    const nobodyFirst: OnCallTestPagePreview = {
      ...currentPreview(),
      people: [],
    };
    const nobodyAnywhere: OnCallTestPagePreview = {
      ...nobodyFirst,
      walkLevels: (nobodyFirst.walkLevels || []).map(
        (level: OnCallTestPagePreviewLevel): OnCallTestPagePreviewLevel => {
          return { ...level, people: [] };
        },
      ),
    };

    expect(doesTestPageAnybody(null, true)).toBe(false);
    expect(doesTestPageAnybody(currentPreview(), false)).toBe(true);
    expect(doesTestPageAnybody(nobodyFirst, false)).toBe(false);
    expect(doesTestPageAnybody(nobodyFirst, true)).toBe(true);
    expect(doesTestPageAnybody(nobodyAnywhere, true)).toBe(false);
    expect(doesTestPageAnybody(olderServersPreview(), true)).toBe(true);
  });
});
