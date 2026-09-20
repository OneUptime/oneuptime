/*
 * What the edition dialog must say about an Enterprise license lapse. Shared
 * by the core EditionLabel suite and ee/Tests/UI/License, which renders the
 * same dialog with the Enterprise license manager.
 *
 * When the license lapses (after the trial or the grace period), single
 * sign-on (SAML and OIDC), SCIM provisioning and audit logging stop - the
 * Community Edition's behaviour - and "Require SSO" stops being enforced at
 * the same moment, so nobody is locked out: users sign in with their
 * password. Everything resumes as soon as a license is activated. The trial
 * and grace notices must say so BEFORE it happens, and the lapsed notice must
 * say what is off.
 *
 * The dialog used to promise the opposite ("SSO, SCIM and audit logging never
 * stop"), so the checks reject that copy too. Plain functions over text, with
 * no jest dependency, so a test can prove each check fails on the wrong copy.
 */

// Before the lapse: the trial and grace notices, after "Without a valid license (...), ".
export const LAPSE_WARNING_PHRASES: ReadonlyArray<string> = [
  "single sign-on (SAML and OIDC) stops",
  '"Require SSO" is no longer enforced, so users sign in with their password',
  "SCIM provisioning stops",
  "audit logging stops recording",
  "enterprise configuration becomes read-only",
  "the enterprise admin dashboards are locked",
  "Everything resumes as soon as a license is activated",
  "core monitoring is never affected",
];

// After the lapse: the license-required notice (expired, missing, invalid).
export const LAPSED_STATE_PHRASES: ReadonlyArray<string> = [
  "Single sign-on (SAML and OIDC) and SCIM provisioning are off",
  '"Require SSO" is not enforced, so users sign in with their password',
  "SCIM requests are refused",
  "Audit logging is not recording",
  "Enterprise configuration is read-only",
  "Everything resumes, without a restart, as soon as a valid license is added",
  "core monitoring is never affected",
];

// The soft-enforcement promises the dialog made before. None may come back.
export const RETIRED_SOFT_ENFORCEMENT_COPY: ReadonlyArray<RegExp> = [
  /never stop/i,
  /already configured keeps working/i,
  /configured stops working/i,
  /keeps? working as configured/i,
  /never (?:silently )?weakens?/i,
];

// The copy the dialog shipped before the owner's decision, verbatim.
export const RETIRED_NOTICE_EXAMPLES: ReadonlyArray<string> = [
  "Without a valid license (after the 14-day grace period), enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything you already configured keeps working — SSO, SCIM and audit logging never stop — and core monitoring is never affected.",
  "Without a valid license (after the 14-day trial), enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything you already configured keeps working — SSO, SCIM and audit logging never stop — and core monitoring is never affected.",
  "The Enterprise license expired and its grace period is over. Enterprise configuration is read-only and the enterprise admin dashboards are locked until a valid license is added. Everything you already configured keeps working — SSO, SCIM and audit logging never stop — and core monitoring is never affected.",
];

type CopyCheck = (text: string | null | undefined) => Array<string>;

// Whitespace-normalized, so a check does not depend on how JSX wraps a line.
const normalize: (text: string | null | undefined) => string = (
  text: string | null | undefined,
): string => {
  return (text || "").replace(/\s+/g, " ").trim();
};

const copyProblems: (
  text: string | null | undefined,
  requiredPhrases: ReadonlyArray<string>,
) => Array<string> = (
  text: string | null | undefined,
  requiredPhrases: ReadonlyArray<string>,
): Array<string> => {
  const flat: string = normalize(text);
  const problems: Array<string> = [];

  for (const phrase of requiredPhrases) {
    if (!flat.includes(phrase)) {
      problems.push(`missing: ${phrase}`);
    }
  }

  for (const retired of RETIRED_SOFT_ENFORCEMENT_COPY) {
    if (retired.test(flat)) {
      problems.push(`retired: ${retired.source}`);
    }
  }

  return problems;
};

// What is wrong with a trial or grace notice (empty when it is right).
export const lapseWarningProblems: CopyCheck = (
  text: string | null | undefined,
): Array<string> => {
  return copyProblems(text, LAPSE_WARNING_PHRASES);
};

// What is wrong with the notice shown once the license has lapsed.
export const lapsedStateProblems: CopyCheck = (
  text: string | null | undefined,
): Array<string> => {
  return copyProblems(text, LAPSED_STATE_PHRASES);
};
