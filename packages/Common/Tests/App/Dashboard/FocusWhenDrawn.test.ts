import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  FOCUS_WHEN_DRAWN_INTERVAL_MS,
  FOCUS_WHEN_DRAWN_TRIES,
  focusWhenDrawn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/FocusWhenDrawn";

/*
 * A note whose button takes the note away - "Investigate too" on a rule
 * that only fixes, "Fix like a new rule" on an older rule - hands keyboard
 * focus to the question that takes the note's place (FocusWhenDrawn), once
 * the form has drawn it. Without it, the button is gone and focus falls
 * back to the page: the next Tab starts again from the dialog's top.
 *
 * The form is drawn here by hand, so each step - the click, the note gone,
 * the question drawn - happens when the test says.
 */

const ANSWER: string = "[data-testid='answer'] input:checked";
const FIRST_ANSWER: string = "[data-testid='answer'] input";

interface Drawn {
  dialog: HTMLElement;
  note: HTMLElement;
  button: HTMLButtonElement;
  outside: HTMLButtonElement;
}

// A dialog holding a note with its button, and a button outside it.
function draw(): Drawn {
  document.body.innerHTML = "";

  const outside: HTMLButtonElement = document.createElement("button");
  outside.textContent = "Outside";
  document.body.appendChild(outside);

  const dialog: HTMLElement = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.appendChild(dialog);

  const note: HTMLElement = document.createElement("div");
  const button: HTMLButtonElement = document.createElement("button");
  button.textContent = "Investigate too";
  note.appendChild(button);
  dialog.appendChild(note);

  return { dialog, note, button, outside };
}

// The question the note stood in for: two answers, the second one picked.
function drawQuestion(into: HTMLElement): {
  first: HTMLInputElement;
  picked: HTMLInputElement;
} {
  const group: HTMLElement = document.createElement("div");
  group.setAttribute("data-testid", "answer");

  const first: HTMLInputElement = document.createElement("input");
  first.type = "radio";
  first.name = "answer";
  const picked: HTMLInputElement = document.createElement("input");
  picked.type = "radio";
  picked.name = "answer";
  picked.checked = true;

  group.appendChild(first);
  group.appendChild(picked);
  into.appendChild(group);

  return { first, picked };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = "";
});

describe("focus after a note's button takes the note away", () => {
  test("goes to the picked answer of the question drawn in the note's place", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER, FIRST_ANSWER] });

    // The form takes the answer: the note goes, the question is drawn.
    drawn.note.remove();
    const question: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(drawn.dialog);

    jest.runOnlyPendingTimers();

    expect(document.activeElement).toBe(question.picked);
  });

  test("falls back to the first answer when none is picked", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER, FIRST_ANSWER] });

    drawn.note.remove();
    const question: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(drawn.dialog);
    question.picked.checked = false;

    jest.runOnlyPendingTimers();

    expect(document.activeElement).toBe(question.first);
  });

  test("waits while the note is still drawn: the question may still show the answer before", () => {
    const drawn: Drawn = draw();
    // The question is there already, above the note's change.
    const question: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(drawn.dialog);
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER] });

    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS);
    expect(document.activeElement).toBe(drawn.button);

    // Now the form takes the new answer and the note goes.
    question.picked.checked = false;
    question.first.checked = true;
    drawn.note.remove();
    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS);

    expect(document.activeElement).toBe(question.first);
  });

  test("looks again while the form redraws, and finds a question drawn a few frames later", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER] });
    drawn.note.remove();

    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS * 3);
    expect(document.activeElement).toBe(document.body);

    const question: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(drawn.dialog);
    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS);

    expect(document.activeElement).toBe(question.picked);
  });

  test("gives up after a few tries, and leaves no timer behind", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER] });
    drawn.note.remove();

    jest.advanceTimersByTime(
      FOCUS_WHEN_DRAWN_INTERVAL_MS * (FOCUS_WHEN_DRAWN_TRIES + 2),
    );

    expect(jest.getTimerCount()).toBe(0);

    // Drawn too late: not taken over.
    drawQuestion(drawn.dialog);
    jest.runOnlyPendingTimers();
    expect(document.activeElement).toBe(document.body);
  });

  test("never takes focus back from where someone has moved it meanwhile", () => {
    const drawn: Drawn = draw();
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER] });
    drawn.note.remove();
    drawn.outside.focus();
    drawQuestion(drawn.dialog);

    jest.runOnlyPendingTimers();

    expect(document.activeElement).toBe(drawn.outside);
  });

  test("looks only inside the note's own dialog", () => {
    const drawn: Drawn = draw();
    // An answer of the same shape on the page behind the dialog.
    const behind: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(document.body);
    drawn.button.focus();

    focusWhenDrawn({ from: drawn.note, selectors: [ANSWER] });
    drawn.note.remove();
    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS * 2);

    expect(document.activeElement).not.toBe(behind.picked);

    const question: { first: HTMLInputElement; picked: HTMLInputElement } =
      drawQuestion(drawn.dialog);
    jest.advanceTimersByTime(FOCUS_WHEN_DRAWN_INTERVAL_MS);

    expect(document.activeElement).toBe(question.picked);
  });

  test("does nothing without a note to start from", () => {
    expect(() => {
      focusWhenDrawn({ from: null, selectors: [ANSWER] });
    }).not.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
