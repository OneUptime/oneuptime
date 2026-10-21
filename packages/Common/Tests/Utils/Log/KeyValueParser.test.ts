import {
  DEFAULT_KEY_VALUE_DELIMITER,
  MAX_KEY_VALUE_DELIMITER_LENGTH,
  MAX_KEY_VALUE_INPUT_LENGTH,
  MAX_KEY_VALUE_KEY_LENGTH,
  MAX_KEY_VALUE_PAIRS,
  MAX_KEY_VALUE_VALUE_LENGTH,
  ResolvedKeyValueParserOptions,
  parseKeyValuePairs,
  resolveKeyValueParserOptions,
} from "../../../Utils/Log/KeyValueParser";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the key=value parser behind the KeyValueParser
 * log pipeline processor.
 *
 * Firewalls log one event per line as key=value pairs whose fields and
 * order change with the event type, which is exactly what a grok pattern
 * cannot describe. The samples below are the shapes customers actually
 * send: Sophos XGS (current and legacy formats, including SD-WAN SLA
 * lines) and Fortinet FortiGate.
 */

const SOPHOS_IPSEC_LINE: string =
  'device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."';

const SOPHOS_SDWAN_LINE: string =
  'log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"';

const SOPHOS_LEGACY_LINE: string =
  'device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" device_name="XG115w" device_id=C01001K234RXPA1 log_id=010101600001 log_type="Event" log_component="IPSec" log_subtype="System" status="Terminate" priority=Notice connectionname="Tunnel A" connectiontype="1" localinterfaceip="10.1.1.1" message="IPSec Connection Tunnel A terminated"';

const FORTINET_LINE: string =
  'date=2024-01-01 time=10:00:00 devname="FG100" devid="FG100E4Q17000001" logid="0100032001" type="event" subtype="vpn" level="notice" vd="root" action="tunnel-down" tunneltype="ipsec" vpntunnel="HQ-to-Branch2" remip=203.0.113.7 msg="IPsec tunnel down"';

describe("parseKeyValuePairs - real device lines", () => {
  it("parses a Sophos XGS IPsec event, quoted values and all", () => {
    expect(parseKeyValuePairs(SOPHOS_IPSEC_LINE)).toEqual({
      device_name: "SFW",
      timestamp: "2024-05-02T11:03:12+0200",
      device_model: "XGS2100",
      device_serial_id: "X1234",
      log_id: "010101600001",
      log_type: "Event",
      log_component: "IPSec",
      log_subtype: "System",
      severity: "Information",
      con_name: "HQ-Branch1",
      src_ip: "10.171.4.117",
      dst_ip: "10.171.4.118",
      status: "Terminated",
      message:
        "IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.",
    });
  });

  it("parses a Sophos SD-WAN SLA line with unquoted numbers", () => {
    expect(parseKeyValuePairs(SOPHOS_SDWAN_LINE)).toEqual({
      log_id: "158825619025",
      log_type: "SD-WAN",
      log_component: "SLA",
      profile_name: "Branch-Internet",
      gw_name: "WAN2",
      latency: "11",
      jitter: "2",
      packet_loss: "0",
      gw_status: "up",
      sla_status: "SLA met",
    });
  });

  it("parses the legacy Sophos format, where time values carry colons", () => {
    const pairs: Record<string, string> =
      parseKeyValuePairs(SOPHOS_LEGACY_LINE);

    expect(pairs["device"]).toBe("SFW");
    expect(pairs["date"]).toBe("2017-01-31");
    expect(pairs["time"]).toBe("18:02:03");
    expect(pairs["timezone"]).toBe("IST");
    expect(pairs["device_id"]).toBe("C01001K234RXPA1");
    expect(pairs["priority"]).toBe("Notice");
    expect(pairs["connectionname"]).toBe("Tunnel A");
    expect(pairs["message"]).toBe("IPSec Connection Tunnel A terminated");
    expect(Object.keys(pairs)).toHaveLength(16);
  });

  it("parses a Fortinet FortiGate event line", () => {
    expect(parseKeyValuePairs(FORTINET_LINE)).toEqual({
      date: "2024-01-01",
      time: "10:00:00",
      devname: "FG100",
      devid: "FG100E4Q17000001",
      logid: "0100032001",
      type: "event",
      subtype: "vpn",
      level: "notice",
      vd: "root",
      action: "tunnel-down",
      tunneltype: "ipsec",
      vpntunnel: "HQ-to-Branch2",
      remip: "203.0.113.7",
      msg: "IPsec tunnel down",
    });
  });

  it("keeps the pairs in the order the line has them", () => {
    expect(Object.keys(parseKeyValuePairs("z=1 a=2 m=3"))).toEqual([
      "z",
      "a",
      "m",
    ]);
  });

  it("gives the same pairs whatever order the fields arrive in", () => {
    expect(
      parseKeyValuePairs('status="Terminated" con_name="HQ-Branch1"'),
    ).toEqual(parseKeyValuePairs('con_name="HQ-Branch1" status="Terminated"'));
  });
});

describe("parseKeyValuePairs - values", () => {
  it("keeps every value a string, numbers included", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      "latency=11 ratio=0.5 ok=true",
    );

    expect(pairs).toEqual({ latency: "11", ratio: "0.5", ok: "true" });

    for (const value of Object.values(pairs)) {
      expect(typeof value).toBe("string");
    }
  });

  it("keeps whitespace and delimiters inside a quoted value", () => {
    expect(
      parseKeyValuePairs('message="a=b c=d, e" next=1', {
        pairDelimiter: undefined,
      }),
    ).toEqual({ message: "a=b c=d, e", next: "1" });
  });

  it("unescapes an escaped quote inside a quoted value", () => {
    expect(parseKeyValuePairs('msg="say \\"hi\\" twice" n=2')).toEqual({
      msg: 'say "hi" twice',
      n: "2",
    });
  });

  it("unescapes an escaped backslash, and keeps any other backslash", () => {
    expect(
      parseKeyValuePairs('path="C:\\Users\\admin" esc="a\\\\b" n=1'),
    ).toEqual({
      path: "C:\\Users\\admin",
      esc: "a\\b",
      n: "1",
    });
  });

  it("accepts single-quoted values", () => {
    expect(parseKeyValuePairs("name='John Smith' role='it''s' x=1")).toEqual({
      name: "John Smith",
      role: "it",
      x: "1",
    });
  });

  it("keeps the other quote character inside a quoted value", () => {
    expect(parseKeyValuePairs(`user="o'brien" note='say "hi"'`)).toEqual({
      user: "o'brien",
      note: 'say "hi"',
    });
  });

  it("runs an unterminated quote to the end of the line", () => {
    // A syslog line cut off by a datagram size limit, mid-message.
    expect(
      parseKeyValuePairs('con_name="HQ-Branch1" message="IPSec Connection HQ'),
    ).toEqual({
      con_name: "HQ-Branch1",
      message: "IPSec Connection HQ",
    });
  });

  it("gives `key=` an empty value, at the end of the line and before another pair", () => {
    expect(parseKeyValuePairs("user= action=login reason=")).toEqual({
      user: "",
      action: "login",
      reason: "",
    });
  });

  it('gives `key=""` an empty value', () => {
    expect(parseKeyValuePairs('user="" action=login')).toEqual({
      user: "",
      action: "login",
    });
  });

  it("keeps an `=` that is part of an unquoted value", () => {
    expect(
      parseKeyValuePairs("url=https://example.com/?a=b&c=d status=200"),
    ).toEqual({
      url: "https://example.com/?a=b&c=d",
      status: "200",
    });
  });

  it("keeps a quote that is not at the start of an unquoted value", () => {
    expect(parseKeyValuePairs('a=b"c d=1')).toEqual({ a: 'b"c', d: "1" });
  });

  it("ignores anything glued to a closing quote", () => {
    expect(parseKeyValuePairs('a="x"junk b=2')).toEqual({ a: "x", b: "2" });
  });

  it("treats tabs and newlines as whitespace between pairs", () => {
    expect(parseKeyValuePairs("a=1\tb=2\nc=3\r\nd=4")).toEqual({
      a: "1",
      b: "2",
      c: "3",
      d: "4",
    });
  });
});

describe("parseKeyValuePairs - keys", () => {
  it("accepts keys with dots, dashes, underscores and @", () => {
    expect(
      parseKeyValuePairs(
        "http.status=200 user-agent=curl _private=1 x@y=2 sd-wan.gw_name=WAN2",
      ),
    ).toEqual({
      "http.status": "200",
      "user-agent": "curl",
      _private: "1",
      "x@y": "2",
      "sd-wan.gw_name": "WAN2",
    });
  });

  it("keeps the FIRST value of a key that repeats", () => {
    expect(
      parseKeyValuePairs('con_name="first" status=up con_name="second"'),
    ).toEqual({ con_name: "first", status: "up" });
  });

  it("skips a key that does not start with a letter or underscore", () => {
    expect(parseKeyValuePairs("1st=a -x=b ok=c")).toEqual({ ok: "c" });
  });

  it("never treats __proto__ as a key", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      "__proto__=polluted constructor=x a=1",
    );

    expect(Object.keys(pairs)).toEqual(["constructor", "a"]);
    expect(Object.getPrototypeOf(pairs)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("skips a key longer than the key ceiling, and keeps one at it", () => {
    const atLimit: string = `k${"x".repeat(MAX_KEY_VALUE_KEY_LENGTH - 1)}`;
    const overLimit: string = `k${"x".repeat(MAX_KEY_VALUE_KEY_LENGTH)}`;

    expect(
      parseKeyValuePairs(`${overLimit}=too-long ${atLimit}=fits a=1`),
    ).toEqual({
      [atLimit]: "fits",
      a: "1",
    });
  });
});

describe("parseKeyValuePairs - text that is not a pair", () => {
  it("skips an RFC 3164 header in front of the first pair", () => {
    expect(
      parseKeyValuePairs(
        '<134>Jan 31 18:02:03 SFW sophos[123]: device_name="SFW" con_name="HQ-Branch1"',
      ),
    ).toEqual({ device_name: "SFW", con_name: "HQ-Branch1" });
  });

  it("recovers a key with a syslog priority glued to its front", () => {
    expect(parseKeyValuePairs('<30>device_name="SFW" log_id=1')).toEqual({
      device_name: "SFW",
      log_id: "1",
    });
  });

  it("recovers a key with a tag glued to its front", () => {
    expect(parseKeyValuePairs("kernel:action=drop proto=tcp")).toEqual({
      action: "drop",
      proto: "tcp",
    });
  });

  it("skips stray words between pairs without losing the pairs around them", () => {
    expect(parseKeyValuePairs("a=1 hello world b=2 = c=3")).toEqual({
      a: "1",
      b: "2",
      c: "3",
    });
  });

  it("returns nothing for a line with no pairs", () => {
    expect(parseKeyValuePairs("just a plain sentence")).toEqual({});
    expect(parseKeyValuePairs("   ")).toEqual({});
    expect(parseKeyValuePairs("")).toEqual({});
  });

  it("does not split on spaces around the delimiter in whitespace mode", () => {
    expect(parseKeyValuePairs("a = b c=d")).toEqual({ c: "d" });
  });

  it("returns nothing for input that is not a string", () => {
    expect(parseKeyValuePairs(undefined as unknown as string)).toEqual({});
    expect(parseKeyValuePairs(42 as unknown as string)).toEqual({});
  });
});

describe("parseKeyValuePairs - ceilings on hostile input", () => {
  it(`returns at most ${MAX_KEY_VALUE_PAIRS} pairs, the first ones`, () => {
    const line: string = Array.from(
      { length: 250 },
      (_: unknown, i: number) => {
        return `k${i}=${i}`;
      },
    ).join(" ");

    const pairs: Record<string, string> = parseKeyValuePairs(line);

    expect(Object.keys(pairs)).toHaveLength(MAX_KEY_VALUE_PAIRS);
    expect(pairs["k0"]).toBe("0");
    expect(pairs[`k${MAX_KEY_VALUE_PAIRS - 1}`]).toBe(
      String(MAX_KEY_VALUE_PAIRS - 1),
    );
    expect(pairs[`k${MAX_KEY_VALUE_PAIRS}`]).toBeUndefined();
  });

  it("does not count repeated or invalid keys against the pair ceiling", () => {
    const repeats: string = Array.from({ length: 300 }, () => {
      return "dup=1 9bad=2";
    }).join(" ");

    expect(parseKeyValuePairs(`${repeats} last=yes`)).toEqual({
      dup: "1",
      last: "yes",
    });
  });

  it("truncates a value over the value ceiling", () => {
    const long: string = "v".repeat(MAX_KEY_VALUE_VALUE_LENGTH + 500);

    const pairs: Record<string, string> = parseKeyValuePairs(
      `big="${long}" small=1`,
    );

    expect(pairs["big"]).toHaveLength(MAX_KEY_VALUE_VALUE_LENGTH);
    expect(pairs["small"]).toBe("1");
  });

  it("never truncates in the middle of a surrogate pair", () => {
    const value: string = `${"v".repeat(MAX_KEY_VALUE_VALUE_LENGTH - 1)}😀tail`;

    const truncated: string = parseKeyValuePairs(`emoji=${value}`)["emoji"]!;

    expect(truncated).toHaveLength(MAX_KEY_VALUE_VALUE_LENGTH - 1);
    expect(truncated.endsWith("v")).toBe(true);
  });

  it("does not parse input over the input ceiling at all", () => {
    const line: string = `status=500 ${"x".repeat(MAX_KEY_VALUE_INPUT_LENGTH)}`;

    expect(parseKeyValuePairs(line)).toEqual({});
  });

  it("parses input exactly at the input ceiling", () => {
    const prefix: string = "status=500 pad=";
    const line: string = `${prefix}${"x".repeat(
      MAX_KEY_VALUE_INPUT_LENGTH - prefix.length,
    )}`;

    expect(line).toHaveLength(MAX_KEY_VALUE_INPUT_LENGTH);
    expect(parseKeyValuePairs(line)["status"]).toBe("500");
  });

  it("stays linear on a pathological line", () => {
    const line: string = `${'a="'.repeat(10000)}`.slice(
      0,
      MAX_KEY_VALUE_INPUT_LENGTH,
    );

    const startedAt: number = Date.now();
    parseKeyValuePairs(line);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("parseKeyValuePairs - configured delimiters", () => {
  it("splits on a configured pair delimiter and trims the padding", () => {
    expect(
      parseKeyValuePairs("a=1, b = 2 ,c=three words", { pairDelimiter: "," }),
    ).toEqual({ a: "1", b: "2", c: "three words" });
  });

  it("keeps a configured pair delimiter inside quotes", () => {
    expect(parseKeyValuePairs('a="x,y", b=2', { pairDelimiter: "," })).toEqual({
      a: "x,y",
      b: "2",
    });
  });

  it("supports a multi-character pair delimiter", () => {
    expect(
      parseKeyValuePairs("a=1 | b=two words | c=3", { pairDelimiter: " | " }),
    ).toEqual({ a: "1", b: "two words", c: "3" });
  });

  it("supports a configured key-value delimiter", () => {
    expect(
      parseKeyValuePairs('status:up time:10:00:00 name:"a b"', {
        keyValueDelimiter: ":",
      }),
    ).toEqual({ status: "up", time: "10:00:00", name: "a b" });
  });

  it("supports a multi-character key-value delimiter", () => {
    expect(
      parseKeyValuePairs("a=>1;b=>2", {
        pairDelimiter: ";",
        keyValueDelimiter: "=>",
      }),
    ).toEqual({ a: "1", b: "2" });
  });

  it("recovers a key behind free text when a pair delimiter is configured", () => {
    expect(
      parseKeyValuePairs("Jan 31 host app: a=1, b=2", { pairDelimiter: "," }),
    ).toEqual({ a: "1", b: "2" });
  });

  it("accepts options that were already resolved", () => {
    const resolved: ResolvedKeyValueParserOptions =
      resolveKeyValueParserOptions({ pairDelimiter: ";" });

    expect(parseKeyValuePairs("a=1;b=2", resolved)).toEqual({
      a: "1",
      b: "2",
    });
  });
});

describe("resolveKeyValueParserOptions", () => {
  it("defaults to whitespace between pairs and = between key and value", () => {
    expect(resolveKeyValueParserOptions()).toEqual({
      pairDelimiter: null,
      keyValueDelimiter: DEFAULT_KEY_VALUE_DELIMITER,
    });
    expect(
      resolveKeyValueParserOptions({
        pairDelimiter: null,
        keyValueDelimiter: undefined,
      }),
    ).toEqual({ pairDelimiter: null, keyValueDelimiter: "=" });
  });

  it("keeps configured delimiters exactly as written", () => {
    expect(
      resolveKeyValueParserOptions({
        pairDelimiter: " | ",
        keyValueDelimiter: ":",
      }),
    ).toEqual({ pairDelimiter: " | ", keyValueDelimiter: ":" });
  });

  it("rejects an empty delimiter", () => {
    expect(() => {
      return resolveKeyValueParserOptions({ pairDelimiter: "" });
    }).toThrow("Pair delimiter cannot be empty.");

    expect(() => {
      return resolveKeyValueParserOptions({ keyValueDelimiter: "" });
    }).toThrow("Key-value delimiter cannot be empty.");
  });

  it("rejects identical pair and key-value delimiters", () => {
    expect(() => {
      return resolveKeyValueParserOptions({ pairDelimiter: "=" });
    }).toThrow("Pair delimiter and key-value delimiter must be different.");

    expect(() => {
      return resolveKeyValueParserOptions({
        pairDelimiter: ":",
        keyValueDelimiter: ":",
      });
    }).toThrow(BadDataException);
  });

  it("rejects delimiters that contain one another", () => {
    for (const options of [
      { pairDelimiter: "==", keyValueDelimiter: "=" },
      { pairDelimiter: ",", keyValueDelimiter: ",=" },
    ]) {
      expect(() => {
        return resolveKeyValueParserOptions(options);
      }).toThrow(
        "Pair delimiter and key-value delimiter cannot contain one another.",
      );
    }
  });

  it("rejects an all-whitespace key-value delimiter", () => {
    expect(() => {
      return resolveKeyValueParserOptions({ keyValueDelimiter: " " });
    }).toThrow(BadDataException);
  });

  it("rejects delimiters with quotes or backslashes", () => {
    for (const delimiter of ['"', "'", "\\", 'a"b']) {
      expect(() => {
        return resolveKeyValueParserOptions({ pairDelimiter: delimiter });
      }).toThrow(BadDataException);

      expect(() => {
        return resolveKeyValueParserOptions({ keyValueDelimiter: delimiter });
      }).toThrow(BadDataException);
    }
  });

  it("rejects a delimiter over the length ceiling", () => {
    expect(() => {
      return resolveKeyValueParserOptions({
        pairDelimiter: ",".repeat(MAX_KEY_VALUE_DELIMITER_LENGTH + 1),
      });
    }).toThrow(BadDataException);

    expect(() => {
      return resolveKeyValueParserOptions({
        pairDelimiter: ",".repeat(MAX_KEY_VALUE_DELIMITER_LENGTH),
      });
    }).not.toThrow();
  });

  it("rejects a delimiter that is not text", () => {
    expect(() => {
      return resolveKeyValueParserOptions({
        pairDelimiter: 7 as unknown as string,
      });
    }).toThrow("Pair delimiter must be text.");
  });

  it("is what parseKeyValuePairs enforces too", () => {
    expect(() => {
      return parseKeyValuePairs("a=1", { pairDelimiter: "=" });
    }).toThrow(BadDataException);
  });
});
