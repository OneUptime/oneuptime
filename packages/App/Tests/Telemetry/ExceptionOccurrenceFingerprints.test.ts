/*
 * WHICH EXCEPTION AN OCCURRENCE BELONGS TO, WHATEVER A SCRUB RULE HID (#10434).
 *
 * ExceptionUtil.getOccurrenceFingerprints makes an occurrence's fingerprints
 * from the exception as it arrived and from what the scrub rules left of it,
 * and resolveGroupFingerprints picks the exception it belongs to: the first
 * of its candidates one exists under, else a new one under its v2. These
 * pin both, with Postgres mocked: the ingest walks are in
 * ScrubRuleExceptionGroups.test.ts.
 */
import ExceptionUtil, {
  EXISTING_GROUP_CACHE_MAX_ENTRIES,
  ExceptionGroupingContent,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  RECORD_SPLIT_PAIR_SQL,
  GroupFingerprintCandidate,
  OccurrenceFingerprints,
  ResolvedGroups,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
  groupFingerprintKey,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import {
  getExceptionGroupingKey,
  getExceptionGroupingText,
} from "Common/Server/Utils/Telemetry/ExceptionGrouping";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-00000000e434",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-00000000e434",
);

// A message-only exception: grouping v2 reads its message.
const CARD_ARRIVED: ExceptionGroupingContent = {
  exceptionType: "PaymentDeclinedError",
  message: "card 4111-1111-1111-4821 declined",
  stackTrace: "",
};
const CARD_STORED: ExceptionGroupingContent = {
  ...CARD_ARRIVED,
  message: "card [REDACTED] declined",
};

// One with a stack trace: grouping v2 reads its frames, not its message.
const CART_STACK: string = [
  "TypeError: no cart for ada@example.com",
  "    at checkout (/app/src/cart.ts:10:15)",
  "    at reserve (/app/src/stock.ts:4:3)",
].join("\n");
const CART_ARRIVED: ExceptionGroupingContent = {
  exceptionType: "TypeError",
  message: "no cart for ada@example.com",
  stackTrace: CART_STACK,
};
const CART_STORED: ExceptionGroupingContent = {
  exceptionType: "TypeError",
  message: "no cart for [REDACTED]",
  stackTrace: [
    "TypeError: no cart for [REDACTED]",
    "    at checkout (/app/src/cart.ts:10:15)",
    "    at reserve (/app/src/stock.ts:4:3)",
  ].join("\n"),
};

interface Fingerprints {
  v1: string;
  // The keyed one of v1's text, where a v1 exception moves (#10619).
  keyedV1: string;
  v2: string;
  keyed: string;
  // Grouping v3's, and its keyed one (#10620): v2's for frames.
  v3: string;
  keyedV3: string;
  // Grouping v4's, and its keyed one (#10898): v2's for frames.
  v4: string;
  keyedV4: string;
}

// An exception's fingerprints, made the way the ingest made them before.
function fingerprintsOf(content: ExceptionGroupingContent): Fingerprints {
  const input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    message: string;
    stackTrace: string;
    exceptionType: string;
  } = {
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    ...content,
  };

  return {
    v1: ExceptionUtil.getFingerprint(input),
    keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTextV1(input),
    }),
    v2: ExceptionUtil.getFingerprintV2(input),
    keyed: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: getExceptionGroupingText({
        projectId: PROJECT_ID.toString(),
        primaryEntityId: SERVICE_ID.toString(),
        key: getExceptionGroupingKey(content),
      }),
    }),
    v3: ExceptionUtil.getFingerprintV3(input),
    keyedV3: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTexts(input).v3,
    }),
    v4: ExceptionUtil.getFingerprintV4(input),
    keyedV4: KeyedExceptionFingerprint.ofGroupingText({
      projectId: PROJECT_ID,
      text: ExceptionUtil.getGroupingTexts(input).v4,
    }),
  };
}

function occurrence(data: {
  arrived: ExceptionGroupingContent;
  stored: ExceptionGroupingContent;
  fromLog?: boolean;
}): OccurrenceFingerprints {
  return ExceptionUtil.getOccurrenceFingerprints({
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    arrived: data.arrived,
    stored: data.stored,
    findsGroupsOfStoredText: data.fromLog,
  });
}

describe("an occurrence's fingerprints", () => {
  test("no rule changed it: v1, v2, v3 and v4, each with its keyed one, are tried in that order, a new exception is made under v4, and v1 is kept when nothing can be read", () => {
    const card: Fingerprints = fingerprintsOf(CARD_ARRIVED);

    for (const fromLog of [false, true]) {
      expect(
        occurrence({ arrived: CARD_ARRIVED, stored: CARD_ARRIVED, fromLog }),
      ).toEqual({
        fingerprint: card.v1,
        fingerprintV2: card.v4,
        fingerprintCandidates: [
          card.v1,
          card.keyedV1,
          card.v2,
          card.keyed,
          card.v3,
          card.keyedV3,
          card.v4,
          card.keyedV4,
        ],
      });
    }

    // Grouped by its frames, v3 and v4 are v2: each is tried once.
    const cart: Fingerprints = fingerprintsOf(CART_ARRIVED);
    expect(cart.v3).toBe(cart.v2);
    expect(cart.keyedV3).toBe(cart.keyed);
    expect(cart.v4).toBe(cart.v2);
    expect(cart.keyedV4).toBe(cart.keyed);
    expect(occurrence({ arrived: CART_ARRIVED, stored: CART_ARRIVED })).toEqual(
      {
        fingerprint: cart.v1,
        fingerprintV2: cart.v2,
        fingerprintCandidates: [cart.v1, cart.keyedV1, cart.v2, cart.keyed],
      },
    );
  });

  test("the fingerprints an occurrence no rule changed was given before #10434 stay its own", () => {
    const expected: Fingerprints = fingerprintsOf(CART_ARRIVED);
    const fingerprints: OccurrenceFingerprints = occurrence({
      arrived: CART_ARRIVED,
      stored: CART_ARRIVED,
    });

    // What a span's exception was given: v1 kept, v2 made under.
    expect(fingerprints.fingerprint).toBe(expected.v1);
    expect(fingerprints.fingerprintV2).toBe(expected.v2);
  });

  test("a rule hid a card number: tried as it arrived, and made under v4, which folds the card, as kept when nothing can be read", () => {
    const arrived: Fingerprints = fingerprintsOf(CARD_ARRIVED);

    expect(occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED })).toEqual({
      fingerprint: arrived.v4,
      fingerprintV2: arrived.v4,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
        arrived.v4,
        arrived.keyedV4,
      ],
      /*
       * v1 and v2 hash the card's digits: an exception made under either
       * moves (#10619). v3's and v4's texts hold <CARD> whatever the card
       * was.
       */
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
      },
    });
  });

  test("a rule hid what grouping v3 and v4 read too, a name: made under v4's keyed fingerprint, and kept under it when nothing can be read", () => {
    const named: ExceptionGroupingContent = {
      exceptionType: "AccountError",
      message: "No account for Ada Lovelace",
      stackTrace: "",
    };
    const arrived: Fingerprints = fingerprintsOf(named);

    expect(
      occurrence({
        arrived: named,
        stored: { ...named, message: "No account for [REDACTED]" },
      }),
    ).toEqual({
      fingerprint: arrived.keyedV4,
      fingerprintV2: arrived.keyedV4,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
        arrived.v4,
        arrived.keyedV4,
      ],
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
        [arrived.v3]: arrived.keyedV3,
        [arrived.v4]: arrived.keyedV4,
      },
    });
  });

  test("for a log, the exceptions grouped by what the rule left are tried first: those a rule split before #10434", () => {
    const arrived: Fingerprints = fingerprintsOf(CARD_ARRIVED);
    const stored: Fingerprints = fingerprintsOf(CARD_STORED);

    expect(
      occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED, fromLog: true }),
    ).toEqual({
      fingerprint: arrived.v4,
      fingerprintV2: arrived.v4,
      fingerprintCandidates: [
        stored.v1,
        stored.v2,
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
        arrived.v3,
        arrived.keyedV3,
        arrived.v4,
        arrived.keyedV4,
      ],
      // What the rule left hashes nothing hidden: never moved.
      fingerprintRekeys: {
        [arrived.v1]: arrived.keyedV1,
        [arrived.v2]: arrived.keyed,
      },
      // An exception found under one of these is one a rule split (#10618).
      fingerprintsOfStoredText: [stored.v1, stored.v2],
    });

    // A span's copy names none: spans were never grouped by what a rule left.
    expect(
      occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED })
        .fingerprintsOfStoredText,
    ).toBeUndefined();
  });

  test("a rule hid only an address in a stack trace's message: made under v2 as it arrived, which leaves the message out, and kept under v1, which folds the address", () => {
    const arrived: Fingerprints = fingerprintsOf(CART_ARRIVED);
    const stored: Fingerprints = fingerprintsOf(CART_STORED);

    // The frames are the same with the address or without it.
    expect(stored.v2).toBe(arrived.v2);
    expect(stored.v1).not.toBe(arrived.v1);

    expect(occurrence({ arrived: CART_ARRIVED, stored: CART_STORED })).toEqual({
      fingerprint: arrived.v1,
      fingerprintV2: arrived.v2,
      fingerprintCandidates: [
        arrived.v1,
        arrived.keyedV1,
        arrived.v2,
        arrived.keyed,
      ],
      /*
       * Neither hashes the address - v1's text holds <EMAIL> in its place -
       * so an exception under either keeps its fingerprint: no moves.
       */
    });

    // A log tries what it was grouped by before, once each.
    expect(
      occurrence({ arrived: CART_ARRIVED, stored: CART_STORED, fromLog: true })
        .fingerprintCandidates,
    ).toEqual([
      stored.v1,
      arrived.v2,
      arrived.v1,
      arrived.keyedV1,
      arrived.keyed,
    ]);
  });

  test("is the same every time, and another in another service or project", () => {
    const first: OccurrenceFingerprints = occurrence({
      arrived: CARD_ARRIVED,
      stored: CARD_STORED,
      fromLog: true,
    });

    expect(
      occurrence({ arrived: CARD_ARRIVED, stored: CARD_STORED, fromLog: true }),
    ).toEqual(first);

    const elsewhere: Array<OccurrenceFingerprints> = [
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: PROJECT_ID,
        primaryEntityId: ObjectID.generate(),
        arrived: CARD_ARRIVED,
        stored: CARD_STORED,
      }),
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: ObjectID.generate(),
        primaryEntityId: SERVICE_ID,
        arrived: CARD_ARRIVED,
        stored: CARD_STORED,
      }),
    ];

    for (const other of elsewhere) {
      expect(other.fingerprintV2).not.toBe(first.fingerprintV2);
      for (const candidate of other.fingerprintCandidates) {
        expect(first.fingerprintCandidates).not.toContain(candidate);
      }
    }
  });
});

// The fingerprints the mocked Postgres holds exceptions under.
let existing: Set<string>;
// Those only kept for an exception moved to a private fingerprint: where it went.
let movedTo: Map<string, string>;
let lookups: Array<Array<unknown>>;
let lookupFails: boolean;
// The pairs of exceptions a rule split, as recorded.
let splitRecords: Array<Array<unknown>>;

function mockPostgres(): void {
  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
          lookups.push(params);
          if (lookupFails) {
            throw new Error("connection reset");
          }
          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return existing.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return { fingerprint, movedTo: movedTo.get(fingerprint) || null };
            });
        }
        if (sql === RECORD_SPLIT_PAIR_SQL) {
          splitRecords.push(params);
        }
        return [];
      },
    },
  } as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  // A failed read is tried again at once (#11027).
  jest.spyOn(ExceptionUtil, "pauseBeforeLookupRetry").mockResolvedValue();
}

describe("which exception an occurrence with candidates belongs to", () => {
  beforeEach(() => {
    clearExistingV1FingerprintCache();
    existing = new Set<string>();
    movedTo = new Map<string, string>();
    lookups = [];
    lookupFails = false;
    splitRecords = [];
    mockPostgres();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function resolve(
    candidates: Array<GroupFingerprintCandidate>,
    now?: number,
  ): Promise<Map<string, string>> {
    return ExceptionUtil.resolveGroupFingerprints(candidates, now);
  }

  const HIDDEN: GroupFingerprintCandidate = {
    projectId: "p",
    v1: "keyed",
    v2: "keyed",
    candidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
  };
  const SEEN_AS_IT_CAME: GroupFingerprintCandidate = {
    projectId: "p",
    v1: "v1",
    v2: "v2",
    candidates: ["v1", "v2", "keyed"],
  };

  test("the first candidate an exception exists under, in their order", async () => {
    existing = new Set<string>(["v2", "keyed"]);

    const chosen: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(chosen.get(groupFingerprintKey(HIDDEN))).toBe("v2");
    expect(chosen.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v2");

    existing = new Set<string>(["stored-v2", "v1"]);
    clearExistingV1FingerprintCache();

    expect((await resolve([HIDDEN])).get(groupFingerprintKey(HIDDEN))).toBe(
      "stored-v2",
    );
  });

  test("one read for the project, with every candidate the batch tries once", async () => {
    await resolve([HIDDEN, SEEN_AS_IT_CAME]);

    expect(lookups).toEqual([
      ["p", ["stored-v1", "stored-v2", "v1", "v2", "keyed"]],
    ]);
  });

  test("none existing, it is made under its v2: the occurrences after it in the batch find it, whichever came first", async () => {
    const hiddenFirst: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(hiddenFirst.get(groupFingerprintKey(HIDDEN))).toBe("keyed");
    expect(hiddenFirst.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("keyed");

    clearExistingV1FingerprintCache();

    const seenFirst: Map<string, string> = await resolve([
      SEEN_AS_IT_CAME,
      HIDDEN,
    ]);

    expect(seenFirst.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v2");
    expect(seenFirst.get(groupFingerprintKey(HIDDEN))).toBe("v2");
  });

  test("and the batches this process reads next find it too, without reading again", async () => {
    await resolve([HIDDEN]);
    expect(lookups).toHaveLength(1);

    // The rule is removed: the next copy no rule changes finds the exception.
    const next: Map<string, string> = await resolve([SEEN_AS_IT_CAME]);

    expect(next.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("keyed");
    expect(lookups).toHaveLength(1);
  });

  test("a read that fails every try leaves the exception unknown, and its occurrence goes under the fingerprint a new one is made under, never v1 (#11027)", async () => {
    lookupFails = true;

    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(resolved.chosen.size).toBe(0);
    expect(Array.from(resolved.unknown.keys())).toEqual([
      groupFingerprintKey(HIDDEN),
      groupFingerprintKey(SEEN_AS_IT_CAME),
    ]);
    // Tried three times, once a project.
    expect(lookups).toHaveLength(3);

    const chosen: Map<string, string> = await resolve([
      HIDDEN,
      SEEN_AS_IT_CAME,
    ]);

    expect(chosen.get(groupFingerprintKey(HIDDEN))).toBe("keyed");
    // Not v1, which every later occurrence would try first.
    expect(chosen.get(groupFingerprintKey(SEEN_AS_IT_CAME))).toBe("v2");
    expect(logger.warn).toHaveBeenCalled();
  });

  test("what a read found is kept for the whole read, though the cache fills and is cleared midway", async () => {
    // Project a's exceptions fill the cache to its cap...
    const many: Array<GroupFingerprintCandidate> = [];

    for (
      let index: number = 0;
      index < EXISTING_GROUP_CACHE_MAX_ENTRIES;
      index++
    ) {
      many.push({
        projectId: "a",
        v1: `a-v1-${index}`,
        v2: `a-v2-${index}`,
      });
    }

    existing = new Set<string>(["a-v1-0"]);

    // ...and project b's, read after them in the same batch, clear it.
    const chosen: Map<string, string> = await resolve([
      ...many,
      { projectId: "b", v1: "b-v1", v2: "b-v2" },
    ]);

    expect(lookups).toHaveLength(2);
    expect(chosen.get(groupFingerprintKey(many[0]!))).toBe("a-v1-0");
    expect(chosen.get(groupFingerprintKey(many[1]!))).toBe("a-v2-1");
  });

  test("rows and payloads are given the chosen fingerprint, and keep no candidates or v2 of their own", async () => {
    existing = new Set<string>(["v1"]);

    const rows: Array<JSONObject> = [
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "v2",
        fingerprintCandidates: ["v1", "v2", "keyed"],
      },
      {
        projectId: "p",
        fingerprint: "keyed",
        fingerprintV2: "keyed",
        fingerprintCandidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
      },
      // A row with no v2 is left as it is, but for its candidates.
      { projectId: "p", fingerprint: "x", fingerprintCandidates: ["v1"] },
    ];

    await ExceptionUtil.assignRowGroupFingerprints(rows);

    expect(rows).toEqual([
      { projectId: "p", fingerprint: "v1" },
      { projectId: "p", fingerprint: "v1" },
      { projectId: "p", fingerprint: "x" },
    ]);

    const payloads: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.assignPayloadGroupFingerprints([
        {
          fingerprint: "keyed",
          fingerprintV2: "keyed",
          fingerprintCandidates: [
            "stored-v1",
            "stored-v2",
            "v1",
            "v2",
            "keyed",
          ],
          projectId: PROJECT_ID,
          primaryEntityId: SERVICE_ID,
        },
      ]);

    // The exception its row was filed under: the one from before the rule.
    expect(payloads[0]!.fingerprint).toBe("v1");
    expect(payloads[0]).not.toHaveProperty("fingerprintV2");
    expect(payloads[0]).not.toHaveProperty("fingerprintCandidates");
  });

  test("a row's candidates are read with care: anything but text is left out, and no list is its v1 alone", async () => {
    existing = new Set<string>(["v2"]);

    const rows: Array<JSONObject> = [
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "keyed",
        fingerprintCandidates: [42, null, "", "v2"] as never,
      },
      {
        projectId: "p",
        fingerprint: "v1",
        fingerprintV2: "fresh",
        fingerprintCandidates: "v2" as never,
      },
    ];

    await ExceptionUtil.assignRowGroupFingerprints(rows);

    expect(rows[0]!["fingerprint"]).toBe("v2");
    // Its v1 alone was tried, and no exception exists under it.
    expect(rows[1]!["fingerprint"]).toBe("fresh");
  });

  // A log's occurrence a rule changed, with what the rule left tried first.
  const SPLIT: GroupFingerprintCandidate = {
    projectId: "p",
    primaryEntityId: "s",
    v1: "v2",
    v2: "v2",
    candidates: ["stored-v1", "stored-v2", "v1", "v2", "keyed"],
    storedOnly: ["stored-v1", "stored-v2"],
  };

  test("an occurrence that lands on an exception a rule split, while one exists under what it said as it arrived, records the pair on the split one (#10618)", async () => {
    existing = new Set<string>(["stored-v2", "v2"]);

    const chosen: Map<string, string> = await resolve([SPLIT]);

    // It keeps landing where it has since the rule: nothing is merged.
    expect(chosen.get(groupFingerprintKey(SPLIT))).toBe("stored-v2");
    expect(splitRecords).toEqual([["p", "s", "stored-v2", "v2"]]);

    // Once in a process, however many occurrences follow.
    await resolve([SPLIT]);
    expect(splitRecords).toHaveLength(1);
  });

  test("the one it was split from, since moved to a private fingerprint, is named by where it went", async () => {
    existing = new Set<string>(["stored-v1", "v1"]);
    movedTo.set("v1", "keyed-v1");

    await resolve([SPLIT]);

    expect(splitRecords).toEqual([["p", "s", "stored-v1", "keyed-v1"]]);
  });

  test("no pair without an exception from before the rule, nor for one found as it arrived", async () => {
    existing = new Set<string>(["stored-v1"]);
    await resolve([SPLIT]);

    clearExistingV1FingerprintCache();
    existing = new Set<string>(["v2", "keyed"]);
    await resolve([SPLIT]);

    expect(splitRecords).toEqual([]);
  });

  test("a failed record never fails the batch", async () => {
    existing = new Set<string>(["stored-v2", "v2"]);
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          if (sql === RECORD_SPLIT_PAIR_SQL) {
            throw new Error("deadlock detected");
          }
          return (params[1] as Array<string>)
            .filter((fingerprint: string): boolean => {
              return existing.has(fingerprint);
            })
            .map((fingerprint: string) => {
              return { fingerprint, movedTo: null };
            });
        },
      },
    } as never);

    const chosen: Map<string, string> = await resolve([SPLIT]);

    expect(chosen.get(groupFingerprintKey(SPLIT))).toBe("stored-v2");
    expect(logger.warn).toHaveBeenCalled();
  });
});

/*
 * GROUPING V4 (#10898): an international phone number, a 15-digit American
 * Express card or a 19-digit card in a message is folded too, for new
 * exceptions; v4's fingerprints are tried after v3's, so every exception
 * made before keeps the occurrences it had.
 */
describe("grouping v4's fingerprints, tried after every older one", () => {
  beforeEach(() => {
    clearExistingV1FingerprintCache();
    existing = new Set<string>();
    movedTo = new Map<string, string>();
    lookups = [];
    lookupFails = false;
    splitRecords = [];
    mockPostgres();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const phone: (number: string) => ExceptionGroupingContent = (
    number: string,
  ): ExceptionGroupingContent => {
    return {
      exceptionType: "SmsDeliveryError",
      message: `SMS to ${number} was not delivered`,
      stackTrace: "",
    };
  };

  const LONDON: ExceptionGroupingContent = phone("+44 20 7946 0958");
  const BERLIN: ExceptionGroupingContent = phone("+49 30 123456");
  const PARIS: ExceptionGroupingContent = phone("+33 1 23 45 67 89");

  function candidateOf(
    content: ExceptionGroupingContent,
    stored?: ExceptionGroupingContent,
  ): GroupFingerprintCandidate {
    const fingerprints: OccurrenceFingerprints = occurrence({
      arrived: content,
      stored: stored || content,
    });

    return {
      projectId: PROJECT_ID.toString(),
      primaryEntityId: SERVICE_ID.toString(),
      v1: fingerprints.fingerprint,
      v2: fingerprints.fingerprintV2,
      candidates: fingerprints.fingerprintCandidates,
      ...(fingerprints.fingerprintRekeys
        ? { rekeys: fingerprints.fingerprintRekeys }
        : {}),
    };
  }

  test("no rule changed it: v1 to v3 as before, then v4 and its keyed one, and every number makes one new exception, under v4", () => {
    const london: Fingerprints = fingerprintsOf(LONDON);
    const berlin: Fingerprints = fingerprintsOf(BERLIN);

    expect(occurrence({ arrived: LONDON, stored: LONDON })).toEqual({
      fingerprint: london.v1,
      fingerprintV2: london.v4,
      fingerprintCandidates: [
        london.v1,
        london.keyedV1,
        london.v2,
        london.keyed,
        london.v3,
        london.keyedV3,
        london.v4,
        london.keyedV4,
      ],
    });

    // Each number its own exception under v1 to v3; one under v4.
    for (const version of [
      "v1",
      "keyedV1",
      "v2",
      "keyed",
      "v3",
      "keyedV3",
    ] as Array<keyof Fingerprints>) {
      expect(london[version]).not.toBe(berlin[version]);
    }
    expect(london.v4).toBe(berlin.v4);
    expect(london.keyedV4).toBe(berlin.keyedV4);
    expect(fingerprintsOf(PARIS).v4).toBe(london.v4);
  });

  test("a keyed v4 fingerprint is never a keyed v3 one, nor any unkeyed one", () => {
    const london: Fingerprints = fingerprintsOf(LONDON);
    const cardMessage: Fingerprints = fingerprintsOf(CARD_ARRIVED);

    for (const fingerprints of [london, cardMessage]) {
      expect(fingerprints.keyedV4).not.toBe(fingerprints.keyedV3);
      expect([
        fingerprints.v1,
        fingerprints.v2,
        fingerprints.v3,
        fingerprints.v4,
      ]).not.toContain(fingerprints.keyedV4);
      expect(fingerprints.v4).not.toBe(fingerprints.v3);
    }
  });

  test("a rule redacted an international number: v1, v2 and v3 hash it, and move; made under v4, which needs no key", () => {
    const london: Fingerprints = fingerprintsOf(LONDON);
    const redacted: ExceptionGroupingContent = {
      ...LONDON,
      message: "SMS to [REDACTED] was not delivered",
    };

    expect(occurrence({ arrived: LONDON, stored: redacted })).toEqual({
      // v1 holds the number: the one a new exception is made under is kept.
      fingerprint: london.v4,
      fingerprintV2: london.v4,
      fingerprintCandidates: [
        london.v1,
        london.keyedV1,
        london.v2,
        london.keyed,
        london.v3,
        london.keyedV3,
        london.v4,
        london.keyedV4,
      ],
      fingerprintRekeys: {
        [london.v1]: london.keyedV1,
        [london.v2]: london.keyed,
        // v3 folds no international number: its text holds this one.
        [london.v3]: london.keyedV3,
      },
    });
  });

  test("an exception made under v3 for one number keeps it, and the numbers since share one under v4, in this batch and the next", async () => {
    existing = new Set<string>([fingerprintsOf(LONDON).v3]);

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([
        candidateOf(LONDON),
        candidateOf(BERLIN),
      ]);

    expect(chosen.get(groupFingerprintKey(candidateOf(LONDON)))).toBe(
      fingerprintsOf(LONDON).v3,
    );
    expect(chosen.get(groupFingerprintKey(candidateOf(BERLIN)))).toBe(
      fingerprintsOf(BERLIN).v4,
    );

    const next: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([
        candidateOf(PARIS),
        candidateOf(LONDON),
      ]);

    expect(next.get(groupFingerprintKey(candidateOf(PARIS)))).toBe(
      fingerprintsOf(BERLIN).v4,
    );
    expect(next.get(groupFingerprintKey(candidateOf(LONDON)))).toBe(
      fingerprintsOf(LONDON).v3,
    );
  });

  test.each([
    ["v1", "v1"],
    ["v1's keyed one", "keyedV1"],
    ["v2", "v2"],
    ["v2's keyed one", "keyed"],
    ["v3", "v3"],
    ["v3's keyed one", "keyedV3"],
  ])(
    "an exception made under %s is found before v4: nothing splits",
    async (_name: string, version: string) => {
      const made: string = (
        fingerprintsOf(LONDON) as unknown as Record<string, string>
      )[version]!;
      existing = new Set<string>([made, fingerprintsOf(LONDON).v4]);

      const chosen: Map<string, string> =
        await ExceptionUtil.resolveGroupFingerprints([candidateOf(LONDON)]);

      expect(chosen.get(groupFingerprintKey(candidateOf(LONDON)))).toBe(made);
    },
  );

  test("when the exceptions cannot be read, one a rule changed keeps the newest fingerprint, tried last: the exception under an older one still gets the next occurrence", async () => {
    const named: ExceptionGroupingContent = {
      exceptionType: "SmsDeliveryError",
      message: "SMS to Ada Lovelace at +44 20 7946 0958 was not delivered",
      stackTrace: "",
    };
    const stored: ExceptionGroupingContent = {
      ...named,
      message: "SMS to [REDACTED] at +44 20 7946 0958 was not delivered",
    };
    const fingerprints: Fingerprints = fingerprintsOf(named);
    const candidate: GroupFingerprintCandidate = candidateOf(named, stored);

    // Made since v3 shipped, under v3's keyed fingerprint.
    existing = new Set<string>([fingerprints.keyedV3]);
    lookupFails = true;

    const failed: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([candidate]);

    expect(failed.get(groupFingerprintKey(candidate))).toBe(
      fingerprints.keyedV4,
    );

    /*
     * That occurrence was stored under keyed v4, and no exception was made
     * there (#11027: its count waits until the exceptions can be read).
     * Once they can, the one under keyed v3, tried first, gets every
     * occurrence: it keeps its place.
     */
    clearExistingV1FingerprintCache();
    lookupFails = false;

    const next: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([candidate]);

    expect(next.get(groupFingerprintKey(candidate))).toBe(fingerprints.keyedV3);
  });

  test("and one no rule changed goes under v4 too, never v1, which every later occurrence tries first (#11027)", async () => {
    lookupFails = true;

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([candidateOf(LONDON)]);

    expect(chosen.get(groupFingerprintKey(candidateOf(LONDON)))).toBe(
      fingerprintsOf(LONDON).v4,
    );
    expect(chosen.get(groupFingerprintKey(candidateOf(LONDON)))).not.toBe(
      fingerprintsOf(LONDON).v1,
    );
  });

  test("an American Express card and a 19-digit card: one exception each kind, whatever the number", () => {
    const card: (number: string) => ExceptionGroupingContent = (
      number: string,
    ): ExceptionGroupingContent => {
      return {
        exceptionType: "PaymentDeclinedError",
        message: `card ${number} declined`,
        stackTrace: "",
      };
    };

    for (const [first, second] of [
      ["3782 822463 10005", "3714 496353 98431"],
      ["6011 1111 1111 1111 117", "6250 9460 0000 0016 228"],
    ] as Array<[string, string]>) {
      expect(fingerprintsOf(card(first)).v3).not.toBe(
        fingerprintsOf(card(second)).v3,
      );
      expect(
        occurrence({ arrived: card(first), stored: card(first) }).fingerprintV2,
      ).toBe(
        occurrence({ arrived: card(second), stored: card(second) })
          .fingerprintV2,
      );
    }
  });
});

/*
 * #11030: WHAT A LOG'S EXCEPTION WAS FOUND BY BEFORE A PHONE NUMBER OR SSN
 * RULE HID MORE.
 *
 * An exception found in a log before #10434 is found by the text the rules
 * left of it, and since #11030 they leave less of an international number.
 * The logs ingest hands over what they left before (storedByEarlierRules):
 * its fingerprints are tried after those of what they leave now, each with
 * the keyed one it moves to, so the exception is found and moved, not
 * split.
 */
describe("what a log's exception was found by before #11030", () => {
  const ARRIVED: ExceptionGroupingContent = {
    exceptionType: "SmsDeliveryError",
    message: "SMS to +44 161 321 4567 was not delivered",
    stackTrace: "",
  };
  const STORED: ExceptionGroupingContent = {
    ...ARRIVED,
    message: "SMS to [REDACTED] was not delivered",
  };
  // The US pattern alone hid the last ten digits.
  const EARLIER: ExceptionGroupingContent = {
    ...ARRIVED,
    message: "SMS to +44 [REDACTED] was not delivered",
  };

  interface EarlierFingerprints {
    v1: string;
    keyedV1: string;
    v2: string;
    keyedV2: string;
  }

  function occurrenceOf(data: {
    stored?: ExceptionGroupingContent;
    earlier?: ExceptionGroupingContent | undefined;
    fromLog?: boolean;
  }): OccurrenceFingerprints {
    return ExceptionUtil.getOccurrenceFingerprints({
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      arrived: ARRIVED,
      stored: data.stored || STORED,
      findsGroupsOfStoredText: data.fromLog !== false,
      ...(data.earlier ? { storedByEarlierRules: data.earlier } : {}),
    });
  }

  function earlierFingerprints(
    content: ExceptionGroupingContent,
  ): EarlierFingerprints {
    const input: {
      projectId: ObjectID;
      primaryEntityId: ObjectID;
      message: string;
      stackTrace: string;
      exceptionType: string;
    } = {
      projectId: PROJECT_ID,
      primaryEntityId: SERVICE_ID,
      ...content,
    };
    const v1Text: string = ExceptionUtil.getGroupingTextV1(input);
    const v2Text: string = ExceptionUtil.getGroupingTexts(input).v2;

    return {
      v1: ExceptionUtil.getFingerprint(input),
      keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
        projectId: PROJECT_ID,
        text: v1Text,
      }),
      v2: ExceptionUtil.getFingerprintV2(input),
      keyedV2: KeyedExceptionFingerprint.ofGroupingText({
        projectId: PROJECT_ID,
        text: v2Text,
      }),
    };
  }

  test("tries what the rules left before #11030 right after what they leave now, each with its keyed one, before what it arrived as", () => {
    const now: OccurrenceFingerprints = occurrenceOf({});
    const withEarlier: OccurrenceFingerprints = occurrenceOf({
      earlier: EARLIER,
    });
    const earlier: EarlierFingerprints = earlierFingerprints(EARLIER);

    expect(withEarlier.fingerprintCandidates).toEqual([
      ...now.fingerprintCandidates.slice(0, 2),
      earlier.v1,
      earlier.keyedV1,
      earlier.v2,
      earlier.keyedV2,
      ...now.fingerprintCandidates.slice(2),
    ]);
    expect(withEarlier.fingerprintsOfStoredText).toEqual([
      ...(now.fingerprintsOfStoredText || []),
      earlier.v1,
      earlier.keyedV1,
      earlier.v2,
      earlier.keyedV2,
    ]);
  });

  test("an exception found under one of them moves to its keyed one: it hashes the calling code the rule hides now", () => {
    const now: OccurrenceFingerprints = occurrenceOf({});
    const withEarlier: OccurrenceFingerprints = occurrenceOf({
      earlier: EARLIER,
    });
    const earlier: EarlierFingerprints = earlierFingerprints(EARLIER);

    expect(withEarlier.fingerprintRekeys).toEqual({
      ...now.fingerprintRekeys,
      [earlier.v1]: earlier.keyedV1,
      [earlier.v2]: earlier.keyedV2,
    });
  });

  test("what a new exception is made under, and its own fingerprint, are as without it", () => {
    const now: OccurrenceFingerprints = occurrenceOf({});
    const withEarlier: OccurrenceFingerprints = occurrenceOf({
      earlier: EARLIER,
    });

    expect(withEarlier.fingerprint).toBe(now.fingerprint);
    expect(withEarlier.fingerprintV2).toBe(now.fingerprintV2);
  });

  test("nothing more when the rules left what they leave now, or the occurrence is a span's", () => {
    expect(occurrenceOf({ earlier: STORED })).toEqual(occurrenceOf({}));
    expect(occurrenceOf({ earlier: EARLIER, fromLog: false })).toEqual(
      occurrenceOf({ fromLog: false }),
    );
  });

  test("one equal to a fingerprint it arrived as is tried in its own place only", () => {
    const berlin: ExceptionGroupingContent = {
      ...ARRIVED,
      message: "SMS to +49 30 81234567 was not delivered",
    };
    const stored: ExceptionGroupingContent = {
      ...berlin,
      message: "SMS to [REDACTED] was not delivered",
    };
    const withEarlier: OccurrenceFingerprints =
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        arrived: berlin,
        stored,
        findsGroupsOfStoredText: true,
        // The US pattern found nothing in it: it was left as it arrived.
        storedByEarlierRules: berlin,
      });
    const without: OccurrenceFingerprints =
      ExceptionUtil.getOccurrenceFingerprints({
        projectId: PROJECT_ID,
        primaryEntityId: SERVICE_ID,
        arrived: berlin,
        stored,
        findsGroupsOfStoredText: true,
      });

    expect(withEarlier).toEqual(without);
  });

  test("an exception of before under one of them is what the resolution finds", async () => {
    clearExistingV1FingerprintCache();
    existing = new Set<string>([earlierFingerprints(EARLIER).v1]);
    movedTo = new Map<string, string>();
    lookups = [];
    lookupFails = false;
    splitRecords = [];
    mockPostgres();

    const occurrence: OccurrenceFingerprints = occurrenceOf({
      earlier: EARLIER,
    });
    const candidate: GroupFingerprintCandidate = {
      projectId: PROJECT_ID.toString(),
      v1: occurrence.fingerprint,
      v2: occurrence.fingerprintV2,
      candidates: occurrence.fingerprintCandidates,
      ...(occurrence.fingerprintsOfStoredText
        ? { storedOnly: occurrence.fingerprintsOfStoredText }
        : {}),
    };

    const chosen: Map<string, string> =
      await ExceptionUtil.resolveGroupFingerprints([candidate]);

    expect(chosen.get(groupFingerprintKey(candidate))).toBe(
      earlierFingerprints(EARLIER).v1,
    );
    jest.restoreAllMocks();
  });
});
