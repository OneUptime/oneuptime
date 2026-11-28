import {
  getFormFollowUpNote,
  getFormFollowUpReplyNote,
} from "../../../../Server/Utils/Form/FormSubmissionNote";
import { describe, expect, test } from "@jest/globals";

/*
 * The private notes a form's follow-ups leave on the record a submission
 * created (Utils/Form/FormFollowUp): a message from somebody following the
 * request - written by a stranger, so made inert where it is placed, as the
 * submission's own note is - and a responder's reply, which says it was
 * sent to the people following.
 */

describe("getFormFollowUpNote: who wrote it", () => {
  test.each([
    [
      "a name and an address",
      { authorName: "Jane", authorEmail: "jane@example.com" },
      "Jane (<jane@example.com>) wrote on this request through the form **Report a Problem**:",
    ],
    [
      "only a name",
      { authorName: "Jane" },
      "Jane wrote on this request through the form **Report a Problem**:",
    ],
    [
      "only an address",
      { authorEmail: "jane@example.com" },
      "<jane@example.com> wrote on this request through the form **Report a Problem**:",
    ],
    [
      "neither",
      {},
      "Somebody following this request wrote through the form **Report a Problem**:",
    ],
  ])(
    "names %s",
    (
      _name: string,
      who: { authorName?: string; authorEmail?: string },
      sentence: string,
    ) => {
      const note: string = getFormFollowUpNote({
        formName: "Report a Problem",
        ...who,
        message: "Still broken.",
      });

      expect(note.split("\n\n")[0]).toBe(sentence);
      expect(note).toContain("Still broken.");
    },
  );

  test("says a form when the form has no name", () => {
    expect(
      getFormFollowUpNote({ authorName: "Jane", message: "Hi" }).split("\n\n")[0],
    ).toBe("Jane wrote on this request through a form:");
  });
});

describe("getFormFollowUpNote: what they wrote", () => {
  test("keeps the message as Markdown, after the sentence", () => {
    const note: string = getFormFollowUpNote({
      formName: "Support",
      authorName: "Jane",
      message: "Order **4471** fails:\n\n- step one\n- step two",
    });

    expect(note).toContain("Order **4471** fails:");
    expect(note).toContain("- step one\n- step two");
  });

  test("says the files are attached for a message that is files alone", () => {
    const note: string = getFormFollowUpNote({
      formName: "Support",
      authorName: "Jane",
      message: "   ",
    });

    expect(note.split("\n\n")[1]).toBe("They sent the attached files.");
  });

  test("leaves nothing in the message that acts on its own", () => {
    const note: string = getFormFollowUpNote({
      formName: "Support",
      authorName: "Jane",
      message:
        "<!channel> look ![x](https://tracker.example/pixel.png) and @here",
    });

    // No image that loads by itself: its "!" is escaped, so it is a link.
    expect(note).not.toMatch(/(^|[^\\])!\[x\]\(https:\/\/tracker\.example/);
    expect(note).toContain("\\![x](https://tracker.example/pixel.png)");
    // No chat mention that pings anybody.
    expect(note).not.toContain("<!channel>");
  });

  test("places a name that looks like Markdown as text", () => {
    const note: string = getFormFollowUpNote({
      formName: "Support",
      authorName: "[click](javascript:alert(1))",
      message: "Hi",
    });

    expect(note).not.toContain("[click](javascript:alert(1))");
  });

  test("links an address to exactly that address", () => {
    const note: string = getFormFollowUpNote({
      formName: "Support",
      authorEmail: "a#b@example.com",
      message: "Hi",
    });

    expect(note).toContain("mailto:a%23b@example.com");
  });
});

describe("getFormFollowUpReplyNote", () => {
  test("says the reply was sent to the people following, and keeps it as written", () => {
    expect(
      getFormFollowUpReplyNote({
        message: "  We have a fix rolling out. **Thanks** for waiting.  ",
      }),
    ).toBe(
      "**Sent to the people following this request:**\n\nWe have a fix rolling out. **Thanks** for waiting.",
    );
  });
});
