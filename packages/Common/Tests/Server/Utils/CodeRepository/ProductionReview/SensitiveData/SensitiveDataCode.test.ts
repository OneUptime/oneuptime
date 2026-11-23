import {
  CodeToken,
  CodeTokenKind,
  getCodeLanguage,
  lastPartOf,
  receiverOf,
  tokenize,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCode";
import {
  extensionOf,
  isGeneratedPath,
  isMarkedNotSensitive,
  isTestPath,
  isVendoredPath,
  PatchLine,
  PatchLineKind,
  readNewLines,
  readPatchLines,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import { fastestRun, FastestRun } from "../../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The text the Sensitive data rules read (#10376): a patch, line by line
 * with the line each has after the change, and code read just far enough -
 * names and their chains, strings and what they interpolate in each
 * language - in time in line with the text, whatever a pull request's
 * author wrote.
 */

function tokensOf(text: string, extension: string = "ts"): Array<CodeToken> {
  const lines: Array<string> = text.split("\n");

  return tokenize({
    lines,
    language: getCodeLanguage(extension),
    line: 0,
    column: 0,
    lastLine: lines.length - 1,
  }).tokens;
}

function namesIn(tokens: Array<CodeToken>): Array<string> {
  const names: Array<string> = [];

  for (const token of tokens) {
    if (token.kind === CodeTokenKind.Name) {
      names.push(token.text);
    }

    for (const part of token.parts) {
      names.push(...namesIn(part));
    }
  }

  return names;
}

describe("a patch, line by line", () => {
  const patch: string = [
    "@@ -10,3 +10,4 @@ export function signup() {",
    " const a = 1;",
    "-logger.info(old);",
    "+logger.info({ email });",
    "+logger.debug(x);",
    " return a;",
    "\\ No newline at end of file",
  ].join("\n");

  test("added and context lines carry their line after the change; removed ones none", () => {
    const lines: Array<PatchLine> = readPatchLines(patch);

    expect(
      lines.map((line: PatchLine): [PatchLineKind, number, string] => {
        return [line.kind, line.newLine, line.text];
      }),
    ).toEqual([
      [PatchLineKind.Context, 10, "const a = 1;"],
      [PatchLineKind.Removed, 0, "logger.info(old);"],
      [PatchLineKind.Added, 11, "logger.info({ email });"],
      [PatchLineKind.Added, 12, "logger.debug(x);"],
      [PatchLineKind.Context, 13, "return a;"],
    ]);
    expect(readNewLines(lines)).toHaveLength(4);
  });

  test("hunks are numbered, and a header that is not one stops reading until one is", () => {
    const lines: Array<PatchLine> = readPatchLines(
      [
        "@@ -1 +1 @@",
        "+a",
        "@@ nonsense",
        "+ignored",
        "@@ -9,1 +20,1 @@",
        "+b",
      ].join("\n"),
    );

    expect(
      lines.map((line: PatchLine): [number, number, string] => {
        return [line.hunk, line.newLine, line.text];
      }),
    ).toEqual([
      [0, 1, "a"],
      [1, 20, "b"],
    ]);
  });

  test("no patch is no lines", () => {
    expect(readPatchLines(null)).toEqual([]);
    expect(readPatchLines("")).toEqual([]);
  });

  test("a line is read only so far", () => {
    const lines: Array<PatchLine> = readPatchLines(
      `@@ -0,0 +1,1 @@\n+${"x".repeat(5000)}`,
    );

    expect(lines[0]!.text.length).toBe(1000);
  });

  test("a line marked not sensitive, or under a comment that marks it, is left alone", () => {
    const lines: Array<PatchLine> = readNewLines(
      readPatchLines(
        [
          "@@ -0,0 +1,6 @@",
          "+  // oneuptime:not-sensitive",
          "+logger.info({ email });",
          "+logger.info({ email }); // OneUptime:Not-Sensitive",
          "+logger.info({ email });",
          "+# oneuptime:not-sensitive",
          "+log.info(email)",
        ].join("\n"),
      ),
    );

    expect(isMarkedNotSensitive(lines, 0)).toBe(true);
    // Under a comment of its own.
    expect(isMarkedNotSensitive(lines, 1)).toBe(true);
    // Marked at its end.
    expect(isMarkedNotSensitive(lines, 2)).toBe(true);
    // A marker at a line's end marks that line, not the one under it.
    expect(isMarkedNotSensitive(lines, 3)).toBe(false);
    expect(isMarkedNotSensitive(lines, 5)).toBe(true);
    expect(
      isMarkedNotSensitive(
        readNewLines(
          readPatchLines("@@ -0,0 +1,2 @@\n+a\n+logger.info({ email });"),
        ),
        1,
      ),
    ).toBe(false);
  });

  test("a comment marks the line under it only when it is right above", () => {
    const lines: Array<PatchLine> = readNewLines(
      readPatchLines(
        [
          "@@ -0,0 +1,1 @@",
          "+// oneuptime:not-sensitive",
          "@@ -10,0 +20,1 @@",
          "+logger.info({ email });",
        ].join("\n"),
      ),
    );

    expect(isMarkedNotSensitive(lines, 1)).toBe(false);
  });
});

describe("what kind of file a path is", () => {
  test.each([
    "src/signup.test.ts",
    "src/signup.spec.js",
    "tests/test_signup.py",
    "pkg/auth/login_test.go",
    "spec/models/user_spec.rb",
    "src/__tests__/signup.ts",
    "test/fixtures/users.json",
    "app/src/test/java/LoginTest.java",
    "src/main/java/LoginTest.java",
    "src/Button.stories.tsx",
    "e2e/login.ts",
    "conftest.py",
  ])("%s is a test or a fixture", (path: string) => {
    expect(isTestPath(path)).toBe(true);
  });

  test.each([
    "src/signup.ts",
    "src/testing-tools.ts",
    "src/latest/api.ts",
    "src/main/java/Contest.java",
    "app/Latest.php",
  ])("%s is the service's own code", (path: string) => {
    expect(isTestPath(path)).toBe(false);
  });

  test("vendored code is a dependency's", () => {
    expect(isVendoredPath("node_modules/left-pad/index.js")).toBe(true);
    expect(isVendoredPath("vendor/github.com/x/y.go")).toBe(true);
    expect(isVendoredPath("src/vendor.ts")).toBe(false);
  });

  test("generated code is said by its path, or its first lines", () => {
    expect(isGeneratedPath("api/v1/user.pb.go", [])).toBe(true);
    expect(isGeneratedPath("src/__generated__/schema.ts", [])).toBe(true);
    expect(
      isGeneratedPath(
        "src/client.ts",
        readPatchLines(
          "@@ -0,0 +1,2 @@\n+// Code generated by openapi. DO NOT EDIT.\n+x",
        ),
      ),
    ).toBe(true);
    expect(
      isGeneratedPath(
        "src/client.ts",
        readPatchLines("@@ -100,1 +100,1 @@\n+// DO NOT EDIT"),
      ),
    ).toBe(false);
    expect(isGeneratedPath("src/client.ts", [])).toBe(false);
  });

  test("an extension is read lower case", () => {
    expect(extensionOf("Infra/Main.TF")).toBe("tf");
    expect(extensionOf("Makefile")).toBe("");
  });
});

describe("code, as far as the rules read it", () => {
  test("a member chain is one name, whatever separates its parts", () => {
    expect(namesIn(tokensOf("user.email"))).toEqual(["user.email"]);
    expect(namesIn(tokensOf("$user->email", "php"))).toEqual(["user.email"]);
    expect(namesIn(tokensOf("Rails::logger.info", "rb"))).toEqual([
      "Rails.logger.info",
    ]);
    expect(namesIn(tokensOf("user?.profile?.email"))).toEqual([
      "user.profile.email",
    ]);
    expect(lastPartOf("user.profile.email")).toBe("email");
    expect(receiverOf("user.profile.email")).toBe("user.profile");
    expect(receiverOf("email")).toBe("");
  });

  test.each([
    ["ts", "`signup ${user.email} now`", ["user.email"]],
    ["py", 'f"signup {user.email}"', ["user.email"]],
    ["py", 'rf"signup {email}"', ["email"]],
    ["rb", '"signup #{user.email}"', ["user.email"]],
    ["ex", '"signup #{email}"', ["email"]],
    ["kt", '"signup $email and ${user.phone}"', ["email", "user.phone"]],
    ["php", '"signup {$user->email} $phone"', ["user.email", "phone"]],
    ["cs", '$"signup {user.Email}"', ["user.Email"]],
    ["swift", '"signup \\(user.email)"', ["user.email"]],
    ["rs", '"signup {email}"', ["email"]],
  ])(
    "a %s string interpolates its values: %s",
    (extension: string, text: string, names: Array<string>) => {
      expect(namesIn(tokensOf(text, extension))).toEqual(names);
    },
  );

  test.each([
    ["ts", '"signup ${email}"'],
    ["ts", "'signup ${email}'"],
    ["py", '"signup {email}"'],
    ["rb", "'signup #{email}'"],
    ["go", '"signup %s"'],
  ])(
    "a %s string that interpolates nothing holds no names: %s",
    (extension: string, text: string) => {
      expect(namesIn(tokensOf(text, extension))).toEqual([]);
    },
  );

  test("comments are left out, in each language's way", () => {
    expect(namesIn(tokensOf("a // email\nb /* phone */ c"))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(namesIn(tokensOf("a # email", "py"))).toEqual(["a"]);
    // "#" is no comment in TypeScript (a private field's name).
    expect(namesIn(tokensOf("this.#email", "ts"))).toContain("email");
  });

  test("a template literal and a triple-quoted string span lines", () => {
    expect(namesIn(tokensOf("`one\n${email}\ntwo` after"))).toEqual([
      "email",
      "after",
    ]);
    expect(namesIn(tokensOf('"""one\n{x}\n""" after', "py"))).toEqual([
      "after",
    ]);
  });

  test("an escaped quote does not end a string", () => {
    expect(namesIn(tokensOf('"a \\" b" email'))).toEqual(["email"]);
  });

  test("reading up to the bracket that is open: a call's arguments", () => {
    const lines: Array<string> = ["logger.info({ email },", "  x) + after"];
    const read: ReturnType<typeof tokenize> = tokenize({
      lines,
      language: getCodeLanguage("ts"),
      line: 0,
      column: "logger.info(".length,
      lastLine: 1,
      untilClosed: true,
    });

    expect(namesIn(read.tokens)).toEqual(["email", "x"]);
  });

  test("punctuation of more than one character is one token", () => {
    expect(
      tokensOf("a => b === c ...d ?? e")
        .filter((token: CodeToken): boolean => {
          return token.kind === CodeTokenKind.Punct;
        })
        .map((token: CodeToken): string => {
          return token.text;
        }),
    ).toEqual(["=>", "===", "...", "??"]);
  });

  test("time in line with the text, whatever it holds", () => {
    const quotes: string = `${'"'.repeat(200000)}`;
    const braces: string = `\`${"${".repeat(100000)}\``;
    const comments: string = "/*".repeat(100000);

    for (const text of [quotes, braces, comments]) {
      const run: FastestRun<number> = fastestRun({
        run: (): number => {
          return tokensOf(text).length;
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});
