// Set required env vars before importing SyslogReceiver (which imports Config.ts)
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
// Small, so the tests of the limit do not need hundreds of messages.
process.env["PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE"] = "20";
// ProbeAPIRequest stamps every forward with the probe's identity.
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import SyslogReceiver from "../../Services/SyslogReceiver";
import {
  PROBE_INGEST_URL,
  PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE,
} from "../../Config";
import SyslogMessage, {
  MAX_SYSLOG_RAW_LENGTH,
} from "Common/Types/Syslog/SyslogMessage";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { parseSyslogMessage } from "Common/Utils/Syslog/SyslogMessageParser";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { EventEmitter } from "events";
import net from "net";

/*
 * The probe's syslog receiver: what it takes as a message, over UDP and
 * over TCP, what it forwards and what it sheds.
 *
 * The OneUptime instance does the reading - which device, which vendor,
 * which event. The probe's job is narrower and must not fail quietly: take
 * every line a device sends, even when the line is not quite syslog; send
 * the line itself along, because that is what the instance's parsers read;
 * and when there is more than it may forward, drop the routine lines
 * before the one that says a link went down.
 */

const SOURCE_IP: string = "10.0.0.99";
const RECEIVED_AT: Date = new Date("2026-07-16T12:00:00.000Z");

const LINK_DOWN: string =
  "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";
const ROUTINE: string =
  "<134>Oct 13 10:11:09 core-sw1 dhcpd: DHCPACK on 10.0.0.77 to 00:11:22:33:44:55";

/*
 * The receiver's own statics, reached past `private`. They are
 * process-wide, so each test resets them.
 */
type ReceiverInternals = {
  handleDatagram: (datagram: Buffer, sourceIpAddress: string) => void;
  handleLine: (line: string, sourceIpAddress: string) => void;
  flush: () => Promise<void>;
  buffer: Array<SyslogMessage>;
  bufferedCharacters: number;
  isFlushing: boolean;
  forwardedThisMinute: number;
  droppedThisMinute: number;
  eventsKeptPastLimitThisMinute: number;
  minuteWindowStartedAt: number;
  lastReceivedAtMs: number;
};

const receiver: ReceiverInternals =
  SyslogReceiver as unknown as ReceiverInternals;

function resetReceiver(): void {
  receiver.buffer = [];
  receiver.bufferedCharacters = 0;
  receiver.isFlushing = false;
  receiver.forwardedThisMinute = 0;
  receiver.droppedThisMinute = 0;
  receiver.eventsKeptPastLimitThisMinute = 0;
  receiver.minuteWindowStartedAt = Date.now();
  receiver.lastReceivedAtMs = 0;
}

function bufferedRawLines(): Array<string | undefined> {
  return receiver.buffer.map((message: SyslogMessage) => {
    return message.raw;
  });
}

beforeEach(() => {
  resetReceiver();
});

afterEach(() => {
  jest.restoreAllMocks();
  resetReceiver();
});

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

  describe("the line itself goes along", () => {
    it("as `raw`: what the instance's vendor parsers read", () => {
      const line: string =
        "<14>Jan  7 20:22:55 10.1.1.5 00076 ports: port 3 is now on-line";
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        line,
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result!.raw).toBe(line);
      // The tag a vendor's format starts with is still on it there.
      expect(result!.raw).toContain("00076 ports:");
    });

    it("without the white space, line ends and NULs senders pad a message with", () => {
      for (const padded of [
        `${LINK_DOWN}\n`,
        `${LINK_DOWN}\r\n`,
        `  ${LINK_DOWN}  `,
        `${LINK_DOWN}\0`,
        `${LINK_DOWN}\n\0\0`,
      ]) {
        expect(
          SyslogReceiver.parseMessage(padded, SOURCE_IP, RECEIVED_AT)!.raw,
        ).toBe(LINK_DOWN);
      }
    });

    it("cut to the longest a message can be", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        `<13>${"x".repeat(MAX_SYSLOG_RAW_LENGTH * 2)}`,
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result!.raw).toHaveLength(MAX_SYSLOG_RAW_LENGTH);
    });

    it("read by the same reader the OneUptime instance uses, so the two never disagree", () => {
      for (const line of [
        LINK_DOWN,
        ROUTINE,
        "<34>1 - - - - - - hello world",
        "<30>May 29 12:17:20 SNTP: <Warn> the clock is not set",
        "<12>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|msg=Lobby AP went offline.",
        'device_name="SFW" log_type="Event" log_component="IPSec" status="Terminated"',
      ]) {
        const result: SyslogMessage | null = SyslogReceiver.parseMessage(
          line,
          SOURCE_IP,
          RECEIVED_AT,
        );
        const shared: ReturnType<typeof parseSyslogMessage> =
          parseSyslogMessage(line);

        expect(result).not.toBeNull();
        expect(result!.message).toBe(shared!.message);
        expect(result!.hostname).toBe(shared!.hostname);
        expect(result!.appName).toBe(shared!.appName);
      }
    });
  });

  describe("a line without a priority", () => {
    it("is taken as user.notice, what a relay assumes for it", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "this is not quite a syslog message",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result).not.toBeNull();
      expect(result!.facility).toBe(1);
      expect(result!.severity).toBe(5);
      expect(result!.message).toBe("this is not quite a syslog message");
      expect(result!.raw).toBe("this is not quite a syslog message");
      expect(result!.timestamp).toBe(RECEIVED_AT);
      expect(result!.hostname).toBeUndefined();
    });

    it("RouterOS's default format arrives: topics, then the message", () => {
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result!.raw).toBe(
        "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
      );
    });

    it("RouterOS's CEF format arrives, with the time and host it starts with", () => {
      const line: string =
        "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik msg=login failure for user guest";
      const result: SyslogMessage | null = SyslogReceiver.parseMessage(
        line,
        SOURCE_IP,
        RECEIVED_AT,
      );

      expect(result!.raw).toBe(line);
      expect(result!.hostname).toBe("MikroTik");
      expect(result!.timestamp.getMonth()).toBe(9);
      expect(result!.timestamp.getDate()).toBe(2);
    });

    it("text in any language and tabs are text", () => {
      for (const line of [
        "température élevée sur le port 3",
        "温度が高い 3",
        "key\tvalue\t3",
      ]) {
        expect(
          SyslogReceiver.parseMessage(line, SOURCE_IP, RECEIVED_AT),
        ).not.toBeNull();
      }
    });

    it("is not taken when it is not a line of text: an open port hears more than syslog", () => {
      for (const junk of [
        // An SNMP request sent to the wrong port.
        Buffer.from([0x30, 0x26, 0x02, 0x01, 0x01, 0x04, 0x06]).toString(
          "utf8",
        ),
        // Bytes that are not UTF-8 decode to the replacement character.
        Buffer.from([0x61, 0x62, 0xff, 0xfe, 0x63]).toString("utf8"),
        "line one\nline two",
        "bell\u0007",
        "delete\u007f",
        // Nothing to read at all.
        "-----",
        "...",
        "?",
      ]) {
        expect({
          junk,
          result: SyslogReceiver.parseMessage(junk, SOURCE_IP, RECEIVED_AT),
        }).toEqual({ junk, result: null });
      }
    });
  });

  describe("malformed input", () => {
    it("should return null for an empty message", () => {
      expect(
        SyslogReceiver.parseMessage("", SOURCE_IP, RECEIVED_AT),
      ).toBeNull();
      expect(
        SyslogReceiver.parseMessage("   ", SOURCE_IP, RECEIVED_AT),
      ).toBeNull();
      expect(
        SyslogReceiver.parseMessage("\0\0\n", SOURCE_IP, RECEIVED_AT),
      ).toBeNull();
      expect(
        SyslogReceiver.parseMessage(
          undefined as unknown as string,
          SOURCE_IP,
          RECEIVED_AT,
        ),
      ).toBeNull();
    });

    it("should return null for an out-of-range priority", () => {
      for (const priority of ["192", "200", "999"]) {
        expect(
          SyslogReceiver.parseMessage(
            `<${priority}>Oct 11 22:14:15 host app: message`,
            SOURCE_IP,
            RECEIVED_AT,
          ),
        ).toBeNull();
      }
    });

    it("should return null where a priority goes and it is not one", () => {
      for (const line of [
        "<abc>Oct 11 22:14:15 host app: message",
        "<1234>Oct 11 22:14:15 host app: message",
        "<>Oct 11 22:14:15 host app: message",
        "<13 Oct 11 22:14:15 host app: message",
        "<-1>Oct 11 22:14:15 host app: message",
      ]) {
        expect({
          line,
          result: SyslogReceiver.parseMessage(line, SOURCE_IP, RECEIVED_AT),
        }).toEqual({ line, result: null });
      }
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

    it("every priority from 0 to 191 is its facility and severity", () => {
      for (let priority: number = 0; priority <= 191; priority++) {
        const result: SyslogMessage | null = SyslogReceiver.parseMessage(
          `<${priority}>text`,
          SOURCE_IP,
          RECEIVED_AT,
        );

        expect({
          priority,
          facility: result?.facility,
          severity: result?.severity,
        }).toEqual({
          priority,
          facility: Math.floor(priority / 8),
          severity: priority % 8,
        });
      }
    });
  });
});

describe("the time a message was received", () => {
  const FROZEN: Date = new Date("2026-10-13T10:11:12.345Z");

  // The clock the receiver reads, held still and moved by hand.
  let clock: Date = FROZEN;

  beforeEach(() => {
    clock = FROZEN;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return clock;
    });
    jest.spyOn(receiver, "flush").mockResolvedValue(undefined);
  });

  function receivedTimes(): Array<number> {
    return receiver.buffer.map((message: SyslogMessage) => {
      return message.receivedAt.getTime();
    });
  }

  it("is never the same millisecond twice: a down and an up sent in one burst keep their order", () => {
    // The clock does not move between the two.
    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    receiver.handleLine(
      "<189>Oct 13 10:11:09 core-sw1 46: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up",
      SOURCE_IP,
    );

    expect(receivedTimes()).toEqual([FROZEN.getTime(), FROZEN.getTime() + 1]);
  });

  it("goes on in order through a burst, and falls back to the clock as soon as it has moved on", () => {
    for (let index: number = 0; index < 5; index++) {
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(`<13>message ${index}`, SOURCE_IP);
    }

    expect(receivedTimes()).toEqual(
      [0, 1, 2, 3, 4].map((offset: number) => {
        return FROZEN.getTime() + offset;
      }),
    );

    clock = new Date(FROZEN.getTime() + 500);
    receiver.handleLine("<13>later", SOURCE_IP);

    expect(receivedTimes()[5]).toBe(FROZEN.getTime() + 500);
  });

  it("is never pushed more than a second ahead of the clock, however long the burst", () => {
    receiver.isFlushing = true; // Nothing leaves the buffer meanwhile.

    for (let index: number = 0; index < 3000; index++) {
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(`<13>message ${index}`, SOURCE_IP);
    }

    const times: Array<number> = receivedTimes();

    expect(Math.max(...times) - FROZEN.getTime()).toBe(1000);
    // Up to the limit every time is its own; past it they share the clock's.
    expect(new Set(times.slice(0, 1001)).size).toBe(1001);
    expect(new Set(times.slice(1001)).size).toBe(1);
    expect(times[2999]).toBe(FROZEN.getTime());
  });

  it("is not moved on by messages the rate limit drops", () => {
    for (let index: number = 0; index < 500; index++) {
      receiver.handleLine(`<134>routine line ${index}`, SOURCE_IP);
    }

    // Twenty were forwarded; the other 480 took no time of their own.
    expect(receiver.buffer).toHaveLength(PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE);
    expect(receiver.lastReceivedAtMs).toBe(
      FROZEN.getTime() + PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE - 1,
    );
  });

  it("is the time of a message that has none of its own", () => {
    receiver.handleLine("<13>first, with no time", SOURCE_IP);
    receiver.handleLine("<13>second, with no time", SOURCE_IP);

    for (const message of receiver.buffer) {
      expect(message.timestamp).toBe(message.receivedAt);
    }

    expect(receiver.buffer[1]!.timestamp.getTime()).toBe(FROZEN.getTime() + 1);
  });

  it("leaves a device's own time as the device wrote it", () => {
    receiver.handleLine(
      "<165>1 2026-10-13T10:11:09.003Z host app - - - first",
      SOURCE_IP,
    );
    receiver.handleLine(
      "<165>1 2026-10-13T10:11:09.003Z host app - - - second",
      SOURCE_IP,
    );

    expect(
      receiver.buffer.map((message: SyslogMessage) => {
        return message.timestamp.toISOString();
      }),
    ).toEqual(["2026-10-13T10:11:09.003Z", "2026-10-13T10:11:09.003Z"]);
    expect(receivedTimes()).toEqual([FROZEN.getTime(), FROZEN.getTime() + 1]);
  });
});

describe("a UDP datagram", () => {
  it("is one message, from the address that sent it", () => {
    receiver.handleDatagram(Buffer.from(LINK_DOWN), SOURCE_IP);

    expect(receiver.buffer).toHaveLength(1);
    expect(receiver.buffer[0]!.sourceIpAddress).toBe(SOURCE_IP);
    expect(receiver.buffer[0]!.raw).toBe(LINK_DOWN);
    expect(receiver.buffer[0]!.receivedAt).toBeInstanceOf(Date);
  });

  it("that is not a message is skipped, and spends nothing of the limit", () => {
    receiver.handleDatagram(Buffer.alloc(0), SOURCE_IP);
    receiver.handleDatagram(Buffer.from([0x30, 0x26, 0x02, 0x01]), SOURCE_IP);
    receiver.handleDatagram(Buffer.from("<999>nope"), SOURCE_IP);

    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.forwardedThisMinute).toBe(0);
  });
});

describe("a TCP connection", () => {
  type FakeConnection = EventEmitter & {
    remoteAddress: string | undefined;
    setKeepAlive: jest.Mock;
    destroy: jest.Mock;
  };

  function connect(remoteAddress: string | undefined): FakeConnection {
    const connection: FakeConnection = Object.assign(new EventEmitter(), {
      remoteAddress: remoteAddress,
      setKeepAlive: jest.fn(),
      destroy: jest.fn(),
    }) as FakeConnection;

    SyslogReceiver.handleConnection(connection as unknown as net.Socket);

    return connection;
  }

  it("carries one message a line, each from the connection's address", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    connection.emit("data", Buffer.from(`${LINK_DOWN}\n${ROUTINE}\n`));

    expect(bufferedRawLines()).toEqual([LINK_DOWN, ROUTINE]);
    expect(
      receiver.buffer.map((message: SyslogMessage) => {
        return message.sourceIpAddress;
      }),
    ).toEqual([SOURCE_IP, SOURCE_IP]);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it("a message that arrives in pieces is one message", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    connection.emit("data", Buffer.from(LINK_DOWN.slice(0, 20)));
    connection.emit("data", Buffer.from(LINK_DOWN.slice(20, 60)));

    expect(receiver.buffer).toHaveLength(0);

    connection.emit("data", Buffer.from(`${LINK_DOWN.slice(60)}\n`));

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
  });

  it("carries counted messages too (RFC 6587 octet counting)", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    connection.emit(
      "data",
      Buffer.from(
        `${Buffer.byteLength(LINK_DOWN)} ${LINK_DOWN}${Buffer.byteLength(ROUTINE)} ${ROUTINE}`,
      ),
    );

    expect(bufferedRawLines()).toEqual([LINK_DOWN, ROUTINE]);
  });

  it("a last line with no line feed is delivered when the device closes", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    connection.emit("data", Buffer.from(LINK_DOWN));

    expect(receiver.buffer).toHaveLength(0);

    connection.emit("end");

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
  });

  it("two connections never mix their bytes", () => {
    const first: FakeConnection = connect("10.0.0.1");
    const second: FakeConnection = connect("10.0.0.2");

    first.emit("data", Buffer.from(LINK_DOWN.slice(0, 30)));
    second.emit("data", Buffer.from(ROUTINE.slice(0, 30)));
    first.emit("data", Buffer.from(`${LINK_DOWN.slice(30)}\n`));
    second.emit("data", Buffer.from(`${ROUTINE.slice(30)}\n`));

    expect(
      receiver.buffer.map((message: SyslogMessage) => {
        return [message.sourceIpAddress, message.raw];
      }),
    ).toEqual([
      ["10.0.0.1", LINK_DOWN],
      ["10.0.0.2", ROUTINE],
    ]);
  });

  it("is closed when what it sends is not syslog, after delivering what was", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    connection.emit("data", Buffer.from(`${LINK_DOWN}\n99999 <34>`));

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
    expect(connection.destroy).toHaveBeenCalledTimes(1);

    // Whatever still arrives before the close takes effect is not read.
    connection.emit("data", Buffer.from(`${ROUTINE}\n`));

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
  });

  it("asks for keep-alive, so a device that was switched off does not hold a connection forever", () => {
    const connection: FakeConnection = connect(SOURCE_IP);

    expect(connection.setKeepAlive).toHaveBeenCalledWith(true, 60000);
  });

  it("reports the address as a device's address is written", () => {
    for (const [remoteAddress, expected] of [
      ["::ffff:10.0.0.7", "10.0.0.7"],
      ["::FFFF:10.0.0.7", "10.0.0.7"],
      ["fe80::1%eth0", "fe80::1"],
      ["2001:db8::5", "2001:db8::5"],
      [" 10.0.0.8 ", "10.0.0.8"],
      // Not an IPv4 address after the prefix: left as it is.
      ["::ffff:abcd", "::ffff:abcd"],
    ] as Array<[string, string]>) {
      resetReceiver();

      const connection: FakeConnection = connect(remoteAddress);

      connection.emit("data", Buffer.from(`${LINK_DOWN}\n`));

      expect(receiver.buffer[0]?.sourceIpAddress).toBe(expected);
    }
  });

  it("with no address (closed before it could be read) is dropped at once", () => {
    for (const remoteAddress of [undefined, "", "   "]) {
      const connection: FakeConnection = connect(remoteAddress);

      expect(connection.destroy).toHaveBeenCalledTimes(1);
      expect(connection.listenerCount("data")).toBe(0);
    }
  });

  it("a reset connection is routine: the error is handled, and other connections carry on", () => {
    jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

    const broken: FakeConnection = connect("10.0.0.1");
    const healthy: FakeConnection = connect("10.0.0.2");

    expect(() => {
      broken.emit("error", new Error("read ECONNRESET"));
    }).not.toThrow();

    healthy.emit("data", Buffer.from(`${LINK_DOWN}\n`));

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
  });

  it("over a real socket: what a device writes is what is buffered", async () => {
    const server: net.Server = net.createServer((socket: net.Socket) => {
      SyslogReceiver.handleConnection(socket);
    });

    await new Promise<void>((resolve: () => void) => {
      // Port 0: whatever port is free, on this machine only.
      server.listen({ port: 0, host: "127.0.0.1" }, resolve);
    });

    try {
      const port: number = (server.address() as net.AddressInfo).port;

      await new Promise<void>(
        (resolve: () => void, reject: (error: Error) => void) => {
          const client: net.Socket = net.createConnection(
            { port: port, host: "127.0.0.1" },
            () => {
              client.write(`${LINK_DOWN}\n`);
              client.write(`${Buffer.byteLength(ROUTINE)} ${ROUTINE}`);
              client.end("<13>the last line, with no line feed");
            },
          );

          client.on("error", reject);
          client.on("close", () => {
            resolve();
          });
        },
      );

      // The server side sees the close a moment after the client does.
      const deadline: number = Date.now() + 5000;

      while (receiver.buffer.length < 3 && Date.now() < deadline) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 10);
        });
      }

      expect(bufferedRawLines()).toEqual([
        LINK_DOWN,
        ROUTINE,
        "<13>the last line, with no line feed",
      ]);
      expect(receiver.buffer[0]!.sourceIpAddress).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});

describe("the rate limit", () => {
  // Read back rather than restated, so the two cannot drift apart.
  const LIMIT: number = PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE;

  beforeEach(() => {
    jest.spyOn(receiver, "flush").mockResolvedValue(undefined);
  });

  function sendRoutine(count: number): void {
    for (let index: number = 0; index < count; index++) {
      receiver.handleLine(
        `<134>Oct 13 10:11:09 core-sw1 dhcpd: DHCPACK on 10.0.0.${index % 250}`,
        SOURCE_IP,
      );
    }
  }

  it("is the one the probe was configured with", () => {
    expect(LIMIT).toBe(20);
  });

  it("forwards everything up to the limit, whatever it is", () => {
    sendRoutine(LIMIT);

    expect(receiver.buffer).toHaveLength(LIMIT);
    expect(receiver.forwardedThisMinute).toBe(LIMIT);
    expect(receiver.droppedThisMinute).toBe(0);
  });

  it("past the limit, drops routine lines and counts them", () => {
    sendRoutine(LIMIT + 7);

    expect(receiver.buffer).toHaveLength(LIMIT);
    expect(receiver.droppedThisMinute).toBe(7);
  });

  it("past the limit, still forwards a line that is a network event: a flood cannot crowd out a link going down", () => {
    sendRoutine(LIMIT * 5);

    expect(receiver.buffer).toHaveLength(LIMIT);

    receiver.handleLine(LINK_DOWN, SOURCE_IP);

    expect(receiver.buffer).toHaveLength(LIMIT + 1);
    expect(receiver.buffer[LIMIT]!.raw).toBe(LINK_DOWN);
    expect(receiver.eventsKeptPastLimitThisMinute).toBe(1);

    // The flood goes on being dropped.
    sendRoutine(10);

    expect(receiver.buffer).toHaveLength(LIMIT + 1);
    expect(receiver.droppedThisMinute).toBe(LIMIT * 4 + 10);
  });

  it("the events of every vendor's format get through, not one vendor's", () => {
    sendRoutine(LIMIT);

    const events: Array<string> = [
      // Sophos Firewall: an IPsec tunnel going down.
      '<30>device_name="SFW" log_id="063411617802" log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" con_name="HQ-Branch1" message="IPSec Connection HQ-Branch1 terminated."',
      // FortiGate: an interface status change.
      '<189>date=2026-10-13 time=10:11:12 devname="FGT60F" logid="0100020099" type="event" subtype="system" level="information" logdesc="Interface status changed" action="interface-stat-change" status="DOWN" msg="Link monitor: Interface wan1 was turned down"',
      // UniFi, relayed by its console in CEF.
      "<12>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIdeviceName=Lobby AP msg=Lobby AP went offline.",
      // RouterOS's default format, with no priority.
      "interface,info ether2 link down",
    ];

    for (const event of events) {
      receiver.handleLine(event, SOURCE_IP);
    }

    expect(bufferedRawLines().slice(LIMIT)).toEqual(events);
  });

  it("events past the limit have an allowance of their own, of the same size: a flapping port cannot flood either", () => {
    sendRoutine(LIMIT);

    for (let index: number = 0; index < LIMIT * 3; index++) {
      receiver.handleLine(LINK_DOWN, SOURCE_IP);
    }

    expect(receiver.buffer).toHaveLength(LIMIT * 2);
    expect(receiver.eventsKeptPastLimitThisMinute).toBe(LIMIT);
    expect(receiver.droppedThisMinute).toBe(LIMIT * 2);
  });

  it("under the limit an event spends an ordinary slot, not the allowance", () => {
    receiver.handleLine(LINK_DOWN, SOURCE_IP);

    expect(receiver.forwardedThisMinute).toBe(1);
    expect(receiver.eventsKeptPastLimitThisMinute).toBe(0);
  });

  it("the window rolls over after a minute, forwarding resumes, and the probe says what it dropped", () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {}) as never);

    sendRoutine(LIMIT + 5);
    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    receiver.minuteWindowStartedAt = Date.now() - 60001;

    sendRoutine(1);

    expect(receiver.forwardedThisMinute).toBe(1);
    expect(receiver.droppedThisMinute).toBe(0);
    expect(receiver.eventsKeptPastLimitThisMinute).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      `Syslog receiver dropped 5 messages in the last minute (rate limit: ${LIMIT}/min); forwarded 1 past the limit because they are network events`,
    );
  });

  it("says nothing when it dropped nothing", () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {}) as never);

    sendRoutine(LIMIT);
    receiver.minuteWindowStartedAt = Date.now() - 60001;
    sendRoutine(1);

    expect(warn).not.toHaveBeenCalled();
  });

  it("when it kept no events past the limit, the warning is the plain one", () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {}) as never);

    sendRoutine(LIMIT + 3);
    receiver.minuteWindowStartedAt = Date.now() - 60001;
    sendRoutine(1);

    expect(warn).toHaveBeenCalledWith(
      `Syslog receiver dropped 3 messages in the last minute (rate limit: ${LIMIT}/min)`,
    );
  });
});

describe("the buffer", () => {
  beforeEach(() => {
    jest.spyOn(receiver, "flush").mockResolvedValue(undefined);
    jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
  });

  function fill(count: number): void {
    for (let index: number = 0; index < count; index++) {
      // The window is kept open so the limit plays no part here.
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(`<13>message ${index}`, SOURCE_IP);
    }
  }

  it("sheds the OLDEST messages once it holds five thousand", () => {
    fill(5003);

    expect(receiver.buffer).toHaveLength(5000);
    expect(receiver.buffer[0]!.message).toBe("message 3");
    expect(receiver.buffer[4999]!.message).toBe("message 5002");
  });

  it("knows how much text it holds, through adding, shedding and flushing", async () => {
    fill(3);

    const expected: number = receiver.buffer.reduce(
      (total: number, message: SyslogMessage) => {
        return total + message.message.length + (message.raw || "").length;
      },
      0,
    );

    expect(expected).toBeGreaterThan(0);
    expect(receiver.bufferedCharacters).toBe(expected);

    jest.restoreAllMocks();
    jest.spyOn(API, "fetch").mockResolvedValue({} as never);

    await receiver.flush();

    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.bufferedCharacters).toBe(0);
  });

  it("sheds the oldest when the text it holds passes its budget, however few messages that is", () => {
    const huge: string = `<13>${"x".repeat(MAX_SYSLOG_RAW_LENGTH - 4)}`;

    // 32 MB of budget; each message holds about 128 KB: its text twice.
    for (let index: number = 0; index < 300; index++) {
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(huge, SOURCE_IP);
    }

    expect(receiver.buffer.length).toBeLessThan(300);
    expect(receiver.buffer.length).toBeGreaterThan(200);
    expect(receiver.bufferedCharacters).toBeLessThanOrEqual(32 * 1024 * 1024);
  });

  it("always keeps the newest message, even one larger than the budget could be", () => {
    receiver.bufferedCharacters = 64 * 1024 * 1024;
    receiver.handleLine(LINK_DOWN, SOURCE_IP);

    expect(bufferedRawLines()).toEqual([LINK_DOWN]);
  });
});

describe("forwarding", () => {
  function mockFetch(): jest.SpyInstance {
    return jest.spyOn(API, "fetch").mockResolvedValue({} as never);
  }

  it("posts the buffered messages to the ingest route, each with its line, and empties the buffer", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    receiver.handleLine("interface,info ether2 link down", "10.0.0.5");

    await receiver.flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = fetchSpy.mock
      .calls[0]?.[0] as unknown as Record<string, unknown>;

    expect(String(call["url"])).toContain("/probe/syslog");

    const sent: Array<Record<string, unknown>> = (
      call["data"] as Record<string, unknown>
    )["syslogMessages"] as Array<Record<string, unknown>>;

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      sourceIpAddress: SOURCE_IP,
      facility: 23,
      severity: 3,
      hostname: "core-sw1",
      raw: LINK_DOWN,
    });
    // An instance older than `raw` still gets what it always read.
    expect(typeof sent[0]!["message"]).toBe("string");
    expect(sent[1]).toMatchObject({
      sourceIpAddress: "10.0.0.5",
      facility: 1,
      severity: 5,
      message: "interface,info ether2 link down",
      raw: "interface,info ether2 link down",
    });
    expect(receiver.buffer).toHaveLength(0);
  });

  it("sends a hundred messages a request", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    receiver.isFlushing = true; // Hold the automatic flush back while filling.

    for (let index: number = 0; index < 250; index++) {
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(`<13>message ${index}`, SOURCE_IP);
    }

    receiver.isFlushing = false;

    await receiver.flush();

    expect(
      fetchSpy.mock.calls.map((call: Array<unknown>) => {
        return (
          (call[0] as Record<string, Record<string, unknown>>)["data"]![
            "syslogMessages"
          ] as Array<unknown>
        ).length;
      }),
    ).toEqual([100, 100, 50]);
  });

  it("starts a forward by itself once a hundred messages are waiting", () => {
    const flush: jest.SpyInstance = jest
      .spyOn(receiver, "flush")
      .mockResolvedValue(undefined);

    for (let index: number = 0; index < 99; index++) {
      receiver.forwardedThisMinute = 0;
      receiver.handleLine(`<13>message ${index}`, SOURCE_IP);
    }

    expect(flush).not.toHaveBeenCalled();

    receiver.forwardedThisMinute = 0;
    receiver.handleLine("<13>the hundredth", SOURCE_IP);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("the shared ingest URL is not mutated by building the route", async () => {
    const before: string = PROBE_INGEST_URL.toString();

    mockFetch();

    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    await receiver.flush();
    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    await receiver.flush();

    /*
     * Route.addRoute mutates in place. Called on the shared global, the
     * second flush would post to ".../probe/syslog/probe/syslog" and every
     * other probe request would be misrouted from then on.
     */
    expect(PROBE_INGEST_URL.toString()).toBe(before);
  });

  it("a failed forward drops its batch rather than re-queueing it", async () => {
    jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockRejectedValue(new Error("ingest unreachable") as never);

    receiver.handleLine(LINK_DOWN, SOURCE_IP);

    await expect(receiver.flush()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Dropped, not re-buffered: a re-queue would grow without bound.
    expect(receiver.buffer).toHaveLength(0);
    expect(receiver.bufferedCharacters).toBe(0);
    // And the receiver is not left wedged.
    expect(receiver.isFlushing).toBe(false);
  });

  it("an empty buffer does not call the ingest endpoint at all", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    await receiver.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a forward already under way is not started twice", async () => {
    const fetchSpy: jest.SpyInstance = mockFetch();

    receiver.handleLine(LINK_DOWN, SOURCE_IP);
    receiver.isFlushing = true;

    await receiver.flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(receiver.buffer).toHaveLength(1);
  });
});
