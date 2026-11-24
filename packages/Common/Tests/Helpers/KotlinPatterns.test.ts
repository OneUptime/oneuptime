/*
 * The agents' Kotlin, read for its regular expressions (KotlinPatterns.ts):
 * each string literal outside comments, with Kotlin's escapes decoded; the
 * files of the agents' product code; and a Java pattern as JavaScript reads
 * it, in the same steps, or refused with the reason.
 */

import { generatedTexts } from "./GeneratedTexts";
import {
  JavaScriptPattern,
  KotlinStringLiteral,
  WordEdge,
  differentWordEdges,
  javaScriptForm,
  kotlinProductFiles,
  kotlinStringLiterals,
} from "./KotlinPatterns";
import { REPOSITORY_DIRECTORY } from "./TagStripScan";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const AGENT_REDACTOR: string =
  "agents/AndroidAgent/app/src/main/java/com/oneuptime/androidagent/logs/Redactor.kt";

// Each literal as [value, line, hasTemplate].
const literalsOf: (kotlin: string) => Array<[string, number, boolean]> = (
  kotlin: string,
): Array<[string, number, boolean]> => {
  return kotlinStringLiterals(kotlin).map(
    (literal: KotlinStringLiteral): [string, number, boolean] => {
      return [literal.value, literal.line, literal.hasTemplate];
    },
  );
};

describe("the string literals of a Kotlin file", () => {
  test("a raw string as written, and a string with its escapes decoded", () => {
    const kotlin: string = String.raw`val raw: Regex = Regex("""\beyJ[A-Za-z0-9_-]{5}\.\u00e9""")
val plain: Regex = Regex("\\d+\"x\u00e9\$\t")`;

    expect(literalsOf(kotlin)).toEqual([
      [String.raw`\beyJ[A-Za-z0-9_-]{5}\.\u00e9`, 1, false],
      ['\\d+"x\u00e9$\t', 2, false],
    ]);
  });

  test("nothing in a comment, a character literal or a name in backticks", () => {
    const kotlin: string = String.raw`// "not this"
/* "nor this" /* "nor this, nested" */ "nor this" */
val quote: Char = '"'
val apostrophe: Char = '\''
fun ${"`"}a "quoted" name${"`"}() = "this one"`;

    expect(literalsOf(kotlin)).toEqual([["this one", 5, false]]);
  });

  test("a template is kept as written, and said", () => {
    const kotlin: string = String.raw`val a = "a$b"
val b = "${"$"}{x.y}z"
val c = """^\d+$"""
val d = "\$e"
val f = """$"""`;

    expect(literalsOf(kotlin)).toEqual([
      ["a$b", 1, true],
      ["${x.y}z", 2, true],
      [String.raw`^\d+$`, 3, false],
      ["$e", 4, false],
      ["$", 5, false],
    ]);
  });

  test("a raw string ends at the last three quotes of a run, and over lines", () => {
    const kotlin: string = String.raw`val a = """"quoted""""
val b = """one
two"""
val c = "after"`;

    expect(literalsOf(kotlin)).toEqual([
      ['"quoted"', 1, false],
      ["one\ntwo", 2, false],
      ["after", 4, false],
    ]);
  });

  test("the agent's redactor gives its token pattern whole", () => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, AGENT_REDACTOR),
      "utf8",
    );
    const tokenPatterns: Array<string> = kotlinStringLiterals(text)
      .map((literal: KotlinStringLiteral): string => {
        return literal.value;
      })
      .filter((value: string): boolean => {
        return value.includes("eyJ[A-Za-z0-9_-]");
      });

    expect(tokenPatterns).toEqual([
      String.raw`(?<![A-Za-z0-9_-])(?>((?:[A-Za-z0-9_-]*?-)??)(?=eyJ))eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*`,
    ]);
  });

  test("a literal says where it starts", () => {
    const kotlin: string = 'val a = "x"\nval b = """y"""';

    expect(
      kotlinStringLiterals(kotlin).map(
        (literal: KotlinStringLiteral): number => {
          return literal.start;
        },
      ),
    ).toEqual([kotlin.indexOf('"x"'), kotlin.indexOf('"""y"""')]);
  });

  test("a literal handed to Regex(...) or Pattern.compile(...), or made one with .toRegex(), is a pattern", () => {
    const kotlin: string = String.raw`val a = Regex("a")
val b =
    Regex(
        // What it matches.
        """b""",
    )
val c = Pattern.compile("c")
val d = java.util.regex.Pattern.compile("d")
val e = kotlin.text.Regex(pattern = "e")
val f = "f".toRegex()
val g = """g"""
    .toRegex(RegexOption.IGNORE_CASE)
val h = line.split(Regex("\\s+"))
val i = Regex("""i""", RegexOption.MULTILINE)
val j = MyRegex("j")
val k = Regex.fromLiteral("k")
val l = Regex.escape("l")
val m = "m"
val n = Regex("n" + "o")
val p = Regex(/* the pattern */ "p")
val q = "Regex(" + "q"`;

    expect(
      kotlinStringLiterals(kotlin).map(
        (literal: KotlinStringLiteral): [string, boolean] => {
          return [literal.value, literal.isPattern];
        },
      ),
    ).toEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", true],
      ["f", true],
      ["g", true],
      [String.raw`\s+`, true],
      ["i", true],
      ["j", false],
      ["k", false],
      ["l", false],
      ["m", false],
      // A pattern built from pieces is read by its first.
      ["n", true],
      ["o", false],
      ["p", true],
      ["Regex(", false],
      ["q", false],
    ]);
  });

  test("the agent's redactor gives each of its patterns, and nothing else, as a pattern", () => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, AGENT_REDACTOR),
      "utf8",
    );
    const patterns: Array<string> = kotlinStringLiterals(text)
      .filter((literal: KotlinStringLiteral): boolean => {
        return literal.isPattern;
      })
      .map((literal: KotlinStringLiteral): string => {
        return literal.value;
      });

    // The card's start, the address, the credential, the token and the secret's value.
    expect(patterns).toHaveLength(5);
    expect(patterns[0]).toContain("(?=([2-6]");
    expect(patterns[1]).toContain("@[A-Za-z0-9-]{1,63}");
    expect(patterns[2]).toContain("(bearer|basic)");
    expect(patterns[3]).toContain("eyJ[A-Za-z0-9_-]{5}");
    expect(patterns[4]).toContain("password|passwd");
  });
});

describe("the agents' Kotlin product files", () => {
  let root: string = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kotlin-patterns-"));

    for (const file of [
      "agents/One/app/src/main/java/A.kt",
      "agents/One/app/src/main/java/B.java",
      "agents/One/app/src/test/java/C.kt",
      "agents/One/app/src/androidTest/java/D.kt",
      "agents/One/app/build/generated/src/main/E.kt",
      "agents/One/.gradle/src/main/F.kt",
      "agents/Two/src/main/kotlin/G.kt",
      "packages/Other/src/main/H.kt",
    ]) {
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("are the Kotlin files under a src/main folder of agents/, and no others", () => {
    expect(kotlinProductFiles(root)).toEqual([
      "agents/One/app/src/main/java/A.kt",
      "agents/Two/src/main/kotlin/G.kt",
    ]);
  });

  test("are none where there is no agents/ folder", () => {
    expect(kotlinProductFiles(path.join(root, "packages"))).toEqual([]);
  });

  test("hold the Android agent's redactor, and no test", () => {
    const files: Array<string> = kotlinProductFiles();

    expect(files).toContain(AGENT_REDACTOR);

    for (const file of files) {
      expect(file).toMatch(/^agents\/.*\/src\/main\/.*\.kt$/);
    }
  });
});

describe("a Java pattern as JavaScript reads it", () => {
  const agents: string = String.raw`(?<![A-Za-z0-9_-])(?>((?:[A-Za-z0-9_-]*?-)??)(?=eyJ))eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*`;

  test("an atomic group is a look-ahead read again, numbered as JavaScript numbers it", () => {
    expect(javaScriptForm(agents)).toEqual({
      source: String.raw`(?<![A-Za-z0-9_-])(?=(((?:[A-Za-z0-9_-]*?-)??)(?=eyJ)))\1eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*`,
      flags: "",
    });
    expect(javaScriptForm("(a)(?>(b)c)d").source).toBe(
      String.raw`(a)(?=((b)c))\2d`,
    );
    expect(javaScriptForm("(?>(?>a)b)").source).toBe(
      String.raw`(?=((?=(a))\2b))\1`,
    );
    expect(javaScriptForm("(?<year>a)(?>b)").source).toBe(
      String.raw`(?<year>a)(?=(b))\2`,
    );
  });

  test("an atomic group keeps its first match, as Java's does", () => {
    const matches: (java: string, text: string) => string | null = (
      java: string,
      text: string,
    ): string | null => {
      const form: JavaScriptPattern = javaScriptForm(java);

      return new RegExp(form.source, form.flags).exec(text)?.[0] ?? null;
    };

    // Java: (?>a|ab) settles on "a", and gives none of it back for "c".
    expect(matches("(?>a|ab)c", "abc")).toBeNull();
    expect(matches("(?>ab|a)c", "ac")).toBe("ac");
    expect(matches("(?>a*)a", "aaa")).toBeNull();
    expect(matches("(?>a*)b", "aaab")).toBe("aaab");
  });

  test("the agent's token pattern takes out the tokens a search from every place outside a word does, on drawn texts", () => {
    const form: JavaScriptPattern = javaScriptForm(agents);
    const now: RegExp = new RegExp(form.source, `${form.flags}g`);
    // JavaScript's \b is ASCII's, so here the pattern before #10835 reads as the one written out.
    const before: RegExp =
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
    const outsideAWord: RegExp =
      /(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
    const texts: Array<string> = generatedTexts(20000, 10786, [
      "eyJ",
      "eyJabcde",
      "-",
      "-eyJ",
      ".",
      ".abcde",
      "a",
      "abcde",
      "x",
      " ",
      "\u00e9",
      "\u4e2d",
      "\u0301",
      "\u200b",
      "_",
      "eyJab-",
    ]);
    let withToken: number = 0;

    for (const text of texts) {
      const expected: string = text.replace(outsideAWord, "[token]");

      if (expected !== text) {
        withToken++;
      }

      expect({
        text,
        redacted: text.replace(now, "$1[token]"),
        before: text.replace(before, "[token]"),
      }).toEqual({
        text,
        redacted: expected,
        before: expected,
      });
    }

    expect(withToken).toBeGreaterThan(texts.length / 50);
  });

  test("flags it opens with are flags", () => {
    expect(javaScriptForm("(?i)abc")).toEqual({ source: "abc", flags: "i" });
    expect(javaScriptForm("(?is)a.c")).toEqual({ source: "a.c", flags: "is" });
  });

  test("what both read alike is written as it is", () => {
    for (const java of [
      String.raw`a*?b+?c??d{2,3}?e{4}f{5,}`,
      String.raw`\.\-\\\/\[\]\(\)\{\}\*\+\?\|\^\$`,
      String.raw`\d\D\w\W\s\S\b\B\t\n\r\f`,
      String.raw`\u00e9\x41`,
      String.raw`(?:a|b)(?=c)(?!d)(?<=e)(?<!f)`,
      String.raw`[A-Za-z0-9_-][^\s,;&)\]\}]`,
    ]) {
      expect(javaScriptForm(java)).toEqual({ source: java, flags: "" });
    }

    // A "]" first in a Java class is one of its characters.
    expect(javaScriptForm("[]a]").source).toBe(String.raw`[\]a]`);
    expect(javaScriptForm("[^]a]").source).toBe(String.raw`[^\]a]`);
  });

  test("what JavaScript reads otherwise is refused, with the reason", () => {
    const refusals: Array<[string, string]> = [
      ["a*+", "a possessive repeat"],
      ["a++", "a possessive repeat"],
      ["a?+", "a possessive repeat"],
      ["a{2}+", "a possessive repeat"],
      ["(ab)*+", "a possessive repeat"],
      [String.raw`(a)\1`, "a back-reference"],
      [String.raw`(?<n>a)\k<n>`, "a back-reference"],
      ["a(?i)b", "an inline flag or a group of another kind"],
      ["(?i:a)", "an inline flag or a group of another kind"],
      ["(?-i)a", "an inline flag or a group of another kind"],
      ["(?u)a", 'the inline flag "u"'],
      [String.raw`\Q.\E`, String.raw`the escape "\Q"`],
      [String.raw`\p{L}`, String.raw`the escape "\p"`],
      [String.raw`\h`, String.raw`the escape "\h"`],
      [String.raw`\v`, String.raw`the escape "\v"`],
      [String.raw`\A`, String.raw`the escape "\A"`],
      [String.raw`\z`, String.raw`the escape "\z"`],
      [String.raw`\0`, String.raw`the escape "\0"`],
      [String.raw`\x{41}`, String.raw`the escape "\x"`],
      [String.raw`[\b]`, String.raw`"\b" in a class`],
      ["[a[b]]", "a class inside a class"],
      ["[a-z&&[^b]]", "an intersection of classes"],
      ["(a", "a class or a group that is not closed"],
      ["[a", "a class or a group that is not closed"],
      ["a)", 'a ")" that closes no group'],
    ];

    for (const [java, reason] of refusals) {
      expect({ java, error: errorOf(java) }).toEqual({
        java,
        error: `javaScriptForm does not write ${reason} for JavaScript, in /${java}/.`,
      });
    }
  });
});

describe("where a Java pattern reads a word's edge otherwise on Android", () => {
  // Each finding as "what@index in lookAround".
  const edgesOf: (java: string) => Array<string> = (
    java: string,
  ): Array<string> => {
    return differentWordEdges(java).map((edge: WordEdge): string => {
      return `${edge.what}@${edge.index} in ${edge.lookAround ?? "none"}`;
    });
  };

  test("a word boundary, anywhere", () => {
    expect(edgesOf(String.raw`\beyJ`)).toEqual([String.raw`\b@0 in none`]);
    expect(edgesOf(String.raw`(?=\beyJ)`)).toEqual([String.raw`\b@3 in (?=`]);
    expect(edgesOf(String.raw`x\B`)).toEqual([String.raw`\B@1 in none`]);
    expect(edgesOf(String.raw`(?i)\b(bearer|basic)\s+`)).toEqual([
      String.raw`\b@4 in none`,
    ]);
  });

  test("a shorthand class or a POSIX class in a look-around, and not outside one", () => {
    expect(
      edgesOf(String.raw`(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])`),
    ).toEqual([String.raw`\w@5 in (?<!`, String.raw`\w@34 in (?!`]);
    expect(
      edgesOf(String.raw`(?<!\W)(?<=\d)(?!\D)(?=\s)(?<!\S)a`).map(
        (edge: string): string => {
          return edge.split("@")[0]!;
        },
      ),
    ).toEqual(["\\W", "\\d", "\\D", "\\s", "\\S"]);
    expect(edgesOf(String.raw`(?<!\p{Alpha})(?!\P{Digit})`)).toEqual([
      String.raw`\p{Alpha}@4 in (?<!`,
      String.raw`\P{Digit}@17 in (?!`,
    ]);
    // Unicode's own classes and properties read alike on both.
    expect(
      edgesOf(
        String.raw`(?<!\p{L})(?<!\p{IsAlphabetic})(?<!\pL)(?<!\p{IsDigit})`,
      ),
    ).toEqual([]);
    // Outside a look-around a class takes in what it reads, and no edge moves.
    expect(
      edgesOf(String.raw`^([A-Za-z_$][\w$]*(?:\.[\w$]+)+)(?::\s?(.*))?$`),
    ).toEqual([]);
    expect(edgesOf(String.raw`(?<word>\w+)\p{Alpha}`)).toEqual([]);
  });

  test("a look-around inside another is told by the inner one", () => {
    expect(edgesOf(String.raw`(?=(?<!\w)x)`)).toEqual([
      String.raw`\w@7 in (?<!`,
    ]);
    expect(edgesOf(String.raw`(?=(a)(?:b)\w)`)).toEqual([
      String.raw`\w@11 in (?=`,
    ]);
  });

  test("an ASCII letter in a look-around read case-insensitively, once each", () => {
    expect(edgesOf(String.raw`(?i)(?<![A-Za-z0-9_])x`)).toEqual([
      "A@9 in (?<!",
    ]);
    expect(edgesOf(String.raw`(?i:(?<![a-z])(?!k))`)).toEqual([
      "a@9 in (?<!",
      "k@17 in (?!",
    ]);
    expect(edgesOf(String.raw`(?i)(?<!\Qab\E)`)).toEqual(["a@10 in (?<!"]);
    // Turned on after the look-around, off for it, or nothing in it a letter: read alike.
    expect(edgesOf(String.raw`(?<![A-Za-z0-9_])(?i)(bearer|basic)`)).toEqual(
      [],
    );
    expect(edgesOf(String.raw`(?i)(?-i:(?<![a-z]))(?-i)(?<![a-z])`)).toEqual(
      [],
    );
    expect(edgesOf(String.raw`(?i)(?<![0-9_.\-])x`)).toEqual([]);
    expect(edgesOf(String.raw`(a(?i)b)(?<![a-z])`)).toEqual([]);
  });

  test("escapes, quoted text and classes are read as Java reads them", () => {
    // An escaped backslash, then a plain b.
    expect(edgesOf(String.raw`\\b`)).toEqual([]);
    expect(edgesOf(String.raw`\Q\b\w\E(?<!\Q\w\E)`)).toEqual([]);
    // In a class, \b is no boundary (Java refuses it).
    expect(edgesOf(String.raw`[\b]`)).toEqual([]);
    // A class inside a class, a "]" first in a class, and an escaped bracket.
    expect(edgesOf(String.raw`(?<![a[\w]])`)).toEqual([
      String.raw`\w@7 in (?<!`,
    ]);
    expect(edgesOf(String.raw`(?<![]\w])`)).toEqual([String.raw`\w@6 in (?<!`]);
    expect(edgesOf(String.raw`(?<![\]\w])`)).toEqual([
      String.raw`\w@7 in (?<!`,
    ]);
    // Escapes with more after their letter: no letter of theirs is text, even read case-insensitively.
    expect(
      edgesOf(String.raw`(?i)(?<!\x41\x{42}\u0043\0101\cA\k<n>\N{SPACE}\t)`),
    ).toEqual([]);
  });

  test("the agent's patterns before #10835 are told, and its patterns now are not", () => {
    const before: Array<string> = [
      String.raw`(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])`,
      String.raw`(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])`,
      String.raw`(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}`,
      String.raw`(?<![A-Za-z0-9_-])(?>((?:[A-Za-z0-9_-]*?-)??)(?=\beyJ))eyJ[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{5}[A-Za-z0-9_-]*`,
      String.raw`(?i)((?<![\w-])["']?[\w-]{0,40}?(?:password|token)["']?\s{0,8}[:=]\s{0,8})([^\s,;&)\]\}]+)`,
      String.raw`^"([^"]*)".*\btid=\d+.*$`,
    ];

    for (const java of before) {
      expect({ java, told: differentWordEdges(java).length > 0 }).toEqual({
        java,
        told: true,
      });
    }

    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, AGENT_REDACTOR),
      "utf8",
    );

    for (const literal of kotlinStringLiterals(text)) {
      expect({ pattern: literal.value, edges: edgesOf(literal.value) }).toEqual(
        { pattern: literal.value, edges: [] },
      );
    }
  });

  test("each finding says what to write", () => {
    const reasons: Array<string> = differentWordEdges(
      String.raw`\b(?<!\w)(?<!\d)(?<!\s)(?<!\p{Alpha})(?i)(?<!a)`,
    ).map((edge: WordEdge): string => {
      return edge.reason;
    });

    expect(reasons).toHaveLength(6);
    expect(reasons[0]).toContain("write (?<![A-Za-z0-9_]) or (?![A-Za-z0-9_])");
    expect(reasons[1]).toContain("write [A-Za-z0-9_]");
    expect(reasons[2]).toContain("write [0-9]");
    expect(reasons[3]).toContain("written out");
    expect(reasons[4]).toContain("write the ASCII class out");
    expect(reasons[5]).toContain("turn (?i) on after the look-around");
  });
});

// What javaScriptForm says when it refuses a pattern, or nothing.
function errorOf(java: string): string | null {
  try {
    javaScriptForm(java);
  } catch (error) {
    return (error as Error).message;
  }

  return null;
}
