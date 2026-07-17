// Set required env vars before importing SyslogReceiver (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SyslogReceiver from "../../Services/SyslogReceiver";
import SyslogMessage from "Common/Types/Syslog/SyslogMessage";
import { describe, expect, it } from "@jest/globals";

const SOURCE_IP: string = "10.0.0.99";
const RECEIVED_AT: Date = new Date("2026-07-16T12:00:00.000Z");

describe("SyslogReceiver.parseMessage", () => {
  describe("RFC 3164", () => {
    it("should decode priority into facility and severity", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<134>Feb  5 17:32:18 10.0.0.99 sshd[2345]: Failed password for root",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      // 134 = 16 * 8 + 6 → facility 16 (local0), severity 6 (informational).
      expect(result!.facility).toBe(16);
      expect(result!.severity).toBe(6);
    });

    it("should extract hostname, tag and message", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<134>Feb  5 17:32:18 10.0.0.99 sshd[2345]: Failed password for root",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.hostname).toBe("10.0.0.99");
      expect(result!.appName).toBe("sshd");
      expect(result!.message).toBe("Failed password for root");
      expect(result!.sourceIpAddress).toBe(SOURCE_IP);
      expect(result!.receivedAt).toBe(RECEIVED_AT);
    });

    it("should parse the timestamp from the message", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.timestamp).toBeInstanceOf(Date);
      expect(result!.timestamp.getMonth()).toBe(9); // October
      expect(result!.timestamp.getDate()).toBe(11);
      expect(result!.timestamp.getHours()).toBe(22);
      expect(result!.timestamp.getMinutes()).toBe(14);
      expect(result!.timestamp.getSeconds()).toBe(15);
    });

    it("should handle a tag without a pid suffix", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      // 34 = 4 * 8 + 2 → facility 4 (security), severity 2 (critical).
      expect(result!.facility).toBe(4);
      expect(result!.severity).toBe(2);
      expect(result!.hostname).toBe("mymachine");
      expect(result!.appName).toBe("su");
      expect(result!.message).toBe("'su root' failed for lonvick");
    });
  });

  describe("RFC 5424", () => {
    it("should decode priority, header fields and message", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        '<165>1 2026-02-05T22:14:15.003Z mymachine.example.com evntslog 1370 ID47 [exampleSDID@32473 iut="3" eventSource="Application"] An application event log entry',
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      // 165 = 20 * 8 + 5 → facility 20 (local4), severity 5 (notice).
      expect(result!.facility).toBe(20);
      expect(result!.severity).toBe(5);
      expect(result!.hostname).toBe("mymachine.example.com");
      expect(result!.appName).toBe("evntslog");
      expect(result!.message).toBe("An application event log entry");
      expect(result!.timestamp.toISOString()).toBe("2026-02-05T22:14:15.003Z");
    });

    it("should handle nil header values and fall back to receive time", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<34>1 - - - - - - hello world",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.hostname).toBeUndefined();
      expect(result!.appName).toBeUndefined();
      expect(result!.timestamp).toBe(RECEIVED_AT);
      expect(result!.message).toBe("hello world");
    });

    it("should skip multiple structured data elements", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        '<165>1 2026-02-05T22:14:15.003Z host app 1370 ID47 [one@123 a="1"] [two@456 b="2"] message text',
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.message).toBe("message text");
    });
  });

  describe("malformed input", () => {
    it("should return null for a message without a <PRI> prefix", () => {
      expect(
        SyslogReceiver.parseMessage(
          "this is not a syslog message",
          SOURCE_IP,
          RECEIVED_AT,
        ),
      ).toBeNull();
    });

    it("should return null for an empty message", () => {
      expect(
        SyslogReceiver.parseMessage("", SOURCE_IP, RECEIVED_AT),
      ).toBeNull();
      expect(
        SyslogReceiver.parseMessage("   ", SOURCE_IP, RECEIVED_AT),
      ).toBeNull();
    });

    it("should return null for an out-of-range priority", () => {
      expect(
        SyslogReceiver.parseMessage(
          "<192>Oct 11 22:14:15 host app: message",
          SOURCE_IP,
          RECEIVED_AT,
        ),
      ).toBeNull();
    });

    it("should return null for a non-numeric priority", () => {
      expect(
        SyslogReceiver.parseMessage(
          "<abc>Oct 11 22:14:15 host app: message",
          SOURCE_IP,
          RECEIVED_AT,
        ),
      ).toBeNull();
    });

    it("should keep a message with a valid <PRI> but unrecognized body", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<13>free-form text without any header",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.facility).toBe(1);
      expect(result!.severity).toBe(5);
      expect(result!.hostname).toBeUndefined();
      expect(result!.timestamp).toBe(RECEIVED_AT);
      expect(result!.message).toBe("free-form text without any header");
    });
  });

  describe("priority decoding edge cases", () => {
    it("should decode priority 0 (kernel emergency)", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<0>Oct 11 22:14:15 host kernel: panic",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.facility).toBe(0);
      expect(result!.severity).toBe(0);
    });

    it("should decode priority 191 (local7 debug)", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "<191>Oct 11 22:14:15 host app: debug line",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.facility).toBe(23);
      expect(result!.severity).toBe(7);
    });
  });
});
