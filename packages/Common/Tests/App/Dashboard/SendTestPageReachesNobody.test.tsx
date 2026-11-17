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
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TEST PAGE DIALOG WHILE NOBODY WOULD GET ANYTHING (#7529, #7259).
 *
 * Send stays off while the preview says the test reaches nobody - not only
 * when it names nobody, but when everybody it names would be sent nothing:
 * opted out, no rule and no fallback, nothing the fallback may use, only
 * methods that are not verified or whose channel the project turned off.
 * One line under the preview says why, and the one next step: for
 * yourself, the page that puts it right; for a member or a policy, that
 * the lines above say why. A policy whose first level reaches nobody while
 * a later level can offers walking every level, in one click.
 *
 * A server from before #7262 lists no method for a person with no rule,
 * whom the fallback may still reach: they count as reached, as before.
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
  doesLevelReachAnybody,
  doesTestPageAnybody,
  getNobodyReachedFix,
  getNobodyReachedSentence,
  getTestPageNobodyReached,
  isPersonReachedByTest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal";
import { OnCallTestPageTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi";
import {
  REACHES_NOBODY_SENTENCES,
  WALK_EVERY_LEVEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageCost,
  OnCallTestPageFix,
  OnCallTestPageKind,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreview,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
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

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

function translatorIn(language: string): Translator {
  const locale: Record<string, string> = LOCALES[language]!;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const NO_COST: OnCallTestPageCost = {
  isPaid: false,
  smsCount: 0,
  callCount: 0,
  whatsAppCount: 0,
  telegramCount: 0,
};

function method(
  channel: OnCallPageChannel,
  data: Partial<OnCallTestPagePreviewMethod> = {},
): OnCallTestPagePreviewMethod {
  return {
    channel: channel,
    notifyAfterMinutes: 0,
    isVerified: true,
    canAcknowledge: true,
    ...data,
  };
}

function person(
  name: string,
  data: Partial<OnCallTestPagePreviewPerson> = {},
): OnCallTestPagePreviewPerson {
  return {
    userId: `7e5b3000-0000-4000-8000-${String(name.length).padStart(12, "0")}`,
    userName: name,
    methods: [method(OnCallPageChannel.SMS)],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    warningCodes: [],
    ...data,
  };
}

const NOTHING_TO_FALL_BACK_TO: string =
  "No on-call rule covers this severity, and no verified method can be used instead: the test sends nothing.";

// No rule, and nothing the fallback may use (#7262): sent nothing.
function withNothingToFallBackTo(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [],
    hasNoRule: true,
    warnings: [NOTHING_TO_FALL_BACK_TO],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
        message: NOTHING_TO_FALL_BACK_TO,
      },
    ],
  });
}

// Opted out of pages of the severity: sent nothing.
function optedOut(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [],
    hasNoRule: true,
    isOptedOut: true,
    warnings: ["Opted out."],
    warningCodes: [
      { code: OnCallTestPageWarningCode.OptedOut, message: "Opted out." },
    ],
  });
}

// No rule, and a project that does not fall back: sent nothing.
function noFallback(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [],
    hasNoRule: true,
    warnings: ["No fallback."],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleNoFallback,
        message: "No fallback.",
      },
    ],
  });
}

// Rules that name only a method that is not verified.
function unverifiedOnly(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [method(OnCallPageChannel.SMS, { isVerified: false })],
    warnings: ["Not verified."],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.MethodNotVerified,
        channel: OnCallPageChannel.SMS,
        message: "Not verified.",
      },
    ],
  });
}

// Rules that name only SMS, which the project turned off.
function smsOffOnly(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [method(OnCallPageChannel.SMS)],
    warnings: ["SMS is off."],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.ChannelOff,
        channel: OnCallPageChannel.SMS,
        message: "SMS is off.",
      },
    ],
  });
}

// No rule: the fallback picks the email they verified on joining (#7262).
function fallingBackToEmail(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [method(OnCallPageChannel.Email, { isFallback: true })],
    hasNoRule: true,
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleFallsBackToListed,
        message: "Falls back.",
      },
    ],
  });
}

// A server from before #7262: no rule, no method listed, "every verified method".
function olderServersNoRule(name: string): OnCallTestPagePreviewPerson {
  return person(name, {
    methods: [],
    hasNoRule: true,
    warnings: ["Goes to every verified method."],
    warningCodes: [
      {
        code: OnCallTestPageWarningCode.NoRuleFallsBack,
        message: "Goes to every verified method.",
      },
    ],
  });
}

function selfPreview(you: OnCallTestPagePreviewPerson): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Self,
    people: [you],
    notPaged: [],
    notPagedCodes: [],
    cost: NO_COST,
  };
}

const NOBODY_ON_CALL: string = "Nobody is on call in schedule Primary now.";

function policyPreview(
  first: Array<OnCallTestPagePreviewPerson>,
  second: Array<OnCallTestPagePreviewPerson> = [person("Bob Stone")],
): OnCallTestPagePreview {
  return {
    kind: OnCallTestPageKind.Policy,
    people: first,
    notPaged: first.length === 0 ? [NOBODY_ON_CALL] : [],
    notPagedCodes:
      first.length === 0
        ? [
            {
              code: OnCallTestPageNotPagedCode.NobodyOnCall,
              scheduleName: "Primary",
              message: NOBODY_ON_CALL,
            },
          ]
        : [],
    levelCount: 2,
    cost: NO_COST,
    walkLevels: [
      {
        order: 2,
        startsAfterMinutes: 0,
        people: second,
        notPaged: [],
        notPagedCodes: [],
      },
    ],
    walkUnreachedLevelCount: 0,
    walkCost: NO_COST,
  };
}

const SELF: OnCallTestPageTarget = { kind: "self" };
const MEMBER: OnCallTestPageTarget = {
  kind: "member",
  userId: "7e5b3000-0000-4000-8000-0000000000a1",
  userName: "Ana Lopez",
};
const POLICY: OnCallTestPageTarget = {
  kind: "policy",
  policyId: "7e5b3000-0000-4000-8000-0000000000c1",
  policyName: "Payments primary",
};

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function openDialog(target: OnCallTestPageTarget): Promise<void> {
  render(
    <MemoryRouter>
      <SendTestPageModal target={target} onClose={() => {}} />
    </MemoryRouter>,
  );

  await screen.findByTestId("test-page-preview");
}

function sendButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

function reason(): string {
  return textOf(screen.getByTestId("test-page-reaches-nobody-reason"));
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
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
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("who a test reaches (#7529)", () => {
  test("somebody the test may send something: a verified method on a channel that is on", () => {
    expect(isPersonReachedByTest(person("Ana"))).toBe(true);
    expect(isPersonReachedByTest(fallingBackToEmail("Ana"))).toBe(true);
    // One usable method among unusable ones is enough.
    expect(
      isPersonReachedByTest(
        person("Ana", {
          methods: [
            method(OnCallPageChannel.SMS, { isVerified: false }),
            method(OnCallPageChannel.Email),
          ],
        }),
      ),
    ).toBe(true);
  });

  test.each([
    ["opted out", optedOut("Ana")],
    ["no rule, and a project that does not fall back", noFallback("Ana")],
    [
      "no rule, and nothing the fallback may use",
      withNothingToFallBackTo("Ana"),
    ],
    ["only a method that is not verified", unverifiedOnly("Ana")],
    ["only a channel the project turned off", smsOffOnly("Ana")],
  ] as Array<[string, OnCallTestPagePreviewPerson]>)(
    "nobody it sends nothing: %s",
    (_why: string, who: OnCallTestPagePreviewPerson) => {
      expect(isPersonReachedByTest(who)).toBe(false);
    },
  );

  test("an older server's person with no rule, whom the fallback may still reach, is reached", () => {
    expect(isPersonReachedByTest(olderServersNoRule("Ana"))).toBe(true);

    // And one from before the codes, which says nothing a Dashboard can read.
    const beforeCodes: OnCallTestPagePreviewPerson = olderServersNoRule("Ana");
    delete beforeCodes.warningCodes;

    expect(isPersonReachedByTest(beforeCodes)).toBe(true);
  });

  test("opted out is read from the person, not only from its line: one from before the codes is sent nothing too", () => {
    const beforeCodes: OnCallTestPagePreviewPerson = optedOut("Ana");
    delete beforeCodes.warningCodes;

    expect(isPersonReachedByTest(beforeCodes)).toBe(false);
  });

  test("a level reaches anybody only through somebody it may send something", () => {
    expect(
      doesLevelReachAnybody({ people: [optedOut("A"), noFallback("B")] }),
    ).toBe(false);
    expect(
      doesLevelReachAnybody({ people: [optedOut("A"), person("B")] }),
    ).toBe(true);
    expect(doesLevelReachAnybody({ people: [] })).toBe(false);
  });

  test("a test reaches anybody: its first level, or - walking - any level it reaches", () => {
    const unreachableFirst: OnCallTestPagePreview = policyPreview([
      optedOut("Ana"),
    ]);

    expect(doesTestPageAnybody(unreachableFirst, false)).toBe(false);
    expect(doesTestPageAnybody(unreachableFirst, true)).toBe(true);
    expect(
      doesTestPageAnybody(
        policyPreview([optedOut("Ana")], [noFallback("Bob")]),
        true,
      ),
    ).toBe(false);
  });
});

describe("why Send is off, and the one next step", () => {
  test("for yourself: Notification Methods when a method needs verifying, How to Reach Me otherwise", () => {
    expect(getNobodyReachedFix(withNothingToFallBackTo("You"))).toBe(
      OnCallTestPageFix.NotificationMethods,
    );
    expect(getNobodyReachedFix(unverifiedOnly("You"))).toBe(
      OnCallTestPageFix.NotificationMethods,
    );
    expect(getNobodyReachedFix(optedOut("You"))).toBe(
      OnCallTestPageFix.OnCallRules,
    );
    expect(getNobodyReachedFix(noFallback("You"))).toBe(
      OnCallTestPageFix.OnCallRules,
    );
    expect(getNobodyReachedFix(smsOffOnly("You"))).toBe(
      OnCallTestPageFix.OnCallRules,
    );
    expect(getNobodyReachedFix(undefined)).toBe(OnCallTestPageFix.OnCallRules);
  });

  test("each target's reason - and none while the test reaches somebody, or before its preview is read", () => {
    expect(
      getTestPageNobodyReached({
        target: SELF,
        preview: selfPreview(withNothingToFallBackTo("You")),
        offersWalk: false,
        isWalking: false,
      }),
    ).toEqual({ kind: "self", fix: OnCallTestPageFix.NotificationMethods });
    expect(
      getTestPageNobodyReached({
        target: MEMBER,
        preview: selfPreview(optedOut("Ana")),
        offersWalk: false,
        isWalking: false,
      }),
    ).toEqual({ kind: "member" });
    expect(
      getTestPageNobodyReached({
        target: POLICY,
        preview: policyPreview([optedOut("Ana")], [optedOut("Bob")]),
        offersWalk: true,
        isWalking: false,
      }),
    ).toEqual({ kind: "policy" });
    expect(
      getTestPageNobodyReached({
        target: SELF,
        preview: selfPreview(person("You")),
        offersWalk: false,
        isWalking: false,
      }),
    ).toBeNull();
    expect(
      getTestPageNobodyReached({
        target: SELF,
        preview: null,
        offersWalk: false,
        isWalking: false,
      }),
    ).toBeNull();
  });

  test("a first level that reaches nobody, with a later level that can, offers the walk - only while it is offered and off (#7259)", () => {
    const preview: OnCallTestPagePreview = policyPreview([]);

    expect(
      getTestPageNobodyReached({
        target: POLICY,
        preview: preview,
        offersWalk: true,
        isWalking: false,
      }),
    ).toEqual({ kind: "walkReachesLaterLevel" });
    // Walking: the later level is paged, and nothing is said.
    expect(
      getTestPageNobodyReached({
        target: POLICY,
        preview: preview,
        offersWalk: true,
        isWalking: true,
      }),
    ).toBeNull();
    // Not offered: nothing to walk to.
    expect(
      getTestPageNobodyReached({
        target: POLICY,
        preview: preview,
        offersWalk: false,
        isWalking: false,
      }),
    ).toEqual({ kind: "policy" });
  });

  test("the sentences, in English: one each, the member by name", () => {
    const english: Translator = translatorIn("en");

    expect(
      getNobodyReachedSentence(
        english,
        { kind: "self", fix: OnCallTestPageFix.NotificationMethods },
        SELF,
      ),
    ).toBe(
      "This test would send you nothing yet. Verify a way to reach you, then send it.",
    );
    expect(
      getNobodyReachedSentence(
        english,
        { kind: "self", fix: OnCallTestPageFix.OnCallRules },
        SELF,
      ),
    ).toBe(
      "This test would send you nothing yet. Choose how you are reached for this severity, then send it.",
    );
    expect(
      withoutIsolateMarks(
        getNobodyReachedSentence(english, { kind: "member" }, MEMBER),
      ),
    ).toBe(
      "This test would send Ana Lopez nothing yet. The line above says why.",
    );
    expect(
      getNobodyReachedSentence(
        english,
        { kind: "member" },
        { kind: "member", userId: "7e5b3000-0000-4000-8000-0000000000a1" },
      ),
    ).toBe("This test would send them nothing yet. The line above says why.");
    expect(getNobodyReachedSentence(english, { kind: "policy" }, POLICY)).toBe(
      "This test would send nothing yet: nobody it pages can receive it right now. Each line above says why.",
    );
    expect(
      getNobodyReachedSentence(
        english,
        { kind: "walkReachesLaterLevel" },
        POLICY,
      ),
    ).toBe(
      "Nobody on the first level can receive this test right now, so it would send nothing. A later level can.",
    );
  });

  test("every sentence is worded in every Dashboard language", () => {
    const keys: Array<string> = [
      ...Object.values(REACHES_NOBODY_SENTENCES),
      WALK_EVERY_LEVEL,
    ];

    for (const language of fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      })) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, language), "utf8"),
      ) as Record<string, string>;

      for (const key of keys) {
        expect({ language, key, worded: Boolean(locale[key]) }).toEqual({
          language,
          key,
          worded: true,
        });
        expect({ language, key, isEnglish: locale[key] === key }).toEqual({
          language,
          key,
          isEnglish: false,
        });
      }
    }
  });
});

describe("the dialog: yourself", () => {
  test("no rule and nothing to fall back to: Send is off, the line says why, and Open Notification Methods puts it right", async () => {
    previewMock.mockResolvedValue(selfPreview(withNothingToFallBackTo("You")));

    await openDialog(SELF);

    expect(sendButton()).toBeDisabled();
    expect(reason()).toBe(
      "This test would send you nothing yet. Verify a way to reach you, then send it.",
    );

    const fix: HTMLElement = screen.getByTestId("test-page-reaches-nobody-fix");

    expect(textOf(fix)).toBe("Open Notification Methods");
    expect(fix.closest("a")?.getAttribute("href")).toContain(
      "/user-settings/notification-methods",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("the severity picker is named by its label", async () => {
    previewMock.mockResolvedValue(selfPreview(person("You")));

    await openDialog(SELF);

    expect(
      screen.getByRole("combobox", { name: "Severity" }),
    ).toBeInTheDocument();
  });

  test("opted out: the line points to How to Reach Me", async () => {
    previewMock.mockResolvedValue(selfPreview(optedOut("You")));

    await openDialog(SELF);

    expect(sendButton()).toBeDisabled();
    expect(reason()).toBe(
      "This test would send you nothing yet. Choose how you are reached for this severity, then send it.",
    );
    expect(textOf(screen.getByTestId("test-page-reaches-nobody-fix"))).toBe(
      "Open How to Reach Me",
    );
  });

  test("with one method the fallback may use, Send is on and nothing is said", async () => {
    previewMock.mockResolvedValue(selfPreview(fallingBackToEmail("You")));

    await openDialog(SELF);

    expect(sendButton()).toBeEnabled();
    expect(
      screen.queryByTestId("test-page-reaches-nobody"),
    ).not.toBeInTheDocument();
  });

  test("an older server's preview of a person with no rule: Send is on, as before", async () => {
    previewMock.mockResolvedValue(selfPreview(olderServersNoRule("You")));

    await openDialog(SELF);

    expect(sendButton()).toBeEnabled();
    expect(
      screen.queryByTestId("test-page-reaches-nobody"),
    ).not.toBeInTheDocument();
  });

  test("in German and Arabic, the line and its link are the reader's", async () => {
    for (const language of ["de", "ar"]) {
      previewMock.mockResolvedValue(
        selfPreview(withNothingToFallBackTo("You")),
      );

      await readIn(language);
      await openDialog(SELF);

      expect(reason()).toBe(
        LOCALES[language]![REACHES_NOBODY_SENTENCES.selfVerify],
      );
      expect(textOf(screen.getByTestId("test-page-reaches-nobody-fix"))).toBe(
        LOCALES[language]!["Open Notification Methods"],
      );

      cleanup();
    }
  });
});

describe("the dialog: a member", () => {
  test("nothing would reach them: Send is off, and the line names them", async () => {
    previewMock.mockResolvedValue(selfPreview(unverifiedOnly("Ana Lopez")));

    await openDialog(MEMBER);

    expect(sendButton()).toBeDisabled();
    expect(reason()).toBe(
      "This test would send Ana Lopez nothing yet. The line above says why.",
    );
    // Their methods are theirs to fix: no link.
    expect(
      screen.queryByTestId("test-page-reaches-nobody-fix"),
    ).not.toBeInTheDocument();
  });
});

describe("the dialog: a policy", () => {
  test.each([
    ["opted out", [optedOut("Ana"), optedOut("Lee")]],
    ["no rule, and no fallback", [noFallback("Ana")]],
    ["nothing the fallback may use", [withNothingToFallBackTo("Ana")]],
    [
      "only methods that can't be used",
      [unverifiedOnly("Ana"), smsOffOnly("Lee")],
    ],
  ] as Array<[string, Array<OnCallTestPagePreviewPerson>]>)(
    "every person of its first level %s, and no later level that can: Send is off, and the line says nobody can receive it",
    async (_why: string, people: Array<OnCallTestPagePreviewPerson>) => {
      previewMock.mockResolvedValue(policyPreview(people, [noFallback("Bob")]));

      await openDialog(POLICY);

      expect(sendButton()).toBeDisabled();
      expect(reason()).toBe(
        "This test would send nothing yet: nobody it pages can receive it right now. Each line above says why.",
      );
      expect(
        screen.queryByTestId("test-page-reaches-nobody-walk"),
      ).not.toBeInTheDocument();
    },
  );

  test("one person of its first level who can be reached: Send is on, and nothing is said", async () => {
    previewMock.mockResolvedValue(
      policyPreview([optedOut("Ana"), person("Lee")]),
    );

    await openDialog(POLICY);

    expect(sendButton()).toBeEnabled();
    expect(
      screen.queryByTestId("test-page-reaches-nobody"),
    ).not.toBeInTheDocument();
  });
});

describe("the dialog: a first level that reaches nobody, with a later level that can (#7259)", () => {
  test("says so and offers the walk; Send stays off until the walk is on", async () => {
    previewMock.mockResolvedValue(policyPreview([]));

    await openDialog(POLICY);

    expect(sendButton()).toBeDisabled();
    expect(reason()).toBe(
      "Nobody on the first level can receive this test right now, so it would send nothing. A later level can.",
    );

    const walk: HTMLElement = screen.getByTestId(
      "test-page-reaches-nobody-walk",
    );

    expect(textOf(walk)).toBe("Walk every escalation level");

    // One click: the walk is on, level 2 is listed, and the line is gone.
    fireEvent.click(walk);

    expect(await screen.findByTestId("test-page-walk")).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    expect(
      screen.queryByTestId("test-page-reaches-nobody"),
    ).not.toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  test("a first level whose people would all be sent nothing offers the walk too", async () => {
    previewMock.mockResolvedValue(policyPreview([optedOut("Ana")]));

    await openDialog(POLICY);

    expect(sendButton()).toBeDisabled();
    expect(
      screen.getByTestId("test-page-reaches-nobody-walk"),
    ).toBeInTheDocument();
  });

  test("the walk it offers sends what the walk sends", async () => {
    previewMock.mockResolvedValue(policyPreview([]));
    sendMock.mockResolvedValue("7e5b3000-0000-4000-8000-0000000000e1");

    await openDialog(POLICY);
    fireEvent.click(screen.getByTestId("test-page-reaches-nobody-walk"));
    await screen.findByTestId("test-page-walk");

    await act(async () => {
      fireEvent.click(sendButton());
    });

    expect(sendMock).toHaveBeenCalledWith({
      target: POLICY,
      severity: { recordKind: "Incident", severityId: "sev-1" },
      walksEscalation: true,
    });
  });

  test("turning the walk off again brings the line back", async () => {
    previewMock.mockResolvedValue(policyPreview([]));

    await openDialog(POLICY);
    fireEvent.click(screen.getByTestId("test-page-reaches-nobody-walk"));
    await screen.findByTestId("test-page-walk");

    fireEvent.click(screen.getByTestId("test-page-walks-escalation"));

    expect(
      await screen.findByTestId("test-page-reaches-nobody-walk"),
    ).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  test("in Persian, the line and its button are Persian", async () => {
    previewMock.mockResolvedValue(policyPreview([]));

    await readIn("fa");
    await openDialog(POLICY);

    expect(reason()).toBe(
      LOCALES["fa"]![REACHES_NOBODY_SENTENCES.firstLevelOnly],
    );
    expect(textOf(screen.getByTestId("test-page-reaches-nobody-walk"))).toBe(
      LOCALES["fa"]![WALK_EVERY_LEVEL],
    );
  });
});
