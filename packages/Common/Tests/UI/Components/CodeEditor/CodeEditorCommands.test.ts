import {
  EditingRules,
  EditorState,
  IndentUnit,
  TAB_INDENT,
  TextEdit,
  applyTextEdit,
  backspace,
  countLines,
  detectIndentUnit,
  getLineColumn,
  indent,
  indentLines,
  lineEndOf,
  lineStartOf,
  newLine,
  outdent,
  spacesIndent,
  toggleLineComment,
  typeCharacter,
} from "../../../../UI/Components/CodeEditor/CodeEditorCommands";
import { CODE_LANGUAGES } from "../../../../UI/Components/CodeEditor/CodeEditorLanguages";
import CodeType from "../../../../Types/Code/CodeType";
import { describe, expect, test } from "@jest/globals";

/*
 * Documents are written with the selection drawn into them: "¦" is a caret,
 * and "«" / "»" enclose a selection. (Not "|" and "[ ]": YAML block scalars
 * and JSON arrays use those.) run() applies a command's edit and draws the
 * result the same way, so each case reads as before -> after.
 */
const CARET: string = "¦";
const SELECTION_START: string = "«";
const SELECTION_END: string = "»";

const TWO: IndentUnit = spacesIndent(2);
const FOUR: IndentUnit = spacesIndent(4);

const JSON_RULES: EditingRules = CODE_LANGUAGES[CodeType.JSON].rules;
const YAML_RULES: EditingRules = CODE_LANGUAGES[CodeType.YAML].rules;
const JS_RULES: EditingRules = CODE_LANGUAGES[CodeType.JavaScript].rules;
const SQL_RULES: EditingRules = CODE_LANGUAGES[CodeType.SQL].rules;
const TEXT_RULES: EditingRules = CODE_LANGUAGES[CodeType.Text].rules;
const CSS_RULES: EditingRules = CODE_LANGUAGES[CodeType.CSS].rules;
const BASH_RULES: EditingRules = CODE_LANGUAGES[CodeType.Bash].rules;

type ParseFunction = (marked: string) => EditorState;

const parse: ParseFunction = (marked: string): EditorState => {
  const caret: number = marked.indexOf(CARET);

  if (caret !== -1) {
    return {
      text: marked.replace(CARET, ""),
      selectionStart: caret,
      selectionEnd: caret,
    };
  }

  const start: number = marked.indexOf(SELECTION_START);
  const end: number = marked.indexOf(SELECTION_END);

  if (start === -1 || end === -1) {
    throw new Error(`No caret or selection drawn in ${JSON.stringify(marked)}`);
  }

  return {
    text: marked.replace(SELECTION_START, "").replace(SELECTION_END, ""),
    selectionStart: start,
    selectionEnd: end - 1,
  };
};

type DrawFunction = (state: EditorState) => string;

const draw: DrawFunction = (state: EditorState): string => {
  const start: number = Math.min(state.selectionStart, state.selectionEnd);
  const end: number = Math.max(state.selectionStart, state.selectionEnd);

  if (start === end) {
    return state.text.slice(0, start) + CARET + state.text.slice(start);
  }

  return (
    state.text.slice(0, start) +
    SELECTION_START +
    state.text.slice(start, end) +
    SELECTION_END +
    state.text.slice(end)
  );
};

type Command = (state: EditorState) => TextEdit | null;

type RunFunction = (marked: string, command: Command) => string | null;

/*
 * Applies the command's edit the way the editor does - one replacement of
 * [from, to) - and draws the result. Also holds every edit to the contract
 * the component relies on: a real range of the old text, and a selection
 * that lands inside the new one.
 */
const run: RunFunction = (marked: string, command: Command): string | null => {
  const state: EditorState = parse(marked);
  const edit: TextEdit | null = command(state);

  if (!edit) {
    return null;
  }

  expect(edit.from).toBeGreaterThanOrEqual(0);
  expect(edit.from).toBeLessThanOrEqual(edit.to);
  expect(edit.to).toBeLessThanOrEqual(state.text.length);

  const text: string = applyTextEdit(state.text, edit);

  expect(edit.selectionStart).toBeGreaterThanOrEqual(0);
  expect(edit.selectionEnd).toBeLessThanOrEqual(text.length);
  expect(edit.selectionStart).toBeLessThanOrEqual(edit.selectionEnd);

  return draw({
    text,
    selectionStart: edit.selectionStart,
    selectionEnd: edit.selectionEnd,
  });
};

describe("the drawing helpers the rest of these tests read through", () => {
  test("parse and draw round-trip a caret and a selection", () => {
    for (const marked of ["ab¦c", "¦", "a«b\nc»d", "«»x"]) {
      expect(draw(parse(marked))).toBe(marked === "«»x" ? "¦x" : marked);
    }
  });
});

describe("applyTextEdit", () => {
  test("replaces [from, to) with the inserted text", () => {
    expect(
      applyTextEdit("hello", {
        from: 1,
        to: 3,
        insert: "XY",
        selectionStart: 3,
        selectionEnd: 3,
      }),
    ).toBe("hXYlo");
  });

  test("inserts when the range is empty and deletes when the text is", () => {
    expect(
      applyTextEdit("ab", {
        from: 1,
        to: 1,
        insert: "-",
        selectionStart: 2,
        selectionEnd: 2,
      }),
    ).toBe("a-b");
    expect(
      applyTextEdit("abc", {
        from: 0,
        to: 2,
        insert: "",
        selectionStart: 0,
        selectionEnd: 0,
      }),
    ).toBe("c");
  });
});

describe("line helpers", () => {
  // a0 b1 \n2 c3 d4 \n5 \n6 e7 f8 - the third line is empty.
  const TEXT: string = "ab\ncd\n\nef";

  test.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 3],
    [5, 3],
    [6, 6],
    [7, 7],
    [9, 7],
  ])("lineStartOf(%i) is %i", (index: number, start: number) => {
    expect(lineStartOf(TEXT, index)).toBe(start);
  });

  test.each([
    [0, 2],
    [2, 2],
    [3, 5],
    [6, 6],
    [7, 9],
    [9, 9],
  ])("lineEndOf(%i) is %i", (index: number, end: number) => {
    expect(lineEndOf(TEXT, index)).toBe(end);
  });

  test.each([
    ["", 1],
    ["a", 1],
    ["a\n", 2],
    ["\n\n", 3],
    [TEXT, 4],
  ])("countLines(%j) is %i", (text: string, lines: number) => {
    expect(countLines(text)).toBe(lines);
  });

  test.each([
    [0, 1, 1],
    [2, 1, 3],
    [3, 2, 1],
    [6, 3, 1],
    [9, 4, 3],
  ])(
    "getLineColumn(%i) is line %i, column %i",
    (index: number, line: number, column: number) => {
      expect(getLineColumn(TEXT, index)).toEqual({ line, column });
    },
  );

  test("getLineColumn clamps positions outside the text", () => {
    expect(getLineColumn(TEXT, -3)).toEqual({ line: 1, column: 1 });
    expect(getLineColumn(TEXT, 100)).toEqual({ line: 4, column: 3 });
  });
});

describe("spacesIndent and TAB_INDENT", () => {
  test("describe one level of indentation", () => {
    expect(spacesIndent(2)).toEqual({ text: "  ", size: 2, usesTabs: false });
    expect(spacesIndent(4)).toEqual({ text: "    ", size: 4, usesTabs: false });
    expect(TAB_INDENT).toEqual({ text: "\t", size: 1, usesTabs: true });
  });
});

describe("indent (Tab)", () => {
  type IndentWithFunction = (unit: IndentUnit) => Command;

  const indentWith: IndentWithFunction = (unit: IndentUnit): Command => {
    return (state: EditorState): TextEdit | null => {
      return indent(state, unit);
    };
  };

  test.each([
    ["¦abc", TWO, "  ¦abc"],
    ["a¦bc", TWO, "a ¦bc"],
    ["ab¦c", TWO, "ab  ¦c"],
    ["abc¦", FOUR, "abc ¦"],
    ["abcd¦", FOUR, "abcd    ¦"],
    ["¦", FOUR, "    ¦"],
    ["x\n  ¦y", TWO, "x\n    ¦y"],
    ["x\n   ¦y", TWO, "x\n    ¦y"],
  ])(
    "a caret types spaces to the next tab stop: %j",
    (before: string, unit: IndentUnit, after: string) => {
      expect(run(before, indentWith(unit))).toBe(after);
    },
  );

  test("indenting with tabs types one tab wherever the caret is", () => {
    expect(run("a¦b", indentWith(TAB_INDENT))).toBe("a\t¦b");
    expect(run("¦a", indentWith(TAB_INDENT))).toBe("\t¦a");
  });

  test("a selection inside one line is replaced by indentation", () => {
    expect(run("a«bc»d", indentWith(TWO))).toBe("a ¦d");
    expect(run("«ab»cd", indentWith(TWO))).toBe("  ¦cd");
  });

  test("a selection of a whole line indents the line and keeps it selected", () => {
    expect(run("«abc»\ndef", indentWith(TWO))).toBe("«  abc»\ndef");
  });

  test("a selection over several lines indents each of them", () => {
    expect(run("a«b\ncd»e\nf", indentWith(TWO))).toBe("  a«b\n  cd»e\nf");
  });

  test("a selection starting at column 1 grows to take in the new indentation", () => {
    expect(run("«ab\ncd»", indentWith(FOUR))).toBe("«    ab\n    cd»");
  });

  test("empty lines inside the selection stay empty", () => {
    expect(run("«a\n\nb»", indentWith(TWO))).toBe("«  a\n\n  b»");
  });

  test("a selection ending at the start of a line leaves that line alone", () => {
    expect(run("«a\n»b", indentWith(TWO))).toBe("«  a\n»b");
  });

  test("tabs indent every selected line with a tab", () => {
    expect(run("«a\nb»", indentWith(TAB_INDENT))).toBe("«\ta\n\tb»");
  });
});

describe("indentLines (Ctrl/Cmd+])", () => {
  type IndentLinesWithFunction = (unit: IndentUnit) => Command;

  const indentLinesWith: IndentLinesWithFunction = (
    unit: IndentUnit,
  ): Command => {
    return (state: EditorState): TextEdit | null => {
      return indentLines(state, unit);
    };
  };

  test("indents the caret's whole line, and the caret moves with its text", () => {
    expect(run("a¦bc", indentLinesWith(TWO))).toBe("  a¦bc");
  });

  test("a caret at column 1 ends up after the new indentation", () => {
    expect(run("¦abc", indentLinesWith(TWO))).toBe("  ¦abc");
  });

  test("only the caret's line is touched", () => {
    expect(run("x\ny¦\nz", indentLinesWith(FOUR))).toBe("x\n    y¦\nz");
  });

  test("an empty line has nothing to indent", () => {
    expect(run("a\n¦\nb", indentLinesWith(TWO))).toBeNull();
    expect(run("¦", indentLinesWith(TWO))).toBeNull();
  });
});

describe("outdent (Shift+Tab)", () => {
  type OutdentWithFunction = (unit: IndentUnit) => Command;

  const outdentWith: OutdentWithFunction = (unit: IndentUnit): Command => {
    return (state: EditorState): TextEdit | null => {
      return outdent(state, unit);
    };
  };

  test.each([
    ["    ¦abc", TWO, "  ¦abc"],
    ["   abc¦", TWO, "  abc¦"],
    ["  ¦abc", TWO, "¦abc"],
    [" ¦a", FOUR, "¦a"],
    ["      x¦", FOUR, "    x¦"],
    ["        x¦", FOUR, "    x¦"],
  ])(
    "snaps to the previous tab stop: %j",
    (before: string, unit: IndentUnit, after: string) => {
      expect(run(before, outdentWith(unit))).toBe(after);
    },
  );

  test("removes one leading tab", () => {
    expect(run("\t\tx¦", outdentWith(TWO))).toBe("\tx¦");
    expect(run("\tx¦", outdentWith(TAB_INDENT))).toBe("x¦");
  });

  test("with tabs as the unit, leading spaces come off four at a time", () => {
    expect(run("    x¦", outdentWith(TAB_INDENT))).toBe("x¦");
    expect(run("      x¦", outdentWith(TAB_INDENT))).toBe("    x¦");
  });

  test("spaces before a tab are outdented as spaces", () => {
    expect(run("  \tx¦", outdentWith(TWO))).toBe("\tx¦");
  });

  test("a caret inside the removed indentation moves to the line start", () => {
    expect(run(" ¦   abc", outdentWith(TWO))).toBe("¦  abc");
  });

  test("outdents every line of a selection, each by what it has", () => {
    expect(run("«  a\n    b\nc»", outdentWith(TWO))).toBe("«a\n  b\nc»");
  });

  test("nothing to take off is null, not an empty edit", () => {
    expect(run("abc¦", outdentWith(TWO))).toBeNull();
    expect(run("«a\nb»", outdentWith(TWO))).toBeNull();
    expect(run("¦", outdentWith(FOUR))).toBeNull();
  });
});

describe("newLine (Enter)", () => {
  type EnterFunction = (rules: EditingRules, unit?: IndentUnit) => Command;

  const enter: EnterFunction = (
    rules: EditingRules,
    unit: IndentUnit = TWO,
  ): Command => {
    return (state: EditorState): TextEdit => {
      return newLine(state, unit, rules);
    };
  };

  test("keeps the current line's indentation", () => {
    expect(run('  "a": 1,¦', enter(JSON_RULES))).toBe('  "a": 1,\n  ¦');
    expect(run("\tx¦", enter(JS_RULES))).toBe("\tx\n\t¦");
  });

  test("goes one level deeper after an opening bracket", () => {
    expect(run("{¦", enter(JSON_RULES))).toBe("{\n  ¦");
    expect(run('  "a": [¦', enter(JSON_RULES))).toBe('  "a": [\n    ¦');
    expect(run("{  ¦", enter(JSON_RULES))).toBe("{  \n  ¦");
  });

  test("uses the document's unit for the extra level", () => {
    expect(run("{¦", enter(JSON_RULES, FOUR))).toBe("{\n    ¦");
    expect(run("{¦", enter(JSON_RULES, TAB_INDENT))).toBe("{\n\t¦");
  });

  test("between a bracket pair, the closer moves to a line of its own", () => {
    expect(run("{¦}", enter(JSON_RULES))).toBe("{\n  ¦\n}");
    expect(run("[¦]", enter(JSON_RULES))).toBe("[\n  ¦\n]");
    expect(run('  "a": [¦]', enter(JSON_RULES))).toBe('  "a": [\n    ¦\n  ]');
  });

  test("the spaces between the caret and the closer are dropped", () => {
    expect(run("{¦   }", enter(JSON_RULES))).toBe("{\n  ¦\n}");
  });

  test("text before the closer means no split", () => {
    expect(run("[¦1]", enter(JSON_RULES))).toBe("[\n  ¦1]");
  });

  test("parentheses count only where the language pairs them", () => {
    expect(run("foo(¦)", enter(JS_RULES))).toBe("foo(\n  ¦\n)");
    expect(run("foo(¦)", enter(JSON_RULES))).toBe("foo(\n¦)");
    expect(run("{¦}", enter(TEXT_RULES))).toBe("{\n¦}");
  });

  test("replaces a selection", () => {
    expect(run("a«bc»d", enter(JSON_RULES))).toBe("a\n¦d");
    expect(run("  x«yz»", enter(JSON_RULES))).toBe("  x\n  ¦");
  });

  describe("in YAML", () => {
    test("goes one level deeper after `key:`", () => {
      expect(run("key:¦", enter(YAML_RULES))).toBe("key:\n  ¦");
      expect(run("  nested: ¦", enter(YAML_RULES))).toBe("  nested: \n    ¦");
    });

    test.each(["|", ">", "|-", ">-", "|+", ">2", "|-2"])(
      "goes one level deeper after a block scalar header `key: %s`",
      (header: string) => {
        expect(run(`key: ${header}¦`, enter(YAML_RULES))).toBe(
          `key: ${header}\n  ¦`,
        );
      },
    );

    /*
     * Regression: YAML takes a block scalar's indentation and chomping
     * indicators in either order (YamlSyntax's BLOCK_SCALAR_HEADER accepts
     * both), and the Enter rule only knew chomping-first.
     */
    test("a block scalar header with the indentation indicator first (`|2-`) goes deeper too", () => {
      expect(run("key: |2-¦", enter(YAML_RULES))).toBe("key: |2-\n  ¦");
    });

    test("stays level after `key: value`", () => {
      expect(run("  key: value¦", enter(YAML_RULES))).toBe("  key: value\n  ¦");
    });

    test("continues a list item at its content column", () => {
      expect(run("- name: web¦", enter(YAML_RULES))).toBe("- name: web\n  ¦");
      expect(run("  - name: x¦", enter(YAML_RULES))).toBe("  - name: x\n    ¦");
    });

    test("goes under a key that opens inside a list item", () => {
      expect(run("- env:¦", enter(YAML_RULES))).toBe("- env:\n    ¦");
    });

    test("a comment ending in a colon does not open a block", () => {
      expect(run("# note:¦", enter(YAML_RULES))).toBe("# note:\n¦");
      expect(run("  # a:¦", enter(YAML_RULES))).toBe("  # a:\n  ¦");
    });

    test("a flow mapping splits like a bracket pair", () => {
      expect(run("key: {¦}", enter(YAML_RULES))).toBe("key: {\n  ¦\n}");
    });

    test("other languages do not treat a colon as opening a block", () => {
      expect(run("key:¦", enter(JSON_RULES))).toBe("key:\n¦");
      expect(run("- a:¦", enter(JS_RULES))).toBe("- a:\n¦");
    });
  });
});

describe("typeCharacter", () => {
  type TypeFunction = (character: string, rules: EditingRules) => Command;

  const type: TypeFunction = (
    character: string,
    rules: EditingRules,
  ): Command => {
    return (state: EditorState): TextEdit | null => {
      return typeCharacter(state, character, rules);
    };
  };

  test.each([
    ["{", "{¦}"],
    ["[", "[¦]"],
    ['"', '"¦"'],
  ])(
    "JSON pairs %s at the end of the text",
    (character: string, after: string) => {
      expect(run("¦", type(character, JSON_RULES))).toBe(after);
    },
  );

  test.each(["¦ x", "¦,", "¦:", "¦}", "¦]", "¦;", "¦)", "¦\nnext"])(
    "an opening bracket is paired before whitespace or punctuation: %j",
    (before: string) => {
      const expected: string = before.replace(CARET, "[" + CARET + "]");

      expect(run(before, type("[", JSON_RULES))).toBe(expected);
    },
  );

  test("an opening bracket straight before a word is typed alone", () => {
    expect(run("¦abc", type("{", JSON_RULES))).toBeNull();
    expect(run("¦1", type("[", JSON_RULES))).toBeNull();
  });

  test("a bracket is paired right after a word: COUNT(", () => {
    expect(run("COUNT¦", type("(", SQL_RULES))).toBe("COUNT(¦)");
  });

  test("typing the closer that is already next steps over it", () => {
    expect(run("{¦}", type("}", JSON_RULES))).toBe("{}¦");
    expect(run("[1¦]", type("]", JSON_RULES))).toBe("[1]¦");
    expect(run("f(x¦)", type(")", JS_RULES))).toBe("f(x)¦");
  });

  test("typing the quote that is already next steps over it", () => {
    expect(run('"abc¦"', type('"', JSON_RULES))).toBe('"abc"¦');
    expect(run("'a¦'", type("'", YAML_RULES))).toBe("'a'¦");
  });

  test("a closer with nothing to step over is typed normally", () => {
    expect(run("{¦", type("}", JSON_RULES))).toBeNull();
    expect(run("{¦x", type("}", JSON_RULES))).toBeNull();
  });

  test("an apostrophe inside a word stays single", () => {
    expect(run("don¦", type("'", YAML_RULES))).toBeNull();
    expect(run("don¦ t", type("'", YAML_RULES))).toBeNull();
    expect(run("café¦", type("'", YAML_RULES))).toBeNull();
    expect(run("x1¦", type('"', JSON_RULES))).toBeNull();
  });

  test("a quote straight before a word is typed alone", () => {
    expect(run("¦abc", type('"', JSON_RULES))).toBeNull();
  });

  test("a quote right after the same quote is typed alone", () => {
    expect(run('"¦', type('"', JSON_RULES))).toBeNull();
  });

  test("a quote after punctuation or a space is paired", () => {
    expect(run('{"a": ¦}', type('"', JSON_RULES))).toBe('{"a": "¦"}');
    expect(run("key: ¦", type("'", YAML_RULES))).toBe("key: '¦'");
    expect(run("(¦)", type("`", JS_RULES))).toBe("(`¦`)");
  });

  test("an opening bracket or quote over a selection wraps it, keeping it selected", () => {
    expect(run("«abc»", type('"', JSON_RULES))).toBe('"«abc»"');
    expect(run("x «a b» y", type("{", JSON_RULES))).toBe("x {«a b»} y");
    expect(run("«a\nb»", type("[", JSON_RULES))).toBe("[«a\nb»]");
    expect(run("«x»", type("'", JS_RULES))).toBe("'«x»'");
    expect(run("«x»", type("(", JS_RULES))).toBe("(«x»)");
  });

  test("a character that is not a bracket or quote over a selection is left to the browser", () => {
    expect(run("«abc»", type("a", JSON_RULES))).toBeNull();
    expect(run("«abc»", type("(", JSON_RULES))).toBeNull();
    expect(run("«abc»", type("}", JSON_RULES))).toBeNull();
  });

  test("plain characters are always left to the browser", () => {
    for (const character of ["a", "1", " ", ":", ",", "-"]) {
      expect(run("x¦", type(character, JSON_RULES))).toBeNull();
    }
  });

  test("a language without pairs never pairs anything", () => {
    for (const character of ["{", "[", "(", '"', "'", "`"]) {
      expect(run("¦", type(character, TEXT_RULES))).toBeNull();
      expect(run("«x»", type(character, TEXT_RULES))).toBeNull();
    }
  });

  test("each language pairs only its own quotes", () => {
    expect(run("¦", type("'", JSON_RULES))).toBeNull();
    expect(run("¦", type("`", YAML_RULES))).toBeNull();
    expect(run("¦", type("`", BASH_RULES))).toBeNull();
    expect(run("¦", type("'", SQL_RULES))).toBe("'¦'");
    expect(run("¦", type("`", JS_RULES))).toBe("`¦`");
  });
});

describe("backspace", () => {
  type BackspaceWithFunction = (
    rules: EditingRules,
    unit?: IndentUnit,
  ) => Command;

  const press: BackspaceWithFunction = (
    rules: EditingRules,
    unit: IndentUnit = TWO,
  ): Command => {
    return (state: EditorState): TextEdit | null => {
      return backspace(state, unit, rules);
    };
  };

  test.each([
    ["{¦}", JSON_RULES],
    ["[¦]", JSON_RULES],
    ['"¦"', JSON_RULES],
    ["(¦)", JS_RULES],
    ["'¦'", YAML_RULES],
    ["`¦`", JS_RULES],
  ])(
    "deletes both halves of an empty pair: %j",
    (before: string, rules: EditingRules) => {
      expect(run(before, press(rules))).toBe("¦");
    },
  );

  test("deletes an empty pair in the middle of a line", () => {
    expect(run('{"a": "¦"}', press(JSON_RULES))).toBe('{"a": ¦}');
    expect(run("x = [¦];", press(JS_RULES))).toBe("x = ¦;");
  });

  test("a closing quote followed by another quote is not an empty pair", () => {
    expect(run('"abc"¦"', press(JSON_RULES))).toBeNull();
    expect(run('""¦"', press(JSON_RULES))).toBeNull();
  });

  test("a pair the language does not know is deleted one character at a time", () => {
    expect(run("(¦)", press(JSON_RULES))).toBeNull();
    expect(run("{¦}", press(TEXT_RULES))).toBeNull();
  });

  test.each([
    ["    ¦x", TWO, "  ¦x"],
    ["  ¦x", TWO, "¦x"],
    ["        ¦", FOUR, "    ¦"],
    ["      ¦", FOUR, "    ¦"],
    ["x\n    ¦y", TWO, "x\n  ¦y"],
  ])(
    "in the indentation, deletes back to the previous tab stop: %j",
    (before: string, unit: IndentUnit, after: string) => {
      expect(run(before, press(JSON_RULES, unit))).toBe(after);
    },
  );

  test("a single character of indentation is left to the browser", () => {
    expect(run("   ¦", press(JSON_RULES, TWO))).toBeNull();
    expect(run(" ¦", press(JSON_RULES, TWO))).toBeNull();
    expect(run("     ¦", press(JSON_RULES, FOUR))).toBeNull();
  });

  test("spaces after text are not indentation", () => {
    expect(run("a   ¦", press(JSON_RULES, TWO))).toBeNull();
    expect(run("    a  ¦", press(JSON_RULES, TWO))).toBeNull();
  });

  test("indenting with tabs deletes one character at a time", () => {
    expect(run("    ¦", press(JSON_RULES, TAB_INDENT))).toBeNull();
    expect(run("\t\t¦", press(JSON_RULES, TAB_INDENT))).toBeNull();
  });

  test("a selection, or the very start, is left to the browser", () => {
    expect(run("«ab»", press(JSON_RULES))).toBeNull();
    expect(run("«  »x", press(JSON_RULES))).toBeNull();
    expect(run("¦ab", press(JSON_RULES))).toBeNull();
    expect(run("¦", press(JSON_RULES))).toBeNull();
  });
});

describe("toggleLineComment (Ctrl/Cmd+/)", () => {
  type ToggleFunction = (rules: EditingRules) => Command;

  const toggle: ToggleFunction = (rules: EditingRules): Command => {
    return (state: EditorState): TextEdit | null => {
      return toggleLineComment(state, rules);
    };
  };

  test("comments the caret's line, and the caret stays with its text", () => {
    expect(run("¦foo()", toggle(JS_RULES))).toBe("// ¦foo()");
    expect(run("fo¦o", toggle(JS_RULES))).toBe("// fo¦o");
  });

  test("uses each language's own token", () => {
    expect(run("key: v¦", toggle(YAML_RULES))).toBe("# key: v¦");
    expect(run("SELECT 1¦", toggle(SQL_RULES))).toBe("-- SELECT 1¦");
    expect(run("echo hi¦", toggle(BASH_RULES))).toBe("# echo hi¦");
  });

  test("comments a block at its shared indentation, so it still lines up", () => {
    expect(run("«  a\n    b»", toggle(JS_RULES))).toBe("«  // a\n  //   b»");
  });

  test("uncomments when every non-blank line is commented", () => {
    expect(run("«// a\n// b»", toggle(JS_RULES))).toBe("«a\nb»");
    expect(run("«  // a\n  // b»", toggle(JS_RULES))).toBe("«  a\n  b»");
  });

  test("uncomments a token with no space after it", () => {
    expect(run("//a¦", toggle(JS_RULES))).toBe("a¦");
    expect(run("#key: v¦", toggle(YAML_RULES))).toBe("key: v¦");
  });

  test("a mix of commented and plain lines is commented as a whole", () => {
    expect(run("«// a\nb»", toggle(JS_RULES))).toBe("«// // a\n// b»");
  });

  test("blank lines in the block are left alone both ways", () => {
    expect(run("«a\n\nb»", toggle(JS_RULES))).toBe("«// a\n\n// b»");
    expect(run("«// a\n\n// b»", toggle(JS_RULES))).toBe("«a\n\nb»");
  });

  test("a caret on an empty line starts a comment there", () => {
    expect(run("¦", toggle(JS_RULES))).toBe("// ¦");
    expect(run("x\n    ¦", toggle(YAML_RULES))).toBe("x\n    # ¦");
  });

  test("a token later in the line does not make the line a comment", () => {
    expect(run("a // b¦", toggle(JS_RULES))).toBe("// a // b¦");
  });

  test("a selection ending at the start of a line leaves that line alone", () => {
    expect(run("«a\n»b", toggle(JS_RULES))).toBe("«// a\n»b");
  });

  test("a language without line comments has nothing to toggle", () => {
    expect(run("¦{}", toggle(JSON_RULES))).toBeNull();
    expect(run("¦a {}", toggle(CSS_RULES))).toBeNull();
    expect(run("¦text", toggle(TEXT_RULES))).toBeNull();
  });
});

describe("detectIndentUnit", () => {
  const FALLBACK: IndentUnit = spacesIndent(2);

  test("two-space YAML is two spaces", () => {
    expect(
      detectIndentUnit("a:\n  b:\n    c: 1\n  d: 2\n", FALLBACK, false),
    ).toEqual(TWO);
  });

  test("four-space JSON is four spaces", () => {
    expect(
      detectIndentUnit(
        JSON.stringify({ a: { b: [1, 2] }, c: 3 }, null, 4),
        FALLBACK,
        true,
      ),
    ).toEqual(FOUR);
  });

  test("two-space JSON is two spaces, even with a four-space fallback", () => {
    expect(
      detectIndentUnit(
        JSON.stringify({ a: { b: [1, 2] }, c: 3 }, null, 2),
        FOUR,
        true,
      ),
    ).toEqual(TWO);
  });

  test("the step seen most often wins", () => {
    // Steps: 4, 2, 4, 4.
    const text: string = "a\n    b\n      c\nd\n    e\nf\n    g";

    expect(detectIndentUnit(text, FALLBACK, true)).toEqual(FOUR);
  });

  test("a tie goes to two spaces", () => {
    expect(detectIndentUnit("a\n  b\nc\n    d", FOUR, true)).toEqual(TWO);
  });

  test("a document indented with tabs uses tabs where tabs are allowed", () => {
    expect(detectIndentUnit("{\n\ta\n\tb\n}", FALLBACK, true)).toBe(TAB_INDENT);
  });

  test("never tabs where they are not allowed (YAML)", () => {
    expect(detectIndentUnit("a:\n\tb: 1\n\tc: 2\n", FALLBACK, false)).toBe(
      FALLBACK,
    );
  });

  test("tabs only win when they outnumber indented space lines", () => {
    expect(detectIndentUnit("a\n  b\n  c\n\td", FALLBACK, true)).toEqual(TWO);
    expect(detectIndentUnit("a\n  b\n\tc", FALLBACK, true)).toEqual(TWO);
  });

  test("blank and whitespace-only lines are ignored", () => {
    expect(
      detectIndentUnit("a\n\n        \n    b\n\n    c", FALLBACK, true),
    ).toEqual(FOUR);
  });

  test("no clear habit falls back to exactly the unit given", () => {
    const fallback: IndentUnit = spacesIndent(4);

    expect(detectIndentUnit("", fallback, true)).toBe(fallback);
    expect(detectIndentUnit("a\nb\nc", fallback, true)).toBe(fallback);
    expect(detectIndentUnit("a\n        b", fallback, true)).toBe(fallback);
    expect(detectIndentUnit("a\n   b", fallback, true)).toBe(fallback);
  });
});
