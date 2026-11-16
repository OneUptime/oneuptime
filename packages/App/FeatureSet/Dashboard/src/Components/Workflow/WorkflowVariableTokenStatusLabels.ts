import { OAuth2TokenStatus } from "Common/Types/Workflow/WorkflowVariableOAuth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Access Token card's pill (WorkflowVariableTokenStatus) calls each
 * status. The pill looks its text up, so these are the keys it finds. Not
 * fetched yet and Valid are the token's own keys (MeaningKeys), which
 * English reads as the bare words: shared with a calendar link and a
 * certificate, Russian's "Ещё не запрашивалась" and Arabic's "صالحة"
 * (feminine) read beside the token's masculine Expired as words about
 * something else (#8659).
 *
 * React-free, so App's tests can read them: App has no react
 * (Tests/FeatureSetImportsStayReactFree.test.ts).
 */
export const OAUTH2_TOKEN_STATUS_LABELS: Record<OAuth2TokenStatus, string> = {
  [OAuth2TokenStatus.NotFetched]: translationKey(
    "Not fetched yet (OAuth token)",
  ),
  [OAuth2TokenStatus.Valid]: translationKey("Valid (OAuth token)"),
  [OAuth2TokenStatus.Expired]: translationKey("Expired"),
  [OAuth2TokenStatus.NoExpiry]: translationKey("No expiry reported"),
  [OAuth2TokenStatus.RefreshFailed]: translationKey("Refresh failed"),
};
