import KubectlOutputRedactor from "../../../Utils/AiRemediation/KubectlOutputRedactor";
import { GenericOutputRedactor } from "../../../Utils/AiRemediation/Resource/ResourceOutputRedactor";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A LINE OF CLUSTER OR RESOURCE OUTPUT IS READ FOR ITS KEY IN TIME IN LINE
 * WITH ITS LENGTH, AND THE SAME KEYS ARE FOUND AS BEFORE.
 *
 * The redactors read every line of what kubectl (or a resource tool)
 * printed for a "key: value" - a pod's log lines among it, which whatever
 * runs in the pod writes. An unquoted key runs to the line's first colon;
 * the spaces before that colon now belong to the gap after the key alone,
 * so a line of hundreds of thousands of spaces is read once instead of once
 * per space. Which lines have a key, and what the key is, has not changed:
 * the lines below were masked exactly so before.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

interface Redactor {
  name: string;
  redact: (output: string) => string;
}

const REDACTORS: Array<Redactor> = [
  {
    name: "cluster output redaction",
    redact: (output: string): string => {
      return KubectlOutputRedactor.redact(output).text;
    },
  },
  {
    name: "resource output redaction",
    redact: (output: string): string => {
      return GenericOutputRedactor.redact(output).text;
    },
  },
];

const WORST_CASES: Array<[string, string]> = [
  ["a word, spaces, and no colon", "a" + repeat(" ", LENGTH) + "b"],
  ["a word, tabs, and no colon", "a" + repeat("\t", LENGTH) + "b"],
  [
    "tabs before a colon that ends nothing",
    "\u0000" + repeat("\t", LENGTH) + "\t\u0000:\t\":\t':",
  ],
  ["words and spaces, ending in a quote", repeat("ab ", LENGTH) + '"'],
  ["a key, spaces, and its colon", "password" + repeat(" ", LENGTH) + ": x"],
  ["many such lines", repeat("a" + " ".repeat(5000) + "b\n", LENGTH)],
];

describe.each(REDACTORS)(
  "$name reads a long line in time in line with its length",
  (redactor: Redactor) => {
    test.each(WORST_CASES)("%s", (_label: string, output: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactor.redact(output);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    });
  },
);

/*
 * Outputs and how they were masked before the key pattern changed (each
 * one run through the earlier redactor): the key a line names, with any
 * spaces or tabs before its colon, and the lines that name none.
 */
const MASKED_AS_BEFORE: Array<[string, string]> = [
  ["password: hunter2", "password: [redacted]"],
  ["password:hunter2", "password:[redacted]"],
  ["password  : hunter2", "password  : [redacted]"],
  ["password\t:\thunter2", "password\t:\t[redacted]"],
  ["DB_PASSWORD    :    hunter2", "DB_PASSWORD    :    [redacted]"],
  [
    "password" + "\t".repeat(30) + ":\thunter2",
    "password" + "\t".repeat(30) + ":\t[redacted]",
  ],
  ["  token:   abc.def", "  token:   [redacted]"],
  ["- password: hunter2", "- password: [redacted]"],
  ['"password": "hunter2",', '"password": "[redacted]",'],
  ["'password': 'hunter2'", "'password': '[redacted]'"],
  [
    "connecting DB_PASSWORD=hunter2 host: db",
    "connecting DB_PASSWORD=[redacted] host: [redacted]",
  ],
  ["client secret \u00a0: hunter2", "client secret \u00a0: [redacted]"],
  [
    "  aws_secret_access_key :   wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "  aws_secret_access_key :   [redacted]",
  ],
  [
    "Labels:   app=web\nAnnotations:   token: abc123",
    "Labels:   app=web\nAnnotations:   token: [redacted]",
  ],
  ["Image ID:   docker://sha256:abc", "Image ID:   docker://sha256:abc"],
  ["started 2026-09-22T10:00:00Z ok", "started 2026-09-22T10:00:00Z ok"],
  ["key: value: more", "key: value: more"],
  ["api key   :  sk-123456789", "api key   :  sk-123456789"],
  ["secret   :", "secret   :"],
  ["a b c", "a b c"],
  ["#password: hunter2", "#password: hunter2"],
  ["a" + " ".repeat(50) + ": hunter2", "a" + " ".repeat(50) + ": hunter2"],
];

describe.each(REDACTORS)(
  "$name finds the keys it found before",
  (redactor: Redactor) => {
    test.each(MASKED_AS_BEFORE)("%j", (output: string, masked: string) => {
      expect(redactor.redact(output)).toBe(masked);
    });
  },
);
