import { describe, expect, test } from "@jest/globals";
import NtpPacket, {
  NTP_PACKET_LENGTH,
  NTP_TO_UNIX_EPOCH_SECONDS,
  NtpReplyCheck,
  NtpReplyFacts,
  NtpServerReply,
} from "../../../../../Utils/Monitors/MonitorTypes/NtpMonitor/NtpPacket";
import { CAPTURED_NTP_REPLIES, CapturedNtpReply } from "./NtpReplyFixtures";

/*
 * The NTP packet codec, on byte fixtures: the request the probe sends, the
 * checks that decide whether a datagram is the reply to it, and the time it
 * reads out of the reply. The real replies are the ones in NtpReplyFixtures,
 * captured from six public servers, two of them the reporter's own.
 */

const TWO_POW_32: bigint = BigInt(4294967296);

/*
 * An independent reading of an NTP timestamp, in exact integer arithmetic
 * (nanoseconds since the Unix epoch), to hold NtpPacket's floating point
 * arithmetic to. A double has about a quarter of a microsecond of resolution
 * at today's Unix milliseconds, so the two agree to within a microsecond.
 */
function referenceUnixNs(timestamp: Buffer): bigint {
  const seconds: bigint = BigInt(timestamp.readUInt32BE(0));
  const fraction: bigint = BigInt(timestamp.readUInt32BE(4));
  const era: bigint = seconds >= BigInt(0x80000000) ? BigInt(0) : BigInt(1);
  const unixSeconds: bigint =
    seconds + era * TWO_POW_32 - BigInt(NTP_TO_UNIX_EPOCH_SECONDS);

  return (
    unixSeconds * BigInt(1000000000) +
    (fraction * BigInt(1000000000)) / TWO_POW_32
  );
}

function referenceUnixMs(timestamp: Buffer): number {
  return Number(referenceUnixNs(timestamp)) / 1000000;
}

const ONE_MICROSECOND_IN_MS: number = 0.001;

function hex(value: string): Buffer {
  return Buffer.from(value, "hex");
}

function replyBuffer(fixture: CapturedNtpReply): Buffer {
  return hex(fixture.replyHex);
}

// A 48-byte server reply with every field set from `fields`.
function buildReply(fields: {
  leapIndicator?: number;
  version?: number;
  mode?: number;
  stratum?: number;
  referenceId?: Buffer;
  origin?: Buffer;
  receive?: Buffer;
  transmit?: Buffer;
  reference?: Buffer;
}): Buffer {
  const packet: Buffer = Buffer.alloc(NTP_PACKET_LENGTH);

  packet.writeUInt8(
    ((fields.leapIndicator ?? 0) << 6) |
      ((fields.version ?? 4) << 3) |
      (fields.mode ?? 4),
    0,
  );
  packet.writeUInt8(fields.stratum ?? 2, 1);
  packet.writeInt8(6, 2);
  packet.writeInt8(-20, 3);
  (fields.referenceId ?? Buffer.from([192, 0, 2, 1])).copy(packet, 12);
  (fields.reference ?? Buffer.alloc(8)).copy(packet, 16);
  (fields.origin ?? Buffer.alloc(8)).copy(packet, 24);
  (fields.receive ?? Buffer.alloc(8)).copy(packet, 32);
  (fields.transmit ?? Buffer.alloc(8)).copy(packet, 40);

  return packet;
}

const NONCE: Buffer = hex("a1b2c3d4e5f60718");
const SENT_AT_MS: number = Date.UTC(2026, 9, 9, 12, 0, 0, 0);

function validReply(packet: Buffer): NtpServerReply {
  const check: NtpReplyCheck = NtpPacket.checkServerReply({
    packet: packet,
    transmitNonce: NONCE,
  });

  if (!check.isValid) {
    throw new Error(`Expected a valid reply, got: ${check.reason}`);
  }

  return check.reply;
}

function readAt(
  packet: Buffer,
  sentAtMs: number,
  receivedAtMs: number,
): NtpReplyFacts {
  return NtpPacket.readReply({
    reply: validReply(packet),
    transmitNonce: NONCE,
    requestSentAtUnixMs: sentAtMs,
    replyReceivedAtUnixMs: receivedAtMs,
  });
}

describe("NtpPacket", () => {
  describe("the client request", () => {
    test("is 48 bytes: leap 0, version 4, mode 3, and the nonce as its transmit timestamp", () => {
      const request: Buffer = NtpPacket.createClientRequest(NONCE);

      expect(request.length).toBe(48);
      expect(request[0]).toBe(0x23);
      expect(request.subarray(40, 48).equals(NONCE)).toBe(true);
      // Everything else is zero: stratum, poll, delays, the other timestamps.
      expect(
        request.subarray(1, 40).every((b: number) => {
          return b === 0;
        }),
      ).toBe(true);
    });

    test("parses as a client packet in version 4", () => {
      const parsed: NtpServerReply = NtpPacket.parse(
        NtpPacket.createClientRequest(NONCE),
      );

      expect(parsed.mode).toBe(3);
      expect(parsed.version).toBe(4);
      expect(parsed.leapIndicator).toBe(0);
      expect(parsed.transmitTimestamp.equals(NONCE)).toBe(true);
    });

    test("refuses a transmit timestamp that is not 8 bytes", () => {
      expect(() => {
        return NtpPacket.createClientRequest(Buffer.alloc(7, 1));
      }).toThrow("8 bytes");
      expect(() => {
        return NtpPacket.createClientRequest(Buffer.alloc(9, 1));
      }).toThrow("8 bytes");
    });
  });

  describe("the transmit nonce", () => {
    test("is 8 random bytes, different on every request", () => {
      const nonces: Set<string> = new Set<string>();

      for (let index: number = 0; index < 500; index++) {
        const nonce: Buffer = NtpPacket.createTransmitNonce();

        expect(nonce.length).toBe(8);
        nonces.add(nonce.toString("hex"));
      }

      expect(nonces.size).toBe(500);
    });

    test("is never all zeros, which would mean 'not set'", () => {
      const draws: Array<Buffer> = [
        Buffer.alloc(8),
        Buffer.alloc(8),
        hex("0000000000000001"),
      ];
      let calls: number = 0;

      const nonce: Buffer = NtpPacket.createTransmitNonce((): Buffer => {
        return draws[calls++]!;
      });

      expect(calls).toBe(3);
      expect(nonce.toString("hex")).toBe("0000000000000001");
    });
  });

  describe("timestamps", () => {
    test("zero is 'not set', not 1900", () => {
      expect(NtpPacket.timestampToUnixMs(Buffer.alloc(8))).toBeUndefined();
      expect(NtpPacket.isZeroTimestamp(Buffer.alloc(8))).toBe(true);
      expect(NtpPacket.isZeroTimestamp(hex("0000000000000001"))).toBe(false);
    });

    test("the Unix epoch is 2208988800 seconds into the NTP era", () => {
      expect(NtpPacket.timestampToUnixMs(hex("83aa7e8000000000"))).toBe(0);
      expect(NtpPacket.unixMsToTimestamp(0).toString("hex")).toBe(
        "83aa7e8000000000",
      );
    });

    test("the fraction is in 2^-32 seconds", () => {
      expect(NtpPacket.timestampToUnixMs(hex("83aa7e8080000000"))).toBe(500);
      expect(NtpPacket.timestampToUnixMs(hex("83aa7e8040000000"))).toBe(250);
      expect(NtpPacket.unixMsToTimestamp(250).toString("hex")).toBe(
        "83aa7e8040000000",
      );
    });

    test("the seconds wrap into era 1 on 2036-02-07 and keep counting", () => {
      // The last second of era 0.
      expect(NtpPacket.timestampToUnixMs(hex("ffffffff00000000"))).toBe(
        Date.UTC(2036, 1, 7, 6, 28, 15),
      );
      // Half a second into era 1: the seconds field starts again at 0.
      expect(NtpPacket.timestampToUnixMs(hex("0000000080000000"))).toBe(
        Date.UTC(2036, 1, 7, 6, 28, 16, 500),
      );
      expect(NtpPacket.timestampToUnixMs(hex("0000000100000000"))).toBe(
        Date.UTC(2036, 1, 7, 6, 28, 17),
      );
      expect(
        NtpPacket.unixMsToTimestamp(Date.UTC(2036, 1, 7, 6, 28, 17)).toString(
          "hex",
        ),
      ).toBe("0000000100000000");
    });

    test("a timestamp written and read back is the same time, from 1990 to 2100", () => {
      for (let year: number = 1990; year <= 2100; year += 5) {
        const unixMs: number = Date.UTC(year, 5, 15, 13, 37, 42, 123.456);

        expect(
          NtpPacket.timestampToUnixMs(NtpPacket.unixMsToTimestamp(unixMs)),
        ).toBeCloseTo(unixMs, 3);
      }
    });

    test.each(CAPTURED_NTP_REPLIES)(
      "reads $server's timestamps as exact integer arithmetic does",
      (fixture: CapturedNtpReply) => {
        const reply: NtpServerReply = NtpPacket.parse(replyBuffer(fixture));

        for (const timestamp of [
          reply.referenceTimestamp,
          reply.receiveTimestamp,
          reply.transmitTimestamp,
        ]) {
          expect(
            Math.abs(
              NtpPacket.timestampToUnixMs(timestamp)! -
                referenceUnixMs(timestamp),
            ),
          ).toBeLessThan(ONE_MICROSECOND_IN_MS);
        }
      },
    );
  });

  describe("the 16.16 short format", () => {
    test("is seconds with a 16-bit fraction", () => {
      expect(NtpPacket.shortFormatToMs(0x00010000)).toBe(1000);
      expect(NtpPacket.shortFormatToMs(0x00008000)).toBe(500);
      expect(NtpPacket.shortFormatToMs(0)).toBe(0);
    });

    test("is written back to within its resolution (1/65536 s)", () => {
      for (const ms of [0, 0.5, 12.5, 999.9, 8175.8]) {
        expect(
          Math.abs(
            NtpPacket.shortFormatToMs(NtpPacket.msToShortFormat(ms)) - ms,
          ),
        ).toBeLessThan(1000 / 65536);
      }

      expect(NtpPacket.msToShortFormat(-5)).toBe(0);
    });
  });

  describe("a real reply", () => {
    test.each(CAPTURED_NTP_REPLIES)(
      "from $server is the answer to its request",
      (fixture: CapturedNtpReply) => {
        const check: NtpReplyCheck = NtpPacket.checkServerReply({
          packet: replyBuffer(fixture),
          transmitNonce: hex(fixture.nonceHex),
        });

        expect(check.isValid).toBe(true);
      },
    );

    test.each(CAPTURED_NTP_REPLIES)(
      "from $server has the header read from its bytes by hand",
      (fixture: CapturedNtpReply) => {
        const reply: NtpServerReply = NtpPacket.parse(replyBuffer(fixture));

        expect({
          leapIndicator: reply.leapIndicator,
          version: reply.version,
          stratum: reply.stratum,
          poll: reply.poll,
          precision: reply.precision,
          referenceId: NtpPacket.decodeReferenceId(
            reply.referenceIdBytes,
            reply.stratum,
          ),
        }).toEqual(fixture.expected);
        expect(reply.mode).toBe(4);
      },
    );

    test.each(CAPTURED_NTP_REPLIES)(
      "from $server gives the offset and delay of RFC 5905's four-timestamp formula",
      (fixture: CapturedNtpReply) => {
        const packet: Buffer = replyBuffer(fixture);
        const reply: NtpServerReply = NtpPacket.parse(packet);

        const facts: NtpReplyFacts = NtpPacket.readReply({
          reply: reply,
          transmitNonce: hex(fixture.nonceHex),
          requestSentAtUnixMs: fixture.sentAtUnixMs,
          replyReceivedAtUnixMs: fixture.receivedAtUnixMs,
        });

        // T1 to T4 in exact nanoseconds.
        const nanosecondsPerMs: bigint = BigInt(1000000);
        const t1: bigint = BigInt(fixture.sentAtUnixMs) * nanosecondsPerMs;
        const t2: bigint = referenceUnixNs(reply.receiveTimestamp);
        const t3: bigint = referenceUnixNs(reply.transmitTimestamp);
        const t4: bigint = BigInt(fixture.receivedAtUnixMs) * nanosecondsPerMs;

        const expectedOffsetInMs: number =
          Number(t2 - t1 + (t3 - t4)) / 2 / 1000000;
        const expectedDelayInMs: number = Math.max(
          0,
          Number(t4 - t1 - (t3 - t2)) / 1000000,
        );

        expect(facts.hasUsableTime).toBe(true);
        expect(
          Math.abs(facts.clockOffsetInMs! - expectedOffsetInMs),
        ).toBeLessThan(ONE_MICROSECOND_IN_MS);
        expect(
          Math.abs(facts.roundTripDelayInMs! - expectedDelayInMs),
        ).toBeLessThan(ONE_MICROSECOND_IN_MS);
        /*
         * Captured from a synchronized host, so the true offset was about
         * zero and what was measured is the path's asymmetry, which RFC 5905
         * bounds by half the round trip. pool.ntp.org shows it: 71 ms off
         * over a 203 ms round trip.
         */
        expect(Math.abs(facts.clockOffsetInMs!)).toBeLessThanOrEqual(
          facts.roundTripDelayInMs! / 2 + 5,
        );
        expect(facts.roundTripDelayInMs!).toBeLessThanOrEqual(
          fixture.receivedAtUnixMs - fixture.sentAtUnixMs,
        );
      },
    );

    test.each(CAPTURED_NTP_REPLIES)(
      "from $server is synchronized and says when and what it synced to",
      (fixture: CapturedNtpReply) => {
        const reply: NtpServerReply = NtpPacket.parse(replyBuffer(fixture));
        const facts: NtpReplyFacts = NtpPacket.readReply({
          reply: reply,
          transmitNonce: hex(fixture.nonceHex),
          requestSentAtUnixMs: fixture.sentAtUnixMs,
          replyReceivedAtUnixMs: fixture.receivedAtUnixMs,
        });

        expect(facts.isSynchronized).toBe(true);
        expect(facts.kissCode).toBeUndefined();
        expect(facts.referenceId).toBe(fixture.expected.referenceId);
        expect(facts.pollIntervalInSeconds).toBe(
          Math.pow(2, fixture.expected.poll),
        );
        expect(facts.precisionInMs).toBeCloseTo(
          Math.pow(2, fixture.expected.precision) * 1000,
          9,
        );

        const serverTime: number = Date.parse(facts.serverTime!);
        expect(Math.abs(serverTime - fixture.sentAtUnixMs)).toBeLessThan(1000);
        expect(Date.parse(facts.referenceTime!)).toBeLessThanOrEqual(
          serverTime,
        );
      },
    );

    test("tick.jrc.us reports the root dispersion its bytes say: 8.18 seconds", () => {
      const reply: NtpServerReply = NtpPacket.parse(
        replyBuffer(CAPTURED_NTP_REPLIES[3]!),
      );

      expect(CAPTURED_NTP_REPLIES[3]!.server).toBe("tick.jrc.us");
      expect(reply.rootDispersionInMs).toBeCloseTo(
        (0x00082d02 / 65536) * 1000,
        6,
      );
      expect(reply.rootDelayInMs).toBeCloseTo((0x0000022a / 65536) * 1000, 6);
    });
  });

  describe("a datagram that is not the reply", () => {
    const origin: Buffer = NONCE;
    const receive: Buffer = NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5);
    const transmit: Buffer = NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6);

    function check(packet: Buffer): NtpReplyCheck {
      return NtpPacket.checkServerReply({
        packet: packet,
        transmitNonce: NONCE,
      });
    }

    function reasonOf(result: NtpReplyCheck): string {
      return result.isValid ? "" : result.reason;
    }

    test("is shorter than 48 bytes", () => {
      const result: NtpReplyCheck = check(
        buildReply({ origin, receive, transmit }).subarray(0, 47),
      );

      expect(result.isValid).toBe(false);
      expect(reasonOf(result)).toContain("47-byte packet");
      expect(check(Buffer.alloc(0)).isValid).toBe(false);
    });

    test("is still the reply when extension fields or a MAC follow the 48 bytes", () => {
      const packet: Buffer = Buffer.concat([
        buildReply({ origin, receive, transmit }),
        Buffer.alloc(20, 0xab),
      ]);

      expect(check(packet).isValid).toBe(true);
    });

    test.each([
      [0, "reserved"],
      [1, "symmetric active"],
      [2, "symmetric passive"],
      [3, "a client request, as a reflector would send back"],
      [5, "broadcast"],
      [6, "NTP control"],
      [7, "private"],
    ])("is in mode %i (%s), not a server reply", (mode: number) => {
      const result: NtpReplyCheck = check(
        buildReply({ mode, origin, receive, transmit }),
      );

      expect(result.isValid).toBe(false);
      expect(reasonOf(result)).toContain(`mode ${mode}`);
    });

    test.each([0, 5, 6, 7])("is in NTP version %i", (version: number) => {
      const result: NtpReplyCheck = check(
        buildReply({ version, origin, receive, transmit }),
      );

      expect(result.isValid).toBe(false);
      expect(reasonOf(result)).toContain(`version ${version}`);
    });

    test.each([1, 2, 3, 4])(
      "is the reply in version %i, which servers answer in",
      (version: number) => {
        expect(
          check(buildReply({ version, origin, receive, transmit })).isValid,
        ).toBe(true);
      },
    );

    test("answers a different request: a stale reply to an earlier attempt", () => {
      const result: NtpReplyCheck = check(
        buildReply({
          origin: hex("a1b2c3d4e5f60719"),
          receive,
          transmit,
        }),
      );

      expect(result.isValid).toBe(false);
      expect(reasonOf(result)).toContain("stale or spoofed");
    });

    test("carries no origin timestamp at all", () => {
      expect(check(buildReply({ origin: Buffer.alloc(8) })).isValid).toBe(
        false,
      );
    });

    test.each(CAPTURED_NTP_REPLIES)(
      "is $server's real reply checked against another request's nonce",
      (fixture: CapturedNtpReply) => {
        expect(
          NtpPacket.checkServerReply({
            packet: replyBuffer(fixture),
            transmitNonce: NONCE,
          }).isValid,
        ).toBe(false);
      },
    );
  });

  describe("kiss-o'-death and unsynchronized replies", () => {
    test("ntpd's RATE kiss echoes the request in every timestamp: no time, no offset", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          leapIndicator: 3,
          stratum: 0,
          referenceId: Buffer.from("RATE", "ascii"),
          origin: NONCE,
          receive: NONCE,
          transmit: NONCE,
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.kissCode).toBe("RATE");
      expect(facts.referenceId).toBe("RATE");
      expect(facts.hasUsableTime).toBe(false);
      expect(facts.clockOffsetInMs).toBeUndefined();
      expect(facts.roundTripDelayInMs).toBeUndefined();
      expect(facts.serverTime).toBeUndefined();
      expect(facts.isSynchronized).toBe(false);
      // A kiss's zero root delay and dispersion are no error bound.
      expect(facts.rootDelayInMs).toBeUndefined();
      expect(facts.rootDispersionInMs).toBeUndefined();
    });

    test("a DENY kiss with zero timestamps carries no time either", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          leapIndicator: 3,
          stratum: 0,
          referenceId: Buffer.from("DENY", "ascii"),
          origin: NONCE,
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.kissCode).toBe("DENY");
      expect(facts.hasUsableTime).toBe(false);
      expect(facts.isSynchronized).toBe(false);
    });

    test("ntpd before its first sync (stratum 0, INIT) serves its free-running clock: offset, but not synchronized", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          leapIndicator: 3,
          stratum: 0,
          referenceId: Buffer.from("INIT", "ascii"),
          origin: NONCE,
          receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 3005),
          transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 3006),
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.kissCode).toBe("INIT");
      expect(facts.hasUsableTime).toBe(true);
      expect(facts.clockOffsetInMs).toBeCloseTo(3000.5, 3);
      expect(facts.isSynchronized).toBe(false);
      expect(facts.rootDispersionInMs).toBeUndefined();
    });

    test("stratum 16 with the leap alarm is not synchronized", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          leapIndicator: 3,
          stratum: 16,
          referenceId: Buffer.from("INIT", "ascii"),
          origin: NONCE,
          receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
          transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6),
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.isSynchronized).toBe(false);
      expect(facts.kissCode).toBeUndefined();
      expect(facts.referenceId).toBe("INIT");
      // An unsynchronized server's own error bound is still worth showing.
      expect(facts.rootDispersionInMs).toBeDefined();
      expect(facts.rootDelayInMs).toBeDefined();
    });

    test("the leap alarm alone makes a stratum 2 server unsynchronized", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          leapIndicator: 3,
          stratum: 2,
          origin: NONCE,
          receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
          transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6),
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.isSynchronized).toBe(false);
      expect(facts.hasUsableTime).toBe(true);
    });

    test.each([1, 2])(
      "a leap second announcement (leap indicator %i) is healthy",
      (leapIndicator: number) => {
        const facts: NtpReplyFacts = readAt(
          buildReply({
            leapIndicator,
            stratum: 1,
            referenceId: Buffer.from("GPS\0", "binary"),
            origin: NONCE,
            receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
            transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6),
          }),
          SENT_AT_MS,
          SENT_AT_MS + 10,
        );

        expect(facts.isSynchronized).toBe(true);
        expect(facts.referenceId).toBe("GPS");
      },
    );

    test.each([17, 200, 255])(
      "a reserved stratum (%i) is not synchronized",
      (stratum: number) => {
        const facts: NtpReplyFacts = readAt(
          buildReply({
            stratum,
            origin: NONCE,
            receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
            transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6),
          }),
          SENT_AT_MS,
          SENT_AT_MS + 10,
        );

        expect(facts.isSynchronized).toBe(false);
      },
    );

    test("a reply with a zero transmit timestamp carries no usable time", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          stratum: 2,
          origin: NONCE,
          receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.hasUsableTime).toBe(false);
      expect(facts.clockOffsetInMs).toBeUndefined();
      expect(facts.isSynchronized).toBe(false);
    });

    test("a server that never synchronized has no reference time", () => {
      const facts: NtpReplyFacts = readAt(
        buildReply({
          stratum: 16,
          leapIndicator: 3,
          origin: NONCE,
          receive: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 5),
          transmit: NtpPacket.unixMsToTimestamp(SENT_AT_MS + 6),
        }),
        SENT_AT_MS,
        SENT_AT_MS + 10,
      );

      expect(facts.referenceTime).toBeUndefined();
    });
  });

  describe("offset and delay", () => {
    test("a server 100 ms ahead, over a symmetric 10 ms path", () => {
      expect(
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: 1000,
          serverReceivedAtMs: 1105,
          serverSentAtMs: 1106,
          replyReceivedAtMs: 1011,
        }),
      ).toEqual({ clockOffsetInMs: 100, roundTripDelayInMs: 10 });
    });

    test("a server 2 seconds behind has a negative offset", () => {
      expect(
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: 10000,
          serverReceivedAtMs: 8010,
          serverSentAtMs: 8011,
          replyReceivedAtMs: 10021,
        }),
      ).toEqual({ clockOffsetInMs: -2000, roundTripDelayInMs: 20 });
    });

    test("the server's own processing time is not part of the delay", () => {
      expect(
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: 0,
          serverReceivedAtMs: 5,
          serverSentAtMs: 105,
          replyReceivedAtMs: 110,
        }).roundTripDelayInMs,
      ).toBe(10);
    });

    test("an asymmetric path skews the offset by up to half the round trip (RFC 5905's caveat)", () => {
      // Equal clocks; the request takes 90 ms and the reply 10 ms.
      expect(
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: 0,
          serverReceivedAtMs: 90,
          serverSentAtMs: 90,
          replyReceivedAtMs: 100,
        }),
      ).toEqual({ clockOffsetInMs: 40, roundTripDelayInMs: 100 });
    });

    test("a delay below zero, from the server's clock precision, is reported as zero", () => {
      expect(
        NtpPacket.computeClockOffsetAndDelay({
          requestSentAtMs: 0,
          serverReceivedAtMs: 0,
          serverSentAtMs: 2,
          replyReceivedAtMs: 1,
        }).roundTripDelayInMs,
      ).toBe(0);
    });
  });

  describe("the reference id", () => {
    test.each([
      ["GPS\0", 1, "GPS"],
      ["PPS\0", 1, "PPS"],
      ["GOOG", 1, "GOOG"],
      ["NIST", 1, "NIST"],
      ["RATE", 0, "RATE"],
      ["INIT", 16, "INIT"],
    ])(
      "%j at stratum %i is the source name %j",
      (bytes: string, stratum: number, expected: string) => {
        expect(
          NtpPacket.decodeReferenceId(Buffer.from(bytes, "binary"), stratum),
        ).toBe(expected);
      },
    );

    test("from stratum 2 it is the upstream address, even if its bytes are printable", () => {
      expect(NtpPacket.decodeReferenceId(Buffer.from([192, 0, 2, 1]), 2)).toBe(
        "192.0.2.1",
      );
      expect(NtpPacket.decodeReferenceId(Buffer.from("ABCD"), 3)).toBe(
        "65.66.67.68",
      );
    });

    test("a stratum 1 id that is not text is shown as an address", () => {
      expect(NtpPacket.decodeReferenceId(Buffer.from([10, 0, 0, 1]), 1)).toBe(
        "10.0.0.1",
      );
      expect(
        NtpPacket.decodeReferenceId(Buffer.from([0x47, 0x00, 0x50, 0x53]), 1),
      ).toBe("71.0.80.83");
    });

    test("an id of zeros is empty", () => {
      expect(NtpPacket.decodeReferenceId(Buffer.alloc(4), 1)).toBe("");
      expect(NtpPacket.decodeReferenceId(Buffer.alloc(4), 2)).toBe("");
    });

    test("ASCII ids are trimmed of their NUL padding and spaces", () => {
      expect(NtpPacket.decodeAscii(Buffer.from("GPS\0", "binary"))).toBe("GPS");
      expect(NtpPacket.decodeAscii(Buffer.from(" PP\0", "binary"))).toBe("PP");
      expect(NtpPacket.decodeAscii(Buffer.from("\0\0\0\0", "binary"))).toBe(
        undefined,
      );
      expect(NtpPacket.decodeAscii(Buffer.from([0x7f, 0x41, 0, 0]))).toBe(
        undefined,
      );
    });
  });
});
