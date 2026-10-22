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

import fs from "fs";
import path from "path";
import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PassOnLinePiece,
  describePassOnResult,
  formatPassOnTime,
  getPassOnKeptTogether,
  getPassOnLinePieces,
  getPassedOnResults,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
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
 * "(LEVEL 2 OF 3)" STAYS ON ONE LINE (UI review of escalate-incident-copy).
 *
 * On a phone, the maintainer's own example broke inside the level's place:
 *
 *   This will immediately page Platform leads (Level 2 of
 *   3), without waiting.
 *
 * and the time the policy moves on broke as "by 6:40" / "PM GMT". The
 * dialog now draws each level's place - "(Level 2 of 3)" after its name,
 * "Level 2 of 3" on its own - and the time on one line, in every language,
 * while the level's name (text somebody typed) still breaks where it needs
 * to and the line's text is unchanged. Its paragraphs are text-pretty: a
 * last word is never left alone on a line ("... without" / "waiting.").
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// Every language the Dashboard ships, besides English.
const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function translatorFor(language: string): Translator {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

const RECORD_ID: ObjectID = new ObjectID(
  "4c1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);

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

// The pieces of a line that stay on one line.
function keptPieces(text: string, kept: Array<string>): Array<string> {
  return getPassOnLinePieces(text, kept)
    .filter((piece: PassOnLinePiece): boolean => {
      return piece.keepTogether;
    })
    .map((piece: PassOnLinePiece): string => {
      return piece.text;
    });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the dialog keeps on one line", () => {
  test("a named level: its place in brackets, never its name", () => {
    const kept: Array<string> = getPassOnKeptTogether([result({})], ENGLISH);

    expect(kept).toEqual(["(Level 2 of 3)"]);
    expect(keptPieces(describePassOnResult(result({}), ENGLISH), kept)).toEqual(
      ["(Level 2 of 3)"],
    );
  });

  test("a level with no name of its own - or only its default one - is its place alone", () => {
    for (const name of [undefined, "", "Level 2"]) {
      const each: OnCallPassOnResult = result({
        rule: { order: 2, name: name },
      });
      const kept: Array<string> = getPassOnKeptTogether([each], ENGLISH);

      expect(kept).toEqual(["Level 2 of 3"]);
      expect(keptPieces(describePassOnResult(each, ENGLISH), kept)).toEqual([
        "Level 2 of 3",
      ]);
    }
  });

  test("a long name still breaks: only what follows it is kept together", () => {
    const each: OnCallPassOnResult = result({
      rule: { order: 2, name: "Platform engineering leads and managers" },
    });
    const pieces: Array<PassOnLinePiece> = getPassOnLinePieces(
      describePassOnResult(each, ENGLISH),
      getPassOnKeptTogether([each], ENGLISH),
    );

    expect(pieces).toEqual([
      {
        text: "This will immediately page Platform engineering leads and managers ",
        keepTogether: false,
      },
      { text: "(Level 2 of 3)", keepTogether: true },
      { text: ", without waiting.", keepTogether: false },
    ]);
  });

  test("somebody else still paged: the next level's place, and the time the policy moves on", () => {
    const at: Date = new Date(Date.now() + 20 * 60 * 1000);
    const each: OnCallPassOnResult = result({
      outcome: OnCallPassOnOutcome.OthersStillPaged,
      rule: { order: 1, name: "Level 1" },
      stillPagedNames: ["Bob Smith"],
      nextStepAt: at,
      nextRule: { order: 2, name: "Platform leads" },
    });
    const kept: Array<string> = getPassOnKeptTogether([each], ENGLISH);

    expect(kept).toEqual([
      "Level 1 of 3",
      "(Level 2 of 3)",
      formatPassOnTime(at),
    ]);
    expect(keptPieces(describePassOnResult(each, ENGLISH), kept)).toEqual([
      formatPassOnTime(at),
      "(Level 2 of 3)",
    ]);
  });

  test("a level it cannot place keeps nothing together, and the sentence is whole", () => {
    for (const rule of [undefined, { order: 0, name: "X" }]) {
      const each: OnCallPassOnResult = result({ rule: rule });
      const text: string = describePassOnResult(each, ENGLISH);

      expect(getPassOnKeptTogether([each], ENGLISH)).toEqual([]);
      expect(getPassOnLinePieces(text, [])).toEqual([
        { text: text, keepTogether: false },
      ]);
    }
  });

  test("two pages, each with its level: both, once each", () => {
    expect(
      getPassOnKeptTogether(
        [
          result({}),
          result({ policyName: "Database", rule: { order: 3 } }),
          result({ policyName: "Payments" }),
        ],
        ENGLISH,
      ),
    ).toEqual(["(Level 2 of 3)", "Level 3 of 3"]);
  });

  test("the answer's places come only from the pages that were escalated", () => {
    const answers: Array<OnCallPassOnAnswer> = [
      {
        passedOn: true,
        result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
      },
      { passedOn: false, refusal: OnCallPassOnRefusal.PageOver },
      {
        passedOn: false,
        refusal: OnCallPassOnRefusal.RecordAcknowledged,
        result: result({ rule: { order: 3 } }),
      },
    ];

    expect(getPassedOnResults(answers)).toEqual([answers[0]!.result]);
    expect(getPassOnKeptTogether(getPassedOnResults(answers), ENGLISH)).toEqual(
      ["(Level 2 of 3)"],
    );
  });
});

describe("a line in pieces", () => {
  test("joined, the pieces are the line - whatever is kept together", () => {
    const text: string =
      "Bob Smith is still being paged. If nobody acknowledges by 6:40 PM GMT, the policy pages Platform leads (Level 2 of 3) next.";

    for (const kept of [
      [],
      ["(Level 2 of 3)"],
      ["6:40 PM GMT", "(Level 2 of 3)"],
      ["not in it"],
      [""],
    ]) {
      expect(
        getPassOnLinePieces(text, kept)
          .map((piece: PassOnLinePiece): string => {
            return piece.text;
          })
          .join(""),
      ).toBe(text);
    }
  });

  test("a phrase at the start, in the middle and at the end", () => {
    expect(getPassOnLinePieces("Level 2 of 3, now", ["Level 2 of 3"])).toEqual([
      { text: "Level 2 of 3", keepTogether: true },
      { text: ", now", keepTogether: false },
    ]);
    expect(getPassOnLinePieces("page Level 2 of 3", ["Level 2 of 3"])).toEqual([
      { text: "page ", keepTogether: false },
      { text: "Level 2 of 3", keepTogether: true },
    ]);
  });

  test("every time a phrase comes, and the longer of two at the same place", () => {
    expect(
      getPassOnLinePieces("A: Level 2 of 3. B: Level 2 of 3.", [
        "Level 2",
        "Level 2 of 3",
      ]),
    ).toEqual([
      { text: "A: ", keepTogether: false },
      { text: "Level 2 of 3", keepTogether: true },
      { text: ". B: ", keepTogether: false },
      { text: "Level 2 of 3", keepTogether: true },
      { text: ".", keepTogether: false },
    ]);
  });
});

describe("in every language the Dashboard ships", () => {
  test("German, French and Japanese keep their own words for the place together", () => {
    const german: Translator = translatorFor("de");
    const french: Translator = translatorFor("fr");
    const japanese: Translator = translatorFor("ja");

    expect(
      keptPieces(
        describePassOnResult(result({}), german),
        getPassOnKeptTogether([result({})], german),
      ),
    ).toEqual(["(Stufe 2 von 3)"]);

    // French gives a level alone its article, and keeps it with the place.
    expect(
      keptPieces(
        describePassOnResult(result({ rule: { order: 2 } }), french),
        getPassOnKeptTogether([result({ rule: { order: 2 } })], french),
      ),
    ).toEqual(["le niveau 2 sur 3"]);
    expect(
      keptPieces(
        describePassOnResult(result({}), french),
        getPassOnKeptTogether([result({})], french),
      ),
    ).toEqual(["(niveau 2 sur 3)"]);

    expect(
      keptPieces(
        describePassOnResult(result({}), japanese),
        getPassOnKeptTogether([result({})], japanese),
      ),
    ).toEqual(["（レベル 2/3）"]);
  });

  test.each(LANGUAGES)(
    "%s: the level's place is kept together in what escalating will do, and did",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const at: Date = new Date(Date.now() + 20 * 60 * 1000);

      for (const each of [
        result({}),
        result({ rule: { order: 2 } }),
        result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "First responders" },
        }),
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          rule: undefined,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: at,
          nextRule: { order: 3, name: "Managers" },
        }),
      ]) {
        const text: string = describePassOnResult(each, translator);
        const kept: Array<string> = getPassOnKeptTogether([each], translator);
        const places: Array<string> = kept.filter((phrase: string): boolean => {
          return phrase !== formatPassOnTime(at);
        });

        // The level's place, in this language's words, is found and kept.
        expect({
          language,
          text,
          place: keptPieces(text, places).length,
        }).toEqual({ language, text, place: 1 });

        // ...and never a level's name, which may be long.
        for (const piece of keptPieces(text, kept)) {
          expect(piece).not.toContain("Platform leads");
          expect(piece).not.toContain("First responders");
          expect(piece).not.toContain("Managers");
        }
      }
    },
  );

  test("a sentence with no translation yet is English, and its English place is kept together", () => {
    // A language that has the level's words but not this sentence's.
    const partly: Translator = createTranslator(
      (key: string): string | undefined => {
        return key === "{{name}} (Level {{order}} of {{count}})"
          ? "{{name}} (Stufe {{order}} von {{count}})"
          : undefined;
      },
      "de",
    );
    const text: string = describePassOnResult(result({}), partly);

    expect(text).toBe(
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
    );
    expect(
      keptPieces(text, getPassOnKeptTogether([result({})], partly)),
    ).toEqual(["(Level 2 of 3)"]);
  });
});

describe("the dialog draws them", () => {
  const STATES: Array<EventStateItem> = [
    { id: "created", name: "Created", color: new Color("#64748b") },
    { id: "acknowledged", name: "Acknowledged", color: new Color("#f59e0b") },
  ];

  let getAnswers: Array<JSONObject>;
  let postAnswers: Array<JSONObject>;

  beforeEach(() => {
    getAnswers = [];
    postAnswers = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(API, "get").mockImplementation((async (_args: { url: URL }) => {
      return new HTTPResponse<JSONObject>(
        200,
        getAnswers.shift() || { pages: [] },
        {},
      );
    }) as never);
    jest.spyOn(API, "post").mockImplementation((async (_args: { url: URL }) => {
      return new HTTPResponse<JSONObject>(
        200,
        postAnswers.shift() || { answers: [] },
        {},
      );
    }) as never);
  });

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  function Header(): ReactElement {
    const passOn: PassOnPageControls = usePassOnPage({
      recordType: OnCallPageRecordType.Incident,
      recordId: RECORD_ID,
    });

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
          secondaryActions={passOn.actions}
        />
        {passOn.dialog}
      </div>
    );
  }

  const openDialog: (preview: OnCallPassOnResult) => Promise<void> = async (
    preview: OnCallPassOnResult,
  ): Promise<void> => {
    getAnswers.push({
      pages: [
        {
          executionLogId: "a1b2c3d4-0000-4000-8000-000000000001",
          preview: preview,
        },
      ] as unknown as JSONObject["pages"],
    });

    render(<Header />);
    await flush();

    fireEvent.click(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Escalate" },
      ),
    );
  };

  const keptSpans: (testId: string) => Array<HTMLElement> = (
    testId: string,
  ): Array<HTMLElement> => {
    return within(screen.getByTestId(testId)).queryAllByTestId(
      "pass-on-kept-together",
    );
  };

  test("the question: the maintainer's sentence, its place on one line, every paragraph text-pretty", async () => {
    await openDialog(result({}));

    const spans: Array<HTMLElement> = keptSpans("pass-on-preview");

    expect(
      spans.map((span: HTMLElement): string => {
        return span.textContent || "";
      }),
    ).toEqual(["(Level 2 of 3)"]);
    expect(spans[0]).toHaveClass("whitespace-nowrap");

    const paragraphs: Array<HTMLParagraphElement> = Array.from(
      screen.getByTestId("pass-on-preview").querySelectorAll("p"),
    );

    // The text a reader (and a screen reader) gets is the sentence, whole.
    expect(
      paragraphs.map((paragraph: HTMLParagraphElement): string => {
        return paragraph.textContent || "";
      }),
    ).toEqual([
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
      "You will not be paged again for this incident.",
    ]);

    for (const paragraph of paragraphs) {
      expect(paragraph).toHaveClass("text-pretty");
    }
  });

  test("the time the policy moves on is kept on one line too", async () => {
    const at: Date = new Date(Date.now() + 20 * 60 * 1000);

    await openDialog(
      result({
        outcome: OnCallPassOnOutcome.OthersStillPaged,
        stillPagedNames: ["Bob Smith"],
        nextStepAt: at,
        nextRule: { order: 3, name: "Managers" },
      }),
    );

    expect(
      keptSpans("pass-on-preview").map((span: HTMLElement): string => {
        return span.textContent || "";
      }),
    ).toEqual([formatPassOnTime(at), "(Level 3 of 3)"]);
  });

  test("the answer: what the policy pages now, its place on one line", async () => {
    postAnswers.push({
      answers: [
        {
          passedOn: true,
          result: result({ isPreview: false, pagedNames: ["Carl Diaz"] }),
        },
      ] as unknown as JSONObject["answers"],
    });

    await openDialog(result({}));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
    expect(
      keptSpans("pass-on-answer").map((span: HTMLElement): string => {
        return span.textContent || "";
      }),
    ).toEqual(["(Level 2 of 3)"]);
  });

  test("nothing escalated: nothing to keep together, and the sentence is drawn as it is", async () => {
    postAnswers.push({
      answers: [
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          acknowledgedByName: "Ana Lopez",
        },
      ] as unknown as JSONObject["answers"],
    });

    await openDialog(result({}));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(keptSpans("pass-on-answer")).toEqual([]);
    expect(screen.getByTestId("pass-on-answer")).toHaveTextContent(
      "Ana Lopez acknowledged it already, so there is nothing to escalate.",
    );
  });
});
