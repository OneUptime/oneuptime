import {
  YamlSyntaxCheckResult,
  checkYamlSyntax,
  describeYamlSyntaxError,
} from "../../../Types/Code/YamlSyntax";
import { describe, expect, test } from "@jest/globals";

/*
 * checkYamlSyntax answers one question — "would a YAML parser accept this
 * text?" — and is the single source of truth behind both the form-level
 * validator and the YAML editor's status bar. It is pure: same string in,
 * same verdict out, no time, network or randomness.
 *
 * Its contract deliberately mirrors checkJSONSyntax's: permissive about
 * anything it cannot decide (non-strings, empty boxes, handlebars loops),
 * definite about anything it can.
 */

const VALID_SIGMA_RULE: string = `title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
level: high
`;

describe("checkYamlSyntax — accepts what a YAML parser accepts", () => {
  test("a real Sigma rule", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(VALID_SIGMA_RULE);

    expect(result.isValid).toBe(true);
    expect(result.wasSkipped).toBe(false);
    expect(result.errorMessage).toBeNull();
    expect(result.line).toBeNull();
    expect(result.column).toBeNull();
  });

  test("a flat mapping", () => {
    expect(checkYamlSyntax("a: 1\nb: two\n").isValid).toBe(true);
  });

  test("a sequence", () => {
    expect(checkYamlSyntax("- one\n- two\n- three\n").isValid).toBe(true);
  });

  test("flow style, which is also legal JSON", () => {
    expect(checkYamlSyntax('{"a": 1, "b": [1, 2]}').isValid).toBe(true);
  });

  test("a bare scalar — a lone word is a valid YAML document", () => {
    expect(checkYamlSyntax("hello").isValid).toBe(true);
  });

  test("comments, which the editor must never strip", () => {
    expect(
      checkYamlSyntax("# what this rule catches\ntitle: Something\n").isValid,
    ).toBe(true);
  });

  test("anchors and aliases", () => {
    expect(
      checkYamlSyntax("base: &base\n  a: 1\nderived:\n  <<: *base\n").isValid,
    ).toBe(true);
  });

  test("a block scalar", () => {
    expect(
      checkYamlSyntax("description: |\n  line one\n  line two\n").isValid,
    ).toBe(true);
  });

  /*
   * A YAML stream can hold several documents separated by `---`. load() throws
   * on the second one, loadAll() does not — this pins that the implementation
   * uses loadAll.
   */
  test("a multi-document stream", () => {
    expect(checkYamlSyntax("---\na: 1\n---\nb: 2\n").isValid).toBe(true);
  });

  test("a document that is only a comment", () => {
    expect(checkYamlSyntax("# nothing but a note\n").isValid).toBe(true);
  });
});

describe("checkYamlSyntax — catches the real mistakes", () => {
  test("an unclosed flow sequence", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax("title: [unclosed");

    expect(result.isValid).toBe(false);
    expect(result.wasSkipped).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  test("an unclosed flow mapping", () => {
    expect(checkYamlSyntax("detection: {selection: 1").isValid).toBe(false);
  });

  test("a tab used for indentation — illegal in YAML, invisible on screen", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "detection:\n\tselection: 1\n",
    );

    expect(result.isValid).toBe(false);
  });

  test("two mapping keys at odds about their indentation", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "detection:\n  selection: 1\n   condition: selection\n",
    );

    expect(result.isValid).toBe(false);
  });

  test("a duplicated mapping key", () => {
    expect(checkYamlSyntax("title: one\ntitle: two\n").isValid).toBe(false);
  });

  test("an unclosed quote", () => {
    expect(checkYamlSyntax('title: "never closed\n').isValid).toBe(false);
  });
});

describe("checkYamlSyntax — reports where the failure is", () => {
  /*
   * The line and column are the whole point of the message: the editor turns
   * the gutter on for YAML precisely so the reader can go there.
   */
  test("a 1-based line and column, not js-yaml's 0-based mark", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "title: fine\ndetection:\n  selection: 1\n   condition: selection\n",
    );

    expect(result.isValid).toBe(false);
    expect(result.line).not.toBeNull();
    expect(result.line).toBeGreaterThanOrEqual(1);
    expect(result.column).not.toBeNull();
    expect(result.column).toBeGreaterThanOrEqual(1);
  });

  test("a single-line reason, not js-yaml's multi-line source excerpt", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax("title: [unclosed");

    expect(result.errorMessage).not.toContain("\n");
  });

  test("the reason does not repeat the coordinates the caller adds", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "detection:\n  selection: 1\n   condition: selection\n",
    );

    // js-yaml's `message` ends with "(3:4)"; its `reason` does not.
    expect(result.errorMessage).not.toMatch(/\(\d+:\d+\)/);
  });
});

describe("checkYamlSyntax — declines to judge what it cannot know", () => {
  /*
   * Every one of these is reported valid AND flagged as skipped, so a caller
   * that wants to explain itself can tell "passed" from "not checked".
   */
  test("a non-string, because nothing was typed", () => {
    for (const value of [undefined, null, 42, true, { a: 1 }, ["a"]]) {
      const result: YamlSyntaxCheckResult = checkYamlSyntax(value);

      expect(result.isValid).toBe(true);
      expect(result.wasSkipped).toBe(true);
    }
  });

  test("empty and whitespace-only, which is the required check's job", () => {
    for (const value of ["", "   ", "\n\n", "\t"]) {
      const result: YamlSyntaxCheckResult = checkYamlSyntax(value);

      expect(result.isValid).toBe(true);
      expect(result.wasSkipped).toBe(true);
    }
  });

  test("a handlebars loop, whose shape is only known at run time", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "items:\n{{#each local.variables.hosts}}\n  - {{this}}\n{{/each}}\n",
    );

    expect(result.isValid).toBe(true);
    expect(result.wasSkipped).toBe(true);
  });
});

describe("checkYamlSyntax — tolerates handlebars the way the JSON check does", () => {
  test("a template standing in for a value", () => {
    expect(
      checkYamlSyntax("threshold: {{local.variables.count}}").isValid,
    ).toBe(true);
  });

  test("a template inside a quoted string", () => {
    expect(
      checkYamlSyntax('auth: "Bearer {{local.variables.token}}"').isValid,
    ).toBe(true);
  });

  test("a whole-field template", () => {
    expect(
      checkYamlSyntax("{{local.components.a.returnValues.body}}").isValid,
    ).toBe(true);
  });

  test("masking does not paper over a genuine error elsewhere", () => {
    expect(
      checkYamlSyntax("threshold: {{local.variables.count}}\nbad: [unclosed")
        .isValid,
    ).toBe(false);
  });
});

describe("checkYamlSyntax — purity", () => {
  test("the same input yields the same verdict every time", () => {
    for (const value of [VALID_SIGMA_RULE, "title: [unclosed", "", "a: 1"]) {
      expect(checkYamlSyntax(value)).toEqual(checkYamlSyntax(value));
    }
  });

  test("does not mutate or consume its input", () => {
    const original: string = VALID_SIGMA_RULE;

    checkYamlSyntax(original);

    expect(original).toBe(VALID_SIGMA_RULE);
  });
});

describe("describeYamlSyntaxError — one readable sentence", () => {
  test("reason, line and column when all three are known", () => {
    expect(
      describeYamlSyntaxError({
        isValid: false,
        errorMessage: "bad indentation of a mapping entry",
        wasSkipped: false,
        line: 4,
        column: 3,
      }),
    ).toBe("bad indentation of a mapping entry (line 4, column 3)");
  });

  test("drops the column when the parser did not report one", () => {
    expect(
      describeYamlSyntaxError({
        isValid: false,
        errorMessage: "unexpected end of the stream",
        wasSkipped: false,
        line: 9,
        column: null,
      }),
    ).toBe("unexpected end of the stream (line 9)");
  });

  test("the bare reason when there is no position at all", () => {
    expect(
      describeYamlSyntaxError({
        isValid: false,
        errorMessage: "something went wrong",
        wasSkipped: false,
        line: null,
        column: null,
      }),
    ).toBe("something went wrong");
  });

  test("never renders an empty sentence", () => {
    expect(
      describeYamlSyntaxError({
        isValid: false,
        errorMessage: null,
        wasSkipped: false,
        line: null,
        column: null,
      }),
    ).toBe("Invalid YAML.");
  });

  test("describes a real parse failure end to end", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "detection:\n  selection: 1\n   condition: selection\n",
    );

    const sentence: string = describeYamlSyntaxError(result);

    expect(sentence).toContain("line ");
    expect(sentence).not.toContain("\n");
  });
});

/*
 * Tabs in indentation.
 *
 * js-yaml ACCEPTS tab-indented YAML rather than rejecting it, and quietly
 * restructures the document: `detection:\n\tselection: 1` yields
 * `{detection: null, selection: 1}` — a sibling where the author wrote a
 * child. So checkYamlSyntax finds these itself, and the risk moves from
 * missing them to over-reporting: a tab is only illegal in INDENTATION, and
 * every "allows" case below is legal YAML that js-yaml parses. Flagging one of
 * them would block Save on a working document, which is the failure this
 * module's permissiveness exists to prevent.
 */
describe("checkYamlSyntax — tabs used for indentation", () => {
  test("reports the line and column of the tab", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "detection:\n\tselection: 1\n",
    );

    expect(result.isValid).toBe(false);
    expect(result.wasSkipped).toBe(false);
    expect(result.line).toBe(2);
    expect(result.column).toBe(1);
    expect(describeYamlSyntaxError(result)).toContain("line 2");
  });

  test.each([
    ["a tab indenting a sequence entry", "a:\n\t- 1\n", 2],
    ["spaces followed by a tab", "a:\n  \tb: 1\n", 2],
    ["a tab on a line after a block scalar closes", "a: |\n  body\nb:\n\tc: 1\n", 4],
    ["a CRLF document", "a:\r\n\tb: 1\r\n", 2],
    ["a tab several levels into the document", "a:\n  b:\n    c: 1\n\td: 2\n", 4],
  ])("rejects %s", (_label: string, document: string, line: number) => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(document);

    expect(result.isValid).toBe(false);
    expect(result.line).toBe(line);
  });

  /*
   * Each of these parses under js-yaml. Verified case by case rather than
   * assumed — a tab is ordinary content inside a scalar, and legal separation
   * whitespace inside a flow collection.
   */
  test.each([
    ["a tab inside block scalar content", "a: |\n  line\twith tab\n"],
    ["a block scalar line that starts with a tab", "a: |\n  first\n  \tindented more\n"],
    ["a block scalar with an explicit indent indicator", "a: |2\n  \tcontent\n"],
    ["a block scalar with chomping indicators", "a: |-\n  \tx\nb: >+\n  \ty\n"],
    ["a block scalar containing a blank line", "a: |\n  one\n\n  \ttwo\nb: 2\n"],
    ["a block scalar inside a sequence", "- |\n  \tx\n- 2\n"],
    ["YAML embedded in a block scalar, as a ConfigMap does", "data:\n  app.yaml: |\n    outer:\n    \tinner: 1\n"],
    ["a block scalar line shaped like a mapping key", "a: |\n  x:\n  \ty: 1\n"],
    ["a double-quoted scalar continued on a tabbed line", 'a: "one\n\ttwo"\n'],
    ["a single-quoted scalar continued on a tabbed line", "a: 'one\n\ttwo'\n"],
    ["a quoted continuation that looks like a mapping key", 'a: "one\n\ttwo: three"\n'],
    ["a flow mapping spanning lines", "a: {\n\tb: 1 }\n"],
    ["a tab inside a quoted value", 'a: "x\ty"\n'],
    ["a tab inside a comment", "a: 1 #\tcomment\n"],
    ["a tab inside folded scalar content", "a: >\n  text\there\n"],
  ])("allows %s", (_label: string, document: string) => {
    expect(checkYamlSyntax(document).isValid).toBe(true);
  });

  /*
   * The apostrophe in `it's` is not an opening quote. Reading it as one would
   * leave a scalar "open" for the rest of the document and silence the check
   * from that line on — a miss rather than a false positive, but a total one.
   */
  test("an apostrophe in a plain scalar does not blind the rest of the document", () => {
    const result: YamlSyntaxCheckResult = checkYamlSyntax(
      "a: it's fine\nb:\n\tc: 1\n",
    );

    expect(result.isValid).toBe(false);
    expect(result.line).toBe(3);
  });
});
