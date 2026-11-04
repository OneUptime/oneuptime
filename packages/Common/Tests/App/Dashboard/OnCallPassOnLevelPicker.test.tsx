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

import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  PASS_ON_PAGE_TEXT,
  PassOnLevelPicks,
  describePassOnPreview,
  describePassOnRefusal,
  describePassOnSkippedLevels,
  getPassOnAnswerTitle,
  getPassOnEscalateTo,
  getPassOnLevelChoiceLabel,
  getPassOnLevelChoices,
  getPassOnLevelPickerLabel,
  getPassOnPickedLevel,
  getPassOnQuestionKeptTogether,
  getPassOnQuestionLines,
  passOnPages,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/PassOnPage";
import usePassOnPage, {
  PASS_ON_LEVELS_LABEL_CLASS_NAME,
  PassOnPageControls,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/PassOn/usePassOnPage";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE,
  ON_CALL_PAGE_NOT_ESCALATED_TITLE,
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnLevelChoice,
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
 * ESCALATING TO A LEVEL THE PERSON PICKS, IN A RECORD'S ESCALATE DIALOG.
 *
 * Somebody who cannot take a page escalates it from the record's header,
 * and the policy pages its next level at once. With two or more levels
 * after theirs, the dialog asks which to page first:
 *
 *   Escalate Incident?
 *   Escalate to
 *     (o) Platform leads (Level 2 of 4)
 *     ( ) DBA leads (Level 3 of 4)
 *     ( ) Level 4 of 4
 *   This will immediately page DBA leads (Level 3 of 4), without waiting.
 *     It skips Platform leads (Level 2 of 4).
 *   You will not be paged again for this incident.
 *
 * The next level is picked, so pressing Escalate does what it always did,
 * and sends nothing about levels. The header is the real EventStatusPanel
 * and the dialog the real ConfirmModal and Radio; only the server is
 * replaced, at API.get / API.post.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "4c1d7e2a-5b3f-4e6a-9c8d-0a1b2c3d4e5f",
);

const RUN_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";
const OTHER_RUN_ID: string = "a1b2c3d4-0000-4000-8000-000000000002";

const ENGLISH: Translator = createTranslator(undefined, "en");

const LEVEL_2: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fd00000-0000-4000-8000-000000000002",
  order: 2,
  name: "Platform leads",
};
const LEVEL_3: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fd00000-0000-4000-8000-000000000003",
  order: 3,
  name: "DBA leads",
};
const LEVEL_4: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fd00000-0000-4000-8000-000000000004",
  order: 4,
};

function result(overrides: Partial<OnCallPassOnResult>): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Payments",
    rule: { order: 2, name: "Platform leads" },
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 4,
    levelChoices: [LEVEL_2, LEVEL_3, LEVEL_4],
    ...overrides,
  };
}

function page(
  overrides: Partial<OnCallPassOnResult> = {},
  executionLogId: string = RUN_ID,
): OnCallOpenPage {
  return { executionLogId: executionLogId, preview: result(overrides) };
}

// "Level 3 of 4" as a radio draws it: its spaces never break.
function kept(phrase: string): string {
  return phrase.split(" ").join(ON_CALL_PASS_ON_NO_BREAK_SPACE);
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the levels a page asks the person to pick from", () => {
  test("every level after theirs, when there are two or more", () => {
    expect(getPassOnLevelChoices(page())).toEqual([LEVEL_2, LEVEL_3, LEVEL_4]);
  });

  test("none with one level after theirs: escalating pages it, and asks nothing", () => {
    expect(getPassOnLevelChoices(page({ levelChoices: [LEVEL_2] }))).toEqual(
      [],
    );
    expect(getPassOnLevelChoices(page({ levelChoices: undefined }))).toEqual(
      [],
    );
  });

  test("the next level is picked until the person picks another", () => {
    expect(getPassOnPickedLevel(page(), {})).toBe(LEVEL_2);
    expect(
      getPassOnPickedLevel(page(), { [RUN_ID]: LEVEL_3.escalationRuleId }),
    ).toBe(LEVEL_3);
    // A pick the page does not offer (the levels changed): the next level.
    expect(
      getPassOnPickedLevel(page(), {
        [RUN_ID]: "0fd00000-0000-4000-8000-0000000000ff",
      }),
    ).toBe(LEVEL_2);
    // Another run's pick is not this page's.
    expect(
      getPassOnPickedLevel(page(), {
        [OTHER_RUN_ID]: LEVEL_3.escalationRuleId,
      }),
    ).toBe(LEVEL_2);
  });
});

describe("what the request says of the levels picked", () => {
  test("nothing while the next level is picked: the request Escalate always sent", () => {
    expect(getPassOnEscalateTo([page()], {})).toEqual({});
    expect(
      getPassOnEscalateTo([page()], { [RUN_ID]: LEVEL_2.escalationRuleId }),
    ).toEqual({});
  });

  test("a later level, by the page's run", () => {
    expect(
      getPassOnEscalateTo([page()], { [RUN_ID]: LEVEL_4.escalationRuleId }),
    ).toEqual({ [RUN_ID]: LEVEL_4.escalationRuleId });
  });

  test("never a level a page does not offer, and never for a page with no choice", () => {
    expect(
      getPassOnEscalateTo(
        [page({ levelChoices: [LEVEL_2] }), page({}, OTHER_RUN_ID)],
        {
          [RUN_ID]: LEVEL_3.escalationRuleId,
          [OTHER_RUN_ID]: "0fd00000-0000-4000-8000-0000000000ff",
        },
      ),
    ).toEqual({});
  });

  test("each page its own", () => {
    expect(
      getPassOnEscalateTo([page(), page({}, OTHER_RUN_ID)], {
        [RUN_ID]: LEVEL_3.escalationRuleId,
        [OTHER_RUN_ID]: LEVEL_4.escalationRuleId,
      }),
    ).toEqual({
      [RUN_ID]: LEVEL_3.escalationRuleId,
      [OTHER_RUN_ID]: LEVEL_4.escalationRuleId,
    });
  });
});

describe("the words where a level is picked", () => {
  test("a level is its name, then its place - the place never broken", () => {
    expect(getPassOnLevelChoiceLabel(LEVEL_3, 4, ENGLISH)).toBe(
      `DBA leads (${kept("Level 3 of 4")})`,
    );
    expect(getPassOnLevelChoiceLabel(LEVEL_4, 4, ENGLISH)).toBe(
      kept("Level 4 of 4"),
    );
    // A name keeps its own spaces: it breaks where it needs to.
    expect(
      getPassOnLevelChoiceLabel(
        { order: 2, name: "Database on-call leads" },
        4,
        ENGLISH,
      ),
    ).toBe(`Database on-call leads (${kept("Level 2 of 4")})`);
  });

  test("a level named after its place is its place alone", () => {
    expect(
      getPassOnLevelChoiceLabel({ order: 3, name: "Level 3" }, 4, ENGLISH),
    ).toBe(kept("Level 3 of 4"));
  });

  test("the radio group is 'Escalate to', or names the policy beside another", () => {
    expect(getPassOnLevelPickerLabel(page(), [page()], ENGLISH)).toBe(
      "Escalate to",
    );
    expect(
      getPassOnLevelPickerLabel(
        page(),
        [page(), page({ policyName: "Database" }, OTHER_RUN_ID)],
        ENGLISH,
      ),
    ).toBe("Payments: escalate to");
    expect(PASS_ON_PAGE_TEXT.escalateTo).toBe("Escalate to");
  });

  test("what a later level skips: one level, two, or none", () => {
    expect(describePassOnSkippedLevels([LEVEL_2], 4, ENGLISH)).toBe(
      "It skips Platform leads (Level 2 of 4).",
    );
    expect(describePassOnSkippedLevels([LEVEL_2, LEVEL_3], 4, ENGLISH)).toBe(
      "It skips Platform leads (Level 2 of 4) and DBA leads (Level 3 of 4).",
    );
    expect(describePassOnSkippedLevels([], 4, ENGLISH)).toBe("");
  });

  test("beside a second policy, a sentence names its policy - unless it is drawn under that policy's own levels", () => {
    const withLevels: OnCallOpenPage = page();
    const withoutLevels: OnCallOpenPage = page(
      {
        policyName: "Database",
        levelChoices: [LEVEL_3],
        rule: { order: 3, name: "DBA leads" },
      },
      OTHER_RUN_ID,
    );

    expect(describePassOnPreview([withLevels, withoutLevels], ENGLISH)).toEqual(
      [
        "This will immediately page Platform leads (Level 2 of 4), without waiting.",
        "Database: This will immediately page DBA leads (Level 3 of 4), without waiting.",
      ],
    );

    // Each line says which page it is about, for its levels to go above it.
    expect(
      getPassOnQuestionLines(
        [withLevels, withoutLevels],
        ENGLISH,
        OnCallPageRecordType.Incident,
      ).map((line: { executionLogId?: string | undefined }) => {
        return line.executionLogId;
      }),
    ).toEqual([RUN_ID, OTHER_RUN_ID, undefined]);
  });

  test("the sentence follows the pick, and says what it skips", () => {
    expect(describePassOnPreview([page()], ENGLISH)).toEqual([
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
    ]);
    expect(
      describePassOnPreview([page()], ENGLISH, {
        [RUN_ID]: LEVEL_3.escalationRuleId,
      }),
    ).toEqual([
      "This will immediately page DBA leads (Level 3 of 4), without waiting. It skips Platform leads (Level 2 of 4).",
    ]);
    expect(
      describePassOnPreview([page()], ENGLISH, {
        [RUN_ID]: LEVEL_4.escalationRuleId,
      }),
    ).toEqual([
      "This will immediately page Level 4 of 4, without waiting. It skips Platform leads (Level 2 of 4) and DBA leads (Level 3 of 4).",
    ]);
  });

  test("the dialog's lines, in the maintainer's order, with the pick", () => {
    expect(
      getPassOnQuestionLines([page()], ENGLISH, OnCallPageRecordType.Incident, {
        [RUN_ID]: LEVEL_3.escalationRuleId,
      }),
    ).toEqual([
      {
        text: "This will immediately page DBA leads (Level 3 of 4), without waiting. It skips Platform leads (Level 2 of 4).",
        isWarning: false,
        // The page it is about: its levels go right above it.
        executionLogId: RUN_ID,
      },
      {
        text: "You will not be paged again for this incident.",
        isWarning: false,
      },
    ]);
  });

  test("each place it names stays on one line: the level picked's and the ones it skips", () => {
    const keptTogether: Array<string> = getPassOnQuestionKeptTogether(
      [page()],
      { [RUN_ID]: LEVEL_4.escalationRuleId },
      ENGLISH,
    );

    expect(keptTogether).toEqual(
      expect.arrayContaining([
        "Level 4 of 4",
        "(Level 2 of 4)",
        "(Level 3 of 4)",
      ]),
    );
  });

  test("a level not offered any more: nothing was escalated, and what to do", () => {
    expect(
      describePassOnRefusal(
        { passedOn: false, refusal: OnCallPassOnRefusal.LevelNotAvailable },
        ENGLISH,
      ),
    ).toBe(ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE);
  });

  test("its title says it was not escalated; beside a page that was, the page that was", () => {
    const notAvailable: OnCallPassOnAnswer = {
      passedOn: false,
      refusal: OnCallPassOnRefusal.LevelNotAvailable,
    };

    expect(
      getPassOnAnswerTitle([notAvailable], OnCallPageRecordType.Incident),
    ).toBe(ON_CALL_PAGE_NOT_ESCALATED_TITLE);
    expect(PASS_ON_PAGE_TEXT.notEscalatedTitle).toBe("Not escalated");
    expect(
      getPassOnAnswerTitle(
        [
          { passedOn: true, result: result({ isPreview: false }) },
          notAvailable,
        ],
        OnCallPageRecordType.Incident,
      ),
    ).toBe("Incident escalated");
  });
});

describe("asking the server", () => {
  let bodies: Array<unknown>;

  beforeEach(() => {
    bodies = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(API, "post").mockImplementation((async (args: {
      data: unknown;
    }) => {
      bodies.push(args.data);
      return new HTTPResponse<JSONObject>(200, { answers: [] }, {});
    }) as never);
  });

  test("a later level picked goes in the body, by run", async () => {
    await passOnPages({
      recordType: OnCallPageRecordType.Incident,
      recordId: RECORD_ID,
      escalateTo: { [RUN_ID]: LEVEL_3.escalationRuleId },
    });

    expect(bodies).toEqual([
      { escalateTo: { [RUN_ID]: LEVEL_3.escalationRuleId } },
    ]);
  });

  test("none picked is the empty body Escalate always sent", async () => {
    await passOnPages({
      recordType: OnCallPageRecordType.Incident,
      recordId: RECORD_ID,
      escalateTo: {},
    });
    await passOnPages({
      recordType: OnCallPageRecordType.Incident,
      recordId: RECORD_ID,
    });

    expect(bodies).toEqual([{}, {}]);
  });
});

describe("in a record's header", () => {
  type ServerAnswer = JSONObject | "fail";

  let getAnswers: Array<ServerAnswer>;
  let postAnswers: Array<ServerAnswer>;
  let gets: number;
  let posts: Array<unknown>;

  const STATES: Array<EventStateItem> = [
    { id: "created", name: "Created", color: new Color("#64748b") },
    { id: "acknowledged", name: "Acknowledged", color: new Color("#f59e0b") },
    { id: "resolved", name: "Resolved", color: new Color("#10b981") },
  ];

  function answerFrom(next: ServerAnswer): HTTPResponse<JSONObject> {
    if (next === "fail") {
      return new HTTPErrorResponse(500, { message: "Server error" }, {});
    }

    return new HTTPResponse<JSONObject>(200, next, {});
  }

  beforeEach(() => {
    getAnswers = [];
    postAnswers = [];
    gets = 0;
    posts = [];

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

    jest.spyOn(API, "get").mockImplementation((async () => {
      gets++;
      return answerFrom(getAnswers.shift() || { pages: [] });
    }) as never);

    jest.spyOn(API, "post").mockImplementation((async (args: {
      data: unknown;
    }) => {
      posts.push(args.data);
      return answerFrom(postAnswers.shift() || { answers: [] });
    }) as never);
  });

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  const pagedAbout: (pages: Array<OnCallOpenPage>) => JSONObject = (
    pages: Array<OnCallOpenPage>,
  ): JSONObject => {
    return { pages: pages as unknown as JSONObject["pages"] };
  };

  const passedTo: (level: OnCallPassOnLevelChoice) => JSONObject = (
    level: OnCallPassOnLevelChoice,
  ): JSONObject => {
    return {
      answers: [
        {
          passedOn: true,
          result: result({
            isPreview: false,
            levelChoices: undefined,
            rule: { order: level.order, name: level.name },
            pagedNames: ["Carl Diaz"],
          }),
        },
      ] as unknown as JSONObject["answers"],
    };
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
          secondaryActions={[...passOn.actions]}
        />
        {passOn.dialog}
      </div>
    );
  }

  const openDialog: () => Promise<void> = async (): Promise<void> => {
    render(<Header />);
    await flush();

    fireEvent.click(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Escalate" },
      ),
    );
  };

  // The dialog's sentences, as paragraphs.
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

  test("asks which level, the next one picked, in a group named Escalate to", async () => {
    getAnswers.push(pagedAbout([page()]));

    await openDialog();

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Escalate to",
    });
    const radios: Array<HTMLElement> = within(group).getAllByRole("radio");

    expect(radios).toHaveLength(3);
    expect(
      radios.map((radio: HTMLElement): boolean => {
        return (radio as HTMLInputElement).checked;
      }),
    ).toEqual([true, false, false]);
    expect(
      within(group).getByLabelText("Platform leads (Level 2 of 4)"),
    ).toBeChecked();
    expect(
      within(group).getByLabelText("DBA leads (Level 3 of 4)"),
    ).not.toBeChecked();
    expect(within(group).getByLabelText("Level 4 of 4")).not.toBeChecked();

    // A level's place never breaks on a phone: its spaces are no-break ones.
    const label: HTMLLabelElement = (
      within(group).getByLabelText(
        "DBA leads (Level 3 of 4)",
      ) as HTMLInputElement
    ).labels![0]!;

    expect(label.textContent).toBe(`DBA leads (${kept("Level 3 of 4")})`);

    expect(dialogLines()).toEqual([
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
      "You will not be paged again for this incident.",
    ]);
  });

  test("the levels come before what escalating does, so the sentence reads as the pick's", async () => {
    getAnswers.push(pagedAbout([page()]));

    await openDialog();

    const levels: HTMLElement = screen.getByTestId("pass-on-levels");
    const sentence: HTMLElement = screen.getByText(
      /This will immediately page/,
    );

    expect(
      levels.compareDocumentPosition(sentence) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("picking a later level changes the sentence, and says what it skips", async () => {
    getAnswers.push(pagedAbout([page()]));

    await openDialog();

    fireEvent.click(screen.getByLabelText("DBA leads (Level 3 of 4)"));

    expect(dialogLines()).toEqual([
      "This will immediately page DBA leads (Level 3 of 4), without waiting. It skips Platform leads (Level 2 of 4).",
      "You will not be paged again for this incident.",
    ]);
    expect(screen.getByLabelText("DBA leads (Level 3 of 4)")).toBeChecked();
  });

  test("escalating to it sends the level picked, and says what came of it", async () => {
    getAnswers.push(pagedAbout([page()]));
    postAnswers.push(passedTo(LEVEL_3));
    getAnswers.push({ pages: [] });

    await openDialog();

    fireEvent.click(screen.getByLabelText("DBA leads (Level 3 of 4)"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toEqual([
      { escalateTo: { [RUN_ID]: LEVEL_3.escalationRuleId } },
    ]);
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Incident escalated",
    );
    expect(dialogLines()).toEqual([
      "The policy is now paging DBA leads (Level 3 of 4): Carl Diaz.",
      "You will not be paged again for this incident.",
    ]);
    // The answer asks nothing.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  test("leaving the next level picked sends what Escalate always sent", async () => {
    getAnswers.push(pagedAbout([page()]));
    postAnswers.push(passedTo(LEVEL_2));

    await openDialog();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toEqual([{}]);
  });

  test("picking a later level and back again sends nothing either", async () => {
    getAnswers.push(pagedAbout([page()]));
    postAnswers.push(passedTo(LEVEL_2));

    await openDialog();

    fireEvent.click(screen.getByLabelText("Level 4 of 4"));
    fireEvent.click(screen.getByLabelText("Platform leads (Level 2 of 4)"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(posts).toEqual([{}]);
  });

  test("with one level after theirs, there is nothing to pick", async () => {
    getAnswers.push(pagedAbout([page({ levelChoices: [LEVEL_2] })]));

    await openDialog();

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByTestId("pass-on-levels")).toBeNull();
    expect(dialogLines()).toEqual([
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
      "You will not be paged again for this incident.",
    ]);
  });

  test("asked again, the next level is picked again", async () => {
    getAnswers.push(pagedAbout([page()]));

    await openDialog();

    fireEvent.click(screen.getByLabelText("Level 4 of 4"));
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    fireEvent.click(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Escalate" },
      ),
    );

    expect(
      screen.getByLabelText("Platform leads (Level 2 of 4)"),
    ).toBeChecked();
    expect(posts).toEqual([]);
  });

  test("a level not offered any more: Not escalated, why, and the page is read again", async () => {
    getAnswers.push(pagedAbout([page()]));
    postAnswers.push({
      answers: [
        { passedOn: false, refusal: OnCallPassOnRefusal.LevelNotAvailable },
      ] as unknown as JSONObject["answers"],
    });
    getAnswers.push(pagedAbout([page({ levelChoices: [LEVEL_2, LEVEL_4] })]));

    await openDialog();

    fireEvent.click(screen.getByLabelText("DBA leads (Level 3 of 4)"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await flush();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Not escalated",
    );
    expect(dialogLines()).toEqual([ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE]);
    // The person is still paged: Escalate stays, with the levels as they are.
    expect(gets).toBe(2);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Event actions" })).getByRole(
        "button",
        { name: "Escalate" },
      ),
    );

    const radios: Array<HTMLElement> = within(
      screen.getByRole("radiogroup", { name: "Escalate to" }),
    ).getAllByRole("radio");

    expect(radios).toHaveLength(2);
  });

  test("two policies paging them: a group for each that has levels, naming its policy", async () => {
    getAnswers.push(
      pagedAbout([
        page(),
        page(
          {
            policyName: "Database",
            levelChoices: [LEVEL_3, LEVEL_4],
            rule: { order: 3, name: "DBA leads" },
          },
          OTHER_RUN_ID,
        ),
      ]),
    );

    await openDialog();

    expect(
      screen.getByRole("radiogroup", { name: "Payments: escalate to" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Database: escalate to" }),
    ).toBeInTheDocument();
  });

  test("a page that would stop paging still warns first, above the levels", async () => {
    getAnswers.push(
      pagedAbout([
        page(),
        page(
          {
            policyName: "Database",
            outcome: OnCallPassOnOutcome.PagingStopped,
            levelChoices: undefined,
          },
          OTHER_RUN_ID,
        ),
      ]),
    );

    await openDialog();

    const warning: HTMLElement = screen.getByTestId("pass-on-warning");
    const levels: HTMLElement = screen.getByTestId("pass-on-levels");

    expect(
      warning.compareDocumentPosition(levels) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /*
   * Two policies paging the person, each with levels to pick from: each
   * policy's levels sit right over that policy's sentence - pick, then what
   * it does - rather than all the levels over all the sentences, where the
   * second sentence had to be matched to the second group by its policy's
   * name. Under its own levels a sentence names no policy: the levels'
   * label already does.
   */
  test("two policies paging them: each policy's levels right above its own sentence", async () => {
    getAnswers.push(
      pagedAbout([
        page(),
        page(
          {
            policyName: "Database",
            levelChoices: [LEVEL_3, LEVEL_4],
            rule: { order: 3, name: "DBA leads" },
          },
          OTHER_RUN_ID,
        ),
      ]),
    );

    await openDialog();

    const picks: Array<HTMLElement> =
      screen.getAllByTestId("pass-on-level-pick");

    expect(picks).toHaveLength(2);
    expect(
      within(picks[0]!).getByRole("radiogroup", {
        name: "Payments: escalate to",
      }),
    ).toBeInTheDocument();
    expect(
      within(picks[1]!).getByRole("radiogroup", {
        name: "Database: escalate to",
      }),
    ).toBeInTheDocument();

    // Each block: its levels, then its sentence - and nothing else.
    for (const pick of picks) {
      expect(pick.children).toHaveLength(2);
      expect(pick.children[0]).toHaveAttribute("data-testid", "pass-on-levels");
      expect(pick.children[1]!.tagName).toBe("P");
    }

    expect((picks[0]!.children[1]!.textContent || "").trim()).toBe(
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
    );
    expect((picks[1]!.children[1]!.textContent || "").trim()).toBe(
      "This will immediately page DBA leads (Level 3 of 4), without waiting.",
    );

    // The second policy's levels stand a little apart from the first's.
    expect(picks[0]!.className.split(" ")).not.toContain("pt-2");
    expect(picks[1]!.className.split(" ")).toContain("pt-2");

    expect(dialogLines()).toEqual([
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
      "This will immediately page DBA leads (Level 3 of 4), without waiting.",
      "You will not be paged again for this incident.",
    ]);

    // A pick changes its own policy's sentence, under it.
    fireEvent.click(
      within(picks[1]!).getByLabelText("Level 4 of 4") as HTMLInputElement,
    );

    const picked: Array<HTMLElement> =
      screen.getAllByTestId("pass-on-level-pick");

    expect((picked[1]!.children[1]!.textContent || "").trim()).toBe(
      "This will immediately page Level 4 of 4, without waiting. It skips DBA leads (Level 3 of 4).",
    );
    expect((picked[0]!.children[1]!.textContent || "").trim()).toBe(
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
    );
  });

  test("beside a policy with levels to pick, one without names its policy in its sentence", async () => {
    getAnswers.push(
      pagedAbout([
        page(),
        page(
          {
            policyName: "Database",
            levelChoices: [LEVEL_3],
            rule: { order: 3, name: "DBA leads" },
          },
          OTHER_RUN_ID,
        ),
      ]),
    );

    await openDialog();

    expect(screen.getAllByTestId("pass-on-level-pick")).toHaveLength(1);
    expect(dialogLines()).toEqual([
      "This will immediately page Platform leads (Level 2 of 4), without waiting.",
      "Database: This will immediately page DBA leads (Level 3 of 4), without waiting.",
      "You will not be paged again for this incident.",
    ]);
  });

  /*
   * "Escalate to" is the question the radios answer: drawn as a form's
   * field label is (FieldLabel: medium, grey-700), not in the radios' own
   * grey-900, where it read as one more of them.
   */
  test("the levels' label is drawn as a form's field label", async () => {
    getAnswers.push(pagedAbout([page()]));

    await openDialog();

    expect(PASS_ON_LEVELS_LABEL_CLASS_NAME).toBe(
      "text-sm font-medium text-gray-700",
    );
    expect(screen.getByTestId("pass-on-levels-label").className).toBe(
      PASS_ON_LEVELS_LABEL_CLASS_NAME,
    );
  });

  test("the picks of the dialog are a page's own: PassOnLevelPicks by run", () => {
    const picks: PassOnLevelPicks = { [RUN_ID]: LEVEL_3.escalationRuleId };

    expect(getPassOnEscalateTo([page({}, OTHER_RUN_ID)], picks)).toEqual({});
  });
});

describe("a URL is never the way a level is picked", () => {
  test("the route is the record's, with the level in the body", async () => {
    let posted: string = "";

    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
    jest.spyOn(API, "post").mockImplementation((async (args: { url: URL }) => {
      posted = args.url.toString();
      return new HTTPResponse<JSONObject>(200, { answers: [] }, {});
    }) as never);

    await passOnPages({
      recordType: OnCallPageRecordType.Incident,
      recordId: RECORD_ID,
      escalateTo: { [RUN_ID]: LEVEL_3.escalationRuleId },
    });

    const address: globalThis.URL = new globalThis.URL(posted);

    expect(
      address.pathname.endsWith(
        `/on-call-page/pass-on/incident/${RECORD_ID.toString()}`,
      ),
    ).toBe(true);
    expect(address.search).toBe("");
  });
});
