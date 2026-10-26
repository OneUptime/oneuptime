import "@testing-library/jest-dom";
import {
  afterEach,
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
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import React, { ReactElement } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  PASS_ON_RECORD_TEXT,
  describePassOnAnswers,
  describePassOnPreview,
  describePassOnRefusal,
  describePassOnResult,
  fetchOpenPages,
  formatPassOnTime,
  getPassOnAnswerLines,
  getPassOnAnswerTitle,
  getPassOnPageRoute,
  getPassOnQuestionLines,
  getPassOnQuestionTitle,
  getPassOnRecordText,
  isAnyPassedOn,
  passOnPages,
  readOpenPages,
  readPassOnAnswers,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ESCALATE,
  ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
  ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
  ON_CALL_PAGE_ESCALATED_STATUS_LABEL,
  ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
  ON_CALL_PAGE_PASS_ON_ROUTE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
  getOnCallPageNotPagedAgainSentence,
  getOnCallPageRecordNoun,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  getOnCallPassOnTimeOfDay,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { StateListType } from "../../../Utils/StateOrder";

/*
 * "ESCALATE" ON A RECORD'S PAGE, IN ENGLISH (task escalate-incident-copy).
 *
 * The person an on-call policy is paging about an incident, an alert or an
 * episode can escalate the page from the record's header: the policy pages
 * its next level now instead of waiting the level out. The button is there
 * only for them. It asks first, in the maintainer's words -
 *
 *   Escalate Incident?
 *   This will immediately page Next_level_name (Level 2 of 3), without
 *     waiting.
 *   You will not be paged again for this incident.
 *   Escalate/Cancel
 *
 * - and then says what it did, or why it could not (somebody acknowledged
 * it meanwhile, the page is over). The action was called "Pass it on"
 * before; nothing on the page says that any more.
 *
 * The header is the real EventStatusPanel and the dialog the real
 * ConfirmModal; only the server is replaced, at API.get / API.post. The
 * words in other languages are in OnCallPassOnPageGerman.test.tsx.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "4c1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "5d2e8f3b-6c40-4f7b-8d9e-1b2c3d4e5f60",
);

const ENGLISH: Translator = createTranslator(undefined, "en");

// The level of the maintainer's screenshot: "second", the policy's 2nd of 3.
const SECOND: OnCallPassOnRule = { order: 2, name: "second" };

function result(overrides: Partial<OnCallPassOnResult>): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Critical",
    rule: { order: 2, name: "Platform leads" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 3,
    ...overrides,
  };
}

function page(overrides: Partial<OnCallPassOnResult>): OnCallOpenPage {
  return {
    executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
    preview: result(overrides),
  };
}

// A record kind, with what its dialog calls it.
interface RecordWords {
  recordType: OnCallPageRecordType;
  question: string;
  doneTitle: string;
  notPagedAgain: string;
}

// The record kinds, with what their dialog calls them.
const RECORDS: Array<RecordWords> = [
  {
    recordType: OnCallPageRecordType.Incident,
    question: "Escalate Incident?",
    doneTitle: "Incident escalated",
    notPagedAgain: "You will not be paged again for this incident.",
  },
  {
    recordType: OnCallPageRecordType.Alert,
    question: "Escalate Alert?",
    doneTitle: "Alert escalated",
    notPagedAgain: "You will not be paged again for this alert.",
  },
  {
    recordType: OnCallPageRecordType.IncidentEpisode,
    question: "Escalate Episode?",
    doneTitle: "Episode escalated",
    notPagedAgain: "You will not be paged again for this episode.",
  },
  {
    recordType: OnCallPageRecordType.AlertEpisode,
    question: "Escalate Episode?",
    doneTitle: "Episode escalated",
    notPagedAgain: "You will not be paged again for this episode.",
  },
];

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what escalating will do: the maintainer's sentence", () => {
  test("the next level by its name, then its place, without waiting", () => {
    expect(describePassOnResult(result({ rule: SECOND }), ENGLISH)).toBe(
      "This will immediately page second (Level 2 of 3), without waiting.",
    );
    expect(describePassOnResult(result({}), ENGLISH)).toBe(
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
    );
  });

  test("a level with no name of its own is its place: never 'Level 2 (Level 2 of 3)'", () => {
    for (const name of [undefined, "", "  ", "Level 2", "level 2"]) {
      expect(
        describePassOnResult(
          result({ rule: { order: 2, name: name } }),
          ENGLISH,
        ),
      ).toBe("This will immediately page Level 2 of 3, without waiting.");
    }
  });

  test("a name somebody chose is kept, even one that names another place", () => {
    expect(
      describePassOnResult(
        result({ rule: { order: 3, name: "Level 1" } }),
        ENGLISH,
      ),
    ).toBe(
      "This will immediately page Level 1 (Level 3 of 3), without waiting.",
    );
  });

  test("a level the reader may not read is 'the next level'", () => {
    expect(describePassOnResult(result({ rule: undefined }), ENGLISH)).toBe(
      "This will immediately page the next level, without waiting.",
    );
    expect(
      describePassOnResult(result({ rule: { order: 0, name: "X" } }), ENGLISH),
    ).toBe("This will immediately page the next level, without waiting.");
  });

  test("'2 of 3' never says fewer levels than the level's own place", () => {
    expect(describePassOnResult(result({ ruleCount: 0 }), ENGLISH)).toBe(
      "This will immediately page Platform leads (Level 2 of 2), without waiting.",
    );
  });

  test("the last level, with Repeat Policy on: the first level again", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "First responders" },
        }),
        ENGLISH,
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page First responders (Level 1 of 3) again, without waiting.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "Level 1" },
        }),
        ENGLISH,
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page Level 1 of 3 again, without waiting.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: undefined,
        }),
        ENGLISH,
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page the first level again, without waiting.",
    );
  });

  test("nobody left to page: paging stops, and somebody needs to take it", () => {
    expect(
      describePassOnResult(
        result({ outcome: OnCallPassOnOutcome.PagingStopped }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PagingStopped,
          isDirectPage: true,
        }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is being paged: paging stops, and somebody needs to take it.",
    );
  });

  test("others on the level are still paged: one person, several", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith is still being paged.");
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith", "Carl Diaz"],
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith and Carl Diaz are still being paged.");
  });

  test("...and when the policy pages the next level if none of them acknowledges: today, just the time", () => {
    const at: Date = new Date("2026-10-16T12:30:00.000Z");
    // Half an hour before: the level's wait is running.
    const now: Date = new Date("2026-10-16T12:00:00.000Z");
    const time: string = getOnCallPassOnTimeOfDay({ at: at });

    // "6:40 PM GMT": no date in front of a time half an hour away.
    expect(time).not.toContain("2026");

    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
          nextRule: { order: 3, name: "Managers" },
        }),
        ENGLISH,
        now,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, the policy pages Managers (Level 3 of 3) next.`,
    );

    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
          nextRule: { order: 3, name: "Level 3" },
        }),
        ENGLISH,
        now,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, the policy pages Level 3 of 3 next.`,
    );

    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
        }),
        ENGLISH,
        now,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, the policy moves on.`,
    );
  });

  test("...a time on another day keeps its date", () => {
    const at: Date = new Date("2026-10-17T12:30:00.000Z");
    const now: Date = new Date("2026-10-16T12:00:00.000Z");
    const time: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(at);

    expect(formatPassOnTime(at, now)).toBe(time);
    expect(time).toContain("2026");
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
        }),
        ENGLISH,
        now,
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${time}, the policy moves on.`,
    );
  });

  test("...read now, unless it is told when", () => {
    const soon: Date = new Date("2026-10-16T12:30:00.000Z");

    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-16T12:00:00.000Z"));

    expect(formatPassOnTime(soon)).toBe(getOnCallPassOnTimeOfDay({ at: soon }));
  });

  test("a direct page has no levels to move on to: who is still paged, only", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          isDirectPage: true,
          policyName: "",
          rule: undefined,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: new Date("2026-10-16T09:30:00.000Z"),
        }),
        ENGLISH,
      ),
    ).toBe("Bob Smith is still being paged.");
  });

  test("the policy moved on already: the level paging now", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: { order: 3, name: "Managers" },
        }),
        ENGLISH,
      ),
    ).toBe(
      "The policy has moved on already and is paging Managers (Level 3 of 3) now.",
    );
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: { order: 3 },
        }),
        ENGLISH,
      ),
    ).toBe("The policy has moved on already and is paging Level 3 of 3 now.");
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: undefined,
        }),
        ENGLISH,
      ),
    ).toBe("The policy has moved on already and is paging a later level now.");
  });
});

describe("what escalating did", () => {
  test("the level now paging, and who", () => {
    expect(
      describePassOnResult(
        result({ isPreview: false, pagedNames: ["Bob Smith", "Carl Diaz"] }),
        ENGLISH,
      ),
    ).toBe(
      "The policy is now paging Platform leads (Level 2 of 3): Bob Smith and Carl Diaz.",
    );
    expect(
      describePassOnResult(
        result({
          isPreview: false,
          pagedNames: ["Ana Lopez", "Bob Smith", "Carl Diaz"],
        }),
        ENGLISH,
      ),
    ).toBe(
      "The policy is now paging Platform leads (Level 2 of 3): Ana Lopez, Bob Smith and Carl Diaz.",
    );
  });

  test("a level with no name of its own, and one that reached nobody yet", () => {
    expect(
      describePassOnResult(
        result({
          isPreview: false,
          rule: { order: 2, name: "Level 2" },
          pagedNames: ["Sam Lee"],
        }),
        ENGLISH,
      ),
    ).toBe("The policy is now paging Level 2 of 3: Sam Lee.");
    expect(describePassOnResult(result({ isPreview: false }), ENGLISH)).toBe(
      "The policy is now paging Platform leads (Level 2 of 3).",
    );
    expect(
      describePassOnResult(
        result({ isPreview: false, rule: undefined, pagedNames: ["Sam Lee"] }),
        ENGLISH,
      ),
    ).toBe("The policy is now paging the next level.");
  });

  test("the policy started over", () => {
    expect(
      describePassOnResult(
        result({
          isPreview: false,
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "First responders" },
        }),
        ENGLISH,
      ),
    ).toBe(
      "There was no level after yours, so the policy started over and is paging First responders (Level 1 of 3) again.",
    );
    expect(
      describePassOnResult(
        result({
          isPreview: false,
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: undefined,
        }),
        ENGLISH,
      ),
    ).toBe(
      "There was no level after yours, so the policy started over and is paging the first level again.",
    );
  });

  test("paging stopped", () => {
    expect(
      describePassOnResult(
        result({
          outcome: OnCallPassOnOutcome.PagingStopped,
          isPreview: false,
        }),
        ENGLISH,
      ),
    ).toBe(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
  });
});

describe("the Dashboard's English is word for word the server's", () => {
  const AT: Date = new Date("2026-10-16T12:30:00.000Z");
  const NOW: Date = new Date("2026-10-16T12:00:00.000Z");

  const rules: Array<OnCallPassOnRule | undefined> = [
    SECOND,
    { order: 2, name: "Platform leads" },
    { order: 2, name: "Level 2" },
    { order: 2 },
    { order: 0, name: "Unknown" },
    undefined,
  ];

  for (const outcome of Object.values(OnCallPassOnOutcome)) {
    for (const isPreview of [true, false]) {
      test(`${outcome}, ${isPreview ? "before" : "after"}, whatever the level`, () => {
        jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

        for (const rule of rules) {
          for (const isDirectPage of [false, true]) {
            const each: OnCallPassOnResult = result({
              outcome,
              isPreview,
              isDirectPage,
              rule,
              nextRule: rule,
              pagedNames: isPreview ? [] : ["Sam Lee", "Priya Patel"],
              stillPagedNames: ["Bob Smith"],
              nextStepAt: AT,
            });

            expect({
              rule,
              isDirectPage,
              said: describePassOnResult(each, ENGLISH, NOW),
            }).toEqual({
              rule,
              isDirectPage,
              said: getOnCallPassOnSentence(each, { now: NOW }),
            });
          }
        }
      });
    }
  }

  test("and refusals say what the server says, but for a record the dialog does not need to name", () => {
    expect(
      describePassOnRefusal(
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.AlreadyPassedOn,
        },
        ENGLISH,
      ),
    ).toBe(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.AlreadyPassedOn,
      }),
    );

    for (const refusal of [
      OnCallPassOnRefusal.PageOver,
      OnCallPassOnRefusal.NotPaged,
    ]) {
      expect(describePassOnRefusal({ passedOn: false, refusal }, ENGLISH)).toBe(
        getOnCallPassOnRefusalSentence({ passedOn: false, refusal }),
      );
    }
  });
});

describe("why a page could not be escalated", () => {
  function refused(
    refusal: OnCallPassOnRefusal,
    acknowledgedByName?: string,
  ): OnCallPassOnAnswer {
    return { passedOn: false, refusal, acknowledgedByName };
  }

  test("somebody acknowledged it meanwhile: named, when the reader may see who", () => {
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.RecordAcknowledged, " Ana Lopez "),
        ENGLISH,
      ),
    ).toBe(
      "Ana Lopez acknowledged it already, so there is nothing to escalate.",
    );
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.RecordAcknowledged),
        ENGLISH,
      ),
    ).toBe(
      "Somebody acknowledged it already, so there is nothing to escalate.",
    );
  });

  test("escalated already, the page is over, not paged", () => {
    expect(
      describePassOnRefusal(
        refused(OnCallPassOnRefusal.AlreadyPassedOn),
        ENGLISH,
      ),
    ).toBe("You escalated it already, so you will not be paged again for it.");
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.PageOver), ENGLISH),
    ).toBe("This page is over: the on-call policy has stopped paging.");
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.NotPaged), ENGLISH),
    ).toBe("You are not being paged about this right now.");
  });

  test("a link's refusal never reaches the Dashboard as 'the link expired'", () => {
    // The Dashboard escalates by the signed-in account, never by a link.
    expect(
      describePassOnRefusal(refused(OnCallPassOnRefusal.InvalidLink), ENGLISH),
    ).toBe("You are not being paged about this right now.");
  });
});

describe("one person, two policies paging them about the same record", () => {
  test("one page: the sentence alone", () => {
    expect(describePassOnPreview([page({})], ENGLISH)).toEqual([
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
    ]);
  });

  test("two pages: each sentence says which policy it is about", () => {
    expect(
      describePassOnPreview(
        [
          page({}),
          page({
            policyName: "Database",
            outcome: OnCallPassOnOutcome.OthersStillPaged,
            stillPagedNames: ["Bob Smith"],
          }),
        ],
        ENGLISH,
      ),
    ).toEqual([
      "Critical: This will immediately page Platform leads (Level 2 of 3), without waiting.",
      "Database: Bob Smith is still being paged.",
    ]);
  });

  test("a direct page beside a policy's page has no policy to name", () => {
    expect(
      describePassOnPreview(
        [
          page({}),
          page({
            policyName: "",
            isDirectPage: true,
            rule: undefined,
            outcome: OnCallPassOnOutcome.PagingStopped,
          }),
        ],
        ENGLISH,
      ),
    ).toEqual([
      "Critical: This will immediately page Platform leads (Level 2 of 3), without waiting.",
      "Nobody else is being paged: paging stops, and somebody needs to take it.",
    ]);
  });

  test("the answers: what each escalation did, or why it could not", () => {
    const answers: Array<OnCallPassOnAnswer> = [
      {
        passedOn: true,
        result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
      },
      { passedOn: false, refusal: OnCallPassOnRefusal.PageOver },
    ];

    expect(describePassOnAnswers(answers, ENGLISH)).toEqual([
      "Critical: The policy is now paging Platform leads (Level 2 of 3): Carl Diaz.",
      "This page is over: the on-call policy has stopped paging.",
    ]);
    expect(isAnyPassedOn(answers)).toBe(true);
    expect(isAnyPassedOn([answers[1]!])).toBe(false);
    expect(isAnyPassedOn([])).toBe(false);
  });
});

describe("the dialog's lines, in the maintainer's order", () => {
  const STOPS: string =
    "Nobody else is left to page: paging stops, and somebody needs to take it.";

  test.each(RECORDS)(
    "asking about a $recordType: what escalating does, then that you are not paged again for it",
    ({ recordType, notPagedAgain }: RecordWords) => {
      expect(
        getPassOnQuestionLines([page({ rule: SECOND })], ENGLISH, recordType),
      ).toEqual([
        {
          text: "This will immediately page second (Level 2 of 3), without waiting.",
          isWarning: false,
        },
        { text: notPagedAgain, isWarning: false },
      ]);
    },
  );

  test("asking, when nobody is left to page: that is a warning, and it comes first", () => {
    expect(
      getPassOnQuestionLines(
        [page({ outcome: OnCallPassOnOutcome.PagingStopped })],
        ENGLISH,
        OnCallPageRecordType.Incident,
      ),
    ).toEqual([
      { text: STOPS, isWarning: true },
      {
        text: "You will not be paged again for this incident.",
        isWarning: false,
      },
    ]);
  });

  test("asking about two pages: only the one that stops paging warns", () => {
    expect(
      getPassOnQuestionLines(
        [
          page({}),
          page({
            policyName: "Database",
            outcome: OnCallPassOnOutcome.PagingStopped,
          }),
        ],
        ENGLISH,
        OnCallPageRecordType.Alert,
      ),
    ).toEqual([
      { text: `Database: ${STOPS}`, isWarning: true },
      {
        text: "Critical: This will immediately page Platform leads (Level 2 of 3), without waiting.",
        isWarning: false,
      },
      { text: "You will not be paged again for this alert.", isWarning: false },
    ]);
  });

  test.each(RECORDS)(
    "answering about a $recordType: what came of it, then not paged again",
    ({ recordType, notPagedAgain }: RecordWords) => {
      expect(
        getPassOnAnswerLines(
          [
            {
              passedOn: true,
              result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
            },
          ],
          ENGLISH,
          recordType,
        ),
      ).toEqual([
        {
          text: "The policy is now paging Platform leads (Level 2 of 3): Carl Diaz.",
          isWarning: false,
        },
        { text: notPagedAgain, isWarning: false },
      ]);
    },
  );

  test("answering, when paging stopped: the warning first", () => {
    expect(
      getPassOnAnswerLines(
        [
          {
            passedOn: true,
            result: result({
              isPreview: false,
              outcome: OnCallPassOnOutcome.PagingStopped,
            }),
          },
        ],
        ENGLISH,
        OnCallPageRecordType.Incident,
      ),
    ).toEqual([
      {
        text: "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
        isWarning: true,
      },
      {
        text: "You will not be paged again for this incident.",
        isWarning: false,
      },
    ]);
  });

  test("a refusal is no warning, and promises nothing about being paged", () => {
    expect(
      getPassOnAnswerLines(
        [{ passedOn: false, refusal: OnCallPassOnRefusal.PageOver }],
        ENGLISH,
        OnCallPageRecordType.Incident,
      ),
    ).toEqual([
      {
        text: "This page is over: the on-call policy has stopped paging.",
        isWarning: false,
      },
    ]);
  });
});

describe("the dialog's titles", () => {
  function refused(refusal: OnCallPassOnRefusal): OnCallPassOnAnswer {
    return { passedOn: false, refusal: refusal };
  }

  test.each(RECORDS)(
    "a $recordType: the question, then what was done",
    ({ recordType, question, doneTitle }: RecordWords) => {
      expect(getPassOnQuestionTitle(recordType)).toBe(question);
      expect(
        getPassOnAnswerTitle(
          [
            { passedOn: true, result: result({ isPreview: false }) },
            refused(OnCallPassOnRefusal.PageOver),
          ],
          recordType,
        ),
      ).toBe(doneTitle);
    },
  );

  test("refused: why, in a few words - the sentence under it says the rest", () => {
    expect(
      getPassOnAnswerTitle(
        [refused(OnCallPassOnRefusal.RecordAcknowledged)],
        OnCallPageRecordType.Incident,
      ),
    ).toBe("Already acknowledged");
    expect(
      getPassOnAnswerTitle(
        [refused(OnCallPassOnRefusal.AlreadyPassedOn)],
        OnCallPageRecordType.Incident,
      ),
    ).toBe("Already escalated");

    for (const refusal of [
      OnCallPassOnRefusal.PageOver,
      OnCallPassOnRefusal.NotPaged,
      OnCallPassOnRefusal.InvalidLink,
    ]) {
      expect(
        getPassOnAnswerTitle([refused(refusal)], OnCallPageRecordType.Alert),
      ).toBe("Nothing to escalate");
    }
  });

  test("refused for different reasons, or no answer at all: Nothing to escalate", () => {
    expect(
      getPassOnAnswerTitle(
        [
          refused(OnCallPassOnRefusal.RecordAcknowledged),
          refused(OnCallPassOnRefusal.AlreadyPassedOn),
        ],
        OnCallPageRecordType.Incident,
      ),
    ).toBe("Nothing to escalate");
    expect(getPassOnAnswerTitle([], OnCallPageRecordType.Incident)).toBe(
      "Nothing to escalate",
    );
  });

  test("never the button's own word: a refusal is no instruction", () => {
    for (const refusal of Object.values(OnCallPassOnRefusal)) {
      for (const { recordType } of RECORDS) {
        expect(getPassOnAnswerTitle([refused(refusal)], recordType)).not.toBe(
          PASS_ON_PAGE_TEXT.button,
        );
      }
    }
  });
});

describe("the server's answers, read with care", () => {
  test("the route names the record's type and id - and keeps the action's first name", () => {
    expect(
      getPassOnPageRoute({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).toBe(`/on-call-page/pass-on/incident/${RECORD_ID.toString()}`);
    expect(
      getPassOnPageRoute({
        recordType: OnCallPageRecordType.AlertEpisode,
        recordId: RECORD_ID,
      }),
    ).toBe(
      `${ON_CALL_PAGE_PASS_ON_ROUTE}/alert-episode/${RECORD_ID.toString()}`,
    );
  });

  test("open pages: a time comes back a date, and anything malformed is left out", () => {
    const pages: Array<OnCallOpenPage> = readOpenPages({
      pages: [
        {
          executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
          preview: {
            ...result({ outcome: OnCallPassOnOutcome.OthersStillPaged }),
            nextStepAt: "2026-10-16T09:30:00.000Z",
          },
        },
        null,
        { executionLogId: "a1b2c3d4-0000-4000-8000-000000000002" },
        { executionLogId: 7, preview: result({}) },
        "page",
      ],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.executionLogId).toBe(
      "a1b2c3d4-0000-4000-8000-000000000001",
    );
    expect(pages[0]!.preview.nextStepAt).toEqual(
      new Date("2026-10-16T09:30:00.000Z"),
    );
  });

  test("open pages: no list at all is no page", () => {
    expect(readOpenPages({})).toEqual([]);
    expect(readOpenPages(undefined)).toEqual([]);
    expect(readOpenPages({ pages: "none" })).toEqual([]);
  });

  test("answers: passedOn is a yes or a no, and the result's time a date", () => {
    const answers: Array<OnCallPassOnAnswer> = readPassOnAnswers({
      answers: [
        {
          passedOn: 1,
          result: {
            ...result({ outcome: OnCallPassOnOutcome.OthersStillPaged }),
            nextStepAt: "2026-10-16T09:30:00.000Z",
          },
        },
        { refusal: OnCallPassOnRefusal.PageOver },
        null,
      ],
    });

    expect(answers).toHaveLength(2);
    expect(answers[0]!.passedOn).toBe(true);
    expect(answers[0]!.result!.nextStepAt).toEqual(
      new Date("2026-10-16T09:30:00.000Z"),
    );
    expect(answers[1]!.passedOn).toBe(false);
    expect(answers[1]!.result).toBeUndefined();
    expect(readPassOnAnswers({ answers: {} })).toEqual([]);
  });
});

describe("asking the server", () => {
  let requests: Array<{ method: string; url: string; headers: unknown }>;

  beforeEach(() => {
    requests = [];

    jest
      .spyOn(ModelAPI, "getCommonHeaders")
      .mockReturnValue({ tenantid: "project-1" });
  });

  test("the open pages are read at the record's route, with the project", async () => {
    jest.spyOn(API, "get").mockImplementation((async (args: {
      url: URL;
      headers: unknown;
    }) => {
      requests.push({
        method: "GET",
        url: args.url.toString(),
        headers: args.headers,
      });
      return new HTTPResponse<JSONObject>(
        200,
        { pages: [page({})] as unknown as JSONObject["pages"] },
        {},
      );
    }) as never);

    const pages: Array<OnCallOpenPage> = await fetchOpenPages({
      recordType: OnCallPageRecordType.IncidentEpisode,
      recordId: RECORD_ID,
    });

    expect(pages).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(
      new globalThis.URL(requests[0]!.url).pathname.endsWith(
        `/on-call-page/pass-on/incident-episode/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
    expect(requests[0]!.headers).toEqual({ tenantid: "project-1" });
  });

  test("escalating is a POST to the same route", async () => {
    jest.spyOn(API, "post").mockImplementation((async (args: {
      url: URL;
      headers: unknown;
    }) => {
      requests.push({
        method: "POST",
        url: args.url.toString(),
        headers: args.headers,
      });
      return new HTTPResponse<JSONObject>(
        200,
        {
          answers: [
            { passedOn: true, result: result({ isPreview: false }) },
          ] as unknown as JSONObject["answers"],
        },
        {},
      );
    }) as never);

    const answers: Array<OnCallPassOnAnswer> = await passOnPages({
      recordType: OnCallPageRecordType.Alert,
      recordId: RECORD_ID,
    });

    expect(answers[0]!.passedOn).toBe(true);
    expect(requests).toEqual([expect.objectContaining({ method: "POST" })]);
    expect(
      new globalThis.URL(requests[0]!.url).pathname.endsWith(
        `/on-call-page/pass-on/alert/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
  });

  test("an answer that is not a success is an error, not 'not paged'", async () => {
    jest.spyOn(API, "get").mockImplementation((async () => {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }) as never);
    jest.spyOn(API, "post").mockImplementation((async () => {
      return new HTTPErrorResponse(403, { message: "Forbidden" }, {});
    }) as never);

    await expect(
      fetchOpenPages({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    await expect(
      passOnPages({
        recordType: OnCallPageRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});

describe("in a record's header", () => {
  type ServerAnswer = JSONObject | "fail" | Promise<JSONObject | "fail">;

  let getAnswers: Array<ServerAnswer>;
  let postAnswers: Array<ServerAnswer>;
  let gets: Array<string>;
  let posts: Array<string>;

  const STATES: Array<EventStateItem> = [
    { id: "created", name: "Created", color: new Color("#64748b") },
    { id: "acknowledged", name: "Acknowledged", color: new Color("#f59e0b") },
    { id: "resolved", name: "Resolved", color: new Color("#10b981") },
  ];

  function answerFrom(next: JSONObject | "fail"): HTTPResponse<JSONObject> {
    if (next === "fail") {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }

    return new HTTPResponse<JSONObject>(200, next, {});
  }

  beforeEach(() => {
    getAnswers = [];
    postAnswers = [];
    gets = [];
    posts = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

    jest.spyOn(API, "get").mockImplementation((async (args: { url: URL }) => {
      gets.push(args.url.toString());
      return answerFrom(await (getAnswers.shift() || { pages: [] }));
    }) as never);

    jest.spyOn(API, "post").mockImplementation((async (args: { url: URL }) => {
      posts.push(args.url.toString());
      return answerFrom(await (postAnswers.shift() || { answers: [] }));
    }) as never);
  });

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  const pagedAbout: (overrides?: Partial<OnCallPassOnResult>) => JSONObject = (
    overrides?: Partial<OnCallPassOnResult>,
  ): JSONObject => {
    return {
      pages: [page(overrides || {})] as unknown as JSONObject["pages"],
    };
  };

  const passed: (overrides?: Partial<OnCallPassOnResult>) => JSONObject = (
    overrides?: Partial<OnCallPassOnResult>,
  ): JSONObject => {
    return {
      answers: [
        {
          passedOn: true,
          result: result({
            isPreview: false,
            pagedNames: ["Carl Diaz"],
            ...(overrides || {}),
          }),
        },
      ] as unknown as JSONObject["answers"],
    };
  };

  interface HeaderProps {
    recordType?: OnCallPageRecordType;
    recordId?: ObjectID;
    onPassedOn?: () => void;
    onRecordChanged?: () => void;
    onControls?: (controls: PassOnPageControls) => void;
  }

  // A record page's header as the record pages draw it: the state buttons, then Escalate.
  function Header(props: HeaderProps): ReactElement {
    const passOn: PassOnPageControls = usePassOnPage({
      recordType: props.recordType || OnCallPageRecordType.Incident,
      recordId: props.recordId || RECORD_ID,
      onPassedOn: props.onPassedOn,
      onRecordChanged: props.onRecordChanged,
    });

    props.onControls?.(passOn);

    return (
      <div>
        <EventStatusPanel
          stateList={StateListType.IncidentState}
          states={STATES}
          identifier="INC-42"
          currentStateId="created"
          actions={[
            {
              stateId: "acknowledged",
              label: "Acknowledge",
              icon: IconProp.Check,
              buttonStyle: ButtonStyleType.PRIMARY,
              id: "incident-acknowledge-btn",
            },
          ]}
          onActionClick={(): void => {}}
          onStateSelect={(): void => {}}
          secondaryActions={[...passOn.actions]}
        />
        {passOn.dialog}
      </div>
    );
  }

  const escalateButton: () => HTMLElement | null = (): HTMLElement | null => {
    return within(
      screen.getByRole("group", { name: "Event actions" }),
    ).queryByRole("button", { name: "Escalate" });
  };

  const dialogLines: () => Array<string> = (): Array<string> => {
    const lines: HTMLElement | null =
      screen.queryByTestId("pass-on-preview") ||
      screen.queryByTestId("pass-on-answer");

    return lines
      ? Array.from(lines.querySelectorAll("p")).map(
          (line: HTMLParagraphElement): string => {
            return (line.textContent || "").trim();
          },
        )
      : [];
  };

  test("somebody the policy is not paging sees no button", async () => {
    getAnswers.push({ pages: [] });

    render(<Header />);
    await flush();

    expect(escalateButton()).toBeNull();
    expect(gets).toHaveLength(1);
    expect(gets[0]).toContain(
      `/on-call-page/pass-on/incident/${RECORD_ID.toString()}`,
    );
  });

  test("when the server cannot say, the button stays away and nothing breaks", async () => {
    getAnswers.push("fail");

    render(<Header />);
    await flush();

    expect(escalateButton()).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Acknowledge" },
      ),
    ).toBeInTheDocument();
  });

  test("the person being paged sees Escalate after the state buttons, with an arrow up the levels", async () => {
    const latest: { controls?: PassOnPageControls } = {};

    getAnswers.push(pagedAbout());

    render(
      <Header
        onControls={(passOn: PassOnPageControls): void => {
          latest.controls = passOn;
        }}
      />,
    );

    // Nothing until the server has said so.
    expect(escalateButton()).toBeNull();

    await flush();

    /*
     * One button, with no tooltip: the header shows an action's tooltip only
     * while it is disabled, and the dialog says what escalating does.
     */
    expect(latest.controls!.actions).toEqual([
      {
        id: "pass-on-page",
        label: "Escalate",
        icon: IconProp.ArrowCircleUp,
        onClick: expect.any(Function),
      },
    ]);

    const button: HTMLElement = escalateButton()!;
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("id", "pass-on-page");
    expect(button.textContent).not.toContain("Pass it on");

    const acknowledge: HTMLElement = within(
      screen.getByRole("group", { name: "Event actions" }),
    ).getByRole("button", { name: "Acknowledge" });

    expect(
      acknowledge.compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the maintainer's dialog: Escalate Incident?, the next level, not paged again, Cancel and Escalate", async () => {
    getAnswers.push(pagedAbout({ rule: SECOND }));

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Escalate Incident?",
    );
    expect(dialogLines()).toEqual([
      "This will immediately page second (Level 2 of 3), without waiting.",
      "You will not be paged again for this incident.",
    ]);
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Escalate",
    );
    expect(screen.getByTestId("modal-footer-close-button")).toHaveTextContent(
      "Cancel",
    );
    expect(screen.queryByTestId("pass-on-warning")).toBeNull();

    // Nothing in the dialog says the old words.
    expect(
      (screen.getByRole("dialog").textContent || "").toLowerCase(),
    ).not.toContain("pass");
  });

  test("Cancel does nothing", async () => {
    getAnswers.push(pagedAbout());

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(screen.queryByTestId("modal-title")).toBeNull();
    expect(posts).toHaveLength(0);
    expect(escalateButton()).not.toBeNull();
  });

  test.each(RECORDS)(
    "a $recordType asks about itself, and says it is done in its own words",
    async ({ recordType, question, doneTitle, notPagedAgain }: RecordWords) => {
      getAnswers.push(pagedAbout({ rule: { order: 2, name: "Level 2" } }));
      postAnswers.push(passed({ rule: { order: 2, name: "Level 2" } }));
      getAnswers.push({ pages: [] });

      render(<Header recordType={recordType} />);
      await flush();

      fireEvent.click(escalateButton()!);

      expect(screen.getByTestId("modal-title")).toHaveTextContent(question);
      expect(dialogLines()).toEqual([
        "This will immediately page Level 2 of 3, without waiting.",
        notPagedAgain,
      ]);

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await flush();

      expect(posts[0]).toContain(
        `/on-call-page/pass-on/${recordType}/${RECORD_ID.toString()}`,
      );
      expect(screen.getByTestId("modal-title")).toHaveTextContent(doneTitle);
      expect(dialogLines()).toEqual([
        "The policy is now paging Level 2 of 3: Carl Diaz.",
        notPagedAgain,
      ]);
    },
  );

  test("escalating says what it did, tells the page, and the button goes", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push(passed());
    // Read again after escalating: no longer paged.
    getAnswers.push({ pages: [] });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(
      `/on-call-page/pass-on/incident/${RECORD_ID.toString()}`,
    );
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
    expect(dialogLines()).toEqual([
      "The policy is now paging Platform leads (Level 2 of 3): Carl Diaz.",
      "You will not be paged again for this incident.",
    ]);
    expect(onPassedOn).toHaveBeenCalledTimes(1);

    // A notice now: one plain Close, and no Cancel.
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Close",
    );
    expect(screen.queryByTestId("modal-footer-close-button")).toBeNull();

    expect(gets).toHaveLength(2);
    expect(escalateButton()).toBeNull();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(screen.queryByTestId("modal-title")).toBeNull();
  });

  test("the last level, with Repeat Policy on: it says the first level is paged again", async () => {
    getAnswers.push(
      pagedAbout({
        outcome: OnCallPassOnOutcome.PolicyStartedAgain,
        rule: { order: 1, name: "First responders" },
      }),
    );
    postAnswers.push(
      passed({
        outcome: OnCallPassOnOutcome.PolicyStartedAgain,
        rule: { order: 1, name: "First responders" },
      }),
    );
    getAnswers.push({ pages: [] });

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);

    expect(dialogLines()).toEqual([
      "There is no level after yours, so this will immediately page First responders (Level 1 of 3) again, without waiting.",
      "You will not be paged again for this incident.",
    ]);
    expect(screen.queryByTestId("pass-on-warning")).toBeNull();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(dialogLines()).toEqual([
      "There was no level after yours, so the policy started over and is paging First responders (Level 1 of 3) again.",
      "You will not be paged again for this incident.",
    ]);
  });

  test("others on the level still paged: the dialog says who, and when the policy pages the next level", async () => {
    const at: Date = new Date("2026-10-16T12:30:00.000Z");

    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-10-16T12:00:00.000Z"));

    getAnswers.push(
      pagedAbout({
        outcome: OnCallPassOnOutcome.OthersStillPaged,
        stillPagedNames: ["Bob Smith"],
        nextStepAt: at,
        nextRule: { order: 3, name: "Managers" },
      }),
    );

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);

    expect(dialogLines()).toEqual([
      `Bob Smith is still being paged. If nobody acknowledges by ${getOnCallPassOnTimeOfDay(
        { at: at },
      )}, the policy pages Managers (Level 3 of 3) next.`,
      "You will not be paged again for this incident.",
    ]);
    expect(screen.queryByTestId("pass-on-warning")).toBeNull();
  });

  test("nobody left to page: the dialog warns about it first, before and after", async () => {
    getAnswers.push(pagedAbout({ outcome: OnCallPassOnOutcome.PagingStopped }));
    postAnswers.push(
      passed({ outcome: OnCallPassOnOutcome.PagingStopped, pagedNames: [] }),
    );
    getAnswers.push({ pages: [] });

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Escalate Incident?",
    );

    const asked: HTMLElement = screen.getByTestId("pass-on-warning");
    expect(asked).toHaveAttribute("role", "alert");
    expect(asked).toHaveTextContent(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
    // The warning comes before the line about the reader.
    expect(
      asked.compareDocumentPosition(
        screen.getByText("You will not be paged again for this incident."),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(dialogLines()).toEqual([
      "You will not be paged again for this incident.",
    ]);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
    expect(screen.getByTestId("pass-on-warning")).toHaveTextContent(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
    expect(dialogLines()).toEqual([
      "You will not be paged again for this incident.",
    ]);
  });

  test("somebody acknowledged it meanwhile: it says so, and nothing was escalated", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push({
      answers: [
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          acknowledgedByName: "Ana Lopez",
        },
      ] as unknown as JSONObject["answers"],
    });

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    // Why, in a few words - not the button's "Escalate", which reads as an instruction.
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Already acknowledged",
    );
    expect(dialogLines()).toEqual([
      "Ana Lopez acknowledged it already, so there is nothing to escalate.",
    ]);
    expect(onPassedOn).not.toHaveBeenCalled();
  });

  /*
   * The header still offered Acknowledge for a record somebody else had
   * taken while the dialog asked (#4914): the page is told, and reads the
   * record again.
   */
  test("somebody acknowledged it meanwhile: the page is told the record changed, once", async () => {
    const onRecordChanged: Mock<() => void> = jest.fn<() => void>();
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push({
      answers: [
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          acknowledgedByName: "Ana Lopez",
        },
      ] as unknown as JSONObject["answers"],
    });

    render(
      <Header onPassedOn={onPassedOn} onRecordChanged={onRecordChanged} />,
    );
    await flush();

    fireEvent.click(escalateButton()!);
    expect(onRecordChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Already acknowledged",
    );
    expect(onRecordChanged).toHaveBeenCalledTimes(1);
    expect(onPassedOn).not.toHaveBeenCalled();

    // Closing the answer tells it nothing more.
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(onRecordChanged).toHaveBeenCalledTimes(1);
  });

  test("one of two pages taken meanwhile tells the page too, beside the one escalated", async () => {
    const onRecordChanged: Mock<() => void> = jest.fn<() => void>();
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push({
      answers: [
        ...(passed()["answers"] as Array<JSONObject>),
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
        },
      ] as unknown as JSONObject["answers"],
    });

    render(
      <Header onPassedOn={onPassedOn} onRecordChanged={onRecordChanged} />,
    );
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(onPassedOn).toHaveBeenCalledTimes(1);
    expect(onRecordChanged).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["escalated", "passed"],
    ["escalated already", OnCallPassOnRefusal.AlreadyPassedOn],
    ["the page is over", OnCallPassOnRefusal.PageOver],
    ["not paged", OnCallPassOnRefusal.NotPaged],
  ])(
    "%s: the record is as the page read it, so it is not told it changed",
    async (_name: string, answer: string) => {
      const onRecordChanged: Mock<() => void> = jest.fn<() => void>();

      getAnswers.push(pagedAbout());
      postAnswers.push(
        answer === "passed"
          ? passed()
          : ({
              answers: [{ passedOn: false, refusal: answer }],
            } as unknown as JSONObject),
      );

      render(<Header onRecordChanged={onRecordChanged} />);
      await flush();

      fireEvent.click(escalateButton()!);
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      await flush();

      expect(screen.getByTestId("modal-title")).toBeInTheDocument();
      expect(onRecordChanged).not.toHaveBeenCalled();
    },
  );

  test("a failed request tells the page nothing", async () => {
    const onRecordChanged: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push("fail");

    render(<Header onRecordChanged={onRecordChanged} />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(onRecordChanged).not.toHaveBeenCalled();
  });

  test("escalated already, from another tab or the phone: says so", async () => {
    getAnswers.push(pagedAbout());
    postAnswers.push({
      answers: [
        { passedOn: false, refusal: OnCallPassOnRefusal.AlreadyPassedOn },
      ] as unknown as JSONObject["answers"],
    });

    render(<Header recordType={OnCallPageRecordType.Alert} />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Already escalated",
    );
    expect(dialogLines()).toEqual([
      "You escalated it already, so you will not be paged again for it.",
    ]);
  });

  test("a failed request keeps the question open, with an error, so it can be tried again", async () => {
    const onPassedOn: Mock<() => void> = jest.fn<() => void>();

    getAnswers.push(pagedAbout());
    postAnswers.push("fail");
    postAnswers.push(passed());

    render(<Header onPassedOn={onPassedOn} />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Escalate Incident?",
    );
    expect(
      screen.getByText("Could not escalate. Please try again."),
    ).toBeInTheDocument();
    expect(onPassedOn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toHaveLength(2);
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
    expect(onPassedOn).toHaveBeenCalledTimes(1);
  });

  test("while it escalates, the dialog shows it is working and cannot be sent twice", async () => {
    let finish: (value: JSONObject) => void = (): void => {};

    getAnswers.push(pagedAbout());
    postAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finish = resolve;
      }),
    );

    render(<Header />);
    await flush();

    fireEvent.click(escalateButton()!);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    // The footer's submit is disabled, with a spinner, while the request is out.
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();
    expect(posts).toHaveLength(1);

    finish(passed());
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
  });

  test("acknowledging from the header reads the page again: no page, no button", async () => {
    const latest: { controls?: PassOnPageControls } = {};

    getAnswers.push(pagedAbout());
    getAnswers.push({ pages: [] });

    render(
      <Header
        onControls={(passOn: PassOnPageControls): void => {
          latest.controls = passOn;
        }}
      />,
    );
    await flush();
    expect(escalateButton()).not.toBeNull();

    // What onActionComplete does on the record pages.
    act(() => {
      latest.controls!.refresh();
    });
    await flush();

    expect(gets).toHaveLength(2);
    expect(escalateButton()).toBeNull();
  });

  test("moving to another record never shows the last record's button", async () => {
    let finishOther: (value: JSONObject) => void = (): void => {};

    getAnswers.push(pagedAbout());
    getAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finishOther = resolve;
      }),
    );

    const view: { rerender: (ui: ReactElement) => void } = render(<Header />);
    await flush();
    expect(escalateButton()).not.toBeNull();

    view.rerender(<Header recordId={OTHER_RECORD_ID} />);
    await flush();

    // Before the other record's answer: no button, not the first record's.
    expect(escalateButton()).toBeNull();
    expect(gets[1]).toContain(OTHER_RECORD_ID.toString());

    finishOther({ pages: [] });
    await flush();
    expect(escalateButton()).toBeNull();
  });

  test("a late answer about the record left behind is ignored", async () => {
    let finishFirst: (value: JSONObject) => void = (): void => {};

    getAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finishFirst = resolve;
      }),
    );
    getAnswers.push({ pages: [] });

    const view: { rerender: (ui: ReactElement) => void } = render(<Header />);
    view.rerender(<Header recordId={OTHER_RECORD_ID} />);
    await flush();

    // The first record's answer arrives last, saying the reader was paged.
    finishFirst(pagedAbout());
    await flush();

    expect(escalateButton()).toBeNull();
  });

  test("each kind of record asks at its own route", async () => {
    for (const recordType of [
      OnCallPageRecordType.Incident,
      OnCallPageRecordType.Alert,
      OnCallPageRecordType.IncidentEpisode,
      OnCallPageRecordType.AlertEpisode,
    ]) {
      getAnswers.push({ pages: [] });
      render(<Header recordType={recordType} />);
      await flush();
      cleanup();
    }

    expect(
      gets.map((url: string): string => {
        return new globalThis.URL(url).pathname.split("/pass-on/")[1]!;
      }),
    ).toEqual([
      `incident/${RECORD_ID.toString()}`,
      `alert/${RECORD_ID.toString()}`,
      `incident-episode/${RECORD_ID.toString()}`,
      `alert-episode/${RECORD_ID.toString()}`,
    ]);
  });
});

describe("the words are the Dashboard's translation keys, and every place's", () => {
  test("the button, the titles and the error", () => {
    expect(PASS_ON_PAGE_TEXT).toEqual({
      button: "Escalate",
      alreadyAcknowledgedTitle: "Already acknowledged",
      alreadyPassedOnTitle: "Already escalated",
      nothingToPassOnTitle: "Nothing to escalate",
      failed: "Could not escalate. Please try again.",
      passedOnStatus: "Escalated",
    });
  });

  test("what each record is called", () => {
    for (const { recordType, question, doneTitle, notPagedAgain } of RECORDS) {
      expect(PASS_ON_RECORD_TEXT[recordType]).toEqual({
        question,
        doneTitle,
        notPagedAgain,
      });
      expect(getPassOnRecordText(recordType)).toEqual({
        question,
        doneTitle,
        notPagedAgain,
      });
    }

    // Anything that is not a record kind reads as an incident.
    expect(
      getPassOnRecordText("unknown" as unknown as OnCallPageRecordType),
    ).toEqual(PASS_ON_RECORD_TEXT[OnCallPageRecordType.Incident]);
  });

  test("the same words the server's pages, the emails and the calls use", () => {
    expect(PASS_ON_PAGE_TEXT.button).toBe(ESCALATE);
    expect(PASS_ON_PAGE_TEXT.alreadyAcknowledgedTitle).toBe(
      ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
    );
    expect(PASS_ON_PAGE_TEXT.alreadyPassedOnTitle).toBe(
      ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
    );
    expect(PASS_ON_PAGE_TEXT.nothingToPassOnTitle).toBe(
      ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
    );
    expect(PASS_ON_PAGE_TEXT.passedOnStatus).toBe(
      ON_CALL_PAGE_ESCALATED_STATUS_LABEL,
    );

    // An incident and an alert are named as the server names them.
    for (const recordType of [
      OnCallPageRecordType.Incident,
      OnCallPageRecordType.Alert,
    ]) {
      expect(getPassOnRecordText(recordType).notPagedAgain).toBe(
        getOnCallPageNotPagedAgainSentence(getOnCallPageRecordNoun(recordType)),
      );
    }
  });

  test("never the old words", () => {
    const words: Array<string> = [
      ...Object.values(PASS_ON_PAGE_TEXT),
      ...Object.values(PASS_ON_RECORD_TEXT).flatMap(
        (text: {
          question: string;
          doneTitle: string;
          notPagedAgain: string;
        }) => {
          return [text.question, text.doneTitle, text.notPagedAgain];
        },
      ),
    ];

    for (const word of words) {
      expect(word.toLowerCase()).not.toContain("pass");
    }
  });
});
