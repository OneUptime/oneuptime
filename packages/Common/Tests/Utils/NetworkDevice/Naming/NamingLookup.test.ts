import {
  MAX_NAMING_LOOKUP_ENTRIES,
  MAX_NAMING_LOOKUP_KEY_LENGTH,
  MAX_NAMING_LOOKUP_VALUE_LENGTH,
  NamingLookupEntry,
  NamingLookupKey,
} from "../../../../Types/NetworkDevice/DeviceNaming";
import {
  NAMING_LOOKUP_PROBLEMS,
  NamingLookupProblem,
  NamingLookupTable,
  ParsedNamingLookupText,
  formatNamingLookupProblem,
  getNamingLookupKeyOf,
  lookUpNamingValue,
  normalizeNamingLookupKey,
  parseNamingLookupText,
  readNamingLookupTable,
  toNamingLookupCsv,
  validateNamingLookupEntries,
} from "../../../../Utils/NetworkDevice/Naming/NamingLookup";
import { seededRandom, SeededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A naming rule's lookup table (OneUptime issue #6619): the reporter's
 * convention maps the last part of each device's address to its role, and a
 * rule's {lookup} puts the device's row in its name. These pin how keys are
 * compared, what a table may hold, and that a table pasted from a
 * spreadsheet or read from a CSV file - and written back as one - keeps
 * every row.
 */

// The reporter's table for one unit's menu boards, as their sheet has it.
const DMB_TABLE: Array<NamingLookupEntry> = [
  { key: "51", value: "MNUPLR01" },
  { key: "151", value: "MNUSCR01" },
  { key: "152", value: "MNUSCR02" },
  { key: "153", value: "MNUSCR03" },
  { key: "150", value: "POPSCR01" },
  { key: "154", value: "DRTSCR01" },
  { key: "155", value: "DRTSCR02" },
  { key: "156", value: "DRTSCR03" },
  { key: "157", value: "DRTSCR04" },
  { key: "158", value: "DRTSCR05" },
  { key: "159", value: "DRTSCR06" },
  { key: "54", value: "DRTPLR01" },
  { key: "55", value: "DRTPLR02" },
  { key: "56", value: "DRTPLR03" },
  { key: "57", value: "DRTPLR04" },
  { key: "58", value: "DRTPLR05" },
  { key: "59", value: "DRTPLR06" },
];

function problemOf(result: unknown): NamingLookupProblem {
  const read: { problem?: NamingLookupProblem } = result as {
    problem?: NamingLookupProblem;
  };

  if (!read.problem) {
    throw new Error("expected a problem");
  }

  return read.problem;
}

describe("normalizeNamingLookupKey", () => {
  test("the last part of an address: 0 to 255, without leading zeros", () => {
    expect(normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "51")).toBe(
      "51",
    );
    expect(normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "051")).toBe(
      "51",
    );
    expect(normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, ".51")).toBe(
      "51",
    );
    expect(normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, 51)).toBe(
      "51",
    );
    expect(normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "0")).toBe(
      "0",
    );
    expect(
      normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "256"),
    ).toBeNull();
    expect(
      normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "5a"),
    ).toBeNull();
    expect(
      normalizeNamingLookupKey(NamingLookupKey.LastIpOctet, "-1"),
    ).toBeNull();
  });

  test("an IP address: IPv4 without leading zeros, IPv6 without case", () => {
    expect(
      normalizeNamingLookupKey(NamingLookupKey.IpAddress, "10.048.145.051"),
    ).toBe("10.48.145.51");
    expect(normalizeNamingLookupKey(NamingLookupKey.IpAddress, "FE80::1")).toBe(
      "fe80::1",
    );
    expect(
      normalizeNamingLookupKey(NamingLookupKey.IpAddress, "10.48.145"),
    ).toBeNull();
    expect(
      normalizeNamingLookupKey(NamingLookupKey.IpAddress, "printer"),
    ).toBeNull();
  });

  test("a MAC address, in any spelling", () => {
    for (const spelling of [
      "00:05:0b:b0:7f:fc",
      "00-05-0B-B0-7F-FC",
      "0005.0bb0.7ffc",
      "00050BB07FFC",
    ]) {
      expect(
        normalizeNamingLookupKey(NamingLookupKey.MacAddress, spelling),
      ).toBe("00:05:0b:b0:7f:fc");
    }

    expect(
      normalizeNamingLookupKey(NamingLookupKey.MacAddress, "00:05:0b"),
    ).toBeNull();
  });

  test("a discovered name, without case", () => {
    expect(
      normalizeNamingLookupKey(NamingLookupKey.DiscoveredName, " DMB-5 "),
    ).toBe("dmb-5");
    expect(
      normalizeNamingLookupKey(NamingLookupKey.DiscoveredName, "dmb\n5"),
    ).toBeNull();
  });

  test("blank, over-long and non-text keys are no keys", () => {
    for (const kind of Object.values(NamingLookupKey)) {
      expect(normalizeNamingLookupKey(kind, "")).toBeNull();
      expect(normalizeNamingLookupKey(kind, "   ")).toBeNull();
      expect(normalizeNamingLookupKey(kind, null)).toBeNull();
      expect(normalizeNamingLookupKey(kind, { key: "51" })).toBeNull();
      expect(
        normalizeNamingLookupKey(
          kind,
          "1".repeat(MAX_NAMING_LOOKUP_KEY_LENGTH + 1),
        ),
      ).toBeNull();
    }
  });
});

describe("looking a device up", () => {
  test("the reporter's table names every one of a unit's menu boards", () => {
    const table: NamingLookupTable | null = readNamingLookupTable({
      kind: NamingLookupKey.LastIpOctet,
      entries: DMB_TABLE,
    });

    expect(table).not.toBeNull();
    expect(table!.values.size).toBe(17);
    expect(lookUpNamingValue(table!, { ipAddress: "10.48.145.51" })).toBe(
      "MNUPLR01",
    );
    expect(lookUpNamingValue(table!, { ipAddress: "10.64.145.159" })).toBe(
      "DRTSCR06",
    );
    // Every unit's subnet: the table is about the last part only.
    expect(lookUpNamingValue(table!, { ipAddress: "10.99.1.54" })).toBe(
      "DRTPLR01",
    );
    expect(
      lookUpNamingValue(table!, { ipAddress: "10.48.145.53" }),
    ).toBeUndefined();
    expect(lookUpNamingValue(table!, {})).toBeUndefined();
  });

  test("a device is looked up by its key of the table's kind", () => {
    const facts: {
      ipAddress: string;
      macAddress: string;
      discoveredName: string;
    } = {
      ipAddress: "10.48.145.051",
      macAddress: "00-05-0B-B0-7F-FC",
      discoveredName: "DMB-5",
    };

    expect(getNamingLookupKeyOf(NamingLookupKey.LastIpOctet, facts)).toBe("51");
    expect(getNamingLookupKeyOf(NamingLookupKey.IpAddress, facts)).toBe(
      "10.48.145.51",
    );
    expect(getNamingLookupKeyOf(NamingLookupKey.MacAddress, facts)).toBe(
      "00:05:0b:b0:7f:fc",
    );
    expect(getNamingLookupKeyOf(NamingLookupKey.DiscoveredName, facts)).toBe(
      "dmb-5",
    );
    expect(
      getNamingLookupKeyOf(NamingLookupKey.LastIpOctet, {
        ipAddress: "fe80::1",
      }),
    ).toBeNull();
  });

  test("a stored table is read defensively: junk rows skipped, the first row of a key wins", () => {
    const table: NamingLookupTable | null = readNamingLookupTable({
      kind: NamingLookupKey.MacAddress,
      entries: [
        null,
        "row",
        { key: "00:05:0b:b0:7f:fc", value: " First " },
        { key: "00-05-0B-B0-7F-FC", value: "Second" },
        { key: "not a mac", value: "x" },
        { key: "00:05:0b:b0:7f:fd", value: "" },
      ],
    });

    expect(table!.values.size).toBe(1);
    expect(table!.values.get("00:05:0b:b0:7f:fc")).toBe("First");
    expect(
      readNamingLookupTable({ kind: "colour", entries: DMB_TABLE }),
    ).toBeNull();
    expect(
      readNamingLookupTable({
        kind: NamingLookupKey.LastIpOctet,
        entries: "51,MNUPLR01",
      }),
    ).toBeNull();
  });
});

describe("validateNamingLookupEntries", () => {
  test("the reporter's table saves as typed", () => {
    expect(
      validateNamingLookupEntries({
        kind: NamingLookupKey.LastIpOctet,
        entries: DMB_TABLE,
      }),
    ).toEqual({ entries: DMB_TABLE });
  });

  test("no table, or an empty one, is no table", () => {
    expect(validateNamingLookupEntries({ kind: null, entries: null })).toEqual({
      entries: [],
    });
    expect(validateNamingLookupEntries({ kind: null, entries: [] })).toEqual({
      entries: [],
    });
  });

  test("keys and values are trimmed, keys kept as typed", () => {
    expect(
      validateNamingLookupEntries({
        kind: NamingLookupKey.LastIpOctet,
        entries: [{ key: " 051 ", value: " MNUPLR01 " }],
      }),
    ).toEqual({ entries: [{ key: "051", value: "MNUPLR01" }] });
  });

  const refusals: Array<[string, unknown, unknown, string]> = [
    [
      "a table that is not a list",
      NamingLookupKey.LastIpOctet,
      "51",
      NAMING_LOOKUP_PROBLEMS.notAList,
    ],
    [
      "a row that is not a row",
      NamingLookupKey.LastIpOctet,
      ["51"],
      NAMING_LOOKUP_PROBLEMS.notAList,
    ],
    [
      "a table without a kind",
      null,
      DMB_TABLE,
      NAMING_LOOKUP_PROBLEMS.noKeyKind,
    ],
    [
      "a table of an unknown kind",
      "colour",
      DMB_TABLE,
      NAMING_LOOKUP_PROBLEMS.noKeyKind,
    ],
    [
      "a key of another kind",
      NamingLookupKey.LastIpOctet,
      [{ key: "10.48.145.51", value: "MNUPLR01" }],
      NAMING_LOOKUP_PROBLEMS.badKey,
    ],
    [
      "a row without a value",
      NamingLookupKey.LastIpOctet,
      [{ key: "51", value: "  " }],
      NAMING_LOOKUP_PROBLEMS.emptyValue,
    ],
    [
      "a value over the limit",
      NamingLookupKey.LastIpOctet,
      [{ key: "51", value: "x".repeat(MAX_NAMING_LOOKUP_VALUE_LENGTH + 1) }],
      NAMING_LOOKUP_PROBLEMS.valueTooLong,
    ],
    [
      "a key over the limit",
      NamingLookupKey.DiscoveredName,
      [{ key: "x".repeat(MAX_NAMING_LOOKUP_KEY_LENGTH + 1), value: "A" }],
      NAMING_LOOKUP_PROBLEMS.keyTooLong,
    ],
    [
      "a line break in a value",
      NamingLookupKey.LastIpOctet,
      [{ key: "51", value: "MNU\nPLR01" }],
      NAMING_LOOKUP_PROBLEMS.controlCharacter,
    ],
    [
      "the same key twice, however it is written",
      NamingLookupKey.LastIpOctet,
      [
        { key: "51", value: "MNUPLR01" },
        { key: "151", value: "MNUSCR01" },
        { key: "051", value: "MNUPLR02" },
      ],
      NAMING_LOOKUP_PROBLEMS.duplicateKey,
    ],
  ];

  test.each(refusals)(
    "refuses %s",
    (_title: string, kind: unknown, entries: unknown, template: string) => {
      const problem: NamingLookupProblem = problemOf(
        validateNamingLookupEntries({ kind: kind, entries: entries }),
      );

      expect(problem.template).toBe(template);
      expect(formatNamingLookupProblem(problem)).not.toMatch(/\{\{[a-z]+\}\}/i);
    },
  );

  test("a refusal names the row, counted from 1, and the rows a key is on twice", () => {
    expect(
      formatNamingLookupProblem(
        problemOf(
          validateNamingLookupEntries({
            kind: NamingLookupKey.LastIpOctet,
            entries: [
              { key: "51", value: "MNUPLR01" },
              { key: "300", value: "X" },
            ],
          }),
        ),
      ),
    ).toBe('Row 2: "300" is not a last part of the ip address, such as 51.');

    expect(
      formatNamingLookupProblem(
        problemOf(
          validateNamingLookupEntries({
            kind: NamingLookupKey.LastIpOctet,
            entries: [
              { key: "51", value: "MNUPLR01" },
              { key: "151", value: "MNUSCR01" },
              { key: "051", value: "MNUPLR02" },
            ],
          }),
        ),
      ),
    ).toBe('Rows 1 and 3 both have the key "051". Keep one of them.');
  });

  test("a table can hold the most rows allowed, and no more", () => {
    const rows: Array<NamingLookupEntry> = [];

    for (let index: number = 0; index < MAX_NAMING_LOOKUP_ENTRIES; index++) {
      rows.push({ key: `host-${index}`, value: `NAME${index}` });
    }

    expect(
      validateNamingLookupEntries({
        kind: NamingLookupKey.DiscoveredName,
        entries: rows,
      }),
    ).toEqual({ entries: rows });

    expect(
      problemOf(
        validateNamingLookupEntries({
          kind: NamingLookupKey.DiscoveredName,
          entries: [...rows, { key: "one-more", value: "X" }],
        }),
      ).template,
    ).toBe(NAMING_LOOKUP_PROBLEMS.tooMany);
  });
});

describe("pasted and uploaded tables", () => {
  test("two columns pasted from a spreadsheet (tab separated)", () => {
    const parsed: ParsedNamingLookupText = parseNamingLookupText(
      "51\tMNUPLR01\n151\tMNUSCR01\n",
      NamingLookupKey.LastIpOctet,
    );

    expect(parsed).toEqual({
      entries: [
        { key: "51", value: "MNUPLR01" },
        { key: "151", value: "MNUSCR01" },
      ],
      incompleteLines: [],
    });
  });

  test("a CSV file with a header, Windows line ends and a byte order mark", () => {
    const parsed: ParsedNamingLookupText = parseNamingLookupText(
      "﻿Last part of the IP address,Value\r\n51,MNUPLR01\r\n151,MNUSCR01\r\n",
      NamingLookupKey.LastIpOctet,
    );

    expect(parsed.entries).toEqual([
      { key: "51", value: "MNUPLR01" },
      { key: "151", value: "MNUSCR01" },
    ]);
  });

  test("a header of key and value is skipped for any kind", () => {
    expect(
      parseNamingLookupText(
        "key,value\ndmb-5,DRTPLR02\n",
        NamingLookupKey.DiscoveredName,
      ).entries,
    ).toEqual([{ key: "dmb-5", value: "DRTPLR02" }]);
  });

  test("a first row of data is never taken for a header", () => {
    expect(
      parseNamingLookupText("51,MNUPLR01\n", NamingLookupKey.LastIpOctet)
        .entries,
    ).toEqual([{ key: "51", value: "MNUPLR01" }]);
  });

  test("semicolons, as a spreadsheet with a comma decimal writes", () => {
    expect(
      parseNamingLookupText(
        "51;MNUPLR01\n151;MNUSCR01",
        NamingLookupKey.LastIpOctet,
      ).entries,
    ).toEqual([
      { key: "51", value: "MNUPLR01" },
      { key: "151", value: "MNUSCR01" },
    ]);
  });

  test("quoted cells keep their separators and doubled quotes", () => {
    expect(
      parseNamingLookupText(
        'key,value\n"Samsung, Inc",SAM\n"say ""hi""",HI\n',
        NamingLookupKey.DiscoveredName,
      ).entries,
    ).toEqual([
      { key: "Samsung, Inc", value: "SAM" },
      { key: 'say "hi"', value: "HI" },
    ]);
  });

  test("blank lines are skipped and lines without a value are reported by number", () => {
    expect(
      parseNamingLookupText(
        "51,MNUPLR01\n\n152\n153,MNUSCR03\n,orphan\n",
        NamingLookupKey.LastIpOctet,
      ),
    ).toEqual({
      entries: [
        { key: "51", value: "MNUPLR01" },
        { key: "153", value: "MNUSCR03" },
      ],
      incompleteLines: [3, 5],
    });
  });

  test("extra columns are ignored", () => {
    expect(
      parseNamingLookupText(
        "51,MNUPLR01,Indoor Menu Player,DMB01\n",
        NamingLookupKey.LastIpOctet,
      ).entries,
    ).toEqual([{ key: "51", value: "MNUPLR01" }]);
  });

  test("the reporter's table written as CSV reads back to the same rows", () => {
    const csv: string = toNamingLookupCsv(
      NamingLookupKey.LastIpOctet,
      DMB_TABLE,
    );

    expect(csv.startsWith("Last part of the IP address,Value\r\n")).toBe(true);
    expect(parseNamingLookupText(csv, NamingLookupKey.LastIpOctet)).toEqual({
      entries: DMB_TABLE,
      incompleteLines: [],
    });
  });

  test("a cell a spreadsheet would run as a formula is written as text, and read back as it was", () => {
    const rows: Array<NamingLookupEntry> = [
      { key: "=cmd", value: "+SUM(A1)" },
      { key: "@x", value: "-1" },
    ];
    const csv: string = toNamingLookupCsv(NamingLookupKey.DiscoveredName, rows);

    expect(csv).toContain("'=cmd,'+SUM(A1)");
    expect(
      parseNamingLookupText(csv, NamingLookupKey.DiscoveredName).entries,
    ).toEqual(rows);
  });

  test("any table written as CSV reads back to its rows (seeded)", () => {
    const random: SeededRandom = seededRandom(1216);
    const alphabet: string = 'ab,c";d e-1\t';

    // One character of the alphabet; its tab, which no cell holds, adds nothing.
    const draw: () => string = (): string => {
      const character: string = alphabet[random(alphabet.length)]!;

      return character === "\t" ? "" : character;
    };

    for (let attempt: number = 0; attempt < 200; attempt++) {
      const rows: Array<NamingLookupEntry> = [];
      const count: number = 1 + random(8);

      for (let index: number = 0; index < count; index++) {
        let key: string = `k${index}`;
        let value: string = "";

        for (let length: number = 1 + random(10); length > 0; length--) {
          key += draw();
          value += draw();
        }

        rows.push({ key: key.trim(), value: `v${value}`.trim() });
      }

      const csv: string = toNamingLookupCsv(
        NamingLookupKey.DiscoveredName,
        rows,
      );

      expect(
        parseNamingLookupText(csv, NamingLookupKey.DiscoveredName).entries,
      ).toEqual(rows);
    }
  });
});
