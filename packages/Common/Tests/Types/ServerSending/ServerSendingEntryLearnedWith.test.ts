import { describe, expect, test } from "@jest/globals";
import ServerSendingStatusUtil, {
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingHealthEntry,
  ServerSendingSettingsFingerprints,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";

/*
 * WHAT THE SERVER REMEMBERS DESCRIBES THE SETTINGS IT WAS LEARNED WITH (#7736).
 *
 * The SMS and call entries of GlobalConfig.serverSendingHealth carry a
 * fingerprint of the route they were learned with, because the Twilio
 * account can change without a save when the GLOBAL_TWILIO_ environment
 * variables set it (#7515). An entry learned with another route says
 * nothing about the one the server sends with now: it reads as nothing
 * remembered (untested). An entry written before there were fingerprints
 * counts as learned with the saved settings - `unmarked` - so an upgrade
 * alone forgets nothing.
 */

const NOW: Date = new Date("2026-11-13T12:00:00.000Z");
const SAVED: string = "a".repeat(64);
const ENVIRONMENT: string = "b".repeat(64);

function entry(
  overrides: Partial<ServerSendingHealthEntry> = {},
): ServerSendingHealthEntry {
  return {
    lastSucceededAt: null,
    lastFailedAt: null,
    failingSince: null,
    lastFailure: null,
    ...overrides,
  };
}

const WORKING: ServerSendingHealthEntry = entry({
  lastSucceededAt: "2026-11-13T11:30:00.000Z",
});

const FAILING: ServerSendingHealthEntry = entry({
  lastSucceededAt: "2026-11-12T08:00:00.000Z",
  lastFailedAt: "2026-11-13T11:59:00.000Z",
  failingSince: "2026-11-13T09:00:00.000Z",
  lastFailure: "Authenticate",
});

function stateOf(found: ServerSendingHealthEntry): ServerSendingState {
  return ServerSendingStatusUtil.getState({ isSetUp: true, entry: found });
}

describe("which entry describes the settings a channel sends with now", () => {
  const sendingWithSaved: ServerSendingSettingsFingerprints = {
    current: SAVED,
    unmarked: SAVED,
  };

  const sendingWithEnvironment: ServerSendingSettingsFingerprints = {
    current: ENVIRONMENT,
    unmarked: SAVED,
  };

  test("an entry from before there were fingerprints stays while the saved settings send", () => {
    const health: ServerSendingHealth = { sms: FAILING, call: WORKING };

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.SMS,
        sendingWithSaved,
      ),
    ).toEqual(FAILING);

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.Call,
        sendingWithSaved,
      ),
    ).toEqual(WORKING);
  });

  test("the same entry reads as untested once the variables set another account", () => {
    const health: ServerSendingHealth = { sms: FAILING, call: WORKING };

    const sms: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.SMS,
        sendingWithEnvironment,
      );
    const call: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.Call,
        sendingWithEnvironment,
      );

    expect(sms).toEqual(entry());
    expect(call).toEqual(entry());
    expect(stateOf(sms)).toBe(ServerSendingState.Untested);
    expect(stateOf(call)).toBe(ServerSendingState.Untested);
  });

  test("an entry marked with the settings sending now is kept, whichever they are", () => {
    const marked: ServerSendingHealthEntry = {
      ...FAILING,
      settingsFingerprint: ENVIRONMENT,
    };

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        { sms: marked },
        ServerSendingChannel.SMS,
        sendingWithEnvironment,
      ),
    ).toEqual(marked);
  });

  test("an entry marked with other settings reads as untested, even the saved ones'", () => {
    // Learned under the variables, then they were unset: the saved account sends again.
    const learnedUnderVariables: ServerSendingHealthEntry = {
      ...WORKING,
      settingsFingerprint: ENVIRONMENT,
    };

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        { call: learnedUnderVariables },
        ServerSendingChannel.Call,
        sendingWithSaved,
      ),
    ).toEqual(entry());

    // Learned with one account the variables set, and they now set another.
    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        { call: learnedUnderVariables },
        ServerSendingChannel.Call,
        { current: "c".repeat(64), unmarked: SAVED },
      ),
    ).toEqual(entry());
  });

  test("a channel without fingerprints keeps every entry, marked or not", () => {
    const marked: ServerSendingHealthEntry = {
      ...FAILING,
      settingsFingerprint: ENVIRONMENT,
    };

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        { email: FAILING, push: marked },
        ServerSendingChannel.Email,
        null,
      ),
    ).toEqual(FAILING);

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        { email: FAILING, push: marked },
        ServerSendingChannel.Push,
        null,
      ),
    ).toEqual(marked);
  });

  test("nothing remembered reads as nothing remembered, with or without fingerprints", () => {
    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        {},
        ServerSendingChannel.SMS,
        sendingWithEnvironment,
      ),
    ).toEqual(entry());
  });

  test("the entry read is a copy: changing it changes nothing remembered", () => {
    const health: ServerSendingHealth = { sms: { ...WORKING } };

    const read: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.SMS,
        sendingWithSaved,
      );

    read.lastFailure = "changed";

    expect(health.sms).toEqual(WORKING);

    const stale: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        health,
        ServerSendingChannel.SMS,
        sendingWithEnvironment,
      );

    stale.lastFailure = "changed";

    expect(
      ServerSendingStatusUtil.getCurrentEntry(
        {},
        ServerSendingChannel.SMS,
        sendingWithEnvironment,
      ),
    ).toEqual(entry());
  });
});

describe("what an entry is written with", () => {
  test("a send under the variables is written as theirs, and starts a new streak", () => {
    // The saved account had been failing; the variables set a fixed one.
    const current: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        { sms: FAILING },
        ServerSendingChannel.SMS,
        { current: ENVIRONMENT, unmarked: SAVED },
      );

    expect(ServerSendingStatusUtil.shouldWriteSucceeded(current, NOW)).toBe(
      true,
    );

    const written: ServerSendingHealthEntry =
      ServerSendingStatusUtil.withSettingsFingerprint(
        ServerSendingStatusUtil.withSucceeded(current, NOW),
        { current: ENVIRONMENT, unmarked: SAVED },
      );

    expect(written).toEqual({
      lastSucceededAt: NOW.toISOString(),
      lastFailedAt: null,
      failingSince: null,
      lastFailure: null,
      settingsFingerprint: ENVIRONMENT,
    });
  });

  test("a failure under new settings starts its streak now, not when the old one's began", () => {
    const current: ServerSendingHealthEntry =
      ServerSendingStatusUtil.getCurrentEntry(
        { call: FAILING },
        ServerSendingChannel.Call,
        { current: ENVIRONMENT, unmarked: SAVED },
      );

    // The same reason as the old account's last failure is still news.
    expect(
      ServerSendingStatusUtil.shouldWriteFailed(current, "Authenticate", NOW),
    ).toBe(true);

    const written: ServerSendingHealthEntry =
      ServerSendingStatusUtil.withSettingsFingerprint(
        ServerSendingStatusUtil.withFailed(current, "Authenticate", NOW),
        { current: ENVIRONMENT, unmarked: SAVED },
      );

    expect(written.failingSince).toBe(NOW.toISOString());
    expect(written.lastSucceededAt).toBeNull();
    expect(written.settingsFingerprint).toBe(ENVIRONMENT);
  });

  test("an entry for a channel without fingerprints is written unmarked", () => {
    const written: ServerSendingHealthEntry =
      ServerSendingStatusUtil.withSettingsFingerprint(
        { ...WORKING, settingsFingerprint: ENVIRONMENT },
        null,
      );

    expect(written).toEqual(WORKING);
    expect("settingsFingerprint" in written).toBe(false);
  });

  test("marking leaves the entry it was given as it was", () => {
    const given: ServerSendingHealthEntry = { ...WORKING };

    ServerSendingStatusUtil.withSettingsFingerprint(given, {
      current: ENVIRONMENT,
      unmarked: SAVED,
    });

    expect(given).toEqual(WORKING);
  });
});

describe("what the server reads back of a fingerprint", () => {
  test("a fingerprint is kept with its entry, and round-trips through the stored column", () => {
    const stored: ServerSendingHealth = {
      sms: { ...WORKING, settingsFingerprint: ENVIRONMENT },
      email: WORKING,
    };

    const read: ServerSendingHealth = ServerSendingStatusUtil.readHealth(
      JSON.parse(JSON.stringify(stored)),
    );

    expect(read).toEqual(stored);
    expect("settingsFingerprint" in read.email!).toBe(false);
  });

  test.each([
    ["a number", 42],
    ["an empty text", "   "],
    ["a text longer than a fingerprint is", "f".repeat(129)],
    ["an object", { value: SAVED }],
    ["null", null],
  ])(
    "%s is no fingerprint: the entry reads as unmarked",
    (_label: string, value: unknown) => {
      const read: ServerSendingHealthEntry = ServerSendingStatusUtil.readEntry({
        ...WORKING,
        settingsFingerprint: value,
      });

      expect(read).toEqual(WORKING);
      expect("settingsFingerprint" in read).toBe(false);
    },
  );

  test("a fingerprint is read trimmed", () => {
    expect(
      ServerSendingStatusUtil.readEntry({
        ...WORKING,
        settingsFingerprint: `  ${SAVED}  `,
      }).settingsFingerprint,
    ).toBe(SAVED);
  });
});
