import { JSONObject } from "../../../../../Types/JSON";

/*
 * One fault-injection scenario of the investigation benchmark (issue #6800):
 * an incident with a cause we planted, and the telemetry an investigation
 * of it would read - the fault's own evidence, and distractors that point
 * somewhere plausible but wrong (a deploy that changed nothing that
 * matters, a noisy but harmless error, a dependency that is fine). The
 * benchmark runs the real investigation loop over it, with the model under
 * test, and scores whether the answer names the planted cause and cites
 * the evidence for it (InvestigationBenchmark, BenchmarkScorer).
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
  // Rows, written as the toolbox writes rows ("- key=value | key=value")...
  rows?: Array<JSONObject> | undefined;
  // ...or free text, as a trace tree or a change's details are.
  text?: string | undefined;
  // The citation label, as the real tool would write it.
  citationLabel?: string | undefined;
  /*
   * The planted fault's own evidence: an answer that cites a result of this
   * response grounded its cause in it.
   */
  isKeyEvidence?: boolean | undefined;
}

export interface BenchmarkExpectation {
  /*
   * The root cause as the people who resolved it would write it: what the
   * judge grades the answer against, in the production grader's words.
   */
  rootCause: string;
  /*
   * Words the answer's "Most likely root cause" must hold: every group, by
   * any one of its words (ignoring case), so "connection pool" or "pool
   * exhausted" both satisfy ["connection pool", "pool exhausted"].
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
  // The fault we planted, in a sentence, for the report.
  plantedFault: string;
  /*
   * When the incident was declared, ISO 8601. The prompt's "now" is
   * minutesSinceDeclared after it.
   */
  declaredAt: string;
  minutesSinceDeclared: number;
  /*
   * The starting context, written as the investigation runner writes it
   * ("# Incident", "Title: ...", then any linked infrastructure, SLOs and
   * recent changes sections).
   */
  contextText: string;
  responses: Array<BenchmarkToolResponse>;
  expectation: BenchmarkExpectation;
}
