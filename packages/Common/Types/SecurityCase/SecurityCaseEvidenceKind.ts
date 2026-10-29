/*
 * What a piece of evidence on a security case is (SecurityCaseEvidence):
 *
 *   - File: a file uploaded to OneUptime - a log excerpt, a screenshot, a
 *     packet capture, an exported mailbox - kept with its size, its type and
 *     the SHA-256 of its bytes as they were uploaded, so anyone can check
 *     that what they download is what was kept.
 *   - Link: an address of evidence kept somewhere else - an EDR console's
 *     page, a ticket, an object in the team's own evidence store.
 */
enum SecurityCaseEvidenceKind {
  File = "File",
  Link = "Link",
}

export const SECURITY_CASE_EVIDENCE_KINDS: ReadonlyArray<SecurityCaseEvidenceKind> =
  [SecurityCaseEvidenceKind.File, SecurityCaseEvidenceKind.Link];

export function isSecurityCaseEvidenceKind(
  value: unknown,
): value is SecurityCaseEvidenceKind {
  return SECURITY_CASE_EVIDENCE_KINDS.includes(
    value as SecurityCaseEvidenceKind,
  );
}

export default SecurityCaseEvidenceKind;
