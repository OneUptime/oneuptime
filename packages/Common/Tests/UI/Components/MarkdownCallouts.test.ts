import { describe, expect, test } from "@jest/globals";
import {
  CalloutMarkdownNode,
  MARKDOWN_CALLOUT_ATTRIBUTE,
  MARKDOWN_CALLOUT_KINDS,
  MARKDOWN_CALLOUT_PROPERTY,
  MarkdownCalloutKind,
  applyMarkdownCallouts,
  getMarkdownCalloutKind,
  getMarkdownCalloutKindOfLabel,
  markMarkdownCallout,
  remarkMarkdownCallouts,
} from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";
import {
  DOCS_CALLOUT_ICONS,
  DOCS_CALLOUT_TYPES,
} from "../../../Server/Types/MarkdownDocsExtensions";
import { MARKDOWN_CALLOUT_STYLES } from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * Which blockquotes are callouts (MarkdownCallouts).
 *
 * A customer's feedback: quoted text in a feed showed an amber exclamation
 * mark, as if somebody's words were a warning. A blockquote is now a quote,
 * unless it asks to be a callout - GitHub's "> [!WARNING]", or the older
 * "> **Note:**" the docs read too - and only then does the transform mark
 * it (data-callout), for the viewer's blockquote renderer to read.
 *
 * remark does not run under Common's jest, so these are the trees remark
 * builds, written out (HugeTextInLongRunningProcess runs the real parser,
 * and the Diagrams fixture's browser tests the drawn page).
 */

const text: (value: string) => CalloutMarkdownNode = (
  value: string,
): CalloutMarkdownNode => {
  return { type: "text", value: value };
};

const strong: (
  ...children: Array<CalloutMarkdownNode>
) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "strong", children: children };
};

const emphasis: (
  ...children: Array<CalloutMarkdownNode>
) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "emphasis", children: children };
};

const paragraph: (
  ...children: Array<CalloutMarkdownNode>
) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "paragraph", children: children };
};

const blockquote: (
  ...children: Array<CalloutMarkdownNode>
) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "blockquote", children: children };
};

const list: (...items: Array<CalloutMarkdownNode>) => CalloutMarkdownNode = (
  ...items: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "list", ordered: false, children: items };
};

const listItem: (
  ...children: Array<CalloutMarkdownNode>
) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "listItem", children: children };
};

const root: (...children: Array<CalloutMarkdownNode>) => CalloutMarkdownNode = (
  ...children: Array<CalloutMarkdownNode>
): CalloutMarkdownNode => {
  return { type: "root", children: children };
};

const LINE_BREAK: CalloutMarkdownNode = { type: "break" };

const calloutOf: (node: CalloutMarkdownNode) => unknown = (
  node: CalloutMarkdownNode,
): unknown => {
  return node.data?.hProperties?.[MARKDOWN_CALLOUT_PROPERTY];
};

// What a blockquote reads as once the transform has run on a tree holding it.
const transformed: (quote: CalloutMarkdownNode) => CalloutMarkdownNode = (
  quote: CalloutMarkdownNode,
): CalloutMarkdownNode => {
  applyMarkdownCallouts(root(quote));
  return quote;
};

describe("a blockquote is a quote", () => {
  test("somebody's words: no mark, nothing changed", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("They said something")),
    );

    expect(transformed(quote)).toEqual(
      blockquote(paragraph(text("They said something"))),
    );
    expect(calloutOf(quote)).toBeUndefined();
  });

  test("a quoted chat message, as ChatMessageMarkdown writes one", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("Restarting the "), strong(text("primary")), text(" now")),
    );

    expect(calloutOf(transformed(quote))).toBeUndefined();
  });

  test("a bold lead that is not a kind's label", () => {
    for (const label of [
      "Update:",
      "Root cause:",
      "This token is a secret.",
      "Note for native installs:",
      "Notes:",
      "Warnings",
      "Note: read this",
      "",
    ]) {
      const quote: CalloutMarkdownNode = blockquote(
        paragraph(strong(text(label)), text(" the rest")),
      );

      expect(calloutOf(transformed(quote))).toBeUndefined();
    }
  });

  test("a label in italics, or bold that holds more than the label", () => {
    expect(
      calloutOf(
        transformed(blockquote(paragraph(emphasis(text("Note:")), text(" x")))),
      ),
    ).toBeUndefined();
    expect(
      calloutOf(
        transformed(
          blockquote(
            paragraph(strong(text("Note:"), emphasis(text("!"))), text(" x")),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  test("a label later in the quote, not opening it", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("As the docs say, "), strong(text("Note:")), text(" x")),
    );

    expect(calloutOf(transformed(quote))).toBeUndefined();
  });

  test("a quote that opens with a list or a code block", () => {
    for (const first of [
      list(listItem(paragraph(text("[!WARNING] x")))),
      { type: "code", value: "[!WARNING]" },
    ]) {
      const quote: CalloutMarkdownNode = blockquote(first);

      expect(calloutOf(transformed(quote))).toBeUndefined();
    }
  });

  test("an empty quote", () => {
    expect(calloutOf(transformed(blockquote()))).toBeUndefined();
    expect(calloutOf(transformed(blockquote(paragraph())))).toBeUndefined();
  });
});

describe("> [!KIND] makes it a callout", () => {
  test.each(
    MARKDOWN_CALLOUT_KINDS.map((kind: string) => {
      return [kind];
    }),
  )("%s, alone on the first line, is taken out of the text", (kind: string) => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(
        text(`[!${kind.toUpperCase()}]\n`),
        strong(text("This token is a secret.")),
        text(" Keep it safe."),
      ),
    );

    transformed(quote);

    expect(calloutOf(quote)).toBe(kind);
    expect(quote.children).toEqual([
      paragraph(
        strong(text("This token is a secret.")),
        text(" Keep it safe."),
      ),
    ]);
  });

  test("in any case", () => {
    for (const marker of [
      "[!warning]",
      "[!Warning]",
      "[!WARNING]",
      "[!wArNiNg]",
    ]) {
      const quote: CalloutMarkdownNode = blockquote(
        paragraph(text(`${marker}\nCareful`)),
      );

      expect(calloutOf(transformed(quote))).toBe("warning");
      expect(quote.children).toEqual([paragraph(text("Careful"))]);
    }
  });

  test("followed by its text on the same line", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!TIP] Hash keeps values comparable")),
    );

    expect(calloutOf(transformed(quote))).toBe("tip");
    expect(quote.children).toEqual([
      paragraph(text("Hash keeps values comparable")),
    ]);
  });

  test("followed by a hard line break", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!NOTE]"), LINE_BREAK, text("Read this first")),
    );

    expect(calloutOf(transformed(quote))).toBe("note");
    expect(quote.children).toEqual([paragraph(text("Read this first"))]);
  });

  test("on a paragraph of its own: the paragraph goes, the rest stays", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!IMPORTANT]")),
      paragraph(text("First paragraph")),
      list(listItem(paragraph(text("a step")))),
    );

    expect(calloutOf(transformed(quote))).toBe("important");
    expect(quote.children).toEqual([
      paragraph(text("First paragraph")),
      list(listItem(paragraph(text("a step")))),
    ]);
  });

  test("before inline formatting on the next line", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!CAUTION]\n"), emphasis(text("slowly")), text(" now")),
    );

    expect(calloutOf(transformed(quote))).toBe("caution");
    expect(quote.children).toEqual([
      paragraph(emphasis(text("slowly")), text(" now")),
    ]);
  });

  test("a marker that names no kind stays as written", () => {
    for (const marker of [
      "[!ALERT]",
      "[!NOTES]",
      "[!]",
      "[!NOTE ]",
      "[ !NOTE]",
      "[NOTE]",
    ]) {
      const quote: CalloutMarkdownNode = blockquote(
        paragraph(text(`${marker}\nCareful`)),
      );

      expect(calloutOf(transformed(quote))).toBeUndefined();
      expect(quote.children).toEqual([paragraph(text(`${marker}\nCareful`))]);
    }
  });

  test("a marker that runs into the next word stays as written", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!NOTE]worthy")),
    );

    expect(calloutOf(transformed(quote))).toBeUndefined();
    expect(quote.children).toEqual([paragraph(text("[!NOTE]worthy"))]);
  });

  test("a marker that is all the quote holds stays as written", () => {
    for (const quote of [
      blockquote(paragraph(text("[!WARNING]"))),
      blockquote(paragraph(text("[!WARNING]  "))),
      blockquote(paragraph(text("[!WARNING]"), LINE_BREAK)),
    ]) {
      const before: string = JSON.stringify(quote);

      expect(calloutOf(transformed(quote))).toBeUndefined();
      expect(JSON.stringify(quote)).toBe(before);
    }
  });

  test("a marker after the start of the quote is text", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("See [!WARNING] below")),
    );

    expect(calloutOf(transformed(quote))).toBeUndefined();
  });

  test("a marker in a later paragraph is text", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("Context")),
      paragraph(text("[!WARNING]\nCareful")),
    );

    expect(calloutOf(transformed(quote))).toBeUndefined();
  });

  test("the marker wins over a bold label after it", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!DANGER]\n"), strong(text("Note:")), text(" x")),
    );

    expect(calloutOf(transformed(quote))).toBe("danger");
    expect(quote.children).toEqual([
      paragraph(strong(text("Note:")), text(" x")),
    ]);
  });
});

describe("> **Label:** makes it a callout, the label kept", () => {
  test.each([
    ["Note:", "note"],
    ["Note", "note"],
    ["note:", "note"],
    ["NOTE:", "note"],
    ["Tip:", "tip"],
    ["Info:", "info"],
    ["Important:", "important"],
    ["Warning:", "warning"],
    ["Warning", "warning"],
    ["Caution:", "caution"],
    ["Danger:", "danger"],
  ])("**%s**", (label: string, kind: string) => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(strong(text(label)), text(" The service runs as LocalSystem.")),
    );

    transformed(quote);

    expect(calloutOf(quote)).toBe(kind);
    // The label is the author's text, and stays where it was written.
    expect(quote.children).toEqual([
      paragraph(strong(text(label)), text(" The service runs as LocalSystem.")),
    ]);
  });

  test("with the colon after the bold", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(strong(text("Tip")), text(": use Hash")),
    );

    expect(calloutOf(transformed(quote))).toBe("tip");
  });

  test("alone in the quote", () => {
    expect(
      calloutOf(transformed(blockquote(paragraph(strong(text("Warning")))))),
    ).toBe("warning");
  });

  test("getMarkdownCalloutKindOfLabel reads a label as the transform does", () => {
    expect(getMarkdownCalloutKindOfLabel("Note:")).toBe("note");
    expect(getMarkdownCalloutKindOfLabel("danger")).toBe("danger");
    expect(getMarkdownCalloutKindOfLabel("Note: ")).toBeNull();
    expect(getMarkdownCalloutKindOfLabel(" Note:")).toBeNull();
    expect(getMarkdownCalloutKindOfLabel("Note::")).toBeNull();
    expect(getMarkdownCalloutKindOfLabel("Update:")).toBeNull();
    expect(getMarkdownCalloutKindOfLabel("")).toBeNull();
  });
});

describe("where blockquotes are", () => {
  test("every blockquote of a document is read, wherever it is", () => {
    const top: CalloutMarkdownNode = blockquote(paragraph(text("[!NOTE]\na")));
    const inList: CalloutMarkdownNode = blockquote(
      paragraph(text("[!WARNING]\nb")),
    );
    const plain: CalloutMarkdownNode = blockquote(paragraph(text("c")));
    const inFootnote: CalloutMarkdownNode = blockquote(
      paragraph(strong(text("Tip:")), text(" d")),
    );

    applyMarkdownCallouts(
      root(top, list(listItem(paragraph(text("item")), inList)), plain, {
        type: "footnoteDefinition",
        identifier: "1",
        children: [inFootnote],
      }),
    );

    expect([top, inList, plain, inFootnote].map(calloutOf)).toEqual([
      "note",
      "warning",
      undefined,
      "tip",
    ]);
  });

  test("a quote inside a callout is a quote; a callout inside a quote is a callout", () => {
    const innerQuote: CalloutMarkdownNode = blockquote(
      paragraph(text("what the vendor said")),
    );
    const callout: CalloutMarkdownNode = blockquote(
      paragraph(text("[!WARNING]\nThe vendor wrote:")),
      innerQuote,
    );
    const innerCallout: CalloutMarkdownNode = blockquote(
      paragraph(text("[!TIP]\nquoted tip")),
    );
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("Earlier:")),
      innerCallout,
    );

    applyMarkdownCallouts(root(callout, quote));

    expect(calloutOf(callout)).toBe("warning");
    expect(calloutOf(innerQuote)).toBeUndefined();
    expect(calloutOf(quote)).toBeUndefined();
    expect(calloutOf(innerCallout)).toBe("tip");
  });

  test("text in paragraphs, headings and tables is never read for quotes", () => {
    const tree: CalloutMarkdownNode = root(
      paragraph(text("[!WARNING]\nnot a quote")),
      { type: "heading", depth: 2, children: [text("[!NOTE]\nheading")] },
    );
    const before: string = JSON.stringify(tree);

    applyMarkdownCallouts(tree);

    expect(JSON.stringify(tree)).toBe(before);
  });

  test("keeps what other plugins put on the blockquote", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!NOTE]\nx")),
    );
    quote.data = { hName: "blockquote", hProperties: { id: "kept" } };

    transformed(quote);

    expect(quote.data).toEqual({
      hName: "blockquote",
      hProperties: { id: "kept", [MARKDOWN_CALLOUT_PROPERTY]: "note" },
    });
  });

  test("running it again changes nothing more", () => {
    const tree: CalloutMarkdownNode = root(
      blockquote(paragraph(text("[!WARNING]\n[!NOTE] careful"))),
      blockquote(paragraph(strong(text("Note:")), text(" x"))),
      blockquote(paragraph(text("quote"))),
    );

    applyMarkdownCallouts(tree);
    const once: string = JSON.stringify(tree);
    applyMarkdownCallouts(tree);

    expect(JSON.stringify(tree)).toBe(once);
    // The second marker is the callout's text now, as written.
    expect(tree.children![0]!.children).toEqual([
      paragraph(text("[!NOTE] careful")),
    ]);
  });

  test("markMarkdownCallout says what it found", () => {
    expect(markMarkdownCallout(blockquote(paragraph(text("[!TIP] x"))))).toBe(
      "tip",
    );
    expect(markMarkdownCallout(blockquote(paragraph(text("x"))))).toBeNull();
  });

  test("a tree that is not one is left alone", () => {
    expect(() => {
      applyMarkdownCallouts(null as unknown as CalloutMarkdownNode);
      applyMarkdownCallouts(undefined as unknown as CalloutMarkdownNode);
      applyMarkdownCallouts({ type: "root" });
      applyMarkdownCallouts({ type: "root", children: [] });
    }).not.toThrow();
  });

  test("the remark plugin runs the transform", () => {
    const quote: CalloutMarkdownNode = blockquote(
      paragraph(text("[!WARNING]\nx")),
    );

    remarkMarkdownCallouts()(root(quote));

    expect(calloutOf(quote)).toBe("warning");
  });
});

describe("in time that grows with the tree", () => {
  test("ten thousand quotes nested in each other, with no recursion to run out of stack", () => {
    const outermost: CalloutMarkdownNode = blockquote(
      paragraph(text("[!NOTE]\nouter")),
    );
    let current: CalloutMarkdownNode = outermost;

    for (let depth: number = 0; depth < 10000; depth++) {
      const inner: CalloutMarkdownNode = blockquote(
        paragraph(text(depth % 2 === 0 ? "plain" : "[!TIP]\ntip")),
      );
      current.children!.push(inner);
      current = inner;
    }

    expect(() => {
      applyMarkdownCallouts(root(outermost));
    }).not.toThrow();
    expect(calloutOf(outermost)).toBe("note");
    expect(calloutOf(current)).toBe("tip");
  });

  test("two hundred thousand quotes in under two seconds", () => {
    const quotes: Array<CalloutMarkdownNode> = [];

    for (let index: number = 0; index < 200000; index++) {
      quotes.push(
        index % 3 === 0
          ? blockquote(paragraph(text("[!WARNING]\nx")))
          : index % 3 === 1
            ? blockquote(paragraph(strong(text("Note:")), text(" y")))
            : blockquote(paragraph(text("z"))),
      );
    }

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        applyMarkdownCallouts({ type: "root", children: quotes });
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(calloutOf(quotes[0]!)).toBe("warning");
    expect(calloutOf(quotes[1]!)).toBe("note");
    expect(calloutOf(quotes[2]!)).toBeUndefined();
  });

  test("the worst first lines a quote can have, 400,000 characters each, in under two seconds", () => {
    const worstTexts: Array<string> = [
      `[!${"W".repeat(400000)}`,
      `[!WARNING]${" ".repeat(400000)}x`,
      `[!WARNING]${"\n".repeat(400000)}`,
      `${"[!".repeat(200000)}`,
      `[!NOTE${"]".repeat(400000)}`,
    ];

    for (const value of worstTexts) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          applyMarkdownCallouts(root(blockquote(paragraph(text(value)))));
          applyMarkdownCallouts(
            root(blockquote(paragraph(strong(text(value)), text(" x")))),
          );
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    }
  });
});

describe("the kinds", () => {
  test("are the docs' kinds, in the docs' order", () => {
    expect([...MARKDOWN_CALLOUT_KINDS]).toEqual([...DOCS_CALLOUT_TYPES]);
  });

  test("each is drawn with the icon the docs draw it with", () => {
    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      const docsIcon: string = DOCS_CALLOUT_ICONS[kind]!;
      const start: number = docsIcon.indexOf(' d="') + 4;
      const end: number = docsIcon.indexOf('"', start);

      expect(MARKDOWN_CALLOUT_STYLES[kind].iconPath).toBe(
        docsIcon.slice(start, end),
      );
    }
  });

  test("getMarkdownCalloutKind reads a kind in any case, and nothing else", () => {
    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      expect(getMarkdownCalloutKind(kind)).toBe(kind);
      expect(getMarkdownCalloutKind(kind.toUpperCase())).toBe(kind);
    }

    for (const value of [
      "",
      "alert",
      "notes",
      " note",
      "note ",
      "toString",
      "constructor",
      "__proto__",
      undefined,
      null,
      7,
      {},
      ["note"],
    ]) {
      expect(getMarkdownCalloutKind(value)).toBeNull();
    }
  });

  test("the transform's property reaches the renderer as data-callout", () => {
    // hast-util-to-jsx-runtime turns dataCallout into data-callout.
    expect(MARKDOWN_CALLOUT_PROPERTY).toBe("dataCallout");
    expect(MARKDOWN_CALLOUT_ATTRIBUTE).toBe("data-callout");
  });

  test("every kind has a label a screen reader is told", () => {
    const labels: Record<MarkdownCalloutKind, string> = {
      note: "Note",
      tip: "Tip",
      info: "Info",
      important: "Important",
      warning: "Warning",
      caution: "Caution",
      danger: "Danger",
    };

    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      expect(MARKDOWN_CALLOUT_STYLES[kind].label).toBe(labels[kind]);
    }
  });
});
