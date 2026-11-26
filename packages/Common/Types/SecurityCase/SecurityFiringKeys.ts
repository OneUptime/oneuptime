/*
 * A FIRING, TAKEN ONCE (#10489).
 *
 * A scheduled detection rule records where its run got to only once it has
 * done what its matches ask, so a worker that stops in between leaves the
 * rule where it was, and the next run judges the same stretch of events
 * again - exactly that stretch (DetectionRule.evaluatingUntil). It fires
 * the same groups again, each under the same name: the stretch it judges,
 * the window (for a rule that counts) and the group (getDetectionFiringKey
 * in DetectionRuleEvaluator). What a firing does is done once for each
 * name:
 *
 *  - its Detection Finding is written under that name, and not again;
 *  - the case detection it repeats keeps the names of the firings it took
 *    (SecurityDetection.recentFiringKeys), and takes one it has once;
 *  - the risk it adds to an entity keeps them beside its source
 *    (SecurityEntityRiskContribution.firingKeys), and counts one once.
 *
 * A name is kept for as long as the latest SECURITY_FIRING_KEYS_KEPT of
 * them: a stretch fires a group at most once a window, and reads at most a
 * dozen windows, so the stretch a run judges again is always among them.
 * A source that never judges the same events twice names no firing, and
 * everything it hands is taken.
 */

// The most firing names one detection, or one source of an entity's risk, keeps.
export const SECURITY_FIRING_KEYS_KEPT: number = 32;

// The longest name kept: a rule's firing names are some sixty characters.
export const SECURITY_FIRING_KEY_MAX_LENGTH: number = 200;

// The names a stored value keeps: text, each once, the latest last.
export function readFiringKeys(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys: Array<string> = [];

  for (const item of value) {
    if (
      typeof item === "string" &&
      item.length > 0 &&
      item.length <= SECURITY_FIRING_KEY_MAX_LENGTH &&
      !keys.includes(item)
    ) {
      keys.push(item);
    }
  }

  return keys.slice(-SECURITY_FIRING_KEYS_KEPT);
}

// Whether this firing was taken already. A firing with no name never was.
export function hasTakenFiring(
  kept: unknown,
  firingKey: string | undefined | null,
): boolean {
  if (!firingKey) {
    return false;
  }

  return readFiringKeys(kept).includes(firingKey);
}

// The names kept once this firing is taken: it last, the oldest dropped past the limit.
export function takeFiring(
  kept: unknown,
  firingKey: string | undefined | null,
): Array<string> {
  const keys: Array<string> = readFiringKeys(kept).filter(
    (key: string): boolean => {
      return key !== firingKey;
    },
  );

  if (firingKey && firingKey.length <= SECURITY_FIRING_KEY_MAX_LENGTH) {
    keys.push(firingKey);
  }

  return keys.slice(-SECURITY_FIRING_KEYS_KEPT);
}
