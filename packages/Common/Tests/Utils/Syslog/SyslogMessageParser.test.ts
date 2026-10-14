import {
  ParsedSyslogMessage,
  SyslogHeaderFormat,
  getSyslogHeaderFormat,
  parseSyslogMessage,
  sanitizeSyslogAttributeKey,
} from "../../../Utils/Syslog/SyslogMessageParser";
import { describe, expect, it } from "@jest/globals";

/*
 * The syslog header reader, on the shapes network devices send that
 * neither RFC describes. The two RFCs' own shapes are pinned where the
 * reader used to live (App/Tests/Telemetry/SyslogParser.test.ts, which
 * still runs against this module); this suite holds what the reader
 * learnt when it started reading for vendor parsers too:
 *
 *   - a line with no host name, where the tag stands in its place;
 *   - a CEF message, which is not a tag named "CEF";
 *   - `content`: everything after the header, tag included, because many
 *     vendors' own format starts where a tag would be;
 *   - a year at the start of a line is not an RFC 5424 version.
 */

function parse(raw: string): ParsedSyslogMessage {
  const parsed: ParsedSyslogMessage | null = parseSyslogMessage(raw);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(raw)} to parse`);
  }

  return parsed;
}

describe("a line with no host name", () => {
  it("reads the word that ends in a colon as the tag, and no host", () => {
    // ExtremeXOS: a syslog target sends no host name by default.
    const parsed: ParsedSyslogMessage = parse(
      "<134>Oct 13 10:11:12 vlan: <Info> Port 1:12 link down",
    );

    expect(parsed.hostname).toBeUndefined();
    expect(parsed.appName).toBe("vlan");
    expect(parsed.message).toBe("<Info> Port 1:12 link down");
    expect(parsed.timestamp).toBeInstanceOf(Date);
    expect(parsed.priority).toBe(134);
  });

  it("reads a process id out of that tag", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<38>Oct 13 10:11:12 sshd[4321]: Failed password for root from 192.0.2.10 port 51234 ssh2",
    );

    expect(parsed.hostname).toBeUndefined();
    expect(parsed.appName).toBe("sshd");
    expect(parsed.procId).toBe("4321");
    expect(parsed.message).toBe(
      "Failed password for root from 192.0.2.10 port 51234 ssh2",
    );
  });

  it("still reads a real host name, and the tag after it", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<134>Oct 13 10:11:12 sw-core-1 vlan: <Info> Port 1:12 link down",
    );

    expect(parsed.hostname).toBe("sw-core-1");
    expect(parsed.appName).toBe("vlan");
    expect(parsed.message).toBe("<Info> Port 1:12 link down");
  });

  it("an address is a host name: IPv4, and IPv6 with its colons inside", () => {
    expect(parse("<14>Jan  7 20:22:55 10.1.1.5 ports: port 3").hostname).toBe(
      "10.1.1.5",
    );
    expect(
      parse("<14>Jan  7 20:22:55 2001:db8::1 ports: port 3").hostname,
    ).toBe("2001:db8::1");
    expect(parse("<14>Jan  7 20:22:55 fe80::1 ports: port 3").appName).toBe(
      "ports",
    );
  });

  it("a key=value pair after the timestamp is not a tag", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<30>Jan 31 18:02:03 fw-branch device="SFW" date=2017-01-31 log_type="Event"',
    );

    expect(parsed.hostname).toBe("fw-branch");
    expect(parsed.appName).toBeUndefined();
    expect(parsed.message).toBe(
      'device="SFW" date=2017-01-31 log_type="Event"',
    );
  });
});

describe("a CEF message behind a syslog header", () => {
  const CEF: string =
    "CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik msg=login failure";

  it("is the message, after the host name", () => {
    const parsed: ParsedSyslogMessage = parse(
      `Oct  2 17:36:35 MikroTik ${CEF}`,
    );

    expect(parsed.hostname).toBe("MikroTik");
    expect(parsed.appName).toBeUndefined();
    expect(parsed.message).toBe(CEF);
    expect(parsed.content).toBeUndefined();
  });

  it("is the message when there is no host name either", () => {
    const parsed: ParsedSyslogMessage = parse(`<134>Oct  2 17:36:35 ${CEF}`);

    expect(parsed.hostname).toBeUndefined();
    expect(parsed.appName).toBeUndefined();
    expect(parsed.message).toBe(CEF);
  });

  it("is the message with a priority and nothing else in front", () => {
    const parsed: ParsedSyslogMessage = parse(`<134>${CEF}`);

    expect(parsed.priority).toBe(134);
    expect(parsed.hostname).toBeUndefined();
    expect(parsed.message).toBe(CEF);
  });

  it("keeps the spaces inside the CEF header as written", () => {
    const spaced: string =
      "CEF:0|Ubiquiti|UniFi  Network|9.3.33|544|Admin  Accessed|1|msg=two  spaces";

    expect(parse(`<134>Oct  2 17:36:35 ${spaced}`).message).toBe(spaced);
  });

  it("a tag that merely starts with the letters CEF is still a tag", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<134>Oct  2 17:36:35 host CEFd: started",
    );

    expect(parsed.appName).toBe("CEFd");
    expect(parsed.message).toBe("started");
  });
});

describe("content: everything after the header", () => {
  it("keeps the tag a vendor's format starts with", () => {
    // AOS-Switch: an event number where a tag would be.
    const parsed: ParsedSyslogMessage = parse(
      "<14>Jan  7 20:22:55 10.1.1.5 00076 ports: port 3 is now on-line",
    );

    expect(parsed.appName).toBe("00076");
    expect(parsed.message).toBe("ports: port 3 is now on-line");
    expect(parsed.content).toBe("00076 ports: port 3 is now on-line");
  });

  it("keeps a tag with its colon and process id", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<38>Oct 13 10:11:12 ap-lobby sshd[4321]: Failed password for root",
    );

    expect(parsed.message).toBe("Failed password for root");
    expect(parsed.content).toBe("sshd[4321]: Failed password for root");
  });

  it("keeps the first word of a message that has no tag at all", () => {
    // RouterOS, syslog format: the entry with no topics and no tag.
    const parsed: ParsedSyslogMessage = parse(
      "<27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh",
    );

    expect(parsed.appName).toBe("login");
    expect(parsed.content).toBe(
      "login failure for user guest from 192.168.88.17 via ssh",
    );
  });

  it("keeps the tag of a line with no host name", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<134>Oct 13 10:11:12 vlan: <Info> Port 1:12 link down",
    );

    expect(parsed.content).toBe("vlan: <Info> Port 1:12 link down");
  });

  it("is left out when it would only repeat the message", () => {
    expect(
      parse('<30>Jan 31 18:02:03 fw device="SFW" log_type="Event"').content,
    ).toBeUndefined();
    expect(parse("<13>disk almost full").content).toBeUndefined();
    expect(
      parse("<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 - 502")
        .content,
    ).toBeUndefined();
  });
});

describe("what is, and is not, an RFC 5424 version", () => {
  it("reads version 1", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 - 502 on /api/login",
    );

    expect(parsed.version).toBe(1);
    expect(parsed.hostname).toBe("web-01");
    expect(parsed.message).toBe("502 on /api/login");
  });

  it("reads versions of up to three digits", () => {
    expect(parse("<34>12 - h a p m - text").version).toBe(12);
    expect(parse("<34>999 - h a p m - text").version).toBe(999);
  });

  it("does not take a year for a version", () => {
    // NX-OS writes the year first.
    const line: string =
      "2026 Oct 13 10:11:12 nexus1 %ETHPORT-5-IF_UP: Interface Ethernet1/1 is up in mode trunk";
    const parsed: ParsedSyslogMessage = parse(`<189>${line}`);

    expect(parsed.version).toBeUndefined();
    expect(parsed.msgId).toBeUndefined();
    // Nothing of the line went into header fields it does not have.
    expect(parsed.message).toBe(line);
  });

  it("does not take 0, or a number starting with 0, for a version", () => {
    expect(parse("<34>0 - h a p m - text").version).toBeUndefined();
    expect(parse("<34>01 - h a p m - text").version).toBeUndefined();
  });
});

describe("getSyslogHeaderFormat", () => {
  it("names the header each line came with", () => {
    expect(
      getSyslogHeaderFormat(
        parse("<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 - text"),
      ),
    ).toBe(SyslogHeaderFormat.Rfc5424);
    expect(
      getSyslogHeaderFormat(parse("<13>Feb  5 17:32:18 db-01 postgres: up")),
    ).toBe(SyslogHeaderFormat.Rfc3164);
    expect(
      getSyslogHeaderFormat(parse("<134>Oct 13 10:11:12 vlan: <Info> text")),
    ).toBe(SyslogHeaderFormat.Rfc3164);
    expect(getSyslogHeaderFormat(parse("<13>disk almost full"))).toBe(
      SyslogHeaderFormat.None,
    );
    expect(
      getSyslogHeaderFormat(
        parse("system,info,account user admin logged in from 10.1.1.1 via ssh"),
      ),
    ).toBe(SyslogHeaderFormat.None);
  });

  it("an RFC 5424 line with nil fields is still RFC 5424", () => {
    expect(getSyslogHeaderFormat(parse("<34>1 - - - - - - text"))).toBe(
      SyslogHeaderFormat.Rfc5424,
    );
  });
});

describe("sanitizeSyslogAttributeKey", () => {
  it("keeps letters, digits, dots, underscores and hyphens, and replaces the rest", () => {
    expect(sanitizeSyslogAttributeKey("env@32473")).toBe("env_32473");
    expect(sanitizeSyslogAttributeKey("a.b_c-d9")).toBe("a.b_c-d9");
    expect(sanitizeSyslogAttributeKey("with space/slash")).toBe(
      "with_space_slash",
    );
  });
});
