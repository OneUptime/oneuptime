import {
  ParsedSyslogMessage,
  parseSyslogMessage,
} from "../../FeatureSet/Telemetry/Utils/SyslogParser";

/*
 * The syslog parser reads bytes that arrived over UDP from a device nobody in
 * this codebase controls - a router, a firewall, an appliance whose vendor
 * left the RFC half-implemented a decade ago. Everything it produces is
 * either indexed, filtered on, or shown to an operator, so the parser has
 * exactly two obligations and they pull against each other:
 *
 *   NEVER LOSE THE LINE. There is no such thing as a syslog datagram worth
 *   dropping. Whatever cannot be understood still has to come back with its
 *   text intact in `message`, because an operator staring at a device that
 *   just fell over would rather read a malformed line than not know it
 *   arrived.
 *
 *   NEVER INVENT A FIELD. A hostname or an appName that the sender did not
 *   actually supply is worse than a blank one: it is indexed, it is filtered
 *   on, and it silently attributes one machine's logs to another. The nil
 *   value "-" is the RFC's way of saying "I have nothing here", and it must
 *   become undefined rather than the literal string.
 *
 * Everything below is a real wire shape. RFC 5424 is the modern format;
 * RFC 3164 is what most hardware still emits; the third case is neither, and
 * is the one a device produces when its clock, its hostname or its patience
 * has run out.
 */

type ParseFunction = (raw: string) => ParsedSyslogMessage;

const parse: ParseFunction = (raw: string): ParsedSyslogMessage => {
  const parsed: ParsedSyslogMessage | null = parseSyslogMessage(raw);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(raw)} to parse`);
  }

  return parsed;
};

describe("nothing at all", () => {
  test("an empty string is not a message", () => {
    expect(parseSyslogMessage("")).toBeNull();
  });

  test("whitespace alone is not a message", () => {
    expect(parseSyslogMessage("   \n\t ")).toBeNull();
  });
});

describe("the priority field, and the facility and severity inside it", () => {
  /*
   * PRI is a single number that packs two fields: severity is the low three
   * bits, facility is the rest. Every alerting rule a customer writes on
   * severity depends on this arithmetic being right, and getting it backwards
   * produces plausible-looking numbers rather than an error.
   */
  test("decodes <34> as facility 4, severity 2", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2003-10-11T22:14:15.003Z mymachine.example.com su - ID47 - failed",
    );

    expect(parsed.priority).toBe(34);
    expect(parsed.facility).toBe(4);
    expect(parsed.severity).toBe(2);
  });

  test("decodes <0> as facility 0, severity 0 - the emergency kernel message", () => {
    const parsed: ParsedSyslogMessage = parse("<0>kernel panic");

    expect(parsed.priority).toBe(0);
    expect(parsed.facility).toBe(0);
    expect(parsed.severity).toBe(0);
  });

  test("decodes <191>, the largest single-byte priority", () => {
    const parsed: ParsedSyslogMessage = parse("<191>local7 debug line");

    expect(parsed.facility).toBe(23);
    expect(parsed.severity).toBe(7);
  });

  test("decodes <13>, the user-notice a logger(1) call produces", () => {
    const parsed: ParsedSyslogMessage = parse("<13>hello from logger");

    expect(parsed.facility).toBe(1);
    expect(parsed.severity).toBe(5);
  });

  test("leaves priority undefined when the line does not carry one", () => {
    const parsed: ParsedSyslogMessage = parse("just a bare line");

    expect(parsed.priority).toBeUndefined();
    expect(parsed.severity).toBeUndefined();
    expect(parsed.facility).toBeUndefined();
  });

  /*
   * A PRI of more than three digits is not a PRI. Consuming it anyway would
   * eat the start of the message.
   */
  test("does not treat a four-digit bracket as a priority", () => {
    const parsed: ParsedSyslogMessage = parse("<1234>something happened");

    expect(parsed.priority).toBeUndefined();
    expect(parsed.message).toBe("<1234>something happened");
  });

  test("does not treat a non-numeric bracket as a priority", () => {
    const parsed: ParsedSyslogMessage = parse("<abc>something happened");

    expect(parsed.priority).toBeUndefined();
    expect(parsed.message).toBe("<abc>something happened");
  });
});

describe("RFC 5424 - the modern format", () => {
  const RFC5424_LINE: string =
    "<34>1 2003-10-11T22:14:15.003Z mymachine.example.com su - ID47 - BOM'su root' failed for lonvick";

  test("reads every header field off the canonical RFC example", () => {
    const parsed: ParsedSyslogMessage = parse(RFC5424_LINE);

    expect(parsed.version).toBe(1);
    expect(parsed.hostname).toBe("mymachine.example.com");
    expect(parsed.appName).toBe("su");
    expect(parsed.msgId).toBe("ID47");
  });

  test("parses the timestamp as a real instant", () => {
    const parsed: ParsedSyslogMessage = parse(RFC5424_LINE);

    expect(parsed.timestamp?.toISOString()).toBe("2003-10-11T22:14:15.003Z");
  });

  /*
   * The RFC's own example prefixes the message with the literal "BOM" to
   * denote a byte order mark. Devices send both the literal and the real
   * U+FEFF, and neither belongs in the indexed text.
   */
  test("strips the RFC's literal BOM marker from the message", () => {
    expect(parse(RFC5424_LINE).message).toBe("'su root' failed for lonvick");
  });

  test("strips a real U+FEFF byte order mark too", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2003-10-11T22:14:15.003Z host app - - - ﻿real bom here",
    );

    expect(parsed.message).toBe("real bom here");
  });

  test("keeps a word that merely starts with the letters BOM", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2003-10-11T22:14:15.003Z host app - - - bomb disposal complete",
    );

    expect(parsed.message).toBe("bomb disposal complete");
  });

  /*
   * "-" is the RFC's nil value. Turning it into the literal string would
   * index a hostname of "-" and attribute logs to a machine that does not
   * exist.
   */
  test("reads the nil value as absent, not as the string '-'", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 - - - - - - message with nothing else",
    );

    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.hostname).toBeUndefined();
    expect(parsed.appName).toBeUndefined();
    expect(parsed.procId).toBeUndefined();
    expect(parsed.msgId).toBeUndefined();
    expect(parsed.message).toBe("message with nothing else");
  });

  test("reads a process id when the sender supplies one", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<165>1 2023-01-01T00:00:00Z host evntslog 8710 ID47 - line",
    );

    expect(parsed.procId).toBe("8710");
  });

  test("leaves the timestamp undefined when it cannot be parsed", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 not-a-timestamp host app - - - line",
    );

    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.message).toBe("line");
  });

  test("keeps the whole original line in raw", () => {
    expect(parse(RFC5424_LINE).raw).toBe(RFC5424_LINE);
  });

  test("a message may itself be empty", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2023-01-01T00:00:00Z host app - - -",
    );

    expect(parsed.message).toBe("");
    expect(parsed.hostname).toBe("host");
  });

  test("a multi-word message survives intact", () => {
    expect(
      parse("<34>1 2023-01-01T00:00:00Z host app - - - a b   c").message,
    ).toBe("a b   c");
  });
});

/*
 * Structured-data IDs and parameter keys become ATTRIBUTE NAMES on an indexed
 * record, so sanitizeKey folds everything outside [A-Za-z0-9_.-] to an
 * underscore. The RFC's own SD-IDs carry an "@" before the enterprise number,
 * so "exampleSDID@32473" is stored as "exampleSDID_32473". The raw text is
 * kept verbatim alongside it, which is where the exact original still lives.
 */
describe("RFC 5424 structured data", () => {
  test("reads one element and its parameters", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z mymachine.example.com evntslog - ID47 [exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"] an application event',
    );

    expect(parsed.structuredData).toEqual({
      exampleSDID_32473: {
        iut: "3",
        eventSource: "Application",
        eventID: "1011",
      },
    });
    expect(parsed.message).toBe("an application event");
  });

  test("reads several elements in one line", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host evntslog - ID47 [a@1 x="1"][b@2 y="2"] after',
    );

    expect(parsed.structuredData).toEqual({
      a_1: { x: "1" },
      b_2: { y: "2" },
    });
    expect(parsed.message).toBe("after");
  });

  test("reads elements separated by a space", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host evntslog - ID47 [a@1 x="1"] [b@2 y="2"] after',
    );

    expect(Object.keys(parsed.structuredData ?? {}).sort()).toEqual([
      "a_1",
      "b_2",
    ]);
    expect(parsed.message).toBe("after");
  });

  test("keeps the raw structured data alongside the parsed form", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host evntslog - ID47 [a@1 x="1"] after',
    );

    // Verbatim, "@" included - the sanitising happens only to the parsed keys.
    expect(parsed.structuredDataRaw).toBe('[a@1 x="1"]');
  });

  /*
   * A bracket inside a quoted VALUE must not be mistaken for the end of the
   * element - splitting there would cut the message in half and leave half of
   * it filed as structured data.
   */
  test("a bracket inside a quoted value does not end the element", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 note="see [here]"] the message',
    );

    expect(parsed.message).toBe("the message");
    expect(parsed.structuredData?.["a_1"]?.["note"]).toBe("see [here]");
  });

  test("no structured data when the field is the nil value", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>1 2023-01-01T00:00:00Z host app - - - plain message",
    );

    expect(parsed.structuredData).toBeUndefined();
    expect(parsed.structuredDataRaw).toBeUndefined();
    expect(parsed.message).toBe("plain message");
  });

  test("an element with no parameters still registers", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<165>1 2003-10-11T22:14:15.003Z host app - - [origin] after",
    );

    expect(parsed.structuredData).toEqual({ origin: {} });
    expect(parsed.message).toBe("after");
  });

  test("an empty parameter value is kept as an empty string", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 x=""] after',
    );

    expect(parsed.structuredData?.["a_1"]?.["x"]).toBe("");
  });

  /*
   * Keys become attribute names on an indexed record, so anything outside the
   * safe set is folded to an underscore rather than passed through.
   */
  test("sanitises a parameter key that carries unsafe characters", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 my$key="v"] after',
    );

    expect(parsed.structuredData?.["a_1"]?.["my_key"]).toBe("v");
  });

  test("an unterminated element is still kept rather than dropped", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 x="1" and then nothing',
    );

    expect(parsed.structuredDataRaw).toContain("[a@1");
  });
});

describe("RFC 3164 - what most hardware still sends", () => {
  test("reads the timestamp, hostname, app and message", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick",
    );

    expect(parsed.hostname).toBe("mymachine");
    expect(parsed.appName).toBe("su");
    expect(parsed.message).toBe("'su root' failed for lonvick");
    expect(parsed.timestamp).toBeInstanceOf(Date);
  });

  test("reads a process id out of the tag", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 web01 sshd[1234]: Accepted publickey for root",
    );

    expect(parsed.appName).toBe("sshd");
    expect(parsed.procId).toBe("1234");
    expect(parsed.message).toBe("Accepted publickey for root");
  });

  /*
   * The RFC pads a single-digit day to two columns with a space. A parser
   * that splits on whitespace naively reads the day as the hostname.
   */
  test("handles the space-padded single-digit day", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct  1 22:14:15 mymachine su: message here",
    );

    expect(parsed.hostname).toBe("mymachine");
    expect(parsed.appName).toBe("su");
    expect(parsed.message).toBe("message here");
  });

  test("handles a tag with no colon after it", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 mymachine kernel out of memory",
    );

    expect(parsed.appName).toBe("kernel");
    expect(parsed.message).toBe("out of memory");
  });

  test("handles a bracketed tag with no colon after it", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 mymachine cron[99] running job",
    );

    expect(parsed.appName).toBe("cron");
    expect(parsed.procId).toBe("99");
    expect(parsed.message).toBe("running job");
  });

  test("carries the priority through alongside the 3164 header", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 mymachine su: failed",
    );

    expect(parsed.facility).toBe(4);
    expect(parsed.severity).toBe(2);
  });

  test("a 3164 line has no version - that field belongs to 5424", () => {
    expect(
      parse("<34>Oct 11 22:14:15 mymachine su: failed").version,
    ).toBeUndefined();
  });

  test("a colon inside the message does not become a second tag", () => {
    const parsed: ParsedSyslogMessage = parse(
      "<34>Oct 11 22:14:15 host app: connect failed: timeout",
    );

    expect(parsed.appName).toBe("app");
    expect(parsed.message).toBe("connect failed: timeout");
  });
});

describe("a line that is neither format is still delivered", () => {
  test("a bare sentence comes back as the message", () => {
    const parsed: ParsedSyslogMessage = parse("something went wrong");

    expect(parsed.message).toBe("something went wrong");
    expect(parsed.hostname).toBeUndefined();
    expect(parsed.appName).toBeUndefined();
  });

  test("a priority with an unstructured body keeps both", () => {
    const parsed: ParsedSyslogMessage = parse("<13>totally freeform text");

    expect(parsed.severity).toBe(5);
    expect(parsed.message).toBe("totally freeform text");
  });

  /*
   * A device that truncates the header mid-way is not a device whose logs may
   * be discarded. The tokeniser pads the missing fields, so the timestamp that
   * DID arrive is still read and the record still comes back - with an empty
   * message rather than no record at all.
   */
  test("a 5424 line that stops after the timestamp still yields a record", () => {
    const parsed: ParsedSyslogMessage = parse("<34>1 2023-01-01T00:00:00Z");

    expect(parsed.timestamp?.toISOString()).toBe("2023-01-01T00:00:00.000Z");
    expect(parsed.message).toBe("");
    expect(parsed.hostname).toBeUndefined();
    expect(parsed.raw).toBe("<34>1 2023-01-01T00:00:00Z");
  });

  test("leading and trailing whitespace is trimmed off raw", () => {
    expect(parse("   hello   ").raw).toBe("hello");
  });

  test("no input ever produces an undefined message", () => {
    const lines: Array<string> = [
      "<34>",
      "<34>1",
      "<34>1 ",
      "[not structured data]",
      "Oct 11 22:14:15",
      "<165>1 2003-10-11T22:14:15.003Z host app - - [",
      "﻿",
    ];

    for (const line of lines) {
      const parsed: ParsedSyslogMessage | null = parseSyslogMessage(line);

      if (parsed) {
        expect(typeof parsed.message).toBe("string");
      }
    }
  });
});
