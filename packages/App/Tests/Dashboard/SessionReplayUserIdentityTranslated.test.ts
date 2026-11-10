import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  ANONYMOUS_TITLE,
  describeSessionUser,
  describeUserRollup,
  HIDDEN_IDENTITY_TITLE,
  SessionUserDescription,
  VISITOR_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayUserIdentity";

/*
 * Who a session belongs to, in the reader's language (issue #6369). The
 * session list, the Users page and the player's user cells drew "Hidden",
 * "Visitor 7f3a2b", "Anonymous" and every hover sentence in English in
 * every language. Each is now looked up whole with the translator the
 * caller hands in; the label a page passed to identify() is drawn as it
 * was given, and without a translator every word is the English it was.
 */

// A language whose every wording is the English one, marked.
const MARKED: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const VISITOR: string = "7f3a2b1c9d8e4f5a6b7c8d9e0f1a2b3c";
const USER_KEY: string =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("describeSessionUser in the reader's language", () => {
  test("an identified person keeps the label as given, in a hover looked up whole", () => {
    const user: SessionUserDescription = describeSessionUser(
      {
        identifiedUserLabel: "jane@acme.com",
        isIdentityVisible: true,
        identifiedUserKey: USER_KEY,
        visitorId: VISITOR,
      },
      MARKED,
    );

    expect(user.text).toBe("jane@acme.com");
    expect(user.title).toBe(
      "⟦Identified by your page as jane@acme.com. Click to see every session from this user.⟧",
    );
  });

  test("hidden, visitor and anonymous are the reader's words, the id in its place", () => {
    const hidden: SessionUserDescription = describeSessionUser(
      {
        identifiedUserLabel: "",
        isIdentityVisible: false,
        identifiedUserKey: USER_KEY,
        visitorId: "",
      },
      MARKED,
    );
    const visitor: SessionUserDescription = describeSessionUser(
      {
        identifiedUserLabel: "",
        isIdentityVisible: true,
        identifiedUserKey: "",
        visitorId: VISITOR,
      },
      MARKED,
    );
    const anonymous: SessionUserDescription = describeSessionUser(
      {
        identifiedUserLabel: "",
        isIdentityVisible: true,
        identifiedUserKey: "",
        visitorId: "",
      },
      MARKED,
    );

    expect(hidden.text).toBe("⟦Hidden⟧");
    expect(hidden.title).toBe(`⟦${HIDDEN_IDENTITY_TITLE}⟧`);
    expect(visitor.text).toBe("⟦Visitor 7f3a2b⟧");
    expect(visitor.title).toBe(`⟦${VISITOR_TITLE}⟧`);
    expect(anonymous.text).toBe("⟦Anonymous⟧");
    expect(anonymous.title).toBe(`⟦${ANONYMOUS_TITLE}⟧`);
  });

  test("the words change nothing but the words: kind, filter, initials and colour", () => {
    const input: Parameters<typeof describeSessionUser>[0] = {
      identifiedUserLabel: "",
      isIdentityVisible: true,
      identifiedUserKey: "",
      visitorId: VISITOR,
    };
    const english: SessionUserDescription = describeSessionUser(input);
    const marked: SessionUserDescription = describeSessionUser(input, MARKED);

    expect(marked.kind).toBe(english.kind);
    expect(marked.filter).toEqual(english.filter);
    expect(marked.initials).toBe(english.initials);
    expect(marked.hue).toBe(english.hue);
  });

  test("without a translator every word is the English it always was", () => {
    expect(
      describeSessionUser({
        identifiedUserLabel: "jane@acme.com",
        isIdentityVisible: true,
        identifiedUserKey: "",
        visitorId: "",
      }).title,
    ).toBe(
      "Identified by your page as jane@acme.com. Click to see every session from this user.",
    );
    expect(
      describeSessionUser({
        identifiedUserLabel: "",
        isIdentityVisible: true,
        identifiedUserKey: "",
        visitorId: VISITOR,
      }).text,
    ).toBe("Visitor 7f3a2b");
    expect(HIDDEN_IDENTITY_TITLE).toBe(
      "Your role cannot read end-user identity, so the label is not sent to you.",
    );
    expect(VISITOR_TITLE).toBe(
      "Anonymous visitor. The recorder links this browser's sessions with a random id so you can follow one person without identify().",
    );
    expect(ANONYMOUS_TITLE).toBe(
      "The page did not call OneUptimeReplay.identify(), and this recorder did not send a visitor id.",
    );
  });

  test("a language without a wording of the sentence reads the English one", () => {
    // Words "Hidden" alone: the visitor sentence stays English.
    const partial: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === "Hidden" ? "Verborgen" : undefined;
      },
      "de",
    );

    expect(
      describeSessionUser(
        {
          identifiedUserLabel: "",
          isIdentityVisible: false,
          identifiedUserKey: "",
          visitorId: "",
        },
        partial,
      ).text,
    ).toBe("Verborgen");
    expect(
      describeSessionUser(
        {
          identifiedUserLabel: "",
          isIdentityVisible: true,
          identifiedUserKey: "",
          visitorId: VISITOR,
        },
        partial,
      ).text,
    ).toBe("Visitor 7f3a2b");
  });
});

describe("describeUserRollup in the reader's language", () => {
  test("every kind of row is worded by the translator handed in", () => {
    const identified: SessionUserDescription = describeUserRollup(
      {
        kind: "identified",
        identifiedUserKey: USER_KEY,
        visitorId: "",
        identifiedUserLabel: "jane@acme.com",
        isIdentityVisible: true,
      },
      MARKED,
    );
    const hidden: SessionUserDescription = describeUserRollup(
      {
        kind: "identified",
        identifiedUserKey: USER_KEY,
        visitorId: "",
        isIdentityVisible: false,
      },
      MARKED,
    );
    const visitor: SessionUserDescription = describeUserRollup(
      {
        kind: "visitor",
        identifiedUserKey: "",
        visitorId: VISITOR,
        isIdentityVisible: true,
      },
      MARKED,
    );
    const anonymous: SessionUserDescription = describeUserRollup(
      {
        kind: "anonymous",
        identifiedUserKey: "",
        visitorId: "",
        isIdentityVisible: true,
      },
      MARKED,
    );

    expect(identified.text).toBe("jane@acme.com");
    expect(identified.title).toBe(
      "⟦Identified by your page as jane@acme.com. Click to see every session from this user.⟧",
    );
    expect(hidden.text).toBe("⟦Hidden⟧");
    expect(hidden.title).toBe(`⟦${HIDDEN_IDENTITY_TITLE}⟧`);
    expect(visitor.text).toBe("⟦Visitor 7f3a2b⟧");
    expect(visitor.title).toBe(`⟦${VISITOR_TITLE}⟧`);
    expect(anonymous.text).toBe("⟦Anonymous⟧");
    expect(anonymous.title).toBe(`⟦${ANONYMOUS_TITLE}⟧`);
  });

  test("without a translator a rollup row reads as it always did", () => {
    const visitor: SessionUserDescription = describeUserRollup({
      kind: "visitor",
      identifiedUserKey: "",
      visitorId: VISITOR,
      isIdentityVisible: true,
    });

    expect(visitor.text).toBe("Visitor 7f3a2b");
    expect(visitor.title).toBe(VISITOR_TITLE);
  });
});
