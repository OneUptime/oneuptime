import {
  SECURITY_USER_ERASURE_MAX_USER_LENGTH,
  SECURITY_USER_ERASURE_REQUEST_STATUSES,
  SecurityUserErasureRequestStatus,
  getErasureSpellings,
  getErasureUserProblem,
  isEmailAddress,
  isErasureToken,
  isSecurityUserErasureRequestFinished,
} from "../../../Types/SecurityEvent/SecurityUserErasure";
import { describe, expect, test } from "@jest/globals";

/*
 * What both the server and the Dashboard's form know about an erasure
 * request (#10908): its states, which spellings of what a person typed it
 * erases, and why it would refuse what was typed.
 */

describe("an erasure request's states", () => {
  test("Pending, InProgress, Completed, Failed - in the order a request moves through them", () => {
    expect(SECURITY_USER_ERASURE_REQUEST_STATUSES).toEqual([
      "Pending",
      "InProgress",
      "Completed",
      "Failed",
    ]);
  });

  test("Completed and Failed are over; Pending and InProgress are not", () => {
    expect(
      isSecurityUserErasureRequestFinished(
        SecurityUserErasureRequestStatus.Completed,
      ),
    ).toBe(true);
    expect(
      isSecurityUserErasureRequestFinished(
        SecurityUserErasureRequestStatus.Failed,
      ),
    ).toBe(true);
    expect(
      isSecurityUserErasureRequestFinished(
        SecurityUserErasureRequestStatus.Pending,
      ),
    ).toBe(false);
    expect(
      isSecurityUserErasureRequestFinished(
        SecurityUserErasureRequestStatus.InProgress,
      ),
    ).toBe(false);
    expect(isSecurityUserErasureRequestFinished(undefined)).toBe(false);
  });
});

describe("what is an email address, and what is a token", () => {
  test.each([
    ["alice@example.com", true],
    ["  Alice.Smith+billing@Example.co.uk ", true],
    ["alice", false],
    ["auth0|5f7c8ec7", false],
    ["alice@localhost", false],
    ["two words@example.com", false],
    ["", false],
  ])("%s is an email address: %s", (text: string, expected: boolean) => {
    expect(isEmailAddress(text)).toBe(expected);
  });

  test.each([
    ["[HASHED:5e29db14e508e09a]", true],
    [" [HASHED:5e29db14e508e09a] ", true],
    // The form made before tokens had a key: no request erases by it.
    ["[HASHED:8c87b489]", false],
    ["[HASHED:5E29DB14E508E09A]", false],
    ["auth0|[HASHED:5e29db14e508e09a]", false],
    ["alice@example.com", false],
  ])(
    "%s is a token a request erases by: %s",
    (text: string, expected: boolean) => {
      expect(isErasureToken(text)).toBe(expected);
    },
  );
});

describe("the spellings a request erases", () => {
  test("an email address: as typed, and in lower case", () => {
    expect(getErasureSpellings("  Alice@Example.com ")).toEqual([
      "Alice@Example.com",
      "alice@example.com",
    ]);
  });

  test("an email address in lower case already: once", () => {
    expect(getErasureSpellings("alice@example.com")).toEqual([
      "alice@example.com",
    ]);
  });

  test("a user id: only as typed, since Alice and alice can be two accounts", () => {
    expect(getErasureSpellings("Alice")).toEqual(["Alice"]);
    expect(getErasureSpellings(" auth0|5F7C8EC7 ")).toEqual(["auth0|5F7C8EC7"]);
  });

  test("a token, nothing, or more than the vault keeps: none", () => {
    expect(getErasureSpellings("[HASHED:5e29db14e508e09a]")).toEqual([]);
    expect(getErasureSpellings("   ")).toEqual([]);
    expect(getErasureSpellings("")).toEqual([]);
    expect(
      getErasureSpellings(
        "a".repeat(SECURITY_USER_ERASURE_MAX_USER_LENGTH + 1),
      ),
    ).toEqual([]);
  });

  test("the longest a request takes is kept whole", () => {
    const longest: string = "a".repeat(SECURITY_USER_ERASURE_MAX_USER_LENGTH);

    expect(getErasureSpellings(longest)).toEqual([longest]);
  });
});

describe("why what was typed cannot be erased", () => {
  test("nothing: say what to enter", () => {
    expect(getErasureUserProblem(undefined)).toBe(
      "Enter the user ID, email address or token of the person to erase.",
    );
    expect(getErasureUserProblem("   ")).toBe(
      "Enter the user ID, email address or token of the person to erase.",
    );
  });

  test("too long: say it is no user Security Events keeps", () => {
    expect(
      getErasureUserProblem(
        "a".repeat(SECURITY_USER_ERASURE_MAX_USER_LENGTH + 1),
      ),
    ).toBe(
      "That is longer than any user Security Events keeps. Enter the user ID or email address as your logs hold it.",
    );
  });

  test("a user id, an email address or a token: nothing wrong", () => {
    for (const typed of [
      "alice@example.com",
      "Alice",
      "[HASHED:5e29db14e508e09a]",
    ]) {
      expect(getErasureUserProblem(typed)).toBeNull();
    }
  });
});
