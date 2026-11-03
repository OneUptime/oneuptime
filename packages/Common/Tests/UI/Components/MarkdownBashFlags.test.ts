import { describe, expect, test } from "@jest/globals";
import {
  BASH_FLAG_PATTERN,
  PrismLanguageDefinition,
  PrismLanguages,
  withFlagsOfSeveralWords,
} from "../../../UI/Components/Markdown.tsx/BashFlags";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A bash code block colours every flag of a command, those of several
 * words too (UI/Components/Markdown.tsx/BashFlags). Prism's own pattern
 * ended a flag at its first hyphen, so the Developer > CLI pages showed
 * --json coloured and --incident-severity-id plain, in the same command.
 */

// Prism's own pattern for bash's parameter token, as refractor 5 ships it.
const PRISM_PARAMETER: RegExp =
  /(^|\s)-{1,2}(?:\w+:[+-]?)?\w+(?:\.\w+)*(?=[=\s]|$)/;

/*
 * The flags of a line as Prism colours them: each match past its first
 * group, which Prism reads as a lookbehind (the token's lookbehind: true).
 */
function flagsIn(pattern: RegExp, line: string): Array<string> {
  const flags: Array<string> = [];

  for (const match of line.matchAll(new RegExp(pattern, "g"))) {
    flags.push(match[0].slice((match[1] || "").length));
  }

  return flags;
}

const UPDATE: string =
  "oneuptime incident update 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11 --incident-severity-id 1d7b0c3e-2a4f-4b6c-8d9e-0f1a2b3c4d5e --json";

describe("flags of several words in a bash code block", () => {
  test("are coloured as flags of one word are, where Prism's pattern left them plain", () => {
    expect(flagsIn(PRISM_PARAMETER, UPDATE)).toEqual(["--json"]);
    expect(flagsIn(BASH_FLAG_PATTERN, UPDATE)).toEqual([
      "--incident-severity-id",
      "--json",
    ]);
    expect(
      flagsIn(
        BASH_FLAG_PATTERN,
        "  --should-status-page-subscribers-be-notified-on-incident-created true \\",
      ),
    ).toEqual([
      "--should-status-page-subscribers-be-notified-on-incident-created",
    ]);
    // On a line of their own, as a long command lays them out.
    expect(flagsIn(BASH_FLAG_PATTERN, "  --monitor-steps '{")).toEqual([
      "--monitor-steps",
    ]);
  });

  test("still colours every flag Prism coloured, and only those, where no flag has several words", () => {
    for (const line of [
      "rm -rf /tmp/build",
      "oneuptime incident list --limit 10 --json",
      "curl -fsSL https://oneuptime.com/install/cli -o install.sh",
      "oneuptime incident list --fields=title,createdAt",
      "python -m http.server --bind 127.0.0.1",
      "terraform plan -var region=eu --a.b",
      "echo $((1 - 2)) -5",
    ]) {
      expect({ line, flags: flagsIn(BASH_FLAG_PATTERN, line) }).toEqual({
        line,
        flags: flagsIn(PRISM_PARAMETER, line),
      });
    }

    expect(flagsIn(BASH_FLAG_PATTERN, "curl -fsSL x -o install.sh")).toEqual([
      "-fsSL",
      "-o",
    ]);
  });

  test("colour nothing that is not a flag: an ID, a date, a word with dashes inside, dashes alone", () => {
    for (const line of [
      "oneuptime incident get 6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11",
      "starts at 2026-11-01T10:00:00Z",
      "a--b and co-op",
      "--",
      "---",
      "echo - --- ---x",
    ]) {
      expect({ line, flags: flagsIn(BASH_FLAG_PATTERN, line) }).toEqual({
        line,
        flags: [],
      });
    }
  });

  test("replace the pattern of bash's parameter token, wherever the grammar shares it", () => {
    const parameter: Record<string, unknown> = {
      pattern: PRISM_PARAMETER,
      alias: "variable",
      lookbehind: true,
    };
    const string: Record<string, unknown> = {
      pattern: /"[^"]*"/,
      // The commands inside $( ) share the same token.
      inside: { parameter },
    };
    const bash: PrismLanguageDefinition = (prism: PrismLanguages): void => {
      prism.languages["bash"] = { parameter, string };
    };

    bash.displayName = "bash";
    bash.aliases = ["sh", "shell"];

    const prism: PrismLanguages = { languages: {} };
    const withFlags: PrismLanguageDefinition = withFlagsOfSeveralWords(bash);

    withFlags(prism);

    expect(parameter).toEqual({
      pattern: BASH_FLAG_PATTERN,
      alias: "variable",
      lookbehind: true,
    });
    expect(
      (string["inside"] as Record<string, Record<string, unknown>>)[
        "parameter"
      ]?.["pattern"],
    ).toBe(BASH_FLAG_PATTERN);
    expect(string["pattern"]).not.toBe(BASH_FLAG_PATTERN);
    // Registered by the same name and aliases as Prism's bash.
    expect(withFlags.displayName).toBe("bash");
    expect(withFlags.aliases).toEqual(["sh", "shell"]);
  });

  test("leave a grammar without a parameter token as it is", () => {
    const bash: PrismLanguageDefinition = (prism: PrismLanguages): void => {
      prism.languages["bash"] = { comment: { pattern: /#.*/ } };
    };
    const prism: PrismLanguages = { languages: {} };

    expect(() => {
      withFlagsOfSeveralWords(bash)(prism);
    }).not.toThrow();
    expect(prism.languages["bash"]).toEqual({ comment: { pattern: /#.*/ } });
  });

  test("are found in time that grows with the text, on a code block somebody else wrote", () => {
    /*
     * The longest scans: a flag that runs on, word after word, and never
     * ends where a flag may, and one long word that might have been
     * followed by a colon; a third of the text each.
     */
    const text: string = [
      ` --${"ab-".repeat(44000)}`,
      ` -${"a".repeat(132000)}:`,
      ` --x${" -a-".repeat(33000)}`,
    ].join("");

    expect(text.length).toBeGreaterThan(390000);

    const found: FastestRun<number> = fastestRun({
      run: (): number => {
        return flagsIn(BASH_FLAG_PATTERN, text).length;
      },
      limitInMs: 2000,
    });

    expect(found.inMs).toBeLessThan(2000);
  });
});
