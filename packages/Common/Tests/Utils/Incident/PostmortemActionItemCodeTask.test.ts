import {
  ActionItemCodeTaskKind,
  buildActionItemCodeTaskRequest,
  getPostmortemContextNote,
  MAX_ACTION_ITEM_DESCRIPTION_IN_REQUEST,
  MAX_ACTION_ITEM_REQUEST_LENGTH,
  MAX_POSTMORTEM_IN_CONTEXT,
  parseActionItemCodeTaskKind,
  PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION,
} from "../../../Utils/Incident/PostmortemActionItemCodeTask";
import { CODE_TASK_LIMITS } from "../../../Types/AI/CodeTask";
import { describe, expect, test } from "@jest/globals";

/*
 * What OneUptime AI is asked when a postmortem's action item becomes a pull
 * request or a test (#6801): the request says what the action item is and
 * which incident it is from, asks for the right thing, carries what the
 * person added, and fits what a code task takes.
 */

describe("the request for a pull request", () => {
  const request: string = buildActionItemCodeTaskRequest({
    kind: ActionItemCodeTaskKind.PullRequest,
    title: "Retry the payment call with backoff",
    description: "The payment provider times out under load.",
    incidentNumber: "#42",
    incidentTitle: "Checkout returns 503s",
  });

  test("names the action item and the incident it comes from", () => {
    expect(request).toContain(
      "This is an action item from the postmortem of incident #42: Checkout returns 503s.",
    );
    expect(request).toContain(
      "Action item: Retry the payment call with backoff",
    );
    expect(request).toContain("The payment provider times out under load.");
  });

  test("asks for the change and a pull request, kept to what the item needs", () => {
    expect(request).toContain(
      "Make the change this action item asks for in this repository, and open a pull request with it for review.",
    );
    expect(request).toContain(
      "say in the pull request which incident it is for",
    );
    expect(request).not.toContain("Write an automated test");
  });
});

describe("the request for a test", () => {
  const request: string = buildActionItemCodeTaskRequest({
    kind: ActionItemCodeTaskKind.Test,
    title: "Add a regression test for the auth leak",
    incidentNumber: "INC-7",
    incidentTitle: "Logins fail",
  });

  test("asks for a test that fails on the code as it was and passes once fixed", () => {
    expect(request).toContain(
      "Write an automated test that would have caught this incident before it reached production",
    );
    expect(request).toContain("it should fail on the code as it was");
    expect(request).toContain("pass once the problem is fixed");
  });

  test("in the repository's own framework, changing nothing but the test", () => {
    expect(request).toContain("Use the repository's own test framework");
    expect(request).toContain("change no code besides the test");
    expect(request).toContain("Open a pull request with the test");
  });

  test("names the incident by its prefix when it has one", () => {
    expect(request).toContain("incident INC-7: Logins fail");
  });
});

/*
 * A private incident (#9186): everyone with access to the repository reads
 * the pull request, which quotes the request, so the request names the
 * incident by its number alone and asks to leave it out of what goes there.
 */
describe("the request for a private incident's action item", () => {
  test.each([
    [ActionItemCodeTaskKind.PullRequest],
    [ActionItemCodeTaskKind.Test],
  ])(
    "for a %s: names the incident by its number only, and asks to keep it out of the pull request",
    (kind: ActionItemCodeTaskKind) => {
      const request: string = buildActionItemCodeTaskRequest({
        kind,
        title: "Retry the payment call with backoff",
        incidentNumber: "#42",
        incidentTitle: "Acme Bank's checkout is down",
        incidentIsPrivate: true,
      });

      expect(request).toContain(
        "This is an action item from the postmortem of incident #42. The incident and its postmortem are attached.",
      );
      expect(request).not.toContain("Acme Bank");
      expect(request).not.toContain("which incident it");
      expect(request).toContain(PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION);
      expect(request).toContain(
        "Action item: Retry the payment call with backoff",
      );
    },
  );

  test("its first line, which titles the task and its pull request, holds nothing of the incident but its number", () => {
    const firstLine: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "Retry the payment call",
      incidentNumber: "INC-9",
      incidentTitle: "Acme Bank's checkout is down",
      incidentIsPrivate: true,
    }).split("\n")[0]!;

    expect(firstLine).toBe(
      "This is an action item from the postmortem of incident INC-9. The incident and its postmortem are attached.",
    );
  });

  test("a private incident with no number is named as an incident, never by its title", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "Retry the payment call",
      incidentTitle: "Acme Bank's checkout is down",
      incidentIsPrivate: true,
    });

    expect(request).toContain("the postmortem of an incident.");
    expect(request).not.toContain("Acme Bank");
  });

  test("the instruction is said once, and covers what goes with the pull request too", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.Test,
      title: "Add a regression test",
      incidentNumber: "#7",
      incidentIsPrivate: true,
      instructions: "Use the existing fixtures.",
    });

    expect(
      request.split(PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION),
    ).toHaveLength(2);
    expect(PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION).toContain(
      "messages and the code's comments",
    );
    // What the person added still goes last, as theirs.
    expect(
      request.endsWith("From the person who asked: Use the existing fixtures."),
    ).toBe(true);
  });

  test("a public incident's request is as it was: its title, and which incident the pull request is for", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "Retry the payment call",
      incidentNumber: "#42",
      incidentTitle: "Checkout returns 503s",
      incidentIsPrivate: false,
    });

    expect(request).toContain("incident #42: Checkout returns 503s");
    expect(request).toContain(
      "say in the pull request which incident it is for",
    );
    expect(request).not.toContain(PRIVATE_INCIDENT_PULL_REQUEST_INSTRUCTION);
  });
});

describe("what the request carries", () => {
  test("what the person added goes last, as theirs", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "Pin the base image",
      instructions: "Use the digest from the release notes.",
    });

    expect(
      request.endsWith(
        "From the person who asked: Use the digest from the release notes.",
      ),
    ).toBe(true);
  });

  test("an incident known only by its title, or not at all, still reads", () => {
    expect(
      buildActionItemCodeTaskRequest({
        kind: ActionItemCodeTaskKind.PullRequest,
        title: "x",
        incidentTitle: "Disk full",
      }),
    ).toContain('the postmortem of the incident "Disk full".');

    expect(
      buildActionItemCodeTaskRequest({
        kind: ActionItemCodeTaskKind.PullRequest,
        title: "x",
      }),
    ).toContain("the postmortem of an incident.");
  });

  test("a long description is cut, and the whole fits what a code task takes", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "t",
      description: "d".repeat(MAX_ACTION_ITEM_DESCRIPTION_IN_REQUEST * 3),
      instructions: "i".repeat(9000),
    });

    expect(request.length).toBeLessThanOrEqual(MAX_ACTION_ITEM_REQUEST_LENGTH);
    expect(MAX_ACTION_ITEM_REQUEST_LENGTH).toBeLessThanOrEqual(
      CODE_TASK_LIMITS.maxMessageLength,
    );
  });

  test("an empty description adds no empty lines of its own", () => {
    const request: string = buildActionItemCodeTaskRequest({
      kind: ActionItemCodeTaskKind.PullRequest,
      title: "t",
      description: "   ",
    });

    expect(request).not.toContain("\n\n\n");
  });
});

describe("the postmortem as context", () => {
  test("is the note, said to be the postmortem", () => {
    expect(
      getPostmortemContextNote("## What Happened\nThe pool ran out."),
    ).toBe("The incident's postmortem:\n\n## What Happened\nThe pool ran out.");
  });

  test("is nothing for a postmortem not written", () => {
    expect(getPostmortemContextNote(undefined)).toBeNull();
    expect(getPostmortemContextNote("  ")).toBeNull();
  });

  test("fits what a note of a code task's context holds", () => {
    const note: string | null = getPostmortemContextNote("p".repeat(20000));

    expect(note!.length).toBeLessThanOrEqual(MAX_POSTMORTEM_IN_CONTEXT);
    expect(MAX_POSTMORTEM_IN_CONTEXT).toBeLessThanOrEqual(
      CODE_TASK_LIMITS.maxNoteLength,
    );
  });
});

describe("a kind read off the wire", () => {
  test("is one of the two, or nothing", () => {
    expect(parseActionItemCodeTaskKind("PullRequest")).toBe(
      ActionItemCodeTaskKind.PullRequest,
    );
    expect(parseActionItemCodeTaskKind("Test")).toBe(
      ActionItemCodeTaskKind.Test,
    );
    expect(parseActionItemCodeTaskKind("Deploy")).toBeNull();
    expect(parseActionItemCodeTaskKind(undefined)).toBeNull();
    expect(parseActionItemCodeTaskKind(3)).toBeNull();
  });
});
