// UX rule: Docs/ux/README.md#names
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where the definition is drawn, as the test asks: on the tooltip layer, as
 * DefinedTerm draws it (#9863), or - to plant the defect of #7561 and #7594
 * - right after its word, inside whatever the word is in.
 */
let mockDrawDefinitionBesideItsWord: boolean = false;

jest.mock("../../../../UI/Components/Tooltip/TooltipLayer", () => {
  const actual: typeof import("../../../../UI/Components/Tooltip/TooltipLayer") =
    jest.requireActual("../../../../UI/Components/Tooltip/TooltipLayer");

  return {
    ...actual,
    getTooltipLayer: (reference: Element): Element => {
      return mockDrawDefinitionBesideItsWord && reference.parentElement
        ? reference.parentElement
        : actual.getTooltipLayer(reference);
    },
  };
});

import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import Card from "../../../../UI/Components/Card/Card";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import DefinedTerm, {
  DEFINED_TERM_DEFINITION_TEST_ID,
  DEFINED_TERM_TEST_ID,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import LazyDefinedTerm from "../../../../UI/Components/Glossary/LazyDefinedTerm";
import {
  CONTROLS_A_WORD_IS_NEVER_IN,
  NAMES_A_DEFINITION_IS_NEVER_IN,
  describeElement,
  getControlAroundWord,
  getMisplacedDefinitionMessage,
  getMisplacedWordMessage,
  getNameAroundDefinition,
  isUnderTest,
} from "../../../../UI/Components/Glossary/DefinedTermPlace";
import { clearGlossaryReads } from "../../../../UI/Utils/Glossary";

/*
 * A DEFINED WORD IS NEVER INSIDE A BUTTON, A LINK OR A TAB, AND ITS
 * DEFINITION IS NEVER DRAWN INSIDE A HEADING, A HEADER CELL, A BUTTON, A
 * LINK OR A TAB (#7618).
 *
 * The definition is a dialog named by its word. Drawn inside an element
 * named by its own words, it made that name say the word twice while it
 * showed: a field's title for its field (#7561) and "Criteria Criteria" for
 * a card's heading (#7594). jsdom's names never doubled, and neither did
 * Playwright's; only Chromium's accessibility tree did, so every test as
 * written passed. DefinedTerm draws it on the page's body now (#9863), and
 * DefinedTermPlace fails the test that opens a definition drawn inside such
 * a name, wherever the word is - planted below by drawing it beside its
 * word again, as before #9863.
 *
 * The word is a button of its own, and a control cannot hold another: a
 * screen reader never reaches it, and the press it keeps is one the tab or
 * the link around it never hears. A word drawn inside a control fails the
 * test that draws it, naming the fix.
 */

const GLOSSARY: unknown = {
  lang: "en",
  entries: [
    {
      id: "criteria",
      term: "Criteria",
      definition: "A monitor's rules: what each check result means.",
    },
  ],
};

const originalFetch: unknown = (globalThis as Record<string, unknown>)["fetch"];

// What React says of an error a test means to cause, kept out of the log.
let consoleError: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  mockDrawDefinitionBesideItsWord = false;
  clearGlossaryReads();
  (globalThis as Record<string, unknown>)["fetch"] = (): Promise<unknown> => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: (): Promise<unknown> => {
        return Promise.resolve(GLOSSARY);
      },
    });
  };
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  (globalThis as Record<string, unknown>)["fetch"] = originalFetch;
});

const word: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(DEFINED_TERM_TEST_ID);
};

// Opens the word's definition, as a hover does, and waits for it.
const openDefinition: () => Promise<HTMLElement> =
  async (): Promise<HTMLElement> => {
    fireEvent.mouseEnter(word());

    return waitFor((): HTMLElement => {
      return screen.getByTestId(DEFINED_TERM_DEFINITION_TEST_ID);
    });
  };

// The words inside an element - what names it, for one named by them.
const wordsIn: (element: Element) => string = (element: Element): string => {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
};

const criteria: () => ReactElement = (): ReactElement => {
  return <DefinedTerm term={GlossaryTerm.Criteria}>Criteria</DefinedTerm>;
};

describe("the checks", () => {
  test("run under test only: jest says NODE_ENV is test", () => {
    expect(isUnderTest()).toBe(true);
  });

  test("find the control around a word's place, and nothing around one that is not in a control", () => {
    document.body.innerHTML = [
      '<div role="tab"><span id="in-tab"><span id="place-a"></span></span></div>',
      '<a href="/x"><span id="place-b"></span></a>',
      '<a><span id="place-c"></span></a>',
      '<h2><label><span id="place-d"></span></label></h2>',
    ].join("");

    expect(
      describeElement(getControlAroundWord(document.getElementById("place-a")!)!),
    ).toBe('<div role="tab">');
    expect(
      describeElement(getControlAroundWord(document.getElementById("place-b")!)!),
    ).toBe("<a>");
    // A link with no address is not a link, and a heading or a label is no control.
    expect(getControlAroundWord(document.getElementById("place-c")!)).toBeNull();
    expect(getControlAroundWord(document.getElementById("place-d")!)).toBeNull();

    document.body.innerHTML = "";
  });

  test("find the name a definition is drawn inside, and nothing on the body", () => {
    document.body.innerHTML = [
      '<table><thead><tr><th><span><div id="in-th"></div></span></th></tr></thead></table>',
      '<h3><div id="in-heading"></div></h3>',
      '<div role="tab"><div id="in-tab"></div></div>',
      '<div id="on-the-body"></div>',
    ].join("");

    expect(
      describeElement(
        getNameAroundDefinition(document.getElementById("in-th")!)!,
      ),
    ).toBe("<th>");
    expect(
      describeElement(
        getNameAroundDefinition(document.getElementById("in-heading")!)!,
      ),
    ).toBe("<h3>");
    expect(
      describeElement(
        getNameAroundDefinition(document.getElementById("in-tab")!)!,
      ),
    ).toBe('<div role="tab">');
    expect(
      getNameAroundDefinition(document.getElementById("on-the-body")!),
    ).toBeNull();

    document.body.innerHTML = "";
  });

  test("cover a heading, a header cell, a button, a link and a tab, for the definition and the word", () => {
    for (const place of ["h2", "[role='heading']", "th", "label"]) {
      expect(NAMES_A_DEFINITION_IS_NEVER_IN).toContain(place);
      expect(CONTROLS_A_WORD_IS_NEVER_IN).not.toContain(place);
    }

    for (const control of [
      "button",
      "a[href]",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
    ]) {
      expect(CONTROLS_A_WORD_IS_NEVER_IN).toContain(control);
      expect(NAMES_A_DEFINITION_IS_NEVER_IN).toContain(control);
    }
  });
});

describe("a word inside a control fails the test that draws it", () => {
  test.each<[string, (term: ReactElement) => ReactElement, string]>([
    [
      "a button",
      (term: ReactElement): ReactElement => {
        return <button type="button">{term} settings</button>;
      },
      "<button>",
    ],
    [
      "a link",
      (term: ReactElement): ReactElement => {
        return <a href="/dashboard">{term}</a>;
      },
      "<a>",
    ],
    [
      "a tab",
      (term: ReactElement): ReactElement => {
        return (
          <div role="tablist">
            <div role="tab" tabIndex={0}>
              {term}
            </div>
          </div>
        );
      },
      '<div role="tab">',
    ],
    [
      "a menu's item",
      (term: ReactElement): ReactElement => {
        return (
          <div role="menu">
            <div role="menuitem">{term}</div>
          </div>
        );
      },
      '<div role="menuitem">',
    ],
    [
      "a list's option",
      (term: ReactElement): ReactElement => {
        return (
          <div role="listbox">
            <div role="option" aria-selected="false">
              {term}
            </div>
          </div>
        );
      },
      '<div role="option">',
    ],
    [
      "a card that is a button",
      (term: ReactElement): ReactElement => {
        return (
          <div role="button" tabIndex={0}>
            {term}
          </div>
        );
      },
      '<div role="button">',
    ],
  ])(
    "inside %s",
    (
      _name: string,
      around: (term: ReactElement) => ReactElement,
      control: string,
    ) => {
      let thrown: unknown = null;

      try {
        render(around(criteria()));
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);

      const message: string = (thrown as Error).message;

      // It names the control, and the fix.
      expect(message).toContain(
        `The defined term "criteria" is drawn inside ${control}, a control.`,
      );
      expect(message).toContain(
        "Mark the word where the page first uses it outside the control",
      );
      expect(message).toContain("Docs/ux/README.md#names");
    },
  );

  test("the message is the one the check writes", () => {
    const tab: HTMLElement = document.createElement("div");
    tab.setAttribute("role", "tab");

    expect(
      getMisplacedWordMessage({ term: GlossaryTerm.Criteria, control: tab }),
    ).toMatch(/^The defined term "criteria" is drawn inside <div role="tab">/);
  });

  test("a title's word too, before its file arrives (LazyDefinedTerm)", () => {
    expect(() => {
      render(
        <a href="/dashboard/monitors">
          <LazyDefinedTerm term={GlossaryTerm.Probe}>Probes</LazyDefinedTerm>
        </a>,
      );
    }).toThrow(/The defined term "probe" is drawn inside <a>, a control/);
  });

  test("and a card's title inside a link", () => {
    expect(() => {
      render(
        <a href="/dashboard/monitors">
          <Card title="Probes" titleGlossaryTerm={GlossaryTerm.Probe} />
        </a>,
      );
    }).toThrow(/Mark the word where the page first uses it outside the control/);
  });
});

describe("where a word may be: its definition drawn on the body, its name said once", () => {
  test.each<[string, (term: ReactElement) => ReactElement, string]>([
    [
      "a heading of its own",
      (term: ReactElement): ReactElement => {
        return <h3 data-testid="named">{term}</h3>;
      },
      "Criteria",
    ],
    [
      "a role heading",
      (term: ReactElement): ReactElement => {
        return (
          <div role="heading" aria-level={2} data-testid="named">
            {term} for this monitor
          </div>
        );
      },
      "Criteria for this monitor",
    ],
    [
      "a table's header cell",
      (term: ReactElement): ReactElement => {
        return (
          <table>
            <thead>
              <tr>
                <th data-testid="named">{term}</th>
              </tr>
            </thead>
          </table>
        );
      },
      "Criteria",
    ],
    [
      "a table's cell",
      (term: ReactElement): ReactElement => {
        return (
          <table>
            <tbody>
              <tr>
                <td data-testid="named">{term} (2)</td>
              </tr>
            </tbody>
          </table>
        );
      },
      "Criteria (2)",
    ],
    [
      "a field's label",
      (term: ReactElement): ReactElement => {
        return (
          <label data-testid="named">
            {term}
            <input />
          </label>
        );
      },
      "Criteria",
    ],
  ])(
    "in %s",
    async (_name: string, around: (term: ReactElement) => ReactElement, name: string) => {
      render(around(criteria()));

      const definition: HTMLElement = await openDefinition();
      const named: HTMLElement = screen.getByTestId("named");

      expect(named).not.toContainElement(definition);
      expect(
        definition.closest("[data-tippy-root]")?.parentElement,
      ).toBe(document.body);
      expect(wordsIn(named)).toBe(name);
    },
  );

  test("as Card and FieldLabel draw it: the heading and the field's title are named by their words alone", async () => {
    render(
      <Card title="Criteria" titleGlossaryTerm={GlossaryTerm.Criteria}>
        <div />
      </Card>,
    );

    // The title's file arrives, and its word is DefinedTerm's.
    await waitFor(() => {
      expect(word()).toHaveAttribute("aria-expanded");
    });

    const definition: HTMLElement = await openDefinition();
    const heading: HTMLElement = screen.getByTestId("card-details-heading");

    expect(heading).not.toContainElement(definition);
    expect(wordsIn(heading)).toBe("Criteria");

    cleanup();

    render(
      <div>
        <FieldLabelElement
          title="Criteria"
          htmlFor="criteria-input"
          glossaryTerm={GlossaryTerm.Criteria}
          required={false}
        />
        <input id="criteria-input" />
      </div>,
    );

    await waitFor(() => {
      expect(word()).toHaveAttribute("aria-expanded");
    });

    const fieldDefinition: HTMLElement = await openDefinition();
    const label: HTMLElement = word().closest("label") as HTMLElement;

    expect(label).not.toBeNull();
    expect(label).not.toContainElement(fieldDefinition);
  });
});

describe("a definition drawn inside a name fails the test that opens it (planted: drawn beside its word, as before #9863)", () => {
  test.each<[string, (term: ReactElement) => ReactElement, string]>([
    [
      "a heading",
      (term: ReactElement): ReactElement => {
        return (
          <h2>
            <span>{term}</span>
          </h2>
        );
      },
      "<h2>",
    ],
    [
      "a header cell",
      (term: ReactElement): ReactElement => {
        return (
          <table>
            <thead>
              <tr>
                <th>
                  <span>{term}</span>
                </th>
              </tr>
            </thead>
          </table>
        );
      },
      "<th>",
    ],
    [
      "a field's label",
      (term: ReactElement): ReactElement => {
        return (
          <label>
            <span>{term}</span>
            <input />
          </label>
        );
      },
      "<label>",
    ],
  ])(
    "inside %s",
    async (_name: string, around: (term: ReactElement) => ReactElement, name: string) => {
      mockDrawDefinitionBesideItsWord = true;
      render(around(criteria()));

      let thrown: unknown = null;

      try {
        act(() => {
          fireEvent.mouseEnter(word());
        });
        // The word draws again once its definition is mounted.
        await act(async () => {
          await Promise.resolve();
        });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        getMisplacedDefinitionMessage({
          term: GlossaryTerm.Criteria,
          name: document.createElement(name.slice(1, -1)),
        }),
      );
    },
  );

  test("beside a word in a box no name comes from, it is not a fault", async () => {
    mockDrawDefinitionBesideItsWord = true;
    render(
      <div data-testid="box">
        <span>{criteria()}</span>
      </div>,
    );

    const definition: HTMLElement = await openDefinition();

    // Drawn in the box, as planted - and nothing named by its words is around it.
    expect(screen.getByTestId("box")).toContainElement(definition);
  });
});
