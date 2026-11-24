import SnmpTrapRefusals, {
  MAX_TRACKED_REFUSALS,
} from "../../../../Utils/Snmp/V3/SnmpTrapRefusals";
import RecentInforms, {
  INFORM_RETRY_WINDOW_MS,
  MAX_INFORMS,
} from "../../../../Utils/Snmp/V3/RecentInforms";
import {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  SNMP_TRAP_REFUSAL_RETENTION_MS,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import { describe, expect, test } from "@jest/globals";

/*
 * What the probe's page says about refused SNMPv3 traps - "12 SNMPv3 traps
 * from 10.20.0.5 failed: unknown user san-monitor" - and the informs a
 * retry would otherwise forward twice.
 */

const T0: number = Date.UTC(2026, 10, 24, 12, 0, 0);

describe("refusals", () => {
  test("are counted per source address, reason and user name", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();

    for (let index: number = 0; index < 12; index++) {
      refusals.record({
        sourceAddress: "10.20.0.5",
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: "san-monitor",
        atMs: T0 + index * 1000,
      });
    }

    refusals.record({
      sourceAddress: "10.20.0.5",
      reason: SnmpTrapRefusalReason.WrongDigest,
      userName: "san-monitor",
      atMs: T0,
    });

    const list: Array<SnmpTrapRefusal> = refusals.list(T0 + 60000);

    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      sourceAddress: "10.20.0.5",
      reason: SnmpTrapRefusalReason.UnknownUser,
      userName: "san-monitor",
      count: 12,
      firstSeenAt: new Date(T0).toISOString(),
      lastSeenAt: new Date(T0 + 11000).toISOString(),
    });
    expect(list[1]!.count).toBe(1);
  });

  test("say the first of each kind, so the probe logs it once", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();
    const record: () => boolean = (): boolean => {
      return refusals.record({
        sourceAddress: "10.20.0.5",
        reason: SnmpTrapRefusalReason.DecryptionError,
        userName: "u",
        atMs: T0,
      });
    };

    expect(record()).toBe(true);
    expect(record()).toBe(false);
  });

  test("one IPv6 source is one source however it was written", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();

    for (const address of ["2001:DB8::1", "2001:db8:0:0:0:0:0:1"]) {
      refusals.record({
        sourceAddress: address,
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: "u",
        atMs: T0,
      });
    }

    expect(refusals.list(T0)).toEqual([
      expect.objectContaining({ sourceAddress: "2001:db8::1", count: 2 }),
    ]);
  });

  test("are listed most recent first, at most MAX_REPORTED_SNMP_TRAP_REFUSALS", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();

    for (let index: number = 0; index < MAX_REPORTED_SNMP_TRAP_REFUSALS + 5; index++) {
      refusals.record({
        sourceAddress: `10.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: "u",
        atMs: T0 + index,
      });
    }

    const list: Array<SnmpTrapRefusal> = refusals.list(T0 + 1000);
    expect(list).toHaveLength(MAX_REPORTED_SNMP_TRAP_REFUSALS);
    expect(list[0]!.lastSeenAt).toBe(
      new Date(T0 + MAX_REPORTED_SNMP_TRAP_REFUSALS + 4).toISOString(),
    );
  });

  test("age out a day after they were last seen", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();
    refusals.record({
      sourceAddress: "10.20.0.5",
      reason: SnmpTrapRefusalReason.NotInTimeWindow,
      userName: "u",
      atMs: T0,
    });

    expect(refusals.list(T0 + SNMP_TRAP_REFUSAL_RETENTION_MS)).toHaveLength(1);
    expect(refusals.list(T0 + SNMP_TRAP_REFUSAL_RETENTION_MS + 1)).toHaveLength(
      0,
    );
    expect(refusals.size()).toBe(0);
  });

  test("a trap taken from the same source and user puts every refusal of theirs right", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();

    for (const reason of [
      SnmpTrapRefusalReason.UnknownUser,
      SnmpTrapRefusalReason.WrongDigest,
    ]) {
      refusals.record({
        sourceAddress: "10.20.0.5",
        reason: reason,
        userName: "san-monitor",
        atMs: T0,
      });
    }

    refusals.record({
      sourceAddress: "10.20.0.5",
      reason: SnmpTrapRefusalReason.UnknownUser,
      userName: "someone-else",
      atMs: T0,
    });
    refusals.record({
      sourceAddress: "10.20.0.6",
      reason: SnmpTrapRefusalReason.UnknownUser,
      userName: "san-monitor",
      atMs: T0,
    });

    refusals.clear("10.20.0.5", "san-monitor");

    expect(
      refusals.list(T0).map((refusal: SnmpTrapRefusal) => {
        return `${refusal.sourceAddress} ${refusal.userName}`;
      }),
    ).toEqual(
      expect.arrayContaining(["10.20.0.5 someone-else", "10.20.0.6 san-monitor"]),
    );
    expect(refusals.list(T0)).toHaveLength(2);
  });

  test("keep at most MAX_TRACKED_REFUSALS, dropping the least recently seen", () => {
    const refusals: SnmpTrapRefusals = new SnmpTrapRefusals();

    for (let index: number = 0; index < MAX_TRACKED_REFUSALS + 25; index++) {
      refusals.record({
        sourceAddress: "10.0.0.1",
        reason: SnmpTrapRefusalReason.UnknownUser,
        userName: `scan-${index}`,
        atMs: T0 + index,
      });
    }

    expect(refusals.size()).toBe(MAX_TRACKED_REFUSALS);
  });
});

describe("recent informs", () => {
  test("a retried copy within the window is not forwarded again", () => {
    const informs: RecentInforms = new RecentInforms();
    const inform: {
      sender: string;
      requestId: number;
      varbinds: string;
      nowMs: number;
    } = {
      sender: "10.20.0.5|3|san-monitor",
      requestId: 77,
      varbinds: "[link down]",
      nowMs: T0,
    };

    expect(informs.isFirstSeen(inform)).toBe(true);
    expect(informs.isFirstSeen({ ...inform, nowMs: T0 + 5000 })).toBe(false);
    expect(
      informs.isFirstSeen({ ...inform, nowMs: T0 + INFORM_RETRY_WINDOW_MS + 1 }),
    ).toBe(true);
  });

  test("another request ID, other varbinds or another sender is another inform", () => {
    const informs: RecentInforms = new RecentInforms();
    const inform: {
      sender: string;
      requestId: number;
      varbinds: string;
      nowMs: number;
    } = { sender: "a", requestId: 1, varbinds: "x", nowMs: T0 };

    expect(informs.isFirstSeen(inform)).toBe(true);
    expect(informs.isFirstSeen({ ...inform, requestId: 2 })).toBe(true);
    expect(informs.isFirstSeen({ ...inform, varbinds: "y" })).toBe(true);
    expect(informs.isFirstSeen({ ...inform, sender: "b" })).toBe(true);
  });

  test("remembers at most MAX_INFORMS", () => {
    const informs: RecentInforms = new RecentInforms();

    for (let index: number = 0; index < MAX_INFORMS + 10; index++) {
      informs.isFirstSeen({ sender: "a", requestId: index, varbinds: "", nowMs: T0 });
    }

    expect(informs.size()).toBe(MAX_INFORMS);
  });
});
