import { SessionReplayUserKind } from "Common/Types/Rum/SessionReplayApi";
import { SessionReplayAdvancedFilters } from "./SessionReplayListFilters";

/*
 * Who a session (or a rollup row) belongs to, as the list should say it.
 *
 * A row can carry three identity facts of very different strength: the
 * label the customer's page passed to identify() (a real person, shown
 * only to roles with the identity permission), the pseudonymous digest the
 * server stored it under (identifiedUserKey - present for everyone, names
 * nobody), and the recorder's per-browser visitor id (random, present from
 * recorders that mint one). Every cell and avatar that reads them has to
 * rank them the same way, or one column would call a person "Anonymous"
 * while another groups them by visitor - which is exactly the confusion
 * the customer in issue #3705 hit. So the ranking lives here, without
 * React, where a node test can pin every branch.
 *
 * The four answers, in precedence:
 *
 *   identified  a label the viewer may read. The person.
 *   hidden      the row carries an identity the viewer's role may not
 *               read. Not "Anonymous": the page DID identify someone.
 *   visitor     no identity, but a visitor id: the same browser can be
 *               followed across sessions without identify().
 *   anonymous   nothing at all - an older recorder, or an opted-out one.
 */
export type SessionUserKind = "identified" | "hidden" | "visitor" | "anonymous";

export interface SessionUserDescription {
  kind: SessionUserKind;
  /* What the cell shows: the label, "Hidden", "Visitor 7f3a2b", "Anonymous". */
  text: string;
  /* One or two sentences for the cell's hover/tooltip. */
  title: string;
  /* One or two characters for the avatar. */
  initials: string;
  /*
   * A stable 0-359 hue for the avatar, so one person keeps one colour
   * across rows, pages and the player; null when there is nothing stable
   * to derive it from (anonymous), which the avatar draws as a dashed grey.
   */
  hue: number | null;
  /*
   * The list filter that selects "every session from this person", or null
   * when no fact on the row can. The digest for a hidden identity, the
   * reference for a visible one (the server hashes it; the digest is
   * ignored beside a reference), the visitor id for a visitor.
   */
  filter: Partial<SessionReplayAdvancedFilters> | null;
}

export const HIDDEN_IDENTITY_TITLE: string =
  "Your role cannot read end-user identity, so the label is not sent to you.";

export const VISITOR_TITLE: string =
  "Anonymous visitor. The recorder links this browser's sessions with a random id so you can follow one person without identify().";

export const ANONYMOUS_TITLE: string =
  "The page did not call OneUptimeReplay.identify(), and this recorder did not send a visitor id.";

/* How much of a visitor id the UI shows: enough to tell two apart at a glance. */
export const SHORT_VISITOR_ID_LENGTH: number = 6;

/*
 * The first six hex characters of a visitor id. Six is what the session id
 * chip beside it already shows; two visitors colliding on six hex digits in
 * one application's range is rare enough that the full id (on the title
 * and in the filter) settles it.
 */
export function shortVisitorId(visitorId: string): string {
  return visitorId.trim().slice(0, SHORT_VISITOR_ID_LENGTH);
}

/*
 * A deterministic hue in [0, 360) from any string, so the avatar colour
 * for one person is the same on every page load and every screen without
 * anyone storing it. FNV-1a, 32-bit: cheap, spreads short similar keys
 * (u:0001 vs u:0002) far apart, and needs no crypto. Not a security
 * primitive - a colour, nothing more.
 */
export function stableHue(key: string): number {
  let hash: number = 0x811c9dc5;

  for (let index: number = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    /* Multiply by the FNV prime (16777619) modulo 2^32. */
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % 360;
}

/*
 * Two letters for a label: the first letter of the first two words for
 * "Jane Doe" -> "JD", the first two characters otherwise ("jane@acme.com"
 * -> "JA"). An email is read by its local part - "jane.doe@acme.com" is
 * "JD", never "JA" from the domain. Uppercased so the avatar reads as a
 * monogram, not as text.
 */
export function initialsOf(label: string): string {
  const localPart: string = label.trim().split("@")[0] ?? "";
  const words: Array<string> = localPart
    .split(/[\s._-]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words.length >= 2) {
    return `${(words[0] as string).charAt(0)}${(words[1] as string).charAt(0)}`.toUpperCase();
  }

  const single: string = words[0] ?? "";

  return single.slice(0, 2).toUpperCase() || "?";
}

export interface DescribeSessionUserInput {
  identifiedUserLabel: string;
  /*
   * Whether the identity column was in the payload at all - the list's
   * isIdentityVisible. False means the server withheld it for this role.
   */
  isIdentityVisible: boolean;
  identifiedUserKey: string;
  visitorId: string;
}

export function describeSessionUser(
  input: DescribeSessionUserInput,
): SessionUserDescription {
  const label: string = input.identifiedUserLabel.trim();
  const key: string = input.identifiedUserKey.trim();
  const visitorId: string = input.visitorId.trim();

  /*
   * A visible label wins over everything: it is the person. The hue keys
   * on the digest when there is one so the same person keeps one colour
   * even where a role sees them as "Hidden".
   */
  if (input.isIdentityVisible && label) {
    return {
      kind: "identified",
      text: label,
      title: `Identified by your page as ${label}. Click to see every session from this user.`,
      initials: initialsOf(label),
      hue: stableHue(key || label),
      filter: { identifiedUserRef: label },
    };
  }

  /*
   * No column at all: the server withheld it, and the row may well be an
   * identified person. Filtering by the digest still works for this role
   * (the digest is not gated), so the cell stays clickable when it has one.
   */
  if (!input.isIdentityVisible) {
    return {
      kind: "hidden",
      text: "Hidden",
      title: HIDDEN_IDENTITY_TITLE,
      initials: "?",
      hue: key ? stableHue(key) : null,
      filter: key ? { identifiedUserKey: key } : null,
    };
  }

  if (visitorId) {
    return {
      kind: "visitor",
      text: `Visitor ${shortVisitorId(visitorId)}`,
      title: VISITOR_TITLE,
      initials: "V",
      hue: stableHue(visitorId),
      filter: { visitorId: visitorId },
    };
  }

  return {
    kind: "anonymous",
    text: "Anonymous",
    title: ANONYMOUS_TITLE,
    initials: "?",
    hue: null,
    filter: null,
  };
}

export interface DescribeUserRollupInput {
  kind: SessionReplayUserKind;
  identifiedUserKey: string;
  visitorId: string;
  /* undefined when the caller's role may not read it. */
  identifiedUserLabel?: string | undefined;
  isIdentityVisible: boolean;
}

/*
 * The same ranking for a /users row, where the server has already said
 * which kind of group this is. The one twist: an identified group whose
 * label the viewer may not read is "hidden", not "anonymous" - the group
 * exists precisely because somebody was identified.
 */
export function describeUserRollup(
  input: DescribeUserRollupInput,
): SessionUserDescription {
  const key: string = input.identifiedUserKey.trim();
  const visitorId: string = input.visitorId.trim();
  const label: string = (input.identifiedUserLabel ?? "").trim();

  if (input.kind === "identified") {
    if (input.isIdentityVisible && label) {
      return {
        kind: "identified",
        text: label,
        title: `Identified by your page as ${label}. Click to see every session from this user.`,
        initials: initialsOf(label),
        hue: stableHue(key || label),
        filter: { identifiedUserRef: label },
      };
    }

    return {
      kind: "hidden",
      text: "Hidden",
      title: HIDDEN_IDENTITY_TITLE,
      initials: "?",
      hue: key ? stableHue(key) : null,
      filter: key ? { identifiedUserKey: key } : null,
    };
  }

  if (input.kind === "visitor" && visitorId) {
    return {
      kind: "visitor",
      text: `Visitor ${shortVisitorId(visitorId)}`,
      title: VISITOR_TITLE,
      initials: "V",
      hue: stableHue(visitorId),
      filter: { visitorId: visitorId },
    };
  }

  return {
    kind: "anonymous",
    text: "Anonymous",
    title: ANONYMOUS_TITLE,
    initials: "?",
    hue: null,
    filter: null,
  };
}
