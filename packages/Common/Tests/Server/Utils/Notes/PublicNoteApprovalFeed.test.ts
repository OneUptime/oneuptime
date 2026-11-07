import PublicNoteApprovalFeed, {
  PublicNoteApprovalFeedRecord,
  PublicNoteApprovalWaitingFor,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalFeed";
import {
  PublicNoteApprovalPosition,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import { describe, expect, test } from "@jest/globals";

/*
 * What a record's feed says about each step of a public note's approval
 * (issue #5720). The record is a link; people's and steps' names and a
 * rejection's reason are text, never Markdown a name could smuggle in; the
 * note is the Markdown its author wrote.
 */

const RECORD: PublicNoteApprovalFeedRecord = {
  label: "Incident INC-42",
  url: "https://oneuptime.example/dashboard/p/incidents/i",
};
const LINK: string =
  "[Incident INC-42](https://oneuptime.example/dashboard/p/incidents/i)";

function step(
  overrides: Partial<PublicNoteApprovalStepRule> = {},
): PublicNoteApprovalStepRule {
  return {
    id: "s1",
    order: 1,
    userIds: [],
    teamIds: [],
    ...overrides,
  };
}

function position(
  overrides: Partial<PublicNoteApprovalPosition> = {},
): PublicNoteApprovalPosition {
  return {
    step: step(),
    number: 1,
    count: 1,
    isFinal: true,
    isAskedAgain: false,
    ...overrides,
  };
}

function waiting(
  overrides: Partial<PublicNoteApprovalWaitingFor> = {},
): PublicNoteApprovalWaitingFor {
  return {
    position: position(),
    approverNames: ["Alice", "Platform team"],
    ...overrides,
  };
}

describe("PublicNoteApprovalFeed.waitingFor", () => {
  test("one step: the approvers, by name", () => {
    expect(PublicNoteApprovalFeed.waitingFor(waiting()).toString()).toBe(
      "It waits for the approvers: Alice, Platform team.",
    );
  });

  test("one named step: the step's name", () => {
    expect(
      PublicNoteApprovalFeed.waitingFor(
        waiting({ position: position({ step: step({ name: "Legal" }) }) }),
      ).toString(),
    ).toBe("It waits for Legal: Alice, Platform team.");
  });

  test("several steps: which one, of how many, and its name", () => {
    expect(
      PublicNoteApprovalFeed.waitingFor(
        waiting({
          position: position({
            step: step({ name: "Legal" }),
            number: 2,
            count: 3,
            isFinal: false,
          }),
        }),
      ).toString(),
    ).toBe("It waits for step 2 of 3 (Legal): Alice, Platform team.");
    expect(
      PublicNoteApprovalFeed.waitingFor(
        waiting({
          position: position({ number: 2, count: 3, isFinal: false }),
        }),
      ).toString(),
    ).toBe("It waits for step 2 of 3: Alice, Platform team.");
  });

  test("a step that names nobody says so", () => {
    expect(
      PublicNoteApprovalFeed.waitingFor(
        waiting({ approverNames: [] }),
      ).toString(),
    ).toBe("It waits for the approvers, which names nobody who can approve it yet.");
  });

  test("names and step names are text: a name cannot make Markdown", () => {
    const text: string = PublicNoteApprovalFeed.waitingFor(
      waiting({
        position: position({ step: step({ name: "**Legal**" }) }),
        approverNames: ["[click](https://evil.example)"],
      }),
    ).toString();

    expect(text).not.toContain("**Legal**");
    expect(text).not.toContain("[click](https://evil.example)");
    expect(text).toContain("Legal");
    expect(text).toContain("click");
  });
});

describe("PublicNoteApprovalFeed.submitted", () => {
  test("a new note: sent for approval, published once approved, who it waits for, and the note", () => {
    const text: string = PublicNoteApprovalFeed.submitted({
      record: RECORD,
      note: "We are **looking** into it.",
      isEdit: false,
      isAgain: false,
      waitingFor: waiting(),
    }).toString();

    expect(text).toContain(
      `📝 sent a **public note** on ${LINK} for approval. It is published once it is approved.`,
    );
    expect(text).toContain("It waits for the approvers: Alice, Platform team.");
    // The note is its author's Markdown, as they wrote it.
    expect(text).toContain("We are **looking** into it.");
  });

  test("sent again", () => {
    expect(
      PublicNoteApprovalFeed.submitted({
        record: RECORD,
        note: "Again.",
        isEdit: false,
        isAgain: true,
        waitingFor: waiting(),
      }).toString(),
    ).toContain(`📝 sent a **public note** on ${LINK} for approval again.`);
  });

  test("an edit: status pages keep the note as it was approved", () => {
    for (const isAgain of [false, true]) {
      const text: string = PublicNoteApprovalFeed.submitted({
        record: RECORD,
        note: "Edited.",
        isEdit: true,
        isAgain,
        waitingFor: waiting(),
      }).toString();

      expect(text).toContain(`📝 sent an edit of a **public note** on ${LINK}`);
      expect(text).toContain(
        "Status pages keep showing the note as it was approved until the edit is approved.",
      );
      expect(text.includes("for approval again")).toBe(isAgain);
    }
  });

  test("a note with no text adds nothing after the headline", () => {
    const text: string = PublicNoteApprovalFeed.submitted({
      record: RECORD,
      note: null,
      isEdit: false,
      isAgain: false,
      waitingFor: waiting(),
    }).toString();

    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });
});

describe("PublicNoteApprovalFeed: decisions", () => {
  test("a step approved names the step and who is next", () => {
    expect(
      PublicNoteApprovalFeed.approvedStep({
        record: RECORD,
        isEdit: false,
        approvedPosition: position({
          step: step({ name: "Support" }),
          number: 1,
          count: 2,
          isFinal: false,
        }),
        waitingFor: waiting({
          position: position({
            step: step({ id: "s2", name: "Legal", order: 2 }),
            number: 2,
            count: 2,
          }),
          approverNames: ["Bob"],
        }),
      }).toString(),
    ).toBe(
      `✅ approved a **public note** on ${LINK} for step 1 of 2 (Support). It waits for step 2 of 2 (Legal): Bob.`,
    );

    expect(
      PublicNoteApprovalFeed.approvedStep({
        record: RECORD,
        isEdit: true,
        approvedPosition: position({ number: 1, count: 2, isFinal: false }),
        waitingFor: waiting({
          position: position({ number: 2, count: 2 }),
          approverNames: ["Bob"],
        }),
      }).toString(),
    ).toBe(
      `✅ approved the edit of a **public note** on ${LINK} for step 1 of 2. It waits for step 2 of 2: Bob.`,
    );
  });

  test("the last approval publishes it", () => {
    expect(
      PublicNoteApprovalFeed.approvedAndPublished({
        record: RECORD,
        isEdit: false,
      }).toString(),
    ).toBe(
      `✅ approved a **public note** on ${LINK}. It is now published on status pages.`,
    );
    expect(
      PublicNoteApprovalFeed.approvedAndPublished({
        record: RECORD,
        isEdit: true,
      }).toString(),
    ).toBe(
      `✅ approved the edit of a **public note** on ${LINK}. Status pages now show the edited note.`,
    );
  });

  test("a rejection carries its reason, as text", () => {
    const text: string = PublicNoteApprovalFeed.rejected({
      record: RECORD,
      isEdit: false,
      reason: "Do not name the vendor.\n# Not a heading",
    }).toString();

    expect(text).toContain(
      `↩️ rejected a **public note** on ${LINK}. It is not published.`,
    );
    expect(text).toContain("Do not name the vendor.");
    // A reason's line cannot become a heading in the feed.
    expect(text).not.toMatch(/^# Not a heading$/m);
    expect(text).toContain("Not a heading");

    expect(
      PublicNoteApprovalFeed.rejected({
        record: RECORD,
        isEdit: true,
        reason: "Wording.",
      }).toString(),
    ).toContain(
      `↩️ rejected the edit of a **public note** on ${LINK}. Status pages keep showing the note as it was approved.`,
    );
  });

  test("an edit withdrawn", () => {
    expect(
      PublicNoteApprovalFeed.editWithdrawn({ record: RECORD }).toString(),
    ).toBe(
      `↩️ withdrew the waiting edit of a **public note** on ${LINK}. Status pages keep showing the note as it was approved.`,
    );
  });

  test("published once approval was turned off says nobody approved it", () => {
    expect(
      PublicNoteApprovalFeed.publishedWithoutApproval({
        record: RECORD,
        isEdit: false,
      }).toString(),
    ).toBe(
      `📄 published a waiting **public note** on ${LINK}. Public notes no longer need approval, so it was not approved.`,
    );
    expect(
      PublicNoteApprovalFeed.publishedWithoutApproval({
        record: RECORD,
        isEdit: true,
      }).toString(),
    ).toContain("📄 published the waiting edit of a **public note**");
  });
});

describe("PublicNoteApprovalFeed.approvedByLine", () => {
  test("the published note's entry ends with who approved it", () => {
    expect(
      PublicNoteApprovalFeed.approvedByLine(["Alice", "Bob"]).toString(),
    ).toBe("\n\nApproved by Alice, Bob.");
  });

  test("nothing when nobody did", () => {
    expect(PublicNoteApprovalFeed.approvedByLine([]).toString()).toBe("");
  });

  test("a name is text", () => {
    const text: string = PublicNoteApprovalFeed.approvedByLine([
      "_Mallory_",
    ]).toString();

    expect(text).not.toContain(" _Mallory_.");
    expect(text).toContain("Mallory");
  });
});
