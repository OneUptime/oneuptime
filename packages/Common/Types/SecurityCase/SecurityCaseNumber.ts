/*
 * Security cases are numbered per project, CASE-1, CASE-2, ..., the same in
 * every project: the number is what analysts say out loud and paste into
 * tickets, and one fixed form keeps a case recognisable wherever it is
 * pasted.
 */
export const SECURITY_CASE_NUMBER_PREFIX: string = "CASE-";

export function formatSecurityCaseNumber(caseNumber: number): string {
  return `${SECURITY_CASE_NUMBER_PREFIX}${caseNumber}`;
}
