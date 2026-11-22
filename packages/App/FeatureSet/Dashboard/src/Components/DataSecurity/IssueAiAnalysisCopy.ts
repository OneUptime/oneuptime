import {
  DataSecurityAiVerdict,
  DataSecurityAnalysisFactKind,
  DataSecurityIssueAnalysisView,
  findAnalysisFact,
  findAnalysisFacts,
  ResponseFact,
  StoreExposureFact,
} from "Common/Types/DataSecurity/DataSecurityIssueAnalysis";
import { DataSecurityAiProposalKind } from "Common/Types/DataSecurity/DataSecurityAi";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreExposure } from "Common/Types/DataSecurity/DataStorePosture";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF ONEUPTIME AI'S ANALYSIS ON AN ISSUE (#10369), AND WHICH OF
 * ITS BUTTONS AN ISSUE OFFERS.
 *
 * Kept free of React, so a test can read every word and every rule without
 * drawing the card: IssueAiAnalysisCard draws them.
 */

export const ANALYSIS_CARD_TITLE: string = translationKey(
  "OneUptime AI Analysis",
);

export const ANALYSIS_CARD_DESCRIPTION: string = translationKey(
  "Written by OneUptime AI from what Data Security knows about this issue. Check it before you act on it.",
);

export const ANALYZE_ISSUE: string = translationKey("Analyze Issue");
export const ANALYZE_AGAIN: string = translationKey("Analyze Again");

export const NOT_ANALYZED_YET: string = translationKey(
  "OneUptime AI has not analyzed this issue yet. It analyzes new Critical and High issues on its own, as your Data Security AI rules allow.",
);

export const ANALYSIS_NOT_LOADED: string = translationKey(
  "OneUptime AI's analysis could not be loaded.",
);

export const ANALYSIS_NOT_WRITTEN: string = translationKey(
  "OneUptime AI could not analyze this issue.",
);

export const ANALYZED_AT: string = translationKey("Analyzed {{time}}");

export const ANALYZED_NOW: string = translationKey(
  "OneUptime AI analyzed this issue again.",
);

export const ANALYSIS_UNCHANGED: string = translationKey(
  "Nothing this analysis rests on changed, so OneUptime AI kept it.",
);

// Under a verdict a person acts on: nothing has been done.
export const PERSON_DECIDES: string = translationKey(
  "Nothing changes until you choose.",
);

export const LINE_HIDDEN: string = translationKey(
  "Hidden: it rests on {{what}}, which you may not read.",
);

export const SHOW_FACTS: PluralTemplate = {
  one: "Show the {{count}} fact it rests on",
  other: "Show the {{count}} facts it rests on",
};

export const HIDE_FACTS: string = translationKey("Hide the facts");

// The buttons.
export const PUBLIC_BY_DESIGN: string = translationKey("Public By Design");
export const SET_OWNERS: string = translationKey("Set Owners");
export const REVIEW_PROPOSAL: string = translationKey("Review Proposal");
export const FIX_WITH_AI: string = translationKey("Fix with AI");

export const PUBLIC_BY_DESIGN_QUESTION: string = translationKey(
  "Mark {{store}} public by design?",
);

export const PUBLIC_BY_DESIGN_SENTENCE: string = translationKey(
  "Its public access checks pass from now on, and it is checked again now: this issue resolves once its check passes. Undo it in the store's Settings.",
);

export const PUBLIC_BY_DESIGN_DONE: string = translationKey(
  "{{store}} is marked public by design and is being checked again.",
);

// The facts, as the card folds them out.
export const FACT_THE_ISSUE: string = translationKey("The issue");

export const FACT_RECORDS: PluralTemplate = {
  one: "About {{count}} record",
  other: "About {{count}} records",
};

export const FACT_OBJECTS: PluralTemplate = {
  one: "About {{count}} object",
  other: "About {{count}} objects",
};

export const FACT_NO_SENSITIVE_DATA: string = translationKey(
  "No sensitive data found yet.",
);

export const FACT_MARKED_PUBLIC_BY_DESIGN: string = translationKey(
  "Marked public by design",
);

export const FACT_IDENTITIES: PluralTemplate = {
  one: "{{count}} identity can reach it",
  other: "{{count}} identities can reach it",
};

export const FACT_PUBLIC_GRANTS: PluralTemplate = {
  one: "{{count}} grant is public",
  other: "{{count}} grants are public",
};

export const FACT_EXTERNAL_GRANTS: PluralTemplate = {
  one: "{{count}} grant reaches outside your accounts",
  other: "{{count}} grants reach outside your accounts",
};

export const FACT_USED_LATELY: PluralTemplate = {
  one: "{{count}} identity used its access in the last 90 days",
  other: "{{count}} identities used their access in the last 90 days",
};

export const FACT_GRANT: string = translationKey("{{level}} through {{via}}");

export const FACT_PUBLIC: string = translationKey("Public grant");
export const FACT_OUTSIDE_YOUR_ACCOUNTS: string = translationKey(
  "Outside your accounts",
);
export const FACT_THE_FIX_REMOVES_IT: string =
  translationKey("The fix removes it");

export const FACT_LAST_USED: string = translationKey("Last used {{when}}");
export const FACT_SEEN_USING_IT: string = translationKey(
  "Seen using it {{when}}",
);

export const FACT_NOTHING_USES_IT: string = translationKey(
  "Nothing OneUptime can see uses this store.",
);

export const FACT_HOLDS_COPY_OF_THIS: string = translationKey(
  "Holds a copy of this store's data",
);
export const FACT_THIS_HOLDS_ITS_COPY: string = translationKey(
  "This store holds a copy of its data",
);
export const FACT_VALUES_IN_COMMON: string = translationKey(
  "{{percent}} of values in common",
);

export const FACT_SECURITY_CASE: string = translationKey(
  "A security case is about this store",
);
export const OPEN_SECURITY_CASE: string = translationKey(
  "Open the Security Case",
);

export const FACT_CAN_RUN_FROM_HERE: string = translationKey(
  "Can run from this page",
);

export const FACT_PROPOSED: string = translationKey(
  "OneUptime AI proposed it: {{status}}",
);

export const FACT_DECLARED_IN: string = translationKey(
  "Declared in {{codeKind}}",
);

export const FACT_OWNERS: PluralTemplate = {
  one: "{{count}} owner",
  other: "{{count}} owners",
};

export const FACT_NO_OWNER: string = translationKey("Nobody owns this store.");

// What OneUptime AI proposed, by kind, as the facts name it.
export const PROPOSAL_KIND_TITLES: Readonly<
  Record<DataSecurityAiProposalKind, string>
> = {
  [DataSecurityAiProposalKind.ScrubTelemetry]: translationKey(
    "Scrub It rules for where its data was found",
  ),
  // Owners for the issue's store, and the rule that keeps stores like it owned (#10374).
  [DataSecurityAiProposalKind.SetStoreOwners]: translationKey("Store owners"),
  [DataSecurityAiProposalKind.CreateOwnerRule]: translationKey("Owner rules"),
  // The fix of the cause of the issue's group (#10370), in code or in its cloud.
  [DataSecurityAiProposalKind.FixIssueGroupInCode]: translationKey(
    "One pull request for the cause",
  ),
  [DataSecurityAiProposalKind.FixIssueGroupInCloud]: translationKey(
    "One approval for the stores made in the console",
  ),
};

// Where a proposal stands, as a fact says it (DataSecurityAiProposalStatus).
export const PROPOSAL_STATUS_TITLES: Readonly<Record<string, string>> = {
  Proposed: translationKey("waiting for a person"),
  Approved: translationKey("approved, being made"),
  Applied: translationKey("made after a person approved it"),
  AppliedWithoutAsking: translationKey("made without asking"),
  Dismissed: translationKey("dismissed"),
  Expired: translationKey("no longer needed"),
  Undone: translationKey("undone"),
  Failed: translationKey("failed"),
};

// A question OneUptime AI's answer said nothing on that rests on a fact.
export const PART_MISSING: string = translationKey(
  "OneUptime AI said nothing on this that rests on a fact.",
);

// How each verdict looks: what it means, not a colour.
export const VERDICT_TONES: Readonly<Record<DataSecurityAiVerdict, PillTone>> =
  {
    [DataSecurityAiVerdict.Real]: PillTone.Danger,
    [DataSecurityAiVerdict.LikelyByDesign]: PillTone.Info,
    [DataSecurityAiVerdict.LikelyWrongFinding]: PillTone.Neutral,
    [DataSecurityAiVerdict.CannotTell]: PillTone.Neutral,
  };

/*
 * What a verdict offers a person, beside the shortest path's own buttons
 * (#10369: "By design, said with care"): never pressed for them.
 *
 *   - Likely by design: Accept Risk, with the reason drafted, on an issue
 *     whose risk can be accepted; and Public By Design on a public store
 *     not marked so.
 *   - Likely a wrong finding: Not an Issue, with the reason drafted.
 */
export interface AnalysisVerdictActions {
  acceptRisk: boolean;
  publicByDesign: boolean;
  notAnIssue: boolean;
}

const PUBLIC_EXPOSURES: ReadonlyArray<string> = [
  DataStoreExposure.Public,
  DataStoreExposure.OtherAccounts,
];

export function getAnalysisVerdictActions(data: {
  view: DataSecurityIssueAnalysisView;
  status: DataSecurityIssueStatus | string | undefined;
}): AnalysisVerdictActions {
  const status: string = data.status || DataSecurityIssueStatus.Open;
  const isOpen: boolean =
    status === DataSecurityIssueStatus.Open ||
    status === DataSecurityIssueStatus.Accepted;
  const exposure: StoreExposureFact | undefined = findAnalysisFact(
    data.view,
    DataSecurityAnalysisFactKind.StoreExposure,
  );

  return {
    acceptRisk:
      data.view.verdict === DataSecurityAiVerdict.LikelyByDesign && isOpen,
    publicByDesign:
      data.view.verdict === DataSecurityAiVerdict.LikelyByDesign &&
      isOpen &&
      Boolean(exposure) &&
      !exposure!.isPublicByDesign &&
      PUBLIC_EXPOSURES.includes(exposure!.exposure),
    notAnIssue:
      data.view.verdict === DataSecurityAiVerdict.LikelyWrongFinding &&
      status !== DataSecurityIssueStatus.NotAnIssue,
  };
}

/*
 * What the shortest path's buttons are, from its facts: the response
 * action that can run from the page, the code to fix it in, OneUptime AI's
 * proposal waiting for a person, a store nobody owns.
 */
export interface AnalysisPathActions {
  response: ResponseFact | undefined;
  fixInCode: boolean;
  reviewProposal: boolean;
  setOwners: boolean;
}

export function getAnalysisPathActions(data: {
  view: DataSecurityIssueAnalysisView;
  status: DataSecurityIssueStatus | string | undefined;
}): AnalysisPathActions {
  const isOpen: boolean =
    (data.status || DataSecurityIssueStatus.Open) ===
    DataSecurityIssueStatus.Open;
  const response: ResponseFact | undefined = findAnalysisFacts(
    data.view,
    DataSecurityAnalysisFactKind.Response,
  ).find((fact: ResponseFact): boolean => {
    return fact.isAvailable;
  });

  return {
    response: isOpen ? response : undefined,
    fixInCode:
      isOpen &&
      Boolean(
        findAnalysisFact(data.view, DataSecurityAnalysisFactKind.DeclaredCode),
      ),
    reviewProposal:
      isOpen &&
      findAnalysisFacts(data.view, DataSecurityAnalysisFactKind.Proposal).some(
        (fact: { status: string }): boolean => {
          return fact.status === "Proposed";
        },
      ),
    setOwners: Boolean(
      findAnalysisFact(data.view, DataSecurityAnalysisFactKind.NoOwner),
    ),
  };
}
