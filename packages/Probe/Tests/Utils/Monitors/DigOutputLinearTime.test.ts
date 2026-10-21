process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

// What every dig run prints: set by each test.
let digStdout: string = "";

jest.mock("child_process", () => {
  return {
    __esModule: true,
    execFile: (
      _file: string,
      _args: Array<string>,
      _options: { timeout?: number | undefined },
      callback: (error: Error | null, stdout: string) => void,
    ): void => {
      callback(null, digStdout);
    },
  };
});

class FakeResolver {
  public setServers(): void {}

  public async resolveTxt(): Promise<Array<Array<string>>> {
    return [["v=spf1 -all"]];
  }
}

jest.mock("dns", () => {
  return {
    __esModule: true,
    default: { promises: { Resolver: FakeResolver } },
  };
});

import {
  digOutputHasAuthenticatedData,
  readDigFlagsField,
} from "../../../Utils/Monitors/DigOutput";
import DnsMonitorUtil from "../../../Utils/Monitors/MonitorTypes/DnsMonitor";
import DnssecMonitorUtil from "../../../Utils/Monitors/MonitorTypes/DnssecMonitor";
import DnsMonitorResponse from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import DnssecMonitorResponse from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import Sleep from "Common/Types/Sleep";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";

/*
 * ---------------------------------------------------------------------------
 * WHAT DIG PRINTED IS READ IN TIME IN LINE WITH ITS LENGTH, AND SAYS WHAT IT
 * SAID BEFORE.
 *
 * Every DNS and DNSSEC check runs dig against the server the monitor names
 * - the domain's own, or a custom one a project chose - and reads what it
 * printed: whether the answer carries the AD flag, and the header's flags.
 * A DNS server decides that output: a TCP answer full of TXT strings is
 * printed as about 255,000 characters on one line. The patterns that read
 * it were tried again from every "flags:" of such a line, each try reading
 * to its end: seconds per check, on probes that run every project's
 * monitors. DigOutput reads it a fixed number of times.
 * ---------------------------------------------------------------------------
 */

// About what dig prints for the largest answer a server can send over TCP.
const LENGTH: number = 256000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => Promise<number> = async (
  run: () => unknown,
): Promise<number> => {
  const startedAt: number = Date.now();
  await run();
  return Date.now() - startedAt;
};

// The patterns as they were: the references the readers must agree with.
const AD_FLAG_BEFORE: RegExp = /flags:.*\bad\b/i;
const FLAGS_FIELD_BEFORE: RegExp = /flags:\s*([^;]+);/i;

// What dig prints around an answer, with the header's flags given.
const digOutput: (headerFlags: string, answer: string) => string = (
  headerFlags: string,
  answer: string,
): string => {
  return [
    ";; Truncated, retrying in TCP mode.",
    "",
    "; <<>> DiG 9.18.39 <<>> +dnssec example.com TXT @192.0.2.53",
    ";; global options: +cmd",
    ";; Got answer:",
    ";; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 1821",
    `;; flags: ${headerFlags}; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1`,
    "",
    ";; OPT PSEUDOSECTION:",
    "; EDNS: version: 0, flags: do; udp: 1232",
    ";; QUESTION SECTION:",
    ";example.com.\t\t\tIN\tTXT",
    "",
    ";; ANSWER SECTION:",
    `example.com.\t\t60\tIN\tTXT\t${answer}`,
    "",
    ";; Query time: 3 msec",
    "",
  ].join("\n");
};

// Answers a server can send, as dig prints them.
const WORST_ANSWERS: Array<[string, string]> = [
  ["flags: over and over", `"${repeat("flags:", LENGTH)}"`],
  ["FLAGS: and an escaped byte", `"${repeat("FLAGS:\\009", LENGTH)}"`],
  ["escaped tabs", `"flags:${repeat("\\009", LENGTH)}"`],
  ["flags: with no ad", `"${repeat("flags: qr rd ra ", LENGTH)}"`],
];

describe("the largest answer a server can send is read quickly", () => {
  test.each(WORST_ANSWERS)(
    "whether %s carries the AD flag",
    async (_label: string, answer: string) => {
      for (const headerFlags of ["qr rd ra", "qr rd ra ad"]) {
        const stdout: string = digOutput(headerFlags, answer);
        let hasAd: boolean | undefined;

        expect(
          await timeOf(() => {
            hasAd = digOutputHasAuthenticatedData(stdout);
          }),
        ).toBeLessThan(2000);
        expect(hasAd).toBe(headerFlags.endsWith("ad"));
      }
    },
  );

  test.each(WORST_ANSWERS)(
    "the header's flags before %s",
    async (_label: string, answer: string) => {
      const stdout: string = digOutput("qr rd ra ad", answer);
      let field: string | null = null;

      expect(
        await timeOf(() => {
          field = readDigFlagsField(stdout);
        }),
      ).toBeLessThan(2000);
      expect(field).toBe("qr rd ra ad");
    },
  );

  test.each([
    ["a run of labels with no ad and no line break", repeat("flags:", 400000)],
    ["a label and a run of tabs", "FLAGS:" + repeat("\t", 400000)],
    ["labels and semicolons", repeat("flags:;", 400000)],
    ["a run of lines that each hold a label", repeat("flags:x\n", 400000)],
  ])("%s", async (_label: string, stdout: string) => {
    expect(
      await timeOf(() => {
        digOutputHasAuthenticatedData(stdout);
        readDigFlagsField(stdout);
      }),
    ).toBeLessThan(2000);
  });
});

describe("through the monitors that run dig", () => {
  beforeEach(() => {
    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  });

  test("a DNS check against a server that answers with the largest TXT record", async () => {
    digStdout = digOutput("qr rd ra", `"${repeat("flags:", LENGTH)}"`);

    let response: DnsMonitorResponse | null = null;

    expect(
      await timeOf(async () => {
        response = await DnsMonitorUtil.query(
          {
            queryName: "example.com",
            recordType: DnsRecordType.TXT,
            hostname: "192.0.2.53",
            port: 53,
            timeout: 5000,
            retries: 0,
          },
          { isOnlineCheckRequest: true },
        );
      }),
    ).toBeLessThan(2000);
    expect(response!.isOnline).toBe(true);
    // The header carries no AD flag; the TXT record's text does not count.
    expect(response!.isDnssecValid).toBe(false);
  });

  test("a DNS check whose resolver vouched for the answer still says so", async () => {
    digStdout = digOutput("qr rd ra ad", `"${repeat("flags:", LENGTH)}"`);

    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      {
        queryName: "example.com",
        recordType: DnsRecordType.TXT,
        hostname: "",
        port: 53,
        timeout: 5000,
        retries: 0,
      },
      { isOnlineCheckRequest: true },
    );

    expect(response!.isDnssecValid).toBe(true);
  });

  test("a DNSSEC check whose resolver answers with the largest TXT record", async () => {
    digStdout = digOutput("qr rd ra ad", `"${repeat("flags:", LENGTH)}"`);

    let response: DnssecMonitorResponse | null = null;

    expect(
      await timeOf(async () => {
        response = await DnssecMonitorUtil.query(
          {
            domainName: "example.com",
            resolvers: ["192.0.2.53"],
            checkNameserverConsistency: false,
            signatureExpiryWarningDays: 7,
            timeout: 5000,
            retries: 0,
          },
          { retry: 0, isOnlineCheckRequest: true },
        );
      }),
    ).toBeLessThan(2000);
    expect(response!.resolverChecks).toEqual([
      expect.objectContaining({ resolver: "192.0.2.53", adFlag: true }),
    ]);
  });
});

describe("the readers answer exactly as the patterns did", () => {
  const PIECES: ReadonlyArray<string> = [
    "flags:",
    "FLAGS:",
    "Flags:",
    "flags",
    ":",
    ";",
    ";;",
    " ",
    "\t",
    "\n",
    "\r",
    "\u2028",
    "\u2029",
    "ad",
    "AD",
    "aD",
    "bad",
    "ads",
    "_ad",
    "ad_",
    "1ad",
    "qr",
    "rd",
    " ad;",
    "x",
    '"',
    "do",
    "\u00a0",
    "\u212a",
  ];

  const SEEDS: ReadonlyArray<string> = [
    digOutput("qr rd ra ad", '"v=spf1 -all"'),
    digOutput("qr rd ra", '"flags: ad"'),
    "flags:ad",
    "flags:;flags: x;",
    "flags:  ;",
    "x\nflags: ad",
  ];

  const drawnTexts: () => Array<string> = (): Array<string> => {
    const random: SeededRandom = seededRandom(5381);
    const texts: Array<string> = generatedTexts(20000, 33, PIECES, 14);

    for (let index: number = 0; index < 20000; index++) {
      let text: string = SEEDS[random(SEEDS.length)]!;
      const changes: number = random(5);

      for (let change: number = 0; change < changes; change++) {
        const at: number = random(text.length + 1);
        const piece: string = PIECES[random(PIECES.length)]!;
        const kind: number = random(4);

        if (kind < 2) {
          text = text.slice(0, at) + piece + text.slice(at);
        } else if (kind === 2) {
          text = text.slice(0, at) + text.slice(at + 1);
        } else {
          text = text.slice(0, at) + piece + text.slice(at + 1);
        }
      }

      texts.push(text);
    }

    return texts;
  };

  const TEXTS: Array<string> = drawnTexts();

  test("whether the output carries the AD flag", () => {
    const differences: Array<string> = [];
    let carried: number = 0;

    for (const text of TEXTS) {
      const expected: boolean = AD_FLAG_BEFORE.test(text);

      carried += expected ? 1 : 0;

      if (digOutputHasAuthenticatedData(text) !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(carried).toBeGreaterThan(2000);
    expect(TEXTS.length - carried).toBeGreaterThan(2000);
  });

  test("the flags field", () => {
    const differences: Array<string> = [];
    let found: number = 0;

    for (const text of TEXTS) {
      const match: RegExpMatchArray | null = text.match(FLAGS_FIELD_BEFORE);
      const expected: string | null = match ? match[1]! : null;

      found += expected === null ? 0 : 1;

      if (readDigFlagsField(text) !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(found).toBeGreaterThan(2000);
  });

  test("what dig prints for the answers it is asked for", () => {
    const signed: string = digOutput("qr rd ra ad", '"v=spf1 -all"');
    const unsigned: string = digOutput("qr rd ra", '"v=spf1 -all"');

    expect(digOutputHasAuthenticatedData(signed)).toBe(true);
    expect(digOutputHasAuthenticatedData(unsigned)).toBe(false);
    expect(readDigFlagsField(signed)).toBe("qr rd ra ad");
    expect(readDigFlagsField(unsigned)).toBe("qr rd ra");
    // Only the white space before ";" after the label: one character of it.
    expect(readDigFlagsField("flags:  ;")).toBe(" ");
    expect(readDigFlagsField("flags:;")).toBeNull();
    expect(readDigFlagsField("flags:;flags: x;")).toBe("x");
  });
});
