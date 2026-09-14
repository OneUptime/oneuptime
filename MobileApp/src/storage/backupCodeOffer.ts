import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY: string = "com.oneuptime.oncall.backup-code-offer-skipped-at";

/**
 * How long "Skip for now" means. A week: long enough that the prompt is not a
 * toll on every sign-in, short enough that an account with no way back in is
 * reminded again before the handset it depends on is lost.
 */
export const BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS: number =
  7 * 24 * 60 * 60 * 1000;

/*
 * Scoped to the user id. A shared handset is common in an on-call rotation,
 * and one engineer skipping the prompt must not silence it for the next person
 * who signs in on the same phone -- their account is a different account with
 * a different recovery posture.
 */
function keyFor(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

/**
 * Record that this account asked not to be prompted for a while.
 *
 * Best effort by design. This is a nudge, not a control: storage that refuses
 * to write means the user is asked again next time, which is the safe
 * direction to fail in and is not worth failing a completed sign-in over.
 */
export async function rememberBackupCodeOfferSkipped(data: {
  userId: string;
  now?: number;
}): Promise<void> {
  if (!data.userId) {
    return;
  }

  try {
    await AsyncStorage.setItem(
      keyFor(data.userId),
      String(data.now ?? Date.now()),
    );
  } catch {
    /* See above: being asked again is the acceptable failure. */
  }
}

/**
 * Whether this handset was recently told to stop asking this account.
 *
 * Anything unreadable -- absent, empty, not a number, a timestamp from the
 * future because the clock moved -- answers false. Every one of those means
 * "we do not know that the user asked us to stop", and the safe answer to that
 * is to ask.
 */
export async function wasBackupCodeOfferSkippedRecently(data: {
  userId: string;
  now?: number;
}): Promise<boolean> {
  if (!data.userId) {
    return false;
  }

  try {
    const stored: string | null = await AsyncStorage.getItem(
      keyFor(data.userId),
    );

    if (!stored) {
      return false;
    }

    const skippedAt: number = Number(stored);

    if (!Number.isFinite(skippedAt)) {
      return false;
    }

    const elapsed: number = (data.now ?? Date.now()) - skippedAt;

    /*
     * A negative elapsed time means the stored stamp is in the future, which
     * happens when the device clock is corrected backwards. Treated as "we do
     * not know", not as an indefinite snooze -- the alternative silences the
     * prompt until the clock catches up, which could be years.
     */
    if (elapsed < 0) {
      return false;
    }

    return elapsed < BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS;
  } catch {
    return false;
  }
}

/**
 * Forget the snooze for an account.
 *
 * Called once a set of codes has actually been saved: the reason not to ask is
 * now that there is nothing to ask about, and leaving the timestamp behind
 * would silence a prompt this account may legitimately need again after a
 * later reset.
 */
export async function clearBackupCodeOfferSkip(data: {
  userId: string;
}): Promise<void> {
  if (!data.userId) {
    return;
  }

  try {
    await AsyncStorage.removeItem(keyFor(data.userId));
  } catch {
    /* Nothing to do; the stale stamp expires on its own. */
  }
}
