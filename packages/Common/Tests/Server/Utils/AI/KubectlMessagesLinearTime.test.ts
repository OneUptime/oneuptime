import KubectlJobRunner from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { patternWith } from "../../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * KUBECTL'S MESSAGES ARE READ IN TIME IN LINE WITH THEIR LENGTH.
 *
 * Whether a kubectl that failed failed for the cluster's AI access is read
 * from its stderr, line by line - and a line is whatever a Runner reported,
 * of any length. Two messages have something between two phrases ("The
 * connection to the server ... was refused", ' is forbidden: User "..."
 * cannot '), and their patterns were tried from every time the first phrase
 * was written on a line, each try reading on to the line's end: time that
 * grows with the square of the line's length. Each is now looked for from
 * the first time the first phrase is written on a line only - what follows
 * a later one follows the first too - and says what it said before.
 * ---------------------------------------------------------------------------
 */

const KUBECTL_FILE: string =
  "packages/Common/Server/Utils/AI/ClusterAccess/KubectlJobRunner.ts";

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

// The patterns as they were, and the ones the product runs now.
const REFUSED_BEFORE: RegExp = /The connection to the server .+ was refused/;
const FORBIDDEN_BEFORE: RegExp = / is forbidden: User ".*" cannot /;
const REFUSED_NOW: RegExp = patternWith(KUBECTL_FILE, " was refused");
const FORBIDDEN_NOW: RegExp = patternWith(KUBECTL_FILE, '".*" cannot ');

// A kubectl that ran, exited non-zero and wrote `stderr`.
const failedKubectl: (stderr: string) => boolean = (
  stderr: string,
): boolean => {
  return KubectlJobRunner.isAccessFailure({
    status: RunnerJobStatus.Failed,
    exitCode: 1,
    output: `[stdout]\n\n[stderr]\n${stderr}`,
    errorMessage: "Exit code 1",
  });
};

describe("a line built to be slow is read quickly", () => {
  test.each([
    [
      "the first phrase over and over",
      repeat("The connection to the server d", LENGTH) +
        "\nThe connection to the server d was refused",
    ],
    [
      "the forbidden phrase over and over",
      repeat('n is forbidden: User "', LENGTH) +
        '\n is forbidden: User "" cannot ',
    ],
    ["a long line of one character", repeat("x", LENGTH)],
    [
      "phrases split by line separators",
      repeat("The connection to the server \u2028", LENGTH),
    ],
  ])("%s", (_label: string, stderr: string) => {
    let isAccess: boolean | undefined;

    expect(
      timeOf(() => {
        isAccess = failedKubectl(stderr);
      }),
    ).toBeLessThan(2000);
    expect(typeof isAccess).toBe("boolean");
  });

  test("a refusal after a long line is still access", () => {
    expect(
      failedKubectl(
        repeat("x", LENGTH) +
          "\nThe connection to the server 10.0.0.1:6443 was refused - did you specify the right host or port?",
      ),
    ).toBe(true);
  });
});

describe("each message is found where it was found before", () => {
  test.each([
    ["the refused connection", REFUSED_BEFORE, (): RegExp => REFUSED_NOW, [
      "The connection to the server ",
      "The connection to the server",
      " was refused",
      "was refused",
      "x",
      " ",
      "\r",
      "\u2028",
      "\n",
      "T",
    ]],
    ["the forbidden user", FORBIDDEN_BEFORE, (): RegExp => FORBIDDEN_NOW, [
      ' is forbidden: User "',
      ' is forbidden: User ',
      '" cannot ',
      '"',
      "x",
      " ",
      "\r",
      "\u2028",
      "\n",
      "cannot",
    ]],
  ])(
    "%s, on forty thousand drawn lines",
    (
      _label: string,
      before: RegExp,
      now: () => RegExp,
      alphabet: ReadonlyArray<string>,
    ) => {
      const differences: Array<string> = [];
      let found: number = 0;

      for (const line of generatedTexts(40000, 3301, alphabet, 10)) {
        const expected: boolean = before.test(line);

        found += expected ? 1 : 0;

        if (now().test(line) !== expected) {
          differences.push(JSON.stringify(line));
        }
      }

      expect(differences).toEqual([]);
      expect(found).toBeGreaterThan(1000);
    },
  );

  test("the messages kubectl writes", () => {
    expect(
      failedKubectl(
        "The connection to the server localhost:8080 was refused - did you specify the right host or port?",
      ),
    ).toBe(true);
    expect(
      failedKubectl(
        'Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:oneuptime:ai" cannot list resource "pods" in API group "" in the namespace "web"',
      ),
    ).toBe(true);
    expect(
      failedKubectl('Error from server (NotFound): pods "web-0" not found'),
    ).toBe(false);
  });
});
