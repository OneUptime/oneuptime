import { JSONObject, JSONValue } from "../JSON";

/*
 * PUBLIC NOTE APPROVAL.
 *
 * A project can ask for public notes to be approved before they are
 * published (Incidents > Settings > Public Note Approval, and the same page
 * under Scheduled Maintenance). Off by default: a project that never turns it
 * on posts public notes exactly as before.
 *
 * With it on, a new public note - from the Dashboard, the API, a workflow,
 * OneUptime AI, Slack, Microsoft Teams, an SLA's reminder or a state change -
 * is saved but not published: no status page shows it, no subscriber is told,
 * no chat channel gets it and no workflow starts with it, until the project's
 * approvers say yes. The approvers are one step or several, in order: each
 * step is a list of people and teams, any one of whom may approve for the
 * step. A note is published when its last step approves it, and only then;
 * it may be rejected at any step, with a reason, and its author can change it
 * and send it again.
 *
 * Who may decide is read when they decide, from the steps as they are then:
 * adding someone to a step, or to a team a step names, lets them decide on
 * the notes already waiting; taking them off takes that away. A note keeps
 * the approvals it has, by step: the step it waits for is the first one, in
 * the steps' current order, that has not approved it. Were every step to
 * have approved it already (one that had not was taken out), its last step
 * is asked once more, so a note is never published by a change of settings,
 * only by somebody approving it.
 *
 * Nobody decides on a note they sent for approval, and nobody approves a
 * note for two steps: a second pair of eyes is what approval is for.
 *
 * An edit of a published note waits too: the status page keeps showing the
 * note as it was approved, and the edit (pendingNote) replaces it once it is
 * approved. An edit of a note that is not published yet starts its approval
 * again, from the first step: an approval is of the words it was given.
 *
 * This file is shared by the server, which decides, and the Dashboard, which
 * shows the same words. Server/Utils/Notes/PublicNoteApprovalEngine writes
 * what is decided here.
 */

// Where a note stands: the note's approvalStatus column.
export enum PublicNoteApprovalStatus {
  WaitingForApproval = "WaitingForApproval",
  Approved = "Approved",
  Rejected = "Rejected",
}

/*
 * Which public notes a project's approval steps are for: an incident's and
 * an episode's (Incidents), or a scheduled maintenance event's.
 */
export enum PublicNoteApprovalEventType {
  Incident = "Incident",
  ScheduledMaintenance = "ScheduledMaintenance",
}

/*
 * How a note reads, from its columns: what the Dashboard draws and what the
 * server allows next.
 */
export enum PublicNoteApprovalState {
  // On the status page; nothing waiting.
  Published = "Published",
  // Not published yet: it waits for an approver.
  WaitingForApproval = "WaitingForApproval",
  // Not published: an approver said no. Its author can change it and send it again.
  Rejected = "Rejected",
  // Published; an edit of it waits for an approver.
  EditWaitingForApproval = "EditWaitingForApproval",
  // Published; an edit of it was rejected. The note shows as it was approved.
  EditRejected = "EditRejected",
}

export enum PublicNoteApprovalDecision {
  Approve = "Approve",
  Reject = "Reject",
}

// The longest comment or reason a decision keeps.
export const PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH: number = 2000;

// One step of a project's approval steps, as they are now.
export interface PublicNoteApprovalStepRule {
  id: string;
  // What the step is called ("Legal"); none for most.
  name?: string | undefined;
  order: number;
  // The people who may approve for it, and the teams whose members may.
  userIds: Array<string>;
  teamIds: Array<string>;
}

// One step's approval of a note.
export interface PublicNoteApprovalGiven {
  stepId: string;
  // What the step was called when it approved, for the record.
  stepName?: string | undefined;
  userId: string;
  // When, as an ISO date.
  at: string;
  comment?: string | undefined;
}

export interface PublicNoteApprovalRejection {
  stepId?: string | undefined;
  stepName?: string | undefined;
  userId: string;
  at: string;
  reason: string;
}

/*
 * What a note's approval column holds: the round of approval it is in, from
 * the moment it was sent (written, or edited) to the moment it was published
 * or rejected. A note sent again starts a new round; the feed keeps the
 * earlier ones.
 */
export interface PublicNoteApprovalRound {
  // When it was sent for approval, as an ISO date.
  submittedAt: string;
  // Who sent it: none when OneUptime, a workflow or an API key wrote it.
  submittedByUserId?: string | undefined;
  // An edit of a published note (pendingNote), rather than a new note.
  isEdit: boolean;
  // For an edit: its editor asked for subscribers to be told about it.
  notifySubscribersOfEdit?: boolean | undefined;
  /*
   * For a new note: its time was chosen when it was written (an author's
   * "posted at", a state change's time), so publishing keeps it. A note
   * written at "now" is posted when it is published.
   */
  keepPostedAt?: boolean | undefined;
  approvals: Array<PublicNoteApprovalGiven>;
  rejection?: PublicNoteApprovalRejection | undefined;
  // When its last approval published it.
  publishedAt?: string | undefined;
  /*
   * For an edit: the note's approval before the edit was sent, put back
   * when the edit is discarded.
   */
  before?: PublicNoteApprovalBefore | undefined;
}

export interface PublicNoteApprovalBefore {
  status: PublicNoteApprovalStatus | null;
  round: PublicNoteApprovalRound | null;
}

// The columns of a note this reads.
export interface PublicNoteApprovalColumns {
  isPublished?: boolean | null | undefined;
  approvalStatus?: string | null | undefined;
  approval?: JSONObject | JSONValue | null | undefined;
  pendingNote?: string | null | undefined;
}

// The step a note waits for, among the steps as they are now.
export interface PublicNoteApprovalPosition {
  step: PublicNoteApprovalStepRule | null;
  // Its place in the steps' order, from 1; 0 when there are no steps.
  number: number;
  count: number;
  // Approving it publishes the note.
  isFinal: boolean;
  /*
   * Every step had approved the note already - one that had not was taken
   * out - so its last step is asked once more.
   */
  isAskedAgain: boolean;
}

export const PublicNoteApprovalMessages: {
  notAPerson: string;
  notWaiting: string;
  noSteps: string;
  notAnApprover: (stepLabel: string) => string;
  sentByYou: string;
  approvedEarlierStep: string;
  reasonRequired: string;
  decidedMeanwhile: string;
  changedMeanwhile: string;
  notRejected: string;
  stillWaiting: string;
  noEditWaiting: string;
  oneNoteAtATime: string;
  attachmentsOfPublishedNote: string;
  writtenByOneUptime: (column: string) => string;
} = {
  notAPerson:
    "Only a signed-in person can approve or reject a public note: approvers are people.",
  notWaiting: "This public note is not waiting for approval.",
  noSteps:
    "Nobody can approve this public note: no approvers are set up. A project admin can add them in Settings > Public Note Approval.",
  notAnApprover: (stepLabel: string): string => {
    return `You are not an approver of ${stepLabel}, which this public note is waiting for.`;
  },
  sentByYou:
    "You sent this public note for approval, so someone else has to approve or reject it.",
  approvedEarlierStep:
    "You approved an earlier step of this public note, so someone else has to approve this one.",
  reasonRequired:
    "Say why the public note is rejected: its author sees the reason.",
  decidedMeanwhile:
    "Somebody decided on this public note a moment ago. Refresh to see what they chose.",
  changedMeanwhile:
    "This public note changed a moment ago, so your edit was not saved. Refresh to see it as it is now, then make your edit again.",
  notRejected:
    "Only a rejected public note can be sent for approval again. Edit a note that is waiting to send it again.",
  stillWaiting: "This public note is already waiting for approval.",
  noEditWaiting: "This public note has no edit waiting for approval.",
  oneNoteAtATime:
    "Edit one public note at a time while public notes need approval.",
  attachmentsOfPublishedNote:
    "The files of a published note cannot change while public notes need approval. Post a new note with the files instead.",
  writtenByOneUptime: (column: string): string => {
    return `${column} is set by OneUptime as a public note is approved, and cannot be written.`;
  },
};

export default class PublicNoteApproval {
  /*
   * How a note reads. Only a note that says it is not published is held:
   * one that was not read as either is published, as every note was before
   * approval existed (the column defaults to published). An unpublished note
   * that is not rejected waits, whatever else its status says.
   */
  public static getState(
    columns: PublicNoteApprovalColumns | null | undefined,
  ): PublicNoteApprovalState {
    const status: string | null | undefined = columns?.approvalStatus;

    if (columns?.isPublished === false) {
      return status === PublicNoteApprovalStatus.Rejected
        ? PublicNoteApprovalState.Rejected
        : PublicNoteApprovalState.WaitingForApproval;
    }

    if (status === PublicNoteApprovalStatus.WaitingForApproval) {
      return PublicNoteApprovalState.EditWaitingForApproval;
    }

    if (status === PublicNoteApprovalStatus.Rejected) {
      return PublicNoteApprovalState.EditRejected;
    }

    return PublicNoteApprovalState.Published;
  }

  // A note, or its edit, waits for an approver.
  public static isWaiting(state: PublicNoteApprovalState): boolean {
    return (
      state === PublicNoteApprovalState.WaitingForApproval ||
      state === PublicNoteApprovalState.EditWaitingForApproval
    );
  }

  // A note, or its edit, was rejected.
  public static isRejected(state: PublicNoteApprovalState): boolean {
    return (
      state === PublicNoteApprovalState.Rejected ||
      state === PublicNoteApprovalState.EditRejected
    );
  }

  // The steps in the order a note goes through them.
  public static sortSteps(
    steps: ReadonlyArray<PublicNoteApprovalStepRule>,
  ): Array<PublicNoteApprovalStepRule> {
    return [...steps].sort(
      (a: PublicNoteApprovalStepRule, b: PublicNoteApprovalStepRule) => {
        if (a.order !== b.order) {
          return a.order - b.order;
        }

        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      },
    );
  }

  /*
   * The step a note waits for: the first step, in the steps' order now, that
   * has not approved it in this round. When every step has (one that had not
   * was taken out since), the last step is asked again. None when there are
   * no steps.
   */
  public static getPosition(
    round: PublicNoteApprovalRound | null,
    steps: ReadonlyArray<PublicNoteApprovalStepRule>,
  ): PublicNoteApprovalPosition {
    const sorted: Array<PublicNoteApprovalStepRule> = this.sortSteps(steps);

    if (sorted.length === 0) {
      return {
        step: null,
        number: 0,
        count: 0,
        isFinal: false,
        isAskedAgain: false,
      };
    }

    const approvedStepIds: Set<string> = new Set<string>(
      (round?.approvals || []).map((given: PublicNoteApprovalGiven) => {
        return given.stepId;
      }),
    );

    const remaining: Array<PublicNoteApprovalStepRule> = sorted.filter(
      (step: PublicNoteApprovalStepRule): boolean => {
        return !approvedStepIds.has(step.id);
      },
    );

    if (remaining.length === 0) {
      return {
        step: sorted[sorted.length - 1]!,
        number: sorted.length,
        count: sorted.length,
        isFinal: true,
        isAskedAgain: true,
      };
    }

    const step: PublicNoteApprovalStepRule = remaining[0]!;

    return {
      step: step,
      number: sorted.indexOf(step) + 1,
      count: sorted.length,
      isFinal: remaining.length === 1,
      isAskedAgain: false,
    };
  }

  // "step 2 (Legal)", "step 1": how a sentence names a step.
  public static getStepLabel(position: PublicNoteApprovalPosition): string {
    if (!position.step) {
      return "an approval step";
    }

    if (position.count <= 1) {
      return position.step.name
        ? `the approval step "${position.step.name}"`
        : "the approval step";
    }

    return position.step.name
      ? `step ${position.number} ("${position.step.name}")`
      : `step ${position.number}`;
  }

  // Whether a person is named on a step, themselves or through a team.
  public static isApproverOf(data: {
    step: PublicNoteApprovalStepRule;
    userId: string;
    userTeamIds: ReadonlyArray<string>;
  }): boolean {
    if (data.step.userIds.includes(data.userId)) {
      return true;
    }

    return data.step.teamIds.some((teamId: string): boolean => {
      return data.userTeamIds.includes(teamId);
    });
  }

  /*
   * Why this person may not make this decision on the note now, or null
   * when they may. Either decision takes someone named on the step the note
   * waits for, who did not send it for approval. Approving also takes
   * someone who has not approved an earlier step of it: one person never
   * approves a note twice. Rejecting publishes nothing, so an earlier
   * approver named on this step may still reject.
   */
  public static getDecisionRefusal(data: {
    state: PublicNoteApprovalState;
    round: PublicNoteApprovalRound | null;
    steps: ReadonlyArray<PublicNoteApprovalStepRule>;
    userId: string | null | undefined;
    userTeamIds: ReadonlyArray<string>;
    decision: PublicNoteApprovalDecision;
  }): string | null {
    if (!data.userId) {
      return PublicNoteApprovalMessages.notAPerson;
    }

    if (!this.isWaiting(data.state)) {
      return PublicNoteApprovalMessages.notWaiting;
    }

    const position: PublicNoteApprovalPosition = this.getPosition(
      data.round,
      data.steps,
    );

    if (!position.step) {
      return PublicNoteApprovalMessages.noSteps;
    }

    if (
      !this.isApproverOf({
        step: position.step,
        userId: data.userId,
        userTeamIds: data.userTeamIds,
      })
    ) {
      return PublicNoteApprovalMessages.notAnApprover(
        this.getStepLabel(position),
      );
    }

    if (data.round?.submittedByUserId === data.userId) {
      return PublicNoteApprovalMessages.sentByYou;
    }

    if (
      data.decision === PublicNoteApprovalDecision.Approve &&
      (data.round?.approvals || []).some(
        (given: PublicNoteApprovalGiven): boolean => {
          return given.userId === data.userId;
        },
      )
    ) {
      return PublicNoteApprovalMessages.approvedEarlierStep;
    }

    return null;
  }

  /*
   * The people a step asks: the ones it names and the members of the teams
   * it names (`teamMembers`, by team), less the person who sent the note
   * and anyone who approved it already. In the order named, once each.
   */
  public static getPeopleToAsk(data: {
    step: PublicNoteApprovalStepRule;
    teamMembers: Record<string, ReadonlyArray<string>>;
    round: PublicNoteApprovalRound | null;
  }): Array<string> {
    const excluded: Set<string> = new Set<string>(
      (data.round?.approvals || []).map((given: PublicNoteApprovalGiven) => {
        return given.userId;
      }),
    );

    if (data.round?.submittedByUserId) {
      excluded.add(data.round.submittedByUserId);
    }

    const people: Array<string> = [];

    const add: (userId: string) => void = (userId: string): void => {
      if (!excluded.has(userId) && !people.includes(userId)) {
        people.push(userId);
      }
    };

    data.step.userIds.forEach(add);

    for (const teamId of data.step.teamIds) {
      (Object.prototype.hasOwnProperty.call(data.teamMembers, teamId)
        ? data.teamMembers[teamId] || []
        : []
      ).forEach(add);
    }

    return people;
  }

  // A new round: the note, or its edit, sent for approval now.
  public static startRound(data: {
    now: Date;
    submittedByUserId?: string | null | undefined;
    isEdit: boolean;
    notifySubscribersOfEdit?: boolean | undefined;
    keepPostedAt?: boolean | undefined;
    before?: PublicNoteApprovalBefore | undefined;
  }): PublicNoteApprovalRound {
    const round: PublicNoteApprovalRound = {
      submittedAt: data.now.toISOString(),
      isEdit: data.isEdit,
      approvals: [],
    };

    if (data.submittedByUserId) {
      round.submittedByUserId = data.submittedByUserId;
    }

    if (data.isEdit && data.notifySubscribersOfEdit) {
      round.notifySubscribersOfEdit = true;
    }

    if (!data.isEdit && data.keepPostedAt) {
      round.keepPostedAt = true;
    }

    if (data.isEdit && data.before) {
      round.before = {
        status: data.before.status,
        round: this.withoutBefore(data.before.round),
      };
    }

    return round;
  }

  // The round once a step approved it.
  public static recordApproval(data: {
    round: PublicNoteApprovalRound | null;
    step: PublicNoteApprovalStepRule;
    userId: string;
    now: Date;
    comment?: string | null | undefined;
    isFinal: boolean;
  }): PublicNoteApprovalRound {
    const round: PublicNoteApprovalRound = this.copyRound(
      data.round || this.startRound({ now: data.now, isEdit: false }),
    );

    const given: PublicNoteApprovalGiven = {
      stepId: data.step.id,
      userId: data.userId,
      at: data.now.toISOString(),
    };

    if (data.step.name) {
      given.stepName = data.step.name;
    }

    const comment: string = this.cleanText(data.comment);

    if (comment) {
      given.comment = comment;
    }

    round.approvals.push(given);
    delete round.rejection;

    if (data.isFinal) {
      round.publishedAt = data.now.toISOString();
    }

    return round;
  }

  // The round once a step rejected it.
  public static recordRejection(data: {
    round: PublicNoteApprovalRound | null;
    step: PublicNoteApprovalStepRule | null;
    userId: string;
    now: Date;
    reason: string;
  }): PublicNoteApprovalRound {
    const round: PublicNoteApprovalRound = this.copyRound(
      data.round || this.startRound({ now: data.now, isEdit: false }),
    );

    const rejection: PublicNoteApprovalRejection = {
      userId: data.userId,
      at: data.now.toISOString(),
      reason: this.cleanText(data.reason),
    };

    if (data.step) {
      rejection.stepId = data.step.id;

      if (data.step.name) {
        rejection.stepName = data.step.name;
      }
    }

    round.rejection = rejection;

    return round;
  }

  /*
   * A comment or a reason as it is kept: trimmed, and at most
   * PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH characters. Anything that is not
   * text is none.
   */
  public static cleanText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().substring(0, PUBLIC_NOTE_APPROVAL_TEXT_MAX_LENGTH);
  }

  /*
   * A note's approval column, read: null when it holds no round, and only
   * the parts of one that are what they say they are - the column is JSON,
   * so a row written by hand or by a newer build is read with care.
   */
  public static readRound(value: unknown): PublicNoteApprovalRound | null {
    if (!this.isObject(value)) {
      return null;
    }

    const submittedAt: unknown = value["submittedAt"];

    if (typeof submittedAt !== "string" || !submittedAt) {
      return null;
    }

    const round: PublicNoteApprovalRound = {
      submittedAt: submittedAt,
      isEdit: value["isEdit"] === true,
      approvals: [],
    };

    if (
      typeof value["submittedByUserId"] === "string" &&
      value["submittedByUserId"]
    ) {
      round.submittedByUserId = value["submittedByUserId"];
    }

    if (value["notifySubscribersOfEdit"] === true) {
      round.notifySubscribersOfEdit = true;
    }

    if (value["keepPostedAt"] === true) {
      round.keepPostedAt = true;
    }

    if (typeof value["publishedAt"] === "string" && value["publishedAt"]) {
      round.publishedAt = value["publishedAt"];
    }

    const approvals: unknown = value["approvals"];

    if (Array.isArray(approvals)) {
      for (const item of approvals) {
        const given: PublicNoteApprovalGiven | null = this.readGiven(item);

        if (given) {
          round.approvals.push(given);
        }
      }
    }

    const rejection: PublicNoteApprovalRejection | null = this.readRejection(
      value["rejection"],
    );

    if (rejection) {
      round.rejection = rejection;
    }

    const before: unknown = value["before"];

    if (this.isObject(before)) {
      const status: unknown = before["status"];

      round.before = {
        status: this.isStatus(status) ? status : null,
        // One level only: a round before an edit has no edit before it.
        round: this.withoutBefore(this.readRound(before["round"])),
      };
    }

    return round;
  }

  // A round as the approval column stores it.
  public static toJSON(round: PublicNoteApprovalRound): JSONObject {
    return JSON.parse(JSON.stringify(round)) as JSONObject;
  }

  public static isStatus(value: unknown): value is PublicNoteApprovalStatus {
    return (
      typeof value === "string" &&
      (Object.values(PublicNoteApprovalStatus) as Array<string>).includes(value)
    );
  }

  private static withoutBefore(
    round: PublicNoteApprovalRound | null,
  ): PublicNoteApprovalRound | null {
    if (!round) {
      return null;
    }

    const copy: PublicNoteApprovalRound = {
      ...round,
      approvals: [...round.approvals],
    };
    delete copy.before;
    return copy;
  }

  private static copyRound(
    round: PublicNoteApprovalRound,
  ): PublicNoteApprovalRound {
    return (
      this.readRound(this.toJSON(round)) || {
        ...round,
        approvals: [...round.approvals],
      }
    );
  }

  private static readGiven(value: unknown): PublicNoteApprovalGiven | null {
    if (!this.isObject(value)) {
      return null;
    }

    const stepId: unknown = value["stepId"];
    const userId: unknown = value["userId"];
    const at: unknown = value["at"];

    if (
      typeof stepId !== "string" ||
      !stepId ||
      typeof userId !== "string" ||
      !userId ||
      typeof at !== "string" ||
      !at
    ) {
      return null;
    }

    const given: PublicNoteApprovalGiven = { stepId, userId, at };

    if (typeof value["stepName"] === "string" && value["stepName"]) {
      given.stepName = value["stepName"];
    }

    if (typeof value["comment"] === "string" && value["comment"]) {
      given.comment = value["comment"];
    }

    return given;
  }

  private static readRejection(
    value: unknown,
  ): PublicNoteApprovalRejection | null {
    if (!this.isObject(value)) {
      return null;
    }

    const userId: unknown = value["userId"];
    const at: unknown = value["at"];
    const reason: unknown = value["reason"];

    if (
      typeof userId !== "string" ||
      !userId ||
      typeof at !== "string" ||
      !at ||
      typeof reason !== "string"
    ) {
      return null;
    }

    const rejection: PublicNoteApprovalRejection = { userId, at, reason };

    if (typeof value["stepId"] === "string" && value["stepId"]) {
      rejection.stepId = value["stepId"];
    }

    if (typeof value["stepName"] === "string" && value["stepName"]) {
      rejection.stepName = value["stepName"];
    }

    return rejection;
  }

  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
