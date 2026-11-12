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
  describeTestPageCost,
  doesTestPageAnybody,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal";
import {
  getNotPagedLines,
  getNotPagedSentence,
  getPersonWarnings,
  getReachedThroughWords,
  getWalkLevelHeading,
  getWarningSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
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
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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

function cost(
  smsCount: number,
  callCount: number,
  estimatedCostInUSDCents?: number,
): OnCallTestPageCost {
  return {
    isPaid: smsCount + callCount > 0,
    smsCount: smsCount,
    callCount: callCount,
    whatsAppCount: 0,
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

    expect(
      levels.map((level: HTMLElement): string => {
        return textOf(level.querySelector("p")!);
      }),
    ).toEqual([
      "Level 1, right away",
      "Level 2, after 2 minutes",
      "Level 3, after 4 minutes",
    ]);
    expect(textOf(levels[0]!)).toContain("Ana Lopez");
    expect(textOf(levels[1]!)).toContain("Bob Stone");
    expect(textOf(levels[1]!)).toContain("Team Platform");
    expect(textOf(levels[2]!)).toContain(LEVEL_3_EMPTY);
    // The first level is still the one the preview names.
    expect(
      within(levels[0]!).getByTestId("test-page-preview"),
    ).toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toBe(
      "If nobody acknowledges it, walking every level sends up to 1 SMS, 1 phone call, paid from this project's SMS and call balance: about $0.35.",
    );
    expect(
      screen.queryByTestId("test-page-walk-unreached"),
    ).not.toBeInTheDocument();

    // Off again: the first level, and its own cost.
    walkEveryLevel();

    expect(screen.queryByTestId("test-page-walk")).not.toBeInTheDocument();
    expect(textOf(screen.getByTestId("test-page-cost"))).toContain("$0.10");
  });

  test("the levels it ends before are counted", async () => {
    previewMock.mockResolvedValue({
      ...currentPreview(),
      walkUnreachedLevelCount: 2,
    });

    await openPolicyDialog();
    walkEveryLevel();

    expect(textOf(await screen.findByTestId("test-page-walk-unreached"))).toBe(
      "The test ends before it reaches 2 more levels.",
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
    const headings: Array<string> = within(walk)
      .getAllByTestId("test-page-walk-level")
      .map((level: HTMLElement): string => {
        return textOf(level.querySelector("p")!);
      });

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

    expect(costLine).toContain("$0.35");
    expect(costLine).not.toContain("walking every level");
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
      "This test sends 2 SMS, 1 phone call, paid from this project's SMS and call balance: about $0.45.",
    );
    expect(
      describeTestPageCost(english, cost(2, 1, 45), { isWalk: true }),
    ).toBe(
      "If nobody acknowledges it, walking every level sends up to 2 SMS, 1 phone call, paid from this project's SMS and call balance: about $0.45.",
    );
    expect(describeTestPageCost(english, cost(0, 2), { isWalk: true })).toBe(
      "If nobody acknowledges it, walking every level sends up to 2 phone calls, paid from this project's SMS and call balance.",
    );
    expect(describeTestPageCost(english, cost(0, 0), { isWalk: true })).toBe(
      "",
    );
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
