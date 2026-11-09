import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import logger from "../../../../Server/Utils/Logger";
import { PublicNoteKind } from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalPolicy from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import PublicNoteApproverChanges from "../../../../Server/Utils/Notes/PublicNoteApproverChanges";
import {
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalStatus,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  ALICE,
  BOB,
  CAROL,
  CHATS,
  DAVE,
  EVE,
  FRANK,
  GRACE,
  KINDS,
  LEGAL_ID,
  OTHER_PROJECT_ID,
  PLATFORM,
  SUPPORT_ID,
  WorldNote,
  addNote,
  askedInChat,
  askedInChatOnly,
  decide,
  eventTypeOf,
  forgetWhatWasSent,
  getSteps,
  joinTeam,
  keptCopies,
  leaveTeam,
  notified,
  replacedCopies,
  restoreWorld,
  roundOf,
  sendForApproval,
  setSteps,
  settled,
  startWorld,
  step,
  stored,
  usesChat,
  world,
  writeSteps,
} from "./PublicNoteApproverChangesWorld";
import type { SpyInstance } from "jest-mock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpy = SpyInstance<(...args: Array<any>) => any>;

/*
 * WHEN WHO APPROVES A WAITING PUBLIC NOTE CHANGES, ITS NEW APPROVERS ARE
 * ASKED (#6353).
 *
 * The approval steps of a kind change while notes wait - a step created,
 * deleted, reordered or renamed, its people or teams changed - or somebody
 * joins or leaves a team a step names. In the background, once the write is
 * done, every waiting note of the project of that kind is followed up:
 *
 *  - whoever the step it waits for now asks, and was not asked about that
 *    step of its round yet, is asked - by their notification settings, and in
 *    chat with Approve and Reject - once;
 *  - its chat copies that no longer ask what is true say so, without Approve
 *    or Reject: about a step it no longer waits for, or held by somebody the
 *    step no longer asks;
 *  - nobody already asked is asked again, the sender and earlier approvers
 *    never are, and notes that no longer wait are left alone.
 *
 * Over the real engine, asking, passes, step hooks and chat copies, for
 * notes of every kind: an incident's, an episode's, a scheduled maintenance
 * event's.
 */

const NEW_STEP_ID: string = "5e000000-0000-4000-8000-0000000000c1";

// The same two steps for any kind: Support (Bob, Dave), then Legal (Carol).
function supportThenLegal(eventType: PublicNoteApprovalEventType): void {
  setSteps(eventType, [
    step({ id: SUPPORT_ID, name: "Support", order: 1, userIds: [BOB, DAVE] }),
    step({ id: LEGAL_ID, name: "Legal", order: 2, userIds: [CAROL] }),
  ]);
}

// A note of `kind` sent for approval by Alice, its first step asked.
async function waitingNote(
  kind: PublicNoteKind,
  data: Parameters<typeof addNote>[0] = {},
): Promise<WorldNote> {
  const note: WorldNote = addNote({ kind, ...data });
  await sendForApproval(note);
  return note;
}

async function change(data: Parameters<typeof writeSteps>[0]): Promise<void> {
  await writeSteps(data);
  await settled();
}

beforeEach(() => {
  startWorld();
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(async () => {
  await restoreWorld();
});

describe.each(KINDS)("a waiting note of %s", (kind: PublicNoteKind) => {
  const eventType: PublicNoteApprovalEventType = eventTypeOf(kind);

  beforeEach(() => {
    supportThenLegal(eventType);
  });

  test("is asked of its first step's people when it is sent, by every channel, once each", async () => {
    const note: WorldNote = await waitingNote(kind);

    expect(notified(note)).toEqual(["Bob", "Dave"]);
    expect(askedInChat(note)).toEqual(["Bob", "Dave"]);
  });

  test("a step created before the one it waits for: its people are asked, the others are not asked again", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "create",
      eventType,
      stepId: NEW_STEP_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return [
          step({ id: NEW_STEP_ID, name: "Comms", order: 0, userIds: [EVE] }),
          ...steps,
        ];
      },
    });

    expect(notified(note)).toEqual(["Eve"]);
    expect(askedInChat(note)).toEqual(["Eve"]);
  });

  test("a step created after the one it waits for asks nobody by email again", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "create",
      eventType,
      stepId: NEW_STEP_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return [
          ...steps,
          step({ id: NEW_STEP_ID, name: "Comms", order: 3, userIds: [EVE] }),
        ];
      },
    });

    // Support still is not the last step: nothing its people hold changed.
    expect(notified(note)).toEqual([]);
    expect(askedInChat(note)).toEqual([]);
  });

  test("the step it waits for deleted: the next step's people are asked", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "delete",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.filter((rule: PublicNoteApprovalStepRule): boolean => {
          return rule.id !== SUPPORT_ID;
        });
      },
    });

    expect(notified(note)).toEqual(["Carol"]);
    expect(askedInChat(note)).toEqual(["Carol"]);
  });

  test("another step deleted: nobody is asked about the step it still waits for", async () => {
    setSteps(eventType, [
      step({ id: SUPPORT_ID, name: "Support", order: 1, userIds: [BOB, DAVE] }),
      step({ id: LEGAL_ID, name: "Legal", order: 2, userIds: [CAROL] }),
      step({ id: NEW_STEP_ID, name: "Comms", order: 3, userIds: [EVE] }),
    ]);
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "delete",
      eventType,
      stepId: NEW_STEP_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.filter((rule: PublicNoteApprovalStepRule): boolean => {
          return rule.id !== NEW_STEP_ID;
        });
      },
    });

    expect(notified(note)).toEqual([]);
    expect(askedInChat(note)).toEqual([]);
  });

  test("reordered: the step that comes first now is asked", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType,
      stepId: LEGAL_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return { ...rule, order: rule.id === LEGAL_ID ? 0 : rule.order };
        });
      },
    });

    expect(notified(note)).toEqual(["Carol"]);
    expect(askedInChat(note)).toEqual(["Carol"]);
  });

  test("renamed: nobody is asked again", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, name: "Front line" }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual([]);
    expect(askedInChat(note)).toEqual([]);
  });

  test("its people changed: only the person added is asked", async () => {
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, EVE] }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual(["Eve"]);
    expect(askedInChat(note)).toEqual(["Eve"]);
  });

  test("its teams changed: the team's members are asked, each once, a member also named only once", async () => {
    world.teams[PLATFORM] = [FRANK, GRACE, BOB];
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, teamIds: [PLATFORM] }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual(["Frank", "Grace"]);
    expect(askedInChat(note)).toEqual(["Frank", "Grace"]);
  });

  test("the sender and an earlier step's approver are never asked, however the steps change", async () => {
    const note: WorldNote = await waitingNote(kind);
    await decide(note, BOB);
    await settled();
    expect(notified(note)).toEqual(["Bob", "Carol", "Dave"]);
    forgetWhatWasSent();

    // Alice sent it and Bob approved Support: both put on Legal, with Eve.
    await change({
      change: "update",
      eventType,
      stepId: LEGAL_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === LEGAL_ID
            ? { ...rule, userIds: [ALICE, BOB, CAROL, EVE] }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual(["Eve"]);
    expect(askedInChat(note)).toEqual(["Eve"]);
  });

  test("an approver asked already is not asked again by any change, nor by a team naming them too", async () => {
    world.teams[PLATFORM] = [BOB];
    const note: WorldNote = await waitingNote(kind);
    forgetWhatWasSent();

    for (const rename of ["One", "Two", "Three"]) {
      await change({
        change: "update",
        eventType,
        stepId: SUPPORT_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return rule.id === SUPPORT_ID
              ? { ...rule, name: rename, teamIds: [PLATFORM] }
              : rule;
          });
        },
      });
    }

    joinTeam(BOB, PLATFORM);
    await settled();

    expect(notified(note)).toEqual([]);
    expect(askedInChat(note)).toEqual([]);
  });

  test("a step that comes back after being moved away does not ask its people by email again", async () => {
    const note: WorldNote = await waitingNote(kind);

    const moveLegal: (order: number) => Promise<void> = async (
      order: number,
    ): Promise<void> => {
      await change({
        change: "update",
        eventType,
        stepId: LEGAL_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return rule.id === LEGAL_ID ? { ...rule, order } : rule;
          });
        },
      });
    };

    await moveLegal(0);
    await moveLegal(2);
    await moveLegal(0);

    // Each asked by email once: Bob and Dave at first, Carol when Legal came first.
    expect(notified(note)).toEqual(["Bob", "Carol", "Dave"]);
  });

  test("a note no longer waiting is left alone: published, rejected", async () => {
    const published: WorldNote = await waitingNote(kind);
    await decide(published, BOB);
    await decide(published, CAROL);
    const rejected: WorldNote = await waitingNote(kind);
    await decide(rejected, DAVE, PublicNoteApprovalDecision.Reject);
    await settled();

    expect(stored(published).isPublished).toBe(true);
    expect(stored(rejected).approvalStatus).toBe(
      PublicNoteApprovalStatus.Rejected,
    );
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, EVE] }
            : rule;
        });
      },
    });

    expect(notified()).toEqual([]);
    expect(askedInChat()).toEqual([]);
  });

  test("an edit of a published note that waits is followed up as a new note is", async () => {
    const note: WorldNote = await waitingNote(kind, { isEdit: true });
    expect(notified(note)).toEqual(["Bob", "Dave"]);
    forgetWhatWasSent();

    await change({
      change: "delete",
      eventType,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.filter((rule: PublicNoteApprovalStepRule): boolean => {
          return rule.id !== SUPPORT_ID;
        });
      },
    });

    expect(notified(note)).toEqual(["Carol"]);
  });

  test("its last step asked once more, every step having approved it: asked again by email too", async () => {
    const note: WorldNote = await waitingNote(kind);
    await decide(note, BOB);
    await settled();
    forgetWhatWasSent();

    // Legal, the step it waits for, goes: every step left approved it.
    await change({
      change: "delete",
      eventType,
      stepId: LEGAL_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.filter((rule: PublicNoteApprovalStepRule): boolean => {
          return rule.id !== LEGAL_ID;
        });
      },
    });

    // Support is asked once more - not Bob, who approved it.
    expect(notified(note)).toEqual(["Dave"]);
    expect(askedInChat(note)).toEqual(["Dave"]);
  });
});

describe("only the notes a change is about", () => {
  test("a change of incident steps follows up incident and episode notes, never maintenance notes", async () => {
    const incident: WorldNote = await waitingNote(PublicNoteKind.Incident);
    const episode: WorldNote = await waitingNote(
      PublicNoteKind.IncidentEpisode,
    );
    const maintenance: WorldNote = await waitingNote(
      PublicNoteKind.ScheduledMaintenance,
    );
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType: PublicNoteApprovalEventType.Incident,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, FRANK] }
            : rule;
        });
      },
    });

    expect(notified(incident)).toEqual(["Frank"]);
    expect(notified(episode)).toEqual(["Frank"]);
    expect(notified(maintenance)).toEqual([]);
  });

  test("a change of maintenance steps follows up maintenance notes only", async () => {
    const incident: WorldNote = await waitingNote(PublicNoteKind.Incident);
    const maintenance: WorldNote = await waitingNote(
      PublicNoteKind.ScheduledMaintenance,
    );
    expect(notified(maintenance)).toEqual(["Eve"]);
    forgetWhatWasSent();

    await change({
      change: "create",
      eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
      stepId: NEW_STEP_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return [
          step({ id: NEW_STEP_ID, name: "Ops", order: 0, userIds: [FRANK] }),
          ...steps,
        ];
      },
    });

    expect(notified(maintenance)).toEqual(["Frank"]);
    expect(notified(incident)).toEqual([]);
  });

  test("another project's notes are never followed up", async () => {
    setSteps(
      PublicNoteApprovalEventType.Incident,
      [step({ id: SUPPORT_ID, name: "Support", order: 1, userIds: [BOB] })],
      OTHER_PROJECT_ID,
    );
    const theirs: WorldNote = await waitingNote(PublicNoteKind.Incident, {
      projectId: OTHER_PROJECT_ID,
    });
    forgetWhatWasSent();

    await change({
      change: "update",
      eventType: PublicNoteApprovalEventType.Incident,
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, FRANK] }
            : rule;
        });
      },
    });

    // The step of this project was written; the other project's note waits as it was.
    expect(notified(theirs)).toEqual([]);
    expect(
      getSteps(PublicNoteApprovalEventType.Incident, OTHER_PROJECT_ID)[0]!
        .userIds,
    ).toEqual([BOB]);
  });
});

describe("team joins and leaves", () => {
  beforeEach(() => {
    setSteps(PublicNoteApprovalEventType.Incident, [
      step({
        id: SUPPORT_ID,
        name: "Support",
        order: 1,
        userIds: [BOB],
        teamIds: [PLATFORM],
      }),
      step({
        id: LEGAL_ID,
        name: "Legal",
        order: 2,
        userIds: [CAROL],
      }),
    ]);
  });

  test("somebody who joins a team the step a note waits for names is asked about it", async () => {
    const incident: WorldNote = await waitingNote(PublicNoteKind.Incident);
    const episode: WorldNote = await waitingNote(
      PublicNoteKind.IncidentEpisode,
    );
    forgetWhatWasSent();

    joinTeam(FRANK, PLATFORM);
    await settled();

    expect(notified(incident)).toEqual(["Frank"]);
    expect(notified(episode)).toEqual(["Frank"]);
    expect(askedInChat(incident)).toEqual(["Frank"]);
  });

  test("joining a team named only on a later step asks nothing yet; reaching the step does", async () => {
    setSteps(PublicNoteApprovalEventType.Incident, [
      step({ id: SUPPORT_ID, name: "Support", order: 1, userIds: [BOB] }),
      step({
        id: LEGAL_ID,
        name: "Legal",
        order: 2,
        userIds: [CAROL],
        teamIds: [PLATFORM],
      }),
    ]);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    joinTeam(FRANK, PLATFORM);
    await settled();
    expect(notified(note)).toEqual([]);

    await decide(note, BOB);
    await settled();
    expect(notified(note)).toEqual(["Carol", "Frank"]);
  });

  test("the sender, an earlier approver, and a member who may not read the note are not asked when they join", async () => {
    setSteps(PublicNoteApprovalEventType.Incident, [
      step({ id: SUPPORT_ID, name: "Support", order: 1, userIds: [BOB] }),
      step({
        id: LEGAL_ID,
        name: "Legal",
        order: 2,
        userIds: [CAROL],
        teamIds: [PLATFORM],
      }),
    ]);
    world.readers.delete(GRACE);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    await decide(note, BOB);
    await settled();
    forgetWhatWasSent();

    joinTeam(ALICE, PLATFORM);
    joinTeam(BOB, PLATFORM);
    joinTeam(GRACE, PLATFORM);
    joinTeam(EVE, PLATFORM);
    await settled();

    expect(notified(note)).toEqual(["Eve"]);
  });

  test("a member who leaves the team is no longer asked: their chat copies say so, without Approve or Reject", async () => {
    usesChat([BOB, FRANK]);
    world.teams[PLATFORM] = [FRANK];
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    expect(keptCopies(note)).toEqual(
      [
        ...CHATS.map((chat: WorkspaceType) => {
          return `Bob:${chat}`;
        }),
        ...CHATS.map((chat: WorkspaceType) => {
          return `Frank:${chat}`;
        }),
      ].sort(),
    );
    forgetWhatWasSent();

    leaveTeam(FRANK, PLATFORM);
    await settled();

    expect(keptCopies(note)).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Bob:${chat}`;
      }).sort(),
    );
    const replaced: Array<{
      who: string;
      markdown: string;
      buttonTitles: Array<string>;
    }> = replacedCopies(note);
    expect(
      replaced.map((copy: { who: string }) => {
        return copy.who;
      }),
    ).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Frank:${chat}`;
      }).sort(),
    );

    for (const copy of replaced) {
      expect(copy.markdown).toContain(
        "You are no longer asked to approve this public note on",
      );
      expect(copy.markdown).toContain(
        "It waits for step 1 of 2 (Support): Bob, Platform.",
      );
      expect(copy.buttonTitles).not.toContain("Approve");
      expect(copy.buttonTitles).not.toContain("Reject");
    }

    // Nobody is asked anything by a leave.
    expect(notified(note)).toEqual([]);
  });

  test("a member who leaves and joins again is asked in chat again, never by email twice", async () => {
    usesChat([FRANK]);
    world.teams[PLATFORM] = [FRANK];
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    leaveTeam(FRANK, PLATFORM);
    await settled();
    joinTeam(FRANK, PLATFORM);
    await settled();

    expect(notified(note)).toEqual([]);
    expect(askedInChatOnly(note)).toEqual(["Frank"]);
    expect(keptCopies(note)).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Frank:${chat}`;
      }).sort(),
    );
  });
});

describe("chat copies about a step a note no longer waits for", () => {
  beforeEach(() => {
    usesChat([BOB, CAROL, DAVE, EVE]);
  });

  test.each(CHATS)(
    "in %s: replaced with what changed, who it waits for now, and no Approve or Reject; the new approver gets a message that asks",
    async (chat: WorkspaceType) => {
      usesChat([BOB, CAROL, DAVE, EVE], [chat]);
      const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
      expect(keptCopies(note)).toEqual([`Bob:${chat}`, `Dave:${chat}`]);
      forgetWhatWasSent();

      await change({
        change: "update",
        stepId: LEGAL_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return { ...rule, order: rule.id === LEGAL_ID ? 0 : rule.order };
          });
        },
      });

      const replaced: Array<{
        who: string;
        markdown: string;
        buttonTitles: Array<string>;
      }> = replacedCopies(note);

      expect(
        replaced.map((copy: { who: string }) => {
          return copy.who;
        }),
      ).toEqual([`Bob:${chat}`, `Dave:${chat}`]);

      for (const copy of replaced) {
        expect(copy.markdown).toContain(
          "The approval steps of this public note on",
        );
        expect(copy.markdown).toContain(
          "changed after you were asked about it.",
        );
        expect(copy.markdown).toContain(
          "It waits for step 1 of 2 (Legal): Carol.",
        );
        // Not what only a press is told.
        expect(copy.markdown).not.toContain("so nothing was decided");
        expect(copy.buttonTitles).toEqual(["View in OneUptime"]);
      }

      // Carol's own message asks, with its buttons; Bob's and Dave's are gone.
      expect(keptCopies(note)).toEqual([`Carol:${chat}`]);
      const carols: Array<{ buttonTitles: Array<string> }> =
        world.copies.filter((copy: { userId: string; noteId: string }) => {
          return copy.userId === CAROL && copy.noteId === note._id;
        });
      expect(carols).toHaveLength(1);
      expect(carols[0]!.buttonTitles).toContain("Approve");
      expect(carols[0]!.buttonTitles).toContain("Reject");
    },
  );

  test("a step added after the last one: its copies say approving no longer publishes it, and its people get new buttons in chat alone", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    await decide(note, BOB);
    await settled();

    // Carol's message: Legal is the last step, so it reads Approve and publish.
    const before: Array<{ buttonTitles: Array<string> }> = world.copies.filter(
      (copy: { userId: string }) => {
        return copy.userId === CAROL;
      },
    );
    expect(before[0]!.buttonTitles).toContain("Approve and publish");
    forgetWhatWasSent();

    await change({
      change: "create",
      stepId: NEW_STEP_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return [
          ...steps,
          step({ id: NEW_STEP_ID, name: "Comms", order: 3, userIds: [EVE] }),
        ];
      },
    });

    // Carol is not emailed again: she was asked about Legal already.
    expect(notified(note)).toEqual([]);
    expect(askedInChatOnly(note)).toEqual(["Carol"]);

    const replaced: Array<{ who: string; markdown: string }> =
      replacedCopies(note);
    expect(
      replaced.map((copy: { who: string }) => {
        return copy.who;
      }),
    ).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Carol:${chat}`;
      }).sort(),
    );
    expect(replaced[0]!.markdown).toContain(
      "It waits for step 2 of 3 (Legal): Carol.",
    );

    const after: Array<{ buttonTitles: Array<string> }> = world.copies
      .filter((copy: { userId: string }) => {
        return copy.userId === CAROL;
      })
      .slice(before.length);
    expect(after).toHaveLength(CHATS.length);

    for (const copy of after) {
      expect(copy.buttonTitles).toContain("Approve");
      expect(copy.buttonTitles).not.toContain("Approve and publish");
    }

    expect(keptCopies(note)).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Carol:${chat}`;
      }).sort(),
    );
  });

  test("a person taken off the step: their copies say they are no longer asked; the others keep theirs", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID ? { ...rule, userIds: [BOB] } : rule;
        });
      },
    });

    const replaced: Array<{
      who: string;
      markdown: string;
      buttonTitles: Array<string>;
    }> = replacedCopies(note);
    expect(
      replaced.map((copy: { who: string }) => {
        return copy.who;
      }),
    ).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Dave:${chat}`;
      }).sort(),
    );
    expect(replaced[0]!.markdown).toContain(
      "You are no longer asked to approve this public note on",
    );
    expect(replaced[0]!.markdown).toContain(
      "It waits for step 1 of 2 (Support): Bob.",
    );
    expect(replaced[0]!.buttonTitles).toEqual(["View in OneUptime"]);
    expect(keptCopies(note)).toEqual(
      CHATS.map((chat: WorkspaceType) => {
        return `Bob:${chat}`;
      }).sort(),
    );
  });

  test("an edit's copies say it is the edit that is no longer asked about", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident, {
      isEdit: true,
    });
    forgetWhatWasSent();

    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID ? { ...rule, userIds: [BOB] } : rule;
        });
      },
    });

    expect(replacedCopies(note)[0]!.markdown).toContain(
      "You are no longer asked to approve the edit of this public note on",
    );
  });

  test("a copy that could not be replaced is logged and skipped; the next change does not ask again", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    await change({
      change: "update",
      stepId: LEGAL_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return { ...rule, order: rule.id === LEGAL_ID ? 0 : rule.order };
        });
      },
    });

    await change({
      change: "update",
      stepId: LEGAL_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === LEGAL_ID
            ? { ...rule, name: "Legal review" }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual(["Carol"]);
    expect(askedInChat(note)).toEqual(["Carol"]);
  });
});

describe("many waiting notes", () => {
  test(`a pass follows up the ${PublicNoteApproverChanges.MAX_NOTES_PER_PASS} notes changed most recently, one at a time, and says it left the rest`, async () => {
    const count: number = PublicNoteApproverChanges.MAX_NOTES_PER_PASS + 10;
    const notes: Array<WorldNote> = [];

    for (let index: number = 0; index < count; index++) {
      notes.push(
        addNote({
          kind:
            index % 2 === 0
              ? PublicNoteKind.Incident
              : PublicNoteKind.IncidentEpisode,
          updatedAt: (index + 1) * 1000,
        }),
      );
    }

    let running: number = 0;
    let mostAtOnce: number = 0;
    const getSteps: AnySpy = jest.spyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    ) as AnySpy;
    const real: (...args: Array<unknown>) => Promise<unknown> =
      getSteps.getMockImplementation() as never;
    getSteps.mockImplementation((async (...args: Array<unknown>) => {
      running++;
      mostAtOnce = Math.max(mostAtOnce, running);
      try {
        return await real(...args);
      } finally {
        running--;
      }
    }) as never);

    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, FRANK] }
            : rule;
        });
      },
    });

    // Frank, once for each of the newest notes; none for the oldest ten.
    const asked: Set<string> = new Set(
      world.sent
        .filter((sent: { userId: string }) => {
          return sent.userId === FRANK;
        })
        .map((sent: { noteId: string | null }) => {
          return sent.noteId || "";
        }),
    );
    expect(asked.size).toBe(PublicNoteApproverChanges.MAX_NOTES_PER_PASS);
    expect(
      notes.slice(10).every((note: WorldNote): boolean => {
        return asked.has(note._id);
      }),
    ).toBe(true);
    expect(mostAtOnce).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `more than ${PublicNoteApproverChanges.MAX_NOTES_PER_PASS} public notes wait for approval`,
      ),
      expect.anything(),
    );
  });

  test("a burst of saves never runs two passes of a project and kind at once, and runs fewer passes than saves", async () => {
    await waitingNote(PublicNoteKind.Incident);

    let running: number = 0;
    let mostAtOnce: number = 0;
    const original: typeof PublicNoteApproverChanges.followUpProject =
      PublicNoteApproverChanges.followUpProject.bind(PublicNoteApproverChanges);
    const followUpProject: AnySpy = jest
      .spyOn(PublicNoteApproverChanges, "followUpProject")
      .mockImplementation((async (
        change: Parameters<typeof PublicNoteApproverChanges.followUpProject>[0],
      ) => {
        running++;
        mostAtOnce = Math.max(mostAtOnce, running);
        try {
          return await original(change);
        } finally {
          running--;
        }
      }) as never) as AnySpy;

    for (let index: number = 0; index < 20; index++) {
      await writeSteps({
        change: "update",
        stepId: SUPPORT_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return rule.id === SUPPORT_ID
              ? { ...rule, name: `Support ${index}` }
              : rule;
          });
        },
      });
    }

    await settled();

    expect(mostAtOnce).toBe(1);
    expect(followUpProject.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(followUpProject.mock.calls.length).toBeLessThan(20);
  });
});

describe("each person asked once, whatever runs at once", () => {
  test("two saves at once ask each new approver once", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    const addFrank: Promise<void> = writeSteps({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [...rule.userIds, FRANK] }
            : rule;
        });
      },
    });
    const addGrace: Promise<void> = writeSteps({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [...rule.userIds, GRACE] }
            : rule;
        });
      },
    });

    await Promise.all([addFrank, addGrace]);
    await settled();

    expect(notified(note)).toEqual(["Frank", "Grace"]);
  });

  test("passes of two processes at once ask each person once between them", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();
    setSteps(PublicNoteApprovalEventType.Incident, [
      step({
        id: SUPPORT_ID,
        name: "Support",
        order: 1,
        userIds: [BOB, DAVE, FRANK, GRACE],
      }),
      step({ id: LEGAL_ID, name: "Legal", order: 2, userIds: [CAROL] }),
    ]);

    // Each process runs its own pass: nothing in memory is shared but the tables.
    await Promise.all([
      PublicNoteApproverChanges.followUpProject({
        projectId: note.projectId,
        eventType: PublicNoteApprovalEventType.Incident,
      }),
      PublicNoteApproverChanges.followUpProject({
        projectId: note.projectId,
        eventType: PublicNoteApprovalEventType.Incident,
      }),
      PublicNoteApproverChanges.followUpProject({
        projectId: note.projectId,
        eventType: PublicNoteApprovalEventType.Incident,
      }),
    ]);
    await settled();

    expect(notified(note)).toEqual(["Frank", "Grace"]);
    expect(askedInChat(note)).toEqual(["Frank", "Grace"]);
  });

  test("a save racing a decision: the next step's people are asked once, by whichever comes first", async () => {
    usesChat([CAROL, EVE]);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    await Promise.all([
      decide(note, BOB),
      writeSteps({
        change: "update",
        stepId: LEGAL_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return rule.id === LEGAL_ID
              ? { ...rule, userIds: [CAROL, EVE] }
              : rule;
          });
        },
      }),
    ]);
    await settled();

    expect(
      roundOf(note).approvals.map((given: { userId: string }) => {
        return given.userId;
      }),
    ).toEqual([BOB]);
    expect(notified(note)).toEqual(["Carol", "Eve"]);
    expect(askedInChat(note)).toEqual(["Carol", "Eve"]);
    expect(keptCopies(note)).toEqual(
      [
        ...CHATS.map((chat: WorkspaceType) => {
          return `Carol:${chat}`;
        }),
        ...CHATS.map((chat: WorkspaceType) => {
          return `Eve:${chat}`;
        }),
      ].sort(),
    );
  });

  test("a team join racing a step change asks the joiner once", async () => {
    setSteps(PublicNoteApprovalEventType.Incident, [
      step({
        id: SUPPORT_ID,
        name: "Support",
        order: 1,
        userIds: [BOB],
        teamIds: [PLATFORM],
      }),
      step({ id: LEGAL_ID, name: "Legal", order: 2, userIds: [CAROL] }),
    ]);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();

    joinTeam(FRANK, PLATFORM);
    await Promise.all([
      writeSteps({
        change: "update",
        stepId: SUPPORT_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps.map((rule: PublicNoteApprovalStepRule) => {
            return rule.id === SUPPORT_ID
              ? { ...rule, name: "Front line" }
              : rule;
          });
        },
      }),
      PublicNoteApproverChanges.followUpProject({
        projectId: note.projectId,
        eventType: PublicNoteApprovalEventType.Incident,
      }),
    ]);
    await settled();

    expect(notified(note)).toEqual(["Frank"]);
  });
});

describe("the save never fails or waits", () => {
  test("a step's hooks hand back at once while everything after them hangs", async () => {
    await waitingNote(PublicNoteKind.Incident);
    world.readsHang = true;

    const started: number = Date.now();

    for (const change of ["create", "update", "delete"] as const) {
      await writeSteps({
        change,
        stepId: change === "create" ? NEW_STEP_ID : SUPPORT_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps;
        },
      });
    }

    joinTeam(FRANK, PLATFORM);

    expect(Date.now() - started).toBeLessThan(500);
    // The passes are still waiting on their first read.
    expect(world.releaseHangingReads.length).toBeGreaterThan(0);
  });

  test("a step's hooks hand back, and never throw, when everything after them fails", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(PublicNoteApprovalPolicy, "getSteps")
      .mockRejectedValue(new Error("The database is gone.") as never);
    world.requestsFail = true;

    await expect(
      writeSteps({
        change: "update",
        stepId: SUPPORT_ID,
        write: (steps: Array<PublicNoteApprovalStepRule>) => {
          return steps;
        },
      }),
    ).resolves.toBeUndefined();
    await settled();

    expect(notified(note)).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a step's hooks hand back when the passes cannot even start", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(PublicNoteApproverChanges, "afterStepsChanged")
      .mockImplementation((): void => {
        throw new Error("Cannot start.");
      });
    jest
      .spyOn(PublicNoteApproverChanges, "afterStepsUpdated")
      .mockImplementation((): void => {
        throw new Error("Cannot start.");
      });

    for (const change of ["create", "update", "delete"] as const) {
      await expect(
        writeSteps({
          change,
          stepId: SUPPORT_ID,
          write: (steps: Array<PublicNoteApprovalStepRule>) => {
            return steps;
          },
        }),
      ).resolves.toBeUndefined();
    }

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not start asking the new approvers"),
    );
  });
});

describe("when asking cannot be recorded, or fails", () => {
  test("a follow-up asks nobody when who was asked cannot be read: nobody is asked twice", async () => {
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    forgetWhatWasSent();
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    world.requestsFail = true;

    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, FRANK] }
            : rule;
        });
      },
    });

    expect(notified(note)).toEqual([]);

    // Once it can be, the next change asks Frank, and only him.
    world.requestsFail = false;
    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps;
      },
    });

    expect(notified(note)).toEqual(["Frank"]);
  });

  test("a note's first step is asked even when it cannot be recorded: a note never waits for nobody", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    world.requestsFail = true;

    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);

    expect(notified(note)).toEqual(["Bob", "Dave"]);
  });

  test("a person whose ask failed is asked by the next change", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    world.sendsFail.add(DAVE);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    expect(notified(note)).toEqual(["Bob"]);

    world.sendsFail.delete(DAVE);
    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps;
      },
    });

    expect(notified(note)).toEqual(["Bob", "Dave"]);
  });

  test("a member who may not read the note is not asked, and is asked once they may", async () => {
    world.readers.delete(DAVE);
    const note: WorldNote = await waitingNote(PublicNoteKind.Incident);
    expect(notified(note)).toEqual(["Bob"]);

    world.readers.add(DAVE);
    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps;
      },
    });

    expect(notified(note)).toEqual(["Bob", "Dave"]);
  });
});

describe("notes that waited before whom they asked was recorded", () => {
  test("the people their step asks now are taken as asked: the first change asks only who is new", async () => {
    // Sent before the upgrade: asked, but with no record of it.
    const incident: WorldNote = addNote({ kind: PublicNoteKind.Incident });
    const maintenance: WorldNote = addNote({
      kind: PublicNoteKind.ScheduledMaintenance,
    });
    const published: WorldNote = addNote({
      kind: PublicNoteKind.Incident,
      status: PublicNoteApprovalStatus.Approved,
      isPublished: true,
    });

    const recorded: number =
      await PublicNoteApproverChanges.recordWaitingNotesAsAsked({
        batchSize: 1,
      });

    // Bob and Dave for the incident's note, Eve for maintenance: two requests each.
    expect(recorded).toBe(6);
    expect(await PublicNoteApproverChanges.recordWaitingNotesAsAsked()).toBe(0);

    await change({
      change: "update",
      stepId: SUPPORT_ID,
      write: (steps: Array<PublicNoteApprovalStepRule>) => {
        return steps.map((rule: PublicNoteApprovalStepRule) => {
          return rule.id === SUPPORT_ID
            ? { ...rule, userIds: [BOB, DAVE, FRANK] }
            : rule;
        });
      },
    });

    expect(notified(incident)).toEqual(["Frank"]);
    expect(notified(maintenance)).toEqual([]);
    expect(notified(published)).toEqual([]);
  });
});
