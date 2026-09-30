import type {} from "highlight.js";
import hljs from "highlight.js/lib/core";
import "../../../../UI/Components/CodeEditor/CodeEditorHighlight";
import {
  CODE_LANGUAGES,
  CodeLanguage,
  getCodeLanguage,
} from "../../../../UI/Components/CodeEditor/CodeEditorLanguages";
import CodeType from "../../../../Types/Code/CodeType";
import { describe, expect, test } from "@jest/globals";

/*
 * Everything CodeEditor does differently per language lives in this table,
 * so these tests pin the choices that matter to a user: which languages
 * highlight, which may hold tabs, which are checked as you type, which can
 * be formatted, and which wrap.
 */

const ALL_TYPES: Array<CodeType> = Object.values(CodeType);

type RowsWhereFunction = (
  predicate: (language: CodeLanguage) => boolean,
) => Array<CodeType>;

const typesWhere: RowsWhereFunction = (
  predicate: (language: CodeLanguage) => boolean,
): Array<CodeType> => {
  return ALL_TYPES.filter((type: CodeType) => {
    return predicate(CODE_LANGUAGES[type]);
  });
};

describe("CODE_LANGUAGES", () => {
  test.each(ALL_TYPES)("%s has a row with a label", (type: CodeType) => {
    const language: CodeLanguage | undefined = CODE_LANGUAGES[type];

    expect(language).toBeDefined();
    expect(language?.label.trim()).not.toBe("");
  });

  test("has a row for every CodeType and nothing else", () => {
    expect(Object.keys(CODE_LANGUAGES).sort()).toEqual([...ALL_TYPES].sort());
  });

  test("labels are unique, since the toolbar names the language", () => {
    const labels: Array<string> = ALL_TYPES.map((type: CodeType) => {
      return CODE_LANGUAGES[type].label;
    });

    expect(new Set(labels).size).toBe(labels.length);
  });

  test.each(ALL_TYPES)(
    "%s's grammar, if any, is registered with highlight.js",
    (type: CodeType) => {
      const grammar: string | null = CODE_LANGUAGES[type].grammar;

      if (grammar !== null) {
        expect(hljs.getLanguage(grammar)).toBeDefined();
      }
    },
  );

  test("each language highlights with the grammar it should", () => {
    expect(
      ALL_TYPES.map((type: CodeType) => {
        return [type, CODE_LANGUAGES[type].grammar];
      }),
    ).toEqual(
      expect.arrayContaining([
        [CodeType.JSON, "json"],
        [CodeType.YAML, "yaml"],
        [CodeType.JavaScript, "javascript"],
        [CodeType.CSS, "css"],
        [CodeType.HTML, "xml"],
        [CodeType.SQL, "sql"],
        [CodeType.Bash, "bash"],
        [CodeType.Markdown, "markdown"],
        [CodeType.Text, null],
      ]),
    );
  });

  test.each(ALL_TYPES)(
    "%s pairs brackets with their own closers",
    (type: CodeType) => {
      const brackets: Record<string, string> =
        CODE_LANGUAGES[type].rules.brackets;
      const expected: Record<string, string> = {
        "(": ")",
        "[": "]",
        "{": "}",
      };

      for (const [opener, closer] of Object.entries(brackets)) {
        expect(expected[opener]).toBe(closer);
      }
    },
  );

  test.each(ALL_TYPES)("%s's quotes are quote characters", (type: CodeType) => {
    for (const quote of CODE_LANGUAGES[type].rules.quotes) {
      expect(['"', "'", "`"]).toContain(quote);
    }
  });
});

describe("the choices each language makes", () => {
  test("YAML: never a tab, # comments, deeper after key:, tabs drawn, checked as YAML", () => {
    const yaml: CodeLanguage = CODE_LANGUAGES[CodeType.YAML];

    expect(yaml.allowTabs).toBe(false);
    expect(yaml.rules.lineComment).toBe("#");
    expect(yaml.rules.indentAfterColon).toBe(true);
    expect(yaml.showTabs).toBe(true);
    expect(yaml.validator).toBe("yaml");
    expect(yaml.canFormat).toBe(false);
  });

  test("JSON: checked as JSON, can be formatted, no comments, double quotes only", () => {
    const json: CodeLanguage = CODE_LANGUAGES[CodeType.JSON];

    expect(json.validator).toBe("json");
    expect(json.canFormat).toBe(true);
    expect(json.rules.lineComment).toBeNull();
    expect(json.rules.quotes).toEqual(['"']);
    expect(json.rules.brackets).toEqual({ "[": "]", "{": "}" });
  });

  test("Markdown: wraps, follows the caller's spell check, pairs nothing", () => {
    const markdown: CodeLanguage = CODE_LANGUAGES[CodeType.Markdown];

    expect(markdown.wrap).toBe(true);
    expect(markdown.spellCheckFollowsCaller).toBe(true);
    expect(markdown.rules.brackets).toEqual({});
    expect(markdown.rules.quotes).toEqual([]);
  });

  test("Text: no grammar, no pairs, no comments, nothing checked", () => {
    const text: CodeLanguage = CODE_LANGUAGES[CodeType.Text];

    expect(text.grammar).toBeNull();
    expect(text.rules.brackets).toEqual({});
    expect(text.rules.quotes).toEqual([]);
    expect(text.rules.lineComment).toBeNull();
    expect(text.validator).toBeNull();
    expect(text.wrap).toBe(false);
  });

  test("line comments use each language's own token", () => {
    expect(CODE_LANGUAGES[CodeType.JavaScript].rules.lineComment).toBe("//");
    expect(CODE_LANGUAGES[CodeType.SQL].rules.lineComment).toBe("--");
    expect(CODE_LANGUAGES[CodeType.Bash].rules.lineComment).toBe("#");
    expect(CODE_LANGUAGES[CodeType.CSS].rules.lineComment).toBeNull();
    expect(CODE_LANGUAGES[CodeType.HTML].rules.lineComment).toBeNull();
  });

  test("only JSON can be formatted", () => {
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.canFormat;
      }),
    ).toEqual([CodeType.JSON]);
  });

  test("only JSON and YAML are checked as you type", () => {
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.validator !== null;
      }).sort(),
    ).toEqual([CodeType.JSON, CodeType.YAML].sort());
  });

  test("only prose wraps and gets spell check; code scrolls sideways", () => {
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.wrap;
      }),
    ).toEqual([CodeType.Markdown]);
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.spellCheckFollowsCaller;
      }),
    ).toEqual([CodeType.Markdown]);
  });

  test("only YAML refuses tabs and draws them", () => {
    expect(
      typesWhere((language: CodeLanguage) => {
        return !language.allowTabs;
      }),
    ).toEqual([CodeType.YAML]);
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.showTabs;
      }),
    ).toEqual([CodeType.YAML]);
  });

  test("only YAML indents after a colon", () => {
    expect(
      typesWhere((language: CodeLanguage) => {
        return language.rules.indentAfterColon;
      }),
    ).toEqual([CodeType.YAML]);
  });
});

describe("getCodeLanguage", () => {
  test.each(ALL_TYPES)("returns the table's row for %s", (type: CodeType) => {
    expect(getCodeLanguage(type)).toBe(CODE_LANGUAGES[type]);
  });

  test("an unknown type from data falls back to plain text", () => {
    expect(getCodeLanguage("cobol" as CodeType)).toBe(
      CODE_LANGUAGES[CodeType.Text],
    );
    expect(getCodeLanguage(undefined as unknown as CodeType)).toBe(
      CODE_LANGUAGES[CodeType.Text],
    );
  });
});
