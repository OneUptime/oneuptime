/*
 * The page on attack.mitre.org for a tactic or technique id: TA0006,
 * T1110, or a sub-technique T1110.003 (whose page is /T1110/003/). Null for
 * anything that is not an ATT&CK id, so stored text never becomes a link.
 */
const TACTIC_ID: RegExp = /^TA\d{4}$/;
const TECHNIQUE_ID: RegExp = /^(T\d{4})(?:\.(\d{3}))?$/;

export function getMitreAttackUrl(id: string): string | null {
  const upper: string = (id || "").trim().toUpperCase();

  if (TACTIC_ID.test(upper)) {
    return `https://attack.mitre.org/tactics/${upper}/`;
  }

  const technique: RegExpMatchArray | null = upper.match(TECHNIQUE_ID);

  if (!technique) {
    return null;
  }

  return technique[2]
    ? `https://attack.mitre.org/techniques/${technique[1]}/${technique[2]}/`
    : `https://attack.mitre.org/techniques/${technique[1]}/`;
}
