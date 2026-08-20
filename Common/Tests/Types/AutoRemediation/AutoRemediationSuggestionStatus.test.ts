import AutoRemediationSuggestionStatus, {
  AutoRemediationSuggestionStatusHelper,
} from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the lifecycle vocabulary of an auto-remediation
 * suggestion and the single predicate that splits it into terminal vs open.
 *
 * A suggestion is the approvable action object a matched rule attaches to an
 * incident or alert. isTerminalStatus draws the line between states that can
 * still be actioned (Planning, Suggested — a human or the executor may yet
 * move them) and states that are frozen for good (Approved, AutoExecuted,
 * Dismissed, NoneApplicable). Anything downstream that decides whether to show
 * an approve/dismiss control, re-run planning, or leave a suggestion alone
 * relies on this partition being exact — every status classified, none in both
 * halves.
 *
 * The enum is string-valued, so the wire/DB representation of each member is
 * itself part of the contract: renaming a value would silently orphan rows
 * persisted under the old string. These tests pin both the string values and
 * the terminal/open classification.
 */

/*
 * The two open (non-terminal) states — still actionable.
 */
const OPEN_STATUSES: Array<AutoRemediationSuggestionStatus> = [
  AutoRemediationSuggestionStatus.Planning,
  AutoRemediationSuggestionStatus.Suggested,
];

/*
 * The four terminal states — frozen, never change again.
 */
const TERMINAL_STATUSES: Array<AutoRemediationSuggestionStatus> = [
  AutoRemediationSuggestionStatus.Approved,
  AutoRemediationSuggestionStatus.AutoExecuted,
  AutoRemediationSuggestionStatus.Dismissed,
  AutoRemediationSuggestionStatus.NoneApplicable,
];

describe("AutoRemediationSuggestionStatus enum", () => {
  test("each member's string value matches its name", () => {
    expect(AutoRemediationSuggestionStatus.Planning).toBe("Planning");
    expect(AutoRemediationSuggestionStatus.Suggested).toBe("Suggested");
    expect(AutoRemediationSuggestionStatus.Approved).toBe("Approved");
    expect(AutoRemediationSuggestionStatus.AutoExecuted).toBe("AutoExecuted");
    expect(AutoRemediationSuggestionStatus.Dismissed).toBe("Dismissed");
    expect(AutoRemediationSuggestionStatus.NoneApplicable).toBe(
      "NoneApplicable",
    );
  });

  test("declares exactly six members and no extras", () => {
    const values: Array<string> = Object.values(
      AutoRemediationSuggestionStatus,
    );
    expect(values).toHaveLength(6);
    expect(values.slice().sort()).toEqual(
      [
        "Approved",
        "AutoExecuted",
        "Dismissed",
        "NoneApplicable",
        "Planning",
        "Suggested",
      ].sort(),
    );
  });

  test("all member string values are unique", () => {
    const values: Array<string> = Object.values(
      AutoRemediationSuggestionStatus,
    );
    const unique: Set<string> = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe("AutoRemediationSuggestionStatusHelper.isTerminalStatus", () => {
  test.each(TERMINAL_STATUSES)(
    "returns true for terminal status %s",
    (status: AutoRemediationSuggestionStatus) => {
      expect(
        AutoRemediationSuggestionStatusHelper.isTerminalStatus(status),
      ).toBe(true);
    },
  );

  test.each(OPEN_STATUSES)(
    "returns false for open status %s",
    (status: AutoRemediationSuggestionStatus) => {
      expect(
        AutoRemediationSuggestionStatusHelper.isTerminalStatus(status),
      ).toBe(false);
    },
  );

  test("terminal and open sets together cover every enum member with no overlap", () => {
    const allStatuses: Array<AutoRemediationSuggestionStatus> = Object.values(
      AutoRemediationSuggestionStatus,
    );
    const partitioned: Array<AutoRemediationSuggestionStatus> = [
      ...TERMINAL_STATUSES,
      ...OPEN_STATUSES,
    ];

    /*
     * No status appears in both halves.
     */
    expect(new Set(partitioned).size).toBe(partitioned.length);

    /*
     * Every enum member lands in exactly one half.
     */
    expect(partitioned.slice().sort()).toEqual(allStatuses.slice().sort());
  });

  test("classifies every enum member without leaving any unclassified", () => {
    const allStatuses: Array<AutoRemediationSuggestionStatus> = Object.values(
      AutoRemediationSuggestionStatus,
    );

    for (const status of allStatuses) {
      const isTerminal: boolean =
        AutoRemediationSuggestionStatusHelper.isTerminalStatus(status);
      const expectedTerminal: boolean = TERMINAL_STATUSES.includes(status);
      expect(isTerminal).toBe(expectedTerminal);
    }
  });

  test("is a pure predicate — repeated calls yield the same result", () => {
    for (const status of Object.values(AutoRemediationSuggestionStatus)) {
      const first: boolean =
        AutoRemediationSuggestionStatusHelper.isTerminalStatus(status);
      const second: boolean =
        AutoRemediationSuggestionStatusHelper.isTerminalStatus(status);
      expect(second).toBe(first);
    }
  });

  test("returns exactly a boolean, never a truthy/falsy proxy", () => {
    const terminalResult: boolean =
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        AutoRemediationSuggestionStatus.Approved,
      );
    const openResult: boolean =
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        AutoRemediationSuggestionStatus.Planning,
      );
    expect(typeof terminalResult).toBe("boolean");
    expect(typeof openResult).toBe("boolean");
  });

  test("matches the raw string value of each member (DB/wire representation)", () => {
    /*
     * The enum is string-backed, so a persisted row carries the string, not the
     * TS enum reference. Passing the equivalent raw string must classify the
     * same way — guarding against a future rename that would strand old rows.
     */
    expect(
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        "Dismissed" as AutoRemediationSuggestionStatus,
      ),
    ).toBe(true);
    expect(
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        "Suggested" as AutoRemediationSuggestionStatus,
      ),
    ).toBe(false);
  });

  test("treats an unknown status as non-terminal (no false freeze)", () => {
    /*
     * Defensive edge: a value outside the enum (legacy or corrupt data) is not
     * one of the four terminal constants, so the predicate reports false. That
     * keeps an unrecognized suggestion open/actionable rather than silently
     * frozen.
     */
    expect(
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        "SomethingElse" as AutoRemediationSuggestionStatus,
      ),
    ).toBe(false);
    expect(
      AutoRemediationSuggestionStatusHelper.isTerminalStatus(
        "" as AutoRemediationSuggestionStatus,
      ),
    ).toBe(false);
  });
});
