import { JSONObject } from "../../../../../Types/JSON";

/*
 * One fault-injection scenario of the investigation benchmark (issue #6800):
 * an incident or an alert with a cause we planted, and the telemetry an
 * investigation of it would read - the fault's own evidence, and distractors
 * that point somewhere plausible but wrong (a deploy that changed nothing
 * that matters, a noisy but harmless error, a dependency that is fine). The
 * benchmark runs the real investigation loop over it, with the model under
 * test, and scores whether the answer names the planted cause and cites
 * the evidence for it (InvestigationBenchmark, BenchmarkScorer).
 *
 * Some scenarios plant no cause the evidence can name (#7766): the right
 * answer says it could not tell, and lists what it checked, rather than
 * blaming the most plausible distractor (BenchmarkExpectationKind).
 *
 * Scenarios are made up end to end: nothing in them is any project's data,
 * and nothing reads a database or a project's telemetry.
 */

export enum BenchmarkFaultKind {
  BadDeploy = "Bad deploy",
  Capacity = "Capacity",
  Dependency = "Dependency",
  Configuration = "Configuration",
  Infrastructure = "Infrastructure",
  Traffic = "Traffic",
  Certificate = "Certificate",
  Data = "Data",
  // Two faults that together caused it: the answer names both (#7766).
  TwoCauses = "Two causes",
  // Nothing the evidence shows explains it (#7766).
  NoEvidence = "No evidence",
}

// What the investigation is about, as the runner that starts it names it.
export enum BenchmarkSubjectKind {
  Incident = "incident",
  Alert = "alert",
}

/*
 * What a right answer does: name the planted cause, or say plainly that the
 * evidence names none.
 */
export enum BenchmarkExpectationKind {
  /*
   * The planted fault is the answer: the root cause holds the scenario's
   * words for it (or a judge grades it MATCH) and cites its evidence.
   */
  Cause = "cause",
  /*
   * The evidence names no cause, and the right answer says so (#7766): its
   * root cause says it could not tell (or the product's own confidence
   * classifier, run by a judge, reads it as INCONCLUSIVE), and it cites
   * what it checked. A confident answer - right words or wrong - fails.
   */
  Inconclusive = "inconclusive",
}

/*
 * What a scripted tool hands back for the calls it matches. The first
 * response of a tool whose whenArguments all match answers the call; a
 * response without whenArguments answers any call of its tool. A tool no
 * response answers returns no rows, as a real tool with nothing to show.
 */
export interface BenchmarkToolResponse {
  toolName: string;
  /*
   * What the call must carry for this response: each value found, ignoring
   * case, in the call's argument of that name - in the text of a string, or
   * in one item of a list. Left out: any call of the tool.
   */
  whenArguments?: { [argumentName: string]: string } | undefined;
  /*
   * What the real tool writes before its rows, each part as the tool
   * writes it (its notes end with a line break): query_slos opens with its
   * deploy-gate and compliance notes, for example (#7766). Handed over
   * before the rows, unredacted, as the tool hands them over.
   */
  notes?: Array<string> | undefined;
  /*
   * What the real tool writes after its rows, on a line of its own, its
   * sentences joined by a space: query_containers says which host and
   * window it read, and how many containers reported.
   */
  notesAfterRows?: Array<string> | undefined;
  // Rows, written as the toolbox writes rows ("- key=value | key=value")...
  rows?: Array<JSONObject> | undefined;
  // ...or free text, as a trace tree or a change's details are.
  text?: string | undefined;
  // The citation label, as the real tool would write it.
  citationLabel?: string | undefined;
  /*
   * The planted fault's own evidence: an answer that cites a result of this
   * response grounded its cause in it. In a scenario whose evidence names
   * no cause, what shows there is none: an honest answer cites what it
   * checked.
   */
  isKeyEvidence?: boolean | undefined;
}

export interface BenchmarkExpectation {
  // Left out: Cause.
  kind?: BenchmarkExpectationKind | undefined;
  /*
   * The root cause as the people who resolved it would write it: what the
   * judge grades the answer against, in the production grader's words. For
   * a scenario whose evidence names no cause, what they found: that
   * nothing they could see explains it.
   */
  rootCause: string;
  /*
   * Words the answer's "Most likely root cause" must hold: every group, by
   * any one of its words (ignoring case), so "connection pool" or "pool
   * exhausted" both satisfy ["connection pool", "pool exhausted"]. A
   * scenario whose evidence names no cause holds INCONCLUSIVE_WORDS
   * (BenchmarkScorer), the words an answer that could not tell uses.
   */
  mustMention: Array<Array<string>>;
  /*
   * The plausible wrong causes the scenario plants, by name, with the words
   * that name each - reported when the root cause names one, so a reader
   * sees which distractor fooled the model.
   */
  distractors: Array<{ name: string; terms: Array<string> }>;
}

export interface BenchmarkScenario {
  // Stable, kebab-case: results are compared by it across runs.
  id: string;
  title: string;
  faultKind: BenchmarkFaultKind;
  // Left out: an incident.
  subjectKind?: BenchmarkSubjectKind | undefined;
  // The fault we planted, in a sentence, for the report.
  plantedFault: string;
  /*
   * When the incident or alert was declared, ISO 8601. The prompt's "now"
   * is minutesSinceDeclared after it.
   */
  declaredAt: string;
  minutesSinceDeclared: number;
  /*
   * The starting context, written as the investigation runner writes it
   * ("# Incident" or "# Alert", "Title: ...", then any past cases, linked
   * infrastructure, SLOs and recent changes sections).
   */
  contextText: string;
  responses: Array<BenchmarkToolResponse>;
  expectation: BenchmarkExpectation;
}

// What a scenario's investigation is about: an incident unless it says.
export function getScenarioSubjectKind(
  scenario: BenchmarkScenario,
): BenchmarkSubjectKind {
  return scenario.subjectKind || BenchmarkSubjectKind.Incident;
}

// What a right answer does: names the cause unless the scenario says.
export function getScenarioExpectationKind(
  scenario: BenchmarkScenario,
): BenchmarkExpectationKind {
  return scenario.expectation.kind || BenchmarkExpectationKind.Cause;
}
