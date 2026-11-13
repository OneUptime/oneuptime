import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CheckFromSentence";
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
 * WHY THE CHECK COULD NOT BE WRITTEN OR ADDED, ON A RIGHT-TO-LEFT PAGE
 * (#7220's review).
 *
 * The card shows the server's message when OneUptime AI cannot make the
 * rule a check, or the check is not added - English, whatever the page's
 * language. Drawn as a paragraph of the page's, an Arabic or Persian page
 * put its full stop at its start (".OneUptime AI could not ... refunded").
 * It is now a line of its own (IsolatedLine), as the suggestion's name and
 * explanation are: an English message reads left to right, as wide as its
 * words at the page's start; a message in the page's language, and every
 * message on an English page, is drawn as before.
 */
describe("the card's error", () => {
  const WRITE_FAILED: string =
    "OneUptime AI could not write a check OneUptime can run for that rule (the table has no column for when an order was refunded) Say it another way, or write the check yourself.";
  const ADD_FAILED: string = "You do not have permission to create a check.";

  // Writes the rule on a page in `language`.
  async function writeIn(language: string): Promise<void> {
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
  }

  test("on an English page: the server's words in a paragraph with no direction of its own", async () => {
    suggestCheckMock.mockRejectedValue(new Error(WRITE_FAILED));

    await writeIn("en");

    const error: HTMLElement = await screen.findByTestId(
      CHECK_FROM_SENTENCE_ERROR_TEST_ID,
    );

    expect(error.tagName).toBe("P");
    expect(error).toHaveTextContent(WRITE_FAILED);
    expect(error).not.toHaveAttribute("dir");
    expect(error).toHaveClass("text-sm", "text-red-600");
    expect(error).not.toHaveClass("w-fit");
  });

  test.each(["ar", "fa"])(
    "on a %s page: the English message reads left to right, as wide as its words, its full stop at its end",
    async (language: string) => {
      suggestCheckMock.mockRejectedValue(new Error(WRITE_FAILED));

      await writeIn(language);

      const error: HTMLElement = await screen.findByTestId(
        CHECK_FROM_SENTENCE_ERROR_TEST_ID,
      );

      expect(error.tagName).toBe("P");
      expect(error).toHaveAttribute("dir", "ltr");
      expect(error).toHaveClass("break-words", "w-fit", "max-w-full");
      // Never text-end beside wrapping lines: each lines up at its own start.
      expect(error).not.toHaveClass("text-end");
      expect(withoutIsolateMarks(error.textContent || "")).toBe(WRITE_FAILED);
    },
  );

  test("on a Persian page, a check that is not added says why the same way, and its suggestion stays", async () => {
    createMock.mockRejectedValue(new Error(ADD_FAILED));

    await writeIn("fa");

    const words: Record<string, string> = readDashboardLocale("fa");

    fireEvent.click(
      await screen.findByRole("button", { name: words["Add Check"]! }),
    );

    const error: HTMLElement = await screen.findByTestId(
      CHECK_FROM_SENTENCE_ERROR_TEST_ID,
    );

    expect(error).toHaveAttribute("dir", "ltr");
    expect(withoutIsolateMarks(error.textContent || "")).toBe(ADD_FAILED);
    expect(
      screen.getByRole("button", { name: words["Add Check"]! }),
    ).toBeInTheDocument();
  });

  test("on an Arabic page, a failure the server could not explain reads left to right too", async () => {
    // A request that failed with no message: the card says the page's sentence for it, in English for now.
    suggestCheckMock.mockRejectedValue(new Error(""));

    await writeIn("ar");

    const error: HTMLElement = await screen.findByTestId(
      CHECK_FROM_SENTENCE_ERROR_TEST_ID,
    );

    expect(error.textContent).not.toBe("");
    expect(error).toHaveAttribute("dir", "ltr");
    expect(error).toHaveClass("w-fit", "max-w-full");
  });
});
