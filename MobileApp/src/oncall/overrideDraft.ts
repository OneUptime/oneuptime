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

export interface OverrideDraft {
  direction: OverrideDirection;
  projectId: string | null;

  /* The other person - whoever the signed-in user is not. */
  counterpartUserId: string | null;

  durationHours: number;
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

  if (!Number.isFinite(draft.durationHours) || draft.durationHours <= 0) {
    return { ok: false, reason: "Choose how long the override should last." };
  }

  const startsAt: Date = new Date(now);
  const endsAt: Date = new Date(now + draft.durationHours * 60 * 60 * 1000);

  const overrideUserId: string =
    draft.direction === "cover-me" ? currentUserId : draft.counterpartUserId;

  const routeAlertsToUserId: string =
    draft.direction === "cover-me" ? draft.counterpartUserId : currentUserId;

  return {
    ok: true,
    input: {
      projectId: draft.projectId,
      overrideUserId,
      routeAlertsToUserId,
      startsAt,
      endsAt,
    },
  };
}

/**
 * The one-line preview shown above the submit button, so the responder reads
 * back what they are about to do before they do it.
 */
export function describeOverride(
  direction: OverrideDirection,
  counterpartName: string,
  durationHours: number,
): string {
  const durationLabel: string =
    durationHours === 1 ? "1 hour" : `${durationHours} hours`;

  if (direction === "cover-me") {
    return `Your on-call pages go to ${counterpartName} for the next ${durationLabel}.`;
  }

  return `${counterpartName}'s on-call pages come to you for the next ${durationLabel}.`;
}
