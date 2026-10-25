import { TechniqueCoverage } from "./AttackCoverage";
import Dictionary from "Common/Types/Dictionary";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of Security Events > ATT&CK Coverage, as locale keys.
 *
 * What each tactic is after, in a line: MITRE_TACTICS keeps the same
 * sentences in Common (Types/SecurityEvent/MitreAttack.ts), which the
 * extractor does not read, so they are written out here once more for the
 * locales - and a test holds the two to each other. The tactics' and
 * techniques' own names are ATT&CK's, and stay as MITRE writes them.
 *
 * React-free so the words are pinned in a plain test.
 */
export const TACTIC_GOALS: Dictionary<string> = {
  TA0043: translationKey("Gather information to plan future operations."),
  TA0042: translationKey("Establish resources to support operations."),
  TA0001: translationKey("Get into your network."),
  TA0002: translationKey("Run malicious code."),
  TA0003: translationKey("Keep a foothold."),
  TA0004: translationKey("Gain higher-level permissions."),
  TA0005: translationKey("Hide activity and blend in with normal operations."),
  TA0112: translationKey("Disable or weaken security controls and monitoring."),
  TA0006: translationKey("Steal account names and passwords."),
  TA0007: translationKey("Figure out your environment."),
  TA0008: translationKey("Move through your environment."),
  TA0009: translationKey("Gather data of interest."),
  TA0011: translationKey(
    "Communicate with compromised systems to control them.",
  ),
  TA0010: translationKey("Steal data."),
  TA0040: translationKey("Manipulate, interrupt or destroy systems and data."),
};

// What each state of a technique is called, in the legend and on a cell's hover.
export const TECHNIQUE_COVERAGE_LABELS: Record<TechniqueCoverage, string> = {
  [TechniqueCoverage.Covered]: translationKey("Covered by an enabled rule"),
  [TechniqueCoverage.DisabledOnly]: translationKey(
    "Covered by disabled rules only",
  ),
  // The Rule Library by the name its page has, as "+2 in the Rule Library" beside it says.
  [TechniqueCoverage.InLibrary]: translationKey(
    "Available in the Rule Library",
  ),
  [TechniqueCoverage.NotCovered]: translationKey("Not covered"),
};

// The two ways to look at the coverage.
export enum AttackCoverageView {
  // A row per tactic, opening on its techniques: the page opens on it.
  Tactics = "tactics",
  // The ATT&CK matrix, a column per tactic.
  Matrix = "matrix",
}

// The page's address keeps the view, and can open on one tactic.
export const ATTACK_COVERAGE_QUERY_KEYS: { view: string; tactic: string } = {
  view: "view",
  tactic: "tactic",
};

export const ATTACK_COVERAGE_VIEW_LABELS: Record<AttackCoverageView, string> = {
  [AttackCoverageView.Tactics]: translationKey("By tactic"),
  [AttackCoverageView.Matrix]: translationKey("Matrix"),
};

// The card's words, by view: a row of tactics opens; the matrix lights cells.
export const ATTACK_COVERAGE_DESCRIPTIONS: Record<AttackCoverageView, string> =
  {
    [AttackCoverageView.Tactics]: translationKey(
      "Tactics are what an attacker is after, in the order an attack moves through them. Techniques are how. Open a tactic to see which of its techniques your rules cover.",
    ),
    [AttackCoverageView.Matrix]: translationKey(
      "Columns are tactics and cells techniques. Lit cells are covered by your rules, outlined ones by library rules not added yet.",
    ),
  };

// A tactic's bar: how many of its techniques the enabled rules cover.
export const TACTIC_COVERED_COUNT: string = translationKey(
  "{{covered}} of {{total}}",
);

// Under it, what the Rule Library would add to the tactic.
export const TACTIC_LIBRARY_COUNT: string = translationKey(
  "+{{count}} in the Rule Library",
);

// The page's next step, while the Rule Library covers what the rules do not.
export const LIBRARY_GAP_SENTENCE: PluralTemplate = {
  one: "The Rule Library covers {{count}} technique your rules do not.",
  other: "The Rule Library covers {{count}} techniques your rules do not.",
};

export const LIBRARY_GAP_ACTION: string = translationKey(
  "See the rules you have not added",
);

// The view the address names, or the tactics.
export function readAttackCoverageView(
  value: string | null | undefined,
): AttackCoverageView {
  return value === AttackCoverageView.Matrix
    ? AttackCoverageView.Matrix
    : AttackCoverageView.Tactics;
}
