/*
 * WHAT ONEUPTIME AI MAY DO ON A SECURITY CASE, PER AREA (#10352).
 *
 * A module of its own, which imports nothing: a project's model names these
 * modes for its columns, and every page that draws a project - the Admin
 * Dashboard's among them - would otherwise load the rest of SecurityCaseAi
 * with it: its blocks, its verdicts and the words they are said in.
 * SecurityCaseAi exports them as well.
 */
export enum SecurityCaseAiMode {
  // Left to a person, and OneUptime AI says so on the case.
  Off = "Off",
  // Asked of a person, with the evidence, wherever they are.
  Ask = "Ask",
  // Done, on the timeline as OneUptime AI's, where it can be undone.
  OnItsOwn = "OnItsOwn",
}

export const SECURITY_CASE_AI_MODES: ReadonlyArray<SecurityCaseAiMode> = [
  SecurityCaseAiMode.Off,
  SecurityCaseAiMode.Ask,
  SecurityCaseAiMode.OnItsOwn,
];
