import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX (#6148's follow-up, which #5519
 * proposed): Project Settings → AI → AI Features → More settings → Fix
 * approvals.
 *
 * One switch, saved the moment it is flipped: with it on, a fix OneUptime AI
 * proposes that holds a riskier change runs only once two different people
 * approve it - on the incident's or alert's AI card, or from the fix's
 * Slack or Microsoft Teams message (Common/Types/AutoRemediation/
 * RemediationApprovals; RemediationApproval decides it on the server). Off
 * by default, for new projects too: most teams approve a fix with one
 * person, so the switch is folded under More settings, beside the project's
 * daily limits, and the folded header says "Fix approvals: Two people" while
 * it is on, so folding never hides it.
 *
 * Project owners and admins change it (the column's update list), as they
 * change whether new incidents and alerts are fixed; everyone else sees the
 * switch locked, with the permission it needs.
 *
 * React-free, so App's tests read these exact strings; every sentence goes
 * through translationKey() so npm run i18n:extract finds it.
 */

/*
 * The Project column the switch saves, named on its own so the AI card can
 * follow the switch (useTwoApprovalsRule) as well.
 */
export type TwoApprovalsColumn = "requireTwoApprovalsForRiskierFixes";

export const TWO_APPROVALS_COLUMN: TwoApprovalsColumn =
  "requireTwoApprovalsForRiskierFixes";

/*
 * The card's place in More settings: the name the folded header lists it
 * by, so a link to it - Cmd+K's "Fix approvals" - opens the fold at it.
 */
export const FIX_APPROVALS_CARD_KEY: string = "FixApprovals";

// The switch's data-testid (ModelSwitchRow); its card's is "-card" after it.
export const FIX_APPROVALS_SWITCH_TEST_ID: string = "fix-approvals-switch";

export const FixApprovalsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  switchDescription: string;
  // The folded header's chip while it is on: "Fix approvals: Two people".
  foldedValue: string;
} = {
  cardTitle: translationKey("Fix approvals"),
  cardDescription: translationKey(
    "How many people approve a fix OneUptime AI proposes before it runs.",
  ),
  switchTitle: translationKey("Ask two people to approve riskier fixes"),
  switchDescription: translationKey(
    "A fix with a riskier change, such as stopping something or scaling it to zero, runs only once two different people approve it, here or in Slack or Microsoft Teams.",
  ),
  foldedValue: translationKey("Two people"),
};

/*
 * The card as the folded More settings header lists it: by name, and as a
 * chip saying "Two people" once the switch is on. Unknown (not read yet),
 * it is listed by name, as a card at its default is.
 */
export const getFixApprovalsFoldedItem: (
  isOn: boolean | null,
) => FoldedSectionItem = (isOn: boolean | null): FoldedSectionItem => {
  return foldedSectionItem(FixApprovalsCopy.cardTitle, {
    key: FIX_APPROVALS_CARD_KEY,
    isSet: isOn === true,
    value: FixApprovalsCopy.foldedValue,
    translateValue: true,
  });
};
