import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import getJestMockFunction, { MockFunction } from "../../../MockType";

const captureMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Analytics", () => {
  return {
    __esModule: true,
    default: {
      capture: (...args: Array<unknown>) => {
        return captureMock(...args);
      },
    },
  };
});

import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import DefinedTerm, {
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import {
  DEFINITION_HOVER_OPEN_MS,
  DefinitionOpened,
  DefinitionOpenedContext,
  DefinitionOpenedTrigger,
} from "../../../../UI/Components/Glossary/DefinitionOpened";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";

/*
 * WHICH DEFINITIONS PEOPLE OPEN (#7019).
 *
 * A defined term tells, once per word on its page, that its definition was
 * opened - by its term and how - to its `onOpened` and to the page's
 * listener (DefinitionOpenedContext): a press or a tap at once, the
 * keyboard's focus at once, a pointer once it has rested on the word for
 * DEFINITION_HOVER_OPEN_MS. A pointer passing over it shows the definition
 * (DefinedTerm) but tells nothing: nobody read it. A page that gives no
 * listener hears nothing, and a shared component sends no event of its
 * own. GlossaryEvents.test.ts follows what the Dashboard's listener sends,
 * and where it goes.
 *
 * Time is the test's own (jest's timers), so a slow machine never turns a
 * resting pointer into a passing one, or the other way round.
 */

const GLOSSARY: unknown = {
  lang: "en",
  entries: [
    {
      id: "criteria",
      term: "Criteria",
      definition: "A monitor's rules: what each check result means.",
    },
    {
      id: "probe",
      term: "Probe",
      definition: "A machine that runs monitors' checks.",
    },
  ],
};

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

let toldPage: MockFunction;
let toldWord: MockFunction;

beforeEach(() => {
  jest.useFakeTimers();
  clearGlossaryReads();
  captureMock.mockReset();
  toldPage = getJestMockFunction();
  toldWord = getJestMockFunction();
  (globalThis as Record<string, unknown>)["fetch"] = (): Promise<unknown> => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(GLOSSARY);
      },
    });
  };
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

// A page that listens, with a word that listens too.
const renderWord: (term?: GlossaryTerm) => void = (
  term?: GlossaryTerm,
): void => {
  render(
    <DefinitionOpenedContext.Provider
      value={(opened: DefinitionOpened) => {
        toldPage(opened);
      }}
    >
      <p>
        Each{" "}
        <DefinedTerm
          term={term || GlossaryTerm.Criteria}
          onOpened={(opened: DefinitionOpened) => {
            toldWord(opened);
          }}
        >
          criteria
        </DefinedTerm>{" "}
        is checked in order.
      </p>
      <button type="button" data-testid="elsewhere">
        Next
      </button>
    </DefinitionOpenedContext.Provider>,
  );
};

const word: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(DEFINED_TERM_TEST_ID);
};

// The test's clock moves on, and what it set off runs.
const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

const opened: (trigger: DefinitionOpenedTrigger) => DefinitionOpened = (
  trigger: DefinitionOpenedTrigger,
): DefinitionOpened => {
  return { term: GlossaryTerm.Criteria, trigger: trigger };
};

describe("a definition someone opens is told once, by its term and how", () => {
  test("a press: at once, to the word's onOpened and to the page", async () => {
    renderWord();

    fireEvent.click(word());
    await wait(0);

    expect(toldWord.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Press)]]);
    expect(toldPage.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Press)]]);
  });

  test("pressed again and again on the same page: still once", async () => {
    renderWord();

    for (let press: number = 0; press < 4; press++) {
      fireEvent.click(word());
      await wait(300);
    }

    expect(toldPage).toHaveBeenCalledTimes(1);
    expect(toldWord).toHaveBeenCalledTimes(1);
  });

  test("the keyboard's focus: at once", async () => {
    renderWord();

    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      word().focus();
    });
    await wait(0);

    expect(toldPage.mock.calls).toEqual([
      [opened(DefinitionOpenedTrigger.Keyboard)],
    ]);
  });

  test("a focus the mouse moved there tells nothing: it showed nothing", async () => {
    renderWord();

    fireEvent.mouseDown(document.body);
    act(() => {
      word().focus();
    });
    await wait(DEFINITION_HOVER_OPEN_MS * 2);

    expect(toldPage).not.toHaveBeenCalled();
  });

  test("a pointer that rests on the word: once it has rested for a second", async () => {
    renderWord();

    fireEvent.mouseEnter(word());
    await wait(DEFINITION_HOVER_OPEN_MS - 1);

    expect(toldPage).not.toHaveBeenCalled();

    await wait(1);

    expect(toldPage.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Hover)]]);
    expect(toldWord.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Hover)]]);
  });

  test("a pointer on its way across the page tells nothing", async () => {
    renderWord();

    fireEvent.mouseEnter(word());
    await wait(DEFINITION_HOVER_OPEN_MS / 2);
    fireEvent.mouseLeave(word());
    fireEvent.mouseMove(document, { clientX: 600, clientY: 600 });
    await wait(DEFINITION_HOVER_OPEN_MS * 5);

    expect(toldPage).not.toHaveBeenCalled();
    expect(toldWord).not.toHaveBeenCalled();
  });

  test("a press on a definition the pointer opened: told as a press, and only that", async () => {
    renderWord();

    fireEvent.mouseEnter(word());
    await wait(200);
    fireEvent.click(word());
    await wait(DEFINITION_HOVER_OPEN_MS * 3);

    expect(toldPage.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Press)]]);
  });

  test("a tap: told as a press", async () => {
    renderWord();

    fireEvent.pointerDown(word());
    fireEvent.mouseOver(word());
    fireEvent.mouseEnter(word());
    fireEvent.mouseDown(word());
    act(() => {
      word().focus();
    });
    fireEvent.mouseUp(word());
    fireEvent.click(word());
    fireEvent.mouseLeave(word());
    await wait(DEFINITION_HOVER_OPEN_MS * 3);

    expect(toldPage.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Press)]]);
  });

  test("each word tells of its own term", async () => {
    render(
      <DefinitionOpenedContext.Provider
        value={(openedDefinition: DefinitionOpened) => {
          toldPage(openedDefinition);
        }}
      >
        <DefinedTerm term={GlossaryTerm.Criteria} dataTestId="criteria-word">
          criteria
        </DefinedTerm>
        <DefinedTerm term={GlossaryTerm.Probe} dataTestId="probe-word">
          probe
        </DefinedTerm>
      </DefinitionOpenedContext.Provider>,
    );

    fireEvent.click(screen.getByTestId("criteria-word"));
    await wait(300);
    fireEvent.click(document.body);
    await wait(300);
    fireEvent.click(screen.getByTestId("probe-word"));
    await wait(0);

    expect(toldPage.mock.calls).toEqual([
      [{ term: GlossaryTerm.Criteria, trigger: DefinitionOpenedTrigger.Press }],
      [{ term: GlossaryTerm.Probe, trigger: DefinitionOpenedTrigger.Press }],
    ]);
  });

  test("a listener that fails is never the page's: the word still opens, and the other listener is told", async () => {
    render(
      <DefinitionOpenedContext.Provider
        value={() => {
          throw new Error("The listener broke.");
        }}
      >
        <DefinedTerm
          term={GlossaryTerm.Criteria}
          onOpened={(openedDefinition: DefinitionOpened) => {
            toldWord(openedDefinition);
          }}
        >
          criteria
        </DefinedTerm>
      </DefinitionOpenedContext.Provider>,
    );

    expect(() => {
      fireEvent.click(word());
    }).not.toThrow();
    await wait(0);

    expect(toldWord.mock.calls).toEqual([[opened(DefinitionOpenedTrigger.Press)]]);
    expect(word()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("a page that gives no listener", () => {
  test("hears nothing, and nothing reaches product analytics", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>criteria</DefinedTerm>);

    fireEvent.click(word());
    await wait(DEFINITION_HOVER_OPEN_MS * 2);
    fireEvent.mouseEnter(word());
    await wait(DEFINITION_HOVER_OPEN_MS * 2);

    expect(captureMock).not.toHaveBeenCalled();
  });
});
