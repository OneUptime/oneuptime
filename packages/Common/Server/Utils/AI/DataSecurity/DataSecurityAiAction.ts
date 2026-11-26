import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityIssueAnalysisRecord } from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ONE KIND OF CHANGE ONEUPTIME AI PROPOSES FOR A DATA SECURITY ISSUE, AND
 * HOW IT IS MADE, CHECKED AND UNDONE (#10364).
 *
 * The engine (DataSecurityAiEngine) asks each action of a kind of work the
 * project's AI rules turn on what it would change for an issue (plan);
 * it decides whether that waits for a person (Types/DataSecurity/
 * DataSecurityAi); and the routes approve, dismiss and undo what it planned
 * (DataSecurityAiProposals), holding each person to the permission the
 * change itself takes. An action knows its change and nothing else: it
 * never decides whether to ask.
 *
 * Adding a kind of change (#10366's AI-written scrub rules, #10367's pull
 * requests, #10372's verdicts, #10374's owners - for a store, or for the
 * project's stores, with no issue at all):
 *
 *   1. a value in DataSecurityAiProposalKind, with its definition in
 *      DATA_SECURITY_AI_PROPOSAL_KINDS - the work it is and what it changes;
 *   2. an object implementing this interface, in Actions/;
 *   3. its entry in DataSecurityAiActions.
 *
 * The rules, the inbox, the timelines, the two-approval rule, the circuit
 * breaker, undo and Why AI did not act then hold for it, with no change of
 * their own. Its plan holds names, places, counts and ids - never a value,
 * a sample or a record - and every text it writes that a cloud, a person or
 * a service named goes in as text, never as Markdown (mdText).
 */

// What an action reads to plan a change for an issue.
export interface DataSecurityAiIssueContext {
  projectId: ObjectID;
  issue: DataSecurityIssue;
  store: DataStore;
  // The project's names for its data types (ProjectDataTypeNames).
  dataTypeNamer: DataTypeNamer;
  now: Date;
  /*
   * OneUptime AI's analysis of the issue, when it has one (#10369), set by
   * Analyze before any other work is planned: its verdict and the facts
   * each line rests on, which an action may propose from - Accept Risk on
   * a verdict of Likely by design, Not an issue on Likely a wrong finding
   * (#10372), each still for a person to approve. Never a reason to change
   * anything on OneUptime AI's word alone.
   */
  analysis?: DataSecurityIssueAnalysisRecord | null | undefined;
  /*
   * The LLM provider the deciding AI rules pick for the work, "" or none
   * for the project's own: an action that asks OneUptime AI asks it there.
   */
  llmProviderId?: string | undefined;
}

// A change an action would make, as a proposal shows it.
export interface DataSecurityAiPlannedChange {
  // What it proposes, in a line, as plain text.
  title: string;
  // A preview of the change, a person can read before approving it.
  changeMarkdown: string;
  // Why, with the facts it rests on.
  reasonMarkdown: string;
  // How it is proven to have worked: a check, never OneUptime AI's word.
  proofMarkdown: string;
  // What Undo does, and what it cannot take back.
  undoMarkdown: string;
  // What the action reads to make it: names and ids only.
  plan: JSONObject;
  /*
   * What makes it the same change again: OneUptime AI never proposes the
   * same one for an issue twice, unless the last one expired. A plan of a
   * kind whose key differs replaces the one of that kind still waiting.
   */
  planKey: string;
  // What it changes, when not its kind's (DATA_SECURITY_AI_PROPOSAL_KINDS).
  safety?: DataSecurityAiChangeSafety | undefined;
  /*
   * Whether it proves it is safe enough to run without asking out of the
   * box, with no AI rule (#10366's conditions for a secret's scrub rule).
   */
  meetsDefaultConditions: boolean;
  /*
   * Whether it may run without asking at all, whatever a rule says: false
   * for a change that cannot prove it is safe - a scrub rule not proven on
   * its records, one that changes other values there, or one that hides
   * what something reads (#10366). Left out, it may, as the rules decide.
   */
  canRunWithoutAsking?: boolean | undefined;
  // Whether the deciding rule names this very action (a change of access).
  isNamedByRule?: boolean | undefined;
}

export type DataSecurityAiPlanOutcome =
  | { kind: "planned"; changes: Array<DataSecurityAiPlannedChange> }
  /*
   * Nothing to change for this issue, and why, as a short code of
   * lower-case words ("no-unscrubbed-finding"): what Why AI did not act
   * says.
   */
  | { kind: "nothing"; detail: string };

/*
 * Who a change is made, or undone, as: a person who approved or pressed
 * Undo - with their own props, so the change is refused where they could
 * not make it themselves - or OneUptime AI, for a change made without
 * asking (props as root, and no person).
 */
export interface DataSecurityAiActor {
  props: DatabaseCommonInteractionProps;
  userId?: ObjectID | undefined;
}

export interface DataSecurityAiChangeMade {
  // What making it made, for Undo to take back.
  result: JSONObject;
  // What the timelines say was done, in Markdown.
  summaryMarkdown: string;
  /*
   * What the issue's timeline entry shows when it is opened: how the
   * change was proven, and anything else a person acts on (#10366).
   */
  detailsMarkdown?: string | undefined;
}

export interface DataSecurityAiChangeUndone {
  summaryMarkdown: string;
}

export interface DataSecurityAiAction {
  kind: DataSecurityAiProposalKind;

  // Whether it can ever change anything for an issue of this check: cheap, read nothing.
  appliesToCheck(checkId: string | undefined): boolean;

  // What it would change for the issue, read as OneUptime.
  plan(context: DataSecurityAiIssueContext): Promise<DataSecurityAiPlanOutcome>;

  /*
   * Why this person may not make the change, or null when they may: the
   * permission the change itself takes - approving a scrub rule takes what
   * creating one takes. Asked before anything is claimed; the change is
   * made with the person's props whatever this says, so a check here never
   * widens what they may do.
   */
  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
    // What the person changed before approving, read by readChanges.
    changes?: JSONObject | undefined;
  }): string | null;

  // The same for Undo: what taking the change back takes.
  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
    proposal: DataSecurityAiProposal;
  }): string | null;

  /*
   * What a person changed before approving ("change one first", #10374),
   * read and held to what the change may be - an owner who is one of the
   * project's - or refused in words. An action without it takes no change:
   * its proposal is approved as it was proposed.
   */
  readChanges?(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    changes: unknown;
  }): Promise<JSONObject>;

  /*
   * Make the change, as the actor - with what the person changed first,
   * when they did. Throws, in words a person reads, when it cannot.
   */
  apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
    changes?: JSONObject | undefined;
  }): Promise<DataSecurityAiChangeMade>;

  /*
   * After a change of this kind is proposed: what it shares with others is
   * looked at once for all of them - a store's owners, the owner rules
   * several stores' owners rest on (#10374). Never fails the proposal.
   */
  onProposed?(data: { projectId: ObjectID }): Promise<void>;

  /*
   * After OneUptime AI made a change of this kind without asking: who is
   * told, beyond the timelines - the store's and the service's owners of a
   * scrub rule made on its own (#10366). Never fails the change.
   */
  onMadeWithoutAsking?(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    made: DataSecurityAiChangeMade;
  }): Promise<void>;

  // Take it back, as the actor. Throws when it cannot.
  undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone>;
}
