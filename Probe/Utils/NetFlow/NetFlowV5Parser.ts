/*
 * Pure NetFlow v5 datagram parser — no I/O, unit-testable. A v5 export
 * datagram is a 24-byte header followed by `count` fixed 48-byte flow
 * records (count is 1-30 on the wire; routers never send more because the
 * datagram would exceed the typical MTU). All fields are big-endian.
 * Malformed input (wrong version, count out of bounds, or a length that
 * does not match the header's record count) returns null rather than a
 * partial parse — a truncated UDP datagram cannot be trusted.
 */

// Header: version, count, sysUptime, unixSecs, unixNsecs, flowSequence,
// engineType, engineId, samplingInterval.
const HEADER_LENGTH_BYTES: number = 24;

// Record: srcAddr, dstAddr, nextHop, inputIf, outputIf, dPkts, dOctets,
// first, last, srcPort, dstPort, pad, tcpFlags, prot, tos, srcAs, dstAs,
// srcMask, dstMask, pad.
const RECORD_LENGTH_BYTES: number = 48;

const NETFLOW_VERSION: number = 5;

// RFC-defined bound: a v5 datagram carries at most 30 records.
const MIN_RECORD_COUNT: number = 1;
const MAX_RECORD_COUNT: number = 30;

export interface NetFlowV5Header {
  version: number;
  count: number;
  // Milliseconds since the exporting device booted.
  sysUptime: number;
  // Export time: seconds since epoch, plus residual nanoseconds.
  unixSecs: number;
  unixNsecs: number;
  flowSequence: number;
  engineType: number;
  engineId: number;
  // 0 = not sampled, 1 = deterministic 1-in-N, 2 = random 1-in-N.
  samplingMode: number;
  // The N in 1-in-N packet sampling; 0 when sampling is off.
  samplingInterval: number;
}

export interface NetFlowV5Record {
  sourceIpAddress: string;
  destinationIpAddress: string;
  nextHopIpAddress: string;
  inputInterfaceIndex: number;
  outputInterfaceIndex: number;
  packets: number;
  octets: number;
  flowStartAt: Date;
  flowEndAt: Date;
  sourcePort: number;
  destinationPort: number;
  tcpFlags: number;
  protocolNumber: number;
  tos: number;
  sourceAs: number;
  destinationAs: number;
  sourceMaskBits: number;
  destinationMaskBits: number;
}

export interface ParsedNetFlowV5Datagram {
  header: NetFlowV5Header;
  records: Array<NetFlowV5Record>;
}

export default class NetFlowV5Parser {
  /*
   * Parses a raw NetFlow v5 export datagram. Returns null when the buffer
   * is not a well-formed v5 datagram: too short for a header, wrong
   * version, record count outside 1-30, or a total length that does not
   * equal header + count * 48 (a v5 datagram is exactly that size — a
   * shorter buffer is truncated, a longer one is not v5).
   */
  public static parse(datagram: Buffer): ParsedNetFlowV5Datagram | null {
    if (!datagram || datagram.length < HEADER_LENGTH_BYTES) {
      return null;
    }

    const version: number = datagram.readUInt16BE(0);

    if (version !== NETFLOW_VERSION) {
      return null;
    }

    const count: number = datagram.readUInt16BE(2);

    if (count < MIN_RECORD_COUNT || count > MAX_RECORD_COUNT) {
      return null;
    }

    if (datagram.length !== HEADER_LENGTH_BYTES + count * RECORD_LENGTH_BYTES) {
      return null;
    }

    /*
     * Bytes 22-23 pack two fields: the top 2 bits are the sampling mode,
     * the low 14 bits the sampling interval. Reading them as one uint16
     * would report e.g. deterministic 1-in-100 sampling as 16484.
     */
    const samplingField: number = datagram.readUInt16BE(22);

    const header: NetFlowV5Header = {
      version: version,
      count: count,
      sysUptime: datagram.readUInt32BE(4),
      unixSecs: datagram.readUInt32BE(8),
      unixNsecs: datagram.readUInt32BE(12),
      flowSequence: datagram.readUInt32BE(16),
      engineType: datagram.readUInt8(20),
      engineId: datagram.readUInt8(21),
      samplingMode: (samplingField >> 14) & 0x3,
      samplingInterval: samplingField & 0x3fff,
    };

    const records: Array<NetFlowV5Record> = [];

    for (let i: number = 0; i < count; i++) {
      const offset: number = HEADER_LENGTH_BYTES + i * RECORD_LENGTH_BYTES;
      records.push(NetFlowV5Parser.parseRecord(datagram, offset, header));
    }

    return {
      header: header,
      records: records,
    };
  }

  private static parseRecord(
    datagram: Buffer,
    offset: number,
    header: NetFlowV5Header,
  ): NetFlowV5Record {
    /*
     * `first`/`last` are the device's sysUptime (ms since boot) when the
     * flow started/ended; the header carries the sysUptime AND wall clock
     * at export time. Wall-clock flow time = export wall clock + (flow
     * uptime - export uptime). The delta is normally negative (the flow
     * happened before the export).
     */
    const exportTimeMs: number =
      header.unixSecs * 1000 + Math.floor(header.unixNsecs / 1_000_000);

    return {
      sourceIpAddress: NetFlowV5Parser.readIpV4(datagram, offset),
      destinationIpAddress: NetFlowV5Parser.readIpV4(datagram, offset + 4),
      nextHopIpAddress: NetFlowV5Parser.readIpV4(datagram, offset + 8),
      inputInterfaceIndex: datagram.readUInt16BE(offset + 12),
      outputInterfaceIndex: datagram.readUInt16BE(offset + 14),
      packets: datagram.readUInt32BE(offset + 16),
      octets: datagram.readUInt32BE(offset + 20),
      flowStartAt: NetFlowV5Parser.uptimeToDate(
        datagram.readUInt32BE(offset + 24),
        header,
        exportTimeMs,
      ),
      flowEndAt: NetFlowV5Parser.uptimeToDate(
        datagram.readUInt32BE(offset + 28),
        header,
        exportTimeMs,
      ),
      sourcePort: datagram.readUInt16BE(offset + 32),
      destinationPort: datagram.readUInt16BE(offset + 34),
      // offset + 36 is pad1.
      tcpFlags: datagram.readUInt8(offset + 37),
      protocolNumber: datagram.readUInt8(offset + 38),
      tos: datagram.readUInt8(offset + 39),
      sourceAs: datagram.readUInt16BE(offset + 40),
      destinationAs: datagram.readUInt16BE(offset + 42),
      sourceMaskBits: datagram.readUInt8(offset + 44),
      destinationMaskBits: datagram.readUInt8(offset + 45),
      // offset + 46 is pad2.
    };
  }

  // sysUptime is a 32-bit millisecond counter; it wraps every ~49.7 days.
  private static readonly SYS_UPTIME_WRAP_MS: number = 0x100000000;

  /*
   * Converts a record's sysUptime timestamp (ms since device boot) to wall
   * clock: unixSecs * 1000 + (recordUptime - exportUptime).
   *
   * The delta between the two uint32 timers is interpreted as a SIGNED
   * 32-bit value (centred on zero) so both real-world glitches decode
   * correctly: a flow stamped just before a sysUptime wrap comes out as the
   * small negative age it really is, while the small POSITIVE deltas some
   * exporters emit (the flow cache's timer running a beat ahead of the
   * export path's) stay small instead of being mistaken for a wrap and
   * backdating the flow ~49.7 days. Any remaining out-of-range result
   * (before the epoch, or after the export was sent) is clamped to the
   * export time rather than producing a garbage date decades off.
   */
  private static uptimeToDate(
    recordUptimeMs: number,
    header: NetFlowV5Header,
    exportTimeMs: number,
  ): Date {
    let uptimeDeltaMs: number =
      (recordUptimeMs - header.sysUptime) % NetFlowV5Parser.SYS_UPTIME_WRAP_MS;

    if (uptimeDeltaMs >= NetFlowV5Parser.SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs -= NetFlowV5Parser.SYS_UPTIME_WRAP_MS;
    } else if (uptimeDeltaMs < -NetFlowV5Parser.SYS_UPTIME_WRAP_MS / 2) {
      uptimeDeltaMs += NetFlowV5Parser.SYS_UPTIME_WRAP_MS;
    }

    const wallClockMs: number = header.unixSecs * 1000 + uptimeDeltaMs;

    if (wallClockMs < 0 || wallClockMs > exportTimeMs) {
      return new Date(exportTimeMs);
    }

    return new Date(wallClockMs);
  }

  private static readIpV4(datagram: Buffer, offset: number): string {
    return `${datagram.readUInt8(offset)}.${datagram.readUInt8(
      offset + 1,
    )}.${datagram.readUInt8(offset + 2)}.${datagram.readUInt8(offset + 3)}`;
  }
}
