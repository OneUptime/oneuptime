import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspacePublicNoteApprovalMessage from "../../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import { UserNotificationChannels } from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import { PublicNoteKind } from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApproverChanges from "../../../../Server/Utils/Notes/PublicNoteApproverChanges";
import WorkspacePublicNoteApproval from "../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import PublicNoteApproval, {
  PublicNoteApprovalDecision,
  PublicNoteApprovalEventType,
  PublicNoteApprovalRound,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { SeededRandom, seededRandom, shuffled } from "../../../Helpers/SeededRandom";
import {
  ALICE,
  BOB,
  CAROL,
  CHATS,
  DAVE,
  EVE,
  FRANK,
  GRACE,
  LEGAL_TEAM,
  PLATFORM,
  REQUESTED,
  Sent,
  WorldNote,
  addNote,
  decide,
  eventTypeOf,
  getSteps,
  joinTeam,
  leaveTeam,
  restoreWorld,
  sendForApproval,
  setSteps,
  settled,
  startWorld,
  step,
  stored,
  world,
  writeSteps,
} from "./PublicNoteApproverChangesWorld";

/*
 * WHO IS ASKED, OVER RANDOM INTERLEAVINGS OF STEP CHANGES, DECISIONS AND
 * TEAM CHANGES (#6353), AGAINST AN ORACLE OF ITS OWN.
 *
 * Each seed (seededRandom) plays a project through a few dozen moves: steps
 * created, deleted, reordered, renamed, their people and teams changed;
 * people joining and leaving teams; approvers approving and rejecting; new
 * notes sent; and some of them at once - two moves in flight together, or
 * a pass of another process beside this one's. After every move, once
 * everything in the background is done, the world is held to an oracle
 * that reads the rules from this file, not from the product:
 *
 *  - the step a waiting note waits for is the first, in the steps' order
 *    (order, then id), that has not approved it in its round; when every step
 *    has, its last step, asked once more;
 *  - it asks the people the step names and the members of the teams it names,
 *    less whoever sent the note and whoever approved it already - of them, the
 *    members of the project who may read the note.
 *
 * And it holds:
 *
 *  1. everyone the step asks has been asked about it, by their notification
 *     settings, in this round;
 *  2. everyone it asks who uses chat holds exactly one message about the
 *     note in each of their chats, and that message asks what is true: the
 *     round, the step, whether approving publishes the note, the text;
 *  3. no other message about the note asks anything: a note that no longer
 *     waits has none left;
 *  4. nobody is asked about a step of a round by their notification settings
 *     more than once - twice when its last step was asked once more;
 *  5. the sender of a round is never asked about it, and nobody is asked about
 *     a step after approving another step of the round.
 */

const PEOPLE: Array<string> = [BOB, CAROL, DAVE, EVE, FRANK, GRACE];
const TEAMS: Array<string> = [PLATFORM, LEGAL_TEAM];
const EVENT_TYPES: Array<PublicNoteApprovalEventType> = [
  PublicNoteApprovalEventType.Incident,
  PublicNoteApprovalEventType.ScheduledMaintenance,
];

// ---------- the oracle ----------

interface OraclePosition {
  stepId: string;
  isFinal: boolean;
  isAskedAgain: boolean;
}

function oraclePosition(
  round: PublicNoteApprovalRound,
  steps: Array<PublicNoteApprovalStepRule>,
): OraclePosition | null {
  const ordered: Array<PublicNoteApprovalStepRule> = [...steps].sort(
    (a: PublicNoteApprovalStepRule, b: PublicNoteApprovalStepRule): number => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return a.id < b.id ? -1 : 1;
    },
  );

  if (ordered.length === 0) {
    return null;
  }

  const approved: Array<string> = round.approvals.map(
    (given: { stepId: string }): string => {
      return given.stepId;
    },
  );
  const left: Array<PublicNoteApprovalStepRule> = ordered.filter(
    (rule: PublicNoteApprovalStepRule): boolean => {
      return !approved.includes(rule.id);
    },
  );

  if (left.length === 0) {
    return {
      stepId: ordered[ordered.length - 1]!.id,
      isFinal: true,
      isAskedAgain: true,
    };
  }

  return { stepId: left[0]!.id, isFinal: left.length === 1, isAskedAgain: false };
}

function oracleAsked(
  round: PublicNoteApprovalRound,
  rule: PublicNoteApprovalStepRule,
): Array<string> {
  const named: Set<string> = new Set<string>(rule.userIds);

  for (const teamId of rule.teamIds) {
    for (const member of world.teams[teamId] || []) {
      named.add(member);
    }
  }

  return Array.from(named).filter((userId: string): boolean => {
    return (
      userId !== round.submittedByUserId &&
      !round.approvals.some((given: { userId: string }): boolean => {
        return given.userId === userId;
      }) &&
      world.members.has(userId) &&
      world.readers.has(userId)
    );
  });
}

function isWaiting(note: WorldNote): boolean {
  return PublicNoteApproval.isWaiting(PublicNoteApproval.getState(note));
}

function textOf(note: WorldNote): string {
  return note.isPublished ? note.pendingNote || note.note : note.note;
}

// Every position each note has been in, as moves left it: what rule 4 allows.
const positionsSeen: Map<string, Set<string>> = new Map();

function notePositions(note: WorldNote): Set<string> {
  const seen: Set<string> = positionsSeen.get(note._id) || new Set<string>();
  positionsSeen.set(note._id, seen);
  return seen;
}

// Records where every waiting note stands now.
function observe(): void {
  for (const note of world.notes) {
    if (!world.exists.has(note._id) || !isWaiting(note)) {
      continue;
    }

    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );
    const position: OraclePosition | null = round
      ? oraclePosition(round, getSteps(eventTypeOf(note.kind)))
      : null;

    if (round && position) {
      notePositions(note).add(
        `${round.submittedAt}|${position.stepId}|${String(position.isAskedAgain)}`,
      );
    }
  }
}

function check(seed: number, move: string): void {
  const where: string = `seed ${seed}, after ${move}`;

  for (const note of world.notes) {
    const current: WorldNote = stored(note);
    const copies: Array<WorkspacePublicNoteApprovalMessage> = world.kept.filter(
      (kept: WorkspacePublicNoteApprovalMessage): boolean => {
        const noteId: unknown =
          kept.incidentPublicNoteId ||
          kept.incidentEpisodePublicNoteId ||
          kept.scheduledMaintenancePublicNoteId;

        return String(noteId) === current._id;
      },
    );

    if (!isWaiting(current)) {
      // 3. A note that no longer waits asks nothing.
      expect({ where, live: copies.length }).toEqual({ where, live: 0 });
      continue;
    }

    const round: PublicNoteApprovalRound = PublicNoteApproval.readRound(
      current.approval,
    )!;
    const position: OraclePosition | null = oraclePosition(
      round,
      getSteps(eventTypeOf(current.kind)),
    );
    const rule: PublicNoteApprovalStepRule | undefined = getSteps(
      eventTypeOf(current.kind),
    ).find((candidate: PublicNoteApprovalStepRule): boolean => {
      return candidate.id === position?.stepId;
    });
    const asked: Array<string> = rule ? oracleAsked(round, rule) : [];
    const digest: string = WorkspacePublicNoteApproval.getTextDigest(
      textOf(current),
    );

    for (const userId of asked) {
      // 1. Asked about this step of this round by their notification settings.
      const notified: number = world.sent.filter((sent: Sent): boolean => {
        return (
          sent.eventType === REQUESTED &&
          sent.userId === userId &&
          sent.noteId === current._id &&
          sent.channels !== UserNotificationChannels.ChatOnly &&
          sent.value?.submittedAt === round.submittedAt &&
          sent.value?.stepId === position!.stepId
        );
      }).length;

      expect({ where, userId, note: current._id, notified: notified > 0 }).toEqual(
        { where, userId, note: current._id, notified: true },
      );

      // 2. One message that asks what is true, in each of their chats.
      for (const workspaceType of world.chatAccounts[userId] || []) {
        const theirs: Array<WorkspacePublicNoteApprovalMessage> = copies.filter(
          (kept: WorkspacePublicNoteApprovalMessage): boolean => {
            return (
              kept.userId?.toString() === userId &&
              kept.workspaceType === workspaceType
            );
          },
        );

        expect({
          where,
          userId,
          workspaceType,
          note: current._id,
          live: theirs.map((kept: WorkspacePublicNoteApprovalMessage) => {
            return [kept.submittedAt, kept.stepId, kept.isFinal, kept.textDigest];
          }),
        }).toEqual({
          where,
          userId,
          workspaceType,
          note: current._id,
          live: [[round.submittedAt, position!.stepId, position!.isFinal, digest]],
        });
      }
    }

    // 3. Nobody else holds a message about it that still asks.
    for (const kept of copies) {
      expect({
        where,
        holder: kept.userId?.toString(),
        isAsked: asked.includes(kept.userId?.toString() || ""),
      }).toEqual({
        where,
        holder: kept.userId?.toString(),
        isAsked: true,
      });
    }
  }

  // 4 and 5, over everything sent so far.
  const notifiedBy: Map<string, number> = new Map();

  for (const sent of world.sent) {
    if (sent.eventType !== REQUESTED || !sent.value || !sent.noteId) {
      continue;
    }

    const note: WorldNote | undefined = world.notes.find(
      (candidate: WorldNote): boolean => {
        return candidate._id === sent.noteId;
      },
    );

    expect(note).toBeDefined();

    const sentRound: PublicNoteApprovalRound | null = sendRounds.get(
      `${sent.noteId}|${sent.value.submittedAt}`,
    )!;

    // 5. The sender of the round is never asked about it.
    expect({ where, asked: sent.userId, sender: sentRound?.submittedByUserId !== sent.userId }).toEqual(
      { where, asked: sent.userId, sender: true },
    );

    if (sent.channels !== UserNotificationChannels.ChatOnly) {
      const key: string = `${sent.noteId}|${sent.value.submittedAt}|${sent.value.stepId}|${sent.userId}`;
      notifiedBy.set(key, (notifiedBy.get(key) || 0) + 1);
    }
  }

  for (const [key, count] of notifiedBy.entries()) {
    const [noteId, submittedAt, stepId] = key.split("|") as [string, string, string];
    const seen: Set<string> = positionsSeen.get(noteId) || new Set<string>();
    const allowed: number =
      (seen.has(`${submittedAt}|${stepId}|false`) ? 1 : 0) +
      (seen.has(`${submittedAt}|${stepId}|true`) ? 1 : 0);

    // 4. Once a step - and once more when its last step was asked again.
    expect({ where, key, atMost: count <= Math.max(1, allowed) }).toEqual({
      where,
      key,
      atMost: true,
    });
  }

  // 5. Nobody is asked about a step after approving another step of the round.
  for (const asked of askedAt) {
    const approvedBefore: boolean = approvedAt.some(
      (approval: { noteId: string; submittedAt: string; stepId: string; userId: string; clock: number }) => {
        return (
          approval.noteId === asked.noteId &&
          approval.submittedAt === asked.submittedAt &&
          approval.userId === asked.userId &&
          approval.stepId !== asked.stepId &&
          approval.clock < asked.clock
        );
      },
    );

    expect({ where, asked, approvedBefore }).toEqual({
      where,
      asked,
      approvedBefore: false,
    });
  }
}

// The rounds each note was sent in, for rule 5.
const sendRounds: Map<string, PublicNoteApprovalRound | null> = new Map();

function rememberRounds(): void {
  for (const note of world.notes) {
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );

    if (round) {
      sendRounds.set(`${note._id}|${round.submittedAt}`, round);
    }
  }
}

// When each person was asked, and when each approved, in moves' order: rule 5.
const askedAt: Array<{
  noteId: string;
  submittedAt: string;
  stepId: string;
  userId: string;
  clock: number;
}> = [];
const approvedAt: Array<{
  noteId: string;
  submittedAt: string;
  stepId: string;
  userId: string;
  clock: number;
}> = [];

let sequence: number = 0;

/*
 * The asks sent since the last move. Those of a move played alone are held
 * to rule 5; those of two moves at once may come of a read made just before
 * the other move's approval landed, which nothing could have known.
 */
function recordAsks(isPlayedAlone: boolean): void {
  for (const sent of world.sent.slice(recordedSends)) {
    sequence++;

    if (
      isPlayedAlone &&
      sent.eventType === REQUESTED &&
      sent.value &&
      sent.noteId
    ) {
      askedAt.push({
        noteId: sent.noteId,
        submittedAt: sent.value.submittedAt,
        stepId: sent.value.stepId,
        userId: sent.userId,
        clock: sequence,
      });
    }
  }

  recordedSends = world.sent.length;
}

let recordedSends: number = 0;

function recordApprovals(): void {
  for (const note of world.notes) {
    const round: PublicNoteApprovalRound | null = PublicNoteApproval.readRound(
      note.approval,
    );

    for (const given of round?.approvals || []) {
      const known: boolean = approvedAt.some(
        (approval: { noteId: string; submittedAt: string; stepId: string; userId: string }) => {
          return (
            approval.noteId === note._id &&
            approval.submittedAt === round!.submittedAt &&
            approval.stepId === given.stepId &&
            approval.userId === given.userId
          );
        },
      );

      if (!known) {
        sequence++;
        approvedAt.push({
          noteId: note._id,
          submittedAt: round!.submittedAt,
          stepId: given.stepId,
          userId: given.userId,
          clock: sequence,
        });
      }
    }
  }
}

// ---------- the moves ----------

let nextStep: number = 0;

function pick<T>(items: ReadonlyArray<T>, random: SeededRandom): T {
  return items[random(items.length)]!;
}

function somePeople(random: SeededRandom): Array<string> {
  // Now and then the sender too: it must never be asked.
  const pool: Array<string> = random(5) === 0 ? [...PEOPLE, ALICE] : PEOPLE;
  return shuffled(pool, random).slice(0, 1 + random(3));
}

type Move = {
  kind: string;
  name: string;
  run: () => Promise<void>;
  isDecision?: boolean;
};

function stepMove(random: SeededRandom): Move {
  const eventType: PublicNoteApprovalEventType = pick(EVENT_TYPES, random);
  const steps: Array<PublicNoteApprovalStepRule> = getSteps(eventType);
  const target: PublicNoteApprovalStepRule = pick(steps, random);
  const what: number = random(6);

  if (what === 0 || steps.length === 1) {
    nextStep++;
    const id: string = `5e000000-0000-4000-8000-${String(900 + nextStep).padStart(12, "0")}`;
    const order: number = random(steps.length + 2);

    return {
      kind: "a step created",
      name: `create a step at ${order} of ${eventType}`,
      run: async () => {
        await writeSteps({
          change: "create",
          eventType,
          stepId: id,
          write: (current: Array<PublicNoteApprovalStepRule>) => {
            return [
              ...current,
              step({
                id,
                name: `S${nextStep}`,
                order,
                userIds: somePeople(random),
                teamIds: random(3) === 0 ? [pick(TEAMS, random)] : [],
              }),
            ];
          },
        });
      },
    };
  }

  if (what === 1) {
    return {
      kind: "a step deleted",
      name: `delete ${target.name} of ${eventType}`,
      run: async () => {
        await writeSteps({
          change: "delete",
          eventType,
          stepId: target.id,
          write: (current: Array<PublicNoteApprovalStepRule>) => {
            return current.filter((rule: PublicNoteApprovalStepRule) => {
              return rule.id !== target.id;
            });
          },
        });
      },
    };
  }

  const order: number = random(steps.length + 2);
  const people: Array<string> = somePeople(random);
  const teams: Array<string> = random(2) === 0 ? [] : [pick(TEAMS, random)];
  const rename: string = `${target.name || "S"}'`;

  return {
    kind: [
      "a step reordered",
      "a step renamed",
      "a step's people changed",
      "a step's teams changed",
    ][what - 2]!,
    name: `${["reorder", "rename", "change the people of", "change the teams of"][what - 2]} ${target.name} of ${eventType}`,
    run: async () => {
      await writeSteps({
        change: "update",
        eventType,
        stepId: target.id,
        write: (current: Array<PublicNoteApprovalStepRule>) => {
          return current.map((rule: PublicNoteApprovalStepRule) => {
            if (rule.id !== target.id) {
              return rule;
            }

            switch (what) {
              case 2:
                return { ...rule, order };
              case 3:
                return { ...rule, name: rename };
              case 4:
                return { ...rule, userIds: people };
              default:
                // A step names somebody: people, if no team.
                return {
                  ...rule,
                  teamIds: teams,
                  userIds: teams.length === 0 && rule.userIds.length === 0 ? people : rule.userIds,
                };
            }
          });
        },
      });
    },
  };
}

function teamMove(random: SeededRandom): Move {
  const teamId: string = pick(TEAMS, random);
  const userId: string = pick([...PEOPLE, ALICE], random);
  const isMember: boolean = (world.teams[teamId] || []).includes(userId);

  return isMember
    ? {
        kind: "a team left",
        name: `${userId.slice(0, 2)} leaves ${teamId.slice(-1)}`,
        run: async () => {
          leaveTeam(userId, teamId);
        },
      }
    : {
        kind: "a team joined",
        name: `${userId.slice(0, 2)} joins ${teamId.slice(-1)}`,
        run: async () => {
          joinTeam(userId, teamId);
        },
      };
}

function decisionMove(random: SeededRandom): Move | null {
  const waiting: Array<WorldNote> = world.notes.filter((note: WorldNote) => {
    return isWaiting(stored(note));
  });

  if (waiting.length === 0) {
    return null;
  }

  const note: WorldNote = stored(pick(waiting, random));
  const round: PublicNoteApprovalRound = PublicNoteApproval.readRound(
    note.approval,
  )!;
  const position: OraclePosition | null = oraclePosition(
    round,
    getSteps(eventTypeOf(note.kind)),
  );
  const rule: PublicNoteApprovalStepRule | undefined = getSteps(
    eventTypeOf(note.kind),
  ).find((candidate: PublicNoteApprovalStepRule): boolean => {
    return candidate.id === position?.stepId;
  });
  const deciders: Array<string> = rule ? oracleAsked(round, rule) : [];

  if (deciders.length === 0) {
    return null;
  }

  const userId: string = pick(deciders, random);
  const decision: PublicNoteApprovalDecision =
    random(6) === 0
      ? PublicNoteApprovalDecision.Reject
      : PublicNoteApprovalDecision.Approve;

  return {
    kind:
      decision === PublicNoteApprovalDecision.Reject
        ? "a rejection"
        : "an approval",
    name: `${userId.slice(0, 2)} ${decision === PublicNoteApprovalDecision.Reject ? "rejects" : "approves"} ${note._id.slice(-3)}`,
    isDecision: true,
    run: async () => {
      // The oracle said they may: the engine must agree.
      await decide(note, userId, decision);
    },
  };
}

function noteMove(random: SeededRandom): Move {
  const kind: PublicNoteKind = pick(
    [
      PublicNoteKind.Incident,
      PublicNoteKind.IncidentEpisode,
      PublicNoteKind.ScheduledMaintenance,
    ],
    random,
  );
  const isEdit: boolean = random(4) === 0;

  return {
    kind: isEdit ? "an edit sent" : "a note sent",
    name: `a new ${isEdit ? "edit" : "note"} of ${kind}`,
    run: async () => {
      const note: WorldNote = addNote({ kind, isEdit });
      await sendForApproval(note);
    },
  };
}

function anyMove(random: SeededRandom): Move {
  for (;;) {
    const roll: number = random(10);

    if (roll < 4) {
      return stepMove(random);
    }

    if (roll < 6) {
      return teamMove(random);
    }

    if (roll < 9) {
      const decision: Move | null = decisionMove(random);

      if (decision) {
        return decision;
      }

      continue;
    }

    return noteMove(random);
  }
}

// A pass as another process runs it, beside this one's.
function otherProcessMove(random: SeededRandom): Move {
  const eventType: PublicNoteApprovalEventType = pick(EVENT_TYPES, random);

  return {
    kind: "another process's pass",
    name: `another process's pass of ${eventType}`,
    run: async () => {
      await PublicNoteApproverChanges.followUpProject({
        projectId: world.notes[0]!.projectId,
        eventType,
      });
    },
  };
}

// What the games played, all seeds together: each kind of move, and what came of them.
const played: Record<string, number> = {};

function count(what: string, by: number = 1): void {
  played[what] = (played[what] || 0) + by;
}

async function play(seed: number, moves: number): Promise<void> {
  const random: SeededRandom = seededRandom(seed);

  // Who uses chat, and who may not read the notes, for the whole game.
  for (const userId of PEOPLE) {
    if (random(2) === 0) {
      world.chatAccounts[userId] = shuffled(CHATS, random).slice(
        0,
        1 + random(3),
      ) as Array<WorkspaceType>;
    }
  }

  if (random(3) === 0) {
    world.readers.delete(pick(PEOPLE, random));
  }

  for (const teamId of TEAMS) {
    world.teams[teamId] = shuffled(PEOPLE, random).slice(0, random(3));
  }

  for (let index: number = 0; index < 3; index++) {
    await noteMove(random).run();
  }

  observe();
  rememberRounds();
  recordApprovals();
  recordAsks(true);
  check(seed, "the first notes");

  for (let index: number = 0; index < moves; index++) {
    const together: number = random(4);
    let played: Array<Move>;

    if (together === 0) {
      // Two moves in flight at once - at most one of them a decision.
      const first: Move = anyMove(random);
      let second: Move = anyMove(random);

      while (first.isDecision && second.isDecision) {
        second = anyMove(random);
      }

      played = [first, second];
    } else if (together === 1) {
      played = [anyMove(random), otherProcessMove(random)];
    } else {
      played = [anyMove(random)];
    }

    for (const move of played) {
      count(move.kind);
    }

    if (played.length > 1) {
      count("moves played at once");
    }

    await Promise.all(
      played.map(async (move: Move): Promise<void> => {
        try {
          await move.run();
        } catch (error) {
          /*
           * A decision beside a change of its step may be refused - its
           * approver taken off the step a moment before: the engine's to
           * say, not this oracle's. Alone, it must be decided.
           */
          if (!move.isDecision || played.length === 1) {
            throw error;
          }
        }
      }),
    );
    await settled();
    rememberRounds();
    recordApprovals();
    recordAsks(played.length === 1);

    check(
      seed,
      `move ${index + 1}: ${played.map((move: Move) => {
        return move.name;
      }).join(" + ")}`,
    );
  }

  count(
    "asked by notifications",
    world.sent.filter((sent: Sent): boolean => {
      return (
        sent.eventType === REQUESTED &&
        sent.channels !== UserNotificationChannels.ChatOnly
      );
    }).length,
  );
  count(
    "asked again in chat alone",
    world.sent.filter((sent: Sent): boolean => {
      return (
        sent.eventType === REQUESTED &&
        sent.channels === UserNotificationChannels.ChatOnly
      );
    }).length,
  );
  count("chat copies replaced", world.replaced.length);
  count(
    "replaced as no longer asked",
    world.replaced.filter((replaced: { markdown: string }): boolean => {
      return replaced.markdown.includes("You are no longer asked");
    }).length,
  );
  count(
    "replaced as steps changed",
    world.replaced.filter((replaced: { markdown: string }): boolean => {
      return replaced.markdown.includes("The approval steps of");
    }).length,
  );
}

beforeEach(() => {
  startWorld();
  world.onChange = observe;
  positionsSeen.clear();
  sendRounds.clear();
  askedAt.splice(0);
  approvedAt.splice(0);
  recordedSends = 0;
  sequence = 0;
  nextStep = 0;
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  setSteps(PublicNoteApprovalEventType.Incident, [
    step({ id: "5e000000-0000-4000-8000-0000000000a1", name: "Support", order: 1, userIds: [BOB, DAVE] }),
    step({ id: "5e000000-0000-4000-8000-0000000000a2", name: "Legal", order: 2, userIds: [CAROL], teamIds: [LEGAL_TEAM] }),
  ]);
  setSteps(PublicNoteApprovalEventType.ScheduledMaintenance, [
    step({ id: "5e000000-0000-4000-8000-0000000000b1", name: "Maintenance", order: 1, userIds: [EVE], teamIds: [PLATFORM] }),
  ]);
});

afterEach(async () => {
  await restoreWorld();
});

describe("PublicNoteApproverChanges: random interleavings against an oracle", () => {
  // The games are worth what they played: every kind of move, and every outcome.
  afterAll(() => {
    for (const what of [
      "a step created",
      "a step deleted",
      "a step reordered",
      "a step renamed",
      "a step's people changed",
      "a step's teams changed",
      "a team joined",
      "a team left",
      "an approval",
      "a rejection",
      "a note sent",
      "an edit sent",
      "another process's pass",
      "moves played at once",
      "asked by notifications",
      "asked again in chat alone",
      "replaced as no longer asked",
      "replaced as steps changed",
    ]) {
      expect([what, (played[what] || 0) > 0]).toEqual([what, true]);
    }
  });

  const SEEDS: Array<number> = Array.from({ length: 30 }, (_: unknown, index: number) => {
    return 6353 + index * 97;
  });

  test.each(SEEDS)("seed %i: asks everyone the step asks, once, and no one else", async (seed: number) => {
    await play(seed, 30);
  });
});
