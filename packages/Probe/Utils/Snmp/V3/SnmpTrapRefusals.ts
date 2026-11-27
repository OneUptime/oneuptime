import {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  SNMP_TRAP_REFUSAL_RETENTION_MS,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "Common/Types/Probe/SnmpTrapReceiver";
import IpCanonicalUtil from "Common/Utils/IpCanonicalUtil";
import OldestKeyMap from "Common/Utils/OldestKeyMap";

/*
 * The SNMPv3 traps the probe's receiver refused, counted per source
 * address, reason and user name - "12 SNMPv3 traps from 10.20.0.5 failed:
 * unknown user san-monitor" - for the probe's report to OneUptime
 * (Types/Probe/SnmpTrapReceiver). Nothing a refused trap carried is kept:
 * only that it came, from where, as whom, and why it was refused.
 *
 * A source and user whose trap is then taken is cleared at once, so the
 * page stops saying a device is refused as soon as its credentials are put
 * right. What is not seen again ages out after a day. At most
 * MAX_TRACKED_REFUSALS are kept - a scan from many addresses drops the
 * least recently seen - and a report carries the most recent ones.
 */

export const MAX_TRACKED_REFUSALS: number = 500;

interface RefusalEntry {
  sourceAddress: string;
  reason: SnmpTrapRefusalReason;
  userName: string;
  count: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
}

export default class SnmpTrapRefusals {
  // Least recently seen first, answered in constant time.
  private readonly entries: OldestKeyMap<string, RefusalEntry> =
    new OldestKeyMap();

  /*
   * Counts one refusal. Returns true when it is the first of its source,
   * reason and user name - the receiver says so once in its log.
   */
  public record(data: {
    sourceAddress: string;
    reason: SnmpTrapRefusalReason;
    userName: string;
    atMs: number;
  }): boolean {
    const sourceAddress: string = IpCanonicalUtil.canonicalize(
      data.sourceAddress,
    );
    const key: string = SnmpTrapRefusals.toKey(
      sourceAddress,
      data.reason,
      data.userName,
    );
    const existing: RefusalEntry | undefined = this.entries.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeenAtMs = data.atMs;
      this.entries.delete(key);
      this.entries.set(key, existing);
      return false;
    }

    this.entries.set(key, {
      sourceAddress: sourceAddress,
      reason: data.reason,
      userName: data.userName,
      count: 1,
      firstSeenAtMs: data.atMs,
      lastSeenAtMs: data.atMs,
    });

    while (this.entries.size > MAX_TRACKED_REFUSALS) {
      const oldest: string | undefined = this.entries.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }

    return true;
  }

  // A trap from this source, as this user, was taken: whatever refused it before is put right.
  public clear(sourceAddress: string, userName: string): void {
    const source: string = IpCanonicalUtil.canonicalize(sourceAddress);

    for (const [key, entry] of this.entries) {
      if (entry.sourceAddress === source && entry.userName === userName) {
        this.entries.delete(key);
      }
    }
  }

  // The refusals of the last day, the most recent first.
  public list(nowMs: number): Array<SnmpTrapRefusal> {
    const oldestKeptMs: number = nowMs - SNMP_TRAP_REFUSAL_RETENTION_MS;

    for (const [key, entry] of this.entries) {
      if (entry.lastSeenAtMs < oldestKeptMs) {
        this.entries.delete(key);
      }
    }

    return Array.from(this.entries.values())
      .sort((a: RefusalEntry, b: RefusalEntry): number => {
        return b.lastSeenAtMs - a.lastSeenAtMs;
      })
      .slice(0, MAX_REPORTED_SNMP_TRAP_REFUSALS)
      .map((entry: RefusalEntry): SnmpTrapRefusal => {
        return {
          sourceAddress: entry.sourceAddress,
          reason: entry.reason,
          userName: entry.userName,
          count: entry.count,
          firstSeenAt: new Date(entry.firstSeenAtMs).toISOString(),
          lastSeenAt: new Date(entry.lastSeenAtMs).toISOString(),
        };
      });
  }

  public size(): number {
    return this.entries.size;
  }

  private static toKey(
    sourceAddress: string,
    reason: SnmpTrapRefusalReason,
    userName: string,
  ): string {
    return JSON.stringify([sourceAddress, reason, userName]);
  }
}
