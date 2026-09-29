import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "../../../Utils/Monitor/MonitorDestinationUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * What the dashboard's destination field does with what somebody typed.
 *
 * This exists because of a customer who had working monitors on their IPv4
 * BGP endpoints, added the IPv6 ones, and could not get them to work
 * Their test address, used verbatim throughout this file, was
 * 2001:518:2800:9::2.
 *
 * The failure was not that IPv6 was rejected. It was that an IPv6 address
 * with a trailing space — which is what copying one out of a looking glass,
 * a router config or a terminal gives you — was SILENTLY TRUNCATED to
 * "2001:518" and saved, with no error shown. The identical IPv4 paste worked,
 * because "1.1.1.1 " has no colon to split on.
 *
 * Every "the customer's address" case below failed before the fix.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

function parse(
  value: string,
  monitorType: MonitorType,
): ParsedMonitorDestination {
  return MonitorDestinationUtil.parse({
    value: value,
    monitorType: monitorType,
  });
}

const HOST_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.IP,
  MonitorType.Ping,
  MonitorType.Port,
];

describe("MonitorDestinationUtil.parse — the customer's IPv6 BGP endpoint", () => {
  for (const monitorType of HOST_MONITOR_TYPES) {
    describe(`${monitorType} monitor`, () => {
      test("keeps the address exactly as typed", () => {
        const parsed: ParsedMonitorDestination = parse(
          CUSTOMER_ADDRESS,
          monitorType,
        );

        expect(parsed.error).toBeNull();
        expect(parsed.destination).toBeInstanceOf(IP);
        expect(parsed.destination?.toString()).toBe(CUSTOMER_ADDRESS);
      });

      test("a trailing space does not truncate it to its first two groups", () => {
        /*
         * THE BUG. "2001:518:2800:9::2 " missed IP.isIP (which does not
         * trim), fell through to Hostname.fromString, and came back as host
         * "2001" with port 518. 518 is a legal port, so nothing threw and
         * the operator was shown no error at all.
         */
        const parsed: ParsedMonitorDestination = parse(
          `${CUSTOMER_ADDRESS} `,
          monitorType,
        );

        expect(parsed.error).toBeNull();
        expect(parsed.destination?.toString()).toBe(CUSTOMER_ADDRESS);
        expect(parsed.destination?.toString()).not.toBe("2001:518");
      });

      test("a leading space or a trailing newline is tolerated the same way", () => {
        expect(
          parse(` ${CUSTOMER_ADDRESS}`, monitorType).destination?.toString(),
        ).toBe(CUSTOMER_ADDRESS);
        expect(
          parse(`${CUSTOMER_ADDRESS}\n`, monitorType).destination?.toString(),
        ).toBe(CUSTOMER_ADDRESS);
      });

      test("the bracketed spelling is accepted and stored bare", () => {
        /*
         * "[2001:518:2800:9::2]" is how the address is written inside a URL,
         * so it is a form people have to hand. It used to produce the
         * baffling "Hostname [2001 is not in valid format." on Ping/Port.
         */
        const parsed: ParsedMonitorDestination = parse(
          `[${CUSTOMER_ADDRESS}]`,
          monitorType,
        );

        expect(parsed.error).toBeNull();
        expect(parsed.destination?.toString()).toBe(CUSTOMER_ADDRESS);
      });

      test("the equivalent IPv4 paste keeps behaving exactly as it always did", () => {
        expect(parse("192.0.2.1", monitorType).destination?.toString()).toBe(
          "192.0.2.1",
        );
        expect(parse("192.0.2.1 ", monitorType).destination?.toString()).toBe(
          "192.0.2.1",
        );
      });

      test("an address that is genuinely malformed is reported, not stored", () => {
        const parsed: ParsedMonitorDestination = parse(
          "2001:518:2800:9:::2",
          monitorType,
        );

        expect(parsed.destination).toBeUndefined();
        expect(parsed.error).toBeTruthy();
      });

      test("an empty field is a missing destination, not a parse failure", () => {
        expect(parse("   ", monitorType)).toEqual({
          destination: undefined,
          error: "Destination is required",
        });
      });
    });
  }

  describe("every prefix of the address as it is typed", () => {
    /*
     * Typing left to right passes through "2001:518:2800:9::", which IS a
     * real address. The form used to write each parse into the step and
     * never clear it, so a prefix that parsed could outlive the keystrokes
     * after it. What matters here is that no prefix EVER parses to something
     * that is not what was typed.
     */
    test("a prefix either fails to parse or parses to itself — never to something else", () => {
      for (let i: number = 1; i <= CUSTOMER_ADDRESS.length; i++) {
        const prefix: string = CUSTOMER_ADDRESS.substring(0, i);

        for (const monitorType of HOST_MONITOR_TYPES) {
          const parsed: ParsedMonitorDestination = parse(prefix, monitorType);

          if (parsed.destination) {
            expect(parsed.destination.toString()).toBe(prefix);
          }
        }
      }
    });

    test("the COMPLETE address never parses to 2001:518, however it is spelled", () => {
      /*
       * "2001:518" on its own is a legitimate parse of the prefix "2001:518"
       * — the operator really had typed only that. What must never happen is
       * the complete address arriving and 2001:518 being what gets stored.
       */
      const spellings: Array<string> = [
        CUSTOMER_ADDRESS,
        `${CUSTOMER_ADDRESS} `,
        ` ${CUSTOMER_ADDRESS}`,
        `${CUSTOMER_ADDRESS}\n`,
        `\t${CUSTOMER_ADDRESS}\t`,
        `[${CUSTOMER_ADDRESS}]`,
        ` [${CUSTOMER_ADDRESS}] `,
      ];

      for (const spelling of spellings) {
        for (const monitorType of HOST_MONITOR_TYPES) {
          expect(parse(spelling, monitorType).destination?.toString()).toBe(
            CUSTOMER_ADDRESS,
          );
        }
      }
    });
  });
});

describe("MonitorDestinationUtil.parse — hostnames still work", () => {
  test("a DNS name is a Hostname", () => {
    const parsed: ParsedMonitorDestination = parse(
      "rs1.example.net",
      MonitorType.Ping,
    );

    expect(parsed.error).toBeNull();
    expect(parsed.destination).toBeInstanceOf(Hostname);
    expect(parsed.destination?.toString()).toBe("rs1.example.net");
  });

  test("a pasted 'host:port' is split, not stored as a host with a colon in its name", () => {
    /*
     * `new Hostname("rs1.example.net:179")` would happily store the whole
     * authority AS THE HOST, and the socket would then go looking for a DNS
     * name with a colon in it.
     */
    const parsed: ParsedMonitorDestination = parse(
      "rs1.example.net:179",
      MonitorType.Port,
    );

    expect(parsed.error).toBeNull();
    expect((parsed.destination as Hostname).hostname).toBe("rs1.example.net");
    expect((parsed.destination as Hostname).port?.toNumber()).toBe(179);
  });

  test("a bracketed IPv6 host WITH a port is split the same way", () => {
    const parsed: ParsedMonitorDestination = parse(
      `[${CUSTOMER_ADDRESS}]:179`,
      MonitorType.Port,
    );

    expect(parsed.error).toBeNull();
    expect((parsed.destination as Hostname).port?.toNumber()).toBe(179);
  });

  test("an IP monitor rejects a DNS name, as it always has", () => {
    expect(
      parse("rs1.example.net", MonitorType.IP).destination,
    ).toBeUndefined();
  });
});

describe("MonitorDestinationUtil.parse — URL monitor types", () => {
  const URL_MONITOR_TYPES: Array<MonitorType> = [
    MonitorType.Website,
    MonitorType.API,
    MonitorType.SSLCertificate,
  ];

  for (const monitorType of URL_MONITOR_TYPES) {
    test(`${monitorType}: a bracketed IPv6 URL round-trips`, () => {
      const parsed: ParsedMonitorDestination = parse(
        `https://[${CUSTOMER_ADDRESS}]/health`,
        monitorType,
      );

      expect(parsed.error).toBeNull();
      expect(parsed.destination).toBeInstanceOf(URL);
      expect(parsed.destination?.toString()).toBe(
        `https://[${CUSTOMER_ADDRESS}]/health`,
      );
    });

    test(`${monitorType}: a BARE IPv6 URL is bracketed rather than stored unusable`, () => {
      /*
       * "https://2001:518:2800:9::2/" is not a URL — the first colon reads
       * as the port separator, and every HTTP client rejects it. The field
       * used to accept it verbatim and the monitor then failed forever.
       */
      const parsed: ParsedMonitorDestination = parse(
        `https://${CUSTOMER_ADDRESS}/`,
        monitorType,
      );

      expect(parsed.error).toBeNull();
      expect(parsed.destination?.toString()).toBe(
        `https://[${CUSTOMER_ADDRESS}]/`,
      );
    });

    test(`${monitorType}: an IPv4 or DNS URL is left byte for byte alone`, () => {
      expect(
        parse(
          "https://example.com:8443/x?y=1",
          monitorType,
        ).destination?.toString(),
      ).toBe("https://example.com:8443/x?y=1");
      expect(
        parse("https://192.0.2.1/health", monitorType).destination?.toString(),
      ).toBe("https://192.0.2.1/health");
    });
  }
});

describe("MonitorDestinationUtil.toUrlWithBracketedIpv6Host", () => {
  const bracket: (value: string) => string = (value: string): string => {
    return MonitorDestinationUtil.toUrlWithBracketedIpv6Host(value);
  };

  test("brackets a bare IPv6 host", () => {
    expect(bracket(`https://${CUSTOMER_ADDRESS}`)).toBe(
      `https://[${CUSTOMER_ADDRESS}]`,
    );
  });

  test("keeps the path, query and fragment where they were", () => {
    expect(bracket(`https://${CUSTOMER_ADDRESS}/a/b?c=1#d`)).toBe(
      `https://[${CUSTOMER_ADDRESS}]/a/b?c=1#d`,
    );
  });

  test("does not bracket twice", () => {
    expect(bracket(`https://[${CUSTOMER_ADDRESS}]/a`)).toBe(
      `https://[${CUSTOMER_ADDRESS}]/a`,
    );
  });

  test("keeps userinfo outside the brackets", () => {
    expect(bracket(`https://user:token@${CUSTOMER_ADDRESS}/a`)).toBe(
      `https://user:token@[${CUSTOMER_ADDRESS}]/a`,
    );
  });

  test("leaves a DNS or IPv4 URL untouched", () => {
    expect(bracket("https://example.com:8443/x")).toBe(
      "https://example.com:8443/x",
    );
    expect(bracket("http://192.0.2.1/x")).toBe("http://192.0.2.1/x");
  });

  test("leaves a host:port that only looks address-ish untouched", () => {
    expect(bracket("https://localhost:3000")).toBe("https://localhost:3000");
  });
});
