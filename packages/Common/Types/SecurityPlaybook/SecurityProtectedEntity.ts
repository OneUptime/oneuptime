import { SecurityEntityType } from "../SecurityCase/SecurityEntity";

/*
 * The users and hosts a project's containment never touches: break-glass
 * accounts, domain controllers, the VPN gateway every attack against the
 * network names. A protected entry is a value or a pattern of one, matched
 * whatever the case: `*` stands for any run of characters, so `svc-*`
 * protects every service account and `*.corp.example.com` every host of a
 * domain. A containment step reports a protected target as protected, and
 * neither it nor an approver can act on it.
 */

/*
 * The kinds of entity containment acts on, and so the ones a project
 * protects. A data store is neither: the steps that close a store's
 * exposure (Block public access to data stores, Revoke data store sharing)
 * change how it is shared, never cut anyone off, and a store meant to be
 * public is protected where it is described - marked public by design in
 * its Settings, which those steps leave alone.
 */
export const PROTECTED_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.User,
  SecurityEntityType.Host,
];

export const PROTECTED_ENTITY_VALUE_MAX_LENGTH: number = 500;

export const PROTECTED_ENTITY_WILDCARD: string = "*";

export interface ProtectedEntityRule {
  type: SecurityEntityType;
  // The value or pattern, as the project wrote it.
  value: string;
}

export function isProtectedEntityType(
  value: unknown,
): value is SecurityEntityType {
  return (
    typeof value === "string" &&
    (PROTECTED_ENTITY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

// A protected value as stored: trimmed, with no run of wildcards.
export function normalizeProtectedEntityValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let text: string = value.trim();

  while (text.includes("**")) {
    text = text.split("**").join("*");
  }

  return text;
}

/*
 * Whether a value matches a protected pattern, whatever the case. Matched
 * piece by piece rather than with a regular expression: the pieces are
 * found in order, the first at the start and the last at the end.
 */
export function matchesProtectedEntityPattern(
  pattern: string,
  value: string,
): boolean {
  const wanted: string = normalizeProtectedEntityValue(pattern).toLowerCase();
  const text: string = (value || "").trim().toLowerCase();

  if (!wanted || !text) {
    return false;
  }

  if (!wanted.includes(PROTECTED_ENTITY_WILDCARD)) {
    return wanted === text;
  }

  const pieces: Array<string> = wanted.split(PROTECTED_ENTITY_WILDCARD);
  const first: string = pieces[0] || "";
  const last: string = pieces[pieces.length - 1] || "";

  if (!text.startsWith(first)) {
    return false;
  }

  let position: number = first.length;

  for (let index: number = 1; index < pieces.length - 1; index++) {
    const piece: string = pieces[index] || "";

    if (!piece) {
      continue;
    }

    const found: number = text.indexOf(piece, position);

    if (found < 0) {
      return false;
    }

    position = found + piece.length;
  }

  return text.length - last.length >= position && text.endsWith(last);
}

// The entry that protects this entity, if any.
export function findProtectingRule(data: {
  type: SecurityEntityType;
  value: string;
  rules: ReadonlyArray<ProtectedEntityRule>;
}): ProtectedEntityRule | undefined {
  return data.rules.find((rule: ProtectedEntityRule): boolean => {
    return (
      rule.type === data.type &&
      matchesProtectedEntityPattern(rule.value, data.value)
    );
  });
}
