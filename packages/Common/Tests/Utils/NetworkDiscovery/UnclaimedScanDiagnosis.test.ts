import {
  MAX_SCAN_STATUS_MESSAGE_LENGTH,
  UNCLAIMED_PENDING_MINUTES,
  UnclaimedScanProbeState,
  buildUnclaimedScanDiagnosis,
} from "../../../Utils/NetworkDiscovery/UnclaimedScanDiagnosis";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test } from "@jest/globals";

/*
 * The sentence a stuck discovery scan gets to say for itself.
 *
 * A scan leaves "Pending" only when a probe asks for it. When no probe ever
 * does, nothing times out and nothing fails — the row simply never moves, and
 * before this existed the product said nothing at all about it. OneUptime
 * issue #3287 is that silence: four scans submitted over an hour, all
 * "Pending", an em-dash where the result goes, and no way to tell a scan
 * queued a second ago from one no probe will ever pick up.
 *
 * So these tests are about the WORDS, not a state machine: whether an operator
 * reading the row learns which of the two very different problems they have,
 * and whether the sentence survives the varchar(500) column it is written to.
 */

const disconnectedProbe: UnclaimedScanProbeState = {
  probeName: "Datacentre Probe",
  isProbeConnected: false,
  lastAliveAt: OneUptimeDate.getSomeHoursAgo(6),
};

const connectedProbe: UnclaimedScanProbeState = {
  probeName: "Datacentre Probe",
  isProbeConnected: true,
  lastAliveAt: OneUptimeDate.getCurrentDate(),
};

describe("buildUnclaimedScanDiagnosis — the probe is not connected", () => {
  test("names the probe the operator chose", () => {
    expect(buildUnclaimedScanDiagnosis(disconnectedProbe)).toContain(
      'Probe "Datacentre Probe"',
    );
  });

  test("says the probe is not connected, which is the actual fault", () => {
    expect(buildUnclaimedScanDiagnosis(disconnectedProbe)).toContain(
      "is not connected to OneUptime",
    );
  });

  /*
   * "Last seen 6 hours ago" is the difference between "my probe just
   * restarted" and "that probe has been gone since the upgrade".
   */
  test("says when the probe was last seen", () => {
    expect(buildUnclaimedScanDiagnosis(disconnectedProbe)).toContain(
      "It was last seen",
    );
  });

  test("a probe that has never connected says exactly that, not 'last seen never'", () => {
    const message: string = buildUnclaimedScanDiagnosis({
      probeName: "Brand New Probe",
      isProbeConnected: false,
      lastAliveAt: null,
    });

    expect(message).toContain("It has never connected.");
    expect(message).not.toContain("last seen");
  });

  test("a missing lastAlive is treated the same as never connecting", () => {
    expect(
      buildUnclaimedScanDiagnosis({
        isProbeConnected: false,
      }),
    ).toContain("It has never connected.");
  });

  /*
   * The scan is annotated, not failed, so the operator needs to know they do
   * not have to re-create it.
   */
  test("promises the scan still runs once the probe returns", () => {
    expect(buildUnclaimedScanDiagnosis(disconnectedProbe)).toContain(
      "as soon as the probe reconnects",
    );
  });
});

describe("buildUnclaimedScanDiagnosis — the probe IS connected", () => {
  /*
   * A completely different problem with a completely different fix: the probe
   * is running and authenticating, but its discovery job is not claiming
   * scans — an old image, a wedged sweep, or a probe that can reach the
   * heartbeat route but not the probe-ingest one.
   */
  test("does not blame the connection", () => {
    const message: string = buildUnclaimedScanDiagnosis(connectedProbe);

    expect(message).toContain("is connected but has not picked this scan up");
    expect(message).not.toContain("is not connected");
  });

  test("names the two things worth checking", () => {
    const message: string = buildUnclaimedScanDiagnosis(connectedProbe);

    expect(message).toContain("version that supports");
    expect(message).toContain("probe-ingest");
  });

  test("quotes the threshold it actually waited for", () => {
    expect(buildUnclaimedScanDiagnosis(connectedProbe)).toContain(
      `${UNCLAIMED_PENDING_MINUTES} minutes`,
    );
  });

  test("the two branches are genuinely different sentences", () => {
    expect(buildUnclaimedScanDiagnosis(connectedProbe)).not.toBe(
      buildUnclaimedScanDiagnosis(disconnectedProbe),
    );
  });
});

describe("buildUnclaimedScanDiagnosis — a probe with no readable name", () => {
  test("falls back to a phrase that still reads as a sentence", () => {
    const message: string = buildUnclaimedScanDiagnosis({
      isProbeConnected: false,
      lastAliveAt: null,
    });

    expect(message).toContain("The assigned probe is not connected");
    expect(message).not.toContain('Probe ""');
  });

  test("an empty-string name is treated as no name", () => {
    expect(
      buildUnclaimedScanDiagnosis({
        probeName: "",
        isProbeConnected: true,
      }),
    ).toContain("The assigned probe");
  });
});

describe("buildUnclaimedScanDiagnosis — it has to fit the column", () => {
  /*
   * statusMessage is a varchar(500) and this message is written through the
   * full update pipeline, which does NOT clamp. An over-long value throws, and
   * the diagnosis is lost precisely when it is most needed.
   */
  test("the column ceiling is the one the model declares", () => {
    expect(MAX_SCAN_STATUS_MESSAGE_LENGTH).toBe(500);
  });

  test("every message fits, for both branches", () => {
    for (const probeState of [disconnectedProbe, connectedProbe]) {
      expect(
        buildUnclaimedScanDiagnosis(probeState).length,
      ).toBeLessThanOrEqual(MAX_SCAN_STATUS_MESSAGE_LENGTH);
    }
  });

  /*
   * A probe name is a ShortText column, so 100 characters is the real worst
   * case. Feeding well past it proves the truncation is what bounds the
   * message rather than the caller's good manners.
   */
  test("an absurdly long probe name cannot overflow the column", () => {
    const longName: string = "N".repeat(400);

    for (const isProbeConnected of [true, false]) {
      const message: string = buildUnclaimedScanDiagnosis({
        probeName: longName,
        isProbeConnected: isProbeConnected,
        lastAliveAt: OneUptimeDate.getSomeHoursAgo(200),
      });

      expect(message.length).toBeLessThanOrEqual(
        MAX_SCAN_STATUS_MESSAGE_LENGTH,
      );
    }
  });

  test("a long name is cut with an ellipsis rather than silently dropped", () => {
    const message: string = buildUnclaimedScanDiagnosis({
      probeName: "N".repeat(400),
      isProbeConnected: false,
    });

    expect(message).toContain("NNN");
    expect(message).toContain("…");
  });

  test("a name that fits is left exactly as the operator typed it", () => {
    expect(
      buildUnclaimedScanDiagnosis({
        probeName: "core-sw-probe-01",
        isProbeConnected: false,
      }),
    ).toContain('Probe "core-sw-probe-01"');
  });
});

describe("the grace period", () => {
  /*
   * The probe polls every minute, so this is a count of consecutive failed
   * polls. Too short and a probe redeploy annotates every queued scan; too
   * long and the operator has given up before the product says anything.
   */
  test("is long enough to ride out a probe restart and short enough to be useful", () => {
    expect(UNCLAIMED_PENDING_MINUTES).toBeGreaterThanOrEqual(5);
    expect(UNCLAIMED_PENDING_MINUTES).toBeLessThanOrEqual(60);
  });
});
