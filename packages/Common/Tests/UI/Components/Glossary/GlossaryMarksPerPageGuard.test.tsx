// UX rule: Docs/ux/README.md#names
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import GlossaryTerm from "../../../../Types/Docs/GlossaryTerm";
import Card from "../../../../UI/Components/Card/Card";
import FieldLabelElement from "../../../../UI/Components/Forms/Fields/FieldLabel";
import DefinedTerm, {
  DEFINED_TERM_TEST_ID,
  PLAIN_GLOSSARY_TERM_ATTRIBUTE,
} from "../../../../UI/Components/Glossary/DefinedTerm";
import {
  GlossaryMarks,
  GlossaryMarksContext,
  MAX_MARKED_TERMS_PER_PAGE,
  pickMarkedWords,
} from "../../../../UI/Components/Glossary/GlossaryMarks";
import Modal from "../../../../UI/Components/Modal/Modal";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";

/*
 * A RENDERED PAGE NEVER MARKS A WORD TWICE, NOR MORE THAN THREE WORDS,
 * WHATEVER COMPONENTS IT HOLDS (#7020).
 *
 * The Dashboard's GlossaryTermsPerPage guard reads a file and the
 * components it imports. A page put together from components that each
 * mark a word on their own - a card's title, a field's title, a line of
 * help - could mark the same word twice, or four words between them, and
 * pass it. So the page counts the words it draws (GlossaryMarks): the first
 * word of each term, in the order the page shows them, is marked, three
 * terms at most, and the rest are drawn as plain words. A dialog is a page
 * of its own.
 *
 * The check below reads a rendered page the way a person sees it: the
 * marked words (DefinedTerm's buttons) outside any dialog, and each
 * dialog's on their own. A page planted with what the rule forbids fails
 * it when nothing counts its words, and passes once they are counted.
 */

afterEach(() => {
  cleanup();
});

/*
 * A rendered page's marked words, by their term, in the order it shows them:
 * the word's button, whatever test id its place gave it.
 */
const markedTermsIn: (root: Element) => Array<string> = (
  root: Element,
): Array<string> => {
  return Array.from(
    root.querySelectorAll<HTMLElement>("button[data-glossary-term]"),
  )
    .filter((mark: HTMLElement): boolean => {
      // A dialog's words are its own page's: read with the dialog.
      return (
        root.matches("[role='dialog']") || !mark.closest("[role='dialog']")
      );
    })
    .map((mark: HTMLElement): string => {
      return mark.getAttribute("data-glossary-term") || "";
    });
};

// What a rendered page does against the rule: none, when it keeps it.
const glossaryMarkProblems: (root: Element) => Array<string> = (
  root: Element,
): Array<string> => {
  const problems: Array<string> = [];
  const pages: Array<Element> = [
    root,
    ...Array.from(root.querySelectorAll("[role='dialog']")),
  ];

  for (const page of pages) {
    const terms: Array<string> = markedTermsIn(page);
    const seen: Set<string> = new Set<string>();
    const name: string = page === root ? "the page" : "a dialog";

    for (const term of terms) {
      if (seen.has(term)) {
        problems.push(`${name} marks "${term}" twice`);
      }
      seen.add(term);
    }

    if (seen.size > MAX_MARKED_TERMS_PER_PAGE) {
      problems.push(
        `${name} marks ${seen.size} terms: ${Array.from(seen).join(", ")}`,
      );
    }
  }

  return problems;
};

// The words a page draws as plain words, by their term, in order.
const plainTermsIn: (root: Element) => Array<string> = (
  root: Element,
): Array<string> => {
  return Array.from(
    root.querySelectorAll(`[${PLAIN_GLOSSARY_TERM_ATTRIBUTE}]`),
  ).map((place: Element): string => {
    return place.getAttribute(PLAIN_GLOSSARY_TERM_ATTRIBUTE) || "";
  });
};

/*
 * A page as the Dashboard puts one together: a card that marks its title,
 * a field in it that marks the same word again, a line of help with a
 * word, and a note that marks two more - five marks of four terms.
 */
const PlantedPage: () => ReactElement = (): ReactElement => {
  return (
    <div data-testid="page">
      <Card title="Probes" titleGlossaryTerm={GlossaryTerm.Probe}>
        <div>
          <FieldLabelElement
            title="Probes"
            htmlFor="probes-input"
            glossaryTerm={GlossaryTerm.Probe}
          />
          <input id="probes-input" />
          <p>
            Each{" "}
            <DefinedTerm term={GlossaryTerm.Criteria}>criteria</DefinedTerm>{" "}
            is checked in order.
          </p>
          <p data-testid="note">
            Declare an{" "}
            <DefinedTerm term={GlossaryTerm.Incident}>incident</DefinedTerm>, or
            create an <DefinedTerm term={GlossaryTerm.Alert}>alert</DefinedTerm>
            .
          </p>
        </div>
      </Card>
    </div>
  );
};

describe("which words a page marks", () => {
  test("the first word of each term, in the order the page shows them, three terms at most", () => {
    expect(
      pickMarkedWords([
        GlossaryTerm.Probe,
        GlossaryTerm.Probe,
        GlossaryTerm.Criteria,
        GlossaryTerm.Incident,
        GlossaryTerm.Criteria,
        GlossaryTerm.Alert,
        GlossaryTerm.Probe,
      ]),
    ).toEqual([true, false, true, true, false, false, false]);

    expect(pickMarkedWords([])).toEqual([]);
    expect(MAX_MARKED_TERMS_PER_PAGE).toBe(3);
  });

  test("for any page, whatever its words: each term marked once, at its first word, three at most", () => {
    const random: SeededRandom = seededRandom(7020);
    const pool: Array<GlossaryTerm> = [
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
      GlossaryTerm.Alert,
      GlossaryTerm.Owner,
      GlossaryTerm.Team,
    ];

    for (let page: number = 0; page < 500; page++) {
      const words: Array<GlossaryTerm> = Array.from(
        { length: random(12) },
        (): GlossaryTerm => {
          return pool[random(pool.length)]!;
        },
      );
      const picks: Array<boolean> = pickMarkedWords(words);
      const marked: Array<GlossaryTerm> = words.filter(
        (_word: GlossaryTerm, index: number): boolean => {
          return picks[index]!;
        },
      );
      const distinctInOrder: Array<GlossaryTerm> = Array.from(new Set(words));

      // Once each, at most three: the first three terms the page uses.
      expect(new Set(marked).size).toBe(marked.length);
      expect(marked).toEqual(
        distinctInOrder.slice(0, MAX_MARKED_TERMS_PER_PAGE),
      );

      // Each at its first word.
      words.forEach((word: GlossaryTerm, index: number): void => {
        if (picks[index]) {
          expect(words.indexOf(word)).toBe(index);
        }
      });
    }
  });
});

describe("a page planted with what the rule forbids", () => {
  test("with nothing counting its words, the check finds a word marked twice and four terms", () => {
    render(
      <GlossaryMarksContext.Provider value={null}>
        <PlantedPage />
      </GlossaryMarksContext.Provider>,
    );

    const page: HTMLElement = screen.getByTestId("page");

    expect(markedTermsIn(page)).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
      GlossaryTerm.Alert,
    ]);
    expect(glossaryMarkProblems(page)).toEqual([
      'the page marks "probe" twice',
      "the page marks 4 terms: probe, criteria, incident, alert",
    ]);
  });

  test("counted as it draws them, it marks each word once and three at most: the rest are plain words", async () => {
    render(<PlantedPage />);

    const page: HTMLElement = screen.getByTestId("page");

    expect(markedTermsIn(page)).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
    ]);
    expect(glossaryMarkProblems(page)).toEqual([]);
    // The field's second "Probes", and the fourth term, read as words.
    expect(plainTermsIn(page)).toEqual([GlossaryTerm.Probe, GlossaryTerm.Alert]);
    expect(screen.getByTestId("note")).toHaveTextContent(
      "Declare an incident, or create an alert.",
    );

    // The card title's word is the one marked: the first the page shows.
    expect(
      screen
        .getByTestId("card-details-heading")
        .querySelector(`[data-testid="${DEFINED_TERM_TEST_ID}"]`),
    ).toHaveAttribute("data-glossary-term", GlossaryTerm.Probe);

    // So it stays once the card title's word has its file (LazyDefinedTerm).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Probes" }),
      ).toHaveAttribute("aria-expanded");
    });
    expect(markedTermsIn(page)).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
    ]);
  });
});

describe("the page's order, whatever order its words are drawn in", () => {
  /*
   * Components draw in an order of their own; what counts is the order the
   * page shows them in. Words of random terms, drawn in a seeded order into
   * their places, are marked as pickMarkedWords reads the page.
   */
  test("seeded pages: the first word of each term the page shows is marked, three at most", () => {
    const random: SeededRandom = seededRandom(9133);
    const pool: Array<GlossaryTerm> = [
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Span,
      GlossaryTerm.Owner,
      GlossaryTerm.Label,
    ];

    for (let attempt: number = 0; attempt < 25; attempt++) {
      const words: Array<GlossaryTerm> = Array.from(
        { length: 1 + random(8) },
        (): GlossaryTerm => {
          return pool[random(pool.length)]!;
        },
      );
      const slots: Array<number> = words.map(
        (_word: GlossaryTerm, index: number): number => {
          return index;
        },
      );
      // The order the words are drawn in: not the page's.
      const drawOrder: Array<number> = shuffled(slots, random);
      const shown: Array<number> = [];

      const { rerender, unmount } = render(<div data-testid="page" />);

      for (const slot of drawOrder) {
        shown.push(slot);
        rerender(
          <div data-testid="page">
            {slots.map((index: number): ReactElement => {
              return shown.includes(index) ? (
                <span key={index} data-slot={index}>
                  <DefinedTerm term={words[index]!}>word {index}</DefinedTerm>
                </span>
              ) : (
                <span key={index} data-slot={index} />
              );
            })}
          </div>,
        );
      }

      const picks: Array<boolean> = pickMarkedWords(words);

      expect({
        words: words,
        drawOrder: drawOrder,
        marked: markedTermsIn(screen.getByTestId("page")),
      }).toEqual({
        words: words,
        drawOrder: drawOrder,
        marked: words.filter((_word: GlossaryTerm, index: number): boolean => {
          return picks[index]!;
        }),
      });
      expect(glossaryMarkProblems(screen.getByTestId("page"))).toEqual([]);

      unmount();
    }
  });

  test("a word drawn above the marked one takes its mark", () => {
    const { rerender } = render(
      <div data-testid="page">
        <span data-testid="above" />
        <span data-testid="below">
          <DefinedTerm term={GlossaryTerm.Probe}>probe</DefinedTerm>
        </span>
      </div>,
    );

    expect(markedTermsIn(screen.getByTestId("below"))).toEqual([
      GlossaryTerm.Probe,
    ]);

    rerender(
      <div data-testid="page">
        <span data-testid="above">
          <DefinedTerm term={GlossaryTerm.Probe}>probe</DefinedTerm>
        </span>
        <span data-testid="below">
          <DefinedTerm term={GlossaryTerm.Probe}>probe</DefinedTerm>
        </span>
      </div>,
    );

    expect(markedTermsIn(screen.getByTestId("above"))).toEqual([
      GlossaryTerm.Probe,
    ]);
    expect(markedTermsIn(screen.getByTestId("below"))).toEqual([]);
    expect(plainTermsIn(screen.getByTestId("below"))).toEqual([
      GlossaryTerm.Probe,
    ]);
    expect(markedTermsIn(screen.getByTestId("page"))).toEqual([
      GlossaryTerm.Probe,
    ]);
  });
});

describe("a word that goes hands its mark on", () => {
  test("to the next word of its term, and to the next term waiting", () => {
    const { rerender } = render(<PlantedPage />);

    expect(markedTermsIn(screen.getByTestId("page"))).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
    ]);

    // The card's title goes plain (no term), and its criteria line goes.
    rerender(
      <div data-testid="page">
        <Card title="Probes">
          <div>
            <FieldLabelElement
              title="Probes"
              htmlFor="probes-input"
              glossaryTerm={GlossaryTerm.Probe}
            />
            <input id="probes-input" />
            <p data-testid="note">
              Declare an{" "}
              <DefinedTerm term={GlossaryTerm.Incident}>incident</DefinedTerm>,
              or create an{" "}
              <DefinedTerm term={GlossaryTerm.Alert}>alert</DefinedTerm>.
            </p>
          </div>
        </Card>
      </div>,
    );

    // The field's "Probes" is the first now, and "alert" is the third term.
    expect(markedTermsIn(screen.getByTestId("page"))).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Incident,
      GlossaryTerm.Alert,
    ]);
    expect(plainTermsIn(screen.getByTestId("page"))).toEqual([]);
  });
});

describe("a dialog is a page of its own", () => {
  test("its words are marked whatever the page behind it marks", () => {
    render(
      <>
        <PlantedPage />
        <Modal title="Add Probe" onClose={() => {}} onSubmit={() => {}}>
          <div data-testid="dialog-words">
            <FieldLabelElement
              title="Probe"
              htmlFor="probe-input"
              glossaryTerm={GlossaryTerm.Probe}
            />
            <input id="probe-input" />
            <p>
              An <DefinedTerm term={GlossaryTerm.Owner}>owner</DefinedTerm> is
              told.
            </p>
          </div>
        </Modal>
      </>,
    );

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(markedTermsIn(screen.getByTestId("page"))).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Criteria,
      GlossaryTerm.Incident,
    ]);
    // "Probe" again, and a fourth term: the dialog's first two words.
    expect(markedTermsIn(dialog)).toEqual([
      GlossaryTerm.Probe,
      GlossaryTerm.Owner,
    ]);
    expect(glossaryMarkProblems(document.body)).toEqual([]);
  });

  test("its count is its own: GlossaryMarks counts only the words drawn under it", () => {
    const marks: GlossaryMarks = new GlossaryMarks();

    render(
      <>
        <PlantedPage />
        <GlossaryMarksContext.Provider value={marks}>
          <DefinedTerm term={GlossaryTerm.Probe}>probe</DefinedTerm>
        </GlossaryMarksContext.Provider>
      </>,
    );

    expect(marks.size).toBe(1);
  });
});
