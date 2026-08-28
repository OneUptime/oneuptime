import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS,
  clearBackupCodeOfferSkip,
  rememberBackupCodeOfferSkipped,
  wasBackupCodeOfferSkippedRecently,
} from "./backupCodeOffer";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The "you have no way back into this account" nudge, and the record of the
 * user having waved it away.
 *
 * This is the only piece of the two factor flow that is allowed to STAY quiet,
 * so it is the only piece that can silence a security prompt by accident. Two
 * ways that goes wrong, and both of them are what the tests below are for:
 *
 *   - it stays quiet for too long, or forever. An account with no backup codes
 *     and a lost handset is an account only an administrator can rescue, and
 *     this prompt is the last thing standing between the user and that. A
 *     window that leaks past its end - or a stored timestamp from a device
 *     whose clock moved - turns a week's snooze into an indefinite one.
 *
 *   - it stays quiet for the WRONG PERSON. A shared on-call handset is normal;
 *     one responder skipping the prompt must not answer for the next responder
 *     who signs in on the same phone, whose account has its own recovery
 *     posture and who never dismissed anything.
 *
 * The other half is that none of this may ever throw. It runs AFTER the second
 * factor has already been accepted - the user is signed in and, on this app,
 * quite possibly holding a page about a live incident. A rejected disk write
 * failing that sign-in would be a far worse outcome than an extra prompt, so
 * every failure has to land on "ask again", never on an exception.
 *
 * The storage key is re-stated here rather than imported: the module does not
 * export it, and the per-user suffix is the security-relevant half. A rename
 * that dropped the suffix would still round-trip perfectly for one user and
 * silently share one snooze across every account on the device.
 */
const STORAGE_KEY_PREFIX: string =
  "com.oneuptime.oncall.backup-code-offer-skipped-at";

function keyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function getItemMock(): jest.Mock {
  return AsyncStorage.getItem as unknown as jest.Mock;
}

function setItemMock(): jest.Mock {
  return AsyncStorage.setItem as unknown as jest.Mock;
}

function removeItemMock(): jest.Mock {
  return AsyncStorage.removeItem as unknown as jest.Mock;
}

/*
 * Two accounts on one handset - the shared-phone case - and a fixed clock, so
 * that every window assertion is written relative to a number in the test
 * rather than to whenever the suite happens to run.
 */
const USER_A: string = "65f1a2b3c4d5e6f708192a3b";
const USER_B: string = "65f1a2b3c4d5e6f708192a3c";
const NOW: number = 1800000000000;
const ONE_DAY: number = 24 * 60 * 60 * 1000;

/*
 * The AsyncStorage mock in src/__tests__/setup.ts is a module-level Map that
 * outlives an individual test, so a snooze written by one test would otherwise
 * be inherited by the next.
 */
beforeEach(async (): Promise<void> => {
  await AsyncStorage.clear();
  getItemMock().mockClear();
  setItemMock().mockClear();
  removeItemMock().mockClear();
});

describe("the snooze window", () => {
  test("a skip just recorded silences the prompt", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(true);
  });

  test("still silent a day into the week", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + ONE_DAY,
      }),
    ).toBe(true);
  });

  test("still silent one millisecond before the window closes", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS - 1,
      }),
    ).toBe(true);
  });

  test("the boundary itself is NOT snoozed - the window is half-open", async () => {
    /*
     * Pinned deliberately, on this exact side. Elapsed time equal to the window
     * means the week is spent, so the prompt comes back. Nothing about the
     * product breaks if a refactor flips `<` to `<=`, which is exactly why it
     * would go unnoticed: the difference is one millisecond here and a whole
     * extra week the next time somebody widens the constant.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS,
      }),
    ).toBe(false);
  });

  test("one millisecond past the window prompts again", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS + 1,
      }),
    ).toBe(false);
  });

  test("long after the window the prompt is back for good", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + 400 * ONE_DAY,
      }),
    ).toBe(false);
  });

  test("the window is a week", async () => {
    /*
     * The screen tells the user they will be asked again later; a week is what
     * "later" was chosen to mean. Worth pinning because it is the one number
     * here that a reader would otherwise have to take on trust.
     */
    expect(BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS).toBe(7 * ONE_DAY);
  });

  test("works off the real clock when no timestamp is injected", async () => {
    /*
     * Every other test in this block hands both calls a `now`. This one takes
     * the path production actually takes, so that a broken `?? Date.now()`
     * fallback - a snooze written as "undefined", a comparison against NaN -
     * cannot hide behind the injected clock.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A });

    expect(await wasBackupCodeOfferSkippedRecently({ userId: USER_A })).toBe(
      true,
    );
  });
});

describe("the snooze is scoped to one account", () => {
  test("one responder's skip leaves the next responder prompted", async () => {
    /*
     * The shared-handset case, and the one that actually hides a security
     * prompt from somebody who never dismissed it.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_B, now: NOW }),
    ).toBe(false);
    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(true);
  });

  test("each account carries its own expiry, not a shared one", async () => {
    /*
     * Same assertion from the other direction: if the two accounts shared a
     * slot, B's later skip would revive A's expired snooze.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });
    await rememberBackupCodeOfferSkipped({
      userId: USER_B,
      now: NOW + 6 * ONE_DAY,
    });

    const readAt: number = NOW + BACKUP_CODE_OFFER_SNOOZE_MILLISECONDS + 1;

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: readAt }),
    ).toBe(false);
    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_B, now: readAt }),
    ).toBe(true);
  });

  test("the stored key carries the user id and no shared key is written", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    expect(await AsyncStorage.getItem(keyFor(USER_A))).toBe(String(NOW));
    expect(await AsyncStorage.getItem(STORAGE_KEY_PREFIX)).toBeNull();
    expect(await AsyncStorage.getItem(keyFor(USER_B))).toBeNull();
  });
});

describe("an unknown account is never snoozed", () => {
  /*
   * TwoFactorScreen calls this with `response.user?._id || ""`, so an empty id
   * is not hypothetical - it is what a login response missing the user object
   * produces. The dangerous reading of "" is a single device-wide key: the
   * first person to skip would silence the prompt for everybody who ever signs
   * in on that phone.
   */
  test("an empty user id writes nothing at all", async () => {
    await rememberBackupCodeOfferSkipped({ userId: "", now: NOW });

    expect(setItemMock()).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(keyFor(""))).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY_PREFIX)).toBeNull();
  });

  test("an empty user id reads as not skipped, without touching storage", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });
    getItemMock().mockClear();

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: "", now: NOW }),
    ).toBe(false);
    expect(getItemMock()).not.toHaveBeenCalled();
  });

  test("an empty user id clears nothing", async () => {
    /*
     * The mirror hazard: a device-wide delete would wipe the snooze of every
     * other account on the handset.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    await clearBackupCodeOfferSkip({ userId: "" });

    expect(removeItemMock()).not.toHaveBeenCalled();
    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(true);
  });
});

describe("a value we cannot read means ask", () => {
  test("an account that never skipped is prompted", async () => {
    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
  });

  /*
   * Each of these is "we do not know that the user asked us to stop", and the
   * only safe answer to that is to ask. The failure they guard against is
   * Number() being generous: "" and "  " both coerce to 0, and 0 read as a
   * timestamp is 1970 - which happens to fall outside the window, so the bug
   * would be invisible until somebody rewrote the comparison.
   */
  test.each([
    ["a half-written empty value", ""],
    ["a blank string", "   "],
    ["free text", "last tuesday"],
    ["a literal NaN", "NaN"],
    ["a literal undefined", "undefined"],
    ["an infinite stamp", "Infinity"],
    ["an ISO date a later build might have written", "2026-08-28T10:00:00Z"],
  ])(
    "%s does not count as a skip",
    async (_label: string, stored: string): Promise<void> => {
      await AsyncStorage.setItem(keyFor(USER_A), stored);

      expect(
        await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
      ).toBe(false);
    },
  );

  test("a stamp from the future prompts rather than snoozing indefinitely", async () => {
    /*
     * What a device clock corrected backwards leaves behind. Treating a future
     * stamp as "recent" would silence the prompt until the clock caught up,
     * which for a handset that was set years ahead is effectively forever.
     */
    await AsyncStorage.setItem(keyFor(USER_A), String(NOW + 400 * ONE_DAY));

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
  });

  test("a stamp one millisecond ahead is already treated as future", async () => {
    await AsyncStorage.setItem(keyFor(USER_A), String(NOW + 1));

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
  });

  test("a stamp written this very millisecond is a skip, not a future stamp", async () => {
    /*
     * The other side of that guard: zero elapsed time is the normal case - the
     * user taps "skip" and the next read happens in the same tick - so the
     * future check has to be strictly negative, not "not positive".
     */
    await AsyncStorage.setItem(keyFor(USER_A), String(NOW));

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(true);
  });
});

describe("clearBackupCodeOfferSkip", () => {
  test("a cleared account is prompted again", async () => {
    /*
     * Called once codes have actually been saved. Leaving the stamp behind
     * would silence a prompt this account legitimately needs again after a
     * later reset wipes those codes.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    await clearBackupCodeOfferSkip({ userId: USER_A });

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
  });

  test("removes the key rather than blanking it", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });

    await clearBackupCodeOfferSkip({ userId: USER_A });

    expect(await AsyncStorage.getItem(keyFor(USER_A))).toBeNull();
  });

  test("clears only the named account", async () => {
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });
    await rememberBackupCodeOfferSkipped({ userId: USER_B, now: NOW });

    await clearBackupCodeOfferSkip({ userId: USER_A });

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_B, now: NOW }),
    ).toBe(true);
  });

  test("is safe on an account that never skipped", async () => {
    await expect(
      clearBackupCodeOfferSkip({ userId: USER_A }),
    ).resolves.toBeUndefined();
  });

  test("a later skip snoozes again from the new moment", async () => {
    /*
     * The full cycle: skip, save codes, a reset removes them, skip again. The
     * second window must start at the second skip and not inherit the first.
     */
    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });
    await clearBackupCodeOfferSkip({ userId: USER_A });
    await rememberBackupCodeOfferSkipped({
      userId: USER_A,
      now: NOW + 30 * ONE_DAY,
    });

    expect(
      await wasBackupCodeOfferSkippedRecently({
        userId: USER_A,
        now: NOW + 33 * ONE_DAY,
      }),
    ).toBe(true);
  });
});

describe("storage that fails never fails the sign-in", () => {
  /*
   * All three of these run after the second factor has been accepted. The user
   * is signed in; this is bookkeeping for a nudge. A rejected promise escaping
   * any of them surfaces as a crash or an unhandled rejection on top of a
   * successful login - on an app somebody opened because they were paged.
   */
  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("a write that is refused does not throw", async () => {
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValue(new Error("SQLite disk image is malformed"));

    await expect(
      rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW }),
    ).resolves.toBeUndefined();
  });

  test("a refused write leaves the prompt on rather than assumed-skipped", async () => {
    /*
     * The direction the failure has to fall in: no record means the user gets
     * asked once more, which costs them a tap. The opposite - treating an
     * unwritten skip as a skip - costs them the account.
     */
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValue(new Error("disk full"));

    await rememberBackupCodeOfferSkipped({ userId: USER_A, now: NOW });
    jest.restoreAllMocks();

    expect(
      await wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).toBe(false);
  });

  test("a read that is refused answers false instead of throwing", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValue(new Error("database is locked"));

    await expect(
      wasBackupCodeOfferSkippedRecently({ userId: USER_A, now: NOW }),
    ).resolves.toBe(false);
  });

  test("a delete that is refused does not throw", async () => {
    jest
      .spyOn(AsyncStorage, "removeItem")
      .mockRejectedValue(new Error("database is locked"));

    await expect(
      clearBackupCodeOfferSkip({ userId: USER_A }),
    ).resolves.toBeUndefined();
  });
});
