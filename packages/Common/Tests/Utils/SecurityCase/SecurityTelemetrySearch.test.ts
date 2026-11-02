import {
  SECURITY_TELEMETRY_MAX_LISTED,
  SECURITY_TELEMETRY_MAX_VALUES,
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SECURITY_TELEMETRY_SIGNALS,
  SecurityTelemetrySignal,
} from "../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import { MAX_URL_LENGTH } from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  RE2_CASE_INSENSITIVE_FLAG,
  RESOURCE_ATTRIBUTE_PREFIX,
  SECURITY_TELEMETRY_MIN_VALUE_LENGTH,
  SecurityTelemetrySearch,
  SecurityTelemetryValueShape,
  getShortIpv6Address,
  getTelemetryAttributeSpellings,
  getTelemetryMessageNeedles,
  getTelemetryMessagePattern,
  getTelemetryMessageSearchText,
  getTelemetryPlaces,
  getTelemetrySearchValues,
  getTelemetryValueShape,
  isFileHashLike,
  isFullHostName,
  isResourceAttributeKey,
  isTelemetrySearchText,
} from "../../../Utils/SecurityCase/SecurityTelemetrySearch";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Which values a case, an event or an entity names are searched for in the
 * project's logs and traces, and how a log line's message and an
 * attribute's value are held to them: the pure rules behind "In your logs
 * and traces" (Server/Utils/SecurityEvent/Connections/
 * SecurityTelemetryMentions runs them in ClickHouse).
 *
 * The message pattern runs in ClickHouse's RE2. Its syntax here - (?i), a
 * class, an alternation, ^ and $ - is also JavaScript's, so the tests hold
 * it to real lines through a RegExp of the same pattern, the flag passed as
 * JavaScript passes it. App's SecurityTelemetryMentionsClickhouse runs the
 * same patterns in a real ClickHouse.
 */

function entity(type: SecurityEntityType, value: string): SecurityEntity {
  return { type, value };
}

// Whether a message names a value, as the read's pattern decides it.
function namedBy(
  value: string,
  shape: SecurityTelemetryValueShape,
  message: string,
): boolean {
  const pattern: string = getTelemetryMessagePattern(value, shape);

  expect(pattern.startsWith(RE2_CASE_INSENSITIVE_FLAG)).toBe(true);

  return new RegExp(pattern.slice(RE2_CASE_INSENSITIVE_FLAG.length), "i").test(
    message,
  );
}

describe("which text is ever searched for", () => {
  test("printable ASCII without white space, from the shortest searched for to a URL's longest", () => {
    expect(isTelemetrySearchText("10.0.0.1")).toBe(true);
    expect(isTelemetrySearchText("a".repeat(MAX_URL_LENGTH))).toBe(true);
    expect(isTelemetrySearchText("a".repeat(MAX_URL_LENGTH + 1))).toBe(false);
    expect(
      isTelemetrySearchText("a".repeat(SECURITY_TELEMETRY_MIN_VALUE_LENGTH)),
    ).toBe(true);
    expect(
      isTelemetrySearchText(
        "a".repeat(SECURITY_TELEMETRY_MIN_VALUE_LENGTH - 1),
      ),
    ).toBe(false);
    expect(isTelemetrySearchText("web 1.acme.example")).toBe(false);
    expect(isTelemetrySearchText("tab\there.example")).toBe(false);
    expect(isTelemetrySearchText("jörg@acme.example")).toBe(false);
    expect(isTelemetrySearchText("evil\u0000.example")).toBe(false);
    expect(isTelemetrySearchText("")).toBe(false);
    expect(isTelemetrySearchText(undefined)).toBe(false);
    expect(isTelemetrySearchText(null)).toBe(false);
  });

  test("a file hash: an MD5, a SHA-1, a SHA-256 or a SHA-512 digest, in hex and nothing else", () => {
    for (const length of [32, 40, 64, 128]) {
      expect(isFileHashLike("a".repeat(length))).toBe(true);
      expect(isFileHashLike("A0".repeat(length / 2))).toBe(true);
    }

    expect(isFileHashLike("a".repeat(33))).toBe(false);
    expect(isFileHashLike("a".repeat(63))).toBe(false);
    expect(isFileHashLike(`${"a".repeat(63)}g`)).toBe(false);
    expect(isFileHashLike("")).toBe(false);
  });

  test("a full host or domain name: a dot, and a last label of two characters holding a letter", () => {
    expect(isFullHostName("web-1.acme.example")).toBe(true);
    expect(isFullHostName("evil.io")).toBe(true);
    expect(isFullHostName("web-1.prod")).toBe(true);
    expect(isFullHostName("api.v2")).toBe(true);
    // A bare name, a version, a one-letter last label, an address.
    expect(isFullHostName("web-1")).toBe(false);
    expect(isFullHostName("2.4.1")).toBe(false);
    expect(isFullHostName("host.a")).toBe(false);
    expect(isFullHostName("10.0.0.1")).toBe(false);
    expect(isFullHostName("evil..example")).toBe(false);
    expect(isFullHostName(".example")).toBe(false);
  });
});

describe("the shape a value is searched for as", () => {
  test("an address every machine has names nothing; any other address is searched for", () => {
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.IpAddress, "203.0.113.7")),
    ).toBe(SecurityTelemetryValueShape.Ipv4Address);
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.IpAddress, "10.0.3.17")),
    ).toBe(SecurityTelemetryValueShape.Ipv4Address);
    // An address typed as something else is still an address.
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.Other, "198.51.100.4")),
    ).toBe(SecurityTelemetryValueShape.Ipv4Address);
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.IpAddress, "2001:db8::7")),
    ).toBe(SecurityTelemetryValueShape.Ipv6Address);

    for (const local of [
      "127.0.0.1",
      "0.0.0.0",
      "169.254.10.1",
      "255.255.255.255",
      "::1",
      "fe80::1",
    ]) {
      expect(
        getTelemetryValueShape(entity(SecurityEntityType.IpAddress, local)),
      ).toBeNull();
    }
  });

  test("a URL by its text, unless it is on a local address or on localhost", () => {
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Url, "https://evil.example/payload.sh"),
      ),
    ).toBe(SecurityTelemetryValueShape.Url);
    // Written with a scheme and a host, whatever it is typed as.
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Other, "http://203.0.113.7:8080/x"),
      ),
    ).toBe(SecurityTelemetryValueShape.Url);
    // Typed as a URL without a scheme: its text is all there is.
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Url, "evil.example/payload.sh"),
      ),
    ).toBe(SecurityTelemetryValueShape.Url);

    for (const local of [
      "http://127.0.0.1/admin",
      "http://localhost:3000/",
      "http://api.localhost/x",
      "http://[::1]/",
    ]) {
      expect(
        getTelemetryValueShape(entity(SecurityEntityType.Url, local)),
      ).toBeNull();
    }
  });

  test("an email, as a user or untyped; a user's bare name is never searched for", () => {
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.User, "k.morgan@acme.example"),
      ),
    ).toBe(SecurityTelemetryValueShape.Email);
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Other, "k.morgan@acme.example"),
      ),
    ).toBe(SecurityTelemetryValueShape.Email);

    for (const name of ["root", "kmorgan", "ACME\\kmorgan", "deploy.user"]) {
      expect(
        getTelemetryValueShape(entity(SecurityEntityType.User, name)),
      ).toBeNull();
    }
  });

  test("a cloud resource's ID and a file's hash, whatever they are typed as", () => {
    for (const id of [
      "arn:aws:s3:::acme-backups",
      "arn:aws:iam::123456789012:user/k.morgan",
      "/subscriptions/1111/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-1",
      "//compute.googleapis.com/projects/acme/zones/us-east1-b/instances/web-1",
    ]) {
      expect(
        getTelemetryValueShape(entity(SecurityEntityType.Other, id)),
      ).toBe(SecurityTelemetryValueShape.ResourceId);
    }

    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.FileHash, "d41d8cd98f00b204e9800998ecf8427e"),
      ),
    ).toBe(SecurityTelemetryValueShape.Hash);
    expect(
      getTelemetryValueShape(
        entity(
          SecurityEntityType.Other,
          "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
        ),
      ),
    ).toBe(SecurityTelemetryValueShape.Hash);
  });

  test("a full host or domain name as a host, a domain or untyped; a bare name is left to its record", () => {
    for (const type of [
      SecurityEntityType.Host,
      SecurityEntityType.Domain,
      SecurityEntityType.Other,
    ]) {
      expect(
        getTelemetryValueShape(entity(type, "evil-c2.example.net")),
      ).toBe(SecurityTelemetryValueShape.Name);
    }

    for (const bare of ["web-1", "WEB-1", "prod", "fin-ws-112"]) {
      expect(
        getTelemetryValueShape(entity(SecurityEntityType.Host, bare)),
      ).toBeNull();
    }

    // A version is no name.
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.Other, "2.4.1")),
    ).toBeNull();
  });

  test("a process, a data store and anything a log line could hold for any reason are never searched for", () => {
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Process, "powershell.exe"),
      ),
    ).toBeNull();
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Process, "C:\\Windows\\System32\\cmd.exe"),
      ),
    ).toBeNull();
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.DataStore, "data-store:s3:acme-backups"),
      ),
    ).toBeNull();
    expect(
      getTelemetryValueShape(entity(SecurityEntityType.Other, "production")),
    ).toBeNull();
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Other, "two words.example"),
      ),
    ).toBeNull();
    expect(
      getTelemetryValueShape(
        entity(SecurityEntityType.Other, "jörg@acme.example"),
      ),
    ).toBeNull();
    expect(
      getTelemetryValueShape({
        type: SecurityEntityType.Other,
        value: undefined as unknown as string,
      }),
    ).toBeNull();
    expect(getTelemetryValueShape(null as unknown as SecurityEntity)).toBeNull();
  });

  test("a long outside value costs no more than its length: 400,000 characters read in a moment", () => {
    const read: FastestRun<SecurityTelemetrySearch> = fastestRun({
      run: (): SecurityTelemetrySearch => {
        // A text of its own each attempt, so every attempt reads it again.
        const long: string = `${"a.".repeat(200000)}example`;

        return getTelemetrySearchValues([
          entity(SecurityEntityType.Domain, long),
          entity(SecurityEntityType.Url, `https://${long}/`),
          entity(SecurityEntityType.Other, `${"0".repeat(400000)}`),
        ]);
      },
      limitInMs: 2000,
    });

    expect(read.result.values).toEqual([]);
    // A length check before any loop over the characters.
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("IPv6 addresses in their short form", () => {
  test("the longest run of two or more zero groups, the first of equal ones, is ::", () => {
    expect(getShortIpv6Address("2001:db8:0:0:0:0:0:7")).toBe("2001:db8::7");
    expect(getShortIpv6Address("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(getShortIpv6Address("1:0:0:0:0:0:0:0")).toBe("1::");
    expect(getShortIpv6Address("2001:db8:0:0:1:0:0:1")).toBe(
      "2001:db8::1:0:0:1",
    );
    expect(getShortIpv6Address("2001:0:0:1:0:0:0:1")).toBe("2001:0:0:1::1");
    // One zero group alone is written as it is.
    expect(getShortIpv6Address("2001:db8:0:1:1:1:1:1")).toBe(
      "2001:db8:0:1:1:1:1:1",
    );
    // Anything that is not eight groups is handed back.
    expect(getShortIpv6Address("2001:db8::7")).toBe("2001:db8::7");
  });
});

describe("the spellings an attribute's value is compared with", () => {
  test("an address as written and in its one spelling; an IPv6 address in lower case and its short form", () => {
    expect(
      getTelemetryAttributeSpellings(
        "203.0.113.7",
        SecurityTelemetryValueShape.Ipv4Address,
      ),
    ).toEqual(["203.0.113.7"]);
    expect(
      getTelemetryAttributeSpellings(
        "2001:0DB8:0:0:0:0:0:7",
        SecurityTelemetryValueShape.Ipv6Address,
      ),
    ).toEqual(["2001:0DB8:0:0:0:0:0:7", "2001:0db8:0:0:0:0:0:7", "2001:db8::7"]);
  });

  test("a name and a hash as written, in lower and in upper case; an email, a URL and an ID as written and in lower case", () => {
    expect(
      getTelemetryAttributeSpellings(
        "Web-1.Acme.Example",
        SecurityTelemetryValueShape.Name,
      ),
    ).toEqual(["Web-1.Acme.Example", "web-1.acme.example", "WEB-1.ACME.EXAMPLE"]);
    expect(
      getTelemetryAttributeSpellings(
        "d41d8cd98f00b204e9800998ecf8427e",
        SecurityTelemetryValueShape.Hash,
      ),
    ).toEqual([
      "d41d8cd98f00b204e9800998ecf8427e",
      "D41D8CD98F00B204E9800998ECF8427E",
    ]);
    expect(
      getTelemetryAttributeSpellings(
        "K.Morgan@Acme.Example",
        SecurityTelemetryValueShape.Email,
      ),
    ).toEqual(["K.Morgan@Acme.Example", "k.morgan@acme.example"]);
    expect(
      getTelemetryAttributeSpellings(
        "https://evil.example/a",
        SecurityTelemetryValueShape.Url,
      ),
    ).toEqual(["https://evil.example/a"]);
  });

  test("what a message is first read for: each spelling once, in lower case", () => {
    expect(
      getTelemetryMessageNeedles(
        "Web-1.Acme.Example",
        SecurityTelemetryValueShape.Name,
      ),
    ).toEqual(["web-1.acme.example"]);
    expect(
      getTelemetryMessageNeedles(
        "2001:0DB8:0:0:0:0:0:7",
        SecurityTelemetryValueShape.Ipv6Address,
      ),
    ).toEqual(["2001:0db8:0:0:0:0:0:7", "2001:db8::7"]);
  });
});

describe("a log line's message names a value whole", () => {
  test("an IPv4 address: never as part of a longer number or address", () => {
    const shape: SecurityTelemetryValueShape =
      SecurityTelemetryValueShape.Ipv4Address;

    for (const message of [
      "10.0.0.1",
      "Accepted publickey for deploy from 10.0.0.1 port 52144 ssh2",
      "connect to 10.0.0.1:443 failed",
      "peer=10.0.0.1,",
      "[10.0.0.1]",
      "Blocked 10.0.0.1.",
      "::ffff:10.0.0.1",
      "\"client\":\"10.0.0.1\"",
    ]) {
      expect(namedBy("10.0.0.1", shape, message)).toBe(true);
    }

    for (const message of [
      "10.0.0.12",
      "from 10.0.0.100 port 22",
      "110.0.0.1",
      "version 1.10.0.0.1",
      "10.0.0.1.5",
      "ip10.0.0.1",
      "10.0.0.1a",
      "10-0-0-1",
    ]) {
      expect(namedBy("10.0.0.1", shape, message)).toBe(false);
    }
  });

  test("a dot in the value is a dot, not any character", () => {
    expect(
      namedBy(
        "10.0.0.1",
        SecurityTelemetryValueShape.Ipv4Address,
        "10a0b0c1 and 10x0x0x1",
      ),
    ).toBe(false);
  });

  test("a full name: in a URL or an email too, never inside a longer name", () => {
    const shape: SecurityTelemetryValueShape = SecurityTelemetryValueShape.Name;

    for (const message of [
      "query evil.example A",
      "GET https://evil.example/x HTTP/1.1",
      "mail from bob@evil.example",
      "resolved EVIL.EXAMPLE.",
      "host=evil.example:8443",
    ]) {
      expect(namedBy("evil.example", shape, message)).toBe(true);
    }

    for (const message of [
      "evil.example.net",
      "sub.evil.example",
      "my-evil.example",
      "evil.examples",
      "evil_example",
    ]) {
      expect(namedBy("evil.example", shape, message)).toBe(false);
    }
  });

  test("an email: never a longer address or one of another domain", () => {
    const shape: SecurityTelemetryValueShape =
      SecurityTelemetryValueShape.Email;

    expect(
      namedBy(
        "k.morgan@acme.example",
        shape,
        "Login failed for <K.Morgan@acme.example>",
      ),
    ).toBe(true);
    expect(
      namedBy("k.morgan@acme.example", shape, "user=xk.morgan@acme.example"),
    ).toBe(false);
    expect(
      namedBy("k.morgan@acme.example", shape, "k.morgan@acme.example.org"),
    ).toBe(false);
  });

  test("a URL: as written, its characters literal; one ending in / is named by every URL under it", () => {
    const shape: SecurityTelemetryValueShape = SecurityTelemetryValueShape.Url;

    expect(
      namedBy(
        "https://evil.example/a",
        shape,
        "GET https://evil.example/a?x=1",
      ),
    ).toBe(true);
    expect(
      namedBy("https://evil.example/a", shape, "GET https://evil.example/ab"),
    ).toBe(false);
    expect(
      namedBy(
        "https://evil.example/",
        shape,
        "GET https://evil.example/payload.sh",
      ),
    ).toBe(true);

    // ? ( ) + [ ] are the URL's own characters, not a pattern's.
    const url: string = "https://evil.example/a?b=(1)+[2]";

    expect(namedBy(url, shape, `fetched ${url} ok`)).toBe(true);
    expect(namedBy(url, shape, "fetched https://evil.example/ab=1+2 ok")).toBe(
      false,
    );
    expect(namedBy(url, shape, "fetched https://evil.example/b=1)+2 ok")).toBe(
      false,
    );
  });

  test("an IPv6 address: in either spelling, never inside a longer address", () => {
    const shape: SecurityTelemetryValueShape =
      SecurityTelemetryValueShape.Ipv6Address;

    expect(namedBy("2001:db8::7", shape, "from [2001:db8::7]:443")).toBe(true);
    expect(namedBy("2001:db8::7", shape, "peer 2001:DB8::7 closed")).toBe(true);
    // The case wrote it in full; the line in its short form.
    expect(
      namedBy("2001:0db8:0:0:0:0:0:7", shape, "peer 2001:db8::7 closed"),
    ).toBe(true);
    expect(namedBy("2001:db8::7", shape, "peer 2001:db8::70")).toBe(false);
    expect(namedBy("2001:db8::7", shape, "peer 2001:db8::7:1")).toBe(false);
    expect(namedBy("2001:db8::7", shape, "peer 12001:db8::7")).toBe(false);
  });

  test("a hash: never inside a longer hex string", () => {
    const hash: string = "d41d8cd98f00b204e9800998ecf8427e";
    const shape: SecurityTelemetryValueShape = SecurityTelemetryValueShape.Hash;

    expect(namedBy(hash, shape, `md5=${hash}`)).toBe(true);
    expect(namedBy(hash, shape, `${hash.toUpperCase()} quarantined`)).toBe(
      true,
    );
    expect(namedBy(hash, shape, `${hash}00`)).toBe(false);
    expect(namedBy(hash, shape, `ff${hash}`)).toBe(false);
  });

  test("the pattern is built from the value alone, escaped, whatever case it is written in", () => {
    expect(
      getTelemetryMessagePattern(
        "Evil.Example",
        SecurityTelemetryValueShape.Name,
      ),
    ).toBe(
      "(?i)(?:^|[^0-9A-Za-z_.-])(?:evil\\.example)(?:$|[^0-9A-Za-z_.-]|\\.(?:$|[^0-9A-Za-z_-]))",
    );
    // A URL that ends in "/" has no edge after it.
    expect(
      getTelemetryMessagePattern(
        "https://evil.example/",
        SecurityTelemetryValueShape.Url,
      ),
    ).toBe("(?i)(?:^|[^0-9A-Za-z_.-])(?:https://evil\\.example/)");
  });
});

describe("the values searched for", () => {
  test("in the order named, each once whatever its case or spelling, the ones never searched for left out", () => {
    const search: SecurityTelemetrySearch = getTelemetrySearchValues([
      entity(SecurityEntityType.Host, "web-1"),
      entity(SecurityEntityType.IpAddress, "203.0.113.7"),
      entity(SecurityEntityType.User, "root"),
      entity(SecurityEntityType.User, " k.morgan@acme.example "),
      entity(SecurityEntityType.Other, "K.MORGAN@ACME.EXAMPLE"),
      entity(SecurityEntityType.IpAddress, "2001:db8::7"),
      entity(SecurityEntityType.IpAddress, "2001:DB8:0:0:0:0:0:7"),
      entity(SecurityEntityType.Domain, "evil-c2.example.net"),
      entity(SecurityEntityType.Process, "powershell.exe"),
    ]);

    expect(
      search.values.map((value: { entity: SecurityEntity }): string => {
        return value.entity.value;
      }),
    ).toEqual([
      "203.0.113.7",
      "k.morgan@acme.example",
      "2001:db8::7",
      "evil-c2.example.net",
    ]);
    expect(
      search.values.map(
        (value: { shape: SecurityTelemetryValueShape }): string => {
          return value.shape;
        },
      ),
    ).toEqual([
      SecurityTelemetryValueShape.Ipv4Address,
      SecurityTelemetryValueShape.Email,
      SecurityTelemetryValueShape.Ipv6Address,
      SecurityTelemetryValueShape.Name,
    ]);
    expect(search.hasMoreValues).toBe(false);

    // Each value carries its needles, its pattern and its spellings.
    expect(search.values[1]).toEqual({
      entity: { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
      shape: SecurityTelemetryValueShape.Email,
      needles: ["k.morgan@acme.example"],
      messagePattern: getTelemetryMessagePattern(
        "k.morgan@acme.example",
        SecurityTelemetryValueShape.Email,
      ),
      spellings: ["k.morgan@acme.example"],
    });
  });

  test(`at most ${SECURITY_TELEMETRY_MAX_VALUES}, and it says when it names more`, () => {
    const addresses: Array<SecurityEntity> = [];

    for (let index: number = 1; index <= SECURITY_TELEMETRY_MAX_VALUES; index++) {
      addresses.push(entity(SecurityEntityType.IpAddress, `203.0.113.${index}`));
    }

    const exactly: SecurityTelemetrySearch = getTelemetrySearchValues(addresses);

    expect(exactly.values.length).toBe(SECURITY_TELEMETRY_MAX_VALUES);
    expect(exactly.hasMoreValues).toBe(false);

    // A duplicate of one already searched for is no more.
    expect(
      getTelemetrySearchValues([
        ...addresses,
        entity(SecurityEntityType.Other, "203.0.113.1"),
      ]).hasMoreValues,
    ).toBe(false);

    // Nor is one never searched for.
    expect(
      getTelemetrySearchValues([
        ...addresses,
        entity(SecurityEntityType.User, "root"),
      ]).hasMoreValues,
    ).toBe(false);

    const more: SecurityTelemetrySearch = getTelemetrySearchValues([
      ...addresses,
      entity(SecurityEntityType.Domain, "evil.example"),
    ]);

    expect(more.values.length).toBe(SECURITY_TELEMETRY_MAX_VALUES);
    expect(more.hasMoreValues).toBe(true);
  });

  test("nothing to search for: no values, and nothing more", () => {
    expect(getTelemetrySearchValues([])).toEqual({
      values: [],
      hasMoreValues: false,
    });
    expect(
      getTelemetrySearchValues([
        entity(SecurityEntityType.Host, "web-1"),
        entity(SecurityEntityType.User, "root"),
        entity(SecurityEntityType.IpAddress, "127.0.0.1"),
      ]),
    ).toEqual({ values: [], hasMoreValues: false });
  });
});

describe("where in the lines or spans it was", () => {
  test("the most first; of equal counts the message, then the keys by name; at most a few", () => {
    expect(
      getTelemetryPlaces({
        messageCount: 84,
        attributeKeys: [
          { key: "net.peer.ip", count: 12, value: "203.0.113.7" },
          { key: "client.address", count: 300, value: "203.0.113.7" },
          { key: "http.client_ip", count: 84, value: "203.0.113.7" },
          { key: "source.address", count: 1, value: "203.0.113.7" },
        ],
      }),
    ).toEqual([
      { key: "client.address", count: 300, value: "203.0.113.7" },
      { key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 84 },
      { key: "http.client_ip", count: 84, value: "203.0.113.7" },
    ]);
    expect(SECURITY_TELEMETRY_MAX_LISTED).toBe(3);
  });

  test("never a resource attribute, a key that is blank or a place nothing was in", () => {
    expect(
      getTelemetryPlaces({
        messageCount: 0,
        attributeKeys: [
          {
            key: `${RESOURCE_ATTRIBUTE_PREFIX}host.name`,
            count: 9000,
            value: "web-1.acme.example",
          },
          { key: "", count: 5, value: "web-1.acme.example" },
          { key: "server.address", count: 0, value: "web-1.acme.example" },
          { key: "server.address.2", count: 2 },
        ],
      }),
    ).toEqual([{ key: "server.address.2", count: 2 }]);
  });

  test("whether a key is a resource attribute's: who sent the line, not what it says", () => {
    expect(isResourceAttributeKey("resource.host.name")).toBe(true);
    expect(isResourceAttributeKey("resource.service.name")).toBe(true);
    expect(isResourceAttributeKey("client.address")).toBe(false);
    expect(isResourceAttributeKey("resourceId")).toBe(false);
  });
});

describe("what the Logs explorer's message search opens on", () => {
  test("the value as named, an IPv6 address in the short form logs write it in", () => {
    expect(getTelemetryMessageSearchText(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(getTelemetryMessageSearchText("2001:0DB8:0:0:0:0:0:7")).toBe(
      "2001:db8::7",
    );
    expect(getTelemetryMessageSearchText("evil.example")).toBe("evil.example");
    expect(getTelemetryMessageSearchText("")).toBe("");
  });
});

describe("the signals", () => {
  test("logs, then traces", () => {
    expect(SECURITY_TELEMETRY_SIGNALS).toEqual([
      SecurityTelemetrySignal.Logs,
      SecurityTelemetrySignal.Traces,
    ]);
  });
});
