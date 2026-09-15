import {
  NBSTAT_QUERY_LENGTH,
  NBSTAT_WILDCARD_ENCODED_NAME,
  NbstatResponse,
  NetbiosNodeName,
  chooseNetbiosName,
  encodeNbstatQuery,
  parseNbstatResponse,
  toNbstatTransactionId,
} from "../../../Utils/Discovery/NetbiosNbstatCodec";
import { describe, expect, it } from "@jest/globals";

/*
 * OneUptime issue #3677 — the wire format of the NetBIOS node status (NBSTAT)
 * lookup the probe uses to name hosts that have no DNS record and no SNMP.
 *
 * Two different kinds of guarantee live here.
 *
 *   - The QUERY is pinned byte for byte. A query that is one bit wrong is not
 *     "slightly worse": Windows silently ignores it, every host stays named by
 *     its address, and nothing anywhere logs a reason.
 *   - The PARSER is fed hostile bytes. A reply datagram is chosen by whatever
 *     machine sits at the scanned address, and an exception thrown out of a
 *     socket 'message' listener ends the probe process. So beyond the realistic
 *     fixtures, every truncation of a real response and thousands of seeded
 *     random and mutated datagrams must come back as null or as names — never
 *     as a throw.
 *
 * The fixtures are written out as HEX SEGMENTS rather than produced by an
 * encoder, so they are an independent statement of RFC 1002 4.2.18 and not the
 * parser's own assumptions played back to it.
 */

function hex(...segments: Array<string>): Buffer {
  return Buffer.from(segments.join("").replace(/\s+/g, ""), "hex");
}

function u16(value: number): string {
  return value.toString(16).padStart(4, "0");
}

function u8(value: number): string {
  return value.toString(16).padStart(2, "0");
}

// A 15-byte name field, space-padded the way RFC 1001 specifies.
function nameField(name: string, padByte: number = 0x20): string {
  const field: Buffer = Buffer.alloc(15, padByte);
  Buffer.from(name, "latin1").copy(field);
  return field.toString("hex");
}

function entry(name: string, suffix: number, flags: number): string {
  return nameField(name) + u8(suffix) + u16(flags);
}

// "*" + 15 NULs, first-level encoded, as a length-prefixed name.
const ENCODED_WILDCARD_RR_NAME: string = "20" + "434b" + "41".repeat(30) + "00";

const UNIQUE_ACTIVE: number = 0x0400;
const GROUP_ACTIVE: number = 0x8400;

// MAC 00:15:5d:01:02:03 then 40 bytes of counters.
const WINDOWS_STATISTICS: string = "00155d010203" + "00".repeat(40);

/*
 * What `nbtstat -A` against a domain-joined Windows workstation returns, in
 * the order Windows lists it.
 */
const WINDOWS_RESPONSE: Buffer = hex(
  // NAME_TRN_ID, FLAGS (R + AA), QDCOUNT 0, ANCOUNT 1, NSCOUNT 0, ARCOUNT 0
  "abcd 8400 0000 0001 0000 0000",
  ENCODED_WILDCARD_RR_NAME,
  // TYPE NBSTAT, CLASS IN, TTL 0, RDLENGTH = 1 + 5*18 + 46 = 137
  "0021 0001 00000000 0089",
  // NUM_NAMES
  "05",
  entry("WORKSTATION01", 0x00, UNIQUE_ACTIVE),
  entry("CORP", 0x00, GROUP_ACTIVE),
  entry("WORKSTATION01", 0x20, UNIQUE_ACTIVE),
  entry("CORP", 0x1e, GROUP_ACTIVE),
  // The browser election pseudo-name fills all 15 bytes itself.
  Buffer.from("\u0001\u0002__MSBROWSE__\u0002", "latin1").toString("hex") +
    "01" +
    u16(GROUP_ACTIVE),
  WINDOWS_STATISTICS,
);

/*
 * nmbd's answer: machine name under <00>, <03> and <20>, workgroup as groups,
 * and a statistics block that is all zero (Samba does not report a MAC).
 */
const SAMBA_RESPONSE: Buffer = hex(
  "0102 8400 0000 0001 0000 0000",
  ENCODED_WILDCARD_RR_NAME,
  "0021 0001 00000000 0089",
  "05",
  entry("FILESERVER", 0x00, UNIQUE_ACTIVE),
  entry("FILESERVER", 0x03, UNIQUE_ACTIVE),
  entry("FILESERVER", 0x20, UNIQUE_ACTIVE),
  entry("WORKGROUP", 0x00, GROUP_ACTIVE),
  entry("WORKGROUP", 0x1e, GROUP_ACTIVE),
  "00".repeat(46),
);

const WINDOWS_NAMES: Array<NetbiosNodeName> = [
  {
    name: "WORKSTATION01  ",
    suffix: 0x00,
    isGroup: false,
    isConflict: false,
    isDeregistering: false,
    isActive: true,
  },
  {
    name: "CORP           ",
    suffix: 0x00,
    isGroup: true,
    isConflict: false,
    isDeregistering: false,
    isActive: true,
  },
  {
    name: "WORKSTATION01  ",
    suffix: 0x20,
    isGroup: false,
    isConflict: false,
    isDeregistering: false,
    isActive: true,
  },
  {
    name: "CORP           ",
    suffix: 0x1e,
    isGroup: true,
    isConflict: false,
    isDeregistering: false,
    isActive: true,
  },
  {
    name: "\u0001\u0002__MSBROWSE__\u0002",
    suffix: 0x01,
    isGroup: true,
    isConflict: false,
    isDeregistering: false,
    isActive: true,
  },
];

/*
 * A response with a caller-chosen header, answer name and table, for the
 * variations below. RDLENGTH and NUM_NAMES default to the honest values.
 */
function buildResponse(options: {
  transactionId?: number;
  flags?: number;
  questionCount?: number;
  answerCount?: number;
  question?: string;
  recordName?: string;
  recordType?: number;
  recordClass?: number;
  entries?: Array<string>;
  declaredNameCount?: number;
  recordDataLength?: number;
  statistics?: string;
}): Buffer {
  const entries: Array<string> = options.entries ?? [
    entry("HOST1", 0x00, UNIQUE_ACTIVE),
  ];
  const statistics: string = options.statistics ?? "";
  const honestLength: number = 1 + entries.length * 18 + statistics.length / 2;

  return hex(
    u16(options.transactionId ?? 0x4242),
    u16(options.flags ?? 0x8400),
    u16(options.questionCount ?? 0),
    u16(options.answerCount ?? 1),
    "0000 0000",
    options.question ?? "",
    options.recordName ?? ENCODED_WILDCARD_RR_NAME,
    u16(options.recordType ?? 0x0021),
    u16(options.recordClass ?? 0x0001),
    "00000000",
    u16(options.recordDataLength ?? honestLength),
    u8(options.declaredNameCount ?? entries.length),
    ...entries,
    statistics,
  );
}

function namesOf(response: NbstatResponse | null): Array<string> {
  return (response?.names ?? []).map((name: NetbiosNodeName) => {
    return `${name.name.trimEnd()}<${u8(name.suffix)}>`;
  });
}

describe("encodeNbstatQuery — the one datagram the probe sends", () => {
  it("matches the pinned 50-byte NBSTAT request", () => {
    expect(encodeNbstatQuery(0x1234).toString("hex")).toBe(
      [
        "1234", // NAME_TRN_ID
        "0000", // FLAGS: request, opcode 0, no RD, no B
        "0001", // QDCOUNT
        "0000", // ANCOUNT
        "0000", // NSCOUNT
        "0000", // ARCOUNT
        "20", // name length: 32 encoded characters
        "434b", // "CK" = "*"
        "41".repeat(30), // "AA" x 15 = the NUL padding
        "00", // root label
        "0021", // QUESTION_TYPE NBSTAT
        "0001", // QUESTION_CLASS IN
      ].join(""),
    );
  });

  it("is exactly 50 bytes", () => {
    expect(encodeNbstatQuery(7)).toHaveLength(50);
    expect(NBSTAT_QUERY_LENGTH).toBe(50);
  });

  it("asks about the NUL-padded wildcard, not a space-padded name", () => {
    /*
     * Space padding would encode as "CKCACACA..." and ask for a machine
     * literally named "*", which nothing answers.
     */
    expect(NBSTAT_WILDCARD_ENCODED_NAME).toBe(
      "CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(encodeNbstatQuery(0).toString("latin1", 13, 45)).toBe(
      "CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });

  it("carries the transaction id in the first two bytes, big-endian", () => {
    for (const id of [0, 1, 0x00ff, 0x0100, 0xabcd, 0xffff]) {
      expect(encodeNbstatQuery(id).readUInt16BE(0)).toBe(id);
    }
  });

  it("keeps only the low 16 bits of an out-of-range id instead of throwing", () => {
    expect(encodeNbstatQuery(0x10000).readUInt16BE(0)).toBe(0);
    expect(encodeNbstatQuery(0x1abcd).readUInt16BE(0)).toBe(0xabcd);
    expect(encodeNbstatQuery(-1).readUInt16BE(0)).toBe(0xffff);
    expect(encodeNbstatQuery(2 ** 40 + 5).readUInt16BE(0)).toBe(5);
    expect(encodeNbstatQuery(1.9).readUInt16BE(0)).toBe(1);
    expect(encodeNbstatQuery(Number.NaN).readUInt16BE(0)).toBe(0);
    expect(encodeNbstatQuery(Number.POSITIVE_INFINITY).readUInt16BE(0)).toBe(0);
  });

  it("masks ids the same way toNbstatTransactionId does, so replies can be compared", () => {
    for (const id of [0, 1, 0xffff, 0x10000, 0x12345, -7, 3.5]) {
      expect(encodeNbstatQuery(id).readUInt16BE(0)).toBe(
        toNbstatTransactionId(id),
      );
    }
  });

  it("is not itself a parseable response (its R bit is clear)", () => {
    expect(parseNbstatResponse(encodeNbstatQuery(5))).toBeNull();
  });
});

describe("parseNbstatResponse — real-world responses", () => {
  it("reads a Windows workstation's name table, flags and all", () => {
    const response: NbstatResponse | null =
      parseNbstatResponse(WINDOWS_RESPONSE);

    expect(response).not.toBeNull();
    expect(response!.transactionId).toBe(0xabcd);
    expect(response!.names).toEqual(WINDOWS_NAMES);
    expect(chooseNetbiosName(response!.names)).toBe("workstation01");
  });

  it("reads a Samba server whose statistics block is all zero", () => {
    const response: NbstatResponse | null = parseNbstatResponse(SAMBA_RESPONSE);

    expect(response!.transactionId).toBe(0x0102);
    expect(namesOf(response)).toEqual([
      "FILESERVER<00>",
      "FILESERVER<03>",
      "FILESERVER<20>",
      "WORKGROUP<00>",
      "WORKGROUP<1e>",
    ]);
    expect(chooseNetbiosName(response!.names)).toBe("fileserver");
  });

  it("round-trips the transaction id of the query it answers", () => {
    for (const id of [0, 1, 0x7fff, 0xffff]) {
      const query: Buffer = encodeNbstatQuery(id);
      const reply: Buffer = buildResponse({
        transactionId: query.readUInt16BE(0),
      });

      expect(parseNbstatResponse(reply)!.transactionId).toBe(id);
    }
  });

  it("does not require the statistics block at all", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({ entries: [entry("NOSTATS", 0x00, UNIQUE_ACTIVE)] }),
    );

    expect(namesOf(response)).toEqual(["NOSTATS<00>"]);
  });

  it("accepts an RR_NAME that is a compression pointer", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({ recordName: "c00c" }),
    );

    expect(namesOf(response)).toEqual(["HOST1<00>"]);
  });

  it("does not follow a compression pointer, even one that points at itself", () => {
    // A pointer to offset 12, which IS the pointer: a loop if followed.
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({ recordName: "c00c", transactionId: 9 }),
    );

    expect(response!.transactionId).toBe(9);
  });

  it("accepts an RR_NAME with a NetBIOS scope label after the encoded name", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        recordName:
          "20" +
          "434b" +
          "41".repeat(30) +
          "04" +
          Buffer.from("corp").toString("hex") +
          "00",
      }),
    );

    expect(namesOf(response)).toEqual(["HOST1<00>"]);
  });

  it("skips a question section a stack echoes back", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        questionCount: 1,
        question: ENCODED_WILDCARD_RR_NAME + "0021 0001",
      }),
    );

    expect(namesOf(response)).toEqual(["HOST1<00>"]);
  });

  it("returns an empty table for a response that declares no names", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({ entries: [] }),
    );

    expect(response).toEqual({ transactionId: 0x4242, names: [] });
    expect(chooseNetbiosName(response!.names)).toBeUndefined();
  });

  it("decodes each NAME_FLAGS bit at its RFC 1002 position", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        entries: [
          entry("G", 0x00, 0x8000),
          entry("DRG", 0x00, 0x1000),
          entry("CNF", 0x00, 0x0800),
          entry("ACT", 0x00, 0x0400),
          // ONT and PRM set, nothing we read.
          entry("NONE", 0x00, 0x6200),
        ],
      }),
    );

    expect(
      response!.names.map((name: NetbiosNodeName) => {
        return [
          name.name.trimEnd(),
          name.isGroup,
          name.isDeregistering,
          name.isConflict,
          name.isActive,
        ];
      }),
    ).toEqual([
      ["G", true, false, false, false],
      ["DRG", false, true, false, false],
      ["CNF", false, false, true, false],
      ["ACT", false, false, false, true],
      ["NONE", false, false, false, false],
    ]);
  });
});

describe("parseNbstatResponse — responses that are not a usable NBSTAT answer", () => {
  it("rejects a datagram with the R bit clear", () => {
    expect(parseNbstatResponse(buildResponse({ flags: 0x0400 }))).toBeNull();
  });

  it("rejects any opcode other than query", () => {
    // Opcode 5 (registration) and 8 (refresh) occupy bits 1-4 of FLAGS.
    expect(
      parseNbstatResponse(buildResponse({ flags: 0x8400 | (5 << 11) })),
    ).toBeNull();
    expect(
      parseNbstatResponse(buildResponse({ flags: 0x8400 | (8 << 11) })),
    ).toBeNull();
  });

  it("rejects a non-zero RCODE", () => {
    for (const rcode of [1, 2, 3, 4, 5, 6, 7, 15]) {
      expect(
        parseNbstatResponse(buildResponse({ flags: 0x8400 | rcode })),
      ).toBeNull();
    }
  });

  it("ignores NM_FLAGS it does not care about", () => {
    // AA, TC, RD, RA, B: none of them change what the answer says.
    expect(
      parseNbstatResponse(buildResponse({ flags: 0x8000 | 0x07f0 })),
    ).not.toBeNull();
  });

  it("rejects a response with no answer records", () => {
    expect(parseNbstatResponse(buildResponse({ answerCount: 0 }))).toBeNull();
  });

  it("rejects an answer whose TYPE is not NBSTAT", () => {
    // 0x0020 is NB, the answer to a NAME query — a different table.
    expect(
      parseNbstatResponse(buildResponse({ recordType: 0x0020 })),
    ).toBeNull();
  });

  it("rejects an answer whose CLASS is not IN", () => {
    expect(
      parseNbstatResponse(buildResponse({ recordClass: 0x0003 })),
    ).toBeNull();
  });

  it("rejects an RR_NAME using a reserved label type", () => {
    expect(
      parseNbstatResponse(buildResponse({ recordName: "4000" })),
    ).toBeNull();
    expect(
      parseNbstatResponse(buildResponse({ recordName: "8000" })),
    ).toBeNull();
  });

  it("rejects an RDLENGTH too short to hold NUM_NAMES", () => {
    expect(
      parseNbstatResponse(buildResponse({ recordDataLength: 0 })),
    ).toBeNull();
  });

  it("rejects anything shorter than a header, and anything that is not a Buffer", () => {
    expect(parseNbstatResponse(Buffer.alloc(0))).toBeNull();
    expect(parseNbstatResponse(Buffer.alloc(11))).toBeNull();

    for (const value of [undefined, null, "8400", 42, {}, [0x84, 0x00]]) {
      expect(parseNbstatResponse(value as unknown as Buffer)).toBeNull();
    }
  });

  it("rejects a declared question that runs off the end", () => {
    expect(
      parseNbstatResponse(buildResponse({ questionCount: 0xffff })),
    ).toBeNull();
  });
});

describe("parseNbstatResponse — damaged name tables yield what can be read", () => {
  it("never throws at any truncation of a Windows response, and returns null or a prefix of its names", () => {
    const fullNames: Array<NetbiosNodeName> =
      parseNbstatResponse(WINDOWS_RESPONSE)!.names;

    // 12 header + 34 name + 10 fixed RR fields = offset of NUM_NAMES.
    const numNamesOffset: number = 56;

    for (let length: number = 0; length <= WINDOWS_RESPONSE.length; length++) {
      const truncated: Buffer = WINDOWS_RESPONSE.subarray(0, length);
      let response: NbstatResponse | null = null;

      expect(() => {
        response = parseNbstatResponse(truncated);
      }).not.toThrow();

      if (length <= numNamesOffset) {
        expect({ length: length, response: response }).toEqual({
          length: length,
          response: null,
        });
        continue;
      }

      const wholeEntries: number = Math.min(
        5,
        Math.floor((length - numNamesOffset - 1) / 18),
      );

      expect({
        length: length,
        names: (response as NbstatResponse | null)?.names,
      }).toEqual({
        length: length,
        names: fullNames.slice(0, wholeEntries),
      });
    }
  });

  it("the truncated workstation entry alone is still enough to name the host", () => {
    // Cut straight after the first entry: everything else is gone.
    const response: NbstatResponse | null = parseNbstatResponse(
      WINDOWS_RESPONSE.subarray(0, 57 + 18),
    );

    expect(chooseNetbiosName(response!.names)).toBe("workstation01");
  });

  it("reads only the entries present when NUM_NAMES claims more", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        entries: [
          entry("ONE", 0x00, UNIQUE_ACTIVE),
          entry("TWO", 0x20, UNIQUE_ACTIVE),
        ],
        declaredNameCount: 255,
        recordDataLength: 0xffff,
      }),
    );

    expect(namesOf(response)).toEqual(["ONE<00>", "TWO<20>"]);
  });

  it("reads no further than RDLENGTH allows even when more bytes follow", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        entries: [
          entry("ONE", 0x00, UNIQUE_ACTIVE),
          entry("TWO", 0x20, UNIQUE_ACTIVE),
        ],
        // NUM_NAMES + one entry and a half.
        recordDataLength: 1 + 18 + 9,
      }),
    );

    expect(namesOf(response)).toEqual(["ONE<00>"]);
  });

  it("reads fewer entries than NUM_NAMES when fewer are declared", () => {
    const response: NbstatResponse | null = parseNbstatResponse(
      buildResponse({
        entries: [
          entry("ONE", 0x00, UNIQUE_ACTIVE),
          entry("TWO", 0x20, UNIQUE_ACTIVE),
        ],
        declaredNameCount: 1,
      }),
    );

    expect(namesOf(response)).toEqual(["ONE<00>"]);
  });
});

describe("chooseNetbiosName", () => {
  function node(
    name: string,
    suffix: number,
    overrides?: Partial<NetbiosNodeName>,
  ): NetbiosNodeName {
    return {
      name: name.padEnd(15, " "),
      suffix: suffix,
      isGroup: false,
      isConflict: false,
      isDeregistering: false,
      isActive: true,
      ...overrides,
    };
  }

  it("prefers the unique <00> name even when <20> is listed first", () => {
    expect(
      chooseNetbiosName([node("SRV-TWENTY", 0x20), node("SRV-ZERO", 0x00)]),
    ).toBe("srv-zero");
  });

  it("falls back to the unique <20> name when there is no usable <00>", () => {
    expect(
      chooseNetbiosName([
        node("CORP", 0x00, { isGroup: true }),
        node("NAS", 0x20),
      ]),
    ).toBe("nas");
  });

  it("never picks a group name, however it is listed", () => {
    expect(
      chooseNetbiosName([
        node("CORP", 0x00, { isGroup: true }),
        node("CORP", 0x20, { isGroup: true }),
      ]),
    ).toBeUndefined();
  });

  it("skips names in conflict or being deregistered", () => {
    expect(
      chooseNetbiosName([
        node("STOLEN", 0x00, { isConflict: true }),
        node("LEAVING", 0x00, { isDeregistering: true }),
        node("REAL", 0x00),
      ]),
    ).toBe("real");
    expect(
      chooseNetbiosName([
        node("STOLEN", 0x00, { isConflict: true }),
        node("LEAVING", 0x20, { isDeregistering: true }),
      ]),
    ).toBeUndefined();
  });

  it("skips __MSBROWSE__ even when a broken stack flags it unique", () => {
    expect(
      chooseNetbiosName([
        node("\u0001\u0002__MSBROWSE__\u0002", 0x00),
        node("__MSBROWSE__", 0x00),
        node("HOST", 0x20),
      ]),
    ).toBe("host");
  });

  it("skips the IIS IS~ name that sits beside the workstation name", () => {
    expect(
      chooseNetbiosName([node("IS~WEB01", 0x00), node("WEB01", 0x00)]),
    ).toBe("web01");
  });

  it("moves past a <00> name that does not normalise to the next one", () => {
    expect(
      chooseNetbiosName([node("BAD NAME", 0x00), node("GOOD", 0x00)]),
    ).toBe("good");
  });

  it("does not name a machine after its messenger or domain-role suffixes", () => {
    expect(
      chooseNetbiosName([
        node("ALICE", 0x03),
        node("CORP", 0x1b),
        node("CORP", 0x1c),
        node("CORP", 0x1d),
      ]),
    ).toBeUndefined();
  });

  it("does not require the ACT bit", () => {
    expect(chooseNetbiosName([node("QUIET", 0x00, { isActive: false })])).toBe(
      "quiet",
    );
  });

  it("returns undefined for an empty table or something that is not a table", () => {
    expect(chooseNetbiosName([])).toBeUndefined();

    for (const value of [undefined, null, "HOST", 5, {}]) {
      expect(
        chooseNetbiosName(value as unknown as Array<NetbiosNodeName>),
      ).toBeUndefined();
    }

    expect(
      chooseNetbiosName([
        null,
        { suffix: 0 },
      ] as unknown as Array<NetbiosNodeName>),
    ).toBeUndefined();
  });
});

describe("parseNbstatResponse — seeded hostile datagrams", () => {
  /*
   * A deterministic LCG, so a failure reproduces from the seed and the suite
   * can never be flaky. Math.random would make "never throws" a claim tested
   * on a different set of inputs every run.
   */
  function seededRandom(seed: number): () => number {
    let state: number = seed >>> 0;

    return (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function expectWellFormed(response: NbstatResponse | null): void {
    if (response === null) {
      return;
    }

    expect(response.transactionId).toBeGreaterThanOrEqual(0);
    expect(response.transactionId).toBeLessThanOrEqual(0xffff);

    for (const name of response.names) {
      expect(name.name).toHaveLength(15);
      expect(name.suffix).toBeGreaterThanOrEqual(0);
      expect(name.suffix).toBeLessThanOrEqual(255);
    }

    const chosen: string | undefined = chooseNetbiosName(response.names);

    if (chosen !== undefined) {
      expect(chosen).toMatch(/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/);
      expect(chosen.length).toBeLessThanOrEqual(15);
    }
  }

  it("never throws on random bytes", () => {
    const random: () => number = seededRandom(0x3677);

    for (let iteration: number = 0; iteration < 5000; iteration++) {
      const length: number = Math.floor(random() * 160);
      const buffer: Buffer = Buffer.alloc(length);

      for (let index: number = 0; index < length; index++) {
        buffer[index] = Math.floor(random() * 256);
      }

      // Bias a share of them toward passing the header checks.
      if (length >= 8 && random() < 0.5) {
        buffer.writeUInt16BE(0x8400, 2);
        buffer.writeUInt16BE(1, 6);
      }

      let response: NbstatResponse | null = null;

      expect(() => {
        response = parseNbstatResponse(buffer);
      }).not.toThrow();

      expectWellFormed(response);
    }
  });

  it("never throws on mutated copies of real responses", () => {
    const random: () => number = seededRandom(0xc0ffee);
    let parsedCount: number = 0;

    for (let iteration: number = 0; iteration < 5000; iteration++) {
      const source: Buffer =
        iteration % 2 === 0 ? WINDOWS_RESPONSE : SAMBA_RESPONSE;
      const buffer: Buffer = Buffer.from(source);
      const mutations: number = 1 + Math.floor(random() * 6);

      for (let index: number = 0; index < mutations; index++) {
        buffer[Math.floor(random() * buffer.length)] = Math.floor(
          random() * 256,
        );
      }

      const cut: Buffer =
        random() < 0.3
          ? buffer.subarray(0, Math.floor(random() * buffer.length))
          : buffer;

      let response: NbstatResponse | null = null;

      expect(() => {
        response = parseNbstatResponse(cut);
      }).not.toThrow();

      if (response !== null) {
        parsedCount++;
      }

      expectWellFormed(response);
    }

    // A guard on the guard: mutations must not ALL be rejected at the header.
    expect(parsedCount).toBeGreaterThan(500);
  });
});
