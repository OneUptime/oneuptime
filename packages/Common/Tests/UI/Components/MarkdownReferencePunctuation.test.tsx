/*
 * A CITATION CHIP OR A RECORD'S PILL KEEPS THE PUNCTUATION RIGHT AFTER IT
 * (#5715's follow-up).
 *
 * A chip ("[C7]") or a record's pill ("#305") is drawn as a box of its own,
 * and a browser may break the line right after such a box even where the
 * sentence goes on with a full stop: on a phone, an Impact line ending
 * "... not users [C7]." left its "." alone at the start of the next line.
 * The inline references' transform now puts a reference and the marks
 * written right after it - in any script - into one group, drawn as a span
 * that never wraps inside (MarkdownReferenceGroupElement).
 *
 * The transform runs on hand-built mdast (react-markdown is ESM and does not
 * run under Common's jest); the group's element is rendered for real. The
 * offline Event Overview suite checks the lines in a browser at 390 pixels,
 * in English, German and Persian.
 */
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import {
  CITATION_REFERENCE_NODE_TYPE,
  CITATION_REFERENCE_TAG_NAME,
  EVENT_REFERENCE_NODE_TYPE,
  EVENT_REFERENCE_TAG_NAME,
  InlineReferenceMarkdownNode,
  MARKDOWN_INLINE_REFERENCE_COMPONENTS,
  MAX_CITATIONS_KEPT_TOGETHER,
  MAX_PUNCTUATION_KEPT_WITH_REFERENCE,
  MarkdownReferenceGroupElement,
  REFERENCE_GROUP_NODE_TYPE,
  REFERENCE_GROUP_TAG_NAME,
  applyInlineReferences,
} from "../../../UI/Components/Markdown.tsx/InlineReferences";
import { fastestRun, FastestRun } from "../../Helpers/FastestRun";

type Node = InlineReferenceMarkdownNode;

function text(value: string): Node {
  return { type: "text", value: value };
}

function citation(citationId: string): Node {
  return {
    type: CITATION_REFERENCE_NODE_TYPE,
    data: {
      hName: CITATION_REFERENCE_TAG_NAME,
      hProperties: { dataCitationId: citationId },
    },
    children: [text(`[${citationId}]`)],
  };
}

function eventRef(
  kind: "incident" | "alert" | "",
  referenceNumber: number,
): Node {
  return {
    type: EVENT_REFERENCE_NODE_TYPE,
    data: {
      hName: EVENT_REFERENCE_TAG_NAME,
      hProperties: {
        dataRefKind: kind,
        dataRefNumber: referenceNumber.toString(),
      },
    },
    children: [text(`#${referenceNumber}`)],
  };
}

// A reference, or a run of citations, and the marks right after it.
function group(references: Node | Array<Node>, punctuation: string = ""): Node {
  return {
    type: REFERENCE_GROUP_NODE_TYPE,
    data: { hName: REFERENCE_GROUP_TAG_NAME },
    children: [
      ...(Array.isArray(references) ? references : [references]),
      ...(punctuation ? [text(punctuation)] : []),
    ],
  };
}

const BOTH: { citations: boolean; eventReferences: boolean } = {
  citations: true,
  eventReferences: true,
};

function transform(
  value: string,
  options: { citations: boolean; eventReferences: boolean } = BOTH,
): Array<Node> {
  const tree: Node = {
    type: "root",
    children: [{ type: "paragraph", children: [text(value)] }],
  };

  applyInlineReferences(tree, options);

  return tree.children?.[0]?.children || [];
}

// What a reader sees: every text node's value, in order.
function visibleText(nodes: Array<Node>): string {
  return nodes
    .map((node: Node): string => {
      if (node.type === "text") {
        return node.value || "";
      }

      return visibleText(node.children || []);
    })
    .join("");
}

function groups(nodes: Array<Node>): Array<Node> {
  return nodes.filter((node: Node): boolean => {
    return node.type === REFERENCE_GROUP_NODE_TYPE;
  });
}

describe("a reference keeps the punctuation written right after it", () => {
  test("a citation chip and the full stop that ends its sentence", () => {
    expect(transform("Failed requests, not users [C7].")).toEqual([
      text("Failed requests, not users "),
      group(citation("C7"), "."),
    ]);
  });

  test("a record's pill and the comma after it", () => {
    expect(transform("as incident #305, it recovered")).toEqual([
      text("as incident "),
      group(eventRef("incident", 305), ","),
      text(" it recovered"),
    ]);
  });

  /*
   * Every script's marks: the Latin ones, the Persian comma, semicolon,
   * question mark and full stop, Chinese and Japanese full-width marks,
   * Hindi's danda, closing brackets and quotes of every kind.
   */
  test.each([
    ["."],
    [","],
    [";"],
    [":"],
    ["!"],
    ["?"],
    [")"],
    ["]"],
    ["}"],
    ["\u{201D}"],
    ["\u{2019}"],
    ["\u{BB}"],
    ["\u{2026}"],
    ["\u{60C}"],
    ["\u{61B}"],
    ["\u{61F}"],
    ["\u{6D4}"],
    ["\u{3002}"],
    ["\u{3001}"],
    ["\u{FF0C}"],
    ["\u{FF09}"],
    ["\u{300D}"],
    ["\u{964}"],
  ])("keeps %p with the chip before it", (mark: string) => {
    expect(transform(`the pool ran dry [C3]${mark} then`)).toEqual([
      text("the pool ran dry "),
      group(citation("C3"), mark),
      text(" then"),
    ]);
  });

  test("a closing bracket and the full stop after it go together", () => {
    expect(transform("(see [C2]).")).toEqual([
      text("(see "),
      group(citation("C2"), ")."),
    ]);
  });

  test("a closing quote and a full stop, as German writes them", () => {
    expect(
      transform("Die Datenbank meldete \u{201E}voll\u{201C} [C4]\u{201C}."),
    ).toEqual([
      text("Die Datenbank meldete \u{201E}voll\u{201C} "),
      group(citation("C4"), "\u{201C}."),
    ]);
  });

  test("a Persian sentence keeps its full stop and its comma with the chip", () => {
    const children: Array<Node> = transform(
      "\u{62E}\u{637}\u{627} \u{628}\u{627}\u{644}\u{627} \u{631}\u{641}\u{62A} [C1]\u{60C} \u{633}\u{67E}\u{633} \u{628}\u{631}\u{6AF}\u{634}\u{62A} [C2].",
    );

    expect(groups(children)).toEqual([
      group(citation("C1"), "\u{60C}"),
      group(citation("C2"), "."),
    ]);
  });

  test("a Japanese sentence keeps its full-width full stop with the chip", () => {
    expect(
      transform("\u{30E1}\u{30E2}\u{30EA}\u{4E0D}\u{8DB3} [C9]\u{3002}"),
    ).toEqual([
      text("\u{30E1}\u{30E2}\u{30EA}\u{4E0D}\u{8DB3} "),
      group(citation("C9"), "\u{3002}"),
    ]);
  });

  test(`at most ${MAX_PUNCTUATION_KEPT_WITH_REFERENCE} marks stay with it; the rest wrap as text`, () => {
    expect(transform("so [C5]......")).toEqual([
      text("so "),
      group(citation("C5"), "...."),
      text(".."),
    ]);
  });

  test.each([
    ["a space", "dry [C6] .", [text("dry "), citation("C6"), text(" .")]],
    ["a letter", "dry [C6]x", [text("dry "), citation("C6"), text("x")]],
    ["a digit", "dry [C6]7", [text("dry "), citation("C6"), text("7")]],
    [
      "a symbol that is no punctuation",
      "dry [C6]+",
      [text("dry "), citation("C6"), text("+")],
    ],
    [
      "an emoji",
      "dry [C6]\u{1F642}",
      [text("dry "), citation("C6"), text("\u{1F642}")],
    ],
    ["nothing", "dry [C6]", [text("dry "), citation("C6")]],
  ])(
    "a reference followed by %s is left as it was",
    (_what: string, value: string, expected: Array<Node>) => {
      expect(transform(value)).toEqual(expected);
    },
  );

  test("marks after a run of citations stay with the whole run", () => {
    expect(transform("dry [C4][C5].")).toEqual([
      text("dry "),
      group([citation("C4"), citation("C5")], "."),
    ]);
  });

  test("marks never run into the next reference", () => {
    expect(transform("[C1].[C2]")).toEqual([
      group(citation("C1"), "."),
      citation("C2"),
    ]);
    expect(transform("incidents #1,#2.")).toEqual([
      text("incidents "),
      group(eventRef("incident", 1), ","),
      group(eventRef("incident", 2), "."),
    ]);
  });

  test("punctuation after plain text is never grouped", () => {
    const value: string = "Nothing cited here. Nothing numbered, either.";

    expect(transform(value)).toEqual([text(value)]);
  });

  test("with citations off, a citation is text and keeps nothing", () => {
    expect(
      transform("dry [C6].", { citations: false, eventReferences: true }),
    ).toEqual([text("dry [C6].")]);
  });

  test("nothing a reader sees is added, lost or reordered", () => {
    const value: string =
      "Users: 1,240 failed requests [C2]. Services: checkout (#305), cart [C3]; SLOs: 1 of 2 [C4]\u{2026} \u{628}\u{631}\u{6AF}\u{634}\u{62A} [C5]\u{60C}";

    expect(visibleText(transform(value))).toBe(value);
    // [C2] "." - #305 ")," - [C3] ";" - [C4] its ellipsis - [C5] its comma.
    expect(groups(transform(value))).toHaveLength(5);
  });

  test("a second pass changes nothing: a group is never split again", () => {
    const tree: Node = {
      type: "root",
      children: [
        { type: "paragraph", children: [text("dry [C6]. as #12, then")] },
      ],
    };

    applyInlineReferences(tree, BOTH);
    const once: string = JSON.stringify(tree);
    applyInlineReferences(tree, BOTH);

    expect(JSON.stringify(tree)).toBe(once);
  });

  /*
   * Model text reaches this transform, so it must take time in line with
   * the text: 400,000 characters of references each followed by its marks,
   * and of marks with no reference before them, within two seconds.
   */
  test.each([
    ["references and their marks", "[C1]....".repeat(50000)],
    ["marks alone", ".".repeat(400000)],
    ["a reference before a sea of marks", `[C1]${"\u{3002}".repeat(400000)}`],
  ])("%s: linear in the text", (_what: string, value: string) => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return transform(value).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBeGreaterThan(0);
  });
});

/*
 * A browser breaks a line between two chips as readily as after one: a
 * report's "requests queued for a connection [C2][C3][C6]." read "C2" at
 * the end of a line and "C3 C6." at the start of the next, at 1280 pixels
 * and on phones alike. Citations written one right after another stay on
 * one line together, with the marks after the last.
 */
describe("citations written one right after another stay together", () => {
  test("a run of three and the full stop after it are one group", () => {
    expect(
      transform("so requests queued for a connection [C2][C3][C6]. Then"),
    ).toEqual([
      text("so requests queued for a connection "),
      group([citation("C2"), citation("C3"), citation("C6")], "."),
      text(" Then"),
    ]);
  });

  test("a run with no mark after it is a group too", () => {
    expect(transform("checked [C6][C9] and moved on")).toEqual([
      text("checked "),
      group([citation("C6"), citation("C9")]),
      text(" and moved on"),
    ]);
  });

  test("a run at the very start of the text, closing it", () => {
    expect(transform("[C1][C2]")).toEqual([
      group([citation("C1"), citation("C2")]),
    ]);
  });

  test.each([
    [
      "a space",
      "dry [C1] [C2].",
      [text("dry "), citation("C1"), text(" "), group(citation("C2"), ".")],
    ],
    [
      "a mark",
      "dry [C1],[C2].",
      [text("dry "), group(citation("C1"), ","), group(citation("C2"), ".")],
    ],
    [
      "a word",
      "dry [C1]and[C2]",
      [text("dry "), citation("C1"), text("and"), citation("C2")],
    ],
  ])(
    "%s between two citations ends the run",
    (_what: string, value: string, expected: Array<Node>) => {
      expect(transform(value)).toEqual(expected);
    },
  );

  test(`a longer run is kept together ${MAX_CITATIONS_KEPT_TOGETHER} at a time, the marks with the last`, () => {
    const ids: Array<string> = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"];
    const children: Array<Node> = transform(
      `see ${ids
        .map((id: string): string => {
          return `[${id}]`;
        })
        .join("")}.`,
    );

    expect(MAX_CITATIONS_KEPT_TOGETHER).toBe(5);
    expect(children).toEqual([
      text("see "),
      group(ids.slice(0, MAX_CITATIONS_KEPT_TOGETHER).map(citation)),
      group(ids.slice(MAX_CITATIONS_KEPT_TOGETHER).map(citation), "."),
    ]);
  });

  test("a record's pill never joins a run: each keeps its own marks", () => {
    expect(transform("as incident #12[C1].")).toEqual([
      text("as incident "),
      eventRef("incident", 12),
      group(citation("C1"), "."),
    ]);
    expect(transform("dry [C1]#12.")).toEqual([
      text("dry "),
      citation("C1"),
      group(eventRef("", 12), "."),
    ]);
  });

  test("with citations off, a run is text", () => {
    expect(
      transform("dry [C1][C2].", { citations: false, eventReferences: true }),
    ).toEqual([text("dry [C1][C2].")]);
  });

  test("nothing a reader sees is added, lost or reordered", () => {
    const value: string =
      "Pool [C2][C3][C6]. Cache [C1][C4], disk [C5][C7][C8][C9][C10][C11]\u{3002} done [C12][C13]";

    expect(visibleText(transform(value))).toBe(value);
  });

  test("a second pass changes nothing: a run is never split again", () => {
    const tree: Node = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [text("dry [C1][C2][C3]. then [C4][C5]")],
        },
      ],
    };

    applyInlineReferences(tree, BOTH);
    const once: string = JSON.stringify(tree);
    applyInlineReferences(tree, BOTH);

    expect(JSON.stringify(tree)).toBe(once);
  });

  // Model text: a run as long as the text takes time in line with it.
  test("400,000 characters of one run of citations: linear in the text", () => {
    const value: string = `${"[C1]".repeat(100000)}.`;
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return transform(value).length;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result).toBe(100000 / MAX_CITATIONS_KEPT_TOGETHER);
  });
});

describe("the group's element", () => {
  test("is registered for its tag, beside the two references", () => {
    expect(MARKDOWN_INLINE_REFERENCE_COMPONENTS[REFERENCE_GROUP_TAG_NAME]).toBe(
      MarkdownReferenceGroupElement,
    );
  });

  test("draws the chip and its full stop in one span that never wraps", () => {
    render(
      <p>
        Failed requests, not users{" "}
        <MarkdownReferenceGroupElement>
          <button type="button">C7</button>.
        </MarkdownReferenceGroupElement>
      </p>,
    );

    const span: HTMLElement = screen.getByTestId("markdown-reference-group");

    expect(span.tagName).toBe("SPAN");
    expect(span).toHaveClass("whitespace-nowrap");
    expect(span.textContent).toBe("C7.");
    expect(span.querySelector("button")).toHaveTextContent("C7");

    cleanup();
  });

  test("draws a run of chips and their full stop in one span that never wraps", () => {
    render(
      <p>
        requests queued for a connection{" "}
        <MarkdownReferenceGroupElement>
          <button type="button">C2</button>
          <button type="button">C3</button>
          <button type="button">C6</button>.
        </MarkdownReferenceGroupElement>
      </p>,
    );

    const span: HTMLElement = screen.getByTestId("markdown-reference-group");

    expect(span).toHaveClass("whitespace-nowrap");
    expect(span.textContent).toBe("C2C3C6.");
    expect(
      Array.from(span.querySelectorAll("button")).map(
        (button: HTMLButtonElement): string => {
          return button.textContent || "";
        },
      ),
    ).toEqual(["C2", "C3", "C6"]);

    cleanup();
  });
});
