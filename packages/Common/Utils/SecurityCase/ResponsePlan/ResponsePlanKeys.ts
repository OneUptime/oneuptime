/*
 * The keys of a case's Response Plan's steps: what a step is, and what it is
 * about - "contain:block-ip:35.205.11.131". A task that ticks a step off
 * keeps its key (SecurityCaseTask.responseStepKey), and so does OneUptime's
 * check of it (SecurityCaseStepCheck.stepKey), so the plan knows the step
 * again in any language, on the server and in the browser.
 */

// The longest a step's key is (SecurityCaseTask.responseStepKey).
export const RESPONSE_STEP_KEY_MAX_LENGTH: number = 100;

// What a step is: the part of its key before what it is about.
export const RESPONSE_STEP_KINDS: {
  take: string;
  requests: string;
  falsePositive: string;
  blockIp: string;
  findIp: string;
  user: string;
  host: string;
  blockDomain: string;
  quarantineFile: string;
  blockIpEverywhere: string;
  hiddenAddress: string;
  claimedAddress: string;
  incident: string;
  markContained: string;
  playbook: string;
  ai: string;
  close: string;
  fixPublicApp: string;
  fixCredentials: string;
  fixBruteForce: string;
  fixAccountChanges: string;
} = {
  take: "confirm:take",
  requests: "confirm:requests",
  falsePositive: "confirm:false-positive",
  blockIp: "contain:block-ip",
  findIp: "contain:find-ip",
  user: "contain:user",
  host: "contain:host",
  blockDomain: "contain:block-domain",
  quarantineFile: "contain:quarantine-file",
  // A command-and-control address, on every machine (#10346): beside the edge's block-ip.
  blockIpEverywhere: "contain:block-ip-everywhere",
  hiddenAddress: "contain:hidden-address",
  claimedAddress: "contain:claimed-address",
  incident: "contain:incident",
  markContained: "contain:mark-contained",
  playbook: "playbook",
  ai: "ai",
  close: "close",
  // The Fix steps OneUptime checks itself (#10347): the route, the password, MFA, the account's changes.
  fixPublicApp: "fix:public-app",
  fixCredentials: "fix:credentials",
  fixBruteForce: "fix:brute-force",
  fixAccountChanges: "fix:account-changes",
};

// A short, stable hash of a text: FNV-1a, 32 bits, as hex.
export function hashText(text: string): string {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, "0");
}

/*
 * A step's key: what it is, and what it is about, case folded - hashed when
 * the two would run past what a task keeps.
 */
export function getResponseStepKey(kind: string, value?: string): string {
  const about: string = (value || "").trim().toLowerCase();

  if (!about) {
    return kind;
  }

  const key: string = `${kind}:${about}`;

  return key.length <= RESPONSE_STEP_KEY_MAX_LENGTH
    ? key
    : `${kind}:#${hashText(about)}`;
}

/*
 * Whether a step's key is of this kind: the kind itself, or the kind and
 * what it is about. "contain:block-ip:1.2.3.4" is of "contain:block-ip",
 * never of "contain:block".
 */
export function isResponseStepOfKind(stepKey: string, kind: string): boolean {
  return stepKey === kind || stepKey.startsWith(`${kind}:`);
}
