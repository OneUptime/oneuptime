import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import React, { ReactElement, useRef } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { DOCS_URL } from "../../../../UI/Config";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import DefinedTerm, {
  DEFINED_TERM_CLASS_NAME,
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_LOADING_TEXT,
  DEFINED_TERM_POPOVER_CLASS_NAME,
  DEFINED_TERM_POPOVER_TEST_ID,
  DEFINED_TERM_READ_MORE_TEST_ID,
  DEFINED_TERM_READ_MORE_TEXT,
  DEFINED_TERM_TEST_ID,
  DEFINED_TERM_UNAVAILABLE_TEXT,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";
import {
  PRODUCT_TEXT_CLASS_NAME,
  withProductText,
} from "../../../../UI/Utils/ProductText";

/*
 * A word with its definition (#6819): the word is a button with a dotted
 * line; hover, the keyboard's focus or a tap opens the term's entry from
 * the docs' Glossary - read from /docs/glossary/<lang>.json, in the
 * reader's language - with Read more to the term on the Glossary page.
 *
 * Tippy runs for real under jsdom: the popover is mounted beside its word
 * (an interactive popover is, so the keyboard reaches Read more), and its
 * box never finishes animating, so presence is what is asserted. The
 * dashboard's own locale files answer react-i18next, so the words asserted
 * in German are the words a German reader sees.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

const readLocale: (code: string) => Locale = (code: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
};

const LOCALES: Record<string, Locale> = {
  en: readLocale("en"),
  de: readLocale("de"),
  fa: readLocale("fa"),
  ar: readLocale("ar"),
};

let language: string = "en";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = LOCALES[language]![key];
          if (typeof flat === "string") {
            return flat;
          }
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: {
          resolvedLanguage: language,
          language: language,
        },
      };
    },
  };
});

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

const DOCS: string = DOCS_URL.toString();

const ENGLISH_GLOSSARY: unknown = {
  lang: "en",
  entries: [
    {
      id: "criteria",
      term: "Criteria",
      definition:
        "A monitor's rules: what each check result means. They are checked in order, and the first one that matches can change the monitor's status, declare an incident, create an alert, or all three.",
    },
    {
      id: "probe",
      term: "Probe",
      definition:
        "A machine that runs monitors' checks. One. Two. Three is too many.",
    },
  ],
};

const GERMAN_GLOSSARY: unknown = {
  lang: "de",
  entries: [
    {
      id: "criteria",
      term: "Kriterien",
      definition: "Die Regeln eines Monitors: was jedes Prüfergebnis bedeutet.",
    },
  ],
};

const PERSIAN_GLOSSARY: unknown = {
  lang: "fa",
  entries: [
    {
      id: "criteria",
      term: "معیارها",
      definition: "قواعد یک مانیتور: هر نتیجه بررسی چه معنایی دارد.",
    },
  ],
};

const GLOSSARIES: Record<string, unknown> = {
  [`${DOCS}/glossary/en.json`]: ENGLISH_GLOSSARY,
  [`${DOCS}/glossary/de.json`]: GERMAN_GLOSSARY,
  [`${DOCS}/glossary/fa.json`]: PERSIAN_GLOSSARY,
};

type FetchMock = Mock<(url: string) => Promise<unknown>>;

let fetchMock: FetchMock;
const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

const okAnswer: (body: unknown) => Promise<unknown> = (
  body: unknown,
): Promise<unknown> => {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: (): Promise<unknown> => {
      return Promise.resolve(body);
    },
  });
};

beforeEach(() => {
  language = "en";
  clearGlossaryReads();
  captureMock.mockReset();
  fetchMock = jest.fn((url: string): Promise<unknown> => {
    return okAnswer(GLOSSARIES[url]);
  });
  (globalThis as Record<string, unknown>)["fetch"] = fetchMock;
});

afterEach(() => {
  cleanup();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

const word: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(DEFINED_TERM_TEST_ID);
};

const popover: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId(DEFINED_TERM_POPOVER_TEST_ID);
};

/*
 * Whether the popover is up. jsdom never ends a transition, so a hidden
 * popover is never taken out of the page: its box says it is hidden.
 */
const isShown: () => boolean = (): boolean => {
  const element: HTMLElement | null = popover();

  return Boolean(
    element &&
      element.closest(".tippy-box")?.getAttribute("data-state") === "visible",
  );
};

const waitHidden: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(isShown()).toBe(false);
  });
};

const waitShown: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(isShown()).toBe(true);
  });
};

// Waits for the popover to show its definition.
const definitionShown: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    return waitFor(() => {
      return screen.getByTestId(DEFINED_TERM_DEFINITION_TEST_ID);
    });
  };

// What a finger's tap sends a button, in the order the browser sends it.
const tap: (element: HTMLElement) => void = (element: HTMLElement): void => {
  fireEvent.pointerDown(element);
  fireEvent.mouseOver(element);
  fireEvent.mouseEnter(element);
  fireEvent.mouseDown(element);
  act(() => {
    element.focus();
  });
  fireEvent.mouseUp(element);
  fireEvent.click(element);
  // The finger lifts: the pointer leaves the word at once.
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
};

// The pointer leaves the word, and moves on well away from it.
const leave: (element: HTMLElement) => void = (element: HTMLElement): void => {
  fireEvent.mouseLeave(element);
  fireEvent.mouseMove(document, { clientX: 600, clientY: 600 });
};

// Lets Tippy's delays run out.
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 350);
    });
  });
};

describe("the word", () => {
  test("is a button drawn with a dotted line, that says which term it defines", () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    const button: HTMLElement = screen.getByRole("button", {
      name: "Criteria",
    });

    expect(button).toBe(word());
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-glossary-term", "criteria");
    expect(button.className).toBe(DEFINED_TERM_CLASS_NAME);
    expect(DEFINED_TERM_CLASS_NAME).toContain("decoration-dotted");
    expect(DEFINED_TERM_CLASS_NAME).toContain("focus-visible:ring-2");
  });

  test("reads nothing from the docs until someone reaches for a definition", () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(popover()).toBeNull();
  });
});

describe("opening the definition", () => {
  test("hovering shows the Glossary's term and definition, and Read more", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();

    expect(definition).toHaveTextContent(
      "A monitor's rules: what each check result means.",
    );
    expect(popover()).toHaveTextContent("Criteria");

    const readMore: HTMLElement = screen.getByTestId(
      DEFINED_TERM_READ_MORE_TEST_ID,
    );

    expect(readMore).toHaveTextContent(DEFINED_TERM_READ_MORE_TEXT);
    expect(readMore).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary#criteria`,
    );
    expect(readMore).toHaveAttribute("target", "_blank");
    expect(readMore).toHaveAttribute("rel", "noopener noreferrer");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${DOCS}/glossary/en.json`);
  });

  test("moving away puts it away again", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.mouseEnter(word());
    await definitionShown();
    await waitShown();

    /*
     * An interactive popover waits for the pointer to leave it too: the
     * pointer moves on, well away from both.
     */
    leave(word());

    await waitHidden();
  });

  test("a quick click on the word shows it, and keeps it", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    // Pointer in, press, pointer out, all at once: no wait for a hover.
    fireEvent.mouseEnter(word());
    fireEvent.mouseDown(word());
    fireEvent.mouseUp(word());
    fireEvent.click(word());
    leave(word());

    await definitionShown();
    await settle();

    expect(isShown()).toBe(true);
  });

  test("the keyboard's focus shows it, and the word is described by it", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      word().focus();
    });

    await definitionShown();

    const describedBy: string | null = word().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "A monitor's rules",
    );
    // An interactive popover says whether it is open.
    expect(word()).toHaveAttribute("aria-expanded", "true");
  });

  test("a focus a script moved after a click does not pop it up unasked", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.mouseDown(document.body);
    act(() => {
      word().focus();
    });
    await settle();

    expect(popover()).toBeNull();
  });

  test("a tap keeps it open once the finger lifts, and the next tap puts it away", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    tap(word());
    await definitionShown();
    await settle();

    // Still up, though the pointer left the word when the finger lifted.
    expect(isShown()).toBe(true);

    tap(word());

    await waitHidden();
  });

  test("a press anywhere else puts a pinned one away", async () => {
    render(
      <div>
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
        <p data-testid="elsewhere">Something else</p>
      </div>,
    );

    tap(word());
    await definitionShown();
    await waitShown();

    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    fireEvent.click(screen.getByTestId("elsewhere"));

    await waitHidden();
  });

  test("Escape puts it away, however it was opened", async () => {
    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    tap(word());
    await definitionShown();
    await waitShown();

    fireEvent.keyDown(word(), { key: "Escape" });

    await waitHidden();
  });

  test("Tab past Read more puts it away; back to the word keeps it", async () => {
    render(
      <div>
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
        <button type="button" data-testid="next">
          Next
        </button>
      </div>,
    );

    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => {
      word().focus();
    });
    await definitionShown();
    await waitShown();

    const readMore: HTMLElement = screen.getByTestId(
      DEFINED_TERM_READ_MORE_TEST_ID,
    );

    // The popover sits right after its word, so Tab reaches Read more.
    expect(
      word().compareDocumentPosition(readMore) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      readMore.compareDocumentPosition(screen.getByTestId("next")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => {
      readMore.focus();
    });
    await settle();
    expect(isShown()).toBe(true);

    // Shift+Tab back to the word: still up.
    act(() => {
      word().focus();
    });
    await settle();
    expect(isShown()).toBe(true);

    act(() => {
      readMore.focus();
    });
    act(() => {
      screen.getByTestId("next").focus();
    });

    await waitHidden();
  });

  /*
   * A word inside something its words name - a form field's title names
   * the field (FieldLabel) - is given a place after it for its definition,
   * so the definition is no part of that name.
   */
  test("is drawn in the place its word is given, still named by the word and reached by Tab from it", async () => {
    const Title: () => ReactElement = (): ReactElement => {
      const place: React.RefObject<HTMLSpanElement> =
        useRef<HTMLSpanElement>(null);

      return (
        <div>
          <span data-testid="title">
            <DefinedTerm term={GlossaryTerm.Criteria} popoverPlace={place}>
              Criteria
            </DefinedTerm>{" "}
            (Optional)
          </span>
          <span data-testid="place" ref={place} />
          <button type="button" data-testid="next">
            Next
          </button>
        </div>
      );
    };

    render(<Title />);

    fireEvent.mouseEnter(word());
    await definitionShown();

    const box: HTMLElement = popover() as HTMLElement;

    expect(screen.getByTestId("place")).toContainElement(box);
    expect(screen.getByTestId("title")).not.toContainElement(box);
    expect(screen.getByRole("dialog", { name: "Criteria" })).toContainElement(
      box,
    );

    const readMore: HTMLElement = screen.getByTestId(
      DEFINED_TERM_READ_MORE_TEST_ID,
    );

    expect(
      word().compareDocumentPosition(readMore) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      readMore.compareDocumentPosition(screen.getByTestId("next")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("every word on a page shares one read of the glossary, and sends nothing to analytics", async () => {
    render(
      <div>
        <DefinedTerm term={GlossaryTerm.Criteria} dataTestId="first">
          Criteria
        </DefinedTerm>
        <DefinedTerm term={GlossaryTerm.Probe} dataTestId="second">
          Probe
        </DefinedTerm>
      </div>,
    );

    fireEvent.mouseEnter(screen.getByTestId("first"));
    await definitionShown();
    await waitShown();
    leave(screen.getByTestId("first"));
    await waitHidden();
    fireEvent.mouseEnter(screen.getByTestId("first"));
    await waitShown();
    leave(screen.getByTestId("first"));
    await waitHidden();
    fireEvent.mouseEnter(screen.getByTestId("second"));
    // jsdom keeps the first word's hidden popover: the second's is beside it.
    await waitFor(() => {
      expect(
        screen
          .getAllByTestId(DEFINED_TERM_DEFINITION_TEST_ID)
          .map((element: HTMLElement): string => {
            return element.textContent || "";
          }),
      ).toContain("A machine that runs monitors' checks. One. Two.");
    });

    // Both definitions came from one read of the glossary.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    /*
     * A shared component sends no event of its own: #6830's catalog holds
     * every event to a page that sends it.
     */
    expect(captureMock).not.toHaveBeenCalled();
  });
});

describe("what the popover says", () => {
  test("at most three sentences: anything longer belongs in the docs", async () => {
    render(<DefinedTerm term={GlossaryTerm.Probe}>Probes</DefinedTerm>);

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();

    expect(definition.textContent).toBe(
      "A machine that runs monitors' checks. One. Two.",
    );
  });

  test("while the definition is on its way, it says so and already links the Glossary", async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce((url: string): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        release = () => {
          resolve(okAnswer(GLOSSARIES[url]));
        };
      });
    });

    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.mouseEnter(word());

    await waitFor(() => {
      expect(popover()).toHaveTextContent(DEFINED_TERM_LOADING_TEXT);
    });
    expect(screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID)).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary#criteria`,
    );

    await act(async () => {
      release!();
    });

    await definitionShown();
    expect(popover()).not.toHaveTextContent(DEFINED_TERM_LOADING_TEXT);
  });

  test("when the docs cannot be reached, it sends the reader to the Glossary page", async () => {
    fetchMock.mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error("offline"));
    });

    render(<DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>);

    fireEvent.mouseEnter(word());

    await waitFor(() => {
      expect(popover()).toHaveTextContent(DEFINED_TERM_UNAVAILABLE_TEXT);
    });
    expect(screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID)).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary#criteria`,
    );
    expect(
      screen.queryByTestId(DEFINED_TERM_DEFINITION_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a term the glossary does not hold links the Glossary page instead", async () => {
    render(<DefinedTerm term={GlossaryTerm.Runbook}>Runbooks</DefinedTerm>);

    fireEvent.mouseEnter(word());

    await waitFor(() => {
      expect(popover()).toHaveTextContent(DEFINED_TERM_UNAVAILABLE_TEXT);
    });
    expect(screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID)).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary#runbook`,
    );
  });

  /*
   * The popover is drawn inside its word's parent, so it would take on that
   * parent's type: a row name in small capitals ("When this goes down" names
   * its On-call policy row so), or a card title's weight.
   */
  test("reads in its own type, not in the capitals, spacing or weight around its word", async () => {
    render(
      <span className="text-xs font-semibold uppercase tracking-wide">
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
      </span>,
    );

    fireEvent.mouseEnter(word());
    await definitionShown();

    const box: HTMLElement = popover() as HTMLElement;

    expect(box.closest(".uppercase")).not.toBeNull();
    // Its own type, and the mark of the product's words, which draws nothing.
    expect(box.className).toBe(
      withProductText(DEFINED_TERM_POPOVER_CLASS_NAME),
    );
    expect(box).toHaveClass(
      "text-sm",
      "font-normal",
      "normal-case",
      "tracking-normal",
    );
  });
});

/*
 * A recording of the first-run pages masks every word on the page but the
 * product's own (Utils/ProductText). A definition is the product's own
 * words wherever it is drawn - beside its word, after a field's title
 * (DefinedTermInFieldLabel.test.tsx) or after a heading
 * (DefinedTermInCardTitle.test.tsx) - so its popover carries the mark
 * itself. The words around it, its word among them, are the page's to mark.
 */
describe("in a recording of the page", () => {
  test("the definition is recorded as written, and the line around it is left to the page", async () => {
    render(
      <p data-testid="line">
        Each check is held to its{" "}
        <DefinedTerm term={GlossaryTerm.Criteria}>criteria</DefinedTerm>.
      </p>,
    );

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();
    const box: HTMLElement = popover() as HTMLElement;
    const marked: string = `.${PRODUCT_TEXT_CLASS_NAME}`;

    expect(definition.closest(marked)).toBe(box);
    expect(
      screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID).closest(marked),
    ).toBe(box);
    expect(screen.getByTestId("line").closest(marked)).toBeNull();
    expect(word().closest(marked)).toBeNull();
  });
});

describe("in the reader's language", () => {
  test("German reads the German glossary and the German words around it", async () => {
    language = "de";

    render(<DefinedTerm term={GlossaryTerm.Criteria}>Kriterien</DefinedTerm>);

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();

    expect(fetchMock.mock.calls[0]![0]).toBe(`${DOCS}/glossary/de.json`);
    expect(definition).toHaveTextContent("Die Regeln eines Monitors");

    const readMore: HTMLElement = screen.getByTestId(
      DEFINED_TERM_READ_MORE_TEST_ID,
    );
    const german: unknown = LOCALES["de"]![DEFINED_TERM_READ_MORE_TEXT];

    expect(typeof german).toBe("string");
    expect(german).not.toBe(DEFINED_TERM_READ_MORE_TEXT);
    expect(readMore).toHaveTextContent(german as string);
    expect(readMore).toHaveAttribute(
      "href",
      `${DOCS}/de/introduction/glossary#criteria`,
    );
    expect(definition.closest("[lang]")).toHaveAttribute("lang", "de");
  });

  test("Persian reads its glossary from the right", async () => {
    language = "fa";

    render(<DefinedTerm term={GlossaryTerm.Criteria}>معیارها</DefinedTerm>);

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();
    const block: HTMLElement = definition.closest("[dir]") as HTMLElement;

    expect(block).toHaveAttribute("dir", "rtl");
    expect(block).toHaveAttribute("lang", "fa");
    expect(within(block).getByText("معیارها")).toBeInTheDocument();
    // Its own text starts where a right-to-left reader starts.
    expect(
      screen.getByTestId(DEFINED_TERM_POPOVER_TEST_ID).className,
    ).toContain("text-start");
  });

  test("Arabic, which the docs have no copy of, reads the English entry left to right inside its page", async () => {
    language = "ar";

    render(<DefinedTerm term={GlossaryTerm.Criteria}>المعايير</DefinedTerm>);

    fireEvent.mouseEnter(word());

    const definition: HTMLElement = await definitionShown();
    const block: HTMLElement = definition.closest("[dir]") as HTMLElement;

    expect(fetchMock.mock.calls[0]![0]).toBe(`${DOCS}/glossary/en.json`);
    expect(block).toHaveAttribute("dir", "ltr");
    expect(block).toHaveAttribute("lang", "en");
    // Read more is in the reader's own language, and opens the English page.
    expect(
      screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID),
    ).toHaveTextContent(LOCALES["ar"]![DEFINED_TERM_READ_MORE_TEXT] as string);
    expect(screen.getByTestId(DEFINED_TERM_READ_MORE_TEST_ID)).toHaveAttribute(
      "href",
      `${DOCS}/en/introduction/glossary#criteria`,
    );
  });
});

describe("a press is the word's own", () => {
  test("pressing the word in a label does not tick the label's box", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <label>
        <input type="checkbox" data-testid="box" onChange={onChange} />
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
      </label>,
    );

    fireEvent.click(word());

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("box")).not.toBeChecked();
  });

  test("pressing the definition's words does not tick it either, and Read more is still a link", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <label>
        <input type="checkbox" data-testid="box" onChange={onChange} />
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
      </label>,
    );

    fireEvent.mouseEnter(word());
    const definition: HTMLElement = await definitionShown();

    const click: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    definition.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("box")).not.toBeChecked();

    const readMoreClick: MouseEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    screen
      .getByTestId(DEFINED_TERM_READ_MORE_TEST_ID)
      .dispatchEvent(readMoreClick);

    // Not held back: the browser follows the link.
    expect(readMoreClick.defaultPrevented).toBe(false);
  });

  test("a card that is a link or a button does not hear the press, nor Enter or Space", () => {
    const onCardClick: MockFunction = getJestMockFunction();
    const onCardKey: MockFunction = getJestMockFunction();

    render(
      <div
        role="button"
        tabIndex={0}
        onClick={onCardClick}
        onKeyDown={onCardKey}
      >
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
      </div>,
    );

    fireEvent.click(word());
    fireEvent.keyDown(word(), { key: "Enter" });
    fireEvent.keyDown(word(), { key: " " });

    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardKey).not.toHaveBeenCalled();
  });

  test("a press inside a form never submits it", () => {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <form
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>
      </form>,
    );

    fireEvent.click(word());

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
