/*
 * The prefix security cases are numbered with until a project chooses its
 * own (Security Events > Settings > Numbering): CASE-1, CASE-2, ... per
 * project. Every project starts with it - the Project column's default
 * (securityCaseNumberPrefix), projects from before the column included - so
 * a case keeps the number analysts say out loud and paste into tickets
 * until someone decides otherwise. A case keeps the number it was given,
 * with its prefix, whatever the prefix becomes later.
 */
export const SECURITY_CASE_NUMBER_PREFIX: string = "CASE-";

// A case number with the default prefix: "CASE-42".
export function formatSecurityCaseNumber(caseNumber: number): string {
  return `${SECURITY_CASE_NUMBER_PREFIX}${caseNumber}`;
}
