import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_DRY_RUN_PREFIX,
  CLOUD_REPLACED_VALUE_PREFIX,
  CLOUD_WRITE_PATH_PREFIX,
  CloudWritePath,
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
  formatCloudWritePath,
  readCloudWritePath,
  withoutCloudWritePath,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The line `cloud whoami` starts its output with, and Test connection
 * reads: whether a change can run as the Cloud AI agent is set up - its
 * write role, identity or account (#6212). Written by the agent, read by
 * the server, so both sides go through these three functions (the agent
 * carries a byte-identical copy of the catalog):
 *
 *  - every state and problem is written as one line and read back as it
 *    was; an unusable path always carries a problem the reader knows;
 *  - only the FIRST line counts, as for a change's replaced value: a later
 *    line, which may quote what the cloud answered, never does;
 *  - anything else - an older agent's output, another command's, a line
 *    that is not JSON, a state or problem it does not know, a line too long
 *    to be one - reads as nothing said;
 *  - what a person reads is the output without that line, and no other.
 */

const REST: string = "Cloud: Azure\nSubscription: 1234";

describe("the write-path line", () => {
  test.each<[CloudWritePath, string]>([
    [{ state: "usable" }, '{"state":"usable"}'],
    [{ state: "unset" }, '{"state":"unset"}'],
    [
      { state: "unusable", problem: "cannot-sign-in" },
      '{"state":"unusable","problem":"cannot-sign-in"}',
    ],
    [
      { state: "unusable", problem: "unreadable-setting" },
      '{"state":"unusable","problem":"unreadable-setting"}',
    ],
    [
      { state: "unusable", problem: "another-account" },
      '{"state":"unusable","problem":"another-account"}',
    ],
  ])(
    "%j is written as one line and read back",
    (path: CloudWritePath, json: string) => {
      const line: string = formatCloudWritePath(path);

      expect(line).toBe(`${CLOUD_WRITE_PATH_PREFIX}${json}`);
      expect(line).not.toContain("\n");
      expect(readCloudWritePath(`${line}\n${REST}`)).toEqual(path);
      // A line on its own, as the output of an agent that printed nothing else.
      expect(readCloudWritePath(line)).toEqual(path);
    },
  );

  test("a problem is written only for an unusable path, and an unusable one always has one", () => {
    expect(
      formatCloudWritePath({ state: "usable", problem: "cannot-sign-in" }),
    ).toBe(`${CLOUD_WRITE_PATH_PREFIX}{"state":"usable"}`);
    expect(formatCloudWritePath({ state: "unusable" })).toBe(
      `${CLOUD_WRITE_PATH_PREFIX}{"state":"unusable","problem":"cannot-sign-in"}`,
    );
  });

  test("only the first line counts: a later one, quoting what the cloud answered, never does", () => {
    const later: string = `${REST}\n${formatCloudWritePath({ state: "unusable", problem: "cannot-sign-in" })}`;

    expect(readCloudWritePath(later)).toBeNull();
    expect(
      readCloudWritePath(
        `${formatCloudWritePath({ state: "usable" })}\n${formatCloudWritePath({ state: "unusable", problem: "another-account" })}`,
      ),
    ).toEqual({ state: "usable" });
  });

  test.each<[string, unknown]>([
    ["an older agent's output", REST],
    ["no output", ""],
    ["not text", 42],
    ["null", null],
    [
      "a dry run's verdict",
      `${formatCloudDryRunVerdict("would-run")}\n${REST}`,
    ],
    [
      "a change's replaced value",
      `${formatCloudReplacedValue({ count: "2" })}\n${REST}`,
    ],
    ["the prefix and no JSON", `${CLOUD_WRITE_PATH_PREFIX}nope\n${REST}`],
    ["a JSON list", `${CLOUD_WRITE_PATH_PREFIX}["usable"]`],
    ["JSON null", `${CLOUD_WRITE_PATH_PREFIX}null`],
    ["a state it does not know", `${CLOUD_WRITE_PATH_PREFIX}{"state":"fine"}`],
    ["no state", `${CLOUD_WRITE_PATH_PREFIX}{"problem":"cannot-sign-in"}`],
    [
      "an unusable path with a problem it does not know",
      `${CLOUD_WRITE_PATH_PREFIX}{"state":"unusable","problem":"gremlins"}`,
    ],
    [
      "an unusable path with no problem",
      `${CLOUD_WRITE_PATH_PREFIX}{"state":"unusable"}`,
    ],
    [
      "a line too long to be one",
      `${CLOUD_WRITE_PATH_PREFIX}{"state":"usable","x":"${"a".repeat(3000)}"}`,
    ],
    [
      "the prefix in another case",
      `${CLOUD_WRITE_PATH_PREFIX.toUpperCase()}{"state":"usable"}`,
    ],
    [
      "the prefix after a space",
      ` ${CLOUD_WRITE_PATH_PREFIX}{"state":"usable"}`,
    ],
  ])("%s says nothing", (_name: string, output: unknown) => {
    expect(readCloudWritePath(output)).toBeNull();
  });

  test("a usable line keeps nothing else it carries", () => {
    expect(
      readCloudWritePath(
        `${CLOUD_WRITE_PATH_PREFIX}{"state":"unset","problem":"cannot-sign-in","extra":1}`,
      ),
    ).toEqual({ state: "unset" });
  });

  test("what a person reads: the output without that line, and without no other", () => {
    const line: string = formatCloudWritePath({
      state: "unusable",
      problem: "cannot-sign-in",
    });

    expect(withoutCloudWritePath(`${line}\n${REST}`)).toBe(REST);
    expect(withoutCloudWritePath(line)).toBe("");
    // Nothing to take out: kept whole, a dry run's verdict and a later line included.
    expect(withoutCloudWritePath(REST)).toBe(REST);
    expect(
      withoutCloudWritePath(
        `${formatCloudDryRunVerdict("would-run")}\n${REST}`,
      ),
    ).toBe(`${CLOUD_DRY_RUN_PREFIX}{"verdict":"would-run"}\n${REST}`);
    expect(withoutCloudWritePath(`${REST}\n${line}`)).toBe(`${REST}\n${line}`);
  });

  test("its prefix is no other marker's", () => {
    for (const prefix of [CLOUD_DRY_RUN_PREFIX, CLOUD_REPLACED_VALUE_PREFIX]) {
      expect(prefix.startsWith(CLOUD_WRITE_PATH_PREFIX)).toBe(false);
      expect(CLOUD_WRITE_PATH_PREFIX.startsWith(prefix)).toBe(false);
    }
  });

  test("a long output is read from its first line alone, in time in line with that line", () => {
    const output: string = `${formatCloudWritePath({ state: "usable" })}\n${"x".repeat(2_000_000)}`;
    const startedAt: number = Date.now();

    expect(readCloudWritePath(output)).toEqual({ state: "usable" });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
