// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import ReverseDnsResolver, {
  buildSystemHostsFileLookup,
  HostsFileLookup,
  parseHostsFile,
  ReverseDnsLookupFunction,
  ReverseDnsResolution,
  SYSTEM_HOSTS_FILE_PATH,
} from "../../../Utils/Discovery/ReverseDnsResolver";
import {
  FakeReverseDnsResolver,
  fakeDnsError,
  fakeReverseDnsResolver,
} from "../../TestingUtils/FakeReverseDnsResolver";
import { DiscoveredHostReverseDnsStatus } from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import dns from "dns";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * OneUptime issue #3916 — the probe host's hosts file.
 *
 * Before #3916 the probe asked every address with Resolver#reverse, and
 * c-ares reads the hosts file for that call BEFORE asking DNS: a device an
 * operator listed in /etc/hosts was named from there whatever DNS did. The
 * probe now asks with resolvePtr, which never reads the file, so the pass
 * reads it itself — first, for every address, with no query sent.
 *
 * The first attempt at keeping those names asked reverse() again after an
 * NXDOMAIN. That lost them whenever the PTR lookup FAILED (no DNS at all,
 * a dropped datagram, SERVFAIL, REFUSED: "0 of 12 named" on an air-gapped
 * probe that used to name its listed devices at once), and its second DNS
 * query turned a slow server's in-time NXDOMAIN into a timeout. This suite
 * pins the replacement: the parser, the lazy once-a-pass read, and how the
 * pass uses what they give it.
 *
 * NO TEST HERE SENDS A QUERY OR READS THE MACHINE'S /etc/hosts: files are
 * written to a temporary directory, or the read is stubbed.
 */

let warnedMessages: Array<string> = [];

beforeEach(() => {
  warnedMessages = [];

  jest.spyOn(logger, "warn").mockImplementation((message: unknown): never => {
    warnedMessages.push(String(message));
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation((): never => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function addressList(count: number): Array<string> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): string => {
      return `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}`;
    },
  );
}

interface RecordingLookup {
  lookup: ReverseDnsLookupFunction;
  asked: Array<string>;
}

function recordingLookup(
  script: (ipAddress: string) => Promise<Array<string>>,
): RecordingLookup {
  const asked: Array<string> = [];

  return {
    asked: asked,
    lookup: (ipAddress: string): Promise<Array<string>> => {
      asked.push(ipAddress);
      return script(ipAddress);
    },
  };
}

function failingWith(code: string): () => Promise<Array<string>> {
  return (): Promise<Array<string>> => {
    return Promise.reject(fakeDnsError(code));
  };
}

function hostsFileOf(entries: Record<string, Array<string>>): HostsFileLookup {
  return (ipAddress: string): Array<string> | undefined => {
    return entries[ipAddress];
  };
}

describe("parseHostsFile — what a hosts file says", () => {
  it("maps each address to its names, canonical name first, then its aliases", () => {
    const parsed: Map<string, Array<string>> = parseHostsFile(
      [
        "127.0.0.1 localhost",
        "10.16.42.51 kds01.wbhq.com kds01",
        "10.16.42.55 kds05",
      ].join("\n"),
    );

    expect([...parsed.entries()]).toEqual([
      ["127.0.0.1", ["localhost"]],
      ["10.16.42.51", ["kds01.wbhq.com", "kds01"]],
      ["10.16.42.55", ["kds05"]],
    ]);
  });

  it("drops comments, whole-line and trailing, and a comment glued to a name", () => {
    const parsed: Map<string, Array<string>> = parseHostsFile(
      [
        "# 10.16.42.50 commented-out.wbhq.com",
        "10.16.42.51 kds01.wbhq.com # the kitchen display",
        "10.16.42.52 kds02#no-space-before-the-comment",
        "   # indented comment",
      ].join("\n"),
    );

    expect([...parsed.entries()]).toEqual([
      ["10.16.42.51", ["kds01.wbhq.com"]],
      ["10.16.42.52", ["kds02"]],
    ]);
  });

  it("splits on any whitespace, and reads Windows line endings", () => {
    const parsed: Map<string, Array<string>> = parseHostsFile(
      "10.16.42.51\tkds01.wbhq.com \t  kds01\r\n  10.16.42.52   kds02  \r\n",
    );

    expect(parsed.get("10.16.42.51")).toEqual(["kds01.wbhq.com", "kds01"]);
    expect(parsed.get("10.16.42.52")).toEqual(["kds02"]);
  });

  it("keeps the FIRST line for an address, as the system resolver does", () => {
    const parsed: Map<string, Array<string>> = parseHostsFile(
      [
        "10.16.42.51 kds01.wbhq.com",
        "10.16.42.51 something-else.wbhq.com kds01-old",
      ].join("\n"),
    );

    expect(parsed.get("10.16.42.51")).toEqual(["kds01.wbhq.com"]);
  });

  it("skips a line with an address and no name, without letting it claim the address", () => {
    const parsed: Map<string, Array<string>> = parseHostsFile(
      ["10.16.42.51", "10.16.42.51 # nothing", "10.16.42.51 kds01"].join("\n"),
    );

    expect(parsed.get("10.16.42.51")).toEqual(["kds01"]);
    expect(parsed.size).toBe(1);
  });

  it.each([
    ["an IPv6 address", "::1 ip6-localhost"],
    ["an IPv4-mapped IPv6 address", "::ffff:10.16.42.51 mapped"],
    ["a leading zero", "010.16.42.51 zero-padded"],
    ["an octet above 255", "10.16.42.256 too-big"],
    ["a CIDR suffix", "10.16.42.51/32 cidr"],
    ["three octets", "10.16.42 short"],
    ["a hostname first", "kds01.wbhq.com 10.16.42.51"],
  ])("skips a line that starts with %s", (_label: string, line: string) => {
    expect(parseHostsFile(line).size).toBe(0);
  });

  it.each([
    ["an empty file", ""],
    ["only blank lines", "\n\n  \n\t\n"],
    ["only comments", "# nothing here\n#10.0.0.1 x\n"],
  ])("reads %s as no entries", (_label: string, contents: string) => {
    expect(parseHostsFile(contents).size).toBe(0);
  });

  it("reads something that is not text as no entries, rather than throwing", () => {
    expect(parseHostsFile(undefined as unknown as string).size).toBe(0);
    expect(parseHostsFile(42 as unknown as string).size).toBe(0);
  });

  it("returns names exactly as written: normalising them is the pass's job", () => {
    expect(
      parseHostsFile("10.16.42.51 KDS01.WBHQ.com. <b>junk</b>").get(
        "10.16.42.51",
      ),
    ).toEqual(["KDS01.WBHQ.com.", "<b>junk</b>"]);
  });
});

describe("buildSystemHostsFileLookup — reading it lazily, once, and never failing over it", () => {
  it("reads nothing until the first address is looked up, then reads once", () => {
    const reads: Array<string> = [];
    const lookup: HostsFileLookup = buildSystemHostsFileLookup(
      "/some/hosts",
      (filePath: string): string => {
        reads.push(filePath);
        return "10.16.42.51 kds01.wbhq.com kds01\n";
      },
    );

    // Building it is free: every caller of the pass builds a resolver.
    expect(reads).toEqual([]);

    expect(lookup("10.16.42.51")).toEqual(["kds01.wbhq.com", "kds01"]);
    expect(lookup("10.16.42.52")).toBeUndefined();
    expect(lookup("10.16.42.51")).toEqual(["kds01.wbhq.com", "kds01"]);

    expect(reads).toEqual(["/some/hosts"]);
  });

  it.each([
    [
      "a file that cannot be read",
      (): string => {
        throw Object.assign(new Error("ENOENT: no such file"), {
          code: "ENOENT",
        });
      },
    ],
    [
      "a reader that hands back something that is not text",
      (): string => {
        return Buffer.from("10.16.42.51 kds01") as unknown as string;
      },
    ],
  ])(
    "treats %s as a file with no entries, and does not try again for every address",
    (_label: string, readFile: (filePath: string) => string) => {
      let readCount: number = 0;
      const lookup: HostsFileLookup = buildSystemHostsFileLookup(
        "/etc/hosts",
        (filePath: string): string => {
          readCount++;
          return readFile(filePath);
        },
      );

      expect(lookup("10.16.42.51")).toBeUndefined();
      expect(lookup("10.16.42.52")).toBeUndefined();
      expect(readCount).toBe(1);
    },
  );

  it("reads a real file from the path it is given", () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-hosts-"),
    );
    const hostsPath: string = path.join(directory, "hosts");

    try {
      fs.writeFileSync(
        hostsPath,
        "127.0.0.1 localhost\n10.16.42.55 kds05 # one name only\n",
      );

      expect(buildSystemHostsFileLookup(hostsPath)("10.16.42.55")).toEqual([
        "kds05",
      ]);
      expect(
        buildSystemHostsFileLookup(path.join(directory, "missing"))(
          "10.16.42.55",
        ),
      ).toBeUndefined();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("defaults to the operating system's hosts file", () => {
    if (process.platform === "win32") {
      expect(SYSTEM_HOSTS_FILE_PATH.toLowerCase()).toContain(
        path.join("drivers", "etc", "hosts"),
      );
    } else {
      expect(SYSTEM_HOSTS_FILE_PATH).toBe("/etc/hosts");
    }
  });
});

describe("ReverseDnsResolver — the hosts file comes first", () => {
  it("names an address the file lists without asking DNS about it", async () => {
    const dnsLookup: RecordingLookup = recordingLookup(
      async (ipAddress: string): Promise<Array<string>> => {
        return [`ptr-${ipAddress}.wbhq.example`];
      },
    );

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: dnsLookup.lookup,
      hostsFileLookup: hostsFileOf({
        "10.16.42.51": ["kds01.wbhq.com", "kds01"],
      }),
      concurrency: 1,
    }).resolveHostnames(["10.16.42.51", "10.16.42.52"]);

    // The canonical name, as written; the pre-#3916 reverse() gave "kds01".
    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds01.wbhq.com",
    );
    expect(result.hostnameByIpAddress.get("10.16.42.52")).toBe(
      "ptr-10.16.42.52.wbhq.example",
    );
    expect(dnsLookup.asked).toEqual(["10.16.42.52"]);
    expect(result.statusByIpAddress!.size).toBe(0);
    expect(result.lookedUpCount).toBe(2);
    expect(result.notLookedUpCount).toBe(0);
  });

  it("names a line with ONE name, which reverse() never did", async () => {
    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: failingWith("ENOTFOUND"),
      hostsFileLookup: buildSystemHostsFileLookup("/stub", (): string => {
        return "10.16.42.55 kds05\n";
      }),
    }).resolveHostnames(["10.16.42.55"]);

    expect(result.hostnameByIpAddress.get("10.16.42.55")).toBe("kds05");
  });

  it.each([
    ["no DNS server listening", "ECONNREFUSED"],
    ["a dropped query", "ETIMEOUT"],
    ["SERVFAIL", "ESERVFAIL"],
    ["REFUSED", "EREFUSED"],
  ])(
    "keeps the file's names when DNS fails with %s — no query is sent for them",
    async (_label: string, code: string) => {
      /*
       * The regression the first fallback introduced: it ran only after
       * NXDOMAIN, so every one of these failures took the operator's
       * hosts-file names with it.
       */
      const addresses: Array<string> = [];

      for (let octet: number = 51; octet <= 62; octet++) {
        addresses.push(`10.16.42.${octet}`);
      }

      const dnsLookup: RecordingLookup = recordingLookup(failingWith(code));
      const retry: RecordingLookup = recordingLookup(failingWith(code));

      const result: ReverseDnsResolution = await new ReverseDnsResolver({
        lookup: dnsLookup.lookup,
        retryLookup: retry.lookup,
        hostsFileLookup: hostsFileOf({
          "10.16.42.51": ["kds01.wbhq.com", "kds01"],
          "10.16.42.55": ["kds05.wbhq.com", "kds05"],
        }),
      }).resolveHostnames(addresses);

      expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
        "kds01.wbhq.com",
      );
      expect(result.hostnameByIpAddress.get("10.16.42.55")).toBe(
        "kds05.wbhq.com",
      );
      expect(result.hostnameByIpAddress.size).toBe(2);

      for (const asked of [...dnsLookup.asked, ...retry.asked]) {
        expect(["10.16.42.51", "10.16.42.55"]).not.toContain(asked);
      }

      expect(dnsLookup.asked).toHaveLength(10);
      expect(result.failedAddressCount).toBe(10);
      expect(result.statusByIpAddress!.has("10.16.42.51")).toBe(false);
    },
  );

  it("falls through to DNS when none of the file's names survives normalisation", async () => {
    const dnsLookup: RecordingLookup = recordingLookup(
      async (): Promise<Array<string>> => {
        return ["kds09.wbhq.example"];
      },
    );

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: dnsLookup.lookup,
      hostsFileLookup: hostsFileOf({
        "10.16.42.59": ["59.42.16.10.in-addr.arpa", "<b>junk</b>", "10.16"],
      }),
    }).resolveHostnames(["10.16.42.59"]);

    expect(dnsLookup.asked).toEqual(["10.16.42.59"]);
    expect(result.hostnameByIpAddress.get("10.16.42.59")).toBe(
      "kds09.wbhq.example",
    );
  });

  it("takes the first name that survives, not simply the first", async () => {
    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: failingWith("ENOTFOUND"),
      hostsFileLookup: hostsFileOf({
        "10.16.42.51": ["<b>junk</b>", "kds01.WBHQ.com."],
      }),
    }).resolveHostnames(["10.16.42.51"]);

    // Normalised as a PTR answer is: one root dot dropped, case kept.
    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds01.WBHQ.com",
    );
  });

  it("asks DNS as usual when the injected lookup throws or answers nonsense", async () => {
    const dnsLookup: RecordingLookup = recordingLookup(
      async (ipAddress: string): Promise<Array<string>> => {
        return [`ptr-${ipAddress.split(".").pop()}.wbhq.example`];
      },
    );

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: dnsLookup.lookup,
      hostsFileLookup: ((ipAddress: string): unknown => {
        if (ipAddress === "10.16.42.51") {
          throw new Error("hosts file exploded");
        }

        return "kds02.wbhq.com";
      }) as unknown as HostsFileLookup,
    }).resolveHostnames(["10.16.42.51", "10.16.42.52"]);

    expect(dnsLookup.asked).toEqual(["10.16.42.51", "10.16.42.52"]);
    expect(result.hostnameByIpAddress.get("10.16.42.52")).toBe(
      "ptr-52.wbhq.example",
    );
  });

  it("never lets a name from the file disarm the failure budget: it says nothing about DNS", async () => {
    /*
     * Fifty addresses the file names, then a probe whose DNS is silent. The
     * breaker must still reach its verdict on the DNS lookups alone, or a
     * well-kept hosts file would hide a probe with no resolver.
     */
    const addresses: Array<string> = addressList(60);
    const entries: Record<string, Array<string>> = {};

    for (const ipAddress of addresses.slice(0, 50)) {
      entries[ipAddress] = [`listed-${ipAddress.split(".").pop()}.wbhq.com`];
    }

    const dnsLookup: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: dnsLookup.lookup,
      hostsFileLookup: hostsFileOf(entries),
      concurrency: 2,
      failureBudget: 2,
    }).resolveHostnames(addresses);

    expect(result.hostnameByIpAddress.size).toBe(50);
    expect(dnsLookup.asked).toEqual(addresses.slice(50, 52));
    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.lookedUpCount).toBe(52);
    expect(result.notLookedUpCount).toBe(8);
  });

  it("names a listed host the failure budget would have skipped: the file is read for every address, up front", async () => {
    const addresses: Array<string> = addressList(100);
    const listed: string = addresses[99]!;

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: failingWith("ETIMEOUT"),
      hostsFileLookup: hostsFileOf({ [listed]: ["printer.wbhq.com"] }),
      concurrency: 32,
    }).resolveHostnames(addresses);

    expect(result.isReverseDnsAvailable).toBe(false);
    expect(result.hostnameByIpAddress.get(listed)).toBe("printer.wbhq.com");
    expect(result.statusByIpAddress!.has(listed)).toBe(false);
    expect(result.statusByIpAddress!.get(addresses[98]!)).toBe(
      DiscoveredHostReverseDnsStatus.SkippedNoResolver,
    );
    // 64 DNS lookups and the one the file answered; 35 never asked.
    expect(result.lookedUpCount).toBe(65);
    expect(result.notLookedUpCount).toBe(35);
  });

  it("names listed hosts even when the wall clock is spent before the first DNS wave", async () => {
    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: async (): Promise<Array<string>> => {
        return ["never.example.com"];
      },
      hostsFileLookup: hostsFileOf({ "10.0.0.2": ["listed.wbhq.com"] }),
      totalBudgetInMs: 1,
      now: ((): (() => number) => {
        let current: number = 0;
        return (): number => {
          const value: number = current;
          current += 10;
          return value;
        };
      })(),
    }).resolveHostnames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(result.hostnameByIpAddress.get("10.0.0.2")).toBe("listed.wbhq.com");
    expect(result.isTimeBudgetExhausted).toBe(true);
    expect(result.statusByIpAddress!.get("10.0.0.1")).toBe(
      DiscoveredHostReverseDnsStatus.SkippedTimeBudget,
    );
    expect(result.lookedUpCount).toBe(1);
    expect(result.notLookedUpCount).toBe(2);
  });

  it("asks DNS nothing at all, and warns about nothing, when the file names every address", async () => {
    const dnsLookup: RecordingLookup = recordingLookup(failingWith("ETIMEOUT"));

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: dnsLookup.lookup,
      hostsFileLookup: (ipAddress: string): Array<string> => {
        return [`listed-${ipAddress.split(".").pop()}.wbhq.com`];
      },
      failureBudget: 1,
    }).resolveHostnames(addressList(5));

    expect(dnsLookup.asked).toEqual([]);
    expect(result.hostnameByIpAddress.size).toBe(5);
    expect(result.isReverseDnsAvailable).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(warnedMessages).toHaveLength(0);
  });
});

describe("ReverseDnsResolver — which hosts file, by default", () => {
  /*
   * The same convention as the retry pass: omit BOTH the lookup and the
   * hosts file and the probe's real ones are used; inject the lookup alone
   * and there is none, so a test that replaced the lookup to keep this
   * machine out of the result gets nothing from its /etc/hosts either.
   */
  const hostsFileText: string = "10.16.42.51 kds01.wbhq.com kds01\n";

  function spyOnHostsFileReads(): Array<string> {
    const reads: Array<string> = [];
    const realReadFileSync: typeof fs.readFileSync = fs.readFileSync;

    jest.spyOn(fs, "readFileSync").mockImplementation(((
      filePath: fs.PathOrFileDescriptor,
      options?: unknown,
    ): unknown => {
      if (filePath === SYSTEM_HOSTS_FILE_PATH) {
        reads.push(String(filePath));
        return hostsFileText;
      }

      return realReadFileSync(filePath, options as never);
    }) as never);

    return reads;
  }

  /*
   * Once per PASS, and only when the pass first needs it (#3916). An
   * instance reused for a second pass reads the file again, so a device the
   * operator added to /etc/hosts between scans is named by the next one —
   * the same reason the retry and rescue lookups are built per pass.
   */
  it("reads the system hosts file once per pass — and only when the pass first needs it — on the default wiring", async () => {
    const reads: Array<string> = spyOnHostsFileReads();
    const created: Array<FakeReverseDnsResolver> = [];

    // No query may leave the machine: every Resolver the defaults build is a fake.
    jest.spyOn(dns.promises, "Resolver").mockImplementation(((options?: {
      timeout?: number;
    }): FakeReverseDnsResolver => {
      const resolver: FakeReverseDnsResolver = fakeReverseDnsResolver(
        {
          servers: ["192.0.2.53"],
          resolvePtr: (): Promise<Array<string>> => {
            return Promise.reject(fakeDnsError("ENOTFOUND"));
          },
        },
        options?.timeout ?? 0,
      );
      created.push(resolver);
      return resolver;
    }) as never);

    const resolver: ReverseDnsResolver = new ReverseDnsResolver({
      lookup: undefined,
    });

    expect(reads).toEqual([]);

    const first: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.16.42.51",
    ]);
    const second: ReverseDnsResolution = await resolver.resolveHostnames([
      "10.16.42.51",
      "10.16.42.52",
    ]);

    expect(first.hostnameByIpAddress.get("10.16.42.51")).toBe("kds01.wbhq.com");
    expect(second.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "kds01.wbhq.com",
    );
    expect(reads).toEqual([SYSTEM_HOSTS_FILE_PATH, SYSTEM_HOSTS_FILE_PATH]);

    // Only 10.16.42.52 ever reached DNS.
    const askedNames: Array<unknown> = created.flatMap(
      (fake: FakeReverseDnsResolver): Array<unknown> => {
        return fake.calls
          .filter((call: { method: string }): boolean => {
            return call.method === "resolvePtr";
          })
          .map((call: { argument?: unknown }): unknown => {
            return call.argument;
          });
      },
    );

    expect(askedNames).toEqual(["52.42.16.10.in-addr.arpa"]);
  });

  it("reads no hosts file at all when the lookup is injected", async () => {
    const reads: Array<string> = spyOnHostsFileReads();

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: failingWith("ENOTFOUND"),
    }).resolveHostnames(["10.16.42.51"]);

    expect(reads).toEqual([]);
    expect(result.hostnameByIpAddress.size).toBe(0);
    expect(result.statusByIpAddress!.get("10.16.42.51")).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
  });

  it("uses an injected hosts file alongside an injected lookup", async () => {
    const reads: Array<string> = spyOnHostsFileReads();

    const result: ReverseDnsResolution = await new ReverseDnsResolver({
      lookup: failingWith("ENOTFOUND"),
      hostsFileLookup: hostsFileOf({ "10.16.42.51": ["injected.wbhq.com"] }),
    }).resolveHostnames(["10.16.42.51"]);

    expect(reads).toEqual([]);
    expect(result.hostnameByIpAddress.get("10.16.42.51")).toBe(
      "injected.wbhq.com",
    );
  });
});
