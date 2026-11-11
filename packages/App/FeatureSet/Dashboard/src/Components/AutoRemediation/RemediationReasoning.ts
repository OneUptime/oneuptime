import {
  getCitationMarkerRegex,
  parseInvestigationReport,
  ParsedInvestigationReport,
} from "Common/Utils/AI/InvestigationReport";
import { markdownToPlainText } from "../AI/InvestigationReport/InvestigationReportData";

/*
 * A FIX'S REASONING, WITHOUT THE REPORT AROUND IT (issue #6860).
 *
 * A round of an AI fix is an AI run, and its answer is posted the way an
 * investigation's report is (AIInvestigationEngine.buildBrandedMarkdown): a
 * brand heading ("🧠 AI — Automated Root Cause Analysis"), the answer, an
 * "Evidence checked" list and a footer that calls the run read-only. Under
 * a fix, the line that previews why read "🧠 AI — Automated Root Cause
 * Analysis I'll verify the current state of the pod ... --- Investigated
 * automatically by OneUptime AI — read-only, 0 ...": the heading of a
 * report the fix is not, and a footer that called a run read-only that may
 * have changed the cluster. A runbook pick also ends with the line the
 * server reads its pick from ("SelectedRunbook: <id>").
 *
 * Here all of that is taken off. What a fix's reasoning opens to is the
 * answer alone; the line under its step is the answer's Summary when it
 * wrote one, else its first words. The commands the round ran are listed
 * under the fix already (RemediationRoundEvidence), so the report's
 * citation marks ("[C1]"), which pointed at the list taken off, go too.
 *
 * React-free, so App's tests can read it.
 */

/*
 * The line a runbook pick ends with (RemediationPlanRunner's framing), in
 * the forms the server reads it in: "SelectedRunbook: <id>", bold or not.
 * One class for the spaces and stars around the label, so a long run of
 * them is read once (the AI's answer is outside text).
 */
const SELECTED_RUNBOOK_LINE: RegExp =
  /^[ \t*]*SelectedRunbook[ \t*]*[:=][^\n]*$/gim;

// Every Markdown heading line, read once each.
const HEADING_LINE: RegExp = /^[ \t]*#{1,6}[ \t][^\n]*$/gm;

/*
 * What a report's brand heading says after "AI — ", lower case: one the
 * parser leaves in, because something came before it - a pick proposed
 * instead of started puts its note first
 * (RemediationPlanRunner.withProposalNote).
 */
const BRAND_HEADING_WORDS: ReadonlyArray<string> = [
  "ai — automated root cause analysis",
  "ai — security case triage",
];

function isBrandHeadingLine(line: string): boolean {
  const lowerCase: string = line.toLowerCase();

  return BRAND_HEADING_WORDS.some((words: string): boolean => {
    return lowerCase.includes(words);
  });
}

/*
 * A citation mark ("[C1]") and the one space before it, so "memory [C1]."
 * reads "memory.": the shape of InvestigationReport's citation marker.
 */
const CITATION_MARK: RegExp = new RegExp(
  ` ?${getCitationMarkerRegex().source}`,
  "g",
);

function tidy(markdown: string): string {
  return markdown
    .replace(SELECTED_RUNBOOK_LINE, "")
    .replace(HEADING_LINE, (line: string): string => {
      return isBrandHeadingLine(line) ? "" : line;
    })
    .replace(CITATION_MARK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parse(markdown: string): ParsedInvestigationReport {
  return parseInvestigationReport(markdown);
}

/*
 * What a fix's reasoning opens to: the AI's answer as it wrote it, without
 * the report's heading, its stop note's place in it, the Evidence checked
 * list, the footer or the runbook pick's line. "" when there is none.
 */
export function getRemediationReasoningMarkdown(
  markdown: string | null | undefined,
): string {
  if (typeof markdown !== "string" || !markdown.trim()) {
    return "";
  }

  const report: ParsedInvestigationReport = parse(markdown);

  /*
   * A stop note says a limit stopped the run: it stays, under the answer,
   * where the run wrote it.
   */
  const body: string = report.stopNote
    ? `${report.bodyMarkdown}\n\n${report.stopNote}`
    : report.bodyMarkdown;

  return tidy(body);
}

/*
 * The line under a fix's first step that previews why: the answer's
 * Summary section when it wrote one - the answer, before the thinking
 * aloud that led to it ("I'll verify the current state of the pod") - else
 * the answer's first words, as plain text. Null when there is nothing.
 */
export function getRemediationReasoningPreview(
  markdown: string | null | undefined,
): string | null {
  if (typeof markdown !== "string" || !markdown.trim()) {
    return null;
  }

  const report: ParsedInvestigationReport = parse(markdown);
  const summary: string = report.summary ? tidy(report.summary) : "";
  const text: string = markdownToPlainText(
    summary || getRemediationReasoningMarkdown(markdown),
  );

  return text || null;
}
