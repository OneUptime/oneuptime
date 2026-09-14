import type { CreateOverrideInput } from "../hooks/useOnCallOverrides";

/*
 * Turning "cover for me for four hours" into the request the server wants.
 *
 * The two directions are the same record with the user ids swapped, and that
 * swap is the entire risk in this feature: getting it backwards routes the
 * WRONG person's pages away, and nobody finds out until an alert goes
 * unanswered. So the swap happens exactly once, here, where it can be tested,
 * rather than inline in a submit handler.
 */

export type OverrideDirection = "cover-me" | "take-over";

/**
 * An explicit window instead of "from now for N hours" - what "Get cover"
 * on a shift card asks for. The whole shift is covered; a shift already in
 * progress is covered from now, because an override cannot start in the past.
 */
export interface OverrideWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface OverrideDraft {
  direction: OverrideDirection;
  projectId: string | null;

  /* The other person - whoever the signed-in user is not. */
  counterpartUserId: string | null;

  durationHours: number;

  /* When set, wins over `durationHours`. */
  window?: OverrideWindow | null;

  /*
   * Scope the override to one escalation policy. Only ever set for a
   * policy-variant shift, which exists inside that policy alone; a plain
   * "cover for me" stays project-wide on purpose.
   */
  onCallDutyPolicyId?: string | null;
}

export type BuildOverrideResult =
  | { ok: true; input: CreateOverrideInput }
  | { ok: false; reason: string };

export const DURATION_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "1 hour", hours: 1 },
  { label: "2 hours", hours: 2 },
  { label: "4 hours", hours: 4 },
  { label: "8 hours", hours: 8 },
  { label: "12 hours", hours: 12 },
  { label: "24 hours", hours: 24 },
];

function resolveWindow(
  draft: OverrideDraft,
  now: number,
): { ok: true; startsAt: Date; endsAt: Date } | { ok: false; reason: string } {
  if (draft.window) {
    const start: number = draft.window.startsAt.getTime();
    const end: number = draft.window.endsAt.getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return {
        ok: false,
        reason: "That shift's times could not be read. Try again from the web.",
      };
    }

    if (end <= now) {
      return { ok: false, reason: "That shift has already ended." };
    }

    if (end <= start) {
      return { ok: false, reason: "That shift ends before it starts." };
    }

    return {
      ok: true,
      startsAt: new Date(Math.max(start, now)),
      endsAt: new Date(end),
    };
  }

  if (!Number.isFinite(draft.durationHours) || draft.durationHours <= 0) {
    return { ok: false, reason: "Choose how long the override should last." };
  }

  return {
    ok: true,
    startsAt: new Date(now),
    endsAt: new Date(now + draft.durationHours * 60 * 60 * 1000),
  };
}

export function buildOverrideRequest(
  draft: OverrideDraft,
  currentUserId: string | null,
  now: number,
): BuildOverrideResult {
  if (!currentUserId) {
    return {
      ok: false,
      reason:
        "We could not identify your account on this device. Sign out and sign in again.",
    };
  }

  if (!draft.projectId) {
    return {
      ok: false,
      reason: "Choose the project this override applies to.",
    };
  }

  if (!draft.counterpartUserId) {
    return { ok: false, reason: "Choose a teammate." };
  }

  if (draft.counterpartUserId === currentUserId) {
    /*
     * The server rejects this too, but only after a round trip. Catching it
     * here means the user finds out while their thumb is still on the picker.
     */
    return {
      ok: false,
      reason: "Pick somebody other than yourself to route pages to.",
    };
  }

  const window:
    | { ok: true; startsAt: Date; endsAt: Date }
    | { ok: false; reason: string } = resolveWindow(draft, now);

  if (!window.ok) {
    return { ok: false, reason: window.reason };
  }

  const overrideUserId: string =
    draft.direction === "cover-me" ? currentUserId : draft.counterpartUserId;

  const routeAlertsToUserId: string =
    draft.direction === "cover-me" ? draft.counterpartUserId : currentUserId;

  const input: CreateOverrideInput = {
    projectId: draft.projectId,
    overrideUserId,
    routeAlertsToUserId,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
  };

  if (draft.onCallDutyPolicyId) {
    input.onCallDutyPolicyId = draft.onCallDutyPolicyId;
  }

  return { ok: true, input };
}

/**
 * The one-line preview shown above the submit button, so the responder reads
 * back what they are about to do before they do it.
 *
 * With a `windowLabel` (a prefilled shift) the sentence names the window
 * instead of a duration: "for the next 4 hours" would be a lie about a shift
 * that starts on Thursday.
 */
export function describeOverride(
  direction: OverrideDirection,
  counterpartName: string,
  durationHours: number,
  windowLabel?: string | null,
): string {
  if (windowLabel) {
    if (direction === "cover-me") {
      return `Your on-call pages go to ${counterpartName} ${windowLabel}.`;
    }

    return `${counterpartName}'s on-call pages come to you ${windowLabel}.`;
  }

  const durationLabel: string =
    durationHours === 1 ? "1 hour" : `${durationHours} hours`;

  if (direction === "cover-me") {
    return `Your on-call pages go to ${counterpartName} for the next ${durationLabel}.`;
  }

  return `${counterpartName}'s on-call pages come to you for the next ${durationLabel}.`;
}
