import PrivateRecordPublicNotes, {
  PrivateRecordKind,
} from "../../../Types/StatusPage/PrivateRecordPublicNotes";
import StatusPageVisibility from "../../../Types/StatusPage/StatusPageVisibility";
import { describe, expect, test } from "@jest/globals";

/*
 * A PRIVATE INCIDENT OR EPISODE TAKES NO PUBLIC NOTES.
 *
 * A customer posted a public note on a private incident. The form promised
 * "This note will be visible to all subscribers of this incident and will
 * show up on the status page", and the note went nowhere - rightly, since
 * the incident was private. So a private incident or episode takes no new
 * public notes: the server refuses one on every way one is made, the
 * Dashboard locks it, and the chats save one as a private note. This pins
 * the one rule they all ask and the one sentence they all say.
 */

describe("PrivateRecordPublicNotes.takesPublicNotes", () => {
  test.each([
    ["Private off", { isPrivate: false }],
    ["Private never set (null)", { isPrivate: null }],
    ["Private not read", {}],
    ["no record read", null],
    ["no record at all", undefined],
  ])("takes public notes with %s", (_label: string, record: unknown) => {
    expect(
      PrivateRecordPublicNotes.takesPublicNotes(
        record as { isPrivate?: unknown } | null | undefined,
      ),
    ).toBe(true);
  });

  test.each([
    ["Private on", { isPrivate: true }],
    ['a hand-written "true"', { isPrivate: "true" }],
    ["a 1", { isPrivate: 1 }],
    ["an odd value", { isPrivate: "yes" }],
  ])(
    "takes none with %s: an odd value hides rather than shows",
    (_label: string, record: unknown) => {
      expect(
        PrivateRecordPublicNotes.takesPublicNotes(
          record as { isPrivate?: unknown },
        ),
      ).toBe(false);
    },
  );

  test("is the status page rule's own reading of Private, never a copy of it", () => {
    for (const value of [true, false, null, undefined, "true", "false", 0, 1]) {
      expect(
        PrivateRecordPublicNotes.takesPublicNotes({ isPrivate: value }),
      ).toBe(!StatusPageVisibility.isPrivate({ isPrivate: value }));
    }
  });

  test("Visible on Status Page has no say: a hidden incident that is not private takes public notes, shown once it is", () => {
    expect(
      PrivateRecordPublicNotes.takesPublicNotes({
        isPrivate: false,
        isVisibleOnStatusPage: false,
      }),
    ).toBe(true);
    expect(
      PrivateRecordPublicNotes.takesPublicNotes({
        isPrivate: true,
        isVisibleOnStatusPage: true,
      }),
    ).toBe(false);
  });
});

describe("PrivateRecordPublicNotes words", () => {
  test("the refusal says why and what to do instead, for an incident", () => {
    expect(
      PrivateRecordPublicNotes.getRefusalMessage(PrivateRecordKind.Incident),
    ).toBe(
      "This incident is private, so public notes cannot be added to it. Use a private note.",
    );
  });

  test("and for an episode", () => {
    expect(
      PrivateRecordPublicNotes.getRefusalMessage(
        PrivateRecordKind.IncidentEpisode,
      ),
    ).toBe(
      "This episode is private, so public notes cannot be added to it. Use a private note.",
    );
  });

  test("a state change that comes with a public note is refused whole, with how to make it", () => {
    expect(
      PrivateRecordPublicNotes.getStateChangeRefusalMessage(
        PrivateRecordKind.Incident,
      ),
    ).toBe(
      "The state was not changed: it comes with a public note, and this incident is private, so public notes cannot be added to it. Post the note as a private note, or leave it out.",
    );
  });

  test("names each record the way the Dashboard names it", () => {
    expect(PrivateRecordPublicNotes.getNoun(PrivateRecordKind.Incident)).toBe(
      "incident",
    );
    expect(
      PrivateRecordPublicNotes.getNoun(PrivateRecordKind.IncidentEpisode),
    ).toBe("episode");
  });

  test("every record has its words: no kind falls through to an empty sentence", () => {
    for (const kind of Object.values(PrivateRecordKind)) {
      const noun: string = PrivateRecordPublicNotes.getNoun(kind);

      expect(noun).toMatch(/^[a-z]+$/);
      expect(PrivateRecordPublicNotes.getRefusalMessage(kind)).toContain(
        `This ${noun} is private`,
      );
      expect(
        PrivateRecordPublicNotes.getStateChangeRefusalMessage(kind),
      ).toContain(`this ${noun} is private`);
    }
  });

  test("never promises the status page or subscribers anything", () => {
    for (const kind of Object.values(PrivateRecordKind)) {
      for (const sentence of [
        PrivateRecordPublicNotes.getRefusalMessage(kind),
        PrivateRecordPublicNotes.getStateChangeRefusalMessage(kind),
      ]) {
        expect(sentence).not.toMatch(/status page|subscriber/i);
      }
    }
  });
});
