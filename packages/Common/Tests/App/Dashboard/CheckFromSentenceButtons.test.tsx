import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WRITE A CHECK FROM A SENTENCE: ITS BUTTONS START WHERE ITS WORDS START
 * (#6555's review).
 *
 * The card's sentence box, the suggestion's words and its buttons share one
 * start edge once the card no longer pads its body twice - but Button keeps
 * a dialog footer's left margin (md:ml-3), so on a desktop Write the Check
 * started 12px in from the box above it, and Add Check 12px in from the
 * suggestion's words. Each row of buttons clears that margin on its
 * buttons, as a card header's actions do; the row's gap spaces them.
 *
 * The API is mocked; jsdom applies no styles, so the rows' classes are read,
 * and the browser's drawing was measured in the review (0px margins, each
 * button's start edge on its box's).
 */

const suggestCheckMock: MockFunction = getJestMockFunction();
const syncCheckAlertMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        suggestCheck: (...args: Array<any>) => {
          return suggestCheckMock(...args);
        },
        syncCheckAlert: (...args: Array<any>) => {
          return syncCheckAlertMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

/*
 * The component comes last: requiring it runs the factories above.
 */
import CheckFromSentence, {
  CHECK_FROM_SENTENCE_ALERT_TEST_ID,
  CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME,
  CHECK_FROM_SENTENCE_ERROR_TEST_ID,
  CheckFromSentenceWhatFailed,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CheckFromSentence";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  CHECK_NOT_WRITTEN_REFUSAL,
  CustomSqlRefusal,
  DataCheckFromSentenceRefusal,
  MongoPipelineRefusal,
  RULE_NOT_A_CHECK_REFUSAL,
} from "../../../Types/DataObservability/DataCheckRefusals";
import APIException from "../../../Types/Exception/ApiException";
import { getRefusalText } from "../../../Types/Exception/RefusalWithValues";
import {
  getExplanationWords,
  getUnexplainedServerErrorMessage,
  readUnexplainedError,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import { BILLING_ENABLED } from "../../../UI/Config";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import { CARD_HEADER_ACTION_CLASS_NAME } from "../../../UI/Components/Card/Card";
import ObjectID from "../../../Types/ObjectID";
import {
  DATA_CHECK_ALERT_CONDITIONS,
  DataCheckAlertCondition,
} from "../../../Types/DataObservability/DataCheckType";
import { DataObservabilityCheckSuggestion } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const TABLE: string = "8b000000-0000-4000-8000-000000000002";
const SENTENCE: string = "Orders never have a negative total";

const SUGGESTION: DataObservabilityCheckSuggestion = {
  name: "Orders never have a negative total",
  customSql:
    "SELECT COUNT(*) FROM payments.ledger_entries WHERE amount_cents < 0",
  alertCondition: DataCheckAlertCondition.Above,
  alertThreshold: 0,
  explanation:
    "Counts the ledger entries whose amount is below zero; any such row breaks the rule.",
};

// The classes that clear Button's left margin on a row's buttons.
function marginClearing(className: string): Array<string> {
  return className.split(" ").filter((name: string): boolean => {
    return name.includes("button]:");
  });
}

function renderCard(onCheckAdded: () => void = () => {}): void {
  render(
    <CheckFromSentence
      dataAssetId={new ObjectID(TABLE)}
      onCheckAdded={onCheckAdded}
    />,
  );
}

function sentenceBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: "The rule, in a sentence",
  }) as HTMLTextAreaElement;
}

// A button's row: the element the row's classes reach it from, itself or the one it sits in.
function rowOf(button: HTMLElement): HTMLElement {
  const parent: HTMLElement = button.parentElement as HTMLElement;

  return parent.className === CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME
    ? parent
    : (parent.parentElement as HTMLElement);
}

async function writeTheCheck(): Promise<void> {
  fireEvent.change(sentenceBox(), { target: { value: SENTENCE } });
  fireEvent.click(screen.getByRole("button", { name: "Write the Check" }));
  await screen.findByRole("button", { name: "Add Check" });
}

// The languages the page is read in below, from the locale files themselves.
const LANGUAGES: Array<string> = ["de", "ja", "ko", "hi", "ar", "fa"];

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  // English unless a test reads the page in another language: with no English file, each word is its own.
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  suggestCheckMock.mockReset();
  syncCheckAlertMock.mockReset();
  createMock.mockReset();
  suggestCheckMock.mockResolvedValue(SUGGESTION);
  syncCheckAlertMock.mockResolvedValue(undefined);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("a row of the card's buttons", () => {
  test("is a wrapping row spaced by its gap that clears Button's dialog-footer margin, on a button or on one inside the element it sits in", () => {
    expect(CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "flex-wrap",
      "gap-2",
      "[&>button]:ml-0",
      "[&>button]:md:ml-0",
      "[&>*>button]:ml-0",
      "[&>*>button]:md:ml-0",
    ]);
  });

  test("clears the margin exactly as a card header's actions do", () => {
    expect(marginClearing(CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME)).toEqual(
      marginClearing(CARD_HEADER_ACTION_CLASS_NAME),
    );
    expect(marginClearing(CARD_HEADER_ACTION_CLASS_NAME)).toHaveLength(4);
  });
});

describe("Write the Check", () => {
  test("starts where the sentence's box starts: its row follows the box in one column and clears the margin its button keeps", () => {
    renderCard();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Write the Check",
    });
    const row: HTMLElement = rowOf(button);

    expect(row.className).toBe(CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME);
    // Button's own margin, for a dialog's footer: what the row clears.
    expect(button).toHaveClass("md:ml-3");
    // The row and the box: one column, one start edge.
    expect(sentenceBox().nextElementSibling).toBe(row);
    expect(row.parentElement).toBe(sentenceBox().parentElement);
    expect(row.parentElement).toHaveClass("space-y-3");
  });

  test("is still in that row while it waits for a sentence, disabled", () => {
    renderCard();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Write the Check",
    });

    expect(button).toBeDisabled();
    expect(rowOf(button).className).toBe(
      CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME,
    );
  });

  test("asks for the check of this table, in the sentence's words", async () => {
    renderCard();

    await writeTheCheck();

    expect(suggestCheckMock).toHaveBeenCalledTimes(1);
    expect((suggestCheckMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
      TABLE,
    );
    expect(suggestCheckMock.mock.calls[0]![1]).toBe(SENTENCE);
    // An English page asks for English words.
    expect(suggestCheckMock.mock.calls[0]![2]).toBe("en");
  });
});

describe("the suggestion's Add Check and Discard", () => {
  test("start where the suggestion's words start: one row in the suggestion's box, after its words, clearing the margin Add Check keeps", async () => {
    renderCard();

    await writeTheCheck();

    const add: HTMLElement = screen.getByRole("button", { name: "Add Check" });
    const discard: HTMLElement = screen.getByRole("button", {
      name: "Discard",
    });
    const row: HTMLElement = rowOf(add);

    expect(row.className).toBe(CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME);
    expect(rowOf(discard)).toBe(row);
    expect(add).toHaveClass("md:ml-3");

    // The box the suggestion's words are in: its name first, the buttons last.
    const box: HTMLElement = row.parentElement as HTMLElement;

    expect(box).toHaveClass("rounded-md", "border", "p-4");
    expect(box.firstElementChild).toHaveTextContent(SUGGESTION.name);
    expect(box.lastElementChild).toBe(row);
    expect(box).toHaveTextContent("Alerts when its value is above 0.");
  });

  test("Discard puts the suggestion away, and Write the Check stays in its row", async () => {
    renderCard();

    await writeTheCheck();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(
      screen.queryByRole("button", { name: "Add Check" }),
    ).not.toBeInTheDocument();
    expect(
      rowOf(screen.getByRole("button", { name: "Write the Check" })).className,
    ).toBe(CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME);
  });

  test("Add Check makes the suggestion a check of this table, with its alert, and empties the card", async () => {
    const createdId: ObjectID = new ObjectID(
      "8c000000-0000-4000-8000-000000000001",
    );
    const onCheckAdded: MockFunction = getJestMockFunction();
    createMock.mockResolvedValue({ data: { id: createdId } });

    renderCard(onCheckAdded);
    await writeTheCheck();
    fireEvent.click(screen.getByRole("button", { name: "Add Check" }));

    await waitFor(() => {
      expect(onCheckAdded).toHaveBeenCalledTimes(1);
    });

    const check: DataCheck = (
      createMock.mock.calls[0]![0] as { model: DataCheck }
    ).model;

    expect(check.dataAssetId?.toString()).toBe(TABLE);
    expect(check.name).toBe(SUGGESTION.name);
    expect(check.customSql).toBe(SUGGESTION.customSql);
    expect(check.alertCondition).toBe(DataCheckAlertCondition.Above);
    expect(check.alertThreshold).toBe(0);
    expect(syncCheckAlertMock).toHaveBeenCalledWith(createdId);
    expect(sentenceBox().value).toBe("");
    expect(
      screen.queryByRole("button", { name: "Add Check" }),
    ).not.toBeInTheDocument();
  });
});

/*
 * WHEN THE CHECK ALERTS, IN THE READER'S LANGUAGE (#6976).
 *
 * The suggestion's last line said "Alerts when its value is
 * {{condition}} {{threshold}}." filled with the condition's English
 * value, lowercased: "Alarmiert, wenn ihr Wert above 0 ist.",
 * "値が above 0 のときにアラートします。". It is now one whole sentence
 * per condition (DataCheckAlertConditionWords), with the number where
 * each language puts it, read here as the card draws it in each
 * language, from the locale files themselves.
 */

// What a condition's English left in a line looks like.
const ENGLISH_CONDITION_WORDS: RegExp = /\b(?:above|below|unusually)\b/i;

const SENTENCE_OF: Record<DataCheckAlertCondition, string> = {
  [DataCheckAlertCondition.Above]:
    "Alerts when its value is above {{threshold}}.",
  [DataCheckAlertCondition.Below]:
    "Alerts when its value is below {{threshold}}.",
  [DataCheckAlertCondition.UnusuallyHigh]:
    "Alerts when its value is unusually high.",
  [DataCheckAlertCondition.UnusuallyLow]:
    "Alerts when its value is unusually low.",
};

// The Intl locale a language writes its numbers in: Latin digits in Arabic.
function numberLocale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : language;
}

// The card in `language`, a suggestion of `condition` and `threshold` written.
async function suggestionIn(
  language: string,
  condition: DataCheckAlertCondition,
  threshold: number,
): Promise<string> {
  suggestCheckMock.mockResolvedValue({
    ...SUGGESTION,
    alertCondition: condition,
    alertThreshold: threshold,
  });

  await inLanguage(language);
  renderCard();

  const words: Record<string, string> =
    language === "en" ? {} : readDashboardLocale(language);
  const said: (text: string) => string = (text: string): string => {
    return words[text] || text;
  };

  fireEvent.change(
    screen.getByRole("textbox", { name: said("The rule, in a sentence") }),
    { target: { value: SENTENCE } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: said("Write the Check") }),
  );
  await screen.findByRole("button", { name: said("Add Check") });

  return withoutIsolateMarks(
    screen.getByTestId(CHECK_FROM_SENTENCE_ALERT_TEST_ID).textContent || "",
  );
}

describe("when the check alerts, in English", () => {
  test.each([
    [DataCheckAlertCondition.Above, 0, "Alerts when its value is above 0."],
    [DataCheckAlertCondition.Below, 5, "Alerts when its value is below 5."],
    [
      DataCheckAlertCondition.Above,
      1500,
      "Alerts when its value is above 1,500.",
    ],
    [
      DataCheckAlertCondition.UnusuallyHigh,
      0,
      "Alerts when its value is unusually high.",
    ],
    [
      DataCheckAlertCondition.UnusuallyLow,
      0,
      "Alerts when its value is unusually low.",
    ],
  ])(
    "%s %d reads %j",
    async (
      condition: DataCheckAlertCondition,
      threshold: number,
      expected: string,
    ) => {
      expect(await suggestionIn("en", condition, threshold)).toBe(expected);
    },
  );

  test("the line is the suggestion's, after its query and before its buttons", async () => {
    await suggestionIn("en", DataCheckAlertCondition.Above, 0);

    const line: HTMLElement = screen.getByTestId(
      CHECK_FROM_SENTENCE_ALERT_TEST_ID,
    );

    expect(line.tagName).toBe("P");
    expect(line).toHaveClass("text-sm", "text-gray-600");
    expect(line.nextElementSibling?.className).toBe(
      CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME,
    );
  });

  test("a condition that is none a check can have draws no line, rather than its English", async () => {
    suggestCheckMock.mockResolvedValue({
      ...SUGGESTION,
      alertCondition: "Sideways" as DataCheckAlertCondition,
    });

    renderCard();
    await writeTheCheck();

    expect(
      screen.queryByTestId(CHECK_FROM_SENTENCE_ALERT_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Check" })).toBeEnabled();
  });
});

describe("when the check alerts, in the issue's languages: the number where each puts it", () => {
  test.each([
    [
      "de",
      DataCheckAlertCondition.Above,
      0,
      "Alarmiert, wenn ihr Wert über 0 liegt.",
    ],
    [
      "de",
      DataCheckAlertCondition.Below,
      5,
      "Alarmiert, wenn ihr Wert unter 5 liegt.",
    ],
    [
      "ja",
      DataCheckAlertCondition.Above,
      0,
      "値が 0 を上回るときにアラートします。",
    ],
    [
      "ja",
      DataCheckAlertCondition.Below,
      5,
      "値が 5 を下回るときにアラートします。",
    ],
    [
      "ko",
      DataCheckAlertCondition.Above,
      0,
      "값이 0 초과일 때 알림을 보냅니다.",
    ],
    [
      "ko",
      DataCheckAlertCondition.Below,
      5,
      "값이 5 미만일 때 알림을 보냅니다.",
    ],
    [
      "hi",
      DataCheckAlertCondition.Above,
      0,
      "अलर्ट करता है जब इसका मान 0 से ऊपर हो।",
    ],
    [
      "hi",
      DataCheckAlertCondition.Below,
      5,
      "अलर्ट करता है जब इसका मान 5 से नीचे हो।",
    ],
  ])(
    "%s, %s %d",
    async (
      language: string,
      condition: DataCheckAlertCondition,
      threshold: number,
      expected: string,
    ) => {
      expect(await suggestionIn(language, condition, threshold)).toBe(expected);
    },
  );
});

describe.each(LANGUAGES)("when the check alerts, in %s", (language: string) => {
  const locale: Record<string, string> = readDashboardLocale(language);

  test.each([...DATA_CHECK_ALERT_CONDITIONS])(
    "%s reads the language's own sentence, with no English condition word",
    async (condition: DataCheckAlertCondition) => {
      const line: string = await suggestionIn(language, condition, 3);
      const own: string = locale[SENTENCE_OF[condition]]!;

      expect(own).toBeDefined();
      expect(own).not.toBe(SENTENCE_OF[condition]);
      expect(line).toBe(
        own.replace(
          "{{threshold}}",
          (3).toLocaleString(numberLocale(language)),
        ),
      );
      expect(line).not.toMatch(ENGLISH_CONDITION_WORDS);
    },
  );
});

describe("when the check alerts, from the right", () => {
  test("Persian writes the number in its own digits", async () => {
    expect(
      await suggestionIn("fa", DataCheckAlertCondition.Above, 25),
    ).toContain("۲۵");
  });

  test("Arabic writes Latin digits", async () => {
    expect(await suggestionIn("ar", DataCheckAlertCondition.Below, 25)).toBe(
      "ينبّه عندما تكون قيمته أدنى من 25.",
    );
  });
});

/*
 * THE SUGGESTION'S NAME AND EXPLANATION READ THE WAY THEY ARE WRITTEN.
 *
 * OneUptime AI names the check and says what it counts in whatever
 * language it answers in - English for an English rule. On an Arabic or
 * Persian page such a line was drawn the page's way: the explanation's
 * full stop at its start, its lines lined up at their end. Each is now a
 * line of its own (IsolatedLine): an English one reads left to right, as
 * wide as its words at the page's start; a line in the page's language,
 * and every line on an English page, is drawn as before.
 */
describe("the suggestion's name and explanation", () => {
  // The suggestion's box: its name first, then its explanation.
  function nameAndExplanation(): [HTMLElement, HTMLElement] {
    const box: HTMLElement = screen.getByTestId(
      CHECK_FROM_SENTENCE_ALERT_TEST_ID,
    ).parentElement as HTMLElement;

    return [box.children[0] as HTMLElement, box.children[1] as HTMLElement];
  }

  test("on an English page: paragraphs with no direction of their own", async () => {
    await suggestionIn("en", DataCheckAlertCondition.Above, 0);

    const [name, explanation] = nameAndExplanation();

    expect(name.tagName).toBe("P");
    expect(name).toHaveTextContent(SUGGESTION.name);
    expect(name).not.toHaveAttribute("dir");
    expect(name).toHaveClass("text-sm", "font-medium", "text-gray-900");
    expect(explanation.tagName).toBe("P");
    expect(explanation).toHaveTextContent(SUGGESTION.explanation);
    expect(explanation).not.toHaveAttribute("dir");
    expect(explanation).not.toHaveClass("w-fit");
  });

  test.each(["ar", "fa"])(
    "on a %s page: English lines read left to right, as wide as their words",
    async (language: string) => {
      await suggestionIn(language, DataCheckAlertCondition.Above, 0);

      const [name, explanation] = nameAndExplanation();

      for (const line of [name, explanation]) {
        expect(line.tagName).toBe("P");
        expect(line).toHaveAttribute("dir", "ltr");
        expect(line).toHaveClass("break-words", "w-fit", "max-w-full");
        // Never text-end beside wrapping lines: each lines up at its own start.
        expect(line).not.toHaveClass("text-end");
      }

      expect(explanation).toHaveTextContent(SUGGESTION.explanation);
      // The alert line is the page's own words: the page's direction.
      expect(
        screen.getByTestId(CHECK_FROM_SENTENCE_ALERT_TEST_ID),
      ).not.toHaveAttribute("dir");
    },
  );

  test("on a Persian page, a Persian name keeps the page's direction", async () => {
    suggestCheckMock.mockResolvedValue({
      ...SUGGESTION,
      name: "سفارش‌هایی با مجموع منفی",
      explanation: "سفارش‌هایی را می‌شمارد که مجموعشان زیر صفر است.",
    });

    await inLanguage("fa");
    renderCard();

    const words: Record<string, string> = readDashboardLocale("fa");

    fireEvent.change(
      screen.getByRole("textbox", { name: words["The rule, in a sentence"]! }),
      { target: { value: SENTENCE } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: words["Write the Check"]! }),
    );
    await screen.findByRole("button", { name: words["Add Check"]! });

    const [name, explanation] = nameAndExplanation();

    expect(name).not.toHaveAttribute("dir");
    expect(explanation).not.toHaveAttribute("dir");
    expect(name).not.toHaveClass("w-fit");
  });
});

/*
 * THE CHECK'S WORDS, ASKED FOR IN THE READER'S LANGUAGE (#7220).
 *
 * OneUptime AI wrote the check's name and explanation in English on every
 * page. Write the Check now sends the language the page is read in with
 * the rule, so the server asks for the name and explanation in it; the
 * server keeps only a language the Dashboard is read in
 * (DataCheckSuggestLanguage).
 */
describe("Write the Check, in the reader's language", () => {
  test.each(["de", "ja", "ar", "fa"])(
    "on a %s page, asks for the check's name and explanation in that language",
    async (language: string) => {
      await suggestionIn(language, DataCheckAlertCondition.Above, 0);

      expect(suggestCheckMock).toHaveBeenCalledTimes(1);
      expect((suggestCheckMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
        TABLE,
      );
      expect(suggestCheckMock.mock.calls[0]![1]).toBe(SENTENCE);
      expect(suggestCheckMock.mock.calls[0]![2]).toBe(language);
    },
  );
});

/*
 * WHY THE CHECK COULD NOT BE WRITTEN OR ADDED, IN THE READER'S LANGUAGE
 * (#7220's review, #7530).
 *
 * The card shows why under its buttons. The server's own refusals are keys
 * of the locales now (Common/Types/DataObservability/DataCheckRefusals):
 * on a German, Arabic or Persian page they read in that language, and the
 * two with a value in them keep the value where the language puts it. A
 * message the language has no words for stays a line of its own read the
 * way its words are (IsolatedLine), so an English message on an Arabic or
 * Persian page keeps its full stop at its end. A failure nobody explained
 * - a gateway's 502, a server failure with its reference, OneUptime not
 * reached, an empty answer, a proxy's HTML page - is ErrorExplanation:
 * what did not happen, why, what to do next, and the reference with its
 * copy button. It was the English sentence as plain text.
 */
describe("the card's error", () => {
  const MODEL_REASON: string =
    "the table has no column for when an order was refunded";
  const WRITE_FAILED: string = getRefusalText(CHECK_NOT_WRITTEN_REFUSAL, {
    reason: MODEL_REASON,
  });
  const ADD_FAILED: string = "You do not have permission to create a check.";

  // Writes the rule on a page in `language`.
  async function writeIn(language: string): Promise<void> {
    await inLanguage(language);
    renderCard();

    const said: (text: string) => string = wordsOf(language);

    fireEvent.change(
      screen.getByRole("textbox", { name: said("The rule, in a sentence") }),
      { target: { value: SENTENCE } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: said("Write the Check") }),
    );
  }

  // The card's error line once a write in `language` failed with `rejection`.
  async function writeFailsWith(
    language: string,
    rejection: unknown,
  ): Promise<HTMLElement> {
    suggestCheckMock.mockRejectedValue(rejection);

    await writeIn(language);

    return await screen.findByTestId(CHECK_FROM_SENTENCE_ERROR_TEST_ID);
  }

  // The words of `language`'s locale: English for a key it has no words for.
  function wordsOf(language: string): (text: string) => string {
    const words: Record<string, string> =
      language === "en" ? {} : readDashboardLocale(language);

    return (text: string): string => {
      return words[text] || text;
    };
  }

  // The sentence `template` in `language`, with its {{reason}} filled in.
  function refusalIn(
    language: string,
    template: string,
    reason: string,
  ): string {
    return wordsOf(language)(template).replace("{{reason}}", reason);
  }

  describe("the server's own words", () => {
    test("on an English page: exactly as before, in a paragraph with no direction of its own", async () => {
      const error: HTMLElement = await writeFailsWith(
        "en",
        new Error(WRITE_FAILED),
      );

      expect(error.tagName).toBe("P");
      expect(error).toHaveTextContent(WRITE_FAILED);
      expect(withoutIsolateMarks(error.textContent || "")).toBe(WRITE_FAILED);
      expect(error).not.toHaveAttribute("dir");
      expect(error).toHaveClass("text-sm", "text-red-600");
      expect(error).not.toHaveClass("w-fit");
      expect(
        within(error).queryByTestId("error-explanation"),
      ).not.toBeInTheDocument();
    });

    test("the refusal the server sends is the English it always sent", () => {
      expect(WRITE_FAILED).toBe(
        "OneUptime AI could not write a check OneUptime can run for that rule (the table has no column for when an order was refunded) Say it another way, or write the check yourself.",
      );
    });

    test.each(["de", "ar", "fa", "ja", "hi", "ko"])(
      "on a %s page: the refusal reads in the page's language, the reason where it puts it",
      async (language: string) => {
        const error: HTMLElement = await writeFailsWith(
          language,
          new Error(WRITE_FAILED),
        );
        const expected: string = refusalIn(
          language,
          CHECK_NOT_WRITTEN_REFUSAL.template,
          MODEL_REASON,
        );

        expect(expected).not.toBe(WRITE_FAILED);
        expect(withoutIsolateMarks(error.textContent || "")).toBe(expected);
        // The page's own words: a line that reads the page's way.
        expect(error).not.toHaveAttribute("dir");
        expect(error).not.toHaveClass("w-fit");
      },
    );

    test("a why of OneUptime's own inside the refusal reads in the page's language too", async () => {
      const message: string = getRefusalText(CHECK_NOT_WRITTEN_REFUSAL, {
        reason: DataCheckFromSentenceRefusal.queryNamesNoValue,
      });
      const error: HTMLElement = await writeFailsWith(
        "de",
        new HTTPErrorResponse(400, { message: message }, {}),
      );
      const said: (text: string) => string = wordsOf("de");

      expect(withoutIsolateMarks(error.textContent || "")).toBe(
        refusalIn(
          "de",
          CHECK_NOT_WRITTEN_REFUSAL.template,
          said(DataCheckFromSentenceRefusal.queryNamesNoValue),
        ),
      );
      expect(error.textContent).not.toContain("Say the rule another way");
    });

    test("the model's why, written in the page's language, keeps its words inside the page's sentence", async () => {
      const reason: string =
        "Die Tabelle hat keine Spalte für den Zeitpunkt einer Erstattung.";
      const error: HTMLElement = await writeFailsWith(
        "de",
        new HTTPErrorResponse(
          400,
          {
            message: getRefusalText(RULE_NOT_A_CHECK_REFUSAL, { reason }),
          },
          {},
        ),
      );

      expect(withoutIsolateMarks(error.textContent || "")).toBe(
        refusalIn("de", RULE_NOT_A_CHECK_REFUSAL.template, reason),
      );
      expect(error.textContent).not.toContain("could not be made a check");
    });

    test.each([
      ...Object.values(DataCheckFromSentenceRefusal),
      ...Object.values(CustomSqlRefusal),
      ...Object.values(MongoPipelineRefusal),
    ])("%j reads in German and in Persian", async (refusal: string) => {
      for (const language of ["de", "fa"]) {
        const error: HTMLElement = await writeFailsWith(
          language,
          new HTTPErrorResponse(400, { message: refusal }, {}),
        );
        const said: string = wordsOf(language)(refusal);

        expect(said).not.toBe(refusal);
        expect(withoutIsolateMarks(error.textContent || "")).toBe(said);
        cleanup();
      }
    });

    test("on a Persian page, a message the language has no words for reads left to right, its full stop at its end, and the suggestion stays", async () => {
      createMock.mockRejectedValue(new Error(ADD_FAILED));

      await writeIn("fa");

      const words: Record<string, string> = readDashboardLocale("fa");

      expect(words[ADD_FAILED]).toBeUndefined();

      fireEvent.click(
        await screen.findByRole("button", { name: words["Add Check"]! }),
      );

      const error: HTMLElement = await screen.findByTestId(
        CHECK_FROM_SENTENCE_ERROR_TEST_ID,
      );

      expect(error.tagName).toBe("P");
      expect(error).toHaveAttribute("dir", "ltr");
      expect(error).toHaveClass("break-words", "w-fit", "max-w-full");
      // Never text-end beside wrapping lines: each lines up at its own start.
      expect(error).not.toHaveClass("text-end");
      expect(withoutIsolateMarks(error.textContent || "")).toBe(ADD_FAILED);
      expect(
        screen.getByRole("button", { name: words["Add Check"]! }),
      ).toBeInTheDocument();
    });

    test.each([
      ["Persian", "این قاعده را نمی‌توان به یک بررسی تبدیل کرد."],
      ["Japanese", "接続が拒否されました"],
      ["Arabic", "تعذر الاتصال بقاعدة البيانات."],
    ])(
      "a message written in %s comes through as it was written (#7536)",
      async (_script: string, message: string) => {
        const error: HTMLElement = await writeFailsWith(
          "fa",
          new HTTPErrorResponse(400, { message: message }, {}),
        );

        expect(withoutIsolateMarks(error.textContent || "")).toBe(message);
        expect(
          within(error).queryByTestId("error-explanation"),
        ).not.toBeInTheDocument();
      },
    );
  });

  describe("a failure nobody explained", () => {
    // The words ErrorExplanation says for `message`, in `language`.
    function explanationIn(language: string, message: string): string {
      const said: (text: string) => string = wordsOf(language);
      const words: { why: string; next: string } = getExplanationWords({
        error: readUnexplainedError(message)!,
        isCloud: BILLING_ENABLED,
        isMasterAdmin: false,
        isVisitor: false,
      });

      return joinSentences([said(words.why), said(words.next)]);
    }

    const NGINX_500: string =
      "<html>\r\n<head><title>500 Internal Server Error</title></head>\r\n<body>\r\n<center><h1>500 Internal Server Error</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

    test.each([
      [
        "a gateway's 502",
        new HTTPErrorResponse(502, "<html>Bad Gateway</html>" as never, {}),
        SERVER_DOWN_MESSAGE,
      ],
      [
        "a load balancer's 503 page",
        new HTTPErrorResponse(
          503,
          "<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>" as never,
          {},
        ),
        SERVER_DOWN_MESSAGE,
      ],
      [
        "a server failure that named a reference",
        new HTTPErrorResponse(
          500,
          {
            error: getUnexplainedServerErrorMessage("1f0c9a2b"),
            reference: "1f0c9a2b",
          },
          {},
        ),
        getUnexplainedServerErrorMessage("1f0c9a2b"),
      ],
      [
        "an empty answer",
        new HTTPErrorResponse(500, {}, {}),
        UNEXPLAINED_ERROR_MESSAGES.server,
      ],
      [
        "a proxy's HTML page",
        new HTTPErrorResponse(500, NGINX_500 as never, {}),
        UNEXPLAINED_ERROR_MESSAGES.server,
      ],
      [
        "OneUptime not reached",
        new APIException(
          "Request failed to https://oneuptime.example.com/api/data-observability/check-suggest. Network Error",
        ),
        UNEXPLAINED_ERROR_MESSAGES.unreachable,
      ],
      [
        "the browser's own network error",
        new TypeError("Failed to fetch"),
        UNEXPLAINED_ERROR_MESSAGES.unreachable,
      ],
    ])(
      "%s: what was not written, why and what to do next, in German, with no English left",
      async (_failure: string, rejection: unknown, message: string) => {
        const error: HTMLElement = await writeFailsWith("de", rejection);
        const said: (text: string) => string = wordsOf("de");
        const explanation: HTMLElement =
          within(error).getByTestId("error-explanation");

        expect(error.tagName).toBe("P");
        expect(error).toHaveClass("text-sm", "text-red-600");
        expect(
          within(explanation).getByTestId("error-what-failed"),
        ).toHaveTextContent(said(CheckFromSentenceWhatFailed.write));
        expect(
          within(explanation).getByTestId("error-why-and-next").textContent,
        ).toBe(explanationIn("de", message));
        expect(error.textContent).not.toContain(message);
        expect(error.textContent).not.toContain("<");
        expect(error.textContent).not.toContain("https://");
        expect(said(CheckFromSentenceWhatFailed.write)).not.toBe(
          CheckFromSentenceWhatFailed.write,
        );
      },
    );

    test("a server failure's reference is code, with a Copy button", async () => {
      const error: HTMLElement = await writeFailsWith(
        "en",
        new HTTPErrorResponse(
          500,
          {
            error: getUnexplainedServerErrorMessage("1f0c9a2b"),
            reference: "1f0c9a2b",
          },
          {},
        ),
      );
      const reference: HTMLElement =
        within(error).getByTestId("error-reference");

      expect(within(reference).getByText("1f0c9a2b").tagName).toBe("CODE");
      expect(
        within(reference).getByRole("button", { name: "Copy" }),
      ).toBeInTheDocument();
    });

    test("on an English page: the English words, what was not written first", async () => {
      const error: HTMLElement = await writeFailsWith(
        "en",
        new HTTPErrorResponse(502, "" as never, {}),
      );

      expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
        "The check was not written.",
      );
      expect(within(error).getByTestId("error-why-and-next").textContent).toBe(
        `${UnexplainedErrorWords.serverDownWhy} ${UnexplainedErrorWords.serverDownNext}`,
      );
      expect(error.textContent).not.toContain(SERVER_DOWN_MESSAGE);
    });

    test.each(["ar", "fa"])(
      "on a %s page: the explanation reads the page's way, with no English left",
      async (language: string) => {
        const error: HTMLElement = await writeFailsWith(
          language,
          new Error(""),
        );
        const said: (text: string) => string = wordsOf(language);

        expect(error).not.toHaveAttribute("dir");
        expect(
          within(error).getByTestId("error-what-failed"),
        ).toHaveTextContent(said(CheckFromSentenceWhatFailed.write));
        expect(
          within(error).getByTestId("error-why-and-next").textContent,
        ).toBe(explanationIn(language, UNEXPLAINED_ERROR_MESSAGES.page));
        expect(error.textContent).not.toMatch(/[A-Za-z]/);
      },
    );

    test("a check that is not added says so first, and its suggestion stays", async () => {
      createMock.mockRejectedValue(new HTTPErrorResponse(504, {}, {}));

      await writeIn("de");

      const said: (text: string) => string = wordsOf("de");

      fireEvent.click(
        await screen.findByRole("button", { name: said("Add Check") }),
      );

      const error: HTMLElement = await screen.findByTestId(
        CHECK_FROM_SENTENCE_ERROR_TEST_ID,
      );

      expect(within(error).getByTestId("error-what-failed")).toHaveTextContent(
        said(CheckFromSentenceWhatFailed.add),
      );
      expect(within(error).getByTestId("error-why-and-next").textContent).toBe(
        explanationIn("de", SERVER_DOWN_MESSAGE),
      );
      expect(
        screen.getByRole("button", { name: said("Add Check") }),
      ).toBeInTheDocument();
    });

    test("writing again clears the last error", async () => {
      const error: HTMLElement = await writeFailsWith(
        "en",
        new HTTPErrorResponse(502, "" as never, {}),
      );

      expect(error).toBeInTheDocument();

      suggestCheckMock.mockResolvedValue(SUGGESTION);
      fireEvent.click(screen.getByRole("button", { name: "Write the Check" }));

      await screen.findByRole("button", { name: "Add Check" });

      expect(
        screen.queryByTestId(CHECK_FROM_SENTENCE_ERROR_TEST_ID),
      ).not.toBeInTheDocument();
    });
  });
});
