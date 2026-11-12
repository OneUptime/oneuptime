import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
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
  CHECK_FROM_SENTENCE_BUTTONS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CheckFromSentence";
import { CARD_HEADER_ACTION_CLASS_NAME } from "../../../UI/Components/Card/Card";
import ObjectID from "../../../Types/ObjectID";
import { DataCheckAlertCondition } from "../../../Types/DataObservability/DataCheckType";
import { DataObservabilityCheckSuggestion } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";

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

beforeEach(() => {
  suggestCheckMock.mockReset();
  syncCheckAlertMock.mockReset();
  createMock.mockReset();
  suggestCheckMock.mockResolvedValue(SUGGESTION);
  syncCheckAlertMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
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
