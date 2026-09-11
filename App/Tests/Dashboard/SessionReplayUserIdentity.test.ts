import { describe, expect, test } from "@jest/globals";
import {
  ANONYMOUS_TITLE,
  describeSessionUser,
  describeUserRollup,
  HIDDEN_IDENTITY_TITLE,
  initialsOf,
  SessionUserDescription,
  shortVisitorId,
  stableHue,
  VISITOR_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUserIdentity";

/*
 * Who a session belongs to, ranked the one way every cell ranks it: a
 * readable label, a withheld one, a visitor id, or nothing. Issue #3705's
 * customer saw "Anonymous" on every row because their page never called
 * identify(); the ranking here is what lets the list say "Visitor 7f3a2b"
 * for them instead, and stay clickable for a role that cannot read labels.
 */

const VISITOR: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("stableHue", () => {
  test("is deterministic and lands in [0, 360)", () => {
    for (const key of ["", "a", VISITOR, USER_KEY, "jane@acme.com"]) {
      const hue: number = stableHue(key);

      expect(hue).toBe(stableHue(key));
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  test("spreads similar keys apart", () => {
    const hues: Set<number> = new Set<number>(
      ["u:0001", "u:0002", "u:0003", "u:0004", "u:0005", "u:0006"].map(
        (key: string): number => {
          return stableHue(key);
        },
      ),
    );

    /* Six near-identical keys should not collapse to one or two colours. */
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });
});

describe("shortVisitorId and initialsOf", () => {
  test("a visitor id is shown by its first six hex characters", () => {
    expect(shortVisitorId(VISITOR)).toBe("7f3a2b");
    expect(shortVisitorId(` ${VISITOR} `)).toBe("7f3a2b");
    expect(shortVisitorId("abc")).toBe("abc");
  });

  test("initials come from two words, else the first two characters, uppercased", () => {
    expect(initialsOf("Jane Doe")).toBe("JD");
    expect(initialsOf("jane.doe")).toBe("JD");
    expect(initialsOf("jane@acme.com")).toBe("JA");
    /* An email reads by its local part, never by the domain. */
    expect(initialsOf("jane.doe@acme.com")).toBe("JD");
    expect(initialsOf("user-1234")).toBe("U1");
    expect(initialsOf("x")).toBe("X");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("@acme.com")).toBe("?");
  });
});

describe("describeSessionUser", () => {
  test("a visible label is the person, filtered by reference, coloured by key", () => {
    const user: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "jane@acme.com",
      isIdentityVisible: true,
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR,
    });

    expect(user.kind).toBe("identified");
    expect(user.text).toBe("jane@acme.com");
    expect(user.initials).toBe("JA");
    expect(user.hue).toBe(stableHue(USER_KEY));
    expect(user.filter).toEqual({ identifiedUserRef: "jane@acme.com" });
    expect(user.title).toContain("jane@acme.com");
  });

  test("a visible label wins over a visitor id", () => {
    const user: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "jane@acme.com",
      isIdentityVisible: true,
      identifiedUserKey: "",
      visitorId: VISITOR,
    });

    expect(user.kind).toBe("identified");
    expect(user.text).toBe("jane@acme.com");
    /* No digest: the label itself keeps the colour stable. */
    expect(user.hue).toBe(stableHue("jane@acme.com"));
  });

  test("a withheld column is Hidden, filtered by the digest when there is one", () => {
    const withKey: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "",
      isIdentityVisible: false,
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR,
    });

    expect(withKey.kind).toBe("hidden");
    expect(withKey.text).toBe("Hidden");
    expect(withKey.title).toBe(HIDDEN_IDENTITY_TITLE);
    expect(withKey.initials).toBe("?");
    expect(withKey.hue).toBe(stableHue(USER_KEY));
    expect(withKey.filter).toEqual({ identifiedUserKey: USER_KEY });

    const withoutKey: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "",
      isIdentityVisible: false,
      identifiedUserKey: "",
      visitorId: "",
    });

    expect(withoutKey.kind).toBe("hidden");
    expect(withoutKey.hue).toBeNull();
    expect(withoutKey.filter).toBeNull();
  });

  test("no label but a visitor id is a visitor, filtered by that id", () => {
    const user: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "",
      isIdentityVisible: true,
      identifiedUserKey: "",
      visitorId: VISITOR,
    });

    expect(user.kind).toBe("visitor");
    expect(user.text).toBe("Visitor 7f3a2b");
    expect(user.title).toBe(VISITOR_TITLE);
    expect(user.initials).toBe("V");
    expect(user.hue).toBe(stableHue(VISITOR));
    expect(user.filter).toEqual({ visitorId: VISITOR });
  });

  test("nothing at all is Anonymous with no colour and no filter", () => {
    const user: SessionUserDescription = describeSessionUser({
      identifiedUserLabel: "",
      isIdentityVisible: true,
      identifiedUserKey: "",
      visitorId: "",
    });

    expect(user.kind).toBe("anonymous");
    expect(user.text).toBe("Anonymous");
    expect(user.title).toBe(ANONYMOUS_TITLE);
    expect(user.initials).toBe("?");
    expect(user.hue).toBeNull();
    expect(user.filter).toBeNull();
  });

  test("two different people get different colours (with overwhelming likelihood)", () => {
    const hues: Set<number> = new Set<number>(
      [
        VISITOR,
        USER_KEY,
        "jane@acme.com",
        "john@acme.com",
        "v:abc",
        "u:abc",
      ].map((key: string): number => {
        return stableHue(key);
      }),
    );

    expect(hues.size).toBeGreaterThanOrEqual(5);
  });
});

describe("describeUserRollup", () => {
  test("an identified group with a readable label is the person", () => {
    const user: SessionUserDescription = describeUserRollup({
      kind: "identified",
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR,
      identifiedUserLabel: "jane@acme.com",
      isIdentityVisible: true,
    });

    expect(user.kind).toBe("identified");
    expect(user.text).toBe("jane@acme.com");
    expect(user.filter).toEqual({ identifiedUserRef: "jane@acme.com" });
    expect(user.hue).toBe(stableHue(USER_KEY));
  });

  test("an identified group whose label was withheld is Hidden, never Anonymous", () => {
    const user: SessionUserDescription = describeUserRollup({
      kind: "identified",
      identifiedUserKey: USER_KEY,
      visitorId: VISITOR,
      identifiedUserLabel: undefined,
      isIdentityVisible: false,
    });

    expect(user.kind).toBe("hidden");
    expect(user.text).toBe("Hidden");
    expect(user.filter).toEqual({ identifiedUserKey: USER_KEY });
  });

  test("a visitor group is filtered by its visitor id", () => {
    const user: SessionUserDescription = describeUserRollup({
      kind: "visitor",
      identifiedUserKey: "",
      visitorId: VISITOR,
      identifiedUserLabel: undefined,
      isIdentityVisible: false,
    });

    expect(user.kind).toBe("visitor");
    expect(user.text).toBe("Visitor 7f3a2b");
    expect(user.filter).toEqual({ visitorId: VISITOR });
  });

  test("the anonymous bucket has no filter", () => {
    const user: SessionUserDescription = describeUserRollup({
      kind: "anonymous",
      identifiedUserKey: "",
      visitorId: "",
      identifiedUserLabel: "",
      isIdentityVisible: true,
    });

    expect(user.kind).toBe("anonymous");
    expect(user.filter).toBeNull();
    expect(user.hue).toBeNull();
  });
});
